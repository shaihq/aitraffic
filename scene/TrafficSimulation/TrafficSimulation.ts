import type { CorridorDrive } from '@/lib/types';
import { mulberry32, type Rng } from '@/lib/random';
import { TRAFFIC_SCALE, type QualityProfile } from '../config';
import { signalLight, type Lane, type Network } from '../RoadNetwork/network';

// Lightweight lane-based traffic: Intelligent Driver Model car-following, fixed-time signals,
// a lane-drop bottleneck, opportunistic (slightly impatient) lane changes and seeded randomness.
// Runs entirely outside React; state lives in typed arrays.

export const VEHICLE_TYPES = ['car', 'suv', 'auto', 'bike', 'bus', 'truck'] as const;
export const VEHICLE_LENGTH = [4.4, 4.8, 2.7, 2.0, 11, 8];
const TYPE_WEIGHTS = [0.4, 0.13, 0.16, 0.19, 0.05, 0.07];
const TYPE_SPEED = [1, 0.97, 0.78, 1.06, 0.8, 0.78];
const TYPE_ACCEL = [1.7, 1.5, 1.3, 2.3, 0.9, 0.9];
const BRAKE_COMFORT = 2.6;

const FADE_IN = 0.9;
const FADE_OUT = 0.7;

interface DistrictRuntime {
  speedFactor: number;
  targetSpeedFactor: number;
  closureActive: boolean;
  volatility: number;
}

function pickType(rng: Rng) {
  let r = rng();
  for (let i = 0; i < TYPE_WEIGHTS.length; i++) {
    r -= TYPE_WEIGHTS[i];
    if (r <= 0) return i;
  }
  return 0;
}

export class TrafficSimulation {
  readonly cap: number;
  readonly net: Network;
  readonly rng: Rng;

  // Vehicle state (structure of arrays).
  readonly lane: Int32Array;
  readonly s: Float32Array;
  readonly v: Float32Array;
  readonly acc: Float32Array;
  readonly lat: Float32Array;
  readonly latTarget: Float32Array;
  readonly latVel: Float32Array;
  readonly type: Uint8Array;
  readonly personal: Float32Array;
  readonly headway: Float32Array;
  readonly brake: Float32Array;
  readonly lcCool: Float32Array;
  readonly fade: Float32Array;
  readonly dying: Uint8Array;
  readonly active: Uint8Array;
  readonly tint: Float32Array;

  private free: number[] = [];
  readonly laneVehicles: number[][];
  private laneTarget: Int32Array;
  private laneAlive: Int32Array;
  private laneCool: Float32Array;
  private districts: DistrictRuntime[];
  private profile: QualityProfile;
  time = 0;

  constructor(net: Network, profile: QualityProfile, seed = 7) {
    this.net = net;
    this.profile = profile;
    this.cap = profile.maxVehicles;
    this.rng = mulberry32(seed);
    const n = this.cap;
    this.lane = new Int32Array(n);
    this.s = new Float32Array(n);
    this.v = new Float32Array(n);
    this.acc = new Float32Array(n);
    this.lat = new Float32Array(n);
    this.latTarget = new Float32Array(n);
    this.latVel = new Float32Array(n);
    this.type = new Uint8Array(n);
    this.personal = new Float32Array(n);
    this.headway = new Float32Array(n);
    this.brake = new Float32Array(n);
    this.lcCool = new Float32Array(n);
    this.fade = new Float32Array(n);
    this.dying = new Uint8Array(n);
    this.active = new Uint8Array(n);
    this.tint = new Float32Array(n);
    for (let i = n - 1; i >= 0; i--) this.free.push(i);
    this.laneVehicles = net.lanes.map(() => []);
    this.laneTarget = new Int32Array(net.lanes.length);
    this.laneAlive = new Int32Array(net.lanes.length);
    this.laneCool = new Float32Array(net.lanes.length);
    this.districts = net.districts.map(() => ({ speedFactor: 0.8, targetSpeedFactor: 0.8, closureActive: false, volatility: 0 }));
  }

  get activeCount() {
    return this.cap - this.free.length;
  }

  isClosureActive(district: number) {
    return this.districts[district]?.closureActive ?? false;
  }

