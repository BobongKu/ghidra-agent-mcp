<#
.SYNOPSIS
    ghidra-agent-mcp 사전 준비 스크립트 — Docker 자동 기동 + 컨테이너 보장 + 모든 바이너리 import/분석까지 ready

.DESCRIPTION
    LLM이 MCP의 upload/import를 직접 호출하면 Ghidra auto-analysis가 5분 한계를 넘겨
    bridge 측에서 timeout 으로 끊기고, 모델은 MCP가 죽었다고 판단해 Python으로 fallback 함.
    그래서 이 스크립트가 사전에:
      1. Docker Desktop 이 죽어 있으면 띄우고
      2. 컨테이너가 안 떠 있으면 deploy.ps1 위임
      3. /health 가 ok 될 때까지 대기
      4. 지정한 폴더(또는 docker\binaries\)의 모든 파일을 /import 로 등록
         (각 호출이 분석 완료까지 동기 블록 — 끝나면 곧 ready 상태가 됨)
      5. /health 로 최종 program 목록 출력
    이후 bridge_lite.py 만 띄우면 LLM은 이미 ready 인 program 들에 대해
    decompile/deps_* 같은 분석 툴만 호출하면 됨.

.USAGE
    .\prepare.ps1                                # docker\binaries\ 안의 모든 파일을 import
    .\prepare.ps1 -BinariesDir D:\samples        # 외부 폴더에서 docker\binaries\ 로 복사 후 import
    .\prepare.ps1 -ImportTimeoutSec 1800         # 파일당 분석 타임아웃 (기본 1800초)
    .\prepare.ps1 -SkipDeploy                    # deploy.ps1 호출 스킵 (컨테이너 이미 떠 있을 때)
    .\prepare.ps1 -StartBridge                   # 마지막에 python bridge_lite.py 실행
#>
param(
    [string]$BinariesDir = "",
    [int]$ImportTimeoutSec = 1800,
    [int]$HealthWaitSec = 120,
    [int]$DockerWaitSec = 120,
    [switch]$SkipDeploy,
    [switch]$StartBridge
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$ComposeFile = "$ProjectRoot\docker\docker-compose.yml"
$LocalBinDir = "$ProjectRoot\docker\binaries"
$ServerUrl   = "http://127.0.0.1:18089"

Write-Host "`n=== ghidra-agent-mcp prepare ===" -ForegroundColor Cyan

# ---------- [1] Docker Desktop 보장 ----------
function Ensure-DockerRunning {
    Write-Host "[1] Docker engine check..." -ForegroundColor Yellow
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "    Docker is running." -ForegroundColor Green; return }

    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
    )
    $exe = $null
    foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { $exe = $p; break } }

    if (-not $exe) {
        Write-Host "    Docker Desktop not found. Start Docker manually and re-run." -ForegroundColor Red
        exit 1
    }

    Write-Host "    Starting Docker Desktop ($exe)..." -ForegroundColor Yellow
    Start-Process -FilePath $exe | Out-Null

    $deadline = (Get-Date).AddSeconds($DockerWaitSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { Write-Host "    Docker is up." -ForegroundColor Green; return }
        Write-Host "    ... waiting for Docker engine" -ForegroundColor DarkGray
    }
    Write-Host "    Docker did not become ready within ${DockerWaitSec}s." -ForegroundColor Red
    exit 1
}
Ensure-DockerRunning

# ---------- [2] 컨테이너 보장 ----------
Write-Host "[2] Container check..." -ForegroundColor Yellow
$running = (docker compose -f $ComposeFile ps --status running --quiet) 2>$null
if (-not $running) {
    if ($SkipDeploy) {
        Write-Host "    Container not running and -SkipDeploy set. Aborting." -ForegroundColor Red
        exit 1
    }
    Write-Host "    Container not running. Delegating to deploy.ps1 -NoBuild ..." -ForegroundColor Yellow
    & "$ProjectRoot\deploy.ps1" -NoBuild
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    deploy.ps1 failed. Aborting." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "    Container already running." -ForegroundColor Green
}

