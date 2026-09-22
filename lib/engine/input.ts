import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import type { EngineBuild } from "./build";

/** Bound work and reject malformed geometry before it reaches WASM or a quadratic check. */
export function validateEngineInput(value: EngineBuild): string[] {
  if (
    !value ||
    !Array.isArray(value.tiles) ||
    !Array.isArray(value.connections)
  )
    return ["invalid build payload"];
  if (!value.tiles.length) return ["Build must contain at least one tile."];
  if (value.tiles.length > 250)
    return [
      "Analysis resource budget exceeded: this evaluator handles 250 tiles per candidate. This is not an inventory limit.",
    ];
  if (value.connections.length > 1500) return ["too many connections"];
  const errors: string[] = [];
  const ids = new Set<string>();
  const vector = (v: unknown): v is { x: number; y: number; z: number } =>
    !!v &&
    typeof v === "object" &&
    ["x", "y", "z"].every(
      (k) =>
        typeof (v as Record<string, unknown>)[k] === "number" &&
        Number.isFinite((v as Record<string, number>)[k]) &&
        Math.abs((v as Record<string, number>)[k]) <= 10000,
    );
  for (const tile of value.tiles) {
    if (!tile || typeof tile.id !== "string" || !tile.id || ids.has(tile.id)) {
      errors.push("missing or duplicate tile id");
      continue;
    }
    ids.add(tile.id);
    if (
      !Object.hasOwn(TILE_SPECS, tile.shape) ||
      !vector(tile.position) ||
      !vector(tile.rotation)
    )
      errors.push(`invalid tile:${tile.id}`);
    if (tile.basis) {
      const axes = [tile.basis.xAxis, tile.basis.yAxis, tile.basis.zAxis];
      if (!axes.every(vector)) {
        errors.push(`invalid basis:${tile.id}`);
        continue;
      }
      const dot = (a: (typeof axes)[0], b: (typeof axes)[0]) =>
        a.x * b.x + a.y * b.y + a.z * b.z;
      if (
        axes.some((a) => Math.abs(dot(a, a) - 1) > 0.001) ||
        Math.abs(dot(axes[0], axes[1])) > 0.001 ||
        Math.abs(dot(axes[0], axes[2])) > 0.001 ||
        Math.abs(dot(axes[1], axes[2])) > 0.001
      )
        errors.push(`non-rigid basis:${tile.id}`);
    }
  }
  if (errors.length) return errors;
  for (const c of value.connections) {
    const a = value.tiles.find((t) => t.id === c?.fromTileId),
      b = value.tiles.find((t) => t.id === c?.toTileId);
    if (
      !a ||
      !b ||
      a === b ||
      !Number.isInteger(c.fromEdge) ||
      !Number.isInteger(c.toEdge) ||
      c.fromEdge < 0 ||
      c.toEdge < 0 ||
      c.fromEdge >= (TILE_SPECS[a.shape]?.maxEdges ?? 0) ||
      c.toEdge >= (TILE_SPECS[b.shape]?.maxEdges ?? 0)
    )
      errors.push("invalid connection reference");
  }
  return errors;
}
