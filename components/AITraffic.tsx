'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrafficPayload, TrafficStateName } from '@/lib/types';
import { computeScale, totalsScale } from '@/lib/analytics/metrics';
import { snapshotAt } from '@/lib/traffic-engine/snapshot';
import { formatDay, formatIso } from '@/lib/format';
import type { CityScene } from '@/scene/CityScene/CityScene';
import type { CameraLevel } from '@/scene/CameraController/CameraController';
import { AudioManager, type SoundMode } from '@/audio/AudioManager';
import { ModelNav } from './ModelNav/ModelNav';
import { ModelInfo } from './ModelInfo/ModelInfo';
import { Timeline } from './Timeline/Timeline';
import { AudioControl } from './AudioControl/AudioControl';
import { ViewControls } from './ViewControls/ViewControls';
import { AboutData } from './About/AboutData';
import { TitleScreen, type LoadStage } from './TitleScreen/TitleScreen';
import { IconInfo, SignalMark } from './ui/icons';
import { Banner } from './Banner/Banner';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
/** The title screen opens at street level in OpenAI's neighbourhood. */
const TITLE_PROVIDER = 'openai';

export default function AITraffic() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const audioRef = useRef<AudioManager | null>(null);

  const [stage, setStage] = useState<LoadStage>('connecting');
  const [phase, setPhase] = useState<'title' | 'play'>('title');
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TrafficPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [level, setLevel] = useState<CameraLevel>('street');
  const [cursor, setCursor] = useState(0);
  const [rangeDays, setRangeDays] = useState(30);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState<SoundMode>('full');
  const [soundLive, setSoundLive] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const audio = () => (audioRef.current ??= new AudioManager());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const on = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // 1. Data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStage('connecting');
      setError(null);
      await nextFrame();
      setStage('loading');
      try {
        const res = await fetch('/api/traffic');
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = (await res.json()) as TrafficPayload;
        if (cancelled) return;
        if (!data.dates?.length) throw new Error('No traffic data available');
        setPayload(data);
        setCursor(data.dates.length - 1);
        setRangeDays(data.dates.length >= 30 ? 30 : 7);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not reach the Bengaluru AI Traffic server');
        setStage('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const scale = useMemo(() => (payload ? computeScale(payload) : null), [payload]);
  const hubScale = useMemo(() => (payload ? totalsScale(payload) : null), [payload]);
  const snapshot = useMemo(
    () => (payload && scale && hubScale ? snapshotAt(payload, Math.min(cursor, payload.dates.length - 1), scale, hubScale) : null),
    [payload, cursor, scale, hubScale],
  );

  // Default selection: OpenAI for the title shot, else the first provider with meaningful usage.
  useEffect(() => {
    if (!payload || !scale || !hubScale || selected) return;
    const last = snapshotAt(payload, payload.dates.length - 1, scale, hubScale);
    const preferred = payload.providers.find((p) => p.key === TITLE_PROVIDER && p.available);
    const first = preferred ?? payload.providers.find((p) => p.available && (last.metrics[p.key]?.activityNormalized ?? 0) > 0.05);
    setSelected(first?.key ?? null);
  }, [payload, scale, hubScale, selected]);

  // 2. Scene (client-only, built once data exists), opening on the street-level title shot.
  useEffect(() => {
    if (!payload || !selected || !hostRef.current || sceneRef.current) return;
    let disposed = false;
    (async () => {
      setStage('building');
      await nextFrame();
      const { CityScene } = await import('@/scene/CityScene/CityScene');
      if (disposed || !hostRef.current) return;
      try {
        const scene = new CityScene(hostRef.current, {
          districts: payload.providers.map((p) => ({ key: p.key, label: p.label, corridor: p.corridor, available: p.available })),
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onPick: (key) => {
            const p = key ? payload.providers.find((x) => x.key === key) : null;
            if (!p?.available) return;
            setSelected(p.key);
            setLevel((l) => (l === 'overview' ? 'district' : l));
            sceneRef.current?.focus(p.key, sceneRef.current.level === 'overview' ? 'district' : sceneRef.current.level);
            audioRef.current?.whoosh();
          },
          onStats: (s) => audioRef.current?.update(s),
        });
        sceneRef.current = scene;
        scene.focus(selected, 'street', true);
        scene.setAttract(true);
        setStage('opening');
        scene.start();
        setTimeout(() => !disposed && setStage('ready'), 900);
      } catch (err) {
        setError(err instanceof Error ? `Could not start 3D view: ${err.message}` : 'WebGL is unavailable in this browser');
        setStage('error');
      }
    })();
    return () => {
      disposed = true;
    };
    // The title shot only needs the first selection; later selections move the camera instead.
  }, [payload, selected !== null]);

  useEffect(
    () => () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      audioRef.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (snapshot && sceneRef.current) sceneRef.current.setSnapshot(snapshot);
  }, [snapshot, stage]);

  useEffect(() => sceneRef.current?.setReducedMotion(reducedMotion), [reducedMotion, stage]);

  // Timeline playback.
  useEffect(() => {
    if (!playing || !payload) return;
    const id = setInterval(
      () => {
        setCursor((c) => {
          if (c >= payload.dates.length - 1) {
            setPlaying(false);
            return c;
          }
          return c + 1;
        });
      },
      reducedMotion ? 1500 : rangeDays > 90 ? 260 : 650,
    );
    return () => clearInterval(id);
  }, [playing, payload, rangeDays, reducedMotion]);

  // Game-feel click sounds for every button (silent while muted).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('button:not(:disabled)');
      if (el) audioRef.current?.ui('click');
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const focus = useCallback((key: string | null, lvl: CameraLevel) => {
    setLevel(key ? lvl : 'overview');
    sceneRef.current?.focus(key, lvl);
    audioRef.current?.whoosh();
  }, []);

  const changeSound = useCallback(async (mode: SoundMode) => {
    setSound(mode);
    await audio().setMode(mode);
    setSoundLive(mode !== 'off');
  }, []);

  const start = useCallback(() => {
    if (stage !== 'ready' || leaving) return;
    // This click is the user gesture that lets audio start.
    void audio()
      .setMode(sound)
      .then(() => {
        setSoundLive(sound !== 'off');
        audioRef.current?.ui('start');
      });
    setLeaving(true);
    sceneRef.current?.setAttract(false);
    focus(selected, 'district');
    setTimeout(() => setPhase('play'), reducedMotion ? 150 : 650);
  }, [stage, leaving, sound, selected, focus, reducedMotion]);

  const onSelect = (key: string) => {
    setSelected(key);
    focus(key, level === 'overview' ? 'district' : level);
  };

  const onLevel = (lvl: CameraLevel) => focus(lvl === 'overview' ? null : selected, lvl);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !aboutOpen && phase === 'play') focus(null, 'overview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, aboutOpen, phase]);

  const onRange = (days: number) => {
    if (!payload) return;
    setRangeDays(days);
    const startIdx = Math.max(0, payload.dates.length - days);
    setCursor((c) => Math.max(c, startIdx));
  };

  const onPlay = (p: boolean) => {
    if (p && payload && cursor >= payload.dates.length - 1) setCursor(Math.max(0, payload.dates.length - rangeDays));
    setPlaying(p);
  };

  // In play, the sound button cycles Music + city → City only → Muted.
  const cycleSound = () => {
    const next: SoundMode = !soundLive ? 'full' : sound === 'full' ? 'city' : 'off';
    void changeSound(next);
  };

  const provider = payload?.providers.find((p) => p.key === selected) ?? null;
  const lastDate = payload ? payload.dates[payload.dates.length - 1] : '';
  const states = useMemo(() => {
    const out: Record<string, TrafficStateName> = {};
    for (const d of snapshot?.drives ?? []) out[d.key] = d.state;
    return out;
  }, [snapshot]);

  const status = !payload
    ? null
    : payload.mode === 'live'
      ? { tone: 'live', text: `Live data · through ${formatDay(lastDate, false)}` }
      : payload.mode === 'cached'
        ? { tone: 'cached', text: `Cached data · updated ${formatIso(payload.fetchedAt)}` }
        : { tone: 'demo', text: 'Demo data — live data unavailable' };

  return (
    <>
      <Banner />
      <main className={`app app--${phase}`}>
        <div ref={hostRef} className="scene-host" aria-label="3D city traffic visualization" role="img" />

        {phase === 'play' && payload && (
          <>
            <header className="topbar">
              <div className="brand enter" style={{ ['--d' as string]: '0ms' }} data-from="top">
                <span className="brand__mark">
                  <SignalMark size={18} />
                </span>
                <div>
                  <h1>
                    <span className="brand__ai">AI TRAFFIC</span> <span className="brand__city">IN BENGALURU</span>
                  </h1>
                  <p>Live traffic across the AI model ecosystem</p>
                </div>
              </div>
            </header>

            <div className="rail enter" style={{ ['--d' as string]: '220ms' }} data-from="right">
              <ViewControls level={level} canFocus={Boolean(provider?.available)} onLevel={onLevel} />
              <div className="rail__group">
                <AudioControl mode={soundLive ? sound : 'off'} onToggle={cycleSound} />
                <button type="button" className="icon-btn" onClick={() => setAboutOpen(true)} aria-label="About the data" data-tip="About the data">
                  <IconInfo />
                </button>
              </div>
            </div>

            <div className="hud">
              {/* Desktop pins this to the top right; on phones it sits above the info card. */}
              <ModelNav providers={payload.providers} selected={selected} states={states} onSelect={onSelect} />
              {snapshot && (
                <div className="enter hud__info" style={{ ['--d' as string]: '300ms' }} data-from="bottom">
                  <ModelInfo
                    provider={provider}
                    metrics={provider ? snapshot.metrics[provider.key] : null}
                    events={snapshot.events}
                    cursorDate={snapshot.date}
                    cursorIndex={snapshot.index}
                    lastDate={lastDate}
                    mode={payload.mode}
                    totalTokens={snapshot.totalTokens}
                  />
                </div>
              )}
              <div className="enter hud__dock" style={{ ['--d' as string]: '400ms' }} data-from="bottom">
                <Timeline
                  dates={payload.dates}
                  cursor={cursor}
                  rangeDays={rangeDays}
                  playing={playing}
                  series={provider?.daily ?? payload.totals}
                  seriesLabel={provider ? `${provider.label} tokens per day` : 'All OpenRouter tokens per day'}
                  onCursor={(i) => {
                    setPlaying(false);
                    setCursor(i);
                  }}
                  onRange={onRange}
                  onPlay={onPlay}
                />
              </div>
            </div>

          </>
        )}

        {phase === 'title' && (
          <TitleScreen
            stage={stage}
            error={error}
            leaving={leaving}
            sound={sound}
            status={status}
            onSound={(m) => void changeSound(m)}
            onStart={start}
            onAbout={() => setAboutOpen(true)}
            onRetry={() => setAttempt((a) => a + 1)}
            onHover={() => audioRef.current?.ui('hover')}
          />
        )}

        {payload && <AboutData open={aboutOpen} onClose={() => setAboutOpen(false)} payload={payload} />}
      </main>
    </>
  );
}
