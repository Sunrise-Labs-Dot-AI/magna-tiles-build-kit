import sharp from "sharp";

/**
 * Pixel-level silhouette comparison: deterministic, fast, cheap.
 *
 * Takes a rendered build PNG and a reference frame JPG, extracts foreground masks from both,
 * aligns by bounding box (scale+translate invariant), and computes IoU + diagnostic metrics.
 * This is the un-gameable rendered-frame signal that complements the geometric silhouette
 * (which operates on tile vertices, not pixels).
 *
 * Usage: the vision-critic loop renders a build, runs pixelSilhouetteMatch against the reference
 * frame, and flags mismatches. Cheap enough to run every iteration. For semantic/ambiguous
 * questions (ordering, which part is wrong, "does it read as a jet"), escalate to the vision-LLM.
 */

export interface PixelSilhouetteMetrics {
  iou: number;
  targetCoverage: number;
  excessRatio: number;
  areaRatio: number;
  widthRatio: number;
  heightRatio: number;
  /** Horizontal mass balance: 0 = symmetric, >0 = right-heavy, <0 = left-heavy. */
  horizontalBalance: number;
  /** Vertical mass balance: 0 = symmetric, >0 = bottom-heavy, <0 = top-heavy. */
  verticalBalance: number;
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

/** Extract a foreground mask from an image. For renders: non-white/non-grid pixels. For reference frames: non-background. */
async function extractMask(
  imagePath: string,
  mode: "render" | "reference"
): Promise<{ mask: Uint8Array; width: number; height: number }> {
  const image = sharp(imagePath);
  const meta = await image.metadata();
  const width = meta.width ?? 100;
  const height = meta.height ?? 100;

  // Resize to a standard size for comparison (256x256 for speed + enough resolution).
  const resized = await image
    .resize(256, 256, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .raw()
    .toBuffer();

  const w = 256;
  const h = 256;
  const mask = new Uint8Array(w * h);

  for (let i = 0; i < w * h; i += 1) {
    const r = resized[i * 3];
    const g = resized[i * 3 + 1];
    const b = resized[i * 3 + 2];

    if (mode === "render") {
      // Render background is light gray grid (~230-240 range). Foreground is colored tiles.
      const isBackground = r > 210 && g > 210 && b > 210;
      mask[i] = isBackground ? 0 : 1;
    } else {
      // Reference frame: background is dark wood table + person. Foreground is the colorful build.
      // Use saturation + brightness: tiles are colorful + bright, background is muted/dark.
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
      const brightness = maxC;
      // Tiles are saturated and moderately bright.
      mask[i] = saturation > 0.15 && brightness > 60 ? 1 : 0;
    }
  }

  return { mask, width: w, height: h };
}

function computeBBox(mask: Uint8Array, width: number, height: number): BBox {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let area = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        area += 1;
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area };
}

/** Normalize a mask to its bounding box (crop + rescale to 64x64 for IoU). */
function normalizeToBBox(mask: Uint8Array, width: number, height: number, bbox: BBox, targetSize = 64): Uint8Array {
  const out = new Uint8Array(targetSize * targetSize);
  if (bbox.area === 0) return out;
  for (let j = 0; j < targetSize; j += 1) {
    for (let i = 0; i < targetSize; i += 1) {
      const srcX = Math.floor(bbox.x + (i / targetSize) * bbox.w);
      const srcY = Math.floor(bbox.y + (j / targetSize) * bbox.h);
      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        out[j * targetSize + i] = mask[srcY * width + srcX];
      }
    }
  }
  return out;
}

function massBalance(mask: Uint8Array, width: number, height: number, axis: "horizontal" | "vertical"): number {
  let leftMass = 0;
  let rightMass = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      total += 1;
      if (axis === "horizontal") {
        if (x < width / 2) leftMass += 1;
        else rightMass += 1;
      } else {
        if (y < height / 2) leftMass += 1; // top
        else rightMass += 1; // bottom
      }
    }
  }
  if (total === 0) return 0;
  return (rightMass - leftMass) / total;
}

export async function pixelSilhouetteMatch(
  renderPath: string,
  referencePath: string
): Promise<PixelSilhouetteMetrics> {
  const render = await extractMask(renderPath, "render");
  const reference = await extractMask(referencePath, "reference");

  const renderBBox = computeBBox(render.mask, render.width, render.height);
  const refBBox = computeBBox(reference.mask, reference.width, reference.height);

  // Normalize both to their bounding boxes for shape comparison (scale/position invariant).
  const normSize = 64;
  const renderNorm = normalizeToBBox(render.mask, render.width, render.height, renderBBox, normSize);
  const refNorm = normalizeToBBox(reference.mask, reference.width, reference.height, refBBox, normSize);

  let intersection = 0;
  let union = 0;
  let renderArea = 0;
  let refArea = 0;
  for (let k = 0; k < normSize * normSize; k += 1) {
    const a = renderNorm[k];
    const b = refNorm[k];
    if (a || b) union += 1;
    if (a && b) intersection += 1;
    if (a) renderArea += 1;
    if (b) refArea += 1;
  }

  return {
    iou: union === 0 ? 0 : intersection / union,
    targetCoverage: refArea === 0 ? 0 : intersection / refArea,
    excessRatio: renderArea === 0 ? 0 : (renderArea - intersection) / renderArea,
    areaRatio: refArea === 0 ? 0 : renderArea / refArea,
    widthRatio: refBBox.w === 0 ? 0 : renderBBox.w / refBBox.w,
    heightRatio: refBBox.h === 0 ? 0 : renderBBox.h / refBBox.h,
    horizontalBalance: massBalance(render.mask, render.width, render.height, "horizontal"),
    verticalBalance: massBalance(render.mask, render.width, render.height, "vertical")
  };
}
