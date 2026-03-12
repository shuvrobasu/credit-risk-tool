import json
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from decimal import Decimal
from models.tables import Customer, CustomerRiskScore, Invoice, DunningLog, Payment

# -----------------------------------------------------------------------------
# 1. TOOL DEFINITIONS (JSON Schemas for LLM)
# -----------------------------------------------------------------------------

AI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_customer_risk_profile",
            "description": "Fetch the current credit risk profile including risk score, risk band, credit limit, and category for a customer. Do NOT use this for payment history or invoices.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {
                        "type": "string",
                        "description": "The customer's UUID, ERP Code, or company name."
                    }
                },
                "required": ["customer_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_score_history",
            "description": "Get the historical credit risk scores and bands for a customer over the last 12 months.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {
                        "type": "string",
                        "description": "The customer's UUID, ERP Code, or company name."
                    }
                },
                "required": ["customer_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_invoice_summary",
            "description": "Get a summary of a customer's invoices including open AR, overdue AR, and the top overdue invoice details. Use this for questions about invoices, open balances, and overdue amounts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {
                        "type": "string",
                        "description": "The customer's UUID, ERP Code, or company name."
                    }
                },
                "required": ["customer_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_dunning_status",
            "description": "Check if a customer is currently in active dunning (collections) and see their latest communication history.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {
                        "type": "string",
                        "description": "The customer's UUID, ERP Code, or company name."
                    }
                },
                "required": ["customer_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_portfolio_summary",
            "description": "Get a high-level summary of the entire AR portfolio, grouping customers by risk band (red, amber, green).",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_payment_history",
            "description": "Get the actual payment history for a customer: how many payments were made, how many were late, average days past due (DPD), average days to pay, and the most recent payment records. Use this for any question about payment behavior, payment history, missed payments, late payments, or DPD.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {
                        "type": "string",
                        "description": "The customer's UUID, ERP Code, or company name."
                    }
                },
                "required": ["customer_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_customers_by_invoice_status",
            "description": "Find all customers who have invoices with a specific status (e.g., 'disputed', 'overdue', 'open'). Use this to answer 'Who has disputes?' or 'Who is overdue?'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "The invoice status to look for: 'disputed', 'open', 'partial', 'overdue'."
                    }
                },
                "required": ["status"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_customers",
            "description": "Search for customers by name or code to find their correct database ID or ERP Code. Use this if you are unsure of the exact customer name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search term (name fragment or code)."
                    }
                },
                "required": ["query"]
            }
        }
    }
]

# -----------------------------------------------------------------------------
# 2. TOOL IMPLEMENTATIONS (Python Callbacks)
# -----------------------------------------------------------------------------

def execute_tool_call(db: Session, tool_name: str, arguments: dict) -> str:
    """Routes the LLM's requested tool call to the Python function and returns JSON string result."""
    try:
        if tool_name == "get_customer_risk_profile":
            return _get_customer_risk_profile(db, arguments.get("customer_id"))
        elif tool_name == "get_score_history":
            return _get_score_history(db, arguments.get("customer_id"))
        elif tool_name == "get_invoice_summary":
            return _get_invoice_summary(db, arguments.get("customer_id"))
        elif tool_name == "get_dunning_status":
            return _get_dunning_status(db, arguments.get("customer_id"))
        elif tool_name == "get_portfolio_summary":
            return _get_portfolio_summary(db)
        elif tool_name == "get_payment_history":
            return _get_payment_history(db, arguments.get("customer_id"))
        elif tool_name == "get_customers_by_invoice_status":
            return _get_customers_by_status(db, arguments.get("status"))
        elif tool_name == "search_customers":
            return _search_customers(db, arguments.get("query"))
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


def _resolve_customer_id(db: Session, identifier: str) -> str:
    """Try to find the actual database customer_id if a friendly name or fragment was provided by the LLM."""
    if not identifier:
        return None
        
    # 1. Try exact ID match first if it looks like a valid UUID format
    import uuid
    try:
        val = uuid.UUID(identifier)
        customer = db.execute(select(Customer).where(Customer.customer_id == str(val))).scalars().first()
        if customer:
            return customer.customer_id
    except ValueError:
        pass # Not a valid UUID format, proceed to string search
        
    # 2. Try case-insensitive exact or fuzzy match on customer_code (ERP ID)
    customer = db.execute(select(Customer).where(Customer.customer_code.ilike(f"%{identifier}%"))).scalars().first()
    if customer:
        return customer.customer_id

    # 3. Try case-insensitive fuzzy match on customer_name
    customer = db.execute(select(Customer).where(Customer.customer_name.ilike(f"%{identifier}%"))).scalars().first()
    if customer:
        return customer.customer_id
        
    return None


