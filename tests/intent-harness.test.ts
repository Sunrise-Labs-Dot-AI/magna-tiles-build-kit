import { describe, expect, it } from "vitest";
import { parseIntent, validateContract } from "@/lib/harness/contract";
import { compileProgram } from "@/lib/harness/compile";
import { measureIntent } from "@/lib/harness/measure";
import { evaluateCandidate } from "@/lib/harness/evaluate";
import { solveContract } from "@/lib/harness/solve";
import { physicsKey } from "@/lib/harness/cache";
import { validateEngineInput } from "@/lib/engine/input";
import { POST as solveAPI } from "@/app/api/solve-build/route";
import { POST as evaluateAPI } from "@/app/api/evaluate-build/route";
import { POST as designAPI } from "@/app/api/design-build/route";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

const create = (prompt: string, unlimited = false) => {
  const contract = parseIntent(prompt, "classic-100", unlimited)!;
  const build = compileProgram(
    {
      kind: contract.kind,
      ...contract.cells,
      reinforcement: contract.kind === "tunnel" ? "diaphragms" : "shell",
    },
    contract,
  );
  return { contract, build };
};
const remove = (build: BuildGraph, id: string) => {
  build.tiles = build.tiles.filter((t) => t.id !== id);
  build.connections = build.connections.filter(
    (c) => c.fromTileId !== id && c.toTileId !== id,
  );
  for (const tile of build.tiles)
    if (tile.parentTileId === id) {
      tile.parentTileId = undefined;
      tile.parentEdge = undefined;
      tile.childEdge = undefined;
      tile.root = true;
    }
};

describe("intent contracts", () => {
  it("parses quantities as clauses and preserves hard constraints", () => {
    const c = parseIntent(
      "Please build a tunnel two tiles wide and three tiles long with at most 25 pieces",
    )!;
    expect(c.unresolved).toEqual([]);
    expect(c.cells).toMatchObject({ width: 2, depth: 3 });
    expect(c.fixed).toEqual(["width", "depth"]);
    expect(c.maxPieces).toBe(25);
    expect(() => validateContract(c)).not.toThrow();
  });
  it("unlimited mode disables both requested count and set inventory, explicitly", () => {
    const c = parseIntent(
      "a staircase with 5 steps and at most 4 pieces",
      "classic-100",
      true,
    )!;
    expect(c).toMatchObject({ unlimitedPieces: true, maxPieces: null });
    expect(c.assumptions.join(" ")).toContain("caps are disabled");
  });
  it("intersects repeated piece caps rather than letting the last clause win", () => {
    expect(
      parseIntent("a tower at most 10 pieces and at most 30 pieces")!.maxPieces,
    ).toBe(10);
  });
  it.each([
    "a tower with an elevator",
    "a tunnel with a door",
    "an open top box with a lid",
    "an open top tower",
    "a staircase with a slide",
    "a box 2 tiles wide and 3 tiles wide",
    "a tower with 2 levels and 3 levels",
    "a staircase with 2 steps and 3 steps",
  ])(
    "does not silently erase unsupported/contradictory intent: %s",
    async (prompt) => {
      const c = parseIntent(prompt)!;
      expect(c.unresolved.length).toBeGreaterThan(0);
      expect((await solveContract(c)).status).toBe("unsupported");
    },
  );
  it("does not change a fixed cell count to accommodate a conflicting inch limit", () => {
    const c = parseIntent("a tower 2 tiles tall and at least 15 inches tall")!;
    expect(c.cells.height).toBe(2);
    const build = compileProgram(
      { kind: c.kind, ...c.cells, reinforcement: "shell" },
      c,
    );
    expect(
      measureIntent(build, c).find((e) => e.id === "dimension-y")!.passed,
    ).toBe(false);
  });
  it("proves only directly contradictory ranges infeasible", async () => {
    const c = parseIntent(
      "a tower at least 12 inches tall and at most 6 inches tall",
    )!;
    expect((await solveContract(c)).status).toBe("infeasible");
  });
  it.each([NaN, Infinity, 0, 9, 1.5])(
    "rejects unsafe construction size %s",
    (height) => {
      const c = parseIntent("a tower")!;
      c.cells.height = height;
      expect(() => validateContract(c)).toThrow();
    },
  );
});

