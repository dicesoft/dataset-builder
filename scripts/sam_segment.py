#!/usr/bin/env python3
"""
SAM2 segmentation script for dataset-builder.
Runs auto-segmentation on a single image and saves binary mask PNGs.

Usage:
    python sam_segment.py --image <path> --output-dir <path> [--model sam2.1-b] [--points-per-side 32]

Requires: pip install ultralytics Pillow numpy
"""

import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="SAM segmentation")
    parser.add_argument("--image", required=True, help="Path to input image")
    parser.add_argument("--output-dir", required=True, help="Directory to save mask PNGs")
    parser.add_argument("--model", default="sam2.1_b.pt", help="SAM model name (default: sam2.1_b.pt)")
    parser.add_argument("--points-per-side", type=int, default=32, help="Points per side for auto mask generation")
    args = parser.parse_args()

    try:
        from ultralytics import SAM
        import numpy as np
    except ImportError:
        print(json.dumps({
            "error": "Required packages not installed. Run: pip install ultralytics Pillow numpy",
            "masks": [],
            "image_width": 0,
            "image_height": 0,
        }))
        sys.exit(1)

    try:
        from PIL import Image
    except ImportError:
        print(json.dumps({
            "error": "Pillow not installed. Run: pip install Pillow",
            "masks": [],
            "image_width": 0,
            "image_height": 0,
        }))
        sys.exit(1)

    try:
        os.makedirs(args.output_dir, exist_ok=True)

        # Load model (auto-downloads on first use)
        model = SAM(args.model)

        # Run auto segmentation
        results = model(args.image, points_per_side=args.points_per_side, verbose=False)

        if not results or len(results) == 0:
            print(json.dumps({
                "masks": [],
                "image_width": 0,
                "image_height": 0,
            }))
            return

        result = results[0]
        img_shape = result.orig_shape  # (height, width)
        image_height, image_width = img_shape[0], img_shape[1]

        masks_data = []
        base_name = os.path.splitext(os.path.basename(args.image))[0]

        if result.masks is not None and result.masks.data is not None:
            mask_tensors = result.masks.data.cpu().numpy()

            for i, mask_array in enumerate(mask_tensors):
                # Save binary mask as PNG
                mask_img = Image.fromarray((mask_array * 255).astype(np.uint8), mode="L")
                mask_filename = f"{base_name}_mask_{i:04d}.png"
                mask_path = os.path.join(args.output_dir, mask_filename)
                mask_img.save(mask_path)

                # Compute area and bbox from mask
                ys, xs = np.where(mask_array > 0)
                if len(xs) == 0:
                    continue

                x_min, x_max = int(xs.min()), int(xs.max())
                y_min, y_max = int(ys.min()), int(ys.max())
                bbox = [x_min, y_min, x_max - x_min, y_max - y_min]
                area = int(mask_array.sum())

                masks_data.append({
                    "label": f"segment_{i}",
                    "mask_path": mask_path,
                    "area": area,
                    "bbox": bbox,
                })

        output = {
            "masks": masks_data,
            "image_width": image_width,
            "image_height": image_height,
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "masks": [],
            "image_width": 0,
            "image_height": 0,
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
