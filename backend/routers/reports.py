from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, select, and_
from database import get_db
from models.tables import Invoice, Payment, DunningWorklist, Customer, CustomerRiskScore
from datetime import date, timedelta, datetime
from decimal import Decimal
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

router = APIRouter()

class DashboardStats(BaseModel):
    total_ar: float
    overdue_ar: float
    dso: float
    recovery_rate: float

class AgingTrendEntry(BaseModel):
    month: str
    current: float
    overdue_1_30: float
    overdue_31_60: float
    overdue_61_90: float
    overdue_91_plus: float

class CollectorEfficiency(BaseModel):
    approved: int
    rejected: int
    pending: int
    efficiency_ratio: float

class ReportQuery(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    customer_categories: Optional[List[str]] = None
    risk_bands: Optional[List[str]] = None
    status: Optional[List[str]] = None
    report_type: str = "ledger" # ledger, dispute, risk, credit_util

@router.post("/query")
def run_custom_report(params: ReportQuery, db: Session = Depends(get_db)):
    # 1. AR Ledger Query (Default)
    if params.report_type == "ledger":
        query = select(
            Customer.customer_code,
            Customer.customer_name,
            Customer.customer_category,
            Invoice.invoice_number,
            Invoice.invoice_date,
            Invoice.due_date,
            Invoice.outstanding_amount,
            Invoice.status,
            CustomerRiskScore.risk_band,
            Invoice.promise_to_pay_date
        ).join(Customer, Invoice.customer_id == Customer.customer_id)\
         .outerjoin(CustomerRiskScore, Customer.customer_id == CustomerRiskScore.customer_id)
        
        # Apply Filters
        if params.date_from:
            query = query.where(Invoice.invoice_date >= params.date_from)
        if params.date_to:
            query = query.where(Invoice.invoice_date <= params.date_to)
        if params.customer_categories:
            query = query.where(Customer.customer_category.in_(params.customer_categories))
        if params.risk_bands:
            query = query.where(CustomerRiskScore.risk_band.in_(params.risk_bands))
        if params.status:
            query = query.where(Invoice.status.in_(params.status))
            
        results = db.execute(query).all()
        return [dict(row._mapping) for row in results]

    elif params.report_type == "dispute":
        query = select(
            Customer.customer_name,
            Invoice.invoice_number,
            Invoice.dispute_category,
            Invoice.dispute_opened_at,
            # Calculate days open: coalesce(dispute_opened_at, invoice_date) subtracted from current date
            func.julianday('now') - func.julianday(func.coalesce(Invoice.dispute_opened_at, Invoice.invoice_date)).label("days_open"),
            Invoice.outstanding_amount,
            Invoice.dispute_reason
        ).join(Customer, Invoice.customer_id == Customer.customer_id)\
         .where(Invoice.dispute_flag == True)
         
        results = db.execute(query).all()
        # Clean up the days_open to be an integer
        return [
            {**dict(row._mapping), "days_open": int(row._mapping["days_open"]) if row._mapping["days_open"] else 0} 
            for row in results
        ]

    # 3. Credit Utilization Query
    elif params.report_type == "credit_util":
        query = select(
            Customer.customer_name,
            # Rounding to thousands: ROUND(val / 1000) * 1000
            (func.round(Customer.credit_limit / 1000) * 1000).label("credit_limit"),
            func.sum(Invoice.outstanding_amount).label("current_exposure"),
            CustomerRiskScore.risk_band
        ).join(Invoice, Customer.customer_id == Invoice.customer_id)\
         .outerjoin(CustomerRiskScore, Customer.customer_id == CustomerRiskScore.customer_id)\
         .group_by(Customer.customer_id, Customer.customer_name, Customer.credit_limit, CustomerRiskScore.risk_band)
         
        results = db.execute(query).all()
        processed = []
        for row in results:
            limit = float(row._mapping["credit_limit"] or 1)
            exposure = float(row._mapping["current_exposure"] or 0)
            util_pct = (exposure / limit) * 100
            band = (row._mapping["risk_band"] or "GREEN").upper()
            
            # Status & Color Mapping
            status = "Within Limit"
            color = "emerald"
            if util_pct > 100: 
                status = "OVER LIMIT"
                color = "rose"
            elif util_pct > 90: 
                status = "NEAR LIMIT"
                color = "orange"
                
            # Recommendation Logic & Intent Mapping
            recommendation = "No Change"
            intent = "info" # default
            
            if util_pct > 100 and band == "RED":
                recommendation = "URGENT: BLOCK/REVIEW"
                intent = "danger"
            elif util_pct < 30 and band == "RED":
                recommendation = "Decrease Limit (-50%)"
                intent = "warning"
            elif util_pct > 95 and band == "GREEN":
                recommendation = "Increase Limit (+20%)"
                intent = "success"
            elif util_pct > 90 and band == "AMBER":
                recommendation = "Monitor Closely"
                intent = "warning"
            elif util_pct > 100:
                recommendation = "Review for Increase"
                intent = "info"
                
            # Override intent based on status
            status_intent = "success"
            if status == "OVER LIMIT": status_intent = "danger"
            elif status == "NEAR LIMIT": status_intent = "warning"
                
            processed.append({
                "Customer": row._mapping["customer_name"],
                "Limit": f"€{int(limit):,}",
                "Exposure": f"€{exposure:,.2f}",
                "Use %": f"{util_pct:.1f}%",
                "Status": status,
                "Recommendation": recommendation,
                "_status_intent": status_intent,
                "_rec_intent": intent,
                "_band": band
            })
        return processed

    return {"error": "Unknown report type"}

@router.get("/dashboard-stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    # 1. Total AR & Overdue
    total_ar = db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0).scalar() or 0.0
    overdue_ar = db.query(func.sum(Invoice.outstanding_amount)).filter(
        Invoice.outstanding_amount > 0,
        Invoice.due_date < date.today()
    ).scalar() or 0.0

    # 2. DSO (Simplified: (Total AR / Total Credit Sales in last 90 days) * 90)
    ninety_days_ago = date.today() - timedelta(days=90)
    total_sales = db.query(func.sum(Invoice.invoice_amount)).filter(Invoice.invoice_date >= ninety_days_ago).scalar() or 1.0
    dso = (float(total_ar) / float(total_sales)) * 90 if total_sales > 0 else 0.0

    # 3. Recovery Rate (Recovered / Total Due in last 30 days)
    thirty_days_ago = date.today() - timedelta(days=30)
    recovered = db.query(func.sum(Payment.payment_amount)).filter(Payment.payment_date >= thirty_days_ago).scalar() or 0.0
    total_due_30 = db.query(func.sum(Invoice.invoice_amount)).filter(Invoice.due_date >= thirty_days_ago, Invoice.due_date <= date.today()).scalar() or 1.0
    recovery_rate = (float(recovered) / float(total_due_30)) * 100 if total_due_30 > 0 else 0.0

    return DashboardStats(
        total_ar=float(total_ar),
        overdue_ar=float(overdue_ar),
        dso=round(dso, 1),
        recovery_rate=round(recovery_rate, 1)
    )

@router.get("/aging-trends", response_model=List[AgingTrendEntry])
def get_aging_trends(db: Session = Depends(get_db)):
    # Simulating a 6-month historical trend
    # In a production system, this would read from a 'snapshots' table.
    # Here we aggregate current data as the latest point and mock previous ones for demo purposes.
    
    today = date.today()
    trends = []
    
    for i in range(5, -1, -1):
        target_month = (today.replace(day=1) - timedelta(days=i*30)).strftime("%b %Y")
        
        # Real aggregate for the 'current' month (last index)
        if i == 0:
            current = db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0, Invoice.due_date >= today).scalar() or 0.0
            o30 = db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0, Invoice.due_date < today, Invoice.due_date >= today - timedelta(days=30)).scalar() or 0.0
            o60 = db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0, Invoice.due_date < today - timedelta(days=30), Invoice.due_date >= today - timedelta(days=60)).scalar() or 0.0
            o90 = db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0, Invoice.due_date < today - timedelta(days=60), Invoice.due_date >= today - timedelta(days=90)).scalar() or 0.0
            oPlus = db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0, Invoice.due_date < today - timedelta(days=90)).scalar() or 0.0
            
            trends.append(AgingTrendEntry(
                month=target_month,
                current=float(current),
                overdue_1_30=float(o30),
                overdue_31_60=float(o60),
                overdue_61_90=float(o90),
                overdue_91_plus=float(oPlus)
            ))
        else:
            # Mock historical data slightly fluctuating based on current
            base = float(total_ar := db.query(func.sum(Invoice.outstanding_amount)).filter(Invoice.outstanding_amount > 0).scalar() or 100000)
            mock_val = lambda factor: round(base * factor * (0.9 + (0.2 * (5-i)/5)), 2)
            trends.append(AgingTrendEntry(
                month=target_month,
                current=mock_val(0.5),
                overdue_1_30=mock_val(0.2),
                overdue_31_60=mock_val(0.15),
                overdue_61_90=mock_val(0.1),
                overdue_91_plus=mock_val(0.05)
            ))
            
    return trends

@router.get("/collector-efficiency", response_model=CollectorEfficiency)
def get_collector_efficiency(db: Session = Depends(get_db)):
    approved = db.query(func.count(DunningWorklist.work_id)).filter(DunningWorklist.status == "approved").scalar() or 0
    rejected = db.query(func.count(DunningWorklist.work_id)).filter(DunningWorklist.status == "rejected").scalar() or 0
    pending = db.query(func.count(DunningWorklist.work_id)).filter(DunningWorklist.status == "pending").scalar() or 0
    
    total_acted = approved + rejected
    ratio = (approved / total_acted * 100) if total_acted > 0 else 0.0
    
    return CollectorEfficiency(
        approved=approved,
        rejected=rejected,
        pending=pending,
        efficiency_ratio=round(ratio, 1)
    )
