import os
import json
from pydantic import BaseModel, Field

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