def _get_customer_risk_profile(db: Session, customer_id: str) -> str:
    resolved_id = _resolve_customer_id(db, customer_id)
    if not resolved_id:
        return json.dumps({"error": f"Customer '{customer_id}' not found in database."})
        
    customer = db.execute(select(Customer).where(Customer.customer_id == resolved_id)).scalars().first()
    if not customer:
        return json.dumps({"error": f"Customer {customer_id} not found."})
        
    latest_score = db.execute(
        select(CustomerRiskScore)
        .where(CustomerRiskScore.customer_id == resolved_id)
        .order_by(CustomerRiskScore.score_date.desc())
    ).scalars().first()

    profile = {
        "customer_name": customer.customer_name,
        "category": customer.customer_category,
        "credit_limit": float(customer.credit_limit) if customer.credit_limit else None,
        "active_status": customer.is_active
    }
    
    if latest_score:
        profile["latest_risk_score"] = float(latest_score.business_adjusted_score)
        profile["risk_band"] = latest_score.risk_band
        profile["score_date"] = str(latest_score.score_date)
        profile["open_ar_balance"] = float(latest_score.open_ar_balance) if latest_score.open_ar_balance else 0.0
    else:
        profile["latest_risk_score"] = "Not Calculated"
        profile["risk_band"] = "Unknown"

    return json.dumps(profile)


def _get_score_history(db: Session, customer_id: str) -> str:
    resolved_id = _resolve_customer_id(db, customer_id)
    if not resolved_id:
        return json.dumps({"error": f"Customer '{customer_id}' not found in database."})
        
    scores = db.execute(
        select(CustomerRiskScore)
        .where(CustomerRiskScore.customer_id == resolved_id)
        .order_by(CustomerRiskScore.score_date.desc())
        .limit(12)
    ).scalars().all()
    
    if not scores:
        return json.dumps({"history": "No score history found for this customer."})
        
    history = [
        {
            "date": str(s.score_date),
            "score": float(s.business_adjusted_score),
            "band": s.risk_band
        } for s in scores
    ]
    return json.dumps({"history": history})


def _get_invoice_summary(db: Session, customer_id: str) -> str:
    resolved_id = _resolve_customer_id(db, customer_id)
    if not resolved_id:
        return json.dumps({"error": f"Customer '{customer_id}' not found in database."})
        
    invoices = db.execute(select(Invoice).where(Invoice.customer_id == resolved_id)).scalars().all()
    
    total_invoices = len(invoices)
    total_value = sum(float(i.invoice_amount) for i in invoices)
    
    open_invoices = [i for i in invoices if i.status in ["open", "partial"] and not i.dispute_flag]
    open_ar = sum(float(i.outstanding_amount) for i in open_invoices)
    
    paid_invoices = [i for i in invoices if i.status == "paid"]
    paid_ar = sum(float(i.invoice_amount) for i in paid_invoices)
    
    disputed_invoices = [i for i in invoices if i.status == "disputed" or i.dispute_flag]
    disputed_ar = sum(float(i.outstanding_amount) for i in disputed_invoices)
    
    from datetime import date
    today = date.today()
    
    overdue_invoices = [i for i in open_invoices if i.due_date and i.due_date < today]
    overdue_ar = sum(float(i.outstanding_amount) for i in overdue_invoices)
    
    max_days_late = 0
    oldest_overdue_invoices = []
    
    if overdue_invoices:
        max_days_late = max((today - i.due_date).days for i in overdue_invoices)
        # Sort to find the oldest 5 invoices to return for specific naming
        sorted_overdue = sorted(overdue_invoices, key=lambda x: x.due_date)
        for inv in sorted_overdue[:5]:
            oldest_overdue_invoices.append({
                "invoice_number": inv.invoice_number,
                "amount": float(inv.outstanding_amount),
                "due_date": str(inv.due_date),
                "days_late": (today - inv.due_date).days
            })

    summary = {
        "total_invoices_count": total_invoices,
        "total_historical_value": total_value,
        "current_open_ar": open_ar,
        "open_invoices_count": len(open_invoices),
        "disputed_invoices_count": len(disputed_invoices),
        "disputed_ar": disputed_ar,
        "current_overdue_ar": overdue_ar,
        "overdue_invoices_count": len(overdue_invoices),
        "max_days_past_due": max_days_late,
        "specific_overdue_invoices_sample": oldest_overdue_invoices,
        "paid_value": paid_ar
    }
    return json.dumps(summary)