describe("independent geometry evidence", () => {
  it("preserves Euler-authored tile orientation when measuring a settled proposal", async () => {
    const { build, contract } = create("an open top box");
    const floor = build.tiles.find((t) => t.id.includes("-bottom-"))!;
    floor.basis = undefined;
    floor.rotation = { x: Math.PI / 2, y: 0, z: 0 };
    const evaluated = await evaluateCandidate(build, contract);
    expect(evaluated.evidence.filter((e) => !e.passed)).toEqual([]);
    expect(evaluated.passed).toBe(true);
  });
  it("finds a real raised passage and rejects a blocked or undersized one", () => {
    const c = parseIntent(
      "a tunnel 2 tiles wide and 4 tiles long",
      "classic-100",
      true,
    )!;
    const b = compileProgram(
      { kind: c.kind, ...c.cells, reinforcement: "portal-base" },
      c,
    );
    expect(measureIntent(b, c).filter((e) => !e.passed)).toEqual([]);
    expect(
      measureIntent(b, { ...c, passage: { width: 8, height: 2 } }).find(
        (e) => e.id === "clear-interior",
      )!.passed,
    ).toBe(false);
    const wall = structuredClone(
      b.tiles.find((t) => t.id.startsWith("brace-front"))!,
    );
    wall.id = "blocking-door";
    wall.position.y += 3;
    b.tiles.push(wall);
    expect(
      measureIntent(b, c).find((e) => e.id === "clear-interior")!.passed,
    ).toBe(false);
  });
  it("a braced base cannot evade an explicit outer height constraint", () => {
    const c = parseIntent(
      "a tunnel 2 tiles wide and at most 4 inches tall",
      "classic-100",
      true,
    )!;
    const b = compileProgram(
      { kind: c.kind, ...c.cells, reinforcement: "portal-base" },
      c,
    );
    expect(
      measureIntent(b, c).find((e) => e.id === "dimension-y")!.passed,
    ).toBe(false);
  });
  it.each([
    "a tower 3 tiles tall",
    "an open top box 3 tiles wide and 2 tiles deep",
    "a tunnel 2 tiles wide and 4 tiles long",
    "a staircase with 4 steps and 2 tiles deep",
  ])("compiles different dimensions from catalog geometry: %s", (prompt) => {
    const { build, contract } = create(prompt, true);
    expect(validateEngineInput(build)).toEqual([]);
    expect(measureIntent(build, contract).filter((e) => !e.passed)).toEqual([]);
  });
  it("requires actual intermediate floors when levels are requested", () => {
    const { build, contract } = create("a tower with 3 levels");
    expect(
      measureIntent(build, contract).find((e) => e.id === "level-floors")!
        .passed,
    ).toBe(false);
    const reinforced = compileProgram(
      { kind: contract.kind, ...contract.cells, reinforcement: "diaphragms" },
      contract,
    );
    expect(
      measureIntent(reinforced, contract).find((e) => e.id === "level-floors")!
        .passed,
    ).toBe(true);
  });
  it("does not infer a roof from title, role, bounds, or a claimed passed flag", async () => {
    const { build, contract } = create("a tower");
    remove(build, build.tiles.find((t) => t.id.includes("-top-"))!.id);
    Object.assign(build, {
      title: "Perfect complete roof",
      bounds: { width: 3, height: 6, depth: 3 },
      passed: true,
    });
    const e = await evaluateCandidate(build, contract);
    expect(e.passed).toBe(false);
    expect(e.evidence.find((e) => e.id === "roof")!.passed).toBe(false);
    expect(e.trials).toEqual([]);
  });
  it("rejects a missing floor panel away from the center", () => {
    const { build, contract } = create(
      "an open top box 3 tiles wide and 3 tiles deep",
    );
    remove(build, build.tiles.find((t) => t.id.includes("-bottom-"))!.id);
    expect(
      measureIntent(build, contract).find((e) => e.id === "open-top")!.passed,
    ).toBe(false);
  });
  it("checks tread coverage across the full depth, not just a center line", () => {
    const { build, contract } = create(
      "a staircase with 3 steps and 2 tiles deep",
    );
    remove(build, build.tiles.find((t) => t.id.includes("riser-3-top-"))!.id);
    expect(
      measureIntent(build, contract).find((e) => e.id === "stair-treads")!
        .passed,
    ).toBe(false);
  });
  it("checks inch bounds after settling; catalog cell counts are construction checks", () => {
    const { build, contract } = create(
      "a tower 2 tiles tall and at least 6 inches tall",
    );
    contract.limits.y = { min: 9, max: 12 };
    const evidence = measureIntent(build, contract, "settled");
    expect(evidence.find((e) => e.id === "dimension-y")!.passed).toBe(false);
    expect(evidence.some((e) => e.id === "cells-height")).toBe(false);
  });
  it("unlimited changes only piece acceptance, never geometry requirements", async () => {
    const { build, contract } = create(
      "a staircase with 5 steps and at most 4 pieces",
    );
    // Force an independent semantic failure so no expensive simulation is needed here.
    contract.limits.y = { min: 30, max: 40 };
    const finite = await evaluateCandidate(build, contract);
    const unlimited = await evaluateCandidate(build, {
      ...contract,
      unlimitedPieces: true,
    });
    expect(finite.evidence.find((e) => e.id === "inventory")!.passed).toBe(
      false,
    );
    expect(unlimited.evidence.find((e) => e.id === "inventory")!.passed).toBe(
      true,
    );
    expect(unlimited.passed).toBe(false);
    expect(unlimited.evidence.find((e) => e.id === "dimension-y")!.passed).toBe(
      false,
    );
  });
  it("resource limits are not mislabeled as inventory limits", () => {
    const { build } = create("a tower");
    build.tiles = Array.from({ length: 251 }, (_, i) => ({
      ...build.tiles[0],
      id: String(i),
    }));
    expect(validateEngineInput(build).join(" ")).toContain(
      "not an inventory limit",
    );
  });
  it("content keys change with geometry but not assembly labels", () => {
    const { build } = create("a tower");
    const original = physicsKey(build);
    build.tiles[0].step = 99;
    expect(physicsKey(build)).toBe(original);
    build.tiles[0].position.x += 0.1;
    expect(physicsKey(build)).not.toBe(original);
  });
  it("labels time exhaustion honestly, without changing the contract", async () => {
    const c = parseIntent("a tower at least 12 inches tall")!,
      before = structuredClone(c);
    const r = await solveContract(c, { maxMilliseconds: 1 });
    expect(r.status).toBe("budget-exhausted");
    expect(c).toEqual(before);
    expect(r.evaluation?.passed ?? false).toBe(false);
  });
});

describe("agent API boundaries", () => {
  it.each([solveAPI, evaluateAPI, designAPI])(
    "rejects malformed JSON and null",
    async (handler) => {
      for (const body of ["null", "{bad json"])
        expect(
          (
            await handler(
              new Request("http://localhost", { method: "POST", body }),
            )
          ).status,
        ).toBe(400);
    },
  );
  it("returns a structured unsupported outcome", async () => {
    const response = await solveAPI(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "a spaceship" }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("unsupported");
  });
  it.each([solveAPI, designAPI])(
    "does not coerce a string into an unlimited flag",
    async (handler) => {
      expect(
        (
          await handler(
            new Request("http://localhost", {
              method: "POST",
              body: JSON.stringify({
                prompt: "a tower",
                unlimitedPieces: "false",
              }),
            }),
          )
        ).status,
      ).toBe(400);
    },
  );
});
