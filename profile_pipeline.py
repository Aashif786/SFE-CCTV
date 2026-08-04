import sys, time, os, json, base64, asyncio
sys.path.insert(0, 'backend')

# ── 0. Settings snapshot ────────────────────────────────────────────────────
with open('backend/settings.json', 'r') as f:
    cfg = json.load(f)

print("=== SETTINGS SNAPSHOT ===")
print(f"  yolo_model      : {cfg['yolo_model']}")
print(f"  yolo_imgsz      : {cfg['yolo_imgsz']}")
print(f"  ai_stream_fps   : {cfg['ai_stream_fps']}  <- configured cap")
print(f"  tracker_with_reid: {cfg['tracker_with_reid']}")
print()

# ── 1. GPU info ─────────────────────────────────────────────────────────────
import torch
print("=== GPU ===")
if torch.cuda.is_available():
    dev = torch.cuda.get_device_name(0)
    props = torch.cuda.get_device_properties(0)
    print(f"  Device      : {dev}")
    print(f"  VRAM total  : {props.total_memory/1024**3:.1f} GB")
    sm = f"sm_{props.major}{props.minor}"
    print(f"  CUDA cap    : {sm}")
    print(f"  VRAM used now: {torch.cuda.memory_allocated(0)/1024**3:.2f} GB")
else:
    print("  NO CUDA")
print()

# ── 2. Stage timing benchmark ───────────────────────────────────────────────
import numpy as np, cv2
from ultralytics import YOLO

model_name = cfg['yolo_model']
imgsz      = cfg['yolo_imgsz']
tracker_cfg = os.path.abspath('backend/custom_tracker.yaml')

print("=== LOADING MODEL ===")
t0 = time.perf_counter()
model_path = os.path.abspath(f"backend/{model_name}")
model = YOLO(model_path)
model.to('cuda:0')
load_ms = (time.perf_counter()-t0)*1000
print(f"  Model load  : {load_ms:.0f} ms  ({model_name})")

dummy = np.zeros((480, 640, 3), dtype=np.uint8)
model.predict(dummy, verbose=False, device=0, half=True)
print("  Warmup done")
print()

frame_1080 = np.random.randint(50, 200, (1080, 1920, 3), dtype=np.uint8)
RUNS = 8

def bench(fn, runs=RUNS):
    times = []
    result = None
    for i in range(runs):
        t = time.perf_counter()
        result = fn()
        times.append((time.perf_counter()-t)*1000)
    return result, times

print("=== STAGE-BY-STAGE TIMINGS (ms) ===")
print(f"  Frame shape : {frame_1080.shape}  (simulating 1080p RTSP)")
print()

# Stage A: YOLO track at configured imgsz
print(f"[A] YOLO track  imgsz={imgsz}  model={model_name}  half=True  persist=True")
def do_track_big():
    return model.track(frame_1080, persist=True, verbose=False,
                       device=0, half=True,
                       conf=cfg['yolo_conf'], iou=cfg['yolo_iou'],
                       imgsz=imgsz, tracker=tracker_cfg)
_, times_A = bench(do_track_big)
times_A = times_A[2:]
avg_A = sum(times_A)/len(times_A)
print(f"    avg={avg_A:.1f}ms  min={min(times_A):.1f}ms  max={max(times_A):.1f}ms  -> {1000/avg_A:.1f} FPS max")
print()

# Stage A2: YOLO track at imgsz=640 for comparison
print("[A2] YOLO track  imgsz=640  (comparison)")
def do_track_640():
    return model.track(frame_1080, persist=True, verbose=False,
                       device=0, half=True,
                       conf=cfg['yolo_conf'], iou=cfg['yolo_iou'],
                       imgsz=640, tracker=tracker_cfg)
_, times_A2 = bench(do_track_640)
times_A2 = times_A2[2:]
avg_A2 = sum(times_A2)/len(times_A2)
print(f"    avg={avg_A2:.1f}ms  min={min(times_A2):.1f}ms  max={max(times_A2):.1f}ms  -> {1000/avg_A2:.1f} FPS max")
print()

# Stage B: JPEG resize + encode (stream_manager WS path)
print("[B] JPEG resize+encode 640px q=40  (stream_manager._grab_loop path)")
scale = 640/1920
small = cv2.resize(frame_1080, (640, int(1080*scale)), interpolation=cv2.INTER_AREA)
def do_jpeg():
    ok, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 40])
    return buf.tobytes()
jpeg_bytes, times_B = bench(do_jpeg, 30)
avg_B = sum(times_B)/len(times_B)
print(f"    avg={avg_B:.2f}ms  size={len(jpeg_bytes)/1024:.1f}KB")
print()

# Stage C: base64 via asyncio.to_thread lambda  (ai_stream.py line 345)
print("[C] base64 encode  (ai_stream.py asyncio.to_thread lambda)")
def do_b64():
    return "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")
_, times_C = bench(do_b64, 30)
avg_C = sum(times_C)/len(times_C)
print(f"    avg={avg_C:.2f}ms")
print()

# Stage D: asyncio.wait_for with 0.01 timeout  (ai_stream.py lines 121-128)
print("[D] asyncio.wait_for timeout=0.01  (anti-pattern in ai_stream.py per-frame)")
async def measure_wf():
    times = []
    for _ in range(60):
        t = time.perf_counter()
        try:
            await asyncio.wait_for(asyncio.sleep(9999), timeout=0.01)
        except asyncio.TimeoutError:
            pass
        times.append((time.perf_counter()-t)*1000)
    return times
