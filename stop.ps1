# Credit Tool - Stop all services

Write-Host ""
Write-Host "  Stopping Credit Tool services..." -ForegroundColor Yellow

# Kill by process name + command line match
$targets = @("uvicorn", "celery")
foreach ($t in $targets) {
    $procs = Get-WmiObject Win32_Process | Where-Object { $_.Name -eq "python.exe" -and $_.CommandLine -match $t }
    foreach ($p in $procs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "  Stopped $t (PID $($p.ProcessId))" -ForegroundColor Gray
    }
}

# Kill vite dev server
$vite = Get-WmiObject Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "vite" }
foreach ($p in $vite) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "  Stopped vite (PID $($p.ProcessId))" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host ""