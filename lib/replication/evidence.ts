import type { Check } from "./types";

export interface EvidenceUse {
  frameId: string;
  replicaId?: string;
  seconds?: number;
  path?: string;
  sourceSha256: string;
  frameSha256: string | null;
  role: "historical" | "fit" | "reserved-holdout";
  reservedAt: string | null;
  baselineCandidateSha256: string | null;
  inspectedBeforeReservation: boolean;
  firstInspectedAt: string | null;
  viewFamily: string;
  independenceReviewed: boolean;
}
export function reservedFrameBinding(entry: EvidenceUse, expectedSourceSha256: string, frame: { id: string; seconds: number; use: string } | undefined,
  verifiedManifest: { id: string; seconds: number; partition: string; sourceSha256: string; sha256: string; path: string } | undefined): Check {
  const m = verifiedManifest;
  const pass = !!frame && !!m && entry.role === "reserved-holdout" && entry.sourceSha256 === expectedSourceSha256 &&
    frame.id === entry.frameId && m.id === entry.frameId && entry.seconds === frame.seconds && m.seconds === frame.seconds &&
    frame.use === "holdout" && m.partition === "holdout" && m.sourceSha256 === expectedSourceSha256 &&
    m.sha256 === entry.frameSha256 && m.path === entry.path;
  return { status: pass ? "pass" : "fail", detail: pass ? "Reservation matches the verified extraction record." : `Reserved frame ${entry.frameId} is not bound to the verified source extraction.` };
}
export interface CandidateFreeze {
  at: string;
  candidateSha256: string;
  baselineCandidateSha256: string;
}

/** A reviewable use ledger is required in addition to byte hashes. Adjacent frames
 * from a fitting view do not create independent coverage. Unassessed views get none.
 * This validates declared provenance; it cannot prove a human never saw a frame.
 */
export function independentHoldoutCoverage(entries: EvidenceUse[], frameIds: string[], freeze?: CandidateFreeze, currentCandidateSha256?: string): Check {
  const sha = (s: string | null) => !!s && /^[a-f0-9]{64}$/.test(s);
  if (!freeze || !currentCandidateSha256 || !Number.isFinite(Date.parse(freeze.at)) || !sha(freeze.candidateSha256) || !sha(freeze.baselineCandidateSha256))
    return { status: "unverified", detail: "No frozen candidate and reservation baseline for an independent evaluation." };
  if (freeze.candidateSha256 !== currentCandidateSha256)
    return { status: "fail", detail: "Candidate changed after freeze; heldout evidence cannot certify a tuned replacement." };
  const historicalFamilies = new Set(entries.filter(e => e.role !== "reserved-holdout" || e.inspectedBeforeReservation).map(e => e.viewFamily));
  const families = new Set<string>(), digests = new Set<string>();
  for (const id of frameIds) {
    const matches = entries.filter(e => e.frameId === id), e = matches[0];
    if (matches.length !== 1 || !e || e.role !== "reserved-holdout" || e.inspectedBeforeReservation ||
        !e.independenceReviewed || !e.viewFamily || e.viewFamily === "unassessed" || historicalFamilies.has(e.viewFamily) ||
        !sha(e.frameSha256) || !sha(e.sourceSha256) || e.baselineCandidateSha256 !== freeze.baselineCandidateSha256 ||
        !e.reservedAt || !e.firstInspectedAt || !Number.isFinite(Date.parse(e.reservedAt)) || !Number.isFinite(Date.parse(e.firstInspectedAt)) ||
        Date.parse(e.reservedAt) > Date.parse(freeze.at) || Date.parse(e.firstInspectedAt) <= Date.parse(freeze.at) ||
        families.has(e.viewFamily) || digests.has(e.frameSha256!))
      return { status: "fail", detail: `Frame ${id} is historical, unassessed, duplicated, or not reserved before candidate freeze and inspection.` };
    families.add(e.viewFamily);
    digests.add(e.frameSha256!);
  }
  return { status: families.size >= 2 ? "pass" : "unverified", detail: `${families.size}/2 independent reserved view families satisfy the declared evidence history. Shape coverage and pixel agreement remain separate.` };
}
