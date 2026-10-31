import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base from "../../vitest.config";
import { gyroPackage, gyroPrecision } from "./gyroscopic-probe-context";

assert(process.env.MAGNATILES_GYRO_MODE === "on" || process.env.MAGNATILES_GYRO_MODE === "off");
export default defineConfig({ ...base,
  resolve: { alias: { "@magnatiles/rapier-contact": `${gyroPackage}/rapier.cjs`,
    ...(gyroPrecision === "f64" ? { "@/vendor/rapier-contact/profile.json": fileURLToPath(new URL("./gyroscopic-f64-profile.json", import.meta.url)) } : {}),
    "@": fileURLToPath(new URL("../../", import.meta.url)) } },
  test: { ...base.test, include: ["scripts/reference/probe-spring-semantics.ts", "scripts/reference/probe-gyroscopic-free-spin.ts"],
    maxWorkers: 1, sequence: { concurrent: false },
    server: { deps: { external: [/magnatiles-gyroscopic-probe(?:-f64)?(?:-principal-frame)?\/.*\/rapier\.cjs$/] } },
  },
});
