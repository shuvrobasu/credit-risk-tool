from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import Literal
from pydantic import BaseModel
from database import get_db
from models.tables import Customer, CustomerRiskScore
from scoring.composer import compute_and_save

router = APIRouter()

class RiskEvaluationRequest(BaseModel):
    customer_id: str
    order_amount: float
    currency: str = "EUR"

class RiskEvaluationResponse(BaseModel):
    customer_id: str
    risk_band: Literal["green", "amber", "red", "black"]
    final_score: float
    credit_limit: float
    current_open_ar: float
    projected_utilization: float
    recommended_action: Literal["APPROVED", "MANUAL_REVIEW", "REJECTED"]
    reasoning: list[str]

@router.post("/evaluate", response_model=RiskEvaluationResponse)
def evaluate_sales_order(
    req: RiskEvaluationRequest,
    db: Session = Depends(get_db)
):
    """
    Outbound Risk Evaluation Endpoint (M8 ERP Integration)
    
    This endpoint allows external ERP systems (SAP, Oracle, Dynamics, etc.) 
    to pass a potential Sales Order amount and instantly receive a credit decision.
    
    The system recalculates the customer's score on-the-fly, projects their
    credit utilization ratio (CUR) including the new order, and issues a
    hard APPROVED, MANUAL_REVIEW, or REJECTED recommendation.
    """
    # 1. Fetch Customer
    customer = db.execute(
        select(Customer).where(Customer.customer_id == req.customer_id)
    ).scalars().first()
    
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    credit_limit = float(customer.credit_limit) if customer.credit_limit else 0.0
    
    # 2. Recompute Score Context (Ensures we use the freshest AR and DPD data)
    result = compute_and_save(db, req.customer_id, trigger="erp_order_validation")
    
    # Composer result yields dictionaries for deep dimensions
    current_open_ar = float(result.get("cur_detail", {}).get("open_balance", 0.0))
    final_score = result.get("final_score", 0.0)
    risk_band = result.get("risk_band", "black")
    
    # 3. Project New Utilization
    # TODO: In a multi-currency environment, `req.order_amount` should be converted 
    # to the billing currency using the `currency_rates` table before this addition. 
    # For MVP, assuming everything is normalized.
    projected_ar = current_open_ar + req.order_amount
    
    if credit_limit <= 0:
        projected_util = 0.0
    else:
        projected_util = projected_ar / credit_limit

    # 4. Decision Matrix Engine
    action = "MANUAL_REVIEW"
    reasons = []

    if risk_band == "black":
        action = "REJECTED"
        reasons.append("Customer is in the Black (Do Not Do Business) risk band.")
    elif risk_band == "red":
        if projected_util > 0.8:
            action = "REJECTED"
            reasons.append(f"Projected utilization ({projected_util*100:.1f}%) exceeds red-band tolerance (80%).")
        else:
            action = "MANUAL_REVIEW"
            reasons.append("Customer is high risk (Red). Requires human eyes.")
    elif risk_band == "amber":
        if projected_util > 1.0:
            action = "REJECTED"
            reasons.append("Order pushes customer over their hard credit limit cap.")
        elif projected_util > 0.9:
            action = "MANUAL_REVIEW"
            reasons.append(f"Projected utilization ({projected_util*100:.1f}%) near cap for an Amber customer.")
        else:
            action = "APPROVED"
    elif risk_band == "green":
        if projected_util > 1.1:
            action = "MANUAL_REVIEW"
            reasons.append("Green customer, but order breaches limit structure by over 10%. Needs override.")
        else:
            action = "APPROVED"

    if projected_util <= 0 and credit_limit <= 0:
        if risk_band in ["green", "amber"]:
            action = "APPROVED" # Unlimited credit / no limit assigned
            
    return RiskEvaluationResponse(
        customer_id=req.customer_id,
        risk_band=risk_band,
        final_score=final_score,
        credit_limit=credit_limit,
        current_open_ar=current_open_ar,
        projected_utilization=projected_util,
        recommended_action=action,
        reasoning=reasons or ["Standard automated approval granted."]
    )
