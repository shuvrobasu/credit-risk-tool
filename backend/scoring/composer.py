from datetime import date
from sqlalchemy.orm import Session
from models.tables import Customer, ScoringConfig, CustomerRiskScore
from scoring.dimensions import (
    calc_dsi, calc_tar, calc_ispv, calc_dnb,
    calc_cur, calc_crh, calc_3pc, calc_bcw,
)


def _get_active_config(db: Session) -> ScoringConfig:
    cfg = db.query(ScoringConfig).filter(ScoringConfig.is_active == True).first()
    if not cfg:
        raise RuntimeError("No active scoring config found")
    return cfg


def _assign_band(score: float, cfg: ScoringConfig) -> str:
    if score >= float(cfg.band_green_floor):
        return "green"
    if score >= float(cfg.band_amber_floor):
        return "amber"
    if score >= float(cfg.band_red_floor):
        return "red"
    return "black"


def _top_risk_drivers(dimensions: dict, weights: dict) -> list:
    contributions = []
    for key, w in weights.items():
        d = dimensions.get(key)
        if not d:
            continue
        max_possible    = w * 1000.0
        actual          = w * d["score"]
        shortfall       = max_possible - actual
        contributions.append((key, shortfall, d["score"]))

    contributions.sort(key=lambda x: x[1], reverse=True)
    drivers = []

    for key, shortfall, score in contributions[:3]:
        if shortfall < 10:
            continue
        if key == "DSI":
            drivers.append("High value-weighted overdue invoices")
        elif key == "TAR":
            drivers.append(f"Terms adherence below threshold ({round(score/10)}%)")
        elif key == "ISPV":
            drivers.append("Large invoices paid significantly later than small ones")
        elif key == "CUR":
            drivers.append("Credit utilization approaching or exceeding limit")
        elif key == "CRH":
            drivers.append("Multiple dunning steps required before payment")
        elif key == "TPC":
            drivers.append("Previous third-party collections referral on record")
        elif key == "DNB":
            drivers.append("Low or stale D&B anchor score")

    return drivers if drivers else ["No significant risk drivers detected"]


def compute_score(db: Session, customer_id: str, trigger: str = "manual") -> dict:
    customer = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not customer:
        raise ValueError(f"Customer {customer_id} not found")

    cfg = _get_active_config(db)

    # --- Compute all dimensions ---
    d_dsi  = calc_dsi(db, customer_id)
    d_tar  = calc_tar(db, customer_id)
    d_ispv = calc_ispv(db, customer_id)
    d_dnb  = calc_dnb(customer, int(cfg.dnb_decay_months))
    d_cur  = calc_cur(db, customer_id, customer.credit_limit)
    d_crh  = calc_crh(db, customer_id, cfg)
    d_3pc  = calc_3pc(db, customer_id, int(cfg.threepc_decay_months))
    d_bcw  = calc_bcw(customer.customer_category)

    weights = {
        "DSI":  float(cfg.weight_dsi),
        "TAR":  float(cfg.weight_tar),
        "ISPV": float(cfg.weight_ispv),
        "CUR":  float(cfg.weight_cur),
        "CRH":  float(cfg.weight_crh),
        "TPC":  float(cfg.weight_3pc),
    }

    dim_map = {
        "DSI":  d_dsi,
        "TAR":  d_tar,
        "ISPV": d_ispv,
        "CUR":  d_cur,
        "CRH":  d_crh,
        "TPC":  d_3pc,
    }

    # --- Behavioral score ---
    behavioral_score = sum(
        weights[k] * dim_map[k]["score"]
        for k in weights
    )

    # --- D&B blend ---
    w_dnb        = float(cfg.weight_dnb)
    dnb_score    = d_dnb["score"]
    composite    = (behavioral_score * (1.0 - w_dnb)) + (dnb_score * w_dnb)

    # --- BCW adjustment ---
    final_score  = min(1000.0, composite * d_bcw["multiplier"])
    risk_band    = _assign_band(final_score, cfg)

    # --- Explainability ---
    contributions = {
        k: {
            "raw":          dim_map[k].get("raw"),
            "score":        dim_map[k]["score"],
            "weight":       weights[k],
            "contribution": round(weights[k] * dim_map[k]["score"], 2),
            "data_flag":    dim_map[k].get("data_flag"),
        }
        for k in weights
    }

    top_drivers = _top_risk_drivers(dim_map, weights)

    result = {
        "customer_id":        customer_id,
        "customer_code":      customer.customer_code,
        "customer_name":      customer.customer_name,
        "score_date":         date.today().isoformat(),
        "behavioral_score":   round(behavioral_score, 2),
        "dnb_blend": {
            "dnb_score":  dnb_score,
            "weight":     w_dnb,
            "composite":  round(composite, 2),
        },
        "bcw": {
            "category":   d_bcw["category"],
            "multiplier": d_bcw["multiplier"],
        },
        "final_score":        round(final_score, 2),
        "risk_band":          risk_band,
        "open_ar_balance":    d_cur.get("open_balance", 0.0),
        "dimensions":         contributions,
        "cur_detail":         d_cur,
        "crh_detail":         d_crh,
        "top_risk_drivers":   top_drivers,
        "score_trigger":      trigger,
        "config_version":     cfg.config_id,
    }

    return result


def save_score_snapshot(db: Session, result: dict) -> CustomerRiskScore:
    customer_id = result["customer_id"]
    today = date.today()
    
    # Check if a score for this customer already exists for today
    existing = db.query(CustomerRiskScore).filter(
        CustomerRiskScore.customer_id == customer_id,
        CustomerRiskScore.score_date == today
    ).first()

    dims    = result["dimensions"]
    cur_d   = result["cur_detail"]

    if existing:
        # Update existing snapshot instead of creating a new one
        existing.behavioral_score          = result["behavioral_score"]
        existing.anchor_score              = result["dnb_blend"]["dnb_score"]
        existing.business_adjusted_score   = result["final_score"]
        existing.risk_band                 = result["risk_band"]
        existing.credit_utilization_ratio  = cur_d.get("raw")
        existing.terms_adherence_ratio     = dims["TAR"]["raw"]
        existing.delinquency_severity_idx  = dims["DSI"]["raw"]
        existing.weighted_avg_daysoverdue  = dims["DSI"]["raw"]
        existing.open_ar_balance           = cur_d.get("open_balance", 0.0)
        existing.score_trigger             = result["score_trigger"]
        existing.config_version            = result["config_version"]
        existing.is_stale                  = False
        snapshot = existing
    else:
        snapshot = CustomerRiskScore(
            customer_id               = customer_id,
            score_date                = today,
            behavioral_score          = result["behavioral_score"],
            anchor_score              = result["dnb_blend"]["dnb_score"],
            business_adjusted_score   = result["final_score"],
            risk_band                 = result["risk_band"],
            credit_utilization_ratio  = cur_d.get("raw"),
            terms_adherence_ratio     = dims["TAR"]["raw"],
            delinquency_severity_idx  = dims["DSI"]["raw"],
            weighted_avg_daysoverdue  = dims["DSI"]["raw"],
            open_ar_balance           = cur_d.get("open_balance", 0.0),
            score_trigger             = result["score_trigger"],
            config_version            = result["config_version"],
            is_stale                  = False,
        )
        db.add(snapshot)
    
    db.commit()
    db.refresh(snapshot)
    return snapshot


def compute_and_save(db: Session, customer_id: str, trigger: str = "manual") -> dict:
    result   = compute_score(db, customer_id, trigger)
    snapshot = save_score_snapshot(db, result)
    result["score_id"] = snapshot.score_id
    return result