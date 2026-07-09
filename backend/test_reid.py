from ultralytics import YOLO
import cv2
import urllib.request
import os

url = "https://ultralytics.com/images/bus.jpg"
img_path = "bus.jpg"
if not os.path.exists(img_path):
    urllib.request.urlretrieve(url, img_path)

model = YOLO("yolo11n-pose.pt")
img = cv2.imread(img_path)

print("Testing track with explicit ReID model...")
results = model.track(img, persist=True, tracker="custom_tracker.yaml", verbose=True)
print("Finished. Track IDs:", results[0].boxes.id)
