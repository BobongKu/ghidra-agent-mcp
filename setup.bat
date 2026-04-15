@echo off
setlocal enabledelayedexpansion

echo.
echo === ghidra-agent-mcp setup ===
echo.

:: Check Docker
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not installed. Install Docker Desktop: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

:: Check Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed. Install Python 3.10+: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Check Docker is running
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

cd /d "%~dp0"

:: Step 1: Install Python dependencies
echo [1/3] Installing Python dependencies...
python -m pip install -r requirements.txt --quiet

:: Step 2: Build and start
echo [2/3] Building Docker image (first run takes a few minutes)...
docker compose -f docker/docker-compose.yml up -d --build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker build failed.
    pause
    exit /b 1
)

:: Step 3: Wait for server
echo [3/3] Waiting for server...
set MAX_WAIT=120
set ELAPSED=0

:wait_loop
if %ELAPSED% geq %MAX_WAIT% goto timeout

curl -s http://127.0.0.1:18089/health | findstr /c:"ok" >nul 2>nul
if %ERRORLEVEL% equ 0 goto ready

timeout /t 3 /nobreak >nul
set /a ELAPSED+=3
echo   ... waiting (%ELAPSED%s)
goto wait_loop

:ready
echo.
echo === Setup complete! ===
echo.
echo Server:  http://127.0.0.1:18089
echo.
echo Usage:
echo   1. Put binaries in docker\binaries\
echo   2. Connect via MCP:
echo      Claude Code: .mcp.json already configured (restart Claude Code)
echo      Claude Desktop: copy .mcp.json config to claude_desktop_config.json
echo      Other: python bridge_lite.py
echo.
pause
exit /b 0

:timeout
echo [ERROR] Server did not start within %MAX_WAIT%s
echo Check logs: docker compose -f docker/docker-compose.yml logs -f
pause
exit /b 1
