import { TILE_SPECS, TILE_THICKNESS } from "./catalog";
import { attachTile, basisFromEuler, makeAnchorTile, type EdgePlacedTile } from "./edge-attachment";
import { connectionWithMagneticEdges, tileWorldVertices } from "./magnet-geometry";
import { compileBuildRecipe } from "./recipe-compiler";
import { arbitraryFold, box, composeMacros, gableRoof, openBox, radialFan, rocketFinBase, squarePyramid, tilePrimitive } from "./macros";
import { JET_AIRCRAFT_RECIPE } from "./recipes/jet-aircraft";
import { LARGE_CAR_RAMP_RECIPE, MEDIUM_CAR_RAMP_RECIPE, SMALL_CAR_RAMP_RECIPE } from "./recipes/small-car-ramp";
import type {
  BuildBounds,
  BuildFamily,
  BuildGraph,
  MagneticConnection,
  PromptProfile,
  Rotation,
  TileBasis,
  TileInstance,
  TileShape,
  Vec3
} from "./types";

interface TileDraft {
  sourceKey?: string;
  shape: TileShape;
  x: number;
  y: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  basis?: TileBasis;
  color?: string;
  step: number;
  role: string;
  subassemblyId?: string;
  parentTileId?: string;
  parentEdge?: number;
  childEdge?: number;
  foldAngle?: number;
  root?: boolean;
}

const DEPTH = 1.58;
const PANEL_THICKNESS = TILE_THICKNESS;
const WING_FOLD = Math.PI * 0.36;

export function generateTemplate(prompt: string, profile: PromptProfile): BuildGraph {
  const recipeBuild = compiledRecipeFor(profile);
  if (recipeBuild) {
    return {
      id: `build-${profile.seed.toString(36)}`,
      prompt,
      title: profile.title,
      family: profile.family,
      seed: profile.seed,
      summary: summaryFor(profile, recipeBuild.tiles.length),
      tiles: recipeBuild.tiles,
      connections: recipeBuild.connections,
      bounds: calculateBounds(recipeBuild.tiles)
    };
  }

  const drafts = familyDrafts(profile);
  const tiles = drafts.map((draft, index) => toTile(draft, index, profile));
  const connections = inferConnections(tiles);
  const bounds = calculateBounds(tiles);

  return {
    id: `build-${profile.seed.toString(36)}`,
    prompt,
    title: profile.title,
    family: profile.family,
    seed: profile.seed,
    summary: summaryFor(profile, tiles.length),
    tiles,
    connections,
    bounds
  };
}

function compiledRecipeFor(profile: PromptProfile) {
  if (profile.family === "aircraft") {
    return compileBuildRecipe(JET_AIRCRAFT_RECIPE);
  }

  if (profile.family === "ramp" && profile.size === "small") {
    return compileBuildRecipe(SMALL_CAR_RAMP_RECIPE);
  }

  if (profile.family === "ramp" && profile.size === "tall") {
    return compileBuildRecipe(LARGE_CAR_RAMP_RECIPE);
  }

  if (profile.family === "ramp") {
    return compileBuildRecipe(MEDIUM_CAR_RAMP_RECIPE);
  }

  if (profile.family === "castle") {
    return composeMacros(
      box({
        id: "castle-keep",
        width: 2,
        height: 1,
        depth: 2,
        openFaces: ["top", "bottom"],
        color: profile.palette[2] ?? "#8ecae6",
        stepStart: 1,
        subassemblyId: "castle-keep"
      }),
      box({
        id: "castle-tower-nw",
        width: 1,
        height: 2,
        depth: 1,
        openFaces: ["top", "bottom"],
        origin: { x: -3.18, y: 0, z: -3.18 },
        color: profile.palette[0] ?? "#118ab2",
        stepStart: 2,
        subassemblyId: "castle-tower-nw"
      }),
      box({
        id: "castle-tower-ne",
        width: 1,
        height: 2,
        depth: 1,
        openFaces: ["top", "bottom"],
        origin: { x: 6.18, y: 0, z: -3.18 },
        color: profile.palette[0] ?? "#118ab2",
        stepStart: 2,
        subassemblyId: "castle-tower-ne"
      }),
      box({
        id: "castle-tower-sw",
        width: 1,
        height: 2,
        depth: 1,
        openFaces: ["top", "bottom"],
        origin: { x: -3.18, y: 0, z: 6.18 },
        color: profile.palette[0] ?? "#118ab2",
        stepStart: 2,
        subassemblyId: "castle-tower-sw"
      }),
      box({
        id: "castle-tower-se",
        width: 1,
        height: 2,
        depth: 1,
        openFaces: ["top", "bottom"],
        origin: { x: 6.18, y: 0, z: 6.18 },
        color: profile.palette[0] ?? "#118ab2",
        stepStart: 2,
        subassemblyId: "castle-tower-se"
      }),
      squarePyramid({
        id: "castle-cap-nw",
        origin: { x: -3.18, y: 6, z: -3.18 },
        color: profile.palette[1] ?? "#ffb703",
        stepStart: 4,
        subassemblyId: "castle-cap-nw"
      }),
      squarePyramid({
        id: "castle-cap-ne",
        origin: { x: 6.18, y: 6, z: -3.18 },
        color: profile.palette[1] ?? "#ffb703",
        stepStart: 4,
        subassemblyId: "castle-cap-ne"
      }),
      squarePyramid({
        id: "castle-cap-sw",
        origin: { x: -3.18, y: 6, z: 6.18 },
        color: profile.palette[1] ?? "#ffb703",
        stepStart: 4,
        subassemblyId: "castle-cap-sw"
      }),
      squarePyramid({
        id: "castle-cap-se",
        origin: { x: 6.18, y: 6, z: 6.18 },
        color: profile.palette[1] ?? "#ffb703",
        stepStart: 4,
        subassemblyId: "castle-cap-se"
      })
    );
  }

  if (profile.family === "house") {
    return composeMacros(
      openBox({
        id: "house-body",
        width: 1,
        height: 1,
        depth: 1,
        openFaces: ["front", "top"],
        color: profile.palette[2] ?? "#8ecae6",
        stepStart: 1,
        subassemblyId: "house-body"
      }),
      gableRoof({
        id: "house-roof",
        origin: { x: 0, y: 3, z: 0 },
        stepStart: 2,
        subassemblyId: "house-roof",
        colors: {
          roof: profile.palette[0] ?? "#d62828",
          gable: profile.palette[1] ?? "#ffb703"
        }
      })
    );
  }

  if (profile.family === "rocket") {
    return composeMacros(
      rocketFinBase({
        id: "rocket-base",
        stepStart: 1,
        subassemblyId: "rocket-base",
        colors: {
          base: profile.palette[2] ?? "#118ab2",
          fin: profile.palette[1] ?? "#ffb703"
        }
      }),
      box({
        id: "rocket-body",
        width: 1,
        height: 2,
        depth: 1,
        openFaces: ["bottom", "top"],
        color: profile.palette[0] ?? "#8ecae6",
        stepStart: 3,
        subassemblyId: "rocket-body"
      }),
      squarePyramid({
        id: "rocket-nose",
        origin: { x: 0, y: 6, z: 0 },
        color: profile.palette[3] ?? "#ef476f",
        stepStart: 5,
        subassemblyId: "rocket-nose"
      })
    );
  }

  if (profile.family === "animal" && profile.title === "Snail") {
    return snailMacroBuild(profile.palette);
  }

  return null;
}

