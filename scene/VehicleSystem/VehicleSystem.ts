import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { lanePose, type Network } from '../RoadNetwork/network';
import type { PathSample } from '../RoadNetwork/CenterPath';
import { LAYOUT } from '../config';
import { VEHICLE_LENGTH, VEHICLE_TYPES, type TrafficSimulation } from '../TrafficSimulation/TrafficSimulation';
import { additiveMaterial, beamTexture, radialTexture } from '@/shaders/glow';
import { clayMaterial } from '@/shaders/clay';

// Toy-like instanced vehicles with a little game physics on top of the traffic simulation:
// spring-damper suspension (nose-dive on braking, squat on acceleration, body roll in turns —
// two-wheelers lean into turns instead), rolling and steering wheels, and a bouncy pop-in.
// Bangalore mix: hatchbacks, SUVs/cabs, green-and-yellow autos, two-wheelers, BMTC buses, lorries.

type RGB = [number, number, number];
const PAINT: RGB = [1, 1, 1];
const GLASS: RGB = [0.2, 0.27, 0.36];
const HEAD: RGB = [1, 0.97, 0.85];
const TAIL: RGB = [0.95, 0.18, 0.12];
const BLACK: RGB = [0.12, 0.12, 0.13];
const SKIN: RGB = [0.78, 0.55, 0.4];

function colorize(g: THREE.BufferGeometry, color: RGB) {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat.attributes.uv) flat.deleteAttribute('uv');
  const c = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) c.set(color, i);
  flat.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return flat;
}

function part(w: number, h: number, l: number, x: number, y: number, z: number, color: RGB, round = 0.3) {
  const r = Math.min(round, w / 2 - 0.01, h / 2 - 0.01, l / 2 - 0.01);
  const g = r > 0.02 ? new RoundedBoxGeometry(w, h, l, 3, r) : new THREE.BoxGeometry(w, h, l);
  return colorize(g.translate(x, y, z), color);
}

const ball = (r: number, x: number, y: number, z: number, color: RGB) => colorize(new THREE.SphereGeometry(r, 14, 10).translate(x, y, z), color);
const cap = (r: number, x: number, y: number, z: number, color: RGB) =>
  colorize(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y, z), color);

/** Wheel layout per vehicle type: [x, z, radius, steers]. Wheels are separate so they can roll. */
const WHEELS: [number, number, number, boolean][][] = [
  [[0.9, 1.35, 0.42, true], [-0.9, 1.35, 0.42, true], [0.9, -1.35, 0.42, false], [-0.9, -1.35, 0.42, false]],
  [[0.96, 1.55, 0.48, true], [-0.96, 1.55, 0.48, true], [0.96, -1.55, 0.48, false], [-0.96, -1.55, 0.48, false]],
  [[0, 1.0, 0.3, true], [0.6, -0.85, 0.3, false], [-0.6, -0.85, 0.3, false]],
  [[0, 0.75, 0.36, true], [0, -0.75, 0.36, false]],
  [[1.14, 3.4, 0.56, true], [-1.14, 3.4, 0.56, true], [1.14, -3.3, 0.56, false], [-1.14, -3.3, 0.56, false]],
  [[1.1, 2.8, 0.52, true], [-1.1, 2.8, 0.52, true], [1.1, -2.2, 0.52, false], [-1.1, -2.2, 0.52, false], [1.1, -3.4, 0.52, false], [-1.1, -3.4, 0.52, false]],
];

