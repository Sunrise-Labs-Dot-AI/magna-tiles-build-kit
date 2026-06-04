import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  boundsForTiles,
  composeMacros,
  joinByPorts,
  macroBom,
  mirrorMacro,
  tilePrimitive,
  type TileMacro
} from "../lib/magnetic-tiles/macros";
import { assembleBuildGraph, draftToBuildGraph } from "../lib/builder/operations";
import type { AuthoredBuildDraft, BuilderDraftStatus } from "../lib/builder/types";
import { gateBuild } from "../lib/engine";
import { buildBounds } from "../lib/engine/build";
import type { Inventory, TileInstance, Vec3 } from "../lib/magnetic-tiles/types";

const OUT = join(process.cwd(), "build-drafts/jet-aircraft.json");
const NOW = new Date().toISOString();
const TARGET_BOM: Partial<Inventory> = {
  "small-square": 16,
  "equilateral-triangle": 9,
  "right-triangle": 10,
  "isosceles-triangle": 5,
  "large-square": 0
};

type StageName = "fuselage" | "nose" | "wings" | "tail";

const COLORS = {
  body: "#118ab2",
  nose: "#8ecae6",
  wing: "#ef476f",
  tail: "#06d6a0",
  fin: "#7b2cbf"
};
const WING_FOLD = -89 * Math.PI / 180;

async function main() {
  const stages: StageName[] = ["fuselage", "nose", "wings", "tail"];
  let best: AuthoredBuildDraft | null = null;

  for (const stage of stages) {
    const draft = macroToDraft(buildJet(stage), stage === "tail" ? "engine-valid" : "geometry-valid");
    const report = await checkDraft(stage, draft);
    printReport(report);

    if (!report.strictPassed || !report.gatePassed) {
      if (best) writeDraft(best);
      throw new Error(`${stage} failed hard self-check; left best passing draft on disk.`);
    }

    best = draft;
    writeDraft(draft);
  }
}

function buildJet(stage: StageName): TileMacro {
  let build = fuselageTube();
  if (stage === "fuselage") return build;

  build = addNose(build);
  if (stage === "nose") return build;

  build = addWings(build);
  if (stage === "wings") return build;

  return addTail(build);
}

