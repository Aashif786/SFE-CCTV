# Object Detection and Tracking Pipeline Configuration Guide

This document provides a comprehensive reference of all configurable parameters in the SFE-CCTV object detection and tracking pipeline. These parameters control the trade-offs between detection accuracy, tracking stability, latency, and system resource usage.

---

## 1. Object Detection Parameters (YOLO Pose Estimator)
These parameters are configured in the `WorkerDetector` initialization and update call inside [pose_detector.py](file:///home/zoro/~projects/caldim/SFE-CCTV/backend/src/detectors/pose_detector.py).

| Parameter Name | Code Location / Usage | Default Value | Recommended Tuning Range | Purpose & Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Model Checkpoint** | `YOLO("yolo11m-pose.pt")` | `yolo11m-pose.pt` | `yolo11n-pose.pt` to `yolo11x-pose.pt` | **Model Architecture:** Selects the model capacity. Larger models (e.g., `11m`, `11l`, `11x`) increase accuracy for small or distant objects but consume more GPU VRAM and increase latency. Smaller models (e.g., `11n`, `11s`) run much faster on lower-end hardware at the cost of detection confidence. |
| **Detection Confidence (`conf`)** | `self.model.track(..., conf=0.35)` | `0.35` | `0.20` to `0.50` | **Confidence Filtering:** Bounding boxes with a prediction confidence below this threshold are discarded.<br>• *Increase value:* Reduces false positive detections (e.g., mistaking background items for workers).<br>• *Decrease value:* Detects workers in low-light, blur, or heavily occluded states, but increases noise/flicker. |
| **NMS IoU Threshold (`iou`)** | `self.model.track(..., iou=0.8)` | `0.8` | `0.5` to `0.9` | **Non-Maximum Suppression:** Controls the overlap threshold for merging overlapping bounding boxes.<br>• *Increase value:* Prevents boxes from merging when two workers are in close proximity (e.g., shaking hands, walking close, crossing). Essential for collision handling.<br>• *Decrease value:* Aggressively merges overlapping boxes, which is useful if the model generates duplicate boxes for a single person. |
| **Inference Image Size (`imgsz`)** | `self.model.track(..., imgsz=1280)` | `1280` | `640` to `1280` (multiples of 32) | **Input Resolution:** Scales the video frames before feeding them to the neural network.<br>• *Increase value:* Substantially improves detection accuracy for workers far from the camera. Required for long-distance factory floor cameras.<br>• *Decrease value:* Reduces GPU load and boosts inference speed, but distant workers will fail to detect. |
| **Precision Mode** | Removed parameter `half=False` | `False` (FP32) | `False` (FP32) or `True` (FP16) | **Inference Precision:** Controls FP16 vs FP32 tensor computations.<br>• *FP32 (half=False):* Safest precision mode. Essential on Turing GPUs (like GTX 1650) to prevent NaN errors and zero-person detection failures.<br>• *FP16 (half=True):* Runs faster on Tensor Core GPUs, but is deprecated/removed in modern YOLO versions in favor of quantization. |
| **Keypoint Confidence Threshold** | `conf[yolo_idx] >= 0.35` | `0.35` | `0.20` to `0.50` | **Keypoint Visibility:** Validates individual joint keypoints (e.g., elbow, wrist, hip). Keypoints with confidence below this threshold are marked invalid (set to `[0.0, 0.0]`) to prevent skeletons from stretching or snapping to incorrect coordinates. |
| **EMA Smoothing Factor (`EMA_ALPHA`)** | `self.EMA_ALPHA = 0.65` | `0.65` | `0.40` to `0.85` | **Temporal Smoothing:** Weight of current frame's keypoint positions in Exponential Moving Average.<br>• *Increase value (e.g., 0.8):* Makes skeletons responsive to fast movement, but increases frame-to-frame keypoint jitter.<br>• *Decrease value (e.g., 0.5):* Stabilizes keypoints and eliminates jitter, but creates a trailing lag behind moving workers. |

---

## 2. Tracking Parameters (BoT-SORT Tracker)
These parameters are configured in [custom_tracker.yaml](file:///home/zoro/~projects/caldim/SFE-CCTV/backend/custom_tracker.yaml).

| Parameter Name | Default Value | Recommended Tuning Range | Purpose & Impact |
| :--- | :--- | :--- | :--- |
| **`tracker_type`** | `botsort` | Fixed (`botsort` or `bytetrack`) | **Tracker Backend:** BoT-SORT is selected because it integrates motion prediction (Kalman filtering), camera motion compensation, and visual appearance matching (Re-ID). |
| **`track_high_thresh`** | `0.35` | `0.20` to `0.50` | **First-Stage Association Threshold:** Detections with confidence above this value are used in the first matching pass using a combination of IoU distance and Re-ID similarity. Keep aligned with detector's `conf` value. |
| **`track_low_thresh`** | `0.1` | `0.05` to `0.20` | **Second-Stage Association Threshold:** Detections with confidence below `track_high_thresh` but above `track_low_thresh` (e.g., blurred or partially occluded workers) are associated solely based on spatial IoU to maintain track continuity. |
| **`new_track_thresh`** | `0.35` | `0.25` to `0.50` | **Track Confirmation Threshold:** Minimum confidence score required to confirm a new object track. High values prevent short-lived, transient false tracks from polluting the database. |
| **`track_buffer`** | `120` | `30` to `200` | **Lost Track Frame Budget (Max Age):** Number of frames to keep a lost track in memory. At 5 FPS, a value of 120 keeps the worker's ID active for 24 seconds, allowing them to step out of frame or remain occluded and recover their ID when they reappear. |
| **`match_thresh`** | `0.8` | `0.6` to `0.9` | **Matcher Distance Threshold:** The maximum cost allowed for a match to be accepted in the Hungarian algorithm (hungarian solver uses cost = 1 - similarity). A higher threshold (0.8) makes matching more permissive (allows tracks to match even if they move fast). |
| **`fuse_score`** | `True` | `True` or `False` | **Score Fusing:** Multiplies the spatial cost matrix by the detection confidence scores. This improves association stability by favoring matches with high-confidence detections. |
| **`gmc_method`** | `none` | `none` or `sparseOptFlow` | **Global Motion Compensation (GMC):** Compensates for camera movement (e.g. pan/tilt/zoom). Set to `none` for static CCTV cameras to save CPU/GPU resource overhead. |
| **`with_reid`** | `True` | `True` or `False` | **Appearance Matching:** Enables or disables extracting worker appearance embeddings to match tracks. If `False`, the tracker relies entirely on spatial IoU and motion prediction. |
| **`model`** | `auto` | `auto` or path to cls model | **Re-ID Feature Extractor:** `"auto"` extracts native visual features directly from the YOLO backbone, resulting in zero additional inference latency. Specifying a classification model path (e.g., `yolo11n-cls.pt`) uses a separate encoder. |
| **`proximity_thresh`** | `0.0` | `0.0` to `0.5` | **Re-ID Spatial Gate:** The minimum IoU required between a track prediction and a detection to allow Re-ID matching.<br>• *Setting to 0.0:* Fully disables spatial gating. Re-ID feature matching is evaluated even when spatial overlap is 0%. Essential for recovering identity after long occlusions or fast crossings.<br>• *Setting to 0.5:* Gated mode. Re-ID only runs if they overlap significantly. Not recommended for occlusion recovery. |
| **`appearance_thresh`** | `0.75` | `0.60` to `0.85` | **Re-ID Similarity Gate:** Controls how visually similar a worker must be to their saved track template to match. In the code, similarity distance must be $\le 1 - \text{appearance\_thresh}$ (which means Cosine Similarity must be $\ge 2 \cdot \text{appearance\_thresh} - 1$).<br>• *Setting to 0.75:* Requires Cosine Similarity of $\ge 0.5$. Prevents worker identity swaps in static uniform environments.<br>• *Setting to 0.5:* Allows Cosine Similarity of $\ge 0.0$ (very permissive, could trigger swaps). |

---

## 3. Typical Parameter Tuning Scenarios

### Scenario A: Identity Swaps Occurring (Workers swap track IDs when close)
1. **Increase `appearance_thresh`** in `custom_tracker.yaml` (e.g., from `0.75` to `0.80` or `0.85`). This requires higher visual similarity to associate, preventing cross-matching.
2. **Decrease `track_low_thresh`** (e.g., to `0.05` or `0.08`) to ensure lower confidence frames are matched under stage-two spatial association rather than starting new tracks.

### Scenario B: Track ID splits into a new ID after occlusion
1. **Increase `track_buffer`** in `custom_tracker.yaml` (e.g., from `120` to `180` or `240`) if the worker is occluded for a long time.
2. **Decrease `proximity_thresh`** to `0.0` if it was set higher, to allow Re-ID matching to run without spatial gating.
3. **Decrease `appearance_thresh`** slightly (e.g., from `0.8` to `0.7` or `0.75`) to make visual matching more permissive if lighting/pose changes drastically during occlusion.

### Scenario C: Jittery/Lagging Skeletons
1. If the skeleton lags behind the worker, **increase `EMA_ALPHA`** in `pose_detector.py` (e.g., from `0.65` to `0.80`).
2. If the skeleton flickers or vibrates while the worker is stationary, **decrease `EMA_ALPHA`** in `pose_detector.py` (e.g., from `0.65` to `0.50`).

### Scenario D: High GPU/CPU Utilization
1. **Decrease `imgsz`** in `pose_detector.py` (e.g., from `1280` to `960` or `640`) to scale down inputs before inference.
2. Change model checkpoint to a smaller variant (e.g., change `yolo11m-pose.pt` to `yolo11s-pose.pt`).

---

## Spatial Handoff Engine

Configure facility-wide handoffs in `spatial_handoff.json` (created from
`spatial_handoff.example.json` on first service start). Each facility declares
camera-local `ENTRY_PORTAL`/`EXIT_PORTAL` polygons and directed connections with
minimum/maximum transit windows. Camera names do not create links: only an
explicit connection does.

Use `GET`/`PUT /api/spatial-handoff/configuration` to manage the layout and
`GET /api/spatial-handoff/status` to inspect pending handoffs and explainable
match events. Runtime matching is restricted to cache entries connected to the
arriving entry portal and inside its transit window; it never runs a
facility-wide appearance search.
