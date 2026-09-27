import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // Rapier release/assembly checks are CPU-bound; avoid worker oversubscription.
    maxWorkers: 2,
    // Load the vendored CJS/WASM artifact through Node, preserving its single
    // module instance instead of transforming the generated bundle as app code.
    server: { deps: { external: [/vendor\/rapier-contact\/rapier\.cjs$/] } },
    testTimeout: 30000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