  /** Map data-driven corridor conditions onto lane targets, speeds, signals and the bottleneck. */
  setDrive(drives: CorridorDrive[], hubActivity: number) {
    const { minFill, maxFill, activityCurve, growthBoost, jamBoost, jamSpacing } = TRAFFIC_SCALE;
    const byKey = new Map(drives.map((d) => [d.key, d]));
    const targets = new Float32Array(this.net.lanes.length);
    let total = 0;

    const fills = new Float32Array(this.net.districts.length);
    for (const district of this.net.districts) {
      const d = byKey.get(district.key);
      const rt = this.districts[district.index];
      const on = Boolean(d && d.available && d.activity > 0);
      const congestion = on ? d!.congestion : 0;
      rt.targetSpeedFactor = on ? 0.32 + 0.68 * d!.flowSpeed : 1;
      rt.closureActive = on && congestion >= 0.42;
      rt.volatility = on ? d!.volatility : 0;
      for (const sig of district.signals) {
        sig.greenMain = 22 - 11 * congestion;
        sig.greenCross = 12 + 8 * congestion;
      }
      const fill = on
        ? (minFill + (maxFill - minFill) * Math.pow(d!.activity, activityCurve)) * (1 + growthBoost * d!.growth) +
          (d!.state === 'JAMMED' ? jamBoost : 0)
        : 0;
      fills[district.index] = fill;
      for (const lane of district.lanes) {
        const t = (lane.length / jamSpacing) * fill * this.profile.vehicleScale;
        targets[lane.id] = t;
        total += t;
      }
    }
    // Outer Ring Road carries the whole ecosystem; arterials blend it with the districts they serve.
    const hubFill = 0.035 + 0.22 * Math.pow(hubActivity, 1.2);
    for (const lane of this.net.lanes) {
      if (lane.kind === 'loop') continue;
      let fill = hubFill;
      if (lane.kind === 'arterial' && lane.road.serves.length) {
        const mean = lane.road.serves.reduce((acc, i) => acc + fills[i], 0) / lane.road.serves.length;
        fill = 0.4 * hubFill + 0.6 * mean * 0.6;
      }
      const t = (lane.length / jamSpacing) * fill * this.profile.vehicleScale;
      targets[lane.id] = t;
      total += t;
    }
    const budget = this.cap * 0.92;
    const k = total > budget ? budget / total : 1;
    for (let i = 0; i < targets.length; i++) this.laneTarget[i] = Math.round(targets[i] * k);
  }

  /**
   * Snap lanes most of the way to new targets right away (e.g. when the timeline is scrubbed):
   * surplus vehicles fade out, missing ones pop in at free spots. The normal turn-in / turn-off
   * flow then settles the rest, so changes are visible within a second instead of minutes.
   */
  rebalance() {
    for (const lane of this.net.lanes) {
      const list = this.laneVehicles[lane.id];
      const alive = list.filter((i) => !this.dying[i]);
      const target = this.laneTarget[lane.id];
      const diff = target - alive.length;
      if (diff < -1) {
        // Remove an evenly spread share of the surplus.
        const remove = Math.round(-diff * 0.8);
        const stride = alive.length / Math.max(1, remove);
        for (let k = 0; k < remove; k++) this.dying[alive[Math.floor(k * stride)]] = 1;
      } else if (diff > 1) {
        const add = Math.round(diff * 0.8);
        let added = 0;
        for (let k = 0; k < add * 3 && added < add && this.free.length; k++) {
          const s = this.rng() * (lane.closed ? lane.length : lane.length - 12) + (lane.closed ? 0 : 6);
          if (lane.closure && this.districts[lane.district]?.closureActive && this.inClosure(lane, s, 10)) continue;
          const [ahead, aheadS, behind, behindS] = this.neighbours(lane, s);
          if ((ahead >= 0 && aheadS - s < 10) || (behind >= 0 && s - behindS < 10)) continue;
          const i = this.spawn(lane, s, ahead >= 0 ? Math.min(this.v[ahead], lane.baseSpeed * 0.7) : lane.baseSpeed * 0.6);
          if (i < 0) break;
          const l = this.laneVehicles[lane.id];
          l.pop();
          let pos = 0;
          while (pos < l.length && this.s[l[pos]] < s) pos++;
          l.splice(pos, 0, i);
          added++;
        }
      }
    }
  }

