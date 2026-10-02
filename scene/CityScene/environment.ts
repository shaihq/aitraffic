import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Network } from '../RoadNetwork/network';
import type { PathSample } from '../RoadNetwork/CenterPath';
import type { QualityProfile } from '../config';
import { buildingMaterial } from '@/shaders/buildings';
import { clayMaterial } from '@/shaders/clay';
import { Foliage, type DecorSet, type DecorSpot, type TreeSpot } from '../Nature/Foliage';
import { mulberry32, range, pick, type Rng } from '@/lib/random';
import { AMBIENT_PLACES, LANDMARKS, project, type LandmarkDef } from '@/lib/bangalore';

// The miniature city around the roads: ground, lakes, parks, Bangalore landmarks, pastel low-rise
// buildings with rooftop water tanks and shop awnings, glassy tech parks, and lots of trees.

const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };
type RGB = [number, number, number];

class Grid {
  readonly cell = 4;
  readonly size: number;
  readonly data: Uint8Array;
  constructor(private cx: number, private cz: number, private half: number) {
    this.size = Math.ceil((half * 2) / this.cell);
    this.data = new Uint8Array(this.size * this.size);
  }
  private idx(x: number, z: number) {
    const i = Math.floor((x - this.cx + this.half) / this.cell);
    const j = Math.floor((z - this.cz + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    return j * this.size + i;
  }
  stamp(x: number, z: number, r: number) {
    for (let dx = -r; dx <= r; dx += this.cell) {
      for (let dz = -r; dz <= r; dz += this.cell) {
        if (dx * dx + dz * dz > r * r) continue;
        const k = this.idx(x + dx, z + dz);
        if (k >= 0) this.data[k] = 1;
      }
    }
  }
  blocked(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 || this.data[k] === 1;
  }
}

function colored(g: THREE.BufferGeometry, c: RGB) {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat.attributes.uv) flat.deleteAttribute('uv');
  const arr = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set(c, i);
  flat.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return flat;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, r = 0.4) =>
  colored(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)).translate(x, y, z), c);
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, c: RGB, seg = 16) => colored(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), c);
const dome = (r: number, x: number, y: number, z: number, c: RGB) => colored(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y, z), c);
const cone = (r: number, h: number, x: number, y: number, z: number, c: RGB, seg = 16) => colored(new THREE.ConeGeometry(r, h, seg).translate(x, y, z), c);

const CREAM: RGB = [0.96, 0.91, 0.8];
const STONE: RGB = [0.89, 0.83, 0.7];

