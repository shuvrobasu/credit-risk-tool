import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel, condecimal
from decimal import Decimal
from database import get_db
from models.tables import Customer, Invoice, CustomerRiskScore
from sqlalchemy import func

router = APIRouter()


# --- Schemas ---

class CustomerCreate(BaseModel):
    customer_code:     str
    customer_name:     str
    country:           Optional[str] = None
    currency:          Optional[str] = "USD"
    customer_category: Optional[str] = "standard"
    credit_limit:      Optional[Decimal] = None
    dnb_paydex_score:  Optional[int] = None
    dnb_score_date:    Optional[str] = None
    contact_person:    Optional[str] = None


class CustomerUpdate(BaseModel):
    customer_name:     Optional[str] = None
    country:           Optional[str] = None
    currency:          Optional[str] = None
    customer_category: Optional[str] = None
    credit_limit:      Optional[Decimal] = None
    dnb_paydex_score:  Optional[int] = None
    dnb_score_date:    Optional[str] = None
    contact_person_manual: Optional[str] = None
    use_manual_contact:    Optional[bool] = None
    is_active:         Optional[bool] = None


# --- Helpers ---

def _latest_score(db: Session, customer_id: str) -> Optional[CustomerRiskScore]:
    return (
        db.query(CustomerRiskScore)
        .filter(CustomerRiskScore.customer_id == customer_id)
        .order_by(CustomerRiskScore.created_at.desc())
        .first()
    )


def _open_ar(db: Session, customer_id: str) -> float:
    val = (
        db.query(func.sum(Invoice.outstanding_amount))
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.status.in_(["open", "partial"]),
        )
        .scalar()
    )
    return float(val or 0)


def _serialize(cust: Customer, db: Session, include_score: bool = False) -> dict:
    d = {
        "customer_id":       str(cust.customer_id),
        "customer_code":     cust.customer_code,
        "customer_name":     cust.customer_name,
        "country":           cust.country,
        "currency":          cust.currency,
        "customer_category": cust.customer_category,
        "credit_limit":      float(cust.credit_limit or 0),
        "dnb_paydex_score":  cust.dnb_paydex_score,
        "dnb_score_date":    cust.dnb_score_date.isoformat() if cust.dnb_score_date else None,
        "contact_person":    cust.contact_person,
        "contact_person_manual": cust.contact_person_manual,
        "use_manual_contact": cust.use_manual_contact,
        "is_active":         cust.is_active,
        "created_at":        cust.created_at.isoformat() if cust.created_at else None,
    }
    if include_score:
        score = _latest_score(db, str(cust.customer_id))
        d["latest_score"] = {
            "final_score":   float(score.business_adjusted_score or 0) if score else None,
            "risk_band":     score.risk_band if score else None,
            "score_date":    score.score_date.isoformat() if score else None,
            "open_ar":       _open_ar(db, str(cust.customer_id)),
            "cur":           float(score.credit_utilization_ratio or 0) if score else None,
        }
    return d


# --- Routes ---

@router.get("")
def list_customers(
    db:       Session = Depends(get_db),
    search:   Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    band:     Optional[str] = Query(None),
    active:   Optional[bool] = Query(True),
    skip:     int = Query(0, ge=0),
    limit:    int = Query(50, le=200),
):
    q = db.query(Customer)

    if active is not None:
        q = q.filter(Customer.is_active == active)
    if category:
        q = q.filter(Customer.customer_category == category)
    if search:
        q = q.filter(or_(
            Customer.customer_name.ilike(f"%{search}%"),
            Customer.customer_code.ilike(f"%{search}%"),
        ))

    # band filter requires joining latest score
    if band:
        latest = (
            db.query(
                CustomerRiskScore.customer_id,
                func.max(CustomerRiskScore.created_at).label("max_created")
            )
            .group_by(CustomerRiskScore.customer_id)
            .subquery()
        )
        score_sub = (
            db.query(CustomerRiskScore)
            .join(latest, (CustomerRiskScore.customer_id == latest.c.customer_id) &
                  (CustomerRiskScore.created_at == latest.c.max_created))
            .subquery()
        )
        q = q.join(score_sub, Customer.customer_id == score_sub.c.customer_id)
        q = q.filter(score_sub.c.risk_band == band)

    total = q.count()
    customers = q.order_by(Customer.customer_code).offset(skip).limit(limit).all()

    return {
        "total":     total,
        "skip":      skip,
        "limit":     limit,
        "customers": [_serialize(c, db, include_score=True) for c in customers],
    }


@router.get("/{customer_id}")
def get_customer(customer_id: str, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _serialize(cust, db, include_score=True)


@router.post("")
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)):
    existing = db.query(Customer).filter(Customer.customer_code == payload.customer_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="customer_code already exists")

    cust = Customer(
        customer_code         = payload.customer_code,
        customer_name         = payload.customer_name,
        country               = payload.country,
        currency              = payload.currency,
        customer_category     = payload.customer_category,
        credit_limit          = payload.credit_limit,
        credit_limit_updated_at = datetime.utcnow() if payload.credit_limit else None,
        dnb_paydex_score      = payload.dnb_paydex_score,
        dnb_score_date        = payload.dnb_score_date,
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return _serialize(cust, db)


@router.patch("/{customer_id}")
def update_customer(customer_id: str, payload: CustomerUpdate, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(cust, field, val)

    if payload.credit_limit is not None:
        cust.credit_limit_updated_at = datetime.utcnow()

    cust.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(cust)
    return _serialize(cust, db, include_score=True)


@router.delete("/{customer_id}")
def deactivate_customer(customer_id: str, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    cust.is_active  = False
    cust.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "deactivated", "customer_id": customer_id}