import os
import io
import time
import shutil
import logging
import threading
from datetime import datetime
from fastapi import UploadFile
from database import SessionLocal
from models.tables import SystemHealth

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("auto_import")

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_DIR   = os.path.join(BASE_DIR, "input")
ARCHIVE_DIR = os.path.join(BASE_DIR, "archive")

POLL_INTERVAL = int(os.getenv("AUTO_IMPORT_POLL_SECONDS", "30"))


def update_health(key: str, status: str, value: str = ""):
    db = SessionLocal()
    try:
        health = db.query(SystemHealth).filter(SystemHealth.key == key).first()
        if not health:
            health = SystemHealth(key=key)
            db.add(health)
        health.status = status
        health.value = value
        health.last_updated = datetime.utcnow()
        db.commit()
    except Exception as e:
        logger.error(f"Failed to update health: {e}")
    finally:
        db.close()


def is_file_ready(path: str) -> bool:
    try:
        size1 = os.path.getsize(path)
        time.sleep(1)
        size2 = os.path.getsize(path)
        return size1 == size2
    except OSError:
        return False


def cleanup_archive():
    if not os.path.exists(ARCHIVE_DIR):
        return
    cutoff = time.time() - (7 * 86400)
    for f in os.listdir(ARCHIVE_DIR):
        path = os.path.join(ARCHIVE_DIR, f)
        if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
            try:
                os.remove(path)
                logger.info(f"Deleted old archive file: {f}")
            except Exception as e:
                logger.error(f"Failed to delete {f}: {e}")


async def process_file(filename: str):
    from routers.import_mapping import import_file

    path = os.path.join(INPUT_DIR, filename)

    target_table = "invoices"
    if "customer" in filename.lower():
        target_table = "customers"
    elif "payment" in filename.lower():
        target_table = "payments"

    mapping_name = "default"

    logger.info(f"Auto-importing {filename} -> {target_table}")

    try:
        with open(path, "rb") as f:
            content = f.read()

        mock_file = UploadFile(filename=filename, file=io.BytesIO(content))
        result    = await import_file(mapping_name=mapping_name, target_table=target_table, file=mock_file)

        timestamp    = datetime.now().strftime("%Y%m%d_%H%M%S")
        archive_name = f"{timestamp}_{filename}"
        shutil.move(path, os.path.join(ARCHIVE_DIR, archive_name))

        logger.info(f"Imported {filename}: {result['success']} rows")
        update_health("last_import", "success", f"{filename} ({result['success']} rows)")

    except Exception as e:
        logger.error(f"Auto-import failed for {filename}: {e}")
        update_health("last_import", "fail", f"{filename}: {str(e)[:100]}")


def start_watcher():
    import asyncio

    logger.info(f"Auto-Import Watcher started. Watching: {INPUT_DIR}")
    os.makedirs(INPUT_DIR,   exist_ok=True)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    while True:
        try:
            cleanup_archive()
            files = [
                f for f in os.listdir(INPUT_DIR)
                if os.path.isfile(os.path.join(INPUT_DIR, f))
                and f.lower().endswith(".csv")
            ]
            for f in files:
                path = os.path.join(INPUT_DIR, f)
                if is_file_ready(path):
                    loop.run_until_complete(process_file(f))

            update_health("folder_watcher", "success", f"Polled {len(files)} files")

        except Exception as e:
            logger.error(f"Watcher loop error: {e}")
            update_health("folder_watcher", "fail", str(e)[:100])

        time.sleep(POLL_INTERVAL)


def run_service_background():
    t = threading.Thread(target=start_watcher, daemon=True)
    t.start()
    return t
