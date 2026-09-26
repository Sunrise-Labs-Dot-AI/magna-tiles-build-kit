"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  ChevronDown,
  Download,
  Pause,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { TileViewer } from "@/app/components/TileViewer";
import { countInventory } from "@/lib/magnetic-tiles/validation";
import {
  SHAPE_ORDER,
  TILE_SPECS,
  inventoryForPreset,
} from "@/lib/magnetic-tiles/catalog";
import type { DesignResult } from "@/lib/planner/types";

const examples = [
  "a tower at least 12 inches tall",
  "an open top box 2 tiles wide",
  "a tunnel 3 tiles long",
  "a staircase with 4 steps",
  "a downhill racecourse for two side by side cars",
  "a zigzagging downhill racecourse for two side by side cars",
];
export default function DesignLab() {
  const [prompt, setPrompt] = useState(examples[1]);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"instructions" | "checks">("checks");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [labels, setLabels] = useState(false);
  const [unlimitedPieces, setUnlimitedPieces] = useState(false);
  const duration = Math.max(
    0,
    ...(result?.trials.flatMap((t) => t.samples.map((s) => s.time)) ?? []),
  );
  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - time * 1000;
    const timer = setInterval(() => {
      const next = Math.min(duration, (performance.now() - start) / 1000);
      setTime(next);
      if (next >= duration) setPlaying(false);
    }, 33);
    return () => clearInterval(timer);
    // The clock captures the slider position when playback starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);
  const inventory = useMemo(
    () => (result ? countInventory(result.build.tiles) : null),
    [result],
  );
  const visibleStep = step === 0 ? Infinity : step;
  const current = result?.instructions.find((s) => s.step === step);
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    setPlaying(false);
    try {
      const response = await fetch("/api/design-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, unlimitedPieces }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "The design could not be completed.");
      setResult(data);
      setStep(0);
      setTime(0);
      setTab("checks");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.build.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const failures =
    result?.checks.filter((c) => c.status === "fail").length ?? 0;
  return (
    <main className="design-shell">
      <header className="design-header">
        <Link href="/" className="design-brand">
          <Blocks size={24} />
          <span>
            Magnetic Tile Builder <small>Design lab</small>
          </span>
        </Link>
        <nav>
          <Link href="/">Build library</Link>
          <Link href="/builder">Workbench</Link>
          <Link href="/references">Reference workshop</Link>
        </nav>
      </header>
      <div className="design-layout">
        <aside className="design-prompt-panel">
          <span className="design-eyebrow">01 / Describe</span>
          <h1>What will you build?</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <label htmlFor="design-prompt">Your build</label>
            <textarea
              id="design-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={1000}
              rows={5}
            />
            <label className="design-inventory-toggle">
              <input
                type="checkbox"
                checked={unlimitedPieces}
                disabled={busy}
                onChange={(e) => setUnlimitedPieces(e.target.checked)}
              />{" "}
              Unlimited pieces
            </label>
            <p className="design-note">
              {unlimitedPieces
                ? "Set inventory and requested piece-count caps are disabled."
                : "Use the Classic 100 inventory and any piece cap in your prompt."}{" "}
              Simulation time and complexity budgets are separate. Larger builds
              can take several minutes to test.
            </p>
            <button
              className="design-primary"
              disabled={busy || !prompt.trim()}
            >
              {busy ? "Building and testing…" : "Build & test"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="design-examples">
            <span>Try a design brief</span>
            {examples.map((example) => (
              <button
                key={example}
                disabled={busy}
                onClick={() => setPrompt(example)}
              >
                {example.replace(/^(?:a|an) /, "")}
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          <p className="design-note">
            Structural requests use a measured intent contract and repair
            search. Racecourses use the earlier experimental planner; turning
            courses remain unsolved.
          </p>
          {error ? (
            <p className="design-error" role="alert">
              {error}
            </p>
          ) : null}
          {result ? (
            <>
              <div className="design-requirements">
                <span className="design-eyebrow">Interpreted brief</span>
                {result.harness ? (
                  <>
                    <strong>
                      {result.harness.contract.kind} · {result.harness.status}
                    </strong>
                    <p>{result.harness.explanation}</p>
                    <details>
                      <summary>Review the intent contract</summary>
                      <pre className="design-contract">
                        {JSON.stringify(result.harness.contract, null, 2)}
                      </pre>
                    </details>
                  </>
                ) : (
                  <>
                    <strong>
                      {result.brief.lanes} lane
                      {result.brief.lanes === 2 ? "s" : ""} ·{" "}
                      {result.brief.turns} turns ·{" "}
                      {result.brief.downhill
                        ? "downhill"
                        : "no slope specified"}
                    </strong>
                    <span>
                      Car proxy: {result.brief.car.length} ×{" "}
                      {result.brief.car.width} in,{" "}
                      {result.brief.car.massKg * 1000} g
                    </span>
                  </>
                )}
              </div>
              <div className="design-inventory">
                <h2>
                  Gather your pieces <span>{result.build.tiles.length}</span>
                </h2>
                {SHAPE_ORDER.filter((shape) => inventory![shape] > 0).map(
                  (shape) => (
                    <div key={shape}>
                      <span>{TILE_SPECS[shape].label}</span>
                      <strong>
                        {inventory![shape]}{" "}
                        {result.brief.unlimitedPieces ? (
                          <small>/ unlimited</small>
                        ) : (
                          <small>
                            /{" "}
                            {
                              inventoryForPreset(result.brief.inventoryPreset)[
                                shape
                              ]
                            }
                          </small>
                        )}
                      </strong>
                    </div>
                  ),
                )}
              </div>
            </>
          ) : null}
        </aside>
        <section className="design-center" aria-busy={busy}>
          <div className="design-viewer-heading">
            <div>
              <span className="design-eyebrow">02 / Inspect</span>
              <h2>{result?.build.title ?? "A plan you can inspect"}</h2>
            </div>
            {result ? (
              <span
                className={`design-status ${result.status === "simulation-passed" ? "good" : "warn"}`}
              >
                {result.status === "simulation-passed" ? (
                  <Check size={15} />
                ) : (
                  <TriangleAlert size={15} />
                )}{" "}
                {result.status === "simulation-passed"
                  ? "Simulation passed"
                  : "Needs repair"}
              </span>
            ) : null}
          </div>
          <div className="design-canvas">
            {result ? (
              <TileViewer
                build={result.build}
                visibleStep={visibleStep}
                lanes={step === 0 ? result.lanes : []}
                trials={step === 0 ? result.trials : []}
                playbackTime={time}
                showLabels={labels}
              />
            ) : (
              <div className="design-empty">
                <Blocks size={48} />
                <h2>Describe. Assemble. Test.</h2>
                <p>
                  Inspect the actual tiles, follow the assembly sequence, and
                  replay the car simulation.
                </p>
              </div>
            )}
            {busy ? (
              <div className="design-loading" role="status">
                <span />
                Checking pieces, connections, routes, and physics…
              </div>
            ) : null}
          </div>
          {result ? (
            <>
              <div className="design-viewer-toolbar">
                <label>
                  <input
                    type="checkbox"
                    checked={labels}
                    onChange={(e) => setLabels(e.target.checked)}
                  />
                  Piece & edge labels
                </label>
                <span>
                  {result.build.bounds.width.toFixed(1)} ×{" "}
                  {result.build.bounds.depth.toFixed(1)} ×{" "}
                  {result.build.bounds.height.toFixed(1)} in
                </span>
                <button onClick={download}>
                  <Download size={16} />
                  Export plan
                </button>
              </div>
              {result.trials.length > 0 ? (
                <div className="design-playback">
                  <button
                    aria-label={
                      playing
                        ? "Pause simulation replay"
                        : "Play simulation replay"
                    }
                    onClick={() => {
                      if (time >= duration) setTime(0);
                      setStep(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <button
                    aria-label="Reset simulation replay"
                    onClick={() => {
                      setPlaying(false);
                      setTime(0);
                    }}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <input
                    aria-label="Simulation time"
                    type="range"
                    min="0"
                    max={duration}
                    step="0.01"
                    value={time}
                    onChange={(e) => {
                      setPlaying(false);
                      setTime(Number(e.target.value));
                      setStep(0);
                    }}
                  />
                  <span>{time.toFixed(2)} s</span>
                  <small>Recorded car centers</small>
                </div>
              ) : null}
              <div className="design-step-controls">
                <button
                  disabled={step <= 1}
                  onClick={() => {
                    setStep(step - 1);
                    setPlaying(false);
                  }}
                  aria-label="Previous assembly step"
                >
                  <ArrowLeft size={18} />
                </button>
                <select
                  aria-label="Assembly step"
                  value={step}
                  onChange={(e) => {
                    setStep(Number(e.target.value));
                    setPlaying(false);
                  }}
                >
                  <option value={0}>Complete model</option>
                  {result.instructions.map((s) => (
                    <option value={s.step} key={s.step}>
                      Step {s.step} · {s.tileIds.length} pieces
                    </option>
                  ))}
                </select>
                <button
                  disabled={step >= result.instructions.length}
                  onClick={() => {
                    setStep(step + 1);
                    setPlaying(false);
                  }}
                  aria-label="Next assembly step"
                >
                  <ArrowRight size={18} />
                </button>
              </div>
              {current ? (
                <div className="design-current-step">
                  <strong>
                    Step {current.step}: {current.title}
                  </strong>
                  <p>{current.instruction}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
        <aside className="design-results">
          <div className="design-tabs">
            <button
              aria-pressed={tab === "checks"}
              onClick={() => setTab("checks")}
            >
              Checks {failures > 0 ? `(${failures})` : ""}
            </button>
            <button
              aria-pressed={tab === "instructions"}
              onClick={() => setTab("instructions")}
            >
              Instructions
            </button>
          </div>
          {!result ? (
            <p className="design-note">
              Your model’s checks and assembly sequence will appear here.
            </p>
          ) : tab === "checks" ? (
            <>
              <p className="design-result-summary">
                {result.status === "simulation-passed"
                  ? result.harness
                    ? "The geometry meets the extracted intent contract, all three release trials passed, and every completed assembly stage stands in the model. Review the contract before trying the real build."
                    : "The modeled structure, cars, and completed assembly steps passed. Try the real build to test the assumptions."
                  : "This candidate is not a verified build. The failed or unverified checks below explain why."}
              </p>
              {result.checks.map((check) => (
                <details
                  className={`design-check ${check.status}`}
                  key={check.code}
                  open={check.status !== "pass"}
                >
                  <summary>
                    <span className="design-check-icon">
                      {check.status === "pass" ? (
                        <Check size={14} />
                      ) : check.status === "fail" ? (
                        <TriangleAlert size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </span>
                    <strong>{check.label}</strong>
                    <small>
                      {check.status === "unverified"
                        ? "not verified"
                        : check.status}
                    </small>
                  </summary>
                  <p>{check.detail}</p>
                </details>
              ))}
              <details className="design-assumptions">
                <summary>Physics assumptions & limits</summary>
                <p>{result.model}</p>
                <p>
                  Video reconstruction and arbitrary prompt generation are not
                  solved by this planner.
                </p>
              </details>
              <small className="design-search-count">
                {result.candidates.length} candidate
                {result.candidates.length === 1 ? "" : "s"} evaluated. No failed
                candidate is promoted to a passing result.
              </small>
              {result.harness ? (
                <details className="design-assumptions">
                  <summary>Search and repair trace</summary>
                  {result.harness.attempts.map((attempt) => (
                    <div key={attempt.index}>
                      <strong>
                        Attempt {attempt.index}: {attempt.program.reinforcement}{" "}
                        · {attempt.evaluation.passed ? "passed" : "rejected"}
                      </strong>
                      <p>{attempt.triggeredBy.join("\n")}</p>
                      <p>
                        {attempt.evaluation.evidence
                          .filter((e) => !e.passed)
                          .map((e) => `${e.label}: ${e.actual}`)
                          .join("\n")}
                      </p>
                    </div>
                  ))}
                </details>
              ) : null}
            </>
          ) : (
            <>
              {result.status !== "simulation-passed" ? (
                <p className="design-error">
                  Study sequence only. Resolve the checks before treating this
                  as a build plan.
                </p>
              ) : null}
              {result.instructions.map((s) => (
                <button
                  className={`design-instruction ${step === s.step ? "active" : ""}`}
                  key={s.step}
                  onClick={() => {
                    setStep(s.step);
                    setPlaying(false);
                  }}
                >
                  <span>{String(s.step).padStart(2, "0")}</span>
                  <div>
                    <strong>{s.title}</strong>
                    <small>{s.tileIds.length} pieces</small>
                    <p>{s.instruction}</p>
                  </div>
                </button>
              ))}
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
