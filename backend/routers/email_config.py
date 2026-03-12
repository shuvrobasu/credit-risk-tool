# routers/email_config.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models.tables import EmailConfig

router = APIRouter()


# --- Pydantic Models ---

class EmailConfigIn(BaseModel):
    config_name:        str
    smtp_host:          str
    smtp_port:          int
    smtp_user:          str
    smtp_password:      str
    use_tls:            bool = True
    from_name:          str
    from_address:       str
    reply_to:           Optional[str] = None
    default_to:         Optional[str] = None   # comma-separated
    default_cc:         Optional[str] = None   # comma-separated
    company_name:       str
    reporting_currency: Optional[str] = None


class EmailConfigUpdate(BaseModel):
    config_name:        Optional[str] = None
    smtp_host:          Optional[str] = None
    smtp_port:          Optional[int] = None
    smtp_user:          Optional[str] = None
    smtp_password:      Optional[str] = None
    use_tls:            Optional[bool] = None
    from_name:          Optional[str] = None
    from_address:       Optional[str] = None
    reply_to:           Optional[str] = None
    default_to:         Optional[str] = None
    default_cc:         Optional[str] = None
    company_name:       Optional[str] = None
    reporting_currency: Optional[str] = None
    is_active:          Optional[bool] = None


def _serialize(c: EmailConfig) -> dict:
    return {
        "email_config_id":    str(c.email_config_id),
        "config_name":        c.config_name,
        "smtp_host":          c.smtp_host,
        "smtp_port":          c.smtp_port,
        "smtp_user":          c.smtp_user,
        "smtp_password":      "***",            # never return plaintext
        "use_tls":            c.use_tls,
        "from_name":          c.from_name,
        "from_address":       c.from_address,
        "reply_to":           c.reply_to,
        "default_to":         c.default_to,
        "default_cc":         c.default_cc,
        "company_name":       c.company_name,
        "reporting_currency": c.reporting_currency,
        "is_active":          c.is_active,
        "created_at":         c.created_at.isoformat() if c.created_at else None,
        "updated_at":         c.updated_at.isoformat() if c.updated_at else None,
    }


# --- Endpoints ---

@router.get("")
def list_configs(db: Session = Depends(get_db)):
    configs = db.query(EmailConfig).order_by(EmailConfig.created_at.desc()).all()
    return [_serialize(c) for c in configs]


@router.get("/active")
def get_active_config(db: Session = Depends(get_db)):
    c = db.query(EmailConfig).filter(EmailConfig.is_active == True).first()
    if not c:
        raise HTTPException(status_code=404, detail="No active email config found")
    return _serialize(c)


@router.get("/{email_config_id}")
def get_config(email_config_id: str, db: Session = Depends(get_db)):
    c = db.query(EmailConfig).filter(EmailConfig.email_config_id == email_config_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Email config not found")
    return _serialize(c)


@router.post("")
def create_config(payload: EmailConfigIn, db: Session = Depends(get_db)):
    c = EmailConfig(
        config_name        = payload.config_name,
        smtp_host          = payload.smtp_host,
        smtp_port          = payload.smtp_port,
        smtp_user          = payload.smtp_user,
        smtp_password      = payload.smtp_password,
        use_tls            = payload.use_tls,
        from_name          = payload.from_name,
        from_address       = payload.from_address,
        reply_to           = payload.reply_to,
        default_to         = payload.default_to,
        default_cc         = payload.default_cc,
        company_name       = payload.company_name,
        reporting_currency = payload.reporting_currency,
        is_active          = False,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _serialize(c)


@router.patch("/{email_config_id}")
def update_config(email_config_id: str, payload: EmailConfigUpdate, db: Session = Depends(get_db)):
    c = db.query(EmailConfig).filter(EmailConfig.email_config_id == email_config_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Email config not found")
    if payload.config_name        is not None: c.config_name        = payload.config_name
    if payload.smtp_host          is not None: c.smtp_host          = payload.smtp_host
    if payload.smtp_port          is not None: c.smtp_port          = payload.smtp_port
    if payload.smtp_user          is not None: c.smtp_user          = payload.smtp_user
    if payload.smtp_password      is not None: c.smtp_password      = payload.smtp_password
    if payload.use_tls            is not None: c.use_tls            = payload.use_tls
    if payload.from_name          is not None: c.from_name          = payload.from_name
    if payload.from_address       is not None: c.from_address       = payload.from_address
    if payload.reply_to           is not None: c.reply_to           = payload.reply_to
    if payload.default_to         is not None: c.default_to         = payload.default_to
    if payload.default_cc         is not None: c.default_cc         = payload.default_cc
    if payload.company_name       is not None: c.company_name       = payload.company_name
    if payload.reporting_currency is not None: c.reporting_currency = payload.reporting_currency
    if payload.is_active          is not None: c.is_active          = payload.is_active
    db.commit()
    db.refresh(c)
    return _serialize(c)


@router.post("/{email_config_id}/activate")
def activate_config(email_config_id: str, db: Session = Depends(get_db)):
    c = db.query(EmailConfig).filter(EmailConfig.email_config_id == email_config_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Email config not found")
    db.query(EmailConfig).update({"is_active": False})
    c.is_active = True
    db.commit()
    return {"activated": email_config_id}


@router.post("/{email_config_id}/test")
def test_smtp(email_config_id: str, db: Session = Depends(get_db)):
    c = db.query(EmailConfig).filter(EmailConfig.email_config_id == email_config_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Email config not found")
    # MVP: mocked — real SMTP test wired in post-MVP
    return {
        "email_config_id": email_config_id,
        "smtp_host":       c.smtp_host,
        "smtp_port":       c.smtp_port,
        "status":          "mocked_ok",
        "note":            "Live SMTP test enabled post-MVP",
    }