function snailMacroBuild(palette: string[]) {
  const footTiles = [];
  const xs = Array.from({ length: 7 }, (_, index) => (index - 3) * 3);
  const zs = [-3, 0, 3];
  for (let zIndex = 0; zIndex < zs.length; zIndex += 1) {
    for (let xIndex = 0; xIndex < xs.length; xIndex += 1) {
      footTiles.push(
        tilePrimitive({
          id: `snail-foot-${xIndex + 1}-${zIndex + 1}`,
          shape: "small-square",
          plane: "horizontal",
          origin: { x: xs[xIndex], y: 0, z: zs[zIndex] },
          stepStart: 1,
          subassemblyId: "snail-foot",
          color: palette[2] ?? "#06d6a0",
          role: "snail horizontal foot slab square"
        })
      );
    }
  }

  let build = composeMacros(...footTiles);
  build = arbitraryFold(
    build,
    "snail-foot-4-2.top",
    radialFan({
      id: "snail-shell",
      segments: 11,
      stepStart: 2,
      subassemblyId: "snail-shell",
      color: palette[4] ?? "#7b2cbf"
    }),
    "baseEdge",
    -Math.PI / 2
  );
  build = arbitraryFold(
    build,
    "snail-shell.rim2",
    tilePrimitive({
      id: "snail-shell-brace-left",
      shape: "small-square",
      stepStart: 13,
      subassemblyId: "snail-shell-braces",
      color: palette[1] ?? "#ffb703",
      role: "snail shell left stabilizing square"
    }),
    "bottom",
    Math.PI / 2
  );
  build = arbitraryFold(
    build,
    "snail-shell.rim11",
    tilePrimitive({
      id: "snail-shell-brace-right",
      shape: "small-square",
      stepStart: 13,
      subassemblyId: "snail-shell-braces",
      color: palette[1] ?? "#ffb703",
      role: "snail shell right stabilizing square"
    }),
    "bottom",
    -Math.PI / 2
  );
  build = composeMacros(
    build,
    box({
      id: "snail-head",
      width: 1,
      height: 1,
      depth: 1,
      origin: { x: -13.68, y: 0, z: -1.5 },
      stepStart: 14,
      subassemblyId: "snail-head",
      color: palette[0] ?? "#ef476f"
    })
  );
  build = arbitraryFold(
    build,
    "snail-head.topFrontEdge",
    tilePrimitive({
      id: "snail-antenna",
      shape: "equilateral-triangle",
      stepStart: 15,
      subassemblyId: "snail-head",
      color: palette[1] ?? "#ffb703",
      role: "snail triangular antenna point"
    }),
    "base",
    -Math.PI / 2
  );
  build = arbitraryFold(
    build,
    "snail-foot-3-2.top",
    tilePrimitive({
      id: "snail-neck",
      shape: "right-triangle",
      stepStart: 14,
      subassemblyId: "snail-head",
      color: palette[3] ?? "#8ecae6",
      role: "snail angled right-triangle neck support"
    }),
    "legB",
    -Math.PI / 2
  );

  return composeMacros(build);
}

function familyDrafts(profile: PromptProfile): TileDraft[] {
  switch (profile.family) {
    case "castle":
      return castleDrafts(profile);
    case "house":
      return houseDrafts(profile);
    case "tower":
      return towerDrafts(profile);
    case "bridge":
      return bridgeDrafts(profile);
    case "rocket":
      return rocketDrafts(profile);
    case "animal":
      return animalDrafts(profile);
    case "aircraft":
      return aircraftDrafts(profile);
    case "ramp":
      return rampDrafts(profile);
  }
}

