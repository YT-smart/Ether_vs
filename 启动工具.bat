@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 20+，或运行安装依赖.bat 查看提示。
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo 未找到 Python 运行环境，请先双击 安装依赖.bat。
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3666/"
node server.mjs
pause
