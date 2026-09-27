import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import * as docking from "@/lib/replication/docking";
import * as supports from "@/lib/replication/support";
import * as workspaces from "@/lib/replication/workspace";
import * as motions from "@/lib/replication/held-motion";
import { assemblyUFixture } from "./fixtures/assembly";

afterEach(() => vi.restoreAllMocks());

function withReleaseStage() {
  const r = assemblyUFixture();
  r.stages.push({ ...r.stages[0],id: "release",installedStageIds: ["u"] });
  r.construction!.push({ stageId: "release",operations: [] });
  return r;
}

describe("complete assembly attempts", () => {
  it("restarts all seeds and operations after a later placement fails", async () => {
    const r = assemblyUFixture(), before = structuredClone(r), last = r.build.tiles[2].id;
    const dock = docking.dockToSupports, carry = motions.simulateHeldMotion;
    const starts: unknown[] = [];
    vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async (...args) => {
      if (args[0].tiles.length === 1) starts.push(structuredClone(args[0]));
      return carry(...args);
    });
    vi.spyOn(docking,"dockToSupports").mockImplementation((...args) => {
      const result = dock(...args);
      return args[6] === "clear-first" && args[2].includes(last)
        ? { ...result,status: "fail",detail: "Injected late placement rejection." } : result;
    });
    const [result] = await evaluateAssembly(r);
    expect(result.status).toBe("pass");
    expect(result.dockingPolicy).toBe("support-aligned");
    expect(result.attemptedPolicies).toEqual(["clear-first","support-aligned"]);
    expect(result.operations).toHaveLength(9);
    expect(result.rejectedAttempts).toHaveLength(1);
    expect(result.rejectedAttempts[0].operations.filter(o => o.status === "fail")).toHaveLength(3);
    expect(starts).toHaveLength(6);
    starts.forEach(start => expect(start).toEqual(starts[0]));
    expect(r).toEqual(before);
    expect(JSON.parse(JSON.stringify(result)).operations[1].docking.targetPenetration).toBe(0);
    expect("states" in result.rejectedAttempts[0]).toBe(false);
  },90_000);

  it("never combines successful seeds from different failed policies", async () => {
    const r = withReleaseStage(), last = r.build.tiles[2].id, dock = docking.dockToSupports;
    const counts = { "clear-first": 0,"support-aligned": 0 };
    vi.spyOn(docking,"dockToSupports").mockImplementation((...args) => {
      const result = dock(...args), policy = args[6];
      if (args[2].includes(last)) {
        const count = ++counts[policy];
        if (count === (policy === "clear-first" ? 1 : 2))
          return { ...result,status: "fail",detail: "Injected distinct seed rejection." };
      }
      return result;
    });
    const [first,second] = await evaluateAssembly(r);
    expect(first.status).toBe("fail");
    expect(first.dockingPolicy).toBeNull();
    expect(first.operations).toEqual([]);
    expect(first.checkpoints).toEqual([]);
    expect(first.rejectedAttempts).toHaveLength(2);
    first.rejectedAttempts.forEach(a => expect(a.checkpoints).toHaveLength(2));
    expect(second.status).toBe("unverified");
    expect(second.attemptedPolicies).toEqual([]);
  },90_000);

  it("isolates predecessor state even when a failing successor mutates its input", async () => {
    const r = withReleaseStage(), original = structuredClone(r);
    const select = workspaces.selectWorkspace, support = supports.simulateSupport;
    const snapshots: { value: workspaces.PreparedWorkspace; before: workspaces.PreparedWorkspace }[] = [];
    let successor = false;
    vi.spyOn(workspaces,"selectWorkspace").mockImplementation((...args) => {
      const value = select(...args);
      snapshots.push({ value,before: structuredClone(value) });
      successor = true;
      return value;
    });
    vi.spyOn(supports,"simulateSupport").mockImplementation(async (...args) => {
      const trial = await support(...args);
      if (!successor) return trial;
      args[5]!.bodies[0].position.x += 1;
      args[0].tiles[0].position.z += 1;
      return { ...trial,status: "fail",detail: "Injected successor release rejection." };
    });
    const [first,second] = await evaluateAssembly(r);
    expect(first.status).toBe("pass");
    expect(second.status).toBe("fail");
    expect(second.attemptedPolicies).toEqual(["clear-first","support-aligned"]);
    expect(second.operations).toEqual([]);
    expect(snapshots).toHaveLength(6);
    snapshots.forEach(({ value,before }) => expect(value).toEqual(before));
    expect(r).toEqual(original);
  },90_000);

  it("propagates a budget exception without trying another policy", async () => {
    const error = new SimulationBudgetExceeded();
    const dock = vi.spyOn(docking,"dockToSupports").mockImplementation(() => { throw error; });
    await expect(evaluateAssembly(assemblyUFixture())).rejects.toBe(error);
    expect(dock).toHaveBeenCalledTimes(1);
    expect(dock.mock.calls[0][6]).toBe("clear-first");
  });
});
