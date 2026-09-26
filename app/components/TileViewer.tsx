"use client";

import { Edges, OrbitControls, Line, Html } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileWorldMagnetPositions } from "@/lib/magnetic-tiles/magnets";
import type { BuildGraph, TileInstance, TileShape } from "@/lib/magnetic-tiles/types";

import type { CourseLane, CarTrial } from "@/lib/planner/types";

interface TileViewerProps {
  lanes?: CourseLane[];
  trials?: CarTrial[];
  playbackTime?: number;
  showLabels?: boolean;
  partLabels?: Record<string, string>;
  viewDirection?: [number, number, number];
  build: BuildGraph | null;
  visibleStep: number;
}

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

interface ViewerControls {
  target?: THREE.Vector3;
  update?: () => void;
}

declare global {
  interface Window {
    __buildViewer?: BuildViewerHandle;
  }
}

// Module-level imperative bridge to the external render/screenshot harness (Playwright reads
// window.__buildViewer). Kept out of the component body so the React Compiler treats these
// side-effecting global writes as opaque calls rather than flagging in-render mutation.
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

export function TileViewer({ build, visibleStep, lanes = [], trials = [], playbackTime = 0, showLabels = false, partLabels, viewDirection }: TileViewerProps) {
  if (!build) {
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

  const visibleTiles = build.tiles.filter((tile) => tile.step <= visibleStep);
  const viewingBox = calculateViewingBox(build.tiles);
  const cameraDistance = Math.max(viewingBox.width, viewingBox.height, viewingBox.depth) * 2.25;
  const loweredCenterY = viewingBox.center.y - build.bounds.height * 0.28;
  const cameraPosition: [number, number, number] =
    viewDirection
      ? [viewingBox.center.x + cameraDistance * viewDirection[0] * .8, loweredCenterY + cameraDistance * viewDirection[1] * .8, viewingBox.center.z + cameraDistance * viewDirection[2] * .8]
      : build.family === "aircraft"
      ? [viewingBox.center.x + build.bounds.width * 0.05, loweredCenterY + cameraDistance * 1.05, viewingBox.center.z - cameraDistance * 0.08]
      : [viewingBox.center.x + cameraDistance * 0.72, loweredCenterY + cameraDistance * 0.38, viewingBox.center.z + cameraDistance * 0.82];
  const cameraTarget: [number, number, number] =
    viewDirection
      ? [viewingBox.center.x, loweredCenterY, viewingBox.center.z]
      : build.family === "aircraft"
      ? [viewingBox.center.x, loweredCenterY + build.bounds.height * 0.04, viewingBox.center.z - 0.2]
      : [viewingBox.center.x, loweredCenterY + build.bounds.height * 0.2, viewingBox.center.z];

  return (
    <Canvas
      camera={{
        position: cameraPosition,
        fov: 38
      }}
      shadows
    >
      <ambientLight intensity={0.7} />
      <directionalLight castShadow intensity={1.8} position={[8, 14, 12]} />
      <group position={[0, -build.bounds.height * 0.28, 0]}>
        {visibleTiles.map((tile) => (
          <TileMesh key={tile.id} tile={tile} />
        ))}
        {showLabels && visibleTiles.map(tile => <group key={`label-${tile.id}`}>
          <Html position={[tile.position.x,tile.position.y+0.2,tile.position.z]} center><span className="design-piece-label">{partLabels?.[tile.id] ?? `P${build.tiles.findIndex(t=>t.id===tile.id)+1}`}</span></Html>
          {tileWorldVertices(tile).map((p,index,vertices) => { const q=vertices[(index+1)%vertices.length]; return <Html key={index} center position={[(p.x+q.x)/2,(p.y+q.y)/2+0.15,(p.z+q.z)/2]}><span className="design-edge-label">{index+1}</span></Html>; })}
        </group>)}
        {lanes.map((lane,i)=><Line key={lane.id} points={lane.waypoints.map(p=>[p.x,p.y+0.2,p.z] as [number,number,number])} color={i?'#dd4c48':'#2165dc'} lineWidth={3}/>) }
        {trials.map((trial,i)=> {
          const sample=trial.samples.find(s=>s.time>=playbackTime)??trial.samples.at(-1);
          if(!sample)return null;
          return <mesh key={trial.laneId} position={[sample.position.x,sample.position.y,sample.position.z]}><sphereGeometry args={[0.25,16,16]}/><meshStandardMaterial color={i?'#dd4c48':'#2165dc'}/></mesh>;
        })}
      </group>
      <Grid build={build} />
      <OrbitControls enableDamping makeDefault maxDistance={80} minDistance={10} target={cameraTarget} />
      <CameraHandle />
    </Canvas>
  );
}

function CameraHandle() {
  const state = useThree();
  const { camera, gl, invalidate, scene } = state;
  const controls = (state as typeof state & { controls?: ViewerControls }).controls;

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

      if (controls?.target) {
        controls.target.copy(center);
      }
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

function calculateViewingBox(tiles: TileInstance[]) {
  const vertices = tiles.flatMap((tile) => tileWorldVertices(tile));
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const zs = vertices.map((vertex) => vertex.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  return {
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2
    },
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ
  };
}

function TileMesh({ tile }: { tile: TileInstance }) {
  const geometry = useMemo(() => createTileGeometry(tile.shape), [tile.shape]);
  const magnets = useMemo(() => tileWorldMagnetPositions(tile), [tile]);
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
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: tile.color,
        transparent: true,
        opacity: 0.78,
        roughness: 0.38,
        metalness: 0.02,
        side: THREE.DoubleSide
      }),
    [tile.color]
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (matrix) {
    return (
      <group>
        <mesh castShadow receiveShadow geometry={geometry} material={material} matrix={matrix} matrixAutoUpdate={false}>
          <Edges color="#1b252b" lineWidth={1.2} threshold={15} />
        </mesh>
        <MagnetMarkers tile={tile} magnets={magnets} />
      </group>
    );
  }

  return (
    <group>
      <mesh
        castShadow
        receiveShadow
        geometry={geometry}
        material={material}
        position={[tile.position.x, tile.position.y, tile.position.z]}
        rotation={[tile.rotation.x, tile.rotation.y, tile.rotation.z]}
      >
        <Edges color="#1b252b" lineWidth={1.2} threshold={15} />
      </mesh>
      <MagnetMarkers tile={tile} magnets={magnets} />
    </group>
  );
}