function castleDrafts(profile: PromptProfile): TileDraft[] {
  const tall = profile.size === "tall";
  const drafts: TileDraft[] = [];
  const columns = tall ? [-6, -3, 0, 3, 6] : [-4.5, -1.5, 1.5, 4.5];
  const levels = tall ? 3 : 2;

  for (let level = 0; level < levels; level += 1) {
    columns.forEach((x) => {
      drafts.push({
        shape: "small-square",
        x,
        y: 1.5 + level * 3,
        step: level + 1,
        role: level === 0 ? "front wall base" : "stacked wall"
      });
    });
  }

  columns.forEach((x, index) => {
    drafts.push({
      shape: index % 2 === 0 ? "equilateral-triangle" : "isosceles-triangle",
      x,
      y: 1.5 + levels * 3,
      rz: index % 2 === 0 ? 0 : Math.PI,
      step: levels + 1,
      role: "roof flags"
    });
  });

  drafts.push(
    { shape: "small-square", x: -7.5, y: 1.5, z: -DEPTH, ry: Math.PI / 2, step: 2, role: "left side return" },
    { shape: "small-square", x: 7.5, y: 1.5, z: -DEPTH, ry: Math.PI / 2, step: 2, role: "right side return" },
    { shape: "right-triangle", x: -1.5, y: 1.5, z: 0.35, step: 1, role: "door brace" },
    { shape: "right-triangle", x: 1.5, y: 1.5, z: 0.35, rz: Math.PI / 2, step: 1, role: "door brace" }
  );

  return drafts;
}

function houseDrafts(profile: PromptProfile): TileDraft[] {
  const garage = profile.accents.includes("wide door");
  const drafts: TileDraft[] = [
    { shape: "large-square", x: -3, y: 3, step: 1, role: garage ? "garage wall" : "front wall" },
    { shape: "large-square", x: 3, y: 3, step: 1, role: "front wall" },
    { shape: "small-square", x: -7.5, y: 1.5, z: -DEPTH, ry: Math.PI / 2, step: 2, role: "left side wall" },
    { shape: "small-square", x: 7.5, y: 1.5, z: -DEPTH, ry: Math.PI / 2, step: 2, role: "right side wall" },
    { shape: "small-square", x: -4.5, y: 7.5, step: 3, role: "upper wall" },
    { shape: "small-square", x: -1.5, y: 7.5, step: 3, role: "upper wall" },
    { shape: "small-square", x: 1.5, y: 7.5, step: 3, role: "upper wall" },
    { shape: "small-square", x: 4.5, y: 7.5, step: 3, role: "upper wall" },
    { shape: "isosceles-triangle", x: -3, y: 11.1, rz: 0, step: 4, role: "left roof" },
    { shape: "isosceles-triangle", x: 3, y: 11.1, rz: 0, step: 4, role: "right roof" },
    { shape: "equilateral-triangle", x: 0, y: 12.8, step: 4, role: "roof peak" }
  ];

  if (garage) {
    drafts.push(
      { shape: "right-triangle", x: -1.5, y: 1.5, step: 1, role: "door opening brace" },
      { shape: "right-triangle", x: 1.5, y: 1.5, rz: Math.PI / 2, step: 1, role: "door opening brace" }
    );
  }

  return drafts;
}

function towerDrafts(profile: PromptProfile): TileDraft[] {
  const levels = profile.size === "tall" ? 5 : 4;
  const drafts: TileDraft[] = [];

  for (let level = 0; level < levels; level += 1) {
    drafts.push(
      { shape: "small-square", x: -1.5, y: 1.5 + level * 3, step: level + 1, role: "left tower wall" },
      { shape: "small-square", x: 1.5, y: 1.5 + level * 3, step: level + 1, role: "right tower wall" }
    );
    if (level < 3) {
      drafts.push(
        { shape: "small-square", x: -3, y: 1.5 + level * 3, z: -DEPTH, ry: Math.PI / 2, step: level + 1, role: "side stabilizer" },
        { shape: "small-square", x: 3, y: 1.5 + level * 3, z: -DEPTH, ry: Math.PI / 2, step: level + 1, role: "side stabilizer" }
      );
    }
  }

  drafts.push(
    { shape: "isosceles-triangle", x: -1.5, y: 1.5 + levels * 3, step: levels + 1, role: "tower cap" },
    { shape: "isosceles-triangle", x: 1.5, y: 1.5 + levels * 3, step: levels + 1, role: "tower cap" }
  );

  return drafts;
}

function bridgeDrafts(profile: PromptProfile): TileDraft[] {
  const wide = profile.size === "wide";
  const span = wide ? [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5] : [-4.5, -1.5, 1.5, 4.5];
  const drafts: TileDraft[] = [];

  span.forEach((x) => {
    drafts.push({ shape: "small-square", x, y: 1.5, step: 1, role: "bridge deck" });
  });

  [-7.5, 7.5].forEach((x) => {
    drafts.push(
      { shape: "small-square", x, y: 4.5, step: 2, role: "bridge pillar" },
      { shape: "small-square", x, y: 7.5, step: 2, role: "bridge pillar" },
      { shape: "right-triangle", x: x - Math.sign(x) * 1.5, y: 4.5, step: 3, role: "arch brace" }
    );
  });

  span.slice(1, -1).forEach((x, index) => {
    drafts.push({
      shape: index % 2 === 0 ? "equilateral-triangle" : "right-triangle",
      x,
      y: 4.5,
      step: 3,
      role: "arch detail"
    });
  });

  return drafts;
}

