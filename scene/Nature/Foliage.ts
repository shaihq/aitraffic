import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clayMaterial } from '@/shaders/clay';

// Clay-diorama nature: tiered scalloped pines, puffy round trees, grass tufts, leafy plants,
// little flowers and white picket fences. Everything is instanced and split into spatial tiles,
// so the GPU skips tiles outside the view and trees swap to a lighter model far from focus.

type RGB = [number, number, number];

export interface TreeSpot {
  x: number;
  z: number;
  r: number;
  kind: 'pine' | 'puff';
}

export interface DecorSpot {
  x: number;
  z: number;
  yaw: number;
  s: number;
}

export interface DecorSet {
  tufts: DecorSpot[];
  bushes: DecorSpot[];
  flowers: DecorSpot[];
  fences: DecorSpot[];
}

function paint(g: THREE.BufferGeometry, c: RGB) {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat.attributes.uv) flat.deleteAttribute('uv');
  const arr = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set(c, i);
  flat.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return flat;
}

/** One frilly pine tier: a skirt whose lower edge droops into rounded scallops. */
function tier(r: number, y0: number, h: number, topR: number, lobes: number, seg: number, rows: 'high' | 'low') {
  const ringDefs: { rad: (lobe: number) => number; y: (lobe: number) => number; c: RGB }[] =
    rows === 'high'
      ? [
          { rad: () => r * 0.55, y: () => y0 + 0.16, c: [0.3, 0.5, 0.2] },
          { rad: (l) => r * (0.96 + 0.06 * l), y: (l) => y0 - 0.05 - 0.12 * l, c: [0.38, 0.62, 0.24] },
          { rad: (l) => r * (1.02 + 0.07 * l), y: (l) => y0 + 0.06 - 0.09 * l, c: [0.5, 0.76, 0.3] },
          { rad: (l) => r * (0.8 + 0.02 * l), y: () => y0 + h * 0.45, c: [0.58, 0.84, 0.34] },
          { rad: () => topR, y: () => y0 + h, c: [0.64, 0.88, 0.38] },
        ]
      : [
          { rad: (l) => r * (1.0 + 0.06 * l), y: (l) => y0 - 0.08 * l, c: [0.44, 0.7, 0.27] },
          { rad: () => r * 0.78, y: () => y0 + h * 0.45, c: [0.58, 0.84, 0.34] },
          { rad: () => topR, y: () => y0 + h, c: [0.64, 0.88, 0.38] },
        ];
  const pos: number[] = [];
  const col: number[] = [];
  for (const ring of ringDefs) {
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const lobe = 0.5 + 0.5 * Math.cos(lobes * t);
      const rad = ring.rad(lobe);
      pos.push(Math.cos(t) * rad, ring.y(lobe), Math.sin(t) * rad);
      col.push(...ring.c);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < ringDefs.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const b = j * seg + ((i + 1) % seg);
      const c = (j + 1) * seg + i;
      const d = (j + 1) * seg + ((i + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export function pineGeometry(detail: 'high' | 'low') {
  const lobes = detail === 'high' ? 8 : 6;
  const seg = detail === 'high' ? 24 : 12;
  const tiers = [
    { r: 1.0, y0: 1.0, h: 0.8, topR: 0.42 },
    { r: 0.82, y0: 1.55, h: 0.75, topR: 0.34 },
    { r: 0.64, y0: 2.05, h: 0.72, topR: 0.26 },
    { r: 0.46, y0: 2.5, h: 0.95, topR: 0.03 },
  ];
  const parts = tiers.map((t) => tier(t.r, t.y0, t.h, t.topR, lobes, seg, detail === 'high' ? 'high' : 'low'));
  parts.push(paint(new THREE.CylinderGeometry(0.2, 0.26, 1.1, detail === 'high' ? 10 : 6).translate(0, 0.55, 0), [0.55, 0.36, 0.24]));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

export function puffGeometry() {
  const leaf: RGB = [0.6, 0.85, 0.36];
  return mergeGeometries([
    paint(new THREE.IcosahedronGeometry(1, 2).scale(1, 0.9, 1).translate(0, 2.2, 0), leaf),
    paint(new THREE.IcosahedronGeometry(0.7, 2).translate(0.55, 2.7, 0.2), [0.66, 0.9, 0.4]),
    paint(new THREE.IcosahedronGeometry(0.62, 2).translate(-0.5, 2.6, -0.25), [0.56, 0.82, 0.33]),
    paint(new THREE.CylinderGeometry(0.17, 0.22, 1.5, 8).translate(0, 0.75, 0), [0.55, 0.36, 0.24]),
  ])!;
}

function tuftGeometry() {
  const blades: THREE.BufferGeometry[] = [];
  for (const [a, tilt, h] of [
    [0, 0.25, 0.55],
    [2.1, 0.35, 0.42],
    [4.2, 0.3, 0.48],
  ]) {
    const b = new THREE.ConeGeometry(0.1, h, 6).translate(0, h / 2, 0).rotateZ(tilt).rotateY(a);
    blades.push(paint(b, [0.62, 0.9, 0.62]));
  }
  return mergeGeometries(blades)!;
}

function bushGeometry() {
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = new THREE.SphereGeometry(1, 8, 6).scale(0.26, 0.09, 0.6).translate(0, 0, 0.5).rotateX(-0.85).rotateY(a).translate(0, 0.25, 0);
    leaves.push(paint(leaf, i % 2 ? [0.42, 0.74, 0.32] : [0.5, 0.8, 0.36]));
  }
  leaves.push(paint(new THREE.SphereGeometry(1, 8, 6).scale(0.22, 0.08, 0.55).rotateX(-1.35).translate(0, 0.5, 0), [0.55, 0.84, 0.4]));
  return mergeGeometries(leaves)!;
}

function flowerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(paint(new THREE.SphereGeometry(1, 8, 4).scale(0.13, 0.05, 0.13).translate(Math.cos(a) * 0.12, 0.32, Math.sin(a) * 0.12), [1, 1, 1]));
  }
  parts.push(paint(new THREE.SphereGeometry(0.07, 8, 6).translate(0, 0.35, 0), [1, 0.86, 0.3]));
  parts.push(paint(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 4).translate(0, 0.16, 0), [0.4, 0.7, 0.35]));
  return mergeGeometries(parts)!;
}

/** A 2.7 m run of white picket fence: six rounded pickets on two rails, along +x. */
function fenceGeometry() {
  const white: RGB = [0.97, 0.96, 0.93];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push(paint(new THREE.CapsuleGeometry(0.13, 0.8, 3, 8).scale(1, 1, 0.42).translate(-1.12 + i * 0.45, 0.6, 0), white));
  }
  parts.push(paint(new THREE.BoxGeometry(2.7, 0.1, 0.07).translate(0, 0.38, -0.07), white));
  parts.push(paint(new THREE.BoxGeometry(2.7, 0.1, 0.07).translate(0, 0.8, -0.07), white));
  return mergeGeometries(parts)!;
}