# ---------- [3] /health ready 대기 ----------
Write-Host "[3] Waiting for /health ..." -ForegroundColor Yellow
$elapsed = 0
$ready = $false
while ($elapsed -lt $HealthWaitSec) {
    try {
        $resp = Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.status -eq "ok") { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 3
    $elapsed += 3
}
if (-not $ready) {
    Write-Host "    Server did not respond within ${HealthWaitSec}s." -ForegroundColor Red
    Write-Host "    Logs: docker compose -f $ComposeFile logs -f" -ForegroundColor Yellow
    exit 1
}
Write-Host "    Server UP. programs_loaded=$($resp.data.programs_loaded)" -ForegroundColor Green

# ---------- [4] 외부 폴더 복사 (옵션) ----------
if ($BinariesDir) {
    if (-not (Test-Path $BinariesDir)) {
        Write-Host "    -BinariesDir not found: $BinariesDir" -ForegroundColor Red
        exit 1
    }
    Write-Host "[4] Copying files from $BinariesDir -> $LocalBinDir ..." -ForegroundColor Yellow
    if (-not (Test-Path $LocalBinDir)) { New-Item -ItemType Directory -Path $LocalBinDir | Out-Null }
    Get-ChildItem -Path $BinariesDir -File | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $LocalBinDir -Force
        Write-Host "    + $($_.Name)" -ForegroundColor DarkGray
    }
}

# ---------- [5] 일괄 import + 분석 대기 ----------
Write-Host "[5] Importing binaries (sync; analysis blocks per file)..." -ForegroundColor Yellow

if (-not (Test-Path $LocalBinDir)) {
    Write-Host "    No local binaries dir: $LocalBinDir" -ForegroundColor Red
    exit 1
}

$files = Get-ChildItem -Path $LocalBinDir -File | Where-Object { $_.Name -notlike ".*" }
if (-not $files) {
    Write-Host "    No files in $LocalBinDir. Drop binaries there or pass -BinariesDir." -ForegroundColor Yellow
    Write-Host "    (Skipping import.)" -ForegroundColor DarkGray
} else {
    # 이미 로드된 program 은 건너뜀
    $already = @{}
    if ($resp.data.programs) { foreach ($p in $resp.data.programs) { $already[$p] = $true } }

    $okCount = 0
    $skipCount = 0
    $failCount = 0
    foreach ($f in $files) {
        if ($already.ContainsKey($f.Name)) {
            Write-Host "    [skip] $($f.Name) (already loaded)" -ForegroundColor DarkGray
            $skipCount++
            continue
        }
        $payload = @{ path = "/binaries/$($f.Name)" } | ConvertTo-Json -Compress
        $sw = [Diagnostics.Stopwatch]::StartNew()
        Write-Host "    [load] $($f.Name) ($([math]::Round($f.Length/1MB,1)) MB) ..." -ForegroundColor Yellow -NoNewline
        try {
            $r = Invoke-RestMethod -Uri "$ServerUrl/import" -Method Post -Body $payload `
                                   -ContentType "application/json" -TimeoutSec $ImportTimeoutSec
            $sw.Stop()
            if ($r.status -eq "ok") {
                Write-Host " ok ($([math]::Round($sw.Elapsed.TotalSeconds))s, fns=$($r.data.functions))" -ForegroundColor Green
                $okCount++
            } else {
                Write-Host " FAIL: $($r.message)" -ForegroundColor Red
                $failCount++
            }
        } catch {
            $sw.Stop()
            Write-Host " ERR ($([math]::Round($sw.Elapsed.TotalSeconds))s): $($_.Exception.Message)" -ForegroundColor Red
            $failCount++
        }
    }
    Write-Host "    Summary: ok=$okCount skip=$skipCount fail=$failCount" -ForegroundColor Cyan
}

# ---------- [6] 최종 상태 ----------
Write-Host "[6] Final /health" -ForegroundColor Yellow
try {
    $final = Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 5
    Write-Host "    programs_loaded = $($final.data.programs_loaded)" -ForegroundColor Green
    foreach ($p in $final.data.programs) { Write-Host "      - $p" -ForegroundColor White }
} catch {
    Write-Host "    /health failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nReady. LLM-side MCP is now analysis-only — do not call upload/import from agents." -ForegroundColor Green

if ($StartBridge) {
    Write-Host "`nStarting bridge_lite.py ..." -ForegroundColor Cyan
    Push-Location $ProjectRoot
    try { python bridge_lite.py } finally { Pop-Location }
} else {
    Write-Host "Next: python bridge_lite.py" -ForegroundColor White
}
