import * as THREE from 'three';
import type { Network } from '../RoadNetwork/network';

// Three conceptual levels — overview, district, street — with journey-like transitions:
// the camera lifts, travels, and settles instead of teleporting. Input is deliberately simple:
// drag to look around, scroll/pinch to zoom, click a district to go there.

export type CameraLevel = 'overview' | 'district' | 'street';

interface View {
  target: THREE.Vector3;
  radius: number;
  phi: number;
  theta: number;
  fov: number;
}

interface Tween {
  from: View;
  to: View;
  t: number;
  duration: number;
  lift: number;
}

const LIMITS: Record<CameraLevel, { r: [number, number]; phi: [number, number] }> = {
  overview: { r: [900, 5600], phi: [0.2, 1.15] },
  district: { r: [90, 900], phi: [0.3, 1.3] },
  street: { r: [12, 140], phi: [0.85, 1.5] },
};

/** Looking north from slightly south-east, like a map — morning sun from the east. */
const MAP_THETA = 0.32;
const MINIATURE_FOV = 30;
const STREET_FOV = 50;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const angleLerp = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class CameraController {
  level: CameraLevel = 'overview';
  readonly view: View;
  private tween: Tween | null = null;
  private dragging = false;
  private down = { x: 0, y: 0, t: 0, moved: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  /** Smoothed zoom: input moves a target (in log-distance); the camera eases toward it each frame. */
  private zoomTarget: number | null = null;
  reducedMotion = false;
  /** Title-screen drift: a slow side-to-side pan around the current view. */
  private attract: { base: number; t: number } | null = null;
  onPick: ((ndcX: number, ndcY: number) => void) | null = null;
  onUserMove: (() => void) | null = null;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private net: Network,
  ) {
    this.view = this.viewFor('overview', null);
    dom.addEventListener('pointerdown', this.handleDown);
    window.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    window.addEventListener('pointercancel', this.handleUp);
    dom.addEventListener('wheel', this.handleWheel, { passive: false });
    this.apply();
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.handleDown);
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('pointercancel', this.handleUp);
    this.dom.removeEventListener('wheel', this.handleWheel);
  }

  get inTransition() {
    return this.tween !== null;
  }

  /** Distance from camera to its focus — used for fog, audio filtering and label sizing. */
  get distance() {
    return this.view.radius;
  }

  viewFor(level: CameraLevel, districtIndex: number | null): View {
    const d = districtIndex !== null ? this.net.districts[districtIndex] : null;
    if (level === 'overview' || !d) {
      const { cx, cz, radius } = this.net.bounds;
      return { target: new THREE.Vector3(cx, 0, cz), radius: radius * 2.5, phi: 0.62, theta: MAP_THETA, fov: MINIATURE_FOV };
    }
    if (level === 'district') {
      return { target: new THREE.Vector3(d.cx, 0, d.cz), radius: 340, phi: 0.82, theta: MAP_THETA + 0.15, fov: MINIATURE_FOV };
    }
    const st = d.street;
    const target = new THREE.Vector3(st.lookX, st.lookY, st.lookZ);
    const off = new THREE.Vector3(st.x - st.lookX, st.y - st.lookY, st.z - st.lookZ);
    const sph = new THREE.Spherical().setFromVector3(off);
    return { target, radius: sph.radius, phi: sph.phi, theta: sph.theta, fov: STREET_FOV };
  }

  /** Cut straight to a view (no journey) — used to set up the title screen. */
  jumpTo(level: CameraLevel, districtIndex: number | null) {
    this.level = level;
    this.zoomTarget = null;
    const v = this.viewFor(level, districtIndex);
    this.view.target.copy(v.target);
    this.view.radius = v.radius;
    this.view.phi = v.phi;
    this.view.theta = v.theta;
    this.view.fov = v.fov;
    this.tween = null;
    if (this.attract) this.attract.base = v.theta;
    this.apply();
  }

  setAttract(on: boolean) {
    this.attract = on && !this.reducedMotion ? { base: this.view.theta, t: 0 } : null;
  }

  goTo(level: CameraLevel, districtIndex: number | null) {
    this.attract = null;
    this.zoomTarget = null;
    this.level = level;
    const to = this.viewFor(level, districtIndex);
    const from: View = { ...this.view, target: this.view.target.clone() };
    const dist = from.target.distanceTo(to.target);
    const duration = this.reducedMotion ? 0.35 : clamp(1.9 + dist / 900, 2, 4.6);
    const lift = this.reducedMotion ? 0 : clamp(dist / (Math.max(from.radius, to.radius) * 1.6), 0, 1.6);
    this.tween = { from, to, t: 0, duration, lift };
  }

  update(dt: number) {
    if (this.zoomTarget !== null && !this.tween) {
      const cur = Math.log(this.view.radius);
      const k = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 11));
      const next = cur + (this.zoomTarget - cur) * k;
      this.view.radius = Math.exp(next);
      if (Math.abs(this.zoomTarget - next) < 0.0015) this.zoomTarget = null;
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const e = ease(tw.t);
      const bump = Math.sin(Math.PI * e);
      this.view.target.lerpVectors(tw.from.target, tw.to.target, e);
      this.view.radius = Math.exp(Math.log(tw.from.radius) + (Math.log(tw.to.radius) - Math.log(tw.from.radius)) * e) * (1 + tw.lift * bump);
      this.view.phi = tw.from.phi + (tw.to.phi - tw.from.phi) * e - 0.25 * tw.lift * bump;
      this.view.theta = angleLerp(tw.from.theta, tw.to.theta, e);
      this.view.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e;
      if (tw.t >= 1) this.tween = null;
    } else if (this.attract) {
      this.attract.t += dt;
      this.view.theta = this.attract.base + Math.sin(this.attract.t * 0.11) * 0.32;
    }
    this.apply();
  }

  private apply() {
    const { target, radius, phi, theta } = this.view;
    const off = new THREE.Vector3().setFromSphericalCoords(radius, clamp(phi, 0.05, 1.54), theta);
    this.camera.position.copy(target).add(off);
    if (this.camera.position.y < 1.2) this.camera.position.y = 1.2;
    this.camera.lookAt(target);
    const near = clamp(radius / 350, 0.4, 6);
    if (Math.abs(near - this.camera.near) > 0.05 || Math.abs(this.camera.fov - this.view.fov) > 0.01) {
      this.camera.near = near;
      this.camera.fov = this.view.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private interrupt() {
    this.tween = null;
    this.onUserMove?.();
  }

  private handleDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragging = true;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  private handleMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.dragging) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.down.moved += Math.abs(dx) + Math.abs(dy);
    if (this.down.moved < 4) return;
    if (this.tween) this.interrupt();
    this.attract = null;
    const lim = LIMITS[this.level];
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.zoomBy(Math.log(this.pinchDist / dist) * 1.15);
      this.pinchDist = dist;
      return;
    }
    this.view.theta -= dx * 0.0045;
    this.view.phi = clamp(this.view.phi - dy * 0.0035, lim.phi[0], lim.phi[1]);
  };

  private handleUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    this.dragging = false;
    const quick = performance.now() - this.down.t < 450;
    if (this.down.moved < 6 && quick && e.target === this.dom) {
      const rect = this.dom.getBoundingClientRect();
      this.onPick?.(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    }
  };

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.tween) this.interrupt();
    this.attract = null;
    // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels send large ones.
    const pinch = e.ctrlKey;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const sensitivity = pinch ? 0.011 : 0.0016;
    // Faster gestures travel proportionally further, so zooming feels accelerated and natural.
    const speed = Math.min(1, Math.abs(delta) / (pinch ? 18 : 120));
    this.zoomBy(delta * sensitivity * (1 + speed * 0.9));
  };

  private zoomBy(logDelta: number) {
    const lim = LIMITS[this.level];
    const base = this.zoomTarget ?? Math.log(this.view.radius);
    this.zoomTarget = clamp(base + logDelta, Math.log(lim.r[0]), Math.log(lim.r[1]));
  }
}
