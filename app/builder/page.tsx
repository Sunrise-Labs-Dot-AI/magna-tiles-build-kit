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
  ROOT_SNAP_GRID,
  builderTileLocalVertices,
  builderTileMagnetWorldPoints,
  builderTileWorldVertices,
  collectSnapPoints,
  collectTileSubtree,
  confirmGhostPlacement,
  clampChildEdge,
  cycleChildEdge,
  cycleFoldIndex,
  defaultPlacementSettings,
  deriveGhostPreview,
  deriveHandTile,
  hoverKey,
  placeRootOnGround,
  resolveSnapHover,
  type MagnetHover,
  type PlacementSettings,
  type SnapPoint
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

/* ------------------------------------------------------------------ */
/* Dev instrumentation: ghost mount/unmount stats + scene probe.       */
/* The flicker bug was a ghost mount/unmount oscillation; these stats  */
/* make "the ghost mounted exactly once during a steady hover" a       */
/* machine-checkable invariant (see scripts/verify-feel.ts).           */
/* ------------------------------------------------------------------ */

type GhostStats = {
  snapMounts: number;
  snapUnmounts: number;
  handMounts: number;
  handUnmounts: number;
};

declare global {
  interface Window {
    __ghostStats?: GhostStats;
    __builderProbe?: {
      tiles: () => Array<{
        id: string;
        shape: TileShape;
        position: Vec3;
        basis: NonNullable<BuilderTile["basis"]> | null;
      }>;
      snapScreenPoints: () => Array<{
        tileId: string;
        edge: number;
        magnetIndex: number | null;
        x: number;
        y: number;
      }>;
    };
  }
}

function bumpGhostStat(key: keyof GhostStats): void {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  const stats = (window.__ghostStats ??= {
    snapMounts: 0,
    snapUnmounts: 0,
    handMounts: 0,
    handUnmounts: 0
  });
  stats[key] += 1;
}

