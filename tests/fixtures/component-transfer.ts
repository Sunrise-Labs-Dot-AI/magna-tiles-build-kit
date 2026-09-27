import { transformLocal } from "@/lib/engine/math";
import { assemble,v } from "@/lib/replication/geometry";
import { edgeGrips } from "@/lib/replication/grip";
import { emptyInventory } from "@/lib/magnetic-tiles/catalog";
import type { Replica } from "@/lib/replication/types";
import type { MagneticConnection } from "@/lib/magnetic-tiles/types";
import { closedShell } from "./closed-shell";
import { seatedRoofFixture } from "./assembly";

/** Three independently constructed modules. A roof-braced U is stacked onto its neighbor;
 * a third stays untouched. No source geometry or held-all-parts shortcut. */
export function componentTransferFixture(): Replica {
  const shell=closedShell(1),braced=seatedRoofFixture(),base=["x-0--1","z-0--1","x-0-1"],rename=(id:string)=>`moving-${id}`;
  const moving=braced.stages[0].tileIds.map(rename),third=base.map(id=>`third-${id}`),ids=[...base,...moving];
  const tiles=[...shell.tiles.filter(t=>base.includes(t.id)),...braced.build.tiles.map(t=>({...t,id:rename(t.id),position:{...t.position,y:t.position.y+3}})),...base.map(id=>{
    const tile=structuredClone(shell.tiles.find(t=>t.id===id)!);
    return {...tile,id:`third-${id}`,position:{...tile.position,x:tile.position.x-9,z:tile.position.z+9}};
  })];
  const build=assemble("component-transfer","Stack a prepared braced module beside an independent U",tiles,"tower");
  const grip=(id:string)=>{
    const tile=build.tiles.find(t=>t.id===id)!;
    return edgeGrips(tile).sort((a,b)=>transformLocal(b.localPoint,tile.position,tile.basis!).y-transformLocal(a.localPoint,tile.position,tile.basis!).y)[0];
  };
  const operations=(parts:string[])=>parts.map((id,i)=>({tileIds:[id],hands:i?[grip(id),grip(parts[0])]:[grip(id)]}));
  return {id:build.id,sourceId:"fixture",title:build.title,build,inventory:emptyInventory(),bomFrameId:"fixture",uncertainties:[],materialQuestions:[],
    stages:[
      {id:"base",frameId:"fixture",title:"Base U",instruction:"Assemble three panels and release.",tileIds:base,support:"released"},
      {id:"moving",frameId:"fixture",title:"Moving braced U",instruction:"Assemble independently, seat the roof and release.",tileIds:moving,support:"released"},
      {id:"third",frameId:"fixture",title:"Third U",instruction:"Assemble the third component and release all ten panels.",tileIds:third,support:"released"},
      {id:"transfer",frameId:"fixture",title:"Stack the moving U",instruction:"Acquire one top grip, lift, align and join the base, then release.",tileIds:[...ids,...third],installedStageIds:["base","third"],support:"released"},
      {id:"after-transfer",frameId:"fixture",title:"Continue released workspace",instruction:"Retain both actual component groups at rest.",tileIds:[...ids,...third],installedStageIds:["transfer"],support:"released"},
    ],
    construction:[
      {stageId:"base",operations:operations(base)},
      {stageId:"moving",workspace:{afterStageId:"base",offset:v(6,0,0)},operations:braced.construction![0].operations.map(op=>({...op,tileIds:op.tileIds.map(rename),hands:op.hands!.map(h=>({...h,tileId:rename(h.tileId)}))}))},
      {stageId:"third",workspace:{afterStageId:"moving",offset:v(0,0,0)},operations:operations(third)},
      {stageId:"transfer",operations:[{tileIds:moving,preparedStageId:"moving",transfer:{afterStageId:"third",transitHeight:8},hands:[edgeGrips(build.tiles.find(t=>t.id==="moving-roof")!)[2]],releaseAfter:true}]},
      {stageId:"after-transfer",operations:[]},
    ]};
}

/** The same independently assembled workspace, with one explicit front-edge
 * grip on a receiving wall. The other eight panels remain dynamic during carry. */
export function supportedComponentTransferFixture(): Replica {
  const replica=componentTransferFixture();
  replica.id=replica.build.id="supported-component-transfer";
  replica.title=replica.build.title="Stack a prepared module while steadying one receiving panel";
  replica.stages[3].instruction="Hold the roof of the moving U and the exposed front edge of one receiving wall. Align and join, then withdraw both hands and release.";
  replica.construction![3].operations[0].hands!.push(edgeGrips(replica.build.tiles.find(t=>t.id==="x-0--1")!)[2]);
  return replica;
}

/** A nominal future fixed-to-fixed hypothesis must never enter this operation. */
export const unearnedFixedConnection: MagneticConnection={kind:"edge",fromTileId:"z-0--1",fromEdge:0,toTileId:"third-x-0-1",toEdge:2};
