# routers/currency.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models.tables import CurrencyRate

router = APIRouter()


# --- Pydantic Models ---

class RateIn(BaseModel):
    from_currency:  str
    to_currency:    str
    rate:           float
    effective_date: date
    source:         str = "manual"   # manual/erp/feed


class RateUpdate(BaseModel):
    rate:           Optional[float] = None
    effective_date: Optional[date]  = None
    source:         Optional[str]   = None


def _serialize(r: CurrencyRate) -> dict:
    return {
        "rate_id":        str(r.rate_id),
        "from_currency":  r.from_currency,
        "to_currency":    r.to_currency,
        "rate":           float(r.rate),
        "effective_date": r.effective_date.isoformat(),
        "source":         r.source,
        "created_at":     r.created_at.isoformat() if r.created_at else None,
    }


# --- Endpoints ---

@router.get("")
def list_rates(
    from_currency: Optional[str] = None,
    to_currency:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(CurrencyRate)
    if from_currency:
        q = q.filter(CurrencyRate.from_currency == from_currency.upper())
    if to_currency:
        q = q.filter(CurrencyRate.to_currency == to_currency.upper())
    rows = q.order_by(CurrencyRate.from_currency, CurrencyRate.effective_date.desc()).all()
    return [_serialize(r) for r in rows]


@router.get("/latest")
def get_latest_rate(from_currency: str, to_currency: str, db: Session = Depends(get_db)):
    r = (
        db.query(CurrencyRate)
        .filter(
            CurrencyRate.from_currency == from_currency.upper(),
            CurrencyRate.to_currency   == to_currency.upper(),
            CurrencyRate.effective_date <= date.today(),
        )
        .order_by(CurrencyRate.effective_date.desc())
        .first()
    )
    if not r:
        raise HTTPException(
            status_code=404,
            detail=f"No rate found for {from_currency.upper()} → {to_currency.upper()}"
        )
    return _serialize(r)


@router.get("/{rate_id}")
def get_rate(rate_id: str, db: Session = Depends(get_db)):
    r = db.query(CurrencyRate).filter(CurrencyRate.rate_id == rate_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rate not found")
    return _serialize(r)


@router.post("")
def create_rate(payload: RateIn, db: Session = Depends(get_db)):
    r = CurrencyRate(
        from_currency  = payload.from_currency.upper(),
        to_currency    = payload.to_currency.upper(),
        rate           = payload.rate,
        effective_date = payload.effective_date,
        source         = payload.source,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.patch("/{rate_id}")
def update_rate(rate_id: str, payload: RateUpdate, db: Session = Depends(get_db)):
    r = db.query(CurrencyRate).filter(CurrencyRate.rate_id == rate_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rate not found")
    if payload.rate           is not None: r.rate           = payload.rate
    if payload.effective_date is not None: r.effective_date = payload.effective_date
    if payload.source         is not None: r.source         = payload.source
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.delete("/{rate_id}")
def delete_rate(rate_id: str, db: Session = Depends(get_db)):
    r = db.query(CurrencyRate).filter(CurrencyRate.rate_id == rate_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rate not found")
    db.delete(r)
    db.commit()
    return {"deleted": rate_id}


@router.post("/convert")
def convert_amount(
    amount:        float,
    from_currency: str,
    to_currency:   str,
    as_of_date:    Optional[date] = None,
    db: Session = Depends(get_db),
):
    if from_currency.upper() == to_currency.upper():
        return {
            "amount":          amount,
            "from_currency":   from_currency.upper(),
            "to_currency":     to_currency.upper(),
            "rate":            1.0,
            "converted_amount": amount,
        }
    lookup_date = as_of_date or date.today()
    r = (
        db.query(CurrencyRate)
        .filter(
            CurrencyRate.from_currency == from_currency.upper(),
            CurrencyRate.to_currency   == to_currency.upper(),
            CurrencyRate.effective_date <= lookup_date,
        )
        .order_by(CurrencyRate.effective_date.desc())
        .first()
    )
    if not r:
        raise HTTPException(
            status_code=404,
            detail=f"No rate found for {from_currency.upper()} → {to_currency.upper()} as of {lookup_date}"
        )
    converted = round(amount * float(r.rate), 2)
    return {
        "amount":           amount,
        "from_currency":    from_currency.upper(),
        "to_currency":      to_currency.upper(),
        "rate":             float(r.rate),
        "effective_date":   r.effective_date.isoformat(),
        "converted_amount": converted,
    }
