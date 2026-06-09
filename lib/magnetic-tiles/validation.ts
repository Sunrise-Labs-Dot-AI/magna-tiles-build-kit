import { SMALL_EDGE, TILE_SPECS, TILE_THICKNESS, emptyInventory, inventoryForPreset, SHAPE_ORDER } from "./catalog";
import { findMagneticEdgeMatch, tileWorldVertices } from "./magnet-geometry";
import { tilesIntersectAsPrisms } from "./prism-geometry";
import type {
  BuildGraph,
  Inventory,
  MagneticConnection,
  StabilityReport,
  TileInstance,
  ValidationIssue
} from "./types";

const PHYSICAL_CONTACT_TOLERANCE = 0.03;

export function validateBuild(build: BuildGraph): StabilityReport {
  const availableInventory = inventoryForPreset(build.inventoryPreset ?? "classic-100");
  const usedInventory = countInventory(build.tiles);
  const remainingInventory = calculateRemaining(usedInventory, availableInventory);
  const issues: ValidationIssue[] = [
    ...validateInventory(usedInventory, availableInventory, build.inventoryPreset ?? "classic-100"),
    ...validateDisconnectedComponents(build),
    ...validateMagneticConstraints(build),
    ...validateFloatingTiles(build.tiles),
    ...validateOverlaps(build.tiles),
    ...validateMagnetAlignment(build.tiles, build.connections),
    ...validateSlenderness(build),
    ...validateStepOrder(build)
  ];
  const status = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.some((issue) => issue.severity === "warning")
      ? "warning"
      : "pass";

  return {
    status,
    issues,
    usedInventory,
    remainingInventory
  };
}

export function countInventory(tiles: TileInstance[]): Inventory {
  const counts = emptyInventory();
  tiles.forEach((tile) => {
    counts[tile.shape] += 1;
  });
  return counts;
}

function calculateRemaining(usedInventory: Inventory, availableInventory: Inventory): Inventory {
  return SHAPE_ORDER.reduce((remaining, shape) => {
    remaining[shape] = availableInventory[shape] - usedInventory[shape];
    return remaining;
  }, emptyInventory());
}

function validateInventory(
  usedInventory: Inventory,
  availableInventory: Inventory,
  inventoryPreset: BuildGraph["inventoryPreset"]
): ValidationIssue[] {
  return SHAPE_ORDER.flatMap((shape) => {
    const overage = usedInventory[shape] - availableInventory[shape];
    if (overage <= 0) return [];
    return [
      {
        severity: "error",
        code: "inventory-overrun",
        message: `Too many ${TILE_SPECS[shape].label.toLowerCase()} tiles`,
        detail: `Uses ${usedInventory[shape]}, but the ${inventoryPreset} inventory only has ${availableInventory[shape]}.`
      }
    ];
  });
}

function validateDisconnectedComponents(build: BuildGraph): ValidationIssue[] {
  if (build.tiles.length === 0) {
    return [
      {
        severity: "error",
        code: "empty-build",
        message: "No tiles generated",
        detail: "The prompt did not produce a buildable tile graph."
      }
    ];
  }

  const neighbors = new Map<string, Set<string>>();
  build.tiles.forEach((tile) => neighbors.set(tile.id, new Set()));
  build.connections.forEach((connection) => {
    neighbors.get(connection.fromTileId)?.add(connection.toTileId);
    neighbors.get(connection.toTileId)?.add(connection.fromTileId);
  });

  const visited = new Set<string>();
  const stack = [build.tiles[0].id];
  while (stack.length > 0) {
    const tileId = stack.pop();
    if (!tileId || visited.has(tileId)) continue;
    visited.add(tileId);
    neighbors.get(tileId)?.forEach((next) => stack.push(next));
  }

  if (visited.size === build.tiles.length) return [];

  const visuallyClose = build.tiles.filter((tile) => !visited.has(tile.id)).every((tile) =>
    build.tiles.some((candidate) => candidate.id !== tile.id && tilesAreCloseEnoughToAttach(tile, candidate))
  );

  return [
    {
      severity: visuallyClose ? "warning" : "error",
      code: "disconnected-components",
      message: visuallyClose ? "Some pieces need confirmed magnet joins" : "Build has disconnected sections",
      detail: visuallyClose
        ? `${build.tiles.length - visited.size} visually adjacent tile(s) are not yet proven as edge-to-edge magnetic joins.`
        : `${build.tiles.length - visited.size} tile(s) are not connected to the main structure.`,
      tileIds: build.tiles.filter((tile) => !visited.has(tile.id)).map((tile) => tile.id)
    }
  ];
}