function bodyGeometry(type: number): THREE.BufferGeometry {
  const L = VEHICLE_LENGTH[type];
  let parts: THREE.BufferGeometry[];
  switch (type) {
    case 0: // hatchback
      parts = [
        part(1.92, 0.82, L, 0, 0.86, 0, PAINT, 0.38),
        part(1.68, 0.8, 2.4, 0, 1.55, -0.25, GLASS, 0.36),
        part(1.56, 0.18, 2.1, 0, 1.96, -0.25, PAINT, 0.09),
      ];
      break;
    case 1: // SUV / cab
      parts = [
        part(2.02, 1.06, L, 0, 1.0, 0, PAINT, 0.42),
        part(1.88, 0.8, 3.05, 0, 1.9, -0.35, GLASS, 0.34),
        part(1.78, 0.2, 2.85, 0, 2.32, -0.35, PAINT, 0.1),
      ];
      break;
    case 2: // auto-rickshaw: green tub, yellow hood, black canopy, driver
      parts = [
        part(1.38, 0.72, L, 0, 0.7, 0, [0.16, 0.62, 0.32], 0.32),
        part(1.04, 0.66, 0.78, 0, 1.12, L / 2 - 0.45, [0.99, 0.8, 0.16], 0.28),
        part(1.46, 0.18, 2.14, 0, 2.1, -0.25, BLACK, 0.09),
        part(1.4, 0.98, 0.14, 0, 1.58, -1.18, BLACK, 0.06),
        part(0.1, 1.0, 0.1, 0.62, 1.55, 0.7, BLACK, 0),
        part(0.1, 1.0, 0.1, -0.62, 1.55, 0.7, BLACK, 0),
        ball(0.26, 0, 1.62, 0.32, SKIN),
        cap(0.27, 0, 1.66, 0.3, [0.12, 0.1, 0.09]),
      ];
      break;
    case 3: // two-wheeler with a chibi rider
      parts = [
        part(0.46, 0.5, L, 0, 0.72, 0, PAINT, 0.2),
        part(0.4, 0.14, 0.7, 0, 1.02, -0.25, BLACK, 0.06),
        part(0.56, 0.62, 0.42, 0, 1.38, -0.2, [0.27, 0.45, 0.85], 0.2),
        ball(0.3, 0, 1.92, -0.12, SKIN),
        cap(0.33, 0, 1.96, -0.14, [0.95, 0.3, 0.25]),
      ];
      break;
    case 4: // BMTC bus
      parts = [
        part(2.52, 2.6, L, 0, 1.88, 0, PAINT, 0.5),
        part(2.56, 0.92, L - 1.6, 0, 2.35, -0.3, GLASS, 0.2),
        part(2.32, 0.22, L - 1.0, 0, 3.24, 0, [0.96, 0.96, 0.94], 0.1),
        part(2.2, 1.05, 0.12, 0, 2.2, L / 2 + 0.01, GLASS, 0.05),
      ];
      break;
    default: // lorry
      parts = [
        part(2.32, 2.15, 2.25, 0, 1.72, L / 2 - 1.12, PAINT, 0.4),
        part(2.12, 0.72, 0.12, 0, 2.15, L / 2 + 0.01, GLASS, 0.05),
        part(2.46, 2.45, L - 2.5, 0, 1.95, -1.2, [0.97, 0.74, 0.27], 0.32),
        part(2.52, 0.38, L - 2.4, 0, 3.3, -1.2, [0.22, 0.52, 0.78], 0.18),
      ];
  }
  const w = type === 3 ? 0.2 : type === 2 ? 1.0 : type >= 4 ? 2.1 : 1.6;
  const ly = type >= 4 ? 1.1 : 0.92;
  for (const sx of type === 3 ? [0] : [-1, 1]) {
    parts.push(ball(0.15, (sx * w) / 2.6, ly, L / 2 - 0.02, HEAD));
    parts.push(part(0.32, 0.18, 0.08, (sx * w) / 2.6, ly, -L / 2 - 0.02, TAIL, 0));
  }
  return mergeGeometries(parts)!;
}

function wheelGeometry() {
  // Unit wheel (radius 1, width 0.32 at radius 0.42 scale) with a pale hub on both sides.
  return mergeGeometries([
    colorize(new THREE.CylinderGeometry(1, 1, 0.75, 16).rotateZ(Math.PI / 2), [0.13, 0.13, 0.15]),
    colorize(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 12).rotateZ(Math.PI / 2), [0.88, 0.88, 0.86]),
  ])!;
}