function rocketDrafts(profile: PromptProfile): TileDraft[] {
  const tall = profile.size === "tall";
  const levels = tall ? 4 : 3;
  const drafts: TileDraft[] = [];

  for (let level = 0; level < levels; level += 1) {
    drafts.push(
      { shape: "small-square", x: -1.5, y: 1.5 + level * 3, step: level + 1, role: "rocket body" },
      { shape: "small-square", x: 1.5, y: 1.5 + level * 3, step: level + 1, role: "rocket body" }
    );
  }

  drafts.push(
    { shape: "isosceles-triangle", x: 0, y: 1.5 + levels * 3, step: levels + 1, role: "nose cone" },
    { shape: "right-triangle", x: -4.5, y: 1.5, rz: Math.PI / 2, step: 1, role: "left fin" },
    { shape: "right-triangle", x: 4.5, y: 1.5, rz: -Math.PI / 2, step: 1, role: "right fin" },
    { shape: "equilateral-triangle", x: -1.5, y: -1.1, rz: Math.PI, step: 1, role: "flame" },
    { shape: "equilateral-triangle", x: 1.5, y: -1.1, rz: Math.PI, step: 1, role: "flame" },
    { shape: "small-square", x: -4.5, y: 4.5, z: -DEPTH, ry: Math.PI / 2, step: 2, role: "left stabilizer" },
    { shape: "small-square", x: 4.5, y: 4.5, z: -DEPTH, ry: Math.PI / 2, step: 2, role: "right stabilizer" }
  );

  return drafts;
}

function animalDrafts(profile: PromptProfile): TileDraft[] {
  const dinosaur = profile.title.toLowerCase().includes("dinosaur");
  const drafts: TileDraft[] = [
    { shape: "small-square", x: -3, y: 1.5, step: 1, role: "body" },
    { shape: "small-square", x: 0, y: 1.5, step: 1, role: "body" },
    { shape: "small-square", x: 3, y: 1.5, step: 1, role: "body" },
    { shape: "small-square", x: 6, y: 1.5, step: 2, role: "head" },
    { shape: "equilateral-triangle", x: 6, y: 4.1, step: 2, role: dinosaur ? "head crest" : "ear" },
    { shape: "right-triangle", x: -6, y: 2, rz: Math.PI, step: 3, role: "tail" },
    { shape: "right-triangle", x: -1.5, y: -1.1, rz: Math.PI, step: 1, role: "front leg" },
    { shape: "right-triangle", x: 3, y: -1.1, rz: Math.PI, step: 1, role: "back leg" }
  ];

  if (dinosaur) {
    drafts.push(
      { shape: "equilateral-triangle", x: -3, y: 4.1, step: 3, role: "back spike" },
      { shape: "equilateral-triangle", x: 0, y: 4.1, step: 3, role: "back spike" },
      { shape: "equilateral-triangle", x: 3, y: 4.1, step: 3, role: "back spike" }
    );
  } else {
    drafts.push(
      { shape: "equilateral-triangle", x: 7.5, y: 4.1, step: 2, role: "second ear" },
      { shape: "small-square", x: -3, y: 1.5, z: -DEPTH, ry: Math.PI / 2, step: 1, role: "body stand" },
      { shape: "small-square", x: 3, y: 1.5, z: -DEPTH, ry: Math.PI / 2, step: 1, role: "body stand" }
    );
  }

  return drafts;
}