  /** Fill lanes to their targets immediately (first frame), so the city opens already alive. */
  populate() {
    for (const lane of this.net.lanes) {
      const target = this.laneTarget[lane.id];
      const spacing = lane.length / Math.max(1, target);
      for (let j = 0; j < target; j++) {
        const s = (j + 0.2 + this.rng() * 0.6) * spacing;
        if (s > lane.length - 2) continue;
        if (lane.closure && this.inClosure(lane, s, 10)) continue;
        this.spawn(lane, s, lane.baseSpeed * 0.6, 1);
      }
    }
    for (const list of this.laneVehicles) list.sort((a, b) => this.s[a] - this.s[b]);
  }

  private inClosure(lane: Lane, s: number, margin: number) {
    const c = lane.closure!;
    const span = (c.to - c.from + lane.length) % lane.length;
    const d = (s - (c.from - margin) + lane.length) % lane.length;
    return d <= span + margin;
  }

  private spawn(lane: Lane, s: number, v: number, fade = 0): number {
    const i = this.free.pop();
    if (i === undefined) return -1;
    const rng = this.rng;
    const t = pickType(rng);
    this.active[i] = 1;
    this.dying[i] = 0;
    this.lane[i] = lane.id;
    this.s[i] = s;
    this.v[i] = v;
    this.acc[i] = 0;
    this.lat[i] = lane.k;
    this.latTarget[i] = lane.k;
    this.latVel[i] = 0;
    this.type[i] = t;
    this.personal[i] = TYPE_SPEED[t] * (0.88 + rng() * 0.24);
    this.headway[i] = 0.9 + rng() * 0.55;
    this.brake[i] = 0;
    this.lcCool[i] = rng() * 2;
    this.fade[i] = fade;
    this.tint[i] = rng();
    this.laneVehicles[lane.id].push(i);
    return i;
  }

  private release(i: number) {
    this.active[i] = 0;
    this.free.push(i);
  }

  private v0(i: number, lane: Lane) {
    const factor = lane.district >= 0 ? this.districts[lane.district].speedFactor : 1;
    return lane.baseSpeed * factor * this.personal[i] * (this.brake[i] > 0 ? 0.12 : 1);
  }

  /** IDM acceleration toward an obstacle `gap` metres ahead moving at `vl`. */
  private idm(i: number, v0: number, gap: number, vl: number) {
    const t = this.type[i];
    const a = TYPE_ACCEL[t];
    const v = this.v[i];
    const s0 = t === 3 ? 1 : 1.8;
    const sStar = s0 + Math.max(0, v * this.headway[i] + (v * (v - vl)) / (2 * Math.sqrt(a * BRAKE_COMFORT)));
    const free = 1 - Math.pow(v / Math.max(0.1, v0), 4);
    return a * (free - (sStar / Math.max(gap, 0.2)) ** 2);
  }

  private freeAccel(i: number, v0: number) {
    return TYPE_ACCEL[this.type[i]] * (1 - Math.pow(this.v[i] / Math.max(0.1, v0), 4));
  }