function validateMagneticConstraints(build: BuildGraph): ValidationIssue[] {
  if (build.tiles.length > 1 && build.connections.length === 0) {
    return [
      {
        severity: "error",
        code: "no-magnetic-joins",
        message: "No magnetic joins were found",
        detail: "The pieces are present, but no edge-to-edge magnet connections were detected."
      }
    ];
  }

  const byId = new Map(build.tiles.map((tile) => [tile.id, tile]));
  const invalidConnections = build.connections.filter((connection) => {
    const first = byId.get(connection.fromTileId);
    const second = byId.get(connection.toTileId);
    if (!first || !second) return true;
    return !findMagneticEdgeMatch(first, second);
  });

  if (invalidConnections.length === 0) return [];

  return [
    {
      severity: "warning",
      code: "magnet-constraint",
      message: "Some joins are not on magnet edges",
      detail:
        "Each connection now has to line up with a real tile edge. These pieces are close visually, but their magnetic hinge lines do not match.",
      tileIds: Array.from(
        new Set(invalidConnections.flatMap((connection) => [connection.fromTileId, connection.toTileId]))
      )
    }
  ];
}

function validateFloatingTiles(tiles: TileInstance[]): ValidationIssue[] {
  const floating = tiles.filter((tile) => {
    const tileBox = collisionBox(tile);
    const bottom = tileBox.minY;
    if (bottom <= 0.05) return false;
    return !tiles.some((candidate) => {
      if (candidate.id === tile.id) return false;
      const candidateBox = collisionBox(candidate);
      const xGap = Math.max(candidateBox.minX - tileBox.maxX, tileBox.minX - candidateBox.maxX, 0);
      const yGap = Math.max(candidateBox.minY - tileBox.maxY, tileBox.minY - candidateBox.maxY, 0);
      const zGap = Math.max(candidateBox.minZ - tileBox.maxZ, tileBox.minZ - candidateBox.maxZ, 0);
      const overlapX = overlapLength(candidateBox.minX, candidateBox.maxX, tileBox.minX, tileBox.maxX);
      const overlapY = overlapLength(candidateBox.minY, candidateBox.maxY, tileBox.minY, tileBox.maxY);
      const overlapZ = overlapLength(candidateBox.minZ, candidateBox.maxZ, tileBox.minZ, tileBox.maxZ);
      const edgeSupported =
        candidateBox.minY <= tileBox.minY + 0.35 &&
        findMagneticEdgeMatch(tile, candidate) !== null;
      if (edgeSupported) return true;
      const sideSupported =
        candidateBox.minY <= tileBox.minY + 0.35 &&
        yGap <= 0.45 &&
        overlapY > 0.7 &&
        ((xGap <= 0.45 && overlapZ > 0.05) || (zGap <= 0.45 && overlapX > 0.05));
      if (sideSupported) return true;
      const candidateTop = candidateBox.maxY;
      const verticalTouch = Math.abs(candidateTop - bottom) < 0.35;
      const horizontalOverlap =
        overlapX > 0.05 &&
        overlapZ > 0.05;
      return verticalTouch && horizontalOverlap;
    });
  });

  if (floating.length === 0) return [];

  return [
    {
      severity: "warning",
      code: "floating-tiles",
      message: "Some tiles are unsupported",
      detail: "Each elevated tile needs a lower tile or side wall touching beneath it.",
      tileIds: floating.map((tile) => tile.id)
    }
  ];
}

