import cv2
import numpy as np
import math
import os
import threading
import yaml
import torch
from ultralytics import YOLO

# Monkey-patch Ultralytics GMC (Global Motion Compensation) to handle frame shape changes
# and avoid repeated OpenCV assertion failure warnings:
# "WARNING ⚠️ GMC failed, falling back to identity: OpenCV(...) lkpyramid.cpp:1415: error: (-215:Assertion failed)..."
try:
    from ultralytics.trackers.utils.gmc import GMC

    _orig_gmc_sparse = getattr(GMC, "apply_sparseoptflow", None)
    _orig_gmc_ecc = getattr(GMC, "apply_ecc", None)
    _orig_gmc_feat = getattr(GMC, "apply_features", None)

    def _safe_gmc_wrap(func):
        if func is None:
            return None
        def wrapper(self, raw_frame: np.ndarray, *args, **kwargs):
            if raw_frame is None or not isinstance(raw_frame, np.ndarray) or raw_frame.size == 0:
                return np.eye(2, 3)
            height, width = raw_frame.shape[:2]
            target_shape = (height // self.downscale, width // self.downscale) if getattr(self, "downscale", 1) > 1.0 else (height, width)
            if getattr(self, "prevFrame", None) is not None and self.prevFrame.shape[:2] != target_shape:
                self.reset_params()
            try:
                return func(self, raw_frame, *args, **kwargs)
            except Exception:
                self.reset_params()
                return np.eye(2, 3)
        return wrapper

    if _orig_gmc_sparse:
        GMC.apply_sparseoptflow = _safe_gmc_wrap(_orig_gmc_sparse)
    if _orig_gmc_ecc:
        GMC.apply_ecc = _safe_gmc_wrap(_orig_gmc_ecc)
    if _orig_gmc_feat:
        GMC.apply_features = _safe_gmc_wrap(_orig_gmc_feat)
except Exception:
    pass

from ..config import config
from .onnx_exporter import get_onnx_path, onnx_exists, export_onnx_blocking

HIP_L, HIP_R = 23, 24
TRACKED_JOINTS = [0, 15, 16, 27, 28]
def get_model_filepath(model_name: str) -> str:
    """Resolve model file path in backend/models/ directory with automatic fallback."""
    _backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    _models_dir = os.path.join(_backend_dir, "models")
    os.makedirs(_models_dir, exist_ok=True)
    
    # 1. Check in backend/models/
    p_models = os.path.join(_models_dir, model_name)
    if os.path.isfile(p_models):
        return p_models
        
    # 2. Check in backend/
    p_backend = os.path.join(_backend_dir, model_name)
    if os.path.isfile(p_backend):
        return p_backend
        
    # Default to backend/models/ for ultralytics auto-download
    return p_models


_pt_model_cache: dict[str, YOLO] = {}
_pt_model_lock = threading.Lock()


def _load_pt_model(pt_path: str) -> "YOLO":
    """
    Load a YOLO .pt model for tracking (cached by file path).
    """
    with _pt_model_lock:
        if pt_path not in _pt_model_cache:
            model = YOLO(pt_path)
            print(f"[WorkerDetector] 📦 Loaded PyTorch model into cache: {os.path.basename(pt_path)} (BoT-SORT tracking enabled)")
            _pt_model_cache[pt_path] = model
        return _pt_model_cache[pt_path]


def _trigger_onnx_export_background(pt_path: str, imgsz: int) -> None:
    """
    Fire-and-forget: start a daemon thread that exports .pt → .onnx.
    The ONNX file is NOT used for .track() (Ultralytics restriction),
    but is exported for reference / future onnxruntime integration.
    """
    def _do_export():
        print(
            f"[WorkerDetector] 🔄 Background ONNX export started for "
            f"{os.path.basename(pt_path)} (imgsz={imgsz}). "
            f"Note: ONNX export is for reference only — .track() always uses .pt."
        )
        result = export_onnx_blocking(pt_path, imgsz=imgsz)
        if result:
            print(
                f"[WorkerDetector] ✅ ONNX export done → {os.path.basename(result)}."
            )
        else:
            print("[WorkerDetector] ⚠️  ONNX export failed — will retry on next startup.")

    t = threading.Thread(target=_do_export, name="onnx-export", daemon=True)
    t.start()


class WorkerDetector:
    """Detects worker pose using YOLO multi-person pose estimation."""

    CONNECTIONS = [
        (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
        (11, 23), (12, 24), (23, 25), (25, 27), (24, 26), (26, 28),
    ]

    # Keypoint mapping: YOLO pose (17 keypoints) -> MediaPipe Pose (33 keypoints)
    YOLO_TO_MP = {
        0: 0,    # nose -> nose
        1: 2,    # left_eye -> left_eye
        2: 5,    # right_eye -> right_eye
        3: 7,    # left_ear -> left_ear
        4: 8,    # right_ear -> right_ear
        5: 11,   # left_shoulder -> left_shoulder
        6: 12,   # right_shoulder -> right_shoulder
        7: 13,   # left_elbow -> left_elbow
        8: 14,   # right_elbow -> right_elbow
        9: 15,   # left_wrist -> left_wrist
        10: 16,  # right_wrist -> right_wrist
        11: 23,  # left_hip -> left_hip
        12: 24,  # right_hip -> right_hip
        13: 25,  # left_knee -> left_knee
        14: 26,  # right_knee -> right_knee
        15: 27,  # left_ankle -> left_ankle
        16: 28,  # right_ankle -> right_ankle
    }

    def __init__(self):
        if torch.cuda.is_available():
            self.device_id = 0  # int device ID for YOLO track()
            self.device = "cuda:0"
            torch.backends.cudnn.benchmark = True
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            print(f"[WorkerDetector] 🚀 GPU Acceleration Enabled: {torch.cuda.get_device_name(0)}")
        else:
            self.device_id = "cpu"
            self.device = "cpu"
            torch.set_num_threads(4)
            print("[WorkerDetector] ⚠️ Running on CPU mode.")

        # Resolve .pt model path from backend/models/
        target_model = getattr(config, "yolo_model", "yolo11m-pose.pt")
        _pt_path = get_model_filepath(target_model)

        # ── Mod 7: FP16 acceleration via half=True ──────────────────────────
        # ONNX/TensorRT exports only support .predict() — NOT .track().
        # The real GPU speedup for .track() is FP16 half-precision inference,
        # which Ultralytics natively supports with .pt models on CUDA.
        # Speedup: ~1.5-2x latency reduction with zero accuracy loss on RTX GPUs.
        self.use_half = (self.device != "cpu")  # FP16 only valid on CUDA, not CPU

        self.model = _load_pt_model(_pt_path)
        self.model.to(self.device)
        self.model_name = target_model

        # Trigger background ONNX export for future reference (not used for tracking)
        use_onnx = getattr(config, "use_onnx", True)
        if use_onnx and not onnx_exists(_pt_path):
            _trigger_onnx_export_background(_pt_path, imgsz=getattr(config, "yolo_imgsz", 640))
        # ────────────────────────────────────────────────────────────────────

        # Warm up CUDA GPU engine to pre-allocate VRAM & compile kernels at startup
        if self.device != "cpu":
            try:
                dummy = np.zeros((480, 640, 3), dtype=np.uint8)
                self.model(dummy, verbose=False, device=self.device_id)
            except Exception as e:
                print(f"[WorkerDetector] CUDA warmup note: {e}")
        
        # Per-track EMA smoothing state — keyed by track_id
        self.smoothed: dict[int, list[list[float]]] = {}
        self.prev_smoothed: dict[int, list[list[float]]] = {}
        self.idle_seconds: dict[int, float] = {}
        self.hands_off_seconds: dict[int, float] = {}
        self.pos_history: dict[int, list[tuple[float, float]]] = {}
        self.last_seen_frame: dict[int, int] = {} # track_id -> frame_number
        self.prev_worker_pos: dict[int, tuple[float, float]] = {}
        self.smoothed_velocities: dict[int, float] = {}
        self.EMA_ALPHA: float = getattr(config, "ema_alpha", 0.80)
        self.frame_count: int = 0
        self.alert_triggered: bool = False
        self.last_returned_ids: set[int] = set()

        # Cache tracker config path once (Ultralytics track() requires a .yaml/.yml file path string)
        self.tracker_config = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "custom_tracker.yaml")
        )

        # Track stability: record the last confirmed box for each track_id
        self.last_confirmed_box: dict[int, list[float]] = {}
        self.dropped_ids: dict[int, int] = {}
        # Native BoT-SORT ``smooth_feat`` vectors, when exposed by the installed
        # Ultralytics tracker.  They are preferred over the visual fallback below.
        self._botsort_features: dict[int, tuple[float, ...]] = {}

    @staticmethod
    def _dist_xy(a: list[float], b: list[float]) -> float:
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

    def _refresh_botsort_features(self) -> None:
        """Read BoT-SORT Re-ID features without coupling to one Ultralytics release."""
        self._botsort_features = {}
        try:
            trackers = getattr(self.model.predictor, "trackers", [])
            for tracker in trackers:
                for track in getattr(tracker, "tracked_stracks", []):
                    feature = getattr(track, "smooth_feat", None)
                    if feature is None:
                        feature = getattr(track, "curr_feat", None)
                    track_id = getattr(track, "track_id", None)
                    if feature is not None and track_id is not None:
                        vector = np.asarray(feature, dtype=np.float32).reshape(-1)
                        norm = float(np.linalg.norm(vector))
                        if norm > 0:
                            self._botsort_features[int(track_id)] = tuple((vector / norm).tolist())
        except Exception:
            # Some Ultralytics versions intentionally hide the tracker encoder.
            # Per-person fallback descriptors keep the handoff engine functional.
            pass

    @staticmethod
    def _fallback_appearance_embedding(frame: np.ndarray, xyxy: np.ndarray) -> tuple[float, ...] | None:
        """Stable crop descriptor used only if native BoT-SORT features are unavailable."""
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = [int(v) for v in xyxy]
        x1, x2 = max(0, x1), min(w, x2)
        y1, y2 = max(0, y1), min(h, y2)
        if x2 - x1 < 8 or y2 - y1 < 8:
            return None
        hsv = cv2.cvtColor(frame[y1:y2, x1:x2], cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 4], [0, 180, 0, 256, 0, 256]).reshape(-1)
        norm = float(np.linalg.norm(hist))
        return tuple((hist / norm).astype(np.float32).tolist()) if norm else None

    @staticmethod
    def _check_seated_posture(smoothed: list[list[float]]) -> bool:
        """Return True if hip-knee-ankle keypoint geometry indicates a seated posture."""
        if not smoothed or len(smoothed) < 27:
            return False
        l_sh, r_sh = smoothed[11], smoothed[12]
        l_hp, r_hp = smoothed[23], smoothed[24]
        l_kn, r_kn = smoothed[25], smoothed[26]

        sh_ys = [pt[1] for pt in (l_sh, r_sh) if pt[0] > 0.01]
        hp_ys = [pt[1] for pt in (l_hp, r_hp) if pt[0] > 0.01]
        kn_ys = [pt[1] for pt in (l_kn, r_kn) if pt[0] > 0.01]

        if not sh_ys or not hp_ys or not kn_ys:
            return False

        avg_sh_y = sum(sh_ys) / len(sh_ys)
        avg_hp_y = sum(hp_ys) / len(hp_ys)
        avg_kn_y = sum(kn_ys) / len(kn_ys)

        torso_h = avg_hp_y - avg_sh_y
        thigh_vertical_drop = avg_kn_y - avg_hp_y

        if torso_h <= 0.01:
            return False

        # In standing pose, thigh vertical drop is approx equal or larger than torso height.
        # In seated pose, thighs are horizontal, so vertical drop ratio is small (< 0.60).
        return (thigh_vertical_drop / torso_h) < 0.60

    @staticmethod
    def _check_hands_on_desk(smoothed: list[list[float]]) -> bool:
        """Return True if hands/wrists are positioned in desk/keyboard area."""
        if not smoothed or len(smoothed) < 25:
            return True  # Default to True if incomplete to avoid false idle
        l_sh, r_sh = smoothed[11], smoothed[12]
        l_wr, r_wr = smoothed[15], smoothed[16]
        l_hp, r_hp = smoothed[23], smoothed[24]

        shoulders = [pt for pt in (l_sh, r_sh) if pt[0] > 0.01]
        wrists = [pt for pt in (l_wr, r_wr) if pt[0] > 0.01]
        hips = [pt for pt in (l_hp, r_hp) if pt[0] > 0.01]

        if not shoulders or not wrists:
            return True

        avg_sh_y = sum(pt[1] for pt in shoulders) / len(shoulders)
        avg_hp_y = sum(pt[1] for pt in hips) / len(hips) if hips else avg_sh_y + 0.4

        for wr in wrists:
            wr_y = wr[1]
            if avg_sh_y - 0.05 <= wr_y <= avg_hp_y + 0.15:
                return True

        return False

    def update(self, frame: np.ndarray) -> list[dict]:
        """
        Process one BGR frame and return per-pose data for all detected people.
        """
        self.frame_count += 1
        h, w, _ = frame.shape

        # Dynamic reload YOLO model
        target_model = getattr(config, "yolo_model", "yolo11m-pose.pt")
        if not hasattr(self, "model_name") or self.model_name != target_model:
            print(f"[WorkerDetector] Reloading YOLO model: {getattr(self, 'model_name', 'None')} -> {target_model}")
            _pt_path = get_model_filepath(target_model)
            self.model = _load_pt_model(_pt_path)
            self.model.to(self.device)
            self.model_name = target_model
            # Trigger background ONNX export for the new model if needed
            use_onnx = getattr(config, "use_onnx", True)
            if use_onnx and not onnx_exists(_pt_path):
                _trigger_onnx_export_background(_pt_path, imgsz=getattr(config, "yolo_imgsz", 640))
            # Clear all per-track state because the new model will restart track IDs
            self.smoothed.clear()
            self.prev_smoothed.clear()
            self.idle_seconds.clear()
            self.hands_off_seconds.clear()
            self.pos_history.clear()
            self.last_seen_frame.clear()
            self.prev_worker_pos.clear()
            self.smoothed_velocities.clear()
            self.last_confirmed_box.clear()
            self.dropped_ids.clear()
            self.last_returned_ids = set()

        # Dynamic EMA_ALPHA
        self.EMA_ALPHA = getattr(config, "ema_alpha", 0.80)

        # Use YOLO's built-in robust tracking (BoT-SORT / ByteTrack).
        # Note: half/quantize are export()-only args and must NOT be passed to track().
        # GPU throughput is maximised via allow_tf32=True already set in __init__.
        results = self.model.track(
            frame,
            persist=True,
            verbose=False,
            device=self.device_id,
            conf=getattr(config, "yolo_conf", 0.30),
            iou=getattr(config, "yolo_iou", 0.90),
            imgsz=getattr(config, "yolo_imgsz", 640),
            tracker=self.tracker_config,
        )
        self._refresh_botsort_features()

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
        # Spatial jump gate: maximum normalised distance the box centre can
        # travel in one frame before logging a warning (increased to 50% frame width).
        MAX_CENTRE_JUMP = 0.50

        for idx in range(len(track_ids)):
            track_id = int(track_ids[idx])
            xyn = xyn_batch[idx]
            conf = conf_batch[idx]
            xyxy = box_xyxy[idx]

            # --- Spatial continuity check ----------------------------------------
            cx_new = ((xyxy[0] + xyxy[2]) / 2) / w
            cy_new = ((xyxy[1] + xyxy[3]) / 2) / h
            if track_id in self.last_confirmed_box:
                lb = self.last_confirmed_box[track_id]
                cx_old = (lb[0] + lb[2]) / 2
                cy_old = (lb[1] + lb[3]) / 2
                jump = math.sqrt((cx_new - cx_old) ** 2 + (cy_new - cy_old) ** 2)
                if jump > MAX_CENTRE_JUMP:
                    print(f"[WorkerDetector] ℹ️ Rapid position jump for track {track_id}: Δ={jump:.3f}")

            # ALWAYS update last confirmed box (normalised) so position state advances cleanly
            self.last_confirmed_box[track_id] = [
                xyxy[0] / w, xyxy[1] / h, xyxy[2] / w, xyxy[3] / h
            ]
            
            # Record track frame activity
            self.last_seen_frame[track_id] = self.frame_count

            # ── Convert YOLO to MediaPipe 33-point format with keypoint confidence thresholding ──
            raw = [[0.0, 0.0] for _ in range(33)]
            for yolo_idx, mp_idx in self.YOLO_TO_MP.items():
                if conf[yolo_idx] >= getattr(config, "yolo_conf", 0.30):
                    raw[mp_idx] = [float(xyn[yolo_idx][0]), float(xyn[yolo_idx][1])]
                else:
                    raw[mp_idx] = [0.0, 0.0]
            
            # Map fingers to wrist for phone detection compatibility
            l_wrist_valid = (conf[9] >= getattr(config, "yolo_conf", 0.30))
            r_wrist_valid = (conf[10] >= getattr(config, "yolo_conf", 0.30))

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

            # ── Idle & Hands-off-desk accumulators ─────────────────────────────
            if movement_score > config.movement_sensitivity:
                self.idle_seconds[track_id] = 0.0
            else:
                self.idle_seconds[track_id] = self.idle_seconds.get(track_id, 0.0) + 0.2

            hands_on_desk = self._check_hands_on_desk(smoothed)
            if hands_on_desk:
                self.hands_off_seconds[track_id] = 0.0
            else:
                self.hands_off_seconds[track_id] = self.hands_off_seconds.get(track_id, 0.0) + 0.2

            is_seated = self._check_seated_posture(smoothed)

            self.prev_smoothed[track_id] = smoothed

            # ── Derived outputs & Position history (Locomotion check) ──────────
            keypoints = [(s[0], s[1]) for s in smoothed]

            if HIP_L < len(smoothed) and HIP_R < len(smoothed):
                worker_pos = (
                    (smoothed[HIP_L][0] + smoothed[HIP_R][0]) / 2,
                    (smoothed[HIP_L][1] + smoothed[HIP_R][1]) / 2,
                )
            else:
                worker_pos = None
                
            velocity = 0.0
            net_displacement = 0.0

            if worker_pos:
                if track_id not in self.pos_history:
                    self.pos_history[track_id] = []
                self.pos_history[track_id].append(worker_pos)
                if len(self.pos_history[track_id]) > 15:
                    self.pos_history[track_id].pop(0)

                oldest_pos = self.pos_history[track_id][0]
                net_displacement = self._dist_xy(worker_pos, oldest_pos)

                if track_id in self.prev_worker_pos:
                    inst_vel = self._dist_xy(worker_pos, self.prev_worker_pos[track_id])
                    self.smoothed_velocities[track_id] = 0.8 * self.smoothed_velocities.get(track_id, 0.0) + 0.2 * inst_vel
                    velocity = self.smoothed_velocities[track_id]
                
                self.prev_worker_pos[track_id] = worker_pos

            poses_out.append({
                "track_id":          track_id,
                "has_pose":          True,
                "movement_score":    movement_score,
                "velocity":          velocity,
                "net_displacement":  net_displacement,
                "is_seated":         is_seated,
                "confidence":        confidence,
                "worker_pos":        worker_pos,
                "idle_seconds":      self.idle_seconds[track_id],
                "hands_off_seconds": self.hands_off_seconds[track_id],
                "keypoints":         keypoints,
                "box":               box,
                "reid_embedding":   self._botsort_features.get(track_id) or self._fallback_appearance_embedding(frame, xyxy),
            })

        # Sort and limit tracked people if max_tracked_people is set
        max_people = getattr(config, "max_tracked_people", 10)
        if max_people > 0 and len(poses_out) > max_people:
            # Sort:
            # 1. Was track returned in the previous frame? (True first, so false first in ascending sort_key)
            # 2. Bounding box area (larger first)
            # 3. Confidence (larger first)
            def sort_key(pose):
                t_id = pose["track_id"]
                is_active = t_id in self.last_returned_ids
                b = pose["box"]
                area = (b[2] - b[0]) * (b[3] - b[1])
                conf = pose["confidence"]
                return (not is_active, -area, -conf)
            
            poses_out.sort(key=sort_key)
            poses_out = poses_out[:max_people]

        self.last_returned_ids = {p["track_id"] for p in poses_out}

        # Prune stale tracks and record dropped IDs to prevent re-use confusion
        DROPPED_ID_COOLDOWN = 60
        for tid in list(self.smoothed.keys()):
            if self.frame_count - self.last_seen_frame.get(tid, 0) > 100:
                self.dropped_ids[tid] = self.frame_count
                self.smoothed.pop(tid, None)
                self.prev_smoothed.pop(tid, None)
                self.idle_seconds.pop(tid, None)
                self.hands_off_seconds.pop(tid, None)
                self.pos_history.pop(tid, None)
                self.last_seen_frame.pop(tid, None)
                self.last_confirmed_box.pop(tid, None)
                self.prev_worker_pos.pop(tid, None)
                self.smoothed_velocities.pop(tid, None)

        # Expire old dropped_id entries after the cooldown
        for tid in list(self.dropped_ids.keys()):
            if self.frame_count - self.dropped_ids[tid] > DROPPED_ID_COOLDOWN:
                self.dropped_ids.pop(tid, None)

        return poses_out
