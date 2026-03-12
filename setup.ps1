# Credit Tool - Environment Setup Script
# Run ONCE after cloning. Right-click -> Run with PowerShell (as Administrator)
# Works on any Windows 11 machine regardless of install path.

$ErrorActionPreference = "Stop"

# --- Resolve project root from script location ---
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition
$VENV         = "$PROJECT_ROOT\venv"
$BACKEND      = "$PROJECT_ROOT\backend"
$FRONTEND     = "$PROJECT_ROOT\frontend"
$ENV_FILE     = "$BACKEND\.env"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Credit Tool - First-Time Setup" -ForegroundColor Cyan
Write-Host "  Root: $PROJECT_ROOT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------------------
# HELPER
# -------------------------------------------------------
function Abort($msg) {
    Write-Host ""
    Write-Host "  ERROR: $msg" -ForegroundColor Red
    Write-Host "  Setup aborted. Fix the issue above and re-run." -ForegroundColor Red
    Write-Host ""
    exit 1
}

function OK($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function SKIP($msg) { Write-Host "    --  $msg (already exists, skipped)" -ForegroundColor Gray }
function WARN($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }

# -------------------------------------------------------
# PRE-FLIGHT CHECKS
# -------------------------------------------------------
Write-Host "[0/8] Pre-flight checks..." -ForegroundColor Yellow

# Python 3.11
$PYTHON = $null
foreach ($candidate in @("python3.11","python3","python")) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "3\.11") { $PYTHON = $candidate; break }
    } catch {}
}
if (-not $PYTHON) { Abort "Python 3.11 not found. Download from https://www.python.org/downloads/release/python-3119/" }
OK "Python 3.11 found ($PYTHON)"

# Node.js
try { $nodeVer = & node --version 2>&1 } catch { Abort "Node.js not found. Download LTS from https://nodejs.org/en/download" }
OK "Node.js found ($nodeVer)"

# npm
try { $npmVer = & npm --version 2>&1 } catch { Abort "npm not found. Reinstall Node.js." }
OK "npm found ($npmVer)"

# PostgreSQL psql
$PG_BIN = $null
foreach ($candidate in @(
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin",
    "C:\Program Files\PostgreSQL\17\bin"
)) {
    if (Test-Path "$candidate\psql.exe") { $PG_BIN = $candidate; break }
}
if (-not $PG_BIN) { Abort "PostgreSQL not found. Download from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads" }
$env:PATH += ";$PG_BIN"
OK "PostgreSQL found ($PG_BIN)"

# Memurai / Redis
$memuraiSvc = Get-Service -Name "Memurai" -ErrorAction SilentlyContinue
$redisSvc   = Get-Service -Name "Redis"   -ErrorAction SilentlyContinue
if (-not $memuraiSvc -and -not $redisSvc) {
    Abort "Memurai (Redis) service not found. Download from https://www.memurai.com/get-memurai and install as a Windows service."
}
$svcName = if ($memuraiSvc) { "Memurai" } else { "Redis" }
$svc = Get-Service -Name $svcName
if ($svc.Status -ne "Running") {
    WARN "$svcName service exists but is not running. Attempting to start..."
    Start-Service -Name $svcName
    Start-Sleep -Seconds 2
    $svc.Refresh()
    if ($svc.Status -ne "Running") { Abort "$svcName failed to start. Start it manually and re-run." }
}
OK "$svcName running"

# PostgreSQL service
$pgSvc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pgSvc) { Abort "PostgreSQL Windows service not found. Reinstall PostgreSQL." }
if ($pgSvc.Status -ne "Running") {
    WARN "PostgreSQL service not running. Attempting to start..."
    Start-Service -Name $pgSvc.Name
    Start-Sleep -Seconds 3
    $pgSvc.Refresh()
    if ($pgSvc.Status -ne "Running") { Abort "PostgreSQL failed to start." }
}
OK "PostgreSQL service running"

# -------------------------------------------------------
# STEP 1 — Folder structure
# -------------------------------------------------------
Write-Host ""
Write-Host "[1/8] Creating folder structure..." -ForegroundColor Yellow

