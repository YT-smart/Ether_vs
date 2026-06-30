param(
  [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Venv = Join-Path $Root ".venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$PipIndex = "https://pypi.tuna.tsinghua.edu.cn/simple"
$TorchCu126 = "https://mirrors.aliyun.com/pytorch-wheels/cu126/torch-2.11.0%2Bcu126-cp311-cp311-win_amd64.whl"
$LocalTorchWheel = Join-Path $Root "work\wheels\torch-2.11.0+cu126-cp311-cp311-win_amd64.whl"
$ModelDir = Join-Path $Root "models\huggingface\Qwen3-ASR-0.6B"

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Warn($Message) {
  Write-Host "!! $Message" -ForegroundColor Yellow
}

function Find-Python311 {
  $candidates = @(
    @("py", "-3.11"),
    @("python", "")
  )
  foreach ($candidate in $candidates) {
    try {
      $cmd = $candidate[0]
      $arg = $candidate[1]
      if ($arg) {
        $version = & $cmd $arg -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
      } else {
        $version = & $cmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
      }
      if ($version.Trim() -eq "3.11") {
        return $candidate
      }
    } catch {
    }
  }
  throw "Python 3.11 was not found. Please install Python 3.11 first."
}

Set-Location $Root

Step "Checking base tools"
try {
  $nodeVersion = node -v
  Write-Host "Node: $nodeVersion"
} catch {
  throw "Node.js was not found. Please install Node.js 20+ first."
}

try {
  $ffmpegVersion = ffmpeg -version | Select-Object -First 1
  Write-Host $ffmpegVersion
} catch {
  Warn "ffmpeg was not found. Transcription needs ffmpeg. Please install it before using the app."
}

if (!(Test-Path $Python)) {
  Step "Creating Python virtual environment"
  $py = Find-Python311
  if ($py[1]) {
    & $py[0] $py[1] -m venv $Venv
  } else {
    & $py[0] -m venv $Venv
  }
}

Step "Upgrading pip"
& $Python -m pip install -U pip -i $PipIndex --timeout 120 --retries 5

Step "Installing Python packages from Tsinghua mirror"
& $Python -m pip install `
  -i $PipIndex `
  --timeout 300 --retries 5 `
  "transformers==4.57.6" `
  "accelerate==1.12.0" `
  "huggingface_hub" `
  "safetensors" `
  "tokenizers" `
  "librosa" `
  "soundfile" `
  "numpy" `
  "scipy"

& $Python -m pip install `
  -i $PipIndex `
  --timeout 300 --retries 5 `
  --no-deps `
  "qwen-asr==0.0.6"

if ($CpuOnly) {
  Step "Installing CPU torch"
  & $Python -m pip install -U torch -i $PipIndex --timeout 300 --retries 5
} else {
  Step "Installing CUDA torch"
  if (Test-Path $LocalTorchWheel) {
    & $Python -m pip install --ignore-installed --no-deps --no-cache-dir $LocalTorchWheel
  } else {
    try {
      & $Python -m pip install --ignore-installed --no-deps --no-cache-dir --timeout 600 --retries 10 $TorchCu126
    } catch {
      Warn "CUDA torch installation failed. Falling back to CPU torch."
      & $Python -m pip install -U torch -i $PipIndex --timeout 300 --retries 5
    }
  }
}

Step "Downloading Qwen3-ASR 0.6B model"
if (!(Test-Path (Join-Path $ModelDir "model.safetensors"))) {
  New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null
  try {
    & $Python -m pip install -i $PipIndex --timeout 300 --retries 5 "modelscope"
    & $Python -m modelscope download --model Qwen/Qwen3-ASR-0.6B --local_dir $ModelDir
  } catch {
    Warn "ModelScope download failed. Trying HuggingFace mirror."
    $env:HF_ENDPOINT = "https://hf-mirror.com"
    & $Python -m huggingface_hub.commands.huggingface_cli download Qwen/Qwen3-ASR-0.6B --local-dir $ModelDir
  }
} else {
  Write-Host "Model already exists: $ModelDir"
}

Step "Verifying runtime"
& $Python -c "import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU mode')"

Write-Host ""
Write-Host "Setup complete. Run start.bat or the Chinese launch bat to open the app." -ForegroundColor Green