function aircraftDrafts(profile: PromptProfile): TileDraft[] {
  const edge = TILE_SPECS["small-square"].edgeLength;
  const half = edge / 2;
  const triangleHeight = TILE_SPECS["equilateral-triangle"].height;
  const isoscelesHeight = TILE_SPECS["isosceles-triangle"].height;
  const lowerY = half;
  const upperY = edge + half;
  const wingY = edge + PANEL_THICKNESS / 2;
  const roofY = edge * 2 + PANEL_THICKNESS / 2;
  const frontZ = -half;
  const rearZ = half;
  const centerZ = 0;
  const sideX = edge;
  const noseBaseZ = frontZ - triangleHeight / 2;
  const noseTipZ = frontZ - edge - triangleHeight / 2;
  const tailZ = rearZ + edge / 2;
  const tailTipZ = rearZ + edge * 1.1;
  const wingInnerX = edge + half;
  const wingTipX = edge * 2 + triangleHeight / 2;
  const shoulderX = sideX;
  const braceX = edge + half + 0.15;
  const verticalTailY = roofY + isoscelesHeight / 2;
  const topFinY = roofY + isoscelesHeight / 2;
  const blue = "#118ab2";
  const yellow = "#ffb703";
  const red = "#ef476f";
  const green = "#06d6a0";
  const purple = "#7b2cbf";
  const smoke = "#d8dee2";
  const orange = "#f7b733";
  const darkBlue = "#0b5f8a";
  const glass = "#8ecae6";
  const horizontal = Math.PI / 2;
  const frontLowerLeft = makeAnchorTile(
    "front-lower-left",
    "small-square",
    { x: -half, y: lowerY, z: frontZ },
    undefined,
    1,
    "front lower fuselage wall",
    red
  );
  const frontLowerRight = attachTile(frontLowerLeft, {
    key: "front-lower-right",
    shape: "small-square",
    attachTo: frontLowerLeft.key,
    parentEdge: 1,
    childEdge: 3,
    foldAngle: 0,
    reverse: true,
    color: red,
    step: 1,
    role: "front lower fuselage wall"
  });
  const rearLowerLeft = makeAnchorTile(
    "rear-lower-left",
    "small-square",
    { x: -half, y: lowerY, z: rearZ },
    undefined,
    1,
    "rear lower fuselage wall",
    purple
  );
  const rearLowerRight = attachTile(rearLowerLeft, {
    key: "rear-lower-right",
    shape: "small-square",
    attachTo: rearLowerLeft.key,
    parentEdge: 1,
    childEdge: 3,
    foldAngle: 0,
    reverse: true,
    color: purple,
    step: 1,
    role: "rear lower fuselage wall"
  });
  const frontUpperLeft = makeAnchorTile(
    "front-upper-left",
    "small-square",
    { x: -half, y: upperY, z: frontZ },
    undefined,
    2,
    "front upper fuselage wall",
    yellow
  );
  const frontUpperRight = attachTile(frontUpperLeft, {
    key: "front-upper-right",
    shape: "small-square",
    attachTo: frontUpperLeft.key,
    parentEdge: 1,
    childEdge: 3,
    foldAngle: 0,
    reverse: true,
    color: yellow,
    step: 2,
    role: "front upper fuselage wall"
  });
  const topDeckLeft = makeAnchorTile(
    "top-deck-left",
    "small-square",
    { x: -half, y: roofY, z: centerZ },
    basisFromEuler(horizontal),
    2,
    "left top deck panel",
    yellow
  );
  const topDeckRight = attachTile(topDeckLeft, {
    key: "top-deck-right",
    shape: "small-square",
    attachTo: topDeckLeft.key,
    parentEdge: 1,
    childEdge: 3,
    foldAngle: 0,
    reverse: true,
    color: yellow,
    step: 2,
    role: "right top deck panel"
  });
  const leftWing = attachTile(topDeckLeft, {
    key: "left-wing",
    shape: "small-square",
    attachTo: topDeckLeft.key,
    parentEdge: 3,
    childEdge: 1,
    foldAngle: 0,
    reverse: true,
    color: blue,
    step: 4,
    role: "left inner wing panel"
  });
  const rightWing = attachTile(topDeckRight, {
    key: "right-wing",
    shape: "small-square",
    attachTo: topDeckRight.key,
    parentEdge: 1,
    childEdge: 3,
    foldAngle: 0,
    reverse: true,
    color: blue,
    step: 4,
    role: "right inner wing panel"
  });
  const leftWingTip = attachTile(leftWing, {
    key: "left-wing-tip",
    shape: "equilateral-triangle",
    attachTo: leftWing.key,
    parentEdge: 3,
    childEdge: 1,
    foldAngle: 0,
    reverse: true,
    color: blue,
    step: 4,
    role: "left pointed wing tip"
  });
  const rightWingTip = attachTile(rightWing, {
    key: "right-wing-tip",
    shape: "equilateral-triangle",
    attachTo: rightWing.key,
    parentEdge: 1,
    childEdge: 2,
    foldAngle: 0,
    reverse: true,
    color: blue,
    step: 4,
    role: "right pointed wing tip"
  });
  const leftNosePanel = attachTile(topDeckLeft, {
    key: "left-nose-panel",
    shape: "equilateral-triangle",
    attachTo: topDeckLeft.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: glass,
    step: 3,
    role: "left pointed nose panel"
  });
  const rightNosePanel = attachTile(topDeckRight, {
    key: "right-nose-panel",
    shape: "equilateral-triangle",
    attachTo: topDeckRight.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: glass,
    step: 3,
    role: "right pointed nose panel"
  });
  const leftNoseSideCheek = attachTile(frontLowerLeft, {
    key: "left-nose-side-cheek",
    shape: "right-triangle",
    attachTo: frontLowerLeft.key,
    parentEdge: 3,
    childEdge: 0,
    foldAngle: -horizontal,
    reverse: false,
    color: red,
    step: 3,
    role: "left nose side cheek"
  });
  const rightNoseSideCheek = attachTile(frontLowerRight, {
    key: "right-nose-side-cheek",
    shape: "right-triangle",
    attachTo: frontLowerRight.key,
    parentEdge: 1,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: red,
    step: 3,
    role: "right nose side cheek"
  });
  const leftFoldedNosePanel = attachTile(frontUpperLeft, {
    key: "left-folded-nose-panel",
    shape: "isosceles-triangle",
    attachTo: frontUpperLeft.key,
    parentEdge: 3,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: orange,
    step: 3,
    role: "left folded nose panel"
  });
  const rightFoldedNosePanel = attachTile(frontUpperRight, {
    key: "right-folded-nose-panel",
    shape: "isosceles-triangle",
    attachTo: frontUpperRight.key,
    parentEdge: 1,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: orange,
    step: 3,
    role: "right folded nose panel"
  });
  const leftWingShoulder = attachTile(leftWing, {
    key: "left-wing-shoulder",
    shape: "equilateral-triangle",
    attachTo: leftWing.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: red,
    step: 4,
    role: "left front wing shoulder"
  });
  const rightWingShoulder = attachTile(rightWing, {
    key: "right-wing-shoulder",
    shape: "equilateral-triangle",
    attachTo: rightWing.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: red,
    step: 4,
    role: "right front wing shoulder"
  });
  const leftAngledWingBrace = attachTile(leftWing, {
    key: "left-angled-wing-brace",
    shape: "right-triangle",
    attachTo: leftWing.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: orange,
    step: 4,
    role: "left angled wing brace"
  });
  const rightAngledWingBrace = attachTile(rightWing, {
    key: "right-angled-wing-brace",
    shape: "right-triangle",
    attachTo: rightWing.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: orange,
    step: 4,
    role: "right angled wing brace"
  });
  const leftTailPiece = attachTile(topDeckLeft, {
    key: "left-tail-piece",
    shape: "equilateral-triangle",
    attachTo: topDeckLeft.key,
    parentEdge: 2,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: red,
    step: 5,
    role: "left horizontal tail piece"
  });
  const rightTailPiece = attachTile(topDeckRight, {
    key: "right-tail-piece",
    shape: "equilateral-triangle",
    attachTo: topDeckRight.key,
    parentEdge: 2,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: red,
    step: 5,
    role: "right horizontal tail piece"
  });
  const leftRearTailPlane = attachTile(leftTailPiece, {
    key: "left-rear-tail-plane",
    shape: "right-triangle",
    attachTo: leftTailPiece.key,
    parentEdge: 2,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: purple,
    step: 5,
    role: "left rear tail plane"
  });
  const rightRearTailPlane = attachTile(rightTailPiece, {
    key: "right-rear-tail-plane",
    shape: "right-triangle",
    attachTo: rightTailPiece.key,
    parentEdge: 1,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: purple,
    step: 5,
    role: "right rear tail plane"
  });
  const rearTailSupport = attachTile(leftRearTailPlane, {
    key: "rear-tail-support",
    shape: "equilateral-triangle",
    attachTo: leftRearTailPlane.key,
    parentEdge: 1,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: smoke,
    step: 5,
    role: "rear tail support"
  });
  const verticalTailPanel = attachTile(rightTailPiece, {
    key: "vertical-tail-panel",
    shape: "isosceles-triangle",
    attachTo: rightTailPiece.key,
    parentEdge: 2,
    childEdge: 2,
    foldAngle: 0,
    reverse: true,
    color: purple,
    step: 5,
    role: "vertical tail panel"
  });
  const topFrontFin = attachTile(topDeckLeft, {
    key: "top-front-fin",
    shape: "isosceles-triangle",
    attachTo: topDeckLeft.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: -horizontal,
    reverse: false,
    color: green,
    step: 6,
    role: "green top front fin"
  });
  const leftTopAdjustmentPlate = attachTile(leftWingTip, {
    key: "left-top-adjustment-plate",
    shape: "right-triangle",
    attachTo: leftWingTip.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: smoke,
    step: 6,
    role: "left top adjustment plate"
  });
  const rightTopAdjustmentPlate = attachTile(rightWingTip, {
    key: "right-top-adjustment-plate",
    shape: "right-triangle",
    attachTo: rightWingTip.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: 0,
    reverse: true,
    color: smoke,
    step: 6,
    role: "right top adjustment plate"
  });
  const leftFrontAlignmentBrace = attachTile(leftWingShoulder, {
    key: "left-front-alignment-brace",
    shape: "right-triangle",
    attachTo: leftWingShoulder.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: false,
    color: orange,
    step: 6,
    role: "left front alignment brace"
  });
  const rightFrontAlignmentBrace = attachTile(rightWingShoulder, {
    key: "right-front-alignment-brace",
    shape: "right-triangle",
    attachTo: rightWingShoulder.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: false,
    color: orange,
    step: 6,
    role: "right front alignment brace"
  });
  const frontUpperNoseCap = attachTile(rightNosePanel, {
    key: "front-upper-nose-cap",
    shape: "isosceles-triangle",
    attachTo: rightNosePanel.key,
    parentEdge: 0,
    childEdge: 0,
    foldAngle: horizontal,
    reverse: true,
    color: red,
    step: 6,
    role: "front upper nose cap"
  });

  return [
    placedToDraft(frontLowerLeft),
    placedToDraft(frontLowerRight),
    placedToDraft(rearLowerLeft),
    placedToDraft(rearLowerRight),
    { shape: "small-square", x: -sideX, y: lowerY, z: centerZ, ry: horizontal, color: blue, step: 1, role: "left lower fuselage side wall" },
    { shape: "small-square", x: sideX, y: lowerY, z: centerZ, ry: horizontal, color: darkBlue, step: 1, role: "right lower fuselage side wall" },

    placedToDraft(frontUpperLeft),
    placedToDraft(frontUpperRight),
    { shape: "small-square", x: -half, y: upperY, z: rearZ, color: blue, step: 2, role: "rear upper fuselage wall" },
    { shape: "small-square", x: half, y: upperY, z: rearZ, color: blue, step: 2, role: "rear upper fuselage wall" },
    { shape: "small-square", x: -sideX, y: upperY, z: centerZ, ry: horizontal, color: blue, step: 2, role: "left upper fuselage side wall" },
    { shape: "small-square", x: sideX, y: upperY, z: centerZ, ry: horizontal, color: darkBlue, step: 2, role: "right upper fuselage side wall" },
    placedToDraft(topDeckLeft),
    placedToDraft(topDeckRight),

    placedToDraft(leftNosePanel),
    placedToDraft(rightNosePanel),
    placedToDraft(leftNoseSideCheek),
    placedToDraft(rightNoseSideCheek),
    placedToDraft(leftFoldedNosePanel),
    placedToDraft(rightFoldedNosePanel),

    placedToDraft(leftWing),
    placedToDraft(rightWing),
    placedToDraft(leftWingTip),
    placedToDraft(rightWingTip),
    placedToDraft(leftWingShoulder),
    placedToDraft(rightWingShoulder),
    placedToDraft(leftAngledWingBrace),
    placedToDraft(rightAngledWingBrace),

    placedToDraft(leftTailPiece),
    placedToDraft(rightTailPiece),
    placedToDraft(leftRearTailPlane),
    placedToDraft(rightRearTailPlane),
    placedToDraft(verticalTailPanel),
    placedToDraft(rearTailSupport),

    placedToDraft(topFrontFin),
    placedToDraft(leftTopAdjustmentPlate),
    placedToDraft(rightTopAdjustmentPlate),
    placedToDraft(leftFrontAlignmentBrace),
    placedToDraft(rightFrontAlignmentBrace),
    placedToDraft(frontUpperNoseCap)
  ];
}

