import os
import json
import re
from pydantic import BaseModel, Field
from typing import List, Dict, Any

def _load_env_file(filepath: str) -> Dict[str, str]:
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"[Config] Failed to read .env file: {e}")
        return {}

    env_dict = {}
    
    # Parse standard variables line-by-line first
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            parts = line.split("=", 1)
            key = parts[0].strip()
            val = parts[1].strip()
            if (val.startswith("'") and val.endswith("'")) or (val.startswith('"') and val.endswith('"')):
                val = val[1:-1].strip()
            env_dict[key] = val

    # Specially parse HIKVISION_DOORS JSON array across newlines, ignoring quote mismatches
    doors_match = re.search(r'HIKVISION_DOORS\s*=\s*\'?\"?(\[.*?\])\'?\"?', content, re.DOTALL)
    if doors_match:
        env_dict["HIKVISION_DOORS"] = doors_match.group(1).strip()

    return env_dict

class EnvSettings:
    def __init__(self):
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        env_vars = _load_env_file(env_path)

        self.hikvision_username = env_vars.get("HIKVISION_USERNAME") or os.environ.get("HIKVISION_USERNAME") or "admin"
        self.hikvision_password = env_vars.get("HIKVISION_PASSWORD") or os.environ.get("HIKVISION_PASSWORD") or ""

        doors_raw = env_vars.get("HIKVISION_DOORS") or os.environ.get("HIKVISION_DOORS") or ""
        self.hikvision_doors = []

        if doors_raw:
            doors_raw = doors_raw.strip()
            # Clean trailing commas from JSON arrays/objects
            cleaned = re.sub(r',\s*([\]}])', r'\1', doors_raw)
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, list):
                    self.hikvision_doors = parsed
            except Exception as e:
                print(f"[Config] Error parsing HIKVISION_DOORS env JSON: {e}")

env_settings = EnvSettings()

class DetectionConfig:
    idle_threshold_seconds: float = 10.0
    movement_sensitivity: float = 0.05      # "has movement" threshold
    confidence_threshold: float = 0.50      # min avg landmark visibility → unknown
    # Identity correlation
    correlation_window_seconds: float = 5.0 # max time gap for identity ↔ track match
    identity_provider: str = "REST_SIMULATOR"

config = DetectionConfig()
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "settings.json")

# Load persistent settings if they exist
if os.path.exists(SETTINGS_FILE):
    try:
        with open(SETTINGS_FILE, "r") as f:
            data = json.load(f)
            if "idle_threshold_seconds" in data: config.idle_threshold_seconds = data["idle_threshold_seconds"]
            if "movement_sensitivity" in data: config.movement_sensitivity = data["movement_sensitivity"]
            if "confidence_threshold" in data: config.confidence_threshold = data["confidence_threshold"]
            print(f"Loaded persistent settings from {SETTINGS_FILE}")
    except Exception as e:
        print(f"Error loading settings: {e}")

class SettingsPayload(BaseModel):
    idle_threshold_seconds: float
    movement_sensitivity: float
    confidence_threshold: float = Field(default=0.50)
