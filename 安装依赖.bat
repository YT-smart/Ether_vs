@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在安装运行环境，请保持网络连接...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-cn.ps1"
pause