function validateOverlaps(tiles: TileInstance[]): ValidationIssue[] {
  const duplicatePlacements: string[] = [];
  const physicalOverlaps: string[] = [];
  const overlapDetails: string[] = [];

  for (let firstIndex = 0; firstIndex < tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tiles.length; secondIndex += 1) {
      const first = tiles[firstIndex];
      const second = tiles[secondIndex];
      const sameCenter =
        Math.abs(first.position.x - second.position.x) < 0.08 &&
        Math.abs(first.position.y - second.position.y) < 0.08 &&
        Math.abs(first.position.z - second.position.z) < 0.08;
      const sameRotation = orientationsMatch(first, second);
      if (sameCenter && sameRotation) {
        duplicatePlacements.push(first.id, second.id);
      } else if (tilesPhysicallyOverlap(first, second)) {
        physicalOverlaps.push(first.id, second.id);
        overlapDetails.push(`${first.id} (${first.role}) intersects ${second.id} (${second.role})`);
      }
    }
  }

  const issues: ValidationIssue[] = [];
  if (duplicatePlacements.length > 0) {
    issues.push({
      severity: "error",
      code: "duplicate-placement",
      message: "Tiles occupy the exact same space",
      detail: "Two or more tiles have the same position and orientation, which is physically impossible.",
      tileIds: Array.from(new Set(duplicatePlacements))
    });
  }

  if (physicalOverlaps.length > 0) {
    issues.push({
      severity: "error",
      code: "tile-overlap",
      message: "Tiles overlap in the same space",
      detail: `One or more decorative or bracing tiles pass through another tile. Real pieces cannot overlap, so this build needs a revised attachment or a different detail. ${overlapDetails.slice(0, 8).join("; ")}${overlapDetails.length > 8 ? "; ..." : ""}`,
      tileIds: Array.from(new Set(physicalOverlaps))
    });
  }

  return issues;
}

function validateMagnetAlignment(tiles: TileInstance[], connections: MagneticConnection[]): ValidationIssue[] {
  const weakContacts: string[] = [];
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));

  connections.forEach((connection) => {
    const first = byId.get(connection.fromTileId);
    const second = byId.get(connection.toTileId);
    if (!first || !second) return;
    if (tilesPhysicallyOverlap(first, second)) return;
    if (findMagneticEdgeMatch(first, second) !== null) return;
    if (!contactLooksMagnetCompatible(first, second)) {
      weakContacts.push(first.id, second.id);
    }
  });

  if (weakContacts.length === 0) return [];

  return [
    {
      severity: "warning",
      code: "magnet-alignment",
      message: "Some joins may miss the magnets",
      detail:
        `A few nearby pieces do not meet edge-to-edge on a ${SMALL_EDGE}-inch magnetic tile grid. They may look connected in 3D but fail with real magnets.`,
      tileIds: Array.from(new Set(weakContacts))
    }
  ];
}

function tilesAreCloseEnoughToAttach(first: TileInstance, second: TileInstance): boolean {
  const firstSpec = TILE_SPECS[first.shape];
  const secondSpec = TILE_SPECS[second.shape];
  const xDistance = Math.abs(first.position.x - second.position.x);
  const yDistance = Math.abs(first.position.y - second.position.y);
  const zDistance = Math.abs(first.position.z - second.position.z);
  const nearInPlane =
    zDistance < 0.4 &&
    xDistance <= (firstSpec.width + secondSpec.width) / 2 + 0.5 &&
    yDistance <= (firstSpec.height + secondSpec.height) / 2 + 0.5;
  const rightAngleReturn =
    zDistance <= SMALL_EDGE + 0.2 &&
    xDistance <= (firstSpec.width + secondSpec.width) / 2 + 0.5 &&
    yDistance <= (firstSpec.height + secondSpec.height) / 2 + 0.5;

  return nearInPlane || rightAngleReturn;
}

function tilesPhysicallyOverlap(first: TileInstance, second: TileInstance): boolean {
  const intersection = tilesIntersectAsPrisms(first, second);
  if (!intersection.overlaps) return false;

  const sharesMagneticHinge = findMagneticEdgeMatch(first, second) !== null;
  if (sharesMagneticHinge && intersection.penetration <= PHYSICAL_CONTACT_TOLERANCE) return false;

  return true;
}

