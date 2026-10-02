// A road centerline resampled at uniform arc-length steps so lookups are O(1).

export type P3 = [number, number, number];

export interface PathSample {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
}

export class CenterPath {
  readonly closed: boolean;
  readonly length: number;
  readonly step: number;
  readonly n: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;

  constructor(points: P3[], closed: boolean, targetStep = 1) {
    this.closed = closed;
    const pts = closed ? [...points, points[0]] : points;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay, az] = pts[i - 1];
      const [bx, by, bz] = pts[i];
      cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay, bz - az));
    }
    this.length = cum[cum.length - 1];
    const segs = Math.max(2, Math.round(this.length / targetStep));
    this.step = this.length / segs;
    this.n = segs + 1;
    this.px = new Float32Array(this.n);
    this.py = new Float32Array(this.n);
    this.pz = new Float32Array(this.n);
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const s = i * this.step;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const span = cum[j + 1] - cum[j] || 1;
      const f = Math.min(1, Math.max(0, (s - cum[j]) / span));
      this.px[i] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
      this.py[i] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
      this.pz[i] = pts[j][2] + (pts[j + 1][2] - pts[j][2]) * f;
    }
  }

  /** Position + unit tangent at arc length `s` (wrapped on closed paths, clamped on open ones). */
  sample(s: number, out: PathSample): PathSample {
    const L = this.length;
    if (this.closed) s = ((s % L) + L) % L;
    else s = Math.min(L, Math.max(0, s));
    const fi = s / this.step;
    let i = Math.floor(fi);
    if (i >= this.n - 1) i = this.n - 2;
    const f = fi - i;
    const { px, py, pz } = this;
    out.x = px[i] + (px[i + 1] - px[i]) * f;
    out.y = py[i] + (py[i + 1] - py[i]) * f;
    out.z = pz[i] + (pz[i + 1] - pz[i]) * f;
    // Tangent from a slightly wider window for smoother orientation through corners.
    const a = Math.max(0, i - 1);
    const b = Math.min(this.n - 1, i + 2);
    let tx = px[b] - px[a];
    let ty = py[b] - py[a];
    let tz = pz[b] - pz[a];
    const len = Math.hypot(tx, ty, tz) || 1;
    tx /= len;
    ty /= len;
    tz /= len;
    out.tx = tx;
    out.ty = ty;
    out.tz = tz;
    return out;
  }

  /** Arc length of the sample closest to (x, z). Build-time only. */
  project(x: number, z: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best * this.step;
  }
}
