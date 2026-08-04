"""
Settings API — read and write detection/tracker/streaming configuration.

Endpoints
---------
GET  /api/settings   — return all current settings
POST /api/settings   — save settings, sync tracker config, reload provider
"""

from __future__ import annotations

import json

from fastapi import APIRouter

from ..config import config, SETTINGS_FILE, SettingsPayload, sync_tracker_config, env_settings, _update_env_file
from ..identity.api import _provider
from ..identity.correlation import correlation_engine
from ..cameras.stream_manager import stream_manager
from ..activity.classifier import profile_registry

router = APIRouter(tags=["settings"])


@router.get("/api/activity/profiles")
async def get_activity_profiles():
    """Return all registered activity profiles with their activity definitions."""
    return {
        "active_profile": getattr(config, "active_profile", "software_office"),
        "profiles": profile_registry.list_profiles(),
    }


@router.get("/api/settings")
async def get_settings():
    return {
        "idle_threshold_seconds": config.idle_threshold_seconds,
        "movement_sensitivity": config.movement_sensitivity,
        "confidence_threshold": config.confidence_threshold,
        "correlation_window_seconds": config.correlation_window_seconds,
        "identity_provider": config.identity_provider,

        # YOLO
        "yolo_model": config.yolo_model,
        "yolo_conf": config.yolo_conf,
        "yolo_iou": config.yolo_iou,
        "yolo_imgsz": config.yolo_imgsz,
        "ema_alpha": config.ema_alpha,
        "max_tracked_people": config.max_tracked_people,
        "ai_stream_fps": config.ai_stream_fps,

        # Tracker
        "tracker_track_high_thresh": config.tracker_track_high_thresh,
        "tracker_track_low_thresh": config.tracker_track_low_thresh,
        "tracker_new_track_thresh": config.tracker_new_track_thresh,
        "tracker_track_buffer": config.tracker_track_buffer,
        "tracker_match_thresh": config.tracker_match_thresh,
        "tracker_fuse_score": config.tracker_fuse_score,
        "tracker_gmc_method": config.tracker_gmc_method,
        "tracker_with_reid": config.tracker_with_reid,
        "tracker_proximity_thresh": config.tracker_proximity_thresh,
        "tracker_appearance_thresh": config.tracker_appearance_thresh,

        # Classifier
        "classifier_velocity_threshold": config.classifier_velocity_threshold,

        # Activity Profile
        "active_profile": getattr(config, "active_profile", "software_office"),

        # Tracking pipeline
        "tracking_fps": config.tracking_fps,

        # Env / Streaming overrides
        "default_rtsp_port": env_settings.default_rtsp_port,
        "stream_reconnect_interval": env_settings.stream_reconnect_interval,
        "stream_timeout": env_settings.stream_timeout,
        "frame_buffer_size": env_settings.frame_buffer_size,
        "max_cameras": env_settings.max_cameras,
        "default_stream_transport": env_settings.default_stream_transport,
        "hikvision_username": env_settings.hikvision_username,
        "hikvision_password": env_settings.hikvision_password,
    }


