"use client";

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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLASSIC_TILE_COLORS,
  createDraftFromGenerated,
  createEmptyDraft,
  deleteBuilderTiles,
  draftToBuildGraph
} from "@/lib/builder/operations";
import {
  FOLD_CHOICES,
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
  type PlacementSettings
} from "@/lib/builder/placement";
import type { AuthoredBuildDraft, BuildDraftSummary } from "@/lib/builder/types";
import { createRollTestPlan, isFunctionalRamp } from "@/lib/engine/physics-model";
import type { GateBuildResult } from "@/lib/engine";
import { SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";
import type { GeneratedBuildResponse, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import {
  BuildScene,
  type SandboxStatus,
  type SimulationMode,
  type SnapBurstInstance
} from "../components/BuildScene";

type GateState =
  | { status: "checking"; gate?: GateBuildResult; detail?: string }
  | { status: "ready"; gate: GateBuildResult; detail?: string }
  | { status: "error"; gate?: GateBuildResult; detail: string };

const HISTORY_CAP = 60;
const WHEEL_STEP_THRESHOLD = 28;

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
        <BuildScene
          mode="play"
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
