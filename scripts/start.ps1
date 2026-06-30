$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$WorkDir = Join-Path $Root "work"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $WorkDir "start-$Stamp.log"
$LatestLogPath = Join-Path $WorkDir "start.log"
$Url = "http://127.0.0.1:3666/"

function T($Value) {
  return [System.Text.RegularExpressions.Regex]::Unescape($Value)
}

function Step($Message) {
  Write-Host ""
  Write-Host $Message
}

function Fail($Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host "$(T '\u8be6\u7ec6\u65e5\u5fd7\uff1a')$LogPath"
  exit 1
}

Set-Location $Root
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] starting" | Set-Content -Encoding UTF8 $LogPath
try {
  "Latest log: $LogPath" | Set-Content -Encoding UTF8 $LatestLogPath
} catch {
  # Another launcher may be writing the old shared log; the per-run log above is enough.
}

Step (T "\u6b63\u5728\u68c0\u67e5\u8fd0\u884c\u73af\u5883...")
Step (T "\u7b2c\u4e00\u6b21\u542f\u52a8\u4f1a\u81ea\u52a8\u4e0b\u8f7d\u4f9d\u8d56\u548c\u6a21\u578b\uff0c\u8bf7\u4fdd\u6301\u7f51\u7edc\u8fde\u63a5\u3002")
Write-Host "$(T '\u8be6\u7ec6\u65e5\u5fd7\uff1a')$LogPath"

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
  "Node.js was not found." | Add-Content -Encoding UTF8 $LogPath
  Fail (T "\u672a\u68c0\u6d4b\u5230 Node.js\uff0c\u8bf7\u5148\u5b89\u88c5 Node.js 20+\u3002")
}

try {
  $SetupScript = Join-Path $Root "scripts\ensure-env.ps1"
  cmd /d /s /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$SetupScript`" >> `"$LogPath`" 2>&1"
} catch {
  $_ | Out-String | Add-Content -Encoding UTF8 $LogPath
  Fail (T "\u8fd0\u884c\u73af\u5883\u51c6\u5907\u5931\u8d25\uff0c\u8bf7\u67e5\u770b\u65e5\u5fd7\u3002")
}

if ($LASTEXITCODE -ne 0) {
  Fail (T "\u8fd0\u884c\u73af\u5883\u51c6\u5907\u5931\u8d25\uff0c\u8bf7\u67e5\u770b\u65e5\u5fd7\u3002")
}

if ($env:ETHER_DY_CHECK_ONLY -eq "1") {
  Step (T "\u73af\u5883\u68c0\u67e5\u5b8c\u6210\u3002")
  exit 0
}

Step (T "\u542f\u52a8\u4e2d...")
Write-Host (T "\u542f\u52a8\u6210\u529f\u540e\u4f1a\u81ea\u52a8\u6253\u5f00\u7f51\u9875\u754c\u9762\u3002")
Write-Host (T "\u5982\u679c\u6d4f\u89c8\u5668\u6ca1\u6709\u81ea\u52a8\u6253\u5f00\uff0c\u8bf7\u590d\u5236\u8fd9\u4e2a\u5730\u5740\u624b\u52a8\u6253\u5f00\uff1a")
Write-Host $Url

try {
  Start-Process $Url | Out-Null
} catch {
  Write-Host (T "\u6d4f\u89c8\u5668\u81ea\u52a8\u6253\u5f00\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236\u4e0a\u9762\u7684\u5730\u5740\u3002")
}

Step (T "\u670d\u52a1\u8fd0\u884c\u4e2d\uff0c\u8bf7\u4e0d\u8981\u5173\u95ed\u8fd9\u4e2a\u7a97\u53e3\u3002")
try {
  $ServerScript = Join-Path $Root "server.mjs"
  cmd /d /s /c "node `"$ServerScript`" >> `"$LogPath`" 2>&1"
} finally {
  Step (T "\u670d\u52a1\u5df2\u9000\u51fa\u3002")
  Write-Host "$(T '\u8be6\u7ec6\u65e5\u5fd7\uff1a')$LogPath"
}