  /** Acceleration of vehicle i if it were in `lane` at its current s, with given leader. */
  private accelInLane(i: number, lane: Lane, leader: number, leaderS: number) {
    const v0 = this.v0(i, lane);
    let acc = this.freeAccel(i, v0);
    const len = VEHICLE_LENGTH[this.type[i]];
    if (leader >= 0) {
      const gap = leaderS - this.s[i] - (VEHICLE_LENGTH[this.type[leader]] + len) / 2;
      acc = Math.min(acc, this.idm(i, v0, gap, this.v[leader]));
    }
    // Signals and the junction box.
    for (const stop of lane.stops) {
      let d = stop.s - this.s[i] - len / 2;
      if (lane.closed) d = ((d % lane.length) + lane.length) % lane.length;
      if (d < 0 || d > 90) continue;
      if (d > lane.length - 6) continue;
      const light = signalLight(stop.signal, stop.phase);
      const v = this.v[i];
      let hold = light === 'red' || (light === 'amber' && d >= (v * v) / (2 * 3.2) + 1);
      if (!hold && d < 22) {
        // Yield while cross traffic is still clearing the box…
        if (stop.signal.occ[stop.phase === 0 ? 1 : 0] > 0) hold = true;
        // …and don't enter if the queue beyond would leave us stuck inside it.
        if (leader >= 0) {
          let beyond = leaderS - stop.s;
          if (lane.closed && beyond < -lane.length / 2) beyond += lane.length;
          const room = beyond - VEHICLE_LENGTH[this.type[leader]] / 2;
          if (beyond > 0 && room < stop.clear + len + 1.5 && this.v[leader] < 1.5) hold = true;
        }
      }
      if (!hold) continue;
      acc = Math.min(acc, this.idm(i, v0, d + 0.5, 0));
      break;
    }
    // Lane drop.
    if (lane.closure && lane.district >= 0 && this.districts[lane.district].closureActive) {
      const d = (lane.closure.from - this.s[i] - len / 2 + lane.length) % lane.length;
      if (d < 160 && !this.inClosure(lane, this.s[i], 0)) acc = Math.min(acc, this.idm(i, v0, d + 0.3, 0));
    }
    return acc;
  }

  private leaderOf(list: number[], pos: number, lane: Lane): [number, number] {
    if (pos + 1 < list.length) return [list[pos + 1], this.s[list[pos + 1]]];
    if (lane.closed && list.length > 1) return [list[0], this.s[list[0]] + lane.length];
    return [-1, 0];
  }

