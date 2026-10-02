import type { SceneStats } from '@/scene/CityScene/CityScene';

// Fully synthesized soundscape (no recordings):
// - city: hum, tyre/road hiss, engine rumble, horns, crossing beeps, birdsong — driven by the
//   focused neighbourhood's live simulation and the camera distance;
// - music: a modern lofi loop (swung boom-bap drums, Rhodes-style chords, sub bass, vinyl crackle);
// - UI sounds: little pops and chimes for buttons.
// The AudioContext is only created after a user gesture.

export type SoundMode = 'full' | 'city' | 'off';
export type UiSound = 'hover' | 'click' | 'start';

// Lofi: Fmaj9 · Em7 · Dm9 · G13, one chord per bar, at a laid-back 76 BPM with swing.
const CHORDS = [
  [87.31, 220, 261.63, 329.63, 392],
  [82.41, 196, 246.94, 293.66, 392],
  [73.42, 174.61, 220, 261.63, 329.63],
  [98, 174.61, 246.94, 329.63, 440],
];
const MELODY = [329.63, 392, 440, 523.25, 587.33, 659.25];
const EIGHTH = 60 / 76 / 2;
const SWING = 0.07;

type NoiseColor = 'white' | 'pink' | 'brown';

function noiseBuffer(ctx: AudioContext, color: NoiseColor, seconds = 4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') data[i] = w;
      else if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      } else {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.2;
      }
    }
  }
  return buf;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private ambience!: GainNode;
  private hiss!: GainNode;
  private hissFilter!: BiquadFilterNode;
  private rumble!: GainNode;
  private rumbleOsc: OscillatorNode[] = [];
  private noise: Record<NoiseColor, AudioBuffer> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stats: SceneStats | null = null;
  private muted = true;
  private mode: SoundMode = 'off';
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private echo!: DelayNode;
  private reverb!: ConvolverNode;
  private nextNote = 0;
  private step = 0;

  get running() {
    return this.ctx !== null && !this.muted;
  }

  get current() {
    return this.mode;
  }

  /** Switch between music + city, city only, or silence. Turning sound on must come from a user gesture. */
  async setMode(mode: SoundMode) {
    const wasMusic = this.mode === 'full';
    this.mode = mode;
    if (mode === 'off') {
      this.muted = true;
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const g of [this.master, this.musicBus, this.sfxBus]) g.gain.setTargetAtTime(0, now, 0.15);
      setTimeout(() => {
        if (this.muted) void this.ctx?.suspend();
      }, 600);
      return;
    }
    if (!this.ctx) this.build();
    await this.ctx!.resume();
    this.muted = false;
    const now = this.ctx!.currentTime;
    this.master.gain.setTargetAtTime(0.9, now, 0.6);
    this.sfxBus.gain.setTargetAtTime(0.7, now, 0.05);
    this.musicBus.gain.setTargetAtTime(mode === 'full' ? 0.55 : 0, now, 0.8);
    if (mode === 'full' && !wasMusic) {
      this.nextNote = now + 0.15;
      this.step = 0;
    }
  }

  /** Small game-UI sounds. Silent unless sound is on. */
  ui(kind: UiSound) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    if (kind === 'hover') {
      this.blip(1250, 1500, now, 0.035, 0.022, 'sine');
    } else if (kind === 'click') {
      this.blip(420, 860, now, 0.09, 0.07, 'triangle');
    } else {
      [587.33, 739.99, 880, 1174.66].forEach((f, i) => this.pluck(f, now + i * 0.075, 0.09, this.sfxBus, 0.9));
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.noise = { white: noiseBuffer(ctx, 'white'), pink: noiseBuffer(ctx, 'pink'), brown: noiseBuffer(ctx, 'brown', 6) };

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 2000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.muffle.connect(this.master).connect(comp).connect(ctx.destination);

    // Music and UI buses share a small room reverb and a dotted echo, bypassing the city muffle.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0;
    // Lofi warmth: the music runs through a soft low-pass with a slow "tape" wobble, plus vinyl crackle.
    const tapeLp = ctx.createBiquadFilter();
    tapeLp.type = 'lowpass';
    tapeLp.frequency.value = 2600;
    tapeLp.Q.value = 0.4;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.3;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 260;
    wobble.connect(wobbleDepth).connect(tapeLp.frequency);
    wobble.start();
    this.musicBus.connect(tapeLp).connect(comp);
    const crackleBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const cd = crackleBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * 0.04 + (Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 0.9 : 0);
    const crackle = ctx.createBufferSource();
    crackle.buffer = crackleBuf;
    crackle.loop = true;
    const crackleHp = ctx.createBiquadFilter();
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = 1200;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.05;
    crackle.connect(crackleHp).connect(crackleGain).connect(this.musicBus);
    crackle.start();
    this.sfxBus.connect(comp);
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2.2), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.musicBus);
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = EIGHTH * 1.5;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    tone.connect(this.musicBus);

    const loop = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start(0, Math.random() * buf.duration);
      return src;
    };

    // Low city hum.
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.2;
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 260;
    loop(this.noise.brown).connect(humLp).connect(this.ambience).connect(this.muffle);

    // Tyre / road hiss.
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 1100;
    this.hissFilter.Q.value = 0.5;
    loop(this.noise.pink).connect(this.hissFilter).connect(this.hiss).connect(this.muffle);

    // Engine rumble: detuned low saws with a slow wobble.
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 140;
    rumbleLp.connect(this.rumble).connect(this.muffle);
    for (const f of [46, 58.5, 71]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.2 + Math.random() * 0.4;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.12;
      lfo.connect(lfoGain).connect(g.gain);
      osc.connect(g).connect(rumbleLp);
      osc.start();
      lfo.start();
      this.rumbleOsc.push(osc);
    }

    this.timer = setInterval(() => this.tick(), 100);
  }

  update(stats: SceneStats) {
    this.stats = stats;
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const near = clamp(1 - Math.log(stats.cameraDistance / 25) / Math.log(2200 / 25));
    const density = stats.focusKey ? clamp(stats.vehicles / 320) : clamp(stats.totalVehicles / 2600);
    const moving = clamp(stats.meanSpeed / 12);

    this.muffle.frequency.setTargetAtTime(500 + 9500 * Math.pow(near, 1.6), now, 0.5);
    this.ambience.gain.setTargetAtTime(0.16 + 0.12 * (1 - near) + 0.06 * density, now, 0.8);
    this.hiss.gain.setTargetAtTime((0.015 + 0.3 * density * (0.35 + 0.65 * near)) * (0.3 + 0.7 * moving), now, 0.5);
    this.hissFilter.frequency.setTargetAtTime(700 + 900 * moving, now, 0.8);
    this.rumble.gain.setTargetAtTime(0.02 + 0.2 * density * (0.3 + 0.7 * near) * (0.6 + 0.4 * stats.stopped), now, 0.6);
    this.rumbleOsc.forEach((o, i) => o.frequency.setTargetAtTime([46, 58.5, 71][i] * (0.85 + 0.35 * moving), now, 1));
  }

  /** Short filtered-noise swell for camera journeys. */
  whoosh(duration = 2.4) {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.pink;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(260, now);
    bp.frequency.exponentialRampToValueAtTime(1600, now + duration * 0.45);
    bp.frequency.exponentialRampToValueAtTime(300, now + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.09, now + duration * 0.4);
    g.gain.linearRampToValueAtTime(0, now + duration);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.1);
  }

  private tick() {
    const ctx = this.ctx;
    if (ctx && !this.muted && this.mode === 'full') {
      while (this.nextNote < ctx.currentTime + 0.3) {
        this.musicStep(this.step, this.nextNote);
        this.nextNote += EIGHTH;
        this.step++;
      }
    }
    const s = this.stats;
    if (!ctx || this.muted || !s) return;
    const near = clamp(1 - Math.log(s.cameraDistance / 25) / Math.log(2200 / 25));
    const density = s.focusKey ? clamp(s.vehicles / 320) : clamp(s.totalVehicles / 2600);
    // Congestion and stopped queues → more impatient horns. Per 100 ms tick.
    const hornRate = (0.015 + density * (0.12 + 0.9 * s.congestion + 0.5 * s.stopped)) * (0.25 + 0.75 * near);
    if (Math.random() < hornRate * 0.15) this.horn(near, density);
    if (s.level === 'street' && Math.random() < 0.05 * (0.4 + s.congestion)) this.beep();
    // Birds carry over light traffic and fade under heavy flow.
    const calm = (1 - 0.75 * density) * (0.35 + 0.65 * near);
    if (Math.random() < 0.09 * calm) this.chirp(calm);
    if (Math.random() < 0.006 * calm) this.koel(calm);
  }

  private chirp(calm: number) {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.8 - 0.9;
    const g = ctx.createGain();
    g.gain.value = 0;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = 2600 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 3);
    const vol = (0.008 + Math.random() * 0.014) * calm;
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const len = 0.05 + Math.random() * 0.06;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + len * 0.6);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + len);
      t += len + 0.04 + Math.random() * 0.05;
    }
    o.connect(g).connect(pan).connect(this.master);
    o.start();
    o.stop(t + 0.05);
  }

  /** Asian koel: a rising two-note "ku-oo", repeated a few times. */
  private koel(calm: number) {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    let t = ctx.currentTime + 0.05;
    let pitch = 620 + Math.random() * 60;
    const vol = 0.022 * calm;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) {
      for (const [mult, len] of [[1, 0.16], [1.32, 0.34]]) {
        o.frequency.setValueAtTime(pitch * mult, t);
        o.frequency.linearRampToValueAtTime(pitch * mult * 1.04, t + len);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.03);
        g.gain.linearRampToValueAtTime(0, t + len);
        t += len + 0.06;
      }
      pitch *= 1.08;
      t += 0.35;
    }
    o.connect(bp).connect(g).connect(pan).connect(this.master);
    o.start();
    o.stop(t + 0.1);
  }

  private horn(near: number, density: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime + Math.random() * 0.05;
    const base = 330 + Math.random() * 180;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300 + Math.random() * 700;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    const vol = (0.02 + Math.random() * 0.05) * (0.3 + 0.7 * near) * (0.5 + 0.5 * density);
    const honks = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 2) : 1;
    let t = now;
    for (let h = 0; h < honks; h++) {
      const len = honks > 1 ? 0.09 + Math.random() * 0.08 : 0.18 + Math.random() * 0.45;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.setValueAtTime(vol, t + len);
      g.gain.linearRampToValueAtTime(0, t + len + 0.04);
      t += len + 0.09;
    }
    for (const mult of [1, 1.26]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * mult;
      o.connect(bp);
      o.start(now);
      o.stop(t + 0.1);
    }
    bp.connect(g).connect(pan).connect(this.muffle);
  }

  private beep() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2650;
    const g = ctx.createGain();
    g.gain.value = 0;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.22;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.07);
    }
    o.connect(g).connect(this.muffle);
    o.start(now);
    o.stop(now + 0.8);
  }

  /** One eighth-note of the lofi loop: Rhodes-style chords, sub bass, swung boom-bap drums. */
  private musicStep(step: number, t0: number) {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 8) % CHORDS.length;
    const beat = step % 8;
    const chord = CHORDS[bar];
    const t = t0 + (beat % 2 === 1 ? SWING : 0);

    // Keys: soft electric-piano voicing on the downbeat, a lighter re-stab on the "and" of 2.
    if (beat === 0 || (beat === 3 && Math.random() < 0.6)) {
      const vol = beat === 0 ? 0.05 : 0.03;
      for (const f of chord.slice(1)) this.keys(f, t + Math.random() * 0.015, vol, beat === 0 ? 2.4 : 1.2);
    }
    // Sub bass: root on 1, a passing note before the next bar.
    if (beat === 0 || (beat === 6 && Math.random() < 0.5)) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = beat === 0 ? chord[0] : chord[0] * 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + EIGHTH * (beat === 0 ? 5 : 2));
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + EIGHTH * 6);
    }
    // Kick on 1 and the "and" of 3; snare on 2 and 4; soft swung hats.
    if (beat === 0 || beat === 5) this.kick(t);
    if (beat === 2 || beat === 6) this.snare(t);
    if (Math.random() < 0.85) this.hat(t, beat % 2 === 0 ? 0.016 : 0.009);
    // A sparse, lazy melody note now and then.
    if ((beat === 1 || beat === 4 || beat === 7) && Math.random() < 0.22) {
      this.keys(MELODY[Math.floor(Math.random() * MELODY.length)], t, 0.035, 1.6);
    }
  }

  /** Rhodes-ish tone: sine with a soft bell partial and a little tape detune. */
  private keys(f: number, t: number, vol: number, len: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    const detune = (Math.random() - 0.5) * 14;
    for (const [mult, level] of [[1, 1], [2, 0.12], [3.01, 0.05]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      o.detune.value = detune;
      const v = ctx.createGain();
      v.gain.value = level;
      o.connect(v).connect(g);
      o.start(t);
      o.stop(t + len + 0.1);
    }
    g.connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    g.connect(send).connect(this.reverb);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp).connect(g).connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    g.connect(send).connect(this.reverb);
    src.start(t, Math.random() * 2, 0.25);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 185;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.05, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    body.connect(bg).connect(this.musicBus);
    body.start(t);
    body.stop(t + 0.1);
  }

  private hat(t: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!.white;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t, Math.random() * 2, 0.07);
  }

  private pluck(f: number, t: number, vol: number, bus: GainNode, echo: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
    for (const [mult, type, level] of [[1, 'sine', 1], [2.01, 'triangle', 0.18], [3.98, 'sine', 0.06]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const v = ctx.createGain();
      v.gain.value = level;
      o.connect(v).connect(g);
      o.start(t);
      o.stop(t + 1);
    }
    g.connect(bus);
    const send = ctx.createGain();
    send.gain.value = 0.35 * echo;
    g.connect(send);
    send.connect(this.echo);
    send.connect(this.reverb);
  }

  private blip(f0: number, f1: number, t: number, len: number, vol: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len + 0.04);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + len + 0.06);
  }
}
