import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from database import SessionLocal
from models.tables import Customer
from scoring.composer import compute_and_save


BAND_COLORS = {
    "green": "\033[92m",
    "amber": "\033[93m",
    "red":   "\033[91m",
    "black": "\033[90m",
}
RESET = "\033[0m"


def run():
    db = SessionLocal()
    try:
        customers = db.query(Customer).order_by(Customer.customer_code).all()
        if not customers:
            print("No customers found. Run seed_data.py first.")
            return

        print(f"\n{'='*72}")
        print(f"  Credit Risk Scoring Test — {len(customers)} customers")
        print(f"{'='*72}\n")
        print(f"{'Code':<12} {'Name':<30} {'Score':>6} {'Band':<8} {'Trigger'}")
        print(f"{'-'*72}")

        band_counts = {"green": 0, "amber": 0, "red": 0, "black": 0}

        for cust in customers:
            result = compute_and_save(db, cust.customer_id, trigger="test_run")
            band   = result["risk_band"]
            color  = BAND_COLORS.get(band, "")
            band_counts[band] = band_counts.get(band, 0) + 1

            print(
                f"{cust.customer_code:<12} "
                f"{cust.customer_name[:28]:<30} "
                f"{result['final_score']:>6.1f} "
                f"{color}{band:<8}{RESET} "
                f"{result['score_trigger']}"
            )

        print(f"\n{'='*72}")
        print("  Score Distribution:")
        for band, count in band_counts.items():
            color = BAND_COLORS.get(band, "")
            bar   = "█" * count
            print(f"  {color}{band:<8}{RESET}  {bar} ({count})")

        print(f"\n  Sample Explainability — {customers[0].customer_code}:")
        sample = compute_and_save(db, customers[0].customer_id, trigger="test_run")
        print(f"  Final Score   : {sample['final_score']}")
        print(f"  Risk Band     : {sample['risk_band']}")
        print(f"  Behavioral    : {sample['behavioral_score']}")
        print(f"  BCW Category  : {sample['bcw']['category']} (x{sample['bcw']['multiplier']})")
        print(f"  Top Drivers   :")
        for d in sample["top_risk_drivers"]:
            print(f"    - {d}")
        print(f"\n  Dimension Breakdown:")
        for k, v in sample["dimensions"].items():
            print(f"    {k:<6} score={v['score']:>7.2f}  weight={v['weight']}  contribution={v['contribution']:>7.2f}  flag={v.get('data_flag','')}")
        print(f"{'='*72}\n")

    finally:
        db.close()


if __name__ == "__main__":
    run()