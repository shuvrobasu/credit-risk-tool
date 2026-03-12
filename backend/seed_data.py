import os
import sys
import random
from datetime import date, timedelta, datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from faker import Faker
from database import SessionLocal
from models.tables import (
    Customer, Invoice, Payment, ScoringConfig,
    DunningConfigStep, DunningTemplate, CollectionsHistory,
    DunningLog, AiConfig
)

fake = Faker()
random.seed(42)

# --- Config ---
NUM_CUSTOMERS       = 50
INVOICES_PER_CUST   = (5, 30)
PAYMENT_RATE        = 0.80        # 80% invoices get paid
COLLECTION_RATE     = 0.15        # 15% customers have collections history
CATEGORIES          = ["strategic", "preferred", "standard", "at_risk"]
CATEGORY_WEIGHTS    = [0.10, 0.20, 0.50, 0.20]
TERMS               = ["Net30", "Net45", "Net60", "Net90"]
CURRENCIES          = ["USD", "EUR", "GBP", "INR"]
METHODS             = ["bank", "cheque", "card", "offset"]
TODAY               = date.today()
WINDOW_START        = TODAY - timedelta(days=730)   # 24 months back


def random_date(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def terms_to_days(terms: str) -> int:
    return int(terms.replace("Net", ""))


def seed_scoring_config(db) -> ScoringConfig:
    cfg = ScoringConfig(
        config_name                = "Default Config v1",
        is_active                  = True,
        weight_dsi                 = Decimal("0.25"),
        weight_tar                 = Decimal("0.20"),
        weight_ispv                = Decimal("0.10"),
        weight_cur                 = Decimal("0.20"),
        weight_crh                 = Decimal("0.15"),
        weight_3pc                 = Decimal("0.10"),
        weight_dnb                 = Decimal("0.15"),
        dnb_decay_months           = 12,
        threepc_decay_months       = 24,
        default_new_customer_score = Decimal("650.00"),
        min_invoice_threshold      = 3,
        crh_rolling_months         = 12,
        band_green_floor           = Decimal("750.00"),
        band_amber_floor           = Decimal("500.00"),
        band_red_floor             = Decimal("250.00"),
        dunning_day1               = 7,
        dunning_day2               = 15,
        dunning_day3               = 30,
        dunning_day4               = 45,
        created_by                 = "system",
    )
    db.add(cfg)
    db.flush()

    steps = [
        (-5,  "Pre-reminder 1",     "pre_due",    "0.05"),
        (-3,  "Pre-reminder 2",     "pre_due",    "0.05"),
        (-1,  "Final pre-reminder", "pre_due",    "0.05"),
        ( 1,  "Post-due reminder 1","post_due",   "0.15"),
        ( 7,  "Post-due reminder 2","post_due",   "0.20"),
        (15,  "Formal notice",      "post_due",   "0.25"),
        (30,  "Final demand",       "escalation", "0.15"),
        (45,  "3P collections ref", "collections","0.10"),
    ]
    for i, (offset, label, stype, weight) in enumerate(steps, start=1):
        db.add(DunningConfigStep(
            config_id      = cfg.config_id,
            step_number    = i,
            trigger_offset = offset,
            step_label     = label,
            step_type      = stype,
            penalty_weight = Decimal(weight),
        ))
    return cfg


def seed_dunning_templates(db):
    templates = [
        (1, None,        "Payment Reminder - Invoice Due Soon",
         "Dear {{customer_name}}, your invoice {{invoice_number}} for {{amount_due}} is due on {{due_date}}. Please arrange payment at your earliest convenience."),
        (2, None,        "Invoice Overdue - Action Required",
         "Dear {{customer_name}}, invoice {{invoice_number}} for {{amount_due}} is now {{days_overdue}} days overdue. Please settle immediately to avoid further action."),
        (3, None,        "Final Notice - Immediate Payment Required",
         "Dear {{customer_name}}, this is a final notice for invoice {{invoice_number}} for {{amount_due}}. Payment must be received within 5 business days to avoid referral to collections."),
        (1, "strategic", "Friendly Payment Reminder",
         "Dear {{customer_name}}, we wanted to flag that invoice {{invoice_number}} for {{amount_due}} will be due on {{due_date}}. Please let us know if you have any queries."),
    ]
    for step, category, subject, body in templates:
        db.add(DunningTemplate(
            template_name     = subject,
            dunning_step      = step,
            customer_category = category,
            subject_line      = subject,
            body_template     = body,
            is_active         = True,
            created_by        = "system",
        ))


def seed_ai_config(db):
    db.add(AiConfig(
        model_path     = os.getenv("LLAMA_MODEL_PATH", "F:/models/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf"),
        model_type     = "mistral",
        context_length = 4096,
        temperature    = Decimal("0.20"),
        max_tokens     = 1024,
        llama_cpp_port = int(os.getenv("LLAMA_PORT", 8002)),
        llama_cpp_host = os.getenv("LLAMA_HOST", "localhost"),
        gpu_layers     = int(os.getenv("LLAMA_GPU_LAYERS", -1)),
        is_active      = True,
    ))


def seed_customers(db, cfg: ScoringConfig) -> list:
    customers = []
    for i in range(NUM_CUSTOMERS):
        category = random.choices(CATEGORIES, weights=CATEGORY_WEIGHTS)[0]
        limit    = Decimal(str(round(random.uniform(50000, 500000), 2)))
        dnb      = random.randint(40, 99) if random.random() > 0.15 else None
        c = Customer(
            customer_code         = f"CUST-{str(i+1).zfill(4)}",
            customer_name         = fake.company(),
            country               = fake.country(),
            currency              = random.choice(CURRENCIES),
            customer_category     = category,
            credit_limit          = limit,
            credit_limit_updated_at = datetime.utcnow(),
            dnb_paydex_score      = dnb,
            dnb_score_date        = random_date(TODAY - timedelta(days=365), TODAY) if dnb else None,
            is_active             = True,
        )
        db.add(c)
        customers.append(c)
    db.flush()
    return customers


def seed_invoices_and_payments(db, customers: list, cfg: ScoringConfig):
    for cust in customers:
        terms     = random.choice(TERMS)
        term_days = terms_to_days(terms)
        n_inv     = random.randint(*INVOICES_PER_CUST)

        for j in range(n_inv):
            inv_date  = random_date(WINDOW_START, TODAY - timedelta(days=10))
            due_date  = inv_date + timedelta(days=term_days)
            amount    = Decimal(str(round(random.uniform(500, 150000), 2)))

            # bias: at_risk customers have more overdue
            if cust.customer_category == "at_risk":
                status_roll = random.random()
                if status_roll < 0.40:
                    status = "open"
                elif status_roll < 0.55:
                    status = "partial"
                else:
                    status = "paid"
            else:
                status = "paid" if random.random() < PAYMENT_RATE else "open"

            outstanding = Decimal("0.00") if status == "paid" else (
                amount * Decimal(str(round(random.uniform(0.1, 0.9), 2)))
                if status == "partial" else amount
            )

            inv = Invoice(
                customer_id       = cust.customer_id,
                invoice_number    = f"INV-{fake.unique.random_int(min=10000, max=99999)}",
                invoice_date      = inv_date,
                due_date          = due_date,
                payment_terms     = terms,
                invoice_amount    = amount,
                currency          = cust.currency,
                outstanding_amount= outstanding,
                status            = status,
                dispute_flag      = random.random() < 0.05,
            )
            db.add(inv)
            db.flush()

            # payments
            if status in ("paid", "partial"):
                paid_amount = amount if status == "paid" else (amount - outstanding)

                # payment behaviour varies by category
                if cust.customer_category == "strategic":
                    delay = random.randint(-5, 5)
                elif cust.customer_category == "preferred":
                    delay = random.randint(-3, 15)
                elif cust.customer_category == "at_risk":
                    delay = random.randint(10, 60)
                else:
                    delay = random.randint(-2, 30)

                pay_date     = due_date + timedelta(days=delay)
                days_to_pay  = (pay_date - inv_date).days
                days_past_due= (pay_date - due_date).days

                if pay_date <= TODAY:
                    db.add(Payment(
                        invoice_id      = inv.invoice_id,
                        customer_id     = cust.customer_id,
                        payment_date    = pay_date,
                        payment_amount  = paid_amount,
                        payment_method  = random.choice(METHODS),
                        reference_number= f"REF-{fake.unique.random_int(min=100000, max=999999)}",
                        days_to_pay     = days_to_pay,
                        days_past_due   = days_past_due,
                    ))

            # dunning logs for overdue invoices
            if status == "open" and due_date < TODAY:
                dpd = (TODAY - due_date).days
                step = 1
                if dpd >= 45:
                    step = 4
                elif dpd >= 30:
                    step = 3
                elif dpd >= 15:
                    step = 2

                db.add(DunningLog(
                    invoice_id          = inv.invoice_id,
                    customer_id         = cust.customer_id,
                    dunning_step        = step,
                    sent_at             = datetime.utcnow() - timedelta(days=random.randint(1, 5)),
                    sent_via            = "email",
                    sent_to             = fake.email(),
                    delivery_status     = "delivered",
                    days_past_due_at_send = dpd,
                ))

    db.flush()


def seed_collections(db, customers: list):
    eligible = [c for c in customers if c.customer_category in ("at_risk", "standard")]
    sample   = random.sample(eligible, min(int(NUM_CUSTOMERS * COLLECTION_RATE), len(eligible)))

    for cust in sample:
        sent_3p  = random.random() < 0.30
        outcome  = random.choice(["recovered", "partial", "written_off", "pending"])
        at_risk  = Decimal(str(round(random.uniform(5000, 80000), 2)))
        recovered= at_risk * Decimal(str(round(random.uniform(0.4, 1.0), 2))) if outcome != "pending" else Decimal("0.00")
        act_date = random_date(TODAY - timedelta(days=365), TODAY - timedelta(days=30))

        db.add(CollectionsHistory(
            customer_id      = cust.customer_id,
            action_type      = "3p_collections" if sent_3p else "formal_notice",
            action_date      = act_date,
            action_by        = "system",
            amount_at_risk   = at_risk,
            amount_recovered = recovered,
            recovery_date    = act_date + timedelta(days=random.randint(30, 90)) if outcome != "pending" else None,
            sent_to_3p       = sent_3p,
            third_party_agency = fake.company() if sent_3p else None,
            outcome          = outcome,
        ))


def main():
    db = SessionLocal()
    try:
        # check if already seeded
        existing = db.query(Customer).count()
        if existing > 0:
            print(f"DB already has {existing} customers. Skipping seed.")
            print("To reseed: truncate all tables and run again.")
            return

        print("Seeding scoring config...")
        cfg = seed_scoring_config(db)

        print("Seeding dunning templates...")
        seed_dunning_templates(db)

        print("Seeding AI config...")
        seed_ai_config(db)

        print(f"Seeding {NUM_CUSTOMERS} customers...")
        customers = seed_customers(db, cfg)

        print("Seeding invoices and payments...")
        seed_invoices_and_payments(db, customers, cfg)

        print("Seeding collections history...")
        seed_collections(db, customers)

        db.commit()

        inv_count = db.query(Invoice).count()
        pay_count = db.query(Payment).count()
        col_count = db.query(CollectionsHistory).count()

        print("")
        print("Seed complete:")
        print(f"  Customers   : {NUM_CUSTOMERS}")
        print(f"  Invoices    : {inv_count}")
        print(f"  Payments    : {pay_count}")
        print(f"  Collections : {col_count}")
        print(f"  Config      : {cfg.config_name}")

    except Exception as e:
        db.rollback()
        print(f"Seed FAILED: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()