function contactLooksMagnetCompatible(first: TileInstance, second: TileInstance): boolean {
  const firstBox = collisionBox(first);
  const secondBox = collisionBox(second);
  const xGap = Math.max(firstBox.minX - secondBox.maxX, secondBox.minX - firstBox.maxX, 0);
  const yGap = Math.max(firstBox.minY - secondBox.maxY, secondBox.minY - firstBox.maxY, 0);
  const zGap = Math.max(firstBox.minZ - secondBox.maxZ, secondBox.minZ - firstBox.maxZ, 0);
  const overlapX = overlapLength(firstBox.minX, firstBox.maxX, secondBox.minX, secondBox.maxX);
  const overlapY = overlapLength(firstBox.minY, firstBox.maxY, secondBox.minY, secondBox.maxY);
  const overlapZ = overlapLength(firstBox.minZ, firstBox.maxZ, secondBox.minZ, secondBox.maxZ);
  const edgeTolerance = 0.42;

  const verticalEdgeJoin =
    xGap <= edgeTolerance && yGap <= edgeTolerance && overlapY >= SMALL_EDGE * 0.75 && overlapZ >= 0.08;
  const stackedEdgeJoin =
    yGap <= edgeTolerance && xGap <= edgeTolerance && overlapX >= SMALL_EDGE * 0.75 && overlapZ >= 0.08;
  const stackedSideReturnJoin =
    yGap <= edgeTolerance && xGap <= edgeTolerance && overlapX >= 0.08 && overlapZ >= SMALL_EDGE * 0.75;
  const sideReturnJoin =
    zGap <= SMALL_EDGE + 0.1 && xGap <= edgeTolerance && yGap <= edgeTolerance && overlapY >= SMALL_EDGE * 0.75;

  return verticalEdgeJoin || stackedEdgeJoin || stackedSideReturnJoin || sideReturnJoin;
}

function collisionBox(tile: TileInstance) {
  const vertices = tileWorldVertices(tile);
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const zs = vertices.map((vertex) => vertex.z);
  return {
    minX: Math.min(...xs) - TILE_THICKNESS / 2,
    maxX: Math.max(...xs) + TILE_THICKNESS / 2,
    minY: Math.min(...ys) - TILE_THICKNESS / 2,
    maxY: Math.max(...ys) + TILE_THICKNESS / 2,
    minZ: Math.min(...zs) - TILE_THICKNESS / 2,
    maxZ: Math.max(...zs) + TILE_THICKNESS / 2
  };
}

function overlapLength(firstMin: number, firstMax: number, secondMin: number, secondMax: number): number {
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

function orientationsMatch(first: TileInstance, second: TileInstance): boolean {
  if (first.basis || second.basis) {
    if (!first.basis || !second.basis) return false;
    return (
      vectorsMatch(first.basis.xAxis, second.basis.xAxis) &&
      vectorsMatch(first.basis.yAxis, second.basis.yAxis) &&
      vectorsMatch(first.basis.zAxis, second.basis.zAxis)
    );
  }

  return (
    Math.abs(first.rotation.x - second.rotation.x) < 0.08 &&
    Math.abs(first.rotation.y - second.rotation.y) < 0.08 &&
    Math.abs(first.rotation.z - second.rotation.z) < 0.08
  );
}

function vectorsMatch(first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }): boolean {
  return (
    Math.abs(first.x - second.x) < 0.08 &&
    Math.abs(first.y - second.y) < 0.08 &&
    Math.abs(first.z - second.z) < 0.08
  );
}

function validateSlenderness(build: BuildGraph): ValidationIssue[] {
  const footprint = Math.max(build.bounds.width, build.bounds.depth, 1);
  const ratio = build.bounds.height / footprint;
  if (ratio < 1.5) return [];

  return [
    {
      severity: "warning",
      code: "slender-build",
      message: "Build may be tippy",
      detail: `Height-to-footprint ratio is ${ratio.toFixed(1)}. Add side returns or widen the base when building with younger kids.`
    }
  ];
}

function validateStepOrder(build: BuildGraph): ValidationIssue[] {
  const badTiles = build.tiles.filter((tile) => {
    const tileBox = collisionBox(tile);
    const bottom = tileBox.minY;
    if (bottom <= 0.05) return false;
    return build.tiles.some((candidate) => {
      if (candidate.id === tile.id) return false;
      const candidateBox = collisionBox(candidate);
      const candidateTop = candidateBox.maxY;
      const overlapX = overlapLength(candidateBox.minX, candidateBox.maxX, tileBox.minX, tileBox.maxX);
      const overlapZ = overlapLength(candidateBox.minZ, candidateBox.maxZ, tileBox.minZ, tileBox.maxZ);
      const substantialContact = overlapX > 0.35 && overlapZ > 0.35;
      return (
        Math.abs(candidateTop - bottom) < 0.35 &&
        substantialContact &&
        findMagneticEdgeMatch(tile, candidate) === null &&
        candidate.step > tile.step
      );
    });
  });

  if (badTiles.length === 0) return [];

  return [
    {
      severity: "warning",
      code: "step-order",
      message: "Instruction order may be confusing",
      detail: "One or more upper tiles are introduced before their supports.",
      tileIds: badTiles.map((tile) => tile.id)
    }
  ];
}
