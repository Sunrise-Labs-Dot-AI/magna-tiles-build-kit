import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import production from "../../vitest.config";
import experimental from "./probe-gyroscopic-negative-control.config";

const mode = process.env.MAGNATILES_NEGATIVE_INPUT;
assert(mode === "production" || mode === "experimental");
const base = mode === "production" ? production : experimental;
export default defineConfig({ ...base,
  plugins: [{ name: "capture-negative-native-inputs", enforce: "pre", load(id) {
    if (!id.endsWith("/tests/fixtures/unpatched-contact.ts")) return null;
    let code = readFileSync(id, "utf8");
    const before = "    let contacts = 0,depthExcess = 0;";
    assert.equal(code.split(before).length - 1, 1);
    if (mode === "experimental") code = code.replace("export async function unpatchedContactControl() {", "export async function unpatchedContactControl() {\n  const MAX_COLLISION_TIMESTEP_SECONDS = 1 / 1920;");
    return code.replace(before, `    console.log(JSON.stringify({ negativeInputs: {
      dt: MAX_COLLISION_TIMESTEP_SECONDS,
      joints: engine.joints.map(j => j.model),
      records: records.map(r => ({ tile: r.tile, inputPoints: Array.from(tilePrismPoints(r.tile)),
        sourceTranslation: engine.bodies.get(r.tile.id)!.body.translation(), sourceRotation: engine.bodies.get(r.tile.id)!.body.rotation(),
        translation: r.body.translation(), rotation: r.body.rotation(),
        colliderTranslation: r.collider.translation(), colliderRotation: r.collider.rotation(),
        shape: r.collider.shapeType(), points: r.tile.shape === "small-square" ? null : Array.from(r.collider.vertices()) }))
    } }));\n${before}`).replace("    return { contacts,depthExcess };", "    console.log(JSON.stringify({ negativeResult: { contacts, depthExcess } }));\n    return { contacts,depthExcess };");
  } }, ...(base.plugins ?? [])],
  test: { ...base.test, maxWorkers: 1, include: ["tests/triangle-contact.test.ts"], testNamePattern: /detects the old touching-prism/ },
});
