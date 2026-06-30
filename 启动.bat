@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 视频文案工具

if not exist "%~dp0work" mkdir "%~dp0work"
set "LOG=%~dp0work\start.log"
echo [%date% %time%] starting > "%LOG%"

echo 正在检查运行环境...
echo 第一次启动会自动下载依赖和模型，可能需要几分钟，请耐心等待。
echo 详细安装日志会写入：work\start.log
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 20+。
  echo Node.js was not found. >> "%LOG%"
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-env.ps1" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo 运行环境准备失败，请查看日志：work\start.log
  pause
  exit /b 1
)

echo 启动成功，正在打开网页界面...
echo 如果浏览器没有自动打开，请复制这个地址手动打开：
echo http://127.0.0.1:3666/
echo.

start "" "http://127.0.0.1:3666/"
echo 服务运行中，请不要关闭这个窗口。
echo.

node server.mjs >> "%LOG%" 2>&1
echo 服务已退出，详情请查看日志：work\start.log
pause
