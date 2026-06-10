import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  attachByPort,
  boundsForTiles,
  box,
  composeMacros,
  joinByPorts,
  macroBom,
  squarePyramid,
  tilePrimitive,
  type TileMacro
} from "../lib/magnetic-tiles/macros";
import { assembleBuildGraph } from "../lib/builder/operations";
import { gateBuild, type GateBuildResult } from "../lib/engine";
import { buildBounds } from "../lib/engine/build";
import { findMagneticEdgeMatch, tileWorldVertices } from "../lib/magnetic-tiles/magnet-geometry";
import { tileNormal, tilesIntersectAsPrisms } from "../lib/magnetic-tiles/prism-geometry";
import { scoreRecognition, combinedScore, type RecognitionBreakdown } from "../lib/recognition/score";
import { jetSilhouetteMatch, type SilhouetteScore } from "../lib/recognition/silhouette";
import { JET_RECOGNITION_TARGET } from "../lib/recognition/targets";
import type { AuthoredBuildDraft, BuilderTile } from "../lib/builder/types";
import type { BuildBounds, BuildGraph, Inventory, MagneticConnection, TileInstance, TileShape, Vec3 } from "../lib/magnetic-tiles/types";

export interface JetParams {
  /** 0 = square-tube box fuselage (legacy template), 1 = keeled triangular-prism fuselage. */
  bodyStyle: number;
  fuselageLength: number;
  noseFold: number;
  nosePortIndex: number;
  noseFlip: number;
  /**
   * Box style: 0 = square pyramid only, 1 = pyramid + flat forward dart, 2 = flat forward dart only.
   * Keel style: 2 = nose top wedge only, otherwise nose top wedge + angled side wedges.
   */
  noseStyle: number;
  /** Fold of the flat isosceles nose dart off the fuselage top face (0 = coplanar forward). */
  noseDartFold: number;
  wingSpan: number;
  wingSweep: number;
  wingDihedral: number;
  wingAttachSegment: number;
  wingFlip: number;
  /**
   * Coplanar lateral extension depth (v1 research finding): number of small squares inserted
   * between the wing root and the triangle tip, all joined coplanar (foldAngle 0), widening
   * the flat wing without tilting it.
   */
  wingExtension: number;
  /** 0 = uniform strips, 1 = taper toward the rear, 2 = taper toward the front (stepped delta). */
  wingTaper: number;
  /** Wing tip triangle: 0 = right triangle, 1 = isosceles (long dart), 2 = equilateral. */
  wingTipShape: number;
  /** Keel style only: 0 = wings off the flat top spine edges, 1 = wings off the low keel side edges. */
  wingMount: number;
  tailFinHeight: number;
  tailFold: number;
  tailFlip: number;
  /** 0 = equilateral tail fins, 1 = taller isosceles tail fins. */
  tailShape: number;
  topFinFold: number;
  topFinFlip: number;
}

interface Candidate {
  params: JetParams;
  draft: AuthoredBuildDraft;
  graph: BuildGraph;
  recognition: RecognitionBreakdown;
  silhouette: SilhouetteScore;
  /** Combined objective: structural recognizability + geometric silhouette match (un-gameable). */
  score: number;
}

interface GateCandidate extends Candidate {
  gate: GateBuildResult;
}

const OUT = "build-drafts/jet-aircraft.json";
const NOW = "2026-06-03T00:00:00.000Z";
const EVALUATIONS = 240;
const GATE_CANDIDATES = 80;
const NOSE_PORTS = ["frontBase", "rightBase", "backBase", "leftBase"] as const;
/** Fold of the keeled fuselage side panels off the flat top spine (matches the reconstruction). */
const KEEL_SIDE_FOLD = Math.PI / 3;
const COLORS = {
  body: "#118ab2",
  nose: "#8ecae6",
  wing: "#ef476f",
  tail: "#06d6a0",
  topFin: "#7b2cbf"
};
const EXPECTED_INVENTORY: Partial<Inventory> = {
  "small-square": 0,
  "equilateral-triangle": 0,
  "right-triangle": 0,
  "isosceles-triangle": 0,
  "large-square": 0
};

export const SEED: JetParams = {
  bodyStyle: 0,
  fuselageLength: 4,
  noseFold: 0,
  nosePortIndex: 0,
  noseFlip: 0,
  noseStyle: 0,
  noseDartFold: 0,
  wingSpan: 3,
  wingSweep: 0,
  wingDihedral: (5 * Math.PI) / 12,
  wingAttachSegment: 2,
  wingFlip: 0,
  wingExtension: 0,
  wingTaper: 0,
  wingTipShape: 0,
  wingMount: 0,
  tailFinHeight: 1,
  tailFold: 0,
  tailFlip: 1,
  tailShape: 0,
  topFinFold: 0,
  topFinFlip: 1
};

