# SFE-CCTV — Object Detection & Multi-Object Tracking Tuning Guide

> **Audience**: Backend developers, ML engineers, and DevOps teams responsible for deploying and maintaining the SFE-CCTV worker monitoring system.  
> **Goal**: Help practitioners confidently tune and optimise every layer of the pipeline — from raw YOLO inference to idle-detection thresholds — without needing to study the source code in depth.

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Object Detection — YOLO11 Pose](#2-object-detection--yolo11-pose)
3. [Pose Estimation & Keypoint Processing](#3-pose-estimation--keypoint-processing)
4. [Multi-Object Tracking — BoT-SORT](#4-multi-object-tracking--bot-sort)
5. [Re-Identification (ReID)](#5-re-identification-reid)
6. [Motion Analysis & Movement Score](#6-motion-analysis--movement-score)
7. [Activity & Idle Classification](#7-activity--idle-classification)
8. [Zone-Based Monitoring](#8-zone-based-monitoring)
9. [Identity Correlation Engine](#9-identity-correlation-engine)
10. [Tuning Scenarios](#10-tuning-scenarios)
11. [Troubleshooting Guide](#11-troubleshooting-guide)
12. [Best Practices](#12-best-practices)

---

## 1. Pipeline Overview

```
Camera Frame
     │
     ▼
┌─────────────────────────────────────────────┐
│  YOLO11m-pose  (object detection + pose)    │  ← Detects people & 17 body keypoints
└─────────────────────────────────────────────┘
     │  Bounding boxes + keypoints + confidence
     ▼
┌─────────────────────────────────────────────┐
│  BoT-SORT Tracker  (custom_tracker.yaml)    │  ← Assigns persistent Track IDs
│  Kalman Filter + Re-ID (backbone feats)     │
└─────────────────────────────────────────────┘
     │  track_id per person
     ▼
┌─────────────────────────────────────────────┐
│  Keypoint Post-Processing (pose_detector)   │  ← EMA smoothing, YOLO→MediaPipe map
└─────────────────────────────────────────────┘
     │  Smoothed 33-point skeleton
     ▼
┌─────────────────────────────────────────────┐
│  Movement Score Calculator                  │  ← Joints Δ-distance with dead-band
└─────────────────────────────────────────────┘
     │  movement_score, idle_seconds
     ▼
┌─────────────────────────────────────────────┐
│  Zone Lookup  (WorkstationZone DB)          │  ← Is hip centroid inside zone?
└─────────────────────────────────────────────┘
     │  inside: True/False
     ▼
┌─────────────────────────────────────────────┐
│  ActivityClassifier                         │  ← working / walking / idle / no_person
└─────────────────────────────────────────────┘
     │  Activity label
     ▼
┌─────────────────────────────────────────────┐
│  Identity Correlation Engine                │  ← Matches RFID/badge scan to track_id
└─────────────────────────────────────────────┘
     │  Employee ID ↔ Track ID
     ▼
Database (PostgreSQL) + WebSocket broadcast → Frontend
```

**Data flow notes:**
- Every camera has its own `WorkerDetector` instance (separate YOLO inference call per frame).
- `persist=True` in the YOLO track call ensures the Kalman filter state is retained across frames.
- The backbone-feature Re-ID hook fires once per frame and feeds appearance embeddings into BoT-SORT.
- `idle_seconds` is accumulated in-memory per `track_id`; it resets to 0 whenever `movement_score > movement_sensitivity`.

---

## 2. Object Detection — YOLO11 Pose

### Purpose
YOLO11 performs single-shot simultaneous **bounding-box detection** and **17-keypoint pose estimation** for every person in the frame. It also triggers the first stage of data association for tracking.

### File location
```
backend/src/detectors/pose_detector.py  →  WorkerDetector.__init__ / update()
```

### 2.1 Model Variant Selection

| Variant | File | Parameters | GPU Memory | FPS @ 1080p | Use Case |
|---|---|---|---|---|---|
| Nano | `yolo11n-pose.pt` | 2.9 M | ~1 GB | ~45 | Raspberry Pi, USB cameras |
| Small | `yolo11s-pose.pt` | 9.9 M | ~2 GB | ~35 | Entry-level NVIDIA GPU |
| **Medium (default)** | **`yolo11m-pose.pt`** | **20.9 M** | **~3 GB** | **~20** | **GTX 1650, RTX 3060** |
| Large | `yolo11l-pose.pt` | 26.2 M | ~4 GB | ~12 | RTX 3070+ |
| X-Large | `yolo11x-pose.pt` | 58.8 M | ~7 GB | ~7 | Data-centre inference |

**Tuning strategy:**
- Start with `yolo11m-pose.pt` (the current default) for most CCTV deployments.
- If workers appear small in frame (far camera) or you need better keypoint accuracy for fine-grained motion, upgrade to `yolo11l-pose.pt`.
- If the system is GPU-bound (FPS drops below 10), downgrade to `yolo11s-pose.pt`.
- **Never use `yolo11n-pose.pt`** for multi-person scenes with occlusions — keypoint accuracy degrades significantly.

**How to change:**
```python
# pose_detector.py  →  WorkerDetector.__init__
self.model = YOLO("yolo11m-pose.pt")   # ← change filename here
```

---

### 2.2 Detection Confidence Threshold (`conf`)

| Property | Value |
|---|---|
| **Parameter** | `conf` in `self.model.track(...)` |
| **Default** | `0.35` |
| **Valid range** | `0.05` – `0.95` |
| **File** | `pose_detector.py`, line 73 |

**What it does:** Bounding boxes whose prediction confidence is below this value are silently discarded before tracking.

| Direction | Effect |
|---|---|
| Increase (→ 0.50) | Fewer false positives. Misses workers in low-light, motion blur, partial occlusion. |
| Decrease (→ 0.20) | Detects more workers. Introduces ghost detections from reflections or equipment. |

**Recommended by scenario:**
- Dense floor with many overlapping workers: `0.30` (catch partially occluded workers)
- High-contrast, well-lit factory: `0.45`
- Low-light CCTV: `0.20`–`0.25`
- Outdoors / high-vibration camera: `0.40`

**Common mistake:** Setting `conf` and `track_high_thresh` to very different values. Keep them aligned (within ±0.05) to avoid detections that pass the detector but fail tracker association.

---

### 2.3 NMS IoU Threshold (`iou`)

| Property | Value |
|---|---|
| **Parameter** | `iou` in `self.model.track(...)` |
| **Default** | `0.8` |
| **Valid range** | `0.3` – `0.95` |
| **File** | `pose_detector.py`, line 74 |

**What it does:** Controls when two overlapping bounding boxes are merged into one via Non-Maximum Suppression (NMS). Two boxes are merged only if their overlap exceeds `iou`.

| Direction | Effect |
|---|---|
| Increase (→ 0.9) | Keeps separate boxes for workers in very close proximity (handshake, crossing). Prevents track loss. May create duplicate detections for a single person if YOLO produces near-duplicate boxes. |
| Decrease (→ 0.5) | Aggressively merges nearby boxes. Prevents duplicates. Causes track loss during physical contact. |

**Recommended by scenario:**
- Dense crowd / factory floor crossings: `0.80`–`0.85`
- Sparse workspace: `0.65`–`0.75`
- Wide-angle camera with large workers in frame: `0.70`

---

### 2.4 Inference Image Size (`imgsz`)

| Property | Value |
|---|---|
| **Parameter** | `imgsz` in `self.model.track(...)` |
| **Default** | `1280` |
| **Valid range** | `320` – `1920` (multiples of 32) |
| **File** | `pose_detector.py`, line 75 |

**What it does:** Resizes every input frame to this square size before feeding to the neural network. Higher resolution preserves more spatial detail, enabling detection of smaller/distant workers.

| Direction | Effect |
|---|---|
| Increase (→ 1920) | Detects workers 10+ m from camera with accurate keypoints. GPU VRAM and inference time roughly double. |
| Decrease (→ 640) | Inference speed 2-4× faster. Workers farther than 5 m from camera may disappear entirely. |

**GPU memory vs. accuracy trade-off:**

| `imgsz` | Relative Speed | Detection at 10 m |
|---|---|---|
| 640 | 4× | Poor |
| 960 | 2× | Adequate |
| **1280** | **1× (baseline)** | **Good** |
| 1920 | 0.5× | Excellent |

**Recommended by scenario:**
- High-ceiling warehouses / large camera FoV: `1280` or `1920`
- Close-up assembly-line cameras: `640`–`960`
- Low-end GPU (GTX 1050 or less): `640`

---

### 2.5 Precision Mode

| Property | Value |
|---|---|
| **Parameter** | `half` (removed from track call) |
| **Default** | FP32 (equivalent to `half=False`) |
| **File** | `pose_detector.py`, line 69–77 |

**Critical note for GTX 1650 and Turing architecture GPUs:** PyTorch CUDA FP16 on Turing GPUs produces `NaN` values during inference, causing YOLO to return 0 detections. **Always use FP32 (the default) on GTX 1650/1660/RTX 2060.** Upgrade to quantization if speed is critical: pass `model.to(torch.float16)` only if on Ampere/Ada GPUs (RTX 30xx/40xx).

---

## 3. Pose Estimation & Keypoint Processing

### Purpose
Converts YOLO's raw 17-keypoint format to a 33-keypoint MediaPipe-compatible skeleton, filters invalid keypoints by confidence, and applies temporal smoothing to stabilise the skeleton display.

### File location
```
backend/src/detectors/pose_detector.py  →  WorkerDetector.update()
```

---

### 3.1 Keypoint Confidence Threshold

| Property | Value |
|---|---|
| **Parameter** | Hardcoded `0.35` in YOLO_TO_MP mapping loop |
| **Default** | `0.35` |
| **Valid range** | `0.10` – `0.70` |
| **File** | `pose_detector.py`, line 103 |

**What it does:** Each of YOLO's 17 joint predictions comes with a per-joint confidence. If a joint's confidence is below this threshold, its coordinates are set to `[0.0, 0.0]` (invalid marker), preventing ghost skeleton connections.

| Direction | Effect |
|---|---|
| Increase (→ 0.50) | Only high-confidence joints are drawn. Skeleton looks cleaner but will have missing limbs for occluded workers. Movement score uses fewer joints (less noise but potentially misses real movement). |
| Decrease (→ 0.15) | More skeleton joints appear. Risk of wild joint positions when YOLO is uncertain (e.g. arm hidden behind body). |

**Common mistake:** Setting this threshold very low on wide-angle cameras. YOLO is often uncertain about joints on distant workers, and low threshold causes skeleton "tendrils" shooting across the frame.

---

### 3.2 EMA Smoothing Factor (`EMA_ALPHA`)

| Property | Value |
|---|---|
| **Parameter** | `self.EMA_ALPHA` |
| **Default** | `0.65` |
| **Valid range** | `0.20` – `0.95` |
| **File** | `pose_detector.py`, line 51 |

**What it does:** Each keypoint's displayed position is a weighted blend of the current-frame raw position and the previous smoothed position:
```
smoothed[t] = ALPHA × raw[t] + (1 − ALPHA) × smoothed[t−1]
```

| Direction | Effect |
|---|---|
| Increase (→ 0.85) | Skeleton tracks real movement quickly. More frame-to-frame jitter when person is stationary. |
| Decrease (→ 0.40) | Skeleton is very stable when stationary. Trails behind fast movement — creates a "ghosting" effect. May cause false-idle classifications for fast workers. |

**Recommended by scenario:**
- Workers on a slow assembly line (fine-motor tasks): `0.50`–`0.60`
- Warehouse workers walking quickly: `0.70`–`0.80`
- Balance for general use (default): `0.65`

---

### 3.3 Stale Track Pruning Window

| Property | Value |
|---|---|
| **Parameter** | `100` (frames) hardcoded in pruning loop |
| **Default** | `100 frames` (~20 s at 5 FPS) |
| **File** | `pose_detector.py`, line 220 |

**What it does:** If a track_id hasn't been seen for 100 frames, its smoothing history and idle accumulator are deleted from memory. This prevents unbounded memory growth.

**Interaction with `track_buffer`:** `track_buffer` (BoT-SORT) decides how long a *track* is kept alive. The pruning window here is larger — it only frees Python-side state after BoT-SORT has already dropped the track. Keep pruning window > `track_buffer` always.

---

## 4. Multi-Object Tracking — BoT-SORT

### Purpose
BoT-SORT (Boobs-of-Track SORT) is a tracking algorithm that assigns a persistent integer `track_id` to each detected person across frames. It combines:
1. **Kalman filter** — predicts where each person will be in the next frame.
2. **IoU-based matching** — associates new detections to predictions by spatial overlap.
3. **Re-ID embedding** — uses visual appearance features to re-identify workers who return after occlusion.

### File location
```
backend/custom_tracker.yaml    ← all tracker parameters
```

---

### 4.1 Parameter Reference Table

| Parameter | Default | Range | Purpose |
|---|---|---|---|
| `tracker_type` | `botsort` | fixed | Tracker backend |
| `track_high_thresh` | `0.35` | `0.15`–`0.60` | First-stage detection confidence gate |
| `track_low_thresh` | `0.10` | `0.05`–`0.25` | Second-stage low-confidence gate |
| `new_track_thresh` | `0.35` | `0.20`–`0.60` | Minimum confidence to start a new track |
| `track_buffer` | `120` | `15`–`300` | Max frames to keep a lost track alive |
| `match_thresh` | `0.80` | `0.50`–`0.95` | Max association cost allowed |
| `fuse_score` | `True` | bool | Fuse detection score into cost matrix |
| `gmc_method` | `none` | `none` / `sparseOptFlow` | Global motion compensation |
| `with_reid` | `True` | bool | Enable visual appearance Re-ID |
| `model` | `auto` | `auto` / model path | Re-ID feature extractor source |
| `proximity_thresh` | `0.0` | `0.0`–`0.7` | Min IoU to gate Re-ID evaluation |
| `appearance_thresh` | `0.75` | `0.40`–`0.95` | Min appearance cosine similarity |

---

### 4.2 `track_high_thresh`

**What it does:** Detections whose YOLO confidence is ≥ `track_high_thresh` are used in the **first** (primary) association pass. They are matched to active tracks using the full cost matrix (IoU + Re-ID).

| Direction | Effect |
|---|---|
| Increase (→ 0.50) | Only very confident detections trigger first-pass matching. In crowded scenes, workers who are partially occluded but detected with 0.35–0.45 confidence get skipped in round 1 and may start new tracks. |
| Decrease (→ 0.20) | More detections enter round 1. Risk: low-confidence ghost detections (furniture reflections) could corrupt track histories. |

**Keep aligned with detector `conf`** — if you set `conf=0.30` in the track call, set `track_high_thresh: 0.30` here as well.

---

### 4.3 `track_low_thresh`

**What it does:** Detections with confidence between `track_low_thresh` and `track_high_thresh` are reserved for the **second** (recovery) association pass. They are matched only to tracks that were *not* matched in round 1, using IoU-only (no Re-ID).

**Critical for occlusion:** When two workers cross, the partially-visible person may have confidence ~0.20. If `track_low_thresh` is above that, the detection is completely discarded, causing track loss. Setting it to `0.10` ensures these detections still participate in the fallback association.

| Direction | Effect |
|---|---|
| Increase (→ 0.20) | Cleaner tracks (fewer spurious second-pass associations). May drop barely-visible workers during crossings. |
| Decrease (→ 0.05) | More permissive — tracks near-invisible workers. Risk of associating background noise to real tracks. |

---

### 4.4 `new_track_thresh`

**What it does:** An unmatched detection (no existing track matched it) starts a new track *only* if its confidence ≥ `new_track_thresh`.

| Direction | Effect |
|---|---|
| Increase (→ 0.50) | Fewer spurious new tracks from transient false detections (a chair leg, a reflection). |
| Decrease (→ 0.20) | Every detection immediately starts a track, including short-lived false positives. |

**Recommended:** Keep at `0.35` unless there are frequent ghost detections — in that case raise to `0.45`.

---

### 4.5 `track_buffer` (Max Age / Lost Track Lifetime)

**What it does:** When a worker leaves the field of view or becomes fully occluded, their track enters "lost" state. `track_buffer` is the number of frames the track is kept alive in this state. If they reappear within this window, they recover their original ID without generating a new one.

**Frame-rate dependency:** At 5 FPS, `track_buffer=120` = 24 seconds. At 15 FPS it is only 8 seconds. **Always calculate in seconds:**
```
track_buffer = desired_recovery_seconds × FPS
```

| Direction | Effect |
|---|---|
| Increase (→ 200) | Workers can disappear for longer and recover their ID. More memory consumed for storing lost tracks. Increases risk of a "zombie" track being incorrectly re-activated. |
| Decrease (→ 30) | Tracks expire quickly. Workers returning after 6 s get a new ID. Less memory use. |

**Recommended by scenario:**
- Workers leaving camera temporarily: `120`–`180`
- Fast-moving workers constantly in frame: `60`
- Low-memory embedded hardware: `30`–`60`

---

### 4.6 `match_thresh`

**What it does:** The Hungarian matching algorithm computes a cost matrix (1 - similarity). A pair is only accepted if its cost is ≤ `match_thresh`. Higher value = more permissive matching.

| Direction | Effect |
|---|---|
| Increase (→ 0.90) | Tracks can match detections even after fast movement or pose change. Risk of cross-matching workers who are close together. |
| Decrease (→ 0.60) | Strict matching only. Workers who move quickly between frames may not match their previous track. |

---

### 4.7 `fuse_score`

**What it does:** Multiplies the IoU cost matrix element-wise by `(1 - detection_confidence)`. This gives preference to matches involving high-confidence detections.

- **`True` (default):** Stabilises tracking when two candidate detections compete for the same track. The more-confident one wins.
- **`False`:** Purely geometric IoU matching. Useful if detection confidence is unstable (very dark scenes).

---

### 4.8 `gmc_method`

**What it does:** Global Motion Compensation (GMC) compensates for camera movement (panning, vibration) by warping the Kalman filter predictions to account for the global motion vector.

- **`none` (default):** No compensation. **Required for static CCTV.** GMC with static cameras wastes CPU and introduces tracking noise.
- **`sparseOptFlow`:** Lucas-Kanade optical flow for motion estimation. Use only on PTZ cameras or cameras subject to mechanical vibration.

**Never set to `sparseOptFlow` on a static camera** — it will compute a near-zero flow vector every frame at significant CPU cost.

---

## 5. Re-Identification (ReID)

### Purpose
Re-ID extracts a visual "fingerprint" (embedding vector) from each detected person's bounding box. When a track is lost and the person reappears, their embedding is compared to the stored track embedding to decide if it is the same person.

### How it works in this project
With `model: auto`, no separate Re-ID model is downloaded. Instead, a forward hook is registered on YOLO's last detection head (`Detect` layer). The feature maps flowing into the detection head serve directly as appearance embeddings. This gives:
- ✅ Zero additional inference latency
- ✅ No separate model download
- ⚠️ Lower embedding quality than a purpose-trained OSNet/ResNet-ReID model

### 5.1 `proximity_thresh` (Re-ID Spatial Gate)

| Property | Value |
|---|---|
| **Parameter** | `proximity_thresh` in `custom_tracker.yaml` |
| **Default** | `0.0` |
| **Valid range** | `0.0` – `0.7` |

**The code in `bot_sort.py`:**
```python
dists_mask = dists > (1 - self.proximity_thresh)
# If IoU distance > (1 - proximity_thresh), mask out Re-ID for this pair
emb_dists[dists_mask] = 1.0  # Re-ID disabled for low-IoU pairs
```

**What it does:** If `proximity_thresh = 0.5`, Re-ID is only evaluated when spatial IoU ≥ 50%. If `proximity_thresh = 0.0`, Re-ID is always evaluated regardless of spatial overlap.

| Direction | Effect |
|---|---|
| Increase (→ 0.5) | Re-ID only fires when a worker re-appears near their predicted location. Efficient but **breaks identity recovery after long occlusions** where the person reappears far from prediction. |
| 0.0 (current) | Re-ID always fires. Recovery works even after fully spatial-disassociated returns. Slight cost: comparisons happen between all track/detection pairs regardless of distance. |

**When to raise above 0:**
- If you observe frequent cross-identity swaps between workers on opposite sides of the frame (distance > 5 m), raise to `0.3`. This prevents the Re-ID from incorrectly linking a new person near camera edge to a lost track near the opposite edge.

---

### 5.2 `appearance_thresh` (Re-ID Similarity Gate)

| Property | Value |
|---|---|
| **Parameter** | `appearance_thresh` in `custom_tracker.yaml` |
| **Default** | `0.75` |
| **Valid range** | `0.40` – `0.95` |

**The code in `bot_sort.py`:**
```python
emb_dists[emb_dists > (1 - self.appearance_thresh)] = 1.0
```
This means: if the **cosine distance** > `(1 - appearance_thresh)`, the Re-ID link is rejected.

Since `distance = 1 − cosine_similarity`, the threshold translates as:
```
appearance_thresh = 0.75  →  reject if cosine_similarity < 0.50
```

| Direction | Effect |
|---|---|
| Increase (→ 0.85) | Requires 70% cosine similarity to accept a Re-ID link. Prevents workers in similar uniforms from swapping IDs. May cause identity loss after lighting changes or large pose transitions. |
| Decrease (→ 0.55) | Accepts Re-ID links with only 10% similarity. Very permissive — workers who disappear long-term are often re-linked even if different people. |

**Recommended by scenario:**
- Workers in identical uniforms/PPE: `0.80`–`0.85`
- Varied clothing (office environment): `0.65`–`0.70`
- Single-person camera (one worker per view): can lower to `0.60`

---

### 5.3 Using a Dedicated ReID Model

For higher Re-ID quality (important when workers wear identical uniforms), replace `model: auto` with a dedicated person Re-ID model:

```yaml
# custom_tracker.yaml
model: yolo26n-reid.onnx   # lightweight ONNX Re-ID model (auto-downloaded)
```

Available Ultralytics ReID models: `yolo26n-reid.onnx`, `yolo26s-reid.onnx`, `yolo26m-reid.onnx`.

**Trade-off:** Each frame requires an additional inference pass through the ReID network, adding ~5–15 ms per frame depending on model size and GPU.

---

## 6. Motion Analysis & Movement Score

### Purpose
Quantifies how much a worker's body is moving between consecutive frames. This score drives the **idle/active** classification.

### How it works
Five joints are tracked (defined in `TRACKED_JOINTS = [0, 15, 16, 27, 28]` → nose, left/right ankle, left/right wrist):

```python
for j in TRACKED_JOINTS:
    d = dist(smoothed[j], prev_smoothed[j])
    if d > dead_band:
        movement_score += d
```

The movement score is the **sum of position deltas** (in normalised frame coordinates 0–1) across all tracked joints, ignoring deltas smaller than `dead_band`.

### 6.1 Tracked Joints

| Index (MediaPipe) | Joint | Rational |
|---|---|---|
| 0 | Nose | Head movement (nodding, turning) |
| 15 | L Wrist | Arm/hand work |
| 16 | R Wrist | Arm/hand work |
| 27 | L Ankle | Walking detection |
| 28 | R Ankle | Walking detection |

**To add more joints:** Edit `TRACKED_JOINTS` in `pose_detector.py`. Adding hips (23, 24) captures torso rotation. Adding shoulders (11, 12) captures reaching/leaning.

---

### 6.2 Dead-Band Filter

**What it does:** Prevents micro-tremors and YOLO's natural keypoint jitter from registering as movement. Only joint deltas larger than `dead_band` contribute to `movement_score`.

```python
box_h_norm = max(s[1] for s in smoothed) - min(s[1] for s in smoothed)
dead_band = max(0.001, min(0.008, 0.008 * box_h_norm))
```

The dead-band **scales with the worker's apparent height** in the frame. A distant worker occupies fewer pixels, so their normalised joint positions fluctuate more — a larger dead-band prevents false activity readings for distant workers.

**To make idle detection more sensitive** (detects subtle wrist movement):
```python
# Reduce maximum dead-band value
dead_band = max(0.0005, min(0.004, 0.004 * box_h_norm))
```

**To reduce false activity readings** (noisy camera, vibration):
```python
# Increase dead-band
dead_band = max(0.002, min(0.015, 0.015 * box_h_norm))
```

---

### 6.3 Idle Seconds Accumulator

**What it does:** `idle_seconds[track_id]` is incremented by 0.2 every frame where `movement_score ≤ movement_sensitivity`. It resets to 0.0 whenever movement is detected.

**Hardcoded frame time:** The `+0.2` increment assumes ~5 FPS. If your server runs at a different frame rate, update this value:
```python
# pose_detector.py line 192
self.idle_seconds[track_id] += (1.0 / TARGET_FPS)
```

---

## 7. Activity & Idle Classification

### Purpose
Maps the per-frame signals (movement score, zone membership, pose confidence) into one of four activity labels: `working`, `walking`, `idle`, `no_person`.

### File location
```
backend/src/activity/classifier.py
backend/src/config.py  ← runtime-configurable thresholds
```

### Decision Logic
```
if not has_pose           → "no_person"
if movement > sensitivity AND inside zone  → "working"
if movement > sensitivity AND outside zone → "walking"
else                      → "idle"
```

---

### 7.1 `movement_sensitivity`

| Property | Value |
|---|---|
| **Parameter** | `config.movement_sensitivity` |
| **Default** | `0.05` |
| **Valid range** | `0.01` – `0.30` |
| **File** | `config.py`, line 7 |
| **API endpoint** | `POST /api/settings` |

**What it does:** The threshold that separates "has movement" from "idle". `movement_score > movement_sensitivity` → active.

A `movement_score` of `0.05` roughly corresponds to a tracked joint moving ~5% of the frame width between consecutive frames.

| Direction | Effect |
|---|---|
| Increase (→ 0.15) | Only vigorous movement counts as active. Workers doing fine-motor assembly tasks (small hand movements) will be classified as idle even when working. |
| Decrease (→ 0.01) | Even very subtle movements (breathing, micro-sway) count as active. High false-positive rate — workers standing perfectly still are hard to classify as idle. |

**Recommended by scenario:**
- Fine-motor assembly (PCB soldering, watch repair): `0.02`–`0.03`
- General manufacturing (packaging, sorting): `0.05` (default)
- Warehouse (walking, heavy lifting): `0.08`–`0.12`
- Security guard / reception (mostly stationary): `0.02`

**How to update at runtime (no server restart needed):**
```bash
curl -X POST http://localhost:8001/api/settings \
  -H "Content-Type: application/json" \
  -d '{"idle_threshold_seconds": 10, "movement_sensitivity": 0.03, "confidence_threshold": 0.5}'
```

---

### 7.2 `idle_threshold_seconds`

| Property | Value |
|---|---|
| **Parameter** | `config.idle_threshold_seconds` |
| **Default** | `10.0` |
| **Valid range** | `3.0` – `120.0` |
| **File** | `config.py`, line 6 |
| **API endpoint** | `POST /api/settings` |

**What it does:** The number of continuous idle seconds before an alert is generated and the UI shows the worker as "Idle" with a warning.

| Direction | Effect |
|---|---|
| Increase (→ 30 s) | Allows longer natural breaks (drinking water, reading a document) before alerting. Reduces alert noise. |
| Decrease (→ 5 s) | Very aggressive idle detection. High false positive rate for workers who pause momentarily between tasks. |

**Recommended by scenario:**
- Production line (minimal breaks allowed): `10`–`15 s`
- QC inspection (natural pauses): `20`–`30 s`
- Office environment: `60`–`120 s`

---

### 7.3 `confidence_threshold` (Pose Quality Gate)

| Property | Value |
|---|---|
| **Parameter** | `config.confidence_threshold` |
| **Default** | `0.50` |
| **Valid range** | `0.20` – `0.90` |
| **File** | `config.py`, line 8 |
| **API endpoint** | `POST /api/settings` |

**What it does:** The average visibility score of key landmarks (both shoulders, both hips, both wrists) must exceed this value; otherwise the detection is flagged as `unknown` quality. Used by the UI to decide whether to show a confidence badge.

**This does not** affect detection or tracking directly — it is a display and logging filter.

| Direction | Effect |
|---|---|
| Increase (→ 0.80) | Only shows workers with well-lit, unoccluded bodies. More "unknown" classifications. |
| Decrease (→ 0.25) | Shows workers even when most joints are obscured. Classification may be noisy. |

---

## 8. Zone-Based Monitoring

### Purpose
Each camera has an optional **workstation zone** — a rectangular region of the frame (in normalised 0–1 coordinates). The worker's **hip centroid** is checked against this zone to determine:
- `inside=True` + `movement=True` → `working`
- `inside=False` + `movement=True` → `walking`

### File location
```
backend/src/main.py  →  _get_zone_for_camera()
backend/src/activity/classifier.py  →  ActivityClassifier._inside_zone()
```

### 8.1 Zone Configuration

Zones are stored in PostgreSQL (`workstation_zones` table) and fetched per-camera at runtime.

**Set via API:**
```bash
# Set zone for camera "assembly_line_a"
# Coordinates: x_min, y_min, x_max, y_max (0.0 to 1.0, normalised to frame size)
curl -X POST http://localhost:8001/api/zones/assembly_line_a \
  -H "Content-Type: application/json" \
  -d '{"x_min": 0.2, "y_min": 0.1, "x_max": 0.8, "y_max": 0.9}'
```

**Default (no zone set):** `(0.0, 0.0, 1.0, 1.0)` — full frame. All movement classifies as `working`.

### 8.2 Zone Design Guidelines

| Principle | Recommendation |
|---|---|
| **Coverage** | Zone should cover the entire workstation, not just the machine. Workers step back and reach sideways. |
| **Margins** | Leave 10–15% padding inside the frame edges — workers near the camera edge produce noisy hip coordinates. |
| **Multiple zones** | Currently, one zone per camera is supported. For cameras covering multiple workstations, deploy one logical camera stream per workstation, or extend the zone model to support multiple zones per camera. |
| **Tall workers** | Hip centroid y-coordinate may be higher than expected. Verify zone boundaries capture the hip position range for all worker heights. |

### 8.3 Zone Assignment Logic

The worker's position is computed from the **average of the left and right hip keypoints** (MediaPipe indices 23 and 24):
```python
worker_pos = ((smoothed[23][0] + smoothed[24][0]) / 2,
              (smoothed[23][1] + smoothed[24][1]) / 2)
```

If either hip keypoint is invalid (`[0.0, 0.0]`), `worker_pos` will be incorrect. In this case `worker_pos = None` and the classifier defaults to `inside=True` (conservative: assumes worker is at their station).

**To fix hip keypoint loss:**
- Ensure camera height and angle provide a clear view of the hip region.
- Lower the keypoint confidence threshold slightly (`0.25`–`0.30`).

### 8.4 Zone Transition Handling

There is no hysteresis (dead-band) on zone transitions. A worker stepping in/out of the zone boundary will switch activity labels on every frame. This can cause rapid `working`/`walking` toggling at the boundary.

**To add hysteresis manually**, modify `_inside_zone()` to use a shrunk inner boundary for "going idle" and the full boundary for "becoming active". This is not currently implemented but is straightforward to add.

---

## 9. Identity Correlation Engine

### Purpose
Links physical workers (identified by RFID badge, NFC, barcode scan, or REST push) to the camera's `track_id`. This allows the system to display employee names on the camera feed and log activity against employee IDs.

### File location
```
backend/src/identity/correlation.py  →  CorrelationEngine
backend/src/config.py  →  correlation_window_seconds
```

### 9.1 `correlation_window_seconds`

| Property | Value |
|---|---|
| **Parameter** | `config.correlation_window_seconds` |
| **Default** | `5.0` |
| **Valid range** | `1.0` – `30.0` |
| **File** | `config.py`, line 10 |

**What it does:** Maximum time difference between an identity event timestamp (badge scan) and a camera entry event (new track detected) for them to be considered the same physical entry.

**Algorithm:**
1. Identity event (badge scan) is added to a pending queue with status `WAITING_FOR_TRACK`.
2. When a new track appears, the engine scans pending events for the earliest whose timestamp falls within `correlation_window_seconds` of the track's detection time.
3. If matched, the track gets an employee ID.

| Direction | Effect |
|---|---|
| Increase (→ 15 s) | Workers with slow badge readers or who badge-in then pause before entering frame are still matched. Risk: a second worker entering shortly after may get matched to the wrong identity event. |
| Decrease (→ 2 s) | Only very-near-simultaneous events match. Requires precise synchronisation between badge hardware clocks and server clock. |

**Common problem:** Clocks between badge reader and server are not synchronised. Fix: use NTP on all devices, or increase the window and use a closer-match priority algorithm.

---

## 10. Tuning Scenarios

### 10.1 Dense Manufacturing Floor (High Crowd Density)
```yaml
# custom_tracker.yaml
track_high_thresh: 0.30   # catch partially occluded workers
track_low_thresh: 0.08    # maximise second-pass recovery
new_track_thresh: 0.30    # confirm tracks quickly
track_buffer: 150         # allow long occlusions during crossings
match_thresh: 0.85        # permissive spatial match for overlapping workers
proximity_thresh: 0.0     # always attempt Re-ID
appearance_thresh: 0.80   # strict appearance (identical PPE risk)
```
```python
# pose_detector.py model.track(...)
conf=0.30, iou=0.85, imgsz=1280
EMA_ALPHA=0.60
```
```python
# config.py
movement_sensitivity=0.05
idle_threshold_seconds=15.0
```

### 10.2 Sparse Workspace (Few Workers, Wide Camera FoV)
```yaml
track_high_thresh: 0.45
track_low_thresh: 0.15
new_track_thresh: 0.40
track_buffer: 90
match_thresh: 0.75
proximity_thresh: 0.3     # spatial gating OK — workers not close
appearance_thresh: 0.70
```
```python
conf=0.40, iou=0.70, imgsz=960
EMA_ALPHA=0.65
movement_sensitivity=0.05
```

### 10.3 Frequent Worker Occlusions
```yaml
track_buffer: 180          # 36 s at 5 FPS
proximity_thresh: 0.0      # mandatory — spatial overlap is 0 post-occlusion
appearance_thresh: 0.75
match_thresh: 0.85
```

### 10.4 Fast-Moving Workers
```yaml
match_thresh: 0.88         # permit large bounding box jumps
track_high_thresh: 0.35
```
```python
EMA_ALPHA=0.80             # skeleton tracks fast movement quickly
movement_sensitivity=0.10  # higher threshold to avoid false activity on jitter
```

### 10.5 Low-Light / Night Shift
```python
conf=0.20              # catch weak detections
imgsz=1280             # preserve spatial detail
EMA_ALPHA=0.55         # smoother skeleton (more jitter in dark scenes)
movement_sensitivity=0.03  # lower threshold (less body movement visible in dark)
```
```yaml
track_high_thresh: 0.20
appearance_thresh: 0.65    # lower — appearance quality degrades in low light
```

### 10.6 Low-Resolution CCTV (720p or Below)
```python
imgsz=640              # no benefit from upscaling beyond native resolution
conf=0.25              # lower to compensate for resolution loss
EMA_ALPHA=0.55         # more smoothing (low-res = more keypoint noise)
```
```yaml
track_high_thresh: 0.25
appearance_thresh: 0.65    # lower — appearance embeddings are lower quality
```

### 10.7 High-Resolution Cameras (4K)
```python
imgsz=1280             # still optimal — YOLO doesn't benefit much above 1280
                       # unless workers are < 0.5% of frame area
conf=0.40              # high confidence available at high resolution
EMA_ALPHA=0.70
```

### 10.8 Embedded / Edge Hardware (Low GPU)
```python
# Switch to smaller model:
self.model = YOLO("yolo11n-pose.pt")   # or yolo11s-pose.pt
imgsz=640
conf=0.35
```
```yaml
with_reid: False       # disable Re-ID to save compute
gmc_method: none       # already none
track_buffer: 60       # less memory
```

---

## 11. Troubleshooting Guide

### 11.1 Frequent ID Switching (Workers Keep Getting New IDs)

**Symptoms:** Track IDs change every few frames. Workers who are in continuous view get 5–10 different IDs per minute.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| Re-ID spatial gate is too strict | `proximity_thresh` | Set to `0.0` |
| Appearance threshold too strict | `appearance_thresh` | Decrease to `0.65`–`0.70` |
| Lost tracks expire too quickly | `track_buffer` | Increase to `120`–`180` |
| Detection confidence too low | `conf` | Increase to `0.40`; some frames are producing phantom detections that fragment tracks |
| `match_thresh` too low | `match_thresh` | Increase to `0.85` |

---

### 11.2 Lost Tracks After Occlusion

**Symptoms:** When two workers cross, one or both get a new ID after separating.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| Re-ID spatial gate prevents matching | `proximity_thresh` | Must be `0.0` |
| Appearance match too strict | `appearance_thresh` | Decrease to `0.70` |
| Low-confidence box during crossing not matched | `track_low_thresh` | Decrease to `0.08`–`0.10` |
| NMS merges both workers into one box | `iou` | Increase to `0.80`–`0.85` |

---

### 11.3 False Idle Detections

**Symptoms:** Worker is actively typing/assembling but is classified as idle.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| `movement_sensitivity` too high | `movement_sensitivity` | Decrease to `0.02`–`0.03` |
| Wrong joints tracked | `TRACKED_JOINTS` | Add wrist joints (15, 16); verify they are included |
| Wrist keypoints have low confidence | Keypoint threshold (`0.35`) | Decrease to `0.25` |
| EMA smoothing too aggressive | `EMA_ALPHA` | Increase to `0.70`–`0.75` (less temporal lag) |
| Worker's hands below camera level | Camera angle | Raise camera or tilt downward |

---

### 11.4 Missed Detections

**Symptoms:** Workers visible to the human eye are not detected.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| Confidence too high | `conf` | Decrease to `0.20`–`0.25` |
| Image resolution too low | `imgsz` | Increase to `1280` |
| Model too small for scene | Model variant | Upgrade to `yolo11m-pose.pt` or `yolo11l-pose.pt` |
| Workers appear < 80 px tall in frame | Camera placement | Move camera closer or increase `imgsz` |
| FP16 NaN bug (GTX 1650) | `half=False` | Ensure `half` param is removed from `model.track()` |

---

### 11.5 Duplicate Tracks (Two IDs for Same Person)

**Symptoms:** One visible worker has two bounding boxes with different track IDs.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| NMS too permissive | `iou` | Decrease to `0.65`–`0.70` |
| `new_track_thresh` too low | `new_track_thresh` | Increase to `0.45` |
| `match_thresh` too high | `match_thresh` | Decrease to `0.70` |

---

### 11.6 Flickering Detections

**Symptoms:** Bounding boxes appear/disappear on consecutive frames for the same worker.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| `conf` near detection confidence | `conf` | Decrease by `0.05` |
| `track_high_thresh` too close to detection score | `track_high_thresh` | Decrease to `0.05` below `conf` |
| Camera frame rate too low | Hardware / streaming | Improve camera FPS; `track_buffer` acts as buffer |
| Low `track_buffer` causes rapid expire | `track_buffer` | Increase to `90`–`120` |

---

### 11.7 High CPU/GPU Usage / Low FPS

**Causes and fixes:**

| Cause | Fix |
|---|---|
| `imgsz=1280` on weak GPU | Reduce to `640`–`960` |
| Large YOLO model | Switch to `yolo11s-pose.pt` |
| Re-ID on every frame with slow GPU | Set `with_reid: False` |
| `gmc_method: sparseOptFlow` on static camera | Set `gmc_method: none` |
| Multiple cameras on one GPU | Stagger inference calls; consider multi-GPU setup |
| No GPU available | Ensure CUDA is installed; check `torch.cuda.is_available()` |

---

### 11.8 Delayed Tracking Initialisation

**Symptoms:** New workers take 2–5 seconds before they appear in the tracking overlay.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| `new_track_thresh` too high | `new_track_thresh` | Decrease to `0.30` |
| `track_high_thresh` too high | `track_high_thresh` | Decrease to `0.25` |
| YOLO warmup not done | Startup | Call `model(dummy_frame)` at startup to pre-warm GPU |

---

### 11.9 Excessive False Positives (Detecting Non-Workers)

**Symptoms:** Chairs, machinery, or reflections are detected as workers.

**Causes and fixes:**

| Cause | Parameter | Fix |
|---|---|---|
| `conf` too low | `conf` | Increase to `0.45`–`0.55` |
| `new_track_thresh` too low | `new_track_thresh` | Increase to `0.45` |
| Short-lived false tracks not pruned | `track_buffer` | Decrease to `30`–`60` so spurious tracks expire quickly |
| Bad keypoint threshold | `0.35` in `YOLO_TO_MP` loop | Increase to `0.45` |

---

## 12. Best Practices

### 12.1 Model Selection
1. **Start with `yolo11m-pose.pt`** — it provides the best balance between accuracy and speed on mid-range GPUs.
2. **Benchmark before committing** — run `test_yolo.py` on a sample clip with `verbose=True` to measure FPS before deploying.
3. **Do not mix models** across cameras unless hardware differs — use the same checkpoint everywhere for consistent keypoint quality.

### 12.2 Performance Optimisation
1. **Reduce `imgsz` first** — the single biggest lever for FPS improvement.
2. **Disable Re-ID if not needed** — `with_reid: False` saves ~5 ms/frame.
3. **Use a single YOLO instance per process** — do not instantiate multiple `WorkerDetector` objects; each loads the model separately into VRAM.
4. **Pre-warm the model at startup**: 
   ```python
   import numpy as np; self.model(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
   ```

### 12.3 Accuracy Optimisation
1. **Tune `conf` and `track_high_thresh` together** — keep them within 0.05 of each other.
2. **Validate `movement_sensitivity` on real footage** — use the tracking log to observe real movement scores for workers you know are "active" vs "idle", then set the threshold between the two distributions.
3. **Use the largest `imgsz` your GPU can handle** — especially for cameras with workers more than 5 m away.

### 12.4 Hardware Considerations
| GPU Tier | Recommended Config |
|---|---|
| GTX 1650 / 1660 | `yolo11m-pose.pt`, `imgsz=1280`, FP32, `with_reid=True` |
| RTX 3060 / 3070 | `yolo11l-pose.pt`, `imgsz=1280`, FP32, 2–3 cameras |
| RTX 3080 / 4080 | `yolo11x-pose.pt`, `imgsz=1280`, 4–6 cameras |
| CPU only | `yolo11n-pose.pt`, `imgsz=640`, `with_reid=False` |

### 12.5 Camera Placement
- Mount cameras **overhead or at 45°** — avoids ego-centric perspective that hides hip/ankle joints.
- Ensure **even lighting** — sharp shadows create artificially low keypoint confidence.
- **Minimum person height in frame:** workers should appear at least 100 px tall for reliable keypoint detection at `imgsz=640`; 60 px at `imgsz=1280`.
- Avoid **direct back-light** (windows behind workers) — silhouette effect destroys pose quality.

### 12.6 Parameter Tuning Workflow
1. **Capture representative footage** of the specific deployment environment.
2. **Run `test_track.py`** on the footage to see raw track IDs and detection counts.
3. **Adjust `conf` first** — aim for zero false positives with minimal missed detections.
4. **Adjust `track_buffer`** — based on expected maximum occlusion duration.
5. **Tune `movement_sensitivity`** — use live logs; observe reported `movement_score` values.
6. **Tune `idle_threshold_seconds`** — consult with operations team on acceptable idle duration policy.
7. **Test crossing scenarios manually** — walk two people through each other in front of the camera; verify IDs are preserved.

### 12.7 Debugging Techniques
- **Enable verbose logging:** set `verbose=True` in `model.track(...)` temporarily to see NMS/IoU decisions.
- **Log movement scores:** add `print(f"Track {track_id}: move={movement_score:.4f}")` in `pose_detector.py` and observe which values are borderline.
- **Visualise zones:** the frontend zone editor shows the zone overlay on live video — verify the zone covers the intended workspace.
- **Check track ID continuity:** add a log of all track IDs per frame (as done in `test_track.py`) and observe where IDs increment unexpectedly.

### 12.8 Persisted Settings
The following parameters are saved to `backend/settings.json` and survive server restarts:
- `idle_threshold_seconds`
- `movement_sensitivity`
- `confidence_threshold`

All other parameters (BoT-SORT YAML, model checkpoint, `imgsz`, `iou`, `EMA_ALPHA`) require a **server restart** or code change to take effect.

---

*Document generated for SFE-CCTV v2. Refer to [pose_detector.py](file:///home/zoro/~projects/caldim/SFE-CCTV/backend/src/detectors/pose_detector.py) and [custom_tracker.yaml](file:///home/zoro/~projects/caldim/SFE-CCTV/backend/custom_tracker.yaml) for the authoritative defaults.*
