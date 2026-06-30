@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Video Copy Client

if not exist "%~dp0work" mkdir "%~dp0work"
set "LOG=%~dp0work\start.log"
echo [%date% %time%] starting > "%LOG%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ was not found. Please install Node.js first.
  echo Node.js was not found. >> "%LOG%"
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-env.ps1"
if errorlevel 1 (
  echo Runtime setup failed. Please check the messages above.
  echo Runtime setup failed. >> "%LOG%"
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3666/"
node server.mjs
echo Node server exited with code %errorlevel%. >> "%LOG%"
pause