$folders = @(
    "$BACKEND\models",
    "$BACKEND\routers",
    "$BACKEND\scoring",
    "$BACKEND\dunning",
    "$BACKEND\scheduler",
    "$BACKEND\chat",
    "$BACKEND\erp",
    "$PROJECT_ROOT\alembic\versions",
    "$PROJECT_ROOT\models",
    "$PROJECT_ROOT\tools",
    "$PROJECT_ROOT\logs"
)
foreach ($f in $folders) {
    if (-not (Test-Path $f)) { New-Item -ItemType Directory -Path $f -Force | Out-Null }
}
OK "Folders ready"

# -------------------------------------------------------
# STEP 2 — Python venv
# -------------------------------------------------------
Write-Host ""
Write-Host "[2/8] Python virtual environment..." -ForegroundColor Yellow

if (Test-Path $VENV) {
    SKIP "venv at $VENV"
} else {
    & $PYTHON -m venv $VENV
    OK "venv created at $VENV"
}

$PIP         = "$VENV\Scripts\pip.exe"
$PYTHON_VENV = "$VENV\Scripts\python.exe"
$ALEMBIC     = "$VENV\Scripts\alembic.exe"

# -------------------------------------------------------
# STEP 3 — pip + packages
# -------------------------------------------------------
Write-Host ""
Write-Host "[3/8] Installing Python packages..." -ForegroundColor Yellow

& $PIP install --upgrade pip --quiet

$REQ = "$PROJECT_ROOT\requirements.txt"
if (-not (Test-Path $REQ)) { Abort "requirements.txt not found at $REQ" }
& $PIP install -r $REQ
OK "Python packages installed"

# -------------------------------------------------------
# STEP 4 — Frontend
# -------------------------------------------------------
Write-Host ""
Write-Host "[4/8] Frontend (React + Vite)..." -ForegroundColor Yellow

if (-not (Test-Path $FRONTEND)) { Abort "frontend/ folder not found. Ensure you cloned the full repo." }

Set-Location $FRONTEND
if (-not (Test-Path "$FRONTEND\node_modules")) {
    npm install --silent
    OK "node_modules installed"
} else {
    SKIP "node_modules"
}

# -------------------------------------------------------
# STEP 5 — PostgreSQL DB + user
# -------------------------------------------------------
Write-Host ""
Write-Host "[5/8] PostgreSQL database setup..." -ForegroundColor Yellow

Write-Host ""
Write-Host "    Enter your PostgreSQL superuser (postgres) password:" -ForegroundColor White
$PG_PASSWORD_PLAIN = Read-Host "    Password"
$env:PGPASSWORD = $PG_PASSWORD_PLAIN

# Test connection
$testConn = & "$PG_BIN\psql.exe" -U postgres -tAc "SELECT 1" 2>&1
if ($testConn -notmatch "1") { Abort "Cannot connect to PostgreSQL as postgres. Check your password." }
OK "Connected to PostgreSQL"

# Create DB
$dbExists = & "$PG_BIN\psql.exe" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='credit_tool'" 2>$null
if ($dbExists -eq "1") {
    SKIP "Database credit_tool"
} else {
    & "$PG_BIN\psql.exe" -U postgres -c "CREATE DATABASE credit_tool;" 2>&1 | Out-Null
    OK "Database credit_tool created"
}

# Create role
$roleExists = & "$PG_BIN\psql.exe" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='credit_user'" 2>$null
if ($roleExists -eq "1") {
    SKIP "Role credit_user"
} else {
    & "$PG_BIN\psql.exe" -U postgres -c "CREATE USER credit_user WITH PASSWORD 'credit_pass_local';" 2>&1 | Out-Null
    & "$PG_BIN\psql.exe" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE credit_tool TO credit_user;" 2>&1 | Out-Null
    & "$PG_BIN\psql.exe" -U postgres -d credit_tool -c "GRANT ALL ON SCHEMA public TO credit_user;" 2>&1 | Out-Null
    OK "Role credit_user created"
}

$env:PGPASSWORD = ""

