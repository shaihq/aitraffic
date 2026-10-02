import * as THREE from 'three';
import { CenterPath, type P3, type PathSample } from './CenterPath';
import { LAYOUT, SPEEDS } from '../config';
import { hashString, mulberry32, range } from '@/lib/random';
import { DISTRICT_PLACES, METRO, PROVIDER_PLACE, ROUTES, project, type Waypoint } from '@/lib/bangalore';

// A simplified miniature of Bangalore: each provider's traffic lives in a real neighbourhood
// (a signalized local loop), joined by real arterials — Outer Ring Road, Bellary/Hosur Road with
// the Hebbal & Silk Board flyovers and the Electronic City elevated expressway, Tumkur/Old Madras
// Road, Old Airport Road to Whitefield — plus Namma Metro viaducts. Traffic keeps LEFT.

export type RoadKind = 'loop' | 'arterial' | 'ring';

export interface Road {
  id: number;
  kind: RoadKind;
  name: string;
  district: number; // -1 = city-level road
  path: CenterPath;
  lanesPerDir: number;
  twoWay: boolean;
  width: number;
  /** Districts this road passes through (arterial density follows them). */
  serves: number[];
}

export interface Signal {
  id: number;
  district: number;
  x: number;
  z: number;
  /** Tangent of the main road and both half-widths, for placing signal heads and zebras. */
  tx: number;
  tz: number;
  halfMain: number;
  halfCross: number;
  main: Road;
  cross: Road;
  offset: number;
  greenMain: number;
  greenCross: number;
  clock: number;
  /** Vehicles currently inside the junction box, per phase (recomputed every step). */
  occ: [number, number];
}

export interface StopLine {
  s: number;
  signal: Signal;
  phase: 0 | 1;
  /** Distance from the stop line to the far side of the junction box. */
  clear: number;
}

export interface Lane {
  id: number;
  road: Road;
  dir: 1 | -1;
  k: number;
  district: number;
  kind: RoadKind;
  length: number;
  closed: boolean;
  baseSpeed: number;
  group: number[];
  stops: StopLine[];
  exits: number[];
  entries: number[];
  closure: { from: number; to: number } | null;
}

export interface District {
  index: number;
  key: string;
  placeId: string;
  name: string;
  cx: number;
  cz: number;
  /** Local frame: w runs along the main road through the district, u across it. */
  ux: number;
  uz: number;
  wx: number;
  wz: number;
  a: number;
  b: number;
  roads: Road[];
  lanes: Lane[];
  signals: Signal[];
  street: { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number };
  closureMarkers: { x: number; z: number }[];
}

export interface MetroLine {
  id: string;
  name: string;
  color: string;
  path: CenterPath;
  stations: { s: number; x: number; z: number }[];
}

export interface Network {
  roads: Road[];
  lanes: Lane[];
  districts: District[];
  ring: { road: Road; lanes: Lane[] };
  signals: Signal[];
  metro: MetroLine[];
  bounds: { cx: number; cz: number; radius: number };
}

const tmp: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };

export function laneOffset(road: Road, lat: number): number {
  const { laneWidth, median } = LAYOUT;
  return road.twoWay ? median / 2 + (lat + 0.5) * laneWidth : (lat - (road.lanesPerDir - 1) / 2) * laneWidth;
}

/** World pose of a lane position. `lat` is a (possibly fractional) lane coordinate. */
export function lanePose(lane: Lane, s: number, lat: number, out: PathSample): PathSample {
  const road = lane.road;
  const along = lane.dir > 0 ? s : road.path.length - s;
  road.path.sample(along, out);
  const fx = out.tx * lane.dir;
  const fz = out.tz * lane.dir;
  const h = Math.hypot(fx, fz) || 1;
  const off = laneOffset(road, lat);
  out.x += (fz / h) * off;
  out.z += (-fx / h) * off;
  out.tx = fx;
  out.ty = out.ty * lane.dir;
  out.tz = fz;
  return out;
}

