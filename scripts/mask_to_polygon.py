#!/usr/bin/env python3
"""
Convert binary mask PNG to polygon contour coordinates.
Used by YOLO-Seg formatter to generate polygon label files.

Usage:
    python mask_to_polygon.py --mask <path> --image-width <w> --image-height <h>

Outputs JSON: {"points": [[x1,y1], [x2,y2], ...]} (normalized 0-1)

Requires: pip install Pillow numpy
"""

import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Mask to polygon converter")
    parser.add_argument("--mask", required=True, help="Path to binary mask PNG")
    parser.add_argument("--image-width", type=int, required=True, help="Original image width")
    parser.add_argument("--image-height", type=int, required=True, help="Original image height")
    parser.add_argument("--simplify", type=float, default=2.0, help="Polygon simplification tolerance in pixels")
    args = parser.parse_args()

    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        print(json.dumps({
            "error": "Required packages not installed. Run: pip install Pillow numpy",
            "points": [],
        }))
        sys.exit(1)

    try:
        # Load mask
        mask = np.array(Image.open(args.mask).convert("L"))
        binary = (mask > 127).astype(np.uint8)

        # Find contours using a simple boundary tracer
        points = find_contour(binary)

        if len(points) < 3:
            print(json.dumps({"points": []}))
            return

        # Simplify polygon (Douglas-Peucker)
        if args.simplify > 0 and len(points) > 10:
            points = douglas_peucker(points, args.simplify)

        # Normalize coordinates to 0-1
        normalized = []
        for x, y in points:
            nx = round(x / args.image_width, 6)
            ny = round(y / args.image_height, 6)
            normalized.append([nx, ny])

        print(json.dumps({"points": normalized}))

    except Exception as e:
        print(json.dumps({"error": str(e), "points": []}))
        sys.exit(1)


def find_contour(binary):
    """Simple boundary tracing for binary mask."""
    import numpy as np

    # Pad to handle edge cases
    padded = np.pad(binary, 1, mode='constant', constant_values=0)

    # Find boundary pixels (where mask pixel differs from neighbor)
    kernel_h = padded[1:, :] != padded[:-1, :]
    kernel_v = padded[:, 1:] != padded[:, :-1]

    boundary = np.zeros_like(padded, dtype=bool)
    boundary[:-1, :] |= kernel_h
    boundary[1:, :] |= kernel_h
    boundary[:, :-1] |= kernel_v
    boundary[:, 1:] |= kernel_v

    # Only keep boundary pixels that are part of the mask
    boundary = boundary & (padded > 0)

    # Remove padding offset
    boundary = boundary[1:-1, 1:-1]

    # Get coordinates
    ys, xs = np.where(boundary)
    if len(xs) == 0:
        return []

    # Order points by angle from centroid for a proper polygon
    cx, cy = xs.mean(), ys.mean()
    angles = np.arctan2(ys - cy, xs - cx)
    order = np.argsort(angles)

    points = list(zip(xs[order].tolist(), ys[order].tolist()))

    # Subsample if too many points
    if len(points) > 500:
        step = len(points) // 200
        points = points[::step]

    return points


def douglas_peucker(points, tolerance):
    """Douglas-Peucker polygon simplification."""
    if len(points) <= 2:
        return points

    # Find the point with maximum distance from line (first, last)
    first = points[0]
    last = points[-1]

    max_dist = 0
    max_idx = 0

    for i in range(1, len(points) - 1):
        dist = point_line_distance(points[i], first, last)
        if dist > max_dist:
            max_dist = dist
            max_idx = i

    if max_dist > tolerance:
        left = douglas_peucker(points[:max_idx + 1], tolerance)
        right = douglas_peucker(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [first, last]


def point_line_distance(point, line_start, line_end):
    """Distance from point to line segment."""
    x0, y0 = point
    x1, y1 = line_start
    x2, y2 = line_end

    dx = x2 - x1
    dy = y2 - y1

    if dx == 0 and dy == 0:
        return ((x0 - x1) ** 2 + (y0 - y1) ** 2) ** 0.5

    t = max(0, min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)))

    proj_x = x1 + t * dx
    proj_y = y1 + t * dy

    return ((x0 - proj_x) ** 2 + (y0 - proj_y) ** 2) ** 0.5


if __name__ == "__main__":
    main()
