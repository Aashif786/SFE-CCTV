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
        self.reload_doors()

    def reload_doors(self):
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        env_vars = _load_env_file(env_path)

        # First load from settings.json if available
        settings_path = os.path.join(os.path.dirname(__file__), "..", "settings.json")
        settings_data = {}
        if os.path.exists(settings_path):
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings_data = json.load(f)
            except Exception as e:
                print(f"[Config] Error reading settings.json for EnvSettings: {e}")

        self.hikvision_username = settings_data.get("hikvision_username") or env_vars.get("HIKVISION_USERNAME") or os.environ.get("HIKVISION_USERNAME") or "admin"
        self.hikvision_password = settings_data.get("hikvision_password") or env_vars.get("HIKVISION_PASSWORD") or os.environ.get("HIKVISION_PASSWORD") or ""

        # Camera streaming configuration
        self.default_rtsp_port = int(settings_data.get("default_rtsp_port") or env_vars.get("DEFAULT_RTSP_PORT") or os.environ.get("DEFAULT_RTSP_PORT", "554"))
        self.stream_reconnect_interval = int(settings_data.get("stream_reconnect_interval") or env_vars.get("STREAM_RECONNECT_INTERVAL") or os.environ.get("STREAM_RECONNECT_INTERVAL", "5"))
        self.stream_timeout = int(settings_data.get("stream_timeout") or env_vars.get("STREAM_TIMEOUT") or os.environ.get("STREAM_TIMEOUT", "30"))
        self.frame_buffer_size = int(settings_data.get("frame_buffer_size") or env_vars.get("FRAME_BUFFER_SIZE") or os.environ.get("FRAME_BUFFER_SIZE", "5"))
        self.max_cameras = int(settings_data.get("max_cameras") or env_vars.get("MAX_CAMERAS") or os.environ.get("MAX_CAMERAS", "50"))
        self.default_stream_transport = settings_data.get("default_stream_transport") or env_vars.get("DEFAULT_STREAM_TRANSPORT") or os.environ.get("DEFAULT_STREAM_TRANSPORT", "tcp")

        # First, try to load from backend/doors.json
        doors_file = os.path.join(os.path.dirname(__file__), "..", "doors.json")
        if os.path.exists(doors_file):
            try:
                with open(doors_file, "r", encoding="utf-8") as f:
                    self.hikvision_doors = json.load(f)
                return
            except Exception as e:
                print(f"[Config] Error reading doors.json: {e}")

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

    # YOLO Pose Estimator
    yolo_model: str = "yolo11m-pose.pt"
    yolo_conf: float = 0.30
    yolo_iou: float = 0.90
    yolo_imgsz: int = 960
    ema_alpha: float = 0.80

    # Tracker parameters
    tracker_track_high_thresh: float = 0.30
    tracker_track_low_thresh: float = 0.1
    tracker_new_track_thresh: float = 0.50
    tracker_track_buffer: int = 120
    tracker_match_thresh: float = 0.8
    tracker_fuse_score: bool = True
    tracker_gmc_method: str = "none"
    tracker_with_reid: bool = True
    tracker_proximity_thresh: float = 0.0
    tracker_appearance_thresh: float = 0.75

    # Classifier parameters
    classifier_velocity_threshold: float = 0.05

config = DetectionConfig()
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "settings.json")

