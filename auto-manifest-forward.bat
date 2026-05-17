@echo off
REM Automated Forward Manifest Scheduler - Windows Task Scheduler
REM This script runs the auto-manifest process for failed forward orders
REM 
REM To schedule daily execution at 9 AM:
REM 1. Open Task Scheduler
REM 2. Create Basic Task
REM 3. Set trigger: Daily at 9:00 AM
REM 4. Set action: Start a program
REM 5. Program: C:\path\to\auto-manifest-forward.bat
REM 6. Start in: C:\path\to\exchange-return-tracking-main

cd /d "%~dp0"
echo [%date% %time%] Running automated forward manifest...
node auto-manifest-forward.js >> logs\auto-manifest-%date:~-4,4%%date:~-7,2%%date:~-10,2%.log 2>&1
echo [%date% %time%] Manifest complete.
echo.
