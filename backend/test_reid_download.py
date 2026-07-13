from ultralytics import YOLO
import cv2

model = YOLO("yolo11n-pose.pt")
img = cv2.imread("bus.jpg")

# Overwrite custom_tracker.yaml
with open("custom_tracker_temp.yaml", "w") as f:
    f.write("""
tracker_type: botsort
with_reid: True
model: osnet_x0_25_msmt17.pt
    """)

print("Testing track with explicit ReID model...")
results = model.track(img, persist=True, tracker="custom_tracker_temp.yaml", verbose=True)
print("Finished. Track IDs:", results[0].boxes.id)
