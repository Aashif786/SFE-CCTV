#!/usr/bin/env python3
"""
manage_configs.py — CLI tool to Export & Import CALVISION System Configurations.

Usage:
  # Export all configs to a single JSON bundle:
  python backend/manage_configs.py export all [calvision_bundle.json]

  # Export individual configs:
  python backend/manage_configs.py export cameras [cameras.json]
  python backend/manage_configs.py export doors [doors.json]
  python backend/manage_configs.py export spatial [spatial_handoff.json]
  python backend/manage_configs.py export zones [camera_zones.json]
  python backend/manage_configs.py export settings [settings.json]
  python backend/manage_configs.py export employees [employees.json]

  # Import / Restore configs:
  python backend/manage_configs.py import all calvision_bundle.json
  python backend/manage_configs.py import cameras cameras.json
  python backend/manage_configs.py import doors doors.json
  python backend/manage_configs.py import spatial spatial_handoff.json
  python backend/manage_configs.py import zones camera_zones.json
  python backend/manage_configs.py import settings settings.json
  python backend/manage_configs.py import employees employees.json
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone

# Ensure project backend root is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

from src.db.database import SessionLocal
from src.api.system import (
    _get_cameras_export,
    _get_doors_export,
    _get_spatial_export,
    _get_camera_zones_export,
    _get_settings_export,
    _get_employees_export,
    _import_cameras,
    _import_doors,
    _import_spatial,
    _import_camera_zones,
    _import_settings,
    _import_employees,
)


def export_config(config_type: str, output_path: str = None):
    ct = config_type.lower().strip()
    with SessionLocal() as db:
        if ct == "all" or ct == "bundle":
            data = {
                "version": "2.0",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "settings": _get_settings_export(),
                "cameras": _get_cameras_export(db),
                "doors": _get_doors_export(),
                "spatial_handoff": _get_spatial_export(),
                "camera_zones": _get_camera_zones_export(db),
                "employees": _get_employees_export(db),
            }
            default_name = f"calvision_config_bundle_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        elif ct == "cameras":
            data = _get_cameras_export(db)
            default_name = "cameras.json"
        elif ct in ("doors", "acs"):
            data = _get_doors_export()
            default_name = "doors.json"
        elif ct in ("spatial", "spatial_handoff", "portals"):
            data = _get_spatial_export()
            default_name = "spatial_handoff.json"
        elif ct in ("zones", "camera_zones"):
            data = _get_camera_zones_export(db)
            default_name = "camera_zones.json"
        elif ct in ("settings", "config"):
            data = _get_settings_export()
            default_name = "settings.json"
        elif ct == "employees":
            data = _get_employees_export(db)
            default_name = "employees.json"
        else:
            print(f"❌ Unknown config type '{config_type}'. Supported: all, cameras, doors, spatial, zones, settings, employees")
            sys.exit(1)

    target_file = output_path or default_name
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"✅ Successfully exported '{config_type}' configuration to: {target_file}")


def import_config(config_type: str, input_path: str, mode: str = "merge"):
    if not os.path.exists(input_path):
        print(f"❌ File not found: {input_path}")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except Exception as e:
            print(f"❌ Failed to parse JSON file {input_path}: {e}")
            sys.exit(1)

    ct = config_type.lower().strip()
    with SessionLocal() as db:
        if ct in ("all", "bundle"):
            if not isinstance(data, dict):
                print(f"❌ Full bundle must be a JSON object")
                sys.exit(1)

            print("🔄 Importing master bundle...")
            if "settings" in data:
                _import_settings(data["settings"])
                print("  ✓ Settings restored")
            if "cameras" in data:
                res = _import_cameras(data["cameras"], db, mode=mode)
                print(f"  ✓ Cameras restored: {res.get('total', 0)} cameras ({res.get('created', 0)} created, {res.get('updated', 0)} updated)")
            if "doors" in data:
                res = _import_doors(data["doors"])
                print(f"  ✓ Doors restored: {res.get('doors_count', 0)} door controllers")
            if "spatial_handoff" in data:
                res = _import_spatial(data["spatial_handoff"])
                print(f"  ✓ Spatial layout restored: {res.get('facilities_count', 0)} facilities")
            if "camera_zones" in data:
                res = _import_camera_zones(data["camera_zones"], db, mode=mode)
                print(f"  ✓ Camera zones restored: {res.get('zones_count', 0)} zones")
            if "employees" in data:
                res = _import_employees(data["employees"], db, mode=mode)
                print(f"  ✓ Employees restored: {res.get('employees_count', 0)} employees, {res.get('zone_assignments_count', 0)} zone assignments")
            print("✅ Master configuration bundle successfully imported!")

        elif ct == "cameras":
            res = _import_cameras(data, db, mode=mode)
            print(f"✅ Cameras imported: {res}")
        elif ct in ("doors", "acs"):
            res = _import_doors(data)
            print(f"✅ Doors imported: {res}")
        elif ct in ("spatial", "spatial_handoff", "portals"):
            res = _import_spatial(data)
            print(f"✅ Spatial layout imported: {res}")
        elif ct in ("zones", "camera_zones"):
            res = _import_camera_zones(data, db, mode=mode)
            print(f"✅ Camera zones imported: {res}")
        elif ct in ("settings", "config"):
            res = _import_settings(data)
            print(f"✅ Settings imported: {res}")
        elif ct == "employees":
            res = _import_employees(data, db, mode=mode)
            print(f"✅ Employees imported: {res}")
        else:
            print(f"❌ Unknown config type '{config_type}'. Supported: all, cameras, doors, spatial, zones, settings, employees")
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="CALVISION Config Export & Import CLI")
    subparsers = parser.add_subparsers(dest="action", required=True, help="Action to perform: export or import")

    # Export parser
    export_parser = subparsers.add_parser("export", help="Export configuration to JSON")
    export_parser.add_argument("type", choices=["all", "cameras", "doors", "spatial", "zones", "settings", "employees"], help="Config type to export")
    export_parser.add_argument("output", nargs="?", default=None, help="Output JSON filename (optional)")

    # Import parser
    import_parser = subparsers.add_parser("import", help="Import configuration from JSON")
    import_parser.add_argument("type", choices=["all", "cameras", "doors", "spatial", "zones", "settings", "employees"], help="Config type to import")
    import_parser.add_argument("input", help="Input JSON file path to import")
    import_parser.add_argument("--mode", choices=["merge", "replace"], default="merge", help="Merge with existing or replace (default: merge)")

    args = parser.parse_args()

    if args.action == "export":
        export_config(args.type, args.output)
    elif args.action == "import":
        import_config(args.type, args.input, mode=args.mode)


if __name__ == "__main__":
    main()
