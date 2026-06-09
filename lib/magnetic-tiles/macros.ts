import {
  ISOSCELES_EQUAL_SIDE,
  LARGE_EDGE,
  RIGHT_TRIANGLE_HYPOTENUSE,
  SMALL_EDGE,
  TILE_SPECS,
  TILE_THICKNESS,
  XL_SQUARE_EDGE,
  emptyInventory
} from "./catalog";
import { connectionWithMagneticEdges, findMagneticEdgeMatch, tileLocalVertices, tileWorldVertices } from "./magnet-geometry";
import { tileNormal, tilesIntersectAsPrisms } from "./prism-geometry";
import type { Inventory, MagneticConnection, TileBasis, TileInstance, TileShape, Vec3 } from "./types";

const EDGE = SMALL_EDGE;
const PANEL_THICKNESS = TILE_THICKNESS;
const HALF_THICKNESS = PANEL_THICKNESS / 2;
const APPROVED_LANDING_SUPPORT_DROP = 1.56;
const GUARD_RAIL_SIDE_CLEARANCE = PANEL_THICKNESS + 0.06;

export type MacroOrientation = number | "east" | "west" | "north" | "south" | Vec3;
export type GridPlane = "vertical" | "horizontal";
export type BoxFace = "front" | "back" | "left" | "right" | "top" | "bottom";
export type MirrorAxis = "x" | "z";
export type EdgeLengthClass = "short" | "hyp" | "long" | "xl";
export type PrimitivePlane = "vertical" | "horizontal";

export interface TileMacro {
  tiles: TileInstance[];
  connections: MagneticConnection[];
  ports?: Record<string, MacroPort>;
}

export interface MacroPortFrame {
  anchor: Vec3;
  start: Vec3;
  end: Vec3;
  direction: Vec3;
  normal: Vec3;
}

export interface MacroPort {
  name: string;
  tileId: string;
  edge: number;
  frameOffset?: Vec3;
  frame: MacroPortFrame;
}

export interface WedgePrismParams {
  id: string;
  deckLength: number;
  width?: number;
  sideShape?: "right-triangle" | "isosceles-triangle" | "equilateral-triangle";
  origin?: Vec3;
  facing?: MacroOrientation;
  includeFloor?: boolean;
  stepStart?: number;
  subassemblyId?: string;
  colors?: {
    side?: string;
    deck?: string;
    floor?: string;
  };
}

export interface WallGridParams {
  id: string;
  rows: number;
  cols: number;
  plane?: GridPlane;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  role?: string;
  subassemblyId?: string;
  color?: string;
}

