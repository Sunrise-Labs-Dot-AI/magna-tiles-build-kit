import { add, cross, dot, normalize, scale, subtract } from "@/lib/engine/math";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import type { Camera, Check, Observation, ProjectionResult } from "./types";
import { v } from "./geometry";

export const PROJECTION_TOLERANCE = { rms: 0.02, maximum: 0.04 };
const rotate = (p: Vec3, a: number[]) => {
  const [x, y, z] = a,
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const q = v(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx),
    r = v(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  return v(r.x * cz - r.y * sz, r.x * sz + r.y * cz, r.z);
};
function solve(a: number[][], b: number[]): number[] | null {
  const m = a.map((r, i) => [...r, b[i]]),
    n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
    if (Math.abs(m[pivot][i]) < 1e-12) return null;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    const d = m[i][i];
    for (let k = i; k <= n; k++) m[i][k] /= d;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const f = m[j][i];
        for (let k = i; k <= n; k++) m[j][k] -= f * m[i][k];
      }
  }
  return m.map((r) => r[n]);
}
export function projectPoint(point: Vec3, camera: Camera): [number, number] {
  const forward = normalize(subtract(camera.target, camera.position)),
    right = normalize(cross(forward, camera.up)),
    up = cross(right, forward),
    q = subtract(point, camera.position),
    depth = dot(q, forward);
  if (depth <= 0) return [NaN, NaN];
  return [
    camera.cx + (camera.focal * dot(q, right)) / depth,
    camera.cy - (camera.focal * dot(q, up)) / depth,
  ];
}

/** Observed camera region is an independent acceptance constraint, never a fit parameter. */
export function checkCameraRegion(build: BuildGraph, observation: Observation, camera: Camera): Check {
  const values = [...Object.values(camera.position), ...Object.values(camera.target), ...Object.values(camera.up), camera.focal, camera.cx, camera.cy];
  const forward = subtract(camera.target, camera.position);
  if (!values.every(Number.isFinite) || camera.focal <= 0 || dot(forward, forward) < 1e-8 ||
      dot(cross(forward, camera.up), cross(forward, camera.up)) < 1e-8)
    return { status: "fail", detail: "Invalid camera focal length or axes." };
  if (build.tiles.flatMap(tileWorldVertices).some(p => dot(subtract(p, camera.position), normalize(forward)) <= 0))
    return { status: "fail", detail: "Candidate geometry lies behind the camera." };
  const region = observation.cameraRegion;
  if (!region) return { status: "unverified", detail: "No independently observed camera region." };
  const d = region.horizontalDirection;
  if (!Number.isFinite(region.tableY) || ![d.x, d.y, d.z].every(Number.isFinite) || Math.hypot(d.x, d.z) < 1e-6 || d.y !== 0)
    return { status: "fail", detail: "Invalid camera region constraint." };
  if (camera.position.y <= region.tableY || dot(subtract(camera.position, camera.target), d) <= 0)
    return { status: "fail", detail: "Camera is below the table or in the wrong observed hemisphere." };
  return { status: "pass", detail: "Positive focal/depth, above table and in the observed horizontal hemisphere." };
}

/** Seven camera parameters, fitted ONLY to camera anchors. Scored landmarks never
 * enter optimization. Geometry, scale ratios and individual tile poses are immutable.
 */
