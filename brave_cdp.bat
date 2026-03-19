@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

title Brave IPC CDP Launcher
echo ============================================
echo   Brave IPC CDP Launcher (Admin)
echo   Puerto: Dinamico via IPC
echo ============================================
echo.

python "%~dp0brave_ipc.py" %*

pause
