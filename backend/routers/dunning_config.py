# routers/dunning_config.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, validator
from typing import Optional, List
from database import get_db
from models.tables import ScoringConfig, DunningConfigStep, DunningTemplate

router = APIRouter()


# --- Pydantic Models ---

class StepIn(BaseModel):
    ladder_key:      str
    step_number:     int
    trigger_offset:  int
    step_label:      str
    step_type:       str        # pre_due/post_due/escalation/collections
    penalty_weight:  float
    template_id:     Optional[str] = None


class LadderIn(BaseModel):
    ladder_key:  str
    steps:       List[StepIn]

    @validator("steps")
    def weights_must_sum_to_one(cls, steps):
        total = round(sum(s.penalty_weight for s in steps), 4)
        if total != 1.0:
            raise ValueError(f"penalty_weights must sum to 1.0, got {total}")
        return steps


class ConfigIn(BaseModel):
    config_name:            str
    ladder_assignment_mode: str = "payment_terms"
    weight_dsi:             float = 0.25
    weight_tar:             float = 0.20
    weight_ispv:            float = 0.10
    weight_cur:             float = 0.20
    weight_crh:             float = 0.15
    weight_3pc:             float = 0.10
    weight_dnb:             float = 0.15
    dnb_decay_months:       int   = 12
    threepc_decay_months:   int   = 24
    default_new_customer_score: float = 650.0
    min_invoice_threshold:  int   = 5
    crh_rolling_months:     int   = 12
    band_green_floor:       float = 750.0
    band_amber_floor:       float = 500.0
    band_red_floor:         float = 250.0
    ladders:                List[LadderIn] = []

    @validator("weight_dsi")
    def weights_sum_to_one(cls, v, values):
        keys = ["weight_dsi", "weight_tar", "weight_ispv", "weight_cur", "weight_crh", "weight_3pc"]
        # full validation done on save — partial here
        return v

    @validator("ladder_assignment_mode")
    def valid_mode(cls, v):
        allowed = {"payment_terms", "customer_category", "risk_band", "custom"}
        if v not in allowed:
            raise ValueError(f"ladder_assignment_mode must be one of {allowed}")
        return v


def _serialize_step(s: DunningConfigStep) -> dict:
    return {
        "step_id":        s.step_id,
        "config_id":      s.config_id,
        "ladder_key":     s.ladder_key,
        "step_number":    s.step_number,
        "trigger_offset": s.trigger_offset,
        "step_label":     s.step_label,
        "step_type":      s.step_type,
        "penalty_weight": float(s.penalty_weight),
        "template_id":    str(s.template_id) if s.template_id else None,
    }


def _serialize_config(cfg: ScoringConfig, steps: list) -> dict:
    ladders = {}
    for s in steps:
        ladders.setdefault(s.ladder_key, []).append(_serialize_step(s))
    return {
        "config_id":                cfg.config_id,
        "config_name":              cfg.config_name,
        "is_active":                cfg.is_active,
        "ladder_assignment_mode":   cfg.ladder_assignment_mode,
        "weight_dsi":               float(cfg.weight_dsi or 0),
        "weight_tar":               float(cfg.weight_tar or 0),
        "weight_ispv":              float(cfg.weight_ispv or 0),
        "weight_cur":               float(cfg.weight_cur or 0),
        "weight_crh":               float(cfg.weight_crh or 0),
        "weight_3pc":               float(cfg.weight_3pc or 0),
        "weight_dnb":               float(cfg.weight_dnb or 0),
        "dnb_decay_months":         cfg.dnb_decay_months,
        "threepc_decay_months":     cfg.threepc_decay_months,
        "default_new_customer_score": float(cfg.default_new_customer_score or 0),
        "min_invoice_threshold":    cfg.min_invoice_threshold,
        "crh_rolling_months":       cfg.crh_rolling_months,
        "band_green_floor":         float(cfg.band_green_floor or 0),
        "band_amber_floor":         float(cfg.band_amber_floor or 0),
        "band_red_floor":           float(cfg.band_red_floor or 0),
        "ladders":                  ladders,
        "created_at":               cfg.created_at.isoformat() if cfg.created_at else None,
    }


# --- Endpoints ---

@router.get("")
def list_configs(db: Session = Depends(get_db)):
    configs = db.query(ScoringConfig).order_by(ScoringConfig.config_id.desc()).all()
    result  = []
    for cfg in configs:
        steps = db.query(DunningConfigStep).filter(DunningConfigStep.config_id == cfg.config_id).all()
        result.append(_serialize_config(cfg, steps))
    return result


