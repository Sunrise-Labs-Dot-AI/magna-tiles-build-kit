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
  draftToBuildGraph,
  updateBuilderTile
} from "@/lib/builder/operations";
import {
  FOLD_CHOICES,
  canRefoldTile,
  collectSnapPoints,
  collectTileSubtree,
  confirmGhostPlacement,
  clampChildEdge,
  cycleChildEdge,
  cycleFold,
  cycleRefold,
  defaultPlacementSettings,
  deriveGhostPreview,
  deriveRootGhost,
  foldLabel,
  hoverKey,
  placeRootOnGround,
  resolveSnapHover,
  snapRootPosition,
  type FoldContext,
  type MagnetHover,
  type PlacementSettings
} from "@/lib/builder/placement";
import {
  PREFAB_ORDER,
  PREFAB_SPECS,
  placePrefabOnEdge,
  placePrefabOnGround,
  prefabGhostOnEdge,
  prefabGhostOnGround,
  type PrefabId
} from "@/lib/builder/prefabs";
import {
  commitSpanPlacement,
  solveSpanPlacement,
  type SpanEdgeRef
} from "@/lib/builder/span";
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

/** What the hand holds: a single tile, a prefab, or nothing. */
type HandItem = { kind: "tile" } | { kind: "prefab"; prefabId: PrefabId } | null;

const HISTORY_CAP = 60;
const WHEEL_STEP_THRESHOLD = 28;