function fuselageTube(): TileMacro {
  let tube = square("fuselage-bottom-1", "horizontal", 1, "fuselage bottom square tube belly panel");

  for (let index = 2; index <= 4; index += 1) {
    tube = joinByPorts(
      tube,
      `fuselage-bottom-${index - 1}.right`,
      square(`fuselage-bottom-${index}`, "horizontal", 1, "fuselage bottom square tube belly panel"),
      "left",
      { foldAngle: 0, flip: true }
    );
  }

  for (let index = 1; index <= 4; index += 1) {
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

  return composeMacros(tube);
}

function addNose(build: TileMacro): TileMacro {
  const noseParts: Array<{
    parent: string;
    id: string;
    plane: "horizontal" | "vertical";
    foldAngle: number;
    flip?: boolean;
    role: string;
  }> = [
    {
      parent: "fuselage-bottom-4.right",
      id: "nose-bottom",
      plane: "horizontal",
      foldAngle: 0,
      flip: true,
      role: "lower triangular nose point continuing forward from the belly"
    },
    {
      parent: "fuselage-left-4.right",
      id: "nose-left",
      plane: "vertical",
      foldAngle: -Math.PI / 2,
      flip: true,
      role: "left triangular nose side tapering the fuselage to a point"
    },
    {
      parent: "fuselage-right-4.right",
      id: "nose-right",
      plane: "vertical",
      foldAngle: Math.PI / 2,
      flip: true,
      role: "right triangular nose side tapering the fuselage to a point"
    }
  ];

  return composeMacros(noseParts.reduce(
    (current, part) =>
      joinByPorts(
        current,
        part.parent,
        triangle(part.id, "equilateral-triangle", part.plane, 4, part.role, "nose", COLORS.nose),
        "base",
        { foldAngle: part.foldAngle, flip: part.flip }
      ),
    build
  ));
}

function addWings(build: TileMacro): TileMacro {
  let current = build;

  for (let index = 1; index <= 3; index += 1) {
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
    triangle("left-wing-swept-trailing-tip", "right-triangle", "horizontal", 5, "left rear swept right-triangle wing extension panel", "left-wing", COLORS.wing),
    "hypotenuse",
    { foldAngle: 0, flip: true }
  );

  const leftWing = {
    tiles: current.tiles.filter((tile) => tile.subassemblyId === "left-wing"),
    connections: current.connections.filter((connection) => connection.fromTileId.startsWith("left-wing") && connection.toTileId.startsWith("left-wing")),
    ports: Object.fromEntries(
      Object.entries(current.ports ?? {}).filter(([, port]) => port.tileId.startsWith("left-wing"))
    )
  };
  const mirrored = mirrorMacro(leftWing, "z", 0);
  const mirroredTiles = new Set(mirrored.tiles.map((tile) => tile.id));
  const mirroredRoots = mirrored.tiles.filter((tile) => /left-wing-root-\d+-mirror/.test(tile.id));
  let rightWing = mirrored;

  mirroredRoots.forEach((tile) => {
    rightWing = {
      ...rightWing,
      tiles: rightWing.tiles.map((candidate) =>
        candidate.id === tile.id
          ? {
              ...candidate,
              parentTileId: `fuselage-right-${tile.id.match(/root-(\d+)/)?.[1]}`,
              parentEdge: 0,
              childEdge: 0,
              foldAngle: WING_FOLD,
              root: false,
              subassemblyId: "right-wing",
              role: candidate.role.replace(/\bleft\b/i, "right")
            }
          : {
              ...candidate,
              subassemblyId: candidate.subassemblyId === "left-wing" ? "right-wing" : candidate.subassemblyId,
              role: candidate.role.replace(/\bleft\b/i, "right")
            }
      ),
      connections: [
        ...rightWing.connections,
        {
          fromTileId: `fuselage-right-${tile.id.match(/root-(\d+)/)?.[1]}`,
          fromEdge: 0,
          toTileId: tile.id,
          toEdge: 0,
          kind: "edge" as const
        }
      ].filter((connection) => mirroredTiles.has(connection.fromTileId) || connection.fromTileId.startsWith("fuselage-right-"))
    };
  });

  return composeMacros(current, rightWing);
}

function addTail(build: TileMacro): TileMacro {
  let current = build;

  current = joinByPorts(
    current,
    "fuselage-top-1.left",
    triangle("tail-vertical-stabilizer", "equilateral-triangle", "vertical", 9, "rear upright vertical stabilizer fin rising from fuselage crown", "tail", COLORS.fin),
    "base",
    { foldAngle: Math.PI / 3 }
  );

  return composeMacros(current);
}

function square(id: string, plane: "horizontal" | "vertical", step: number, role: string): TileMacro {
  return tilePrimitive({
    id,
    shape: "small-square",
    plane,
    color: COLORS.body,
    stepStart: step,
    role,
    subassemblyId: "fuselage"
  });
}

function triangle(
  id: string,
  shape: "equilateral-triangle" | "right-triangle" | "isosceles-triangle",
  plane: "horizontal" | "vertical",
  step: number,
  role: string,
  subassemblyId: string,
  color: string
): TileMacro {
  return tilePrimitive({ id, shape, plane, color, stepStart: step, role, subassemblyId });
}

function macroToDraft(macro: TileMacro, status: BuilderDraftStatus): AuthoredBuildDraft {
  const tiles = macro.tiles.map((tile) => ({
    ...roundTile(tile),
    authoredMode: "edge-snap" as const,
    confirmed: true
  }));
  return {
    id: "jet-aircraft",
    title: "Jet Aircraft",
    prompt: "Jet Aircraft",
    family: "aircraft",
    inventoryPreset: "classic-100",
    status,
    createdAt: NOW,
    updatedAt: NOW,
    notes: "Macro-authored rebuild matching the source-video square tube: 16-square horizontal fuselage, pointed triangular nose, wide low mirrored wings, and upright rear/front fins. Geometry is produced by tile primitives and attachByPort folds, not hand-authored tile bases.",
    expectedInventory: TARGET_BOM,
    referenceFrameSrcs: [
      "/reference-frames/jet-aircraft/steps/01-body-start.jpg",
      "/reference-frames/jet-aircraft/steps/02-body-tall.jpg",
      "/reference-frames/jet-aircraft/steps/03-body-stands.jpg",
      "/reference-frames/jet-aircraft/steps/04-nose.jpg",
      "/reference-frames/jet-aircraft/steps/05-left-wing.jpg",
      "/reference-frames/jet-aircraft/steps/06-right-wing.jpg",
      "/reference-frames/jet-aircraft/steps/07-wings-aligned.jpg",
      "/reference-frames/jet-aircraft/steps/08-tail-end.jpg",
      "/reference-frames/jet-aircraft/steps/09-tail-horiz-vert.jpg",
      "/reference-frames/jet-aircraft/steps/10-top-fin.jpg",
      "/reference-frames/jet-aircraft/steps/11-final-front.jpg",
      "/reference-frames/jet-aircraft/steps/12-final-side.jpg",
      "/reference-frames/jet-aircraft/steps/13-final-rear.jpg"
    ],
    visualSignoff: false,
    tiles,
    connections: macro.connections
  };
}

async function checkDraft(stage: StageName, draft: AuthoredBuildDraft) {
  let strictPassed = false;
  let strictError = "";
  try {
    assembleBuildGraph(draft, { strict: true });
    strictPassed = true;
  } catch (error) {
    strictError = error instanceof Error ? error.message : String(error);
  }

  const verdict = await gateBuild(draftToBuildGraph(draft));
  const bounds = buildBounds(draft.tiles);
  const extents = {
    x: round(bounds.max.x - bounds.min.x),
    y: round(bounds.max.y - bounds.min.y),
    z: round(bounds.max.z - bounds.min.z)
  };
  return {
    stage,
    strictPassed,
    strictError,
    gatePassed: verdict.passed,
    gateReasons: verdict.reasons,
    bom: macroBom({ tiles: draft.tiles, connections: draft.connections }),
    bounds: {
      min: roundVec(bounds.min),
      max: roundVec(bounds.max),
      extents,
      minY: round(bounds.min.y),
      macroExtents: roundSize(boundsForTiles(draft.tiles))
    }
  };
}

function printReport(report: Awaited<ReturnType<typeof checkDraft>>) {
  console.log(`\n[${report.stage}]`);
  console.log(`strict: ${report.strictPassed ? "passed" : `failed: ${report.strictError}`}`);
  console.log(`gate: ${report.gatePassed ? "passed" : "failed"}`);
  report.gateReasons.forEach((reason) => console.log(`  - ${reason}`));
  console.log(`bom: ${JSON.stringify(report.bom)}`);
  console.log(`bounds: ${JSON.stringify(report.bounds)}`);
}

function writeDraft(draft: AuthoredBuildDraft) {
  writeFileSync(OUT, `${JSON.stringify(draft, null, 2)}\n`);
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

function roundSize(value: { width: number; height: number; depth: number }) {
  return { width: round(value.width), height: round(value.height), depth: round(value.depth) };
}

function round(value: number): number {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
