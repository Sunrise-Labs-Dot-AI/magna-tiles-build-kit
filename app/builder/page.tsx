"use client";

import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
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
  FolderOpen,
  Magnet,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import Link from "next/link";
import { createRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import {
  CLASSIC_TILE_COLORS,
  createDraftFromGenerated,
  createEmptyDraft,
  deleteBuilderTiles,
  draftToBuildGraph
} from "@/lib/builder/operations";
import {
  FOLD_CHOICES,
  collectTileSubtree,
  confirmGhostPlacement,
  clampChildEdge,
  cycleChildEdge,
  cycleFoldIndex,
  defaultPlacementSettings,
  deriveGhostPreview,
  placeRootOnGround,
  snapRootPosition,
  type MagnetHover,
  type PlacementSettings
} from "@/lib/builder/placement";
import type { AuthoredBuildDraft, BuildDraftSummary, BuilderTile } from "@/lib/builder/types";
import {
  BALL_FRICTION,
  GROUND_FRICTION,
  HINGE_MAX_ANGLE,
  HINGE_MIN_ANGLE,
  ROLL_TEST_OFF_SURFACE_MARGIN,
  ROLL_TEST_SETTLE_STEPS,
  SIMULATION_TIMESTEP_SECONDS,
  TILE_FRICTION,
  TILE_THICKNESS
} from "@/lib/engine/constants";
import {
  createMagneticPhysicsModel,
  createRollTestPlan,
  currentWorldEdgeFromBody,
  gravityVector,
  isFunctionalRamp,
  sampleJointBreak,
  type MagneticPhysicsModel,
  type PhysicsBodyModel,
  type PhysicsJointModel,
  type RollTestPlan
} from "@/lib/engine/physics-model";
import type { GateBuildResult } from "@/lib/engine";
import { SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { magnetFractionsForLength, tileWorldMagnetPositions } from "@/lib/magnetic-tiles/magnets";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";
import type { GeneratedBuildResponse, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";

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
type SnapBurstInstance = { id: number; position: Vec3 };
type BodyRef = RefObject<RapierRigidBody | null>;

const HISTORY_CAP = 60;
const WHEEL_STEP_THRESHOLD = 28;

export default function BuilderPage() {
  const [draft, setDraft] = useState<AuthoredBuildDraft>(() => createEmptyDraft("My Build"));
  const [past, setPast] = useState<AuthoredBuildDraft[]>([]);
  const [future, setFuture] = useState<AuthoredBuildDraft[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<BuildDraftSummary[]>([]);
  const [settings, setSettings] = useState<PlacementSettings>(() => defaultPlacementSettings());
  const [hover, setHover] = useState<MagnetHover | null>(null);
  const [rootHover, setRootHover] = useState<{ x: number; z: number } | null>(null);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tileId: string; at: number } | null>(null);
  const [bursts, setBursts] = useState<SnapBurstInstance[]>([]);
  const [toast, setToast] = useState<{ text: string; kind: "info" | "blocked" } | null>(null);
  const [gateState, setGateState] = useState<GateState>({ status: "checking" });
  const [gateOpen, setGateOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>("edit");
  const [simulationNonce, setSimulationNonce] = useState(0);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);

  const burstIdRef = useRef(1);
  const toastTimerRef = useRef<number | null>(null);
  const hoverRef = useRef<MagnetHover | null>(null);
  hoverRef.current = hover;
  const wheelAccumRef = useRef(0);

  const build = useMemo(() => draftToBuildGraph(draft), [draft]);
  const rollPlan = useMemo(() => createRollTestPlan(build), [build]);
  const isRamp = useMemo(() => isFunctionalRamp(build), [build]);
  const ghost = useMemo(() => deriveGhostPreview(draft, hover, settings), [draft, hover, settings]);
  const rootGhost = useMemo(() => {
    if (draft.tiles.length > 0 || !rootHover || simulationMode !== "edit") return null;
    const { draft: next } = placeRootOnGround(draft, {
      shape: settings.shape,
      color: settings.color,
      point: rootHover
    });
    return next.tiles[0] ?? null;
  }, [draft, rootHover, settings.color, settings.shape, simulationMode]);
  const selectedTile = draft.tiles.find((tile) => tile.id === selectedTileId) ?? null;
  const selectedSubtree = useMemo(
    () => (selectedTileId ? collectTileSubtree(draft, selectedTileId) : []),
    [draft, selectedTileId]
  );
  const isSimulating = simulationMode !== "edit";

  const showToast = useCallback((text: string, kind: "info" | "blocked" = "info") => {
    setToast({ text, kind });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const resetSimulation = useCallback(() => {
    setSimulationMode("edit");
    setSimulationNonce((nonce) => nonce + 1);
    setSandboxStatus(null);
  }, []);

  const commitDraft = useCallback(
    (next: AuthoredBuildDraft) => {
      setPast((history) => [...history.slice(-(HISTORY_CAP - 1)), draft]);
      setFuture([]);
      setDraft(next);
      resetSimulation();
    },
    [draft, resetSimulation]
  );

  const undo = useCallback(() => {
    setPast((history) => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setFuture((stack) => [draft, ...stack].slice(0, HISTORY_CAP));
      setDraft(previous);
      setSelectedTileId((id) => (id && previous.tiles.some((tile) => tile.id === id) ? id : null));
      setHover(null);
      resetSimulation();
      return history.slice(0, -1);
    });
  }, [draft, resetSimulation]);

  const redo = useCallback(() => {
    setFuture((stack) => {
      const next = stack[0];
      if (!next) return stack;
      setPast((history) => [...history.slice(-(HISTORY_CAP - 1)), draft]);
      setDraft(next);
      setSelectedTileId((id) => (id && next.tiles.some((tile) => tile.id === id) ? id : null));
      setHover(null);
      resetSimulation();
      return stack.slice(1);
    });
  }, [draft, resetSimulation]);

  const spawnBurst = useCallback((position: Vec3) => {
    const id = burstIdRef.current;
    burstIdRef.current += 1;
    setBursts((current) => [...current, { id, position }]);
    window.setTimeout(() => {
      setBursts((current) => current.filter((burst) => burst.id !== id));
    }, 520);
  }, []);

  const placeAtHover = useCallback(
    (target: MagnetHover) => {
      const result = confirmGhostPlacement(draft, target, settings);
      if (!result.placedTileId) {
        const blocked = deriveGhostPreview(draft, target, settings);
        showToast(blocked?.reason ?? "That tile can't snap there.", "blocked");
        return;
      }
      const placed = result.draft.tiles.find((tile) => tile.id === result.placedTileId);
      commitDraft(result.draft);
      setSelectedTileId(result.placedTileId);
      setHover(null);
      setFlash({ tileId: result.placedTileId, at: performance.now() });
      if (placed) spawnBurst(placed.position);
    },
    [commitDraft, draft, settings, showToast, spawnBurst]
  );

  const placeRoot = useCallback(
    (point: { x: number; z: number }) => {
      if (draft.tiles.length > 0) return;
      const result = placeRootOnGround(draft, { shape: settings.shape, color: settings.color, point });
      if (!result.placedTileId) return;
      commitDraft(result.draft);
      setSelectedTileId(result.placedTileId);
      setFlash({ tileId: result.placedTileId, at: performance.now() });
      spawnBurst(snapRootPosition(point));
      showToast("First tile down. Hover a magnet dot to snap the next one.");
    },
    [commitDraft, draft, settings.color, settings.shape, showToast, spawnBurst]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedTileId || selectedSubtree.length === 0) return;
    const next = deleteBuilderTiles(draft, selectedSubtree);
    commitDraft(next);
    setSelectedTileId(null);
    setHover(null);
    showToast(
      selectedSubtree.length === 1
        ? "Tile removed."
        : `Removed ${selectedSubtree.length} tiles (the tile and everything built on it).`
    );
  }, [commitDraft, draft, selectedSubtree, selectedTileId, showToast]);

  // Engine gate: debounce-check every draft state. The gate is law; this only reports it.
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
          setGateState({
            status: "error",
            detail: error instanceof Error ? error.message : "Could not run engine gate."
          });
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draft]);

  useEffect(() => {
    // /plan hands a generated build off via the draft store and links here
    // with ?draft=<id>; honor that instead of starting from empty ground.
    const requestedDraftId = new URLSearchParams(window.location.search).get("draft");
    if (requestedDraftId) {
      void loadSavedDraft(requestedDraftId);
    }
    void refreshDrafts();
  }, []);

  // Game keyboard map.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key >= "1" && event.key <= "9") {
        const index = Number(event.key) - 1;
        const shape = SHAPE_ORDER[index];
        if (shape) {
          setSettings((current) => ({
            ...current,
            shape,
            childEdge: clampChildEdge(shape, current.childEdge)
          }));
        }
        return;
      }

      switch (key) {
        case "q":
          setSettings((current) => ({ ...current, foldIndex: cycleFoldIndex(current.foldIndex, -1) }));
          break;
        case "e":
          setSettings((current) => ({ ...current, foldIndex: cycleFoldIndex(current.foldIndex, 1) }));
          break;
        case "r":
          setSettings((current) => ({ ...current, reverse: !current.reverse }));
          break;
        case "t":
          setSettings((current) => ({
            ...current,
            childEdge: cycleChildEdge(current.shape, current.childEdge, 1)
          }));
          break;
        case "enter":
          if (hoverRef.current) {
            event.preventDefault();
            placeAtHover(hoverRef.current);
          }
          break;
        case "backspace":
        case "delete":
          event.preventDefault();
          deleteSelected();
          break;
        case "escape":
          setHover(null);
          setSelectedTileId(null);
          setDrawerOpen(false);
          setGateOpen(false);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected, placeAtHover, redo, undo]);

  // Scroll wheel cycles the fold while a ghost is live (non-passive so we can stop zoom).
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    function handleWheel(event: WheelEvent) {
      if (!hoverRef.current) return;
      event.preventDefault();
      wheelAccumRef.current += event.deltaY;
      if (Math.abs(wheelAccumRef.current) < WHEEL_STEP_THRESHOLD) return;
      const direction = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;
      setSettings((current) => ({ ...current, foldIndex: cycleFoldIndex(current.foldIndex, direction) }));
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, []);

  async function refreshDrafts() {
    const response = await fetch("/api/build-drafts");
    if (!response.ok) return;
    const body = (await response.json()) as { drafts: BuildDraftSummary[] };
    setSavedDrafts(body.drafts);
  }

  function adoptDraft(next: AuthoredBuildDraft, note?: string) {
    setDraft(next);
    setPast([]);
    setFuture([]);
    setSelectedTileId(null);
    setHover(null);
    setRootHover(null);
    resetSimulation();
    setDrawerOpen(false);
    setFrameNonce((nonce) => nonce + 1);
    if (note) showToast(note);
  }

  async function loadLibraryDraft(prompt: string, draftId?: string) {
    setLoading(true);
    try {
      if (draftId) {
        const savedResponse = await fetch(`/api/build-drafts/${draftId}`);
        if (savedResponse.ok) {
          const body = (await savedResponse.json()) as { draft: AuthoredBuildDraft };
          adoptDraft(body.draft, `Loaded ${body.draft.title}.`);
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
        status: "draft"
      });
      adoptDraft(next, `Loaded ${next.title} as a starting point.`);
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedDraft(id: string) {
    if (!id) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/build-drafts/${id}`);
      if (!response.ok) return;
      const body = (await response.json()) as { draft: AuthoredBuildDraft };
      adoptDraft(body.draft, `Loaded ${body.draft.title}.`);
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    const response = await fetch("/api/build-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    });
    const body = (await response.json()) as { draft?: AuthoredBuildDraft; gate?: GateBuildResult; detail?: string };
    if (!response.ok || !body.draft) {
      showToast(body.detail ?? "Could not save the build.", "blocked");
      return;
    }
    setDraft(body.draft);
    if (body.gate) setGateState({ status: "ready", gate: body.gate });
    showToast(`Saved ${body.draft.title}. Gate: ${body.gate?.passed ? "passed" : "not yet passing"}.`);
    await refreshDrafts();
  }

  function startEmptyBuild() {
    adoptDraft(createEmptyDraft("My Build"), "Fresh ground. Click anywhere to lay the first tile.");
  }

  const gateLabel =
    draft.tiles.length === 0
      ? "ready to build"
      : gateState.status === "checking"
        ? "checking…"
        : gateState.status === "error"
          ? "gate offline"
          : gateState.gate.passed
            ? "stands strong"
            : "won't stand yet";
  const gateClass =
    draft.tiles.length === 0
      ? "idle"
      : gateState.status === "checking"
        ? "checking"
        : gateState.status === "ready" && gateState.gate.passed
          ? "pass"
          : "fail";
  const gateReasons = gateState.status === "ready" ? gateState.gate.reasons : [];
  const usedByShape = useMemo(() => {
    const counts = new Map<TileShape, number>();
    draft.tiles.forEach((tile) => counts.set(tile.shape, (counts.get(tile.shape) ?? 0) + 1));
    return counts;
  }, [draft.tiles]);

  return (
    <main className="play-shell">
      <div className="play-stage" ref={stageRef}>
        <BuilderCanvas
          frameNonce={frameNonce}
          bursts={bursts}
          draft={draft}
          flash={flash}
          ghost={ghost}
          hover={hover}
          isSimulating={isSimulating}
          onGroundClick={(point) => {
            if (draft.tiles.length === 0) placeRoot(point);
            else {
              setSelectedTileId(null);
              setHover(null);
            }
          }}
          onGroundMove={(point) => {
            if (draft.tiles.length === 0) setRootHover(point);
          }}
          onGroundLeave={() => setRootHover(null)}
          onHoverMagnet={setHover}
          onPlace={placeAtHover}
          onSelectTile={(tileId) => {
            setSelectedTileId(tileId);
            setHover(null);
          }}
          onSimulationStatus={setSandboxStatus}
          rootGhost={rootGhost}
          selectedTileId={selectedTileId}
          simulationMode={simulationMode}
          simulationNonce={simulationNonce}
          build={build}
        />

        {/* ---- top bar ---- */}
        <header className="play-topbar">
          <div className="play-topbar-left">
            <Link aria-label="Back to library" className="play-chip play-chip-icon" href="/">
              <ArrowLeft size={16} />
            </Link>
            <div className="play-brand">
              <span className="play-brand-mark">
                <Magnet size={16} />
              </span>
              <input
                aria-label="Build title"
                className="play-title-input"
                onChange={(event) => setDraft({ ...draft, title: event.target.value, prompt: event.target.value })}
                value={draft.title}
              />
            </div>
            <span className="play-tile-count">
              {draft.tiles.length} {draft.tiles.length === 1 ? "tile" : "tiles"}
            </span>
          </div>
          <div className="play-topbar-right">
            <div className="play-gate">
              <button
                className={`play-gate-pill ${gateClass}`}
                onClick={() => setGateOpen((open) => !open)}
                type="button"
              >
                <span className="play-gate-dot" />
                {gateLabel}
              </button>
              {gateOpen ? (
                <div className="play-gate-popover">
                  <strong>Engine gate</strong>
                  {gateState.status === "error" ? (
                    <p>{gateState.detail}</p>
                  ) : gateReasons.length > 0 ? (
                    <ul>
                      {gateReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : gateState.status === "ready" ? (
                    <p>No overlaps, valid magnet joints, and it stands under simulation.</p>
                  ) : (
                    <p>Checking physics…</p>
                  )}
                </div>
              ) : null}
            </div>
            <button className="play-chip" disabled={past.length === 0} onClick={undo} title="Undo (Cmd+Z)" type="button">
              <Undo2 size={15} />
            </button>
            <button
              className="play-chip"
              disabled={future.length === 0}
              onClick={redo}
              title="Redo (Shift+Cmd+Z)"
              type="button"
            >
              <Redo2 size={15} />
            </button>
            <button className="play-chip" onClick={() => setDrawerOpen((open) => !open)} type="button">
              <FolderOpen size={15} />
              Builds
            </button>
            <button className="play-chip play-chip-strong" onClick={saveDraft} type="button">
              <Save size={15} />
              Save
            </button>
          </div>
        </header>

        {/* ---- physics dock ---- */}
        <aside className="play-physics-dock">
          <span className="play-dock-label">Physics</span>
          <button
            className="play-dock-button"
            disabled={isSimulating || draft.tiles.length === 0}
            onClick={() => {
              setSimulationMode("stability");
              setSimulationNonce((nonce) => nonce + 1);
              setSandboxStatus(null);
            }}
            type="button"
          >
            <Play size={15} />
            Shake test
          </button>
          <button
            className="play-dock-button"
            disabled={!isRamp || !rollPlan || isSimulating}
            onClick={() => {
              setSimulationMode("roll");
              setSimulationNonce((nonce) => nonce + 1);
              setSandboxStatus(null);
            }}
            type="button"
          >
            <Circle size={15} />
            Roll a ball
          </button>
          <button className="play-dock-button" disabled={!isSimulating} onClick={resetSimulation} type="button">
            <RotateCcw size={15} />
            Rebuild
          </button>
          {sandboxStatus ? (
            <div className="play-dock-readout">
              <span>drift {sandboxStatus.maxDisplacement.toFixed(2)}</span>
              <span>speed {sandboxStatus.maxSpeed.toFixed(2)}</span>
              {sandboxStatus.poppedJoints.length > 0 ? (
                <span className="bad">{sandboxStatus.poppedJoints.length} joints popped</span>
              ) : null}
              {sandboxStatus.roll ? (
                <span className={sandboxStatus.roll === "fell-off" ? "bad" : sandboxStatus.roll === "reached-bottom" ? "good" : ""}>
                  {sandboxStatus.roll === "reached-bottom"
                    ? "ball made it!"
                    : sandboxStatus.roll === "fell-off"
                      ? "ball fell off"
                      : "rolling…"}
                </span>
              ) : null}
            </div>
          ) : null}
        </aside>

        {/* ---- selected tile chip ---- */}
        {selectedTile && !isSimulating ? (
          <div className="play-selected-chip">
            <span className="play-selected-swatch" style={{ background: selectedTile.color }} />
            <span className="play-selected-name">
              {TILE_SPECS[selectedTile.shape].label}
              {selectedSubtree.length > 1 ? <small> +{selectedSubtree.length - 1} built on it</small> : null}
            </span>
            <button className="play-selected-delete" onClick={deleteSelected} type="button">
              <Trash2 size={14} />
              {selectedSubtree.length > 1 ? `Remove ${selectedSubtree.length}` : "Remove"}
            </button>
            <button aria-label="Clear selection" className="play-selected-clear" onClick={() => setSelectedTileId(null)} type="button">
              <X size={13} />
            </button>
          </div>
        ) : null}

        {/* ---- toast ---- */}
        {toast ? <div className={`play-toast ${toast.kind}`}>{toast.text}</div> : null}

        {/* ---- empty state hint ---- */}
        {draft.tiles.length === 0 && !isSimulating ? (
          <div className="play-empty-hint">Click the ground to lay your first tile</div>
        ) : null}
        {isSimulating ? (
          <div className="play-sim-banner">
            Physics running — press <strong>Rebuild</strong> to keep building
          </div>
        ) : null}

        {/* ---- hotbar ---- */}
        <footer className="play-hotbar-wrap">
          <div className="play-fold-row">
            <span className="play-key-hint">
              <kbd>Q</kbd>
            </span>
            <div className="play-fold-ticks" title="Fold angle (Q/E or scroll on a magnet)">
              {FOLD_CHOICES.map((choice, index) => (
                <button
                  className={`play-fold-tick ${index === settings.foldIndex ? "active" : ""}`}
                  key={choice.label}
                  onClick={() => setSettings((current) => ({ ...current, foldIndex: index }))}
                  type="button"
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <span className="play-key-hint">
              <kbd>E</kbd>
            </span>
            <button
              className={`play-modifier ${settings.reverse ? "active" : ""}`}
              onClick={() => setSettings((current) => ({ ...current, reverse: !current.reverse }))}
              title="Flip edge direction (R)"
              type="button"
            >
              <kbd>R</kbd> flip
            </button>
            <button
              className="play-modifier"
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  childEdge: cycleChildEdge(current.shape, current.childEdge, 1)
                }))
              }
              title="Cycle which edge of the new tile attaches (T)"
              type="button"
            >
              <kbd>T</kbd> edge {settings.childEdge + 1}/{TILE_SPECS[settings.shape].maxEdges}
            </button>
          </div>
          <div className="play-hotbar">
            {SHAPE_ORDER.map((shape, index) => {
              const used = usedByShape.get(shape) ?? 0;
              return (
                <button
                  className={`play-slot ${settings.shape === shape ? "active" : ""}`}
                  key={shape}
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      shape,
                      childEdge: clampChildEdge(shape, current.childEdge)
                    }))
                  }
                  title={TILE_SPECS[shape].label}
                  type="button"
                >
                  <span className="play-slot-key">{index + 1}</span>
                  <ShapeGlyph color={settings.shape === shape ? settings.color : "#a8b8c2"} shape={shape} />
                  {used > 0 ? <span className="play-slot-count">{used}</span> : null}
                </button>
              );
            })}
            <div className="play-swatches">
              {CLASSIC_TILE_COLORS.map((swatch) => (
                <button
                  aria-label={`Tile color ${swatch}`}
                  className={`play-swatch ${settings.color === swatch ? "active" : ""}`}
                  key={swatch}
                  onClick={() => setSettings((current) => ({ ...current, color: swatch }))}
                  style={{ background: swatch }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </footer>

        {/* ---- builds drawer ---- */}
        {drawerOpen ? (
          <div className="play-drawer">
            <div className="play-drawer-head">
              <strong>Builds</strong>
              <button aria-label="Close" className="play-selected-clear" onClick={() => setDrawerOpen(false)} type="button">
                <X size={14} />
              </button>
            </div>
            <button className="play-drawer-item play-drawer-new" disabled={loading} onClick={startEmptyBuild} type="button">
              + New empty build
            </button>
            <span className="play-drawer-label">Library starting points</span>
            <div className="play-drawer-list">
              {BUILD_LIBRARY.map((item) => (
                <button
                  className="play-drawer-item"
                  disabled={loading}
                  key={item.id}
                  onClick={() => void loadLibraryDraft(item.prompt, item.id)}
                  type="button"
                >
                  {item.title}
                </button>
              ))}
            </div>
            {savedDrafts.length > 0 ? (
              <>
                <span className="play-drawer-label">Your saved builds</span>
                <div className="play-drawer-list">
                  {savedDrafts.map((item) => (
                    <button
                      className="play-drawer-item"
                      disabled={loading}
                      key={item.id}
                      onClick={() => void loadSavedDraft(item.id)}
                      type="button"
                    >
                      {item.title}
                      <small>
                        {item.tileCount} tiles · {item.status}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/* ================================================================== */
/* Canvas                                                              */
/* ================================================================== */

function BuilderCanvas({
  build,
  bursts,
  draft,
  flash,
  frameNonce,
  ghost,
  hover,
  isSimulating,
  onGroundClick,
  onGroundLeave,
  onGroundMove,
  onHoverMagnet,
  onPlace,
  onSelectTile,
  onSimulationStatus,
  rootGhost,
  selectedTileId,
  simulationMode,
  simulationNonce
}: {
  build: ReturnType<typeof draftToBuildGraph>;
  bursts: SnapBurstInstance[];
  draft: AuthoredBuildDraft;
  flash: { tileId: string; at: number } | null;
  frameNonce: number;
  ghost: ReturnType<typeof deriveGhostPreview>;
  hover: MagnetHover | null;
  isSimulating: boolean;
  onGroundClick: (point: { x: number; z: number }) => void;
  onGroundLeave: () => void;
  onGroundMove: (point: { x: number; z: number }) => void;
  onHoverMagnet: (hover: MagnetHover | null) => void;
  onPlace: (hover: MagnetHover) => void;
  onSelectTile: (tileId: string) => void;
  onSimulationStatus: (status: SandboxStatus) => void;
  rootGhost: BuilderTile | null;
  selectedTileId: string | null;
  simulationMode: SimulationMode;
  simulationNonce: number;
}) {
  const [initialCameraPosition] = useState<[number, number, number]>(() => {
    const cameraDistance = Math.max(16, build.bounds.width, build.bounds.height, build.bounds.depth) * 1.8;
    return [cameraDistance * 0.62, cameraDistance * 0.52, cameraDistance * 0.82];
  });
  // drop:true matches the engine gate's own stand test (lib/engine/simulate.ts): the
  // build is dropped a calibrated height and must settle. Same sandbox as v1.
  const physicsModel = useMemo(() => createMagneticPhysicsModel(build, { drop: true }), [build]);
  const rollPlan = useMemo(() => createRollTestPlan(build), [build]);
  const physicsKey = `${simulationMode}-${simulationNonce}-${build.id}-${draft.updatedAt}`;

  return (
    <Canvas camera={{ position: initialCameraPosition, fov: 42 }} shadows>
      <ambientLight intensity={0.85} />
      <hemisphereLight args={["#cfeefc", "#f6e3bd", 0.5]} />
      <directionalLight
        castShadow
        intensity={1.7}
        position={[10, 18, 9]}
        shadow-camera-bottom={-30}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <fog args={["#dff1f7", 70, 160]} attach="fog" />

      <WarmGround
        interactive={!isSimulating}
        onGroundClick={onGroundClick}
        onGroundLeave={onGroundLeave}
        onGroundMove={onGroundMove}
      />

      {isSimulating ? (
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
              flashAt={flash?.tileId === tile.id ? flash.at : undefined}
              hover={hover}
              isSelected={tile.id === selectedTileId}
              key={tile.id}
              onHoverMagnet={onHoverMagnet}
              onPlace={onPlace}
              onSelectTile={onSelectTile}
              tile={tile}
            />
          ))}
          {ghost ? <GhostTileMesh invalid={!ghost.valid} tile={ghost.tile} /> : null}
          {rootGhost ? <GhostTileMesh tile={rootGhost} /> : null}
          {bursts.map((burst) => (
            <SnapBurst key={burst.id} position={burst.position} />
          ))}
        </>
      )}
      <OrbitControls
        enableDamping
        enableZoom={!hover}
        makeDefault
        maxDistance={90}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={6}
        target={[0, 1.5, 0]}
      />
      <CameraRig bounds={build.bounds} nonce={frameNonce} />
    </Canvas>
  );
}

/**
 * Reframes the camera when a different build is adopted (load/new), without
 * remounting the canvas — remounting kills the live Rapier physics provider.
 */
function CameraRig({ bounds, nonce }: { bounds: { width: number; height: number; depth: number }; nonce: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  const framedNonceRef = useRef(0);

  useEffect(() => {
    if (nonce === framedNonceRef.current) return;
    framedNonceRef.current = nonce;
    const cameraDistance = Math.max(16, bounds.width, bounds.height, bounds.depth) * 1.8;
    camera.position.set(cameraDistance * 0.62, cameraDistance * 0.52, cameraDistance * 0.82);
    const target = new THREE.Vector3(0, Math.max(1.5, bounds.height * 0.22), 0);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else {
      camera.lookAt(target);
    }
  }, [bounds, camera, controls, nonce]);

  return null;
}

function WarmGround({
  interactive,
  onGroundClick,
  onGroundLeave,
  onGroundMove
}: {
  interactive: boolean;
  onGroundClick: (point: { x: number; z: number }) => void;
  onGroundLeave: () => void;
  onGroundMove: (point: { x: number; z: number }) => void;
}) {
  return (
    <group>
      <mesh
        onPointerUp={
          interactive
            ? (event) => {
                if (event.delta > 5) return;
                event.stopPropagation();
                onGroundClick({ x: event.point.x, z: event.point.z });
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (event) => onGroundMove({ x: event.point.x, z: event.point.z })
            : undefined
        }
        onPointerOut={interactive ? () => onGroundLeave() : undefined}
        position={[0, -0.01, 0]}
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[110, 64]} />
        <meshStandardMaterial color="#f3e3bf" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[26, 64]} />
        <meshStandardMaterial color="#f7ecd2" roughness={0.9} />
      </mesh>
      <gridHelper args={[52, 17, "#e3cfa2", "#ecdcb6"]} position={[0, 0.02, 0]} />
    </group>
  );
}

/* ================================================================== */
/* Tiles                                                               */
/* ================================================================== */

function BuilderTileMesh({
  flashAt,
  hover,
  isSelected,
  onHoverMagnet,
  onPlace,
  onSelectTile,
  tile
}: {
  flashAt?: number;
  hover: MagnetHover | null;
  isSelected: boolean;
  onHoverMagnet: (hover: MagnetHover | null) => void;
  onPlace: (hover: MagnetHover) => void;
  onSelectTile: (tileId: string) => void;
  tile: BuilderTile;
}) {
  const geometry = useMemo(() => createTileGeometry(tile), [tile]);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;
    if (flashAt === undefined) {
      if (material.emissiveIntensity !== 0) material.emissiveIntensity = 0;
      return;
    }
    const elapsed = performance.now() - flashAt;
    material.emissiveIntensity = Math.max(0, 0.85 * (1 - elapsed / 420));
  });

  const meshProps = useTileTransformProps(tile);
  const magnetPoints = useMemo(() => builderTileWorldMagnetPoints(tile), [tile]);
  const edgeMidpoints = useMemo(() => builderTileEdgeBars(tile), [tile]);

  return (
    <group>
      <mesh
        castShadow
        geometry={geometry}
        onPointerUp={(event) => {
          if (event.delta > 5) return;
          event.stopPropagation();
          onSelectTile(tile.id);
        }}
        receiveShadow
        {...meshProps}
      >
        <meshPhysicalMaterial
          clearcoat={0.6}
          clearcoatRoughness={0.35}
          color={tile.color}
          emissive={tile.color}
          emissiveIntensity={0}
          metalness={0.02}
          opacity={0.85}
          ref={materialRef}
          roughness={0.22}
          side={THREE.DoubleSide}
          transparent
        />
        <Edges color={isSelected ? "#f7b733" : "#27343c"} lineWidth={isSelected ? 2.6 : 1.15} threshold={15} />
      </mesh>
      {magnetPoints.map((magnet) => (
        <MagnetDot
          hovered={
            hover?.tileId === tile.id &&
            hover.edge === magnet.edgeIndex &&
            hover.magnetIndex === magnet.magnetIndex
          }
          key={`${tile.id}-e${magnet.edgeIndex}-m${magnet.magnetIndex}`}
          onClick={() =>
            onPlace({ tileId: tile.id, edge: magnet.edgeIndex, magnetIndex: magnet.magnetIndex, t: magnet.t })
          }
          onEnter={() =>
            onHoverMagnet({ tileId: tile.id, edge: magnet.edgeIndex, magnetIndex: magnet.magnetIndex, t: magnet.t })
          }
          onLeave={() => onHoverMagnet(null)}
          position={magnet.position}
        />
      ))}
      {edgeMidpoints.map((bar) => (
        <EdgeBar
          bar={bar}
          hovered={hover?.tileId === tile.id && hover.edge === bar.edgeIndex && hover.magnetIndex === undefined}
          key={`${tile.id}-bar-${bar.edgeIndex}`}
          onClick={() => onPlace({ tileId: tile.id, edge: bar.edgeIndex, t: 0.5 })}
          onEnter={() => onHoverMagnet({ tileId: tile.id, edge: bar.edgeIndex, t: 0.5 })}
          onLeave={() => onHoverMagnet(null)}
        />
      ))}
    </group>
  );
}

function MagnetDot({
  hovered,
  onClick,
  onEnter,
  onLeave,
  position
}: {
  hovered: boolean;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
  position: Vec3;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const target = hovered ? 1.85 + Math.sin(clock.elapsedTime * 7) * 0.12 : 1;
    const current = ref.current.scale.x;
    const next = current + (target - current) * 0.25;
    ref.current.scale.setScalar(next);
  });

  return (
    <mesh
      onPointerUp={(event) => {
        if (event.delta > 5) return;
        event.stopPropagation();
        onClick();
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
        onLeave();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        onEnter();
      }}
      position={[position.x, position.y, position.z]}
      ref={ref}
    >
      <sphereGeometry args={[0.14, 16, 16]} />
      <meshStandardMaterial
        color={hovered ? "#f7b733" : "#5b6b75"}
        emissive={hovered ? "#f7b733" : "#000000"}
        emissiveIntensity={hovered ? 0.7 : 0}
        metalness={0.45}
        roughness={0.3}
      />
    </mesh>
  );
}

type EdgeBarInfo = {
  edgeIndex: number;
  center: Vec3;
  quaternion: THREE.Quaternion;
  length: number;
};

function EdgeBar({
  bar,
  hovered,
  onClick,
  onEnter,
  onLeave
}: {
  bar: EdgeBarInfo;
  hovered: boolean;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <mesh
      onPointerUp={(event) => {
        if (event.delta > 5) return;
        event.stopPropagation();
        onClick();
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "auto";
        onLeave();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        onEnter();
      }}
      position={[bar.center.x, bar.center.y, bar.center.z]}
      quaternion={bar.quaternion}
    >
      <cylinderGeometry args={[hovered ? 0.085 : 0.05, hovered ? 0.085 : 0.05, bar.length, 8]} />
      <meshStandardMaterial
        color={hovered ? "#f7b733" : "#8da0ab"}
        emissive={hovered ? "#f7b733" : "#000000"}
        emissiveIntensity={hovered ? 0.55 : 0}
        opacity={hovered ? 0.95 : 0.0}
        transparent
      />
    </mesh>
  );
}

function GhostTileMesh({ invalid = false, tile }: { invalid?: boolean; tile: BuilderTile }) {
  const geometry = useMemo(() => createTileGeometry(tile), [tile]);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.opacity = 0.36 + Math.sin(clock.elapsedTime * 5) * 0.08;
  });
  const meshProps = useTileTransformProps(tile);

  return (
    <mesh geometry={geometry} raycast={() => null} {...meshProps}>
      <meshPhysicalMaterial
        color={invalid ? "#e84855" : tile.color}
        depthWrite={false}
        emissive={invalid ? "#e84855" : tile.color}
        emissiveIntensity={0.25}
        metalness={0}
        opacity={0.42}
        ref={materialRef}
        roughness={0.3}
        side={THREE.DoubleSide}
        transparent
      />
      <Edges color={invalid ? "#e84855" : "#ffffff"} lineWidth={1.6} threshold={15} />
    </mesh>
  );
}

function SnapBurst({ position }: { position: Vec3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const startRef = useRef<number | null>(null);

  useFrame(({ camera }) => {
    if (!ref.current || !materialRef.current) return;
    if (startRef.current === null) startRef.current = performance.now();
    const t = Math.min(1, (performance.now() - startRef.current) / 460);
    const eased = 1 - (1 - t) ** 3;
    ref.current.scale.setScalar(0.3 + eased * 1.5);
    ref.current.quaternion.copy(camera.quaternion);
    materialRef.current.opacity = 0.85 * (1 - eased);
  });

  return (
    <mesh position={[position.x, position.y, position.z]} raycast={() => null} ref={ref}>
      <ringGeometry args={[0.42, 0.55, 32]} />
      <meshBasicMaterial color="#f7b733" ref={materialRef} transparent />
    </mesh>
  );
}

function useTileTransformProps(tile: BuilderTile) {
  return useMemo(() => {
    if (tile.basis) {
      const matrix = new THREE.Matrix4();
      matrix.makeBasis(
        new THREE.Vector3(tile.basis.xAxis.x, tile.basis.xAxis.y, tile.basis.xAxis.z),
        new THREE.Vector3(tile.basis.yAxis.x, tile.basis.yAxis.y, tile.basis.yAxis.z),
        new THREE.Vector3(tile.basis.zAxis.x, tile.basis.zAxis.y, tile.basis.zAxis.z)
      );
      matrix.setPosition(tile.position.x, tile.position.y, tile.position.z);
      return { matrix, matrixAutoUpdate: false as const };
    }
    return {
      position: [tile.position.x, tile.position.y, tile.position.z] as [number, number, number],
      rotation: [tile.rotation.x, tile.rotation.y, tile.rotation.z] as [number, number, number]
    };
  }, [tile.basis, tile.position.x, tile.position.y, tile.position.z, tile.rotation.x, tile.rotation.y, tile.rotation.z]);
}

/* ================================================================== */
/* Hotbar glyphs                                                       */
/* ================================================================== */

function ShapeGlyph({ color, shape }: { color: string; shape: TileShape }) {
  const points: Record<TileShape, string> = {
    "small-square": "8,8 24,8 24,24 8,24",
    "large-square": "4,4 28,4 28,28 4,28",
    "xl-square": "2,2 30,2 30,30 2,30",
    "equilateral-triangle": "16,5 28,26 4,26",
    "right-triangle": "6,5 6,27 28,27",
    "isosceles-triangle": "16,3 24,28 8,28"
  };
  return (
    <svg aria-hidden className="play-slot-glyph" viewBox="0 0 32 32">
      <polygon
        fill={color}
        fillOpacity={0.82}
        points={points[shape]}
        stroke="#27343c"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

/* ================================================================== */
/* Physics sandbox (stability + roll), unchanged behavior              */
/* ================================================================== */

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
        opacity: 0.82,
        roughness: 0.3,
        metalness: 0.02,
        clearcoat: 0.5,
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
        contactSkin={0.006}
        friction={TILE_FRICTION}
        mass={body.mass}
        restitution={0.02}
      />
      <mesh castShadow geometry={geometry} material={material} receiveShadow>
        <Edges color="#27343c" lineWidth={1.1} threshold={15} />
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
    impulseJoint.current?.setContactsEnabled(false);
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

/* ================================================================== */
/* Geometry helpers                                                    */
/* ================================================================== */

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

function builderTileEdgeBars(tile: BuilderTile): EdgeBarInfo[] {
  const vertices = tile.sizeOverride
    ? builderLocalVertices(tile).map((point) => transformBuilderPoint(point, tile))
    : tileWorldVertices(tile);
  return vertices.map((start, edgeIndex) => {
    const end = vertices[(edgeIndex + 1) % vertices.length];
    const center = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      z: (start.z + end.z) / 2
    };
    const direction = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
    const length = Math.max(0.2, direction.length() - 1.7);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );
    return { edgeIndex, center, quaternion, length };
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
