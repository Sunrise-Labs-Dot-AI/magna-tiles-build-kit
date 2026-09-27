import {transformLocal} from "@/lib/engine/math";
import {assemble} from "@/lib/replication/geometry";
import {edgeGrips} from "@/lib/replication/grip";
import {bridgePanelFixture} from "./bridge-panel";
import {closedShell} from "./closed-shell";

/** A connected, genuinely assembled seven-panel predecessor owns its six
 * joints. A later nominal graph may propose an old edge without earning it. */
export function continuedPrefixFixture(extraOldJoin=true,futurePanels=false){
  const replica=bridgePanelFixture(),shell=closedShell(1);
  replica.build.tiles=replica.build.tiles.filter(t=>t.id!=="bystander");
  replica.stages=replica.stages.filter(s=>s.id!=="bystander");
  replica.construction=replica.construction!.filter(p=>p.stageId!=="bystander");
  const last=replica.stages.at(-1)!;
  last.tileIds=last.tileIds.filter(id=>id!=="bystander");last.installedStageIds=["left","right"];
  replica.construction.at(-1)!.operations[0].bridgeInsertion!.afterStageId="right";
  const front={...shell.tiles.find(t=>t.id==="z-0-1")!,id:"right-front"};
  front.position={...front.position,x:front.position.x+3.18};
  const incoming=[front];
  if(futurePanels){
    const wall={...front,id:"future-wall",position:{...front.position,x:45,y:front.position.y-9}};
    const roof={...shell.tiles.find(t=>t.id==="roof")!,id:"future-roof"};
    roof.position={...roof.position,x:45,y:roof.position.y-9};incoming.push(wall,roof);
  }
  replica.build=assemble("continued-prefix","Continue only earned predecessor joints",[...replica.build.tiles,...incoming],"tower");
  if(extraOldJoin)replica.build.connections.push({kind:"edge",fromTileId:"left-z-0--1",fromEdge:0,toTileId:"right-z-0--1",toEdge:0});
  if(futurePanels)replica.build.connections.push({kind:"edge",fromTileId:front.id,fromEdge:1,toTileId:"future-wall",toEdge:3});
  replica.stages.push({id:"extension",frameId:"fixture",title:"Add one front panel",instruction:"Insert the front panel and release.",
    tileIds:[...last.tileIds,...incoming.map(t=>t.id)],installedStageIds:["bridge"],support:"released"});
  replica.construction.push({stageId:"extension",operations:incoming.map(tile=>({tileIds:[tile.id],releaseAfter:true,
    hands:[edgeGrips(tile).sort((a,b)=>transformLocal(b.localPoint,tile.position,tile.basis!).y-transformLocal(a.localPoint,tile.position,tile.basis!).y)[0]]}))});
  return replica;
}
