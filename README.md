# CreditTool — Credit Risk Engine

> Self-hosted, API-first credit risk and AR management platform with dynamic scoring, dunning automation, and AI-assisted analysis.

![Dashboard Screenshot]<img width="1915" height="996" alt="image" src="https://github.com/user-attachments/assets/a78d028c-c887-42a2-b851-4ed59d28742c" />


---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Screenshots](#screenshots)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the App](#running-the-app)
- [API Reference](#api-reference)
- [Scoring Model](#scoring-model)
- [Dunning Engine](#dunning-engine)
- [Project Structure](#project-structure)
- [Build Milestones](#build-milestones)
- [ERP Integration](#erp-integration)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

CreditTool ingests accounts receivable and payment data at the **invoice level**, builds a dynamic customer risk profile, scores it across 8 behavioral dimensions, predicts future payment behavior, and automates dunning workflows — all exposed via a REST API and visualised in a React dashboard.

![Architecture Diagram](docs/images/architecture.png)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python 3.11) |
| Database | PostgreSQL 16 |
| Cache / Broker | Memurai (Windows Redis) |
| Task Queue | Celery + Celery Beat |
| ORM | SQLAlchemy Core |
| Migrations | Alembic |
| Frontend | React + Vite |
| Charts | Recharts |
| Styling | Tailwind CSS |
| Auth | JWT (python-jose) |
| Deployment | PowerShell (Windows 11) |

---

## Features

### Core
- **Invoice-level AR tracking** — outstanding balance, status, dispute flags
- **8-dimension behavioral scoring** — DSI, TAR, ISPV, DNB, CUR, CRH, 3PC, BCW
- **Versioned score snapshots** — every score is reproducible from its config version
- **Risk band assignment** — GREEN / AMBER / RED / BLACK with configurable thresholds
- **Score explainability** — per-dimension contribution breakdown + top risk drivers
- **Prediction layer** — expected payment date, p(on-time), 30/60/90-day cash flow forecast

### Dunning
- **Configurable step ladder** — pre-due reminders through 3P collections
- **Template designer** — rich text editor with token toolbar and live preview
- **Dunning log** — full timeline per customer with delivery status and DPD at send
- **Celery-scheduled evaluation** — nightly DPD drift check triggers dunning steps automatically

### Dashboard
- Portfolio heat map (risk band distribution)
- Customer drilldown — score history, invoice summary, dunning timeline
- AR Ledger
- Scoring config editor with weight-sum validation
- Ladder and template editors

### AI Assistant *(M9)*
- RAG-grounded chat — LLM answers questions from live DB data only
- Tool-calling pattern — no hallucinated scores or invoice numbers
- Runs locally via llama.cpp (GGUF models, no API cost)

---

## Screenshots

| Dashboard | Customer Detail |
|---|---|
| <img src="https://github.com/user-attachments/assets/83e634be-1b59-4b06-8841-42d3ac0630d0" width="480"/> | <img src="https://github.com/user-attachments/assets/d8edd3c0-2d9e-4f1d-8336-e22f4a558d6c" width="480"/> |

| Scoring Config | Template Designer |
|---|---|
| <img src="https://github.com/user-attachments/assets/08918402-04c4-43d4-bf69-842b2ff413b2" width="480"/> | <img src="https://github.com/user-attachments/assets/3452200d-331e-4f24-ad3d-c1f6802b659c" width="480"/> |

| Ladder Editor | AR Ledger |
|---|---|
| <img src="https://github.com/user-attachments/assets/4c010d4a-a7ff-41c8-9151-217f53fbfcb5" width="480"/> | <img src="https://github.com/user-attachments/assets/c7f56fe3-3067-4ba5-b79a-4663388b02da" width="480"/> |
---

## Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.11 |
| Node.js | LTS (18+) |
| PostgreSQL | 16 |
| Memurai | Developer Edition |
| Windows | 11 |

---

## Installation

### 1. Clone

```bash
git clone https://github.com/your-org/credit-tool.git
cd credit-tool
```

### 2. One-click setup (Windows PowerShell — run as Administrator)

```powershell
.\setup.ps1
```

This script:
- Creates Python virtual environment and installs all packages
- Runs `npm install` for the frontend
- Initialises Alembic and runs all migrations
- Seeds the database with realistic fake data via `seed_data.py`
- Verifies PostgreSQL and Memurai service status

### 3. Manual setup (if preferred)

```bash
# Backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Migrations
alembic upgrade head

# Seed data
python seed_data.py

# Frontend
cd frontend
npm install
```

---

## Configuration

Copy `.env.example` to `.env` and update:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/credittool
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=your-jwt-secret
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# Optional
ENABLE_ERP_INTEGRATION=false
```

---

## Running the App

### Daily start (PowerShell)

```powershell
.\start.ps1
```

### Manual start

```bash
# Backend API — http://localhost:8000
uvicorn backend.main:app --reload

# Celery worker
celery -A backend.scheduler worker --loglevel=info

# Celery Beat (scheduler)
celery -A backend.scheduler beat --loglevel=info

# Frontend — http://localhost:5173
cd frontend && npm run dev
```

### Stop all processes

```powershell
.\stop.ps1
```

Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## API Reference

Full interactive docs at `/docs` (Swagger UI) and `/redoc`.

### Key Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/customers` | List customers |
| `POST` | `/api/v1/customers` | Create customer |
| `GET` | `/api/v1/customers/{id}` | Customer detail |
| `GET` | `/api/v1/invoices` | List invoices |
| `POST` | `/api/v1/invoices` | Create invoice |
| `POST` | `/api/v1/payments` | Record payment |
| `POST` | `/api/v1/scores/trigger/{customer_id}` | Manual score trigger |
| `GET` | `/api/v1/scores/{customer_id}/history` | Score history |
| `POST` | `/api/v1/risk/evaluate` | Sales order credit check |
| `POST` | `/api/v1/chat` | AI assistant |

### Sales Order Credit Check

```http
POST /api/v1/risk/evaluate
{
  "customer_id": "CUST-001",
  "proposed_invoice_value": 85000,
  "currency": "EUR"
}
```

```json
{
  "customer_id": "CUST-001",
  "current_risk_band": "amber",
  "final_score": 672,
  "credit_limit": 200000,
  "open_ar_balance": 165000,
  "utilization_post_order": 0.925,
  "recommended_action": "hold",
  "auto_approve": false,
  "requires_manual_review": true
}
```

---

## Scoring Model

Scores run **0–1000** (higher = better). Three output layers:

| Layer | Description |
|---|---|
| `behavioral_score` | Internal transactional data only |
| `composite_score` | D&B blended at 15% |
| `business_adjusted_score` | Composite × BCW multiplier, capped at 1000 |

### 8 Dimensions

| # | Code | Name | Default Weight |
|---|---|---|---|
| D1 | DSI | Delinquency Severity Index | 0.25 |
| D2 | TAR | Terms Adherence Ratio | 0.20 |
| D3 | ISPV | Invoice Size vs Payment Velocity | 0.10 |
| D4 | DNB | D&B Anchor Score | blended 15% |
| D5 | CUR | Credit Utilization Ratio | 0.20 |
| D6 | CRH | Collection Effort Intensity | 0.15 |
| D7 | 3PC | Third-Party Collections Flag | 0.10 |
| D8 | BCW | Business Classification Weight | multiplier |

### Risk Bands

| Band | Floor | Meaning |
|---|---|---|
| GREEN | 750 | Standard terms, auto-approve |
| AMBER | 500 | Monitor, manual review on large invoices |
| RED | 250 | Restrict credit, dunning active |
| BLACK | 0 | Collections mode, no new credit |

### Score Triggers

Score recomputed and snapshot inserted on: `invoice_event` · `payment_event` · `collections_event` · `credit_limit_change` · `dnb_update` · `scheduled_nightly` · `manual`

---

## Dunning Engine

### Default Step Ladder (Net30)

| Step | Offset | Type | Penalty Weight |
|---|---|---|---|
| 1 | −5d | pre_due | 0.05 |
| 2 | −3d | pre_due | 0.05 |
| 3 | −1d | pre_due | 0.05 |
| 4 | +1d | post_due | 0.15 |
| 5 | +7d | post_due | 0.20 |
| 6 | +15d | post_due | 0.25 |
| 7 | +30d | escalation | 0.15 |
| 8 | +45d | collections | 0.10 |

Penalty weights per config must sum to `1.0` (validated on save).

### Template Tokens

`{{customer_name}}` · `{{invoice_number}}` · `{{amount_due}}` · `{{due_date}}` · `{{days_overdue}}` · `{{outstanding_balance}}` · `{{payment_terms}}` · `{{company_name}}` · `{{invoice_table}}`

`{{invoice_table}}` renders a full HTML table of all outstanding invoices.

---

## Project Structure

```
credit_tool/
├── backend/
│   ├── main.py                  # FastAPI app entry
│   ├── database.py              # SQLAlchemy engine + session
│   ├── models/                  # Table definitions
│   ├── routers/                 # One file per API domain
│   ├── scoring/                 # Dimension calculators
│   ├── dunning/                 # Dunning logic + template renderer
│   └── scheduler.py             # Celery beat jobs
├── frontend/
│   └── src/
│       ├── pages/               # Dashboard, Customers, Config, Templates, ...
│       ├── components/          # Charts, tables, score cards, AI chat
│       └── api/                 # Axios wrappers
├── alembic/                     # DB migrations
├── tools/
│   └── mock_erp.py              # Self-contained ERP mock server (port 8001)
├── setup.ps1
├── start.ps1
├── stop.ps1
└── seed_data.py
```

---

## Build Milestones

| # | Milestone | Status |
|---|---|---|
| M1 | Foundation — DB, seed data, FastAPI boot | ✅ |
| M2 | Scoring engine core — all 8 dimensions | ✅ |
| M3 | Core API routers — customers, invoices, payments, scores | ✅ |
| M4 | Dunning engine — ladder, templates, Celery | 🔄 |
| M5 | Prediction layer — p(on-time), cash flow forecast | ⬜ |
| M6 | Dashboard frontend | ✅ |
| M7 | Config UI — weights, ladder, templates, bands | ✅ |
| M8 | ERP integration (feature-flagged) | ⬜ |
| M9 | AI chat assistant (llama.cpp local LLM) | ⬜ |
| M10 | Internal ML predictor (XGBoost) | ⬜ |
| M11 | Customer similarity via pgvector | ⬜ |
| M12 | Fine-tuned domain model | ⬜ |

---

## ERP Integration

Feature-flagged via `ENABLE_ERP_INTEGRATION=true`. When enabled:

| ERP | Inbound | Outbound | Middleware |
|---|---|---|---|
| SAP S/4HANA | OData v4 + webhooks | BAdI → REST | None |
| SAP ECC | File drop / SAP PI | ABAP → REST | SAP PI/PO |
| Oracle Fusion | REST batch pull | OIC adapter | None |
| Oracle EBS | OIC / file drop | OIC adapter | Oracle Integration Cloud |
| MS Dynamics 365 | OData + Power Automate | Power Automate flow | None |
| Custom ERP | CSV/SFTP or REST pull | REST API call | None |

A self-contained mock ERP server (`tools/mock_erp.py`) runs on port 8001 and simulates SAP OData, Oracle REST, and Dynamics webhook feeds — no ERP licence required for development.

---

## Roadmap

- [x] Live email sending (SMTP / SendGrid)
- [ ] D&B live API integration
- [ ] Multi-user role management
- [ ] Report export (PDF / Excel)
- [ ] Horizontal scaling (Redis Cluster, DB partitioning, materialized views)
- [ ] Fine-tuned local LLM on accumulated credit decisions

---

## License

MIT — see [LICENSE](LICENSE)
