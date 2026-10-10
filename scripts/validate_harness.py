#!/usr/bin/env python3
"""
scripts/validate_harness.py
เครื่องมือตรวจสอบความถูกต้องของ harness/feature_list.json สำหรับ wang-raan-service
- ตรวจสอบ Schema และคีย์จำเป็น
- ตรวจสอบ ID ซ้ำ
- ตรวจสอบการอ้างอิง dependencies ที่ไม่มีอยู่จริง
- ตรวจสอบ Circular Dependencies
- ตรวจสอบความถูกต้องของ status และ role
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEATURE_LIST_PATH = ROOT / "harness" / "feature_list.json"

VALID_STATUSES = {"not-started", "in-progress", "done", "blocked"}
VALID_ROLES = {"core", "db", "auth", "api", "qa", "devops"}
REQUIRED_KEYS = {"id", "name", "status", "dependencies", "role", "summary"}


def validate():
    if not FEATURE_LIST_PATH.exists():
        print(f"ERROR: ไม่พบไฟล์ {FEATURE_LIST_PATH}")
        sys.exit(1)

    try:
        data = json.loads(FEATURE_LIST_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR: JSON ผิดรูปแบบใน {FEATURE_LIST_PATH}: {e}")
        sys.exit(1)

    if not isinstance(data, dict) or "features" not in data:
        print("ERROR: โครงสร้างหลักต้องมีคีย์ 'features' แบบ list")
        sys.exit(1)

    features = data["features"]
    print(f"=== กำลังตรวจสอบ Harness Tasks ({len(features)} รายการ) ===")

    seen_ids = set()
    errors = []
    status_counts = {s: 0 for s in VALID_STATUSES}
    feature_map = {}

    for idx, f in enumerate(features):
        fid = f.get("id")
        if not fid:
            errors.append(f"รายการที่ {idx}: ขาดฟิลด์ 'id'")
            continue

        if fid in seen_ids:
            errors.append(f"Task '{fid}': ID ซ้ำ")
        seen_ids.add(fid)
        feature_map[fid] = f

        missing_keys = REQUIRED_KEYS - set(f.keys())
        if missing_keys:
            errors.append(f"Task '{fid}': ขาดฟิลด์สำคัญ {missing_keys}")

        status = f.get("status")
        if status not in VALID_STATUSES:
            errors.append(f"Task '{fid}': status '{status}' ไม่อยู่ใน {VALID_STATUSES}")
        else:
            status_counts[status] += 1

        role = f.get("role")
        if role not in VALID_ROLES:
            errors.append(f"Task '{fid}': role '{role}' ไม่อยู่ใน {VALID_ROLES}")

        deps = f.get("dependencies")
        if not isinstance(deps, list):
            errors.append(f"Task '{fid}': dependencies ต้องเป็น list")

    # ตรวจสอบว่า dependency ทุกตัวมีอยู่จริง
    for fid, f in feature_map.items():
        for dep in f.get("dependencies", []):
            if dep not in feature_map:
                errors.append(f"Task '{fid}': อ้าง dependency '{dep}' ที่ไม่มีอยู่ใน feature_list")

    # ตรวจสอบ Circular Dependencies
    visited = {}  # 0 = unvisited, 1 = visiting, 2 = visited

    def has_cycle(node, path):
        visited[node] = 1
        path.append(node)
        for dep in feature_map.get(node, {}).get("dependencies", []):
            if dep not in feature_map:
                continue
            if visited.get(dep) == 1:
                return True, path + [dep]
            if visited.get(dep) == 0:
                cycle_found, c_path = has_cycle(dep, path)
                if cycle_found:
                    return True, c_path
        path.pop()
        visited[node] = 2
        return False, []

    for fid in feature_map:
        visited[fid] = 0

    for fid in feature_map:
        if visited[fid] == 0:
            cycle, c_path = has_cycle(fid, [])
            if cycle:
                errors.append(f"ตรวจพบ Circular Dependency: {' -> '.join(c_path)}")
                break

    if errors:
        print("\n❌ พบข้อผิดพลาด:")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)

    print("✅ ตรวจสอบโครงสร้าง Harness สำเร็จ:")
    print(f"  • ทั้งหมด: {len(features)} งาน")
    print(f"  • Done: {status_counts['done']}")
    print(f"  • In Progress: {status_counts['in-progress']}")
    print(f"  • Not Started: {status_counts['not-started']}")
    print(f"  • Blocked: {status_counts['blocked']}")


if __name__ == "__main__":
    validate()
