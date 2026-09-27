"use client";

import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  BallCollider,
  ConvexHullCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useAfterPhysicsStep,
  useRapier,
  useRevoluteJoint,
  type RapierRigidBody
} from "@react-three/rapier";
import {
  ArrowLeft,
  Circle,
  Magnet,
  Plus,
  Play,
  RotateCcw,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import Link from "next/link";
import { createRef, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  addEdgeSnappedTile,
  addRootTile,
  createDraftFromGenerated,
  createEmptyDraft,
  deleteBuilderTiles,
  draftToBuildGraph,
  previewEdgeSnappedTile,
  updateBuilderTile
} from "@/lib/builder/operations";
import type { EdgeFitMode } from "@/lib/builder/operations";
import type { AuthoredBuildDraft, BuildDraftSummary, BuilderTile } from "@/lib/builder/types";
import { BALL_FRICTION, GROUND_FRICTION, HINGE_MAX_ANGLE, HINGE_MIN_ANGLE, ROLL_TEST_OFF_SURFACE_MARGIN, ROLL_TEST_SETTLE_STEPS, SIMULATION_TIMESTEP_SECONDS, TILE_CONTACT_SKIN, TILE_FRICTION, TILE_THICKNESS } from "@/lib/engine/constants";
import { createMagneticPhysicsModel, createRollTestPlan, currentWorldEdgeFromBody, gravityVector, isFunctionalRamp, sampleJointBreak, type MagneticPhysicsModel, type PhysicsBodyModel, type PhysicsJointModel, type RollTestPlan } from "@/lib/engine/physics-model";
import type { GateBuildResult } from "@/lib/engine";
import { SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { tileLocalVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { magnetFractionsForLength, tileWorldMagnetPositions } from "@/lib/magnetic-tiles/magnets";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";
import type { GeneratedBuildResponse, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import { JET_AIRCRAFT_REFERENCE_FRAMES } from "@/lib/reference-encoder/examples/jet-aircraft-frames";

const DEFAULT_COLOR = "#118ab2";
const EMPTY_WORKBENCH_TIME = "1970-01-01T00:00:00.000Z";
type CameraMove = { direction: "left" | "right" | "up" | "down" | "in" | "out"; nonce: number };
type SelectedEdge = { tileId: string; edge: number; magnetIndex?: number; t?: number };
type SimulationMode = "edit" | "stability" | "roll";
type GateState =
  | { status: "checking"; gate?: GateBuildResult; detail?: string }
  | { status: "ready"; gate: GateBuildResult; detail?: string }
  | { status: "error"; gate?: GateBuildResult; detail: string };
type SandboxStatus = {
  maxDisplacement: number;
  maxSpeed: number;
  poppedJoints: string[];
  roll?: "running" | "reached-bottom" | "fell-off";
};
type BodyRef = RefObject<RapierRigidBody | null>;
const FOLD_OPTIONS = [
  { label: "-90", value: -Math.PI / 2 },
  { label: "-45", value: -Math.PI / 4 },
  { label: "0", value: 0 },
  { label: "45", value: Math.PI / 4 },
  { label: "90", value: Math.PI / 2 }
];

export default function BuilderPage() {
  const [draft, setDraft] = useState<AuthoredBuildDraft>(() => createStableWorkbenchDraft());
  const [draftHistory, setDraftHistory] = useState<AuthoredBuildDraft[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<BuildDraftSummary[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [selectedTileIds, setSelectedTileIds] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [shape, setShape] = useState<TileShape>("small-square");
  const [childEdge, setChildEdge] = useState(0);
  const [foldAngle, setFoldAngle] = useState(0);
  const [edgeFit, setEdgeFit] = useState<EdgeFitMode>("auto");
  const [reverse, setReverse] = useState(true);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [status, setStatus] = useState<string | null>(null);
  const [gateState, setGateState] = useState<GateState>({ status: "checking" });
  const [simulationMode, setSimulationMode] = useState<SimulationMode>("edit");
  const [simulationNonce, setSimulationNonce] = useState(0);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const build = useMemo(() => draftToBuildGraph(draft), [draft]);
  const rollPlan = useMemo(() => createRollTestPlan(build), [build]);
  const isRamp = useMemo(() => isFunctionalRamp(build), [build]);
  const selectedTile = draft.tiles.find((tile) => tile.id === selectedTileId) ?? null;
  const actionTileIds = selectedTileIds.length > 0 ? selectedTileIds : selectedTileId ? [selectedTileId] : [];
  const ghostTile = useMemo(() => {
    if (!selectedEdge) return null;
    return previewEdgeSnappedTile(draft, {
      parentTileId: selectedEdge.tileId,
      parentEdge: selectedEdge.edge,
      parentMagnetT: selectedEdge.t,
      childShape: shape,
      childEdge,
      foldAngle,
      edgeFit,
      reverse,
      color,
      role: `${TILE_SPECS[shape].shortLabel.toLowerCase()} attached panel`,
      step: selectedTile?.step ?? 1,
      subassemblyId: selectedTile?.subassemblyId
    });
  }, [childEdge, color, draft, edgeFit, foldAngle, reverse, selectedEdge, selectedTile?.step, selectedTile?.subassemblyId, shape]);

  useEffect(() => {
    void loadLibraryDraft(BUILD_LIBRARY[0]?.prompt ?? "Jet Aircraft");
    void refreshDrafts();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setGateState((current) => ({ status: "checking", gate: current.gate }));
      void fetch("/api/gate-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
        signal: controller.signal
      })
        .then(async (response) => {
          const body = (await response.json()) as { gate?: GateBuildResult; detail?: string };
          if (!response.ok || !body.gate) throw new Error(body.detail ?? "Could not run engine gate.");
          setGateState({ status: "ready", gate: body.gate });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setGateState({ status: "error", detail: error instanceof Error ? error.message : "Could not run engine gate." });
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draft]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableTarget(event.target) || actionTileIds.length === 0) return;

      event.preventDefault();
      deleteSelected();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actionTileIds, draft]);

  async function refreshDrafts() {
    const response = await fetch("/api/build-drafts");
    if (!response.ok) return;
    const body = (await response.json()) as { drafts: BuildDraftSummary[] };
    setSavedDrafts(body.drafts);
  }

  async function loadLibraryDraft(prompt: string, draftId?: string) {
    setStatus("Loading build into workbench");
    if (draftId) {
      const savedResponse = await fetch(`/api/build-drafts/${draftId}`);
      if (savedResponse.ok) {
        const body = (await savedResponse.json()) as { draft: AuthoredBuildDraft };
        setDraft(body.draft);
        setDraftHistory([]);
        setSelectedTileId(body.draft.tiles[0]?.id ?? null);
        setSelectedTileIds(body.draft.tiles[0] ? [body.draft.tiles[0].id] : []);
        setSelectedEdge(null);
        resetSimulation();
        setStatus("Loaded saved stock draft.");
        return;
      }
    }

    const response = await fetch("/api/generate-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, inventoryPreset: "classic-100" })
    });
    const generated = (await response.json()) as GeneratedBuildResponse;
    const next = createDraftFromGenerated(generated, {
      id: generated.build.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      status: "draft",
      referenceFrameSrcs: generated.build.title === "Jet Aircraft" ? JET_AIRCRAFT_REFERENCE_FRAMES.map((frame) => frame.src) : []
    });
    setDraft(next);
    setDraftHistory([]);
    setSelectedTileId(next.tiles[0]?.id ?? null);
    setSelectedTileIds(next.tiles[0] ? [next.tiles[0].id] : []);
    setSelectedEdge(null);
    resetSimulation();
    setStatus(null);
  }

  async function loadSavedDraft(id: string) {
    if (!id) return;
    const response = await fetch(`/api/build-drafts/${id}`);
    const body = (await response.json()) as { draft: AuthoredBuildDraft };
    setDraft(body.draft);
    setDraftHistory([]);
    setSelectedTileId(body.draft.tiles[0]?.id ?? null);
    setSelectedTileIds(body.draft.tiles[0] ? [body.draft.tiles[0].id] : []);
    setSelectedEdge(null);
    resetSimulation();
  }

  async function saveDraft() {
    const response = await fetch("/api/build-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    });
    const body = (await response.json()) as { draft?: AuthoredBuildDraft; gate?: GateBuildResult; detail?: string };
    if (!response.ok || !body.draft) {
      setStatus(body.detail ?? "Could not save draft.");
      return;
    }
    setDraft(body.draft);
    setDraftHistory([]);
    if (body.gate) setGateState({ status: "ready", gate: body.gate });
    setStatus(`Saved ${body.draft.title}. Engine gate: ${body.gate?.passed ? "passed" : "failed"}.`);
    await refreshDrafts();
  }

  function addRoot() {
    if (draft.tiles.length > 0) return;
    const next = addRootTile(draft, {
      shape,
      color,
      role: "root panel",
      subassemblyId: "body"
    });
    const added = next.tiles[next.tiles.length - 1];
    commitDraft(next);
    setSelectedTileId(added.id);
    setSelectedTileIds([added.id]);
    setSelectedEdge(null);
  }

  function addSnapped() {
    if (!selectedEdge) return;
    const next = addEdgeSnappedTile(draft, {
      parentTileId: selectedEdge.tileId,
      parentEdge: selectedEdge.edge,
      parentMagnetT: selectedEdge.t,
      childShape: shape,
      childEdge,
      foldAngle,
      edgeFit,
      reverse,
      color,
      role: `${TILE_SPECS[shape].shortLabel.toLowerCase()} attached panel`,
      step: selectedTile?.step ?? 1,
      subassemblyId: selectedTile?.subassemblyId
    });
    if (next === draft) {
      setStatus("That placement intersects another tile. Try another edge or fold angle.");
      return;
    }
    setStatus(null);
    const added = next.tiles[next.tiles.length - 1];
    commitDraft(next);
    setSelectedTileId(added?.id ?? selectedTileId);
    setSelectedTileIds(added ? [added.id] : selectedTileId ? [selectedTileId] : []);
    setSelectedEdge(null);
  }

  function updateSelected(patch: Partial<Pick<BuilderTile, "role" | "subassemblyId" | "step" | "color" | "confirmed">>) {
    if (!selectedTileId) return;
    commitDraft(updateBuilderTile(draft, selectedTileId, patch));
  }

  function selectTile(tileId: string, additive: boolean) {
    setSelectedEdge(null);
    setSelectedTileId(tileId);
    setSelectedTileIds((current) => {
      if (!additive) return [tileId];
      if (current.includes(tileId)) {
        const next = current.filter((id) => id !== tileId);
        if (next.length === 0) {
          setSelectedTileId(null);
        }
        return next;
      }
      return [...current, tileId];
    });
  }

  function deleteSelected() {
    if (actionTileIds.length === 0) return;

    const next = deleteBuilderTiles(draft, actionTileIds);
    commitDraft(next);
    setSelectedTileId(next.tiles[0]?.id ?? null);
    setSelectedTileIds(next.tiles[0] ? [next.tiles[0].id] : []);
    setSelectedEdge(null);
    setStatus(`Deleted ${actionTileIds.length} selected tile${actionTileIds.length === 1 ? "" : "s"}.`);
  }

  function commitDraft(next: AuthoredBuildDraft) {
    setDraftHistory((history) => [...history.slice(-29), draft]);
    setDraft(next);
    resetSimulation();
  }

  function undoDraft() {
    const previous = draftHistory[draftHistory.length - 1];
    if (!previous) return;

    setDraftHistory((history) => history.slice(0, -1));
    setDraft(previous);
    const previousIds = new Set(previous.tiles.map((tile) => tile.id));
    const nextSelectedIds = selectedTileIds.filter((id) => previousIds.has(id));
    const nextPrimary = selectedTileId && previousIds.has(selectedTileId)
      ? selectedTileId
      : nextSelectedIds[0] ?? previous.tiles[0]?.id ?? null;
    setSelectedTileId(nextPrimary);
    setSelectedTileIds(nextSelectedIds.length > 0 ? nextSelectedIds : nextPrimary ? [nextPrimary] : []);
    setSelectedEdge(null);
    resetSimulation();
    setStatus("Undid last builder edit.");
  }

  function runStabilityTest() {
    setSimulationMode("stability");
    setSimulationNonce((nonce) => nonce + 1);
    setSandboxStatus(null);
  }

  function runRollTest() {
    setSimulationMode("roll");
    setSimulationNonce((nonce) => nonce + 1);
    setSandboxStatus(null);
  }

  function resetSimulation() {
    setSimulationMode("edit");
    setSimulationNonce((nonce) => nonce + 1);
    setSandboxStatus(null);
  }

  const selectedEdgeCount = selectedTile ? TILE_SPECS[selectedTile.shape].maxEdges : 0;
  const childEdgeCount = TILE_SPECS[shape].maxEdges;
  const gateLabel = gateState.status === "checking"
    ? "checking engine"
    : gateState.status === "error"
      ? "gate unavailable"
      : gateState.gate.passed
        ? "engine-valid"
        : "engine failed";
  const gateClass = gateState.status === "checking" ? "warn" : gateState.status === "ready" && gateState.gate.passed ? "pass" : "error";

  return (
    <main className="app-shell builder-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Magnet size={22} />
          </div>
          <div>
            <h1>Build Workbench</h1>
            <span>Author magnetic tile geometry before calling a build reviewed</span>
          </div>
        </div>
        <Link className="builder-link" href="/">
          <ArrowLeft size={16} />
          Library
        </Link>
        <button className="builder-link" disabled={draftHistory.length === 0} onClick={undoDraft} type="button">
          <Undo2 size={16} />
          Undo
        </button>
      </header>

      <section className="builder-workspace">
        <aside className="panel builder-panel">
          <section>
            <h2 className="section-title">Load</h2>
            <div className="builder-button-grid">
              {BUILD_LIBRARY.map((item) => (
                <button className="chip-button" key={item.id} onClick={() => loadLibraryDraft(item.prompt, item.id)} type="button">
                  {item.title}
                </button>
              ))}
            </div>
            <label className="builder-label">
              <span>Saved drafts</span>
              <select className="text-input" onChange={(event) => loadSavedDraft(event.target.value)} value="">
                <option value="">Choose a saved draft</option>
                {savedDrafts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.status}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section>
            <h2 className="section-title">Tools</h2>
            <label className="builder-label">
              <span>Shape</span>
              <select className="text-input" onChange={(event) => setShape(event.target.value as TileShape)} value={shape}>
                {SHAPE_ORDER.map((item) => (
                  <option key={item} value={item}>{TILE_SPECS[item].label}</option>
                ))}
              </select>
            </label>
            <label className="builder-label">
              <span>Color</span>
              <input className="text-input color-input" onChange={(event) => setColor(event.target.value)} type="color" value={color} />
            </label>
            <div className="builder-stack">
              <p className="builder-hint">
                Construction is edge-to-edge only: create one root tile, then click a magnet dot on an existing tile and attach the next tile to that edge.
              </p>
              {draft.tiles.length === 0 ? (
                <button className="primary-button" onClick={addRoot} type="button">
                  <Plus size={16} />
                  Start root tile
                </button>
              ) : (
                <button className="primary-button" disabled={!selectedEdge} onClick={addSnapped} type="button">
                  <Plus size={16} />
                  Add snapped tile
                </button>
              )}
              <div className="mini-grid">
                <label>
                  <span>Parent edge</span>
                  <select
                    className="text-input"
                    disabled={!selectedTile || draft.tiles.length === 0}
                    onChange={(event) => setSelectedEdge(selectedTileId ? { tileId: selectedTileId, edge: Number(event.target.value) } : null)}
                    value={selectedEdge?.edge ?? 0}
                  >
                    {Array.from({ length: Math.max(1, selectedEdgeCount) }, (_, index) => (
                      <option key={index} value={index}>edge {index}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Child edge</span>
                  <select className="text-input" onChange={(event) => setChildEdge(Number(event.target.value))} value={childEdge}>
                    {Array.from({ length: childEdgeCount }, (_, index) => (
                      <option key={index} value={index}>edge {index}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mini-grid">
                <label>
                  <span>Fold</span>
                  <select className="text-input" onChange={(event) => setFoldAngle(Number(event.target.value))} value={foldAngle}>
                    {FOLD_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value}>{option.label} deg</option>
                    ))}
                  </select>
                </label>
                <label className="check-row">
                  <input checked={reverse} onChange={(event) => setReverse(event.target.checked)} type="checkbox" />
                  Reverse edge
                </label>
              </div>
              <label className="builder-label">
                <span>Joint fit</span>
                <select className="text-input" onChange={(event) => setEdgeFit(event.target.value as EdgeFitMode)} value={edgeFit}>
                  <option value="auto">Auto: folded joins use clicked magnet</option>
                  <option value="flush">Flush edge alignment</option>
                  <option value="magnet-overlap">Magnet overlap alignment</option>
                </select>
              </label>
            </div>
          </section>

          <section>
            <h2 className="section-title">Actions</h2>
            <div className="builder-button-grid">
              <button
                className="secondary-button"
                disabled={actionTileIds.length === 0}
                onClick={deleteSelected}
                type="button"
              >
                <Trash2 size={15} />
                Delete
              </button>
              <button className="secondary-button" disabled={simulationMode !== "edit"} onClick={runStabilityTest} type="button">
                <Play size={15} />
                Test stability
              </button>
              <button className="secondary-button" disabled={!isRamp || !rollPlan} onClick={runRollTest} type="button">
                <Circle size={15} />
                Roll a ball
              </button>
              <button className="secondary-button" disabled={simulationMode === "edit"} onClick={resetSimulation} type="button">
                <RotateCcw size={15} />
                Reset
              </button>
            </div>
            {sandboxStatus ? (
              <p className="issue-detail">
                Run: displacement {sandboxStatus.maxDisplacement.toFixed(2)}, speed {sandboxStatus.maxSpeed.toFixed(2)}
                {sandboxStatus.poppedJoints.length ? `, popped joints ${sandboxStatus.poppedJoints.length}` : ""}
                {sandboxStatus.roll ? `, roll ${sandboxStatus.roll}` : ""}
              </p>
            ) : null}
          </section>
        </aside>

        <section className="panel builder-canvas-panel">
          <div className="builder-title-row">
            <div>
              <input
                className="builder-title-input"
                onChange={(event) => setDraft({ ...draft, title: event.target.value, prompt: event.target.value })}
                value={draft.title}
              />
              <div className="builder-selection-meta">
                <span>{draft.tiles.length} tiles · {draft.connections.length} confirmed joins</span>
                <span>
                  {selectedTileIds.length > 1
                    ? `${selectedTileIds.length} selected`
                    : selectedTile
                      ? `selected ${selectedTile.id}`
                      : "select a tile body or tile row"}
                </span>
                <span>
                  {selectedEdge
                    ? `edge ${selectedEdge.edge}${selectedEdge.magnetIndex !== undefined ? ` · magnet ${selectedEdge.magnetIndex + 1}` : ""} armed`
                    : "pick a magnet dot or parent edge to preview"}
                </span>
              </div>
            </div>
            <span className={`pill ${gateClass}`}>
              {gateLabel}
            </span>
          </div>
          <div className="builder-canvas-wrap">
            <BuilderCanvas
              build={build}
              draft={draft}
              ghostTile={ghostTile}
              onSimulationStatus={setSandboxStatus}
              selectedEdge={selectedEdge}
              selectedTileId={selectedTileId}
              selectedTileIds={selectedTileIds}
              simulationMode={simulationMode}
              simulationNonce={simulationNonce}
              onSelectEdge={(tileId, edge, magnetIndex, t) => {
                setSelectedTileId(tileId);
                setSelectedTileIds([tileId]);
                setSelectedEdge({ tileId, edge, magnetIndex, t });
              }}
              onSelectTile={selectTile}
            />
          </div>
          {draft.referenceFrameSrcs.length > 0 ? (
            <div className="builder-reference-rail">
              {draft.referenceFrameSrcs.map((src) => (
                <img alt="Reference frame" key={src} src={src} />
              ))}
            </div>
          ) : null}
        </section>

        <aside className="panel builder-panel">
          <section>
            <h2 className="section-title">Selection</h2>
            <p className="builder-hint">
              Click a tile body to select it. Shift-click tile bodies or rows to select a group. New tiles can only be attached through a selected magnet edge.
            </p>
            {selectedTileIds.length > 1 ? (
              <div className="selection-count">
                <strong>{selectedTileIds.length} tiles selected</strong>
                <button className="text-button" onClick={() => setSelectedTileIds(selectedTileId ? [selectedTileId] : [])} type="button">
                  Keep primary only
                </button>
              </div>
            ) : null}
            <div className="builder-tile-list">
              {draft.tiles.map((tile) => (
                <button
                  className={`builder-tile-button ${selectedTileIds.includes(tile.id) ? "selected" : ""}`}
                  key={tile.id}
                  onClick={(event) => selectTile(tile.id, event.shiftKey)}
                  type="button"
                >
                  <span>
                    <strong>{tile.id}</strong>
                    <small>{TILE_SPECS[tile.shape].shortLabel} · step {tile.step}</small>
                  </span>
                  <span className={`mini-pill ${tile.confirmed ? "pass" : "warn"}`}>
                    {tile.root ? "root" : tile.confirmed ? "snap" : "loaded"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="section-title">Selected Tile</h2>
            {selectedTile ? (
              <div className="builder-stack">
                <strong>{selectedTile.id}</strong>
                <span className="muted">{TILE_SPECS[selectedTile.shape].label} · {selectedTile.authoredMode}</span>
                <label className="builder-label">
                  <span>Role</span>
                  <input className="text-input" onChange={(event) => updateSelected({ role: event.target.value })} value={selectedTile.role} />
                </label>
                <label className="builder-label">
                  <span>Subassembly</span>
                  <input className="text-input" onChange={(event) => updateSelected({ subassemblyId: event.target.value })} value={selectedTile.subassemblyId ?? ""} />
                </label>
                <label className="builder-label">
                  <span>Build step</span>
                  <input className="text-input" min={1} onChange={(event) => updateSelected({ step: Number(event.target.value) })} type="number" value={selectedTile.step} />
                </label>
                <small className="muted">
                  Position {formatVec(selectedTile.position)}
                </small>
                {selectedTileIds.length > 1 ? (
                  <small className="muted">
                    Group actions will affect {selectedTileIds.length} selected tiles. Inspector fields edit the primary tile only.
                  </small>
                ) : null}
              </div>
            ) : (
              <p className="muted">Select a tile or edge in the canvas.</p>
            )}
          </section>

          <section>
            <h2 className="section-title">Readiness</h2>
            <label className="check-row">
              <input
                checked={draft.visualSignoff}
                onChange={(event) => commitDraft({ ...draft, visualSignoff: event.target.checked })}
                type="checkbox"
              />
              Visual signoff complete
            </label>
            <div className="issues-list">
              {gateState.status === "checking" ? (
                <div className="issue">
                  <strong>Running engine gate</strong>
                  <span className="issue-detail">Checking pre-filters, standing stability, and ramp roll test when applicable.</span>
                </div>
              ) : gateState.status === "error" ? (
                <div className="issue">
                  <strong>Engine gate unavailable</strong>
                  <span className="issue-detail">{gateState.detail}</span>
                </div>
              ) : gateState.gate.reasons.length ? (
                gateState.gate.reasons.map((reason) => (
                  <div className="issue" key={reason}>
                    <span className="issue-detail">{reason}</span>
                  </div>
                ))
              ) : (
                <div className="issue">
                  <strong>Engine gate passed</strong>
                  <span className="issue-detail">Recognizable-object resemblance remains a human note on top of the physics gate.</span>
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="section-title">Inventory</h2>
            <div className="inventory-list">
              {SHAPE_ORDER.map((item) => {
                const used = draft.tiles.filter((tile) => tile.shape === item).length;
                const total = draft.expectedInventory?.[item] ?? used;
                return (
                  <div className="tile-row compact-row" key={item}>
                    <strong>{TILE_SPECS[item].shortLabel}</strong>
                    <span className={used > total ? "error-text" : "muted"}>{used}/{total}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="section-title">Save</h2>
            <button className="primary-button" onClick={saveDraft} type="button">
              <Save size={16} />
              Save local draft
            </button>
            {status ? <p className="issue-detail">{status}</p> : null}
            <details className="secondary-details">
              <summary className="secondary-button export-summary">Reference JSON</summary>
              <pre className="json-preview">{JSON.stringify(draft, null, 2)}</pre>
            </details>
          </section>
        </aside>
      </section>
    </main>
  );
}

function createStableWorkbenchDraft(): AuthoredBuildDraft {
  const draft = createEmptyDraft("Workbench Draft");
  return {
    ...draft,
    createdAt: EMPTY_WORKBENCH_TIME,
    updatedAt: EMPTY_WORKBENCH_TIME
  };
}

function BuilderCanvas({
  build,
  draft,
  ghostTile,
  onSimulationStatus,
  selectedEdge,
  selectedTileId,
  selectedTileIds,
  simulationMode,
  simulationNonce,
  onSelectEdge,
  onSelectTile
}: {
  build: ReturnType<typeof draftToBuildGraph>;
  draft: AuthoredBuildDraft;
  ghostTile: BuilderTile | null;
  onSimulationStatus: (status: SandboxStatus) => void;
  selectedEdge: SelectedEdge | null;
  selectedTileId: string | null;
  selectedTileIds: string[];
  simulationMode: SimulationMode;
  simulationNonce: number;
  onSelectEdge: (tileId: string, edge: number, magnetIndex?: number, t?: number) => void;
  onSelectTile: (tileId: string, additive: boolean) => void;
}) {
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    const cameraDistance = Math.max(18, build.bounds.width, build.bounds.height, build.bounds.depth) * 1.9;
    return [cameraDistance * 0.65, cameraDistance * 0.5, cameraDistance * 0.8];
  }, [build.bounds.depth, build.bounds.height, build.bounds.width]);
  const [cameraMove, setCameraMove] = useState<CameraMove | null>(null);
  const moveCamera = (direction: CameraMove["direction"]) => {
    setCameraMove({ direction, nonce: Date.now() });
  };
  const physicsModel = useMemo(() => createMagneticPhysicsModel(build, { drop: true }), [build]);
  const rollPlan = useMemo(() => createRollTestPlan(build), [build]);
  const isRunning = simulationMode !== "edit";
  const physicsKey = `${simulationMode}-${simulationNonce}-${build.id}-${draft.updatedAt}`;

  return (
    <div className="builder-camera-stage">
      <Canvas camera={{ position: initialCameraPosition, fov: 42 }} shadows>
        <ambientLight intensity={0.75} />
        <directionalLight castShadow intensity={1.6} position={[8, 16, 12]} />
        {isRunning ? (
          <Physics
            colliders={false}
            gravity={tuple(gravityVector())}
            interpolate
            key={physicsKey}
            lengthUnit={10}
            numSolverIterations={16}
            paused={false}
            timeStep={SIMULATION_TIMESTEP_SECONDS}
          >
            <PhysicsSandbox
              model={physicsModel}
              onSimulationStatus={onSimulationStatus}
              rollPlan={simulationMode === "roll" ? rollPlan : null}
            />
          </Physics>
        ) : (
          <>
            {draft.tiles.map((tile) => (
              <BuilderTileMesh
                isPrimarySelected={tile.id === selectedTileId}
                isSelected={selectedTileIds.includes(tile.id)}
                key={tile.id}
                onSelectEdge={onSelectEdge}
                onSelectTile={onSelectTile}
                selectedEdge={selectedEdge}
                tile={tile}
              />
            ))}
            {ghostTile ? <BuilderTileMesh ghost tile={ghostTile} /> : null}
          </>
        )}
        <gridHelper args={[Math.max(24, build.bounds.width + 16), 16, "#9fb0b8", "#d4dde0"]} position={[0, 0, 0]} />
        <BuilderOrbitControls build={build} command={cameraMove} />
      </Canvas>
      <div className="camera-nudge-panel" aria-label="Camera movement controls">
        <span>POV</span>
        <button onClick={() => moveCamera("up")} type="button">Up</button>
        <button onClick={() => moveCamera("in")} type="button">In</button>
        <button onClick={() => moveCamera("left")} type="button">Left</button>
        <button onClick={() => moveCamera("right")} type="button">Right</button>
        <button onClick={() => moveCamera("out")} type="button">Out</button>
        <button onClick={() => moveCamera("down")} type="button">Down</button>
      </div>
    </div>
  );
}

function PhysicsSandbox({
  model,
  onSimulationStatus,
  rollPlan
}: {
  model: MagneticPhysicsModel;
  onSimulationStatus: (status: SandboxStatus) => void;
  rollPlan: RollTestPlan | null;
}) {
  const bodyRefs = useMemo(() => {
    return new Map(model.bodies.map((body) => [body.tile.id, createRef<RapierRigidBody>()]));
  }, [model]);
  const [poppedJoints, setPoppedJoints] = useState<string[]>([]);
  const poppedRef = useRef(new Set<string>());
  const [rollStatus, setRollStatus] = useState<SandboxStatus["roll"]>(rollPlan ? "running" : undefined);

  function handleJointBreak(id: string) {
    if (poppedRef.current.has(id)) return;
    poppedRef.current.add(id);
    setPoppedJoints([...poppedRef.current]);
  }

  return (
    <>
      <RigidBody colliders={false} position={tuple(model.ground.position)} type="fixed">
        <CuboidCollider
          args={[model.ground.halfExtents.x, model.ground.halfExtents.y, model.ground.halfExtents.z]}
          friction={GROUND_FRICTION}
          restitution={0}
        />
      </RigidBody>
      {model.bodies.map((body) => (
        <PhysicsTileBody body={body} bodyRef={bodyRefs.get(body.tile.id) ?? createRef<RapierRigidBody>()} key={body.tile.id} />
      ))}
      {model.joints.map((joint) => {
        const fromRef = bodyRefs.get(joint.fromTileId);
        const toRef = bodyRefs.get(joint.toTileId);
        if (!fromRef || !toRef || poppedJoints.includes(joint.id)) return null;
        return <BreakableRevoluteJoint fromRef={fromRef} joint={joint} key={joint.id} onBreak={handleJointBreak} toRef={toRef} />;
      })}
      <PhysicsTelemetry bodyRefs={bodyRefs} model={model} onSimulationStatus={onSimulationStatus} poppedJoints={poppedJoints} roll={rollStatus} />
      {rollPlan ? <PhysicsRollLauncher onRollStatus={setRollStatus} plan={rollPlan} /> : null}
    </>
  );
}

function PhysicsTileBody({ body, bodyRef }: { body: PhysicsBodyModel; bodyRef: BodyRef }) {
  const geometry = useMemo(() => createTileGeometry(body.tile), [body.tile]);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: body.tile.color,
        transparent: true,
        opacity: 0.78,
        roughness: 0.36,
        metalness: 0.02,
        side: THREE.DoubleSide
      }),
    [body.tile.color]
  );

  return (
    <RigidBody
      additionalSolverIterations={8}
      angularVelocity={tuple(body.angularVelocity)}
      colliders={false}
      linearVelocity={tuple(body.linearVelocity)}
      position={tuple(body.translation)}
      ref={bodyRef}
      rotation={tileRotation(body.tile)}
      type="dynamic"
      userData={{ tileId: body.tile.id }}
    >
      <ConvexHullCollider
        args={[body.localHullPoints]}
        contactSkin={TILE_CONTACT_SKIN}
        friction={TILE_FRICTION}
        mass={body.mass}
        restitution={0.02}
      />
      <mesh castShadow geometry={geometry} material={material} receiveShadow>
        <Edges color="#1b252b" lineWidth={1.1} threshold={15} />
      </mesh>
    </RigidBody>
  );
}

function BreakableRevoluteJoint({
  fromRef,
  joint,
  onBreak,
  toRef
}: {
  fromRef: BodyRef;
  joint: PhysicsJointModel;
  onBreak: (id: string) => void;
  toRef: BodyRef;
}) {
  const { world } = useRapier();
  const previousDistanceRef = useRef(0);
  const impulseJoint = useRevoluteJoint(fromRef as RefObject<RapierRigidBody>, toRef as RefObject<RapierRigidBody>, [
    tuple(joint.fromLocalAnchor),
    tuple(joint.toLocalAnchor),
    tuple(joint.axis),
    [HINGE_MIN_ANGLE, HINGE_MAX_ANGLE]
  ]);

  useEffect(() => {
    impulseJoint.current?.setContactsEnabled(true);
  }, [impulseJoint]);

  useAfterPhysicsStep(() => {
    if (!impulseJoint.current?.isValid()) return;
    const fromBody = fromRef.current;
    const toBody = toRef.current;
    if (!fromBody || !toBody) return;

    const fromEdge = currentWorldEdgeFromBody(vector(fromBody.translation()), fromBody.rotation(), joint.fromLocal);
    const toEdge = currentWorldEdgeFromBody(vector(toBody.translation()), toBody.rotation(), joint.toLocal);
    const sample = sampleJointBreak(fromEdge, toEdge, previousDistanceRef.current, SIMULATION_TIMESTEP_SECONDS);
    previousDistanceRef.current = sample.midpointDistance;
    if (!sample.shouldBreak) return;

    world.removeImpulseJoint(impulseJoint.current, true);
    onBreak(joint.id);
  });

  return null;
}

function PhysicsTelemetry({
  bodyRefs,
  model,
  onSimulationStatus,
  poppedJoints,
  roll
}: {
  bodyRefs: Map<string, BodyRef>;
  model: MagneticPhysicsModel;
  onSimulationStatus: (status: SandboxStatus) => void;
  poppedJoints: string[];
  roll?: SandboxStatus["roll"];
}) {
  const frameRef = useRef(0);

  useAfterPhysicsStep(() => {
    frameRef.current += 1;
    if (frameRef.current % 12 !== 0) return;

    let maxDisplacement = 0;
    let maxSpeed = 0;
    for (const bodyModel of model.bodies) {
      const body = bodyRefs.get(bodyModel.tile.id)?.current;
      if (!body) continue;
      maxDisplacement = Math.max(maxDisplacement, pointDistance(vector(body.translation()), bodyModel.targetPosition));
      maxSpeed = Math.max(maxSpeed, vectorMagnitude(vector(body.linvel())), vectorMagnitude(vector(body.angvel())));
    }
    onSimulationStatus({ maxDisplacement, maxSpeed, poppedJoints, roll });
  });

  return null;
}

function PhysicsRollLauncher({ onRollStatus, plan }: { onRollStatus: (status: SandboxStatus["roll"]) => void; plan: RollTestPlan }) {
  const [spawned, setSpawned] = useState(false);
  const settleStepsRef = useRef(0);

  useAfterPhysicsStep(() => {
    if (spawned) return;
    settleStepsRef.current += 1;
    if (settleStepsRef.current >= ROLL_TEST_SETTLE_STEPS) {
      setSpawned(true);
    }
  });

  return spawned ? <PhysicsRollBall onRollStatus={onRollStatus} plan={plan} /> : null;
}

function PhysicsRollBall({ onRollStatus, plan }: { onRollStatus: (status: SandboxStatus["roll"]) => void; plan: RollTestPlan }) {
  const ballRef = useRef<RapierRigidBody>(null);
  const statusRef = useRef<SandboxStatus["roll"]>("running");

  useAfterPhysicsStep(() => {
    const ball = ballRef.current;
    if (!ball || statusRef.current !== "running") return;
    const position = vector(ball.translation());
    const progress = dot3(subtract3(position, plan.start), plan.axis) / plan.length;
    const alongAxis = scale3(plan.axis, dot3(subtract3(position, plan.start), plan.axis));
    const lateral = vectorMagnitude(subtract3(subtract3(position, plan.start), alongAxis));
    const nextStatus = progress >= 0.84 || distance2d(position, plan.bottom) <= plan.radius + 0.75
      ? "reached-bottom"
      : position.y < -0.4 || lateral > plan.halfWidth + ROLL_TEST_OFF_SURFACE_MARGIN
        ? "fell-off"
        : "running";

    if (nextStatus === statusRef.current) return;
    statusRef.current = nextStatus;
    onRollStatus(nextStatus);
  });

  return (
    <RigidBody
      additionalSolverIterations={12}
      ccd
      colliders={false}
      linearVelocity={[plan.downhill.x * 0.25, -0.02, plan.downhill.z * 0.25]}
      position={[plan.start.x, plan.start.y + plan.radius + 0.08, plan.start.z]}
      ref={ballRef}
      type="dynamic"
    >
      <BallCollider args={[plan.radius]} friction={BALL_FRICTION} mass={0.045} restitution={0.03} />
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[plan.radius, 24, 16]} />
        <meshStandardMaterial color="#f05d5e" roughness={0.32} />
      </mesh>
    </RigidBody>
  );
}

function BuilderOrbitControls({ build, command }: { build: ReturnType<typeof draftToBuildGraph>; command: CameraMove | null }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const initializedRef = useRef(false);
  const { camera } = useThree();

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || initializedRef.current || build.tiles.length === 0) return;
    controls.target.set(0, Math.max(1, build.bounds.height * 0.2), 0);
    controls.update();
    initializedRef.current = true;
  }, [build.bounds.height, build.tiles.length]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!command || !controls) return;

    const viewDirection = new THREE.Vector3();
    camera.getWorldDirection(viewDirection).normalize();
    const right = new THREE.Vector3().crossVectors(viewDirection, camera.up).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const panStep = Math.max(0.75, Math.min(3, Math.max(build.bounds.width, build.bounds.height, build.bounds.depth) * 0.08));
    const dollyStep = panStep * 1.4;
    const movement = new THREE.Vector3();

    if (command.direction === "left") movement.copy(right).multiplyScalar(-panStep);
    if (command.direction === "right") movement.copy(right).multiplyScalar(panStep);
    if (command.direction === "up") movement.copy(up).multiplyScalar(panStep);
    if (command.direction === "down") movement.copy(up).multiplyScalar(-panStep);
    if (command.direction === "in") movement.copy(viewDirection).multiplyScalar(dollyStep);
    if (command.direction === "out") movement.copy(viewDirection).multiplyScalar(-dollyStep);

    camera.position.add(movement);
    if (command.direction !== "in" && command.direction !== "out") {
      controls.target.add(movement);
    }
    controls.update();
  }, [build.bounds.depth, build.bounds.height, build.bounds.width, camera, command]);

  return <OrbitControls ref={controlsRef} enableDamping makeDefault maxDistance={90} minDistance={8} />;
}

function BuilderTileMesh({
  ghost = false,
  isPrimarySelected = false,
  isSelected = false,
  selectedEdge,
  tile,
  onSelectEdge,
  onSelectTile
}: {
  ghost?: boolean;
  isPrimarySelected?: boolean;
  isSelected?: boolean;
  selectedEdge?: SelectedEdge | null;
  tile: BuilderTile;
  onSelectEdge?: (tileId: string, edge: number, magnetIndex?: number, t?: number) => void;
  onSelectTile?: (tileId: string, additive: boolean) => void;
}) {
  const geometry = useMemo(() => createTileGeometry(tile), [tile]);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: tile.color,
        transparent: true,
        opacity: ghost ? 0.32 : tile.confirmed ? 0.78 : 0.54,
        roughness: 0.36,
        metalness: 0.02,
        side: THREE.DoubleSide
      }),
    [ghost, tile.color, tile.confirmed]
  );
  const matrix = useMemo(() => {
    if (!tile.basis) return null;
    const next = new THREE.Matrix4();
    next.makeBasis(
      new THREE.Vector3(tile.basis.xAxis.x, tile.basis.xAxis.y, tile.basis.xAxis.z),
      new THREE.Vector3(tile.basis.yAxis.x, tile.basis.yAxis.y, tile.basis.yAxis.z),
      new THREE.Vector3(tile.basis.zAxis.x, tile.basis.zAxis.y, tile.basis.zAxis.z)
    );
    next.setPosition(tile.position.x, tile.position.y, tile.position.z);
    return next;
  }, [tile.basis, tile.position.x, tile.position.y, tile.position.z]);

  const meshProps = matrix
    ? { matrix, matrixAutoUpdate: false }
    : {
        position: [tile.position.x, tile.position.y, tile.position.z] as [number, number, number],
        rotation: [tile.rotation.x, tile.rotation.y, tile.rotation.z] as [number, number, number]
      };
  const magnetPoints = useMemo(() => builderTileWorldMagnetPoints(tile), [tile]);

  return (
    <group>
      <mesh
        castShadow
        geometry={geometry}
        material={material}
        onClick={(event) => {
          event.stopPropagation();
          onSelectTile?.(tile.id, event.shiftKey);
        }}
        receiveShadow
        {...meshProps}
      >
        <Edges
          color={isPrimarySelected ? "#f05d5e" : isSelected ? "#24b7c9" : "#1b252b"}
          lineWidth={isPrimarySelected ? 2.4 : isSelected ? 2 : 1.1}
          threshold={15}
        />
      </mesh>
      {!ghost
        ? magnetPoints.map((magnet) => {
            const selected = selectedEdge?.tileId === tile.id && selectedEdge.edge === magnet.edgeIndex;
            return (
              <mesh
                key={`${tile.id}-edge-${magnet.edgeIndex}-magnet-${magnet.magnetIndex}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge?.(tile.id, magnet.edgeIndex, magnet.magnetIndex, magnet.t);
                }}
                position={[magnet.position.x, magnet.position.y, magnet.position.z]}
              >
                <sphereGeometry args={[selected ? 0.17 : 0.095, 14, 14]} />
                <meshBasicMaterial color={selected ? "#f7b733" : isSelected ? "#24b7c9" : "#142126"} />
              </mesh>
            );
          })
        : null}
    </group>
  );
}

function createTileGeometry(tile: { shape: TileShape; sizeOverride?: BuilderTile["sizeOverride"] }): THREE.ExtrudeGeometry {
  const path = new THREE.Shape();
  const vertices = builderLocalVertices(tile);
  path.moveTo(vertices[0].x, vertices[0].y);
  vertices.slice(1).forEach((vertex) => path.lineTo(vertex.x, vertex.y));
  path.lineTo(vertices[0].x, vertices[0].y);

  const geometry = new THREE.ExtrudeGeometry(path, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.03,
    depth: TILE_THICKNESS
  });
  geometry.translate(0, 0, -TILE_THICKNESS / 2);
  return geometry;
}

function builderTileWorldMagnetPoints(tile: BuilderTile): Array<{ edgeIndex: number; magnetIndex: number; position: Vec3; t: number }> {
  if (!tile.sizeOverride) {
    return tileWorldMagnetPositions(tile).map((magnet) => ({
      edgeIndex: magnet.edgeIndex,
      magnetIndex: magnet.magnetIndex,
      t: magnet.fraction,
      position: magnet.worldPoint
    }));
  }

  const vertices = builderLocalVertices(tile).map((point) => transformBuilderPoint(point, tile));
  return vertices.flatMap((start, edgeIndex) => {
    const end = vertices[(edgeIndex + 1) % vertices.length];
    const length = distance(start, end);
    return magnetFractionsForLength(length).map((t, magnetIndex) => {
      return {
        edgeIndex,
        magnetIndex,
        t,
        position: {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
          z: start.z + (end.z - start.z) * t
        }
      };
    });
  });
}

function builderLocalVertices(tile: { shape: TileShape; sizeOverride?: BuilderTile["sizeOverride"] }): Vec3[] {
  if (!tile.sizeOverride) return tileLocalVertices(tile.shape);
  const halfW = tile.sizeOverride.width / 2;
  const halfH = tile.sizeOverride.height / 2;

  if (TILE_SPECS[tile.shape].maxEdges === 4) {
    return [
      { x: -halfW, y: -halfH, z: 0 },
      { x: halfW, y: -halfH, z: 0 },
      { x: halfW, y: halfH, z: 0 },
      { x: -halfW, y: halfH, z: 0 }
    ];
  }

  if (tile.shape === "right-triangle") {
    return [
      { x: -halfW, y: -halfH, z: 0 },
      { x: halfW, y: -halfH, z: 0 },
      { x: -halfW, y: halfH, z: 0 }
    ];
  }

  return [
    { x: -halfW, y: -halfH, z: 0 },
    { x: halfW, y: -halfH, z: 0 },
    { x: 0, y: halfH, z: 0 }
  ];
}

function transformBuilderPoint(point: Vec3, tile: BuilderTile): Vec3 {
  if (tile.basis) {
    return {
      x: tile.basis.xAxis.x * point.x + tile.basis.yAxis.x * point.y + tile.basis.zAxis.x * point.z + tile.position.x,
      y: tile.basis.xAxis.y * point.x + tile.basis.yAxis.y * point.y + tile.basis.zAxis.y * point.z + tile.position.y,
      z: tile.basis.xAxis.z * point.x + tile.basis.yAxis.z * point.y + tile.basis.zAxis.z * point.z + tile.position.z
    };
  }

  const cosZ = Math.cos(tile.rotation.z);
  const sinZ = Math.sin(tile.rotation.z);
  const zRotated = {
    x: point.x * cosZ - point.y * sinZ,
    y: point.x * sinZ + point.y * cosZ,
    z: point.z
  };
  const cosY = Math.cos(tile.rotation.y);
  const sinY = Math.sin(tile.rotation.y);
  const yRotated = {
    x: zRotated.x * cosY + zRotated.z * sinY,
    y: zRotated.y,
    z: -zRotated.x * sinY + zRotated.z * cosY
  };
  const cosX = Math.cos(tile.rotation.x);
  const sinX = Math.sin(tile.rotation.x);
  return {
    x: yRotated.x + tile.position.x,
    y: yRotated.y * cosX - yRotated.z * sinX + tile.position.y,
    z: yRotated.y * sinX + yRotated.z * cosX + tile.position.z
  };
}

function tileRotation(tile: PhysicsBodyModel["tile"]): [number, number, number] {
  if (!tile.basis) return [tile.rotation.x, tile.rotation.y, tile.rotation.z];
  const matrix = new THREE.Matrix4();
  matrix.makeBasis(
    new THREE.Vector3(tile.basis.xAxis.x, tile.basis.xAxis.y, tile.basis.xAxis.z),
    new THREE.Vector3(tile.basis.yAxis.x, tile.basis.yAxis.y, tile.basis.yAxis.z),
    new THREE.Vector3(tile.basis.zAxis.x, tile.basis.zAxis.y, tile.basis.zAxis.z)
  );
  const euler = new THREE.Euler().setFromRotationMatrix(matrix);
  return [euler.x, euler.y, euler.z];
}

function tuple(point: Vec3): [number, number, number] {
  return [point.x, point.y, point.z];
}

function vector(point: { x: number; y: number; z: number }): Vec3 {
  return { x: point.x, y: point.y, z: point.z };
}

function vectorMagnitude(point: Vec3): number {
  return Math.sqrt(point.x ** 2 + point.y ** 2 + point.z ** 2);
}

function pointDistance(first: Vec3, second: Vec3): number {
  return vectorMagnitude(subtract3(first, second));
}

function subtract3(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scale3(point: Vec3, amount: number): Vec3 {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function dot3(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function distance2d(first: { x: number; z: number }, second: { x: number; z: number }): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function distance(first: Vec3, second: Vec3): number {
  return Math.sqrt((first.x - second.x) ** 2 + (first.y - second.y) ** 2 + (first.z - second.z) ** 2);
}

function formatVec(point: Vec3): string {
  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
