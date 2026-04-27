@echo off
REM Wrapper that bypasses PowerShell execution policy so users can just double-click.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
