import {
  composeMacros,
  joinByPorts,
  macroBom,
  mirrorMacro,
  tilePrimitive,
  type TileMacro
} from "@/lib/magnetic-tiles/macros";
import { assembleBuildGraph, draftToBuildGraph } from "@/lib/builder/operations";
import { gateBuild } from "@/lib/engine";
import { buildBounds } from "@/lib/engine/build";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import type { BuildGraph, Inventory, TileInstance, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";

type PlannerPart =
  | { id: "body"; kind: "fuselageTube"; length: number }
  | { id: "nose"; kind: "triangularNose"; dependsOn: "body" }
  | { id: "wings"; kind: "mirroredWingPair"; dependsOn: "nose"; rootCount: number }
  | { id: "top-fin"; kind: "topFin"; dependsOn: "wings" };

interface PlannerPlan {
  id: string;
  title: string;
  family: "aircraft";
  expectedInventory: Partial<Inventory>;
  parts: PlannerPart[];
}

const COLORS = {
  body: "#118ab2",
  nose: "#8ecae6",
  wing: "#ef476f",
  fin: "#7b2cbf"
};
const WING_FOLD = -89 * Math.PI / 180;

const jetPlan: PlannerPlan = {
  id: "research-jet-planner-poc",
  title: "Research Jet Planner POC",
  family: "aircraft",
  expectedInventory: {
    "small-square": 16,
    "equilateral-triangle": 9,
    "right-triangle": 10,
    "isosceles-triangle": 5
  },
  parts: [
    { id: "body", kind: "fuselageTube", length: 4 },
    { id: "nose", kind: "triangularNose", dependsOn: "body" },
    { id: "wings", kind: "mirroredWingPair", dependsOn: "nose", rootCount: 3 },
    { id: "top-fin", kind: "topFin", dependsOn: "wings" }
  ]
};

async function main() {
  const macro = executePlan(jetPlan);
  const draft = macroToDraft(jetPlan, macro);
  let strictPassed = false;
  let strictError: string | undefined;
  let graph: BuildGraph;

  try {
    graph = assembleBuildGraph(draft, { strict: true });
    strictPassed = true;
  } catch (error) {
    strictError = error instanceof Error ? error.message : String(error);
    graph = draftToBuildGraph(draft);
  }

  const gate = await gateBuild(graph);
  const bounds = buildBounds(graph.tiles);
  const result = {
    planId: jetPlan.id,
    partKinds: jetPlan.parts.map((part) => part.kind),
    tileCount: graph.tiles.length,
    connectionCount: graph.connections.length,
    bom: macroBom(macro),
    strictPassed,
    strictError,
    gatePassed: gate.passed,
    gateReasons: gate.reasons,
    bounds: {
      width: round(bounds.max.x - bounds.min.x),
      height: round(bounds.max.y - bounds.min.y),
      depth: round(bounds.max.z - bounds.min.z)
    }
  };

  console.log(JSON.stringify(result, null, 2));
}

function executePlan(plan: PlannerPlan): TileMacro {
  let current: TileMacro | undefined;

  for (const part of plan.parts) {
    if (part.kind === "fuselageTube") {
      current = fuselageTube(part.length);
      continue;
    }
    if (!current) throw new Error(`Plan ${plan.id} tried to attach ${part.id} before body`);
    if (part.kind === "triangularNose") current = addNose(current);
    if (part.kind === "mirroredWingPair") current = addMirroredWings(current, part.rootCount);
    if (part.kind === "topFin") current = addTopFin(current);
  }

  if (!current) throw new Error(`Plan ${plan.id} produced no macro`);
  return composeMacros(current);
}

function fuselageTube(length: number): TileMacro {
  let tube = square("fuselage-bottom-1", "horizontal", 1, "fuselage bottom square tube belly panel");

  for (let index = 2; index <= length; index += 1) {
    tube = joinByPorts(
      tube,
      `fuselage-bottom-${index - 1}.right`,
      square(`fuselage-bottom-${index}`, "horizontal", 1, "fuselage bottom square tube belly panel"),
      "left",
      { foldAngle: 0, flip: true }
    );
  }

  for (let index = 1; index <= length; index += 1) {
    tube = joinByPorts(
      tube,
      `fuselage-bottom-${index}.bottom`,
      square(`fuselage-left-${index}`, "vertical", 2, "fuselage left vertical square tube side face"),
      "bottom",
      { foldAngle: -Math.PI / 2 }
    );
    tube = joinByPorts(
      tube,
      `fuselage-bottom-${index}.top`,
      square(`fuselage-right-${index}`, "vertical", 2, "fuselage right vertical square tube side face"),
      "bottom",
      { foldAngle: -Math.PI / 2, flip: true }
    );
    tube = joinByPorts(
      tube,
      `fuselage-left-${index}.top`,
      square(`fuselage-top-${index}`, "horizontal", 3, "fuselage top square tube crown panel"),
      "bottom",
      { foldAngle: Math.PI / 2 }
    );
  }

  return tube;
}

function addNose(build: TileMacro): TileMacro {
  return [
    ["fuselage-bottom-4.right", "nose-bottom", "horizontal", 0, true, "lower triangular nose point"],
    ["fuselage-left-4.right", "nose-left", "vertical", -Math.PI / 2, true, "left triangular nose side"],
    ["fuselage-right-4.right", "nose-right", "vertical", Math.PI / 2, true, "right triangular nose side"]
  ].reduce(
    (current, [parent, id, plane, foldAngle, flip, role]) =>
      joinByPorts(
        current,
        parent as string,
        triangle(id as string, "equilateral-triangle", plane as "horizontal" | "vertical", 4, role as string, "nose", COLORS.nose),
        "base",
        { foldAngle: foldAngle as number, flip: flip as boolean }
      ),
    build
  );
}

function addMirroredWings(build: TileMacro, rootCount: number): TileMacro {
  let current = build;

  for (let index = 1; index <= rootCount; index += 1) {
    current = joinByPorts(
      current,
      `fuselage-left-${index}.bottom`,
      triangle(`left-wing-root-${index}`, "right-triangle", "horizontal", 5, "left low swept right-triangle wing panel", "left-wing", COLORS.wing),
      "legA",
      { foldAngle: WING_FOLD }
    );
  }

  current = joinByPorts(
    current,
    "left-wing-root-2.hypotenuse",
    triangle("left-wing-tip", "right-triangle", "horizontal", 5, "left outboard right-triangle wing tip panel", "left-wing", COLORS.wing),
    "hypotenuse",
    { foldAngle: 0, flip: true }
  );

  current = joinByPorts(
    current,
    "left-wing-root-3.hypotenuse",
    triangle("left-wing-swept-trailing-tip", "right-triangle", "horizontal", 5, "left rear swept wing extension panel", "left-wing", COLORS.wing),
    "hypotenuse",
    { foldAngle: 0, flip: true }
  );

  const leftWing: TileMacro = {
    tiles: current.tiles.filter((tile) => tile.subassemblyId === "left-wing"),
    connections: current.connections.filter((connection) => connection.fromTileId.startsWith("left-wing") && connection.toTileId.startsWith("left-wing")),
    ports: Object.fromEntries(Object.entries(current.ports ?? {}).filter(([, port]) => port.tileId.startsWith("left-wing")))
  };
  const mirrored = mirrorMacro(leftWing, "z", 0);
  const mirroredTileIds = new Set(mirrored.tiles.map((tile) => tile.id));
  const mirroredRoots = mirrored.tiles.filter((tile) => /left-wing-root-\d+-mirror/.test(tile.id));
  let rightWing = mirrored;

  mirroredRoots.forEach((tile) => {
    const rootIndex = tile.id.match(/root-(\d+)/)?.[1];
    rightWing = {
      ...rightWing,
      tiles: rightWing.tiles.map((candidate) => ({
        ...candidate,
        parentTileId: candidate.id === tile.id ? `fuselage-right-${rootIndex}` : candidate.parentTileId,
        parentEdge: candidate.id === tile.id ? 0 : candidate.parentEdge,
        childEdge: candidate.id === tile.id ? 0 : candidate.childEdge,
        foldAngle: candidate.id === tile.id ? WING_FOLD : candidate.foldAngle,
        root: candidate.id === tile.id ? false : candidate.root,
        subassemblyId: candidate.subassemblyId === "left-wing" ? "right-wing" : candidate.subassemblyId,
        role: candidate.role.replace(/\bleft\b/i, "right")
      })),
      connections: [
        ...rightWing.connections,
        {
          fromTileId: `fuselage-right-${rootIndex}`,
          fromEdge: 0,
          toTileId: tile.id,
          toEdge: 0,
          kind: "edge" as const
        }
      ].filter((connection) => mirroredTileIds.has(connection.fromTileId) || connection.fromTileId.startsWith("fuselage-right-"))
    };
  });

  return composeMacros(current, rightWing);
}

function addTopFin(build: TileMacro): TileMacro {
  return joinByPorts(
    build,
    "fuselage-top-1.left",
    triangle("top-fin", "isosceles-triangle", "vertical", 9, "upright top-fin triangle on fuselage crown", "top-fin", COLORS.fin),
    "base",
    { foldAngle: Math.PI / 3 }
  );
}

function square(id: string, plane: "horizontal" | "vertical", step: number, role: string): TileMacro {
  return tilePrimitive({
    id,
    shape: "small-square",
    plane,
    color: COLORS.body,
    stepStart: step,
    role,
    subassemblyId: "body"
  });
}

function triangle(
  id: string,
  shape: Extract<TileShape, "equilateral-triangle" | "right-triangle" | "isosceles-triangle">,
  plane: "horizontal" | "vertical",
  step: number,
  role: string,
  subassemblyId: string,
  color: string
): TileMacro {
  return tilePrimitive({ id, shape, plane, color, stepStart: step, role, subassemblyId });
}

function macroToDraft(plan: PlannerPlan, macro: TileMacro): AuthoredBuildDraft {
  const now = new Date().toISOString();
  return {
    id: plan.id,
    title: plan.title,
    prompt: "Build a recognizable magnetic-tile jet aircraft",
    family: plan.family,
    inventoryPreset: "classic-100",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    expectedInventory: plan.expectedInventory,
    referenceFrameSrcs: ["/reference-frames/jet-aircraft/steps/11-final-front.jpg"],
    visualSignoff: false,
    tiles: macro.tiles.map((tile) => ({
      ...roundTile(tile),
      authoredMode: "edge-snap" as const,
      confirmed: true
    })),
    connections: macro.connections
  };
}

function roundTile(tile: TileInstance): TileInstance {
  return {
    ...tile,
    position: roundVec(tile.position),
    rotation: roundVec(tile.rotation),
    basis: tile.basis
      ? {
          xAxis: roundVec(tile.basis.xAxis),
          yAxis: roundVec(tile.basis.yAxis),
          zAxis: roundVec(tile.basis.zAxis)
        }
      : undefined,
    foldAngle: tile.foldAngle === undefined ? undefined : round(tile.foldAngle)
  };
}

function roundVec<T extends Vec3>(value: T): T {
  return { x: round(value.x), y: round(value.y), z: round(value.z) } as T;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