/** The keeled-prism neighborhood seed: the proven reconstruction topology, now searchable. */
export const KEEL_SEED: JetParams = {
  ...SEED,
  bodyStyle: 1,
  noseStyle: 0,
  wingSpan: 3,
  wingAttachSegment: 2,
  wingDihedral: 0,
  wingFlip: 0,
  wingExtension: 0,
  wingTipShape: 1,
  tailShape: 1,
  tailFold: -Math.PI / 2,
  tailFlip: 0,
  topFinFold: -Math.PI / 2,
  topFinFlip: 0
};

export function buildJetDraft(params: Partial<JetParams> = SEED): AuthoredBuildDraft {
  const normalized = normalizeParams({ ...SEED, ...params });
  const macro = normalized.bodyStyle === 1 ? buildKeelJetMacro(normalized) : buildBoxJetMacro(normalized);
  return macroToDraft(composeMacros(macro));
}

function buildBoxJetMacro(normalized: JetParams): TileMacro {
  let build = labelMacro(
    box({
      id: "fuselage",
      width: normalized.fuselageLength,
      height: 1,
      depth: 1,
      openFaces: [],
      subassemblyId: "body",
      color: COLORS.body
    }),
    "body",
    "fuselage body square tube panel"
  );
  build = withPortAlias(build, "noseMount", "fuselage-right-1-1", 2);

  if (normalized.noseStyle !== 2) {
    build = attachConnectedByPort(
      build,
      "fuselage.noseMount",
      labelMacro(squarePyramid({ id: "nose", subassemblyId: "nose", color: COLORS.nose, stepStart: 4 }), "nose", "pointed nose cone face"),
      NOSE_PORTS[normalized.nosePortIndex],
      { foldAngle: normalized.noseFold, flip: Boolean(normalized.noseFlip) }
    );
  }

  if (normalized.noseStyle !== 0) {
    build = withPortAlias(build, "noseDartMount", `fuselage-top-${normalized.fuselageLength}-1`, 1);
    build = attachConnectedByPort(
      build,
      "fuselage.noseDartMount",
      tilePrimitive({
        id: "nose-dart",
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.nose,
        stepStart: 4,
        role: "long pointed nose dart panel",
        subassemblyId: "nose"
      }),
      "base",
      { foldAngle: normalized.noseDartFold, flip: Boolean(normalized.noseFlip) }
    );
  }

  const firstWingSegment = Math.min(
    normalized.wingAttachSegment,
    Math.max(1, normalized.fuselageLength - normalized.wingSpan + 1)
  );
  for (let offset = 0; offset < normalized.wingSpan; offset += 1) {
    const segment = firstWingSegment + offset;
    const extension = stripExtension(normalized, offset);
    build = withPortAlias(build, `leftWingMount${segment}`, `fuselage-front-${segment}-1`, 0);
    build = attachConnectedByPort(
      build,
      `fuselage.leftWingMount${segment}`,
      buildWingMacro("left", segment, normalized.wingSweep, extension, normalized.wingTipShape),
      "root",
      { foldAngle: normalized.wingDihedral, flip: Boolean(normalized.wingFlip) }
    );

    build = withPortAlias(build, `rightWingMount${segment}`, `fuselage-back-${segment}-1`, 0);
    build = attachConnectedByPort(
      build,
      `fuselage.rightWingMount${segment}`,
      buildWingMacro("right", segment, normalized.wingSweep, extension, normalized.wingTipShape),
      "root",
      { foldAngle: Math.PI - normalized.wingDihedral, flip: Boolean(normalized.wingFlip) }
    );
  }

  const tailFinShape = normalized.tailShape === 1 ? "isosceles-triangle" : "equilateral-triangle";
  const tailStackPorts =
    normalized.tailShape === 1
      ? { parent: "leftLong", child: "rightLong" }
      : { parent: "left", child: "right" };
  let tail = tilePrimitive({
    id: "tail-fin-1",
    shape: tailFinShape,
    plane: "vertical",
    color: COLORS.tail,
    stepStart: 8,
    role: "rear upright tail-fin vertical stabilizer",
    subassemblyId: "tail"
  });
  for (let index = 2; index <= normalized.tailFinHeight; index += 1) {
    tail = attachConnectedByPort(
      tail,
      `tail-fin-${index - 1}.${tailStackPorts.parent}`,
      tilePrimitive({
        id: `tail-fin-${index}`,
        shape: tailFinShape,
        plane: "vertical",
        color: COLORS.tail,
        stepStart: 8 + index,
        role: "stacked rear upright tail-fin vertical stabilizer",
        subassemblyId: "tail"
      }),
      tailStackPorts.child,
      { foldAngle: 0, flip: true }
    );
  }
  build = attachConnectedByPort(
    build,
    "fuselage.topLeftEdge",
    tail,
    "base",
    { foldAngle: normalized.tailFold, flip: Boolean(normalized.tailFlip) }
  );

  build = attachConnectedByPort(
    build,
    "fuselage.topBackEdge",
    tilePrimitive({
      id: "top-fin",
      shape: "isosceles-triangle",
      plane: "vertical",
      color: COLORS.topFin,
      stepStart: 10,
      role: "forward upright top-fin tail accent",
      subassemblyId: "top-fin"
    }),
    "base",
    { foldAngle: normalized.topFinFold, flip: Boolean(normalized.topFinFlip) }
  );

  return build;
}

