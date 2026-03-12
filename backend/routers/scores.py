import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models.tables import Customer, CustomerRiskScore, Invoice, ScoringConfig
from scoring.composer import compute_and_save

router = APIRouter()


@router.get("/portfolio")
def get_portfolio(db: Session = Depends(get_db)):
    # latest snapshot per customer via subquery
    latest = (
        db.query(
            CustomerRiskScore.customer_id,
            func.max(CustomerRiskScore.created_at).label("max_created")
        )
        .group_by(CustomerRiskScore.customer_id)
        .subquery()
    )

    rows = (
        db.query(CustomerRiskScore, Customer)
        .join(latest, (CustomerRiskScore.customer_id == latest.c.customer_id) &
              (CustomerRiskScore.created_at == latest.c.max_created))
        .join(Customer, Customer.customer_id == CustomerRiskScore.customer_id)
        .all()
    )

    from datetime import date
    overdue_summary = dict(
        db.query(Invoice.customer_id, func.sum(Invoice.outstanding_amount))
        .filter(Invoice.status.in_(['open', 'partial']), Invoice.due_date < date.today())
        .group_by(Invoice.customer_id)
        .all()
    )

    result = []
    for score, cust in rows:
        result.append({
            "customer_id":       str(cust.customer_id),
            "customer_code":     cust.customer_code,
            "customer_name":     cust.customer_name,
            "customer_category": cust.customer_category,
            "credit_limit":      float(cust.credit_limit or 0),
            "final_score":       float(score.business_adjusted_score or 0),
            "behavioral_score":  float(score.behavioral_score or 0),
            "risk_band":         score.risk_band,
            "cur":               float(score.credit_utilization_ratio or 0),
            "tar":               float(score.terms_adherence_ratio or 0),
            "dsi":               float(score.delinquency_severity_idx or 0),
            "open_ar_balance":   float(score.open_ar_balance or 0),
            "overdue_balance":   float(overdue_summary.get(cust.customer_id) or 0),
            "score_date":        score.score_date.isoformat(),
            "score_trigger":     score.score_trigger,
        })

    band_summary = {"green": 0, "amber": 0, "red": 0, "black": 0}
    for r in result:
        band_summary[r["risk_band"]] = band_summary.get(r["risk_band"], 0) + 1

    total_exposure = sum(r["open_ar_balance"] for r in result)

    return {
        "customers":      result,
        "band_summary":   band_summary,
        "total_customers": len(result),
        "total_exposure": round(total_exposure, 2),
    }


@router.get("/customer/{customer_id}")
def get_customer_score(customer_id: str, db: Session = Depends(get_db)):
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    result = compute_and_save(db, customer_id, trigger="api_request")
    return result


@router.post("/compute-all")
def compute_all_scores(db: Session = Depends(get_db)):
    customers = db.query(Customer).filter(Customer.is_active == True).all()
    results   = []
    errors    = []
    for cust in customers:
        try:
            r = compute_and_save(db, cust.customer_id, trigger="bulk_compute")
            results.append({"customer_id": cust.customer_id, "score": r["final_score"], "band": r["risk_band"]})
        except Exception as e:
            errors.append({"customer_id": cust.customer_id, "error": str(e)})
    return {"computed": len(results), "errors": len(errors), "results": results}

@router.get("/history/{customer_id}")
def get_score_history(customer_id: str, months: int = 12, db: Session = Depends(get_db)):
    from datetime import date, timedelta
    cutoff = date.today() - timedelta(days=months * 30)
    rows = (
        db.query(CustomerRiskScore)
        .filter(CustomerRiskScore.customer_id == customer_id,
                CustomerRiskScore.score_date >= cutoff)
        .order_by(CustomerRiskScore.score_date.asc())
        .all()
    )
    return {"history": [
        {"score_date": r.score_date.isoformat(),
         "business_adjusted_score": float(r.business_adjusted_score or 0),
         "behavioral_score": float(r.behavioral_score or 0),
         "risk_band": r.risk_band}
        for r in rows
    ]}


@router.get("/portfolio/aging-summary")
def get_portfolio_aging(db: Session = Depends(get_db)):
    from datetime import date
    today = date.today()
    
    invoices = db.query(Invoice).filter(Invoice.status.in_(['open', 'partial'])).all()
    
    buckets = {
        "current": 0.0,
        "1_30":   0.0,
        "31_60":  0.0,
        "61_90":  0.0,
        "90_plus": 0.0
    }
    
    for inv in invoices:
        amt = float(inv.outstanding_amount or 0)
        if inv.due_date >= today:
            buckets["current"] += amt
        else:
            dpd = (today - inv.due_date).days
            if dpd <= 30:   buckets["1_30"] += amt
            elif dpd <= 60: buckets["31_60"] += amt
            elif dpd <= 90: buckets["61_90"] += amt
            else:           buckets["90_plus"] += amt
            
    total_ar = sum(buckets.values())
    ratios = {k: (v / total_ar if total_ar > 0 else 0) for k, v in buckets.items()}
    
    return {
        "buckets": {k: round(v, 2) for k, v in buckets.items()},
        "ratios":  {k: round(v, 4) for k, v in ratios.items()},
        "total_ar": round(total_ar, 2),
        "updated_at": today.isoformat()
    }