function hingedPanel(
  shape: TileShape,
  hingeX: number,
  hingeY: number,
  angle: number,
  step: number,
  role: string,
  hingeEdge: "left" | "right" = "right"
): TileDraft {
  const halfWidth = TILE_SPECS[shape].width / 2;
  const edgeDirection = hingeEdge === "right" ? -1 : 1;

  return {
    shape,
    x: hingeX + edgeDirection * halfWidth * Math.cos(angle),
    y: hingeY,
    z: -edgeDirection * halfWidth * Math.sin(angle),
    ry: angle,
    step,
    role
  };
}

function placedToDraft(tile: EdgePlacedTile): TileDraft {
  return {
    sourceKey: tile.key,
    shape: tile.shape,
    x: tile.position.x,
    y: tile.position.y,
    z: tile.position.z,
    basis: tile.basis,
    color: tile.color,
    step: tile.step,
    role: tile.role,
    subassemblyId: tile.subassemblyId ?? subassemblyForRole(tile.role),
    parentTileId: tile.parentTileId,
    parentEdge: tile.parentEdge,
    childEdge: tile.childEdge,
    foldAngle: tile.foldAngle,
    root: tile.root
  };
}

function subassemblyForRole(role: string): string {
  if (/nose/i.test(role)) return "nose";
  if (/wing/i.test(role)) return "wings";
  if (/tail/i.test(role)) return "tail";
  if (/fin/i.test(role)) return "top-fin";
  if (/deck|fuselage|body/i.test(role)) return "body";
  return "details";
}

