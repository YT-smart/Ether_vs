@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ was not found. Please install Node.js first.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-env.ps1"
if errorlevel 1 (
  echo Runtime setup failed. Please check the messages above.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3666/"
node server.mjs
pause
