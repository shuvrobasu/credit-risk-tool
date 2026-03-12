from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text, select, func
from typing import List, Dict, Any
from pydantic import BaseModel
from database import get_db
from models.tables import Invoice, Customer, Payment, CustomerRiskScore
from datetime import date, timedelta
from decimal import Decimal

router = APIRouter()

class CashFlowForecastResponse(BaseModel):
    current_date: date
    forecast_30_days: float
    forecast_60_days: float
    forecast_90_days: float
    total_expected_recovery: float

class InvoicePredictionResponse(BaseModel):
    invoice_id: str
    invoice_number: str
    due_date: date
    outstanding_amount: float
    predicted_payment_date: date | None
    p_ontime: float
    expected_recovery: float

class CustomerPredictionResponse(BaseModel):
    customer_id: str
    customer_name: str
    risk_band: str | None
    historical_avg_dtp: int | None
    invoices: List[InvoicePredictionResponse]

def _calculate_p_ontime(tar: float, dsi: float, crh: float) -> float:
    """
    Calculate probability of on-time payment.
    Formula: p_ontime = TAR_raw * (1 - min(1, DSI_raw/100)) * (CRH_base/1000)
    """
    tar_raw = tar / 1000.0 if tar is not None else 1.0
    dsi_raw = dsi if dsi is not None else 0.0
    
    # Estimate CRH base (assume worst case 1000 max score if crh is high)
    crh_base = crh if crh is not None else 500.0
    
    dsi_penalty = min(1.0, float(dsi_raw) / 100.0)
    p_ontime = tar_raw * (1.0 - dsi_penalty) * (float(crh_base) / 1000.0)
    
    return max(0.0, min(1.0, p_ontime))

def _calculate_expected_recovery(outstanding: float, p_ontime: float) -> float:
    """
    Formula: expected_recovery = outstanding * avg_recovery_rate * p_ontime_decay
    Simplified MVP: outstanding * p_ontime
    """
    return float(outstanding) * p_ontime

def _get_historical_avg_dtp(db: Session, customer_id: str) -> int | None:
    """
    Calculate historical average days to pay for the last 20 paid invoices.
    """
    payments = db.execute(
        select(Payment.days_to_pay)
        .where(Payment.customer_id == customer_id, Payment.days_to_pay.is_not(None))
        .order_by(Payment.payment_date.desc())
        .limit(20)
    ).scalars().all()

    if not payments:
        return None
    
    return int(sum(payments) / len(payments))

@router.get("/customer/{customer_id}", response_model=CustomerPredictionResponse)
def get_customer_predictions(customer_id: str, db: Session = Depends(get_db)):
    # 1. Get Customer and latest score
    customer = db.execute(select(Customer).where(Customer.customer_id == customer_id)).scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    latest_score = db.execute(
        select(CustomerRiskScore)
        .where(CustomerRiskScore.customer_id == customer_id)
        .order_by(CustomerRiskScore.created_at.desc())
    ).scalars().first()

    risk_band = latest_score.risk_band if latest_score else None
    
    # Using defaults if no score exists yet
    tar = float(latest_score.terms_adherence_ratio) if latest_score and latest_score.terms_adherence_ratio else 1000.0
    dsi = float(latest_score.delinquency_severity_idx) if latest_score and latest_score.delinquency_severity_idx else 0.0
    crh = float(latest_score.behavioral_score) if latest_score and latest_score.behavioral_score else 500.0

    # 2. Historical AVG DTP
    avg_dtp = _get_historical_avg_dtp(db, customer_id)

    # 3. Get open invoices
    open_invoices = db.execute(
        select(Invoice)
        .where(Invoice.customer_id == customer_id, Invoice.outstanding_amount > 0)
    ).scalars().all()

    invoice_predictions = []
    for inv in open_invoices:
        # Calculate Predicted Date
        predicted_date = None
        if avg_dtp is not None:
             predicted_date = inv.invoice_date + timedelta(days=avg_dtp)
        else:
             # Fallback to due date if no history
             predicted_date = inv.due_date

        p_ontime = _calculate_p_ontime(tar, dsi, crh)
        expected_rec = _calculate_expected_recovery(float(inv.outstanding_amount), p_ontime)

        invoice_predictions.append(
            InvoicePredictionResponse(
                invoice_id=str(inv.invoice_id),
                invoice_number=inv.invoice_number,
                due_date=inv.due_date,
                outstanding_amount=float(inv.outstanding_amount),
                predicted_payment_date=predicted_date,
                p_ontime=p_ontime,
                expected_recovery=expected_rec
            )
        )

    return CustomerPredictionResponse(
        customer_id=str(customer.customer_id),
        customer_name=customer.customer_name,
        risk_band=risk_band,
        historical_avg_dtp=avg_dtp,
        invoices=invoice_predictions
    )

@router.get("/cashflow", response_model=CashFlowForecastResponse)
def get_global_cashflow_forecast(db: Session = Depends(get_db)):
    """
    Returns a 30/60/90 day cash flow forecast by aggregating expected_recovery for all open invoices.
    """
    today = date.today()
    day_30 = today + timedelta(days=30)
    day_60 = today + timedelta(days=60)
    day_90 = today + timedelta(days=90)

    # We need to iterate customers with open invoices to calculate personal DTP and p_ontime
    customers_with_open_invs = db.execute(
        select(Customer.customer_id).distinct()
        .join(Invoice, Customer.customer_id == Invoice.customer_id)
        .where(Invoice.outstanding_amount > 0)
    ).scalars().all()

    f30, f60, f90, total = 0.0, 0.0, 0.0, 0.0

    for cid in customers_with_open_invs:
        # Re-use customer prediction endpoint logic per customer
        pred_data = get_customer_predictions(cid, db)
        
        for inv in pred_data.invoices:
            amount = inv.expected_recovery
            total += amount
            
            p_date = inv.predicted_payment_date
            if not p_date:
                continue

            if today <= p_date <= day_30:
                f30 += amount
            elif day_30 < p_date <= day_60:
                f60 += amount
            elif day_60 < p_date <= day_90:
                f90 += amount

    return CashFlowForecastResponse(
        current_date=today,
        forecast_30_days=round(f30, 2),
        forecast_60_days=round(f60, 2),
        forecast_90_days=round(f90, 2),
        total_expected_recovery=round(total, 2)
    )
