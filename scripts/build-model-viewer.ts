/**
 * Generate a standalone, rotatable 3D viewer for the jet reconstruction (jet-reference-model.ts).
 * Writes public/jet-model.html (served by Next at http://localhost:3000/jet-model.html).
 *
 * Run: npx tsx scripts/build-model-viewer.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { JET_REFERENCE_TILES } from "../lib/recognition/jet-reference-model";

const COLORS: Record<string, string> = {
  fuselage: "#1e6eb4",
  nose: "#78c8e6",
  wing: "#e1466e",
  tail: "#14c896",
  fin: "#8c46c8"
};

// Triangulate each tile (fan) into triangles with a color, for a BufferGeometry.
const tris: Array<{ a: number[]; b: number[]; c: number[]; color: string }> = [];
for (const tile of JET_REFERENCE_TILES) {
  const v = tile.verts;
  for (let i = 1; i < v.length - 1; i += 1) {
    tris.push({ a: v[0], b: v[i], c: v[i + 1], color: COLORS[tile.part] ?? "#888888" });
  }
}

const data = JSON.stringify(tris);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Jet reconstruction — 3D model</title>
<style>
  html, body { margin: 0; height: 100%; background: #eef2f6; font-family: system-ui, sans-serif; }
  #info { position: fixed; top: 12px; left: 12px; padding: 8px 12px; background: rgba(255,255,255,0.85);
          border-radius: 8px; font-size: 13px; color: #333; line-height: 1.5; }
  #info b { color: #111; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
</style>
</head>
<body>
<div id="info">
  <b>Jet reconstruction</b> (from video frames) — drag to rotate, scroll to zoom<br/>
  <span class="sw" style="background:#1e6eb4"></span>fuselage
  <span class="sw" style="background:#78c8e6"></span>nose
  <span class="sw" style="background:#e1466e"></span>wing
  <span class="sw" style="background:#14c896"></span>tail
  <span class="sw" style="background:#8c46c8"></span>fin
</div>
<script type="importmap">
{ "imports": {
  "three": "https://esm.sh/three@0.160.0",
  "three/addons/": "https://esm.sh/three@0.160.0/examples/jsm/"
} }
</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const TRIS = ${data};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef2f6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);

// Build geometry grouped by color for clean materials.
const byColor = new Map();
for (const t of TRIS) {
  if (!byColor.has(t.color)) byColor.set(t.color, []);
  byColor.get(t.color).push(t);
}
const group = new THREE.Group();
const box = new THREE.Box3();
for (const [color, ts] of byColor) {
  const positions = [];
  for (const t of ts) { positions.push(...t.a, ...t.b, ...t.c); }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.92 });
  const mesh = new THREE.Mesh(geom, mat);
  group.add(mesh);
  // edges
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 1), new THREE.LineBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.25 }));
  group.add(edges);
  geom.computeBoundingBox();
  box.union(geom.boundingBox);
}
scene.add(group);

// Center the group at origin.
const center = new THREE.Vector3();
box.getCenter(center);
group.position.sub(center);

const size = new THREE.Vector3();
box.getSize(size);
const radius = size.length() / 2;

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(1, 1.4, 0.8);
scene.add(dir);
const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
dir2.position.set(-0.8, 0.5, -1);
scene.add(dir2);

const grid = new THREE.GridHelper(radius * 6, 24, 0xbbc4cc, 0xd2d9e0);
grid.position.y = -radius;
scene.add(grid);

camera.position.set(radius * 1.8, radius * 1.3, radius * 2.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
</script>
</body>
</html>
`;

writeFileSync(join(process.cwd(), "public", "jet-model.html"), html);
console.log(`Wrote public/jet-model.html (${tris.length} triangles). Open http://localhost:3000/jet-model.html`);