export default function BuilderPage() {
  const [draft, setDraft] = useState<AuthoredBuildDraft>(() => createEmptyDraft("My Build"));
  const [past, setPast] = useState<AuthoredBuildDraft[]>([]);
  const [future, setFuture] = useState<AuthoredBuildDraft[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<BuildDraftSummary[]>([]);
  const [settings, setSettings] = useState<PlacementSettings>(() => defaultPlacementSettings());
  const [hover, setHover] = useState<MagnetHover | null>(null);
  const [handActive, setHandActive] = useState(true);
  const [cursorActive, setCursorActive] = useState(false);
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
  const handActiveRef = useRef(handActive);
  handActiveRef.current = handActive;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const wheelAccumRef = useRef(0);
  /** Latest cursor world point on ground/tile geometry, updated outside React. */
  const cursorRef = useRef<Vec3 | null>(null);

  const build = useMemo(() => draftToBuildGraph(draft), [draft]);
  const rollPlan = useMemo(() => createRollTestPlan(build), [build]);
  const isRamp = useMemo(() => isFunctionalRamp(build), [build]);
  const ghost = useMemo(
    () => (handActive ? deriveGhostPreview(draft, hover, settings) : null),
    [draft, handActive, hover, settings]
  );
  const handTile = useMemo(() => deriveHandTile(settings), [settings]);
  const snapPoints = useMemo(() => collectSnapPoints(draft), [draft]);
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
      // Keep the hand live: re-derive the snap against the new draft from the cursor's
      // current position, so the next ghost appears without wiggling the mouse.
      setHover(resolveSnapHover(collectSnapPoints(result.draft), cursorRef.current, null));
      setFlash({ tileId: result.placedTileId, at: performance.now() });
      if (placed) spawnBurst(placed.position);
    },
    [commitDraft, draft, settings, showToast, spawnBurst]
  );

  const placeRoot = useCallback(
    (point: { x: number; z: number }) => {
      if (draft.tiles.length > 0) return;
      const result = placeRootOnGround(draft, {
        shape: settings.shape,
        color: settings.color,
        point,
        foldIndex: settings.foldIndex,
        reverse: settings.reverse
      });
      if (!result.placedTileId) return;
      const placed = result.draft.tiles.find((tile) => tile.id === result.placedTileId);
      commitDraft(result.draft);
      setSelectedTileId(result.placedTileId);
      setFlash({ tileId: result.placedTileId, at: performance.now() });
      if (placed) spawnBurst(placed.position);
      const foldLabel = FOLD_CHOICES[settings.foldIndex]?.label ?? "Flat";
      showToast(
        foldLabel === "Flat"
          ? "First tile down. Bring the next one close to a magnet to snap it."
          : `First tile ${Math.abs(FOLD_CHOICES[settings.foldIndex].radians) === Math.PI / 2 ? "standing on its edge" : "leaning"} — the gate pill says if it stands for real.`
      );
    },
    [commitDraft, draft, settings.color, settings.foldIndex, settings.reverse, settings.shape, showToast, spawnBurst]
  );

  /** Cursor moved over scene geometry (ground or a tile): track + derive snap hover. */
  const handleCursorMove = useCallback(
    (point: Vec3) => {
      cursorRef.current = point;
      setCursorActive(true);
      if (!handActiveRef.current) {
        if (hoverRef.current) setHover(null);
        return;
      }
      const next = resolveSnapHover(snapPoints, point, hoverRef.current);
      if (hoverKey(next) !== hoverKey(hoverRef.current)) setHover(next);
    },
    [snapPoints]
  );

  /**
   * Clear the cursor ONLY when the pointer leaves the whole stage. Scene meshes never
   * clear it: R3F fires a mesh pointerout mid-crossing (ground→tile and back), and any
   * transient clear there is exactly the ghost unmount/remount flicker this rework
   * removes. Moving away from snap points is handled by resolveSnapHover's hysteresis.
   */
  const handleStageLeave = useCallback(() => {
    cursorRef.current = null;
    setCursorActive(false);
    if (hoverRef.current) setHover(null);
  }, []);

  /** One click handler for the whole scene: snap-place > root-place > select > clear. */
  const handleSceneClick = useCallback(
    (point: Vec3, source: "ground" | string) => {
      if (handActiveRef.current && hoverRef.current) {
        placeAtHover(hoverRef.current);
        return;
      }
      if (handActiveRef.current && draft.tiles.length === 0 && source === "ground") {
        placeRoot({ x: point.x, z: point.z });
        return;
      }
      if (source !== "ground") {
        setSelectedTileId(source);
        return;
      }
      setSelectedTileId(null);
    },
    [draft.tiles.length, placeAtHover, placeRoot]
  );

  const emptyHand = useCallback(() => {
    setHandActive(false);
    setHover(null);
  }, []);

  const pickUpTile = useCallback((shape: TileShape) => {
    setHandActive(true);
    setSettings((current) => ({
      ...current,
      shape,
      childEdge: clampChildEdge(shape, current.childEdge)
    }));
  }, []);

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
        if (shape) pickUpTile(shape);
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
          emptyHand();
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
  }, [deleteSelected, emptyHand, pickUpTile, placeAtHover, redo, undo]);

  // The snap hover is a pointer affordance: show the pointer cursor while snapped.
  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "auto";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [hover]);

  // The stage owns "the pointer is gone": leaving the canvas empties the cursor.
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    node.addEventListener("pointerleave", handleStageLeave);
    return () => node.removeEventListener("pointerleave", handleStageLeave);
  }, [handleStageLeave]);

  // Scroll wheel cycles the fold while a ghost is live (non-passive so we can stop zoom):
  // either snapped to a magnet, or aiming the first tile at open ground.
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    function handleWheel(event: WheelEvent) {
      const aimingRoot =
        handActiveRef.current && draftRef.current.tiles.length === 0 && cursorRef.current !== null;
      if (!hoverRef.current && !aimingRoot) return;
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
          aimingRoot={handActive && cursorActive && draft.tiles.length === 0}
          bursts={bursts}
          cursorRef={cursorRef}
          draft={draft}
          flash={flash}
          ghost={ghost}
          handActive={handActive}
          handTile={handTile}
          hover={hover}
          isSimulating={isSimulating}
          onCursorMove={handleCursorMove}
          onSceneClick={handleSceneClick}
          onSimulationStatus={setSandboxStatus}
          selectedTileId={selectedTileId}
          simulationMode={simulationMode}
          simulationNonce={simulationNonce}
          snapPoints={snapPoints}
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
        {draft.tiles.length === 0 && !isSimulating && handActive ? (
          <div className="play-empty-hint">
            Your tile is in hand — <kbd>Q</kbd>/<kbd>E</kbd> tilts it, <kbd>R</kbd> flips, click the ground to place
          </div>
        ) : null}
        {!handActive && !isSimulating ? (
          <div className="play-empty-hint">
            Hand empty — press <kbd>1</kbd>–<kbd>6</kbd> or click a shape below to pick up a tile
          </div>
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
                  className={`play-slot ${handActive && settings.shape === shape ? "active" : ""}`}
                  key={shape}
                  onClick={() => pickUpTile(shape)}
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
  aimingRoot,
  build,
  bursts,
  cursorRef,
  draft,
  flash,
  frameNonce,
  ghost,
  handActive,
  handTile,
  hover,
  isSimulating,
  onCursorMove,
  onSceneClick,
  onSimulationStatus,
  selectedTileId,
  simulationMode,
  simulationNonce,
  snapPoints
}: {
  aimingRoot: boolean;
  build: ReturnType<typeof draftToBuildGraph>;
  bursts: SnapBurstInstance[];
  cursorRef: RefObject<Vec3 | null>;
  draft: AuthoredBuildDraft;
  flash: { tileId: string; at: number } | null;
  frameNonce: number;
  ghost: ReturnType<typeof deriveGhostPreview>;
  handActive: boolean;
  handTile: BuilderTile;
  hover: MagnetHover | null;
  isSimulating: boolean;
  onCursorMove: (point: Vec3) => void;
  onSceneClick: (point: Vec3, source: "ground" | string) => void;
  onSimulationStatus: (status: SandboxStatus) => void;
  selectedTileId: string | null;
  simulationMode: SimulationMode;
  simulationNonce: number;
  snapPoints: SnapPoint[];
}) {
  const [initialCameraPosition] = useState<[number, number, number]>(() => {
    const cameraDistance = Math.max(16, build.bounds.width, build.bounds.height, build.bounds.depth) * 1.8;
    return [cameraDistance * 0.62, cameraDistance * 0.52, cameraDistance * 0.82];
  });
  // drop:false — the sandbox settles the build IN PLACE so what you see simulated is
  // exactly what you built, where you built it. The engine gate (lib/engine/simulate.ts)
  // still runs its own calibrated drop test; the gate is law, this is presentation.
  const physicsModel = useMemo(() => createMagneticPhysicsModel(build, { drop: false }), [build]);
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

      <WarmGround interactive={!isSimulating} onCursorMove={onCursorMove} onSceneClick={onSceneClick} />

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
              handActive={handActive}
              hover={hover}
              isSelected={tile.id === selectedTileId}
              key={tile.id}
              onCursorMove={onCursorMove}
              onSceneClick={onSceneClick}
              tile={tile}
            />
          ))}
          {handActive && ghost ? (
            <GhostTileMesh invalid={!ghost.valid} snapped statKind="snap" tile={ghost.tile} />
          ) : null}
          {handActive && !ghost ? (
            <HandGhost cursorRef={cursorRef} gridSnap={draft.tiles.length === 0} tile={handTile} />
          ) : null}
          {bursts.map((burst) => (
            <SnapBurst key={burst.id} position={burst.position} />
          ))}
        </>
      )}
      <OrbitControls
        enableDamping
        enableZoom={!hover && !aimingRoot}
        makeDefault
        maxDistance={90}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={6}
        target={[0, 1.5, 0]}
      />
      <CameraRig bounds={build.bounds} nonce={frameNonce} />
      {process.env.NODE_ENV !== "production" ? <DevProbe draft={draft} snapPoints={snapPoints} /> : null}
    </Canvas>
  );
}

