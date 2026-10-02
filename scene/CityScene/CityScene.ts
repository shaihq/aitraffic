import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { dofShader } from '@/shaders/edgeBlur';
import type { TrafficStateName } from '@/lib/types';
import type { TrafficSnapshot } from '@/lib/traffic-engine/snapshot';
import { buildNetwork, type Network } from '../RoadNetwork/network';
import { buildRoadMeshes, STATE_COLORS, type RoadMeshes } from '../RoadNetwork/RoadMeshes';
import type { PathSample } from '../RoadNetwork/CenterPath';
import { TrafficSimulation } from '../TrafficSimulation/TrafficSimulation';
import { VehicleSystem } from '../VehicleSystem/VehicleSystem';
import { MetroSystem } from '../Metro/MetroSystem';
import { PedestrianSystem } from '../Pedestrians/PedestrianSystem';
import { CameraController, type CameraLevel } from '../CameraController/CameraController';
import { buildEnvironment, buildSky, LABEL_FONT, LabelSprite, type WorldLabel } from './environment';
import { qualityProfile, type QualityProfile } from '../config';

// Imperative scene host. React owns the UI; this class owns the render loop, so the
// per-frame simulation never goes through React reconciliation.

export interface DistrictInfo {
  key: string;
  label: string;
  corridor: string;
  available: boolean;
}

export interface SceneStats {
  focusKey: string | null;
  level: CameraLevel;
  cameraDistance: number;
  vehicles: number;
  meanSpeed: number;
  stopped: number;
  braking: number;
  congestion: number;
  activity: number;
  totalVehicles: number;
}

export interface CitySceneOptions {
  districts: DistrictInfo[];
  reducedMotion: boolean;
  onPick?: (key: string | null) => void;
  onStats?: (stats: SceneStats) => void;
  onUserMove?: () => void;
}

/** Faint warm tint used only far away — depth of field does the rest, not haze. */
const DUSK = new THREE.Color('#e9c3a8');
/** Late-afternoon sun from the west-south-west: warm, but high enough to keep clay colours bright. */
const SUN_DIR = new THREE.Vector3(-0.72, 0.52, 0.42).normalize();

