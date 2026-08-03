import os
import sys

# ── Register PyTorch CUDA & cuDNN DLL directory on Windows ─────────────────
# When ONNX Runtime or Ultralytics initializes CUDA models on Windows, ONNX
# Runtime requires cuDNN DLLs (cudnn64_9.dll, etc.). PyTorch ships these DLLs
# inside site-packages/torch/lib. Adding this directory to DLL search path and PATH
# prevents ONNX Runtime from silently failing CUDA initialization and falling back
# to single-threaded CPU execution.
try:
    import torch
    _torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.exists(_torch_lib):
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(_torch_lib)
        os.environ["PATH"] = _torch_lib + os.path.pathsep + os.environ.get("PATH", "")
except Exception as e:
    pass

import json
from pydantic_settings import BaseSettings
from pydantic import Field, BaseModel

class EnvSettings(BaseSettings):
    default_rtsp_port: int = 554
    stream_reconnect_interval: int = 5
    stream_timeout: int = 30
    frame_buffer_size: int = 5
    max_cameras: int = 50
    default_stream_transport: str = "tcp"
    hikvision_username: str = "admin"
    hikvision_password: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

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
    yolo_imgsz: int = 640
    ema_alpha: float = 0.80
    max_tracked_people: int = 10
    ai_stream_fps: int = 15  # Target FPS for the AI WebSocket stream

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

    # AI WebSocket tracking rate (FPS delivered to the frontend)
    tracking_fps: float = 5.0

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
            if "max_tracked_people" in data: config.max_tracked_people = int(data["max_tracked_people"])
            if "ai_stream_fps" in data: config.ai_stream_fps = int(data["ai_stream_fps"])

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

            # Tracking FPS
            if "tracking_fps" in data: config.tracking_fps = float(data["tracking_fps"])

            print(f"Loaded persistent settings from {SETTINGS_FILE}")
    except Exception as e:
        print(f"Error loading settings: {e}")

class SettingsPayload(BaseModel):
    idle_threshold_seconds: float
    movement_sensitivity: float
    confidence_threshold: float
    correlation_window_seconds: float
    identity_provider: str

    yolo_model: str = Field(default="yolo11m-pose.pt")
    yolo_conf: float = Field(default=0.30)
    yolo_iou: float = Field(default=0.90)
    yolo_imgsz: int = Field(default=640)
    ema_alpha: float = Field(default=0.80)
    max_tracked_people: int = Field(default=10)
    ai_stream_fps: int = Field(default=15)

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

    # AI tracking FPS
    tracking_fps: float = Field(default=5.0)

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
    # Using model: auto instructs BoT-SORT to extract ReID embeddings natively from GPU feature
    # maps in CUDA VRAM during the main YOLO pass. This eliminates external CPU ONNX inference
    # and achieves 85-100+ FPS on RTX GPUs.
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

# ReID (GPU Native Acceleration)
with_reid: {str(config.tracker_with_reid)}
model: auto
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