function rampDrafts(profile: PromptProfile): TileDraft[] {
  if (profile.size === "small") return smallRampDrafts();
  if (profile.size === "tall") return largeRampDrafts();
  return mediumRampDrafts();
}

function smallRampDrafts(): TileDraft[] {
  return [
    { shape: "small-square", x: -4.5, y: 1.5, step: 1, role: "low ramp floor" },
    { shape: "right-triangle", x: -1.5, y: 1.5, step: 1, role: "left wedge side" },
    { shape: "right-triangle", x: 1.5, y: 1.5, rz: Math.PI / 2, step: 1, role: "right wedge side" },
    { shape: "small-square", x: 0, y: 4.5, rz: Math.PI / 8, step: 2, role: "sloped ramp driving surface" },
    { shape: "small-square", x: 3, y: 4.5, step: 3, role: "top landing support" },
    { shape: "small-square", x: 6, y: 4.5, step: 3, role: "top landing support" },
    { shape: "isosceles-triangle", x: 4.5, y: 8.1, step: 4, role: "left ramp side guard" },
    { shape: "isosceles-triangle", x: 7.5, y: 8.1, step: 4, role: "right ramp side guard" }
  ];
}

function mediumRampDrafts(): TileDraft[] {
  const drafts: TileDraft[] = [
    { shape: "small-square", x: -6, y: 1.5, step: 1, role: "lower ramp base" },
    { shape: "small-square", x: -3, y: 1.5, step: 1, role: "lower ramp base" },
    { shape: "small-square", x: 0, y: 1.5, step: 1, role: "lower ramp base" },
    { shape: "small-square", x: 3, y: 1.5, step: 2, role: "rear support wall" },
    { shape: "small-square", x: 6, y: 1.5, step: 2, role: "rear support wall" },
    { shape: "small-square", x: 3, y: 4.5, step: 2, role: "rear support wall" },
    { shape: "small-square", x: 6, y: 4.5, step: 2, role: "rear support wall" },
    { shape: "small-square", x: 0, y: 4.5, rz: Math.PI / 8, step: 3, role: "sloped ramp driving surface" },
    { shape: "small-square", x: -3, y: 4.5, rz: Math.PI / 8, step: 3, role: "sloped ramp driving surface" },
    { shape: "equilateral-triangle", x: -6, y: 4.1, step: 4, role: "ramp side brace" },
    { shape: "equilateral-triangle", x: -3, y: 6.7, step: 4, role: "ramp side brace" },
    { shape: "equilateral-triangle", x: 0, y: 7.1, step: 4, role: "ramp side brace" },
    { shape: "isosceles-triangle", x: 4.5, y: 8.1, step: 5, role: "upper ramp guard" },
    { shape: "isosceles-triangle", x: 7.5, y: 8.1, step: 5, role: "upper ramp guard" }
  ];

  return drafts;
}

