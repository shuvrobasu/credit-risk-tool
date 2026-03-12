# dunning/engine.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import logging
from datetime import date
from sqlalchemy.orm import Session
from models.tables import (
    Customer, Invoice, DunningLog, DunningTemplate,
    ScoringConfig, DunningConfigStep, EmailConfig, AppSettings
)
from dunning.renderer import render_template
from dunning.mailer import send_email
from ai.dunning_agent import evaluate_ai_dunning_strategy

logger = logging.getLogger(__name__)


# --- Ladder resolution ---

def _get_active_config(db: Session) -> ScoringConfig:
    cfg = db.query(ScoringConfig).filter(ScoringConfig.is_active == True).first()
    if not cfg:
        raise RuntimeError("No active scoring config found")
    return cfg


def _resolve_ladder_key(customer: Customer, cfg: ScoringConfig) -> str:
    mode = cfg.ladder_assignment_mode or "payment_terms"
    if mode == "payment_terms":
        return customer.currency or "default"   # payment_terms stored per invoice not customer
    if mode == "customer_category":
        return customer.customer_category or "default"
    if mode == "risk_band":
        from models.tables import CustomerRiskScore
        return "default"    # resolved per invoice call — see _resolve_ladder_key_for_invoice
    return "default"


def _resolve_ladder_key_for_invoice(
    db:       Session,
    customer: Customer,
    invoice:  Invoice,
    cfg:      ScoringConfig,
) -> str:
    mode = cfg.ladder_assignment_mode or "payment_terms"
    if mode == "payment_terms":
        key = invoice.payment_terms or "default"
    elif mode == "customer_category":
        key = customer.customer_category or "default"
    elif mode == "risk_band":
        from models.tables import CustomerRiskScore
        from sqlalchemy import func
        latest = (
            db.query(CustomerRiskScore.risk_band)
            .filter(CustomerRiskScore.customer_id == str(customer.customer_id))
            .order_by(CustomerRiskScore.created_at.desc())
            .first()
        )
        key = latest[0] if latest else "default"
    else:
        key = "default"

    # fallback to default if no steps defined for resolved key
    steps = db.query(DunningConfigStep).filter(
        DunningConfigStep.config_id  == cfg.config_id,
        DunningConfigStep.ladder_key == key,
    ).count()
    if steps == 0:
        key = "default"
    return key


def _get_ladder_steps(db: Session, config_id: int, ladder_key: str) -> list:
    return (
        db.query(DunningConfigStep)
        .filter(
            DunningConfigStep.config_id  == config_id,
            DunningConfigStep.ladder_key == ladder_key,
        )
        .order_by(DunningConfigStep.step_number.asc())
        .all()
    )


# --- Dunning step evaluator per invoice ---

def _already_sent(db: Session, invoice_id: str, step_number: int) -> bool:
    return db.query(DunningLog).filter(
        DunningLog.invoice_id   == invoice_id,
        DunningLog.dunning_step == step_number,
    ).count() > 0


def _get_due_steps(steps: list, invoice: Invoice) -> list:
    today    = date.today()
    due_date = invoice.due_date
    due      = []
    for step in steps:
        trigger_date = due_date + __import__("datetime").timedelta(days=int(step.trigger_offset))
        if today >= trigger_date:
            due.append(step)
    return due


def _log_dunning(
    db:          Session,
    invoice:     Invoice,
    step:        DunningConfigStep,
    sent_to:     str,
    sent_cc:     str,
    status:      str,
    sent_via:    str = "email",
    rendered_subject: str = None,
    rendered_body:    str = None,
) -> DunningLog:
    today = date.today()
    dpd   = max(0, (today - invoice.due_date).days) if invoice.due_date < today else 0
    log   = DunningLog(
        invoice_id            = str(invoice.invoice_id),
        customer_id           = str(invoice.customer_id),
        dunning_step          = step.step_number,
        template_id           = str(step.template_id) if step.template_id else None,
        sent_at               = __import__("datetime").datetime.utcnow(),
        sent_via              = sent_via,
        sent_to               = sent_to,
        sent_cc               = sent_cc,
        delivery_status       = status,
        days_past_due_at_send = dpd,
        rendered_subject      = rendered_subject,
        rendered_body         = rendered_body,
    )
    db.add(log)
    return log


# --- Main engine entry points ---

