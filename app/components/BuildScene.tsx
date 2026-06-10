"use client";

/**
 * BuildScene: the ONE 3D scene for the whole app — sky, warm ground, soft shadows,
 * magnet-dotted translucent tiles. Three modes share the exact same visual language:
 *
 *  - "play":   the full Minecraft-like builder (hand ghost, snapping, placement,
 *              physics sandbox). /builder is a thin consumer of this mode; all of its
 *              interaction state stays in the page, this component only renders it.
 *  - "step":   read-only step-through playback — tiles up to `visibleStep` are shown,
 *              tiles added in the latest visible step are highlighted. Used by the
 *              home library viewer and /plan.
 *  - "static": the whole build, read-only.
 *
 * There is exactly ONE physics representation in the browser: the play-mode sandbox.
 * Step/static modes never simulate; buildability verdicts come from the engine gate
 * (/api/gate-build), which is law.
 */

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
import { createRef, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import {
  ROOT_SNAP_GRID,
  builderTileLocalVertices,
  builderTileMagnetWorldPoints,
  builderTileWorldVertices,
  deriveGhostPreview,
  type MagnetHover,
  type SnapPoint
} from "@/lib/builder/placement";
import type { AuthoredBuildDraft, BuilderTile } from "@/lib/builder/types";
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
  sampleJointBreak,
  type MagneticPhysicsModel,
  type PhysicsBodyModel,
  type PhysicsJointModel,
  type RollTestPlan
} from "@/lib/engine/physics-model";
import type { BuildGraph, TileInstance, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";

/* ================================================================== */
/* Public types                                                        */
/* ================================================================== */

export type SimulationMode = "edit" | "stability" | "roll";
export type SandboxStatus = {
  maxDisplacement: number;
  maxSpeed: number;
  poppedJoints: string[];
  roll?: "running" | "reached-bottom" | "fell-off";
};
export type SnapBurstInstance = { id: number; position: Vec3 };
type BodyRef = RefObject<RapierRigidBody | null>;

export interface PlaySceneProps {
  aimingRoot: boolean;
  build: BuildGraph;
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
}

export type BuildSceneProps =
  | ({ mode: "play" } & PlaySceneProps)
  | { mode: "step"; build: BuildGraph | null; visibleStep: number }
  | { mode: "static"; build: BuildGraph | null };

export function BuildScene(props: BuildSceneProps) {
  if (props.mode === "play") {
    return <PlayScene {...props} />;
  }
  if (!props.build) {
    return (
      <div className="empty-state">
        <div className="brand-mark">3D</div>
        <div>
          <strong>Pick a build to see it here.</strong>
          <p className="muted">The viewer shows tiles as translucent magnetic panels.</p>
        </div>
      </div>
    );
  }
  return (
    <PlaybackScene
      build={props.build}
      visibleStep={props.mode === "step" ? props.visibleStep : Number.POSITIVE_INFINITY}
      highlightLatest={props.mode === "step"}
    />
  );
}

/* ================================================================== */
/* Dev instrumentation: ghost mount/unmount stats + scene probe.       */
/* The flicker bug was a ghost mount/unmount oscillation; these stats  */
/* make "the ghost mounted exactly once during a steady hover" a       */
/* machine-checkable invariant (see scripts/verify-feel.ts).           */
/* ================================================================== */

type GhostStats = {
  snapMounts: number;
  snapUnmounts: number;
  handMounts: number;
  handUnmounts: number;
};

interface BuildViewerBounds {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  radius: number;
}

interface BuildViewerHandle {
  setCamera: (azDeg: number, elDeg: number, distScale?: number) => boolean;
  getBounds: () => BuildViewerBounds;
  fitAndOrbit: (azDeg: number, elDeg: number) => boolean;
}

declare global {
  interface Window {
    __ghostStats?: GhostStats;
    __buildViewer?: BuildViewerHandle;
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

// Module-level imperative bridge to the external render/screenshot harness (Playwright
// reads window.__buildViewer). Kept out of the component body so the React Compiler
// treats these side-effecting global writes as opaque calls rather than flagging
// in-render mutation.
function registerBuildViewer(handle: BuildViewerHandle, domElement: HTMLElement): void {
  if (typeof window === "undefined") return;
  window.__buildViewer = handle;
  domElement.dataset.buildViewer = "ready";
}

function unregisterBuildViewer(handle: BuildViewerHandle, domElement: HTMLElement): void {
  if (typeof window === "undefined") return;
  if (window.__buildViewer === handle) window.__buildViewer = undefined;
  delete domElement.dataset.buildViewer;
}

/* ================================================================== */
/* Play mode (the /builder canvas, behavior unchanged)                 */
/* ================================================================== */

function PlayScene({
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
}: PlaySceneProps) {
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
      <SceneAtmosphere />

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

/* ================================================================== */
/* Step / static playback (read-only, same visual language)            */
/* ================================================================== */

function PlaybackScene({
  build,
  highlightLatest,
  visibleStep
}: {
  build: BuildGraph;
  highlightLatest: boolean;
  visibleStep: number;
}) {
  const [initialCameraPosition] = useState<[number, number, number]>(() => {
    const cameraDistance = Math.max(16, build.bounds.width, build.bounds.height, build.bounds.depth) * 1.8;
    return [cameraDistance * 0.62, cameraDistance * 0.52, cameraDistance * 0.82];
  });
  const visibleTiles = useMemo(
    () => build.tiles.filter((tile) => tile.step <= visibleStep),
    [build, visibleStep]
  );
  const latestVisibleStep = useMemo(
    () => (visibleTiles.length > 0 ? Math.max(...visibleTiles.map((tile) => tile.step)) : 0),
    [visibleTiles]
  );

  return (
    <Canvas camera={{ position: initialCameraPosition, fov: 42 }} shadows>
      <SceneAtmosphere />
      <WarmGround interactive={false} />
      {visibleTiles.map((tile) => (
        <PlaybackTileMesh
          highlight={highlightLatest && tile.step === latestVisibleStep}
          key={tile.id}
          tile={tile}
        />
      ))}
      <OrbitControls
        enableDamping
        makeDefault
        maxDistance={90}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={6}
        target={[0, 1.5, 0]}
      />
      <CameraRig bounds={build.bounds} nonce={build.id} />
      <CameraHandle />
    </Canvas>
  );
}

/** A generated/library tile rendered with the builder's exact material language. */
function PlaybackTileMesh({ highlight, tile }: { highlight: boolean; tile: TileInstance }) {
  // The playback path renders plain TileInstances through the builder helpers, which
  // accept the BuilderTile superset; authoring metadata is irrelevant to rendering.
  const builderTile = useMemo<BuilderTile>(
    () => ({ ...tile, authoredMode: "edge-snap", confirmed: true }),
    [tile]
  );
  const geometry = useMemo(() => createTileGeometry(builderTile), [builderTile]);
  const meshProps = useTileTransformProps(builderTile);
  const magnetPoints = useMemo(() => builderTileMagnetWorldPoints(builderTile), [builderTile]);

  return (
    <group>
      <mesh castShadow geometry={geometry} receiveShadow {...meshProps}>
        <meshPhysicalMaterial
          clearcoat={0.6}
          clearcoatRoughness={0.35}
          color={tile.color}
          emissive={highlight ? tile.color : "#000000"}
          emissiveIntensity={highlight ? 0.22 : 0}
          metalness={0.02}
          opacity={0.85}
          roughness={0.22}
          side={THREE.DoubleSide}
          transparent
        />
        <Edges
          color={highlight ? "#f7b733" : "#27343c"}
          lineWidth={highlight ? 2.6 : 1.15}
          threshold={15}
        />
      </mesh>
      {magnetPoints.map((magnet) => (
        <MagnetDot
          active={false}
          hovered={false}
          key={`${tile.id}-e${magnet.edgeIndex}-m${magnet.magnetIndex}`}
          position={magnet.position}
        />
      ))}
    </group>
  );
}

/**
 * Imperative camera bridge for the external render/screenshot harnesses
 * (scripts/render-draft.ts drives window.__buildViewer over Playwright).
 */
function CameraHandle() {
  const state = useThree();
  const { camera, gl, invalidate, scene } = state;
  const controls = (state as typeof state & {
    controls?: { target?: THREE.Vector3; update?: () => void };
  }).controls;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const getBounds = (): BuildViewerBounds => {
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3();

      scene.traverse((object: THREE.Object3D) => {
        if (object.visible === false || object.type === "GridHelper") return;
        const mesh = object as THREE.Object3D & { geometry?: THREE.BufferGeometry };
        if (!mesh.geometry) return;
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const sphere = mesh.geometry.boundingSphere;
        if (!sphere) return;
        // The ground disc would swallow the build bounds; skip the big flat meshes.
        if (sphere.radius > 60) return;

        const center = sphere.center.clone();
        object.localToWorld(center);
        const scale = new THREE.Vector3();
        object.getWorldScale(scale);
        const radius = sphere.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        box.expandByPoint(new THREE.Vector3(center.x - radius, center.y - radius, center.z - radius));
        box.expandByPoint(new THREE.Vector3(center.x + radius, center.y + radius, center.z + radius));
      });

      if (box.isEmpty()) {
        const fallbackCenter = controls?.target ?? new THREE.Vector3();
        return {
          center: { x: fallbackCenter.x, y: fallbackCenter.y, z: fallbackCenter.z },
          size: { x: 12, y: 12, z: 12 },
          radius: 6
        };
      }

      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      return {
        center: { x: center.x, y: center.y, z: center.z },
        size: { x: size.x, y: size.y, z: size.z },
        radius: size.length() / 2
      };
    };

    const setCamera = (azDeg: number, elDeg: number, distScale = 1.5): boolean => {
      const bounds = getBounds();
      const center = new THREE.Vector3(bounds.center.x, bounds.center.y, bounds.center.z);
      const largestSpan = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1);
      const distance = Math.max(10, largestSpan * distScale);
      const azimuth = THREE.MathUtils.degToRad(azDeg);
      const elevation = THREE.MathUtils.degToRad(elDeg);
      const planarDistance = distance * Math.cos(elevation);

      camera.position.set(
        center.x + planarDistance * Math.cos(azimuth),
        center.y + distance * Math.sin(elevation),
        center.z + planarDistance * Math.sin(azimuth)
      );
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      if (controls?.target) controls.target.copy(center);
      controls?.update?.();
      invalidate();
      return true;
    };

    const handle: BuildViewerHandle = {
      setCamera,
      getBounds,
      fitAndOrbit: (azDeg, elDeg) => setCamera(azDeg, elDeg, 1.5)
    };

    registerBuildViewer(handle, gl.domElement);
    return () => unregisterBuildViewer(handle, gl.domElement);
  }, [camera, controls, gl, invalidate, scene]);

  return null;
}

/* ================================================================== */
/* Shared atmosphere: lights, fog, ground                              */
/* ================================================================== */

function SceneAtmosphere() {
  return (
    <>
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
    </>
  );
}

function WarmGround({
  interactive,
  onCursorMove,
  onSceneClick
}: {
  interactive: boolean;
  onCursorMove?: (point: Vec3) => void;
  onSceneClick?: (point: Vec3, source: "ground" | string) => void;
}) {
  return (
    <group>
      <mesh
        onPointerUp={
          interactive && onSceneClick
            ? (event) => {
                if (event.delta > 5) return;
                event.stopPropagation();
                onSceneClick({ x: event.point.x, y: event.point.y, z: event.point.z }, "ground");
              }
            : undefined
        }
        onPointerMove={
          interactive && onCursorMove
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
function CameraRig({
  bounds,
  nonce
}: {
  bounds: { width: number; height: number; depth: number };
  nonce: number | string;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  const framedNonceRef = useRef<number | string>(typeof nonce === "number" ? 0 : nonce);
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
/* Physics sandbox (stability + roll), play mode only                  */
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
