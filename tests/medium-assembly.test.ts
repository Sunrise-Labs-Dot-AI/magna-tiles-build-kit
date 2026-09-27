import { describe,expect,it } from "vitest";
import { mediumRamp } from "@/lib/replication/models";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { sameHandContact } from "@/lib/replication/grip";

describe("medium ramp construction",()=>{
  it("constructs both initial modules and freely releases the complete occupied workspace",async()=>{
    const replica=mediumRamp(),before=structuredClone(replica);
    const [lower,support,...remaining]=await evaluateAssembly(replica);
    expect(lower.status,lower.detail).toBe("pass");
    expect(lower.operations).toHaveLength(12);
    expect(lower.checkpoints).toHaveLength(3);
    expect(lower.rejectedAttempts).toEqual([]);
    for(const seed of [0,17,53]){
      const rows=lower.operations.filter(o=>o.seed===seed);
      expect(rows.map(o=>o.tileIds[0])).toEqual(["lower-side--1","lower-deck-2","lower-side-1","lower-deck-1"]);
      expect(rows.every(o=>o.status==="pass")).toBe(true);
      const pickup=rows[2],last=rows[3];
      expect(pickup.pickupHandoff?.status).toBe("pass");
      expect(pickup.pickupHandoff!.previousHands).toHaveLength(2);
      expect(pickup.pickupHandoff!.retainedHands.map(h=>h.tileId)).toEqual(["lower-deck-2"]);
      expect(pickup.pickup!.dynamicTileCount).toBe(1);
      expect(pickup.path!.offsets[0].y).toBe(0);
      expect(pickup.pickup!.motion[0].tiles).toEqual(pickup.trials[0].motion.at(-1)!.tiles);
      expect(last.lowering?.status).toBe("pass");
      expect(last.lowering!.dynamicTileCount).toBe(3);
      expect(last.trials.at(-2)!.heldTileIds).toEqual(["lower-deck-2"]);
      expect(last.lowering!.motion[0].tiles).toEqual(last.trials.at(-2)!.motion.at(-1)!.tiles);
      expect(last.trials.at(-1)!.heldTileIds).toEqual([]);
      expect(last.trials.at(-1)!.dynamicTileCount).toBe(4);
    }
    for(const checkpoint of lower.checkpoints){
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
      expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.dynamicTileCount).toBe(4);
      expect(checkpoint.solidFailures).toEqual([]);
      expect(checkpoint.poppedJoints).toEqual([]);
    }
    const operations=replica.construction![0].operations;
    const roof=operations[1].hands![0];
    expect(sameHandContact(roof,operations[2].pickup!.hand)).toBe(true);
    expect(sameHandContact(roof,operations[3].hands![1])).toBe(true);
    expect(support.status,support.detail).toBe("pass");
    expect(support.operations).toHaveLength(15);
    expect(support.checkpoints).toHaveLength(3);
    expect(support.rejectedAttempts).toEqual([]);
    expect(replica.construction![1].operations[3].releaseAfter).toBe(true);
    const lowerIds=replica.stages[0].tileIds;
    for(const row of support.operations){
      expect(row.status,row.detail).toBe("pass");
      expect(row.handTransitions?.every(t=>t.status==="pass")).not.toBe(false);
      expect(row.carry!.motion.every(frame=>lowerIds.every(id=>frame.tiles.some(t=>t.id===id)))).toBe(true);
    }
    for(const checkpoint of support.checkpoints){
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
      expect(checkpoint.dynamicTileCount).toBe(9);
      expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.solidFailures).toEqual([]);
      expect(checkpoint.poppedJoints).toEqual([]);
    }
    expect(remaining).toHaveLength(6);
    expect(remaining.every(stage=>stage.status==="unverified")).toBe(true);
    expect(replica).toEqual(before);
    expect(replica.build.tiles).toHaveLength(37);
    expect(replica.stages[0].constructionEvidence).toBeUndefined();
  },300000);
});