def evaluate_invoice(
    db:         Session,
    invoice_id: str,
    dry_run:    bool = False,
) -> dict:
    invoice  = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()
    if not invoice:
        raise ValueError(f"Invoice {invoice_id} not found")
    # re-check status at evaluation time — invoice may have been paid since queued
    db.refresh(invoice)
    
    # Check global settings
    settings_raw = db.query(AppSettings).all()
    app_settings = {s.setting_key: s.setting_value for s in settings_raw}
    auto_resolve_dispute = app_settings.get("auto_resolve_dispute_on_payment", False)

    # 1. Dispute Auto-Resolution Logic
    if invoice.status == "paid" and auto_resolve_dispute and invoice.dispute_flag:
        logger.info(f"Auto-resolving dispute for paid invoice: {invoice_id}")
        invoice.dispute_flag = False
        invoice.dispute_reason = (invoice.dispute_reason or "") + f" [Auto-resolved on payment {date.today()}]"
        db.add(invoice)
        db.commit() # Commit resolution immediately
    
    # 2. Skip paid/written_off/disputed
    if invoice.status in ("paid", "written_off", "disputed") or invoice.dispute_flag:
        logger.info(f"Dunning skip: inv={invoice_id} status={invoice.status} (cleared/disputed since queued)")
        return {"invoice_id": invoice_id, "status": "skipped", "reason": f"{invoice.status}_since_queued"}

    customer = db.query(Customer).filter(Customer.customer_id == str(invoice.customer_id)).first()
    
    # 3. Customer-level exclusion
    if customer and customer.exclude_from_dunning:
        logger.info(f"Dunning skip: cust={customer.customer_id} is explicitly excluded from dunning.")
        return {"invoice_id": invoice_id, "status": "skipped", "reason": "customer_excluded"}
        
    # Determine Dunning Mode (Fixed vs AI)
    cfg = _get_active_config(db)
    # Mode priority: Global Level (if set to AI) -> Customer Level -> Default 'fixed'
    # This allows a global toggle to 'ai' to sweep all customers who aren't explicitly customized.
    if cfg.dunning_mode == "ai":
        dunning_mode = "ai"
    else:
        dunning_mode = customer.dunning_mode or "fixed"
    
    if dunning_mode == "ai":
        # Only evaluate at invoice level if global level is also set to invoice
        if (cfg.dunning_level or "invoice") == "invoice":
            logger.info(f"Using AI Dunning Mode for customer {customer.customer_id}")
            ai_strategy = evaluate_ai_dunning_strategy(db, customer, invoice)
            return {
                "invoice_id": invoice_id, 
                "status": "ai_evaluated", 
                "strategy": ai_strategy,
                "mode": "ai"
            }
        else:
            logger.info(f"Skipping AI Invoice eval for {invoice_id} because level is set to 'customer'")
            return {"invoice_id": invoice_id, "status": "skipped", "reason": "level_is_customer"}

    # Standard Fixed Ladder Logic
    ladder_key = _resolve_ladder_key_for_invoice(db, customer, invoice, cfg)
    steps      = _get_ladder_steps(db, cfg.config_id, ladder_key)

    if not steps:
        return {"invoice_id": invoice_id, "status": "no_ladder", "ladder_key": ladder_key}

    due_steps    = _get_due_steps(steps, invoice)
    actions_taken = []

    # --- Resolve Recipient ---
    email_cfg = db.query(EmailConfig).filter(EmailConfig.is_active == True).first()
    sent_to = email_cfg.default_to if email_cfg else ""
    sent_cc = email_cfg.default_cc if email_cfg else ""

    # Priority: Global Override > Manual Override > Master Contact > System Default
    global_cfg = db.query(AppSettings).filter(AppSettings.setting_key == "global_use_manual_contact").first()
    is_global_manual = global_cfg.setting_value if global_cfg else False

    if (is_global_manual or customer.use_manual_contact) and customer.contact_person_manual:
        sent_to = customer.contact_person_manual
    elif customer.contact_person:
        sent_to = customer.contact_person

    for step in due_steps:
        if _already_sent(db, invoice_id, step.step_number):
            actions_taken.append({
                "step":   step.step_number,
                "status": "already_sent",
            })
            continue

        rendered = None
        if step.template_id:
            tmpl = db.query(DunningTemplate).filter(
                DunningTemplate.template_id == str(step.template_id)
            ).first()
            if tmpl:
                rendered = render_template(
                    db            = db,
                    template_body = tmpl.body_template,
                    subject       = tmpl.subject_line,
                    customer_id   = str(invoice.customer_id),
                    invoice_id    = invoice_id,
                )

        if dry_run:
            actions_taken.append({
                "step":        step.step_number,
                "step_label":  step.step_label,
                "ladder_key":  ladder_key,
                "status":      "dry_run",
                "subject":     rendered["subject"] if rendered else None,
            })
            continue

        send_result = {"status": "no_template"}
        if rendered:
            send_result = send_email(
                to_addresses = sent_to,
                cc_addresses = sent_cc,
                subject      = rendered["subject"],
                body         = rendered["body"],
                db           = db,
            )

        if not dry_run:
            log = _log_dunning(
                db       = db,
                invoice  = invoice,
                step     = step,
                sent_to  = sent_to,
                sent_cc  = sent_cc,
                status   = send_result.get("status", "unknown"),
                rendered_subject = rendered["subject"] if rendered else None,
                rendered_body    = rendered["body"]    if rendered else None,
            )
            db.flush()

        actions_taken.append({
            "step":       step.step_number,
            "step_label": step.step_label,
            "ladder_key": ladder_key,
            "status":     send_result.get("status"),
        })

    db.commit()
    return {
        "invoice_id":    invoice_id,
        "invoice_number": invoice.invoice_number,
        "customer_id":   str(invoice.customer_id),
        "ladder_key":    ladder_key,
        "steps_due":     len(due_steps),
        "actions":       actions_taken,
    }