/**
 * The held tile: follows the cursor every frame (outside React state, so following is
 * free of re-renders and cannot thrash the ghost lifecycle). On an empty draft it
 * grid-snaps and previews the exact root placement a click would commit.
 */
function HandGhost({
  cursorRef,
  gridSnap,
  tile
}: {
  cursorRef: RefObject<Vec3 | null>;
  gridSnap: boolean;
  tile: BuilderTile;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    bumpGhostStat("handMounts");
    return () => bumpGhostStat("handUnmounts");
  }, []);

  useFrame(() => {
    const node = groupRef.current;
    if (!node) return;
    const cursor = cursorRef.current;
    if (!cursor) {
      node.visible = false;
      return;
    }
    node.visible = true;
    const targetX = gridSnap ? Math.round(cursor.x / ROOT_SNAP_GRID) * ROOT_SNAP_GRID : cursor.x;
    const targetZ = gridSnap ? Math.round(cursor.z / ROOT_SNAP_GRID) * ROOT_SNAP_GRID : cursor.z;
    if (gridSnap) {
      node.position.set(targetX, 0, targetZ);
    } else {
      // Light smoothing makes the held tile feel carried rather than glued to the ray.
      node.position.x += (targetX - node.position.x) * 0.45;
      node.position.z += (targetZ - node.position.z) * 0.45;
      node.position.y = 0;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <GhostTileMesh statKind="hand" tile={tile} />
    </group>
  );
}

/**
 * Dev-only scene probe for scripted verification (scripts/verify-feel.ts): exposes
 * tile transforms and the screen-space coordinates of every snap point.
 */
function DevProbe({ draft, snapPoints }: { draft: AuthoredBuildDraft; snapPoints: SnapPoint[] }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    window.__builderProbe = {
      tiles: () =>
        draft.tiles.map((tile) => ({
          id: tile.id,
          shape: tile.shape,
          position: tile.position,
          basis: tile.basis ?? null
        })),
      snapScreenPoints: () => {
        const rect = gl.domElement.getBoundingClientRect();
        return snapPoints.map((point) => {
          const projected = new THREE.Vector3(point.position.x, point.position.y, point.position.z).project(camera);
          return {
            tileId: point.hover.tileId,
            edge: point.hover.edge,
            magnetIndex: point.hover.magnetIndex ?? null,
            x: rect.left + ((projected.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - projected.y) / 2) * rect.height
          };
        });
      }
    };
  }, [camera, draft, gl, snapPoints]);

  return null;
}

