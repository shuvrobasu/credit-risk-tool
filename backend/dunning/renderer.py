# dunning/renderer.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from sqlalchemy.orm import Session
from models.tables import Customer, Invoice, EmailConfig, CurrencyRate


# --- Token resolver ---

def _get_rate(db: Session, from_ccy: str, to_ccy: str, as_of: date):
    if from_ccy == to_ccy:
        return 1.0
    from models.tables import CurrencyRate
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


def _build_invoice_table(db: Session, customer_id: str, report_ccy: str) -> str:
    today    = date.today()
    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.status.in_(["open", "partial"]),
        )
        .order_by(Invoice.due_date.asc())
        .all()
    )

    rows_html = ""
    for inv in invoices:
        dpd         = max(0, (today - inv.due_date).days) if inv.due_date < today else 0
        billing_ccy = inv.currency or "EUR"
        outstanding = float(inv.outstanding_amount or inv.invoice_amount)
        rows_html += (
            f"<tr>"
            f"<td>{inv.invoice_number}</td>"
            f"<td>{inv.invoice_date.strftime('%d/%m/%Y')}</td>"
            f"<td>{inv.due_date.strftime('%d/%m/%Y')}</td>"
            f"<td>{billing_ccy}</td>"
            f"<td style='text-align:right'>{outstanding:,.2f}</td>"
            f"<td style='text-align:center'>{dpd}</td>"
            f"<td>{inv.status.capitalize()}</td>"
            f"</tr>"
        )

    table = (
        "<table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:13px'>"
        "<thead><tr style='background:#f0f0f0'>"
        "<th>Invoice #</th><th>Invoice Date</th><th>Due Date</th>"
        "<th>Currency</th><th>Outstanding</th><th>DPD</th><th>Status</th>"
        "</tr></thead>"
        f"<tbody>{rows_html}</tbody>"
        "</table>"
    )
    return table


def _resolve_tokens(
    db:          Session,
    template:    str,
    customer:    Customer,
    invoice:     Invoice = None,
    report_ccy:  str     = None,
) -> str:
    today          = date.today()
    email_cfg      = db.query(EmailConfig).filter(EmailConfig.is_active == True).first()
    company_name   = email_cfg.company_name if email_cfg else ""
    report_ccy     = report_ccy or (email_cfg.reporting_currency if email_cfg else "EUR")

    # outstanding balance across all open invoices
    open_invoices  = (
        db.query(Invoice)
        .filter(
            Invoice.customer_id == customer.customer_id,
            Invoice.status.in_(["open", "partial"]),
        )
        .all()
    )
    outstanding_balance = sum(float(i.outstanding_amount or i.invoice_amount) for i in open_invoices)

    tokens = {
        "{{customer_name}}":       customer.customer_name,
        "{{outstanding_balance}}": f"{outstanding_balance:,.2f}",
        "{{payment_terms}}":       customer.currency or "Net30",
        "{{company_name}}":        company_name,
    }

    if invoice:
        dpd = max(0, (today - invoice.due_date).days) if invoice.due_date < today else 0
        tokens.update({
            "{{invoice_number}}": invoice.invoice_number,
            "{{amount_due}}":     f"{float(invoice.outstanding_amount or invoice.invoice_amount):,.2f}",
            "{{due_date}}":       invoice.due_date.strftime("%d/%m/%Y"),
            "{{days_overdue}}":   str(dpd),
        })
    else:
        tokens.update({
            "{{invoice_number}}": "",
            "{{amount_due}}":     "",
            "{{due_date}}":       "",
            "{{days_overdue}}":   "",
        })

    # resolve {{invoice_table}} last — it's a block token
    result = template
    for token, value in tokens.items():
        result = result.replace(token, value)

    if "{{invoice_table}}" in result:
        result = result.replace(
            "{{invoice_table}}",
            _build_invoice_table(db, str(customer.customer_id), report_ccy)
        )

    return result


def render_template(
    db:          Session,
    template_body: str,
    subject:     str,
    customer_id: str,
    invoice_id:  str = None,
    report_ccy:  str = None,
) -> dict:
    customer = db.query(Customer).filter(Customer.customer_id == customer_id).first()
    if not customer:
        raise ValueError(f"Customer {customer_id} not found")

    invoice = None
    if invoice_id:
        invoice = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()

    rendered_body    = _resolve_tokens(db, template_body, customer, invoice, report_ccy)
    rendered_subject = _resolve_tokens(db, subject,        customer, invoice, report_ccy)

    return {
        "customer_id":   customer_id,
        "invoice_id":    invoice_id,
        "subject":       rendered_subject,
        "body":          rendered_body,
        "rendered_at":   date.today().isoformat(),
    }