def _get_dunning_status(db: Session, customer_id: str) -> str:
    resolved_id = _resolve_customer_id(db, customer_id)
    if not resolved_id:
        return json.dumps({"error": f"Customer '{customer_id}' not found in database."})
        
    logs = db.execute(
        select(DunningLog)
        .where(DunningLog.customer_id == resolved_id)
        .order_by(DunningLog.action_date.desc())
    ).scalars().all()
    
    if not logs:
        return json.dumps({"status": "No dunning history for this customer."})
        
    latest = logs[0]
    
    # Send the last 3 actions so the LLM doesn't guess
    recent_history = [
        {
            "date": str(l.action_date),
            "step": l.step_number,
            "status": l.status,
            "error": l.error_message
        } for l in logs[:3]
    ]
    
    return json.dumps({
        "status": "In Collections" if latest.status == "sent" else "Unknown",
        "recent_communication_history": recent_history,
        "total_dunning_events_historical": len(logs)
    })


def _get_portfolio_summary(db: Session) -> str:
    scores = db.execute(
        select(CustomerRiskScore)
        .where(CustomerRiskScore.is_stale == False)
    ).scalars().all()
    
    bands = {"green": 0, "amber": 0, "red": 0, "black": 0, "total_customers": len(scores)}
    total_ar_by_band = {"green": 0.0, "amber": 0.0, "red": 0.0, "black": 0.0}
    
    for s in scores:
        b = s.risk_band or "black"
        bands[b] += 1
        ar = float(s.open_ar_balance) if s.open_ar_balance else 0.0
        if b in total_ar_by_band:
            total_ar_by_band[b] += ar
            
    return json.dumps({
        "customer_count_distribution": bands,
        "open_ar_exposure_distribution": total_ar_by_band
    })


