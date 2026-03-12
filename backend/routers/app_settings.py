import os
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.tables import AppSettings, ScoringConfig
from pydantic import BaseModel
from typing import Any

router = APIRouter()

THEME_FILE = "f:/credit_tool/frontend/public/theme.json"

class SettingUpdate(BaseModel):
    key: str
    value: Any

@router.get("")
def get_all_settings(db: Session = Depends(get_db)):
    settings = db.query(AppSettings).all()
    return {s.setting_key: s.setting_value for s in settings}

@router.patch("/{key}")
def update_setting(key: str, payload: dict, db: Session = Depends(get_db)):
    setting = db.query(AppSettings).filter(AppSettings.setting_key == key).first()
    if not setting:
        setting = AppSettings(setting_key=key, setting_value=payload.get("value"))
        db.add(setting)
    else:
        setting.setting_value = payload.get("value")
    db.commit()
    return {"status": "ok", "key": key, "value": setting.setting_value}

@router.post("/bulk")
def update_settings_bulk(payload: dict, db: Session = Depends(get_db)):
    """
    Update multiple settings in a single transaction.
    Payload: { "key1": "value1", "key2": "value2" }
    """
    for key, value in payload.items():
        setting = db.query(AppSettings).filter(AppSettings.setting_key == key).first()
        if not setting:
            setting = AppSettings(setting_key=key, setting_value=value)
            db.add(setting)
        else:
            setting.setting_value = value
    # Sync to ScoringConfig if relevant keys are present
    sync_keys = {"dunning_level", "dunning_mode"}
    if any(k in payload for k in sync_keys):
        active_config = db.query(ScoringConfig).filter(ScoringConfig.is_active == True).first()
        if active_config:
            if "dunning_level" in payload:
                active_config.dunning_level = payload["dunning_level"]
            if "dunning_mode" in payload:
                active_config.dunning_mode = payload["dunning_mode"]
    
    db.commit()
    return {"status": "ok"}

@router.get("/theme")
def get_theme(db: Session = Depends(get_db)):
    # Try DB first
    theme_setting = db.query(AppSettings).filter(AppSettings.setting_key == "theme_config").first()
    if theme_setting:
        return theme_setting.setting_value
    
    # Fallback to file
    if os.path.exists(THEME_FILE):
        with open(THEME_FILE, "r") as f:
            return json.load(f)
    return {}

@router.post("/theme")
def save_theme(payload: dict, db: Session = Depends(get_db)):
    """
    Save theme strictly to the database. 
    NOTE: File system writes to 'public/theme.json' are removed because they trigger 
    development environment reloads (HMR) which can freeze the browser during the request.
    """
    try:
        theme_setting = db.query(AppSettings).filter(AppSettings.setting_key == "theme_config").first()
        if not theme_setting:
            theme_setting = AppSettings(setting_key="theme_config", setting_value=payload)
            db.add(theme_setting)
        else:
            theme_setting.setting_value = payload
        db.commit()
        return {"status": "ok"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
