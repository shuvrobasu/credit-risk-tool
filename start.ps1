# Credit Tool - Start all services
# Run from project root. Does NOT require Administrator.

$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition
$VENV         = "$PROJECT_ROOT\venv"
$BACKEND      = "$PROJECT_ROOT\backend"
$FRONTEND     = "$PROJECT_ROOT\frontend"

function Abort($msg) {
    Write-Host "  ERROR: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$VENV\Scripts\activate.ps1")) { Abort "venv not found. Run setup.ps1 first." }
if (-not (Test-Path "$BACKEND\.env"))              { Abort ".env not found. Run setup.ps1 first." }

# --- Read .env into hashtable ---
$envVars = @{}
Get-Content "$BACKEND\.env" | Where-Object { $_ -match "^\s*[^#].*=" } | ForEach-Object {
    $parts = $_ -split "=", 2
    $envVars[$parts[0].Trim()] = $parts[1].Trim()
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Credit Tool - Starting Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# FastAPI
Write-Host "  Starting FastAPI..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$BACKEND'; & '$VENV\Scripts\activate.ps1'; uvicorn main:app --reload --port 8000"
) -WindowStyle Normal

Start-Sleep -Seconds 2

# Celery worker
Write-Host "  Starting Celery worker..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$BACKEND'; & '$VENV\Scripts\activate.ps1'; celery -A scheduler worker --loglevel=info --pool=solo"
) -WindowStyle Normal

Start-Sleep -Seconds 1

# Celery beat
Write-Host "  Starting Celery beat..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$BACKEND'; & '$VENV\Scripts\activate.ps1'; celery -A scheduler beat --loglevel=info"
) -WindowStyle Normal

Start-Sleep -Seconds 1

# React frontend
Write-Host "  Starting React frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$FRONTEND'; npm run dev"
) -WindowStyle Normal

# llama.cpp AI server (optional)
$llamaEnabled   = $envVars["ENABLE_LLAMA"]
$llamaModelPath = $envVars["LLAMA_MODEL_PATH"]
$llamaHost      = if ($envVars["LLAMA_HOST"])           { $envVars["LLAMA_HOST"] }           else { "localhost" }
$llamaPort      = if ($envVars["LLAMA_PORT"])           { $envVars["LLAMA_PORT"] }           else { "8002" }
$llamaGpuLayers = if ($envVars["LLAMA_GPU_LAYERS"])     { $envVars["LLAMA_GPU_LAYERS"] }     else { "-1" }
$llamaCtx       = if ($envVars["LLAMA_CONTEXT_LENGTH"]) { $envVars["LLAMA_CONTEXT_LENGTH"] } else { "4096" }

if ($llamaEnabled -eq "true") {
    if (-not $llamaModelPath) {
        Write-Host "  SKIP llama.cpp — LLAMA_MODEL_PATH not set in .env" -ForegroundColor Gray
    } elseif (-not (Test-Path $llamaModelPath)) {
        Write-Host "  SKIP llama.cpp — model file not found at: $llamaModelPath" -ForegroundColor Gray
        Write-Host "         Download: huggingface-cli download bartowski/Mistral-7B-Instruct-v0.3-GGUF --include Mistral-7B-Instruct-v0.3-Q4_K_M.gguf --local-dir .\models" -ForegroundColor Gray
    } else {
        # Find llama-server.exe in project tools folder or PATH
        $llamaExe = "$PROJECT_ROOT\tools\llama-server.exe"
        if (-not (Test-Path $llamaExe)) {
            $llamaExe = (Get-Command "llama-server" -ErrorAction SilentlyContinue)?.Source
        }
        if (-not $llamaExe) {
            Write-Host "  SKIP llama.cpp — llama-server.exe not found." -ForegroundColor Gray
            Write-Host "         Download from https://github.com/ggml-org/llama.cpp/releases and place in .\tools\" -ForegroundColor Gray
        } else {
            Write-Host "  Starting llama.cpp AI server..." -ForegroundColor Yellow
            $llamaCmd = "& '$llamaExe' --model '$llamaModelPath' --host $llamaHost --port $llamaPort --n-gpu-layers $llamaGpuLayers --ctx-size $llamaCtx"
            Start-Process powershell -ArgumentList @(
                "-NoExit",
                "-Command",
                $llamaCmd
            ) -WindowStyle Normal
            Write-Host "    AI server starting at http://${llamaHost}:${llamaPort}" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  SKIP llama.cpp — set ENABLE_LLAMA=true in .env to enable" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  All services started." -ForegroundColor Green
Write-Host ""
Write-Host "  API      : http://localhost:8000" -ForegroundColor White
Write-Host "  Swagger  : http://localhost:8000/docs" -ForegroundColor White
Write-Host "  Frontend : http://localhost:5173" -ForegroundColor White
if ($llamaEnabled -eq "true" -and (Test-Path $llamaModelPath)) {
Write-Host "  AI       : http://${llamaHost}:${llamaPort}" -ForegroundColor White
}
Write-Host ""
Write-Host "  To stop: run .\stop.ps1" -ForegroundColor Gray
Write-Host ""