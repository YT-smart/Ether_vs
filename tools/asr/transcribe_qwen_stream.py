#!/usr/bin/env python3
"""Stream Qwen3-ASR transcription as JSON lines, chunk by chunk.

Qwen3-ASR is not available through the generic transformers ASR pipeline yet.
Use the official qwen-asr wrapper, which registers the qwen3_asr architecture
before loading local model files.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


MODEL_IDS = {
    "qwen3-asr-0.6b": "Qwen/Qwen3-ASR-0.6B",
    "qwen3-asr-1.7b": "Qwen/Qwen3-ASR-1.7B",
}


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def run_ffmpeg(args: list[str]) -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is not installed or not on PATH.")
    result = subprocess.run(
        ["ffmpeg", *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or "ffmpeg failed.")


def split_audio(media: Path, chunk_dir: Path, chunk_seconds: int) -> list[Path]:
    pattern = chunk_dir / "chunk_%04d.wav"
    run_ffmpeg([
        "-y",
        "-i",
        str(media),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "segment",
        "-segment_time",
        str(chunk_seconds),
        "-reset_timestamps",
        "1",
        "-c:a",
        "pcm_s16le",
        str(pattern),
    ])
    return sorted(chunk_dir.glob("chunk_*.wav"))


def install_optional_alignment_stubs() -> None:
    """Avoid requiring forced-alignment-only packages for plain transcription."""
    import types

    if "nagisa" not in sys.modules:
        module = types.ModuleType("nagisa")

        def unavailable(*_args, **_kwargs):
            raise RuntimeError("nagisa is only needed when forced alignment is enabled.")

        module.tagging = unavailable
        sys.modules["nagisa"] = module


def find_local_model(model_id: str) -> str:
    cache_root = Path(os.environ.get("HF_HOME", "")).expanduser()
    local_model = None
    if cache_root:
        direct_dir = cache_root / model_id.split("/")[-1]
        if (direct_dir / "config.json").exists():
            local_model = str(direct_dir)

        safe_repo = f"models--{model_id.replace('/', '--')}"
        snapshots = cache_root / safe_repo / "snapshots"
        candidates = sorted(snapshots.glob("*")) if snapshots.exists() else []
        if not local_model and candidates:
            local_model = str(candidates[-1])

    if not local_model:
        raise SystemExit(
            f"{model_id} is not cached locally. Click 下载模型 for this model first, "
            "then run extraction again."
        )
    if not list(Path(local_model).glob("*.safetensors")):
        raise SystemExit(
            f"{model_id} is only partially cached. Missing model.safetensors. "
            "Click 下载模型 and wait until it finishes before extracting copy."
        )
    return local_model


def normalize_language(language: str) -> str | None:
    value = (language or "").strip().lower()
    if value in {"", "auto", "none"}:
        return None
    if value in {"zh", "zh-cn", "chinese", "中文", "汉语"}:
        return "Chinese"
    return language[:1].upper() + language[1:].lower()


def load_qwen_model(model_id: str, device: str):
    try:
        subprocess.run(
            [sys.executable, "-c", "import sys, types; sys.modules.setdefault('nagisa', types.ModuleType('nagisa')); from qwen_asr import Qwen3ASRModel; print('ok')"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
            check=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise SystemExit(
            "qwen-asr import timed out after 120 seconds. Try restarting the app, then run: "
            "python -m pip install qwen-asr transformers==4.57.6 accelerate==1.12.0"
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "qwen-asr is not usable yet. Install with: "
            "python -m pip install qwen-asr transformers==4.57.6 accelerate==1.12.0 librosa soundfile\n"
            + (exc.stderr or "")
        ) from exc

    try:
        import torch  # type: ignore
        install_optional_alignment_stubs()
        from qwen_asr import Qwen3ASRModel  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "Qwen3-ASR requires qwen-asr, transformers and torch. Install with: "
            "python -m pip install qwen-asr transformers==4.57.6 accelerate==1.12.0 librosa soundfile"
        ) from exc

    if device == "cuda":
        if not torch.cuda.is_available():
            raise SystemExit("CUDA was selected, but torch.cuda.is_available() is false.")
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        device_map = "cuda:0"
    elif device == "cpu":
        dtype = torch.float32
        device_map = "cpu"
    else:
        if torch.cuda.is_available():
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            device_map = "cuda:0"
        else:
            dtype = torch.float32
            device_map = "cpu"

    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    local_model = find_local_model(model_id)
    return Qwen3ASRModel.from_pretrained(
        local_model,
        dtype=dtype,
        device_map=device_map,
        local_files_only=True,
        max_inference_batch_size=1,
        max_new_tokens=96,
    )


def extract_text(result) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        for key in ("text", "transcription", "sentence"):
            if result.get(key):
                return str(result[key]).strip()
    return str(result).strip()


def join_transcript_parts(parts: list[str]) -> str:
    merged = ""
    for part in (part.strip() for part in parts if part and part.strip()):
        if not merged:
            merged = part
            continue
        if merged[-1:].isascii() and merged[-1:].isalnum() and part[:1].isascii() and part[:1].isalnum():
            merged += " " + part
        else:
            merged += part
    return merged.strip()


def transcribe_chunk(asr, chunk: Path, language: str) -> str:
    results = asr.transcribe(audio=str(chunk), language=normalize_language(language))
    if not results:
        return ""
    return extract_text(getattr(results[0], "text", results[0]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("media")
    parser.add_argument("--model", required=True, choices=sorted(MODEL_IDS))
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--language", default="zh")
    parser.add_argument("--chunk-seconds", type=int, default=20)
    parser.add_argument("--output-json")
    parser.add_argument("--output-text")
    args = parser.parse_args()

    media = Path(args.media)
    if not media.exists():
        raise SystemExit(f"Media file not found: {media}")

    model_id = MODEL_IDS[args.model]
    emit({"type": "status", "message": f"加载 {model_id}"})
    asr = load_qwen_model(model_id, args.device)

    segments: list[dict] = []
    text_lines: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        chunk_dir = Path(tmp)
        emit({"type": "status", "message": "切分音频"})
        chunks = split_audio(media, chunk_dir, args.chunk_seconds)
        total = len(chunks)
        for index, chunk in enumerate(chunks, start=1):
            emit({"type": "status", "message": f"转写 {index}/{total}"})
            text = transcribe_chunk(asr, chunk, args.language)
            if text:
                start = round((index - 1) * args.chunk_seconds, 2)
                end = round(index * args.chunk_seconds, 2)
                segment = {"type": "segment", "index": index, "start": start, "end": end, "text": text}
                segments.append({k: v for k, v in segment.items() if k != "type"})
                text_lines.append(text)
                emit(segment)

    if args.output_json:
        Path(args.output_json).write_text(
            json.dumps({"segments": segments, "text": join_transcript_parts(text_lines)}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if args.output_text:
        text = join_transcript_parts(text_lines)
        Path(args.output_text).write_text(text + ("\n" if text else ""), encoding="utf-8")

    emit({"type": "complete", "segments": len(segments)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
