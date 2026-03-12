from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from models.tables import Invoice, Payment, CollectionsHistory, DunningLog, Customer, ScoringConfig, DunningConfigStep


# --- Helpers ---

def _today() -> date:
    return date.today()


def _window_start(months: int) -> date:
    return _today() - timedelta(days=months * 30)


def _clamp(val: float, lo: float = 0.0, hi: float = 1000.0) -> float:
    return max(lo, min(hi, val))


# --- D1: Delinquency Severity Index ---

def calc_dsi(db: Session, customer_id: str, months: int = 24) -> dict:
    ws = _window_start(months)

    rows = (
        db.query(Invoice.invoice_amount, Payment.days_past_due)
        .join(Payment, Payment.invoice_id == Invoice.invoice_id)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.invoice_date >= ws,
        )
        .all()
    )

    # also include open overdue invoices
    open_rows = (
        db.query(Invoice.invoice_amount, Invoice.due_date)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.invoice_date >= ws,
            Invoice.status.in_(["open", "partial"]),
            Invoice.due_date < _today(),
        )
        .all()
    )

    total_amount = Decimal("0")
    weighted_dpd = Decimal("0")

    for amount, dpd in rows:
        if amount and dpd and dpd > 0:
            weighted_dpd += Decimal(str(amount)) * Decimal(str(dpd))
            total_amount += Decimal(str(amount))
        elif amount:
            total_amount += Decimal(str(amount))

    for amount, due_date in open_rows:
        if not amount or not due_date:
            continue
        dpd = (_today() - due_date).days
        if dpd > 0:
            weighted_dpd += Decimal(str(amount)) * Decimal(str(dpd))
            total_amount += Decimal(str(amount))
        else:
            total_amount += Decimal(str(amount))

    if total_amount == Decimal("0"):
        dsi_raw = 0.0
    else:
        dsi_raw = float(weighted_dpd / total_amount)

    score = _clamp(1000.0 - (dsi_raw * 10.0))

    return {
        "dimension": "DSI",
        "raw": round(dsi_raw, 2),
        "score": round(score, 2),
    }


# --- D2: Terms Adherence Ratio ---

def calc_tar(db: Session, customer_id: str, months: int = 24) -> dict:
    ws = _window_start(months)

    paid = (
        db.query(Payment.days_past_due)
        .join(Invoice, Invoice.invoice_id == Payment.invoice_id)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.invoice_date >= ws,
        )
        .all()
    )

    if not paid:
        return {"dimension": "TAR", "raw": None, "score": 650.0, "data_flag": "insufficient_data"}

    on_time = sum(1 for (dpd,) in paid if dpd is not None and dpd <= 0)
    tar_raw = on_time / len(paid)
    score   = _clamp(tar_raw * 1000.0)

    return {
        "dimension": "TAR",
        "raw": round(tar_raw, 4),
        "score": round(score, 2),
        "data_flag": "sufficient_data",
    }


# --- D3: Invoice Size vs Payment Velocity ---