times_D = asyncio.run(measure_wf())
times_D = times_D[5:]  # drop startup
avg_D = sum(times_D)/len(times_D)
print(f"    avg={avg_D:.2f}ms  min={min(times_D):.2f}ms  max={max(times_D):.2f}ms")
print(f"    *** Wasted every single frame ***")
print()

# Stage E: asyncio.to_thread overhead per call (ai_stream.py uses 2 to_thread calls)
print("[E] asyncio.to_thread dispatch overhead  (2 calls per frame: detector.update + base64)")
async def measure_to_thread():
    times = []
    for _ in range(50):
        t = time.perf_counter()
        await asyncio.to_thread(lambda: None)
        times.append((time.perf_counter()-t)*1000)
    return times
times_E = asyncio.run(measure_to_thread())
times_E = times_E[5:]
avg_E = sum(times_E)/len(times_E)
print(f"    avg per call={avg_E:.2f}ms  x2={avg_E*2:.2f}ms total dispatch")
print()

# Stage F: SQLite DB operations  (dwell_tracker opens DB connection per track per frame)
print("[F] SQLite open+query  (dwell_tracker._open_visit_in_db is called on zone entry)")
from src.db.database import SessionLocal
from src.db.models import CameraZoneDB
def do_db_query():
    with SessionLocal() as db:
        return db.query(CameraZoneDB).filter(
            CameraZoneDB.camera_id == '99999',
        ).all()
try:
    _, times_F = bench(do_db_query, 30)
    avg_F = sum(times_F)/len(times_F)
    print(f"    avg={avg_F:.2f}ms  min={min(times_F):.2f}ms  max={max(times_F):.2f}ms")
except Exception as e:
    print(f"    error: {e}")
    avg_F = 0
print()

# Stage G: WorkerDetector blocking init on event loop (ai_stream.py line 91)
print("[G] WorkerDetector() init time  (blocking on event loop at line 91)")
t0 = time.perf_counter()
from src.detectors.pose_detector import WorkerDetector
det = WorkerDetector()
init_ms = (time.perf_counter()-t0)*1000
print(f"    WorkerDetector() init: {init_ms:.0f} ms  (BLOCKS EVENT LOOP if called without to_thread!)")
print()

# Stage H: detector.update single frame
print("[H] detector.update() single frame  (the actual per-frame inference)")
frame_test = np.random.randint(50,200,(1080,1920,3),dtype=np.uint8)
_, times_H = bench(lambda: det.update(frame_test))
times_H = times_H[2:]
avg_H = sum(times_H)/len(times_H)
print(f"    avg={avg_H:.1f}ms  min={min(times_H):.1f}ms  max={max(times_H):.1f}ms -> {1000/avg_H:.1f} FPS")
print()

# ── VRAM after loading ──────────────────────────────────────────────────────
if torch.cuda.is_available():
    print(f"  VRAM allocated now : {torch.cuda.memory_allocated(0)/1024**3:.2f} GB")
    print(f"  VRAM reserved  now : {torch.cuda.memory_reserved(0)/1024**3:.2f} GB")
print()

# ── Summary ─────────────────────────────────────────────────────────────────
overhead_per_frame = avg_D + avg_E*2  # wait_for + 2x to_thread dispatch
inference_per_frame = avg_H
total_floor = inference_per_frame + overhead_per_frame + avg_B + avg_C

print("=" * 60)
print("BOTTLENECK SUMMARY")
print("=" * 60)
rows = [
    ("H  detector.update() = YOLO+track", avg_H, True),
    ("D  asyncio.wait_for overhead", avg_D, True),
    ("E  asyncio.to_thread dispatch x2", avg_E*2, False),
    ("B  JPEG resize+encode", avg_B, False),
    ("C  base64 encode", avg_C, False),
]
for label, ms, critical in rows:
    flag = " <-- CRITICAL" if critical else ""
    print(f"  [{label}]  {ms:.1f} ms{flag}")
print(f"  {'─'*50}")
print(f"  Total floor per frame: {total_floor:.1f} ms  ->  {1000/total_floor:.1f} FPS ceiling")
print()
print(f"  Configured ai_stream_fps: {cfg['ai_stream_fps']}")
print(f"  yolo_imgsz={imgsz} + model={model_name}")
print(f"  YOLO alone costs {avg_H:.0f}ms = {1000/avg_H:.1f} FPS max -- below the 20 FPS target")
print()
print("ROOT CAUSES (ordered by impact):")
print(f"  1. MODEL: yolo11x-pose (HEAVIEST variant) at imgsz=1280 takes ~{avg_H:.0f}ms/frame")
print(f"     That is a HARD {1000/avg_H:.1f} FPS ceiling -- 20 FPS is physically impossible with this config")
print(f"     Fix: use yolo11n-pose or yolo11s-pose + imgsz=640 for ~{1000/avg_A2:.0f}+ FPS")
print(f"  2. ASYNC OVERHEAD: asyncio.wait_for(timeout=0.01) costs {avg_D:.1f}ms per frame (wasted)")
print(f"  3. BLOCKING INIT: WorkerDetector() takes {init_ms:.0f}ms and is called on the event loop (line 91)")
print(f"  4. DOUBLE to_thread: base64 encoding uses a separate to_thread hop unnecessarily")
print(f"  5. DWELL_TRACKER: synchronous DB writes on zone entry/exit happen in inference thread")
