# scripts/generate_test_data.py
# Generates realistic AR + payment test data as CSV files for import demo.
# Usage: python scripts/generate_test_data.py
# Output: scripts/output/customers.csv, invoices.csv, payments.csv

import csv
import os
import random
import uuid
from datetime import date, timedelta
from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

NUM_CUSTOMERS = 50
NUM_INVOICES = 500
NUM_PAYMENTS = 300

CATEGORIES = ["strategic", "preferred", "standard", "at_risk"]
CURRENCIES = ["EUR", "USD", "GBP", "CHF"]
TERMS = ["Net30", "Net60", "Net90"]
METHODS = ["Bank", "Cheque", "Card"]
STATUSES = ["open", "partial", "paid"]


def generate_customers():
    customers = []
    for i in range(1, NUM_CUSTOMERS + 1):
        code = f"DEMO-{i:04d}"
        name = fake.company()
        country = fake.country_code()
        currency = random.choice(CURRENCIES)
        category = random.choice(CATEGORIES)
        credit_limit = round(random.uniform(50000, 1000000), 2)
        paydex = random.randint(30, 95) if random.random() > 0.3 else ""
        paydex_date = (date.today() - timedelta(days=random.randint(30, 365))).isoformat() if paydex else ""

        customers.append({
            "customer_code": code,
            "customer_name": name,
            "country": country,
            "currency": currency,
            "customer_category": category,
            "credit_limit": credit_limit,
            "dnb_paydex_score": paydex,
            "dnb_score_date": paydex_date,
        })
    return customers


def generate_invoices(customers):
    invoices = []
    today = date.today()

    for _ in range(NUM_INVOICES):
        cust = random.choice(customers)
        inv_date = today - timedelta(days=random.randint(30, 540))
        terms = random.choice(TERMS)
        term_days = int(terms.replace("Net", ""))
        due_date = inv_date + timedelta(days=term_days)
        amount = round(random.uniform(1000, 200000), 2)
        currency = cust["currency"]

        # determine status
        if due_date > today:
            status = "open"
            outstanding = amount
        else:
            roll = random.random()
            if roll < 0.4:
                status = "paid"
                outstanding = 0
            elif roll < 0.6:
                status = "partial"
                outstanding = round(amount * random.uniform(0.2, 0.8), 2)
            else:
                status = "open"
                outstanding = amount

        inv_number = f"INV-{random.randint(10000, 99999)}"
        invoices.append({
            "customer_code": cust["customer_code"],
            "invoice_number": inv_number,
            "invoice_date": inv_date.isoformat(),
            "due_date": due_date.isoformat(),
            "payment_terms": terms,
            "invoice_amount": amount,
            "currency": currency,
            "outstanding_amount": outstanding,
            "status": status,
        })
    return invoices


def generate_payments(invoices):
    payments = []
    today = date.today()

    # only generate payments for paid/partial invoices
    payable = [inv for inv in invoices if inv["status"] in ("paid", "partial")]
    random.shuffle(payable)

    for inv in payable[:NUM_PAYMENTS]:
        inv_date = date.fromisoformat(inv["invoice_date"])
        due_date = date.fromisoformat(inv["due_date"])
        inv_amount = float(inv["invoice_amount"])
        outstanding = float(inv["outstanding_amount"])

        if inv["status"] == "paid":
            pay_amount = inv_amount
        else:
            pay_amount = round(inv_amount - outstanding, 2)

        # payment date: sometimes early, sometimes late
        days_offset = random.randint(-10, 60)
        pay_date = due_date + timedelta(days=days_offset)
        if pay_date > today:
            pay_date = today - timedelta(days=random.randint(1, 30))

        days_to_pay = (pay_date - inv_date).days
        days_past_due = (pay_date - due_date).days

        ref = f"REF-{random.randint(100000, 999999)}"
        method = random.choice(METHODS)

        payments.append({
            "invoice_number": inv["invoice_number"],
            "customer_code": inv["customer_code"],
            "payment_date": pay_date.isoformat(),
            "payment_amount": pay_amount,
            "payment_method": method,
            "reference_number": ref,
            "days_to_pay": days_to_pay,
            "days_past_due": days_past_due,
        })
    return payments


def write_csv(filename, rows, fieldnames):
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Written {len(rows)} rows to {path}")


def main():
    print("Generating test data...")

    customers = generate_customers()
    write_csv("customers.csv", customers, [
        "customer_code", "customer_name", "country", "currency",
        "customer_category", "credit_limit", "dnb_paydex_score", "dnb_score_date",
    ])

    invoices = generate_invoices(customers)
    write_csv("invoices.csv", invoices, [
        "customer_code", "invoice_number", "invoice_date", "due_date",
        "payment_terms", "invoice_amount", "currency", "outstanding_amount", "status",
    ])

    payments = generate_payments(invoices)
    write_csv("payments.csv", payments, [
        "invoice_number", "customer_code", "payment_date", "payment_amount",
        "payment_method", "reference_number", "days_to_pay", "days_past_due",
    ])

    print(f"\nDone! Files in: {OUTPUT_DIR}")
    print(f"  {len(customers)} customers, {len(invoices)} invoices, {len(payments)} payments")


if __name__ == "__main__":
    main()
