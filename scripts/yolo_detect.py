#!/usr/bin/env python3
"""
YOLOv8 object detection script for dataset-builder.
Runs inference on a single image and outputs JSON to stdout.

Usage:
    python yolo_detect.py --image <path> [--model yolov8n] [--conf 0.25]

Requires: pip install ultralytics
"""

import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="YOLOv8 object detection")
    parser.add_argument("--image", required=True, help="Path to input image")
    parser.add_argument("--model", default="yolov8n", help="YOLO model name (default: yolov8n)")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold (default: 0.25)")
    args = parser.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print(json.dumps({
            "error": "ultralytics not installed. Run: pip install ultralytics",
            "objects": [],
            "image_width": 0,
            "image_height": 0,
        }))
        sys.exit(1)

    try:
        # Load model (auto-downloads weights on first use)
        model_name = args.model
        if not model_name.endswith(".pt"):
            model_name += ".pt"
        model = YOLO(model_name)

        # Run inference
        results = model(args.image, conf=args.conf, verbose=False)

        if not results or len(results) == 0:
            print(json.dumps({
                "objects": [],
                "image_width": 0,
                "image_height": 0,
            }))
            return

        result = results[0]
        img_shape = result.orig_shape  # (height, width)
        image_height, image_width = img_shape[0], img_shape[1]

        objects = []
        boxes = result.boxes
        if boxes is not None:
            for i in range(len(boxes)):
                # Get bbox in xyxy format, convert to COCO [x, y, w, h]
                xyxy = boxes.xyxy[i].tolist()
                x1, y1, x2, y2 = xyxy
                bbox = [round(x1, 2), round(y1, 2), round(x2 - x1, 2), round(y2 - y1, 2)]

                conf = float(boxes.conf[i])
                cls_id = int(boxes.cls[i])
                label = model.names[cls_id] if cls_id in model.names else f"class_{cls_id}"

                objects.append({
                    "label": label,
                    "bbox": bbox,
                    "confidence": round(conf, 4),
                })

        output = {
            "objects": objects,
            "image_width": image_width,
            "image_height": image_height,
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "objects": [],
            "image_width": 0,
            "image_height": 0,
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