export class CityScene {
  private renderer: THREE.WebGLRenderer;
  /** Post chain: scene (+depth) → FXAA → depth-of-field H → V → output, ping-ponging A/B. */
  private post: { scene: THREE.WebGLRenderTarget; a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget; output: OutputPass } | null = null;
  private blurH: ShaderPass | null = null;
  private blurV: ShaderPass | null = null;
  private fxaa: ShaderPass | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private net: Network;
  private sim: TrafficSimulation;
  private vehicles: VehicleSystem;
  private metro: MetroSystem;
  private people: PedestrianSystem;
  private roads: RoadMeshes;
  private foliage: ReturnType<typeof buildEnvironment>['foliage'];
  private cameraCtl: CameraController;
  private districtLabels: LabelSprite[] = [];
  private worldLabels: { label: LabelSprite; at: WorldLabel }[] = [];
  private profile: QualityProfile;
  private raf = 0;
  private last = 0;
  private time = 0;
  private statsTimer = 0;
  private focusIndex: number | null = null;
  private snapshot: TrafficSnapshot | null = null;
  private populated = false;
  private reducedMotion: boolean;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement, private opts: CitySceneOptions) {
    this.profile = qualityProfile();
    this.reducedMotion = opts.reducedMotion;
    const shadows = this.profile.shadows;

    this.renderer = new THREE.WebGLRenderer({ antialias: this.profile.antialias && !this.profile.postprocess, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.profile.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'scene-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
    this.scene.background = DUSK;
    this.scene.fog = new THREE.FogExp2(DUSK, 0.0001);

    // Soft studio-like light for the clay diorama: bright sky fill, warm sun, soft shadows.
    this.scene.add(new THREE.HemisphereLight('#dceaff', '#9bd4ae', 1.5));
    this.sun = new THREE.DirectionalLight('#ffd7ad', 2.6);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 5;
    this.sun.shadow.blurSamples = 12;
    this.scene.add(this.sun, this.sun.target);

    this.net = buildNetwork(opts.districts.map((d) => d.key));
    const env = buildEnvironment(this.net, this.profile, shadows);
    this.foliage = env.foliage;
    this.roads = buildRoadMeshes(this.net, shadows);
    this.sim = new TrafficSimulation(this.net, this.profile);
    this.vehicles = new VehicleSystem(this.sim, this.net, shadows);
    const probe: PathSample = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1 };
    // Metro pillars must not land on an at-grade road.
    const onRoad = (x: number, z: number) =>
      this.net.roads.some((r) => {
        r.path.sample(r.path.project(x, z), probe);
        return probe.y < 2 && (probe.x - x) ** 2 + (probe.z - z) ** 2 < (r.width / 2 + 2) ** 2;
      });
    this.metro = new MetroSystem(this.net, shadows, onRoad);
    this.people = new PedestrianSystem(this.net, this.profile.pedestrians, shadows);
    this.scene.add(buildSky(SUN_DIR), env.group, this.roads.group, this.vehicles.group, this.metro.group, this.people.group);

    for (const d of this.net.districts) {
      const label = new LabelSprite(d.name, 'district');
      label.sprite.position.set(d.cx, 26, d.cz);
      this.scene.add(label.sprite);
      this.districtLabels.push(label);
    }
    for (const at of env.labels) {
      const label = new LabelSprite(at.text, at.kind);
      label.sprite.position.set(at.x, at.y, at.z);
      this.scene.add(label.sprite);
      this.worldLabels.push({ label, at });
    }

    // Pins use the game font; repaint once it has loaded.
    document.fonts?.load(`600 66px ${LABEL_FONT}`).then(() => {
      for (const l of this.districtLabels) l.redraw();
      for (const { label } of this.worldLabels) label.redraw();
    });

    this.cameraCtl = new CameraController(this.camera, this.renderer.domElement, this.net);
    this.cameraCtl.reducedMotion = this.reducedMotion;
    this.cameraCtl.onPick = (x, y) => this.pick(x, y);
    this.cameraCtl.onUserMove = () => opts.onUserMove?.();

    if (this.profile.postprocess) {
      // Depth of field around the focus point — the macro-lens look of a toy diorama. The scene
      // renders into its own target so its depth can be sampled without a feedback loop.
      const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
      const a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      const b = a.clone();
      this.fxaa = new ShaderPass(FXAAShader);
      this.blurH = new ShaderPass(dofShader('h'));
      this.blurV = new ShaderPass(dofShader('v'));
      this.blurH.uniforms.tDepth.value = sceneTarget.depthTexture;
      this.blurV.uniforms.tDepth.value = sceneTarget.depthTexture;
      const output = new OutputPass();
      output.renderToScreen = true;
      this.post = { scene: sceneTarget, a, b, output };
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.cameraCtl.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      });
    });
    if (this.post) for (const t of [this.post.scene, this.post.a, this.post.b]) t.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setReducedMotion(v: boolean) {
    this.reducedMotion = v;
    this.cameraCtl.reducedMotion = v;
  }

  setSnapshot(snapshot: TrafficSnapshot) {
    this.snapshot = snapshot;
    this.sim.setDrive(snapshot.drives, snapshot.hubActivity);
    if (!this.populated) {
      this.sim.populate();
      this.populated = true;
    } else {
      this.sim.rebalance();
    }
  }

  focus(key: string | null, level: CameraLevel, instant = false) {
    const idx = key ? this.net.districts.findIndex((d) => d.key === key) : -1;
    this.focusIndex = idx >= 0 ? idx : null;
    const lvl = this.focusIndex === null ? 'overview' : level;
    if (instant) this.cameraCtl.jumpTo(lvl, this.focusIndex);
    else this.cameraCtl.goTo(lvl, this.focusIndex);
  }

  /** Slow cinematic drift for the title screen. */
  setAttract(on: boolean) {
    this.cameraCtl.setAttract(on);
  }

  get level() {
    return this.cameraCtl.level;
  }

  private pick(x: number, y: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return;
    let best: number | null = null;
    let bestD = 160 * 160;
    for (const d of this.net.districts) {
      const dd = (d.cx - hit.x) ** 2 + (d.cz - hit.z) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d.index;
      }
    }
    this.opts.onPick?.(best === null ? null : this.net.districts[best].key);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.post) {
      const pr = this.renderer.getPixelRatio();
      for (const t of [this.post.scene, this.post.a, this.post.b]) t.setSize(Math.floor(w * pr), Math.floor(h * pr));
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(dt: number) {
    this.time += dt;
    const simDt = this.reducedMotion ? dt * 0.3 : dt;
    this.sim.step(simDt / 2);
    this.sim.step(simDt / 2);
    this.cameraCtl.update(dt);
    const r = this.cameraCtl.distance;
    const target = this.cameraCtl.view.target;

    // Only the far horizon picks up a dusk tint; nothing near the camera washes out.
    (this.scene.fog as THREE.FogExp2).density = 0.00014 * Math.pow(340 / Math.max(r, 20), 0.6);
    this.foliage.update(target, r);

    // Keep the shadow frustum around what the camera is looking at.
    const span = Math.min(2600, Math.max(140, r * 0.95));
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 10;
    cam.far = 6000;
    cam.updateProjectionMatrix();
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 2500);

    if (this.blurH && this.blurV) {
      const w = this.renderer.domElement.width;
      const h = this.renderer.domElement.height;
      const street = this.cameraCtl.level === 'street';
      const focus = this.camera.position.distanceTo(target);
      this.fxaa?.uniforms.resolution.value.set(1 / w, 1 / h);
      for (const pass of [this.blurH, this.blurV]) {
        const u = pass.uniforms;
        u.uTexel.value.set(1 / w, 1 / h);
        u.uNear.value = this.camera.near;
        u.uFar.value = this.camera.far;
        // Street level focuses on the traffic just ahead; above, on the point being looked at.
        u.uFocus.value = street ? 26 : focus;
        // Kept gentle: a hint of miniature lens at the edges, never fogging the city.
        u.uAperture.value = street ? 0.15 : r > 1500 ? 0.35 : 0.55;
        u.uMaxBlur.value = (street ? 1.8 : 2.5) * (h / 900);
        u.uEdge.value = (street ? 0.5 : 1) * (h / 900);
      }
    }

    const focused = this.focusIndex !== null && this.cameraCtl.level !== 'overview';
    for (let i = 0; i < this.vehicles.emphasis.length; i++) {
      const t = !focused || i === this.focusIndex ? 1 : 0.5;
      this.vehicles.emphasis[i] += (t - this.vehicles.emphasis[i]) * Math.min(1, dt * 2);
    }

    this.vehicles.update(simDt, this.camera.position);
    this.metro.update(simDt);
    this.people.update(simDt, this.time, target, r);
    const states = this.net.districts.map((d): TrafficStateName | 'NONE' => {
      if (!this.opts.districts[d.index].available) return 'NONE';
      return this.snapshot?.drives.find((x) => x.key === d.key)?.state ?? 'NONE';
    });
    // Live-traffic colour layer reads from afar and fades as you get close.
    const overlay = Math.min(1, Math.max(0, (r - 450) / 700));
    this.roads.update(this.sim.time, (i) => this.sim.isClosureActive(i), states, overlay);
    this.updateLabels(states);

    this.statsTimer += dt;
    if (this.statsTimer > 0.1 && this.opts.onStats) {
      this.statsTimer = 0;
      this.opts.onStats(this.stats());
    }
    if (this.post && this.fxaa && this.blurH && this.blurV) {
      const { scene: st, a, b, output } = this.post;
      this.renderer.setRenderTarget(st);
      this.renderer.render(this.scene, this.camera);
      this.fxaa.render(this.renderer, a, st, 0, false);
      this.blurH.render(this.renderer, b, a, 0, false);
      this.blurV.render(this.renderer, a, b, 0, false);
      output.render(this.renderer, null as unknown as THREE.WebGLRenderTarget, a, 0, false);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateLabels(states: (TrafficStateName | 'NONE')[]) {
    const camPos = this.camera.position;
    const level = this.cameraCtl.level;
    const r = this.cameraCtl.distance;
    const target = this.cameraCtl.view.target;
    const focused = this.focusIndex !== null && level !== 'overview';
    const fovScale = this.camera.fov / 30;
    this.districtLabels.forEach((label, i) => {
      const info = this.opts.districts[i];
      const state = states[i];
      const selected = i === this.focusIndex;
      const sub = info.available ? `${info.label} · ${state === 'NONE' ? 'NO DATA' : state}` : `${info.label} · NO CURRENT DATA`;
      label.draw(sub, STATE_COLORS[state], selected, focused && !selected);
      const dist = label.sprite.position.distanceTo(camPos);
      const w = Math.min(420, Math.max(40, dist * 0.085 * fovScale));
      label.sprite.scale.set(w, w * label.aspect, 1);
      label.sprite.visible = level !== 'street';
    });
    for (const { label, at } of this.worldLabels) {
      const dist = label.sprite.position.distanceTo(camPos);
      const near = Math.hypot(at.x - target.x, at.z - target.z);
      // Neighbourhood and landmark names appear as you zoom in, within the area in view.
      label.sprite.visible = r < 2200 && near < Math.max(500, r * 0.9) && level !== 'street';
      const w = Math.min(260, Math.max(26, dist * (at.kind === 'place' ? 0.06 : 0.05) * fovScale));
      label.sprite.scale.set(w, w * label.aspect, 1);
    }
  }

  private stats(): SceneStats {
    const idx = this.focusIndex;
    const key = idx !== null ? this.net.districts[idx].key : null;
    const local = idx !== null ? this.sim.districtStats(idx) : this.sim.globalStats();
    const drive = key ? this.snapshot?.drives.find((d) => d.key === key) : null;
    return {
      focusKey: key,
      level: this.cameraCtl.level,
      cameraDistance: this.cameraCtl.distance,
      vehicles: local.vehicles,
      meanSpeed: local.meanSpeed,
      stopped: local.stopped,
      braking: local.braking,
      congestion: drive?.congestion ?? 0,
      activity: drive ? drive.activity : this.snapshot?.hubActivity ?? 0,
      totalVehicles: this.sim.activeCount,
    };
  }
}
