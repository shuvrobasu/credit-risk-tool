# routers/ar_ledger.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, List
from database import get_db
from models.tables import Customer, Invoice, CurrencyRate, EmailConfig

router = APIRouter()


# --- Helpers ---

def _get_rate(db: Session, from_ccy: str, to_ccy: str, as_of: date) -> Optional[float]:
    if from_ccy == to_ccy:
        return 1.0
    r = (
        db.query(CurrencyRate)
        .filter(
            CurrencyRate.from_currency == from_ccy.upper(),
            CurrencyRate.to_currency   == to_ccy.upper(),
            CurrencyRate.effective_date <= as_of,
        )
        .order_by(CurrencyRate.effective_date.desc())
        .first()
    )
    return float(r.rate) if r else None


def _build_ledger(db: Session, customer_id: str, reporting_currency: Optional[str]) -> dict:
    cust = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.status.in_(["open", "partial"]),
        )
        .order_by(Invoice.due_date.asc())
        .all()
    )

    today        = date.today()
    email_cfg    = db.query(EmailConfig).filter(EmailConfig.is_active == True).first()
    report_ccy   = reporting_currency or (email_cfg.reporting_currency if email_cfg else None)

    rows              = []
    total_billing     = {}   # {ccy: amount}
    total_reporting   = 0.0
    rate_missing      = False

    for inv in invoices:
        dpd          = (today - inv.due_date).days if inv.due_date < today else 0
        billing_ccy  = inv.currency or cust.currency or "EUR"
        outstanding  = float(inv.outstanding_amount or inv.invoice_amount)

        # exchange rate resolution: invoice rate → rates table → None
        rate = None
        if report_ccy:
            if inv.exchange_rate and inv.reporting_currency == report_ccy:
                rate = float(inv.exchange_rate)
            else:
                rate = _get_rate(db, billing_ccy, report_ccy, inv.invoice_date)
            if rate is None:
                rate_missing = True

        reporting_amount = round(outstanding * rate, 2) if rate else None

        # accumulate billing totals per currency
        total_billing[billing_ccy] = total_billing.get(billing_ccy, 0.0) + outstanding
        if reporting_amount is not None:
            total_reporting += reporting_amount

        rows.append({
            "invoice_number":    inv.invoice_number,
            "invoice_date":      inv.invoice_date.isoformat(),
            "due_date":          inv.due_date.isoformat(),
            "billing_currency":  billing_ccy,
            "outstanding_amount": round(outstanding, 2),
            "dpd":               dpd,
            "status":            inv.status,
            "exchange_rate":     rate,
            "reporting_currency": report_ccy,
            "reporting_amount":  reporting_amount,
        })

    return {
        "customer_id":        customer_id,
        "customer_code":      cust.customer_code,
        "customer_name":      cust.customer_name,
        "statement_date":     today.isoformat(),
        "reporting_currency": report_ccy,
        "invoices":           rows,
        "total_by_currency":  {k: round(v, 2) for k, v in total_billing.items()},
        "total_reporting":    round(total_reporting, 2) if report_ccy else None,
        "rate_missing":       rate_missing,
        "invoice_count":      len(rows),
    }


# --- Endpoints ---

@router.get("/customer/{customer_id}")
def get_ar_ledger(
    customer_id:        str,
    reporting_currency: Optional[str] = None,
    db: Session = Depends(get_db),
):
    return _build_ledger(db, customer_id, reporting_currency)


@router.get("/customer/{customer_id}/pdf")
def download_pdf(
    customer_id:        str,
    reporting_currency: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        from dunning.exporters import render_pdf
    except ImportError:
        raise HTTPException(status_code=501, detail="PDF exporter not yet available")

    ledger = _build_ledger(db, customer_id, reporting_currency)
    pdf    = render_pdf(ledger)

    filename = f"AR_Statement_{ledger['customer_code']}_{ledger['statement_date']}.pdf"
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/customer/{customer_id}/excel")
def download_excel(
    customer_id:        str,
    reporting_currency: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        from dunning.exporters import render_excel
    except ImportError:
        raise HTTPException(status_code=501, detail="Excel exporter not yet available")

    ledger   = _build_ledger(db, customer_id, reporting_currency)
    workbook = render_excel(ledger)

    filename = f"AR_Statement_{ledger['customer_code']}_{ledger['statement_date']}.xlsx"
    return StreamingResponse(
        iter([workbook]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/customer/{customer_id}/send")
def send_ar_ledger(
    customer_id:        str,
    to_addresses:       str,
    cc_addresses:       Optional[str] = None,
    reporting_currency: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        from dunning.mailer import send_email
    except ImportError:
        raise HTTPException(status_code=501, detail="Mailer not yet available")

    ledger   = _build_ledger(db, customer_id, reporting_currency)

    try:
        from dunning.exporters import render_pdf
        attachment = render_pdf(ledger)
        attachment_name = f"AR_Statement_{ledger['customer_code']}_{ledger['statement_date']}.pdf"
    except ImportError:
        attachment      = None
        attachment_name = None

    result = send_email(
        to_addresses    = to_addresses,
        cc_addresses    = cc_addresses,
        subject         = f"Account Statement — {ledger['customer_name']} — {ledger['statement_date']}",
        body            = f"Please find attached your account statement as of {ledger['statement_date']}.",
        attachment      = attachment,
        attachment_name = attachment_name,
    )

    return {
        "customer_id":   customer_id,
        "customer_name": ledger["customer_name"],
        "sent_to":       to_addresses,
        "sent_cc":       cc_addresses,
        "status":        result.get("status", "mocked"),
        "statement_date": ledger["statement_date"],
    }