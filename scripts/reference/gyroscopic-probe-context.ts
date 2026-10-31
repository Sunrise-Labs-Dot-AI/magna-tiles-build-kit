import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RigidBody } from "../../lib/engine/physics-backend";

export const gyroPrecision = process.env.MAGNATILES_GYRO_PRECISION ?? "f32";
assert(gyroPrecision === "f32" || gyroPrecision === "f64");
export const gyroFrameFix = process.env.MAGNATILES_GYRO_FRAME_FIX === "1";
assert(!gyroFrameFix || gyroPrecision === "f64");
export const gyroRoot = "/tmp/magnatiles-gyroscopic-probe" + (gyroPrecision === "f64" ? "-f64" : "") + (gyroFrameFix ? "-principal-frame" : "");
export const gyroPackage = `${gyroRoot}/source/rapier-compat/builds/3d/pkg`;

export function configureExperimentalGyro(body: RigidBody) {
  const mode = process.env.MAGNATILES_GYRO_MODE;
  if (!mode) return;
  assert(mode === "on" || mode === "off");
  const native = body as RigidBody & { enableGyroscopicForces(enabled: boolean): void; gyroscopicForcesEnabled(): boolean };
  assert.equal(native.gyroscopicForcesEnabled(), false, "The experimental binding must preserve the native false default");
  native.enableGyroscopicForces(mode === "on");
  assert.equal(native.gyroscopicForcesEnabled(), mode === "on");
}

export async function experimentalGyroContext() {
  const mode = process.env.MAGNATILES_GYRO_MODE;
  if (!mode) return null;
  assert(mode === "on" || mode === "off");
  const proofBytes = await readFile(`${gyroRoot}/build-proof.json`), proof = JSON.parse(proofBytes.toString());
  assert.equal(proof.precision ?? "f32", gyroPrecision);
  assert.equal(proof.principalFrameFix ?? false, gyroFrameFix);
  const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  const artifacts: Record<string, string> = {};
  for (const name of ["rapier.cjs", "rapier_wasm3d_bg.wasm"]) {
    artifacts[name] = hash(await readFile(`${gyroPackage}/${name}`));
    assert.equal(artifacts[name], proof.artifacts[name]);
  }
  return { mode, precision: gyroPrecision, principalFrameFix: gyroFrameFix, artifacts, buildProofSha256: hash(proofBytes), scope: "Experimental native gyro binding; no production or source acceptance" };
}
