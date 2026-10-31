import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import base from "./gyroscopic-tile-probe.config";

// A counterfactual for the one failed regression control: change only the
// explicitly unpatched f32 world's step back to the historical reproduction.
// The corrected engine and its positive-contact row keep their finer step.
export default defineConfig({ ...base,
  plugins: [...(base.plugins ?? []), { name: "historical-negative-control-step", enforce: "pre", load(id) {
    if (!id.endsWith("/tests/fixtures/unpatched-contact.ts")) return null;
    const code = readFileSync(id, "utf8");
    const before = "export async function unpatchedContactControl() {";
    assert.equal(code.split(before).length - 1, 1);
    return code.replace(before, `${before}\n  const MAX_COLLISION_TIMESTEP_SECONDS = 1 / 1920;`)
      .replace("    return { contacts,depthExcess };", "    console.log(JSON.stringify({ control: 'original-f32', dt: MAX_COLLISION_TIMESTEP_SECONDS, contacts, depthExcess }));\n    return { contacts,depthExcess };");
  } }],
  test: { ...base.test, include: ["tests/triangle-contact.test.ts"], testNamePattern: /detects the old touching-prism/ },
});
