import cv2
import numpy as np
import math
import os
import torch
from ultralytics import YOLO
from ..config import config

HIP_L, HIP_R = 23, 24
TRACKED_JOINTS = [0, 15, 16, 27, 28]

class WorkerDetector:
    """Detects worker pose using YOLO multi-person pose estimation."""

    CONNECTIONS = [
        (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
        (11, 23), (12, 24), (23, 25), (25, 27), (24, 26), (26, 28),
    ]

    # Map YOLO 17 keypoints to MediaPipe 33 keypoints format
    YOLO_TO_MP = {
        0: 0,   # Nose
        1: 2,   # L Eye
        2: 5,   # R Eye
        3: 7,   # L Ear
        4: 8,   # R Ear
        5: 11,  # L Shoulder
        6: 12,  # R Shoulder
        7: 13,  # L Elbow
        8: 14,  # R Elbow
        9: 15,  # L Wrist
        10: 16, # R Wrist
        11: 23, # L Hip
        12: 24, # R Hip
        13: 25, # L Knee
        14: 26, # R Knee
        15: 27, # L Ankle
        16: 28  # R Ankle
    }

    def __init__(self):
        self.model = YOLO("yolo11m-pose.pt")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model.to(self.device)
        
        # Per-track EMA smoothing state — keyed by track_id
        self.smoothed: dict[int, list[list[float]]] = {}
        self.prev_smoothed: dict[int, list[list[float]]] = {}
        self.idle_seconds: dict[int, float] = {}
        self.last_seen_frame: dict[int, int] = {} # track_id -> frame_number
        self.prev_worker_pos: dict[int, tuple[float, float]] = {}
        self.smoothed_velocities: dict[int, float] = {}
        self.EMA_ALPHA: float = 0.80  # higher = less display lag on moving workers
        self.frame_count: int = 0
        self.alert_triggered: bool = False

    @staticmethod
    def _dist_xy(a: list[float], b: list[float]) -> float:
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

    def update(self, frame: np.ndarray) -> list[dict]:
        """
        Process one BGR frame and return per-pose data for all detected people.
        """
        self.frame_count += 1
        h, w, _ = frame.shape

        # Use YOLO's built-in robust tracking (BoT-SORT)
        # imgsz=960 gives ~35% lower inference latency vs 1280 with minimal accuracy loss at CCTV distances.
        tracker_config = os.path.join(os.path.dirname(__file__), "..", "..", "custom_tracker.yaml")
        results = self.model.track(
            frame,
            persist=True,
            verbose=False,
            conf=0.30,
            iou=0.90,
            imgsz=960,
            tracker=tracker_config
        )

        if len(results) == 0 or results[0].boxes is None or results[0].boxes.id is None:
            return []
            
        keypoints_obj = results[0].keypoints
        if keypoints_obj is None or keypoints_obj.xyn.numel() == 0:
            return []

        xyn_batch = keypoints_obj.xyn.cpu().numpy()  # (num_poses, 17, 2)
        conf_batch = keypoints_obj.conf.cpu().numpy() # (num_poses, 17)
        track_ids = results[0].boxes.id.cpu().numpy().astype(int) # (num_poses,)
        box_xyxy = results[0].boxes.xyxy.cpu().numpy() # (num_poses, 4)

        poses_out = []
        for idx in range(len(track_ids)):
            track_id = int(track_ids[idx])
            xyn = xyn_batch[idx]
            conf = conf_batch[idx]
            
            # Record track frame activity
            self.last_seen_frame[track_id] = self.frame_count

            # ── Convert YOLO to MediaPipe 33-point format with keypoint confidence thresholding ──
            raw = [[0.0, 0.0] for _ in range(33)]
            for yolo_idx, mp_idx in self.YOLO_TO_MP.items():
                if conf[yolo_idx] >= 0.35:
                    raw[mp_idx] = [float(xyn[yolo_idx][0]), float(xyn[yolo_idx][1])]
                else:
                    raw[mp_idx] = [0.0, 0.0]
            
            # Map fingers to wrist for phone detection compatibility
            l_wrist_valid = (conf[9] >= 0.35)
            r_wrist_valid = (conf[10] >= 0.35)

            for f_idx in [17, 19, 21]: # L pinky, index, thumb -> L wrist
                if l_wrist_valid:
                    raw[f_idx] = [float(xyn[9][0]), float(xyn[9][1])]
                else:
                    raw[f_idx] = [0.0, 0.0]
            for f_idx in [18, 20, 22]: # R pinky, index, thumb -> R wrist
                if r_wrist_valid:
                    raw[f_idx] = [float(xyn[10][0]), float(xyn[10][1])]
                else:
                    raw[f_idx] = [0.0, 0.0]

            # ── Confidence ───────────────────────────────────────────────────
            vis_scores = [conf[i] for i in [5, 6, 11, 12, 9, 10]]
            confidence = float(np.mean(vis_scores)) if vis_scores else 0.0

            # ── EMA smoothing (ignoring unmapped/invalid points) ──────────────
            if track_id not in self.smoothed:
                self.smoothed[track_id] = [pt[:] for pt in raw]
            else:
                a = self.EMA_ALPHA
                new_smoothed = []
                for r, s in zip(raw, self.smoothed[track_id]):
                    if r[0] > 0.0 and r[1] > 0.0:
                        if s[0] == 0.0 and s[1] == 0.0:
                            # If previously invalid, initialize directly with current valid value
                            new_smoothed.append(r[:])
                        else:
                            new_smoothed.append([
                                a * r[0] + (1 - a) * s[0],
                                a * r[1] + (1 - a) * s[1]
                            ])
                    else:
                        # If raw is invalid, smoothed also becomes invalid [0.0, 0.0] to prevent freezing lag/offsets
                        new_smoothed.append([0.0, 0.0])
                self.smoothed[track_id] = new_smoothed
            smoothed = self.smoothed[track_id]

            # ── Calculate bounding box from the SMOOTHED keypoints ──────────
            valid_xs = [smoothed[mp_idx][0] for yolo_idx, mp_idx in self.YOLO_TO_MP.items() if smoothed[mp_idx][0] > 0.0]
            valid_ys = [smoothed[mp_idx][1] for yolo_idx, mp_idx in self.YOLO_TO_MP.items() if smoothed[mp_idx][1] > 0.0]
            
            if valid_xs and valid_ys:
                x_min, x_max = min(valid_xs), max(valid_xs)
                y_min, y_max = min(valid_ys), max(valid_ys)
                # Add 5% padding around the keypoints for a clean box
                pad_x = (x_max - x_min) * 0.05
                pad_y = (y_max - y_min) * 0.05
                box = [
                    max(0.0, x_min - pad_x),
                    max(0.0, y_min - pad_y),
                    min(1.0, x_max + pad_x),
                    min(1.0, y_max + pad_y)
                ]
            else:
                # Fallback to YOLO box normalized
                box = [
                    float(box_xyxy[idx][0] / w),
                    float(box_xyxy[idx][1] / h),
                    float(box_xyxy[idx][2] / w),
                    float(box_xyxy[idx][3] / h)
                ]

            # ── Movement score ───────────────────────────────────────────────
            box_h_norm = (max(s[1] for s in smoothed) - min(s[1] for s in smoothed)) if smoothed else 1.0
            dead_band = max(0.001, min(0.008, 0.008 * box_h_norm))

            if track_id in self.prev_smoothed:
                movement_score = 0.0
                for j in TRACKED_JOINTS:
                    if j < len(smoothed) and j < len(self.prev_smoothed[track_id]):
                        d = self._dist_xy(smoothed[j], self.prev_smoothed[track_id][j])
                        if d > dead_band:
                            movement_score += d
            else:
                movement_score = 0.0

            # ── Idle accumulator ─────────────────────────────────────────────
            if movement_score > config.movement_sensitivity:
                self.idle_seconds[track_id] = 0.0
            else:
                self.idle_seconds[track_id] = self.idle_seconds.get(track_id, 0.0) + 0.2

            self.prev_smoothed[track_id] = smoothed

            # ── Derived outputs ──────────────────────────────────────────────
            keypoints = [(s[0], s[1]) for s in smoothed]

            if HIP_L < len(smoothed) and HIP_R < len(smoothed):
                worker_pos = (
                    (smoothed[HIP_L][0] + smoothed[HIP_R][0]) / 2,
                    (smoothed[HIP_L][1] + smoothed[HIP_R][1]) / 2,
                )
            else:
                worker_pos = None
                
            velocity = 0.0
            if worker_pos and track_id in self.prev_worker_pos:
                inst_vel = self._dist_xy(worker_pos, self.prev_worker_pos[track_id])
                self.smoothed_velocities[track_id] = 0.8 * self.smoothed_velocities.get(track_id, 0.0) + 0.2 * inst_vel
                velocity = self.smoothed_velocities[track_id]
                
            if worker_pos:
                self.prev_worker_pos[track_id] = worker_pos

            poses_out.append({
                "track_id":       track_id,
                "has_pose":       True,
                "movement_score": movement_score,
                "velocity":       velocity,
                "confidence":     confidence,
                "worker_pos":     worker_pos,
                "idle_seconds":   self.idle_seconds[track_id],
                "keypoints":      keypoints,
                "box":            box,
            })

        # Prune stale tracks
        for tid in list(self.smoothed.keys()):
            if self.frame_count - self.last_seen_frame.get(tid, 0) > 100:
                self.smoothed.pop(tid, None)
                self.prev_smoothed.pop(tid, None)
                self.idle_seconds.pop(tid, None)
                self.last_seen_frame.pop(tid, None)
                if hasattr(self, 'prev_worker_pos'):
                    self.prev_worker_pos.pop(tid, None)
                if hasattr(self, 'smoothed_velocities'):
                    self.smoothed_velocities.pop(tid, None)

        return poses_out
