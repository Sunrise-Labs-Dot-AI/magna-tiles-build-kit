import { assemble,v } from "@/lib/replication/geometry";
import { edgeGrips } from "@/lib/replication/grip";
import { assemblyUFixture,seatedRoofFixture } from "./assembly";

/** A separately constructed braced module moves six inches on the table while
 * a second, released U remains dynamic. No source geometry or added support. */
export function tablePlacementFixture() {
  const replica=seatedRoofFixture(),neighbor=assemblyUFixture(),rename=(id:string)=>`neighbor-${id}`;
  const movingIds=[...replica.stages[0].tileIds],fixedIds=neighbor.stages[0].tileIds.map(rename);
  replica.id="prepared-table-placement";
  replica.build=assemble(replica.id,"Relocate a prepared module beside an independent support",[
    ...replica.build.tiles.map(t=>({...t,position:{...t.position,x:t.position.x+6}})),
    ...neighbor.build.tiles.map(t=>({...t,id:rename(t.id)})),
  ],"tower");
  replica.construction![0].workspace={offset:v(0,0,6)};
  replica.stages.push({...neighbor.stages[0],id:"neighbor",tileIds:fixedIds});
  replica.construction!.push({stageId:"neighbor",workspace:{afterStageId:"u",offset:v(0,0,0)},
    operations:neighbor.construction![0].operations.map(op=>({...op,tileIds:op.tileIds.map(rename),hands:op.hands!.map(h=>({...h,tileId:rename(h.tileId)}))}))});
  replica.stages.push({id:"relocate",frameId:"fixture",title:"Relocate the prepared module",instruction:"Carry to the table destination, release and check rest.",
    tileIds:[...movingIds,...fixedIds],installedStageIds:["neighbor"],support:"released"});
  replica.construction!.push({stageId:"relocate",operations:[{tileIds:movingIds,preparedStageId:"u",
    transfer:{placement:"table",afterStageId:"neighbor",transitHeight:8,releaseHeight:.3},
    hands:[edgeGrips(replica.build.tiles.find(t=>t.id==="roof")!)[2]],releaseAfter:true}]});
  return replica;
}
