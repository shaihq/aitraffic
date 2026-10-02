import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUT } from '../config';
import type { CenterPath, PathSample } from './CenterPath';
import { signalLight, type Network, type Signal } from './network';
import type { TrafficStateName } from '@/lib/types';
import { additiveMaterial, radialTexture } from '@/shaders/glow';
import { clayMaterial } from '@/shaders/clay';

// Road geometry in a soft miniature style: grey asphalt, pale sidewalks, white paint, concrete
// flyover decks on pillars. Dynamic parts: signal heads, roadworks cones, and a live-traffic-map
// style overlay that is visible from far away and fades out up close.

const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };

interface StripOptions {
  from?: number;
  to?: number;
  step?: number;
  y?: number;
}

function ribbon(path: CenterPath, o1: number, o2: number, opts: StripOptions = {}): THREE.BufferGeometry {
  const step = opts.step ?? 2;
  const from = opts.from ?? 0;
  const to = opts.to ?? path.length;
  const yOff = opts.y ?? 0;
  const pos: number[] = [];
  const idx: number[] = [];
  const count = Math.max(1, Math.ceil((to - from) / step));
  for (let i = 0; i <= count; i++) {
    const s = from + Math.min(to - from, i * step);
    path.sample(path.closed && i === count && to === path.length ? 0 : s, tmp);
    const h = Math.hypot(tmp.tx, tmp.tz) || 1;
    const lx = tmp.tz / h;
    const lz = -tmp.tx / h;
    pos.push(tmp.x + lx * o1, tmp.y + yOff, tmp.z + lz * o1, tmp.x + lx * o2, tmp.y + yOff, tmp.z + lz * o2);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  if (n.count && n.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function wall(path: CenterPath, o: number, h: number, from: number, to: number, step = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const count = Math.max(1, Math.ceil((to - from) / step));
  for (let i = 0; i <= count; i++) {
    path.sample(Math.min(to, from + i * step), tmp);
    const hh = Math.hypot(tmp.tx, tmp.tz) || 1;
    const x = tmp.x + (tmp.tz / hh) * o;
    const z = tmp.z + (-tmp.tx / hh) * o;
    pos.push(x, tmp.y - 1.1, z, x, tmp.y + h, z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Contiguous [from, to] arc-length runs where `pred(y)` holds. */
function runs(path: CenterPath, pred: (y: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let s = 0; s <= path.length; s += 2) {
    path.sample(s, tmp);
    const ok = pred(tmp.y);
    if (ok && start < 0) start = s;
    if (!ok && start >= 0) {
      out.push([start, s]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, path.length]);
  return out;
}

function dashes(path: CenterPath, offset: number, width: number, dash: number, gap: number, y: number, keep: (s: number) => boolean) {
  const parts: THREE.BufferGeometry[] = [];
  for (let s = 0; s + dash < path.length; s += dash + gap) {
    if (!keep(s)) continue;
    parts.push(ribbon(path, offset - width / 2, offset + width / 2, { from: s, to: s + dash, step: dash / 2, y }));
  }
  return parts;
}

export const STATE_COLORS: Record<TrafficStateName | 'NONE', string> = {
  'FREE FLOW': '#36c26b',
  BUSY: '#f3c331',
  HEAVY: '#f28a24',
  CONGESTED: '#e5462f',
  JAMMED: '#9b1c1c',
  CLEARING: '#4e9cf0',
  NONE: '#b9bec6',
};

export interface RoadMeshes {
  group: THREE.Group;
  update(time: number, closureActive: (district: number) => boolean, states: (TrafficStateName | 'NONE')[], overlayOpacity: number): void;
}

export function buildRoadMeshes(net: Network, castShadow: boolean): RoadMeshes {
  const group = new THREE.Group();
  const { laneWidth, median } = LAYOUT;

  const asphalt = new THREE.MeshStandardMaterial({ color: '#8d939c', roughness: 0.8, depthWrite: false });
  const deckMat = clayMaterial({ color: '#959ba3', roughness: 0.75, side: THREE.DoubleSide });
  const walk = new THREE.MeshStandardMaterial({ color: '#f4e3b4', roughness: 0.9, depthWrite: false });
  const paint = new THREE.MeshBasicMaterial({ color: '#fbfaf5', depthWrite: false, fog: true });
  const yellow = new THREE.MeshBasicMaterial({ color: '#f2c94c', depthWrite: false, fog: true });
  const concrete = clayMaterial({ color: '#ece6da', roughness: 0.8, side: THREE.DoubleSide });

  const ground: THREE.BufferGeometry[] = [];
  const decks: THREE.BufferGeometry[] = [];
  const sidewalks: THREE.BufferGeometry[] = [];
  const whites: THREE.BufferGeometry[] = [];
  const yellows: THREE.BufferGeometry[] = [];
  const barriers: THREE.BufferGeometry[] = [];
  const curbs: THREE.BufferGeometry[] = [];

  const isGround = (y: number) => y < 0.4;
  const yAt = (path: CenterPath, s: number) => path.sample(s, tmp).y;
  const nearJunction = (path: CenterPath, s: number, r: number) => {
    path.sample(s, tmp);
    if (!isGround(tmp.y)) return false;
    return net.signals.some((j) => (j.x - tmp.x) ** 2 + (j.z - tmp.z) ** 2 < r * r);
  };

  for (const road of net.roads) {
    const half = road.width / 2;
    const baseY = road.kind === 'loop' ? 0.06 : road.kind === 'ring' ? 0.05 : 0.04;
    for (const [from, to] of runs(road.path, isGround)) ground.push(ribbon(road.path, -half, half, { from, to, y: baseY }));
    for (const [from, to] of runs(road.path, (y) => !isGround(y))) {
      decks.push(ribbon(road.path, -half - 0.4, half + 0.4, { from: Math.max(0, from - 4), to: Math.min(road.path.length, to + 4), y: 0.05 }));
      barriers.push(wall(road.path, half + 0.4, 0.9, from, to), wall(road.path, -half - 0.4, 0.9, from, to));
    }

    // Paint follows the road (decks included) but stops at at-grade junctions.
    const my = baseY + 0.02;
    const keep = (s: number) => !nearJunction(road.path, s, Math.max(14, road.width / 2 + 9));
    yellows.push(...dashes(road.path, median / 2 - 0.15, 0.16, 6, 0.01, my, keep), ...dashes(road.path, -median / 2 + 0.15, 0.16, 6, 0.01, my, keep));
    for (const side of [1, -1]) {
      for (let l = 1; l < road.lanesPerDir; l++) whites.push(...dashes(road.path, side * (median / 2 + l * laneWidth), 0.16, 3, 5, my, keep));
      whites.push(...dashes(road.path, side * (half - 0.6), 0.16, 6, 0.01, my, keep));
      sidewalks.push(...dashes(road.path, side * (half + 1.7), 3.2, 6, 0.01, 0.16, (s) => keep(s) && isGround(yAt(road.path, s))));
      // Little kerbs so the sidewalk reads as a raised clay slab.
      for (let s = 0; s + 6 < road.path.length; s += 6) {
        if (keep(s) && isGround(yAt(road.path, s))) curbs.push(wall(road.path, side * (half + 0.08), 0.2, s, s + 6, 3));
      }
    }
  }

  // Zebra crossings across both roads at every junction.
  const zebra = (path: CenterPath, at: number, width: number) => {
    for (let o = -width / 2 + 0.8; o < width / 2 - 0.4; o += 1.1) {
      whites.push(ribbon(path, o, o + 0.6, { from: at - 1.5, to: at + 1.5, step: 3, y: 0.1 }));
    }
  };
  for (const sig of net.signals) {
    for (const [road, other] of [
      [sig.main, sig.cross],
      [sig.cross, sig.main],
    ]) {
      const sc = road.path.project(sig.x, sig.z);
      for (const side of [-1, 1]) {
        const at = sc + side * (other.width / 2 + 2.6);
        if (at > 2 && at < road.path.length - 2) zebra(road.path, at, road.width);
      }
    }
  }

  const mesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, order: number, receive = true) => {
    const m = new THREE.Mesh(mergeGeometries(geos)!, mat);
    m.renderOrder = order;
    m.receiveShadow = receive;
    group.add(m);
    return m;
  };
  mesh(ground, asphalt, -2);
  mesh(sidewalks, walk, -2);
  mesh(whites, paint, -1, false);
  mesh(yellows, yellow, -1, false);
  if (decks.length) mesh(decks, deckMat, 0).castShadow = castShadow;
  if (barriers.length) mesh(barriers, concrete, 0).castShadow = castShadow;
  if (curbs.length) mesh(curbs, concrete, 0);

  // Flyover pillars.
  const pillarMats: THREE.Matrix4[] = [];
  for (const road of net.roads) {
    for (let s = 6; s < road.path.length - 6; s += 24) {
      road.path.sample(s, tmp);
      if (tmp.y < 3) continue;
      pillarMats.push(new THREE.Matrix4().makeScale(3, tmp.y - 1, 2.2).setPosition(tmp.x, (tmp.y - 1) / 2, tmp.z));
    }
  }
  const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), concrete, pillarMats.length);
  pillarMats.forEach((m, i) => pillars.setMatrixAt(i, m));
  pillars.castShadow = castShadow;
  group.add(pillars);

  // Street lamps along neighbourhood loops, just switching on for the evening.
  const lampSpots: THREE.Matrix4[] = [];
  for (const d of net.districts) {
    const loop = d.roads[0];
    for (let s = 8; s < loop.path.length; s += 30) {
      if (nearJunction(loop.path, s, 18)) continue;
      loop.path.sample(s, tmp);
      const h = Math.hypot(tmp.tx, tmp.tz) || 1;
      const o = loop.width / 2 + 3.6;
      for (const side of [1, -1]) {
        const x = tmp.x + (tmp.tz / h) * o * side;
        const z = tmp.z + (-tmp.tx / h) * o * side;
        if ((x - d.street.x) ** 2 + (z - d.street.z) ** 2 < 20 * 20) continue;
        // Arm reaches toward the road.
        lampSpots.push(new THREE.Matrix4().makeRotationY(Math.atan2(-(tmp.tz / h) * side, (tmp.tx / h) * side)).setPosition(x, 0, z));
      }
    }
  }
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.13, 0.18, 7, 6).translate(0, 3.5, 0),
    new THREE.BoxGeometry(0.2, 0.2, 1.6).translate(0, 7, 0.7),
    new THREE.BoxGeometry(0.55, 0.22, 0.8).translate(0, 6.9, 1.4),
  ])!;
  const lamps = new THREE.InstancedMesh(lampGeo, clayMaterial({ color: '#4f5864', roughness: 0.5 }), lampSpots.length);
  const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 0.7).translate(0, 6.76, 1.4), new THREE.MeshBasicMaterial({ color: '#ffd29a', toneMapped: false }), lampSpots.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(0, 0.16, 2.2), additiveMaterial(radialTexture(128, 1.6), '#ffb46b', 0.12), lampSpots.length);
  pools.renderOrder = 1;
  lampSpots.forEach((m, i) => {
    lamps.setMatrixAt(i, m);
    bulbs.setMatrixAt(i, m);
    pools.setMatrixAt(i, m);
  });
  lamps.castShadow = castShadow;
  group.add(lamps, bulbs, pools);

  // Signals: a pole at each corner; heads show the phase colour for that approach.
  interface Head {
    signal: Signal;
    phase: 0 | 1;
  }
  const heads: Head[] = [];
  const headMats: THREE.Matrix4[] = [];
  for (const sig of net.signals) {
    const nx = sig.tz;
    const nz = -sig.tx;
    for (const [sa, sb, phase] of [
      [1, 1, 0],
      [-1, -1, 0],
      [1, -1, 1],
      [-1, 1, 1],
    ] as [number, number, 0 | 1][]) {
      const along = sb * (sig.halfCross + 2.2);
      const across = sa * (sig.halfMain + 2.2);
      heads.push({ signal: sig, phase });
      headMats.push(new THREE.Matrix4().makeTranslation(sig.x + sig.tx * along + nx * across, 0, sig.z + sig.tz * along + nz * across));
    }
  }
  const poleMat = clayMaterial({ color: '#3d4550', roughness: 0.5 });
  const sigPoles = new THREE.InstancedMesh(
    mergeGeometries([new THREE.CylinderGeometry(0.14, 0.14, 4.6, 6).translate(0, 2.3, 0), new THREE.BoxGeometry(0.7, 1.7, 0.6).translate(0, 4.9, 0)])!,
    poleMat,
    headMats.length,
  );
  const sigHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8).translate(0, 5.3, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), headMats.length);
  headMats.forEach((m, i) => {
    sigPoles.setMatrixAt(i, m);
    sigHeads.setMatrixAt(i, m);
  });
  sigHeads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(headMats.length * 3), 3);
  sigPoles.castShadow = castShadow;
  group.add(sigPoles, sigHeads);

  // Roadworks: cones + beacons on the curb lane while a corridor is congested.
  const coneSpots: { district: number; x: number; z: number }[] = [];
  for (const d of net.districts) for (const p of d.closureMarkers) coneSpots.push({ district: d.index, ...p });
  const cones = new THREE.InstancedMesh(
    mergeGeometries([new THREE.ConeGeometry(0.45, 1.2, 10).translate(0, 0.6, 0), new THREE.CylinderGeometry(0.6, 0.6, 0.12, 10).translate(0, 0.06, 0)])!,
    clayMaterial({ color: '#ff7a1a', roughness: 0.5 }),
    coneSpots.length,
  );
  cones.castShadow = castShadow;
  const beacons = new THREE.InstancedMesh(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(0, 0.2, 0), additiveMaterial(radialTexture(64, 2), '#ffb020', 0.6), coneSpots.length);
  beacons.renderOrder = 1;
  group.add(cones, beacons);

  // Traffic overlay: one coloured ribbon per neighbourhood loop, like a live-traffic map layer.
  const overlayMats = net.districts.map(() => new THREE.MeshBasicMaterial({ color: STATE_COLORS.NONE, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  net.districts.forEach((d, i) => {
    const loop = d.roads[0];
    const m = new THREE.Mesh(ribbon(loop.path, -loop.width / 2 + 1, loop.width / 2 - 1, { y: 0.35, step: 3 }), overlayMats[i]);
    m.renderOrder = 3;
    group.add(m);
  });

  const colors = { green: new THREE.Color('#2fd36b'), amber: new THREE.Color('#ffb020'), red: new THREE.Color('#ff3b2f') };
  const m4 = new THREE.Matrix4();
  let lastKey = '';

  return {
    group,
    update(time, closureActive, states, overlayOpacity) {
      heads.forEach((h, i) => {
        const light = signalLight(h.signal, h.phase);
        sigHeads.setColorAt(i, light === 'green' ? colors.green : light === 'amber' ? colors.amber : colors.red);
      });
      sigHeads.instanceColor!.needsUpdate = true;

      const key = net.districts.map((d) => (closureActive(d.index) ? 1 : 0)).join('');
      const blink = Math.sin(time * 6) > 0 ? 1 : 0.1;
      coneSpots.forEach((c, i) => {
        const on = key[c.district] === '1';
        if (key !== lastKey) {
          const sc = on ? 1 : 0;
          m4.makeScale(sc, sc, sc).setPosition(c.x, 0.06, c.z);
          cones.setMatrixAt(i, m4);
        }
        const b = on && i % 4 === 0 ? blink : 0;
        m4.makeScale(b, 1, b).setPosition(c.x, 0.06, c.z);
        beacons.setMatrixAt(i, m4);
      });
      if (key !== lastKey) cones.instanceMatrix.needsUpdate = true;
      beacons.instanceMatrix.needsUpdate = true;
      lastKey = key;

      overlayMats.forEach((mat, i) => {
        mat.color.set(STATE_COLORS[states[i] ?? 'NONE']);
        mat.opacity = overlayOpacity * (states[i] === 'NONE' ? 0.35 : 0.85);
        mat.visible = overlayOpacity > 0.01;
      });
    },
  };
}
