import { describe, expect, it, vi } from "vitest";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { prepareSeparatingAxes, separatingAxes, separatingAxesFromPrepared } from "@/lib/replication/insertion";
import { checkSweptPoses } from "@/lib/replication/rotation-clearance";
import { checkSweptPoses as oracleSweep, separatingAxes as oracleAxes } from "./fixtures/rotation-clearance-oracle";

const shapes: TileShape[] = ["small-square", "large-square", "xl-square", "equilateral-triangle", "right-triangle", "isosceles-triangle"];
const tile = (id: string, shape: TileShape = "small-square"): TileInstance => ({
  id, shape, position: { x: 0, y: 8, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, color: "blue", step: 1, role: "fixture",
});
const graph = (tiles: TileInstance[]): BuildGraph => ({
  id: "oracle", prompt: "", title: "Oracle comparison", family: "tower", seed: 0, summary: "", tiles,
  connections: [], bounds: { width: 20, height: 20, depth: 20 },
});
const equalAxes = (actual: Vec3[], expected: Vec3[]) => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) for (const key of ["x", "y", "z"] as const)
    expect(Object.is(actual[i][key], expected[i][key]), `axis ${i}.${key}`).toBe(true);
};
const compare = (before: BuildGraph, after: BuildGraph, floor = 0) => {
  const frozen = structuredClone({ before, after });
  const expected = oracleSweep(before, after, floor), actual = checkSweptPoses(before, after, floor);
  expect(actual).toEqual(expected);
  expect({ before, after }).toEqual(frozen);
  return actual;
};

