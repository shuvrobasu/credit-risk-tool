# routers/templates.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models.tables import DunningTemplate

router = APIRouter()


# --- Pydantic Models ---

class TemplateIn(BaseModel):
    template_name:     str
    dunning_step:      Optional[int] = None   # NULL = standalone/AR ledger
    customer_category: Optional[str] = None   # NULL = applies to all
    subject_line:      str
    body_template:     str                    # HTML with tokens
    is_active:         bool = True
    created_by:        Optional[str] = None


class TemplateUpdate(BaseModel):
    template_name:     Optional[str] = None
    dunning_step:      Optional[int] = None
    customer_category: Optional[str] = None
    subject_line:      Optional[str] = None
    body_template:     Optional[str] = None
    is_active:         Optional[bool] = None


def _serialize(t: DunningTemplate) -> dict:
    return {
        "template_id":       str(t.template_id),
        "template_name":     t.template_name,
        "dunning_step":      t.dunning_step,
        "customer_category": t.customer_category,
        "subject_line":      t.subject_line,
        "body_template":     t.body_template,
        "is_active":         t.is_active,
        "created_by":        t.created_by,
        "created_at":        t.created_at.isoformat() if t.created_at else None,
        "updated_at":        t.updated_at.isoformat() if t.updated_at else None,
    }


# --- Endpoints ---

@router.get("")
def list_templates(
    dunning_step:      Optional[int] = None,
    customer_category: Optional[str] = None,
    is_active:         Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(DunningTemplate)
    if dunning_step is not None:
        q = q.filter(DunningTemplate.dunning_step == dunning_step)
    if customer_category is not None:
        q = q.filter(DunningTemplate.customer_category == customer_category)
    if is_active is not None:
        q = q.filter(DunningTemplate.is_active == is_active)
    templates = q.order_by(DunningTemplate.dunning_step.asc().nullslast(), DunningTemplate.template_name).all()
    return [_serialize(t) for t in templates]


@router.get("/tokens")
def get_token_reference():
    return {
        "tokens": [
            {"token": "{{customer_name}}",        "description": "Customer full name"},
            {"token": "{{invoice_number}}",       "description": "Invoice number (single invoice context)"},
            {"token": "{{amount_due}}",           "description": "Amount due on invoice"},
            {"token": "{{due_date}}",             "description": "Invoice due date"},
            {"token": "{{days_overdue}}",         "description": "Days past due at time of send"},
            {"token": "{{outstanding_balance}}",  "description": "Total outstanding across all open invoices"},
            {"token": "{{payment_terms}}",        "description": "Customer payment terms e.g. Net30"},
            {"token": "{{company_name}}",         "description": "Your company name from email config"},
            {"token": "{{invoice_table}}",        "description": "Full HTML table of all outstanding invoices"},
            {"token": "{{signature}}",            "description": "Email signature block from Email Config"},
        ]
    }


@router.get("/{template_id}")
def get_template(template_id: str, db: Session = Depends(get_db)):
    t = db.query(DunningTemplate).filter(DunningTemplate.template_id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return _serialize(t)


@router.post("")
def create_template(payload: TemplateIn, db: Session = Depends(get_db)):
    t = DunningTemplate(
        template_name     = payload.template_name,
        dunning_step      = payload.dunning_step,
        customer_category = payload.customer_category,
        subject_line      = payload.subject_line,
        body_template     = payload.body_template,
        is_active         = payload.is_active,
        created_by        = payload.created_by,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.patch("/{template_id}")
def update_template(template_id: str, payload: TemplateUpdate, db: Session = Depends(get_db)):
    t = db.query(DunningTemplate).filter(DunningTemplate.template_id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if payload.template_name     is not None: t.template_name     = payload.template_name
    if payload.dunning_step      is not None: t.dunning_step      = payload.dunning_step
    if payload.customer_category is not None: t.customer_category = payload.customer_category
    if payload.subject_line      is not None: t.subject_line      = payload.subject_line
    if payload.body_template     is not None: t.body_template     = payload.body_template
    if payload.is_active         is not None: t.is_active         = payload.is_active
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.delete("/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db)):
    t = db.query(DunningTemplate).filter(DunningTemplate.template_id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(t)
    db.commit()
    return {"deleted": template_id}


@router.post("/{template_id}/preview")
def preview_template(template_id: str, db: Session = Depends(get_db)):
    t = db.query(DunningTemplate).filter(DunningTemplate.template_id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    invoice_table = """
<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
  <thead>
    <tr style="background:#f1f5f9;">
      <th style="border:1px solid #e2e8f0;padding:8px 12px;text-align:left;">Invoice #</th>
      <th style="border:1px solid #e2e8f0;padding:8px 12px;text-align:left;">Invoice Date</th>
      <th style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;">Amount</th>
      <th style="border:1px solid #e2e8f0;padding:8px 12px;text-align:left;">Due Date</th>
      <th style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;">DPD</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;">INV-0001</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;">2026-01-15</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;">€10,000.00</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;">2026-02-15</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;color:#dc2626;font-weight:600;">+24d</td>
    </tr>
    <tr style="background:#fafafa;">
      <td style="border:1px solid #e2e8f0;padding:8px 12px;">INV-0002</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;">2026-02-01</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;">€15,000.00</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;">2026-03-01</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;color:#d97706;font-weight:600;">+10d</td>
    </tr>
    <tr>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;font-weight:600;" colspan="2">Total Outstanding</td>
      <td style="border:1px solid #e2e8f0;padding:8px 12px;text-align:right;font-weight:600;">€25,000.00</td>
      <td colspan="2" style="border:1px solid #e2e8f0;"></td>
    </tr>
  </tbody>
</table>"""

    dummy = {
        "{{customer_name}}":        "Acme Corp",
        "{{invoice_number}}":       "INV-0001",
        "{{amount_due}}":           "€10,000.00",
        "{{due_date}}":             "2026-02-15",
        "{{days_overdue}}":         "10",
        "{{outstanding_balance}}":  "€25,000.00",
        "{{payment_terms}}":        "Net30",
        "{{company_name}}":         "Your Company",
        "{{invoice_table}}":        invoice_table,
        "{{signature}}": "<p style='margin-top:24px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;padding-top:12px;'>Best regards,<br/><strong>Your Company</strong><br/>accounts@yourcompany.com</p>",
    }

    body    = t.body_template or ""
    subject = t.subject_line  or ""
    for token, val in dummy.items():
        body    = body.replace(token, val)
        subject = subject.replace(token, val)

    return {
        "template_id":     template_id,
        "preview_subject": subject,
        "preview_body":    body,
        "note":            "dummy data — connect to renderer for live customer preview",
    }