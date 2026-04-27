<#
.SYNOPSIS
    Stop the Ghidra server container. Project state on the named volume is preserved.
#>
# Native commands write progress to stderr; do NOT use ErrorActionPreference=Stop.
$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot

& docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker daemon is not reachable — nothing to stop." -ForegroundColor Yellow
    exit 0
}

docker compose -f "$Root\docker\docker-compose.yml" down
if ($LASTEXITCODE -ne 0) {
    Write-Host "docker compose down failed." -ForegroundColor Red
    exit 1
}
Write-Host "Stopped. Project data is preserved in the 'ghidra-data' Docker volume." -ForegroundColor Green
