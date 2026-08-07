"""
ONNX Exporter — Transparent YOLO11 model acceleration helper.

Exports an existing .pt model to ONNX format the first time it is requested.
This module is intentionally isolated so it can be called from a background
thread without touching any shared detector state.

Usage:
    from .onnx_exporter import get_onnx_path, onnx_exists, export_onnx_blocking

    onnx_path = get_onnx_path(pt_path)
    if not onnx_exists(pt_path):
        # Call from asyncio.to_thread(...) — never on the event loop
        export_onnx_blocking(pt_path, imgsz=640)
"""

from __future__ import annotations

import os
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def get_onnx_path(pt_path: str) -> str:
    """
    Return the expected .onnx file path for a given .pt model path.

    Example:
        /path/to/models/yolo11m-pose.pt  →  /path/to/models/yolo11m-pose.onnx
    """
    base, _ = os.path.splitext(pt_path)
    return base + ".onnx"


def onnx_exists(pt_path: str) -> bool:
    """Return True if the ONNX export already exists on disk."""
    return os.path.isfile(get_onnx_path(pt_path))


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_onnx_blocking(pt_path: str, imgsz: int = 640) -> str | None:
    """
    Export a YOLO .pt model to ONNX format using Ultralytics' native API.

    This function is **blocking** (model compilation can take 60-120 seconds)
    and MUST be called from a background thread, not the asyncio event loop.

        # Correct usage:
        onnx_path = await asyncio.to_thread(export_onnx_blocking, pt_path, imgsz)

    Parameters
    ----------
    pt_path:
        Absolute path to the source .pt model file.
    imgsz:
        Export image size. Should match yolo_imgsz from DetectionConfig
        so inference dimensions are consistent.

    Returns
    -------
    str | None
        Absolute path to the exported .onnx file on success.
        None if export failed (caller should fall back to .pt).
    """
    if not os.path.isfile(pt_path):
        logger.warning(
            "[OnnxExporter] Source .pt model not found at %s — skipping export.", pt_path
        )
        return None

    onnx_path = get_onnx_path(pt_path)

    # Guard: another thread may have exported concurrently
    if os.path.isfile(onnx_path):
        logger.info("[OnnxExporter] ONNX already exists at %s — skipping.", onnx_path)
        return onnx_path

    logger.info(
        "[OnnxExporter] 🚀 Starting ONNX export: %s → %s  (imgsz=%d)",
        os.path.basename(pt_path),
        os.path.basename(onnx_path),
        imgsz,
    )

    try:
        # Import here to avoid importing Ultralytics at module load time
        from ultralytics import YOLO

        model = YOLO(pt_path)
        # Export to ONNX — opset 17 is widely supported and gives best perf.
        # dynamic=False keeps shapes static for maximum TensorRT compatibility later.
        export_result = model.export(
            format="onnx",
            imgsz=imgsz,
            opset=17,
            dynamic=False,
            simplify=True,    # onnx-simplifier removes redundant ops for faster inference
            verbose=False,
        )

        # Ultralytics returns the exported file path as a string
        exported_file: str = str(export_result) if export_result else onnx_path

        # Ultralytics may write to a slightly different path; normalise it
        if not os.path.isfile(exported_file):
            # Fall back: look for the file next to the .pt
            if os.path.isfile(onnx_path):
                exported_file = onnx_path
            else:
                logger.error(
                    "[OnnxExporter] Export reported success but file not found: %s",
                    exported_file,
                )
                return None

        size_mb = os.path.getsize(exported_file) / (1024 * 1024)
        logger.info(
            "[OnnxExporter] ✅ Export complete: %s  (%.1f MB)",
            exported_file,
            size_mb,
        )
        return exported_file

    except Exception as exc:
        logger.error(
            "[OnnxExporter] ❌ Export failed for %s: %s — will continue with .pt model.",
            pt_path,
            exc,
        )
        return None