describe("prepared swept clearance against the frozen original", () => {
  it("preserves every ordered axis scalar for all shapes and adversarial direct inputs", () => {
    const variants = shapes.flatMap((shape, index) => {
      const base = tile(`shape-${index}`, shape);
      const euler = { ...base, rotation: { x: 13 + index, y: -29, z: 71 } };
      const basis = { ...euler, basis: basisFromEuler(13 + index, -29, 71) };
      const reflected = structuredClone(basis); reflected.basis.zAxis.x *= -1; reflected.basis.zAxis.y *= -1; reflected.basis.zAxis.z *= -1;
      const zero = { ...base, position: { x: -0, y: 0, z: -0 }, rotation: { x: -0, y: 0, z: -0 } };
      const nearParallel = { ...base, rotation: { x: 1e-12, y: -1e-9, z: 1e-7 } };
      const huge = { ...base, position: { x: 1e150, y: -1e150, z: 1e150 } };
      // These direct-call inputs are equivalence controls, never valid-engine input evidence.
      const nonfinite = { ...base, position: { x: NaN, y: Infinity, z: -Infinity } };
      return [base, euler, basis, reflected, zero, nearParallel, huge, nonfinite];
    });
    const prepared = variants.map(prepareSeparatingAxes);
    const frozen = structuredClone(variants);
    for (let i = 0; i < variants.length; i++) for (let j = 0; j < variants.length; j++) {
      const expected = oracleAxes(variants[i], variants[j]);
      equalAxes(separatingAxes(variants[i], variants[j]), expected);
      equalAxes(separatingAxesFromPrepared(prepared[i], prepared[j]), expected);
    }
    expect(variants).toEqual(frozen);
  });

  it("returns identical complete decisions for 2,000 deterministic diverse sweeps", () => {
    let state = 937152;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    let passes = 0, failures = 0;
    for (let sample = 0; sample < 2000; sample++) {
      const before = graph(Array.from({ length: 1 + sample % 4 }, (_, i) => {
        const t = tile(`t-${i}`, shapes[(sample + i) % shapes.length]);
        t.position = { x: (random() - .5) * 16, y: 2 + random() * 8, z: (random() - .5) * 16 };
        t.rotation = { x: random() * 2 * Math.PI, y: random() * 2 * Math.PI, z: random() * 2 * Math.PI };
        if (sample % 3 !== 0) t.basis = basisFromEuler(t.rotation.x, t.rotation.y, t.rotation.z);
        if (sample % 7 === 0 && t.basis) t.basis.zAxis = { x: -t.basis.zAxis.x, y: -t.basis.zAxis.y, z: -t.basis.zAxis.z };
        return t;
      }));
      const after = structuredClone(before);
      for (const t of after.tiles) {
        t.position.x += (random() - .5) * 4; t.position.y += (random() - .5) * 4;
        if (sample % 5 !== 0) t.basis = basisFromEuler(random() * 2 * Math.PI, random() * 2 * Math.PI, random() * 2 * Math.PI);
      }
      if (sample % 11 === 0) after.tiles.reverse();
      const result = compare(before, after);
      if (result.status === "pass") passes++; else failures++;
    }
    expect(passes).toBeGreaterThan(100); expect(failures).toBeGreaterThan(100);
  });

  it("preserves table and pair thresholds, input-set failures and failure ordering", () => {
    for (const offset of [-1e-8, -1e-10, -Number.EPSILON, -0, 0, Number.EPSILON, 1e-10, 1e-8]) {
      const a = tile("a"), b = tile("b");
      b.position.x = 3 - RAW_OVERLAP_TOLERANCE + offset;
      const build = graph([a, b]); compare(build, build);
      const lowest = Math.min(...tilePrismVertices(a).map(p => p.y));
      compare(graph([a]), graph([a]), lowest + RAW_OVERLAP_TOLERANCE + offset);
    }
    const build = graph([tile("first"), tile("second"), tile("third")]);
    expect(compare(build, build).detail).toBe("second intersects first during rotation/translation.");
    for (const after of [graph([]), graph([tile("renamed")]), graph([tile("first", "right-triangle")])])
      expect(compare(graph([tile("first")]), after).status).toBe("fail");
    for (const floor of [NaN, Infinity, -Infinity]) expect(compare(build, build, floor).status).toBe("fail");
    compare(graph([]), graph([]));
  });

  it("retains between-endpoint collisions, table crossings and subdivision exhaustion", () => {
    const moving = tile("moving"), obstacle = tile("obstacle");
    moving.position = { x: 0, y: 3, z: 0 };
    obstacle.position = { x: 1.95, y: 3, z: 0 };
    obstacle.basis = { xAxis: { x: 0, y: 1, z: 0 }, yAxis: { x: 0, y: 0, z: 1 }, zAxis: { x: 1, y: 0, z: 0 } };
    const turned = { ...moving, basis: { xAxis: { x: 0, y: 1, z: 0 }, yAxis: { x: -1, y: 0, z: 0 }, zAxis: { x: 0, y: 0, z: 1 } } };
    const before = graph([moving, obstacle]), after = graph([turned, obstacle]);
    expect(compare(before, before).status).toBe("pass"); expect(compare(after, after).status).toBe("pass");
    expect(compare(before, after).status).toBe("fail");
    moving.position.y = 1.6;
    expect(compare(graph([moving]), graph([moving])).status).toBe("pass");
    expect(compare(graph([moving]), graph([{ ...turned, position: moving.position }])).status).toBe("fail");
    // Translation parallel to an exactly threshold-touching floor cannot certify
    // a positive motion bound before exhausting the original depth allowance.
    const start = tile("tangent"), end = structuredClone(start); end.position.x += 1;
    const floor = Math.min(...tilePrismVertices(start).map(p => p.y)) + RAW_OVERLAP_TOLERANCE;
    expect(compare(graph([start]), graph([end]), floor).detail).toBe("Swept clearance cannot be certified within the subdivision budget.");
  });

  it("checks the same deadline at every recursive entry", () => {
    const start = tile("deadline"), end = structuredClone(start); end.position.x += 1;
    const floor = Math.min(...tilePrismVertices(start).map(p => p.y)) + RAW_OVERLAP_TOLERANCE;
    for (const execute of [oracleSweep, checkSweptPoses]) {
      let calls = 0;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => ++calls);
      try {
        expect(() => execute(graph([start]), graph([end]), floor, 4)).toThrow(SimulationBudgetExceeded);
        expect(calls).toBe(5);
      } finally { clock.mockRestore(); }
    }
  });
});
