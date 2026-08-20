"""
System Resources API — Real-time CPU, Memory, and GPU utilization.

Uses an asynchronous background polling cache to eliminate process spawning
overhead (subprocess nvidia-smi execution) on every HTTP request.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import threading
import time

from fastapi import APIRouter

router = APIRouter(tags=["system"])

# Warm up psutil.cpu_percent so subsequent calls measure non-zero deltas
try:
    import psutil
    psutil.cpu_percent(interval=None)
except ImportError:
    psutil = None


# Cached resource stats to serve HTTP requests in <0.1ms with zero CPU overhead
_cached_resources = {
    "cpu_percent": 0.0,
    "memory_percent": 0.0,
    "ram_percent": 0.0,
    "disk_percent": 0.0,
    "gpu": {
        "available": False,
        "name": "",
        "utilization_percent": -1.0,
        "memory_used_mb": 0,
        "memory_total_mb": 0,
        "memory_percent": -1.0,
        "temperature_c": -1,
    },
}
_cache_lock = threading.Lock()
_bg_thread_started = False


def _fetch_gpu_stats() -> dict:
    """Fetch live GPU stats via nvidia-smi."""
    result = {
        "available": False,
        "name": "",
        "utilization_percent": -1.0,
        "memory_used_mb": 0,
        "memory_total_mb": 0,
        "memory_percent": -1.0,
        "temperature_c": -1,
    }

    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name",
                "--format=csv,noheader,nounits",
            ],
            timeout=1.0,
            text=True,
        ).strip()

        parts = [p.strip() for p in out.split(",")]
        if len(parts) >= 5:
            gpu_util = float(parts[0])
            mem_used = int(parts[1])
            mem_total = int(parts[2])
            temp = int(parts[3])
            gpu_name = parts[4]

            mem_pct = round((mem_used / mem_total) * 100, 1) if mem_total > 0 else 0.0

            result["available"] = True
            result["name"] = gpu_name
            result["utilization_percent"] = gpu_util
            result["memory_used_mb"] = mem_used
            result["memory_total_mb"] = mem_total
            result["memory_percent"] = mem_pct
            result["temperature_c"] = temp
            return result
    except Exception:
        pass

    try:
        import torch
        if torch.cuda.is_available():
            result["available"] = True
            result["name"] = torch.cuda.get_device_name(0)
            mem = torch.cuda.mem_get_info(0)
            free_mb = mem[0] / (1024 * 1024)
            total_mb = mem[1] / (1024 * 1024)
            used_mb = total_mb - free_mb
            result["memory_used_mb"] = round(used_mb)
            result["memory_total_mb"] = round(total_mb)
            result["memory_percent"] = round((used_mb / total_mb) * 100, 1) if total_mb > 0 else 0.0
    except Exception:
        pass

    return result


def _resource_sampler_loop():
    """Background thread sampling system resources once every 1.5 seconds."""
    while True:
        try:
            # CPU
            cpu = -1.0
            if psutil is not None:
                cpu = round(psutil.cpu_percent(interval=None), 1)

            # Memory
            mem = -1.0
            if psutil is not None:
                mem = round(psutil.virtual_memory().percent, 1)

            # Disk
            disk = shutil.disk_usage(os.path.abspath(os.sep))
            disk_pct = round((disk.used / disk.total) * 100, 1)

            # GPU
            gpu = _fetch_gpu_stats()

            with _cache_lock:
                _cached_resources["cpu_percent"] = cpu
                _cached_resources["memory_percent"] = mem
                _cached_resources["ram_percent"] = mem
                _cached_resources["disk_percent"] = disk_pct
                _cached_resources["gpu"] = gpu
        except Exception as e:
            print(f"[ResourceSampler] Error sampling resources: {e}")

        time.sleep(1.5)


def _ensure_sampler_started():
    global _bg_thread_started
    if not _bg_thread_started:
        _bg_thread_started = True
        t = threading.Thread(target=_resource_sampler_loop, daemon=True, name="resource-sampler")
        t.start()


@router.get("/api/system/resources")
@router.get("/api/resources")
async def get_system_resources():
    """Return live system resource metrics from background cache."""
    _ensure_sampler_started()
    with _cache_lock:
        return dict(_cached_resources)

