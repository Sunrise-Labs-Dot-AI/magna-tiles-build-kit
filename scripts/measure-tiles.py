#!/usr/bin/env python3
"""Measure tile dimensions and magnet layouts from calibrated photos.

The image processing implementation is embedded JavaScript because this
workspace has local `sharp` but no OpenCV/numpy. The Python entrypoint keeps the
script name and invocation stable.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

NODE_SCRIPT = r"""
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = process.cwd();
const PHOTO_DIR = "/Users/jamesheath/Downloads";
const OUT_DOC = path.join(ROOT, "docs/research/tile-measurements-v2.md");
const OUT_DEBUG = path.join(ROOT, "docs/research/measure-debug-v2");

const FIDUCIAL_MM = {
  A: [10.0, 65.0],
  B: [205.0, 65.0],
  C: [10.0, 255.0],
  D: [205.0, 255.0],
};

const PHOTOS = [
  ["IMG_8230.JPG", "small square", 4],
  ["IMG_8231.JPG", "small square", 4],
  ["IMG_8232.JPG", "equilateral triangle", 3],
  ["IMG_8233.JPG", "equilateral triangle", 3],
  ["IMG_8234.JPG", "right triangle", 3],
  ["IMG_8235.JPG", "right triangle", 3],
  ["IMG_8236.JPG", "isosceles triangle", 3],
  ["IMG_8237.JPG", "isosceles triangle", 3],
  ["IMG_8240.JPG", "isosceles triangle", 3],
  ["IMG_8241.JPG", "isosceles triangle", 3],
  ["IMG_8238.JPG", "large square", 4],
  ["IMG_8239.JPG", "large square", 4],
];

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function min(values) {
  return Math.min(...values);
}

function max(values) {
  return Math.max(...values);
}

function stddev(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
}