function landmarkGeometry(kind: LandmarkDef['kind']): THREE.BufferGeometry[] {
  switch (kind) {
    case 'vidhana-soudha': {
      const parts = [
        box(78, 3, 36, 0, 1.5, 0, STONE, 0.3),
        box(74, 12, 30, 0, 9, 0, CREAM),
        box(34, 21, 26, 0, 13.5, 0, CREAM),
        cyl(7.4, 7.4, 3, 0, 25.5, 0, STONE, 24),
        dome(7.6, 0, 27, 0, [0.95, 0.9, 0.78]),
        cyl(0.5, 0.5, 4, 0, 36, 0, [0.9, 0.75, 0.35], 8),
        box(26, 2, 7, 0, 17, 16, STONE, 0.3),
        box(28, 3, 7, 0, 1.5, 20, STONE, 0.2),
      ];
      for (let i = 0; i < 8; i++) parts.push(cyl(0.75, 0.85, 13, -10.5 + i * 3, 9.5, 16.5, [0.98, 0.95, 0.88], 10));
      for (const [x, z] of [[-33, -12], [33, -12], [-33, 12], [33, 12]]) parts.push(dome(3, x, 15, z, [0.95, 0.9, 0.78]));
      return parts;
    }
    case 'palace': {
      const parts = [box(48, 14, 22, 0, 7, 0, [0.84, 0.74, 0.58]), box(10, 24, 10, 0, 12, 0, [0.84, 0.74, 0.58]), cone(7.5, 7, 0, 27.5, 0, [0.45, 0.35, 0.3], 4)];
      for (const [x, z] of [[-24, -11], [24, -11], [-24, 11], [24, 11]]) {
        parts.push(cyl(4, 4, 20, x, 10, z, [0.82, 0.72, 0.56], 14), cone(4.8, 7, x, 23.5, z, [0.45, 0.35, 0.3], 14));
      }
      return parts;
    }
    case 'glasshouse': {
      const glass: RGB = [0.72, 0.88, 0.95];
      return [
        box(40, 1, 18, 0, 0.5, 0, [0.97, 0.97, 0.97], 0.2),
        colored(new THREE.CylinderGeometry(7, 7, 34, 20, 1).rotateZ(Math.PI / 2).translate(0, 1, 0), glass),
        colored(new THREE.SphereGeometry(9.5, 20, 12).translate(0, 1, 0), glass),
        cyl(0.4, 0.4, 3, 0, 11.5, 0, [0.95, 0.95, 0.95], 6),
      ];
    }
    case 'stadium': {
      const profile = [new THREE.Vector2(22, 0.3), new THREE.Vector2(24, 2), new THREE.Vector2(32, 11), new THREE.Vector2(35, 12.5), new THREE.Vector2(35, 0)];
      const parts = [
        colored(new THREE.LatheGeometry(profile, 40), [0.9, 0.9, 0.88]),
        colored(new THREE.CircleGeometry(22.5, 40).rotateX(-Math.PI / 2).translate(0, 0.25, 0), [0.45, 0.76, 0.35]),
        colored(new THREE.PlaneGeometry(3, 11).rotateX(-Math.PI / 2).translate(0, 0.3, 0), [0.85, 0.76, 0.56]),
      ];
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        parts.push(cyl(0.5, 0.6, 32, Math.cos(a) * 37, 16, Math.sin(a) * 37, [0.6, 0.62, 0.66], 6), box(5, 2.5, 1, Math.cos(a) * 37, 32.5, Math.sin(a) * 37, [0.95, 0.95, 0.9], 0.2));
      }
      return parts;
    }
    case 'tower':
      return [
        box(38, 10, 30, 0, 5, 0, CREAM),
        box(16, 72, 16, 0, 36, 0, [0.58, 0.74, 0.86], 0.6),
        cone(9.5, 11, 0, 77.5, 0, [0.85, 0.88, 0.9], 4),
        cyl(0.4, 0.4, 10, 0, 87, 0, [0.85, 0.85, 0.85], 6),
      ];
    default:
      return [];
  }
}