function largeRampDrafts(): TileDraft[] {
  const drafts: TileDraft[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      drafts.push({
        shape: "small-square",
        x: 4.5 + column * 3,
        y: 1.5 + row * 3,
        step: row < 2 ? 1 : 2,
        role: "large rear grid wall"
      });
    }
  }

  drafts.push(
    { shape: "large-square", x: -4.5, y: 3, rz: Math.PI / 7, step: 3, role: "large sloped ramp plane" },
    { shape: "large-square", x: -10.5, y: 3, rz: Math.PI / 7, step: 3, role: "large sloped ramp plane" },
    { shape: "small-square", x: -1.5, y: 1.5, step: 4, role: "box platform support" },
    { shape: "small-square", x: 1.5, y: 1.5, step: 4, role: "box platform support" },
    { shape: "small-square", x: -1.5, y: 4.5, step: 4, role: "box platform support" },
    { shape: "small-square", x: 1.5, y: 4.5, step: 4, role: "box platform support" },
    { shape: "equilateral-triangle", x: -13.5, y: 1.3, rz: Math.PI, step: 5, role: "ramp side marker" },
    { shape: "equilateral-triangle", x: -7.5, y: 7, step: 5, role: "ramp side marker" },
    { shape: "equilateral-triangle", x: 1.5, y: 7, step: 5, role: "ramp side marker" }
  );

  return drafts;
}

function toTile(draft: TileDraft, index: number, profile: PromptProfile): TileInstance {
  const color = draft.color ?? profile.palette[index % profile.palette.length];
  const rotation: Rotation = {
    x: draft.rx ?? 0,
    y: draft.ry ?? 0,
    z: draft.rz ?? 0
  };
  const position: Vec3 = {
    x: round(draft.x),
    y: round(draft.y),
    z: round(draft.z ?? 0)
  };

  return {
    id: draft.sourceKey ?? `${profile.family}-${index + 1}`,
    shape: draft.shape,
    color,
    position,
    rotation,
    basis: draft.basis,
    step: draft.step,
    role: draft.role,
    subassemblyId: draft.subassemblyId ?? (profile.family === "aircraft" ? subassemblyForRole(draft.role) : undefined),
    parentTileId: draft.parentTileId,
    parentEdge: draft.parentEdge,
    childEdge: draft.childEdge,
    foldAngle: draft.foldAngle,
    root: draft.root
  };
}

function inferConnections(tiles: TileInstance[]): MagneticConnection[] {
  const connections: MagneticConnection[] = [];

  for (let a = 0; a < tiles.length; a += 1) {
    for (let b = a + 1; b < tiles.length; b += 1) {
      const first = tiles[a];
      const second = tiles[b];
      const samePlane = Math.abs(first.position.z - second.position.z) < 0.05;
      const sameHeight = Math.abs(first.position.y - second.position.y) < 0.35;
      const verticalTouch = Math.abs(verticalGap(first, second)) < 0.2;
      const horizontalTouch = Math.abs(horizontalGap(first, second)) < 0.2;
      const horizontalOverlap = horizontalGap(first, second) < -0.35;
      const magneticConnection = connectionWithMagneticEdges(
        first,
        second,
        samePlane && horizontalOverlap && verticalTouch ? "support" : "edge"
      );

      if (magneticConnection) connections.push(magneticConnection);
    }
  }

  return connections;
}

function horizontalGap(first: TileInstance, second: TileInstance): number {
  return (
    Math.abs(first.position.x - second.position.x) -
    (TILE_SPECS[first.shape].width + TILE_SPECS[second.shape].width) / 2
  );
}

function verticalGap(first: TileInstance, second: TileInstance): number {
  return (
    Math.abs(first.position.y - second.position.y) -
    (TILE_SPECS[first.shape].height + TILE_SPECS[second.shape].height) / 2
  );
}

function calculateBounds(tiles: TileInstance[]): BuildBounds {
  const extents = tiles.map((tile) => {
    const vertices = tileWorldVertices(tile);
    const xs = vertices.map((vertex) => vertex.x);
    const ys = vertices.map((vertex) => vertex.y);
    const zs = vertices.map((vertex) => vertex.z);
    return {
      minX: Math.min(...xs) - PANEL_THICKNESS / 2,
      maxX: Math.max(...xs) + PANEL_THICKNESS / 2,
      minY: Math.min(...ys) - PANEL_THICKNESS / 2,
      maxY: Math.max(...ys) + PANEL_THICKNESS / 2,
      minZ: Math.min(...zs) - PANEL_THICKNESS / 2,
      maxZ: Math.max(...zs) + PANEL_THICKNESS / 2
    };
  });

  return {
    width: round(Math.max(...extents.map((item) => item.maxX)) - Math.min(...extents.map((item) => item.minX))),
    height: round(Math.max(...extents.map((item) => item.maxY)) - Math.min(...extents.map((item) => item.minY))),
    depth: round(Math.max(...extents.map((item) => item.maxZ)) - Math.min(...extents.map((item) => item.minZ)))
  };
}

function summaryFor(profile: PromptProfile, count: number): string {
  const sizeCopy =
    profile.size === "tall"
      ? "a taller, wide-base"
      : profile.size === "wide"
        ? "a low, wide"
        : profile.size === "small"
          ? "a compact"
          : "a medium";
  const accents = profile.accents.length ? ` with ${profile.accents.join(", ")}` : "";
  return `${capitalizeArticle(sizeCopy)} ${profile.family} using ${count} tiles${accents}.`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function capitalizeArticle(value: string): string {
  return value.startsWith("a ") ? `A ${value.slice(2)}` : `An ${value.slice(3)}`;
}