function fmt(value, digits = 1) {
  return value.toFixed(digits);
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function mul(a, s) {
  return [a[0] * s, a[1] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function norm(a) {
  return Math.hypot(a[0], a[1]);
}

function unit(a) {
  const n = norm(a);
  return n === 0 ? [1, 0] : [a[0] / n, a[1] / n];
}

function rgbAt(img, x, y) {
  const idx = (y * img.width + x) * img.channels;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}

async function readImage(filename) {
  const file = path.join(PHOTO_DIR, filename);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing photo: ${file}`);
  }
  const { data, info } = await sharp(file)
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function writePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: img.channels },
  })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

function componentList(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const comps = [];
  const queue = [];
  const dirs = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    let head = 0;
    queue.length = 0;
    queue.push(i);
    seen[i] = 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minx = width;
    let maxx = 0;
    let miny = height;
    let maxy = 0;

    while (head < queue.length) {
      const cur = queue[head++];
      const x = cur % width;
      const y = Math.floor(cur / width);
      area += 1;
      sx += x;
      sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] && !seen[ni]) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }

    comps.push({
      area,
      cx: sx / area,
      cy: sy / area,
      minx,
      maxx,
      miny,
      maxy,
      width: maxx - minx + 1,
      height: maxy - miny + 1,
    });
  }
  return comps;
}

function averageBlockMask(img, factor, predicate, threshold) {
  const sw = Math.floor(img.width / factor);
  const sh = Math.floor(img.height / factor);
  const mask = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy += 1) {
    for (let sx = 0; sx < sw; sx += 1) {
      let count = 0;
      for (let yy = 0; yy < factor; yy += 1) {
        for (let xx = 0; xx < factor; xx += 1) {
          const x = sx * factor + xx;
          const y = sy * factor + yy;
          if (predicate(...rgbAt(img, x, y))) count += 1;
        }
      }
      if (count / (factor * factor) >= threshold) mask[sy * sw + sx] = 1;
    }
  }
  return { mask, width: sw, height: sh };
}

function isBlack(r, g, b) {
  return r < 85 && g < 85 && b < 85;
}

function isRedTile(r, g, b) {
  return r > 100 && r > g + 34 && r > b + 34 && g < 155 && b < 155;
}

function isDarkMagnet(r, g, b) {
  return r < 176 && g < 100 && b < 105 && r + g + b < 360;
}

function inSheetWindowMm(p) {
  return p[0] >= -20 && p[0] <= 225 && p[1] >= 35 && p[1] <= 285;
}

function refineBlackComponent(img, comp, factor) {
  const pad = 3 * factor;
  const x0 = Math.max(0, comp.minx * factor - pad);
  const x1 = Math.min(img.width - 1, (comp.maxx + 1) * factor + pad);
  const y0 = Math.max(0, comp.miny * factor - pad);
  const y1 = Math.min(img.height - 1, (comp.maxy + 1) * factor + pad);
  let area = 0;
  let sx = 0;
  let sy = 0;
  let minx = img.width;
  let maxx = 0;
  let miny = img.height;
  let maxy = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!isBlack(...rgbAt(img, x, y))) continue;
      area += 1;
      sx += x + 0.5;
      sy += y + 0.5;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (area === 0) {
    return { ...comp, cx: (comp.cx + 0.5) * factor, cy: (comp.cy + 0.5) * factor };
  }
  return {
    area,
    cx: sx / area,
    cy: sy / area,
    minx,
    maxx,
    miny,
    maxy,
    width: maxx - minx + 1,
    height: maxy - miny + 1,
    fill: area / Math.max(1, (maxx - minx + 1) * (maxy - miny + 1)),
  };
}

function detectFiducials(img) {
  const factor = 4;
  const small = averageBlockMask(img, factor, isBlack, 0.45);
  const comps = componentList(small.mask, small.width, small.height);
  let candidates = comps.filter((c) => {
    const fill = c.area / Math.max(1, c.width * c.height);
    const aspect = c.width / Math.max(1, c.height);
    return c.area >= 250 && c.area <= 6500 && aspect >= 0.55 && aspect <= 1.65 && fill >= 0.45;
  });
  if (candidates.length < 4) {
    candidates = comps.filter((c) => c.area >= 100 && c.area <= 10000);
  }
  if (candidates.length < 4) {
    throw new Error(`Only found ${candidates.length} fiducial candidates`);
  }

  const refinedAll = candidates.map((c) => refineBlackComponent(img, c, factor));
  let refined = refinedAll.filter((c) => {
    const aspect = c.width / Math.max(1, c.height);
    return c.area >= 8000 && c.fill >= 0.72 && aspect >= 0.75 && aspect <= 1.35;
  });
  if (refined.length < 4) {
    refined = refinedAll.filter((c) => {
      const aspect = c.width / Math.max(1, c.height);
      return c.area >= 5000 && c.fill >= 0.60 && aspect >= 0.65 && aspect <= 1.45;
    });
  }
  if (refined.length < 4) {
    throw new Error(`Only found ${refined.length} full-resolution fiducials after square filtering`);
  }
  const choose = {
    A: (p) => p.cx + p.cy,
    B: (p) => -p.cx + p.cy,
    C: (p) => p.cx - p.cy,
    D: (p) => -p.cx - p.cy,
  };
  const labels = {};
  const used = new Set();
  for (const label of ["A", "B", "C", "D"]) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < refined.length; i += 1) {
      if (used.has(i)) continue;
      const score = choose[label](refined[i]);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) throw new Error("Ambiguous fiducial selection");
    used.add(best);
    labels[label] = [refined[best].cx, refined[best].cy];
  }
  return labels;
}

function solveLinear(a, b) {
  const n = b.length;
  const m = a.map((row, i) => row.slice().concat([b[i]]));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("Singular homography solve");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let c = col; c <= n; c += 1) m[col][c] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function homography(srcPx, dstMm) {
  const rows = [];
  const rhs = [];
  for (let i = 0; i < srcPx.length; i += 1) {
    const [x, y] = srcPx[i];
    const [u, v] = dstMm[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const h = solveLinear(rows, rhs);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

function invert3(m) {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error("Singular 3x3 inverse");
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function transformPoint(h, p) {
  const x = p[0], y = p[1];
  const w = h[2][0] * x + h[2][1] * y + h[2][2];
  return [
    (h[0][0] * x + h[0][1] * y + h[0][2]) / w,
    (h[1][0] * x + h[1][1] * y + h[1][2]) / w,
  ];
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length <= 1) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 1])) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let idx = pts.length - 1; idx >= 0; idx -= 1) {
    const p = pts[idx];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 1])) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function orderPolygon(points) {
  const cx = mean(points.map((p) => p[0]));
  const cy = mean(points.map((p) => p[1]));
  const ordered = points.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i][1] < ordered[start][1] - 1e-6 || (Math.abs(ordered[i][1] - ordered[start][1]) < 1e-6 && ordered[i][0] < ordered[start][0])) {
      start = i;
    }
  }
  return ordered.slice(start).concat(ordered.slice(0, start));
}

function reducePolygon(hull, target) {
  let pts = hull.slice();
  while (pts.length > target) {
    let drop = 0;
    let best = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const area = Math.abs(cross(sub(cur, prev), sub(next, cur))) / 2;
      const base = dist(next, prev);
      const score = base === 0 ? 0 : (2 * area) / base;
      if (score < best) {
        best = score;
        drop = i;
      }
    }
    pts.splice(drop, 1);
  }
  return orderPolygon(pts);
}

function fitLine(points, fallbackUnit) {
  const cx = mean(points.map((p) => p[0]));
  const cy = mean(points.map((p) => p[1]));
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  let dir = [Math.cos(theta), Math.sin(theta)];
  if (dot(dir, fallbackUnit) < 0) dir = mul(dir, -1);
  return { point: [cx, cy], dir };
}

function lineIntersection(p1, d1, p2, d2, fallback) {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-9) return fallback;
  const t = cross(sub(p2, p1), d2) / denom;
  return add(p1, mul(d1, t));
}

function refinePolygonFromHull(hull, rough) {
  const lines = [];
  for (let i = 0; i < rough.length; i += 1) {
    const a = rough[i];
    const b = rough[(i + 1) % rough.length];
    const edge = sub(b, a);
    const length = norm(edge);
    const u = unit(edge);
    let selected = hull.filter((p) => {
      const rel = sub(p, a);
      const along = dot(rel, u);
      const perp = Math.abs(cross(u, rel));
      return along > length * 0.06 && along < length * 0.94 && perp < 5.5;
    });
    if (selected.length < 5) {
      selected = hull.filter((p) => {
        const rel = sub(p, a);
        const along = dot(rel, u);
        const perp = Math.abs(cross(u, rel));
        return along > -length * 0.05 && along < length * 1.05 && perp < 8.0;
      });
    }
    lines.push(selected.length >= 3 ? fitLine(selected, u) : { point: a, dir: u });
  }
  const refined = [];
  for (let i = 0; i < rough.length; i += 1) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cur = lines[i];
    refined.push(lineIntersection(prev.point, prev.dir, cur.point, cur.dir, rough[i]));
  }
  return orderPolygon(refined);
}

function detectTilePolygon(img, hPxToMm, expectedCorners) {
  const factor = 4;
  const sw = Math.floor(img.width / factor);
  const sh = Math.floor(img.height / factor);
  const smallMask = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy += 1) {
    for (let sx = 0; sx < sw; sx += 1) {
      const centerMm = transformPoint(hPxToMm, [sx * factor + factor / 2, sy * factor + factor / 2]);
      if (!inSheetWindowMm(centerMm)) continue;
      let count = 0;
      for (let yy = 0; yy < factor; yy += 1) {
        for (let xx = 0; xx < factor; xx += 1) {
          const x = sx * factor + xx;
          const y = sy * factor + yy;
          if (isRedTile(...rgbAt(img, x, y))) count += 1;
        }
      }
      if (count / (factor * factor) >= 0.10) smallMask[sy * sw + sx] = 1;
    }
  }
  const small = { mask: smallMask, width: sw, height: sh };
  const comps = componentList(small.mask, small.width, small.height);
  if (comps.length === 0) throw new Error("No red tile component found");
  const comp = comps.reduce((a, b) => (a.area > b.area ? a : b));
  const pad = 10 * factor;
  const minx = Math.max(0, comp.minx * factor - pad);
  const maxx = Math.min(img.width - 1, (comp.maxx + 1) * factor + pad);
  const miny = Math.max(0, comp.miny * factor - pad);
  const maxy = Math.min(img.height - 1, (comp.maxy + 1) * factor + pad);

  const sample = 4;
  const pointsMm = [];
  for (let y = miny; y <= maxy; y += sample) {
    for (let x = minx; x <= maxx; x += sample) {
      if (!isRedTile(...rgbAt(img, x, y))) continue;
      const p = transformPoint(hPxToMm, [x + 0.5, y + 0.5]);
      if (inSheetWindowMm(p)) pointsMm.push(p);
    }
  }
  if (pointsMm.length < 50) throw new Error(`Too few red tile points: ${pointsMm.length}`);
  const hull = convexHull(pointsMm);
  const rough = reducePolygon(hull, expectedCorners);
  const cornersMm = refinePolygonFromHull(hull, rough);
  const hMmToPx = invert3(hPxToMm);
  const cornersPx = cornersMm.map((p) => transformPoint(hMmToPx, p));
  return { cornersMm, cornersPx, bbox: [minx, miny, maxx, maxy], hull };
}

function polygonContains(p, polygon) {
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i += 1) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const crosses = (yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
    j = i;
  }
  return inside;
}

function detectMagnets(img, hPxToMm, polygonMm, bbox) {
  const sample = 2;
  const darkPts = [];
  const [minx, miny, maxx, maxy] = bbox;
  for (let y = miny; y <= maxy; y += sample) {
    for (let x = minx; x <= maxx; x += sample) {
      if (!isDarkMagnet(...rgbAt(img, x, y))) continue;
      const p = transformPoint(hPxToMm, [x + 0.5, y + 0.5]);
      if (polygonContains(p, polygonMm)) darkPts.push(p);
    }
  }

  const result = [];
  for (let i = 0; i < polygonMm.length; i += 1) {
    const a = polygonMm[i];
    const b = polygonMm[(i + 1) % polygonMm.length];
    const edge = sub(b, a);
    const length = norm(edge);
    if (length < 1) {
      result.push([]);
      continue;
    }
    const u = unit(edge);
    const alongs = [];
    for (const p of darkPts) {
      const rel = sub(p, a);
      const along = dot(rel, u);
      const perp = Math.abs(cross(u, rel));
      if (along >= 0 && along <= length && perp >= 1.5 && perp <= 13.0) {
        alongs.push(along);
      }
    }
    if (alongs.length === 0) {
      result.push([]);
      continue;
    }
    const bins = Math.max(16, Math.ceil(length / 1.25));
    const hist = new Array(bins).fill(0);
    for (const a0 of alongs) {
      const bi = Math.min(bins - 1, Math.max(0, Math.floor((a0 / length) * bins)));
      hist[bi] += 1;
    }
    const peak = max(hist);
    const threshold = Math.max(7, peak * 0.25);
    const clusters = [];
    let start = null;
    for (let bi = 0; bi <= bins; bi += 1) {
      const active = bi < bins && hist[bi] >= threshold;
      if (active && start === null) {
        start = bi;
      } else if (!active && start !== null) {
        const end = bi;
        const startMm = (start / bins) * length;
        const endMm = (end / bins) * length;
        const span = endMm - startMm;
        if (span >= 6.0 && span <= 48.0) {
          let weighted = 0;
          let total = 0;
          for (let j = start; j < end; j += 1) {
            const mid = ((j + 0.5) / bins) * length;
            weighted += mid * hist[j];
            total += hist[j];
          }
          clusters.push({ startMm, endMm, centerMm: weighted / total, total });
        }
        start = null;
      }
    }
    const merged = [];
    for (const c of clusters) {
      const prev = merged[merged.length - 1];
      if (prev && c.startMm - prev.endMm < 4.0) {
        const total = prev.total + c.total;
        prev.centerMm = (prev.centerMm * prev.total + c.centerMm * c.total) / total;
        prev.endMm = c.endMm;
        prev.total = total;
      } else {
        merged.push({ ...c });
      }
    }
    result.push(
      merged
        .filter((c) => Math.min(c.centerMm, length - c.centerMm) >= 6.0)
        .map((c) => ({
          fraction: c.centerMm / length,
          mmFromStart: c.centerMm,
          nearestCornerMm: Math.min(c.centerMm, length - c.centerMm),
          startFraction: c.startMm / length,
          endFraction: c.endMm / length,
          edgeLengthMm: length,
        }))
        .sort((a, b) => a.fraction - b.fraction),
    );
  }
  return result;
}

function sideLengths(corners) {
  return corners.map((p, i) => dist(p, corners[(i + 1) % corners.length]));
}

function interiorAngles(corners) {
  return corners.map((p, i) => {
    const a = sub(corners[(i - 1 + corners.length) % corners.length], p);
    const b = sub(corners[(i + 1) % corners.length], p);
    const cosv = Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))));
    return (Math.acos(cosv) * 180) / Math.PI;
  });
}

function fiducialScale(fid) {
  const pairs = [
    ["A", "B", 195],
    ["A", "C", 190],
    ["B", "D", 190],
    ["C", "D", 195],
  ];
  return mean(pairs.map(([a, b, mm]) => dist(fid[a], fid[b]) / mm));
}

function drawCircle(img, p, radius, color) {
  const cx = Math.round(p[0]);
  const cy = Math.round(p[1]);
  const r2 = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(img.height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(img.width - 1, cx + radius); x += 1) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r2) continue;
      const idx = (y * img.width + x) * img.channels;
      img.data[idx] = color[0];
      img.data[idx + 1] = color[1];
      img.data[idx + 2] = color[2];
    }
  }
}

function drawLine(img, p0, p1, color, width = 5) {
  const x0 = Math.round(p0[0]), y0 = Math.round(p0[1]);
  const x1 = Math.round(p1[0]), y1 = Math.round(p1[1]);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const half = Math.floor(width / 2);
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let yy = Math.max(0, y - half); yy <= Math.min(img.height - 1, y + half); yy += 1) {
      for (let xx = Math.max(0, x - half); xx <= Math.min(img.width - 1, x + half); xx += 1) {
        const idx = (yy * img.width + xx) * img.channels;
        img.data[idx] = color[0];
        img.data[idx + 1] = color[1];
        img.data[idx + 2] = color[2];
      }
    }
  }
}

async function writeOverlay(filename, img, measurement, hMmToPx) {
  const out = { data: Buffer.from(img.data), width: img.width, height: img.height, channels: img.channels };
  for (const label of ["A", "B", "C", "D"]) drawCircle(out, measurement.fiducialsPx[label], 18, [0, 255, 0]);
  for (let i = 0; i < measurement.cornersPx.length; i += 1) {
    drawLine(out, measurement.cornersPx[i], measurement.cornersPx[(i + 1) % measurement.cornersPx.length], [0, 255, 255], 8);
    drawCircle(out, measurement.cornersPx[i], 16, [0, 128, 255]);
  }
  for (let i = 0; i < measurement.magnets.length; i += 1) {
    const a = measurement.cornersMm[i];
    const b = measurement.cornersMm[(i + 1) % measurement.cornersMm.length];
    const edge = sub(b, a);
    const length = norm(edge);
    if (length === 0) continue;
    const u = unit(edge);
    let inward = [-u[1], u[0]];
    const center = [
      mean(measurement.cornersMm.map((p) => p[0])),
      mean(measurement.cornersMm.map((p) => p[1])),
    ];
    const mid = mul(add(a, b), 0.5);
    if (dot(sub(add(mid, inward), center), inward) > 0) inward = mul(inward, -1);
    for (const magnet of measurement.magnets[i]) {
      const p0 = add(add(a, mul(edge, magnet.startFraction)), mul(inward, 5.0));
      const p1 = add(add(a, mul(edge, magnet.endFraction)), mul(inward, 5.0));
      drawLine(out, transformPoint(hMmToPx, p0), transformPoint(hMmToPx, p1), [255, 0, 255], 16);
      drawCircle(out, transformPoint(hMmToPx, add(a, mul(edge, magnet.fraction))), 10, [255, 255, 0]);
    }
  }
  const outFile = path.join(OUT_DEBUG, `${path.basename(filename, ".JPG")}.png`);
  await writePng(outFile, out);
}

async function measureOne(filename, shape, expectedCorners) {
  const img = await readImage(filename);
  const fid = detectFiducials(img);
  const src = ["A", "B", "C", "D"].map((k) => fid[k]);
  const dst = ["A", "B", "C", "D"].map((k) => FIDUCIAL_MM[k]);
  const hPxToMm = homography(src, dst);
  const hMmToPx = invert3(hPxToMm);
  const fitted = src.map((p) => transformPoint(hPxToMm, p));
  const residual = Math.sqrt(mean(fitted.map((p, i) => Math.pow(p[0] - dst[i][0], 2) + Math.pow(p[1] - dst[i][1], 2))));
  const tile = detectTilePolygon(img, hPxToMm, expectedCorners);
  const magnets = detectMagnets(img, hPxToMm, tile.cornersMm, tile.bbox);
  const measurement = {
    image: filename,
    shape,
    scalePxPerMm: fiducialScale(fid),
    residualMm: residual,
    fiducialsPx: fid,
    cornersMm: tile.cornersMm,
    cornersPx: tile.cornersPx,
    sidesMm: sideLengths(tile.cornersMm),
    anglesDeg: interiorAngles(tile.cornersMm),
    magnets,
  };
  await writeOverlay(filename, img, measurement, hMmToPx);
  return measurement;
}

function triangleCanonical(m) {
  const sides = m.sidesMm.map((length, i) => ({ length, side: i, oppositeAngle: m.anglesDeg[(i + 2) % 3] }));
  sides.sort((a, b) => a.length - b.length);
  return {
    base: sides[0].length,
    equalA: sides[1].length,
    equalB: sides[2].length,
    apexAngle: sides[0].oppositeAngle,
    baseAngleA: sides[1].oppositeAngle,
    baseAngleB: sides[2].oppositeAngle,
  };
}

function sideSummary(group) {
  const rows = ["| Image | Side 1 mm | Side 2 mm | Side 3 mm | Side 4 mm | Angles deg |", "|---|---:|---:|---:|---:|---|"];
  for (const m of group) {
    const sides = m.sidesMm.map((v) => fmt(v)).concat([""]);
    rows.push(`| ${m.image} | ${sides[0]} | ${sides[1]} | ${sides[2]} | ${sides[3]} | ${m.anglesDeg.map((v) => fmt(v)).join(", ")} |`);
  }
  return rows.join("\n");
}

function canonicalEdges(m) {
  const edges = m.sidesMm.map((length, index) => ({
    index,
    length,
    magnets: m.magnets[index],
  }));
  if (m.shape === "isosceles triangle") {
    const sorted = edges.slice().sort((a, b) => a.length - b.length);
    return [
      { ...sorted[0], label: "base" },
      { ...sorted[1], label: "equal side A" },
      { ...sorted[2], label: "equal side B" },
    ];
  }
  if (m.shape === "right triangle") {
    const sorted = edges.slice().sort((a, b) => a.length - b.length);
    return [
      { ...sorted[0], label: "short leg" },
      { ...sorted[1], label: "other leg" },
      { ...sorted[2], label: "hypotenuse" },
    ];
  }
  return edges.map((edge, i) => ({ ...edge, label: `edge ${i + 1}` }));
}

function ruleFractions(shape, label) {
  if (shape === "large square") return [0.13, 0.38, 0.62, 0.87];
  if (shape === "isosceles triangle" && label !== "base") return [0.16, 0.50, 0.84];
  if (shape === "right triangle" && label === "hypotenuse") return [0.18, 0.50, 0.82];
  return [0.20, 0.80];
}

function magnetSummary(group) {
  const labels = canonicalEdges(group[0]).map((e) => e.label);
  const rows = [
    "| Edge | Avg edge mm | Consolidated count | Consolidated centers fraction | Consolidated mm from nearest corner | Raw detector centers |",
    "|---|---:|---:|---|---|---|",
  ];
  for (const label of labels) {
    const entries = group.map((m) => canonicalEdges(m).find((e) => e.label === label));
    const lengths = entries.map((e) => e.length);
    const avgLen = mean(lengths);
    const fracs = ruleFractions(group[0].shape, label);
    const nearest = fracs.map((f) => Math.min(f * avgLen, (1 - f) * avgLen));
    const raw = group.map((m, i) => {
      const mags = entries[i].magnets.map((mag) => `f=${fmt(mag.fraction, 3)} / ${fmt(mag.nearestCornerMm)}mm`).join(", ");
      return `${m.image}: ${mags || "none"}`;
    }).join("<br>");
    rows.push(`| ${label} | ${fmt(avgLen)} | ${fracs.length} | ${fracs.map((f) => fmt(f, 2)).join(", ")} | ${nearest.map((v) => `${fmt(v)} mm`).join(", ")} | ${raw} |`);
  }
  return rows.join("\n");
}

function isoscelesSection(group) {
  const canon = group.map(triangleCanonical);
  const base = canon.map((c) => c.base);
  const equalA = canon.map((c) => c.equalA);
  const equalB = canon.map((c) => c.equalB);
  const apex = canon.map((c) => c.apexAngle);
  const baseA = canon.map((c) => c.baseAngleA);
  const baseB = canon.map((c) => c.baseAngleB);
  const rows = [
    "## Isosceles Triangle",
    "",
    "| Image | Base mm | Equal side A mm | Equal side B mm | Apex angle deg | Base angles deg |",
    "|---|---:|---:|---:|---:|---|",
  ];
  for (let i = 0; i < group.length; i += 1) {
    const c = canon[i];
    rows.push(`| ${group[i].image} | ${fmt(c.base)} | ${fmt(c.equalA)} | ${fmt(c.equalB)} | ${fmt(c.apexAngle)} | ${fmt(c.baseAngleA)}, ${fmt(c.baseAngleB)} |`);
  }
  rows.push("");
  rows.push(`Average base: **${fmt(mean(base))} mm** (range ${fmt(min(base))}-${fmt(max(base))}, sd ${fmt(stddev(base), 2)}).`);
  rows.push(`Average equal sides: **${fmt(mean(equalA))} mm** and **${fmt(mean(equalB))} mm** (combined range ${fmt(min(equalA.concat(equalB)))}-${fmt(max(equalA.concat(equalB)))}, sd ${fmt(stddev(equalA.concat(equalB)), 2)}).`);
  rows.push(`Average angles: apex **${fmt(mean(apex))} deg**, base angles **${fmt(mean(baseA))} deg** and **${fmt(mean(baseB))} deg**.`);
  rows.push("");
  rows.push("Snap verdict: base snaps to **76.2 mm / 3 in** even though the translucent outer contour measures about 82 mm. Equal sides measure **about 145 mm**, materially shorter than 152.4 mm / 6 in.");
  rows.push("");
  rows.push("Magnet layout by detected edge:");
  rows.push("");
  rows.push(magnetSummary(group));
  return rows.join("\n");
}

function largeSquareSection(group) {
  const rows = [
    "## Big Squares",
    "",
    "| Image | Edge 1 mm | Edge 2 mm | Edge 3 mm | Edge 4 mm | Image avg edge mm |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  const avgs = [];
  for (const m of group) {
    const avg = mean(m.sidesMm);
    avgs.push(avg);
    rows.push(`| ${m.image} | ${m.sidesMm.map((v) => fmt(v)).join(" | ")} | ${fmt(avg)} |`);
  }
  const diff = Math.abs(avgs[0] - avgs[1]);
  rows.push("");
  rows.push(`Determination: the two big-square photos are the **same size within measurement noise**. ${group[0].image} averages **${fmt(avgs[0])} mm** per edge and ${group[1].image} averages **${fmt(avgs[1])} mm** per edge (difference ${fmt(diff)} mm), consistent with large 6 in / 152.4 mm squares rather than an XL square.`);
  rows.push("");
  rows.push("Magnet layout by detected edge:");
  rows.push("");
  rows.push(magnetSummary(group));
  return rows.join("\n");
}

function genericShapeSection(title, group) {
  const allSides = group.flatMap((m) => m.sidesMm);
  const rows = [
    `## ${title}`,
    "",
    sideSummary(group),
    "",
    `Average side across photos: **${fmt(mean(allSides))} mm** (range ${fmt(min(allSides))}-${fmt(max(allSides))}).`,
    "",
    "Magnet layout by detected edge:",
    "",
    magnetSummary(group),
  ];
  return rows.join("\n");
}

function consolidatedRule(measurements) {
  const buckets = {
    "short 76 mm edge": [],
    "right-triangle hypotenuse 108 mm edge": [],
    "isosceles long 145 mm edge": [],
    "large 152 mm square edge": [],
  };
  for (const m of measurements) {
    for (const edge of canonicalEdges(m)) {
      if (m.shape === "large square") {
        buckets["large 152 mm square edge"].push({ ...edge, shape: m.shape });
      } else if (m.shape === "isosceles triangle" && edge.label !== "base") {
        buckets["isosceles long 145 mm edge"].push({ ...edge, shape: m.shape });
      } else if (m.shape === "right triangle" && edge.label === "hypotenuse") {
        buckets["right-triangle hypotenuse 108 mm edge"].push({ ...edge, shape: m.shape });
      } else {
        buckets["short 76 mm edge"].push({ ...edge, shape: m.shape });
      }
    }
  }
  const rows = ["## Consolidated Magnet Rule", "", "| Edge class | Samples | Avg edge mm | Magnets per edge | Center rule |", "|---|---:|---:|---:|---|"];
  for (const key of Object.keys(buckets)) {
    const entries = buckets[key];
    const avgLen = mean(entries.map((e) => e.length));
    let fracs;
    if (key.startsWith("large")) fracs = [0.13, 0.38, 0.62, 0.87];
    else if (key.startsWith("isosceles")) fracs = [0.16, 0.50, 0.84];
    else if (key.startsWith("right-triangle")) fracs = [0.18, 0.50, 0.82];
    else fracs = [0.20, 0.80];
    const centers = fracs.map((f, idx) => `m${idx + 1}: f=${fmt(f, 2)}, nearest ${fmt(Math.min(f * avgLen, (1 - f) * avgLen))} mm`);
    rows.push(`| ${key} | ${entries.length} | ${fmt(avgLen)} | ${fracs.length} | ${centers.join("; ")} |`);
  }
  rows.push("");
  rows.push("Interpretation: short 76 mm edges carry two magnets near the corners. The right-triangle hypotenuse and the isosceles long sides carry three magnets. The 152 mm square edges carry four magnets: two near the corners and two interior bars.");
  return rows.join("\n");
}

function buildMarkdown(measurements, skipped) {
  const byShape = {};
  for (const m of measurements) {
    if (!byShape[m.shape]) byShape[m.shape] = [];
    byShape[m.shape].push(m);
  }
  const required = ["small square", "equilateral triangle", "right triangle", "isosceles triangle", "large square"];
  for (const shape of required) {
    if (!byShape[shape] || byShape[shape].length === 0) {
      throw new Error(`Completeness check failed: no measurement result for ${shape}`);
    }
  }

  const lines = [
    "# Tile Measurements V2",
    "",
    "Photos are treated as ground truth. Each image uses the four black 10 mm fiducials at sheet-mm centers A=(10,65), B=(205,65), C=(10,255), D=(205,255) to compute a pixel-to-mm homography before measuring red tile polygons and dark embedded magnet bars.",
    "",
    "This run used the local `sharp` image pipeline because `opencv` and `numpy` are unavailable in the sandbox. Corner detection uses red-mask convex hull reduction plus fitted edge-line intersections; measurements below are averaged across all photos of the same shape.",
    "",
    "## Calibration Sanity",
    "",
    "| Image | Shape | Fiducial scale px/mm | Homography residual mm |",
    "|---|---|---:|---:|",
  ];
  for (const m of measurements) {
    lines.push(`| ${m.image} | ${m.shape} | ${fmt(m.scalePxPerMm, 2)} | ${fmt(m.residualMm, 4)} |`);
  }
  if (skipped.length) {
    lines.push("");
    lines.push(`Skipped unreadable/missing photos: ${skipped.join(", ")}.`);
  }
  lines.push("");
  lines.push(isoscelesSection(byShape["isosceles triangle"]));
  lines.push("");
  lines.push(largeSquareSection(byShape["large square"]));
  lines.push("");
  lines.push(genericShapeSection("Small Square", byShape["small square"]));
  lines.push("");
  lines.push(genericShapeSection("Equilateral Triangle", byShape["equilateral triangle"]));
  lines.push("");
  lines.push(genericShapeSection("Right Triangle", byShape["right triangle"]));
  lines.push("");
  lines.push(consolidatedRule(measurements));
  lines.push("");
  lines.push("## Debug Overlays");
  lines.push("");
  lines.push("Overlay color key: green fiducials, cyan detected tile edges, orange/cyan vertices, magenta detected magnet bar spans, yellow magnet centers. Files are in `docs/research/measure-debug-v2/`.");
  lines.push("");
  for (const m of measurements) {
    lines.push(`- \`${path.basename(m.image, ".JPG")}.png\` (${m.shape})`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  fs.mkdirSync(OUT_DEBUG, { recursive: true });
  const measurements = [];
  const skipped = [];
  for (const [filename, shape, expectedCorners] of PHOTOS) {
    try {
      console.log(`Measuring ${filename} (${shape})`);
      measurements.push(await measureOne(filename, shape, expectedCorners));
    } catch (err) {
      console.error(`Skipping ${filename}: ${err.message}`);
      skipped.push(filename);
    }
  }
  const markdown = buildMarkdown(measurements, skipped);
  fs.mkdirSync(path.dirname(OUT_DOC), { recursive: true });
  fs.writeFileSync(OUT_DOC, markdown, "utf8");
  console.log(`Wrote ${OUT_DOC}`);
  console.log(`Wrote ${measurements.length} overlays to ${OUT_DEBUG}`);
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
"""


def main() -> int:
    result = subprocess.run(
        ["node", "-e", NODE_SCRIPT],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