@router.post("/api/settings")
async def save_settings(payload: SettingsPayload):
    # Core settings
    config.idle_threshold_seconds = payload.idle_threshold_seconds
    config.movement_sensitivity = payload.movement_sensitivity
    config.confidence_threshold = payload.confidence_threshold
    config.correlation_window_seconds = payload.correlation_window_seconds
    config.identity_provider = payload.identity_provider

    # YOLO settings
    config.yolo_model = payload.yolo_model
    config.yolo_conf = payload.yolo_conf
    config.yolo_iou = payload.yolo_iou
    config.yolo_imgsz = payload.yolo_imgsz
    config.ema_alpha = payload.ema_alpha
    config.max_tracked_people = payload.max_tracked_people
    config.ai_stream_fps = payload.ai_stream_fps

    # Tracker settings
    config.tracker_track_high_thresh = payload.tracker_track_high_thresh
    config.tracker_track_low_thresh = payload.tracker_track_low_thresh
    config.tracker_new_track_thresh = payload.tracker_new_track_thresh
    config.tracker_track_buffer = payload.tracker_track_buffer
    config.tracker_match_thresh = payload.tracker_match_thresh
    config.tracker_fuse_score = payload.tracker_fuse_score
    config.tracker_gmc_method = payload.tracker_gmc_method
    config.tracker_with_reid = payload.tracker_with_reid
    config.tracker_proximity_thresh = payload.tracker_proximity_thresh
    config.tracker_appearance_thresh = payload.tracker_appearance_thresh

    # Classifier settings
    config.classifier_velocity_threshold = payload.classifier_velocity_threshold

    # Activity Profile
    config.active_profile = payload.active_profile

    # Tracking FPS
    config.tracking_fps = max(1.0, min(60.0, payload.tracking_fps))

    # Write to settings.json
    try:
        with open(SETTINGS_FILE, "w") as f:
            json.dump({
                "idle_threshold_seconds": config.idle_threshold_seconds,
                "movement_sensitivity": config.movement_sensitivity,
                "confidence_threshold": config.confidence_threshold,
                "correlation_window_seconds": config.correlation_window_seconds,
                "identity_provider": config.identity_provider,

                "yolo_model": config.yolo_model,
                "yolo_conf": config.yolo_conf,
                "yolo_iou": config.yolo_iou,
                "yolo_imgsz": config.yolo_imgsz,
                "ema_alpha": config.ema_alpha,
                "max_tracked_people": config.max_tracked_people,
                "ai_stream_fps": config.ai_stream_fps,

                "tracker_track_high_thresh": config.tracker_track_high_thresh,
                "tracker_track_low_thresh": config.tracker_track_low_thresh,
                "tracker_new_track_thresh": config.tracker_new_track_thresh,
                "tracker_track_buffer": config.tracker_track_buffer,
                "tracker_match_thresh": config.tracker_match_thresh,
                "tracker_fuse_score": config.tracker_fuse_score,
                "tracker_gmc_method": config.tracker_gmc_method,
                "tracker_with_reid": config.tracker_with_reid,
                "tracker_proximity_thresh": config.tracker_proximity_thresh,
                "tracker_appearance_thresh": config.tracker_appearance_thresh,

                "classifier_velocity_threshold": config.classifier_velocity_threshold,

                "active_profile": config.active_profile,

                "tracking_fps": config.tracking_fps,

                # Env / Streaming overrides
                "default_rtsp_port": payload.default_rtsp_port,
                "stream_reconnect_interval": payload.stream_reconnect_interval,
                "stream_timeout": payload.stream_timeout,
                "frame_buffer_size": payload.frame_buffer_size,
                "max_cameras": payload.max_cameras,
                "default_stream_transport": payload.default_stream_transport,
                "hikvision_username": payload.hikvision_username,
                "hikvision_password": payload.hikvision_password,
            }, f, indent=4)
    except Exception as e:
        print(f"Failed to persist settings: {e}")

    # Update sensitive credentials in .env file
    if payload.hikvision_username:
        _update_env_file("HIKVISION_USERNAME", payload.hikvision_username)
    if payload.hikvision_password:
        _update_env_file("HIKVISION_PASSWORD", payload.hikvision_password)

    # Reload the environment config settings (which reads from .env & settings.json)
    env_settings.reload_doors()

    # Dynamic synchronize tracker configuration file
    sync_tracker_config()

    # Dynamic reload provider in DynamicProviderProxy if present
    if hasattr(_provider, "reload_provider"):
        _provider.reload_provider()

    # Apply correlation window immediately
    correlation_engine.set_window(config.correlation_window_seconds)

    # Restart active streams to apply updated RTSP configurations instantly
    stream_manager.restart_all_active()

    print(f"⚙️  Settings: idle={config.idle_threshold_seconds}s  sens={config.movement_sensitivity}  conf={config.confidence_threshold}")
    return {
        "status": "saved",
        "idle_threshold_seconds": config.idle_threshold_seconds,
        "movement_sensitivity": config.movement_sensitivity,
        "confidence_threshold": config.confidence_threshold,
    }