function roundedRect(a: number, b: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [a - r, b - r, 0],
    [-(a - r), b - r, Math.PI / 2],
    [-(a - r), -(b - r), Math.PI],
    [a - r, -(b - r), (3 * Math.PI) / 2],
  ];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= 12; i++) {
      const t = start + (i / 12) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(t), cz + r * Math.sin(t)]);
    }
  }
  return pts;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Push districts apart until loops no longer overlap, keeping them near their real positions. */
function relax(points: { x: number; z: number }[], minDist: number) {
  const home = points.map((p) => ({ ...p }));
  for (let iter = 0; iter < 300; iter++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[j].x - points[i].x;
        const dz = points[j].z - points[i].z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d >= minDist) continue;
        const push = (minDist - d) / 2;
        points[i].x -= (dx / d) * push;
        points[i].z -= (dz / d) * push;
        points[j].x += (dx / d) * push;
        points[j].z += (dz / d) * push;
      }
    }
    for (let i = 0; i < points.length; i++) {
      points[i].x += (home[i].x - points[i].x) * 0.02;
      points[i].z += (home[i].z - points[i].z) * 0.02;
    }
  }
  return points;
}

/** Segment intersection in the XZ plane. Returns parameters along both segments or null. */
function segHit(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const rX = bx - ax;
  const rZ = bz - az;
  const sX = dx - cx;
  const sZ = dz - cz;
  const den = rX * sZ - rZ * sX;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sZ - (cz - az) * sX) / den;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

const KIND_RANK: Record<RoadKind, number> = { loop: 0, ring: 1, arterial: 2 };