export default function BuilderPage() {
  const [draft, setDraft] = useState<AuthoredBuildDraft>(() => createEmptyDraft("My Build"));
  const [past, setPast] = useState<AuthoredBuildDraft[]>([]);
  const [future, setFuture] = useState<AuthoredBuildDraft[]>([]);
  const [savedDrafts, setSavedDrafts] = useState<BuildDraftSummary[]>([]);
  const [settings, setSettings] = useState<PlacementSettings>(() => defaultPlacementSettings());
  const [hover, setHover] = useState<MagnetHover | null>(null);
  const [handItem, setHandItem] = useState<HandItem>({ kind: "tile" });
  const [spanAnchor, setSpanAnchor] = useState<SpanEdgeRef | null>(null);
  const [groundAnchor, setGroundAnchor] = useState<{ x: number; z: number } | null>(null);
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
  const handActive = handItem !== null;
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
  const spanGhost = useMemo(() => {
    if (!spanAnchor || !hover || handItem?.kind !== "tile") return null;
    if (hover.tileId === spanAnchor.tileId && hover.edge === spanAnchor.edge) return null;
    return solveSpanPlacement(
      draft,
      spanAnchor,
      { tileId: hover.tileId, edge: hover.edge },
      { shape: settings.shape, childEdge: settings.childEdge, color: settings.color }
    );
  }, [draft, handItem, hover, settings.childEdge, settings.color, settings.shape, spanAnchor]);
  const ghost = useMemo(
    () => (handItem?.kind === "tile" && !spanAnchor ? deriveGhostPreview(draft, hover, settings) : null),
    [draft, handItem, hover, settings, spanAnchor]
  );
  const rootGhost = useMemo(
    () =>
      handItem?.kind === "tile" && !hover && !spanAnchor && groundAnchor && cursorActive
        ? deriveRootGhost(draft, settings, groundAnchor)
        : null,
    [cursorActive, draft, groundAnchor, handItem, hover, settings, spanAnchor]
  );
  const prefabGhost = useMemo(() => {
    if (handItem?.kind !== "prefab") return null;
    if (hover) return prefabGhostOnEdge(draft, handItem.prefabId, hover, settings.color);
    if (groundAnchor && cursorActive) {
      return prefabGhostOnGround(draft, handItem.prefabId, groundAnchor, settings.color);
    }
    return null;
  }, [cursorActive, draft, groundAnchor, handItem, hover, settings.color]);
  const snapPoints = useMemo(() => collectSnapPoints(draft), [draft]);
  const selectedTile = draft.tiles.find((tile) => tile.id === selectedTileId) ?? null;
  const selectedSubtree = useMemo(
    () => (selectedTileId ? collectTileSubtree(draft, selectedTileId) : []),
    [draft, selectedTileId]
  );
  const selectedRefoldable = useMemo(
    () => canRefoldTile(draft, selectedTileId),
    [draft, selectedTileId]
  );
  const spanAnchorEdge = useMemo(() => {
    if (!spanAnchor) return null;
    return draft.tiles.some((tile) => tile.id === spanAnchor.tileId) ? spanAnchor : null;
  }, [draft, spanAnchor]);
  const isSimulating = simulationMode !== "edit";

  /** Where the fold controls currently aim (for collision-filtered Q/E cycling). */
  const foldContext: FoldContext = useMemo(() => {
    if (hover && handItem?.kind === "tile" && !spanAnchor) return { kind: "hover", hover };
    if (!hover && handItem?.kind === "tile" && groundAnchor && cursorActive) {
      return { kind: "root", point: groundAnchor };
    }
    return { kind: "free" };
  }, [cursorActive, groundAnchor, handItem, hover, spanAnchor]);

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
        // No valid angle exists at this edge: quiet no-fit, nothing to do.
        return;
      }
      const placed = result.draft.tiles.find((tile) => tile.id === result.placedTileId);
      commitDraft(result.draft);
      setSelectedTileId(result.placedTileId);
      // The placement may have auto-selected a different valid angle; adopt it so the
      // controls reflect what was actually placed.
      if (result.effectiveFoldAngle !== undefined) {
        const adopted = result.effectiveFoldAngle;
        setSettings((current) =>
          Math.abs(current.foldAngle - adopted) > 0.0001 ? { ...current, foldAngle: adopted } : current
        );
      }
      // Keep the hand live: re-derive the snap against the new draft from the cursor's
      // current position, so the next ghost appears without wiggling the mouse.
      setHover(resolveSnapHover(collectSnapPoints(result.draft), cursorRef.current, null));
      setFlash({ tileId: result.placedTileId, at: performance.now() });
      if (placed) spawnBurst(placed.position);
    },
    [commitDraft, draft, settings, spawnBurst]
  );

  /** Ground click with a tile in hand ALWAYS starts a new island (current orientation honored). */
  const placeRoot = useCallback(
    (point: { x: number; z: number }) => {
      const result = placeRootOnGround(draft, {
        shape: settings.shape,
        color: settings.color,
        point,
        foldAngle: settings.foldAngle,
        reverse: settings.reverse
      });
      if (!result.placedTileId) {
        return;
      }
      const placed = result.draft.tiles.find((tile) => tile.id === result.placedTileId);
      const isFirstIsland = draft.tiles.length === 0;
      commitDraft(result.draft);
      setSelectedTileId(result.placedTileId);
      setFlash({ tileId: result.placedTileId, at: performance.now() });
      if (placed) spawnBurst(placed.position);
      showToast(
        isFirstIsland
          ? "First tile down. Bring the next one close to a magnet to snap it."
          : "New island started — separate grounded structures are physically real."
      );
    },
    [commitDraft, draft, settings.color, settings.foldAngle, settings.reverse, settings.shape, showToast, spawnBurst]
  );

  const placePrefab = useCallback(
    (prefabId: PrefabId, target: { hover: MagnetHover } | { point: { x: number; z: number } }) => {
      const result =
        "hover" in target
          ? placePrefabOnEdge(draft, prefabId, target.hover, settings.color)
          : placePrefabOnGround(draft, prefabId, target.point, settings.color);
      if (result.placedTileIds.length === 0) {
        showToast(result.reason ?? "The prefab doesn't fit there.", "blocked");
        return;
      }
      const anchor = result.draft.tiles.find((tile) => tile.id === result.placedTileIds[0]);
      commitDraft(result.draft);
      setSelectedTileId(null);
      setHover(resolveSnapHover(collectSnapPoints(result.draft), cursorRef.current, null));
      if (anchor) spawnBurst(anchor.position);
      showToast(`${PREFAB_SPECS[prefabId].label} placed (${result.placedTileIds.length} tiles).`);
    },
    [commitDraft, draft, settings.color, showToast, spawnBurst]
  );

  const commitSpan = useCallback(
    (target: MagnetHover) => {
      if (!spanAnchor) return;
      const targetRef = { tileId: target.tileId, edge: target.edge };
      const solution = solveSpanPlacement(draft, spanAnchor, targetRef, {
        shape: settings.shape,
        childEdge: settings.childEdge,
        color: settings.color
      });
      if (!solution.ok) {
        showToast(solution.reason, "blocked");
        return;
      }
      const result = commitSpanPlacement(draft, spanAnchor, targetRef, solution, {
        shape: settings.shape,
        childEdge: settings.childEdge,
        color: settings.color
      });
      if (!result.placedTileId) {
        showToast("The solved span could not be committed.", "blocked");
        return;
      }
      commitDraft(result.draft);
      setSpanAnchor(null);
      setSelectedTileId(result.placedTileId);
      const placed = result.draft.tiles.find((tile) => tile.id === result.placedTileId);
      if (placed) spawnBurst(placed.position);
      showToast(`Span placed at ${foldLabel(solution.foldAngle)} — both edges connected.`);
    },
    [commitDraft, draft, settings.childEdge, settings.color, settings.shape, showToast, spanAnchor, spawnBurst]
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
      // Track the grid cell the ground ghost would land in (discrete, so cheap).
      const snapped = snapRootPosition({ x: point.x, z: point.z });
      setGroundAnchor((current) =>
        current && current.x === snapped.x && current.z === snapped.z
          ? current
          : { x: snapped.x, z: snapped.z }
      );
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

  /** One click handler for the whole scene: span > snap-place > root-place > select > clear. */
  const handleSceneClick = useCallback(
    (point: Vec3, source: "ground" | string) => {
      if (spanAnchor && handItem?.kind === "tile" && hoverRef.current) {
        commitSpan(hoverRef.current);
        return;
      }
      if (handItem?.kind === "prefab") {
        if (hoverRef.current) {
          placePrefab(handItem.prefabId, { hover: hoverRef.current });
          return;
        }
        if (source === "ground") {
          placePrefab(handItem.prefabId, { point: { x: point.x, z: point.z } });
          return;
        }
      }
      if (handItem?.kind === "tile" && hoverRef.current) {
        placeAtHover(hoverRef.current);
        return;
      }
      if (handItem?.kind === "tile" && source === "ground") {
        placeRoot({ x: point.x, z: point.z });
        return;
      }
      if (source !== "ground") {
        setSelectedTileId(source);
        return;
      }
      setSelectedTileId(null);
    },
    [commitSpan, handItem, placeAtHover, placePrefab, placeRoot, spanAnchor]
  );

  const emptyHand = useCallback(() => {
    setHandItem(null);
    setSpanAnchor(null);
    setHover(null);
  }, []);

  const pickUpTile = useCallback((shape: TileShape) => {
    setHandItem({ kind: "tile" });
    setSpanAnchor(null);
    setSettings((current) => ({
      ...current,
      shape,
      childEdge: clampChildEdge(shape, current.childEdge)
    }));
  }, []);

  const pickUpPrefab = useCallback((prefabId: PrefabId) => {
    setHandItem({ kind: "prefab", prefabId });
    setSpanAnchor(null);
  }, []);

  /** S with a magnet edge hovered: anchor the hinge there, then pick the far edge. */
  const armSpan = useCallback(() => {
    if (handItem?.kind !== "tile") return;
    if (TILE_SPECS[settings.shape].maxEdges !== 4) {
      showToast("Span placement needs a four-sided tile.", "blocked");
      return;
    }
    const target = hoverRef.current;
    if (!target) {
      showToast("Hover a magnet edge first, then press S to anchor the span.", "blocked");
      return;
    }
    setSpanAnchor({ tileId: target.tileId, edge: target.edge });
    showToast("Span anchored — now click the far edge (Esc cancels).");
  }, [handItem, settings.shape, showToast]);

  const recolorSelected = useCallback(
    (color: string) => {
      if (!selectedTileId) return;
      commitDraft(updateBuilderTile(draft, selectedTileId, { color }));
    },
    [commitDraft, draft, selectedTileId]
  );

  const refoldSelected = useCallback(
    (direction: 1 | -1, fine: boolean) => {
      if (!selectedTileId) return;
      const result = cycleRefold(draft, selectedTileId, direction, fine);
      if (!result) {
        showToast("No other collision-free angle in that direction.", "blocked");
        return;
      }
      commitDraft(result.draft);
      showToast(`Re-folded to ${foldLabel(result.foldAngle)}.`);
    },
    [commitDraft, draft, selectedTileId, showToast]
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
        if (shape) pickUpTile(shape);
        return;
      }

      switch (key) {
        case "q":
        case "e": {
          const direction: 1 | -1 = key === "e" ? 1 : -1;
          const fine = event.shiftKey;
          // With an empty hand and a selected tile, Q/E re-folds the selection live.
          if (!handActiveRef.current && selectedTileId) {
            refoldSelected(direction, fine);
            break;
          }
          // Otherwise Q/E steers the hand fold, skipping collision-invalid angles.
          setSettings((current) => ({
            ...current,
            foldAngle: cycleFold(draftRef.current, foldContext, current, direction, fine)
          }));
          break;
        }
        case "s":
          armSpan();
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
            if (spanAnchor) commitSpan(hoverRef.current);
            else placeAtHover(hoverRef.current);
          }
          break;
        case "backspace":
        case "delete":
          event.preventDefault();
          deleteSelected();
          break;
        case "escape":
          if (spanAnchor) {
            setSpanAnchor(null);
            break;
          }
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
  }, [
    armSpan,
    commitSpan,
    deleteSelected,
    emptyHand,
    foldContext,
    pickUpTile,
    placeAtHover,
    redo,
    refoldSelected,
    selectedTileId,
    spanAnchor,
    undo
  ]);

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
  // either snapped to a magnet, or aiming a tile at open ground. Like Q/E, the wheel
  // skips collision-invalid angles (Shift+wheel steps fine).
  const foldContextRef = useRef(foldContext);
  foldContextRef.current = foldContext;
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    function handleWheel(event: WheelEvent) {
      const aimingRoot = handActiveRef.current && cursorRef.current !== null;
      if (!hoverRef.current && !aimingRoot) return;
      event.preventDefault();
      wheelAccumRef.current += event.deltaY;
      if (Math.abs(wheelAccumRef.current) < WHEEL_STEP_THRESHOLD) return;
      const direction: 1 | -1 = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;
      const fine = event.shiftKey;
      setSettings((current) => ({
        ...current,
        foldAngle: cycleFold(draftRef.current, foldContextRef.current, current, direction, fine)
      }));
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
          aimingRoot={handActive && cursorActive}
          bursts={bursts}
          draft={draft}
          flash={flash}
          ghost={ghost}
          handActive={handActive}
          hover={hover}
          isSimulating={isSimulating}
          onCursorMove={handleCursorMove}
          onSceneClick={handleSceneClick}
          onSimulationStatus={setSandboxStatus}
          prefabGhost={prefabGhost}
          rootGhost={rootGhost}
          selectedTileId={selectedTileId}
          simulationMode={simulationMode}
          simulationNonce={simulationNonce}
          snapPoints={snapPoints}
          spanAnchor={spanAnchorEdge}
          spanGhost={spanGhost}
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

        {/* ---- selected tile panel: recolor, re-fold, delete ---- */}
        {selectedTile && !isSimulating ? (
          <div className="play-selected-chip" data-testid="selected-panel">
            <div className="play-selected-row">
              <span className="play-selected-swatch" style={{ background: selectedTile.color }} />
              <span className="play-selected-name">
                {TILE_SPECS[selectedTile.shape].label}
                {selectedSubtree.length > 1 ? <small> +{selectedSubtree.length - 1} built on it</small> : null}
              </span>
              <button aria-label="Clear selection" className="play-selected-clear" onClick={() => setSelectedTileId(null)} type="button">
                <X size={13} />
              </button>
            </div>
            <div className="play-selected-row">
              {CLASSIC_TILE_COLORS.map((swatch) => (
                <button
                  aria-label={`Recolor ${swatch}`}
                  className={`play-swatch small ${selectedTile.color === swatch ? "active" : ""}`}
                  data-recolor={swatch}
                  key={swatch}
                  onClick={() => recolorSelected(swatch)}
                  style={{ background: swatch }}
                  type="button"
                />
              ))}
            </div>
            <div className="play-selected-row">
              {selectedRefoldable ? (
                <>
                  <button className="play-modifier" data-testid="refold-left" onClick={() => refoldSelected(-1, false)} type="button">
                    ⟲ fold
                  </button>
                  <button className="play-modifier" data-testid="refold-fine-left" onClick={() => refoldSelected(-1, true)} type="button">
                    −5°
                  </button>
                  <span className="play-selected-fold" data-testid="selected-fold">
                    {selectedTile.foldAngle !== undefined ? foldLabel(selectedTile.foldAngle) : "—"}
                  </span>
                  <button className="play-modifier" data-testid="refold-fine-right" onClick={() => refoldSelected(1, true)} type="button">
                    +5°
                  </button>
                  <button className="play-modifier" data-testid="refold-right" onClick={() => refoldSelected(1, false)} type="button">
                    fold ⟳
                  </button>
                </>
              ) : (
                <span className="play-selected-fold muted">root tile — no hinge to re-fold</span>
              )}
              <button className="play-selected-delete" onClick={deleteSelected} type="button">
                <Trash2 size={14} />
                {selectedSubtree.length > 1 ? `Remove ${selectedSubtree.length}` : "Remove"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ---- span mode chip ---- */}
        {spanAnchor && !isSimulating ? (
          <div className="play-span-chip" data-testid="span-chip">
            {spanGhost
              ? spanGhost.ok
                ? `Span solves at ${foldLabel(spanGhost.foldAngle)} — click to place`
                : spanGhost.reason
              : "Span anchored — hover the far edge (Esc cancels)"}
          </div>
        ) : null}

        {/* ---- toast ---- */}
        {toast ? <div className={`play-toast ${toast.kind}`}>{toast.text}</div> : null}

        {/* ---- empty state hint ---- */}
        {draft.tiles.length === 0 && !isSimulating && handActive ? (
          <div className="play-empty-hint">
            Your tile is in hand — <kbd>Q</kbd>/<kbd>E</kbd> tilts it (<kbd>Shift</kbd> for ±5°), <kbd>R</kbd> flips, click the ground to place
          </div>
        ) : null}
        {!handActive && !isSimulating && !selectedTile ? (
          <div className="play-empty-hint">
            Hand empty — press <kbd>1</kbd>–<kbd>6</kbd> or click a shape below; click a placed tile to edit it
          </div>
        ) : null}
        {!handActive && !isSimulating && selectedTile ? (
          <div className="play-empty-hint">
            <kbd>Q</kbd>/<kbd>E</kbd> re-folds the selected tile (<kbd>Shift</kbd> for ±5°), <kbd>Esc</kbd> deselects
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
            <div className="play-fold-ticks" title="Fold angle (Q/E presets, Shift+Q/E ±5°, or scroll)">
              {FOLD_CHOICES.map((choice) => (
                <button
                  className={`play-fold-tick ${Math.abs(choice.radians - settings.foldAngle) < 0.0001 ? "active" : ""}`}
                  key={choice.label}
                  onClick={() => setSettings((current) => ({ ...current, foldAngle: choice.radians }))}
                  type="button"
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <span className="play-key-hint">
              <kbd>E</kbd>
            </span>
            <span className="play-fold-readout" data-testid="fold-readout" title="Current fold angle (ghost may auto-pick the nearest valid angle)">
              {ghost?.valid ? foldLabel(ghost.effectiveFoldAngle) : foldLabel(settings.foldAngle)}
              {ghost?.valid && ghost.autoAngled ? <small> auto</small> : null}
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
            <button
              className={`play-modifier ${spanAnchor ? "active" : ""}`}
              onClick={armSpan}
              title="Span: anchor the hinge on the hovered edge, then click the far edge (S)"
              type="button"
            >
              <kbd>S</kbd> span
            </button>
          </div>
          <div className="play-hotbar">
            {SHAPE_ORDER.map((shape, index) => {
              const used = usedByShape.get(shape) ?? 0;
              return (
                <button
                  className={`play-slot ${handItem?.kind === "tile" && settings.shape === shape ? "active" : ""}`}
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
            <div className="play-prefab-strip" data-testid="prefab-strip">
              {PREFAB_ORDER.map((prefabId) => (
                <button
                  className={`play-slot play-prefab-slot ${
                    handItem?.kind === "prefab" && handItem.prefabId === prefabId ? "active" : ""
                  }`}
                  data-prefab={prefabId}
                  key={prefabId}
                  onClick={() => pickUpPrefab(prefabId)}
                  title={PREFAB_SPECS[prefabId].description}
                  type="button"
                >
                  <PrefabGlyph prefabId={prefabId} />
                  <span className="play-prefab-label">{PREFAB_SPECS[prefabId].label}</span>
                </button>
              ))}
            </div>
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

function PrefabGlyph({ prefabId }: { prefabId: PrefabId }) {
  const art: Record<PrefabId, string> = {
    "open-cube": "M8 12 L16 7 L24 12 L24 22 L16 27 L8 22 Z M8 12 L16 17 L24 12 M16 17 L16 27",
    "tower-module": "M9 17 L16 13 L23 17 L23 24 L16 28 L9 24 Z M9 10 L16 6 L23 10 L23 17 L16 21 L9 17 Z",
    "closed-box": "M8 12 L16 7 L24 12 L24 22 L16 27 L8 22 Z",
    "wedge-ramp": "M6 26 L26 26 L26 12 Z",
    "roof-prism": "M6 26 L16 10 L26 26"
  };
  return (
    <svg aria-hidden className="play-slot-glyph" viewBox="0 0 32 32">
      <path d={art[prefabId]} fill="none" stroke="#27343c" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