const TILE = 480;

interface Tile {
  cx: number;
  cz: number;
  high: THREE.InstancedMesh | null;
  low: THREE.InstancedMesh | null;
}

export class Foliage {
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  private decor: THREE.Group;
  private lastKey = '';

  constructor(trees: TreeSpot[], decorByDistrict: DecorSet[], castShadow: boolean, seed: () => number) {
    const mat = clayMaterial({ vertexColors: true, roughness: 0.7 });
    const pineHigh = pineGeometry('high');
    const pineLow = pineGeometry('low');
    const puff = puffGeometry();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const TINTS = ['#ffffff', '#f2ffe6', '#e6f7d6', '#fbffe0', '#dff3d9'];

    // Spatial tiles.
    const buckets = new Map<string, TreeSpot[]>();
    for (const t of trees) {
      const key = `${Math.floor(t.x / TILE)},${Math.floor(t.z / TILE)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(t);
    }
    for (const [key, list] of buckets) {
      const [ix, iz] = key.split(',').map(Number);
      const pines = list.filter((t) => t.kind === 'pine');
      const puffs = list.filter((t) => t.kind === 'puff');
      const make = (geo: THREE.BufferGeometry, items: TreeSpot[]) => {
        if (!items.length) return null;
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        items.forEach((t, i) => {
          q.setFromAxisAngle(up, seed() * Math.PI * 2);
          m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.r, t.r * (0.9 + seed() * 0.25), t.r));
          mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, col.set(TINTS[Math.floor(seed() * TINTS.length)]));
        });
        mesh.computeBoundingSphere();
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return mesh;
      };
      const high = make(pineHigh, pines);
      const low = make(pineLow, pines);
      make(puff, puffs);
      if (high) high.visible = false;
      this.tiles.push({ cx: (ix + 0.5) * TILE, cz: (iz + 0.5) * TILE, high, low });
    }

    // Ground-level decor, one mesh per neighbourhood so off-screen ones are culled.
    this.decor = new THREE.Group();
    const geos = { tufts: tuftGeometry(), bushes: bushGeometry(), flowers: flowerGeometry(), fences: fenceGeometry() };
    const FLOWER = ['#ff7aa8', '#ff9fc2', '#ffd36b', '#ff6f6f', '#c99bff'];
    for (const set of decorByDistrict) {
      for (const kind of ['tufts', 'bushes', 'flowers', 'fences'] as const) {
        const spots = set[kind];
        if (!spots.length) continue;
        const mesh = new THREE.InstancedMesh(geos[kind], mat, spots.length);
        spots.forEach((s, i) => {
          q.setFromAxisAngle(up, s.yaw);
          m4.compose(new THREE.Vector3(s.x, 0.02, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
          mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, col.set(kind === 'flowers' ? FLOWER[i % FLOWER.length] : '#ffffff'));
        });
        mesh.computeBoundingSphere();
        mesh.castShadow = castShadow && (kind === 'fences' || kind === 'bushes');
        mesh.receiveShadow = true;
        this.decor.add(mesh);
      }
    }
    this.group.add(this.decor);
  }

  /** Detailed pines near the focus point, light ones elsewhere; ground decor only up close. */
  update(target: THREE.Vector3, distance: number) {
    const near = Math.max(240, distance * 0.6);
    const key = `${Math.round(target.x / 60)},${Math.round(target.z / 60)},${Math.round(near / 60)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      for (const t of this.tiles) {
        const close = Math.hypot(t.cx - target.x, t.cz - target.z) < near + TILE * 0.5 && distance < 1200;
        if (t.high) t.high.visible = close;
        if (t.low) t.low.visible = !close;
      }
    }
    this.decor.visible = distance < 1400;
  }
}