export function buildNetwork(keys: string[]): Network {
  const { laneWidth, median, loopLanes, elevatedHeight, metroHeight } = LAYOUT;
  const roads: Road[] = [];
  const lanes: Lane[] = [];
  const signals: Signal[] = [];
  const districts: District[] = [];

  const makeRoad = (kind: RoadKind, name: string, district: number, path: CenterPath, lanesPerDir: number, twoWay: boolean): Road => {
    const width = (twoWay ? lanesPerDir * 2 * laneWidth + median : lanesPerDir * laneWidth) + 1.2;
    const road: Road = { id: roads.length, kind, name, district, path, lanesPerDir, twoWay, width, serves: [] };
    roads.push(road);
    return road;
  };

  const makeLanes = (road: Road, speed: number): Lane[] => {
    const dirs: (1 | -1)[] = road.twoWay ? [1, -1] : [1];
    const made: Lane[] = [];
    for (const dir of dirs) {
      const group: number[] = [];
      for (let k = 0; k < road.lanesPerDir; k++) {
        const lane: Lane = {
          id: lanes.length,
          road,
          dir,
          k,
          district: road.district,
          kind: road.kind,
          length: road.path.length,
          closed: road.path.closed,
          baseSpeed: speed,
          group,
          stops: [],
          exits: [],
          entries: [],
          closure: null,
        };
        group.push(lane.id);
        lanes.push(lane);
        made.push(lane);
      }
    }
    return made;
  };

  const laneS = (lane: Lane, x: number, z: number) => {
    const along = lane.road.path.project(x, z);
    return lane.dir > 0 ? along : lane.road.path.length - along;
  };
  const wrap = (lane: Lane, s: number) => (lane.closed ? ((s % lane.length) + lane.length) % lane.length : s);

  // 1. Place districts at their real positions, nudged apart where neighbourhoods are very close.
  const placeOf = keys.map((k) => DISTRICT_PLACES.find((p) => p.id === PROVIDER_PLACE[k]) ?? DISTRICT_PLACES[0]);
  const positions = relax(placeOf.map((p) => project(p.lat, p.lon)), LAYOUT.districtSpacing);
  const districtByPlace = new Map(placeOf.map((p, i) => [p.id, i]));
  const resolve = (w: Waypoint) => {
    if ('place' in w) {
      const i = districtByPlace.get(w.place);
      if (i !== undefined) return positions[i];
      const p = DISTRICT_PLACES.find((d) => d.id === w.place)!;
      return project(p.lat, p.lon);
    }
    return project(w.lat, w.lon);
  };

  // District orientation: along the first route that passes through it.
  const orientation = positions.map(() => ({ x: 1, z: 0 }));
  const oriented = new Set<number>();
  for (const route of ROUTES) {
    route.waypoints.forEach((w, i) => {
      if (!('place' in w)) return;
      const d = districtByPlace.get(w.place);
      if (d === undefined || oriented.has(d)) return;
      const prev = resolve(route.waypoints[(i - 1 + route.waypoints.length) % route.waypoints.length]);
      const next = resolve(route.waypoints[(i + 1) % route.waypoints.length]);
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      orientation[d] = { x: dx / len, z: dz / len };
      oriented.add(d);
    });
  }

  // 2. Neighbourhood loops.
  keys.forEach((key, index) => {
    const rnd = mulberry32(hashString(`district:${key}`));
    const { x: cx, z: cz } = positions[index];
    const wx = orientation[index].x;
    const wz = orientation[index].z;
    const ux = -wz;
    const uz = wx;
    const a = range(rnd, 62, 72);
    const b = range(rnd, 42, 50);
    const r = range(rnd, 16, 24);
    const toWorld = (lx: number, y: number, lz: number): P3 => [cx + wx * lx + ux * lz, y, cz + wz * lx + uz * lz];

    const loop = makeRoad('loop', placeOf[index].name, index, new CenterPath(roundedRect(a, b, r).map(([lx, lz]) => toWorld(lx, 0, lz)), true, 1), loopLanes, true);
    const loopLanesMade = makeLanes(loop, SPEEDS.loop);

    // Lane-drop bottleneck on the curb lane of each long side; active only while congested.
    const closureMarkers: { x: number; z: number }[] = [];
    for (const [dir, x1, x2, lz] of [
      [1, -0.72 * a, -0.28 * a, b],
      [-1, 0.28 * a, 0.72 * a, -b],
    ] as [1 | -1, number, number, number][]) {
      const lane = loopLanesMade.find((l) => l.dir === dir && l.k === loopLanes - 1)!;
      const p1 = toWorld(x1, 0, lz);
      const p2 = toWorld(x2, 0, lz);
      let s1 = laneS(lane, p1[0], p1[2]);
      let s2 = laneS(lane, p2[0], p2[2]);
      if ((s2 - s1 + lane.length) % lane.length > lane.length / 2) [s1, s2] = [s2, s1];
      lane.closure = { from: s1, to: s2 };
      const out: PathSample = { ...tmp };
      const span = (s2 - s1 + lane.length) % lane.length;
      for (let d = 0; d <= span; d += 6) {
        lanePose(lane, s1 + d, lane.k, out);
        closureMarkers.push({ x: out.x, z: out.z });
      }
    }

    const curb = loopLanesMade.find((l) => l.dir === 1 && l.k === loopLanes - 1)!;
    const eye: PathSample = { ...tmp };
    const look: PathSample = { ...tmp };
    lanePose(curb, curb.closure!.from - 34, loopLanes + 2.6, eye);
    lanePose(curb, curb.closure!.from + 26, 0.5, look);

    districts.push({
      index,
      key,
      placeId: placeOf[index].id,
      name: placeOf[index].name,
      cx,
      cz,
      ux,
      uz,
      wx,
      wz,
      a,
      b,
      roads: [loop],
      lanes: loopLanesMade,
      signals: [],
      street: { x: eye.x, y: 3.4, z: eye.z, lookX: look.x, lookY: 1.4, lookZ: look.z },
      closureMarkers,
    });
  });

  // 3. Arterials and the Outer Ring Road, with flyover / elevated stretches.
  let ring: { road: Road; lanes: Lane[] } | null = null;
  for (const route of ROUTES) {
    const closed = route.kind === 'ring';
    const ctrl = route.waypoints.map((w) => {
      const p = resolve(w);
      return new THREE.Vector3(p.x, 0, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(ctrl, closed, 'centripetal');
    const n = Math.max(40, Math.round(curve.getLength() / 3));
    const pts = curve.getSpacedPoints(n).map((v) => [v.x, 0, v.z] as P3);
    if (closed) pts.pop();

    if (route.elevated?.length) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
      const sAt = (placeId: string) => {
        const p = resolve({ place: placeId });
        let best = 0;
        let bestD = Infinity;
        pts.forEach((q, i) => {
          const d = (q[0] - p.x) ** 2 + (q[2] - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        return cum[best];
      };
      const regions = route.elevated.map((e) => {
        const sa = sAt(e.from);
        if (!e.to) return [sa - (e.radius ?? 110), sa + (e.radius ?? 110)];
        const sb = sAt(e.to);
        return [Math.min(sa, sb) - 100, Math.max(sa, sb) + 100];
      });
      pts.forEach((p, i) => {
        let h = 0;
        for (const [r0, r1] of regions) {
          const outside = Math.max(r0 - cum[i], cum[i] - r1, 0);
          h = Math.max(h, 1 - smooth(clamp01(outside / 70)));
        }
        p[1] = h * elevatedHeight;
      });
    }

    const road = makeRoad(closed ? 'ring' : 'arterial', route.name, -1, new CenterPath(pts, closed, 1), route.lanes, true);
    const made = makeLanes(road, closed ? SPEEDS.ring : SPEEDS.arterial);
    road.serves = districts.filter((d) => route.waypoints.some((w) => 'place' in w && w.place === d.placeId)).map((d) => d.index);
    if (closed) ring = { road, lanes: made };
  }

  // 4. Signalized junctions wherever two roads cross at grade (found with a coarse spatial hash).
  const CELL = 40;
  const STRIDE = 3;
  const grid = new Map<string, { road: Road; i: number }[]>();
  for (const road of roads) {
    const p = road.path;
    const last = p.closed ? p.n - 1 : p.n - 1 - STRIDE;
    for (let i = 0; i <= last; i += STRIDE) {
      const j = Math.min(p.n - 1, i + STRIDE);
      const x0 = Math.floor(Math.min(p.px[i], p.px[j]) / CELL);
      const x1 = Math.floor(Math.max(p.px[i], p.px[j]) / CELL);
      const z0 = Math.floor(Math.min(p.pz[i], p.pz[j]) / CELL);
      const z1 = Math.floor(Math.max(p.pz[i], p.pz[j]) / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const key = `${gx},${gz}`;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push({ road, i });
        }
      }
    }
  }
  const crossings: { a: Road; b: Road; x: number; z: number }[] = [];
  for (const list of grid.values()) {
    for (let m = 0; m < list.length; m++) {
      for (let n2 = m + 1; n2 < list.length; n2++) {
        const A = list[m];
        const B = list[n2];
        if (A.road === B.road) continue;
        if (A.road.kind === 'loop' && B.road.kind === 'loop') continue;
        const pa = A.road.path;
        const pb = B.road.path;
        const ja = Math.min(pa.n - 1, A.i + STRIDE);
        const jb = Math.min(pb.n - 1, B.i + STRIDE);
        const hit = segHit(pa.px[A.i], pa.pz[A.i], pa.px[ja], pa.pz[ja], pb.px[B.i], pb.pz[B.i], pb.px[jb], pb.pz[jb]);
        if (!hit) continue;
        const ya = pa.py[A.i] + (pa.py[ja] - pa.py[A.i]) * hit.t;
        const yb = pb.py[B.i] + (pb.py[jb] - pb.py[B.i]) * hit.u;
        if (Math.max(ya, yb) > 1.2) continue; // flyover / elevated: grade separated
        const x = pa.px[A.i] + (pa.px[ja] - pa.px[A.i]) * hit.t;
        const z = pa.pz[A.i] + (pa.pz[ja] - pa.pz[A.i]) * hit.t;
        if (crossings.some((c) => ((c.a === A.road && c.b === B.road) || (c.a === B.road && c.b === A.road)) && (c.x - x) ** 2 + (c.z - z) ** 2 < 30 * 30)) continue;
        crossings.push({ a: A.road, b: B.road, x, z });
      }
    }
  }

  const sigRnd = mulberry32(99);
  for (const c of crossings) {
    const [main, cross] = KIND_RANK[c.a.kind] <= KIND_RANK[c.b.kind] ? [c.a, c.b] : [c.b, c.a];
    let district = main.district >= 0 ? main.district : cross.district;
    if (district < 0) {
      const near = districts.find((d) => (d.cx - c.x) ** 2 + (d.cz - c.z) ** 2 < 130 * 130);
      district = near ? near.index : -1;
    }
    main.path.sample(main.path.project(c.x, c.z), tmp);
    const h = Math.hypot(tmp.tx, tmp.tz) || 1;
    const signal: Signal = {
      id: signals.length,
      district,
      x: c.x,
      z: c.z,
      tx: tmp.tx / h,
      tz: tmp.tz / h,
      halfMain: main.width / 2,
      halfCross: cross.width / 2,
      main,
      cross,
      offset: sigRnd() * 40,
      greenMain: 20,
      greenCross: 14,
      clock: 0,
      occ: [0, 0],
    };
    signals.push(signal);
    if (district >= 0) districts[district].signals.push(signal);
    for (const [road, other, phase] of [
      [main, cross, 0],
      [cross, main, 1],
    ] as [Road, Road, 0 | 1][]) {
      for (const lane of lanes) {
        if (lane.road !== road) continue;
        const sc = laneS(lane, c.x, c.z);
        const stop = sc - other.width / 2 - 1.5;
        if (lane.closed || stop > 0) lane.stops.push({ s: wrap(lane, stop), signal, phase, clear: other.width + 3 });
        lane.exits.push(sc);
        const entry = sc + other.width / 2 + 3;
        if (lane.closed || entry < lane.length - 20) lane.entries.push(wrap(lane, entry));
      }
    }
  }
  for (const lane of lanes) lane.stops.sort((p, q) => p.s - q.s);

  // 5. Namma Metro viaducts.
  const metro: MetroLine[] = METRO.map((line) => {
    const ctrl = line.waypoints.map((w) => {
      const p = resolve(w);
      return new THREE.Vector3(p.x, metroHeight, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const pts = curve.getSpacedPoints(Math.max(40, Math.round(curve.getLength() / 3))).map((v) => [v.x, metroHeight, v.z] as P3);
    const path = new CenterPath(pts, false, 1);
    const stations = line.stations.map((id) => {
      const p = resolve({ place: id });
      const s = path.project(p.x, p.z);
      path.sample(s, tmp);
      return { s, x: tmp.x, z: tmp.z };
    });
    return { id: line.id, name: line.name, color: line.color, path, stations };
  });

  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;
  const radius = Math.max(...positions.map((p) => Math.hypot(p.x - cx, p.z - cz))) + 260;

  return { roads, lanes, districts, ring: ring!, signals, metro, bounds: { cx, cz, radius } };
}

export type SignalLight = 'green' | 'amber' | 'red';

const AMBER = 3;
const ALL_RED = 1.5;

/** Two-phase fixed-time controller: main green → amber → all-red → cross green → amber → all-red. */
export function signalLight(sig: Signal, phase: 0 | 1): SignalLight {
  const cycle = sig.greenMain + sig.greenCross + 2 * (AMBER + ALL_RED);
  const t = (sig.clock + sig.offset) % cycle;
  const mainEnd = sig.greenMain;
  const crossStart = mainEnd + AMBER + ALL_RED;
  const crossEnd = crossStart + sig.greenCross;
  if (phase === 0) {
    if (t < mainEnd) return 'green';
    if (t < mainEnd + AMBER) return 'amber';
    return 'red';
  }
  if (t >= crossStart && t < crossEnd) return 'green';
  if (t >= crossEnd && t < crossEnd + AMBER) return 'amber';
  return 'red';
}
