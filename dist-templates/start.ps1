<#
.SYNOPSIS
    One-click launcher: start Ghidra server container + open the GUI.
#>
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "`n=== ghidra-agent-mcp ===" -ForegroundColor Cyan

# 1. Docker check (native exit code, not exception)
$null = docker version --format '{{.Server.Version}}' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Docker daemon is not reachable." -ForegroundColor Red
    Write-Host "  - Open Docker Desktop and wait until the whale icon turns green." -ForegroundColor Yellow
    Write-Host "  - If you see 'Switch to Linux containers...' in the tray menu, click it." -ForegroundColor Yellow
    Write-Host "  - Verify with:  docker info --format '{{.OperatingSystem}}'" -ForegroundColor DarkGray
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# 2. Start container (build on first run)
$Compose = "$Root\docker\docker-compose.yml"
Write-Host "[1/3] Starting Ghidra server container..." -ForegroundColor Yellow
Write-Host "      (first run downloads Ghidra ~400 MB and may take a few minutes)" -ForegroundColor DarkGray
docker compose -f $Compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start container." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# 3. Wait for health
Write-Host "[2/3] Waiting for server to be ready..." -ForegroundColor Yellow
$maxWait = 180
$elapsed = 0
$ready = $false
while ($elapsed -lt $maxWait) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:18089/health" -TimeoutSec 2 -ErrorAction Stop
        if ($resp.status -eq "ok") { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
    $elapsed += 2
}
if (-not $ready) {
    Write-Host "Server did not become healthy within ${maxWait}s." -ForegroundColor Yellow
    Write-Host "Check: docker compose -f docker\docker-compose.yml logs -f" -ForegroundColor DarkGray
}

# 4. Launch GUI
Write-Host "[3/3] Launching GUI..." -ForegroundColor Yellow
Start-Process "$Root\ghidra-agent-gui.exe"
Write-Host "Done. Server: http://127.0.0.1:18089" -ForegroundColor Green
