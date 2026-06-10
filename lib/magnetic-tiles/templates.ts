import { SMALL_EDGE, TILE_THICKNESS } from "./catalog";
import { draftPaletteMap, draftTemplate, type DraftTemplateId } from "./draft-templates";
import { tileWorldVertices } from "./magnet-geometry";
import {
  arbitraryFold,
  box,
  composeMacros,
  gableRoof,
  openBox,
  radialFan,
  rocketFinBase,
  squarePyramid,
  tilePrimitive,
  type TileMacro
} from "./macros";
import type {
  BuildBounds,
  BuildGraph,
  BuildPart,
  MagneticConnection,
  PromptProfile,
  TileInstance
} from "./types";

const PANEL_THICKNESS = TILE_THICKNESS;

const PART_ROLE_PATTERNS: Record<BuildPart, RegExp> = {
  roof: /roof|gable|cone|pyramid|cap/i,
  wall: /wall|box face/i,
  tower: /tower|shaft/i,
  door: /door/i,
  deck: /deck|landing|span/i,
  body: /body|fuselage|keep/i,
  nose: /nose/i,
  wing: /wing/i,
  fin: /fin|tail/i,
  base: /base|bottom|floor|foot/i
};

/**
 * Deterministic template assembly. Every family resolves to either a macro composition
 * (built through the edge-attachment system, so connections and parent links are real
 * magnetic joins) or a replay of a hand-authored, engine-valid build draft. No geometry
 * is invented at prompt time; prompts only select template parameters.
 */
export function generateTemplate(prompt: string, profile: PromptProfile): BuildGraph {
  const assembly = assembleFamily(profile);
  const tiles = applyPartColors(assembly.tiles, profile);
  const connections = assembly.connections;

  return {
    id: `build-${profile.seed.toString(36)}`,
    prompt,
    title: profile.title,
    family: profile.family,
    seed: profile.seed,
    summary: summaryFor(profile, tiles.length),
    tiles,
    connections,
    bounds: calculateBounds(tiles)
  };
}

interface TemplateAssembly {
  tiles: TileInstance[];
  connections: MagneticConnection[];
}

function assembleFamily(profile: PromptProfile): TemplateAssembly {
  switch (profile.family) {
    case "castle":
      return castleMacroBuild(profile);
    case "house":
      return houseMacroBuild(profile);
    case "rocket":
      return rocketMacroBuild(profile);
    case "tower":
      return towerMacroBuild(profile);
    case "bridge":
      return bridgeMacroBuild(profile);
    case "aircraft":
      return draftAssembly("jet-aircraft", profile);
    case "ramp":
      return draftAssembly(rampDraftIdFor(profile), profile);
    case "animal":
      return animalAssembly(profile);
  }
}

function rampDraftIdFor(profile: PromptProfile): DraftTemplateId {
  if (profile.size === "small") return "small-car-ramp";
  if (profile.size === "tall") return "large-car-ramp";
  return "medium-car-ramp";
}

function animalAssembly(profile: PromptProfile): TemplateAssembly {
  if (profile.title === "Snail") return snailMacroBuild(profile.palette);
  if (profile.title === "Friendly Tile Dinosaur") {
    return draftAssembly("dog", profile, draftPaletteMap("dog", profile.palette));
  }
  return draftAssembly("dog", profile);
}

function draftAssembly(
  id: DraftTemplateId,
  profile: PromptProfile,
  paletteMap?: Map<string, string>
): TemplateAssembly {
  let colorMap = paletteMap;
  if (!colorMap && profile.dominantColor) {
    const firstSeen = draftPaletteMap(id, [profile.dominantColor]);
    const [firstColor] = firstSeen.keys();
    colorMap = new Map([[firstColor, profile.dominantColor]]);
  }
  return draftTemplate(id, colorMap);
}

