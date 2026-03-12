# dunning/mailer.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional
from sqlalchemy.orm import Session
from models.tables import EmailConfig

logger = logging.getLogger(__name__)


def _get_active_config(db: Session) -> EmailConfig:
    cfg = db.query(EmailConfig).filter(EmailConfig.is_active == True).first()
    if not cfg:
        raise RuntimeError("No active email config found")
    return cfg


def _parse_addresses(addr_str: Optional[str]) -> list:
    if not addr_str:
        return []
    return [a.strip() for a in addr_str.split(",") if a.strip()]


def send_email(
    to_addresses:    str,
    subject:         str,
    body:            str,
    cc_addresses:    Optional[str]   = None,
    attachment:      Optional[bytes] = None,
    attachment_name: Optional[str]   = None,
    db:              Optional[Session] = None,
    is_html:         bool            = True,
) -> dict:
    # --- MVP mock mode: no db or no active config → log and return mocked ---
    if db is None:
        logger.info(f"[MAILER MOCK] TO={to_addresses} CC={cc_addresses} SUBJECT={subject}")
        return {
            "status":  "mocked",
            "to":      to_addresses,
            "cc":      cc_addresses,
            "subject": subject,
            "note":    "No db session — mocked send",
        }

    try:
        cfg = _get_active_config(db)
    except RuntimeError:
        logger.warning("[MAILER MOCK] No active email config — mocked send")
        return {
            "status":  "mocked",
            "to":      to_addresses,
            "cc":      cc_addresses,
            "subject": subject,
            "note":    "No active email config — mocked send",
        }

    to_list  = _parse_addresses(to_addresses)
    cc_list  = _parse_addresses(cc_addresses)
    all_rcpt = to_list + cc_list

    if not to_list:
        raise ValueError("No valid TO addresses provided")

    # --- Build message ---
    msg = MIMEMultipart("alternative" if not attachment else "mixed")
    msg["Subject"] = subject
    msg["From"]    = f"{cfg.from_name} <{cfg.from_address}>"
    msg["To"]      = ", ".join(to_list)
    if cc_list:
        msg["Cc"]  = ", ".join(cc_list)
    if cfg.reply_to:
        msg["Reply-To"] = cfg.reply_to

    if is_html:
        msg.attach(MIMEText(body, "html"))
    else:
        msg.attach(MIMEText(body, "plain"))

    if attachment and attachment_name:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(attachment)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={attachment_name}")
        msg.attach(part)

    # --- Send ---
    mock_mode = os.getenv("MOCK_EMAIL", "true").lower() == "true"
    if mock_mode:
        logger.info(f"[MAILER MOCK] TO={to_addresses} CC={cc_addresses} SUBJECT={subject}")
        return {
            "status":  "mocked",
            "to":      to_addresses,
            "cc":      cc_addresses,
            "subject": subject,
            "note":    "MOCK_EMAIL=true in .env — set to false for live sending",
        }

    try:
        if cfg.use_tls:
            server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=10)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=10)

        server.login(cfg.smtp_user, cfg.smtp_password)
        server.sendmail(cfg.from_address, all_rcpt, msg.as_string())
        server.quit()

        logger.info(f"[MAILER] Sent TO={to_addresses} CC={cc_addresses} SUBJECT={subject}")
        return {
            "status":  "sent",
            "to":      to_addresses,
            "cc":      cc_addresses,
            "subject": subject,
        }

    except Exception as e:
        logger.error(f"[MAILER] Failed: {e}")
        return {
            "status":  "failed",
            "to":      to_addresses,
            "cc":      cc_addresses,
            "subject": subject,
            "error":   str(e),
        }