# -------------------------------------------------------
# STEP 6 — .env file
# -------------------------------------------------------
Write-Host ""
Write-Host "[6/8] Environment config (.env)..." -ForegroundColor Yellow

if (Test-Path $ENV_FILE) {
    SKIP ".env at $ENV_FILE"
} else {
    $envContent = @"
# -------------------------------------------------------
# Credit Tool — Environment Config
# Generated by setup.ps1 — edit as needed
# -------------------------------------------------------

# Database
DATABASE_URL=postgresql://credit_user:credit_pass_local@localhost:5432/credit_tool

# Redis / Memurai
REDIS_URL=redis://localhost:6379/0

# Auth
SECRET_KEY=change_this_to_a_long_random_string_in_production
ACCESS_TOKEN_EXPIRE_MINUTES=480

# App
APP_ENV=development
APP_PORT=8000
LOG_LEVEL=info

# llama.cpp (M9 — AI assistant, leave defaults until model is downloaded)
LLAMA_HOST=localhost
LLAMA_PORT=8002
LLAMA_MODEL_PATH=./models/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf
LLAMA_GPU_LAYERS=-1
LLAMA_CONTEXT_LENGTH=4096

# Feature flags
ENABLE_ERP_INTEGRATION=false
"@
    $envContent | Out-File -FilePath $ENV_FILE -Encoding UTF8
    OK ".env created at $ENV_FILE"
}

# -------------------------------------------------------
# STEP 7 — Alembic migrations
# -------------------------------------------------------
Write-Host ""
Write-Host "[7/8] Alembic migrations..." -ForegroundColor Yellow

Set-Location $PROJECT_ROOT

$alembicIni = "$PROJECT_ROOT\alembic.ini"
if (-not (Test-Path $alembicIni)) { Abort "alembic.ini not found. Ensure full repo is cloned." }

$headResult = & $ALEMBIC current 2>&1
if ($headResult -match "head") {
    SKIP "Migrations already at head"
} else {
    & $ALEMBIC upgrade head
    OK "Migrations applied"
}

# -------------------------------------------------------
# STEP 8 — llama.cpp + model download
# -------------------------------------------------------
Write-Host ""
Write-Host "[8/9] llama.cpp AI server..." -ForegroundColor Yellow

# Read .env to check ENABLE_LLAMA
$envVars = @{}
Get-Content $ENV_FILE | Where-Object { $_ -match "^\s*[^#].*=" } | ForEach-Object {
    $parts = $_ -split "=", 2
    $envVars[$parts[0].Trim()] = $parts[1].Trim()
}