export function compareObservation(
  build: BuildGraph,
  observation: Observation,
  lockedCamera?: Camera,
): ProjectionResult {
  if (
    !["fit", "holdout"].includes(observation.partition) ||
    observation.landmarks.some((l) => !["camera", "check"].includes(l.use)) ||
    !Number.isFinite(observation.width) ||
    !Number.isFinite(observation.height) ||
    observation.width <= 0 ||
    observation.height <= 0 ||
    observation.landmarks.length > 64 ||
    !Object.values(observation.viewDirection).every(Number.isFinite) ||
    Math.hypot(observation.viewDirection.x, observation.viewDirection.z) < 1e-6
  )
    throw new Error("Invalid or oversized source observation");
  const o = observation,
    empty: ProjectionResult = {
      id: o.id,
      frameId: o.frameId,
      partition: o.partition,
      status: "unverified",
      detail: "",
      camera: null,
      cameraRegion: { status: "unverified", detail: "Camera not fitted." },
      cameraAnchors: 0,
      checkLandmarks: 0,
      rmsPx: null,
      maxPx: null,
      sourceDiagonalPx: 0,
      residuals: [],
    };
  const ids = new Set<string>();
  const vertices = new Set<string>();
  const points = o.landmarks.map((l) => {
    const tile = build.tiles.find((t) => t.id === l.tileId),
      point = tile && tileWorldVertices(tile)[l.vertex];
    const key = `${l.tileId}:${l.vertex}`;
    if (
      ids.has(l.id) ||
      vertices.has(key) ||
      !Number.isInteger(l.vertex) ||
      !point ||
      ![...l.pixel, l.uncertaintyPx].every(Number.isFinite) ||
      l.uncertaintyPx < 0 ||
      l.pixel[0] < 0 ||
      l.pixel[1] < 0 ||
      l.pixel[0] > o.width ||
      l.pixel[1] > o.height
    )
      throw new Error(`Invalid landmark ${l.id}`);
    ids.add(l.id);
    vertices.add(key);
    return { l, point };
  });
  const anchors = points.filter((p) => p.l.use === "camera"),
    checks = points.filter((p) => p.l.use === "check");
  empty.cameraAnchors = anchors.length;
  empty.checkLandmarks = checks.length;
  if (anchors.length < 6 || checks.length < 4)
    return {
      ...empty,
      detail:
        "Need at least six camera anchors and four independent scored landmarks (seven camera parameters).",
    };
  const px = points.map((p) => p.l.pixel[0]),
    py = points.map((p) => p.l.pixel[1]);
  const diagonal = Math.hypot(
    Math.max(...px) - Math.min(...px),
    Math.max(...py) - Math.min(...py),
  );
  if (diagonal < 10) throw new Error("Degenerate source annotation extent");
  const anchorDiagonal = Math.hypot(
    Math.max(...anchors.map((p) => p.l.pixel[0])) -
      Math.min(...anchors.map((p) => p.l.pixel[0])),
    Math.max(...anchors.map((p) => p.l.pixel[1])) -
      Math.min(...anchors.map((p) => p.l.pixel[1])),
  );
  // Reject a coplanar anchor set: its camera depth cannot constrain a 3D replica.
  const center = scale(
    anchors.reduce((s, p) => add(s, p.point), v(0, 0, 0)),
    1 / anchors.length,
  );
  let volume = 0;
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++)
      for (let k = j + 1; k < anchors.length; k++)
        volume = Math.max(
          volume,
          Math.abs(
            dot(
              subtract(anchors[i].point, center),
              cross(
                subtract(anchors[j].point, center),
                subtract(anchors[k].point, center),
              ),
            ),
          ),
        );
  if (volume < 0.01)
    return {
      ...empty,
      sourceDiagonalPx: diagonal,
      detail:
        "Camera anchors are coplanar or degenerate; add an independently visible depth landmark.",
    };
  const forward = scale(normalize(o.viewDirection), -1),
    right = normalize(cross(forward, v(0, 1, 0))),
    down = scale(cross(right, forward), -1);
  const radius = Math.max(
    1,
    ...anchors.map((p) =>
      Math.hypot(...Object.values(subtract(p.point, center))),
    ),
  );
  const local = (p: Vec3) => {
    const q = subtract(p, center);
    return v(dot(q, right), dot(q, down), dot(q, forward));
  };
  const screen = (point: Vec3, p: number[]): [number, number] => {
    const q = rotate(local(point), p),
      depth = Math.exp(p[4]),
      scalePx = Math.exp(p[3]),
      den = 1 + q.z / depth;
    return [p[5] + (scalePx * q.x) / den, p[6] + (scalePx * q.y) / den];
  };
  const residual = (p: number[]) =>
    anchors.flatMap((a) =>
      screen(a.point, p).map(
        (x, i) => (x - a.l.pixel[i]) / Math.max(1, a.l.uncertaintyPx),
      ),
    );
  let camera = lockedCamera;
  if (!camera) {
    const mean = anchors.reduce(
      (s, a) => [
        s[0] + a.l.pixel[0] / anchors.length,
        s[1] + a.l.pixel[1] / anchors.length,
      ],
      [0, 0],
    );
    let best: number[] | null = null,
      score = Infinity;
    for (const initialYaw of [0, -0.25, 0.25]) {
      let p = [
          0,
          initialYaw,
          0,
          Math.log(anchorDiagonal / (radius * 2.5)),
          Math.log(radius * 7),
          ...mean,
        ],
        lambda = 0.01;
      for (let iteration = 0; iteration < 100; iteration++) {
        const r = residual(p),
          cost = r.reduce((s, x) => s + x * x, 0);
        const jac = p.map((value, k) => {
          const q = [...p],
            h = k < 5 ? 1e-5 : 1e-3;
          q[k] = value + h;
          return residual(q).map((x, i) => (x - r[i]) / h);
        });
        const normal = jac.map((col, i) =>
            jac.map(
              (other, j) =>
                col.reduce((s, x, k) => s + x * other[k], 0) +
                (i === j ? lambda : 0),
            ),
          ),
          gradient = jac.map(
            (col) => -col.reduce((s, x, k) => s + x * r[k], 0),
          );
        const delta = solve(normal, gradient);
        if (!delta) break;
        const q = p.map((x, i) => x + Math.max(-0.4, Math.min(0.4, delta[i])));
        // Pixel translation updates need not be limited to subpixel size.
        q[5] = p[5] + Math.max(-30, Math.min(30, delta[5]));
        q[6] = p[6] + Math.max(-30, Math.min(30, delta[6]));
        q[4] = Math.max(
          Math.log(radius * 2),
          Math.min(Math.log(radius * 100), q[4]),
        );
        q[3] = Math.max(Math.log(0.1), Math.min(Math.log(10000), q[3]));
        const next = residual(q).reduce((s, x) => s + x * x, 0);
        if (next < cost) {
          p = q;
          lambda = Math.max(1e-7, lambda / 3);
          if (cost - next < 1e-8) break;
        } else lambda = Math.min(1e8, lambda * 10);
      }
      const error = residual(p).reduce((s, x) => s + x * x, 0);
      if (error < score) {
        score = error;
        best = p;
      }
    }
    if (!best) return { ...empty, detail: "Camera optimization failed." };
    const p = best,
      ex = rotate(v(1, 0, 0), p),
      ey = rotate(v(0, 1, 0), p),
      ez = rotate(v(0, 0, 1), p);
    const row = (axis: "x" | "y" | "z") =>
      add(
        add(scale(right, ex[axis]), scale(down, ey[axis])),
        scale(forward, ez[axis]),
      );
    const depth = Math.exp(p[4]);
    camera = {
      position: subtract(center, scale(row("z"), depth)),
      target: center,
      up: scale(row("y"), -1),
      focal: Math.exp(p[3]) * depth,
      cx: p[5],
      cy: p[6],
    };
  }
  const residuals = points.map(({ l, point }) => {
    const projected = projectPoint(point, camera);
    return {
      id: l.id,
      use: l.use,
      observed: l.pixel,
      projected,
      errorPx: Math.hypot(projected[0] - l.pixel[0], projected[1] - l.pixel[1]),
      uncertaintyPx: l.uncertaintyPx,
    };
  });
  const scored = residuals.filter((r) => r.use === "check"),
    rms = Math.sqrt(
      scored.reduce((s, r) => s + r.errorPx ** 2, 0) / scored.length,
    ),
    max = Math.max(...scored.map((r) => r.errorPx));
  const finite = residuals.every((r) => Number.isFinite(r.errorPx)),
    anchorRms = Math.sqrt(
      residuals
        .filter((r) => r.use === "camera")
        .reduce((s, r) => s + r.errorPx ** 2, 0) / anchors.length,
    );
  const cameraRegion = checkCameraRegion(build, observation, camera);
  const passed =
    cameraRegion.status === "pass" &&
    finite &&
    rms <= diagonal * PROJECTION_TOLERANCE.rms &&
    max <= diagonal * PROJECTION_TOLERANCE.maximum &&
    anchorRms <= diagonal * PROJECTION_TOLERANCE.rms;
  return {
    ...empty,
    camera,
    cameraRegion,
    residuals,
    sourceDiagonalPx: diagonal,
    rmsPx: finite ? rms : null,
    maxPx: finite ? max : null,
    status: passed ? "pass" : cameraRegion.status === "unverified" && finite && rms <= diagonal * PROJECTION_TOLERANCE.rms && max <= diagonal * PROJECTION_TOLERANCE.maximum && anchorRms <= diagonal * PROJECTION_TOLERANCE.rms ? "unverified" : "fail",
    detail: `${anchors.length} camera anchors / 7 camera parameters; ${checks.length} scored landmarks; anchor RMS ${anchorRms.toFixed(2)} px. ${cameraRegion.detail} Independent point agreement only; not complete shape fidelity.`,
  };
}
