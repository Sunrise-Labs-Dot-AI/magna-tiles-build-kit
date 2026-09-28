import { describe, expect, it } from "vitest";
import { checkSourcePieces, sourcePieceSummary, type SourcePieceRecord, type SourcePieceFrame, type SourcePieceSource } from "@/lib/replication/source-pieces";
import { assemblyUFixture } from "./fixtures/assembly";
import { mediumRamp, smallRamp } from "@/lib/replication/models";
import sources from "@/verification/replication/sources.json";
import manifest from "@/verification/replication/frame-manifest.json";
import ledger from "@/verification/replication/source-pieces.json";

function fixture() {
  const replica = assemblyUFixture();
  const record: SourcePieceRecord = {
    replicaId: replica.id, stageId: "u", sourceId: "fixture", frameId: "fixture", seconds: 5,
    sourceSha256: "a".repeat(64), frameSha256: "b".repeat(64), coverage: "complete",
    observed: replica.build.tiles.map((t,i) => ({ sourcePartId: `observed-${i}`, tileId: t.id, shape: t.shape })),
    minimumVisible: [], inferred: [], proposed: [], basis: "Synthetic complete set for gate semantics.", review: "Synthetic test only.",
  };
  const source: SourcePieceSource = { id: "fixture", sha256: record.sourceSha256,
    frames: [{ id: "fixture", seconds: 5, stage: "u", use: "construction" }] };
  const frames: SourcePieceFrame[] = [{ id: "fixture", sourceId: "fixture", seconds: 5, stage: "u", partition: "construction",
    sourceSha256: record.sourceSha256, sha256: record.frameSha256, path: "public/reference-frames/replication/fixture/fixture.png" }];
  const records = [record];
  const run = (data: unknown = { schema: 1, records }, verified = true) => checkSourcePieces(replica, data, source, frames,
    { status: verified ? "pass" : "unverified", detail: "Synthetic verified-byte input" });
  return { replica, record, source, frames, records, run };
}

