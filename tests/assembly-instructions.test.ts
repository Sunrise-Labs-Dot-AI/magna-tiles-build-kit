import {describe,expect,it} from "vitest";
import {connectionId} from "@/lib/engine/build";
import {instructions} from "@/lib/replication/evaluate";
import type {AssemblyResult} from "@/lib/replication/assembly";
import {componentTransferFixture,unearnedFixedConnection} from "./fixtures/component-transfer";

function fixture() {
  const replica=componentTransferFixture();
  replica.build.connections.push(unearnedFixedConnection);
  const stage=replica.stages.find(s=>s.id==="transfer")!;
  const ids=replica.build.connections.filter(c=>connectionId(c)!==connectionId(unearnedFixedConnection)).map(connectionId);
  const assembly:AssemblyResult={stageId:stage.id,status:"pass",detail:"Unit fixture for instruction rendering, not physical evidence.",
    dockingPolicy:"clear-first",attemptedPolicies:["clear-first"],rejectedAttempts:[],operations:[],checkpoints:[],
    terminalConnections:[0,17,53].map(seed=>({seed,connectionIds:[...ids]}))};
  return {replica,stage,assembly,ids};
}
const joinedText=(replica:ReturnType<typeof fixture>["replica"],id:string)=>{
  const c=replica.build.connections.find(c=>connectionId(c)===id)!;
  const label=(id:string)=>`P${replica.build.tiles.findIndex(t=>t.id===id)+1}`;
  return `${label(c.fromTileId)} edge ${c.fromEdge+1} to ${label(c.toTileId)} edge ${c.toEdge+1}`;
};

describe("instructions distinguish terminal assembly joins from proposals",()=>{
  it("keeps standalone instructions explicitly proposed",()=>{
    const {replica}=fixture(),rows=instructions(replica);
    expect(rows.some(r=>r.instruction.includes("Proposed joins (not verified)"))).toBe(true);
    expect(rows.every(r=>!r.instruction.includes("Joins present after assembly checks"))).toBe(true);
  });
  it("uses final joints and does not let earlier nominal proposals hide newly checked joins",()=>{
    const {replica,assembly,ids}=fixture();
    const rows=instructions(replica,[assembly]),row=rows.find(r=>r.title===replica.stages[3].title)!;
    expect(rows[0].instruction).toContain("Proposed joins (not verified)");
    expect(row.instruction).toContain("Joins present after assembly checks");
    for(const id of ids)expect(row.instruction).toContain(joinedText(replica,id));
    expect(row.instruction).not.toContain(joinedText(replica,connectionId(unearnedFixedConnection)));
    expect(row.instruction).toContain("Reuse the numbered parts already assembled.");
  });
  it("compares terminal sets independently of seed and join ordering",()=>{
    const {replica,assembly}=fixture(),before=instructions(replica,[assembly]);
    assembly.terminalConnections!.reverse().forEach(t=>t.connectionIds.reverse());
    expect(instructions(replica,[assembly])).toEqual(before);
  });
  it.each(["missing-terminal","missing-seed","duplicate-seed","wrong-seed","duplicate-join","unknown-join","inconsistent-joins","malformed-joins"])("rejects claimed passing evidence with %s",mode=>{
    const {replica,assembly}=fixture(),terminal=assembly.terminalConnections!;
    if(mode==="missing-terminal")delete assembly.terminalConnections;
    if(mode==="missing-seed")terminal.pop();
    if(mode==="duplicate-seed")terminal[2].seed=17;
    if(mode==="wrong-seed")terminal[2].seed=99;
    if(mode==="duplicate-join")terminal[0].connectionIds.push(terminal[0].connectionIds[0]);
    if(mode==="unknown-join")terminal[0].connectionIds.push("invented");
    if(mode==="inconsistent-joins")terminal[0].connectionIds.pop();
    if(mode==="malformed-joins")terminal[0].connectionIds=null as unknown as string[];
    expect(()=>instructions(replica,[assembly])).toThrow(/terminal assembly/);
  });
  it("rejects duplicate stage evidence",()=>{
    const {replica,assembly}=fixture();
    expect(()=>instructions(replica,[assembly,assembly])).toThrow(/Duplicate assembly evidence/);
  });
  it("never uses failed or rejected-attempt data as checked joins",()=>{
    const {replica,assembly}=fixture();assembly.status="fail";
    assembly.rejectedAttempts=[{policy:"clear-first",status:"fail",detail:"Unit failure",operations:[],checkpoints:[]}];
    const row=instructions(replica,[assembly])[3];
    expect(row.instruction).toContain("Proposed joins (not verified)");
    expect(row.instruction).not.toContain("Joins present after assembly checks");
  });
});
