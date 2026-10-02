import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { signalLight, type Network, type Road, type Signal } from '../RoadNetwork/network';
import type { PathSample } from '../RoadNetwork/CenterPath';
import { mulberry32, pick } from '@/lib/random';
import { clayMaterial } from '@/shaders/clay';

// Chibi townsfolk on the neighbourhood sidewalks. They walk with a proper gait (legs and arms
// swing with stride, body bobs), ease in and out of motion, keep a little personal space, wait
// at junctions until cross traffic has a red light before using the zebra, and some just stand
// around chatting. Decoration only — they do not represent users or requests.

const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };

interface Crossing {
  from: number;
  to: number;
  signal: Signal;
  /** Phase of the road being crossed; walkers go when that phase is red. */
  phase: 0 | 1;
}

interface Walker {
  road: Road;
  crossings: Crossing[];
  side: 1 | -1;
  s: number;
  dir: 1 | -1;
  pace: number;
  speed: number;
  lat: number;
  latTarget: number;
  phase: number;
  idle: boolean;
  faceYaw: number;
  scale: number;
}

interface Look {
  skin: THREE.Color;
  hair: THREE.Color;
  shirt: THREE.Color;
  pants: THREE.Color;
  cap: THREE.Color | null;
  bag: THREE.Color | null;
}

type PartName = 'head' | 'hair' | 'eyes' | 'torso' | 'arms' | 'legs' | 'caps' | 'bags';

const SKIN = ['#f1c7a0', '#d9a77f', '#c08a64', '#9c6a4a', '#7a5038'];
const HAIR = ['#1f1a17', '#2e2420', '#4a3426', '#151515', '#6b4a2e'];
const SHIRTS = ['#ff5a4e', '#4aa3ff', '#ffc94a', '#2fbf7a', '#ff9a4a', '#a37cf0', '#ffffff', '#ff8fb5', '#2b3a55', '#33c4c4'];
const PANTS = ['#3a4a6b', '#2b2b33', '#6b8bd6', '#d9c7a3', '#4a6b4a', '#7a4a5a'];
const CAPS = ['#e84a3f', '#2f73c9', '#ffffff', '#f2c230'];

const root = new THREE.Matrix4();
const local = new THREE.Matrix4();
const r1 = new THREE.Matrix4();
const r2 = new THREE.Matrix4();
const world = new THREE.Matrix4();
const unit = new THREE.Vector3();

function makeMesh(geo: THREE.BufferGeometry, count: number, castShadow: boolean, colorful = true) {
  const im = new THREE.InstancedMesh(geo, clayMaterial({ roughness: 0.6 }), count);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colorful) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
  im.castShadow = castShadow;
  im.frustumCulled = false;
  im.count = 0;
  return im;
}

export class PedestrianSystem {
  readonly group = new THREE.Group();
  private walkers: Walker[] = [];
  private looks: Look[] = [];
  private eyes: { x: number; z: number }[];
  private parts: Record<PartName, THREE.InstancedMesh>;
  private separateTimer = 0;

