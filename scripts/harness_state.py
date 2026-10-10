"""
scripts/harness_state.py — ตัวโหลด state ของ harness สำหรับโครงการ วางร้าน (Wang-Raan) Backend Service

- harness/feature_list.json — feature ทั้งหมด โดยตัวที่เสร็จสิ้นอาจเก็บแบบย่อ
- harness/feature_list.archive.json — full record ของ feature ที่ archived
- harness/progress.md — บันทึกความคืบหน้าของเดือนปัจจุบัน
- harness/archive/progress-YYYY-MM.md — บันทึกความคืบหน้าเดือนก่อนหน้า
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FEATURE_LIST = ROOT / "harness" / "feature_list.json"
FEATURE_ARCHIVE = ROOT / "harness" / "feature_list.archive.json"
PROGRESS_MD = ROOT / "harness" / "progress.md"
PROGRESS_ARCHIVE_DIR = ROOT / "harness" / "archive"

__all__ = ["load_features", "read_progress_text", "ROOT", "FEATURE_LIST", "FEATURE_ARCHIVE"]


def _read_json(path: pathlib.Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"WARNING: {path.name} parse error: {exc}", file=sys.stderr)
        return {}


def load_features() -> list[dict]:
    """คืน feature ทุกตัวพร้อม field ครบ (merge archive กลับเข้ากับ record ย่อ)"""
    features = _read_json(FEATURE_LIST).get("features", [])
    archived = {f.get("id"): f for f in _read_json(FEATURE_ARCHIVE).get("features", [])}
    if not archived:
        return features
    merged = []
    for f in features:
        full = archived.get(f.get("id"))
        merged.append({**full, **f} if full else f)
    return merged


def read_progress_text(include_archive: bool = True) -> str:
    """คืนเนื้อหา progress.md — ต่อ archive ท้ายไฟล์ให้ถ้าต้องการค้นย้อนหลัง"""
    text = PROGRESS_MD.read_text(encoding="utf-8") if PROGRESS_MD.exists() else ""
    if not include_archive or not PROGRESS_ARCHIVE_DIR.exists():
        return text
    for p in sorted(PROGRESS_ARCHIVE_DIR.glob("progress-*.md"), reverse=True):
        text += "\n" + p.read_text(encoding="utf-8")
    return text