if ($envVars["ENABLE_LLAMA"] -ne "true") {
    SKIP "llama.cpp (ENABLE_LLAMA not true in .env — set it and re-run setup.ps1 to install)"
} else {
    $TOOLS_DIR   = "$PROJECT_ROOT\tools"
    $LLAMA_EXE   = "$TOOLS_DIR\llama-server.exe"
    $MODEL_PATH  = $envVars["LLAMA_MODEL_PATH"]

    # --- Check CUDA GPU ---
    $gpuCheck = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" }
    if (-not $gpuCheck) {
        WARN "No NVIDIA GPU detected. llama.cpp will run on CPU — inference will be slow."
        WARN "If you have a GPU, ensure NVIDIA drivers are installed."
    } else {
        OK "NVIDIA GPU detected: $($gpuCheck.Name)"
    }

    # --- Download llama-server.exe ---
    if (Test-Path $LLAMA_EXE) {
        SKIP "llama-server.exe already in .\tools\"
    } else {
        Write-Host "    Fetching latest llama.cpp release from GitHub..." -ForegroundColor Gray

        $releaseApi = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
        try {
            $release = Invoke-RestMethod -Uri $releaseApi -Headers @{ "User-Agent" = "credit-tool-setup" }
        } catch {
            Abort "Failed to fetch llama.cpp release info from GitHub. Check your internet connection."
        }

        $asset = $release.assets | Where-Object { $_.name -match "win-cuda-cu12" -and $_.name -match "x64" -and $_.name -match "\.zip$" } | Select-Object -First 1

        if (-not $asset) {
            Abort "Could not find win-cuda-cu12 x64 zip in latest llama.cpp release. Check https://github.com/ggml-org/llama.cpp/releases manually."
        }

        $zipName = $asset.name
        $zipUrl  = $asset.browser_download_url
        $zipPath = "$TOOLS_DIR\$zipName"

        Write-Host "    Downloading $zipName (~100MB)..." -ForegroundColor Gray
        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        } catch {
            Abort "Download failed: $zipUrl`n  $_"
        }

        Write-Host "    Extracting llama-server.exe..." -ForegroundColor Gray
        $extractDir = "$TOOLS_DIR\llama_extracted"
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $serverBin = Get-ChildItem -Path $extractDir -Filter "llama-server.exe" -Recurse | Select-Object -First 1
        if (-not $serverBin) {
            Abort "llama-server.exe not found inside zip. Inspect $extractDir manually."
        }

        Copy-Item $serverBin.FullName -Destination $LLAMA_EXE -Force

        # Copy CUDA runtime DLLs sitting alongside the binary — llama-server needs them
        $cudaDlls = Get-ChildItem -Path $serverBin.DirectoryName -Filter "*.dll"
        foreach ($dll in $cudaDlls) {
            Copy-Item $dll.FullName -Destination $TOOLS_DIR -Force
        }

        Remove-Item $extractDir -Recurse -Force
        Remove-Item $zipPath    -Force

        OK "llama-server.exe installed to .\tools\"
    }

    # --- Download model ---
    if (-not $MODEL_PATH) {
        WARN "LLAMA_MODEL_PATH not set in .env — skipping model download."
    } elseif (Test-Path $MODEL_PATH) {
        SKIP "Model already exists at $MODEL_PATH"
    } else {
        Write-Host "    Model not found at $MODEL_PATH" -ForegroundColor Gray
        Write-Host "    Downloading Mistral-7B-Instruct-v0.3-Q4_K_M (~4.4GB)..." -ForegroundColor Gray
        Write-Host "    This will take several minutes depending on your connection." -ForegroundColor Gray

        $modelDir = Split-Path -Parent $MODEL_PATH

        if (-not (Test-Path $modelDir)) {
            New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
        }

        # huggingface_hub is installed via requirements.txt
        $hfCmd = "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='bartowski/Mistral-7B-Instruct-v0.3-GGUF', filename='Mistral-7B-Instruct-v0.3-Q4_K_M.gguf', local_dir=r'$modelDir')"
        & $PYTHON_VENV -c $hfCmd

        if (-not (Test-Path $MODEL_PATH)) {
            Abort "Model download failed. Check your internet connection or download manually:`n  huggingface-cli download bartowski/Mistral-7B-Instruct-v0.3-GGUF --include Mistral-7B-Instruct-v0.3-Q4_K_M.gguf --local-dir $modelDir"
        }

        OK "Model downloaded to $MODEL_PATH"
    }
}

# -------------------------------------------------------
# STEP 9 — Seed data
# -------------------------------------------------------
Write-Host ""
Write-Host "[8/8] Seed data..." -ForegroundColor Yellow

$SEED = "$PROJECT_ROOT\seed_data.py"
if (-not (Test-Path $SEED)) {
    WARN "seed_data.py not found — skipping. Add it to project root to auto-seed."
} else {
    & $PYTHON_VENV $SEED
    OK "Seed data loaded"
}

# -------------------------------------------------------
# DONE
# -------------------------------------------------------
Set-Location $PROJECT_ROOT

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Project  : $PROJECT_ROOT" -ForegroundColor White
Write-Host "  Database : credit_tool @ localhost:5432" -ForegroundColor White
Write-Host "  DB user  : credit_user / credit_pass_local" -ForegroundColor White
Write-Host "  venv     : $VENV" -ForegroundColor White
Write-Host "  .env     : $ENV_FILE" -ForegroundColor White
Write-Host ""
Write-Host "  Run next:" -ForegroundColor Yellow
Write-Host "  .\start.ps1" -ForegroundColor White
Write-Host ""