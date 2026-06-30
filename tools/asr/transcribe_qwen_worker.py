#!/usr/bin/env python3
"""Persistent Qwen3-ASR worker.

Reads JSON jobs from stdin and writes JSON events to stdout. The model is loaded
once and reused for later jobs.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from transcribe_qwen_stream import MODEL_IDS, join_transcript_parts, load_qwen_model, split_audio, transcribe_chunk


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def run_job(asr, payload: dict, chunk_seconds: int) -> None:
    job_id = payload["id"]
    media = Path(payload["media"])
    if not media.exists():
        emit({"type": "error", "id": job_id, "message": f"Media file not found: {media}"})
        return

    segments: list[dict] = []
    text_lines: list[str] = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            emit({"type": "progress", "id": job_id, "percent": 8})
            chunks = split_audio(media, Path(tmp), chunk_seconds)
            total = max(len(chunks), 1)
            for index, chunk in enumerate(chunks, start=1):
                text = transcribe_chunk(asr, chunk, payload.get("language", "zh"))
                if text:
                    start = round((index - 1) * chunk_seconds, 2)
                    end = round(index * chunk_seconds, 2)
                    segment = {"index": index, "start": start, "end": end, "text": text}
                    segments.append(segment)
                    text_lines.append(text)
                percent = min(96, 8 + round(index / total * 88))
                emit({"type": "progress", "id": job_id, "percent": percent})

        emit({
            "type": "done",
            "id": job_id,
            "segments": segments,
            "text": join_transcript_parts(text_lines),
        })
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "id": job_id, "message": str(exc)})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="qwen3-asr-0.6b", choices=sorted(MODEL_IDS))
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--chunk-seconds", type=int, default=20)
    args = parser.parse_args()

    asr = load_qwen_model(MODEL_IDS[args.model], args.device)
    emit({"type": "ready"})

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
            if payload.get("type") == "transcribe":
                run_job(asr, payload, args.chunk_seconds)
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "id": payload.get("id") if "payload" in locals() else "", "message": str(exc)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
