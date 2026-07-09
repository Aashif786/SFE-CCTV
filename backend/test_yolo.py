from ultralytics import YOLO
import torch
import cv2
import numpy as np

model = YOLO("yolo11n-pose.pt")
print("Model loaded.")

# Create a dummy image
img = np.zeros((480, 640, 3), dtype=np.uint8)

res = model(img, verbose=False)
if len(res) > 0 and res[0].keypoints is not None:
    kp = res[0].keypoints
    print("Has keypoints:", kp.has_visible)
    print("xyn shape:", kp.xyn.shape if hasattr(kp, 'xyn') else "No xyn")
    print("conf shape:", kp.conf.shape if hasattr(kp, 'conf') else "No conf")
    if kp.xyn.shape[0] > 0:
        print("xyn[0]:", kp.xyn[0])
else:
    print("No keypoints detected.")