@router.get("/active")
def get_active_config(db: Session = Depends(get_db)):
    cfg = db.query(ScoringConfig).filter(ScoringConfig.is_active == True).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="No active scoring config found")
    steps = db.query(DunningConfigStep).filter(DunningConfigStep.config_id == cfg.config_id).all()
    return _serialize_config(cfg, steps)


@router.get("/{config_id}")
def get_config(config_id: int, db: Session = Depends(get_db)):
    cfg = db.query(ScoringConfig).filter(ScoringConfig.config_id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config not found")
    steps = db.query(DunningConfigStep).filter(DunningConfigStep.config_id == cfg.config_id).all()
    return _serialize_config(cfg, steps)


@router.post("")
def create_config(payload: ConfigIn, db: Session = Depends(get_db)):
    # validate behavioral weights sum to 1.0
    w_sum = round(
        payload.weight_dsi + payload.weight_tar + payload.weight_ispv +
        payload.weight_cur + payload.weight_crh + payload.weight_3pc, 4
    )
    if w_sum != 1.0:
        raise HTTPException(status_code=400, detail=f"Behavioral weights must sum to 1.0, got {w_sum}")

    cfg = ScoringConfig(
        config_name                = payload.config_name,
        is_active                  = False,
        ladder_assignment_mode     = payload.ladder_assignment_mode,
        weight_dsi                 = payload.weight_dsi,
        weight_tar                 = payload.weight_tar,
        weight_ispv                = payload.weight_ispv,
        weight_cur                 = payload.weight_cur,
        weight_crh                 = payload.weight_crh,
        weight_3pc                 = payload.weight_3pc,
        weight_dnb                 = payload.weight_dnb,
        dnb_decay_months           = payload.dnb_decay_months,
        threepc_decay_months       = payload.threepc_decay_months,
        default_new_customer_score = payload.default_new_customer_score,
        min_invoice_threshold      = payload.min_invoice_threshold,
        crh_rolling_months         = payload.crh_rolling_months,
        band_green_floor           = payload.band_green_floor,
        band_amber_floor           = payload.band_amber_floor,
        band_red_floor             = payload.band_red_floor,
    )
    db.add(cfg)
    db.flush()

    for ladder in payload.ladders:
        for s in ladder.steps:
            db.add(DunningConfigStep(
                config_id      = cfg.config_id,
                ladder_key     = ladder.ladder_key,
                step_number    = s.step_number,
                trigger_offset = s.trigger_offset,
                step_label     = s.step_label,
                step_type      = s.step_type,
                penalty_weight = s.penalty_weight,
                template_id    = s.template_id,
            ))

    db.commit()
    db.refresh(cfg)
    steps = db.query(DunningConfigStep).filter(DunningConfigStep.config_id == cfg.config_id).all()
    return _serialize_config(cfg, steps)


@router.post("/{config_id}/activate")
def activate_config(config_id: int, db: Session = Depends(get_db)):
    cfg = db.query(ScoringConfig).filter(ScoringConfig.config_id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config not found")
    # deactivate all others
    db.query(ScoringConfig).update({"is_active": False})
    cfg.is_active = True
    db.commit()
    return {"activated": config_id}


@router.post("/{config_id}/ladders")
def add_ladder(config_id: int, payload: LadderIn, db: Session = Depends(get_db)):
    cfg = db.query(ScoringConfig).filter(ScoringConfig.config_id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config not found")

    # remove existing steps for this ladder_key if any
    db.query(DunningConfigStep).filter(
        DunningConfigStep.config_id  == config_id,
        DunningConfigStep.ladder_key == payload.ladder_key,
    ).delete()

    for s in payload.steps:
        db.add(DunningConfigStep(
            config_id      = config_id,
            ladder_key     = payload.ladder_key,
            step_number    = s.step_number,
            trigger_offset = s.trigger_offset,
            step_label     = s.step_label,
            step_type      = s.step_type,
            penalty_weight = s.penalty_weight,
            template_id    = s.template_id,
        ))

    db.commit()
    steps = db.query(DunningConfigStep).filter(DunningConfigStep.config_id == config_id).all()
    cfg   = db.query(ScoringConfig).filter(ScoringConfig.config_id == config_id).first()
    return _serialize_config(cfg, steps)


@router.delete("/{config_id}/ladders/{ladder_key}")
def delete_ladder(config_id: int, ladder_key: str, db: Session = Depends(get_db)):
    deleted = db.query(DunningConfigStep).filter(
        DunningConfigStep.config_id  == config_id,
        DunningConfigStep.ladder_key == ladder_key,
    ).delete()
    if not deleted:
        raise HTTPException(status_code=404, detail="Ladder not found")
    db.commit()
    return {"deleted": ladder_key, "steps_removed": deleted}