<#
.SYNOPSIS
    Stop the Ghidra server container. Project state on the named volume is preserved.
#>
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
docker compose -f "$Root\docker\docker-compose.yml" down
Write-Host "Stopped. Project data is preserved in the 'ghidra-data' Docker volume." -ForegroundColor Green
