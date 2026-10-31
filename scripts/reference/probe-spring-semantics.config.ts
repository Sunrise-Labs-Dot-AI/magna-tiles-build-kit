import { defineConfig } from "vitest/config";
import base from "../../vitest.config";
export default defineConfig({ ...base, test: { ...base.test,
  include: ["scripts/reference/probe-spring-semantics.ts"], maxWorkers: 1, sequence: { concurrent: false },
} });
