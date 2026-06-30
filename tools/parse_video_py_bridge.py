import asyncio
import dataclasses
import json
import sys
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parent
PARSE_VIDEO_SRC = TOOLS_DIR / "parse-video-py" / "src"
sys.path.insert(0, str(PARSE_VIDEO_SRC))

from parse_video_py import parse_video_share_url  # noqa: E402
from parse_video_py.utils import extract_url  # noqa: E402


async def parse(url: str) -> dict:
    extracted = extract_url(url)
    if not extracted:
        raise ValueError("未检测到有效的视频链接")
    info = await parse_video_share_url(extracted)
    return dataclasses.asdict(info)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing url"}, ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        data = asyncio.run(parse(sys.argv[1]))
        print(json.dumps(data, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
