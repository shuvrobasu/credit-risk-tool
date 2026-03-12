# ============================================================
#  CREDIT RISK TOOL — DAILY STARTUP
#  Run each block in a separate terminal window/tab
# ============================================================

# --- TERMINAL 1: PostgreSQL (Windows Service — usually auto-starts) ---
# If not running, start manually:
net start postgresql-x64-16

# Verify:
# psql -U postgres -c "SELECT version();"


# --- TERMINAL 2: Memurai / Redis (Windows Service — usually auto-starts) ---
# If not running:
net start Memurai

# Verify:
# memurai-cli ping   →  should return PONG


# --- TERMINAL 3: FastAPI Backend ---
cd F:\credit_tool\backend
F:\credit_tool\venv\Scripts\activate
uvicorn main:app --reload --port 8000

# Swagger UI available at: http://localhost:8000/docs


# --- TERMINAL 4: Celery Worker (async jobs / dunning) ---
cd F:\credit_tool\backend
F:\credit_tool\venv\Scripts\activate
celery -A celery_app worker --loglevel=info --pool=solo


# --- TERMINAL 5: Celery Beat (scheduled jobs / nightly DPD drift) ---
cd F:\credit_tool\backend
F:\credit_tool\venv\Scripts\activate
celery -A celery_app beat --loglevel=info


# --- TERMINAL 6: React Frontend ---
cd F:\credit_tool\frontend
npm run dev

# Dashboard at: http://localhost:5173/dashboard


# ============================================================
#  ONE-SHOT start.ps1  (save as F:\credit_tool\start.ps1)
# ============================================================
# Uncomment and save as start.ps1 to launch everything at once:

# Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd F:\credit_tool\backend; F:\credit_tool\venv\Scripts\activate; uvicorn main:app --reload --port 8000'
# Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd F:\credit_tool\backend; F:\credit_tool\venv\Scripts\activate; celery -A celery_app worker --loglevel=info --pool=solo'
# Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd F:\credit_tool\backend; F:\credit_tool\venv\Scripts\activate; celery -A celery_app beat --loglevel=info'
# Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd F:\credit_tool\frontend; npm run dev'
# Start-Process "http://localhost:5173/dashboard"