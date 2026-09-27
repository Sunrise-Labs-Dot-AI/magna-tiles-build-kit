import { transformLocal } from "@/lib/engine/math";
import { assemble,v } from "@/lib/replication/geometry";
import { edgeGrips } from "@/lib/replication/grip";
import { assemblyUFixture } from "./assembly";
import { closedShell } from "./closed-shell";

/** Two individually assembled independent U supports, joined only when one
 * incoming square reaches their facing top edges. A distant table panel stays
 * an independent, dynamic component throughout the bridge operation. */
export function bridgePanelFixture(){
  const replica=assemblyUFixture(),base=assemblyUFixture(),roof={...closedShell(1).tiles.find(t=>t.id==="roof")!,id:"bridge"};
  const left=base.build.tiles.map(t=>({...t,id:`left-${t.id}`,position:{...t.position,x:t.position.x-3.18}}));
  const right=base.build.tiles.map(t=>({...t,id:`right-${t.id}`,position:{...t.position,x:t.position.x+3.18}}));
  const bystander={...roof,id:"bystander",position:v(9,.09,6)};
  const leftIds=left.map(t=>t.id),rightIds=right.map(t=>t.id);
  const operations=(prefix:string)=>base.construction![0].operations.map(op=>({...op,
    tileIds:op.tileIds.map(id=>`${prefix}-${id}`),hands:op.hands!.map(h=>({...h,tileId:`${prefix}-${h.tileId}`}))}));
  replica.id="bridge-panel-fixture";replica.title="Bridge independently prepared supports";
  replica.build=assemble(replica.id,replica.title,[...left,...right,bystander,roof],"tower");
  replica.stages=[{...base.stages[0],id:"left",tileIds:leftIds},{...base.stages[0],id:"right",tileIds:rightIds},
    {...base.stages[0],id:"bystander",tileIds:[bystander.id]},
    {id:"bridge",frameId:"fixture",title:"Join both supports with one new panel",instruction:"Grip the front edge, lower the bridge to both supports, then release.",
      tileIds:[...leftIds,...rightIds,bystander.id,roof.id],installedStageIds:["left","right","bystander"],support:"released"}];
  const hand=edgeGrips(roof).sort((a,b)=>transformLocal(b.localPoint,roof.position,roof.basis!).z-transformLocal(a.localPoint,roof.position,roof.basis!).z)[0];
  replica.construction=[{stageId:"left",operations:operations("left")},
    {stageId:"right",workspace:{afterStageId:"left",offset:v(0,0,0)},operations:operations("right")},
    {stageId:"bystander",workspace:{afterStageId:"right",offset:v(0,0,0)},operations:[{tileIds:[bystander.id],
      hands:[edgeGrips(bystander)[0]],gravitySeat:{releaseHeight:.6,placement:"table"},releaseAfter:true}]},
    {stageId:"bridge",operations:[{tileIds:[roof.id],hands:[hand],releaseAfter:true,
      bridgeInsertion:{afterStageId:"bystander",connections:replica.build.connections.filter(c=>c.fromTileId===roof.id||c.toTileId===roof.id)}}]}];
  return replica;
}