# Load persistent settings if they exist
if os.path.exists(SETTINGS_FILE):
    try:
        with open(SETTINGS_FILE, "r") as f:
            data = json.load(f)
            # Core
            if "idle_threshold_seconds" in data: config.idle_threshold_seconds = float(data["idle_threshold_seconds"])
            if "movement_sensitivity" in data: config.movement_sensitivity = float(data["movement_sensitivity"])
            if "confidence_threshold" in data: config.confidence_threshold = float(data["confidence_threshold"])
            if "correlation_window_seconds" in data: config.correlation_window_seconds = float(data["correlation_window_seconds"])
            if "identity_provider" in data: config.identity_provider = str(data["identity_provider"])

            # YOLO Pose Estimator
            if "yolo_model" in data: config.yolo_model = str(data["yolo_model"])
            if "yolo_conf" in data: config.yolo_conf = float(data["yolo_conf"])
            if "yolo_iou" in data: config.yolo_iou = float(data["yolo_iou"])
            if "yolo_imgsz" in data: config.yolo_imgsz = int(data["yolo_imgsz"])
            if "ema_alpha" in data: config.ema_alpha = float(data["ema_alpha"])

            # Tracker parameters
            if "tracker_track_high_thresh" in data: config.tracker_track_high_thresh = float(data["tracker_track_high_thresh"])
            if "tracker_track_low_thresh" in data: config.tracker_track_low_thresh = float(data["tracker_track_low_thresh"])
            if "tracker_new_track_thresh" in data: config.tracker_new_track_thresh = float(data["tracker_new_track_thresh"])
            if "tracker_track_buffer" in data: config.tracker_track_buffer = int(data["tracker_track_buffer"])
            if "tracker_match_thresh" in data: config.tracker_match_thresh = float(data["tracker_match_thresh"])
            if "tracker_fuse_score" in data: config.tracker_fuse_score = bool(data["tracker_fuse_score"])
            if "tracker_gmc_method" in data: config.tracker_gmc_method = str(data["tracker_gmc_method"])
            if "tracker_with_reid" in data: config.tracker_with_reid = bool(data["tracker_with_reid"])
            if "tracker_proximity_thresh" in data: config.tracker_proximity_thresh = float(data["tracker_proximity_thresh"])
            if "tracker_appearance_thresh" in data: config.tracker_appearance_thresh = float(data["tracker_appearance_thresh"])

            # Classifier parameters
            if "classifier_velocity_threshold" in data: config.classifier_velocity_threshold = float(data["classifier_velocity_threshold"])

            print(f"Loaded persistent settings from {SETTINGS_FILE}")
    except Exception as e:
        print(f"Error loading settings: {e}")

class SettingsPayload(BaseModel):
    idle_threshold_seconds: float
    movement_sensitivity: float
    confidence_threshold: float = Field(default=0.50)
    correlation_window_seconds: float = Field(default=5.0)
    identity_provider: str = Field(default="REST_SIMULATOR")

    # YOLO Pose Estimator
    yolo_model: str = Field(default="yolo11m-pose.pt")
    yolo_conf: float = Field(default=0.30)
    yolo_iou: float = Field(default=0.90)
    yolo_imgsz: int = Field(default=960)
    ema_alpha: float = Field(default=0.80)

    # Tracker parameters
    tracker_track_high_thresh: float = Field(default=0.30)
    tracker_track_low_thresh: float = Field(default=0.1)
    tracker_new_track_thresh: float = Field(default=0.50)
    tracker_track_buffer: int = Field(default=120)
    tracker_match_thresh: float = Field(default=0.8)
    tracker_fuse_score: bool = Field(default=True)
    tracker_gmc_method: str = Field(default="none")
    tracker_with_reid: bool = Field(default=True)
    tracker_proximity_thresh: float = Field(default=0.0)
    tracker_appearance_thresh: float = Field(default=0.75)

    # Classifier parameters
    classifier_velocity_threshold: float = Field(default=0.05)

    # Env / Streaming settings (overridden dynamically)
    default_rtsp_port: int = Field(default=554)
    stream_reconnect_interval: int = Field(default=5)
    stream_timeout: int = Field(default=30)
    frame_buffer_size: int = Field(default=5)
    max_cameras: int = Field(default=50)
    default_stream_transport: str = Field(default="tcp")
    hikvision_username: str = Field(default="admin")
    hikvision_password: str = Field(default="")

def sync_tracker_config():
    tracker_path = os.path.join(os.path.dirname(__file__), "..", "custom_tracker.yaml")
    yaml_content = f"""# Auto-generated BoT-SORT tracker configuration
tracker_type: botsort
track_high_thresh: {config.tracker_track_high_thresh}
track_low_thresh: {config.tracker_track_low_thresh}
new_track_thresh: {config.tracker_new_track_thresh}
track_buffer: {config.tracker_track_buffer}
match_thresh: {config.tracker_match_thresh}
fuse_score: {str(config.tracker_fuse_score)}

# GMC Optimization
gmc_method: {config.tracker_gmc_method}

# ReID
with_reid: {str(config.tracker_with_reid)}
model: yolo26m-reid.onnx
proximity_thresh: {config.tracker_proximity_thresh}
appearance_thresh: {config.tracker_appearance_thresh}
"""
    try:
        with open(tracker_path, "w", encoding="utf-8") as f:
            f.write(yaml_content)
        print(f"[Config] Successfully synchronized tracker config to {tracker_path}")
    except Exception as e:
        print(f"[Config] Failed to write tracker config: {e}")

# Initial sync of tracker config on module load
sync_tracker_config()

