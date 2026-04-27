<#
.SYNOPSIS
    Configure the MCP bridge for an LLM client (Claude Desktop / Claude Code / Cursor / etc.).

.DESCRIPTION
    - Installs Python dependencies (requirements.txt) into the current Python.
    - Generates an absolute-path bridge_lite.py invocation snippet.
    - Optionally writes a .mcp.json next to the bundle for clients that read project-local config.

.USAGE
    .\setup-mcp.ps1                    # install deps + print snippet
    .\setup-mcp.ps1 -WriteLocal        # also write .mcp.json next to this script
#>
param(
    [switch]$WriteLocal
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

# 1. Python check
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "Python not found in PATH. Install Python 3.10+ first: https://python.org/downloads" -ForegroundColor Red
    exit 1
}

# 2. Install deps
Write-Host "[1/2] Installing Python dependencies..." -ForegroundColor Yellow
python -m pip install -q -r "$Root\requirements.txt"
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed." -ForegroundColor Red; exit 1 }

# 3. Build snippet
$bridgePath = (Resolve-Path "$Root\bridge_lite.py").Path -replace '\\', '\\'
$pythonExe  = $python.Source -replace '\\', '\\'

$snippet = @"
{
  "mcpServers": {
    "ghidra-agent-mcp": {
      "command": "$pythonExe",
      "args": ["$bridgePath"],
      "env": {
        "GHIDRA_AGENT_MCP_URL": "http://127.0.0.1:18089"
      }
    }
  }
}
"@

Write-Host "`n[2/2] MCP server config snippet:" -ForegroundColor Green
Write-Host $snippet -ForegroundColor White

if ($WriteLocal) {
    $localPath = "$Root\.mcp.json"
    $snippet | Set-Content $localPath -Encoding UTF8
    Write-Host "`nWrote: $localPath" -ForegroundColor Green
}

Write-Host "`nWhere to put it:" -ForegroundColor Cyan
Write-Host "  Claude Desktop : %APPDATA%\Claude\claude_desktop_config.json"
Write-Host "  Claude Code    : .mcp.json in your project root (or use -WriteLocal)"
Write-Host "  Cursor         : ~/.cursor/mcp.json"
