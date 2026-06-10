import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attachTile, type EdgePlacedTile } from "../lib/magnetic-tiles/edge-attachment";
import { draftToBuildGraph } from "../lib/builder/operations";
import { gateBuild, type GateBuildResult } from "../lib/engine";
import { tilesIntersectAsPrisms } from "../lib/magnetic-tiles/prism-geometry";
import { tileWorldVertices } from "../lib/magnetic-tiles/magnet-geometry";
import type { AuthoredBuildDraft, BuilderTile } from "../lib/builder/types";
import type { Inventory, MagneticConnection, TileInstance, TileShape, Vec3 } from "../lib/magnetic-tiles/types";

/**
 * Re-author the three car ramps so they carry the elements the structured reference describes
 * (lib/reference-encoder/examples/car-ramps-reference.ts), while staying gate-valid (stand +
 * roll test). All geometry flows through the macro / edge-attachment system: this script only
 * chooses DISCRETE attachment parameters; where a fold sign or edge index is ambiguous, a
 * deterministic resolver tries the candidate set, rejects placements with raw overlaps or
 * below-ground geometry, and picks by an explicit criterion. No coordinate is ever hand-typed.
 *
 * - small:  wedge built from PAIRED RIGHT TRIANGLES (per the reference) + sloped driving panel +
 *           top landing with supports + upright guard rails flanking the slope.
 * - medium: existing gate-valid wedge/landing core EXTENDED with equilateral side bracing along
 *           the slope, landing side braces ("top edge becomes more enclosed"), and a widened
 *           rear upright support wall.
 * - large:  existing gate-valid platform/plane core EXTENDED with a taller rear wall grid,
 *           box-platform side walls around the top platform, and six equilateral side markers
 *           laid out beside the ramp.
 */

const NOW = "2026-06-09T00:00:00.000Z";
const OVERLAP_TOLERANCE = 0.03;

interface AdditionSpec {
  key: string;
  /** Parent tile id; may reference an earlier addition in the same list. */
  parentId: string;
  shape: TileShape;
  parentEdges: number[];
  childEdges?: number[];
  folds: number[];
  reverses?: boolean[];
  edgeAlign?: "start" | "center";
  edgeOffsets?: Array<number | undefined>;
  color: string;
  step: number;
  role: string;
  subassemblyId: string;
  /** Placement preference among overlap-free candidates. */
  pick: "highest" | "lowest";
}

interface ResolvedAddition {
  tile: TileInstance;
  connection: MagneticConnection;
}

