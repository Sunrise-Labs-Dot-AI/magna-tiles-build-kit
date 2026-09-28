import { afterEach,describe,expect,it,vi } from "vitest";
import { assemble } from "@/lib/replication/geometry";
import { checkHandAccess,edgeGrips,findHandInsertionPath } from "@/lib/replication/grip";
import * as grips from "@/lib/replication/grip";
import * as insertion from "@/lib/replication/insertion";
import { dockToSupports } from "@/lib/replication/docking";
import { simulateGravitySeat } from "@/lib/replication/seating";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { closedShell } from "./fixtures/closed-shell";
import { assemblyUFixture,seatedRoofFixture } from "./fixtures/assembly";
import { emptyInventory } from "@/lib/magnetic-tiles/catalog";
import type { Replica } from "@/lib/replication/types";

const wallAndRoof=()=>{
  const shell=closedShell(1),wall=shell.tiles.find(t=>t.id==="x-0--1")!,roof=shell.tiles.find(t=>t.id==="roof")!;
  return {wall,roof,build:assemble("access","Wall under roof",[wall,roof],"tower"),hand:edgeGrips(wall)[0]};
};
afterEach(()=>vi.restoreAllMocks());

describe("grip-aware bounded insertion search",()=>{
  it("finds a lateral route when vertical tile clearance hides a fingertip crossing",()=>{
    const {build,wall,roof,hand}=wallAndRoof(),before=structuredClone(build);
    const first=insertion.findInsertionPath(build,[wall.id],[roof.id],Infinity,0)!;
    expect(first.offsets[0].y).toBeGreaterThan(0);
    expect(insertion.validateInsertionPath(build,first,Infinity,0).status).toBe("pass");
    expect(checkHandAccess(build,first,[hand],0).status).toBe("fail");
    const selected=findHandInsertionPath(build,[wall.id],[roof.id],[hand],0)!;
    expect(selected).not.toBeNull();expect(selected.offsets[0].y).toBe(0);
    expect(selected.fixedTileIds).toEqual([roof.id]);
    expect(insertion.validateInsertionPath(build,selected,Infinity,0).status).toBe("pass");
    expect(checkHandAccess(build,selected,[hand],0).status).toBe("pass");
    expect(build).toEqual(before);
    const docking=dockToSupports(build,build,[wall.id],[roof.id],[hand],0,"clear-first");
    expect(docking.status,docking.detail).toBe("pass");
    expect(docking.path!.offsets[0].y).toBe(0);
    expect(checkHandAccess(docking.build,docking.path!,[hand],0).status).toBe("pass");
  });
  it("returns no path for a trapped endpoint or an elevated fixed floor",()=>{
    const {build,wall,roof,hand}=wallAndRoof();
    expect(findHandInsertionPath(build,[wall.id],[roof.id],[edgeGrips(wall)[1]],0)).toBeNull();
    expect(findHandInsertionPath(build,[wall.id],[roof.id],[hand],.5)).toBeNull();
  });
  it("preserves the original first direction when both checks pass",()=>{
    const {build,wall,hand}=wallAndRoof();
    const single={...build,tiles:[wall],connections:[]};
    expect(findHandInsertionPath(single,[wall.id],[],[hand],0)).toEqual(insertion.findInsertionPath(single,[wall.id],[],Infinity,0));
  });
  it("throws if budget expires after tile validation, inside hand checking",()=>{
    const {build,wall,roof,hand}=wallAndRoof(),validate=insertion.validateInsertionPath;
    const clock=vi.spyOn(Date,"now").mockReturnValue(0);
    const spy=vi.spyOn(insertion,"validateInsertionPath").mockImplementation((...args)=>{
      const result=validate(...args);expect(result.status).toBe("pass");clock.mockReturnValue(2);return result;
    });
    expect(()=>findHandInsertionPath(build,[wall.id],[roof.id],[hand],0,1)).toThrow(SimulationBudgetExceeded);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("carries the selected lateral approach in the actual assembly record",async()=>{
    const {build,wall,roof,hand}=wallAndRoof(),hold=edgeGrips(roof)[0];
    const replica:Replica={id:"grip-route",title:"Grip route fixture",sourceId:"fixture",bomFrameId:"fixture",build,
      inventory:emptyInventory(),uncertainties:[],materialQuestions:[],
      stages:[{id:"held",frameId:"fixture",title:"Held L",instruction:"Hold the two separate panels.",tileIds:[roof.id,wall.id],support:"held"}],
      construction:[{stageId:"held",operations:[{tileIds:[roof.id],hands:[hold]},{tileIds:[wall.id],hands:[hand,hold]}]}]};
    const [result]=await evaluateAssembly(replica);
    expect(result.status,result.detail).toBe("pass");
    for(const row of result.operations.filter(o=>o.index===1)){
      const path=row.path!,start=row.carry!.motion[0].tiles.find(t=>t.id===wall.id)!,end=row.carry!.motion.at(-1)!.tiles.find(t=>t.id===wall.id)!;
      expect(path.offsets[0].y).toBe(0);expect(path.offsets[0].x).toBeLessThan(0);
      for(const axis of ["x","y","z"] as const)expect(start.position[axis]-end.position[axis]).toBeCloseTo(path.offsets[0][axis],5);
      const target={...build,tiles:row.approachTiles!};
      expect(insertion.validateInsertionPath(target,path,Infinity,0).status).toBe("pass");
      expect(checkHandAccess(target,path,[hand,hold],0).status).toBe("pass");
      expect(row.trials.at(-1)!.dynamicTileCount).toBe(0);
    }
    // This fixture deliberately holds both panels, so it makes no free-build claim.
    expect(result.checkpoints).toEqual([]);
  },120000);
  it("fails closed at all three runtime callers when no grip-compatible direction exists",async()=>{
    const find=vi.spyOn(grips,"findHandInsertionPath").mockReturnValue(null);
    const {build,wall,roof,hand}=wallAndRoof();
    expect(dockToSupports(build,build,[wall.id],[roof.id],[hand],0,"clear-first").status).toBe("fail");
    expect(find).toHaveBeenCalled();find.mockClear();
    const seated=seatedRoofFixture(),top=seated.build.tiles.find(t=>t.id==="roof")!;
    const seating=await simulateGravitySeat(seated.build,[top.id],[edgeGrips(top)[0]],.55,0,0);
    expect(seating.status).toBe("fail");expect(seating.motion).toEqual([]);expect(find).toHaveBeenCalled();find.mockClear();
    const [assembly]=await evaluateAssembly(assemblyUFixture());
    expect(assembly.status).toBe("fail");
    expect(assembly.rejectedAttempts.flatMap(a=>a.operations).every(o=>!o.carry)).toBe(true);
    expect(find).toHaveBeenCalledTimes(6);
  });
});