def calc_ispv(db: Session, customer_id: str, months: int = 24) -> dict:
    ws = _window_start(months)

    rows = (
        db.query(Invoice.invoice_amount, Payment.days_past_due)
        .join(Payment, Payment.invoice_id == Invoice.invoice_id)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.invoice_date >= ws,
        )
        .all()
    )

    if len(rows) < 3:
        return {"dimension": "ISPV", "raw": None, "score": 1000.0, "data_flag": "insufficient_data"}

    amounts = sorted([float(r[0]) for r in rows])
    n       = len(amounts)
    p33     = amounts[n // 3]
    p66     = amounts[(2 * n) // 3]

    small_dpd  = [float(dpd) for amt, dpd in rows if float(amt) <= p33 and dpd is not None]
    large_dpd  = [float(dpd) for amt, dpd in rows if float(amt) > p66 and dpd is not None]

    if not small_dpd or not large_dpd:
        return {"dimension": "ISPV", "raw": 0.0, "score": 1000.0, "data_flag": "insufficient_data"}

    avg_small = sum(small_dpd) / len(small_dpd)
    avg_large = sum(large_dpd) / len(large_dpd)
    diff      = avg_large - avg_small

    penalty = max(0.0, diff * 5.0)
    score   = _clamp(1000.0 - penalty)

    return {
        "dimension": "ISPV",
        "raw": round(diff, 2),
        "score": round(score, 2),
        "avg_dpd_small": round(avg_small, 2),
        "avg_dpd_large": round(avg_large, 2),
        "data_flag": "sufficient_data",
    }


# --- D4: D&B Anchor Score ---

def calc_dnb(customer: Customer, dnb_decay_months: int = 12) -> dict:
    if not customer.dnb_paydex_score:
        return {"dimension": "DNB", "raw": None, "score": 500.0, "data_flag": "not_available"}

    normalized = float(customer.dnb_paydex_score) * 10.0

    if customer.dnb_score_date:
        months_since = (_today() - customer.dnb_score_date).days / 30.0
        decay        = max(0.5, 1.0 - (months_since / dnb_decay_months) * 0.5)
    else:
        decay = 0.5

    score = _clamp(normalized * decay)

    return {
        "dimension": "DNB",
        "raw": customer.dnb_paydex_score,
        "normalized": round(normalized, 2),
        "decay_factor": round(decay, 4),
        "score": round(score, 2),
        "data_flag": "available",
    }


# --- D5: Credit Utilization Ratio ---

def calc_cur(db: Session, customer_id: str, credit_limit: Decimal) -> dict:
    from models.tables import Invoice
    open_balance = (
        db.query(func.sum(Invoice.outstanding_amount))
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.status.in_(["open", "partial"]),
        )
        .scalar()
    )
    open_balance = float(open_balance) if open_balance else 0.0

    if not credit_limit or credit_limit == 0:
        return {
            "dimension":    "CUR",
            "raw":          None,
            "score":        500.0,
            "open_balance": float(open_balance),
            "credit_limit": 0.0,
            "data_flag":    "no_limit_set",
        }

    cur_raw = float(open_balance) / float(credit_limit)

    if cur_raw <= 0.50:
        score = 1000.0
    elif cur_raw <= 0.75:
        score = 1000.0 - ((cur_raw - 0.50) / 0.25) * 200.0
    elif cur_raw <= 0.90:
        score = 800.0 - ((cur_raw - 0.75) / 0.15) * 300.0
    elif cur_raw <= 1.00:
        score = 500.0 - ((cur_raw - 0.90) / 0.10) * 300.0
    else:
        score = max(0.0, 200.0 - (cur_raw - 1.00) * 500.0)

    return {
        "dimension":    "CUR",
        "raw":          round(cur_raw, 4),
        "open_balance": float(open_balance),
        "credit_limit": float(credit_limit),
        "score":        round(_clamp(score), 2),
        "data_flag":    "sufficient_data",
    }

# --- D6: Collection Effort Intensity ---

def calc_crh(db: Session, customer_id: str, cfg: ScoringConfig) -> dict:
    ws = _window_start(cfg.crh_rolling_months)

    steps = (
        db.query(DunningConfigStep)
        .filter(DunningConfigStep.config_id == cfg.config_id)
        .order_by(DunningConfigStep.step_number)
        .all()
    )

    step_penalties = {s.step_number: float(s.penalty_weight) for s in steps}

    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.invoice_date >= ws,
        )
        .all()
    )

    default_score = float(cfg.default_new_customer_score)
    threshold     = cfg.min_invoice_threshold

    if not invoices:
        return {
            "dimension": "CRH",
            "score": default_score,
            "data_flag": "insufficient_data",
            "invoices_in_window": 0,
        }

    scored_invoices = []

    for inv in invoices:
        logs = (
            db.query(DunningLog)
            .filter(DunningLog.invoice_id == inv.invoice_id)
            .order_by(DunningLog.dunning_step.desc())
            .all()
        )

        if not logs:
            inv_score = 1000.0
        else:
            max_step  = max(l.dunning_step for l in logs if l.dunning_step)
            cum_penalty = sum(
                v for k, v in step_penalties.items() if k <= max_step
            )
            inv_score = _clamp(1000.0 - (cum_penalty * 1000.0))

        scored_invoices.append((float(inv.invoice_amount), inv_score))

    total_amt   = sum(a for a, _ in scored_invoices)
    inv_count   = len(scored_invoices)

    if total_amt == 0:
        observed_crh = default_score
    else:
        observed_crh = sum(a * s for a, s in scored_invoices) / total_amt

    if inv_count < threshold:
        w            = inv_count / threshold
        blended      = (observed_crh * w) + (default_score * (1 - w))
        data_flag    = "partial_data"
    else:
        blended      = observed_crh
        data_flag    = "sufficient_data"

    worst = min(scored_invoices, key=lambda x: x[1]) if scored_invoices else None

    return {
        "dimension": "CRH",
        "score": round(blended, 2),
        "observed_crh": round(observed_crh, 2),
        "invoices_in_window": inv_count,
        "data_flag": data_flag,
        "worst_invoice_score": round(worst[1], 2) if worst else None,
    }


# --- D7: Third Party Collections Flag ---

def calc_3pc(db: Session, customer_id: str, threepc_decay_months: int = 24) -> dict:
    cases = (
        db.query(CollectionsHistory)
        .filter(
            CollectionsHistory.customer_id == customer_id,
            CollectionsHistory.sent_to_3p == True,
        )
        .all()
    )

    if not cases:
        return {"dimension": "TPC", "raw": 0, "score": 1000.0, "data_flag": "clean"}

    most_recent  = max(c.action_date for c in cases)
    months_since = (_today() - most_recent).days / 30.0
    decay        = min(1.0, months_since / threepc_decay_months)
    base_penalty = min(400.0 * len(cases), 800.0)
    score        = _clamp(
        1000.0 - base_penalty + (decay * base_penalty * 0.6),
        lo=200.0,
    )

    return {
        "dimension": "TPC",
        "raw": len(cases),
        "most_recent_3p_months_ago": round(months_since, 1),
        "decay_factor": round(decay, 4),
        "score": round(score, 2),
        "data_flag": "flagged",
    }


# --- D8: Business Classification Weight ---

BCW_MULTIPLIERS = {
    "strategic": 1.10,
    "preferred": 1.05,
    "standard":  1.00,
    "at_risk":   0.90,
}

def calc_bcw(customer_category: Optional[str]) -> dict:
    cat        = (customer_category or "standard").lower()
    multiplier = BCW_MULTIPLIERS.get(cat, 1.00)
    return {
        "dimension": "BCW",
        "category": cat,
        "multiplier": multiplier,
    }