const PALETTES = [
  ['#ff5a4e', '#ffc94a', '#4aa3ff', '#ffffff', '#33d1b0', '#ff9a4a', '#a37cf0', '#e3e7ec', '#4a5a70', '#ff9ec0'],
  ['#ffffff', '#f5f2ea', '#3a4a5c', '#e04b4b', '#5c95e0', '#f2c94c'],
  ['#ffffff'],
  ['#ff4b4b', '#2f7fe6', '#2b2b2b', '#f4f4f4', '#2fb36a', '#ffa020'],
  ['#e0473b', '#3479c4', '#45ab5f', '#f08a34'],
  ['#ef5146', '#3389dd', '#f5ae45', '#48b058'],
];

const pose: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };
const base = new THREE.Matrix4();
const local = new THREE.Matrix4();
const tmpA = new THREE.Matrix4();
const tmpB = new THREE.Matrix4();
const out = new THREE.Matrix4();
const PIVOT = [0.5, 0.55, 0.4, 0.3, 0.7, 0.7];

/** easeOutBack: overshoots then settles — a toy "pop" when a vehicle appears. */
const pop = (t: number) => {
  const c1 = 1.9;
  const u = t - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
};

export class VehicleSystem {
  readonly group = new THREE.Group();
  private bodies: THREE.InstancedMesh[] = [];
  private wheels: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private paletteColors: THREE.Color[][];
  /** Light-glow multiplier per district — de-emphasizes unselected regions. */
  emphasis: Float32Array;
  hubEmphasis = 1;

  // Render-side physics state, indexed like the simulation's vehicles.
  private tracked: Uint8Array;
  private pitch: Float32Array;
  private pitchV: Float32Array;
  private roll: Float32Array;
  private rollV: Float32Array;
  private heave: Float32Array;
  private heaveV: Float32Array;
  private yawPrev: Float32Array;
  private yawRate: Float32Array;
  private spin: Float32Array;

  constructor(private sim: TrafficSimulation, private net: Network, castShadow: boolean) {
    const cap = sim.cap;
    this.emphasis = new Float32Array(net.districts.length).fill(1);
    this.paletteColors = PALETTES.map((p) => p.map((c) => new THREE.Color(c)));
    this.tracked = new Uint8Array(cap);
    this.pitch = new Float32Array(cap);
    this.pitchV = new Float32Array(cap);
    this.roll = new Float32Array(cap);
    this.rollV = new Float32Array(cap);
    this.heave = new Float32Array(cap);
    this.heaveV = new Float32Array(cap);
    this.yawPrev = new Float32Array(cap);
    this.yawRate = new Float32Array(cap);
    this.spin = new Float32Array(cap);

    const mat = clayMaterial({ vertexColors: true, roughness: 0.38 });
    VEHICLE_TYPES.forEach((_, t) => {
      const body = new THREE.InstancedMesh(bodyGeometry(t), mat, cap);
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      body.frustumCulled = false;
      body.castShadow = castShadow;
      body.count = 0;
      this.bodies.push(body);
      this.group.add(body);
    });
    this.wheels = new THREE.InstancedMesh(wheelGeometry(), clayMaterial({ vertexColors: true, roughness: 0.55 }), Math.ceil(cap * 4.2));
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.frustumCulled = false;
    this.wheels.castShadow = castShadow;
    this.wheels.count = 0;
    this.group.add(this.wheels);

    const tailGeo = new THREE.PlaneGeometry(2.6, 2.4).rotateX(-Math.PI / 2).translate(0, 0.12, -0.7);
    this.tails = new THREE.InstancedMesh(tailGeo, additiveMaterial(radialTexture(64, 1.8), '#ffffff', 0.7), cap);
    this.tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tails.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tails.frustumCulled = false;
    this.tails.renderOrder = 2;
    this.tails.count = 0;
    const beamGeo = new THREE.PlaneGeometry(3.6, 10).rotateX(-Math.PI / 2).translate(0, 0.11, 5);
    this.beams = new THREE.InstancedMesh(beamGeo, additiveMaterial(beamTexture(), '#ffdcaa', 0.18), cap);
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 2;
    this.beams.count = 0;
    this.group.add(this.tails, this.beams);
  }

