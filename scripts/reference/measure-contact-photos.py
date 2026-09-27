#!/usr/bin/env python3
"""Reproduce reviewed straight-edge measurements; Pillow is used only for overlays.

Pass the original photo paths as arguments. Their byte hashes must match the
annotations. This does not change the tile catalog or any scored observations.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/research/contact-measurements"


def solve(matrix, values):
    rows = [list(a) + [b] for a, b in zip(matrix, values)]
    for i in range(len(rows)):
        pivot = max(range(i, len(rows)), key=lambda j: abs(rows[j][i]))
        rows[i], rows[pivot] = rows[pivot], rows[i]
        divisor = rows[i][i]
        if abs(divisor) < 1e-12:
            raise ValueError("Degenerate calibration")
        rows[i] = [v / divisor for v in rows[i]]
        for j in range(len(rows)):
            if i != j:
                factor = rows[j][i]
                rows[j] = [a - factor * b for a, b in zip(rows[j], rows[i])]
    return [row[-1] for row in rows]


def homography(source, destination):
    matrix, values = [], []
    for (x, y), (u, v) in zip(source, destination):
        matrix.extend([[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]])
        values.extend([u, v])
    return solve(matrix, values) + [1]


def project(h, point):
    x, y = point
    divisor = h[6]*x + h[7]*y + h[8]
    return [(h[0]*x + h[1]*y + h[2])/divisor, (h[3]*x + h[4]*y + h[5])/divisor]


def intersection(first, second):
    (ax, ay), (bx, by) = first
    (cx, cy), (dx, dy) = second
    t, _ = solve([[bx-ax, -(dx-cx)], [by-ay, -(dy-cy)]], [cx-ax, cy-ay])
    return [ax + t*(bx-ax), ay + t*(by-ay)]


def main():
    paths = {Path(p).name: Path(p) for p in sys.argv[1:]}
    results = []
    for item in json.loads((OUT / "annotations.json").read_text()):
        path = paths[item["image"]]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sourceSha256"]:
            raise ValueError(f"Photo bytes changed: {path.name}")
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        if list(im.size) != item["originalSize"]:
            raise ValueError("Image orientation/size changed")
        im = im.resize(tuple(item["annotationImageSize"]))
        factor = item["annotationImageSize"][0] / item["originalSize"][0]
        fid = [[v*factor for v in item["fiducials"][key]] for key in "ABCD"]
        h = homography(fid, [[10, 65], [205, 65], [10, 255], [205, 255]])
        edges = item["edgeSamples"]
        corners = [intersection(edges[i-1], edges[i]) for i in range(len(edges))]
        mm = [project(h, p) for p in corners]
        sides = [math.dist(mm[i], mm[(i+1) % len(mm)]) for i in range(len(mm))]
        checks = [{"expectedMm": n, "measuredMm": round(math.dist(project(h, a), project(h, b)), 2)} for a, b, n in item["independentDistances"]]
        draw = ImageDraw.Draw(im)
        for i, (a, b) in enumerate(edges):
            draw.line([tuple(a), tuple(b)], fill="yellow", width=4)
            draw.text(tuple(a), f"edge {i+1}", fill="blue")
        draw.line([tuple(p) for p in corners + [corners[0]]], fill="cyan", width=2)
        for a, b, n in item["independentDistances"]:
            draw.line([tuple(a), tuple(b)], fill="lime", width=3)
            draw.text(tuple(a), f"independent {n} mm", fill="blue")
        for key, (x, y) in zip("ABCD", fid):
            draw.ellipse((x-8, y-8, x+8, y+8), outline="lime", width=3)
            draw.text((x+10, y), key, fill="blue")
        im.save(OUT / f"{path.stem}-reviewed.jpg", quality=88)
        results.append({"image": path.name, "sourceSha256": item["sourceSha256"], "sidesMm": [round(n, 2) for n in sides], "independentChecks": checks})
    (OUT / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
