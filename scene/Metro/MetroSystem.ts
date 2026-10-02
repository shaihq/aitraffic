import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Network } from '../RoadNetwork/network';
import type { PathSample } from '../RoadNetwork/CenterPath';
import { LAYOUT } from '../config';
import { clayMaterial } from '@/shaders/clay';

// Namma Metro: elevated viaducts with stations and trains shuttling end to end. Ambient city
// life only — trains are not driven by usage data.

const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };
const CAR = 17;
const CARS = 3;
const SPEED = 16;
const DWELL = 5;

interface Train {
  line: number;
  s: number;
  v: number;
  dir: 1 | -1;
  dwell: number;
  lastStation: number;
}

const ACCEL = 0.9;
const BRAKE = 1.0;

function deck(n: number, sample: (i: number) => PathSample, width: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = sample(i);
    const h = Math.hypot(p.tx, p.tz) || 1;
    const lx = p.tz / h;
    const lz = -p.tx / h;
    // Top surface + two sides, as a U-shaped trough.
    const y = p.y - 0.6;
    const pts = [
      [p.x + lx * width, y - 1.6, p.z + lz * width],
      [p.x + lx * width, y + 0.9, p.z + lz * width],
      [p.x + lx * width, y, p.z + lz * width],
      [p.x - lx * width, y, p.z - lz * width],
      [p.x - lx * width, y + 0.9, p.z - lz * width],
      [p.x - lx * width, y - 1.6, p.z - lz * width],
    ];
    for (const q of pts) pos.push(q[0], q[1], q[2]);
    if (i > 0) {
      const a = (i - 1) * 6;
      const b = i * 6;
      for (const [u, v] of [[0, 1], [2, 3], [4, 5], [5, 0]]) idx.push(a + u, b + u, a + v, a + v, b + u, b + v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class MetroSystem {
  readonly group = new THREE.Group();
  private trains: Train[] = [];
  private cars: THREE.InstancedMesh;
  private colors: THREE.Color[];

  constructor(private net: Network, castShadow: boolean, blocked: (x: number, z: number) => boolean) {
    const concrete = clayMaterial({ color: '#efe9de', roughness: 0.75, side: THREE.DoubleSide });
    const decks: THREE.BufferGeometry[] = [];
    const pillars: THREE.Matrix4[] = [];
    const stations: THREE.BufferGeometry[] = [];
    this.colors = net.metro.map((l) => new THREE.Color(l.color));

    net.metro.forEach((line, li) => {
      const step = 3;
      const n = Math.floor(line.path.length / step) + 1;
      decks.push(deck(n, (i) => line.path.sample(Math.min(line.path.length, i * step), { ...tmp }), 3.4));
      for (let s = 10; s < line.path.length; s += 32) {
        line.path.sample(s, tmp);
        if (blocked(tmp.x, tmp.z)) continue;
        pillars.push(new THREE.Matrix4().makeScale(1.4, LAYOUT.metroHeight - 2, 1.4).setPosition(tmp.x, (LAYOUT.metroHeight - 2) / 2, tmp.z));
      }
      for (const st of line.stations) {
        line.path.sample(st.s, tmp);
        const yaw = Math.atan2(tmp.tx, tmp.tz);
        const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(tmp.x, tmp.y, tmp.z);
        const parts = [
          new RoundedBoxGeometry(12, 1, 44, 2, 0.3).translate(0, -1.1, 0),
          new RoundedBoxGeometry(13, 0.8, 46, 2, 0.3).translate(0, 5.5, 0),
          new THREE.BoxGeometry(0.5, 5, 0.5).translate(5.8, 2.5, -18),
          new THREE.BoxGeometry(0.5, 5, 0.5).translate(-5.8, 2.5, -18),
          new THREE.BoxGeometry(0.5, 5, 0.5).translate(5.8, 2.5, 18),
          new THREE.BoxGeometry(0.5, 5, 0.5).translate(-5.8, 2.5, 18),
        ].map((g) => {
          const ng = g.index ? g.toNonIndexed() : g;
          ng.deleteAttribute('uv');
          return ng.applyMatrix4(m);
        });
        stations.push(...parts);
      }
      // Trains shuttle end to end, starting at opposite ends. `s` is the train's centre.
      this.trains.push({ line: li, s: CAR * 2, v: 0, dir: 1, dwell: 0, lastStation: -1 });
      this.trains.push({ line: li, s: line.path.length - CAR * 2, v: 0, dir: -1, dwell: 0, lastStation: -1 });
      if (line.path.length > 1500) this.trains.push({ line: li, s: line.path.length / 2, v: 0, dir: 1, dwell: 0, lastStation: -1 });
    });

    const deckMesh = new THREE.Mesh(mergeGeometries(decks)!, concrete);
    deckMesh.castShadow = castShadow;
    deckMesh.receiveShadow = true;
    const pillarMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.1, 1, 10), concrete, pillars.length);
    pillars.forEach((m, i) => pillarMesh.setMatrixAt(i, m));
    pillarMesh.castShadow = castShadow;
    const stationMesh = new THREE.Mesh(mergeGeometries(stations)!, clayMaterial({ color: '#fbf7ef', roughness: 0.7 }));
    stationMesh.castShadow = castShadow;
    this.group.add(deckMesh, pillarMesh, stationMesh);

    // Train car: body in the line colour (instance colour), dark window band, pale roof.
    const paint = (g: THREE.BufferGeometry, c: [number, number, number]) => {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.deleteAttribute('uv');
      const arr = new Float32Array(ng.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) arr.set(c, i);
      ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return ng;
    };
    const carGeo = mergeGeometries([
      paint(new RoundedBoxGeometry(2.9, 3.0, CAR - 0.6, 2, 0.5).translate(0, 1.9, 0), [1, 1, 1]),
      paint(new RoundedBoxGeometry(2.96, 0.9, CAR - 2, 2, 0.2).translate(0, 2.3, 0), [0.15, 0.2, 0.26]),
      paint(new RoundedBoxGeometry(2.4, 0.3, CAR - 2, 2, 0.1).translate(0, 3.45, 0), [0.92, 0.92, 0.92]),
    ])!;
    this.cars = new THREE.InstancedMesh(carGeo, clayMaterial({ vertexColors: true, roughness: 0.4 }), this.trains.length * CARS);
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.trains.length * CARS * 3), 3);
    this.cars.castShadow = castShadow;
    this.cars.frustumCulled = false;
    this.group.add(this.cars);
  }

  update(dt: number) {
    const m4 = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    let k = 0;
    for (const tr of this.trains) {
      const line = this.net.metro[tr.line];
      if (tr.dwell > 0) tr.dwell -= dt;
      else {
        // Next stopping point ahead: a station not just served, or the end of the line.
        const lo = CAR * 1.5;
        const hi = line.path.length - CAR * 1.5;
        let stopAt = tr.dir > 0 ? hi : lo;
        let stopStation = -1;
        line.stations.forEach((st, si) => {
          const ahead = (st.s - tr.s) * tr.dir;
          if (si !== tr.lastStation && ahead > 0 && ahead < (stopAt - tr.s) * tr.dir) {
            stopAt = st.s;
            stopStation = si;
          }
        });
        const dist = (stopAt - tr.s) * tr.dir;
        // Accelerate to line speed, then brake so the train glides to a stop on the mark.
        const brakeSpeed = Math.sqrt(Math.max(0, 2 * BRAKE * dist));
        const target = Math.min(SPEED, brakeSpeed);
        tr.v = tr.v < target ? Math.min(target, tr.v + ACCEL * dt) : Math.max(target, tr.v - BRAKE * 1.5 * dt);
        tr.s += tr.dir * Math.min(tr.v * dt, Math.max(0, dist));
        if (dist < 0.3 && tr.v < 0.6) {
          tr.v = 0;
          if (stopStation >= 0) {
            tr.dwell = DWELL;
            tr.lastStation = stopStation;
          } else {
            tr.dir = tr.dir > 0 ? -1 : 1;
            tr.dwell = DWELL * 2;
            tr.lastStation = -1;
          }
        }
      }
      for (let c = 0; c < CARS; c++) {
        const s = tr.s + tr.dir * (1 - c) * CAR;
        line.path.sample(s, tmp);
        const fx = tmp.tx * tr.dir;
        const fz = tmp.tz * tr.dir;
        const h = Math.hypot(fx, fz) || 1;
        const zx = fx / h;
        const zz = fz / h;
        basis.set(zz, 0, zx, tmp.x, 0, 1, 0, tmp.y - 0.4, -zx, 0, zz, tmp.z, 0, 0, 0, 1);
        m4.copy(basis);
        this.cars.setMatrixAt(k, m4);
        this.cars.setColorAt(k, this.colors[tr.line]);
        k++;
      }
    }
    this.cars.instanceMatrix.needsUpdate = true;
    this.cars.instanceColor!.needsUpdate = true;
  }
}