  update(dt: number, camera: THREE.Vector3) {
    const sim = this.sim;
    const lanes = this.net.lanes;
    const counts = new Int32Array(VEHICLE_TYPES.length);
    const cols = this.bodies.map((b) => b.instanceColor!.array as Float32Array);
    const tm = this.tails.instanceMatrix.array as Float32Array;
    const tc = this.tails.instanceColor!.array as Float32Array;
    const bm = this.beams.instanceMatrix.array as Float32Array;
    let g = 0;
    let wheelCount = 0;
    const h = Math.min(Math.max(dt, 1e-4), 1 / 30);
    const laneW = LAYOUT.laneWidth;
    const wheelRange2 = 650 * 650;

    for (let i = 0; i < sim.cap; i++) {
      if (!sim.active[i]) {
        this.tracked[i] = 0;
        continue;
      }
      const lane = lanes[sim.lane[i]];
      lanePose(lane, sim.s[i], sim.lat[i], pose);
      const t = sim.type[i];
      const len = VEHICLE_LENGTH[t];
      const v = sim.v[i];

      // Heading (with a little yaw while changing lanes).
      let fx = pose.tx;
      let fy = pose.ty;
      let fz = pose.tz;
      const hl = Math.hypot(fx, fz) || 1;
      const sway = (sim.latVel[i] * laneW) / Math.max(2, v);
      fx += (pose.tz / hl) * sway;
      fz += (-pose.tx / hl) * sway;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      const yaw = Math.atan2(fx, fz);

      if (!this.tracked[i]) {
        this.tracked[i] = 1;
        this.yawPrev[i] = yaw;
        this.yawRate[i] = 0;
        this.pitch[i] = this.pitchV[i] = this.roll[i] = this.rollV[i] = 0;
        this.heave[i] = 0.5;
        this.heaveV[i] = 0;
        this.spin[i] = sim.tint[i] * 6;
      }

      // Suspension: damped springs chasing targets from longitudinal and lateral acceleration.
      let dyaw = yaw - this.yawPrev[i];
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yawPrev[i] = yaw;
      this.yawRate[i] += (dyaw / h - this.yawRate[i]) * Math.min(1, h * 10);
      const lat = v * this.yawRate[i];
      const heavy = t >= 4 ? 0.6 : 1;
      const pitchT = Math.max(-0.1, Math.min(0.12, -sim.acc[i] * 0.028 * heavy));
      const rollT = t === 3 ? Math.max(-0.45, Math.min(0.45, -lat * 0.05)) : Math.max(-0.1, Math.min(0.1, lat * 0.022 * heavy));
      const k = t === 3 ? 30 : 70;
      const c = t === 3 ? 10 : 7.5;
      this.pitchV[i] += (-k * (this.pitch[i] - pitchT) - c * this.pitchV[i]) * h;
      this.pitch[i] += this.pitchV[i] * h;
      this.rollV[i] += (-k * (this.roll[i] - rollT) - c * this.rollV[i]) * h;
      this.roll[i] += this.rollV[i] * h;
      this.heaveV[i] += (-90 * this.heave[i] - 8 * this.heaveV[i] - (this.heave[i] > 0 ? 6 : 0)) * h;
      this.heave[i] += this.heaveV[i] * h;
      this.spin[i] += (v * h) / WHEELS[t][0][2];

      const fade = sim.fade[i];
      const sc = fade < 1 ? Math.max(0, pop(fade)) : 1;

      // Base frame: X = left, Y = up, Z = forward.
      let xx = fz;
      let xz = -fx;
      const xl = Math.hypot(xx, xz) || 1;
      xx /= xl;
      xz /= xl;
      const yx = fy * xz;
      const yy = fz * xx - fx * xz;
      const yz = -fy * xx;
      const px = pose.x;
      const py = pose.y + 0.04;
      const pz = pose.z;
      base.set(xx * sc, yx * sc, fx * sc, px, 0, yy * sc, fy * sc, py, xz * sc, yz * sc, fz * sc, pz, 0, 0, 0, 1);

      // Body = base · lift(heave) · pivot · roll · pitch · unpivot.
      const pv = PIVOT[t];
      local.makeTranslation(0, pv + Math.max(-0.2, this.heave[i]), 0);
      tmpA.makeRotationZ(this.roll[i]);
      local.multiply(tmpA);
      tmpA.makeRotationX(this.pitch[i]);
      local.multiply(tmpA);
      tmpA.makeTranslation(0, -pv, 0);
      local.multiply(tmpA);
      out.multiplyMatrices(base, local);
      const slot = counts[t]++;
      out.toArray(this.bodies[t].instanceMatrix.array as Float32Array, slot * 16);
      const pal = this.paletteColors[t];
      const col = pal[Math.floor(sim.tint[i] * pal.length) % pal.length];
      cols[t][slot * 3] = col.r;
      cols[t][slot * 3 + 1] = col.g;
      cols[t][slot * 3 + 2] = col.b;

      // Wheels: stay on the road while the body moves; front ones steer with the yaw rate.
      const dx = px - camera.x;
      const dz = pz - camera.z;
      if (dx * dx + dz * dz < wheelRange2) {
        const wheelbase = len * 0.6;
        const steer = Math.max(-0.5, Math.min(0.5, (this.yawRate[i] * wheelbase) / Math.max(v, 1.5)));
        for (const [wx, wz, wr, steers] of WHEELS[t]) {
          const width = t === 3 ? 0.18 : 0.32;
          local.makeTranslation(wx, wr, wz);
          if (steers) {
            tmpA.makeRotationY(steer);
            local.multiply(tmpA);
          }
          tmpA.makeRotationX(this.spin[i]);
          tmpB.makeScale(width / 0.75, wr, wr);
          local.multiply(tmpA).multiply(tmpB);
          out.multiplyMatrices(base, local);
          out.toArray(this.wheels.instanceMatrix.array as Float32Array, wheelCount * 16);
          wheelCount++;
        }
      }

      // Evening lights: head beams, tail lights brighter while braking.
      const braking = sim.acc[i] < -0.9 || v < 0.5;
      const em = lane.district >= 0 ? this.emphasis[lane.district] : this.hubEmphasis;
      const half = len / 2;
      const o = g * 16;
      for (const [arr, off] of [[tm, -half], [bm, half]] as const) {
        arr[o] = xx * sc; arr[o + 1] = 0; arr[o + 2] = xz * sc; arr[o + 3] = 0;
        arr[o + 4] = yx * sc; arr[o + 5] = yy * sc; arr[o + 6] = yz * sc; arr[o + 7] = 0;
        arr[o + 8] = fx * sc; arr[o + 9] = fy * sc; arr[o + 10] = fz * sc; arr[o + 11] = 0;
        arr[o + 12] = px + fx * off; arr[o + 13] = py + fy * off; arr[o + 14] = pz + fz * off; arr[o + 15] = 1;
      }
      const tail = (braking ? 0.9 : 0.3) * em;
      tc[g * 3] = tail;
      tc[g * 3 + 1] = tail * 0.08;
      tc[g * 3 + 2] = tail * 0.05;
      g++;
    }

    this.bodies.forEach((b, t) => {
      b.count = counts[t];
      b.instanceMatrix.needsUpdate = true;
      b.instanceColor!.needsUpdate = true;
    });
    this.wheels.count = wheelCount;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.tails.count = g;
    this.beams.count = g;
    this.tails.instanceMatrix.needsUpdate = true;
    this.tails.instanceColor!.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }
}
