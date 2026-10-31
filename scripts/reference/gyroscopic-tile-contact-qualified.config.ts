import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import base from "./gyroscopic-tile-probe.config";

export default defineConfig({ ...base,
  plugins: [{ name: "frozen-historical-negative-control", enforce: "pre", load(id) {
    if (!id.endsWith("/tests/triangle-contact.test.ts")) return null;
    const code = readFileSync(id, "utf8");
    const before = 'import { unpatchedContactControl } from "./fixtures/unpatched-contact";';
    assert.equal(code.split(before).length - 1, 1);
    return code.replace(before, 'import { unpatchedContactControl } from "@/scripts/reference/gyroscopic-frozen-negative-control";');
  } }, ...(base.plugins ?? [])],
});
