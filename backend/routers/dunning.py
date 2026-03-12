# routers/dunning.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models.tables import DunningLog, Customer, Invoice, DunningTemplate
from dunning.engine import evaluate_invoice, evaluate_customer, run_portfolio_dunning

router = APIRouter()


def _serialize_log(d: DunningLog) -> dict:
    return {
        "dunning_id":            str(d.dunning_id),
        "invoice_id":            str(d.invoice_id),
        "customer_id":           str(d.customer_id),
        "dunning_step":          d.dunning_step,
        "template_id":           str(d.template_id) if d.template_id else None,
        "sent_at":               d.sent_at.isoformat() if d.sent_at else None,
        "sent_via":              d.sent_via,
        "sent_to":               d.sent_to,
        "sent_cc":               d.sent_cc,
        "delivery_status":       d.delivery_status,
        "days_past_due_at_send": d.days_past_due_at_send,
        "created_at":            d.created_at.isoformat() if d.created_at else None,
    }


# --- Evaluation endpoints ---

@router.post("/evaluate/invoice/{invoice_id}")
def evaluate_single_invoice(
    invoice_id: str,
    dry_run:    bool = False,
    db: Session = Depends(get_db),
):
    inv = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    try:
        return evaluate_invoice(db, invoice_id, dry_run=dry_run)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate/customer/{customer_id}")
def evaluate_single_customer(
    customer_id: str,
    dry_run:     bool = False,
    db: Session = Depends(get_db),
):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    try:
        return evaluate_customer(db, customer_id, dry_run=dry_run)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate/portfolio")
def evaluate_portfolio(
    dry_run: bool = False,
    db: Session = Depends(get_db),
):
    try:
        return run_portfolio_dunning(db, dry_run=dry_run)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Log history endpoints ---

@router.get("/log/customer/{customer_id}")
def get_customer_dunning_log(
    customer_id: str,
    limit:       int = 50,
    db: Session = Depends(get_db),
):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    logs = (
        db.query(DunningLog)
        .filter(DunningLog.customer_id == customer_id)
        .order_by(DunningLog.sent_at.desc())
        .limit(limit)
        .all()
    )

    # build timeline grouped by invoice
    timeline = {}
    for d in logs:
        inv_id = str(d.invoice_id)
        if inv_id not in timeline:
            inv = db.query(Invoice).filter(Invoice.invoice_id == inv_id).first()
            timeline[inv_id] = {
                "invoice_id":     inv_id,
                "invoice_number": inv.invoice_number if inv else None,
                "due_date":       inv.due_date.isoformat() if inv else None,
                "status":         inv.status if inv else None,
                "steps":          [],
            }
        entry = _serialize_log(d)
        if d.template_id:
            tmpl = db.query(DunningTemplate).filter(
                DunningTemplate.template_id == str(d.template_id)
            ).first()
            entry["template_name"] = tmpl.template_name if tmpl else None
        timeline[inv_id]["steps"].append(entry)

    return {
        "customer_id":   customer_id,
        "customer_name": cust.customer_name,
        "total_entries": len(logs),
        "timeline":      list(timeline.values()),
    }