export interface BoxParams {
  id: string;
  width: number;
  height: number;
  depth: number;
  origin?: Vec3;
  facing?: MacroOrientation;
  openFaces?: BoxFace[];
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface SmallLandingParams {
  id: string;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  colors?: {
    deck?: string;
    leg?: string;
    side?: string;
  };
}

export interface GuardRailParams {
  id: string;
  side: "left" | "right";
  deckLength: number;
  width?: number;
  sideShape?: WedgePrismParams["sideShape"];
  origin?: Vec3;
  facing?: MacroOrientation;
  tileShape?: TileShape;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface SwitchbackRampParams {
  lowerLength: number;
  upperLength: number;
  slope?: WedgePrismParams["sideShape"];
  towerHeight: number;
  withGuardRails?: boolean;
  id?: string;
}

export interface AttachMacroToEdgeParams {
  child: TileMacro;
  childAnchorTileId: string;
  childEdge: number;
  parent: TileMacro;
  parentTileId: string;
  parentEdge: number;
  foldAngle?: number;
  reverse?: boolean;
}

export interface AttachByPortOptions {
  foldAngle?: number;
  flip?: boolean;
}

export interface TilePrimitiveParams {
  id: string;
  shape: TileShape;
  origin?: Vec3;
  facing?: MacroOrientation;
  plane?: PrimitivePlane;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
  role?: string;
}

export interface JoinByPortOptions extends AttachByPortOptions {
  name?: string;
}

export interface OpenBoxParams extends Omit<BoxParams, "openFaces"> {
  openFaces?: BoxFace[];
}

export interface CubeParams {
  id: string;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface TriangularPrismParams extends Omit<WedgePrismParams, "includeFloor"> {
  includeFloor?: boolean;
}

export interface RampSegmentParams extends WedgePrismParams {
  withLanding?: boolean;
  withGuardRails?: boolean;
}

export interface SteppedRiserParams {
  id: string;
  steps: number;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface TriangleTentParams {
  id: string;
  shape?: "equilateral-triangle" | "right-triangle" | "isosceles-triangle";
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface GableRoofParams {
  id: string;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  colors?: {
    roof?: string;
    gable?: string;
  };
}

export interface SquarePyramidParams {
  id: string;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface RadialFanParams {
  id: string;
  segments?: number;
  shape?: "equilateral-triangle" | "isosceles-triangle";
  origin?: Vec3;
  facing?: MacroOrientation;
  startAngle?: number;
  stepStart?: number;
  subassemblyId?: string;
  color?: string;
}

export interface RocketFinBaseParams {
  id: string;
  origin?: Vec3;
  facing?: MacroOrientation;
  stepStart?: number;
  subassemblyId?: string;
  colors?: {
    base?: string;
    fin?: string;
  };
}

type PortSpec = Omit<MacroPort, "frame"> & { frameOffset?: Vec3 };

interface MacroFrame {
  origin: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

interface SideGeometry {
  localVertices: Vec3[];
  worldVertices: Vec3[];
  deckEdge: number;
  lowerDeckPoint: Vec3;
  upperDeckPoint: Vec3;
}

export const EDGE_LENGTH_CLASS_JOIN_MATRIX: Record<EdgeLengthClass, EdgeLengthClass[]> = {
  short: ["short"],
  hyp: ["hyp"],
  long: ["long"],
  xl: ["xl"]
};

export function tilePrimitive(params: TilePrimitiveParams): TileMacro {
  const frame = frameFromOrientation(params.origin, params.facing);
  const spec = TILE_SPECS[params.shape];
  const plane = params.plane ?? "horizontal";
  const localBasis = plane === "horizontal" ? horizontalBasis() : identityBasis();
  const localPosition =
    plane === "horizontal"
      ? { x: 0, y: HALF_THICKNESS, z: 0 }
      : { x: 0, y: spec.height / 2, z: 0 };
  const tile = makeTile({
    id: params.id,
    shape: params.shape,
    color: params.color ?? "#118ab2",
    localPosition,
    localBasis,
    frame,
    step: params.stepStart ?? 1,
    role: params.role ?? `${params.id} ${spec.label.toLowerCase()} primitive`,
    subassemblyId: params.subassemblyId ?? params.id,
    root: true
  });

  return withPorts({ tiles: [tile], connections: [] }, params.id, primitivePortSpecs(params.id, params.shape));
}

export function edgeLengthClassForShapeEdge(shape: TileShape, edge: number): EdgeLengthClass {
  return edgeLengthClass(edgeLength(shape, edge));
}

export function edgeLengthClassForPort(macro: TileMacro, portName: string): EdgeLengthClass {
  const port = requirePort(macro, portName);
  const tile = tileById(macro, port.tileId);
  return edgeLengthClassForShapeEdge(tile.shape, port.edge);
}

export function canJoinFullEdges(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string
): boolean {
  return edgeLengthClassForPort(parent, parentPortName) === edgeLengthClassForPort(child, childPortName);
}

export function joinByPorts(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  options: JoinByPortOptions = {}
): TileMacro {
  assertJoinablePorts(parent, parentPortName, child, childPortName);
  const joined = attachByPort(parent, parentPortName, child, childPortName, options);
  return resolveJoinedHingeClearance(joined, parent, child, parentPortName, childPortName, options.foldAngle ?? 0);
}

export function coplanarFlatJoin(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  options: Omit<JoinByPortOptions, "foldAngle"> = {}
): TileMacro {
  return joinByPorts(parent, parentPortName, child, childPortName, { flip: true, ...options, foldAngle: 0 });
}

export function rightAngleFold(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  direction: 1 | -1 = 1,
  options: Omit<JoinByPortOptions, "foldAngle"> = {}
): TileMacro {
  return joinByPorts(parent, parentPortName, child, childPortName, { flip: true, ...options, foldAngle: direction * Math.PI / 2 });
}

export function arbitraryFold(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  foldAngle: number,
  options: Omit<JoinByPortOptions, "foldAngle"> = {}
): TileMacro {
  return joinByPorts(parent, parentPortName, child, childPortName, { flip: true, ...options, foldAngle });
}

export function mirroredPair(macro: TileMacro, axis: MirrorAxis = "x", origin = 0): TileMacro {
  return composeMacros(macro, mirrorMacro(macro, axis, origin));
}

export function openBox(params: OpenBoxParams): TileMacro {
  return box({ ...params, openFaces: params.openFaces ?? ["top"] });
}

export function cube(params: CubeParams): TileMacro {
  return box({
    id: params.id,
    width: 1,
    height: 1,
    depth: 1,
    origin: params.origin,
    facing: params.facing,
    stepStart: params.stepStart,
    subassemblyId: params.subassemblyId,
    color: params.color
  });
}

export function triangularPrism(params: TriangularPrismParams): TileMacro {
  return wedgePrism({ ...params, includeFloor: params.includeFloor ?? true });
}

export function rampSegment(params: RampSegmentParams): TileMacro {
  let ramp = wedgePrism(params);
  if (params.withLanding) {
    const deck = tileById(ramp, `${params.id}-deck-${params.deckLength}-1`);
    ramp = joinByPorts(
      ramp,
      "highEdge",
      smallLanding({
        id: `${params.id}-landing`,
        stepStart: (params.stepStart ?? 1) + params.deckLength + 1,
        subassemblyId: params.subassemblyId ?? params.id
      }),
      "wedgeEdge",
      { foldAngle: horizontalFoldAngle(tileNormal(deck)), flip: true }
    );
  }

  if (params.withGuardRails) {
    ramp = joinByPorts(
      ramp,
      `${params.id}.leftDeckEdge`,
      guardRail({
        id: `${params.id}-left-rail`,
        side: "left",
        deckLength: params.deckLength,
        width: params.width,
        sideShape: params.sideShape,
        stepStart: (params.stepStart ?? 1) + params.deckLength + 3,
        subassemblyId: params.subassemblyId ?? params.id
      }),
      "deckEdge"
    );
    ramp = joinByPorts(
      ramp,
      `${params.id}.rightDeckEdge`,
      guardRail({
        id: `${params.id}-right-rail`,
        side: "right",
        deckLength: params.deckLength,
        width: params.width,
        sideShape: params.sideShape,
        stepStart: (params.stepStart ?? 1) + params.deckLength + 4,
        subassemblyId: params.subassemblyId ?? params.id
      }),
      "deckEdge",
      { flip: true }
    );
  }

  return connectByContact(ramp);
}

export function steppedRiser(params: SteppedRiserParams): TileMacro {
  assertPositiveInteger(params.steps, "steps");
  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const color = params.color ?? "#06d6a0";
  const macros: TileMacro[] = [];

  for (let index = 0; index < params.steps; index += 1) {
    macros.push(
      box({
        id: `${params.id}-step-${index + 1}`,
        width: 1,
        height: index + 1,
        depth: 1,
        openFaces: ["front", "back"],
        origin: transformPoint({ x: index * (EDGE + PANEL_THICKNESS * 2), y: 0, z: 0 }, frame),
        facing: params.facing,
        stepStart: stepStart + index,
        subassemblyId,
        color
      })
    );
  }

  return connectByContact(composeMacros(...macros));
}

export function triangleTent(params: TriangleTentParams): TileMacro {
  const shape = params.shape ?? "equilateral-triangle";
  const tent = triangularPrism({
    id: params.id,
    deckLength: shape === "isosceles-triangle" ? 2 : 1,
    width: 1,
    sideShape: shape,
    origin: params.origin,
    facing: params.facing,
    stepStart: params.stepStart,
    subassemblyId: params.subassemblyId ?? params.id,
    includeFloor: true,
    colors: {
      side: params.color ?? "#ffb703",
      deck: params.color ?? "#ffb703",
      floor: "#8ecae6"
    }
  });
  return {
    ...tent,
    tiles: tent.tiles.map((tile) => ({
      ...tile,
      role: tile.role
        .replace(/\bwedge\b/gi, "tent")
        .replace(/\bdeck\b/gi, "roof")
        .replace(/\bdriving\b/gi, "ridge")
        .replace(/\bfloor\b/gi, "base")
        .replace(/\bramp\b/gi, "tent")
    }))
  };
}

export function gableRoof(params: GableRoofParams): TileMacro {
  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const roofColor = params.colors?.roof ?? "#d62828";
  const gableColor = params.colors?.gable ?? "#ffb703";
  const roofHeight = TILE_SPECS["equilateral-triangle"].height;
  const slopeDirection = normalize({ x: EDGE / 2, y: roofHeight, z: 0 });
  const rightSlopeDirection = { x: slopeDirection.x, y: -slopeDirection.y, z: 0 };
  const leftRoofNormal = normalize(cross(slopeDirection, { x: 0, y: 0, z: 1 }));
  const rightRoofNormal = normalize(cross(rightSlopeDirection, { x: 0, y: 0, z: 1 }));
  const leftRoofPosition = add(
    { x: EDGE / 4, y: roofHeight / 2, z: EDGE / 2 },
    scale(leftRoofNormal, -HALF_THICKNESS)
  );
  const rightRoofPosition = add(
    { x: EDGE * 0.75, y: roofHeight / 2, z: EDGE / 2 },
    scale(rightRoofNormal, -HALF_THICKNESS)
  );

  const tiles: TileInstance[] = [
    makeTile({
      id: `${params.id}-front-gable`,
      shape: "equilateral-triangle",
      color: gableColor,
      localPosition: { x: EDGE / 2, y: roofHeight / 2, z: -HALF_THICKNESS },
      localBasis: { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: 0, y: 0, z: -1 } },
      frame,
      step: stepStart,
      role: `${params.id} front triangle gable end`,
      subassemblyId,
      root: true
    }),
    makeTile({
      id: `${params.id}-left-roof`,
      shape: "small-square",
      color: roofColor,
      localPosition: leftRoofPosition,
      localBasis: {
        xAxis: slopeDirection,
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: leftRoofNormal
      },
      frame,
      step: stepStart + 1,
      role: `${params.id} left pitched roof panel`,
      subassemblyId
    }),
    makeTile({
      id: `${params.id}-right-roof`,
      shape: "small-square",
      color: roofColor,
      localPosition: rightRoofPosition,
      localBasis: {
        xAxis: rightSlopeDirection,
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: rightRoofNormal
      },
      frame,
      step: stepStart + 1,
      role: `${params.id} right pitched roof panel`,
      subassemblyId
    }),
    makeTile({
      id: `${params.id}-back-gable`,
      shape: "equilateral-triangle",
      color: gableColor,
      localPosition: { x: EDGE / 2, y: roofHeight / 2, z: EDGE + HALF_THICKNESS },
      localBasis: identityBasis(),
      frame,
      step: stepStart,
      role: `${params.id} back triangle gable end`,
      subassemblyId
    })
  ];

  return withPorts(connectByContact({ tiles, connections: [] }), params.id, [
    { name: "frontBase", tileId: `${params.id}-front-gable`, edge: 0 },
    { name: "backBase", tileId: `${params.id}-back-gable`, edge: 0 },
    { name: "leftEave", tileId: `${params.id}-left-roof`, edge: 3 },
    { name: "rightEave", tileId: `${params.id}-right-roof`, edge: 1 },
    { name: "ridge", tileId: `${params.id}-left-roof`, edge: 1 }
  ]);
}

export function squarePyramid(params: SquarePyramidParams): TileMacro {
  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const color = params.color ?? "#d62828";
  const faceHeight = TILE_SPECS["equilateral-triangle"].height;
  const inset = EDGE / 2 - PANEL_THICKNESS * 1.5;
  const apexHeight = Math.sqrt(faceHeight ** 2 - inset ** 2);
  const tiles: TileInstance[] = [
    makeTile({
      id: `${params.id}-base-cap`,
      shape: "small-square",
      color: "#118ab2",
      localPosition: { x: EDGE / 2, y: HALF_THICKNESS, z: EDGE / 2 },
      localBasis: horizontalBasis(),
      frame,
      step: stepStart,
      role: `${params.id} hidden square nose cone cap`,
      subassemblyId,
      root: true
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-front-face`,
      shape: "equilateral-triangle",
      color,
      baseStart: { x: 0, y: HALF_THICKNESS, z: 0 },
      baseEnd: { x: EDGE, y: HALF_THICKNESS, z: 0 },
      apex: { x: EDGE / 2, y: HALF_THICKNESS + apexHeight, z: inset },
      normalOffset: -PANEL_THICKNESS,
      frame,
      step: stepStart + 1,
      role: `${params.id} front triangular nose cone face`,
      subassemblyId,
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-right-face`,
      shape: "equilateral-triangle",
      color,
      baseStart: { x: EDGE, y: HALF_THICKNESS, z: 0 },
      baseEnd: { x: EDGE, y: HALF_THICKNESS, z: EDGE },
      apex: { x: EDGE - inset, y: HALF_THICKNESS + apexHeight, z: EDGE / 2 },
      normalOffset: -PANEL_THICKNESS,
      frame,
      step: stepStart + 2,
      role: `${params.id} right triangular nose cone face`,
      subassemblyId
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-back-face`,
      shape: "equilateral-triangle",
      color,
      baseStart: { x: EDGE, y: HALF_THICKNESS, z: EDGE },
      baseEnd: { x: 0, y: HALF_THICKNESS, z: EDGE },
      apex: { x: EDGE / 2, y: HALF_THICKNESS + apexHeight, z: EDGE - inset },
      normalOffset: -PANEL_THICKNESS,
      frame,
      step: stepStart + 3,
      role: `${params.id} back triangular nose cone face`,
      subassemblyId
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-left-face`,
      shape: "equilateral-triangle",
      color,
      baseStart: { x: 0, y: HALF_THICKNESS, z: EDGE },
      baseEnd: { x: 0, y: HALF_THICKNESS, z: 0 },
      apex: { x: inset, y: HALF_THICKNESS + apexHeight, z: EDGE / 2 },
      normalOffset: -PANEL_THICKNESS,
      frame,
      step: stepStart + 4,
      role: `${params.id} left triangular nose cone face`,
      subassemblyId
    })
  ];

  return withPorts(connectByContact({ tiles, connections: [] }), params.id, [
    { name: "frontBase", tileId: `${params.id}-front-face`, edge: 0 },
    { name: "rightBase", tileId: `${params.id}-right-face`, edge: 0 },
    { name: "backBase", tileId: `${params.id}-back-face`, edge: 0 },
    { name: "leftBase", tileId: `${params.id}-left-face`, edge: 0 }
  ]);
}

export function radialFan(params: RadialFanParams): TileMacro {
  const shape = params.shape ?? "isosceles-triangle";
  const sideLength = edgeLength(shape, 1);
  const baseLength = edgeLength(shape, 0);
  const halfAngle = Math.asin(baseLength / (sideLength * 2));
  const segmentAngle = halfAngle * 2;
  const segments = params.segments ?? Math.floor((Math.PI * 2) / segmentAngle);
  assertPositiveInteger(segments, "segments");
  if (segments * segmentAngle > Math.PI * 2 + 0.001) {
    throw new Error(`${shape} radial fan cannot fit ${segments} segment(s) without overlap.`);
  }

  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const color = params.color ?? "#7b2cbf";
  const startAngle = params.startAngle ?? -Math.PI / 2;
  const center: Vec3 = { x: 0, y: 0, z: 0 };
  const tiles: TileInstance[] = [];

  for (let index = 0; index < segments; index += 1) {
    const centerAngle = startAngle + index * segmentAngle;
    const firstRimAngle = centerAngle - halfAngle;
    const secondRimAngle = centerAngle + halfAngle;
    const baseStart = {
      x: Math.cos(firstRimAngle) * sideLength,
      y: Math.sin(firstRimAngle) * sideLength,
      z: 0
    };
    const baseEnd = {
      x: Math.cos(secondRimAngle) * sideLength,
      y: Math.sin(secondRimAngle) * sideLength,
      z: 0
    };

    tiles.push(
      makeTriangleTileFromWorldPoints({
        id: `${params.id}-segment-${index + 1}`,
        shape,
        color,
        baseStart,
        baseEnd,
        apex: center,
        frame,
        step: stepStart + index,
        role: `${params.id} radial shell triangle segment`,
        subassemblyId,
        root: index === 0
      })
    );
  }

  const macro = connectByContact({ tiles, connections: [] });
  const rimPorts: PortSpec[] = tiles.map((tile, index) => ({
    name: `rim${index + 1}`,
    tileId: tile.id,
    edge: 0
  }));
  return withPorts(macro, params.id, [
    { name: "baseEdge", tileId: `${params.id}-segment-1`, edge: 0 },
    { name: "openLeft", tileId: `${params.id}-segment-1`, edge: 2 },
    { name: "openRight", tileId: `${params.id}-segment-${segments}`, edge: 1 },
    ...rimPorts
  ]);
}

export function rocketFinBase(params: RocketFinBaseParams): TileMacro {
  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const finHeight = TILE_SPECS["equilateral-triangle"].height;
  const finClearance = PANEL_THICKNESS;
  const colors = {
    base: params.colors?.base ?? "#118ab2",
    fin: params.colors?.fin ?? "#ffb703"
  };
  const baseY = HALF_THICKNESS;
  const tiles: TileInstance[] = [
    makeTile({
      id: `${params.id}-center-base`,
      shape: "small-square",
      color: colors.base,
      localPosition: { x: EDGE / 2, y: baseY, z: EDGE / 2 },
      localBasis: horizontalBasis(),
      frame,
      step: stepStart,
      role: `${params.id} central square rocket base panel`,
      subassemblyId,
      root: true
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-front-fin`,
      shape: "equilateral-triangle",
      color: colors.fin,
      baseStart: { x: 0, y: baseY, z: -finClearance },
      baseEnd: { x: EDGE, y: baseY, z: -finClearance },
      apex: { x: EDGE / 2, y: baseY, z: -finClearance - finHeight },
      frame,
      step: stepStart + 1,
      role: `${params.id} front triangular rocket fin outrigger`,
      subassemblyId
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-right-fin`,
      shape: "equilateral-triangle",
      color: colors.fin,
      baseStart: { x: EDGE + finClearance, y: baseY, z: 0 },
      baseEnd: { x: EDGE + finClearance, y: baseY, z: EDGE },
      apex: { x: EDGE + finClearance + finHeight, y: baseY, z: EDGE / 2 },
      frame,
      step: stepStart + 1,
      role: `${params.id} right triangular rocket fin outrigger`,
      subassemblyId
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-back-fin`,
      shape: "equilateral-triangle",
      color: colors.fin,
      baseStart: { x: EDGE, y: baseY, z: EDGE + finClearance },
      baseEnd: { x: 0, y: baseY, z: EDGE + finClearance },
      apex: { x: EDGE / 2, y: baseY, z: EDGE + finClearance + finHeight },
      frame,
      step: stepStart + 1,
      role: `${params.id} back triangular rocket fin outrigger`,
      subassemblyId
    }),
    makeTriangleTileFromWorldPoints({
      id: `${params.id}-left-fin`,
      shape: "equilateral-triangle",
      color: colors.fin,
      baseStart: { x: -finClearance, y: baseY, z: EDGE },
      baseEnd: { x: -finClearance, y: baseY, z: 0 },
      apex: { x: -finClearance - finHeight, y: baseY, z: EDGE / 2 },
      frame,
      step: stepStart + 1,
      role: `${params.id} left triangular rocket fin outrigger`,
      subassemblyId
    })
  ];

  return withPorts(connectByContact({ tiles, connections: [] }), params.id, [
    { name: "bodyBase", tileId: `${params.id}-center-base`, edge: 0 },
    { name: "frontFinBase", tileId: `${params.id}-front-fin`, edge: 0 },
    { name: "rightFinBase", tileId: `${params.id}-right-fin`, edge: 0 },
    { name: "backFinBase", tileId: `${params.id}-back-fin`, edge: 0 },
    { name: "leftFinBase", tileId: `${params.id}-left-fin`, edge: 0 }
  ]);
}

export function wedgePrism(params: WedgePrismParams): TileMacro {
  const sideShape = params.sideShape ?? "isosceles-triangle";
  const width = params.width ?? 1;
  assertPositiveInteger(params.deckLength, "deckLength");
  assertPositiveInteger(width, "width");

  const geometry = sideGeometry(sideShape);
  const deckVector = subtract(geometry.upperDeckPoint, geometry.lowerDeckPoint);
  const deckLength = magnitude(deckVector);
  if (params.deckLength * EDGE - deckLength > 0.001) {
    throw new Error(`${sideShape} side cannot support ${params.deckLength} deck square(s).`);
  }

  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const colors = {
    side: params.colors?.side ?? "#ffb703",
    deck: params.colors?.deck ?? "#f77f00",
    floor: params.colors?.floor ?? "#8ecae6"
  };
  const side = sideTileBasis(geometry);
  const sideOffset = (width * EDGE) / 2 + HALF_THICKNESS;
  const deckDirection = normalize(deckVector);
  const deckNormal = { x: deckDirection.y, y: -deckDirection.x, z: 0 };
  const flatMatingLift = Math.max(0, EDGE + PANEL_THICKNESS / 3 - geometry.upperDeckPoint.y);
  const tiles: TileInstance[] = [
    makeTile({
      id: `${params.id}-left-side`,
      shape: sideShape,
      color: colors.side,
      localPosition: { ...side.position, z: -sideOffset },
      localBasis: { ...side.basis, zAxis: { x: 0, y: 0, z: 1 } },
      frame,
      step: stepStart,
      role: `${params.id} left ${sideShape} wedge side`,
      subassemblyId,
      root: true
    }),
    makeTile({
      id: `${params.id}-right-side`,
      shape: sideShape,
      color: colors.side,
      localPosition: { ...side.position, z: sideOffset },
      localBasis: { ...side.basis, zAxis: { x: 0, y: 0, z: -1 } },
      frame,
      step: stepStart,
      role: `${params.id} right ${sideShape} wedge side`,
      subassemblyId,
      root: true
    })
  ];

  for (let lengthIndex = 0; lengthIndex < params.deckLength; lengthIndex += 1) {
    for (let widthIndex = 0; widthIndex < width; widthIndex += 1) {
      const centerOnSlope = add(geometry.lowerDeckPoint, scale(deckDirection, EDGE * lengthIndex + EDGE / 2));
      const localZ = (widthIndex - (width - 1) / 2) * EDGE;
      tiles.push(
        makeTile({
          id: `${params.id}-deck-${lengthIndex + 1}-${widthIndex + 1}`,
          shape: "small-square",
          color: colors.deck,
          localPosition: { x: centerOnSlope.x, y: centerOnSlope.y, z: localZ },
          localBasis: {
            xAxis: { x: deckDirection.x, y: deckDirection.y, z: 0 },
            yAxis: { x: 0, y: 0, z: 1 },
            zAxis: deckNormal
          },
          frame,
          step: stepStart + 1 + lengthIndex,
          role: `${params.id} sloped driving deck`,
          subassemblyId: `${subassemblyId}-deck`,
          parentTileId: lengthIndex === 0 && widthIndex === 0 ? `${params.id}-left-side` : undefined,
          parentEdge: lengthIndex === 0 && widthIndex === 0 ? geometry.deckEdge : undefined,
          childEdge: lengthIndex === 0 && widthIndex === 0 ? 0 : undefined,
          foldAngle: lengthIndex === 0 && widthIndex === 0 ? -Math.PI / 2 : undefined
        })
      );
    }
  }

  if (params.includeFloor) {
    for (let lengthIndex = 0; lengthIndex < params.deckLength; lengthIndex += 1) {
      for (let widthIndex = 0; widthIndex < width; widthIndex += 1) {
        tiles.push(
          makeTile({
            id: `${params.id}-floor-${lengthIndex + 1}-${widthIndex + 1}`,
            shape: "small-square",
            color: colors.floor,
            localPosition: {
              x: EDGE * lengthIndex + EDGE / 2,
              y: -PANEL_THICKNESS,
              z: (widthIndex - (width - 1) / 2) * EDGE
            },
            localBasis: horizontalBasis(),
            frame,
            step: stepStart,
            role: `${params.id} optional floor square`,
            subassemblyId: `${subassemblyId}-floor`,
            root: true
          })
        );
      }
    }
  }

  const connections = connectWedgeTiles(tiles, params.id, params.deckLength, width, geometry.deckEdge, params.includeFloor);
  const macro = connectByContact({ tiles: withAttachmentMetadata(tiles, connections), connections });
  return withPorts(macro, params.id, [
    { name: "lowEdge", tileId: `${params.id}-deck-1-1`, edge: 3 },
    { name: "highEdge", tileId: `${params.id}-deck-${params.deckLength}-1`, edge: 1, frameOffset: { x: 0, y: flatMatingLift, z: 0 } },
    { name: "leftDeckEdge", tileId: `${params.id}-deck-1-1`, edge: 0 },
    { name: "rightDeckEdge", tileId: `${params.id}-deck-1-${width}`, edge: 2 },
    { name: "baseFloor", tileId: `${params.id}-left-side`, edge: 2 }
  ]);
}

export function wallGrid(params: WallGridParams): TileMacro {
  assertPositiveInteger(params.rows, "rows");
  assertPositiveInteger(params.cols, "cols");

  const frame = frameFromOrientation(params.origin, params.facing);
  const plane = params.plane ?? "vertical";
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const tiles: TileInstance[] = [];

  for (let row = 0; row < params.rows; row += 1) {
    for (let col = 0; col < params.cols; col += 1) {
      const localPosition =
        plane === "vertical"
          ? { x: col * EDGE + EDGE / 2, y: row * EDGE + EDGE / 2, z: 0 }
          : { x: col * EDGE + EDGE / 2, y: HALF_THICKNESS, z: row * EDGE + EDGE / 2 };
      tiles.push(
        makeTile({
          id: `${params.id}-${col + 1}-${row + 1}`,
          shape: "small-square",
          color: params.color ?? "#118ab2",
          localPosition,
          localBasis: plane === "vertical" ? identityBasis() : horizontalBasis(),
          frame,
          step: stepStart + row,
          role: params.role ?? `${params.id} square grid panel`,
          subassemblyId,
          root: col === 0 && row === 0
        })
      );
    }
  }

  const macro = connectByContact({ tiles, connections: [] });
  return withPorts(macro, params.id, [
    { name: "baseEdge", tileId: `${params.id}-1-1`, edge: 0 },
    { name: "topEdge", tileId: `${params.id}-1-${params.rows}`, edge: 2 },
    { name: "leftEdge", tileId: `${params.id}-1-1`, edge: 3 },
    { name: "rightEdge", tileId: `${params.id}-${params.cols}-1`, edge: 1 }
  ]);
}

export function box(params: BoxParams): TileMacro {
  assertPositiveInteger(params.width, "width");
  assertPositiveInteger(params.height, "height");
  assertPositiveInteger(params.depth, "depth");

  const frame = frameFromOrientation(params.origin, params.facing);
  const openFaces = new Set(params.openFaces ?? []);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const color = params.color ?? "#8ecae6";
  const tiles: TileInstance[] = [];
  const totalWidth = params.width * EDGE;
  const totalHeight = params.height * EDGE;
  const totalDepth = params.depth * EDGE;

  const addFaceTile = (
    face: BoxFace,
    col: number,
    row: number,
    localPosition: Vec3,
    localBasis: TileBasis,
    role: string
  ) => {
    if (openFaces.has(face)) return;
    tiles.push(
      makeTile({
        id: `${params.id}-${face}-${col + 1}-${row + 1}`,
        shape: "small-square",
        color,
        localPosition,
        localBasis,
        frame,
        step: stepStart + row,
        role,
        subassemblyId,
        root: tiles.length === 0
      })
    );
  };

  for (let row = 0; row < params.height; row += 1) {
    for (let col = 0; col < params.width; col += 1) {
      addFaceTile(
        "front",
        col,
        row,
        { x: col * EDGE + EDGE / 2, y: row * EDGE + EDGE / 2, z: -HALF_THICKNESS },
        { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: 0, y: 0, z: -1 } },
        `${params.id} front box face`
      );
      addFaceTile(
        "back",
        col,
        row,
        { x: col * EDGE + EDGE / 2, y: row * EDGE + EDGE / 2, z: totalDepth + HALF_THICKNESS },
        identityBasis(),
        `${params.id} back box face`
      );
    }
  }

  for (let row = 0; row < params.height; row += 1) {
    for (let col = 0; col < params.depth; col += 1) {
      addFaceTile(
        "left",
        col,
        row,
        { x: -HALF_THICKNESS, y: row * EDGE + EDGE / 2, z: col * EDGE + EDGE / 2 },
        { xAxis: { x: 0, y: 0, z: 1 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: -1, y: 0, z: 0 } },
        `${params.id} left box face`
      );
      addFaceTile(
        "right",
        col,
        row,
        { x: totalWidth + HALF_THICKNESS, y: row * EDGE + EDGE / 2, z: col * EDGE + EDGE / 2 },
        { xAxis: { x: 0, y: 0, z: 1 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: 1, y: 0, z: 0 } },
        `${params.id} right box face`
      );
    }
  }

  for (let row = 0; row < params.depth; row += 1) {
    for (let col = 0; col < params.width; col += 1) {
      addFaceTile(
        "bottom",
        col,
        row,
        { x: col * EDGE + EDGE / 2, y: HALF_THICKNESS, z: row * EDGE + EDGE / 2 },
        horizontalBasis(),
        `${params.id} bottom box face`
      );
      addFaceTile(
        "top",
        col,
        row,
        { x: col * EDGE + EDGE / 2, y: totalHeight + HALF_THICKNESS, z: row * EDGE + EDGE / 2 },
        horizontalBasis(),
        `${params.id} top box face`
      );
    }
  }

  const macro = connectByContact({ tiles, connections: [] });
  const ports: PortSpec[] = [];
  const addFacePort = (name: string, face: BoxFace, edge: number) => {
    if (!openFaces.has(face)) ports.push({ name, tileId: `${params.id}-${face}-1-1`, edge });
  };

  addFacePort("front", "front", 0);
  addFacePort("back", "back", 0);
  addFacePort("left", "left", 0);
  addFacePort("right", "right", 0);
  addFacePort("bottom", "bottom", 3);
  addFacePort("top", "top", 3);
  addFacePort("topLeftEdge", "top", 3);
  addFacePort("topRightEdge", "top", 1);
  addFacePort("topFrontEdge", "top", 0);
  addFacePort("topBackEdge", "top", 2);
  if (!openFaces.has("top")) {
    ports.push({
      name: "topRightRampEdge",
      tileId: `${params.id}-top-1-1`,
      edge: 1,
      frameOffset: { x: HALF_THICKNESS, y: 0.14, z: 0 }
    });
  }
  return withPorts(macro, params.id, ports);
}

export function smallLanding(params: SmallLandingParams): TileMacro {
  const frame = frameFromOrientation(params.origin, params.facing);
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? params.id;
  const colors = {
    deck: params.colors?.deck ?? "#d62828",
    leg: params.colors?.leg ?? "#d62828",
    side: params.colors?.side ?? "#06d6a0"
  };
  const tiles = [
    makeTile({
      id: `${params.id}-top`,
      shape: "small-square",
      color: colors.deck,
      localPosition: { x: 0, y: 0, z: 0 },
      localBasis: horizontalBasis(),
      frame,
      step: stepStart,
      role: `${params.id} supported flat top landing square`,
      subassemblyId,
      root: true
    }),
    makeTile({
      id: `${params.id}-leg`,
      shape: "small-square",
      color: colors.leg,
      localPosition: { x: EDGE / 2 + HALF_THICKNESS, y: -APPROVED_LANDING_SUPPORT_DROP, z: 0 },
      localBasis: { xAxis: { x: 0, y: 0, z: 1 }, yAxis: { x: 0, y: 1, z: 0 }, zAxis: { x: -1, y: 0, z: 0 } },
      frame,
      step: stepStart + 1,
      role: `${params.id} vertical landing support square`,
      subassemblyId: `${subassemblyId}-support`,
      parentTileId: `${params.id}-top`,
      parentEdge: 1,
      childEdge: 2,
      foldAngle: Math.PI / 2
    }),
    makeTile({
      id: `${params.id}-left-triangle`,
      shape: "right-triangle",
      color: colors.side,
      localPosition: { x: 0, y: -EDGE / 2, z: -EDGE / 2 - HALF_THICKNESS - PANEL_THICKNESS },
      localBasis: { xAxis: { x: 0, y: -1, z: 0 }, yAxis: { x: -1, y: 0, z: 0 }, zAxis: { x: 0, y: 0, z: -1 } },
      frame,
      step: stepStart + 1,
      role: `${params.id} left right-triangle side support`,
      subassemblyId: `${subassemblyId}-support`,
      parentTileId: `${params.id}-top`,
      parentEdge: 0,
      childEdge: 2,
      foldAngle: Math.PI / 2
    }),
    makeTile({
      id: `${params.id}-right-triangle`,
      shape: "right-triangle",
      color: colors.side,
      localPosition: { x: 0, y: -EDGE / 2, z: EDGE / 2 + HALF_THICKNESS + PANEL_THICKNESS },
      localBasis: { xAxis: { x: 0, y: -1, z: 0 }, yAxis: { x: -1, y: 0, z: 0 }, zAxis: { x: 0, y: 0, z: -1 } },
      frame,
      step: stepStart + 1,
      role: `${params.id} right right-triangle side support`,
      subassemblyId: `${subassemblyId}-support`,
      parentTileId: `${params.id}-top`,
      parentEdge: 2,
      childEdge: 2,
      foldAngle: Math.PI / 2
    })
  ];
  const connections = [
    edgeConnection(tiles[0], 1, tiles[1], 2),
    edgeConnection(tiles[0], 0, tiles[2], 2),
    edgeConnection(tiles[0], 2, tiles[3], 2)
  ];

  return withPorts({ tiles, connections }, params.id, [
    { name: "wedgeEdge", tileId: `${params.id}-top`, edge: 3 },
    { name: "frontEdge", tileId: `${params.id}-top`, edge: 1 },
    { name: "leftEdge", tileId: `${params.id}-top`, edge: 0 },
    { name: "rightEdge", tileId: `${params.id}-top`, edge: 2 },
    { name: "legEdge", tileId: `${params.id}-leg`, edge: 2 }
  ]);
}

export function guardRail(params: GuardRailParams): TileMacro {
  const width = params.width ?? 1;
  assertPositiveInteger(params.deckLength, "deckLength");
  assertPositiveInteger(width, "width");

  const railShape = params.tileShape ?? "isosceles-triangle";
  const frame = frameFromOrientation(params.origin, params.facing);
  const geometry = sideGeometry(params.sideShape ?? "isosceles-triangle");
  const deckDirection = normalize(subtract(geometry.upperDeckPoint, geometry.lowerDeckPoint));
  const deckNormal = { x: deckDirection.y, y: -deckDirection.x, z: 0 };
  const outward = params.side === "left" ? { x: 0, y: 0, z: -1 } : { x: 0, y: 0, z: 1 };
  const attachEdge = guardRailAttachEdge(railShape);
  const segmentLength = edgeLength(railShape, attachEdge);
  const totalLength = params.deckLength * EDGE;
  const segmentCount = totalLength / segmentLength;
  if (Math.abs(segmentCount - Math.round(segmentCount)) > 0.001) {
    throw new Error(`${railShape} guard rail tiles do not evenly match a ${params.deckLength}-square deck.`);
  }

  const sideOffset = (width * EDGE) / 2 + GUARD_RAIL_SIDE_CLEARANCE;
  const stepStart = params.stepStart ?? 1;
  const subassemblyId = params.subassemblyId ?? `${params.id}-guards`;
  const color = params.color ?? "#7b2cbf";
  const tiles: TileInstance[] = [];

  for (let segment = 0; segment < Math.round(segmentCount); segment += 1) {
    const edgeStart = add(
      add(geometry.lowerDeckPoint, scale(deckDirection, segment * segmentLength)),
      scale(outward, sideOffset)
    );
    const { position, basis } = tileBasisAlongEdge(railShape, attachEdge, edgeStart, deckDirection, outward, deckNormal);
    tiles.push(
      makeTile({
        id: `${params.id}-${params.side}-rail-${segment + 1}`,
        shape: railShape,
        color,
        localPosition: position,
        localBasis: basis,
        frame,
        step: stepStart + segment,
        role: `${params.id} ${params.side} slope-parallel guard rail`,
        subassemblyId,
        root: segment === 0
      })
    );
  }

  const macro = connectByContact({ tiles, connections: [] });
  const attachTile = tiles[0];
  const deckPortOffset = params.side === "left"
    ? { x: 0, y: 0, z: GUARD_RAIL_SIDE_CLEARANCE }
    : { x: 0, y: 0, z: -GUARD_RAIL_SIDE_CLEARANCE };
  return withPorts(macro, params.id, [
    { name: "deckEdge", tileId: attachTile.id, edge: attachEdge, frameOffset: deckPortOffset },
    { name: `${params.side}DeckEdge`, tileId: attachTile.id, edge: attachEdge, frameOffset: deckPortOffset }
  ]);
}

export function composeMacros(...macros: TileMacro[]): TileMacro {
  return connectByContact({
    tiles: macros.flatMap((macro) => macro.tiles),
    connections: macros.flatMap((macro) => macro.connections),
    ports: mergePorts(...macros)
  });
}

export function switchbackRamp(params: SwitchbackRampParams): TileMacro {
  assertPositiveInteger(params.lowerLength, "lowerLength");
  assertPositiveInteger(params.upperLength, "upperLength");
  assertPositiveInteger(params.towerHeight, "towerHeight");

  const upperShape = params.slope ?? (params.upperLength === 1 ? "right-triangle" : "isosceles-triangle");
  const lower = wedgePrism({
    id: "lower",
    deckLength: params.lowerLength,
    width: 1,
    sideShape: "isosceles-triangle",
    stepStart: 1,
    subassemblyId: params.id ?? "switchback"
  });
  const lowerFold = horizontalFoldAngle(tileNormal(tileById(lower, `lower-deck-${params.lowerLength}-1`)));
  let build = attachByPort(
    lower,
    "highEdge",
    box({
      id: "turn",
      width: 1,
      height: 1,
      depth: 1,
      openFaces: ["front", "back", "left"],
      stepStart: params.lowerLength + 2,
      subassemblyId: params.id ?? "switchback"
    }),
    "topLeftEdge",
    { foldAngle: lowerFold, flip: true }
  );

  const upperProbe = wedgePrism({ id: "upper-probe", deckLength: params.upperLength, width: 1, sideShape: upperShape });
  const upperFold = horizontalFoldAngle(tileNormal(tileById(upperProbe, "upper-probe-deck-1-1")));
  build = attachByPort(
    build,
    "turn.topRightRampEdge",
    wedgePrism({
      id: "upper",
      deckLength: params.upperLength,
      width: 1,
      sideShape: upperShape,
      stepStart: params.lowerLength + 4,
      subassemblyId: params.id ?? "switchback"
    }),
    "lowEdge",
    { foldAngle: -upperFold }
  );

  build = attachByPort(
    build,
    "upper.highEdge",
    box({
      id: "tower",
      width: 1,
      height: params.towerHeight,
      depth: 1,
      openFaces: ["front", "back", "left"],
      stepStart: params.lowerLength + params.upperLength + 5,
      subassemblyId: params.id ?? "switchback"
    }),
    "topRightEdge",
    { foldAngle: Math.PI }
  );

  if (params.withGuardRails) {
    const railTileShape = params.upperLength === 1 ? "equilateral-triangle" : undefined;
    build = attachByPort(
      build,
      "upper.leftDeckEdge",
      guardRail({
        id: "left-rail",
        side: "left",
        deckLength: params.upperLength,
        width: 1,
        sideShape: upperShape,
        tileShape: railTileShape,
        stepStart: params.lowerLength + params.upperLength + params.towerHeight + 6,
        subassemblyId: params.id ?? "switchback"
      }),
      "deckEdge"
    );
    build = attachByPort(
      build,
      "upper.rightDeckEdge",
      guardRail({
        id: "right-rail",
        side: "right",
        deckLength: params.upperLength,
        width: 1,
        sideShape: upperShape,
        tileShape: railTileShape,
        stepStart: params.lowerLength + params.upperLength + params.towerHeight + 7,
        subassemblyId: params.id ?? "switchback"
      }),
      "deckEdge",
      { flip: true }
    );
  }

  return connectByContact(build);
}

export function placeMacro(macro: TileMacro, origin: Vec3, facing?: MacroOrientation): TileMacro {
  const frame = frameFromOrientation(origin, facing);
  const placed = {
    ...macro,
    tiles: macro.tiles.map((tile) => ({
      ...tile,
      position: transformPoint(tile.position, frame),
      basis: transformBasis(tile.basis ?? identityBasis(), frame)
    })),
    connections: macro.connections.map((connection) => ({ ...connection }))
  };
  return refreshPorts(placed);
}

export function attachByPort(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  options: AttachByPortOptions = {}
): TileMacro {
  const parentPort = requirePort(parent, parentPortName);
  const childPort = requirePort(child, childPortName);
  const parentTile = parent.tiles.find((tile) => tile.id === parentPort.tileId);
  const childAnchor = child.tiles.find((tile) => tile.id === childPort.tileId);
  if (!parentTile) throw new Error(`Missing parent tile ${parentPort.tileId}`);
  if (!childAnchor) throw new Error(`Missing child anchor tile ${childPort.tileId}`);

  const targetStart = options.flip ? parentPort.frame.end : parentPort.frame.start;
  const targetEnd = options.flip ? parentPort.frame.start : parentPort.frame.end;
  const targetDirection = normalize(subtract(targetEnd, targetStart));
  const sourceFrame = frameFromEdge(childPort.frame.start, childPort.frame.end, childPort.frame.normal);
  const targetNormal = normalize(rotateAroundAxis(parentPort.frame.normal, targetDirection, options.foldAngle ?? 0));
  const targetFrame = frameFromEdge(targetStart, targetEnd, targetNormal);
  const transformedChild = child.tiles.map((tile) => {
    const transformed = transformTileBetweenFrames(tile, sourceFrame, targetFrame, childPort.frame.start, targetStart);
    if (tile.id !== childPort.tileId) return transformed;
    return {
      ...transformed,
      parentTileId: parentPort.tileId,
      parentEdge: parentPort.edge,
      childEdge: childPort.edge,
      foldAngle: options.foldAngle ?? 0,
      root: false
    };
  });

  return {
    tiles: [...parent.tiles, ...transformedChild],
    connections: [
      ...parent.connections,
      ...child.connections,
      edgeConnection(parentTile, parentPort.edge, transformedChild.find((tile) => tile.id === childPort.tileId)!, childPort.edge)
    ],
    ports: mergePorts(parent, { ...child, tiles: transformedChild })
  };
}

export function getMacroPort(macro: TileMacro, portName: string): MacroPort {
  return requirePort(macro, portName);
}

export function attachMacroToEdge(params: AttachMacroToEdgeParams): TileMacro {
  const parentTile = params.parent.tiles.find((tile) => tile.id === params.parentTileId);
  const childAnchor = params.child.tiles.find((tile) => tile.id === params.childAnchorTileId);
  if (!parentTile) throw new Error(`Missing parent tile ${params.parentTileId}`);
  if (!childAnchor) throw new Error(`Missing child anchor tile ${params.childAnchorTileId}`);

  const sourceEdge = tileEdge(childAnchor, params.childEdge);
  const targetEdge = tileEdge(parentTile, params.parentEdge);
  const targetStart = params.reverse ? targetEdge.end : targetEdge.start;
  const targetEnd = params.reverse ? targetEdge.start : targetEdge.end;
  const targetDirection = normalize(subtract(targetEnd, targetStart));
  const sourceFrame = frameFromEdge(sourceEdge.start, sourceEdge.end, tileNormal(childAnchor));
  const targetNormal = normalize(rotateAroundAxis(tileNormal(parentTile), targetDirection, params.foldAngle ?? 0));
  const targetFrame = frameFromEdge(targetStart, targetEnd, targetNormal);
  const transformedChild = params.child.tiles.map((tile) => {
    const transformed = transformTileBetweenFrames(tile, sourceFrame, targetFrame, sourceEdge.start, targetStart);
    if (tile.id !== params.childAnchorTileId) return transformed;
    return {
      ...transformed,
      parentTileId: params.parentTileId,
      parentEdge: params.parentEdge,
      childEdge: params.childEdge,
      foldAngle: params.foldAngle ?? 0,
      root: false
    };
  });
  return {
    tiles: [...params.parent.tiles, ...transformedChild],
    connections: [
      ...params.parent.connections,
      ...params.child.connections,
      edgeConnection(parentTile, params.parentEdge, transformedChild.find((tile) => tile.id === params.childAnchorTileId)!, params.childEdge)
    ],
    ports: mergePorts(params.parent, { ...params.child, tiles: transformedChild })
  };
}

export function mirrorMacro(macro: TileMacro, axis: MirrorAxis = "x", origin = 0): TileMacro {
  const component = axis;
  const mirrored = {
    tiles: macro.tiles.map((tile) => ({
      ...tile,
      id: `${tile.id}-mirror`,
      mirrored: true,
      position: reflectPoint(tile.position, component, origin),
      basis: reflectBasis(tile.basis ?? identityBasis(), component),
      role: tile.role.replace(/\bleft\b/i, "TEMP_SIDE").replace(/\bright\b/i, "left").replace(/TEMP_SIDE/i, "right"),
      root: false,
      parentTileId: tile.parentTileId ? `${tile.parentTileId}-mirror` : undefined
    })),
    connections: macro.connections.map((connection) => ({
      ...connection,
      fromTileId: `${connection.fromTileId}-mirror`,
      toTileId: `${connection.toTileId}-mirror`
    })),
    ports: mirrorPorts(macro.ports, component, origin)
  };
  return refreshPorts(mirrored);
}

export function macroBom(macro: TileMacro): Inventory {
  return macro.tiles.reduce((counts, tile) => {
    counts[tile.shape] += 1;
    return counts;
  }, emptyInventory());
}

function primitivePortSpecs(tileId: string, shape: TileShape): PortSpec[] {
  const generic = tileLocalVertices(shape).map((_, edge) => ({ name: `edge${edge}`, tileId, edge }));
  if (shape === "small-square" || shape === "large-square" || shape === "xl-square") {
    return [
      ...generic,
      { name: "bottom", tileId, edge: 0 },
      { name: "right", tileId, edge: 1 },
      { name: "top", tileId, edge: 2 },
      { name: "left", tileId, edge: 3 }
    ];
  }

  if (shape === "right-triangle") {
    return [
      ...generic,
      { name: "legA", tileId, edge: 0 },
      { name: "hypotenuse", tileId, edge: 1 },
      { name: "legB", tileId, edge: 2 }
    ];
  }

  if (shape === "isosceles-triangle") {
    return [
      ...generic,
      { name: "base", tileId, edge: 0 },
      { name: "rightLong", tileId, edge: 1 },
      { name: "leftLong", tileId, edge: 2 }
    ];
  }

  return [
    ...generic,
    { name: "base", tileId, edge: 0 },
    { name: "right", tileId, edge: 1 },
    { name: "left", tileId, edge: 2 }
  ];
}

function assertJoinablePorts(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string
): void {
  const parentClass = edgeLengthClassForPort(parent, parentPortName);
  const childClass = edgeLengthClassForPort(child, childPortName);
  if (EDGE_LENGTH_CLASS_JOIN_MATRIX[parentClass].includes(childClass)) return;
  throw new Error(
    `Cannot full-edge join ${parentPortName} (${parentClass}) to ${childPortName} (${childClass}); edge length classes must match.`
  );
}

function resolveJoinedHingeClearance(
  joined: TileMacro,
  parent: TileMacro,
  child: TileMacro,
  parentPortName: string,
  childPortName: string,
  foldAngle: number
): TileMacro {
  if (Math.abs(foldAngle) <= 0.0001) return joined;

  const parentPort = requirePort(parent, parentPortName);
  const childPort = requirePort(child, childPortName);
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
        scale(parentNormal, (parentSign * PANEL_THICKNESS) / 2),
        scale(childNormal, (childSign * PANEL_THICKNESS) / 2)
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

  return refreshPorts(shiftChildTiles(joined, childIds, scored[0]?.offset ?? { x: 0, y: 0, z: 0 }));
}

function shiftChildTiles(macro: TileMacro, childIds: Set<string>, offset: Vec3): TileMacro {
  return {
    ...macro,
    tiles: macro.tiles.map((tile) => childIds.has(tile.id) ? { ...tile, position: add(tile.position, offset) } : tile)
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

function withPorts(macro: TileMacro, namespace: string, specs: PortSpec[]): TileMacro {
  const ports: Record<string, MacroPort> = {};
  specs.forEach((spec) => {
    const port = materializePort(macro.tiles, spec);
    ports[spec.name] = port;
    ports[`${namespace}.${spec.name}`] = { ...port, name: `${namespace}.${spec.name}` };
  });
  return { ...macro, ports };
}

function mergePorts(...macros: TileMacro[]): Record<string, MacroPort> | undefined {
  const ports: Record<string, MacroPort> = {};
  macros.forEach((macro) => {
    Object.values(macro.ports ?? {}).forEach((port) => {
      if (ports[port.name]) return;
      ports[port.name] = materializePort(macro.tiles, port);
    });
  });

  return Object.keys(ports).length > 0 ? ports : undefined;
}

function refreshPorts(macro: TileMacro): TileMacro {
  if (!macro.ports) return macro;
  return {
    ...macro,
    ports: Object.fromEntries(
      Object.entries(macro.ports).map(([name, port]) => [name, materializePort(macro.tiles, { ...port, name })])
    )
  };
}

function requirePort(macro: TileMacro, portName: string): MacroPort {
  const port = macro.ports?.[portName];
  if (!port) {
    const available = Object.keys(macro.ports ?? {}).sort().join(", ") || "none";
    throw new Error(`Missing macro port ${portName}. Available ports: ${available}`);
  }
  return materializePort(macro.tiles, port);
}

function materializePort(tiles: TileInstance[], spec: PortSpec): MacroPort {
  const tile = tiles.find((candidate) => candidate.id === spec.tileId);
  if (!tile) throw new Error(`Missing port tile ${spec.tileId} for port ${spec.name}`);
  const edge = tileEdge(tile, spec.edge);
  const offset = spec.frameOffset ?? { x: 0, y: 0, z: 0 };
  const start = add(edge.start, offset);
  const end = add(edge.end, offset);
  return {
    name: spec.name,
    tileId: spec.tileId,
    edge: spec.edge,
    frameOffset: spec.frameOffset,
    frame: {
      anchor: scale(add(start, end), 0.5),
      start,
      end,
      direction: normalize(subtract(end, start)),
      normal: tileNormal(tile)
    }
  };
}

function mirrorPorts(ports: TileMacro["ports"], axis: MirrorAxis, origin: number): TileMacro["ports"] {
  if (!ports) return undefined;
  return Object.fromEntries(
    Object.entries(ports).map(([name, port]) => {
      const mirroredName = mirroredPortName(name, axis);
      const mirrored = {
        name: mirroredName,
        tileId: `${port.tileId}-mirror`,
        edge: port.edge,
        frameOffset: port.frameOffset ? reflectVector(port.frameOffset, axis) : undefined,
        frame: {
          anchor: reflectPoint(port.frame.anchor, axis, origin),
          start: reflectPoint(port.frame.start, axis, origin),
          end: reflectPoint(port.frame.end, axis, origin),
          direction: normalize(reflectVector(port.frame.direction, axis)),
          normal: normalize(reflectVector(port.frame.normal, axis))
        }
      };
      return [mirroredName, mirrored];
    })
  );
}

function mirroredPortName(name: string, axis: MirrorAxis): string {
  if (axis !== "z") return name;
  return name
    .replace(/\bleft\b/i, "TEMP_SIDE")
    .replace(/\bright\b/i, "left")
    .replace(/TEMP_SIDE/i, "right")
    .replace(/Left/g, "TEMP_SIDE")
    .replace(/Right/g, "Left")
    .replace(/TEMP_SIDE/g, "Right");
}

export function boundsForTiles(tiles: TileInstance[]) {
  const vertices = tiles.flatMap((tile) => tileWorldVertices(tile));
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const zs = vertices.map((vertex) => vertex.z);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    depth: Math.max(...zs) - Math.min(...zs)
  };
}

function connectWedgeTiles(
  tiles: TileInstance[],
  id: string,
  deckLength: number,
  width: number,
  sideDeckEdge: number,
  includeFloor = false
): MagneticConnection[] {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  const connections: MagneticConnection[] = [];
  const left = byId.get(`${id}-left-side`)!;
  const right = byId.get(`${id}-right-side`)!;

  for (let lengthIndex = 1; lengthIndex <= deckLength; lengthIndex += 1) {
    const leftDeck = byId.get(`${id}-deck-${lengthIndex}-1`)!;
    const rightDeck = byId.get(`${id}-deck-${lengthIndex}-${width}`)!;
    connections.push(edgeConnection(left, sideDeckEdge, leftDeck, 0));
    connections.push(edgeConnection(right, sideDeckEdge, rightDeck, 2));

    for (let widthIndex = 2; widthIndex <= width; widthIndex += 1) {
      connections.push(edgeConnection(byId.get(`${id}-deck-${lengthIndex}-${widthIndex - 1}`)!, 2, byId.get(`${id}-deck-${lengthIndex}-${widthIndex}`)!, 0));
    }

    if (lengthIndex > 1) {
      for (let widthIndex = 1; widthIndex <= width; widthIndex += 1) {
        connections.push(edgeConnection(byId.get(`${id}-deck-${lengthIndex - 1}-${widthIndex}`)!, 1, byId.get(`${id}-deck-${lengthIndex}-${widthIndex}`)!, 3));
      }
    }
  }

  if (includeFloor) {
    for (let lengthIndex = 1; lengthIndex <= deckLength; lengthIndex += 1) {
      for (let widthIndex = 1; widthIndex <= width; widthIndex += 1) {
        if (lengthIndex > 1) {
          connections.push(edgeConnection(byId.get(`${id}-floor-${lengthIndex - 1}-${widthIndex}`)!, 1, byId.get(`${id}-floor-${lengthIndex}-${widthIndex}`)!, 3));
        }
        if (widthIndex > 1) {
          connections.push(edgeConnection(byId.get(`${id}-floor-${lengthIndex}-${widthIndex - 1}`)!, 2, byId.get(`${id}-floor-${lengthIndex}-${widthIndex}`)!, 0));
        }
      }
    }
  }

  return connections;
}

function connectByContact(macro: TileMacro): TileMacro {
  const connections: MagneticConnection[] = [...macro.connections];
  const connected = new Set(macro.connections.map((connection) => connection.toTileId));
  const seen = new Set(
    macro.connections.map((connection) => connectionKey(connection.fromTileId, connection.toTileId))
  );

  for (let index = 0; index < macro.tiles.length; index += 1) {
    const tile = macro.tiles[index];
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const parent = macro.tiles[candidateIndex];
      if (seen.has(connectionKey(parent.id, tile.id))) continue;
      const match = connectionWithMagneticEdges(parent, tile);
      if (!match) continue;
      connections.push(match);
      connected.add(tile.id);
      seen.add(connectionKey(parent.id, tile.id));
    }
  }

  const connectionByChild = new Map(connections.map((connection) => [connection.toTileId, connection]));
  return {
    tiles: macro.tiles.map((tile, index) => {
      const root = index === 0 || !connected.has(tile.id);
      if (root || tile.parentTileId) return { ...tile, root };
      const connection = connectionByChild.get(tile.id);
      return {
        ...tile,
        root,
        parentTileId: connection?.fromTileId,
        parentEdge: connection?.fromEdge,
        childEdge: connection?.toEdge,
        foldAngle: 0
      };
    }),
    connections,
    ports: macro.ports
  };
}

function connectionKey(firstId: string, secondId: string): string {
  return [firstId, secondId].sort().join("::");
}

function withAttachmentMetadata(tiles: TileInstance[], connections: MagneticConnection[]): TileInstance[] {
  return tiles.map((tile) => {
    if (tile.root || tile.parentTileId) return tile;
    const connection = connections.find((candidate) => candidate.toTileId === tile.id);
    if (!connection) return tile;
    return {
      ...tile,
      parentTileId: connection.fromTileId,
      parentEdge: connection.fromEdge,
      childEdge: connection.toEdge,
      foldAngle: 0,
      root: false
    };
  });
}

function edgeConnection(
  fromTile: TileInstance,
  fromEdge: number,
  toTile: TileInstance,
  toEdge: number
): MagneticConnection {
  return {
    fromTileId: fromTile.id,
    fromEdge,
    toTileId: toTile.id,
    toEdge,
    kind: "edge"
  };
}

function guardRailAttachEdge(shape: TileShape): number {
  if (shape === "right-triangle" || shape === "isosceles-triangle") return 1;
  return 0;
}

function edgeLength(shape: TileShape, edgeIndex: number): number {
  const vertices = tileLocalVertices(shape);
  return magnitude(subtract(vertices[(edgeIndex + 1) % vertices.length], vertices[edgeIndex]));
}

function edgeLengthClass(length: number): EdgeLengthClass {
  const classes: Array<{ edgeClass: EdgeLengthClass; length: number }> = [
    { edgeClass: "short", length: SMALL_EDGE },
    { edgeClass: "hyp", length: RIGHT_TRIANGLE_HYPOTENUSE },
    { edgeClass: "long", length: LARGE_EDGE },
    { edgeClass: "long", length: ISOSCELES_EQUAL_SIDE },
    { edgeClass: "xl", length: XL_SQUARE_EDGE }
  ];
  const match = classes.find((candidate) => Math.abs(candidate.length - length) <= 0.001);
  if (!match) throw new Error(`Unsupported magnetic edge length ${length.toFixed(5)}.`);
  return match.edgeClass;
}

function tileBasisAlongEdge(
  shape: TileShape,
  edgeIndex: number,
  targetStart: Vec3,
  targetDirection: Vec3,
  targetInterior: Vec3,
  preferredNormal: Vec3
): { position: Vec3; basis: TileBasis } {
  const vertices = tileLocalVertices(shape);
  const localStart = vertices[edgeIndex];
  const localEnd = vertices[(edgeIndex + 1) % vertices.length];
  const localDirection = normalize(subtract(localEnd, localStart));
  const thirdVertex = vertices[(edgeIndex + 2) % vertices.length];
  const localInterior = normalize(reject(subtract(thirdVertex, localStart), localDirection));
  const basis = {
    xAxis: normalize(add(scale(targetDirection, localDirection.x), scale(targetInterior, localInterior.x))),
    yAxis: normalize(add(scale(targetDirection, localDirection.y), scale(targetInterior, localInterior.y))),
    zAxis: normalize(cross(
      add(scale(targetDirection, localDirection.x), scale(targetInterior, localInterior.x)),
      add(scale(targetDirection, localDirection.y), scale(targetInterior, localInterior.y))
    ))
  };
  if (dot(basis.zAxis, preferredNormal) < 0) {
    basis.zAxis = scale(basis.zAxis, -1);
  }
  const transformedLocalStart = add(scale(basis.xAxis, localStart.x), scale(basis.yAxis, localStart.y));
  return {
    position: subtract(targetStart, transformedLocalStart),
    basis
  };
}

function sideGeometry(shape: WedgePrismParams["sideShape"]): SideGeometry {
  const localVertices = tileLocalVertices(shape!);
  if (shape === "right-triangle") {
    const shortLeg = TILE_SPECS["right-triangle"].width;
    const longLeg = TILE_SPECS["right-triangle"].height;
    return {
      localVertices,
      worldVertices: [
        { x: shortLeg, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: shortLeg, y: longLeg, z: 0 }
      ],
      deckEdge: 1,
      lowerDeckPoint: { x: 0, y: 0, z: 0 },
      upperDeckPoint: { x: shortLeg, y: longLeg, z: 0 }
    };
  }

  if (shape === "equilateral-triangle") {
    const height = TILE_SPECS["equilateral-triangle"].height;
    return {
      localVertices,
      worldVertices: [
        { x: EDGE, y: 0, z: 0 },
        { x: EDGE / 2, y: height, z: 0 },
        { x: 0, y: 0, z: 0 }
      ],
      deckEdge: 1,
      lowerDeckPoint: { x: 0, y: 0, z: 0 },
      upperDeckPoint: { x: EDGE / 2, y: height, z: 0 }
    };
  }

  const height = TILE_SPECS["isosceles-triangle"].height;
  return {
      localVertices,
      worldVertices: [
        { x: EDGE * 2, y: 0, z: 0 },
        { x: EDGE * 1.75, y: height / 2, z: 0 },
        { x: 0, y: 0, z: 0 }
      ],
    deckEdge: 1,
    lowerDeckPoint: { x: 0, y: 0, z: 0 },
    upperDeckPoint: { x: EDGE * 1.75, y: height / 2, z: 0 }
  };
}

function sideTileBasis(geometry: SideGeometry): { position: Vec3; basis: TileBasis } {
  const localStart = geometry.localVertices[geometry.deckEdge];
  const localEnd = geometry.localVertices[(geometry.deckEdge + 1) % geometry.localVertices.length];
  const worldStart = geometry.worldVertices[geometry.deckEdge];
  const worldEnd = geometry.worldVertices[(geometry.deckEdge + 1) % geometry.worldVertices.length];
  const localDirection = normalize(subtract(localEnd, localStart));
  const worldDirection = normalize(subtract(worldEnd, worldStart));
  const cos = dot(localDirection, worldDirection);
  const sin = localDirection.x * worldDirection.y - localDirection.y * worldDirection.x;
  const basis = {
    xAxis: { x: cos, y: sin, z: 0 },
    yAxis: { x: -sin, y: cos, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 }
  };
  const rotatedLocalStart = add(scale(basis.xAxis, localStart.x), scale(basis.yAxis, localStart.y));
  return {
    position: subtract(worldStart, rotatedLocalStart),
    basis
  };
}

function makeTriangleTileFromWorldPoints(params: {
  id: string;
  shape: "equilateral-triangle" | "right-triangle" | "isosceles-triangle";
  color: string;
  baseStart: Vec3;
  baseEnd: Vec3;
  apex: Vec3;
  normalOffset?: number;
  frame: MacroFrame;
  step: number;
  role: string;
  subassemblyId: string;
  root?: boolean;
}): TileInstance {
  const spec = TILE_SPECS[params.shape];
  const baseMidpoint = scale(add(params.baseStart, params.baseEnd), 0.5);
  const baseAxis = normalize(subtract(params.baseEnd, params.baseStart));
  const apexAxis = normalize(subtract(params.apex, baseMidpoint));
  const normal = normalize(cross(baseAxis, apexAxis));
  return makeTile({
    id: params.id,
    shape: params.shape,
    color: params.color,
    localPosition: add(add(baseMidpoint, scale(apexAxis, spec.height / 2)), scale(normal, params.normalOffset ?? 0)),
    localBasis: {
      xAxis: baseAxis,
      yAxis: apexAxis,
      zAxis: normal
    },
    frame: params.frame,
    step: params.step,
    role: params.role,
    subassemblyId: params.subassemblyId,
    root: params.root
  });
}

function makeTile(params: {
  id: string;
  shape: TileShape;
  color: string;
  localPosition: Vec3;
  localBasis: TileBasis;
  frame: MacroFrame;
  step: number;
  role: string;
  subassemblyId: string;
  root?: boolean;
  parentTileId?: string;
  parentEdge?: number;
  childEdge?: number;
  foldAngle?: number;
}): TileInstance {
  return {
    id: params.id,
    shape: params.shape,
    color: params.color,
    position: transformPoint(params.localPosition, params.frame),
    rotation: { x: 0, y: 0, z: 0 },
    basis: transformBasis(params.localBasis, params.frame),
    step: params.step,
    role: params.role,
    subassemblyId: params.subassemblyId,
    root: params.root,
    parentTileId: params.parentTileId,
    parentEdge: params.parentEdge,
    childEdge: params.childEdge,
    foldAngle: params.foldAngle
  };
}

function frameFromOrientation(origin: Vec3 = { x: 0, y: 0, z: 0 }, facing: MacroOrientation = "east"): MacroFrame {
  const forward = normalize(facingVector(facing));
  return {
    origin,
    forward,
    right: { x: -forward.z, y: 0, z: forward.x },
    up: { x: 0, y: 1, z: 0 }
  };
}

function facingVector(facing: MacroOrientation): Vec3 {
  if (typeof facing === "number") return { x: Math.cos(facing), y: 0, z: Math.sin(facing) };
  if (typeof facing === "object") return { x: facing.x, y: 0, z: facing.z };
  if (facing === "west") return { x: -1, y: 0, z: 0 };
  if (facing === "north") return { x: 0, y: 0, z: -1 };
  if (facing === "south") return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

function transformPoint(point: Vec3, frame: MacroFrame): Vec3 {
  return add(add(add(frame.origin, scale(frame.forward, point.x)), scale(frame.up, point.y)), scale(frame.right, point.z));
}

function transformBasis(basis: TileBasis, frame: MacroFrame): TileBasis {
  return {
    xAxis: normalize(transformVector(basis.xAxis, frame)),
    yAxis: normalize(transformVector(basis.yAxis, frame)),
    zAxis: normalize(transformVector(basis.zAxis, frame))
  };
}

function transformVector(vector: Vec3, frame: MacroFrame): Vec3 {
  return add(add(scale(frame.forward, vector.x), scale(frame.up, vector.y)), scale(frame.right, vector.z));
}

function horizontalBasis(): TileBasis {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 0, y: -1, z: 0 }
  };
}

function identityBasis(): TileBasis {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 }
  };
}

function tileEdge(tile: TileInstance, edgeIndex: number): { start: Vec3; end: Vec3 } {
  const vertices = tileWorldVertices(tile);
  return {
    start: vertices[edgeIndex],
    end: vertices[(edgeIndex + 1) % vertices.length]
  };
}

interface OrthonormalFrame {
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
}

function frameFromEdge(start: Vec3, end: Vec3, normal: Vec3): OrthonormalFrame {
  const xAxis = normalize(subtract(end, start));
  const zAxis = normalize(normal);
  const yAxis = normalize(cross(zAxis, xAxis));
  return { xAxis, yAxis, zAxis };
}

function transformTileBetweenFrames(
  tile: TileInstance,
  sourceFrame: OrthonormalFrame,
  targetFrame: OrthonormalFrame,
  sourceOrigin: Vec3,
  targetOrigin: Vec3
): TileInstance {
  return {
    ...tile,
    position: add(targetOrigin, transformVectorBetweenFrames(subtract(tile.position, sourceOrigin), sourceFrame, targetFrame)),
    basis: {
      xAxis: normalize(transformVectorBetweenFrames(tile.basis?.xAxis ?? { x: 1, y: 0, z: 0 }, sourceFrame, targetFrame)),
      yAxis: normalize(transformVectorBetweenFrames(tile.basis?.yAxis ?? { x: 0, y: 1, z: 0 }, sourceFrame, targetFrame)),
      zAxis: normalize(transformVectorBetweenFrames(tile.basis?.zAxis ?? { x: 0, y: 0, z: 1 }, sourceFrame, targetFrame))
    }
  };
}

function transformVectorBetweenFrames(vector: Vec3, sourceFrame: OrthonormalFrame, targetFrame: OrthonormalFrame): Vec3 {
  const x = dot(vector, sourceFrame.xAxis);
  const y = dot(vector, sourceFrame.yAxis);
  const z = dot(vector, sourceFrame.zAxis);
  return add(add(scale(targetFrame.xAxis, x), scale(targetFrame.yAxis, y)), scale(targetFrame.zAxis, z));
}

function rotateAroundAxis(point: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(add(scale(point, cos), scale(cross(unit, point), sin)), scale(unit, dot(unit, point) * (1 - cos)));
}

function reflectPoint(point: Vec3, axis: MirrorAxis, origin: number): Vec3 {
  return axis === "x" ? { ...point, x: origin - (point.x - origin) } : { ...point, z: origin - (point.z - origin) };
}

function reflectBasis(basis: TileBasis, axis: MirrorAxis): TileBasis {
  const reflect = (vector: Vec3) => (axis === "x" ? { ...vector, x: -vector.x } : { ...vector, z: -vector.z });
  return {
    xAxis: reflect(basis.xAxis),
    yAxis: reflect(basis.yAxis),
    zAxis: reflect(basis.zAxis)
  };
}

function reflectVector(point: Vec3, axis: MirrorAxis): Vec3 {
  return axis === "x" ? { ...point, x: -point.x } : { ...point, z: -point.z };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function tileById(macro: TileMacro, tileId: string): TileInstance {
  const tile = macro.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) throw new Error(`Missing tile ${tileId}`);
  return tile;
}

function horizontalFoldAngle(normal: Vec3): number {
  return Math.atan2(normal.x, -normal.y);
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

function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  };
}

function reject(point: Vec3, axis: Vec3): Vec3 {
  return subtract(point, scale(axis, dot(point, axis)));
}

function magnitude(point: Vec3): number {
  return Math.sqrt(dot(point, point));
}

function normalize(point: Vec3): Vec3 {
  const length = magnitude(point);
  return length <= 0.000001 ? { x: 0, y: 0, z: 0 } : scale(point, 1 / length);
}