def evaluate_customer(
    db:          Session,
    customer_id: str,
    dry_run:     bool = False,
) -> dict:
    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.status.in_(["open", "partial"]), # Strictly only open/partial, not disputed
        )
        .all()
    )

    # skip if no open items at all
    if not invoices:
        logger.info(f"Dunning skip: customer={customer_id} — no open/partial invoices")
        return {
            "customer_id":      customer_id,
            "invoices_checked": 0,
            "status":           "skipped",
            "reason":           "no_open_items",
            "results":          [],
            "errors":           [],
        }

    # Determine Dunning Level
    cfg = _get_active_config(db)
    level = cfg.dunning_level or "invoice"

    if level == "customer":
        customer = db.query(Customer).filter(Customer.customer_id == customer_id).first()
        # Check if customer overall is excluded
        if customer and customer.exclude_from_dunning:
             return {"customer_id": customer_id, "status": "skipped", "reason": "customer_excluded"}
        
        # Consolidation mode: One strategy for all open items
        logger.info(f"Using Customer-Level Dunning for {customer_id}")
        from ai.dunning_agent import evaluate_customer_level_strategy
        res = evaluate_customer_level_strategy(db, customer, invoices)
        return {
            "customer_id": customer_id,
            "status": "acc_evaluated",
            "strategy": res,
            "invoices_affected": [str(inv.invoice_id) for inv in invoices]
        }

    # Invoice level mode (original logic)
    results = []
    errors  = []
    for inv in invoices:
        try:
            r = evaluate_invoice(db, str(inv.invoice_id), dry_run=dry_run)
            results.append(r)
        except Exception as e:
            errors.append({"invoice_id": str(inv.invoice_id), "error": str(e)})
            logger.error(f"Dunning eval error inv={inv.invoice_id}: {e}")

    return {
        "customer_id":      customer_id,
        "invoices_checked": len(invoices),
        "results":          results,
        "errors":           errors,
    }


def run_portfolio_dunning(db: Session, dry_run: bool = False) -> dict:
    customers = db.query(Customer).filter(Customer.is_active == True).all()
    summary   = {"processed": 0, "skipped": 0, "errors": 0, "actions_taken": 0}
    for cust in customers:
        try:
            r = evaluate_customer(db, str(cust.customer_id), dry_run=dry_run)
            summary["processed"] += 1
            
            # Count actions from fixed ladder
            if "results" in r:
                for res in r["results"]:
                    for a in res.get("actions", []):
                        if a["status"] not in ("already_sent", "dry_run", "no_template"):
                            summary["actions_taken"] += 1
            
            # Count actions from AI strategies (Worklist entries)
            if r.get("status") == "ai_evaluated" or r.get("status") == "acc_evaluated":
                if not dry_run:
                    summary["actions_taken"] += 1
        except Exception as e:
            summary["errors"] += 1
            logger.error(f"Portfolio dunning error cust={cust.customer_id}: {e}")
    return summary