import logging
import json
from datetime import date
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from models.tables import Customer, Invoice, CustomerRiskScore, AppSettings, DunningWorklist, Payment

logger = logging.getLogger(__name__)

def _get_dtp_trend(db: Session, customer_id: str) -> float:
    """
    Calculates the 3-payment rolling average DTP vs lifetime average DTP.
    Returns the 'delta' in days. Positive = slowing down.
    """
    # 1. Lifetime average
    lifetime_avg = db.query(func.avg(Payment.days_to_pay)).filter(
        Payment.customer_id == customer_id,
        Payment.days_to_pay != None
    ).scalar() or 0.0
    
    # 2. Last 3 payments
    recent_payments = db.query(Payment.days_to_pay).filter(
        Payment.customer_id == customer_id,
        Payment.days_to_pay != None
    ).order_by(Payment.payment_date.desc()).limit(3).all()
    
    if not recent_payments:
        return 0.0
        
    recent_avg = sum(p[0] for p in recent_payments) / len(recent_payments)
    return float(recent_avg) - float(lifetime_avg)

def _get_user_feedback_score(db: Session, customer_id: str) -> float:
    """
    Checks if the user has been rejecting 'Firm' or 'Urgent' actions for this customer.
    Returns a multiplier (0.5 to 1.0).
    """
    recent_actions = db.query(DunningWorklist.status).filter(
        DunningWorklist.customer_id == customer_id,
        DunningWorklist.status.in_(["approved", "rejected"])
    ).order_by(DunningWorklist.created_at.desc()).limit(5).all()
    
    if not recent_actions:
        return 1.0
        
    rejections = sum(1 for a in recent_actions if a[0] == "rejected")
    # If 3 or more of the last 5 were rejected, we dampen the AI tone intensity
    if rejections >= 3:
        return 0.7
    return 1.0

def evaluate_ai_dunning_strategy(db: Session, customer: Customer, invoice: Invoice) -> dict:
    """
    Evaluates the 'Next Best Action' for an invoice using LLM-derived logic.
    In a real M9/M10 implementation, this would call the llama.cpp server.
    For this implementation, we use a sophisticated rule-based strategy that 
    simulates the agentic decision-making based on risk scores.
    """
    
    # 1. Gather Context
    score = db.execute(
        select(CustomerRiskScore)
        .where(CustomerRiskScore.customer_id == str(customer.customer_id))
        .order_by(CustomerRiskScore.score_date.desc())
    ).scalars().first()
    
    today = date.today()
    dpd = (today - invoice.due_date).days
    
    # 2. Decision Logic (The 'Agent' Brain)
    # We define strategies based on Behavioral Score vs Anchor Score vs DPD
    
    risk_score = float(score.business_adjusted_score) if score else 500.0
    
    # --- LEARNING ENGINE DATA POINTS ---
    dtp_delta = _get_dtp_trend(db, str(customer.customer_id))
    feedback_multiplier = _get_user_feedback_score(db, str(customer.customer_id))
    
    # Apply learning adjustments
    # 1. DTP Slowdown: If payment is slowing down (+5 days), artificial risk increase
    effective_risk_score = risk_score
    if dtp_delta > 5:
        logger.info(f"AI Learning: Customer payment slowing down by {dtp_delta:.1f} days. Increasing risk weight.")
        effective_risk_score *= 0.85 # Artificial reduction in score = higher risk
    
    strategy = {
        "action": "email",
        "tone": "professional",
        "priority": "normal",
        "reason": "standard_followup"
    }
    
    if risk_score > 750: # GREEN: High trust, gentle tone
        if dpd < 7:
            strategy["tone"] = "collaborative"
            strategy["reason"] = "high_trust_preemptive"
        else:
            strategy["tone"] = "professional"
            strategy["reason"] = "high_trust_standard"
            
    elif risk_score > 500: # AMBER: Moderate risk, standard firmness
        if dpd > 15:
            strategy["tone"] = "firm"
            strategy["priority"] = "high"
            strategy["reason"] = "moderate_risk_late"
        else:
            strategy["tone"] = "professional"
            strategy["reason"] = "moderate_risk_standard"
            
    else: # RED/BLACK: High risk, urgent/firm tone
        strategy["priority"] = "urgent"
        if dpd > 0:
            strategy["tone"] = "urgent"
            strategy["reason"] = "high_risk_overdue"
        else:
            strategy["tone"] = "firm"
            strategy["reason"] = "high_risk_preemptive"

    # --- FEEDBACK LOOP ADJUSTMENT ---
    if feedback_multiplier < 1.0 and strategy["tone"] in ["urgent", "firm"]:
        logger.info(f"AI Learning: High rejection rate detected. Dampening tone from {strategy['tone']} to professional.")
        strategy["tone"] = "professional"
        strategy["reason"] += " (Feedback dampened)"

    # --- Logical Guard: Future Invoices ---
    # We shouldn't bother the user with dunning actions for future invoices 
    # unless they are high risk.
    is_future = dpd < -7 # More than a week in the future
    if is_future and risk_score > 500:
        logger.info(f"Skipping strategy for {invoice.invoice_number}: Future invoice (DPD {dpd}) with safe score {risk_score:.0f}")
        return {"status": "skipped", "reason": "future_invoice_low_risk"}

    # Integration point for LLM (llama.cpp) would go here:
    # prompt = f"Customer {customer.customer_name} has score {risk_score} and invoice {invoice.invoice_number} is {dpd} days late..."
    # llm_res = call_llm(prompt)
    
    logger.info(f"AI Strategy for {invoice.invoice_number}: {strategy['tone']} tone due to {strategy['reason']}")
    
    # --- Populating the Human-in-the-Loop Worklist ---
    # Check if a pending item for this invoice already exists to avoid duplicates
    existing = db.execute(
        select(DunningWorklist)
        .where(DunningWorklist.invoice_id == str(invoice.invoice_id), DunningWorklist.status == "pending")
    ).scalars().first()
    
    if not existing:
        work_item = DunningWorklist(
            customer_id=str(customer.customer_id),
            invoice_id=str(invoice.invoice_id),
            suggested_action=strategy["action"],
            suggested_tone=strategy["tone"],
            priority=strategy["priority"],
            reason=f"AI Recommendation: {strategy['reason']} (Score: {risk_score:.0f}, DPD: {dpd})"
        )
        db.add(work_item)
        db.commit()
    
    return strategy