@router.get("/log/invoice/{invoice_id}")
def get_invoice_dunning_log(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    logs = (
        db.query(DunningLog)
        .filter(DunningLog.invoice_id == invoice_id)
        .order_by(DunningLog.dunning_step.asc())
        .all()
    )
    return {
        "invoice_id":     invoice_id,
        "invoice_number": inv.invoice_number,
        "due_date":       inv.due_date.isoformat(),
        "status":         inv.status,
        "steps_sent":     [_serialize_log(d) for d in logs],
    }


@router.get("/log/portfolio")
def get_portfolio_dunning_log(limit: int = 100, db: Session = Depends(get_db)):
    from sqlalchemy.orm import joinedload
    logs = (
        db.query(DunningLog)
        .order_by(DunningLog.sent_at.desc())
        .limit(limit)
        .all()
    )
    entries = []
    for d in logs:
        e = _serialize_log(d)
        cust = db.query(Customer).filter(Customer.customer_id == d.customer_id).first()
        inv  = db.query(Invoice).filter(Invoice.invoice_id == d.invoice_id).first()
        e["customer_name"]  = cust.customer_name if cust else None
        e["invoice_number"] = inv.invoice_number if inv else None
        entries.append(e)
    return {"total_entries": len(entries), "entries": entries}


@router.delete("/log/{dunning_id}")
def delete_dunning_log(dunning_id: str, db: Session = Depends(get_db)):
    d = db.query(DunningLog).filter(DunningLog.dunning_id == dunning_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Dunning log entry not found")
    db.delete(d)
    db.commit()
    return {"deleted": dunning_id}


# --- Sent Emails audit trail ---

@router.get("/sent-emails")
def get_sent_emails(
    limit:           int = 50,
    offset:          int = 0,
    customer_id:     Optional[str] = None,
    delivery_status: Optional[str] = None,
    search:          Optional[str] = None,
    db: Session = Depends(get_db),
):
    from sqlalchemy import or_
    q = db.query(DunningLog)
    if customer_id:
        q = q.filter(DunningLog.customer_id == customer_id)
    if delivery_status:
        q = q.filter(DunningLog.delivery_status == delivery_status)

    total = q.count()
    logs = q.order_by(DunningLog.sent_at.desc()).offset(offset).limit(limit).all()

    entries = []
    for d in logs:
        cust = db.query(Customer).filter(Customer.customer_id == d.customer_id).first()
        inv  = db.query(Invoice).filter(Invoice.invoice_id == d.invoice_id).first()
        tmpl = None
        if d.template_id:
            tmpl = db.query(DunningTemplate).filter(DunningTemplate.template_id == str(d.template_id)).first()

        entry = {
            "dunning_id":            str(d.dunning_id),
            "invoice_id":            str(d.invoice_id),
            "customer_id":           str(d.customer_id),
            "customer_name":         cust.customer_name if cust else None,
            "invoice_number":        inv.invoice_number if inv else None,
            "dunning_step":          d.dunning_step,
            "template_name":         tmpl.template_name if tmpl else None,
            "sent_at":               d.sent_at.isoformat() if d.sent_at else None,
            "sent_via":              d.sent_via,
            "sent_to":               d.sent_to,
            "sent_cc":               d.sent_cc,
            "delivery_status":       d.delivery_status,
            "days_past_due_at_send": d.days_past_due_at_send,
            "rendered_subject":      d.rendered_subject,
        }

        # apply search filter in Python (simpler than SQL LIKE on multiple fields)
        if search:
            s = search.lower()
            searchable = f"{entry.get('customer_name','')}{entry.get('invoice_number','')}{entry.get('rendered_subject','')}".lower()
            if s not in searchable:
                continue

        entries.append(entry)

    return {"total": total, "entries": entries}


@router.get("/sent-emails/{dunning_id}")
def get_sent_email_detail(dunning_id: str, db: Session = Depends(get_db)):
    d = db.query(DunningLog).filter(DunningLog.dunning_id == dunning_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Dunning log entry not found")

    cust = db.query(Customer).filter(Customer.customer_id == d.customer_id).first()
    inv  = db.query(Invoice).filter(Invoice.invoice_id == d.invoice_id).first()
    tmpl = None
    if d.template_id:
        tmpl = db.query(DunningTemplate).filter(DunningTemplate.template_id == str(d.template_id)).first()

    return {
        "dunning_id":            str(d.dunning_id),
        "invoice_id":            str(d.invoice_id),
        "customer_id":           str(d.customer_id),
        "customer_name":         cust.customer_name if cust else None,
        "invoice_number":        inv.invoice_number if inv else None,
        "dunning_step":          d.dunning_step,
        "template_name":         tmpl.template_name if tmpl else None,
        "sent_at":               d.sent_at.isoformat() if d.sent_at else None,
        "sent_via":              d.sent_via,
        "sent_to":               d.sent_to,
        "sent_cc":               d.sent_cc,
        "delivery_status":       d.delivery_status,
        "days_past_due_at_send": d.days_past_due_at_send,
        "rendered_subject":      d.rendered_subject,
        "rendered_body":         d.rendered_body,
    }