  constructor(net: Network, count: number, castShadow: boolean) {
    const rng = mulberry32(4242);
    this.eyes = net.districts.map((d) => ({ x: d.street.x, z: d.street.z }));

    // Where each neighbourhood sidewalk meets another road, and which light lets people cross.
    const crossingsFor = (road: Road): Crossing[] =>
      net.signals
        .filter((sg) => sg.main === road || sg.cross === road)
        .map((sg) => {
          const other = sg.main === road ? sg.cross : sg.main;
          const sc = road.path.project(sg.x, sg.z);
          const half = other.width / 2 + 3.4;
          return { from: sc - half, to: sc + half, signal: sg, phase: sg.main === road ? 1 : 0 };
        });

    const loops = net.districts.map((d) => ({ road: d.roads[0], crossings: crossingsFor(d.roads[0]) }));
    for (let i = 0; this.walkers.length < count; i++) {
      const { road, crossings } = loops[i % loops.length];
      const idle = rng() < 0.22;
      const w: Walker = {
        road,
        crossings,
        side: rng() < 0.5 ? 1 : -1,
        s: rng() * road.path.length,
        dir: rng() < 0.5 ? 1 : -1,
        pace: 1.0 + rng() * 0.5,
        speed: 0,
        lat: 1.2 + rng() * 1.4,
        latTarget: 0,
        phase: rng() * Math.PI * 2,
        idle,
        faceYaw: rng() * Math.PI * 2,
        scale: 0.9 + rng() * 0.2,
      };
      w.latTarget = w.lat;
      if (crossings.some((c) => w.s > c.from - 2 && w.s < c.to + 2)) w.s = (crossings[0]?.to ?? 0) + 6;
      w.speed = idle ? 0 : w.pace;
      this.walkers.push(w);
      if (idle && rng() < 0.7) {
        // A friend standing opposite, mid-conversation.
        this.walkers.push({ ...w, lat: w.lat + 0.9, latTarget: w.lat + 0.9, faceYaw: w.faceYaw + Math.PI, phase: rng() * 6, scale: 0.9 + rng() * 0.2 });
      }
    }
    for (let i = 0; i < this.walkers.length; i++) {
      this.looks.push({
        skin: new THREE.Color(pick(rng, SKIN)),
        hair: new THREE.Color(pick(rng, HAIR)),
        shirt: new THREE.Color(pick(rng, SHIRTS)),
        pants: new THREE.Color(pick(rng, PANTS)),
        cap: rng() < 0.18 ? new THREE.Color(pick(rng, CAPS)) : null,
        bag: rng() < 0.3 ? new THREE.Color(pick(rng, SHIRTS)) : null,
      });
    }

    const n = this.walkers.length;
    const eye = () => new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.4, 0.6);
    this.parts = {
      head: makeMesh(new THREE.SphereGeometry(0.4, 18, 14), n, castShadow),
      hair: makeMesh(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(-0.35), n, castShadow),
      eyes: makeMesh(mergeGeometries([eye().translate(0.13, 0, 0.36), eye().translate(-0.13, 0, 0.36)])!, n, false, false),
      torso: makeMesh(new RoundedBoxGeometry(0.56, 0.58, 0.38, 3, 0.16), n, castShadow),
      arms: makeMesh(new THREE.CapsuleGeometry(0.1, 0.3, 4, 8).translate(0, -0.2, 0), n * 2, castShadow),
      legs: makeMesh(new THREE.CapsuleGeometry(0.115, 0.3, 4, 8).translate(0, -0.21, 0), n * 2, castShadow),
      caps: makeMesh(new THREE.SphereGeometry(0.44, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1), n, castShadow),
      bags: makeMesh(new RoundedBoxGeometry(0.42, 0.46, 0.2, 2, 0.08), n, castShadow),
    };
    (this.parts.eyes.material as THREE.MeshStandardMaterial).color.set('#1b1b1f');
    for (const p of Object.values(this.parts)) this.group.add(p);
  }

  update(dt: number, time: number, focus: THREE.Vector3, distance: number) {
    // Walking continues everywhere; only people near the camera's focus are drawn.
    this.separateTimer -= dt;
    if (this.separateTimer <= 0) {
      this.separateTimer = 0.25;
      this.separate();
    }
    for (const w of this.walkers) this.step(w, dt);

    const P = this.parts;
    const slots: Record<PartName, number> = { head: 0, hair: 0, eyes: 0, torso: 0, arms: 0, legs: 0, caps: 0, bags: 0 };
    const put = (name: PartName, color?: THREE.Color) => {
      world.multiplyMatrices(root, local);
      const im = P[name];
      const slot = slots[name]++;
      im.setMatrixAt(slot, world);
      if (color && im.instanceColor) im.setColorAt(slot, color);
    };

    if (distance < 900) {
      const range2 = Math.max(260, distance * 1.1) ** 2;
      for (let i = 0; i < this.walkers.length; i++) {
        const w = this.walkers[i];
        w.road.path.sample(w.s, tmp);
        const h = Math.hypot(tmp.tx, tmp.tz) || 1;
        const o = w.side * (w.road.width / 2 + w.lat);
        const px = tmp.x + (tmp.tz / h) * o;
        const pz = tmp.z + (-tmp.tx / h) * o;
        if ((px - focus.x) ** 2 + (pz - focus.z) ** 2 > range2) continue;
        if (this.eyes.some((e) => (e.x - px) ** 2 + (e.z - pz) ** 2 < 8 * 8)) continue;

        const moving = w.speed > 0.08;
        const stride = Math.min(1, w.speed / 1.2);
        const yaw = moving ? Math.atan2((tmp.tx / h) * w.dir, (tmp.tz / h) * w.dir) : w.faceYaw + Math.sin(time * 0.6 + w.phase) * 0.25;
        const gait = Math.sin(w.phase) * stride;
        const bob = moving ? Math.abs(Math.cos(w.phase)) * 0.07 * stride : Math.sin(time * 2 + w.phase) * 0.015;
        const sway = Math.sin(w.phase) * 0.04 * stride;
        const look = this.looks[i];

        unit.setScalar(w.scale);
        root.makeRotationY(yaw).scale(unit).setPosition(px, 0.14 + bob, pz);

        const headTilt = moving ? Math.sin(w.phase * 2) * 0.05 : Math.sin(time * 1.3 + w.phase) * 0.12;
        local.makeTranslation(0, 1.48, 0).multiply(r1.makeRotationZ(headTilt + sway));
        put('head', look.skin);
        put('hair', look.hair);
        put('eyes');
        if (look.cap) {
          local.multiply(r1.makeTranslation(0, 0.06, 0));
          put('caps', look.cap);
        }
        local.makeTranslation(0, 0.86, 0).multiply(r1.makeRotationZ(sway));
        put('torso', look.shirt);
        if (look.bag) {
          local.makeTranslation(0, 0.9, -0.28);
          put('bags', look.bag);
        }
        const armSwing = moving ? gait * 0.75 : Math.sin(time * 2.4 + w.phase) * 0.15;
        for (const side of [1, -1]) {
          local.makeTranslation(side * 0.34, 1.08, 0).multiply(r1.makeRotationX(-armSwing * side)).multiply(r2.makeRotationZ(side * 0.12));
          put('arms', look.shirt);
          local.makeTranslation(side * 0.13, 0.56, 0).multiply(r1.makeRotationX(gait * 0.6 * side));
          put('legs', look.pants);
        }
      }
    }
    for (const [name, im] of Object.entries(P) as [PartName, THREE.InstancedMesh][]) {
      im.count = slots[name];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private step(w: Walker, dt: number) {
    if (w.idle) return;
    const L = w.road.path.length;
    let target = w.pace;
    for (const c of w.crossings) {
      if (w.s > c.from && w.s < c.to) {
        target = w.pace * 1.5; // already on the zebra: hurry across
        break;
      }
      const edge = w.dir > 0 ? c.from : c.to;
      let d = (edge - w.s) * w.dir;
      if (d < -L / 2) d += L;
      if (d > 0 && d < 3) {
        // Wait at the kerb until the road being crossed has a red light.
        if (signalLight(c.signal, c.phase) !== 'red') target = d < 0.7 ? 0 : Math.min(target, d * 0.8);
        break;
      }
    }
    // Ease speed like a body with mass rather than snapping between walking and standing.
    w.speed += (target - w.speed) * Math.min(1, dt * 4);
    w.s = (((w.s + w.speed * w.dir * dt) % L) + L) % L;
    w.phase += w.speed * dt * 4.2;
    w.lat += (w.latTarget - w.lat) * Math.min(1, dt * 1.5);
  }

  /** Personal space: walkers close together on the same sidewalk drift sideways to pass. */
  private separate() {
    const groups = new Map<string, Walker[]>();
    for (const w of this.walkers) {
      const key = `${w.road.id}:${w.side}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(w);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.s - b.s);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length && list[j].s - a.s < 1.6; j++) {
          const b = list[j];
          if (a.idle && b.idle) continue;
          if (Math.abs(a.lat - b.lat) < 0.75) {
            const push = a.lat <= b.lat ? -0.55 : 0.55;
            if (!a.idle) a.latTarget = Math.min(2.9, Math.max(0.7, a.lat + push));
            if (!b.idle) b.latTarget = Math.min(2.9, Math.max(0.7, b.lat - push));
          }
        }
      }
    }
  }
}