def evaluate_customer_level_strategy(db: Session, customer: Customer, invoices: list[Invoice]) -> dict:
    """
    Consolidates multiple invoices for a single customer and generates ONE strategic action.
    This uses the cumulative balance and maximum DPD to inform the tone.
    """
    logger.info(f"AI Eval (Customer Level) start for {customer.customer_id}. Invoices: {len(invoices)}")
    if not invoices:
        logger.warning(f"AI Eval skip: No invoices provided for {customer.customer_id}")
        return {"status": "skipped", "reason": "no_invoices"}

    # 1. Gather Cumulative Context
    score = db.execute(
        select(CustomerRiskScore)
        .where(CustomerRiskScore.customer_id == str(customer.customer_id))
        .order_by(CustomerRiskScore.score_date.desc())
    ).scalars().first()
    
    total_due = sum(inv.outstanding_amount for inv in invoices)
    max_dpd = max((date.today() - inv.due_date).days for inv in invoices)
    risk_score = float(score.business_adjusted_score) if score else 500.0
    logger.info(f"AI Eval data: Score={risk_score}, Balance={total_due}, MaxDPD={max_dpd}")

    strategy = {
        "action": "email",
        "tone": "professional",
        "priority": "normal",
        "reason": "account_level_followup"
    }

    # 2. Decision Logic (Consolidating tone/priority)
    if risk_score > 750:
        if max_dpd < 7:
            strategy["tone"] = "collaborative"
            strategy["reason"] = "acc_high_trust_preemptive"
        else:
            strategy["tone"] = "professional"
            strategy["reason"] = "acc_high_trust_standard"
    elif risk_score > 500:
        if max_dpd > 15:
            strategy["tone"] = "firm"
            strategy["priority"] = "high"
            strategy["reason"] = "acc_moderate_risk_late"
        else:
            strategy["tone"] = "professional"
            strategy["reason"] = "acc_moderate_risk_standard"
    else:
        # High Risk
        strategy["priority"] = "urgent"
        strategy["tone"] = "urgent" if max_dpd > 0 else "firm"
        strategy["reason"] = "acc_high_risk_overdue" if max_dpd > 0 else "acc_high_risk_preemptive"

    logger.info(f"AI Strategic Decision: {strategy['action']}/{strategy['tone']} due to {strategy['reason']}")
    # --- Populating the Worklist (Consolidated) ---
    existing = db.execute(
        select(DunningWorklist)
        .where(
            DunningWorklist.customer_id == str(customer.customer_id), 
            DunningWorklist.invoice_id == None, 
            DunningWorklist.status == "pending"
        )
    ).scalars().first()

    if not existing:
        work_item = DunningWorklist(
            customer_id=str(customer.customer_id),
            invoice_id=None, # Consolidated
            suggested_action=strategy["action"],
            suggested_tone=strategy["tone"],
            priority=strategy["priority"],
            reason=f"Account-Level Strategy: {strategy['reason']} (Score: {risk_score:.0f}, Max DPD: {max_dpd}, Total: {total_due:.2f})"
        )
        db.add(work_item)
        db.commit()

    return strategy