async function main(): Promise<void> {
  const plans: Array<{ id: string; apply: () => AuthoredBuildDraft }> = [
    { id: "small-car-ramp", apply: authorSmallRamp },
    { id: "medium-car-ramp", apply: extendMediumRamp },
    { id: "large-car-ramp", apply: extendLargeRamp }
  ];

  const failures: string[] = [];
  for (const plan of plans) {
    try {
      const draft = plan.apply();
      const gate = await gateDraft(draft);
      if (!gate.passed) {
        failures.push(`${plan.id} failed the gate after re-authoring:\n${gate.reasons.join("\n")}`);
        continue;
      }
      writeFileSync(`build-drafts/${plan.id}.json`, `${JSON.stringify(draft, null, 2)}\n`);
      console.log(
        `${plan.id}: gate passed (${gate.reasons.filter((reason) => reason.startsWith("engine passed")).join("; ")})`
      );
      console.log(`  tiles: ${draft.tiles.length}, BOM: ${JSON.stringify(compactInventory(draft.expectedInventory))}`);
    } catch (error) {
      failures.push(`${plan.id} threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n\n"));
  }
}

/**
 * Small ramp: extend the gate-valid wedge/landing core with guard rails on the landing sides.
 *
 * The reference's "wedge from paired right triangles" was probed as a fresh wedgePrism
 * composition (sideShape right-triangle): its 45-degree slope fails BOTH the stand test alone
 * (max displacement 1.66) and the roll test with a landing, so the engine-honest core stays the
 * isosceles wedge already in the draft (which carries the described orange sloped face, red
 * landing + vertical support, and the paired green right triangles as landing side supports).
 */
function authorSmallRamp(): AuthoredBuildDraft {
  const draft = existingDraft("small-car-ramp");
  return applyAdditions(
    draft,
    [
      upright("small-left-guard-rail", "red-top-landing-square", [0], 5, "#7b2cbf", "upright landing side guard rail triangle", "guards"),
      upright("small-right-guard-rail", "red-top-landing-square", [2], 5, "#f7b733", "upright landing side guard rail triangle", "guards")
    ],
    "Extended per the car-ramps reference description: the gate-valid wedge (orange sloped driving face, red landing with vertical support, paired green right-triangle side supports) now carries upright equilateral guard rails enclosing the landing. Additions authored via the edge-attachment system with a deterministic fold resolver; gateBuild passes stand + roll test headlessly."
  );
}

/** Medium ramp: extend the gate-valid wedge/landing core with the described wall + bracing. */
function extendMediumRamp(): AuthoredBuildDraft {
  const draft = existingDraft("medium-car-ramp");
  return applyAdditions(
    draft,
    [
      // Equilateral side bracing along the sloped driving surface (reference: "brace slopes with
      // equilateral triangles", "repeated triangular side panels").
      upright("medium-lower-left-slope-brace", "medium-lower-sloped-driving-square", [0], 6, "#ffb703", "left upright side brace triangle along the slope", "braces"),
      upright("medium-lower-right-slope-brace", "medium-lower-sloped-driving-square", [2], 6, "#ffb703", "right upright side brace triangle along the slope", "braces"),
      upright("medium-upper-left-slope-brace", "medium-upper-sloped-driving-square", [0], 6, "#ffb703", "left upright side brace triangle along the slope", "braces"),
      upright("medium-upper-right-slope-brace", "medium-upper-sloped-driving-square", [2], 6, "#ffb703", "right upright side brace triangle along the slope", "braces"),
      // Landing side braces (reference: "add top and side triangle braces", "top edge becomes
      // more enclosed").
      upright("medium-landing-left-brace", "medium-top-landing-square", [0], 7, "#ef476f", "left upright landing side brace triangle", "braces"),
      upright("medium-landing-right-brace", "medium-top-landing-square", [2], 7, "#ef476f", "right upright landing side brace triangle", "braces"),
      upright("medium-extended-landing-left-brace", "medium-extended-top-landing-square", [0], 7, "#ef476f", "left upright landing side brace triangle", "braces"),
      upright("medium-extended-landing-right-brace", "medium-extended-top-landing-square", [2], 7, "#ef476f", "right upright landing side brace triangle", "braces"),
      // Widen the vertical end support into the described rear upright support wall.
      coplanarSquare("medium-rear-wall-left-square", "medium-extended-red-vertical-leg-support-square", [3], 8, "#118ab2", "rear upright support wall square", "rear-support-wall"),
      coplanarSquare("medium-rear-wall-right-square", "medium-extended-red-vertical-leg-support-square", [1], 8, "#118ab2", "rear upright support wall square", "rear-support-wall")
    ],
    "Extended per the car-ramps reference description: the gate-valid continuous wedge now carries equilateral side bracing along the slope, landing side braces enclosing the top, and a widened rear upright support wall. Additions authored via the edge-attachment system with a deterministic fold resolver; gateBuild passes stand + roll test headlessly."
  );
}

/** Large ramp: extend the gate-valid platform/plane core with wall, box sides, and markers. */
function extendLargeRamp(): AuthoredBuildDraft {
  const draft = existingDraft("large-car-ramp");
  return applyAdditions(
    draft,
    [
      // Taller rear wall (reference: "assemble square tiles into a large vertical grid panel").
      coplanarSquare("large-left-tall-rear-wall-square", "large-left-upper-rear-wall-square", [2], 6, "#118ab2", "large tall rear wall grid square", "large-rear-support-wall"),
      coplanarSquare("large-right-tall-rear-wall-square", "large-right-upper-rear-wall-square", [2], 6, "#118ab2", "large tall rear wall grid square", "large-rear-support-wall"),
      // Box-platform walls widening the rear support box (reference: "red square walls form a
      // box" under the platform that the ramp face lands on). The resolver finds the outward
      // coplanar extension (up/inward/through-wall candidates all collide and are rejected).
      {
        key: "large-left-box-side-wall",
        parentId: "large-left-front-box-support-square",
        shape: "small-square",
        parentEdges: [0, 1, 2, 3],
        childEdges: [0, 1, 2, 3],
        folds: [0],
        reverses: [true, false],
        color: "#d62828",
        step: 7,
        role: "large left box side wall square",
        subassemblyId: "large-platform-box",
        pick: "highest"
      },
      {
        key: "large-right-box-side-wall",
        parentId: "large-right-front-box-support-square",
        shape: "small-square",
        parentEdges: [0, 1, 2, 3],
        childEdges: [0, 1, 2, 3],
        folds: [0],
        reverses: [true, false],
        color: "#d62828",
        step: 7,
        role: "large right box side wall square",
        subassemblyId: "large-platform-box",
        pick: "highest"
      },
      // Six equilateral side markers (reference: "yellow and green triangles are placed near
      // ramp sides"): zig-zag strips laid flat on the table off the wedge-side ground edges.
      groundMarker("large-left-side-marker-1", "large-left-long-wedge-side", [0, 1, 2], 8, "#ffb703"),
      groundMarker("large-left-side-marker-2", "large-left-side-marker-1", [1, 2], 8, "#06d6a0"),
      groundMarker("large-left-side-marker-3", "large-left-side-marker-2", [1, 2], 8, "#ffb703"),
      groundMarker("large-right-side-marker-1", "large-right-long-wedge-side", [0, 1, 2], 8, "#06d6a0"),
      groundMarker("large-right-side-marker-2", "large-right-side-marker-1", [1, 2], 8, "#ffb703"),
      groundMarker("large-right-side-marker-3", "large-right-side-marker-2", [1, 2], 8, "#06d6a0")
    ],
    "Extended per the car-ramps reference description: the gate-valid platform/plane core now carries a taller rear wall grid, box-platform walls around the top platform, and six equilateral side markers laid out beside the ramp. Additions authored via the edge-attachment system with a deterministic fold resolver; gateBuild passes stand + the stricter clear-descent roll test headlessly."
  );
}

/** Upright triangle flanking a deck/landing square: resolver picks the overlap-free up fold. */
function upright(
  key: string,
  parentId: string,
  parentEdges: number[],
  step: number,
  color: string,
  role: string,
  subassemblyId: string
): AdditionSpec {
  return {
    key,
    parentId,
    shape: "equilateral-triangle",
    parentEdges,
    folds: [Math.PI / 2, -Math.PI / 2],
    reverses: [false, true],
    color,
    step,
    role: `${key.replace(/-/g, " ")} ${role}`,
    subassemblyId,
    pick: "highest"
  };
}

/** Coplanar square extension (wall growth), like the squareGrid recipe rows. */
function coplanarSquare(
  key: string,
  parentId: string,
  parentEdges: number[],
  step: number,
  color: string,
  role: string,
  subassemblyId: string
): AdditionSpec {
  return {
    key,
    parentId,
    shape: "small-square",
    parentEdges,
    childEdges: [0, 1, 2, 3],
    folds: [0],
    reverses: [true, false],
    color,
    step,
    role: `${key.replace(/-/g, " ")} ${role}`,
    subassemblyId,
    pick: "highest"
  };
}

/** Flat equilateral marker laid on the table; resolver finds the ground edge + flat fold. */
function groundMarker(key: string, parentId: string, parentEdges: number[], step: number, color: string): AdditionSpec {
  return {
    key,
    parentId,
    shape: "equilateral-triangle",
    parentEdges,
    childEdges: [0, 1, 2],
    folds: [Math.PI / 2, -Math.PI / 2, 0],
    reverses: [false, true],
    color,
    step,
    role: `${key.replace(/-/g, " ")} flat side marker triangle beside the ramp`,
    subassemblyId: "side-markers",
    pick: "lowest"
  };
}

function applyAdditions(draft: AuthoredBuildDraft, specs: AdditionSpec[], notes: string): AuthoredBuildDraft {
  const tiles: BuilderTile[] = draft.tiles.map((tile) => ({ ...tile }));
  const connections: MagneticConnection[] = draft.connections?.map((connection) => ({ ...connection })) ?? [];

  for (const spec of specs) {
    const resolved = resolveAddition(tiles, spec);
    tiles.push({ ...resolved.tile, authoredMode: "edge-snap", confirmed: true });
    connections.push(resolved.connection);
  }

  return {
    ...draft,
    status: "engine-valid",
    updatedAt: NOW,
    notes,
    expectedInventory: inventoryFor(tiles),
    visualSignoff: false,
    tiles,
    connections
  };
}

/**
 * Deterministic candidate resolver: enumerate the discrete candidate placements, drop any with a
 * raw overlap against the current build or geometry below the table, then pick by the spec's
 * criterion (highest = upright guard/wall, lowest = flat marker). Ties break by candidate order.
 */
function resolveAddition(tiles: BuilderTile[], spec: AdditionSpec): ResolvedAddition {
  const parent = tiles.find((tile) => tile.id === spec.parentId);
  if (!parent) throw new Error(`Missing parent tile ${spec.parentId} for ${spec.key}`);

  const candidates: Array<{ tile: TileInstance; connection: MagneticConnection; centroidY: number; order: number }> = [];
  let order = 0;
  for (const parentEdge of spec.parentEdges) {
    for (const childEdge of spec.childEdges ?? [0]) {
      for (const fold of spec.folds) {
        for (const reverse of spec.reverses ?? [false]) {
          for (const edgeOffset of spec.edgeOffsets ?? [undefined]) {
            order += 1;
            const placed = attachTile(toEdgePlaced(parent), {
              key: spec.key,
              shape: spec.shape,
              attachTo: spec.parentId,
              parentEdge,
              childEdge,
              foldAngle: fold,
              edgeAlign: spec.edgeAlign,
              edgeOffset,
              reverse,
              color: spec.color,
              step: spec.step,
              role: spec.role,
              subassemblyId: spec.subassemblyId
            });
            const tile = edgePlacedToTile(placed, spec.parentId);
            const vertices = tileWorldVertices(tile);
            if (Math.min(...vertices.map((vertex) => vertex.y)) < -0.05) continue;
            const overlapping = tiles.some((existing) => {
              const intersection = tilesIntersectAsPrisms(existing, tile);
              return intersection.overlaps && intersection.penetration > OVERLAP_TOLERANCE;
            });
            if (overlapping) continue;
            candidates.push({
              tile,
              connection: {
                fromTileId: spec.parentId,
                fromEdge: parentEdge,
                toTileId: spec.key,
                toEdge: childEdge,
                kind: "edge"
              },
              centroidY: vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length,
              order
            });
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No overlap-free placement found for ${spec.key} on ${spec.parentId}`);
  }
  candidates.sort((first, second) =>
    spec.pick === "highest"
      ? second.centroidY - first.centroidY || first.order - second.order
      : first.centroidY - second.centroidY || first.order - second.order
  );
  return { tile: candidates[0].tile, connection: candidates[0].connection };
}

async function gateDraft(draft: AuthoredBuildDraft): Promise<GateBuildResult> {
  return gateBuild(draftToBuildGraph(draft));
}

function existingDraft(id: string): AuthoredBuildDraft {
  return JSON.parse(readFileSync(`build-drafts/${id}.json`, "utf8")) as AuthoredBuildDraft;
}

function toEdgePlaced(tile: BuilderTile): EdgePlacedTile {
  if (!tile.basis) throw new Error(`Tile ${tile.id} is missing a basis`);
  return {
    key: tile.id,
    shape: tile.shape,
    position: tile.position,
    basis: tile.basis,
    color: tile.color,
    step: tile.step,
    role: tile.role,
    subassemblyId: tile.subassemblyId
  };
}

function edgePlacedToTile(tile: EdgePlacedTile, parentTileId: string): TileInstance {
  return {
    id: tile.key,
    shape: tile.shape,
    color: tile.color ?? "#118ab2",
    position: roundVec(tile.position),
    rotation: { x: 0, y: 0, z: 0 },
    basis: tile.basis
      ? { xAxis: roundVec(tile.basis.xAxis), yAxis: roundVec(tile.basis.yAxis), zAxis: roundVec(tile.basis.zAxis) }
      : undefined,
    step: tile.step,
    role: tile.role,
    subassemblyId: tile.subassemblyId,
    parentTileId,
    parentEdge: tile.parentEdge,
    childEdge: tile.childEdge,
    foldAngle: tile.foldAngle === undefined ? undefined : round(tile.foldAngle)
  };
}

function inventoryFor(tiles: BuilderTile[]): Partial<Inventory> {
  const inventory: Partial<Inventory> = {
    "small-square": 0,
    "large-square": 0,
    "equilateral-triangle": 0,
    "right-triangle": 0,
    "isosceles-triangle": 0
  };
  for (const tile of tiles) {
    inventory[tile.shape] = (inventory[tile.shape] ?? 0) + 1;
  }
  return inventory;
}

function compactInventory(inventory: Partial<Inventory> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(inventory ?? {}).filter(([, count]) => (count ?? 0) > 0)) as Record<
    string,
    number
  >;
}

function roundVec<T extends Vec3>(value: T): T {
  return { x: round(value.x), y: round(value.y), z: round(value.z) } as T;
}

function round(value: number): number {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
