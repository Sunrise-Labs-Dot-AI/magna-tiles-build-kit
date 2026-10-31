import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base from "./probe-gyroscopic-semantics.config";
import { gyroFrameFix, gyroPackage, gyroPrecision } from "./gyroscopic-probe-context";

assert(gyroPrecision === "f64" && gyroFrameFix && process.env.MAGNATILES_GYRO_MODE === "on");
const root = fileURLToPath(new URL("../../", import.meta.url));
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const scriptHash = digest(readFileSync(fileURLToPath(import.meta.url)));
const nativeHash = digest(readFileSync(`${gyroPackage}/rapier.cjs`));
const profileHash = digest(readFileSync(new URL("./gyroscopic-f64-profile.json", import.meta.url)));
const identity = `experimental-f64-gyro-principal1-${nativeHash.slice(0, 16)}-profile${profileHash.slice(0, 16)}-loader${scriptHash.slice(0, 16)}`;
const arrays = new Map([["lib/engine/build.ts", 2], ["lib/engine/physics-model.ts", 1], ["lib/engine/rapier-world.ts", 1]]);
function exactlyOnce(code: string, before: string, after: string) {
  assert.equal(code.split(before).length - 1, 1, `Experimental transform must match exactly once: ${before}`);
  return code.replace(before, after);
}

export default defineConfig({ ...base,
  plugins: [{ name: "isolated-gyroscopic-tile-probe", enforce: "pre", load(id) {
    const path = id.split("?")[0], relative = path.startsWith(root) ? path.slice(root.length) : "";
    if (![...arrays.keys(), "lib/engine/backend-identity.ts", "lib/engine/constants.ts"].includes(relative)) return null;
    let code = readFileSync(path, "utf8");
    if (relative === "lib/engine/backend-identity.ts") return `export const PHYSICS_BACKEND_ID = ${JSON.stringify(identity)};`;
    if (arrays.has(relative)) {
      assert.equal(code.split("Float32Array").length - 1, arrays.get(relative));
      code = code.replaceAll("Float32Array", "Float64Array");
    }
    if (relative === "lib/engine/rapier-world.ts") {
      code = `import { configureExperimentalGyro } from "@/scripts/reference/gyroscopic-probe-context";\n${code}`;
      code = exactlyOnce(code, "  body.userData = { tileId: model.tile.id };", "  configureExperimentalGyro(body);\n  body.userData = { tileId: model.tile.id };");
    }
    if (relative === "lib/engine/constants.ts") {
      code = exactlyOnce(code, "export const MAX_COLLISION_TIMESTEP_SECONDS = 1 / 1920;", "export const MAX_COLLISION_TIMESTEP_SECONDS = 2.5e-5;");
      code = exactlyOnce(code, "rigid-contact-v8-solid-sweep-contact480-collision1920-", "experimental-gyro-tile-contact480-collision40000-");
    }
    return code;
  } }],
  test: { ...base.test,
    include: ["scripts/reference/probe-gyroscopic-tile-contact.ts", "tests/triangle-contact.test.ts", "tests/rectangular-contact.test.ts", "tests/polyhedral-contact.test.ts"],
    testNamePattern: /experimental|preserves .* corners|matches corners|phantom deep|finite polyhedral|detects the old touching-prism/,
    maxWorkers: 1, sequence: { concurrent: false }, testTimeout: 120000,
  },
});