function blobShape(rng: Rng, r: number) {
  const shape = new THREE.Shape();
  const phases = [rng() * 6, rng() * 6, rng() * 6];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.12 * Math.sin(a * 2 + phases[0]) + 0.08 * Math.sin(a * 3 + phases[1]) + 0.05 * Math.sin(a * 5 + phases[2]);
    const x = Math.cos(a) * r * k;
    const y = Math.sin(a) * r * k * 0.8;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

export interface WorldLabel {
  text: string;
  kind: 'place' | 'landmark';
  x: number;
  y: number;
  z: number;
}

export function buildEnvironment(net: Network, profile: QualityProfile, castShadow: boolean) {
  const group = new THREE.Group();
  const rng = mulberry32(20261003);
  const { cx, cz, radius } = net.bounds;
  const worldR = radius + 700;
  const labels: WorldLabel[] = [];

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(worldR + 3000, 96).rotateX(-Math.PI / 2).translate(cx, 0, cz),
    new THREE.MeshStandardMaterial({ color: '#7fd0a0', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
  );
  ground.receiveShadow = true;
  ground.renderOrder = -4;
  group.add(ground);

  // Occupancy: tight road footprint (for trees), wide road margins (for buildings), objects.
  const half = worldR + 50;
  const roadsTight = new Grid(cx, cz, half);
  const roadsWide = new Grid(cx, cz, half);
  const objects = new Grid(cx, cz, half);
  for (const road of net.roads) {
    for (let s = 0; s <= road.path.length; s += 3) {
      road.path.sample(s, tmp);
      roadsTight.stamp(tmp.x, tmp.z, road.width / 2 + 4.5);
      roadsWide.stamp(tmp.x, tmp.z, road.width / 2 + 6.5);
    }
  }
  for (const line of net.metro) {
    for (let s = 0; s <= line.path.length; s += 3) {
      line.path.sample(s, tmp);
      roadsWide.stamp(tmp.x, tmp.z, 9);
      objects.stamp(tmp.x, tmp.z, 4);
    }
  }
  for (const sig of net.signals) roadsTight.stamp(sig.x, sig.z, sig.halfMain + 6);
  // Keep each street-level camera's view clear.
  for (const d of net.districts) {
    roadsTight.stamp(d.street.x, d.street.z, 16);
    roadsWide.stamp(d.street.x, d.street.z, 24);
  }

  // Lakes and parks (flat), then landmark buildings.
  const water = new THREE.MeshStandardMaterial({ color: '#5cc2ec', roughness: 0.12, metalness: 0.05, depthWrite: false });
  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, depthWrite: false });
  const flats: THREE.BufferGeometry[] = [];
  const waters: THREE.BufferGeometry[] = [];
  const landmarkGeos: THREE.BufferGeometry[] = [];
  const parks: { x: number; z: number; r: number }[] = [];
  const findSpot = (x: number, z: number, r: number) => {
    for (let ring = 0; ring < 14; ring++) {
      for (let k = 0; k < Math.max(1, ring * 6); k++) {
        const a = (k / Math.max(1, ring * 6)) * Math.PI * 2;
        const px = x + Math.cos(a) * ring * 12;
        const pz = z + Math.sin(a) * ring * 12;
        let ok = true;
        for (let t = 0; t < 12 && ok; t++) {
          const b = (t / 12) * Math.PI * 2;
          if (roadsWide.blocked(px + Math.cos(b) * r, pz + Math.sin(b) * r) || objects.blocked(px + Math.cos(b) * r, pz + Math.sin(b) * r)) ok = false;
        }
        if (ok && !roadsWide.blocked(px, pz) && !objects.blocked(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  };

  for (const lm of LANDMARKS) {
    const p = project(lm.lat, lm.lon);
    const lrng = mulberry32(lm.id.length * 97 + Math.round(lm.size));
    if (lm.kind === 'lake' || lm.kind === 'park') {
      const shape = blobShape(lrng, lm.size);
      const rot = lrng() * Math.PI;
      if (lm.kind === 'lake') {
        flats.push(colored(new THREE.ShapeGeometry(blobShape(lrng, lm.size + 5)).rotateX(-Math.PI / 2).rotateY(rot).translate(p.x, 0.015, p.z), [0.97, 0.89, 0.7]));
        waters.push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).rotateY(rot).translate(p.x, 0.03, p.z));
        objects.stamp(p.x, p.z, lm.size * 0.85);
      } else {
        flats.push(colored(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).rotateY(rot).translate(p.x, 0.02, p.z), [0.66, 0.88, 0.48]));
        parks.push({ x: p.x, z: p.z, r: lm.size * 0.8 });
      }
      labels.push({ text: lm.name, kind: 'landmark', x: p.x, y: 6, z: p.z });
      continue;
    }
    const spot = findSpot(p.x, p.z, lm.size);
    if (!spot) continue;
    const yaw = Math.atan2(net.bounds.cx - spot.x, net.bounds.cz - spot.z);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(spot.x, 0, spot.z);
    for (const g of landmarkGeometry(lm.kind)) landmarkGeos.push(g.applyMatrix4(m));
    objects.stamp(spot.x, spot.z, lm.size);
    labels.push({ text: lm.name, kind: 'landmark', x: spot.x, y: lm.kind === 'tower' ? 95 : 40, z: spot.z });
  }
  for (const p of parks) objects.stamp(p.x, p.z, p.r * 0.9);

  if (flats.length) {
    const m = new THREE.Mesh(mergeGeometries(flats)!, flatMat);
    m.renderOrder = -3;
    m.receiveShadow = true;
    group.add(m);
  }
  if (waters.length) {
    const m = new THREE.Mesh(mergeGeometries(waters)!, water);
    m.renderOrder = -2.5; // after the sandy shore, before roads
    group.add(m);
  }
  if (landmarkGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(landmarkGeos)!, clayMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
    m.castShadow = castShadow;
    m.receiveShadow = true;
    group.add(m);
  }

  for (const p of AMBIENT_PLACES) {
    const q = project(p.lat, p.lon);
    if (net.districts.some((d) => (d.cx - q.x) ** 2 + (d.cz - q.z) ** 2 < 170 * 170)) continue;
    labels.push({ text: p.name, kind: 'place', x: q.x, y: 10, z: q.z });
  }

  // Buildings.
  type B = { x: number; z: number; w: number; d: number; h: number; rot: number; glass: boolean };
  const buildings: B[] = [];
  const techCentres = ['whitefield', 'ecity'].map((id) => net.districts.find((d) => d.placeId === id)).filter(Boolean) as Network['districts'];
  const manyata = project(13.0475, 77.6215);
  const cbd = project(12.9716, 77.596);
  const step = 24;
  for (let x = cx - worldR; x <= cx + worldR; x += step) {
    for (let z = cz - worldR; z <= cz + worldR; z += step) {
      const px = x + range(rng, -5, 5);
      const pz = z + range(rng, -5, 5);
      if ((px - cx) ** 2 + (pz - cz) ** 2 > worldR * worldR) continue;
      let nearest = Infinity;
      for (const d of net.districts) nearest = Math.min(nearest, Math.hypot(d.cx - px, d.cz - pz));
      const tech = techCentres.some((d) => Math.hypot(d.cx - px, d.cz - pz) < 230) || Math.hypot(manyata.x - px, manyata.z - pz) < 150 || Math.hypot(cbd.x - px, cbd.z - pz) < 120;
      const density = (tech ? 0.62 : nearest < 280 ? 0.72 : nearest < 520 ? 0.45 : 0.22) * profile.buildingDensity;
      if (rng() > density) continue;
      const glass = tech && rng() < 0.7;
      const h = glass ? range(rng, 22, 58) : nearest < 280 ? range(rng, 6, 17) * (rng() < 0.1 ? 1.8 : 1) : range(rng, 5, 13);
      const w = glass ? range(rng, 16, 28) : range(rng, 9, 17);
      const d = glass ? range(rng, 14, 24) : range(rng, 9, 16);
      // Align to the nearest district's grid for tidy blocks.
      let rot = rng() * 0.2;
      let best = Infinity;
      for (const dd of net.districts) {
        const dist = Math.hypot(dd.cx - px, dd.cz - pz);
        if (dist < best) {
          best = dist;
          rot = Math.atan2(dd.wx, dd.wz) + range(rng, -0.05, 0.05);
        }
      }
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      let ok = true;
      for (const [ax, az] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
        const qx = px + ax * c + az * s;
        const qz = pz - ax * s + az * c;
        if (roadsWide.blocked(qx, qz) || objects.blocked(qx, qz)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      buildings.push({ x: px, z: pz, w, d, h, rot, glass });
      objects.stamp(px, pz, Math.max(w, d) * 0.55);
    }
  }

  // Clay-toy houses: bright pastels, some with little gabled roofs, the rest flat with tanks.
  const PASTELS = ['#fff3e0', '#ffe0c2', '#ffd6d6', '#d8f0ff', '#dcf5e2', '#fff1b8', '#f1ddff', '#ffe8d6', '#cfe6ff', '#fde2e4'];
  const GLASSY = ['#a9d6ec', '#93c8e2', '#bfe0f0'];
  const ROOFS = ['#e0704f', '#d8664a', '#e8845f', '#cc5a45', '#e0704f', '#d97a52', '#f0a040', '#5b8fd8'];
  const bGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.08).translate(0, 0.5, 0);
  const seeds = new Float32Array(buildings.length);
  const glassAttr = new Float32Array(buildings.length);
  const bMesh = new THREE.InstancedMesh(bGeo, buildingMaterial(), buildings.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const roofed = buildings.map((b) => !b.glass && b.h < 11 && rng() < 0.45);
  buildings.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    bMesh.setMatrixAt(i, m4);
    bMesh.setColorAt(i, col.set(b.glass ? pick(rng, GLASSY) : pick(rng, PASTELS)));
    seeds[i] = rng();
    glassAttr[i] = b.glass ? 1 : 0;
  });
  bGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  bGeo.setAttribute('aGlass', new THREE.InstancedBufferAttribute(glassAttr, 1));
  bMesh.castShadow = castShadow;
  bMesh.receiveShadow = true;
  group.add(bMesh);

  const roofShape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }).translate(0, 0, -0.5);
  const roofList = buildings.filter((_, i) => roofed[i]);
  const roofMesh = new THREE.InstancedMesh(roofGeo, clayMaterial({ roughness: 0.6 }), roofList.length);
  roofList.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m4.compose(new THREE.Vector3(b.x, b.h - 0.05, b.z), q, new THREE.Vector3(b.w * 1.08, Math.min(b.w, b.d) * 0.45, b.d * 1.08));
    roofMesh.setMatrixAt(i, m4);
    roofMesh.setColorAt(i, col.set(pick(rng, ROOFS)));
  });
  roofMesh.castShadow = castShadow;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);

  // Rooftop black water tanks (a Bangalore signature) and striped shop awnings.
  const tanks: THREE.Matrix4[] = [];
  const awnings: { m: THREE.Matrix4; color: string }[] = [];
  const AWNING = ['#e84a3f', '#2f9e6a', '#2f73c9', '#f29a2e', '#8e5bd1', '#e85d8f'];
  buildings.forEach((b, bi) => {
    if (b.glass) return;
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    if (!roofed[bi] && rng() < 0.6) {
      const ox = range(rng, -b.w * 0.3, b.w * 0.3);
      const oz = range(rng, -b.d * 0.3, b.d * 0.3);
      tanks.push(new THREE.Matrix4().makeTranslation(b.x + ox * c + oz * s, b.h, b.z - ox * s + oz * c));
    }
    if (b.h < 20 && rng() < 0.5) {
      const face = Math.floor(rng() * 4);
      const yaw = b.rot + (face * Math.PI) / 2;
      const depth = face % 2 === 0 ? b.d : b.w;
      const width = face % 2 === 0 ? b.w : b.d;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const m = new THREE.Matrix4()
        .makeTranslation(b.x + fx * (depth / 2 + 0.9), 3.1, b.z + fz * (depth / 2 + 0.9))
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .multiply(new THREE.Matrix4().makeRotationX(0.38))
        .multiply(new THREE.Matrix4().makeScale(width * 0.75, 0.2, 2.0));
      awnings.push({ m, color: pick(rng, AWNING) });
    }
  });
  const tankMesh = new THREE.InstancedMesh(
    mergeGeometries([new THREE.CylinderGeometry(0.85, 0.85, 1.4, 14).translate(0, 0.7, 0), new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10).translate(0, 1.5, 0)])!,
    clayMaterial({ color: '#2e2f33', roughness: 0.45 }),
    tanks.length,
  );
  tanks.forEach((m, i) => tankMesh.setMatrixAt(i, m));
  tankMesh.castShadow = castShadow;
  group.add(tankMesh);

  const awningMat = clayMaterial({ roughness: 0.65 });
  const clayCompile = awningMat.onBeforeCompile;
  awningMat.onBeforeCompile = (shader, renderer) => {
    clayCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAwnU;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAwnU = uv.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAwnU;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.98, 0.97, 0.94), diffuseColor.rgb, step(0.5, fract(vAwnU * 7.0)));');
  };
  const awningMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.12), awningMat, awnings.length);
  awnings.forEach((a, i) => {
    awningMesh.setMatrixAt(i, a.m);
    awningMesh.setColorAt(i, col.set(a.color));
  });
  awningMesh.castShadow = castShadow;
  group.add(awningMesh);

  // Trees: tiered pines and puffy round trees — dense in parks, lining roads, scattered everywhere.
  const trees: TreeSpot[] = [];
  const budget = profile.treeBudget;
  const treeOk = (x: number, z: number) => !roadsTight.blocked(x, z) && !objects.blocked(x, z);
  const nearEye = (x: number, z: number) => net.districts.some((d) => (d.street.x - x) ** 2 + (d.street.z - z) ** 2 < 16 * 16);
  for (const p of parks) {
    for (let x = -p.r; x <= p.r; x += 8) {
      for (let z = -p.r * 0.8; z <= p.r * 0.8; z += 8) {
        if (x * x + z * z > p.r * p.r || rng() < 0.25) continue;
        const tx = p.x + x + range(rng, -3, 3);
        const tz = p.z + z + range(rng, -3, 3);
        if (!roadsTight.blocked(tx, tz)) trees.push({ x: tx, z: tz, r: range(rng, 3.2, 4.8), kind: rng() < 0.6 ? 'pine' : 'puff' });
      }
    }
  }
  for (const road of net.roads) {
    for (let s = 5; s < road.path.length; s += road.kind === 'loop' ? 11 : 15) {
      road.path.sample(s, tmp);
      if (tmp.y > 0.5) continue;
      const h = Math.hypot(tmp.tx, tmp.tz) || 1;
      for (const side of [1, -1]) {
        if (rng() < 0.2) continue;
        const o = side * (road.width / 2 + 7.4);
        const tx = tmp.x + (tmp.tz / h) * o;
        const tz = tmp.z + (-tmp.tx / h) * o;
        if (net.signals.some((sg) => (sg.x - tx) ** 2 + (sg.z - tz) ** 2 < 22 * 22)) continue;
        if (objects.blocked(tx, tz) || nearEye(tx, tz)) continue;
        trees.push({ x: tx, z: tz, r: range(rng, 2.6, 3.6), kind: rng() < 0.5 ? 'puff' : 'pine' });
      }
    }
  }
  let attempts = 0;
  while (trees.length < budget && attempts < budget * 6) {
    attempts++;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * worldR;
    const tx = cx + Math.cos(a) * r;
    const tz = cz + Math.sin(a) * r;
    if (!treeOk(tx, tz)) continue;
    const clump = 1 + Math.floor(rng() * 4);
    for (let k = 0; k < clump; k++) {
      const x2 = tx + range(rng, -9, 9);
      const z2 = tz + range(rng, -9, 9);
      if (treeOk(x2, z2)) trees.push({ x: x2, z: z2, r: range(rng, 2.8, 4.6), kind: rng() < 0.65 ? 'pine' : 'puff' });
    }
  }
  trees.length = Math.min(trees.length, Math.round(budget * 1.15));

  // Ground decor around each neighbourhood: picket fences, leafy plants, grass tufts, flowers.
  const decor: DecorSet[] = net.districts.map((d) => {
    const set: DecorSet = { tufts: [], bushes: [], flowers: [], fences: [] };
    const loop = d.roads[0];
    const nearJunction = (x: number, z: number, r: number) => net.signals.some((sg) => (sg.x - x) ** 2 + (sg.z - z) ** 2 < r * r);
    let run = 0;
    let gap = Math.floor(rng() * 5);
    for (let s = 0; s < loop.path.length; s += 2.7) {
      loop.path.sample(s + 1.35, tmp);
      const h = Math.hypot(tmp.tx, tmp.tz) || 1;
      const nx = tmp.tz / h;
      const nz = -tmp.tx / h;
      if (gap > 0) {
        gap--;
      } else {
        for (const side of [1, -1]) {
          const o = side * (loop.width / 2 + 3.7);
          const x = tmp.x + nx * o;
          const z = tmp.z + nz * o;
          if (nearJunction(x, z, 24) || nearEye(x, z) || objects.blocked(x, z)) continue;
          set.fences.push({ x, z, yaw: Math.atan2(-tmp.tz, tmp.tx), s: 1 });
        }
        if (++run > 4 + rng() * 6) {
          run = 0;
          gap = 2 + Math.floor(rng() * 6);
        }
      }
      for (const side of [1, -1]) {
        if (rng() > 0.35) continue;
        const o = side * (loop.width / 2 + 4.9 + rng() * 1.2);
        const x = tmp.x + nx * o;
        const z = tmp.z + nz * o;
        if (nearJunction(x, z, 22) || nearEye(x, z) || objects.blocked(x, z)) continue;
        set.bushes.push({ x, z, yaw: rng() * Math.PI * 2, s: range(rng, 0.9, 1.5) });
      }
    }
    const scatter = (n: number, into: DecorSpot[], scale: [number, number], cluster: number) => {
      let tries = 0;
      while (into.length < n && tries < n * 8) {
        tries++;
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * 230;
        const x0 = d.cx + Math.cos(a) * rr;
        const z0 = d.cz + Math.sin(a) * rr;
        for (let k = 0; k < cluster; k++) {
          const x = x0 + range(rng, -1.6, 1.6) * (k ? 1 : 0);
          const z = z0 + range(rng, -1.6, 1.6) * (k ? 1 : 0);
          if (roadsTight.blocked(x, z) || objects.blocked(x, z)) continue;
          into.push({ x, z, yaw: rng() * Math.PI * 2, s: range(rng, scale[0], scale[1]) });
        }
      }
    };
    scatter(profile.mobile ? 140 : 420, set.tufts, [0.8, 1.5], 1);
    scatter(profile.mobile ? 60 : 150, set.flowers, [1.1, 1.7], 4);
    return set;
  });

  const foliage = new Foliage(trees, decor, castShadow, rng);
  group.add(foliage.group);

  return { group, labels, foliage };
}