function MagnetMarkers({ magnets, tile }: { magnets: ReturnType<typeof tileWorldMagnetPositions>; tile: TileInstance }) {
  return magnets.map((magnet) => (
    <mesh
      key={`${tile.id}-edge-${magnet.edgeIndex}-magnet-${magnet.magnetIndex}`}
      position={[magnet.worldPoint.x, magnet.worldPoint.y, magnet.worldPoint.z]}
    >
      <sphereGeometry args={[0.08, 12, 12]} />
      <meshBasicMaterial color="#142126" />
    </mesh>
  ));
}

function Grid({ build }: { build: BuildGraph }) {
  const size = Math.max(24, Math.ceil(Math.max(build.bounds.width, build.bounds.depth) + 12));
  return (
    <gridHelper
      args={[size, Math.max(8, size / 3), "#9fb0b8", "#d4dde0"]}
      position={[0, -build.bounds.height * 0.28, 0]}
    />
  );
}

function createTileGeometry(shape: TileShape): THREE.ExtrudeGeometry {
  const spec = TILE_SPECS[shape];
  const path = new THREE.Shape();

  if (spec.maxEdges === 4) {
    const halfW = spec.width / 2;
    const halfH = spec.height / 2;
    path.moveTo(-halfW, -halfH);
    path.lineTo(halfW, -halfH);
    path.lineTo(halfW, halfH);
    path.lineTo(-halfW, halfH);
    path.lineTo(-halfW, -halfH);
  } else if (shape === "right-triangle") {
    path.moveTo(-spec.width / 2, -spec.height / 2);
    path.lineTo(spec.width / 2, -spec.height / 2);
    path.lineTo(-spec.width / 2, spec.height / 2);
    path.lineTo(-spec.width / 2, -spec.height / 2);
  } else {
    const halfW = spec.width / 2;
    path.moveTo(-halfW, -spec.height / 2);
    path.lineTo(halfW, -spec.height / 2);
    path.lineTo(0, spec.height / 2);
    path.lineTo(-halfW, -spec.height / 2);
  }

  const geometry = new THREE.ExtrudeGeometry(path, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.03,
    depth: 0.14
  });
  geometry.translate(0, 0, -0.07);
  return geometry;
}
