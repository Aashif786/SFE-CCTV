#!/usr/bin/env python3
"""
migrate_doors.py — One-shot migration from old door config format to new format.

Old format (per entry):
  { "check_in_cameras": [...], "check_out_cameras": [...] }

New format (per Door ACS unit):
  { "cameras": [...], "door_group": "" }

Migration rules:
  - cameras = check_in_cameras if non-empty, else check_out_cameras if non-empty, else []
  - door_group = "" (user fills in via UI)
  - All other fields preserved unchanged.

Run from the repo root:
  python backend/migrate_doors.py
"""

import json
import os
import shutil
from datetime import datetime

DOORS_FILE = os.path.join(os.path.dirname(__file__), "doors.json")


def migrate(entry: dict) -> dict:
    out = dict(entry)

    # Already migrated
    if "cameras" in out and out["cameras"] is not None:
        out.pop("check_in_cameras", None)
        out.pop("check_out_cameras", None)
        out.setdefault("door_group", "")
        return out

    old_in  = out.pop("check_in_cameras",  None) or []
    old_out = out.pop("check_out_cameras", None) or []

    # Prefer check_in; fall back to check_out
    out["cameras"] = old_in if old_in else old_out
    out.setdefault("door_group", "")
    return out


def main():
    if not os.path.exists(DOORS_FILE):
        print(f"[migrate_doors] No doors.json found at {DOORS_FILE}. Nothing to do.")
        return

    with open(DOORS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        print("[migrate_doors] doors.json is not a list. Aborting.")
        return

    # Check if migration is needed
    needs_migration = any(
        "check_in_cameras" in d or "check_out_cameras" in d or "cameras" not in d
        for d in data
    )

    if not needs_migration:
        print("[migrate_doors] doors.json is already in the new format. No changes made.")
        return

    # Backup original
    backup_path = DOORS_FILE + f".bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(DOORS_FILE, backup_path)
    print(f"[migrate_doors] Backup saved: {backup_path}")

    migrated = [migrate(d) for d in data]

    with open(DOORS_FILE, "w", encoding="utf-8") as f:
        json.dump(migrated, f, indent=2)

    print(f"[migrate_doors] Migrated {len(migrated)} door ACS entries:")
    for d in migrated:
        print(f"  - {d['name']} ({d['ip']}) → cameras={d['cameras']}, door_group='{d.get('door_group', '')}'")

    print("[migrate_doors] Done.")


if __name__ == "__main__":
    main()
