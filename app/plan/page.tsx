"use client";

import {
  AlertTriangle,
  Blocks,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Hammer,
  Play,
  Printer,
  ShieldCheck,
  ShieldX
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createDraftFromGenerated } from "@/lib/builder/operations";
import { CLASSIC_100_INVENTORY, SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import type {
  GatedBuildFailure,
  GatedBuildResult,
  GatedBuildSuccess
} from "@/lib/magnetic-tiles/generate";
import { TileViewer } from "../components/TileViewer";

const EXAMPLES = [
  "a castle",
  "two towers",
  "a house with a red roof",
  "a bridge for toy cars",
  "small car ramp",
  "a dinosaur",
  "a rocket ship",
  "a jet aircraft"
];

type PlanState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ok"; result: GatedBuildSuccess }
  | { phase: "failed"; failure: GatedBuildFailure }
  | { phase: "error"; detail: string };

export default function PlanPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("a castle");
  const [state, setState] = useState<PlanState>({ phase: "idle" });
  const [currentStep, setCurrentStep] = useState(1);
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const result = state.phase === "ok" ? state.result : null;
  const maxStep = useMemo(
    () => Math.max(1, ...(result?.instructions.map((step) => step.step) ?? [1])),
    [result]
  );
  const activeInstruction =
    result?.instructions.find((step) => step.step === currentStep) ?? null;
  const repairAttempt = useMemo(() => {
    if (!result) return null;
    const passing = result.attempts.find((attempt) => attempt.passed);
    return passing && passing.label !== "primary template" ? passing : null;
  }, [result]);

  async function generatePlan(nextPrompt = prompt) {
    setPrompt(nextPrompt);
    setState({ phase: "loading" });
    setHandoffError(null);
    try {
      const response = await fetch("/api/generate-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: nextPrompt, inventoryPreset: "classic-100" })
      });
      const body = (await response.json()) as GatedBuildResult & { detail?: string };

      if (response.status === 422 && body.status === "failed") {
        setState({ phase: "failed", failure: body });
        return;
      }
      if (!response.ok || body.status !== "ok") {
        throw new Error(body.detail ?? "The build engine could not complete that prompt.");
      }
      setState({ phase: "ok", result: body });
      setCurrentStep(1);
    } catch (caught) {
      setState({
        phase: "error",
        detail: caught instanceof Error ? caught.message : "Something went wrong."
      });
    }
  }

  async function openInWorkbench() {
    if (!result) return;
    setIsHandingOff(true);
    setHandoffError(null);
    try {
      const draft = createDraftFromGenerated(result, {
        id: `plan-${result.build.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
        status: "draft"
      });
      const response = await fetch("/api/build-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const body = (await response.json()) as { draft?: { id: string }; detail?: string };
      if (!response.ok || !body.draft) {
        throw new Error(body.detail ?? "Could not save the plan as a workbench draft.");
      }
      router.push(`/builder?draft=${encodeURIComponent(body.draft.id)}`);
    } catch (caught) {
      setHandoffError(
        caught instanceof Error ? caught.message : "Could not open the plan in the workbench."
      );
      setIsHandingOff(false);
    }
  }

  const isLoading = state.phase === "loading";

  return (
    <main className="app-shell plan-page">
      <header className="topbar plan-no-print">
        <div className="brand">
          <div className="brand-mark">
            <Blocks size={22} />
          </div>
          <div>
            <h1>Build Plan</h1>
            <span>Prompt to physics-verified plan, shopping list, and printable instructions</span>
          </div>
        </div>
        <nav className="plan-nav">
          <Link className="builder-link" href="/">
            Build library
          </Link>
          <Link className="builder-link" href="/builder">
            Open workbench
          </Link>
        </nav>
      </header>

      <section className="plan-controls panel plan-no-print">
        <div className="prompt-box">
          <textarea
            aria-label="Build prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe a build, like a castle with two towers or a ramp for toy cars"
          />
          <button
            className="primary-button"
            disabled={isLoading}
            onClick={() => generatePlan(prompt)}
            type="button"
          >
            <Play size={16} />
            {isLoading ? "Running physics gate" : "Generate plan"}
          </button>
        </div>
        <div className="example-grid">
          {EXAMPLES.map((example) => (
            <button
              className="chip-button"
              disabled={isLoading}
              key={example}
              onClick={() => generatePlan(example)}
              type="button"
            >
              {example}
            </button>
          ))}
        </div>
        <p className="beta-copy">
          Every plan must pass the real engine gate: no overlaps, valid magnetic joins, and a
          Rapier stand test (plus a roll test for ramps). If no template variant passes, you
          get an honest failure instead of a wobbly guess.
        </p>
      </section>

      {state.phase === "error" ? (
        <section className="panel plan-failure plan-no-print">
          <h2 className="section-title">
            <AlertTriangle size={16} />
            Something went wrong
          </h2>
          <p className="issue-detail">{state.detail}</p>
        </section>
      ) : null}

      {state.phase === "failed" ? (
        <section className="panel plan-failure plan-no-print">
          <h2 className="section-title">
            <ShieldX size={16} />
            No buildable plan for this prompt
          </h2>
          <span className="pill error">gate failed</span>
          <p className="plan-failure-message">{state.failure.message}</p>
          <div className="issues-list">
            {state.failure.attempts.map((attempt) => (
              <div className="issue" key={attempt.label}>
                <div className="issue-title">
                  <strong>{attempt.label}</strong>
                  <span className="mini-pill error">failed</span>
                </div>
                <span className="issue-detail">
                  {attempt.reasons.filter((reason) => !/passed/.test(reason)).slice(0, 3).join(" ")}
                </span>
              </div>
            ))}
          </div>
          <p className="issue-detail">
            Try a different phrasing or one of the example prompts above. The physics gate is
            never loosened to force a result.
          </p>
        </section>
      ) : null}

      {result ? (
        <section className="plan-workspace">
          <section className="panel viewer-panel plan-no-print">
            <div className="viewer-header">
              <div className="viewer-title">
                <h2>{result.build.title}</h2>
                <span className="muted">
                  {Math.round(result.build.bounds.width)} in wide •{" "}
                  {Math.round(result.build.bounds.height)} in tall •{" "}
                  {result.build.tiles.length} tiles
                </span>
              </div>
              <span className="pill pass" title={result.gate.reasons.join("\n")}>
                <ShieldCheck size={14} />
                physics-verified
              </span>
            </div>
            {repairAttempt ? (
              <p className="plan-repair-note">
                Honest repair: the first template variant failed the gate, so this plan uses
                “{repairAttempt.label}” ({repairAttempt.size} {repairAttempt.family}).
              </p>
            ) : null}
            <div className="canvas-wrap">
              <TileViewer build={result.build} visibleStep={currentStep} />
            </div>
            <div className="viewer-footer">
              <button
                aria-label="Previous step"
                className="icon-button"
                disabled={currentStep <= 1}
                onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
                type="button"
              >
                <ChevronLeft size={18} />
              </button>
              <input
                aria-label="Step preview"
                className="range"
                max={maxStep}
                min={1}
                onChange={(event) => setCurrentStep(Number(event.target.value))}
                type="range"
                value={currentStep}
              />
              <button
                aria-label="Next step"
                className="icon-button"
                disabled={currentStep >= maxStep}
                onClick={() => setCurrentStep((step) => Math.min(maxStep, step + 1))}
                type="button"
              >
                <ChevronRight size={18} />
              </button>
              <span className="muted">
                Step {currentStep}/{maxStep}
              </span>
            </div>
            {activeInstruction ? (
              <div className="plan-active-step">
                <strong>
                  {activeInstruction.step}. {activeInstruction.title}
                </strong>
                <span className="step-detail">{activeInstruction.instruction}</span>
              </div>
            ) : null}
            <div className="plan-actions">
              <button
                className="secondary-button"
                onClick={() => window.print()}
                type="button"
              >
                <Printer size={16} />
                Print plan
              </button>
              <button
                className="secondary-button"
                disabled={isHandingOff}
                onClick={openInWorkbench}
                type="button"
              >
                <Hammer size={16} />
                {isHandingOff ? "Opening workbench" : "Open in workbench"}
              </button>
            </div>
            {handoffError ? <p className="issue-detail">{handoffError}</p> : null}
          </section>

          <aside className="plan-print-area">
            <div className="plan-print-header">
              <h2>{result.build.title}</h2>
              <p className="muted">{result.build.summary}</p>
              <p className="plan-print-verdict">
                <CheckCircle2 size={14} /> Physics-verified plan: passes the engine gate
                (no overlaps, valid magnetic joins, stands under simulation
                {result.build.family === "ramp" ? ", roll test passed" : ""}).
              </p>
            </div>

            <section className="panel plan-shopping">
              <h2 className="section-title">
                <Box size={16} />
                Tile shopping list (Classic 100)
              </h2>
              <div className="inventory-list">
                {SHAPE_ORDER.filter(
                  (shape) =>
                    result.validation.usedInventory[shape] > 0 ||
                    CLASSIC_100_INVENTORY[shape] > 0
                ).map((shape) => {
                  const needed = result.validation.usedInventory[shape];
                  const inSet = CLASSIC_100_INVENTORY[shape];
                  const enough = needed <= inSet;
                  const color =
                    result.build.tiles.find((tile) => tile.shape === shape)?.color ?? "#d8dee2";
                  return (
                    <div className="tile-row" key={shape}>
                      <span className="swatch" style={{ background: color }} />
                      <div>
                        <strong>{TILE_SPECS[shape].label}</strong>
                        <span className="tile-meta">
                          need {needed} • set has {inSet}
                        </span>
                      </div>
                      <span className={`mini-pill ${enough ? "info" : "error"}`}>
                        {enough ? (needed > 0 ? "in set" : "not needed") : `short ${needed - inSet}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel plan-instructions">
              <h2 className="section-title">
                <ClipboardList size={16} />
                Step-by-step instructions
              </h2>
              <ol className="plan-instruction-list">
                {result.instructions.map((step) => (
                  <li className="plan-instruction" key={step.step}>
                    <button
                      className="plan-step-button plan-no-print-style"
                      onClick={() => setCurrentStep(step.step)}
                      type="button"
                    >
                      <div className="step-header">
                        <strong>
                          {step.step}. {step.title}
                        </strong>
                        <span className="muted">{step.tileIds.length} tiles</span>
                      </div>
                      <span className="step-detail">{step.instruction}</span>
                      <span className="plan-step-tiles muted">
                        {Object.entries(step.tileCounts)
                          .filter(([, count]) => (count ?? 0) > 0)
                          .map(([shape, count]) => `${count}x ${TILE_SPECS[shape as keyof typeof TILE_SPECS].shortLabel}`)
                          .join(", ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