/**
 * Keeled triangular-prism jet (the topology measured closest to the reconstruction target):
 * a flat top spine of squares with two angled side panels folded down into a keel, triangular
 * end caps, a long isosceles nose wedge (optionally with angled side wedges), flat coplanar
 * delta wings spread from the top spine edges (with optional coplanar lateral extensions), an
 * upright tail-fin pair at the rear, and a rear top fin.
 */
function buildKeelJetMacro(normalized: JetParams): TileMacro {
  const length = normalized.fuselageLength;
  let build = tilePrimitive({
    id: "body-top-1",
    shape: "small-square",
    plane: "horizontal",
    color: COLORS.body,
    subassemblyId: "body",
    role: "fuselage flat top square panel segment 1",
    stepStart: 1
  });
  for (let segment = 2; segment <= length; segment += 1) {
    build = joinByPorts(
      build,
      `body-top-${segment - 1}.right`,
      tilePrimitive({
        id: `body-top-${segment}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.body,
        subassemblyId: "body",
        role: `fuselage flat top square panel segment ${segment}`,
        stepStart: 1
      }),
      `body-top-${segment}.left`,
      { foldAngle: 0, flip: true }
    );
  }

  for (let segment = 1; segment <= length; segment += 1) {
    build = joinByPorts(
      build,
      `body-top-${segment}.bottom`,
      tilePrimitive({
        id: `body-left-${segment}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.body,
        subassemblyId: "body",
        role: `fuselage left angled square side panel segment ${segment}`,
        stepStart: 2
      }),
      `body-left-${segment}.top`,
      { foldAngle: KEEL_SIDE_FOLD }
    );
    build = joinByPorts(
      build,
      `body-top-${segment}.top`,
      tilePrimitive({
        id: `body-right-${segment}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.body,
        subassemblyId: "body",
        role: `fuselage right angled square side panel segment ${segment}`,
        stepStart: 2
      }),
      `body-right-${segment}.top`,
      { foldAngle: KEEL_SIDE_FOLD }
    );
  }

  build = joinByPorts(
    build,
    "body-top-1.left",
    tilePrimitive({
      id: "body-rear-cap",
      shape: "equilateral-triangle",
      plane: "horizontal",
      color: COLORS.body,
      subassemblyId: "body",
      role: "fuselage rear triangular end cap",
      stepStart: 3
    }),
    "body-rear-cap.base",
    { foldAngle: Math.PI / 2 }
  );
  build = joinByPorts(
    build,
    `body-top-${length}.right`,
    tilePrimitive({
      id: "body-front-cap",
      shape: "equilateral-triangle",
      plane: "horizontal",
      color: COLORS.body,
      subassemblyId: "body",
      role: "fuselage front triangular end cap",
      stepStart: 3
    }),
    "body-front-cap.base",
    { foldAngle: Math.PI / 2 }
  );

  build = joinByPorts(
    build,
    `body-top-${length}.right`,
    tilePrimitive({
      id: "nose-top",
      shape: "isosceles-triangle",
      plane: "horizontal",
      color: COLORS.nose,
      subassemblyId: "nose",
      role: "long pointed nose top isosceles wedge panel",
      stepStart: 4
    }),
    "nose-top.base",
    { foldAngle: normalized.noseDartFold, flip: true }
  );
  if (normalized.noseStyle !== 2) {
    build = joinByPorts(
      build,
      `body-left-${length}.edge3`,
      tilePrimitive({
        id: "nose-left",
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.nose,
        subassemblyId: "nose",
        role: "long pointed nose left angled side wedge panel",
        stepStart: 4
      }),
      "nose-left.base",
      { foldAngle: 0, flip: true }
    );
    build = joinByPorts(
      build,
      `body-right-${length}.edge1`,
      tilePrimitive({
        id: "nose-right",
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.nose,
        subassemblyId: "nose",
        role: "long pointed nose right angled side wedge panel",
        stepStart: 4
      }),
      "nose-right.base",
      { foldAngle: 0, flip: true }
    );
  }

  const firstWingSegment = Math.min(
    normalized.wingAttachSegment,
    Math.max(1, length - normalized.wingSpan + 1)
  );
  for (let offset = 0; offset < normalized.wingSpan; offset += 1) {
    const segment = Math.min(length, firstWingSegment + offset);
    const extension = stripExtension(normalized, offset);
    const leftMount = normalized.wingMount === 1 ? `body-left-${segment}.bottom` : `body-top-${segment}.bottom`;
    const rightMount = normalized.wingMount === 1 ? `body-right-${segment}.bottom` : `body-top-${segment}.top`;
    build = attachConnectedByPort(
      build,
      leftMount,
      buildWingMacro("left", segment, normalized.wingSweep, extension, normalized.wingTipShape),
      "root",
      { foldAngle: normalized.wingDihedral, flip: !normalized.wingFlip }
    );
    build = attachConnectedByPort(
      build,
      rightMount,
      buildWingMacro("right", segment, normalized.wingSweep, extension, normalized.wingTipShape),
      "root",
      { foldAngle: normalized.wingDihedral, flip: !normalized.wingFlip }
    );
  }

  const tailFinShape = normalized.tailShape === 1 ? "isosceles-triangle" : "equilateral-triangle";
  build = attachConnectedByPort(
    build,
    "body-top-1.bottom",
    buildTailFinStack("tail-left-fin", tailFinShape, normalized.tailFinHeight, normalized.tailShape),
    "root",
    { foldAngle: normalized.tailFold, flip: Boolean(normalized.tailFlip) }
  );
  build = attachConnectedByPort(
    build,
    "body-top-1.top",
    buildTailFinStack("tail-right-fin", tailFinShape, normalized.tailFinHeight, normalized.tailShape),
    "root",
    { foldAngle: normalized.tailFold, flip: Boolean(normalized.tailFlip) }
  );

  build = attachConnectedByPort(
    build,
    "body-top-1.left",
    tilePrimitive({
      id: "top-fin",
      shape: "isosceles-triangle",
      plane: "horizontal",
      color: COLORS.topFin,
      subassemblyId: "top-fin",
      role: "center tall upright top-fin tail accent vertical stabilizer",
      stepStart: 10
    }),
    "base",
    { foldAngle: normalized.topFinFold, flip: Boolean(normalized.topFinFlip) }
  );

  return build;
}

function buildTailFinStack(id: string, shape: TileShape, height: number, tailShape: number): TileMacro {
  const stackPorts = tailShape === 1 ? { parent: "leftLong", child: "rightLong" } : { parent: "left", child: "right" };
  let stack = tilePrimitive({
    id: `${id}-1`,
    shape,
    plane: "horizontal",
    color: COLORS.tail,
    stepStart: 8,
    role: "tall upright tail-fin vertical stabilizer",
    subassemblyId: "tail"
  });
  for (let index = 2; index <= height; index += 1) {
    stack = attachConnectedByPort(
      stack,
      `${id}-${index - 1}.${stackPorts.parent}`,
      tilePrimitive({
        id: `${id}-${index}`,
        shape,
        plane: "horizontal",
        color: COLORS.tail,
        stepStart: 8 + index,
        role: "stacked tall upright tail-fin vertical stabilizer",
        subassemblyId: "tail"
      }),
      stackPorts.child,
      { foldAngle: 0, flip: true }
    );
  }
  const rootPort = stack.ports?.[`${id}-1.base`] ?? stack.ports?.base;
  if (!rootPort) throw new Error(`tail fin stack ${id} is missing its base port`);
  return { ...stack, ports: { ...(stack.ports ?? {}), root: rootPort } };
}

export async function optimizeJet(evaluations = EVALUATIONS): Promise<GateCandidate> {
  const structurallyValid: Candidate[] = [];
  const seeds = seedNeighborhood();

  for (const params of seeds) {
    const candidate = evaluate(params);
    if (candidate) structurallyValid.push(candidate);
  }

  const bestSeed = structurallyValid.reduce<Candidate | null>(
    (best, candidate) => (best === null || candidate.score > best.score ? candidate : best),
    null
  );
  let current = bestSeed?.params ?? SEED;
  for (let index = 0; index < evaluations; index += 1) {
    const params = index === 0 ? SEED : mutate(current, index);
    const candidate = evaluate(params);
    if (!candidate) continue;
    structurallyValid.push(candidate);
    const currentScore = evaluate(current)?.score ?? 0;
    if (candidate.score >= currentScore || index % 17 === 0) {
      current = candidate.params;
    }
  }

  structurallyValid.sort((first, second) => second.score - first.score);

  const gatePassed: GateCandidate[] = [];
  for (const candidate of structurallyValid.slice(0, GATE_CANDIDATES)) {
    const gate = await gateBuild(candidate.graph);
    if (gate.passed) gatePassed.push({ ...candidate, gate });
  }

  if (gatePassed.length === 0) {
    throw new Error(
      `No gate-passing jet found among ${structurallyValid.length} strict candidates. Best combined score: ${
        structurallyValid[0]?.score.toFixed(3) ?? "none"
      }`
    );
  }

  gatePassed.sort((first, second) => second.score - first.score);
  return gatePassed[0];
}

/** Extension depth for the wing strip at offset `offset` within the span (stepped-delta taper). */
function stripExtension(params: JetParams, offset: number): number {
  if (params.wingExtension <= 0) return 0;
  if (params.wingTaper === 1) return Math.max(0, params.wingExtension - (params.wingSpan - 1 - offset));
  if (params.wingTaper === 2) return Math.max(0, params.wingExtension - offset);
  return params.wingExtension;
}

/**
 * One wing strip: optional coplanar lateral extension squares (the v1 "coplanar lateral extension"
 * fold — widen the flat wing by chaining coplanar tiles outward, never by tilting), capped by a
 * right-triangle tip. With extension 0 this is exactly the original single-triangle wing.
 */
function buildWingMacro(
  side: "left" | "right",
  segment: number,
  sweep: number,
  extension: number,
  tipShape: number
): TileMacro {
  const shape: TileShape =
    tipShape === 1 ? "isosceles-triangle" : tipShape === 2 ? "equilateral-triangle" : "right-triangle";
  const tipPortName = shape === "right-triangle" ? (Math.abs(sweep) > 0.001 ? "hypotenuse" : "legA") : "base";
  const tipId = extension > 0 ? `${side}-wing-${segment}-tip` : `${side}-wing-${segment}`;
  const tip = tilePrimitive({
    id: tipId,
    shape,
    plane: "horizontal",
    color: COLORS.wing,
    stepStart: 5 + extension,
    role: `${side} broad low delta wing triangle panel`,
    subassemblyId: "wings"
  });

  if (extension <= 0) {
    return withRootPort(tip, `${tipId}.${tipPortName}`, tipPortName);
  }

  let strip = tilePrimitive({
    id: `${side}-wing-${segment}-1`,
    shape: "small-square",
    plane: "horizontal",
    color: COLORS.wing,
    stepStart: 5,
    role: `${side} broad low delta wing coplanar extension panel`,
    subassemblyId: "wings"
  });
  for (let index = 2; index <= extension; index += 1) {
    strip = attachConnectedByPort(
      strip,
      `${side}-wing-${segment}-${index - 1}.top`,
      tilePrimitive({
        id: `${side}-wing-${segment}-${index}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.wing,
        stepStart: 4 + index,
        role: `${side} broad low delta wing coplanar extension panel`,
        subassemblyId: "wings"
      }),
      "bottom",
      { foldAngle: 0, flip: true }
    );
  }
  strip = attachConnectedByPort(strip, `${side}-wing-${segment}-${extension}.top`, tip, tipPortName, {
    foldAngle: 0,
    flip: true
  });

  return withRootPort(strip, `${side}-wing-${segment}-1.bottom`, "bottom");
}

