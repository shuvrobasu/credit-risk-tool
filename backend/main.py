import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from celery import Celery
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text
from database import engine, Base

# --- ERP Feature Flag ---
ERP_ENABLED = os.getenv("ENABLE_ERP_INTEGRATION", "false").lower() == "true"

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Credit Tool API starting - ENV={os.getenv('APP_ENV')}")
    print(f"ERP Integration: {'ENABLED' if ERP_ENABLED else 'DISABLED'}")
    
    # Start auto-import service
    try:
        from services.auto_import import run_service_background
        run_service_background()
        print("Auto-Import Service: STARTED")
    except Exception as e:
        print(f"Auto-Import Service: FAILED TO START: {e}")
        
    # --- Dynamic Schema Sync (M9/M10 Extensions) ---
    try:
        with engine.connect() as conn:
            # Customer table extensions
            conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS exclude_from_dunning BOOLEAN DEFAULT FALSE;"))
            conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS dunning_mode VARCHAR(20) DEFAULT 'fixed';"))
            # Scoring Config extensions
            conn.execute(text("ALTER TABLE scoring_config ADD COLUMN IF NOT EXISTS dunning_mode VARCHAR(20) DEFAULT 'fixed';"))
            
            # Invoice table extensions (M11/M12 Custom Reporting)
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promise_to_pay_date DATE;"))
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispute_category VARCHAR(50);"))
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispute_opened_at TIMESTAMP;"))

            # Normalize Credit Limits to nearest 1000 (M13 requirement)
            conn.execute(text("UPDATE customers SET credit_limit = ROUND(CAST(credit_limit AS FLOAT) / 1000) * 1000;"))

            # Create NEW tables if they don't exist (Manual migration for SQLite/PG fallback)
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS dunning_worklist (
                    work_id UUID PRIMARY KEY,
                    customer_id UUID NOT NULL,
                    invoice_id UUID NOT NULL,
                    suggested_action VARCHAR(50),
                    suggested_tone VARCHAR(50),
                    priority VARCHAR(20),
                    reason TEXT,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS system_health (
                    key VARCHAR(100) PRIMARY KEY,
                    value VARCHAR(255),
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(20)
                );
            """))
            
            conn.commit()
            print("Database Schema: SYNCED (exclude_from_dunning, dunning_mode, worklist, health)")
    except Exception as e:
        print(f"Database Schema Sync: WARNING - {e}")

    yield

# --- App Init ---
app = FastAPI(
    title="Credit Risk Tool",
    description="AR-based credit risk scoring, dunning automation and prediction engine",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Celery ---
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery = Celery(
    "credit_tool",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={},
)

# --- Health Check ---
@app.get("/health", tags=["System"])
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "env": os.getenv("APP_ENV", "development"),
    }

# --- Routers ---
from routers.customers import router as customers_router
from routers.invoices import router as invoices_router
from routers.payments import router as payments_router
from routers.scores import router as scores_router
from routers.collections import router as collections_router
from routers.dunning_config import router as dunning_config_router
from routers.templates import router as templates_router
from routers.email_config import router as email_config_router
from routers.currency import router as currency_router
from routers.import_mapping import router as import_mapping_router
from routers.ar_ledger import router as ar_ledger_router
from routers.dunning import router as dunning_router
from routers.predictions import router as predictions_router
from routers.erp_sync import router as erp_sync_router
from routers.ai_chat import router as ai_chat_router

from routers.app_settings import router as app_settings_router
from routers.system_health import router as system_health_router
from routers.worklist import router as worklist_router
from routers.ui_mapping import router as ui_mapping_router # Added this line
from routers.reports import router as reports_router

app.include_router(app_settings_router, prefix="/api/v1/app-settings", tags=["App Settings"])
app.include_router(reports_router, prefix="/api/v1/reports", tags=["Reports"])
app.include_router(system_health_router, prefix="/api/v1/system-health", tags=["System Health"])
app.include_router(worklist_router, prefix="/api/v1/worklist", tags=["Worklist"])
app.include_router(ui_mapping_router, prefix="/api/v1/ui-mapping", tags=["UI Mapping"]) # Added this line
app.include_router(dunning_router, prefix="/api/v1/dunning", tags=["Dunning"])
app.include_router(ar_ledger_router, prefix="/api/v1/ar-ledger", tags=["AR Ledger"])
app.include_router(import_mapping_router, prefix="/api/v1/import-mapping", tags=["Import Mapping"])
app.include_router(currency_router, prefix="/api/v1/currency", tags=["Currency Rates"])
app.include_router(email_config_router, prefix="/api/v1/email-config", tags=["Email Config"])
app.include_router(templates_router, prefix="/api/v1/templates", tags=["Dunning Templates"])
app.include_router(dunning_config_router, prefix="/api/v1/dunning-config", tags=["Dunning Config"])
app.include_router(customers_router,   prefix="/api/v1/customers",   tags=["Customers"])
app.include_router(invoices_router,    prefix="/api/v1/invoices",     tags=["Invoices"])
app.include_router(payments_router,    prefix="/api/v1/payments",     tags=["Payments"])
app.include_router(scores_router,      prefix="/api/v1/scores",       tags=["Scores"])
app.include_router(predictions_router, prefix="/api/v1/predictions",  tags=["Predictions"])
app.include_router(collections_router, prefix="/api/v1/collections",  tags=["Collections"])
app.include_router(ai_chat_router,     prefix="/api/v1/ai-chat",      tags=["AI Chat Assistant"])

# --- Static Files (Frontend) ---
# When running in Docker, the frontend dist folder is at /app/frontend/dist
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(frontend_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_path, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # API requests stay as they are (handled by routers)
        if full_path.startswith("api/v1") or full_path == "health":
             return # FastAPI will handle these
        
        # Everything else serves index.html (React routing)
        file_path = os.path.join(frontend_path, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_path, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("APP_PORT", 8000)),
        reload=True,
    )