def _get_payment_history(db: Session, customer_id: str) -> str:
    resolved_id = _resolve_customer_id(db, customer_id)
    if not resolved_id:
        return json.dumps({"error": f"Customer '{customer_id}' not found in database."})

    from datetime import date
    today = date.today()

    # ---- SECTION 1: All invoices (the full picture) ----
    invoices = db.execute(
        select(Invoice)
        .where(Invoice.customer_id == resolved_id)
        .order_by(Invoice.invoice_date.asc())
    ).scalars().all()

    total_invoices = len(invoices)
    paid_invoices = [i for i in invoices if i.status == "paid"]
    open_invoices = [i for i in invoices if i.status in ["open", "partial"] and not i.dispute_flag]
    disputed_invoices = [i for i in invoices if i.status == "disputed" or i.dispute_flag]
    overdue_invoices = [i for i in open_invoices if i.due_date and i.due_date < today]

    # Build a per-invoice breakdown
    invoice_breakdown = []
    for inv in invoices:
        entry = {
            "invoice_number": inv.invoice_number,
            "invoice_date": str(inv.invoice_date),
            "due_date": str(inv.due_date),
            "terms": inv.payment_terms,
            "amount": float(inv.invoice_amount),
            "outstanding": float(inv.outstanding_amount or 0),
            "status": inv.status,
            "disputed": bool(inv.dispute_flag or inv.status == "disputed")
        }
        if (inv.status in ["open", "partial"]) and (not inv.dispute_flag) and (inv.due_date and inv.due_date < today):
            entry["days_late"] = (today - inv.due_date).days
        else:
            entry["days_late"] = 0
        invoice_breakdown.append(entry)

    # ---- SECTION 2: Actual payments received ----
    payments = db.execute(
        select(Payment)
        .where(Payment.customer_id == resolved_id)
        .order_by(Payment.payment_date.desc())
    ).scalars().all()

    total_payments_received = len(payments)
    late_payments = [p for p in payments if p.days_past_due and p.days_past_due > 0]
    late_payment_count = len(late_payments)

    avg_dpd_on_paid = 0.0
    if late_payments:
        avg_dpd_on_paid = round(sum(p.days_past_due for p in late_payments) / late_payment_count, 1)

    all_dtp = [p.days_to_pay for p in payments if p.days_to_pay is not None]
    avg_days_to_pay = 0.0
    if all_dtp:
        avg_days_to_pay = round(sum(all_dtp) / len(all_dtp), 1)

    # ---- SECTION 3: Overdue severity ----
    max_days_overdue = 0
    total_overdue_ar = 0.0
    if overdue_invoices:
        max_days_overdue = max((today - i.due_date).days for i in overdue_invoices)
        total_overdue_ar = sum(float(i.outstanding_amount or 0) for i in overdue_invoices)

    result = {
        "summary": {
            "total_invoices": total_invoices,
            "paid_invoices": len(paid_invoices),
            "open_or_partial_invoices": len(open_invoices),
            "disputed_invoices": len(disputed_invoices),
            "overdue_invoices": len(overdue_invoices),
            "max_days_overdue": max_days_overdue,
            "total_overdue_ar": total_overdue_ar
        },
        "payment_behavior": {
            "total_payments_received": total_payments_received,
            "late_payments_received": late_payment_count,
            "avg_days_past_due_on_paid_invoices": avg_dpd_on_paid,
            "avg_days_to_pay": avg_days_to_pay
        },
        "all_invoices": invoice_breakdown
    }
    return json.dumps(result)


def _get_customers_by_status(db: Session, status: str) -> str:
    from datetime import date
    today = date.today()
    
    if status == "overdue":
        # Overdue is logic based, not a status string
        invoices = db.execute(
            select(Invoice)
            .where(Invoice.status.in_(["open", "partial"]))
            .where(Invoice.dispute_flag == False)
            .where(Invoice.due_date < today)
        ).scalars().all()
    elif status == "disputed":
        invoices = db.execute(
            select(Invoice)
            .where((Invoice.status == "disputed") | (Invoice.dispute_flag == True))
        ).scalars().all()
    else:
        invoices = db.execute(
            select(Invoice)
            .where(Invoice.status == status)
        ).scalars().all()
        
    if not invoices:
        return json.dumps({"message": f"No customers found with invoices in status: {status}"})
        
    customer_ids = list(set([str(i.customer_id) for i in invoices]))
    customers = db.execute(
        select(Customer)
        .where(Customer.customer_id.in_(customer_ids))
    ).scalars().all()
    
    result = []
    for c in customers:
        cust_invs = [i for i in invoices if str(i.customer_id) == str(c.customer_id)]
        
        # For 'disputed' we often want to see the ORIGINAL contested amount (invoice_amount)
        # because outstanding_amount might be 0 if it was paid but then disputed.
        # However, for 'overdue' we strictly care about what is still unpaid.
        if status == "disputed":
            total_val = sum(float(i.invoice_amount or 0) for i in cust_invs)
        else:
            total_val = sum(float(i.outstanding_amount or 0) for i in cust_invs)
            
        result.append({
            "customer_name": c.customer_name,
            "customer_code": c.customer_code,
            "invoice_count": len(cust_invs),
            "total_value": total_val
        })
        
    return json.dumps({"status": status, "customers": result})


def _search_customers(db: Session, query: str) -> str:
    customers = db.execute(
        select(Customer)
        .where(
            (Customer.customer_name.ilike(f"%{query}%")) | 
            (Customer.customer_code.ilike(f"%{query}%"))
        )
        .limit(10)
    ).scalars().all()
    
    if not customers:
        return json.dumps({"message": f"No customers matching '{query}' found."})
        
    return json.dumps({
        "matches": [
            {"name": c.customer_name, "code": c.customer_code, "id": str(c.customer_id)} 
            for c in customers
        ]
    })