function withRootPort(macro: TileMacro, preferredPortName: string, fallbackPortName: string): TileMacro {
  const rootPort = macro.ports?.[preferredPortName] ?? macro.ports?.[fallbackPortName];
  if (!rootPort) throw new Error(`wing strip is missing root port ${preferredPortName}`);
  return {
    ...macro,
    ports: {
      ...(macro.ports ?? {}),
      root: rootPort
    }
  };
}

function evaluate(params: JetParams): Candidate | null {
  try {
    const draft = buildJetDraft(params);
    const graph = assembleBuildGraph(draft, { strict: true });
    const recognition = scoreRecognition(graph, JET_RECOGNITION_TARGET);
    if (!recognition.overlapFree || recognition.connectivity < 1) return null;
    const silhouette = jetSilhouetteMatch(graph);
    const score = combinedScore(recognition.total, silhouette.total);
    return { params: normalizeParams(params), draft, graph, recognition, silhouette, score };
  } catch {
    return null;
  }
}

function seedNeighborhood(): JetParams[] {
  const candidates: JetParams[] = [];
  for (const noseFold of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    for (let nosePortIndex = 0; nosePortIndex < NOSE_PORTS.length; nosePortIndex += 1) {
      for (const noseFlip of [0, 1]) {
        for (const wingDihedral of [Math.PI / 2, (5 * Math.PI) / 12, (7 * Math.PI) / 12, Math.PI / 3, (2 * Math.PI) / 3]) {
          for (const wingSpan of [2, 3, 4]) {
            for (const wingAttachSegment of [1, 2, 3]) {
              candidates.push(
                normalizeParams({ ...SEED, noseFold, nosePortIndex, noseFlip, wingDihedral, wingSpan, wingAttachSegment })
              );
            }
          }
        }
      }
    }
  }

  // Reference-shaped seeds for the extended dimensions: wide flat coplanar-extended wings, a long
  // flat nose dart, and taller tail fin stacks (the proportions the reconstruction target shows).
  for (const wingDihedral of [Math.PI / 2, (5 * Math.PI) / 12, (7 * Math.PI) / 12]) {
    for (const wingSpan of [3, 4]) {
      for (const wingExtension of [1, 2]) {
        for (const wingTaper of [0, 1, 2]) {
          for (const noseStyle of [0, 1, 2]) {
            for (const tailShape of [0, 1]) {
              for (const tailFinHeight of [1, 2]) {
                candidates.push(
                  normalizeParams({
                    ...SEED,
                    wingAttachSegment: 1,
                    noseFlip: noseStyle === 0 ? 0 : 1,
                    wingDihedral,
                    wingSpan,
                    wingExtension,
                    wingTaper,
                    noseStyle,
                    tailShape,
                    tailFinHeight
                  })
                );
              }
            }
          }
        }
      }
    }
  }

  // Keeled-prism seeds around the proven reconstruction topology, exploring the new wing
  // mount/extension/taper/tip and tail dimensions.
  for (const wingMount of [0, 1]) {
    for (const wingDihedral of wingMount === 1 ? [Math.PI / 3, (2 * Math.PI) / 3, Math.PI / 2] : [0, Math.PI / 3, -Math.PI / 3]) {
      for (const wingSpan of [2, 3, 4]) {
        for (const wingAttachSegment of [1, 2]) {
          for (const wingExtension of [0, 1, 2]) {
            for (const wingTaper of [0, 1, 2]) {
              for (const wingTipShape of [0, 1]) {
                for (const noseStyle of [0, 2]) {
                  for (const tailFinHeight of [1, 2]) {
                    candidates.push(
                      normalizeParams({
                        ...KEEL_SEED,
                        wingMount,
                        wingDihedral,
                        wingSpan,
                        wingAttachSegment,
                        wingExtension,
                        wingTaper,
                        wingTipShape,
                        noseStyle,
                        tailFinHeight
                      })
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return candidates;
}

function mutate(base: JetParams, index: number): JetParams {
  const random = mulberry32(0x51f15e + index * 7919);
  const next = { ...base };
  next.bodyStyle = random() < 0.8 ? base.bodyStyle : 1 - clampInt(base.bodyStyle, 0, 1);
  next.fuselageLength += randomStep(random, 1.1);
  next.noseFold += randomStep(random, Math.PI / 2);
  next.nosePortIndex += randomStep(random, 1.4);
  next.noseFlip = random() < 0.5 ? 0 : 1;
  next.noseStyle += randomStep(random, 1.4);
  next.noseDartFold += randomStep(random, Math.PI / 6);
  next.wingSpan += randomStep(random, 1.1);
  next.wingSweep += randomStep(random, Math.PI / 8);
  next.wingDihedral += randomStep(random, Math.PI / 4);
  next.wingAttachSegment += randomStep(random, 1);
  next.wingFlip = random() < 0.5 ? 0 : 1;
  next.wingExtension += randomStep(random, 1.2);
  next.wingTaper += randomStep(random, 1.2);
  next.wingTipShape += randomStep(random, 1.2);
  next.wingMount = random() < 0.7 ? base.wingMount : 1 - clampInt(base.wingMount, 0, 1);
  next.tailFinHeight += randomStep(random, 0.9);
  next.tailFold += randomStep(random, Math.PI / 3);
  next.tailFlip = random() < 0.5 ? 0 : 1;
  next.tailShape = random() < 0.5 ? 0 : 1;
  next.topFinFold += randomStep(random, Math.PI / 3);
  next.topFinFlip = random() < 0.5 ? 0 : 1;
  return normalizeParams(next);
}

function normalizeParams(params: JetParams): JetParams {
  return {
    bodyStyle: clampInt(params.bodyStyle, 0, 1),
    fuselageLength: clampInt(params.fuselageLength, 3, 5),
    noseFold: snapFold(params.noseFold),
    nosePortIndex: clampInt(params.nosePortIndex, 0, NOSE_PORTS.length - 1),
    noseFlip: params.noseFlip >= 0.5 ? 1 : 0,
    noseStyle: clampInt(params.noseStyle, 0, 2),
    noseDartFold: snapFold(params.noseDartFold, [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3]),
    wingSpan: clampInt(params.wingSpan, 2, 4),
    wingSweep: snapFold(params.wingSweep, [0, Math.PI / 6, -Math.PI / 6]),
    wingDihedral: snapFold(params.wingDihedral, [
      0,
      Math.PI / 3,
      -Math.PI / 3,
      Math.PI / 2,
      (5 * Math.PI) / 12,
      (7 * Math.PI) / 12,
      (2 * Math.PI) / 3
    ]),
    wingAttachSegment: clampInt(params.wingAttachSegment, 1, 4),
    wingFlip: params.wingFlip >= 0.5 ? 1 : 0,
    wingExtension: clampInt(params.wingExtension, 0, 2),
    wingTaper: clampInt(params.wingTaper, 0, 2),
    wingTipShape: clampInt(params.wingTipShape, 0, 2),
    wingMount: clampInt(params.wingMount, 0, 1),
    tailFinHeight: clampInt(params.tailFinHeight, 1, 3),
    tailFold: snapFold(params.tailFold),
    tailFlip: params.tailFlip >= 0.5 ? 1 : 0,
    tailShape: clampInt(params.tailShape, 0, 1),
    topFinFold: snapFold(params.topFinFold),
    topFinFlip: params.topFinFlip >= 0.5 ? 1 : 0
  };
}

function macroToDraft(macro: TileMacro): AuthoredBuildDraft {
  const bom = macroBom(macro);
  const stepValues = Array.from(new Set(macro.tiles.map((tile) => tile.step))).sort((a, b) => a - b);
  const stepMap = new Map(stepValues.map((value, index) => [value, index + 1]));
  return {
    id: "jet-aircraft",
    title: "Jet Aircraft",
    prompt: "Jet Aircraft",
    family: "aircraft",
    inventoryPreset: "classic-100",
    status: "engine-valid",
    createdAt: NOW,
    updatedAt: NOW,
    notes:
      "Generated by scripts/generate-jet.ts: connected parametric attachByPort jet template (coplanar lateral wing extensions, nose dart/pyramid, stacked tail fins) hill-climbed against JET_RECOGNITION_TARGET + reconstruction silhouette IoU.",
    expectedInventory: { ...EXPECTED_INVENTORY, ...bom },
    referenceFrameSrcs: [
      "/reference-frames/jet-aircraft/steps/01-body-start.jpg",
      "/reference-frames/jet-aircraft/steps/04-nose.jpg",
      "/reference-frames/jet-aircraft/steps/07-wings-aligned.jpg",
      "/reference-frames/jet-aircraft/steps/10-top-fin.jpg",
      "/reference-frames/jet-aircraft/steps/12-final-side.jpg"
    ],
    visualSignoff: false,
    tiles: macro.tiles.map((tile): BuilderTile => ({
      ...roundTile(tile),
      step: stepMap.get(tile.step) ?? tile.step,
      authoredMode: "edge-snap",
      confirmed: true
    })),
    connections: macro.connections as MagneticConnection[]
  };
}

function labelMacro(macro: TileMacro, subassemblyId: string, role: string): TileMacro {
  return {
    ...macro,
    tiles: macro.tiles.map((tile) => ({ ...tile, subassemblyId, role: `${role} ${tile.id}` }))
  };
}

function withPortAlias(macro: TileMacro, name: string, tileId: string, edge: number): TileMacro {
  const tile = tileById(macro, tileId);
  const vertices = tileWorldVertices(tile);
  const start = vertices[edge];
  const end = vertices[(edge + 1) % vertices.length];
  const direction = normalize(subtract(end, start));
  const normal = tileNormal(tile);
  const port = {
    name,
    tileId,
    edge,
    frame: {
      anchor: start,
      start,
      end,
      direction,
      normal
    }
  };
  return {
    ...macro,
    ports: {
      ...(macro.ports ?? {}),
      [name]: port,
      [`fuselage.${name}`]: { ...port, name: `fuselage.${name}` }
    }
  };
}

function attachConnectedByPort(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  options: { foldAngle?: number; flip?: boolean } = {}
): TileMacro {
  const joined = attachByPort(parent, parentPortName, child, childPortName, options);
  if (Math.abs(options.foldAngle ?? 0) <= 0.0001) return joined;

  const parentPort = parent.ports?.[parentPortName];
  const childPort = child.ports?.[childPortName];
  if (!parentPort || !childPort) return joined;

  const parentTile = tileById(joined, parentPort.tileId);
  const childTile = tileById(joined, childPort.tileId);
  const initial = tilesIntersectAsPrisms(parentTile, childTile);
  if (!initial.overlaps || initial.penetration <= 0.03) return joined;

  const childIds = new Set(child.tiles.map((tile) => tile.id));
  const parentIds = new Set(parent.tiles.map((tile) => tile.id));
  const parentNormal = tileNormal(parentTile);
  const childNormal = tileNormal(childTile);
  const candidates = [-1, 1].flatMap((parentSign) =>
    [-1, 1].map((childSign) =>
      add(
        scale(parentNormal, (parentSign * 0.18) / 2),
        scale(childNormal, (childSign * 0.18) / 2)
      )
    )
  );

  const scored = candidates.map((offset) => {
    const shifted = shiftChildTiles(joined, childIds, offset);
    const maxPenetration = maxParentChildPenetration(shifted, parentIds, childIds);
    const shiftedChild = tileById(shifted, childPort.tileId);
    const match = findMagneticEdgeMatch(parentTile, shiftedChild);
    return {
      offset,
      maxPenetration,
      edgeDistance: match?.fromEdge === parentPort.edge && match.toEdge === childPort.edge
        ? match.midpointDistance
        : Number.POSITIVE_INFINITY
    };
  });

  scored.sort((first, second) =>
    first.maxPenetration - second.maxPenetration ||
    first.edgeDistance - second.edgeDistance ||
    first.offset.x - second.offset.x ||
    first.offset.y - second.offset.y ||
    first.offset.z - second.offset.z
  );

  return shiftChildTiles(joined, childIds, scored[0]?.offset ?? { x: 0, y: 0, z: 0 });
}

function shiftChildTiles(macro: TileMacro, childIds: Set<string>, offset: Vec3): TileMacro {
  return {
    ...macro,
    tiles: macro.tiles.map((tile) =>
      childIds.has(tile.id) ? { ...tile, position: add(tile.position, offset) } : tile
    )
  };
}

function maxParentChildPenetration(macro: TileMacro, parentIds: Set<string>, childIds: Set<string>): number {
  let maxPenetration = 0;
  const parents = macro.tiles.filter((tile) => parentIds.has(tile.id));
  const children = macro.tiles.filter((tile) => childIds.has(tile.id));
  parents.forEach((parent) => {
    children.forEach((child) => {
      const intersection = tilesIntersectAsPrisms(parent, child);
      if (intersection.overlaps) maxPenetration = Math.max(maxPenetration, intersection.penetration);
    });
  });
  return maxPenetration;
}

function tileById(macro: TileMacro, tileId: string): TileInstance {
  const tile = macro.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) throw new Error(`Missing tile ${tileId}`);
  return tile;
}

function add(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scale(point: Vec3, amount: number): Vec3 {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function normalize(point: Vec3): Vec3 {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return scale(point, 1 / length);
}

function formatSummary(candidate: GateCandidate): string {
  const bounds = buildBounds(candidate.graph.tiles);
  const extents = extentsFor(bounds);
  const bomBySubassembly = candidate.graph.tiles.reduce<Record<string, Record<string, number>>>((counts, tile) => {
    const subassembly = tile.subassemblyId ?? "unknown";
    counts[subassembly] ??= {};
    counts[subassembly][tile.shape] = (counts[subassembly][tile.shape] ?? 0) + 1;
    return counts;
  }, {});
  return [
    `best combined score: ${candidate.score.toFixed(3)} (structural ${candidate.recognition.total.toFixed(
      3
    )}, silhouette ${candidate.silhouette.total.toFixed(3)})`,
    `silhouette perView: ${JSON.stringify({
      top: round(candidate.silhouette.perView.top),
      side: round(candidate.silhouette.perView.side),
      front: round(candidate.silhouette.perView.front)
    })}`,
    `breakdown: ${JSON.stringify({
      subassemblyCoverage: round(candidate.recognition.subassemblyCoverage),
      roleCoverage: round(candidate.recognition.roleCoverage),
      foldCoverage: round(candidate.recognition.foldCoverage),
      silhouetteRules: round(candidate.recognition.silhouette),
      connectivity: round(candidate.recognition.connectivity),
      overlapFree: candidate.recognition.overlapFree,
      passedSilhouetteRules: candidate.recognition.passedSilhouetteRules,
      failedSilhouetteRules: candidate.recognition.failedSilhouetteRules
    })}`,
    `params: ${JSON.stringify(candidate.params)}`,
    `bounds X/Y/Z: ${extents.x.toFixed(3)} / ${extents.y.toFixed(3)} / ${extents.z.toFixed(3)}`,
    `gate.passed: ${candidate.gate.passed}`,
    `BOM by subassembly: ${JSON.stringify(bomBySubassembly)}`
  ].join("\n");
}

function extentsFor(bounds: { min: Vec3; max: Vec3 }): Vec3 {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z
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
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function randomStep(random: () => number, scale: number): number {
  return (random() * 2 - 1) * scale;
}

function snapFold(value: number, choices = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 3, -Math.PI / 3]): number {
  return choices.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  );
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const best = await optimizeJet(EVALUATIONS);
  writeFileSync(OUT, `${JSON.stringify(best.draft, null, 2)}\n`);
  console.log(formatSummary(best));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
