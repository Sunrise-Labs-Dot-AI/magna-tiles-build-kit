import { describe, expect, it } from "vitest";
import { independentHoldoutCoverage, reservedFrameBinding, type CandidateFreeze, type EvidenceUse } from "@/lib/replication/evidence";
import { compareObservation, projectPoint, checkCameraRegion } from "@/lib/replication/projection";
import { assemble, square, v } from "@/lib/replication/geometry";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { Camera, Observation } from "@/lib/replication/types";

const freeze: CandidateFreeze = { at: "2026-09-26T12:00:00Z", candidateSha256: "c".repeat(64), baselineCandidateSha256: "b".repeat(64) };
function evidence(): EvidenceUse[] {
  return ["front", "back"].map((family, i) => ({ frameId: family, sourceSha256: "a".repeat(64), frameSha256: String(i).repeat(64),
    role: "reserved-holdout", reservedAt: "2026-09-26T11:00:00Z", baselineCandidateSha256: freeze.baselineCandidateSha256,
    inspectedBeforeReservation: false, firstInspectedAt: "2026-09-26T13:00:00Z", viewFamily: family, independenceReviewed: true }));
}
describe("heldout evidence history", () => {
  it("accepts two independently assessed views reserved before freeze and inspection", () => {
    expect(independentHoldoutCoverage(evidence(), ["front", "back"], freeze, freeze.candidateSha256).status).toBe("pass");
  });
  it.each(["relabel", "same-view", "same-bytes", "fit-view", "early-inspection", "late-reservation", "wrong-baseline", "unassessed", "duplicate-id"])("rejects %s as fresh independent coverage", mode => {
    const records = evidence();
    if (mode === "relabel") records[0].inspectedBeforeReservation = true;
    if (mode === "same-view") records[1].viewFamily = records[0].viewFamily;
    if (mode === "same-bytes") records[1].frameSha256 = records[0].frameSha256;
    if (mode === "fit-view") records.push({ ...records[0], frameId: "nearby-fit", role: "fit" });
    if (mode === "early-inspection") records[0].firstInspectedAt = "2026-09-26T11:30:00Z";
    if (mode === "late-reservation") records[0].reservedAt = "2026-09-26T12:30:00Z";
    if (mode === "wrong-baseline") records[0].baselineCandidateSha256 = "d".repeat(64);
    if (mode === "unassessed") records[0].independenceReviewed = false;
    if (mode === "duplicate-id") records.push(records[0]);
    expect(independentHoldoutCoverage(records, ["front", "back"], freeze, freeze.candidateSha256).status).toBe("fail");
  });
  it("rejects a candidate changed after heldout evaluation", () => {
    expect(independentHoldoutCoverage(evidence(), ["front", "back"], freeze, "e".repeat(64)).status).toBe("fail");
  });
  it("requires both a frozen candidate and two independent views", () => {
    expect(independentHoldoutCoverage(evidence(), ["front", "back"]).status).toBe("unverified");
    expect(independentHoldoutCoverage(evidence(), ["front"], freeze, freeze.candidateSha256).status).toBe("unverified");
  });
  it("binds reservations to a verified frame's source, time, role, hash and path", () => {
    const entry = { ...evidence()[0], seconds: 36.25, path: "frame.png" };
    const frame = { id: entry.frameId, seconds: 36.25, use: "holdout" };
    const manifest = { id: entry.frameId, seconds: 36.25, partition: "holdout", sourceSha256: entry.sourceSha256, sha256: entry.frameSha256!, path: entry.path };
    expect(reservedFrameBinding(entry, entry.sourceSha256, frame, manifest).status).toBe("pass");
    for (const changed of [{ sha256: "f".repeat(64) }, { seconds: 36.5 }, { sourceSha256: "e".repeat(64) }, { partition: "fit" }, { path: "elsewhere.png" }])
      expect(reservedFrameBinding(entry, entry.sourceSha256, frame, { ...manifest, ...changed }).status).toBe("fail");
    expect(reservedFrameBinding(entry, entry.sourceSha256, undefined, manifest).status).toBe("fail");
  });
});

function projection(camera: Camera) {
  const tiles = [square("floor", v(0,0,0), v(3,0,0), v(0,0,3), "blue", 1, "fixture"),
    square("wall", v(0,0,0), v(3,0,0), v(0,3,0), "red", 1, "fixture"),
    square("check", v(4,2,0), v(3,0,0), v(0,3,0), "green", 1, "fixture")];
  const build = assemble("camera", "Camera constraints", tiles, "ramp");
  const observation: Observation = { id: "camera", replicaId: "fixture", frameId: "frame", stageId: "stage", partition: "holdout",
    width: 1280, height: 720, viewDirection: v(1,1,2), cameraRegion: { tableY: -0.1, horizontalDirection: v(1,0,2) },
    landmarks: tiles.flatMap(t => tileWorldVertices(t).map((p, vertex) => ({ id: `${t.id}-${vertex}`, tileId: t.id, vertex,
      pixel: projectPoint(p, camera), uncertaintyPx: 1, use: t.id === "check" ? "check" : "camera" }))) };
  return { build, observation };
}
const camera: Camera = { position: v(13,12,24), target: v(1.5,1,1), up: v(0,1,0), focal: 900, cx: 640, cy: 360 };
describe("camera region independent of pixel residual", () => {
  it.each(["above", "below", "opposite"])("checks a perfect-residual %s camera", mode => {
    const c = { ...camera, position: mode === "below" ? v(13,-12,24) : mode === "opposite" ? v(-13,12,-24) : camera.position };
    const { build, observation } = projection(c), result = compareObservation(build, observation, c);
    expect(result.rmsPx).toBe(0);
    expect(result.status).toBe(mode === "above" ? "pass" : "fail");
    expect(result.cameraRegion.status).toBe(mode === "above" ? "pass" : "fail");
  });
  it("does not promote a fit without an observed region", () => {
    const { build, observation } = projection(camera); delete observation.cameraRegion;
    expect(compareObservation(build, observation, camera).status).toBe("unverified");
  });
  it("rejects invalid focal length, degenerate axes and geometry behind the camera", () => {
    const { build, observation } = projection(camera);
    expect(checkCameraRegion(build, observation, { ...camera, focal: -900 }).status).toBe("fail");
    expect(checkCameraRegion(build, observation, { ...camera, up: v(0,0,0) }).status).toBe("fail");
    expect(checkCameraRegion(build, observation, { ...camera, target: v(30,30,50) }).status).toBe("fail");
  });
});
