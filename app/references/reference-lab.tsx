"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { TileViewer } from "@/app/components/TileViewer";
import { stageBuild } from "@/lib/replication/geometry";
import { insertionPreview } from "@/lib/replication/insertion";
import { assemblyOperationPreview } from "@/lib/replication/assembly-preview";
import { countInventory } from "@/lib/magnetic-tiles/validation";
import { SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import type { Check, Replica, ReplicaReport } from "@/lib/replication/types";
import sources from "@/verification/replication/sources.json";
import "./references.css";

const titles: Record<string, string> = {
  source: "Source record",
  inventory: "Piece inventory",
  fidelity: "Resemblance to footage",
  materials: "Physical calibration",
  geometry: "Tile shapes & intersections",
  release: "Release from proposed pose",
  settledShape: "Shape after settling",
  assembly: "Assembly sequence",
  function: "Car route",
};
const statusText = {
  pass: "Passed this check",
  fail: "Needs correction",
  unverified: "Not verified",
};
function Status({ check }: { check: Check }) {
  return (
    <span className={`reference-status ${check.status}`}>
      {statusText[check.status]}
    </span>
  );
}

export default function ReferenceLab({
  entries,
  localComparisons,
}: {
  entries: { replica: Replica; report: ReplicaReport }[];
  localComparisons: boolean;
}) {
  const [selected, setSelected] = useState("jet");
  return (
    <main className="reference-shell">
      <header className="reference-header">
        <Link href="/design">← Design lab</Link>
        <span>Magnetic Tile Builder / Reference workshop</span>
      </header>
      <div className="reference-intro">
        <span className="reference-kicker">From the footage</span>
        <h1>Inspect the build. Examine the evidence.</h1>
        <p>
          Four source-informed candidates, with the original piece counts and
          construction checkpoints. None is yet a verified replica.
        </p>
      </div>
      <nav className="reference-picker" aria-label="Reference build">
        {entries.map(({ replica }) => (
          <button
            key={replica.id}
            aria-pressed={selected === replica.id}
            onClick={() => setSelected(replica.id)}
          >
            {replica.build.title}
            <small>{replica.build.tiles.length} pieces</small>
          </button>
        ))}
        <button
          aria-pressed={selected === "snail"}
          onClick={() => setSelected("snail")}
        >
          3D snail<small>Source missing</small>
        </button>
      </nav>
      {selected === "snail" ? (
        <section className="reference-missing">
          <h2>The original 3D snail is still missing</h2>
          <p>
            The local project and likely download folders were searched. The
            official flat snail instructions describe a different target.
          </p>
          <p>
            A source filename or video link is needed before this reconstruction
            can begin.
          </p>
        </section>
      ) : (
        <Candidate
          key={selected}
          entry={entries.find((e) => e.replica.id === selected)!}
          localComparisons={localComparisons}
        />
      )}
    </main>
  );
}

function Candidate({
  entry: { replica, report },
  localComparisons,
}: {
  entry: { replica: Replica; report: ReplicaReport };
  localComparisons: boolean;
}) {
  const [step, setStep] = useState(-1),
    [labels, setLabels] = useState(false),
    [path, setPath] = useState(false),
    [attemptIndex, setAttemptIndex] = useState(-1),
    [insertionIndex, setInsertionIndex] = useState(-1),
    [insertionProgress, setInsertionProgress] = useState(100);
  const stage = replica.stages[step],
    constructionPlan = replica.construction?.find(p => p.stageId === stage?.id),
    assembly = stage ? report.assemblySimulation?.find(s => s.stageId === stage.id) : undefined,
    rejected = assembly?.rejectedAttempts ?? [],
    shownAttempt = attemptIndex >= 0 ? attemptIndex : assembly?.status === "fail" && rejected.length ? 0 : -1,
    attempt = shownAttempt >= 0 ? rejected[shownAttempt] : assembly,
    operation = attempt?.operations.find(o => o.seed === 0 && o.index === insertionIndex),
    construction = stage ? report.constructionPaths?.find(p => p.stageId === stage.id) : undefined,
    insertion = operation?.path ?? construction?.paths[insertionIndex],
    checkpointBuild = stage ? stageBuild(replica, stage) : replica.build,
    recorded = operation && (operation.timeline?.length || operation.pickup?.motion.length || operation.carry?.motion.length || (operation.approachTiles && operation.path)) ? operation : undefined,
    build = recorded ? assemblyOperationPreview(replica.build, recorded, insertionProgress / 100)
      : insertion ? insertionPreview(checkpointBuild, insertion, insertionProgress / 100) : checkpointBuild;
  const framingTiles = recorded ? [assemblyOperationPreview(checkpointBuild, recorded, 0).tiles,
    recorded.approachTiles ?? [], ...[recorded.pickup,recorded.carry,recorded.seating,recorded.lowering,...recorded.trials].flatMap(p => p?.motion?.map(f => f.tiles) ?? [])].flat()
    : insertion ? insertion.offsets.flatMap((_, index) =>
      insertionPreview(checkpointBuild, insertion, index / (insertion.offsets.length - 1)).tiles) : undefined;
  const selectStep = (next: number) => { setStep(next); setAttemptIndex(-1); setInsertionIndex(-1); setInsertionProgress(100); };
  const counts = countInventory(replica.build.tiles),
    source = sources.sources.find((s) => s.id === replica.sourceId)!;
  const frame = stage
    ? source.frames.find((f) => f.id === stage.frameId)
    : undefined;
  const checkpoint = stage
    ? report.stages.find((s) => s.id === stage.id)
    : undefined;
  const labelsById = Object.fromEntries(
    replica.build.tiles.map((t, i) => [t.id, `P${i + 1}`]),
  );
  const partDetail = (detail: string) => Object.keys(labelsById).sort((a, b) => b.length - a.length)
    .reduce((text, id) => text.replaceAll(id, labelsById[id]), detail)
    .replace(/\b(P\d+):(\d+)/g, (_, part, edge) => `${part} edge ${Number(edge) + 1}`)
    .replaceAll("->", " to ");
  return (
    <>
      <div className="reference-banner">
        <strong>Reconstruction candidate</strong>
        <span>
          Passing one check does not certify source fidelity or physical
          buildability. Recorded evidence:{" "}
          {report.generatedAt?.slice(0, 10) ?? "not dated"}.
        </span>
      </div>
      <div className="reference-layout">
        <section
          className="reference-model"
          aria-label="3D model and construction stages"
        >
          <div className="reference-toolbar">
            <h2>{replica.build.title}</h2>
            <a href={`/reference-replicas/${replica.id}.json`} download>
              Download model & evidence
            </a>
          </div>
          <div className="reference-canvas">
            <TileViewer
              key={`${replica.id}-${step}-${insertionIndex}`}
              build={build}
              framingTiles={framingTiles}
              visibleStep={Infinity}
              showLabels={labels || !!insertion}
              partLabels={labelsById}
              viewDirection={replica.id === "medium-ramp" ? [-.6,.65,-1] : [-.4,.65,1]}
              lanes={path && !stage ? replica.route?.lanes : []}
            />
          </div>
          <div className="reference-controls">
            <label>
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => setLabels(e.target.checked)}
              />{" "}
              Number parts & edges
            </label>
            {replica.route && (
              <label>
                <input
                  type="checkbox"
                  checked={path}
                  disabled={!!stage}
                  onChange={(e) => setPath(e.target.checked)}
                />{" "}
                Show inferred car route
              </label>
            )}
            <span>Drag to rotate · scroll to zoom</span>
          </div>
          <label className="reference-stage">
            Construction checkpoint
            <select
              value={step}
              onChange={(e) => selectStep(Number(e.target.value))}
            >
              <option value={-1}>
                Complete candidate · {replica.build.tiles.length} pieces
              </option>
              {replica.stages.map((s, i) => (
                <option key={s.id} value={i}>
                  {i + 1}. {s.title} · {s.tileIds.length} pieces
                </option>
              ))}
            </select>
          </label>
          {stage && (
            <article className="reference-instruction">
              <div className="reference-toolbar">
                <h3>
                  {step + 1}. {stage.title}
                </h3>
                {(assembly ?? checkpoint) && <Status check={(assembly ?? checkpoint)!} />}
              </div>
              <p>{stage.instruction}</p>
              {assembly && <div className="reference-assembly" aria-label="Complete assembly check">
                <strong>Assembly with hand support</strong> <Status check={assembly} />
                <p>{partDetail(assembly.detail)}</p>
                {rejected.length > 0 && <label>
                  Recorded attempt
                  <select value={shownAttempt} onChange={e => { setAttemptIndex(Number(e.target.value)); setInsertionIndex(-1); setInsertionProgress(100); }}>
                    {assembly.status === "pass" && <option value={-1}>Selected complete attempt</option>}
                    {rejected.map((_,i) => <option key={i} value={i}>Rejected attempt {i+1}</option>)}
                  </select>
                </label>}
                {shownAttempt >= 0 && attempt && <p>Viewing a rejected attempt. {partDetail(attempt.detail)}</p>}
                {!!attempt?.operations.length && <details>
                  <summary>Grip and intermediate checks</summary>
                  <ol>{attempt.operations.filter(o => o.seed === 0).map(o => <li key={o.index}>
                    {o.tablePlacement ? "Move" : "Insert"} {o.tileIds.map(id => labelsById[id]).join(" + ")}: {partDetail(o.detail)}
                  </li>)}</ol>
                </details>}
              </div>}
              {construction && construction.paths.length > 0 && (
                <div className="reference-insertion">
                  <label>
                    Part insertion preview
                    <select value={insertionIndex} onChange={e => { setInsertionIndex(Number(e.target.value)); setInsertionProgress(100); }}>
                      <option value={-1}>Show complete checkpoint</option>
                      {construction.paths.map((p, index) => <option key={p.id} value={index}>
                        {index + 1}. {constructionPlan?.operations[index]?.transfer?.placement === "table" ? "Move" : "Insert"} {p.movingTileIds.map(id => labelsById[id]).join(" + ")}
                      </option>)}
                    </select>
                  </label>
                  {insertion && <label>
                    {recorded?.carry?.motion.length || recorded?.pickup?.motion.length ? "Recorded assembly motion" : recorded?.seating?.motion.length ? "Approach and recorded release" : "Move into place"} · {insertionProgress}%
                    <input type="range" min={0} max={100} value={insertionProgress}
                      onChange={e => setInsertionProgress(Number(e.target.value))} />
                  </label>}
                  <p>{recorded ? recorded.carry?.motion.length || recorded.pickup?.motion.length
                    ? "Recorded motion from the first perturbation run. Only the gripped panel is driven; surrounding parts stay dynamic. A failed run stops at its actual failure pose."
                    : recorded.seating?.motion.length
                    ? "First half: checked approach. Second half: recorded gravity motion from the first perturbation run. New joins remain absent during this fall."
                    : "Preview uses the checked approach and actual settled predecessor positions."
                    : `Preview uses the proposed poses. ${construction.detail}`}</p>
                  {recorded?.tablePlacement && <div aria-label="Prepared table placement">
                    <strong>Table placement</strong> <Status check={recorded.tablePlacement} />
                    {recorded.tablePlacement.status === "pass" && recorded.seating && <p>
                      Moved {recorded.tablePlacement.horizontalDisplacement.toFixed(2)} in across the table.
                      Table contact checked on {recorded.seating.tableBearingTileIds.map(id => labelsById[id]).join(", ")}.
                      {" "}The existing magnetic joins were retained; no new join was added.
                    </p>}
                  </div>}
                </div>
              )}
              <p>
                <strong>
                  {stage.support === "held"
                    ? "Held module"
                    : "Release from proposed pose"}
                  .
                </strong>{" "}
                {stage.support === "held" && assembly?.status === "pass"
                  ? "The assembly check includes grip access and supported intermediate steps. Unattended release of this held checkpoint is not certified."
                  : checkpoint?.detail}
              </p>
              {frame && (
                <a
                  href={`${source.url}&t=${frame.seconds}s`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Watch source at {Math.floor(frame.seconds / 60)}:
                  {String(frame.seconds % 60).padStart(2, "0")}
                </a>
              )}
              <details>
                <summary>Numbered parts and {assembly?.status === "pass" ? "checked" : "proposed"} edge joins</summary>
                <p>{report.instructions[step]?.instruction}</p>
                <p>
                  {assembly?.status === "pass"
                    ? "Checked joins were present after the complete assembly simulation in all three runs. Physical magnetic forces remain uncalibrated."
                    : "These proposed joins come from the nominal edge matcher. They have not passed the complete assembly check."}
                </p>
              </details>
              <div className="reference-step-buttons">
                <button
                  disabled={step === 0}
                  onClick={() => selectStep(step - 1)}
                >
                  Previous
                </button>
                <button
                  disabled={step === replica.stages.length - 1}
                  onClick={() => selectStep(step + 1)}
                >
                  Next
                </button>
              </div>
            </article>
          )}
        </section>
        <aside className="reference-evidence">
          <h2>What the checks establish</h2>
          <p className="reference-muted">
            Source shape, simulator behavior and assembly are assessed
            separately.
          </p>
          {Object.entries(report.checks).map(([key, check]) => (
            <details key={key} className="reference-check">
              <summary>
                <strong>{titles[key]}</strong>
                <Status check={check} />
              </summary>
              <p>{check.detail}</p>
            </details>
          ))}
          <h3>Inventory from the footage</h3>
          <ul className="reference-inventory">
            {SHAPE_ORDER.filter((s) => counts[s] > 0).map((s) => (
              <li key={s}>
                <span>{TILE_SPECS[s].label}</span>
                <strong>{counts[s]}</strong>
              </li>
            ))}
          </ul>
          <a
            href={`${source.url}&t=${source.frames.find((f) => f.id === replica.bomFrameId)!.seconds}s`}
            target="_blank"
            rel="noreferrer"
          >
            Open original piece-count card ↗
          </a>
        </aside>
      </div>
      <section className="reference-comparisons">
        <div className="reference-toolbar">
          <h2>Source versus render</h2>
          {localComparisons && (
            <a
              href="/reference-frames/replication/comparison.html"
              target="_blank"
              rel="noreferrer"
            >
              Open local footage overlays ↗
            </a>
          )}
        </div>
        <p>
          Camera alignment uses designated anchors. Red residual lines measure
          other annotated corners. Withheld views are excluded from geometry
          tuning; sparse agreement cannot establish the full shape.
        </p>
        {report.projections.length === 0 ? (
          <p>
            No measured camera comparisons yet. Source fidelity remains
            unverified.
          </p>
        ) : (
          <div className="reference-projections">
            {report.projections.map((p) => (
              <article key={p.id}>
                <h3>
                  {p.frameId} ·{" "}
                  {p.partition === "holdout" ? "withheld view" : "fitting view"}
                </h3>
                <Status check={p} />
                {p.camera && (
                  <Image
                    unoptimized
                    src={`/reference-replicas/${p.id}.svg`}
                    width={960}
                    height={540}
                    alt={`Projected candidate and annotated corner errors for ${p.frameId}`}
                  />
                )}
                <p>
                  Corner RMS: {p.rmsPx?.toFixed(1) ?? "unavailable"} px ·
                  maximum: {p.maxPx?.toFixed(1) ?? "unavailable"} px.
                </p>
                <p>{p.detail}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="reference-open-questions">
        <h2>Unresolved placements and measurements</h2>
        {replica.uncertainties.map((u) => (
          <p key={u.id}>{u.detail}</p>
        ))}
        {replica.route && <p>{replica.route.evidence}</p>}
        <p>{replica.materialQuestions.join(" ")}</p>
      </section>
    </>
  );
}