function castleMacroBuild(profile: PromptProfile): TileMacro {
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

function houseMacroBuild(profile: PromptProfile): TileMacro {
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

function rocketMacroBuild(profile: PromptProfile): TileMacro {
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

export function towerHeightFor(size: PromptProfile["size"]): number {
  if (size === "small") return 1;
  if (size === "tall") return 3;
  return 2;
}

/**
 * One or more square towers (box shaft + pyramid cap), the same proven pattern as the
 * castle corner towers. Multiple towers are physically linked by short wall sections so
 * the whole build is one connected magnetic structure (the gate requires connectivity).
 */
function towerMacroBuild(profile: PromptProfile): TileMacro {
  return towerRowMacro(profile, towerHeightFor(profile.size), profile.count);
}

export function towerRowMacro(
  profile: PromptProfile,
  height: number,
  count: number
): TileMacro {
  const macros: TileMacro[] = [];
  const shaftColor = profile.palette[0] ?? "#118ab2";
  const capColor = profile.palette[1] ?? "#ffb703";
  const linkColor = profile.palette[2] ?? "#8ecae6";

  for (let index = 0; index < count; index += 1) {
    const x = index * SMALL_EDGE * 2;
    macros.push(
      box({
        id: `tower-${index + 1}-shaft`,
        width: 1,
        height,
        depth: 1,
        openFaces: ["top", "bottom"],
        origin: { x, y: 0, z: 0 },
        color: shaftColor,
        stepStart: 1,
        subassemblyId: `tower-${index + 1}`
      }),
      squarePyramid({
        id: `tower-${index + 1}-cap`,
        origin: { x, y: height * SMALL_EDGE, z: 0 },
        color: capColor,
        stepStart: height + 1,
        subassemblyId: `tower-${index + 1}`
      })
    );
    if (index > 0) {
      macros.push(
        box({
          id: `tower-link-${index}`,
          width: 1,
          height: 1,
          depth: 1,
          openFaces: ["top", "bottom", "left", "right"],
          origin: { x: x - SMALL_EDGE, y: 0, z: 0 },
          color: linkColor,
          stepStart: 1,
          subassemblyId: `tower-link-${index}`
        })
      );
    }
  }

  return composeMacros(...macros);
}

/**
 * A bridge: closed-top box pillars carrying flush horizontal span tiles between them.
 * Span tiles sit in the same plane as the pillar tops, so every joint is a real flush
 * magnetic edge join. Roles deliberately avoid ramp vocabulary (deck/landing/slope) so
 * the engine does not classify the flat bridge as a functional ramp.
 */
function bridgeMacroBuild(profile: PromptProfile): TileMacro {
  const wide = profile.size === "wide" || profile.size === "tall";
  const pillarXs = wide ? [0, SMALL_EDGE * 2, SMALL_EDGE * 4] : [0, SMALL_EDGE * 2];
  const pillarColor = profile.palette[0] ?? "#118ab2";
  const spanColor = profile.palette[1] ?? "#ffb703";
  const macros: TileMacro[] = pillarXs.map((x, index) =>
    box({
      id: `bridge-pillar-${index + 1}`,
      width: 1,
      height: 1,
      depth: 1,
      openFaces: ["bottom"],
      origin: { x, y: 0, z: 0 },
      color: pillarColor,
      stepStart: 1,
      subassemblyId: `bridge-pillar-${index + 1}`
    })
  );

  for (let index = 1; index < pillarXs.length; index += 1) {
    macros.push(
      tilePrimitive({
        id: `bridge-span-${index}`,
        shape: "small-square",
        plane: "horizontal",
        origin: { x: pillarXs[index] - SMALL_EDGE / 2, y: SMALL_EDGE, z: SMALL_EDGE / 2 },
        color: spanColor,
        stepStart: 2,
        subassemblyId: `bridge-span-${index}`,
        role: `bridge span square ${index} between pillars`
      })
    );
  }

  return composeMacros(...macros);
}

function snailMacroBuild(palette: string[]): TileMacro {
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

/** Apply explicit part-color requests ("red roof") as a cosmetic recolor pass. */
function applyPartColors(tiles: TileInstance[], profile: PromptProfile): TileInstance[] {
  if (profile.partColors.length === 0) return tiles;
  return tiles.map((tile) => {
    const request = profile.partColors.find((candidate) =>
      PART_ROLE_PATTERNS[candidate.part].test(tile.role)
    );
    return request ? { ...tile, color: request.color } : tile;
  });
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
  const structureCopy =
    profile.family === "tower" && profile.count > 1
      ? `${profile.count === 2 ? "pair" : "row"} of connected towers`
      : profile.family;
  const accents = profile.accents.length ? ` with ${profile.accents.join(", ")}` : "";
  return `${capitalizeArticle(sizeCopy)} ${structureCopy} using ${count} tiles${accents}.`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function capitalizeArticle(value: string): string {
  return value.startsWith("a ") ? `A ${value.slice(2)}` : `An ${value.slice(3)}`;
}
