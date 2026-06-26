@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Python runtime was not found. Please run install.bat first.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3666/"
node server.mjs
pause
