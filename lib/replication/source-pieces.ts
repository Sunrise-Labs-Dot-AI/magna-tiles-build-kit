import { SHAPE_ORDER } from "@/lib/magnetic-tiles/catalog";
import type { TileShape } from "@/lib/magnetic-tiles/types";
import type { Check, Replica } from "./types";

export interface SourcePartMapping {
  sourcePartId: string;
  tileId: string;
  shape: TileShape;
}
/** The complete installed set is observed; individual serial identities are not. */
export interface ObservedPieceSet {
  sourceSetId: string;
  shape: TileShape;
  count: number;
  tileIds: string[];
}
export interface SourcePieceRecord {
  replicaId: string;
  stageId: string;
  sourceId: string;
  frameId: string;
  seconds: number;
  sourceSha256: string;
  frameSha256: string;
  /** Complete means the reviewed sequence establishes the entire installed set. */
  coverage: "complete" | "partial";
  observed: SourcePartMapping[];
  /** Required in ledger schema2; forbidden in historical schema1. */
  observedSets?: ObservedPieceSet[];
  minimumVisible: { shape: TileShape; count: number }[];
  inferred: SourcePartMapping[];
  proposed: SourcePartMapping[];
  basis: string;
  review: string;
}
export interface SourcePieceResult extends Check {
  stageId: string;
  frameId: string;
  observedTileIds: string[];
  observedSets: ObservedPieceSet[];
  inferredTileIds: string[];
  proposedTileIds: string[];
  unaccountedTileIds: string[];
}
export interface SourcePieceSource {
  id: string;
  sha256: string | null;
  frames: { id: string; seconds: number; stage: string; use: string }[];
}
export interface SourcePieceFrame {
  id: string;
  sourceId: string;
  seconds: number;
  stage: string;
  partition: string;
  sourceSha256: string;
  sha256: string;
  path: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const shape = (value: unknown): value is TileShape => SHAPE_ORDER.includes(value as TileShape);
const mappings = (value: unknown): value is SourcePartMapping[] => Array.isArray(value) && value.every(p =>
  object(p) && text(p.sourcePartId) && text(p.tileId) && shape(p.shape));

const observedSets = (value: unknown): value is ObservedPieceSet[] => Array.isArray(value) && value.every(set =>
  object(set) && text(set.sourceSetId) && shape(set.shape) && typeof set.count === "number" &&
  Number.isSafeInteger(set.count) && set.count > 0 && Array.isArray(set.tileIds) && set.tileIds.every(text) &&
  set.tileIds.length === set.count && new Set(set.tileIds).size === set.count);

function isRecord(value: unknown, schema: 1 | 2): value is SourcePieceRecord {
  if (!object(value)) return false;
  return [value.replicaId,value.stageId,value.sourceId,value.frameId,value.basis,value.review].every(text) &&
    typeof value.seconds === "number" && Number.isFinite(value.seconds) && value.seconds >= 0 &&
    digest(value.sourceSha256) && digest(value.frameSha256) &&
    (value.coverage === "complete" || value.coverage === "partial") &&
    mappings(value.observed) && mappings(value.inferred) && mappings(value.proposed) &&
    (schema === 1 ? !("observedSets" in value) : observedSets(value.observedSets)) &&
    Array.isArray(value.minimumVisible) && value.minimumVisible.every(m => object(m) && shape(m.shape) &&
      typeof m.count === "number" && Number.isSafeInteger(m.count) && m.count > 0);
}

/** Checks reviewed manual piece accounting, not image resemblance or physical
 * buildability. Call only with the source/frame manifest used by local byte
 * verification. Unavailable source bytes can never establish agreement. */
export function checkSourcePieces(replica: Replica, ledger: unknown, source: SourcePieceSource | undefined,
  frames: unknown, verifiedSource: Check): SourcePieceResult[] {
  const validLedger = object(ledger) && (ledger.schema === 1 || ledger.schema === 2) && Array.isArray(ledger.records) &&
    ledger.records.every(record => isRecord(record, ledger.schema as 1 | 2));
  const records: SourcePieceRecord[] = validLedger ? ledger.records as SourcePieceRecord[] : [];
  const targetRecords = records.filter(r => r.replicaId === replica.id);
  const validFrames = Array.isArray(frames) && frames.every(f => object(f) &&
    [f.id,f.sourceId,f.stage,f.partition,f.path].every(text) && digest(f.sourceSha256) && digest(f.sha256) &&
    typeof f.seconds === "number" && Number.isFinite(f.seconds) && f.seconds >= 0);
  const sourceParts = new Map<string,string>(), candidateParts = new Map<string,string>(), sourceSets = new Map<string,string>();
  let inconsistentIdentities = false;
  for (const record of targetRecords) {
    for (const part of [...record.observed,...record.inferred,...record.proposed]) {
      const identity = `part:${part.sourcePartId}`;
      if (sourceParts.has(part.sourcePartId) && sourceParts.get(part.sourcePartId) !== part.tileId ||
        sourceSets.has(part.sourcePartId) ||
        candidateParts.has(part.tileId) && candidateParts.get(part.tileId) !== identity) inconsistentIdentities = true;
      sourceParts.set(part.sourcePartId,part.tileId); candidateParts.set(part.tileId,identity);
    }
    for (const set of record.observedSets ?? []) {
      const identity = `set:${set.sourceSetId}`;
      const signature = JSON.stringify([set.shape,set.count,[...set.tileIds].sort()]);
      if (sourceParts.has(set.sourceSetId) || sourceSets.has(set.sourceSetId) && sourceSets.get(set.sourceSetId) !== signature)
        inconsistentIdentities = true;
      sourceSets.set(set.sourceSetId,signature);
      for (const id of set.tileIds) {
        if (candidateParts.has(id) && candidateParts.get(id) !== identity) inconsistentIdentities = true;
        candidateParts.set(id,identity);
      }
    }
  }
  const unknownStage = targetRecords.some(r => !replica.stages.some(s => s.id === r.stageId));
  const invalidCandidateIds = new Set(replica.stages.map(s => s.id)).size !== replica.stages.length ||
    new Set(replica.build.tiles.map(t => t.id)).size !== replica.build.tiles.length ||
    replica.stages.some(s => s.tileIds.some(id => !replica.build.tiles.some(t => t.id === id)));
  return replica.stages.map(stage => {
    const result: SourcePieceResult = { stageId: stage.id, frameId: stage.frameId, status: "unverified",
      detail: "No reviewed piece accounting for this source stage; a frame link alone cannot establish its installed parts.",
      observedTileIds: [], observedSets: [], inferredTileIds: [], proposedTileIds: [], unaccountedTileIds: [...stage.tileIds] };
    const fail = (detail: string): SourcePieceResult => ({ ...result, status: "fail", detail });
    if (!validLedger || unknownStage || invalidCandidateIds || inconsistentIdentities) return fail("Invalid source-piece ledger, candidate identities or stage binding.");
    const matches = targetRecords.filter(r => r.stageId === stage.id);
    if (matches.length > 1) return fail("Duplicate source-piece stage records.");
    const record = matches[0];
    if (!record) return result;
    if (!validFrames || source && (!Array.isArray(source.frames) || source.frames.some(f => !object(f))))
      return fail("Invalid source-frame manifest or catalog.");
    const catalogFrames = source?.frames.filter(f => f.id === record.frameId) ?? [];
    const extracted = (frames as SourcePieceFrame[]).filter(f => f.id === record.frameId);
    const f = catalogFrames[0], m = extracted[0];
    if (!source || source.id !== replica.sourceId || record.sourceId !== source.id || record.sourceSha256 !== source.sha256 ||
      record.frameId !== stage.frameId || catalogFrames.length !== 1 || extracted.length !== 1 ||
      f.stage !== stage.id || m.stage !== stage.id || f.seconds !== record.seconds || m.seconds !== record.seconds ||
      !["construction","fit"].includes(f.use) || m.partition !== f.use ||
      m.sourceId !== source.id || m.sourceSha256 !== record.sourceSha256 || m.sha256 !== record.frameSha256 ||
      m.path !== `public/reference-frames/replication/${source.id}/${record.frameId}.png`)
      return fail("Piece accounting does not match the declared construction/fitting frame, stage, timestamp or source hashes.");
    const all = [...record.observed,...record.inferred,...record.proposed];
    const sets = record.observedSets ?? [];
    const ids = [...all.map(p => p.tileId),...sets.flatMap(set => set.tileIds)], sourceIds = all.map(p => p.sourcePartId);
    if (new Set(ids).size !== ids.length || new Set(sourceIds).size !== sourceIds.length ||
      new Set(sets.map(set => set.sourceSetId)).size !== sets.length ||
      new Set(stage.tileIds).size !== stage.tileIds.length ||
      new Set(record.minimumVisible.map(p => p.shape)).size !== record.minimumVisible.length)
      return fail("Duplicate candidate/source identities or visible-minimum categories.");
    for (const part of all) {
      const tiles = replica.build.tiles.filter(t => t.id === part.tileId);
      if (tiles.length !== 1 || !stage.tileIds.includes(part.tileId) || tiles[0].shape !== part.shape)
        return fail(`Source part ${part.sourcePartId} maps to an absent, duplicate or differently shaped stage panel.`);
    }
    for (const set of sets) for (const id of set.tileIds) {
      const tiles = replica.build.tiles.filter(tile => tile.id === id);
      if (tiles.length !== 1 || !stage.tileIds.includes(id) || tiles[0].shape !== set.shape)
        return fail(`Observed set ${set.sourceSetId} contains an absent, duplicate or differently shaped stage panel.`);
    }
    for (const minimum of record.minimumVisible) {
      const count = replica.build.tiles.filter(t => stage.tileIds.includes(t.id) && t.shape === minimum.shape).length;
      if (count < minimum.count) return fail(`The stage has ${count} ${minimum.shape} panels; the source establishes at least ${minimum.count}.`);
    }
    result.observedTileIds = record.observed.map(p => p.tileId);
    result.observedSets = structuredClone(sets);
    result.inferredTileIds = record.inferred.map(p => p.tileId);
    result.proposedTileIds = record.proposed.map(p => p.tileId);
    const observedIds = [...result.observedTileIds,...sets.flatMap(set => set.tileIds)];
    result.unaccountedTileIds = stage.tileIds.filter(id => !observedIds.includes(id));
    if (record.coverage === "complete" && (record.inferred.length || record.proposed.length ||
      record.minimumVisible.some(minimum => record.observed.filter(p => p.shape === minimum.shape).length +
        sets.filter(set => set.shape === minimum.shape).reduce((sum,set) => sum + set.count,0) < minimum.count)))
      return fail("A complete observed set cannot be established by inferred/proposed panels or a visible minimum.");
    if (record.coverage === "complete" && result.unaccountedTileIds.length)
      return fail(`Candidate stage contains ${result.unaccountedTileIds.length} panels outside the complete reviewed source set.`);
    if (verifiedSource.status !== "pass") return { ...result, detail: "Source-stage agreement requires locally verified source and frame bytes." };
    const identityDetail = sets.length ? ` ${sets.reduce((sum,set) => sum + set.count,0)} panels belong to observed interchangeable sets; individual member identities remain unresolved.` : "";
    if (record.coverage !== "complete" || !observedIds.length)
      return { ...result, detail: `${observedIds.length} observed panels; coverage is partial.${identityDetail} Visible minimums, inferred and proposed panels cannot establish an exact source-stage set. ${record.basis}` };
    return { ...result, status: "pass", detail: `${observedIds.length} installed panels match the complete reviewed source-stage accounting.${identityDetail} Pose, joins, motion and independent final-view fidelity remain separate checks.` };
  });
}

export function sourcePieceSummary(results: SourcePieceResult[]): Check {
  return { status: results.some(r => r.status === "fail") ? "fail" : results.length && results.every(r => r.status === "pass") ? "pass" : "unverified",
    detail: `${results.filter(r => r.status === "pass").length}/${results.length} source-stage piece sets established. ${results.filter(r => r.status !== "pass").map(r => `${r.stageId}: ${r.detail}`).join(" ")}` };
}
