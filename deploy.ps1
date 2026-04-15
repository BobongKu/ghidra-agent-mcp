<#
.SYNOPSIS
    ghidra-agent-mcp 배포 스크립트 — Docker clean build + 컨테이너 시작
.USAGE
    .\deploy.ps1              # full: clean build + start
    .\deploy.ps1 -NoBuild     # skip build, just (re)start container
    .\deploy.ps1 -BuildOnly   # build only, don't start
    .\deploy.ps1 -Clean       # nuke everything (images, volumes, results)
#>
param(
    [switch]$NoBuild,
    [switch]$BuildOnly,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$ComposeFile = "$ProjectRoot\docker\docker-compose.yml"

Write-Host "`n=== ghidra-agent-mcp deploy ===" -ForegroundColor Cyan

# --- Clean mode ---
if ($Clean) {
    Write-Host "[1/3] Stopping containers..." -ForegroundColor Yellow
    docker compose -f $ComposeFile down -v 2>$null
    Write-Host "[2/3] Removing Docker image..." -ForegroundColor Yellow
    docker rmi docker-ghidra-agent-mcp 2>$null
    Write-Host "[3/3] Cleaning results..." -ForegroundColor Yellow
    if (Test-Path "$ProjectRoot\docker\results") {
        Remove-Item -Recurse -Force "$ProjectRoot\docker\results"
    }
    Write-Host "`nClean complete." -ForegroundColor Green
    exit 0
}

# --- Stop existing ---
Write-Host "[1] Stopping existing container..." -ForegroundColor Yellow
docker compose -f $ComposeFile down 2>$null

# --- Build ---
if (-not $NoBuild) {
    Write-Host "[2] Building Docker image (this takes a few minutes on first run)..." -ForegroundColor Yellow
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    docker compose -f $ComposeFile build --no-cache
    if ($LASTEXITCODE -ne 0) {
        Write-Host "BUILD FAILED" -ForegroundColor Red
        exit 1
    }
    $sw.Stop()
    Write-Host "Build completed in $([math]::Round($sw.Elapsed.TotalSeconds))s" -ForegroundColor Green
}

if ($BuildOnly) {
    Write-Host "`nBuild only mode — not starting container." -ForegroundColor Cyan
    exit 0
}

# --- Start ---
Write-Host "[3] Starting container..." -ForegroundColor Yellow
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED to start container" -ForegroundColor Red
    exit 1
}

# --- Wait for health ---
Write-Host "[4] Waiting for server to be ready..." -ForegroundColor Yellow
$maxWait = 120
$elapsed = 0
while ($elapsed -lt $maxWait) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:18089/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.status -eq "ok") {
            Write-Host "Server is UP (took ${elapsed}s)" -ForegroundColor Green
            Write-Host "  Programs loaded: $($resp.data.programs_loaded)"
            Write-Host "  Binaries available: $($resp.data.available_binaries.Count)"
            Write-Host "  Endpoint: http://127.0.0.1:18089" -ForegroundColor Cyan
            Write-Host "`nReady! Start the MCP bridge:" -ForegroundColor Green
            Write-Host "  python bridge_lite.py" -ForegroundColor White
            exit 0
        }
    } catch {}
    Start-Sleep -Seconds 3
    $elapsed += 3
    Write-Host "  ... waiting (${elapsed}s)" -ForegroundColor DarkGray
}

Write-Host "Server did not respond within ${maxWait}s" -ForegroundColor Red
Write-Host "Check logs: docker compose -f $ComposeFile logs -f" -ForegroundColor Yellow
exit 1
