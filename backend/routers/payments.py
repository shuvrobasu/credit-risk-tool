import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from typing import Optional
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from database import get_db
from models.tables import Invoice, Payment, Customer
from scoring.composer import compute_and_save

router = APIRouter()


# --- Schemas ---

class PaymentCreate(BaseModel):
    invoice_id:       str
    payment_date:     date
    payment_amount:   Decimal
    payment_method:   Optional[str] = "bank"
    reference_number: Optional[str] = None


# --- Helpers ---

def _serialize(p: Payment) -> dict:
    return {
        "payment_id":      str(p.payment_id),
        "invoice_id":      str(p.invoice_id),
        "customer_id":     str(p.customer_id),
        "payment_date":    p.payment_date.isoformat(),
        "payment_amount":  float(p.payment_amount),
        "payment_method":  p.payment_method,
        "reference_number":p.reference_number,
        "days_to_pay":     p.days_to_pay,
        "days_past_due":   p.days_past_due,
        "created_at":      p.created_at.isoformat() if p.created_at else None,
    }


# --- Routes ---

@router.get("")
def list_payments(
    db:          Session = Depends(get_db),
    customer_id: Optional[str] = Query(None),
    invoice_id:  Optional[str] = Query(None),
    skip:        int = Query(0, ge=0),
    limit:       int = Query(50, le=200),
):
    q = db.query(Payment)

    if customer_id:
        q = q.filter(Payment.customer_id == customer_id)
    if invoice_id:
        q = q.filter(Payment.invoice_id == invoice_id)

    total    = q.count()
    payments = q.order_by(Payment.payment_date.desc()).offset(skip).limit(limit).all()

    return {
        "total":    total,
        "skip":     skip,
        "limit":    limit,
        "payments": [_serialize(p) for p in payments],
    }


@router.get("/stats")
def payment_stats(db: Session = Depends(get_db), customer_id: Optional[str] = Query(None)):
    q = db.query(Payment)
    if customer_id:
        q = q.filter(Payment.customer_id == customer_id)

    total_payments = q.count()
    total_amount   = q.with_entities(func.sum(Payment.payment_amount)).scalar() or 0
    avg_dtp        = q.with_entities(func.avg(Payment.days_to_pay)).scalar() or 0
    avg_dpd        = q.with_entities(func.avg(Payment.days_past_due)).scalar() or 0
    late_count     = q.filter(Payment.days_past_due > 0).count()
    early_count    = q.filter(Payment.days_past_due <= 0).count()

    return {
        "customer_id":    customer_id,
        "total_payments": total_payments,
        "total_amount":   round(float(total_amount), 2),
        "avg_days_to_pay": round(float(avg_dtp), 1),
        "avg_days_past_due": round(float(avg_dpd), 1),
        "late_count":     late_count,
        "early_count":    early_count,
        "late_pct":       round(late_count / total_payments * 100, 1) if total_payments else 0,
    }


@router.get("/{payment_id}")
def get_payment(payment_id: str, db: Session = Depends(get_db)):
    p = db.query(Payment).filter(Payment.payment_id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return _serialize(p)


@router.post("")
def create_payment(payload: PaymentCreate, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.invoice_id == payload.invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == "paid":
        raise HTTPException(status_code=400, detail="Invoice already fully paid")

    days_to_pay  = (payload.payment_date - inv.invoice_date).days
    days_past_due= (payload.payment_date - inv.due_date).days

    payment = Payment(
        invoice_id       = payload.invoice_id,
        customer_id      = str(inv.customer_id),
        payment_date     = payload.payment_date,
        payment_amount   = payload.payment_amount,
        payment_method   = payload.payment_method,
        reference_number = payload.reference_number,
        days_to_pay      = days_to_pay,
        days_past_due    = days_past_due,
    )
    db.add(payment)

    # update invoice outstanding and status
    new_outstanding = float(inv.outstanding_amount or inv.invoice_amount) - float(payload.payment_amount)

    if new_outstanding <= 0:
        inv.outstanding_amount = Decimal("0.00")
        inv.status             = "paid"
    else:
        inv.outstanding_amount = Decimal(str(round(new_outstanding, 2)))
        inv.status             = "partial"

    db.commit()
    db.refresh(payment)

    # trigger score recompute on payment event
    try:
        compute_and_save(db, str(inv.customer_id), trigger="payment_event")
    except Exception:
        pass

    return _serialize(payment)