/** Late-afternoon pastel sky: soft blue overhead, peach and amber toward the western sun. */
export function buildSky(sunDir: THREE.Vector3) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: sunDir.clone().normalize() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun;
        void main(){
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -0.2, 1.0);
          float towardSun = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          vec3 top = vec3(0.45, 0.66, 0.9);
          vec3 mid = mix(vec3(0.74, 0.8, 0.92), vec3(0.98, 0.82, 0.7), towardSun);
          vec3 horizon = mix(vec3(0.93, 0.88, 0.84), vec3(1.0, 0.8, 0.6), towardSun);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, top, smoothstep(0.15, 0.7, h));
          float sun = max(dot(dir, uSun), 0.0);
          c += vec3(1.0, 0.62, 0.3) * pow(sun, 18.0) * 0.55 + vec3(1.0, 0.9, 0.7) * pow(sun, 900.0) * 1.5;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

/** Game-style map pin: a chunky dark plate with a rim and a solid lip; orange when selected. */
export const LABEL_FONT = '"Fredoka Variable", "Fredoka", ui-rounded, ui-sans-serif, system-ui, sans-serif';

export class LabelSprite {
  readonly sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private last = '';
  private args: [string, string, boolean, boolean] = ['', '#b9bec6', false, false];
  readonly aspect: number;
  constructor(private title: string, readonly kind: 'district' | 'place' | 'landmark') {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = kind === 'district' ? 280 : 120;
    this.aspect = this.canvas.height / this.canvas.width;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    this.sprite.renderOrder = kind === 'district' ? 12 : 11;
    this.sprite.center.set(0.5, 0);
    this.draw('', '#b9bec6', false, false);
  }

