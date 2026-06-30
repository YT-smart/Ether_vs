$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$ModelFile = Join-Path $Root "models\huggingface\Qwen3-ASR-0.6B\model.safetensors"
$Setup = Join-Path $Root "scripts\setup-cn.ps1"
$ParseVideoPySrc = Join-Path $Root "tools\parse-video-py\src"

function Need-Setup {
  if (!(Test-Path $Python)) {
    Write-Host "Python venv is missing."
    return $true
  }

  if (!(Test-Path $ModelFile)) {
    Write-Host "Qwen3-ASR model is missing."
    return $true
  }

  $check = @'
import sys, types
stub = types.ModuleType("nagisa")
stub.tagging = lambda *args, **kwargs: None
sys.modules.setdefault("nagisa", stub)
import torch
import transformers
import accelerate
import librosa
import soundfile
from qwen_asr import Qwen3ASRModel
sys.path.insert(0, r"__PARSE_VIDEO_PY_SRC__")
import aiohttp
import fake_useragent
import httpx
import jmespath
import lxml
import parsel
import yaml
from parse_video_py import parse_video_share_url
print("ok")
'@
  $check = $check.Replace("__PARSE_VIDEO_PY_SRC__", $ParseVideoPySrc.Replace("\", "\\"))

  try {
    $output = $check | & $Python -
    return (!([string]::Join("`n", $output).Trim().EndsWith("ok")))
  } catch {
    Write-Host "Python dependencies are incomplete."
    return $true
  }
}

Set-Location $Root

if (Need-Setup) {
  Write-Host "Runtime is incomplete. Starting setup..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $Setup
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} else {
  Write-Host "Runtime is ready."
}
