"use client";

import {
  AlertTriangle,
  Blocks,
  Box,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  Library,
  Play,
  Sparkles,
  Tags
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CLASSIC_100_INVENTORY, inventoryTotal, SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";
import type { BuildLibraryItem, GeneratedBuildResponse, Severity } from "@/lib/magnetic-tiles/types";
import { JET_AIRCRAFT_CONTACT_SHEET, JET_AIRCRAFT_REFERENCE_FRAMES } from "@/lib/reference-encoder/examples/jet-aircraft-frames";
import { ReferenceEncoder } from "./components/ReferenceEncoder";
import { TileViewer } from "./components/TileViewer";

const EXAMPLES = [
  "a tall rainbow castle",
  "a rocket ship",
  "a bridge for toy cars",
  "a small dog",
  "a garage",
  "a dinosaur"
];

export default function Home() {
  const [prompt, setPrompt] = useState("a spaceship");
  const [result, setResult] = useState<GeneratedBuildResponse | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState(BUILD_LIBRARY[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reportSeverity, setReportSeverity] = useState<"bug" | "rough-edge" | "idea">("bug");
  const [reportArea, setReportArea] = useState("rendering");
  const [reportSummary, setReportSummary] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportExpected, setReportExpected] = useState("");
  const [reportActual, setReportActual] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const maxStep = useMemo(
    () => Math.max(1, ...(result?.instructions.map((step) => step.step) ?? [1])),
    [result]
  );
  const selectedLibraryItem = BUILD_LIBRARY.find((item) => item.id === selectedLibraryId) ?? null;
  const referenceFrames = result?.build.title === "Jet Aircraft" ? JET_AIRCRAFT_REFERENCE_FRAMES : [];

  useEffect(() => {
    if (BUILD_LIBRARY[0]) {
      void loadLibraryBuild(BUILD_LIBRARY[0]);
    }
  }, []);

  async function generate(nextPrompt = prompt, source: "library" | "beta" = "beta") {
    setIsLoading(true);
    setError(null);
    if (source === "beta") setSelectedLibraryId("");
    setPrompt(nextPrompt);
    try {
      const response = await fetch("/api/generate-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: nextPrompt, inventoryPreset: "classic-100" })
      });
      if (!response.ok) {
        throw new Error("The build engine could not complete that prompt.");
      }
      const data = (await response.json()) as GeneratedBuildResponse;
      setResult(data);
      setCurrentStep(Math.max(1, data.instructions.length));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadLibraryBuild(item: BuildLibraryItem) {
    setSelectedLibraryId(item.id);
    setIsLoading(true);
    setError(null);
    setPrompt(item.prompt);
    try {
      // Guided library builds replay the hand-authored draft (build-drafts/<id>.json),
      // not the procedural generator. This is the "author once, replay as guided" path.
      const response = await fetch("/api/library-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id })
      });
      if (!response.ok) {
        throw new Error("Could not load that library build.");
      }
      const data = (await response.json()) as GeneratedBuildResponse;
      setResult(data);
      setCurrentStep(Math.max(1, data.instructions.length));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  async function fileBugReport() {
    setIsReporting(true);
    setReportStatus(null);
    try {
      const response = await fetch("/api/report-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          currentStep,
          severity: reportSeverity,
          area: reportArea,
          summary: reportSummary,
          details: reportDetails,
          expected: reportExpected,
          actual: reportActual,
          result
        })
      });
      const body = (await response.json()) as { path?: string; detail?: string };
      if (!response.ok) {
        throw new Error(body.detail ?? "Unable to file that report.");
      }
      setReportStatus(`Filed ${body.path}`);
      setReportSummary("");
      setReportDetails("");
      setReportExpected("");
      setReportActual("");
    } catch (caught) {
      setReportStatus(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsReporting(false);
    }
  }

  const usedTotal = result ? inventoryTotal(result.validation.usedInventory) : 0;
  const remainingTotal = result ? inventoryTotal(result.validation.remainingInventory) : inventoryTotal(CLASSIC_100_INVENTORY);
  const isEngineVerifiedLibraryBuild =
    !!result && BUILD_LIBRARY.some((item) => item.id === selectedLibraryId && item.status === "engine-valid");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Blocks size={22} />
          </div>
          <div>
            <h1>Magnetic Tile Builder</h1>
            <span>Build library with 3D instructions for Classic 100-compatible sets</span>
          </div>
        </div>
        <Link className="builder-link" href="/builder">
          Open workbench
        </Link>
      </header>

      <section className="workspace">
        <aside className="panel control-panel">
          <div>
            <h2 className="section-title">
              <Library size={16} />
              Build Library
            </h2>
            <div className="library-list">
              {BUILD_LIBRARY.map((item) => (
                <button
                  className={`library-card ${selectedLibraryId === item.id ? "selected" : ""}`}
                  disabled={isLoading}
                  key={item.id}
                  onClick={() => loadLibraryBuild(item)}
                  type="button"
                >
                  <div className="library-card-header">
                    <strong>{item.title}</strong>
                    <span className={`mini-pill ${item.status === "human-reviewed" || item.status === "engine-valid" ? "info" : "warning"}`}>
                      {item.status}
                    </span>
                  </div>
                  <span className="library-summary">{item.summary}</span>
                  <span className="library-meta">
                    {item.difficulty} · {item.estimatedMinutes} min · {item.tags.slice(0, 2).join(", ")}
                  </span>
                </button>
              ))}
            </div>
            {error ? <p className="issue-detail">{error}</p> : null}
          </div>

          <details className="beta-card secondary-details">
            <summary className="beta-header">
              <h2 className="section-title">
                <Sparkles size={16} />
                Prompt Lab
              </h2>
              <span className="pill warn">beta</span>
            </summary>
            <div className="secondary-content">
              <div className="prompt-box">
                <textarea
                  aria-label="Experimental build prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Try a draft variation, like a spaceship or a tall rainbow castle"
                />
                <button className="primary-button" disabled={isLoading} onClick={() => generate(prompt, "beta")}>
                  <Play size={16} />
                  {isLoading ? "Generating" : "Draft build"}
                </button>
              </div>
              <p className="beta-copy">
                Prompted builds are experimental drafts. The library builds are the reviewed product experience.
              </p>
              <div className="example-grid">
                {EXAMPLES.map((example) => (
                  <button className="chip-button" key={example} onClick={() => setPrompt(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </details>

          <div className="summary-card">
            <h2 className="summary-title">{result?.build.title ?? "Ready for a build"}</h2>
            <p className="summary-copy">
              {selectedLibraryItem?.summary ??
                result?.build.summary ??
                "Pick a reviewed build to see the 3D model, piece count, validation checks, and step-by-step instructions."}
            </p>
            {selectedLibraryItem ? (
              <div className="tag-row">
                {selectedLibraryItem.tags.map((tag) => (
                  <span className="tag" key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="stat-grid">
            <div className="stat">
              <strong>{usedTotal}</strong>
              <span>tiles used</span>
            </div>
            <div className="stat">
              <strong>{remainingTotal}</strong>
              <span>left over</span>
            </div>
            <div className="stat">
              <strong>{result?.build.connections.length ?? 0}</strong>
              <span>joins</span>
            </div>
          </div>

          <details className="bug-card secondary-details">
            <summary className="section-title secondary-summary">
              <Flag size={16} />
              File a local report
            </summary>
            <div className="bug-grid secondary-content">
              <label>
                <span>Type</span>
                <select
                  className="text-input"
                  onChange={(event) =>
                    setReportSeverity(event.target.value as "bug" | "rough-edge" | "idea")
                  }
                  value={reportSeverity}
                >
                  <option value="bug">Bug</option>
                  <option value="rough-edge">Rough edge</option>
                  <option value="idea">Idea</option>
                </select>
              </label>
              <label>
                <span>Area</span>
                <select
                  className="text-input"
                  onChange={(event) => setReportArea(event.target.value)}
                  value={reportArea}
                >
                  <option value="rendering">Rendering</option>
                  <option value="instructions">Instructions</option>
                  <option value="physics">Physics</option>
                  <option value="inventory">Inventory</option>
                  <option value="library-data">Library data</option>
                  <option value="prompt-mapping">Prompt Lab</option>
                  <option value="ui">UI</option>
                </select>
              </label>
              <label className="wide-field">
                <span>Summary</span>
                <input
                  className="text-input"
                  onChange={(event) => setReportSummary(event.target.value)}
                  placeholder="Short title for what broke or felt off"
                  value={reportSummary}
                />
              </label>
              <label className="wide-field">
                <span>What you saw</span>
                <textarea
                  className="text-area compact-area"
                  onChange={(event) => setReportDetails(event.target.value)}
                  placeholder="Describe the issue. Current prompt, step, build state, and validation data are captured automatically."
                  value={reportDetails}
                />
              </label>
              <label className="wide-field">
                <span>Expected</span>
                <input
                  className="text-input"
                  onChange={(event) => setReportExpected(event.target.value)}
                  placeholder="Optional"
                  value={reportExpected}
                />
              </label>
              <label className="wide-field">
                <span>Actual</span>
                <input
                  className="text-input"
                  onChange={(event) => setReportActual(event.target.value)}
                  placeholder="Optional"
                  value={reportActual}
                />
              </label>
              <button
                className="secondary-button wide-field"
                disabled={isReporting || !reportSummary.trim() || !reportDetails.trim()}
                onClick={fileBugReport}
                type="button"
              >
                <Flag size={16} />
                {isReporting ? "Filing" : "File report"}
              </button>
              {reportStatus ? <p className="issue-detail wide-field">{reportStatus}</p> : null}
            </div>
          </details>
        </aside>

        <section className="panel viewer-panel">
          <div className="viewer-header">
            <div className="viewer-title">
              <h2>{result?.build.title ?? "3D build viewer"}</h2>
              <span className="muted">
                {result
                  ? `${Math.round(result.build.bounds.width)} in wide • ${Math.round(result.build.bounds.height)} in tall`
                  : "Orbit, zoom, and scrub through steps after generation"}
              </span>
            </div>
            <StatusPill isReference={isEngineVerifiedLibraryBuild} status={result?.validation.status ?? "pass"} />
          </div>
          <div className="canvas-wrap">
            <TileViewer build={result?.build ?? null} visibleStep={currentStep} />
          </div>
          <div className="viewer-footer">
            <button
              aria-label="Previous step"
              className="icon-button"
              disabled={!result || currentStep <= 1}
              onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
            >
              <ChevronLeft size={18} />
            </button>
            <input
              aria-label="Step preview"
              className="range"
              disabled={!result}
              max={maxStep}
              min={1}
              onChange={(event) => setCurrentStep(Number(event.target.value))}
              type="range"
              value={currentStep}
            />
            <button
              aria-label="Next step"
              className="icon-button"
              disabled={!result || currentStep >= maxStep}
              onClick={() => setCurrentStep((step) => Math.min(maxStep, step + 1))}
            >
              <ChevronRight size={18} />
            </button>
            <span className="muted">
              Step {result ? currentStep : 0}/{result ? maxStep : 0}
            </span>
          </div>
          {referenceFrames.length > 0 ? (
            <details className="viewer-reference" open>
              <summary>
                <span>Video reference frames</span>
                <span className="muted">source of truth for Jet Aircraft</span>
              </summary>
              <div className="viewer-frame-strip">
                {referenceFrames.map((frame) => (
                  <figure className="viewer-frame" key={frame.id}>
                    <img alt={`${frame.label} at ${frame.timestamp}`} src={frame.src} />
                    <figcaption>
                      <strong>{frame.label}</strong>
                      <span>{frame.timestamp}</span>
                    </figcaption>
                  </figure>
                ))}
                <figure className="viewer-frame contact-sheet">
                  <img alt="Reviewed Jet Aircraft contact sheet" src={JET_AIRCRAFT_CONTACT_SHEET} />
                  <figcaption>
                    <strong>Contact sheet</strong>
                    <span>reviewed</span>
                  </figcaption>
                </figure>
              </div>
            </details>
          ) : null}
        </section>

        <aside className="panel result-panel">
          <section>
            <h2 className="section-title">
              <Box size={16} />
              Inventory
            </h2>
            <div className="inventory-list">
              {SHAPE_ORDER.map((shape, index) => {
                const used = result?.validation.usedInventory[shape] ?? 0;
                const total = used + (result?.validation.remainingInventory[shape] ?? CLASSIC_100_INVENTORY[shape]);
                const color = result?.build.tiles.find((tile) => tile.shape === shape)?.color ?? ["#2aaec2", "#f7b733", "#8ecae6", "#f05d5e", "#4aa96c", "#7b2cbf"][index];
                return (
                  <div className="tile-row" key={shape}>
                    <span className="swatch" style={{ background: color }} />
                    <div>
                      <strong>{TILE_SPECS[shape].label}</strong>
                      <span className="tile-meta">{used} used of {total}</span>
                    </div>
                    <span className="muted">{total - used}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="section-title">
              <AlertTriangle size={16} />
              Validation
            </h2>
            <div className="issues-list">
              {result?.validation.issues.length ? (
                result.validation.issues.map((issue) => (
                  <div className="issue" key={`${issue.code}-${issue.message}`}>
                    <div className="issue-title">
                      <strong>{issue.message}</strong>
                      <span className={`mini-pill ${issue.severity}`}>{issue.severity}</span>
                    </div>
                    <span className="issue-detail">{issue.detail}</span>
                    {issue.tileIds?.length ? (
                      <span className="tile-id-list">{issue.tileIds.slice(0, 12).join(", ")}{issue.tileIds.length > 12 ? ", ..." : ""}</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="issue">
                  <strong>No blocking issues</strong>
                  <span className="issue-detail">
                    This build fits the inventory and passes the magnet-edge checks.
                  </span>
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="section-title">
              <ClipboardList size={16} />
              Instructions
            </h2>
            <div className="steps-list">
              {result?.instructions.map((step) => (
                <button
                  className="step"
                  key={step.step}
                  onClick={() => setCurrentStep(step.step)}
                  type="button"
                >
                  <div className="step-header">
                    <strong>{step.step}. {step.title}</strong>
                    <span className="muted">{step.tileIds.length} tiles</span>
                  </div>
                  <span className="step-detail">{step.instruction}</span>
                </button>
              )) ?? (
                <div className="step">
                  <strong>Pick a build</strong>
                  <span className="step-detail">Step-by-step instructions will appear here.</span>
                </div>
              )}
            </div>
          </section>

          {result ? (
            <details className="debug-card secondary-details">
              <summary className="section-title secondary-summary">
                <Tags size={16} />
                Tile debug
              </summary>
              <div className="debug-list secondary-content">
                {result.build.tiles.map((tile) => (
                  <div className="debug-row" key={tile.id}>
                    <strong>{tile.id}</strong>
                    <span>{tile.role}</span>
                    <small>
                      {TILE_SPECS[tile.shape].shortLabel} · step {tile.step}
                      {tile.subassemblyId ? ` · ${tile.subassemblyId}` : ""}
                      {tile.parentTileId ? ` · ${tile.parentTileId} e${tile.parentEdge} -> e${tile.childEdge}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </aside>
      </section>

      <ReferenceEncoder />
    </main>
  );
}

function StatusPill({ isReference = false, status }: { isReference?: boolean; status: "pass" | "warning" | "error" }) {
  const severity: Severity = status === "error" ? "error" : status === "warning" ? "warning" : "info";
  const label =
    status === "pass"
      ? isReference
        ? "engine verified"
        : "magnet checks pass"
      : status === "warning"
        ? "review magnet joins"
        : "needs repair";
  return <span className={`pill ${severity === "error" ? "error" : severity === "warning" ? "warn" : "pass"}`}>{label}</span>;
}
