# scheduler.py
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

import logging
from celery import Celery
from celery.schedules import crontab
from database import SessionLocal
from scoring.composer import compute_and_save
from dunning.engine import run_portfolio_dunning
from models.tables import Customer, Invoice
from datetime import date

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery = Celery(
    "credit_tool_scheduler",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery.conf.update(
    task_serializer  = "json",
    result_serializer= "json",
    accept_content   = ["json"],
    timezone         = "UTC",
    enable_utc       = True,
    broker_connection_retry_on_startup = True
)

# --- Beat schedule ---
celery.conf.beat_schedule = {
    "nightly-score-refresh": {
        "task":     "scheduler.task_nightly_score_refresh",
        "schedule": crontab(hour=2, minute=0),   # 02:00 UTC daily
    },
    "nightly-dunning-run": {
        "task":     "scheduler.task_nightly_dunning",
        "schedule": crontab(hour=3, minute=0),   # 03:00 UTC daily
    },
    "nightly-dpd-drift-check": {
        "task":     "scheduler.task_dpd_drift_check",
        "schedule": crontab(hour=1, minute=0),   # 01:00 UTC daily
    },
}


# --- Tasks ---

@celery.task(name="scheduler.task_nightly_score_refresh", bind=True, max_retries=3)
def task_nightly_score_refresh(self):
    db = SessionLocal()
    try:
        customers = db.query(Customer).filter(Customer.is_active == True).all()
        success   = 0
        errors    = 0
        for cust in customers:
            try:
                compute_and_save(db, str(cust.customer_id), trigger="scheduled_nightly")
                success += 1
            except Exception as e:
                errors += 1
                logger.error(f"Score refresh failed cust={cust.customer_id}: {e}")
        logger.info(f"Nightly score refresh complete: {success} ok, {errors} errors")
        return {"success": success, "errors": errors}
    except Exception as e:
        logger.error(f"Nightly score refresh task failed: {e}")
        raise self.retry(exc=e, countdown=300)
    finally:
        db.close()


@celery.task(name="scheduler.task_nightly_dunning", bind=True, max_retries=3)
def task_nightly_dunning(self):
    db = SessionLocal()
    try:
        summary = run_portfolio_dunning(db, dry_run=False)
        logger.info(f"Nightly dunning complete: {summary}")
        return summary
    except Exception as e:
        logger.error(f"Nightly dunning task failed: {e}")
        raise self.retry(exc=e, countdown=300)
    finally:
        db.close()


@celery.task(name="scheduler.task_dpd_drift_check", bind=True, max_retries=3)
def task_dpd_drift_check(self):
    db = SessionLocal()
    try:
        today     = date.today()
        # find open invoices that are now overdue and mark stale scores
        overdue   = (
            db.query(Invoice)
            .filter(
                Invoice.status.in_(["open", "partial"]),
                Invoice.due_date < today,
            )
            .all()
        )
        triggered = 0
        errors    = 0
        seen_customers = set()
        for inv in overdue:
            cid = str(inv.customer_id)
            if cid in seen_customers:
                continue
            seen_customers.add(cid)
            try:
                compute_and_save(db, cid, trigger="scheduled_nightly")
                triggered += 1
            except Exception as e:
                errors += 1
                logger.error(f"DPD drift recompute failed cust={cid}: {e}")

        logger.info(f"DPD drift check complete: {triggered} recomputed, {errors} errors")
        return {"overdue_invoices": len(overdue), "customers_recomputed": triggered, "errors": errors}
    except Exception as e:
        logger.error(f"DPD drift check task failed: {e}")
        raise self.retry(exc=e, countdown=300)
    finally:
        db.close()