  /** Re-render with the last arguments (e.g. once the game font has loaded). */
  redraw() {
    this.last = '';
    this.draw(...this.args);
  }

  draw(sub: string, dot: string, selected: boolean, dim: boolean) {
    this.args = [sub, dot, selected, dim];
    const key = `${sub}|${dot}|${selected}|${dim}`;
    if (key === this.last) return;
    this.last = key;
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.kind === 'district') {
      ctx.font = `600 66px ${LABEL_FONT}`;
      const titleW = ctx.measureText(this.title).width;
      ctx.font = `500 40px ${LABEL_FONT}`;
      const subW = ctx.measureText(sub).width + 40;
      const tw = Math.max(titleW, subW) + 110;
      const x0 = (W - tw) / 2;
      const y0 = 12;
      const bh = 180;
      ctx.globalAlpha = dim ? 0.6 : 1;
      const fill = selected ? ['#ffd25c', '#ff9a2e'] : ['#3b3256', '#2a2340'];
      const rim = selected ? '#ffe7a3' : '#5d5180';
      const lip = selected ? '#b8561a' : '#17121f';
      // Lip (the 3D underside), then the plate, then its rim.
      ctx.fillStyle = lip;
      ctx.beginPath();
      ctx.roundRect(x0, y0 + 12, tw, bh, 44);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W / 2 - 22, y0 + bh + 4);
      ctx.lineTo(W / 2, y0 + bh + 46);
      ctx.lineTo(W / 2 + 22, y0 + bh + 4);
      ctx.fill();
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      grad.addColorStop(0, fill[0]);
      grad.addColorStop(1, fill[1]);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x0, y0, tw, bh, 44);
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.roundRect(x0 + 3.5, y0 + 3.5, tw - 7, bh - 7, 41);
      ctx.stroke();
      ctx.font = `600 66px ${LABEL_FONT}`;
      ctx.fillStyle = selected ? '#3a2410' : '#fff4e3';
      ctx.fillText(this.title, W / 2, y0 + 70);
      ctx.font = `500 40px ${LABEL_FONT}`;
      ctx.fillStyle = selected ? '#6b3a12' : '#c9bedf';
      ctx.fillText(sub, W / 2 + 20, y0 + 132);
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(W / 2 - (subW - 40) / 2 - 6, y0 + 132, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = `600 52px ${LABEL_FONT}`;
      ctx.lineWidth = 12;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(42,35,64,0.85)';
      ctx.fillStyle = this.kind === 'landmark' ? '#ffd88a' : '#fff4e3';
      ctx.strokeText(this.title, W / 2, H / 2);
      ctx.fillText(this.title, W / 2, H / 2);
    }
    this.texture.needsUpdate = true;
  }
}
