# Installation Guide

## Prerequisites

Install these manually before running setup.ps1:

| Requirement | Version | Download |
|---|---|---|
| Windows | 11 | — |
| Python | 3.11 | https://www.python.org/downloads/release/python-3119/ |
| Node.js | LTS (18+) | https://nodejs.org/en/download |
| PostgreSQL | 16 | https://www.enterprisedb.com/downloads/postgres-postgresql-downloads |
| Memurai | Developer Edition | https://www.memurai.com/get-memurai |

**Python install note:** During Python install, check "Add Python to PATH". Verify with:
```
python --version   # must show 3.11.x
```

**PostgreSQL install note:** Note the superuser password you set during install — setup.ps1 will ask for it.

**Memurai install note:** During install, choose "Install as Windows service". Verify it appears in Services (services.msc) as "Memurai".

---

## Step 1 — Clone the repo
```
git clone https://github.com/your-org/credit-tool.git
cd credit-tool
```

---

## Step 2 — Run setup.ps1

Open PowerShell **as Administrator**, navigate to the project root, then run:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup.ps1
```

The script will:
- Verify Python, Node, PostgreSQL, Memurai are installed and running
- Create Python virtual environment at `.\venv`
- Install all Python packages from `requirements.txt`
- Install all Node packages in `.\frontend`
- Create PostgreSQL database `credit_tool` and user `credit_user`
- Generate `.\backend\.env` from defaults
- Run Alembic migrations (all tables created)
- Load seed data via `seed_data.py`

When prompted, enter your PostgreSQL superuser (`postgres`) password.

Total time: ~3–5 minutes on first run.

---

## Step 3 — Start the app
```powershell
.\start.ps1
```

This opens 4 terminal windows:
- FastAPI backend — http://localhost:8000
- Swagger UI — http://localhost:8000/docs
- Celery worker
- Celery beat scheduler
- React frontend — http://localhost:5173

---

## Step 4 — Verify

Open http://localhost:8000/docs — Swagger UI should load with all routes visible.
Open http://localhost:5173 — Dashboard should load with seeded customer data.

---

## Stop
```powershell
.\stop.ps1
```

Kills uvicorn, celery worker, celery beat, and vite processes.

---

## Manual Setup (if setup.ps1 fails)
```powershell
# 1. Create venv
python -m venv venv
.\venv\Scripts\activate

# 2. Install packages
pip install -r requirements.txt

# 3. Frontend
cd frontend
npm install
cd ..

# 4. Create DB (in psql as postgres)
CREATE DATABASE credit_tool;
CREATE USER credit_user WITH PASSWORD 'credit_pass_local';
GRANT ALL PRIVILEGES ON DATABASE credit_tool TO credit_user;
GRANT ALL ON SCHEMA public TO credit_user;

# 5. Create .env
copy backend\.env.example backend\.env
# Edit backend\.env with your values

# 6. Migrations
alembic upgrade head

# 7. Seed data
python seed_data.py
```

---

## Troubleshooting

**`python not found` or wrong version**
<br>Reinstall Python 3.11 and ensure "Add to PATH" was checked. Or set `$PYTHON` at the top of setup.ps1 to the full path, e.g. `C:\Program Files\Python311\python.exe`.

**`psql: error: connection refused`**
<br>PostgreSQL service is not running. Open services.msc, find `postgresql-x64-16`, right-click → Start.

**`Memurai service not found`**
<br>Memurai was not installed as a Windows service. Re-run the Memurai installer and select "Install as service".

**`alembic: command not found`**
<br>Run alembic from the venv: `.\venv\Scripts\alembic.exe upgrade head`

**`npm install` fails**
<br>Delete `frontend\node_modules` and `frontend\package-lock.json`, then re-run setup.ps1 or `npm install` manually.

**Port 8000 already in use**
<br>Change `APP_PORT` in `backend\.env` and update the uvicorn command in `start.ps1` to match.

**Swagger loads but returns 500 on all routes**
<br>Migrations likely didn't run. Run `.\venv\Scripts\alembic.exe upgrade head` from the project root.