describe("reviewed source-stage piece accounting", () => {
  it("accepts an exact complete set without claiming poses, joins or buildability", () => {
    const f = fixture(), result = f.run();
    expect(result[0].status).toBe("pass");
    expect(result[0].observedTileIds.sort()).toEqual([...f.replica.stages[0].tileIds].sort());
    expect(result[0].unaccountedTileIds).toEqual([]);
    expect(result[0].detail).toContain("Pose, joins, motion and independent final-view fidelity remain separate");
    expect(sourcePieceSummary(result).status).toBe("pass");
  });
  it("does not credit prose-only frame links", () => {
    const f = fixture();
    f.replica.stages[0].constructionEvidence = [{ claim: "Everything matches", frameIds: ["fixture"] }];
    expect(f.run({ schema: 1, records: [] })[0].status).toBe("unverified");
  });
  it("does not turn a partial visible set into an exact certificate", () => {
    const f = fixture(); f.record.coverage = "partial";
    f.record.observed = f.record.observed.slice(0,1);
    f.record.minimumVisible = [{ shape: "small-square", count: 2 }];
    const r = f.run()[0];
    expect(r.status).toBe("unverified"); expect(r.unaccountedTileIds).toHaveLength(2);
    f.record.coverage = "complete";
    expect(f.run()[0].status).toBe("fail");
  });
  it.each(["inferred", "proposed"] as const)("keeps %s panels separate from observed panels", category => {
    const f = fixture(); f.record.coverage = "partial";
    f.record[category].push(f.record.observed.pop()!);
    const r = f.run()[0];
    expect(r.status).toBe("unverified"); expect(r.observedTileIds).toHaveLength(2);
    expect(r[category === "inferred" ? "inferredTileIds" : "proposedTileIds"]).toHaveLength(1);
    f.record.coverage = "complete"; expect(f.run()[0].status).toBe("fail");
  });
  it("rejects extra candidate panels outside the exact source set", () => {
    const f = fixture(); f.record.observed.pop();
    expect(f.run()[0]).toMatchObject({ status: "fail", unaccountedTileIds: expect.any(Array) });
    expect(f.run()[0].detail).toContain("outside the complete reviewed source set");
  });
  it("rejects a stage with fewer panels than the visible minimum", () => {
    const f = fixture(); f.record.coverage = "partial";
    f.record.minimumVisible = [{ shape: "small-square", count: 4 }];
    expect(f.run()[0].status).toBe("fail");
  });
  it("cannot accept unavailable local source bytes", () => {
    expect(fixture().run(undefined,false)[0].status).toBe("unverified");
  });
  it.each(["tileId", "sourcePartId"] as const)("rejects duplicate %s across categories", key => {
    const f = fixture(); f.record.coverage = "partial";
    const p = f.record.observed.pop()!; p[key] = f.record.observed[0][key]; f.record.proposed.push(p);
    expect(f.run()[0].status).toBe("fail");
  });
  it.each(["absent", "shape"])("rejects %s mappings", kind => {
    const f = fixture();
    if (kind === "absent") f.record.observed[0].tileId = "unknown";
    else f.record.observed[0].shape = "equilateral-triangle";
    expect(f.run()[0].status).toBe("fail");
  });
  it.each(["sourceId", "sourceSha256", "frameId", "frameSha256", "seconds", "stageId"] as const)("rejects altered %s binding", key => {
    const f = fixture();
    if (key === "seconds") f.record[key]++;
    else f.record[key] = key.endsWith("Sha256") ? "c".repeat(64) : "different";
    expect(f.run()[0].status).toBe("fail");
  });
  it("rejects duplicated stage records and extraction records", () => {
    const f = fixture(); f.records.push(structuredClone(f.record)); expect(f.run()[0].status).toBe("fail");
    f.records.pop(); f.frames.push(structuredClone(f.frames[0])); expect(f.run()[0].status).toBe("fail");
  });
  it.each([null, {}, [null], [{ id: "fixture" }]])("fails closed for a malformed frame manifest %#", frames => {
    const f = fixture();
    const r = checkSourcePieces(f.replica,{ schema: 1, records: f.records },f.source,frames,{status:"pass",detail:"Synthetic"});
    expect(r[0].status).toBe("fail");
  });
  it.each(["sourcePartId","tileId"] as const)("keeps %s stable across source stages", key => {
    const f = fixture();
    f.replica.stages.push({...structuredClone(f.replica.stages[0]),id:"later",frameId:"later"});
    f.source.frames.push({...f.source.frames[0],id:"later",stage:"later"});
    f.frames.push({...f.frames[0],id:"later",stage:"later",path:"public/reference-frames/replication/fixture/later.png"});
    const later = {...structuredClone(f.record),stageId:"later",frameId:"later"};
    f.records.push(later);
    expect(f.run().every(r => r.status === "pass")).toBe(true);
    [later.observed[0][key],later.observed[1][key]] = [later.observed[1][key],later.observed[0][key]];
    expect(f.run().every(r => r.status === "fail")).toBe(true);
  });
  it("does not use heldout frames as construction annotations", () => {
    const f = fixture(); f.source.frames[0].use = "holdout"; f.frames[0].partition = "holdout";
    expect(f.run()[0].status).toBe("fail");
  });
  it.each([null, {}, { schema: 1, records: [null] }, { schema: 99, records: [] }])("rejects malformed ledger %#", data => {
    expect(fixture().run(data)[0].status).toBe("fail");
  });
  it("rejects malformed minimums and repeated shape categories", () => {
    const f = fixture();
    for (const count of [-1,0,1.5,NaN,Infinity]) {
      f.record.minimumVisible = [{ shape: "small-square", count }]; expect(f.run()[0].status).toBe("fail");
    }
    f.record.minimumVisible = [{ shape: "small-square", count: 1 }, { shape: "small-square", count: 2 }];
    expect(f.run()[0].status).toBe("fail");
  });
  it("rejects invalid candidate identities", () => {
    const f = fixture(); f.replica.stages.push(structuredClone(f.replica.stages[0]));
    expect(f.run().every(r => r.status === "fail")).toBe(true);
    f.replica.stages.pop(); f.replica.stages[0].tileIds.push("unknown"); expect(f.run()[0].status).toBe("fail");
  });
  it("leaves the existing medium support and partial canopy unverified", () => {
    const r = checkSourcePieces(mediumRamp(),ledger,sources.sources.find(s => s.id === "henry"),manifest.frames,
      { status: "pass", detail: "Pure binding test; not a local byte-verification claim." });
    expect(r.find(s => s.stageId === "medium-support")?.status).toBe("unverified");
    expect(r.find(s => s.stageId === "medium-lower-walls")?.status).toBe("unverified");
    expect(sourcePieceSummary(r).status).toBe("unverified");
    expect(r.every(s => s.status !== "pass")).toBe(true);
  });
  it("establishes the two reviewed small-ramp component sets without promoting the final stage", () => {
    const result=checkSourcePieces(smallRamp(),ledger,sources.sources.find(s=>s.id==="henry"),manifest.frames,
      {status:"pass",detail:"Pure binding test; not a local byte-verification claim."});
    expect(result.map(r=>[r.stageId,r.status])).toEqual([["small-wedge","pass"],["small-launch","pass"],["small-final","unverified"]]);
    expect(result[0].observedTileIds).toHaveLength(3);
    expect(result[0].observedSets).toMatchObject([{shape:"isosceles-triangle",count:2}]);
    expect(result[1].observedTileIds).toHaveLength(2);
    expect(result[1].observedSets).toMatchObject([{shape:"right-triangle",count:2}]);
    expect(result[1].frameId).toBe("small-construction-seat-32.5");
    expect(sourcePieceSummary(result).status).toBe("unverified");
  });
  it("never turns no stages into an aggregate pass", () => {
    expect(sourcePieceSummary([]).status).toBe("unverified");
  });
});