  /** Neighbours of position s in a sorted lane list: [ahead, aheadS, behind, behindS]. */
  private neighbours(lane: Lane, s: number): [number, number, number, number] {
    const list = this.laneVehicles[lane.id];
    if (list.length === 0) return [-1, 0, -1, 0];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.s[list[mid]] < s) lo = mid + 1;
      else hi = mid;
    }
    let ahead = lo < list.length ? list[lo] : -1;
    let aheadS = ahead >= 0 ? this.s[ahead] : 0;
    let behind = lo > 0 ? list[lo - 1] : -1;
    let behindS = behind >= 0 ? this.s[behind] : 0;
    if (lane.closed) {
      if (ahead < 0) {
        ahead = list[0];
        aheadS = this.s[ahead] + lane.length;
      }
      if (behind < 0) {
        behind = list[list.length - 1];
        behindS = this.s[behind] - lane.length;
      }
    }
    return [ahead, aheadS, behind, behindS];
  }

  private tryLaneChange(i: number, lane: Lane, currentAcc: number, forced: boolean): boolean {
    const lanes = this.net.lanes;
    const len = VEHICLE_LENGTH[this.type[i]];
    const s = this.s[i];
    const options = forced ? [lane.k - 1] : this.rng() < 0.5 ? [lane.k - 1, lane.k + 1] : [lane.k + 1, lane.k - 1];
    for (const k of options) {
      if (k < 0 || k >= lane.group.length) continue;
      const target = lanes[lane.group[k]];
      if (target.closure && target.district >= 0 && this.districts[target.district].closureActive && this.inClosure(target, s, 40)) continue;
      const [ahead, aheadS, behind, behindS] = this.neighbours(target, s);
      const gapAhead = ahead >= 0 ? aheadS - s - (VEHICLE_LENGTH[this.type[ahead]] + len) / 2 : 999;
      const gapBehind = behind >= 0 ? s - behindS - (VEHICLE_LENGTH[this.type[behind]] + len) / 2 : 999;
      const vb = behind >= 0 ? this.v[behind] : 0;
      const needBehind = forced ? 1.2 + vb * 0.25 : 2.5 + vb * 0.55;
      if (gapAhead < (forced ? 1.5 : 4) || gapBehind < needBehind) continue;
      const accTarget = this.accelInLane(i, target, ahead, aheadS);
      if (!forced && accTarget < currentAcc + 0.35) continue;
      // Commit.
      const from = this.laneVehicles[lane.id];
      from.splice(from.indexOf(i), 1);
      const to = this.laneVehicles[target.id];
      let pos = 0;
      while (pos < to.length && this.s[to[pos]] < s) pos++;
      to.splice(pos, 0, i);
      this.lane[i] = target.id;
      this.latTarget[i] = target.k;
      this.lcCool[i] = 2.5 + this.rng() * 2;
      return true;
    }
    return false;
  }

  step(rawDt: number) {
    const dt = Math.min(rawDt, 0.05);
    if (dt <= 0) return;
    this.time += dt;
    const rng = this.rng;
    const lanes = this.net.lanes;

    for (const sig of this.net.signals) sig.clock += dt;
    for (const rt of this.districts) rt.speedFactor += (rt.targetSpeedFactor - rt.speedFactor) * Math.min(1, dt * 0.35);

    // 0. Who is inside each junction box right now.
    for (const sig of this.net.signals) sig.occ[0] = sig.occ[1] = 0;
    for (const lane of lanes) {
      if (!lane.stops.length) continue;
      for (const i of this.laneVehicles[lane.id]) {
        const half = VEHICLE_LENGTH[this.type[i]] / 2;
        for (const stop of lane.stops) {
          let d = this.s[i] - stop.s;
          if (lane.closed && d < -lane.length / 2) d += lane.length;
          if (lane.closed && d > lane.length / 2) d -= lane.length;
          if (d > -half && d < stop.clear + half) stop.signal.occ[stop.phase]++;
        }
      }
    }

    // 1. Keep lane lists sorted (nearly sorted already → insertion sort is cheap).
    for (const list of this.laneVehicles) {
      for (let a = 1; a < list.length; a++) {
        const id = list[a];
        const sv = this.s[id];
        let b = a - 1;
        while (b >= 0 && this.s[list[b]] > sv) {
          list[b + 1] = list[b];
          b--;
        }
        list[b + 1] = id;
      }
    }

    // 2. Accelerations + lane-change decisions.
    for (const lane of lanes) {
      const list = this.laneVehicles[lane.id];
      const rt = lane.district >= 0 ? this.districts[lane.district] : null;
      for (let p = 0; p < list.length; p++) {
        const i = list[p];
        const [leader, leaderS] = this.leaderOf(list, p, lane);
        const a = this.accelInLane(i, lane, leader, leaderS);
        this.acc[i] = a;

        if (this.brake[i] > 0) this.brake[i] -= dt;
        else if (rt && rng() < (0.0015 + 0.03 * rt.volatility) * dt) this.brake[i] = 0.8 + rng() * 1.6;

        this.lcCool[i] -= dt;
        if (this.lcCool[i] > 0 || lane.group.length < 2 || this.dying[i] || Math.abs(this.lat[i] - lane.k) > 0.1) continue;
        const forced =
          !!lane.closure && !!rt?.closureActive && ((lane.closure.from - this.s[i] + lane.length) % lane.length) < 110 && !this.inClosure(lane, this.s[i], 0);
        const blocked = a < this.freeAccel(i, this.v0(i, lane)) - 0.8;
        const weave = rt ? rng() < 0.04 + 0.12 * rt.volatility : false;
        if (forced || blocked || weave) {
          if (this.tryLaneChange(i, lane, a, forced)) p--; // list shifted left under us
          else this.lcCool[i] = forced ? 0.2 : 0.6 + rng() * 0.6;
        } else {
          this.lcCool[i] = 0.5 + rng() * 0.8;
        }
      }
    }

    // 3. Integrate, lateral motion, exits, despawns.
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li];
      const list = this.laneVehicles[li];
      let alive = 0;
      for (let p = list.length - 1; p >= 0; p--) {
        const i = list[p];
        const v = Math.max(0, this.v[i] + this.acc[i] * dt);
        const prevS = this.s[i];
        let s = prevS + Math.max(0, (this.v[i] + v) * 0.5 * dt);
        this.v[i] = v;

        const dl = this.latTarget[i] - this.lat[i];
        const stepLat = Math.sign(dl) * Math.min(Math.abs(dl), dt * 0.75);
        this.lat[i] += stepLat;
        this.latVel[i] = stepLat / dt;

        if (this.dying[i]) {
          this.fade[i] -= dt / FADE_OUT;
          if (this.fade[i] <= 0) {
            list.splice(p, 1);
            this.release(i);
            continue;
          }
        } else if (this.fade[i] < 1) {
          this.fade[i] = Math.min(1, this.fade[i] + dt / FADE_IN);
        }

        if (lane.closed && s >= lane.length) s -= lane.length;
        if (!lane.closed && s >= lane.length - 4) {
          if (!this.dying[i]) this.dying[i] = 1;
          if (s >= lane.length + 2) {
            list.splice(p, 1);
            this.release(i);
            continue;
          }
        } else if (!this.dying[i] && this.laneAlive[li] > this.laneTarget[li] && this.laneCool[li] <= 0) {
          // Surplus vehicles "turn off" at junctions, so declining usage thins traffic gradually.
          for (const e of lane.exits) {
            const crossed = prevS <= e ? s >= e || (lane.closed && s < prevS) : lane.closed && s >= e && s < prevS;
            if (crossed) {
              this.dying[i] = 1;
              this.laneCool[li] = 0.3 + rng() * 0.4;
              break;
            }
          }
        }
        this.s[i] = s;
        if (!this.dying[i]) alive++;
      }
      this.laneAlive[li] = alive;
    }

    // 4. Spawn toward targets (rate-limited so changes in usage arrive/clear gradually).
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li];
      this.laneCool[li] -= dt;
      const deficit = this.laneTarget[li] - this.laneAlive[li];
      if (deficit <= 0 || this.laneCool[li] > 0 || this.free.length === 0) continue;
      const list = this.laneVehicles[li];
      // Open roads: enter at the city edge, or turn in at a junction. Loops: turn in at junctions.
      if (!lane.closed && (lane.entries.length === 0 || rng() < 0.4)) {
        const first = list.length ? list[0] : -1;
        if (first >= 0 && this.s[first] - VEHICLE_LENGTH[this.type[first]] < 9) continue;
        const v0 = lane.baseSpeed * (lane.district >= 0 ? this.districts[lane.district].speedFactor : 1);
        this.spawn(lane, 0, first >= 0 ? Math.min(v0 * 0.8, this.v[first] + 1) : v0 * 0.8);
        list.unshift(list.pop()!);
        this.laneCool[li] = Math.max(0.15, Math.min(1.5, 2 / deficit)) * (0.5 + rng());
      } else {
        const e = lane.entries[Math.floor(rng() * lane.entries.length)];
        if (e === undefined) continue;
        if (lane.closure && this.districts[lane.district]?.closureActive && this.inClosure(lane, e, 15)) continue;
        const [ahead, aheadS, behind, behindS] = this.neighbours(lane, e);
        const gapA = ahead >= 0 ? aheadS - e : 999;
        const gapB = behind >= 0 ? e - behindS : 999;
        if (gapA < 11 || gapB < 9 + (behind >= 0 ? this.v[behind] : 0)) {
          this.laneCool[li] = 0.15;
          continue;
        }
        const i = this.spawn(lane, e, ahead >= 0 ? Math.min(this.v[ahead], lane.baseSpeed * 0.7) : lane.baseSpeed * 0.6);
        if (i >= 0) {
          list.pop();
          let pos = 0;
          while (pos < list.length && this.s[list[pos]] < e) pos++;
          list.splice(pos, 0, i);
        }
        this.laneCool[li] = Math.max(0.12, Math.min(1.2, 1.5 / deficit));
      }
    }
  }

  /** Local conditions around a district for audio / overlay (cheap; call at ~10 Hz). */
  districtStats(index: number) {
    const d = this.net.districts[index];
    let n = 0;
    let speed = 0;
    let braking = 0;
    let stopped = 0;
    for (const lane of d.lanes) {
      for (const i of this.laneVehicles[lane.id]) {
        n++;
        speed += this.v[i];
        if (this.acc[i] < -1.2) braking++;
        if (this.v[i] < 1) stopped++;
      }
    }
    return { vehicles: n, meanSpeed: n ? speed / n : 0, braking: n ? braking / n : 0, stopped: n ? stopped / n : 0 };
  }

  globalStats() {
    let n = 0;
    let speed = 0;
    let stopped = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.active[i]) continue;
      n++;
      speed += this.v[i];
      if (this.v[i] < 1) stopped++;
    }
    return { vehicles: n, meanSpeed: n ? speed / n : 0, braking: 0, stopped: n ? stopped / n : 0 };
  }
}
