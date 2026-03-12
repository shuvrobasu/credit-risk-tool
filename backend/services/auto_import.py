import os
import time
import shutil
import logging
import threading
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import SessionLocal
from routers.import_mapping import import_file
from fastapi import UploadFile
import io
from models.tables import SystemHealth

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("auto_import")

INPUT_DIR = "f:/credit_tool/input"
ARCHIVE_DIR = "f:/credit_tool/archive"
POLL_INTERVAL = 30 # seconds

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

def cleanup_archive():
    """Delete files in archive older than 7 days."""
    now = time.time()
    cutoff = now - (7 * 86400)
    if not os.path.exists(ARCHIVE_DIR):
        return
    for f in os.listdir(ARCHIVE_DIR):
        path = os.path.join(ARCHIVE_DIR, f)
        if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
            try:
                os.remove(path)
                logger.info(f"Deleted old archive file: {f}")
            except Exception as e:
                logger.error(f"Failed to delete {f}: {e}")

async def process_file(filename: str):
    """Processes a single file from the input directory."""
    path = os.path.join(INPUT_DIR, filename)
    
    # Determine target table based on filename hints or default to invoices
    target_table = "invoices"
    if "customer" in filename.lower(): target_table = "customers"
    elif "payment" in filename.lower(): target_table = "payments"
    
    # Default mapping name - typically we'd look this up or use a 'default'
    mapping_name = "default" 
    
    logger.info(f"Auto-importing {filename} -> {target_table}")
    
    db = SessionLocal()
    try:
        with open(path, "rb") as f:
            content = f.read()
            
        # Create a mock UploadFile for the existing import_file function
        mock_file = UploadFile(filename=filename, file=io.BytesIO(content))
        
        # Call existing import logic (from routers.import_mapping)
        # Note: import_file is async, so we await it
        from routers.import_mapping import import_file as core_import
        result = await core_import(mapping_name=mapping_name, target_table=target_table, file=mock_file, db=db)
        
        # Archive
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        archive_name = f"{timestamp}_{filename}"
        shutil.move(path, os.path.join(ARCHIVE_DIR, archive_name))
        
        update_health("last_import", "success", f"{filename} ({result['success']} rows)")
        
    except Exception as e:
        logger.error(f"Auto-import failed for {filename}: {e}")
        update_health("last_import", "fail", f"{filename}: {str(e)[:100]}")
    finally:
        db.close()

def start_watcher():
    """Background loop to poll input folder."""
    logger.info("Starting Auto-Import Watcher...")
    if not os.path.exists(INPUT_DIR): os.makedirs(INPUT_DIR)
    if not os.path.exists(ARCHIVE_DIR): os.makedirs(ARCHIVE_DIR)
    
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    while True:
        try:
            cleanup_archive()
            files = [f for f in os.listdir(INPUT_DIR) if os.path.isfile(os.path.join(INPUT_DIR, f))]
            for f in files:
                # We need to run the async process_file in the loop
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