/**
 * Reframes the camera when a different build is adopted (load/new), without
 * remounting the canvas — remounting kills the live Rapier physics provider.
 */
function CameraRig({ bounds, nonce }: { bounds: { width: number; height: number; depth: number }; nonce: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  const framedNonceRef = useRef(0);
  const framedWithControlsRef = useRef(false);

  useEffect(() => {
    // A frame applied before OrbitControls registered is incomplete (the
    // controls never synced to the new target), so redo it once they exist —
    // otherwise a build adopted during canvas mount (?draft= handoff) leaves
    // the camera unframed and the scene reads as blank sky.
    if (nonce === framedNonceRef.current && (framedWithControlsRef.current || !controls)) return;
    framedNonceRef.current = nonce;
    framedWithControlsRef.current = Boolean(controls);
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
  onCursorMove,
  onSceneClick
}: {
  interactive: boolean;
  onCursorMove: (point: Vec3) => void;
  onSceneClick: (point: Vec3, source: "ground" | string) => void;
}) {
  return (
    <group>
      <mesh
        onPointerUp={
          interactive
            ? (event) => {
                if (event.delta > 5) return;
                event.stopPropagation();
                onSceneClick({ x: event.point.x, y: event.point.y, z: event.point.z }, "ground");
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (event) => onCursorMove({ x: event.point.x, y: event.point.y, z: event.point.z })
            : undefined
        }
        position={[0, -0.01, 0]}
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[110, 64]} />
        <meshStandardMaterial color="#f3e3bf" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.005, 0]} raycast={() => null} rotation={[-Math.PI / 2, 0, 0]}>
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
  handActive,
  hover,
  isSelected,
  onCursorMove,
  onSceneClick,
  tile
}: {
  flashAt?: number;
  handActive: boolean;
  hover: MagnetHover | null;
  isSelected: boolean;
  onCursorMove: (point: Vec3) => void;
  onSceneClick: (point: Vec3, source: "ground" | string) => void;
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
  const magnetPoints = useMemo(() => builderTileMagnetWorldPoints(tile), [tile]);
  const edgeMidpoints = useMemo(() => builderTileEdgeBars(tile), [tile]);

  return (
    <group>
      <mesh
        castShadow
        geometry={geometry}
        onPointerMove={(event) => {
          event.stopPropagation();
          onCursorMove({ x: event.point.x, y: event.point.y, z: event.point.z });
        }}
        onPointerUp={(event) => {
          if (event.delta > 5) return;
          event.stopPropagation();
          onSceneClick({ x: event.point.x, y: event.point.y, z: event.point.z }, tile.id);
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
      {/* Magnet dots and edge bars are pure visuals now: raycast-transparent, never
          pointer targets. Hover is derived from cursor proximity (resolveSnapHover),
          which is what makes ghost flicker structurally impossible. */}
      {magnetPoints.map((magnet) => (
        <MagnetDot
          active={handActive}
          hovered={
            hover?.tileId === tile.id &&
            hover.edge === magnet.edgeIndex &&
            hover.magnetIndex === magnet.magnetIndex
          }
          key={`${tile.id}-e${magnet.edgeIndex}-m${magnet.magnetIndex}`}
          position={magnet.position}
        />
      ))}
      {edgeMidpoints.map((bar) => (
        <EdgeBar
          bar={bar}
          hovered={hover?.tileId === tile.id && hover.edge === bar.edgeIndex}
          key={`${tile.id}-bar-${bar.edgeIndex}`}
        />
      ))}
    </group>
  );
}

function MagnetDot({ active, hovered, position }: { active: boolean; hovered: boolean; position: Vec3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const base = active ? 1.2 : 1;
    const target = hovered ? 1.95 + Math.sin(clock.elapsedTime * 7) * 0.12 : base;
    const current = ref.current.scale.x;
    const next = current + (target - current) * 0.25;
    ref.current.scale.setScalar(next);
  });

  return (
    <mesh position={[position.x, position.y, position.z]} raycast={() => null} ref={ref}>
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

/** Edge highlight bar: pure visual (raycast-transparent), lit when its edge is snapped. */
function EdgeBar({ bar, hovered }: { bar: EdgeBarInfo; hovered: boolean }) {
  return (
    <mesh
      position={[bar.center.x, bar.center.y, bar.center.z]}
      quaternion={bar.quaternion}
      raycast={() => null}
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

function GhostTileMesh({
  invalid = false,
  snapped = false,
  statKind,
  tile
}: {
  invalid?: boolean;
  snapped?: boolean;
  statKind?: "snap" | "hand";
  tile: BuilderTile;
}) {
  const geometry = useMemo(() => createTileGeometry(tile), [tile]);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useEffect(() => {
    if (!statKind) return;
    bumpGhostStat(statKind === "snap" ? "snapMounts" : "handMounts");
    return () => bumpGhostStat(statKind === "snap" ? "snapUnmounts" : "handUnmounts");
  }, [statKind]);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    // Snapped: solidify (steady, more opaque). In hand: soft breathing pulse.
    materialRef.current.opacity = snapped
      ? 0.62
      : 0.3 + Math.sin(clock.elapsedTime * 5) * 0.07;
  });
  const meshProps = useTileTransformProps(tile);

  return (
    <mesh geometry={geometry} raycast={() => null} {...meshProps}>
      <meshPhysicalMaterial
        color={invalid ? "#e84855" : tile.color}
        depthWrite={false}
        emissive={invalid ? "#e84855" : tile.color}
        emissiveIntensity={snapped ? 0.45 : 0.25}
        metalness={0}
        opacity={0.42}
        ref={materialRef}
        roughness={0.3}
        side={THREE.DoubleSide}
        transparent
      />
      <Edges
        color={invalid ? "#e84855" : snapped ? "#f7b733" : "#ffffff"}
        lineWidth={snapped ? 2.2 : 1.6}
        threshold={15}
      />
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

function useTileTransformProps(tile: Pick<BuilderTile, "basis" | "position" | "rotation">) {
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
  // The physics model bakes each tile's orientation into the hull points
  // (tilePrismPoints = world vertices minus position) and into the joint anchors, and
  // the headless gate world (lib/engine/rapier-world.ts) therefore spawns every body
  // with IDENTITY rotation. Rotating the RigidBody here double-rotated the collider and
  // anchors — the simulated build visibly didn't match the built orientation. The body
  // stays unrotated to match the gate exactly; only the visual mesh inside is oriented.
  const orientedTile = useMemo(
    () => ({ ...body.tile, position: { x: 0, y: 0, z: 0 } }),
    [body.tile]
  );
  const meshProps = useTileTransformProps(orientedTile);

  return (
    <RigidBody
      additionalSolverIterations={8}
      angularVelocity={tuple(body.angularVelocity)}
      colliders={false}
      linearVelocity={tuple(body.linearVelocity)}
      position={tuple(body.translation)}
      ref={bodyRef}
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
      <mesh castShadow geometry={geometry} material={material} receiveShadow {...meshProps}>
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
  const vertices = builderTileLocalVertices(tile);
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

function builderTileEdgeBars(tile: BuilderTile): EdgeBarInfo[] {
  const vertices = builderTileWorldVertices(tile);
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