function setsFixture() {
  const f = fixture();
  const members = f.record.observed.splice(1);
  f.record.observedSets = [{ sourceSetId: "observed-side-set", shape: "small-square", count: 2, tileIds: members.map(p => p.tileId) }];
  const run = (verified = true) => f.run({ schema: 2, records: f.records },verified);
  const later = () => {
    f.replica.stages.push({ ...structuredClone(f.replica.stages[0]),id:"later",frameId:"later" });
    f.source.frames.push({ ...f.source.frames[0],id:"later",stage:"later" });
    f.frames.push({ ...f.frames[0],id:"later",stage:"later",path:"public/reference-frames/replication/fixture/later.png" });
    const record = { ...structuredClone(f.record),stageId:"later",frameId:"later" };
    f.records.push(record);
    return record;
  };
  return { ...f,run,later };
}

describe("observed interchangeable installed sets", () => {
  it("accepts the exact union while keeping unresolved member identities visible", () => {
    const f=setsFixture(), result=f.run()[0];
    expect(result.status).toBe("pass");
    expect(result.observedTileIds).toHaveLength(1);
    expect(result.observedSets).toEqual(f.record.observedSets);
    expect(result.unaccountedTileIds).toEqual([]);
    expect(result.detail).toContain("3 installed panels");
    expect(result.detail).toContain("individual member identities remain unresolved");
    expect(result.detail).toContain("Pose, joins, motion and independent final-view fidelity remain separate");
    result.observedSets[0].tileIds[0]="edited-output";
    expect(f.record.observedSets![0].tileIds).not.toContain("edited-output");
  });
  it("leaves an empty schema2 ledger unverified", () => {
    expect(fixture().run({schema:2,records:[]})[0].status).toBe("unverified");
  });
  it("allows schema2 exact-only records without changing their meaning", () => {
    const f=fixture();f.record.observedSets=[];
    expect(f.run({schema:2,records:f.records})[0].status).toBe("pass");
  });
  it("accepts complete all-set coverage without inventing exact identities", () => {
    const f=setsFixture();f.record.observed=[];
    f.record.observedSets![0].tileIds=[...f.replica.stages[0].tileIds];f.record.observedSets![0].count=3;
    expect(f.run()[0]).toMatchObject({status:"pass",observedTileIds:[],unaccountedTileIds:[]});
  });
  it("counts set members toward observed minima, without deriving members from minima", () => {
    const f=setsFixture();f.record.minimumVisible=[{shape:"small-square",count:3}];
    expect(f.run()[0].status).toBe("pass");
    f.record.observedSets![0].tileIds.pop();f.record.observedSets![0].count--;
    expect(f.run()[0].status).toBe("fail");
  });
  it.each([null,{},[],[null],[{}]])("rejects malformed or missing schema2 set coverage %#", sets => {
    const f=setsFixture();
    const record={...f.record,observedSets:sets};
    expect(checkSourcePieces(f.replica,{schema:2,records:[record]},f.source,f.frames,{status:"pass",detail:"Synthetic"})[0].status).toBe("fail");
  });
  it("rejects absent schema2 fields and any schema1 set field, including empty", () => {
    const f=setsFixture();
    expect(f.run()[0].status).toBe("pass");
    expect(checkSourcePieces(f.replica,{schema:1,records:f.records},f.source,f.frames,{status:"pass",detail:"Synthetic"})[0].status).toBe("fail");
    delete f.record.observedSets;
    expect(f.run()[0].status).toBe("fail");
    f.record.observedSets=[];
    expect(checkSourcePieces(f.replica,{schema:1,records:f.records},f.source,f.frames,{status:"pass",detail:"Synthetic"})[0].status).toBe("fail");
  });
  it("cannot smuggle observed sets into schema1 through an inherited field", () => {
    const f=setsFixture(),{observedSets,...fields}=f.record;
    const record=Object.assign(Object.create({observedSets}),fields);
    expect(checkSourcePieces(f.replica,{schema:1,records:[record]},f.source,f.frames,
      {status:"pass",detail:"Synthetic"})[0].status).toBe("fail");
  });
  it.each([-1,0,1.5,NaN,Infinity,1,3])("rejects invalid or mismatched exact count %s", count => {
    const f=setsFixture();f.record.observedSets![0].count=count;
    expect(f.run()[0].status).toBe("fail");
  });
  it.each(["duplicate", "unknown", "wrong-shape", "missing", "extra"])("rejects %s set members", kind => {
    const f=setsFixture(),set=f.record.observedSets![0];
    if(kind==="duplicate")set.tileIds[1]=set.tileIds[0];
    if(kind==="unknown")set.tileIds[1]="unknown";
    if(kind==="wrong-shape")set.shape="equilateral-triangle";
    if(kind==="missing"){set.tileIds.pop();set.count--;}
    if(kind==="extra"){set.tileIds.push(f.record.observed[0].tileId);set.count++;}
    expect(f.run()[0].status).toBe("fail");
  });
  it("rejects repeated or overlapping sets", () => {
    const f=setsFixture(),set=f.record.observedSets![0];
    f.record.observedSets!.push(structuredClone(set));expect(f.run()[0].status).toBe("fail");
    f.record.observedSets![1].sourceSetId="other-set";expect(f.run()[0].status).toBe("fail");
  });
  it.each(["observed","inferred","proposed"] as const)("rejects overlap with %s identities", category => {
    const f=setsFixture();f.record.coverage="partial";
    f.record[category].push({sourcePartId:"claimed-member",tileId:f.record.observedSets![0].tileIds[0],shape:"small-square"});
    expect(f.run()[0].status).toBe("fail");
  });
  it.each([false,true])("retains stable complete membership across stages, independent of row order (%s)", reverse => {
    const f=setsFixture(),later=f.later();
    later.observedSets![0].tileIds.reverse();if(reverse)f.records.reverse();
    expect(f.run().every(r=>r.status==="pass")).toBe(true);
    later.observedSets![0].sourceSetId="reassigned-set";
    expect(f.run().every(r=>r.status==="fail")).toBe(true);
  });
  it.each(["shape","count","members"])("rejects changed %s even when both stage sets are locally valid", change => {
    const f=setsFixture(),later=f.later(),set=later.observedSets![0];
    const extra=(id:string,shape=set.shape)=>{
      f.replica.build.tiles.push({...structuredClone(f.replica.build.tiles[1]),id,shape});
      return id;
    };
    if(change==="shape") {
      set.shape="equilateral-triangle";
      set.tileIds=[extra("new-triangle-a",set.shape),extra("new-triangle-b",set.shape)];
    }
    if(change==="count") {set.tileIds.push(extra("additional-side"));set.count++;}
    if(change==="members") set.tileIds[0]=extra("replacement-side");
    f.replica.stages[1].tileIds=[...later.observed.map(p=>p.tileId),...set.tileIds];
    // Each stage is independently valid. Only their shared stable sourceSetId
    // makes the two otherwise-complete records contradict one another.
    const earlier=f.records.shift()!;
    expect(f.run()[1].status).toBe("pass");
    f.records.unshift(earlier);
    expect(f.run().every(r=>r.status==="fail"&&r.detail.includes("identities"))).toBe(true);
  });
  it.each([false,true])("rejects source-ID collisions and member reassignment across stages (%s)", reverse => {
    const f=setsFixture(),later=f.later();
    later.observedSets=[];
    later.proposed=[{sourcePartId:"new-identity",tileId:f.record.observedSets![0].tileIds[0],shape:"small-square"}];
    later.coverage="partial";if(reverse)f.records.reverse();
    expect(f.run().every(r=>r.status==="fail")).toBe(true);
    later.proposed=[];later.observed[0].sourcePartId="observed-side-set";
    expect(f.run().every(r=>r.status==="fail")).toBe(true);
  });
  it("cannot bind a whole observed set to a stage containing only one member", () => {
    const f=setsFixture();f.replica.stages[0].tileIds.pop();
    expect(f.run()[0].status).toBe("fail");
  });
  it("keeps partial coverage and missing local source bytes unverified", () => {
    const f=setsFixture();expect(f.run(false)[0].status).toBe("unverified");
    f.record.coverage="partial";expect(f.run()[0].status).toBe("unverified");
  });
  it.each(["sourceSha256","frameSha256","frameId","sourceId"] as const)("rejects altered %s on a set record", key => {
    const f=setsFixture();f.record[key]=key.endsWith("Sha256")?"c".repeat(64):"wrong";
    expect(f.run()[0].status).toBe("fail");
  });
  it("cannot use a reserved holdout as observed construction evidence", () => {
    const f=setsFixture();f.source.frames[0].use="holdout";f.frames[0].partition="holdout";
    expect(f.run()[0].status).toBe("fail");
  });
});
