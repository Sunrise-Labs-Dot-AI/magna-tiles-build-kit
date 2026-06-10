/**
 * PNG decode/encode helpers for the measured ingestion pipeline.
 *
 * Uses pngjs (pure JS, no native builds). ffmpeg writes analysis frames as
 * grayscale PNGs; these helpers turn them into GrayFrame pixel buffers for the
 * deterministic segmentation code, and turn silhouette masks back into small
 * PNGs stored in the local video cache.
 */
import { PNG } from "pngjs";
import type { GrayFrame } from "./segmentation";

/** Decode a PNG buffer to a grayscale frame (luma from RGB if not already gray). */
export function decodePngToGrayFrame(buffer: Buffer, seconds: number): GrayFrame {
  const png = PNG.sync.read(buffer);
  const pixels = new Uint8Array(png.width * png.height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    // Integer Rec.601 luma; for gray-source PNGs r=g=b so this is the identity.
    pixels[index] = (r * 77 + g * 151 + b * 28) >> 8;
  }
  return { seconds, width: png.width, height: png.height, pixels };
}

/** Encode a binary silhouette mask (1 = foreground) as a black/white PNG. */
export function encodeMaskToPng(mask: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    const value = mask[index] ? 255 : 0;
    const offset = index * 4;
    png.data[offset] = value;
    png.data[offset + 1] = value;
    png.data[offset + 2] = value;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Encode a grayscale frame as a PNG (used by tests to round-trip synthetic frames). */
export function encodeGrayFrameToPng(frame: GrayFrame): Buffer {
  const png = new PNG({ width: frame.width, height: frame.height });
  for (let index = 0; index < frame.width * frame.height; index += 1) {
    const value = frame.pixels[index] ?? 0;
    const offset = index * 4;
    png.data[offset] = value;
    png.data[offset + 1] = value;
    png.data[offset + 2] = value;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Decode a black/white mask PNG back into a binary Uint8Array (1 = foreground). */
export function decodeMaskPng(buffer: Buffer): { mask: Uint8Array; width: number; height: number } {
  const frame = decodePngToGrayFrame(buffer, 0);
  const mask = new Uint8Array(frame.pixels.length);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = frame.pixels[index] >= 128 ? 1 : 0;
  }
  return { mask, width: frame.width, height: frame.height };
}
