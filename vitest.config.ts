import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Many tests run full Rapier gate simulations (~5-15s under load); the
    // 5s default produced load-dependent false timeouts, never real failures.
    testTimeout: 60_000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  }
});
