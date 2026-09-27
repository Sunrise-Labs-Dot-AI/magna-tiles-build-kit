import {
  EQUILATERAL_HEIGHT as H,
  ISOSCELES_EQUAL_SIDE as L,
  emptyInventory,
} from "@/lib/magnetic-tiles/catalog";
import { add, scale, cross, normalize } from "@/lib/engine/math";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { Inventory, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { assemble, outside, rigidPanel, square, v } from "./geometry";
import type { Replica, StagePose } from "./types";

const blue = "#168db3",
  red = "#d93747",
  yellow = "#f3bc25",
  purple = "#6c42aa",
  green = "#32ad66",
  orange = "#eb802b";
const inventory = (
  s: number,
  e: number,
  r: number,
  i: number,
  x = 0,
): Inventory => ({
  ...emptyInventory(),
  "small-square": s,
  "equilateral-triangle": e,
  "right-triangle": r,
  "isosceles-triangle": i,
  "xl-square": x,
});
const panel = (
  id: string,
  shape: TileInstance["shape"],
  p: Vec3[],
  color: string,
  step: number,
  group: string,
  inside?: Vec3,
) => {
  const t = rigidPanel(id, shape, p, color, step, group);
  return inside ? outside(t, inside) : t;
};
const prefix = (tiles: TileInstance[], step: number) =>
  tiles.filter((t) => t.step <= step).map((t) => t.id);
const stage = (
  id: string,
  frameId: string,
  title: string,
  instruction: string,
  tileIds: string[],
  support: StagePose["support"] = "released",
): StagePose => ({ id, frameId, title, instruction, tileIds, support });

/** The source uses two unscaled squares over each long isosceles side.
 * The 143 mm catalog side leaves 0.37 in of total deck overhang. This is a material
 * discrepancy to measure, not a reason to stretch the triangle or truncate the deck.
 */
export function rampPrism(
  id: string,
  origin: Vec3,
  forward: Vec3,
  step: number,
): TileInstance[] {
  const run = L - 9 / (2 * L),
    rise = Math.sqrt(L * L - run * run);
  const along = normalize(forward),
    lateral = normalize(cross(along, v(0, 1, 0)));
  const p = (x: number, y: number, z: number) =>
    add(origin, add(add(scale(along, x), v(0, y, 0)), scale(lateral, z)));
  const d = v(run / L, rise / L, 0);
  const result: TileInstance[] = [];
  for (const sign of [-1, 1]) {
    // Short base first, apex last, as in the catalog.
    result.push(
      panel(
        `${id}-side-${sign}`,
        "isosceles-triangle",
        [p(L, 0, sign * 1.59), p(run, rise, sign * 1.59), p(0, 0, sign * 1.59)],
        yellow,
        step,
        id,
      ),
    );
  }
  const start = -((6 - L) / 2);
  for (let n = 0; n < 2; n++) {
    const a = start + 3 * n;
    const tile = square(
      `${id}-deck-${n + 1}`,
      p(a * d.x, a * d.y, -1.5),
      add(scale(along, 3 * d.x), v(0, 3 * d.y, 0)),
      scale(lateral, 3),
      orange,
      step,
      id,
    );
    // Top face of the support edges carries the deck's inside face.
    result.push(outside(tile, p(3, 0, 0)));
  }
  result.push(
    outside(
      square(
        `${id}-back`,
        p(L, 0, -1.5),
        add(scale(along, run - L), v(0, rise, 0)),
        scale(lateral, 3),
        red,
        step,
        id,
      ),
      p(3, 0, 0),
    ),
  );
  return result;
}

export function smallRamp(): Replica {
  const tiles = rampPrism("small", v(0, 0, 0), v(1, 0, 0), 1);
  const run = L - 9 / (2 * L),
    rise = Math.sqrt(L * L - run * run);
  const x = run + 0.15,
    y = rise + 0.18;
  tiles.push(
    square(
      "launch-roof",
      v(x, y, -1.5),
      v(3, 0, 0),
      v(0, 0, 3),
      red,
      2,
      "launch",
    ),
  );
  tiles.push(
    square(
      "launch-back",
      v(x + 3.09, y - 3, -1.5),
      v(0, 3, 0),
      v(0, 0, 3),
      red,
      2,
      "launch",
    ),
  );
  for (const sign of [-1, 1])
    tiles.push(
      panel(
        `launch-side-${sign}`,
        "right-triangle",
        [
          v(x + 3, y, sign * 1.59),
          v(x, y, sign * 1.59),
          v(x + 3, y - 3, sign * 1.59),
        ],
        green,
        2,
        "launch",
      ),
    );
  return {
    id: "small-ramp",
    sourceId: "henry",
    title: "Henry's small ramp · 9-piece candidate",
    build: assemble("replica-small", "Henry's small ramp", tiles, "ramp"),
    inventory: inventory(5, 0, 2, 2),
    bomFrameId: "small-bom",
    construction: [
      {
        stageId: "small-wedge",
        operations: ["small-deck-1", "small-deck-2", "small-side--1", "small-side-1", "small-back"]
          .map(id => ({ tileIds: [id] })),
      },
      {
        stageId: "small-launch",
        operations: ["launch-roof", "launch-back", "launch-side--1", "launch-side-1"]
          .map(id => ({ tileIds: [id] })),
      },
      {
        stageId: "small-final",
        operations: [{ tileIds: tiles.filter(t => t.step === 2).map(t => t.id), preparedStageId: "small-launch" }],
      },
    ],
    stages: [
      stage(
        "small-wedge",
        "small-fit",
        "Join the five-piece wedge",
        "Join the two orange driving squares edge to edge. Seat their long edges along the yellow isosceles sides; close the short rear edge with the red square. Hold while closing the wedge, then place both long side edges on the table.",
        prefix(tiles, 1),
      ),
      stage(
        "small-launch",
        "small-launch",
        "Make the launch module separately",
        "Join the red roof and back at a right angle. Close both ends with green right triangles. Henry holds this four-piece module while bringing it to the wedge; it is not released alone in the footage.",
        tiles.filter((t) => t.step === 2).map((t) => t.id),
        "held",
      ),
      {
        ...stage(
          "small-final",
          "small-check",
          "Connect the launch to the wedge",
          "Bring the launch roof's front edge to the wedge's high edge. Seat both magnets before releasing; do not press through an unresolved gap.",
          prefix(tiles, 2),
        ),
        installedStageIds: ["small-wedge"],
      },
    ],
    uncertainties: [
      {
        id: "small-seam",
        tileIds: tiles.map((t) => t.id),
        frameIds: ["small-fit", "small-check"],
        detail:
          "The source long-edge/short-edge ratio and exact launch-to-wedge seam need measurement. The 143 mm catalog side is shorter than two squares; retained as an explicit overhang, not stretched.",
      },
    ],
    materialQuestions: [
      "Isosceles long side is the existing noisy 143 mm catalog measurement; source-specific dimensions and magnets not calibrated.",
    ],
    route: {
      sourceFrameId: "small-car",
      evidence:
        "Inferred deck route; the sampled source frames do not establish a completed vehicle run or measured car parameters.",
      brief: {
        prompt: "Henry's small ramp car release",
        kind: "racecourse",
        lanes: 1,
        turns: 0,
        downhill: true,
        unsupportedTerms: [],
        unlimitedPieces: true,
        inventoryPreset: "classic-100",
        car: { width: 1.1, length: 2.3, wheelRadius: 0.24, massKg: 0.035 },
      },
      lanes: [
        {
          id: "car",
          width: 3,
          surfaceTileIds: ["small-deck-2", "small-deck-1"],
          waypoints: [v(run - 0.9, rise - 0.4, 0), v(0.5, 0.35, 0)],
        },
      ],
    },
  };
}

export function jet(): Replica {
  const tiles: TileInstance[] = [];
  // X runs from the nose root to the tail. Three squares per equilateral bay,
  // observed directly at 00:33, stacked vertically at 00:50, then laid keel-down.
  for (let n = 0; n < 4; n++) {
    const x = 3 * n,
      color = [blue, red, yellow, orange][n],
      inside = v(x + 1.5, H / 2, 0);
    tiles.push(
      outside(
        square(
          `body-${n + 1}-top`,
          v(x, H, -1.5),
          v(3, 0, 0),
          v(0, 0, 3),
          color,
          n + 1,
          "body",
        ),
        inside,
      ),
    );
    for (const sign of [-1, 1])
      tiles.push(
        outside(
          square(
            `body-${n + 1}-side-${sign}`,
            v(x, H, 1.5 * sign),
            v(3, 0, 0),
            v(0, -H, -1.5 * sign),
            color,
            n + 1,
            "body",
          ),
          inside,
        ),
      );
  }
  const corners = [v(0, H, -1.5), v(0, H, 1.5), v(0, 0, 0)],
    tip = v(-Math.sqrt(L * L - 3), (2 * H) / 3, 0);
  for (let i = 0; i < 3; i++)
    tiles.push(
      panel(
        `nose-${i + 1}`,
        "isosceles-triangle",
        [corners[i], corners[(i + 1) % 3], tip],
        blue,
        5,
        "nose",
        v(-1, (2 * H) / 3, 0),
      ),
    );
  // The 01:50–02:07 module has two square faces and two right-triangle ends.
  // It is open on its third long face. Wing incidence/attachment remain hypotheses.
  for (const sign of [-1, 1]) {
    const z = sign * 1.84,
      q = sign * 3,
      group = `wing-${sign}`,
      x = 6,
      y = H;
    tiles.push(
      outside(
        square(
          `${group}-roof`,
          v(x, y, z),
          v(3, 0, 0),
          v(0, 0, q),
          blue,
          sign < 0 ? 6 : 7,
          group,
        ),
        v(7, y - 1, z + q / 2),
      ),
    );
    tiles.push(
      outside(
        square(
          `${group}-front`,
          v(x, y, z),
          v(0, -3, 0),
          v(0, 0, q),
          purple,
          sign < 0 ? 6 : 7,
          group,
        ),
        v(7, y - 1, z + q / 2),
      ),
    );
    for (const end of [0, 1])
      tiles.push(
        panel(
          `${group}-cap-${end}`,
          "right-triangle",
          [
            v(x, y, z + q * end),
            v(x + 3, y, z + q * end),
            v(x, y - 3, z + q * end),
          ],
          orange,
          sign < 0 ? 6 : 7,
          group,
          v(7, y - 1, z + q / 2),
        ),
      );
    // Red leading triangles are visibly added after the pods (02:48–02:59).
    tiles.push(
      panel(
        `${group}-leading`,
        "equilateral-triangle",
        [
          v(x, y + 0.18, z),
          v(x, y + 0.18, z + q),
          v(x - H, y + 0.18, z + q / 2),
        ],
        red,
        8,
        "leading wings",
      ),
    );
    tiles.push(
      panel(
        `${group}-tip`,
        "right-triangle",
        [
          v(x + 3, y + 0.18, z + q),
          v(x, y + 0.18, z + q),
          v(x + 3, y + 0.18, z + q + sign * 3),
        ],
        blue,
        9,
        "outer wings",
      ),
    );
  }
  const tail = [v(12, H, -1.5), v(12, H, 1.5), v(12, 0, 0)],
    tailTip = v(12 + Math.sqrt(6), (2 * H) / 3, 0);
  for (let i = 0; i < 3; i++)
    tiles.push(
      panel(
        `tail-cone-${i + 1}`,
        "equilateral-triangle",
        [tail[i], tail[(i + 1) % 3], tailTip],
        red,
        10,
        "tail cone",
        v(12.5, (2 * H) / 3, 0),
      ),
    );
  for (const sign of [-1, 1]) {
    tiles.push(
      panel(
        `tail-horizontal-${sign}`,
        "right-triangle",
        [
          v(12, H + 0.18, sign * 1.59),
          v(9, H + 0.18, sign * 1.59),
          v(12, H + 0.18, sign * 4.59),
        ],
        orange,
        11,
        "horizontal tail",
      ),
    );
    tiles.push(
      panel(
        `tail-vertical-${sign}`,
        "equilateral-triangle",
        [
          v(9, H + 0.36, sign * 1.59),
          v(12, H + 0.36, sign * 1.59),
          v(10.5, H + H + 0.36, sign * 1.59),
        ],
        purple,
        12,
        "vertical tail",
      ),
    );
  }
  // Six-piece cockpit topology observed at 04:49–05:24. Its seating on the body
  // is occluded. Exact rigid pieces below are a testable placement hypothesis.
  const a = v(3, H + 0.2, -1.5),
    c = v(3, H + 0.2, 1.5),
    b = v(3, H + H + 0.2, 0),
    rear = v(3 + Math.sqrt(L * L - 3), H + H / 3 + 0.2, 0);
  tiles.push(
    panel(
      "cockpit-rear-left",
      "isosceles-triangle",
      [a, b, rear],
      purple,
      13,
      "cockpit",
    ),
  );
  tiles.push(
    panel(
      "cockpit-rear-right",
      "isosceles-triangle",
      [c, b, rear],
      purple,
      13,
      "cockpit",
    ),
  );
  tiles.push(
    panel(
      "cockpit-divider",
      "equilateral-triangle",
      [a, c, b],
      yellow,
      13,
      "cockpit",
    ),
  );
  // Tetrahedron with base edges 3, distances from tip to a/c = 3 and b = sqrt(18).
  // Solving three sphere constraints, not typing a visual approximation of the vertices.
  const front = v(3 - Math.sqrt(6), H + 0.2 - H / 3, 0);
  tiles.push(
    panel(
      "cockpit-front-left",
      "right-triangle",
      [a, b, front],
      green,
      13,
      "cockpit",
    ),
  );
  tiles.push(
    panel(
      "cockpit-front-right",
      "right-triangle",
      [c, b, front],
      green,
      13,
      "cockpit",
    ),
  );
  tiles.push(
    panel(
      "cockpit-floor",
      "equilateral-triangle",
      [a, c, front],
      red,
      13,
      "cockpit",
    ),
  );
  // Seat the two longitudinal tips on the body roof, by one rigid rotation of the
  // complete module. The divider base is raised; forcing it flat cut the green
  // front panels through the body. This is still a source-testable hypothesis.
  const pitch = -Math.atan2(rear.y - front.y, rear.x - front.x);
  const rotateCockpit = (p: Vec3): Vec3 =>
    v(
      p.x * Math.cos(pitch) - p.y * Math.sin(pitch),
      p.x * Math.sin(pitch) + p.y * Math.cos(pitch),
      p.z,
    );
  const seatedFront = rotateCockpit(v(front.x - 3, front.y - a.y, 0));
  for (let i = 0; i < tiles.length; i++) {
    let tile = tiles[i];
    if (tile.subassemblyId !== "cockpit") continue;
    if (tile.id !== "cockpit-divider")
      tile = outside(tile, v(tile.id.includes("rear") ? 4 : 2, a.y + H / 3, 0));
    if (tile.id.includes("front") || tile.id === "cockpit-floor")
      tile = { ...tile, position: add(tile.position, v(-0.09, 0, 0)) };
    const p = rotateCockpit(
      v(tile.position.x - 3, tile.position.y - a.y, tile.position.z),
    );
    tiles[i] = {
      ...tile,
      position: v(p.x + 3, p.y + H + 0.36 - seatedFront.y, p.z),
      basis: {
        xAxis: rotateCockpit(tile.basis!.xAxis),
        yAxis: rotateCockpit(tile.basis!.yAxis),
        zAxis: rotateCockpit(tile.basis!.zAxis),
      },
    };
  }
  const stages: StagePose[] = [];
  for (let n = 1; n <= 4; n++)
    stages.push({
      ...stage(
        `body-upright-${n}`,
        [
          "jet-body-ring",
          "jet-body-second",
          "jet-body-third",
          "jet-body-upright",
        ][n - 1],
        `Build body bay ${n} upright`,
        "Join three square tiles into an open triangular ring. Stack the next ring on its three matching edges. The creator supports the upright assembly; its first clear hands-off checkpoint is the horizontal pose.",
        prefix(tiles, n),
        "held",
      ),
      transform: {
        basis: { xAxis: v(0, 1, 0), yAxis: v(1, 0, 0), zAxis: v(0, 0, -1) },
        translation: v(0, 0, 0),
      },
    });
  stages.push(
    stage(
      "body-horizontal",
      "jet-body-release",
      "Lay the body on its keel",
      "Turn the four connected triangular bays onto the long keel. Adjust as shown in the source and release for the balance check.",
      prefix(tiles, 4),
    ),
  );
  stages.push(
    stage(
      "nose",
      "jet-nose",
      "Make and attach the three-triangle nose",
      "Join the three long blue isosceles triangles into a point. Attach all three short bases around the front triangular opening.",
      prefix(tiles, 5),
    ),
  );
  for (const [s, sign] of [
    [6, -1],
    [7, 1],
  ]) {
    const ids = tiles
      .filter((t) => t.subassemblyId === `wing-${sign}`)
      .map((t) => t.id);
    stages.push(
      stage(
        `wing-module-${sign}`,
        sign < 0 ? "jet-wing-module" : "jet-wing-module-right",
        "Make a wing pod beside the body",
        "Join its two squares at a right angle and add the two right-triangle end caps. Keep the third long side open.",
        ids,
        "held",
      ),
    );
    stages.push(
      stage(
        `wing-root-${sign}`,
        sign < 0 ? "jet-wing-root-left" : "jet-wing-root-right",
        "Seat the wing pod against the body",
        "Hold the pod against the middle body bay, matching its top edge. The exact seating remains unresolved; this step is not certified buildable.",
        prefix(tiles, s),
      ),
    );
  }
  for (const [stepNo, id, frame, title, instruction] of [
    [
      8,
      "wing-roots",
      "jet-wings",
      "Add the red leading panels",
      "Seat each red equilateral triangle along the front edge of its pod.",
    ],
    [
      9,
      "wingtips",
      "jet-wingtips",
      "Add the blue outer wingtips",
      "Join one right triangle to each outer roof edge, preserving the mirrored sweep.",
    ],
    [
      10,
      "tail-cone",
      "jet-tail-cone",
      "Close the tail point",
      "Join the three red equilateral triangles into a point and seat around the rear opening.",
    ],
    [
      11,
      "tail-horizontal",
      "jet-horizontal-tail",
      "Attach the horizontal tail first",
      "Join the two orange horizontal stabilizers to the rear bay. Keep their outer edges clear.",
    ],
    [
      12,
      "tail-fins",
      "jet-tail-order",
      "Put the upright fins on the tail",
      "Attach each purple equilateral fin above its horizontal stabilizer, following the source ordering.",
    ],
    [
      13,
      "final",
      "jet-final-fit",
      "Build and seat the cockpit module",
      "Join the two purple long triangles to the yellow divider; add the green right triangles and red front floor. Seat the six-piece module on the forward body. The hidden bottom joins require further reconstruction.",
    ],
  ] as const)
    stages.push(stage(id, frame, title, instruction, prefix(tiles, stepNo)));
  return {
    id: "jet",
    sourceId: "jet",
    title: "Jet aircraft · 40-piece candidate",
    build: assemble("replica-jet", "Jet aircraft", tiles, "aircraft"),
    inventory: inventory(16, 9, 10, 5),
    bomFrameId: "jet-bom",
    stages,
    materialQuestions: [
      "Triangle side lengths and magnet layout use the existing catalog; source-specific calibration is pending.",
    ],
    uncertainties: [
      {
        id: "wing-seat",
        tileIds: tiles
          .filter((t) => t.subassemblyId?.includes("wing"))
          .map((t) => t.id),
        frameIds: ["jet-wing-module", "jet-wings", "jet-final-fit"],
        detail:
          "Pod incidence, longitudinal bay and the red leading triangle contacts are candidate hypotheses; the footage does not expose every join.",
      },
      {
        id: "cockpit-seat",
        tileIds: tiles
          .filter((t) => t.subassemblyId === "cockpit")
          .map((t) => t.id),
        frameIds: ["jet-cockpit-module", "jet-final-fit"],
        detail:
          "Hidden cockpit floor/contact geometry and final inclination remain unresolved. The six rigid pieces are retained rather than collapsed to one fin.",
      },
    ],
  };
}

export function mediumRamp(): Replica {
  const yaw = Math.PI / 3,
    upperDirection = v(Math.cos(yaw), 0, Math.sin(yaw));
  const lower = rampPrism("lower", v(0, 0, 0), v(1, 0, 0), 1).filter(
    (t) => !t.id.endsWith("-back"),
  );
  const run = L - 9 / (2 * L),
    rise = Math.sqrt(L * L - run * run);
  // The equilateral turn joins two width-three edges; their outbound headings differ 60°.
  const edge = tileWorldVertices(
    lower.find((t) => t.id === "lower-deck-2")!,
  )[1];
  const a = v(edge.x + 0.12, edge.y + 0.12, -1.5),
    b = v(edge.x + 0.12, edge.y + 0.12, 1.5),
    c = v(edge.x + 0.12 + H, edge.y + 0.12, 0);
  const upperOrigin = add(
    scale(add(b, c), 0.5),
    add(scale(upperDirection, 0.34), v(0, 0.05, 0)),
  );
  const upper = rampPrism("upper", upperOrigin, upperDirection, 3).filter(
    (t) => !t.id.endsWith("-back"),
  );
  const tiles = [...lower];
  const side = normalize(cross(upperDirection, v(0, 1, 0)));
  const p = (x: number, y: number, z: number) =>
    add(
      upperOrigin,
      add(add(scale(upperDirection, x), v(0, y, 0)), scale(side, z)),
    );
  const interior = p(3.18, -1.5, 0);
  for (const sign of [-1, 1])
    for (let n = 0; n < 2; n++)
      tiles.push(
        outside(
          square(
            `support-side-${sign}-${n}`,
            p(0.18 + n * 3, -3, sign * 1.5),
            scale(upperDirection, 3),
            v(0, 3, 0),
            green,
            2,
            "support",
          ),
          interior,
        ),
      );
  tiles.push(
    outside(
      square(
        "support-back",
        p(6.18, -3, -1.5),
        scale(side, 3),
        v(0, 3, 0),
        green,
        2,
        "support",
      ),
      interior,
    ),
  );
  tiles.push(
    ...upper,
    panel("turn-floor", "equilateral-triangle", [a, b, c], blue, 4, "turn"),
  );
  // Triangular walls preserve the observed 18-triangle inventory. Canopy pitch and
  // exact end closure are intentionally unresolved and evaluated, not forced to pass.
  for (const [name, origin, dir, start] of [
    ["lower", v(0, 0, 0), v(1, 0, 0), 5],
    ["upper", upperOrigin, upperDirection, 8],
  ] as const) {
    const lateral = normalize(cross(dir, v(0, 1, 0))),
      slope = add(scale(dir, run / L), v(0, rise / L, 0)),
      normal = normalize(cross(lateral, slope));
    const q = (s: number, h: number, z: number) =>
      add(
        origin,
        add(
          add(scale(slope, s - (6 - L) / 2), scale(normal, h)),
          scale(lateral, z),
        ),
      );
    for (const sign of [-1, 1]) {
      const z = sign * 1.6;
      for (let n = 0; n < 2; n++) {
        const s = n * 3;
        for (const [j, verts] of [
          [1, [q(s, 0, z), q(s + 3, 0, z), q(s + 1.5, H, z)]],
          [2, [q(s + 1.5, H, z), q(s + 4.5, H, z), q(s + 3, 0, z)]],
        ] as [number, Vec3[]][])
          tiles.push(
            panel(
              `${name}-wall-${sign}-${n * 2 + j}`,
              "equilateral-triangle",
              verts,
              start === 5 ? red : green,
              start,
              `${name} canopy walls`,
            ),
          );
      }
    }
    for (let n = 0; n < 2; n++)
      tiles.push(
        outside(
          square(
            `${name}-cover-${n + 1}`,
            q(1.5 + 3 * n, H, -1.5),
            scale(slope, 3),
            scale(lateral, 3),
            yellow,
            start + 1,
            `${name} canopy roof`,
          ),
          q(3, 0, 0),
        ),
      );
  }
  tiles.push(
    panel(
      "turn-roof",
      "equilateral-triangle",
      [add(a, v(0, H, 0)), add(b, v(0, H, 0)), add(c, v(0, H, 0))],
      blue,
      7,
      "turn cover",
    ),
  );
  for (const sign of [-1, 1]) {
    const slope = add(scale(upperDirection, run / L), v(0, rise / L, 0));
    const normal = normalize(cross(side, slope));
    const o = add(
      upperOrigin,
      add(
        add(scale(slope, 4.5), scale(normal, H + 0.18)),
        scale(side, sign * 1.65),
      ),
    );
    const u = scale(slope, 3),
      w = scale(normal, 3);
    tiles.push(square(`launch-flap-${sign}`, o, u, w, red, 10, "launch flaps"));
  }
  const stages = [
    stage(
      "medium-lower",
      "medium-lower",
      "Build the lower wedge",
      "Join two long isosceles sides and two square deck tiles. The medium flight has four pieces; it omits the small ramp's rear square.",
      prefix(tiles, 1),
    ),
    stage(
      "medium-support",
      "medium-support",
      "Make the five-square support",
      "Join two green squares along each long side and one across the back to make the elongated U beside the lower wedge.",
      tiles.filter((t) => t.step === 2).map((t) => t.id),
    ),
    stage(
      "medium-turn",
      "medium-turn",
      "Add the upper wedge and triangular turn",
      "Place the second wedge on the U support. Join the blue equilateral turn between the upper exit and lower entrance; retain its 60-degree change of direction.",
      prefix(tiles, 4),
    ),
  ];
  for (const [n, id, frame, title] of [
    [5, "medium-lower-walls", "medium-fit", "Add the lower triangular walls"],
    [
      6,
      "medium-lower-cover",
      "medium-lower-cover",
      "Cover the lower driving section",
    ],
    [7, "medium-turn-cover", "medium-turn-cover", "Cover the triangular turn"],
    [
      9,
      "medium-upper-cover",
      "medium-upper-cover",
      "Add the upper walls and cover",
    ],
    [10, "medium-final", "medium-check-a", "Add the launch flaps"],
  ] as const)
    stages.push(
      stage(
        id,
        frame,
        title,
        "Add only the numbered pieces in this step. The canopy end geometry and support contacts remain hypotheses; stop if the shown joins do not seat without force.",
        prefix(tiles, n),
      ),
    );
  return {
    id: "medium-ramp",
    sourceId: "henry",
    title: "Henry's medium ramp · 37-piece candidate",
    build: assemble("replica-medium", "Henry's medium ramp", tiles, "ramp"),
    inventory: inventory(15, 18, 0, 4),
    bomFrameId: "medium-bom",
    stages,
    materialQuestions: [
      "Source isosceles dimensions and magnets are uncalibrated; the simulated vehicle is an assumed proxy.",
    ],
    uncertainties: [
      {
        id: "canopy-topology",
        tileIds: tiles.filter((t) => t.step >= 5).map((t) => t.id),
        frameIds: ["medium-fit", "medium-lower-cover", "medium-check-a"],
        detail:
          "Canopy roof pitch, triangular tessellation, end closures and red launch flap joins require additional fitting. Exact BOM alone does not validate this hypothesis.",
      },
      {
        id: "support-turn",
        tileIds: tiles.filter((t) => t.step <= 4).map((t) => t.id),
        frameIds: ["medium-support", "medium-turn"],
        detail:
          "Upper wedge elevation/support alignment and the blue turn's dihedral remain unresolved.",
      },
    ],
    route: {
      sourceFrameId: "medium-car",
      evidence:
        "The 01:46 close-up shows Henry gesturing along the upper squares. No complete toy-car trajectory is visible. The roof route below is an inferred functional target, not a measured successful turn.",
      brief: {
        prompt: "Henry's medium ramp with a triangular passive turn",
        kind: "racecourse",
        lanes: 1,
        turns: 1,
        downhill: true,
        unsupportedTerms: [],
        unlimitedPieces: true,
        inventoryPreset: "classic-100",
        car: { width: 1.1, length: 2.3, wheelRadius: 0.24, massKg: 0.035 },
      },
      lanes: [
        {
          id: "car",
          width: 3,
          surfaceTileIds: [
            "upper-cover-2",
            "upper-cover-1",
            "turn-roof",
            "lower-cover-2",
            "lower-cover-1",
          ],
          waypoints: [
            tiles.find((t) => t.id === "upper-cover-2")!.position,
            tiles.find((t) => t.id === "upper-cover-1")!.position,
            tiles.find((t) => t.id === "turn-roof")!.position,
            tiles.find((t) => t.id === "lower-cover-2")!.position,
            tiles.find((t) => t.id === "lower-cover-1")!.position,
          ],
        },
      ],
    },
  };
}

export function largeRamp(): Replica {
  const tiles: TileInstance[] = [];
  // Three open-bottom, two-square-wide, one-square-deep shells: 20 + 14 + 8 squares.
  const centers = [0, 8.376, 16.752],
    levels = [3, 2, 1];
  for (let b = 0; b < 3; b++) {
    const x = centers[b],
      height = levels[b],
      inside = v(x + 1.5, height * 1.5, 0);
    for (let y = 0; y < height; y++) {
      for (const sign of [-1, 1])
        tiles.push(
          outside(
            square(
              `bay-${b}-side-${sign}-${y}`,
              v(x, 3 * y, sign * 3),
              v(3, 0, 0),
              v(0, 3, 0),
              b ? red : green,
              b + 1,
              `bay ${b}`,
            ),
            inside,
          ),
        );
      for (const end of [0, 1])
        for (let z = 0; z < 2; z++)
          tiles.push(
            outside(
              square(
                `bay-${b}-end-${end}-${y}-${z}`,
                v(x + end * 3, 3 * y, -3 + 3 * z),
                v(0, 0, 3),
                v(0, 3, 0),
                b ? orange : blue,
                b + 1,
                `bay ${b}`,
              ),
              inside,
            ),
          );
    }
    for (let z = 0; z < 2; z++)
      tiles.push(
        outside(
          square(
            `bay-${b}-roof-${z}`,
            v(x, 3 * height, -3 + 3 * z),
            v(3, 0, 0),
            v(0, 0, 3),
            b ? red : green,
            b + 1,
            `bay ${b}`,
          ),
          inside,
        ),
      );
    const o = v(x + 3.18, 3 * height + 0.18, -3);
    tiles.push(
      square(
        `xl-deck-${b}`,
        o,
        v(Math.sqrt(27), -3, 0),
        v(0, 0, 6),
        blue,
        4 + b,
        "XL driving deck",
        "xl-square",
      ),
    );
    for (const sign of [-1, 1])
      tiles.push(
        panel(
          `marker-${b}-${sign}`,
          "equilateral-triangle",
          [
            v(x, 3 * height + 0.18, sign * 3.09),
            v(x + 3, 3 * height + 0.18, sign * 3.09),
            v(x + 1.5, 3 * height + H + 0.18, sign * 3.09),
          ],
          [green, yellow, red][b],
          7,
          "side markers",
        ),
      );
  }
  return {
    id: "large-ramp",
    sourceId: "henry",
    title: "Henry's large ramp · 51-piece candidate",
    build: assemble("replica-large", "Henry's large ramp", tiles, "ramp"),
    inventory: inventory(42, 6, 0, 0, 3),
    bomFrameId: "large-bom",
    stages: [
      ...levels.map((_, i) =>
        stage(
          `large-bay-${i}`,
          [
            "large-tower-finished",
            "large-box-finished",
            "large-lowbox-finished",
          ][i],
          `Build support ${i + 1}`,
          "Build the two-square-wide open-bottom shell one ring at a time, then add its two roof squares. The individual ring releases remain unverified.",
          tiles.filter((t) => t.subassemblyId === `bay ${i}`).map((t) => t.id),
        ),
      ),
      stage(
        "large-decks",
        "large-xl",
        "Bridge the supports with the three XL squares",
        "Seat the large blue panels between the roof edges, preserving a three-inch fall at each span. Each XL is one part, not four small squares.",
        prefix(tiles, 6),
      ),
      stage(
        "large-final",
        "large-final",
        "Add the six side markers",
        "Add the two triangular markers on each support roof.",
        prefix(tiles, 7),
      ),
    ],
    materialQuestions: [
      "Source XL spans two classic-square widths at 02:50, supporting the six-inch interpretation. Magnet layout and force remain uncalibrated.",
    ],
    uncertainties: [
      {
        id: "large-supports",
        tileIds: tiles.map((t) => t.id),
        frameIds: ["large-tower", "large-box", "large-xl"],
        detail:
          "42-square shell allocation and exact deck seams are source-informed hypotheses; intermediate ring release checks and independent camera fitting remain incomplete.",
      },
    ],
  };
}

export function replicas(): Replica[] {
  return [jet(), smallRamp(), mediumRamp(), largeRamp()];
}
