import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db
from models.tables import CollectionsHistory, Customer, Invoice
from scoring.composer import compute_and_save

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────

class CollectionCreate(BaseModel):
    customer_id:        str
    invoice_id:         Optional[str]   = None
    action_type:        str
    action_date:        date
    action_by:          str
    amount_at_risk:     Optional[float] = None
    amount_recovered:   Optional[float] = None
    sent_to_3p:         bool            = False
    third_party_agency: Optional[str]   = None
    outcome:            Optional[str]   = "pending"
    notes:              Optional[str]   = None


class OutcomeUpdate(BaseModel):
    outcome:           str
    amount_recovered:  Optional[float] = None
    recovery_date:     Optional[date]  = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _serialize(c: CollectionsHistory, customer_name: str = None) -> dict:
    return {
        "collection_id":      str(c.collection_id),
        "customer_id":        str(c.customer_id),
        "customer_name":      customer_name,
        "invoice_id":         str(c.invoice_id) if c.invoice_id else None,
        "action_type":        c.action_type,
        "action_date":        c.action_date.isoformat(),
        "action_by":          c.action_by,
        "amount_at_risk":     float(c.amount_at_risk)    if c.amount_at_risk    else None,
        "amount_recovered":   float(c.amount_recovered)  if c.amount_recovered  else None,
        "recovery_date":      c.recovery_date.isoformat() if c.recovery_date   else None,
        "sent_to_3p":         c.sent_to_3p,
        "third_party_agency": c.third_party_agency,
        "outcome":            c.outcome,
        "notes":              c.notes,
        "created_at":         c.created_at.isoformat() if c.created_at else None,
    }


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
def list_collections(
    db:          Session       = Depends(get_db),
    customer_id: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    outcome:     Optional[str] = Query(None),
    sent_to_3p:  Optional[bool]= Query(None),
    skip:        int            = Query(0, ge=0),
    limit:       int            = Query(500, le=1000),
):
    q = (
        db.query(CollectionsHistory, Customer)
        .join(Customer, CollectionsHistory.customer_id == Customer.customer_id)
    )
    if customer_id:
        q = q.filter(CollectionsHistory.customer_id == customer_id)
    if action_type:
        q = q.filter(CollectionsHistory.action_type == action_type)
    if outcome:
        q = q.filter(CollectionsHistory.outcome == outcome)
    if sent_to_3p is not None:
        q = q.filter(CollectionsHistory.sent_to_3p == sent_to_3p)

    total = q.count()
    rows  = q.order_by(CollectionsHistory.action_date.desc()).offset(skip).limit(limit).all()

    return {
        "total":   total,
        "records": [_serialize(c, cust.customer_name) for c, cust in rows],
    }


@router.get("/customer/{customer_id}")
def get_customer_collections(customer_id: str, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    rows = (
        db.query(CollectionsHistory)
        .filter(CollectionsHistory.customer_id == customer_id)
        .order_by(CollectionsHistory.action_date.desc())
        .all()
    )

    return {
        "customer_id":      customer_id,
        "customer_name":    cust.customer_name,
        "total_actions":    len(rows),
        "total_at_risk":    round(sum(float(r.amount_at_risk   or 0) for r in rows), 2),
        "total_recovered":  round(sum(float(r.amount_recovered or 0) for r in rows), 2),
        "sent_to_3p_count": sum(1 for r in rows if r.sent_to_3p),
        "actions":          [_serialize(r, cust.customer_name) for r in rows],
    }


@router.get("/{collection_id}")
def get_collection(collection_id: str, db: Session = Depends(get_db)):
    row = (
        db.query(CollectionsHistory, Customer)
        .join(Customer, CollectionsHistory.customer_id == Customer.customer_id)
        .filter(CollectionsHistory.collection_id == collection_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection record not found")
    c, cust = row
    return _serialize(c, cust.customer_name)


@router.post("")
def create_collection(payload: CollectionCreate, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == payload.customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    if payload.invoice_id:
        if not db.query(Invoice).filter(Invoice.invoice_id == payload.invoice_id).first():
            raise HTTPException(status_code=404, detail="Invoice not found")

    record = CollectionsHistory(
        customer_id        = payload.customer_id,
        invoice_id         = payload.invoice_id,
        action_type        = payload.action_type,
        action_date        = payload.action_date,
        action_by          = payload.action_by,
        amount_at_risk     = payload.amount_at_risk,
        amount_recovered   = payload.amount_recovered,
        sent_to_3p         = payload.sent_to_3p,
        third_party_agency = payload.third_party_agency,
        outcome            = payload.outcome,
        notes              = payload.notes,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    try:
        compute_and_save(db, payload.customer_id, trigger="collections_event")
    except Exception:
        pass

    return _serialize(record, cust.customer_name)


@router.patch("/{collection_id}/outcome")
def update_outcome(collection_id: str, payload: OutcomeUpdate, db: Session = Depends(get_db)):
    row = (
        db.query(CollectionsHistory, Customer)
        .join(Customer, CollectionsHistory.customer_id == Customer.customer_id)
        .filter(CollectionsHistory.collection_id == collection_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection record not found")
    c, cust = row

    c.outcome = payload.outcome
    if payload.amount_recovered is not None:
        c.amount_recovered = payload.amount_recovered
    if payload.recovery_date is not None:
        c.recovery_date = payload.recovery_date

    db.commit()
    db.refresh(c)

    try:
        compute_and_save(db, str(c.customer_id), trigger="collections_event")
    except Exception:
        pass

    return _serialize(c, cust.customer_name)