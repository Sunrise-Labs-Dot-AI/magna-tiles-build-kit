import { describe,expect,it } from "vitest";
import { mediumRamp } from "@/lib/replication/models";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { sameHandContact } from "@/lib/replication/grip";
import { MAX_STANDING_DISPLACEMENT } from "@/lib/engine/constants";

describe("medium ramp construction",()=>{
  it("constructs both wedges and support, places them and joins the blue turn in one workspace",async()=>{
    const replica=mediumRamp(),before=structuredClone(replica);
    const [lower,upper,support,transfer,placement,bridge,...remaining]=await evaluateAssembly(replica);
    expect([lower,upper,support,transfer].map(stage=>stage.stageId)).toEqual([
      "medium-lower","medium-upper-preparation","medium-support","medium-upper-transfer",
    ]);
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
    const lowerIds=replica.stages[0].tileIds,upperIds=replica.stages[1].tileIds;
    expect(upper.status,upper.detail).toBe("pass");
    expect(upper.operations).toHaveLength(12);
    expect(upper.checkpoints).toHaveLength(3);
    expect(upper.rejectedAttempts).toEqual([]);
    for(const row of upper.operations){
      expect(row.status,row.detail).toBe("pass");
      expect(row.carry!.motion.every(frame=>lowerIds.every(id=>frame.tiles.some(t=>t.id===id)))).toBe(true);
    }
    for(const checkpoint of upper.checkpoints){
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
      expect(checkpoint.dynamicTileCount).toBe(8);
      expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.solidFailures).toEqual([]);
      expect(checkpoint.poppedJoints).toEqual([]);
    }
    expect(support.status,support.detail).toBe("pass");
    expect(support.operations).toHaveLength(15);
    expect(support.checkpoints).toHaveLength(3);
    expect(support.rejectedAttempts).toEqual([]);
    expect(replica.construction![2].operations[3].releaseAfter).toBe(true);
    for(const row of support.operations){
      expect(row.status,row.detail).toBe("pass");
      expect(row.handTransitions?.every(t=>t.status==="pass")).not.toBe(false);
      expect(row.carry!.motion.every(frame=>[...lowerIds,...upperIds].every(id=>frame.tiles.some(t=>t.id===id)))).toBe(true);
    }
    for(const checkpoint of support.checkpoints){
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
      expect(checkpoint.dynamicTileCount).toBe(13);
      expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.solidFailures).toEqual([]);
      expect(checkpoint.poppedJoints).toEqual([]);
    }
    expect(transfer.status,transfer.detail).toBe("pass");
    expect(transfer.operations).toHaveLength(3);
    expect(transfer.checkpoints).toHaveLength(3);
    expect(transfer.rejectedAttempts).toEqual([]);
    for(const row of transfer.operations){
      expect(row.status,row.detail).toBe("pass");
      expect(row.transfer!.earnedCrossConnectionIds).toHaveLength(2);
      expect(row.transfer!.earnedCrossConnectionIds.every(id=>id.includes("upper-")&&id.includes("support-"))).toBe(true);
      expect(row.transfer!.earnedComponentGroups.map(group=>group.length).sort((a,b)=>a-b)).toEqual([4,9]);
      expect(row.transfer!.earnedComponentGroups.some(group=>group.length===4&&lowerIds.every(id=>group.includes(id)))).toBe(true);
      expect(row.carry!.completion).toBe("contact-arrival");
      expect(row.carry!.motion.every(frame=>frame.tiles.length===13)).toBe(true);
      expect(row.trials.at(-1)!.heldTileIds).toEqual([]);
    }
    for(const checkpoint of transfer.checkpoints){
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
      expect(checkpoint.dynamicTileCount).toBe(13);
      expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.solidFailures).toEqual([]);
      expect(checkpoint.poppedJoints).toEqual([]);
    }
    for(const stage of [lower,upper,support,transfer]){
      expect(stage.terminalConnections!.map(record=>record.seed)).toEqual([0,17,53]);
      expect(stage.terminalConnections!.every(record=>JSON.stringify(record.connectionIds)===JSON.stringify(stage.terminalConnections![0].connectionIds))).toBe(true);
    }
    expect(transfer.terminalConnections!.every(record=>record.connectionIds.length===16)).toBe(true);
    expect(placement.status,placement.detail).toBe("pass");
    expect(placement.operations).toHaveLength(3);expect(placement.checkpoints).toHaveLength(3);
    expect(placement.terminalConnections).toEqual(transfer.terminalConnections);
    // The source model retains an unclosed lower/support proposal. Explicit
    // table mode must neither request that join nor publish it as checked.
    const nominalLowerSupport=replica.build.connections.filter(c=>
      c.fromTileId.startsWith("lower-")&&c.toTileId.startsWith("support-"));
    expect(nominalLowerSupport).toHaveLength(1);
    expect(placement.terminalConnections!.every(record=>record.connectionIds.every(id=>
      !(id.includes("lower-")&&id.includes("support-"))))).toBe(true);
    expect(placement.operations.map(row=>row.seed)).toEqual([0,17,53]);
    for(const [index,row] of placement.operations.entries()){
      expect(row.status,row.detail).toBe("pass");
      expect(row.tablePlacement!.horizontalDisplacement).toBeGreaterThanOrEqual(3);
      expect(row.tablePlacement!.componentGroups.map(g=>g.length).sort((a,b)=>a-b)).toEqual([4,9]);
      expect([...row.carry!.movingComponentTileIds].sort()).toEqual([...lowerIds].sort());
      expect(row.carry!.motion.every(frame=>frame.tiles.length===13)).toBe(true);
      expect(row.seating!.motion.every(frame=>frame.tiles.length===13)).toBe(true);
      expect(row.seating!.earnedJointIds).toEqual([]);
      expect(row.seating!.tableBearingTileIds.length).toBeGreaterThan(0);
      expect(row.seating!.tableBearingTileIds.every(id=>lowerIds.includes(id))).toBe(true);
      const prepared=lower.checkpoints[index].motion.at(-1)!.tiles;
      const final=placement.checkpoints[index];
      expect(final.status,final.detail).toBe("pass");expect(final.dynamicTileCount).toBe(13);
      expect(final.heldTileIds).toEqual([]);expect(final.poppedJoints).toEqual([]);expect(final.solidFailures).toEqual([]);
      const deltas=lowerIds.map(id=>{
        const before=prepared.find(t=>t.id===id)!.position,after=final.motion.at(-1)!.tiles.find(t=>t.id===id)!.position;
        return {x:after.x-before.x,z:after.z-before.z};
      });
      const mean=deltas.reduce((sum,d)=>({x:sum.x+d.x/4,z:sum.z+d.z/4}),{x:0,z:0});
      expect(Math.hypot(mean.x,mean.z)).toBeGreaterThanOrEqual(3);
      for(const delta of deltas){
        expect(Math.hypot(delta.x,delta.z)).toBeGreaterThanOrEqual(3);
        expect(Math.hypot(delta.x-mean.x,delta.z-mean.z)).toBeLessThan(MAX_STANDING_DISPLACEMENT);
      }
    }
    expect(bridge.stageId).toBe("medium-turn");expect(bridge.status,bridge.detail).toBe("pass");
    expect(bridge.rejectedAttempts).toEqual([]);expect(bridge.operations).toHaveLength(3);expect(bridge.checkpoints).toHaveLength(3);
    for(const [index,row] of bridge.operations.entries()){
      expect(row.status,row.detail).toBe("pass");expect(row.tileIds).toEqual(["turn-floor"]);
      expect(row.bridge!.introduction!.bodyIdsBefore).toHaveLength(13);
      expect(row.bridge!.introduction!.bodyIdsAfter).toHaveLength(14);
      expect(row.bridge!.activeJointIdsBeforeClosure).toEqual([...placement.terminalConnections![index].connectionIds].sort());
      expect(row.bridge!.earnedConnectionIds).toHaveLength(2);
      expect(row.bridge!.earnedConnectionIds.every(id=>id.includes("turn-floor")&&(id.includes("upper-deck-1")||id.includes("lower-deck-2")))).toBe(true);
      expect(row.bridge!.earnedComponentGroups.map(g=>g.length)).toEqual([14]);
      expect(row.carry!.completion).toBe("contact-arrival");
      expect(row.carry!.motion.every(frame=>frame.tiles.length===14)).toBe(true);
      expect(row.carry!.separationCheckpoint!.separations.every(pair=>pair.gap>0)).toBe(true);
      expect(row.trials.at(-1)!.heldTileIds).toEqual([]);
      const checkpoint=bridge.checkpoints[index];
      expect(checkpoint.status,checkpoint.detail).toBe("pass");expect(checkpoint.dynamicTileCount).toBe(14);
      expect(checkpoint.heldTileIds).toEqual([]);expect(checkpoint.poppedJoints).toEqual([]);expect(checkpoint.solidFailures).toEqual([]);
      expect(bridge.terminalConnections![index].connectionIds.sort()).toEqual([
        ...placement.terminalConnections![index].connectionIds,...row.bridge!.earnedConnectionIds,
      ].sort());
    }
    expect(remaining).toHaveLength(5);
    expect(remaining.every(stage=>stage.status==="unverified")).toBe(true);
    expect(replica).toEqual(before);
    expect(replica.build.tiles).toHaveLength(37);
    expect(replica.stages[0].constructionEvidence).toBeUndefined();
  // Six stages include continuous upper transfer, lower relocation and one bridge.
  // A measured full run takes 951 seconds; allow 20 minutes of computation.
  // Simulated durations, rest thresholds and physical limits are unchanged.
  },1200000);
});
