import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, date
from typing import Optional
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from database import get_db
from models.tables import Invoice, Payment, Customer, InvoiceRiskFlag
from scoring.composer import compute_and_save

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────

class InvoiceCreate(BaseModel):
    customer_id:    str
    invoice_number: str
    invoice_date:   date
    due_date:       date
    payment_terms:  Optional[str]     = "Net30"
    invoice_amount: Decimal
    currency:       Optional[str]     = "EUR"
    dispute_flag:   Optional[bool]    = False
    dispute_reason: Optional[str]     = None


class InvoiceUpdate(BaseModel):
    dispute_flag:       Optional[bool]    = None
    dispute_reason:     Optional[str]     = None
    status:             Optional[str]     = None
    outstanding_amount: Optional[Decimal] = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _dpd(inv: Invoice) -> int:
    """Live DPD for open/partial; 0 for paid/written_off."""
    if inv.status in ("open", "partial"):
        return max(0, (date.today() - inv.due_date).days)
    return 0


def _serialize(inv: Invoice, payments: list = None, customer: Customer = None) -> dict:
    cust = customer or inv.customer  # use joined obj if passed
    d = {
        "invoice_id":         str(inv.invoice_id),
        "customer_id":        str(inv.customer_id),
        "customer_name":      cust.customer_name if cust else None,
        "customer_code":      cust.customer_code if cust else None,
        "invoice_number":     inv.invoice_number,
        "invoice_date":       inv.invoice_date.isoformat(),
        "due_date":           inv.due_date.isoformat(),
        "payment_terms":      inv.payment_terms,
        "invoice_amount":     float(inv.invoice_amount),
        "currency":           inv.currency,
        "outstanding_amount": float(inv.outstanding_amount or 0),
        "status":             inv.status,
        "dispute_flag":       inv.dispute_flag,
        "dispute_reason":     inv.dispute_reason,
        "days_past_due":      _dpd(inv),
        "created_at":         inv.created_at.isoformat() if inv.created_at else None,
    }
    if payments is not None:
        d["payments"] = [
            {
                "payment_id":     str(p.payment_id),
                "payment_date":   p.payment_date.isoformat(),
                "payment_amount": float(p.payment_amount),
                "payment_method": p.payment_method,
                "days_past_due":  p.days_past_due,
            }
            for p in payments
        ]
    return d


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
def list_invoices(
    db:           Session       = Depends(get_db),
    customer_id:  Optional[str] = Query(None),
    status:       Optional[str] = Query(None),
    overdue_only: Optional[bool]= Query(False),
    min_amount:   Optional[float]= Query(None),
    max_amount:   Optional[float]= Query(None),
    skip:         int            = Query(0, ge=0),
    limit:        int            = Query(50, le=5000),
):
    q = db.query(Invoice, Customer).join(Customer, Invoice.customer_id == Customer.customer_id)

    if customer_id:
        q = q.filter(Invoice.customer_id == customer_id)
    if status:
        q = q.filter(Invoice.status == status)
    if overdue_only:
        q = q.filter(Invoice.status.in_(["open", "partial"]), Invoice.due_date < date.today())
    if min_amount is not None:
        q = q.filter(Invoice.invoice_amount >= min_amount)
    if max_amount is not None:
        q = q.filter(Invoice.invoice_amount <= max_amount)

    total = q.count()
    rows  = q.order_by(Invoice.due_date.asc()).offset(skip).limit(limit).all()

    return {
        "total":    total,
        "skip":     skip,
        "limit":    limit,
        "invoices": [_serialize(inv, customer=cust) for inv, cust in rows],
    }


@router.get("/summary")
def invoice_summary(db: Session = Depends(get_db), customer_id: Optional[str] = Query(None)):
    q = db.query(Invoice)
    if customer_id:
        q = q.filter(Invoice.customer_id == customer_id)

    total_invoices = q.count()
    total_value    = q.with_entities(func.sum(Invoice.invoice_amount)).scalar() or 0
    open_value     = (
        q.filter(Invoice.status.in_(["open", "partial"]))
         .with_entities(func.sum(Invoice.outstanding_amount)).scalar() or 0
    )
    overdue_q      = q.filter(Invoice.status.in_(["open", "partial"]), Invoice.due_date < date.today())
    overdue_value  = overdue_q.with_entities(func.sum(Invoice.outstanding_amount)).scalar() or 0
    overdue_count  = overdue_q.count()

    return {
        "customer_id":    customer_id,
        "total_invoices": total_invoices,
        "total_value":    round(float(total_value), 2),
        "open_value":     round(float(open_value), 2),
        "overdue_value":  round(float(overdue_value), 2),
        "overdue_count":  overdue_count,
    }


@router.get("/{invoice_id}")
def get_invoice(invoice_id: str, db: Session = Depends(get_db)):
    row = (
        db.query(Invoice, Customer)
        .join(Customer, Invoice.customer_id == Customer.customer_id)
        .filter(Invoice.invoice_id == invoice_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv, cust = row
    payments  = db.query(Payment).filter(Payment.invoice_id == invoice_id).all()
    return _serialize(inv, payments=payments, customer=cust)


@router.post("")
def create_invoice(payload: InvoiceCreate, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == payload.customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    if db.query(Invoice).filter(Invoice.invoice_number == payload.invoice_number).first():
        raise HTTPException(status_code=400, detail="invoice_number already exists")

    inv = Invoice(
        customer_id        = payload.customer_id,
        invoice_number     = payload.invoice_number,
        invoice_date       = payload.invoice_date,
        due_date           = payload.due_date,
        payment_terms      = payload.payment_terms,
        invoice_amount     = payload.invoice_amount,
        currency           = payload.currency or cust.currency or "EUR",
        outstanding_amount = payload.invoice_amount,
        status             = "open",
        dispute_flag       = payload.dispute_flag,
        dispute_reason     = payload.dispute_reason,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    try:
        compute_and_save(db, payload.customer_id, trigger="invoice_event")
    except Exception:
        pass

    return _serialize(inv, customer=cust)


@router.patch("/{invoice_id}")
def update_invoice(invoice_id: str, payload: InvoiceUpdate, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(inv, field, val)

    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _serialize(inv)


@router.get("/{invoice_id}/flags")
def get_invoice_flags(invoice_id: str, db: Session = Depends(get_db)):
    flags = db.query(InvoiceRiskFlag).filter(InvoiceRiskFlag.invoice_id == invoice_id).all()
    return [
        {
            "flag_id":       str(f.flag_id),
            "flag_type":     f.flag_type,
            "flag_severity": f.flag_severity,
            "flag_message":  f.flag_message,
            "resolved":      f.resolved,
            "created_at":    f.created_at.isoformat() if f.created_at else None,
        }
        for f in flags
    ]