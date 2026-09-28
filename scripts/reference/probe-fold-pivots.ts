/** Off-path geometry only. Surface pivots are hypotheses, not magnetic models. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createMagneticPhysicsModel } from "../../lib/engine/physics-model";
import { connectionId, worldEdge } from "../../lib/engine/build";
import { TILE_THICKNESS } from "../../lib/engine/constants";
import { add, cross, distance, dot, magnitude, normalize, scale, subtract } from "../../lib/engine/math";
import { RAW_OVERLAP_TOLERANCE, findRawOverlaps } from "../../lib/engine/overlap";
import { tilePrismVertices } from "../../lib/magnetic-tiles/prism-geometry";
import { checkSolidSweep, prismPose } from "../../lib/magnetic-tiles/swept-prisms";
import type { BuildGraph, MagneticConnection, TileInstance, Vec3 } from "../../lib/magnetic-tiles/types";
import { assemble, square, v } from "../../lib/replication/geometry";
import { contactsClosed } from "../../lib/replication/contacts";
import { checkSweptPoses } from "../../lib/replication/rotation-clearance";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";

const script = "scripts/reference/probe-fold-pivots.ts";
const nativeArchive = "runs/diagnostics/2026-09-27-native-fold-corrected.json.gz";
const geometricArchive = "runs/diagnostics/2026-09-27-fold-clearance.json.gz";
const output = "/tmp/magnatiles-fold-pivots.json";
const expectedRuntime = "3a2ed4ddf041cbf7615825b5e75dd6b3132f520d65c19ff662896a1285b5381d";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function rotateTile(tile: TileInstance, anchor: Vec3, axis: Vec3, angle: number): TileInstance {
  const rotate = (p: Vec3) => add(add(scale(p, Math.cos(angle)), scale(cross(axis, p), Math.sin(angle))),
    scale(axis, dot(axis, p) * (1 - Math.cos(angle))));
  assert(tile.basis);
  return { ...tile, position: add(anchor, rotate(subtract(tile.position, anchor))), basis: {
    xAxis: rotate(tile.basis.xAxis), yAxis: rotate(tile.basis.yAxis), zAxis: rotate(tile.basis.zAxis),
  } };
}

function edgeMeasures(build: BuildGraph, connections = build.connections) {
  return connections.map(c => {
    const a = worldEdge(build.tiles.find(t => t.id === c.fromTileId)!, c.fromEdge);
    const b = worldEdge(build.tiles.find(t => t.id === c.toTileId)!, c.toEdge);
    const delta = subtract(b.midpoint, a.midpoint), aa = [a.start, a.end].map(p => dot(p, a.direction));
    const bb = [b.start, b.end].map(p => dot(p, a.direction));
    return { id: connectionId(c), from: a, to: b,
      transverseGap: magnitude(subtract(delta, scale(a.direction, dot(delta, a.direction)))),
      alignment: Math.abs(dot(a.direction, b.direction)),
      overlap: Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) };
  });
}

async function main() {
  const inputPaths = [script, "scripts/reference/probe-native-fold.ts", "scripts/reference/probe-fold-clearance.ts", nativeArchive, geometricArchive];
  const context = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes(inputPaths) };
  assert.equal(context.validationCodeHash, expectedRuntime);
  const nativeBytes = gunzipSync(await readFile(nativeArchive)), geometricBytes = gunzipSync(await readFile(geometricArchive));
  assert.equal(sha(nativeBytes), "227416a245557f4ca7b0c84d751b07db17f63b654e1571f18148fd0f480a97c4");
  assert.equal(sha(geometricBytes), "2106b8302ec227d4b15b056c5959d3af8065b85487172e8bf148ee0f7cbc7080");
  const native = JSON.parse(nativeBytes.toString()) as { rows: { gap: number; direction: number; seed: number; build: BuildGraph; failure: unknown }[] };
  const geometric = JSON.parse(geometricBytes.toString()) as { rows: { gap: number; direction: number; firstEngineFailure: number; firstCallerFailure: number }[] };
  const gap = .09;
  const build = assemble(`native-fold-${gap}`, "Three-panel folding diagnostic", [
    square("root", v(-3, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip"),
    square("middle", v(gap, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip"),
    square("end", v(3 + 2 * gap, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip"),
  ], "tower");
  // The archived JSON omits optional undefined fields such as ports.
  assert.deepEqual(JSON.parse(JSON.stringify(build)), native.rows.find(r => r.gap === gap)!.build);
  const initialClosure = contactsClosed(build);
  assert.equal(initialClosure.status, "pass");
  const model = createMagneticPhysicsModel(build, { drop: false, floorY: 0 });
  assert.equal(model.joints.length, 2);
  assert.deepEqual(model.joints.map(j => [j.fromTileId, j.toTileId]), [["root", "middle"], ["middle", "end"]]);
  const hinges = model.joints.map(j => {
    const a = build.tiles.find(t => t.id === j.fromTileId)!, b = build.tiles.find(t => t.id === j.toTileId)!;
    const anchor = add(a.position, j.fromLocalAnchor), axis = normalize(j.axis);
    assert(distance(anchor, add(b.position, j.toLocalAnchor)) < 1e-12);
    assert(distance(axis, v(0, 1, 0)) < 1e-12);
    return { model: j, anchor, axis };
  });
  const normal = normalize(build.tiles[0].basis!.zAxis);
  assert(build.tiles.every(t => distance(t.basis!.zAxis, normal) < 1e-12));
  const third: MagneticConnection = { fromTileId: "root", fromEdge: 3, toTileId: "end", toEdge: 1, kind: "edge" };
  const rows = [], started = performance.now(), deadline = Date.now() + 5000;
  const checkBudget = () => assert(Date.now() <= deadline, "Geometric diagnostic exceeded five-second compute allowance; do not compete with regression");
  for (const direction of [-1, 1]) for (const proximalOffset of [-TILE_THICKNESS / 2, 0, TILE_THICKNESS / 2])
    for (const distalOffset of [-TILE_THICKNESS / 2, 0, TILE_THICKNESS / 2]) {
      const anchors = [proximalOffset, distalOffset].map((offset, i) => add(hinges[i].anchor, scale(normal, offset)));
      const pose = (degrees: number): BuildGraph => {
        const angle = direction * degrees * Math.PI / 180;
        const proximal = (tile: TileInstance) => rotateTile(tile, anchors[0], hinges[0].axis, angle);
        return { ...build, tiles: [build.tiles[0], proximal(build.tiles[1]),
          proximal(rotateTile(build.tiles[2], anchors[1], hinges[1].axis, angle))] };
      };
      assert(Math.max(...pose(0).tiles.flatMap((tile, i) => tilePrismVertices(tile).map((p, k) =>
        distance(p, tilePrismVertices(build.tiles[i])[k])))) < 1e-12);
      let previous = build;
      const segments = [];
      for (let degrees = 5; degrees <= 120; degrees += 5) {
        checkBudget();
        const actual = pose(degrees);
        assert.deepEqual(actual.connections, build.connections);
        const engine = checkSolidSweep(previous.tiles.map(prismPose), actual.tiles.map(prismPose), 0, RAW_OVERLAP_TOLERANCE, checkBudget);
        const caller = checkSweptPoses(previous, actual, 0, deadline);
        segments.push({ fromDegrees: degrees - 5, toDegrees: degrees, engine, caller,
          retainedClosure: contactsClosed(actual), retainedEdges: edgeMeasures(actual),
          endpointOverlaps: findRawOverlaps(actual.tiles), endpointGroundPenetration: Math.max(0, ...actual.tiles.flatMap(t => tilePrismVertices(t).map(p => -p.y))),
          endpoint: actual.tiles });
        previous = actual;
      }
      const ring = { ...previous, connections: [...previous.connections, third] };
      const thirdClosure = contactsClosed({ ...previous, tiles: [previous.tiles[0], previous.tiles[2]], connections: [third] });
      const wholeRingClosure = contactsClosed(ring);
      const baseline = geometric.rows.find(r => r.gap === gap && r.direction === direction)!;
      rows.push({ direction, proximalOffset, distalOffset, anchors,
        firstEngineFailure: segments.find(s => s.engine.failure)?.toDegrees ?? null,
        firstCallerFailure: segments.find(s => s.caller.status !== "pass")?.toDegrees ?? null,
        firstSampledRetainedClosureFailure: segments.find(s => s.retainedClosure.status !== "pass")?.toDegrees ?? null,
        allSolidIntervalsClear: segments.every(s => !s.engine.failure && s.caller.status === "pass"),
        allSampledRetainedContactsClosed: segments.every(s => s.retainedClosure.status === "pass"),
        terminal: { proposedThirdConnection: third, thirdClosure, thirdEdge: edgeMeasures(previous, [third])[0], wholeRingClosure },
        zeroOffsetComparison: proximalOffset === 0 && distalOffset === 0 ? { priorTwoPanel: baseline,
          priorNativeFailures: native.rows.filter(r => r.gap === gap && r.direction === direction).map(r => ({ seed: r.seed, failure: r.failure })) } : null,
        segments });
    }
  assert.equal(rows.length, 18);
  assert(rows.every(r => r.segments.length === 24));
  const computeSeconds = (performance.now() - started) / 1000;
  const finalContext = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes(inputPaths) };
  assert.deepEqual(finalContext, context);
  const evidence = { scope: "Prescribed geometry only. Continuous clearance applies to piecewise linear/slerped intervals, not the exact curved hinge motion; contacts are checked only at samples. No native, material, grip, assembly, release or source acceptance.",
    context, finalContext, completed: true, nativeDynamicsRun: false, requiredRows: 18, computeSeconds,
    gap, normal, build, hinges, initialClosure, initialEdges: edgeMeasures(build), rows };
  await writeFile(`${output}.tmp`, JSON.stringify(evidence, null, 2) + "\n");
  await rename(`${output}.tmp`, output);
  console.log(JSON.stringify({ computeSeconds, rows: rows.map(({ direction, proximalOffset, distalOffset, firstEngineFailure, firstCallerFailure,
    firstSampledRetainedClosureFailure, terminal }) => ({ direction, proximalOffset, distalOffset, firstEngineFailure, firstCallerFailure,
    firstSampledRetainedClosureFailure, terminalThird: terminal.thirdClosure.status, wholeRing: terminal.wholeRingClosure.status })) }, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
