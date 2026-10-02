'use client';

import { useEffect } from 'react';
import type { SoundMode } from '@/audio/AudioManager';
import { Segmented } from '../ui/Segmented';
import { IconInfo } from '../ui/icons';

export type LoadStage = 'connecting' | 'loading' | 'building' | 'opening' | 'ready' | 'error';

const STEPS: { stage: LoadStage; label: string }[] = [
  { stage: 'connecting', label: 'Connecting to Bengaluru AI Traffic' },
  { stage: 'loading', label: 'Loading model data' },
  { stage: 'building', label: 'Building Bangalore' },
  { stage: 'opening', label: 'Opening roads' },
];

interface Props {
  stage: LoadStage;
  error: string | null;
  leaving: boolean;
  sound: SoundMode;
  status: { tone: string; text: string } | null;
  onSound: (mode: SoundMode) => void;
  onStart: () => void;
  onAbout: () => void;
  onRetry: () => void;
  onHover: () => void;
}

/**
 * Game-style start screen. The city loads behind it (the Start button doubles as the loading
 * bar), then shows the street-level view while the camera drifts. Start flies up into the city.
 */
export function TitleScreen({ stage, error, leaving, sound, status, onSound, onStart, onAbout, onRetry, onHover }: Props) {
  const ready = stage === 'ready';
  const step = STEPS.findIndex((s) => s.stage === stage);
  const progress = ready ? 1 : Math.max(0.08, (step + 0.6) / STEPS.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && ready && !leaving) onStart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, leaving, onStart]);

  return (
    <div className={`title${ready ? ' is-ready' : ''}${leaving ? ' is-leaving' : ''}`} aria-live="polite">
      <div className="title__backdrop" aria-hidden="true" />
      <div className="title__shade" aria-hidden="true" />

      <div className="title__logo">
        <h1 className="logo">
          <span className="logo__word">AI TRAFFIC</span>
          <span className="logo__sub">IN BENGALURU</span>
        </h1>
        <p className="title__tag">Live traffic across the AI model ecosystem</p>
        <p className="title__sub">A miniature Bangalore where every car is AI demand, from real OpenRouter usage.</p>
      </div>

      <div className="title__menu plate">
        {stage === 'error' ? (
          <>
            <p className="title__error">{error ?? 'Something went wrong.'}</p>
            <button type="button" className="gbtn gbtn--primary gbtn--xl" onClick={onRetry} onMouseEnter={onHover}>
              Try again
            </button>
          </>
        ) : (
          <button type="button" className="gbtn gbtn--primary gbtn--xl" disabled={!ready} onClick={onStart} onMouseEnter={onHover}>
            {ready ? (
              'Start'
            ) : (
              <span className="loadbar">
                <span className="loadbar__fill" style={{ transform: `scaleX(${progress})` }} />
                <span className="loadbar__text">{STEPS[Math.max(0, step)]?.label}…</span>
              </span>
            )}
          </button>
        )}

        <div className="title__sound">
          <span className="title__label">Sound</span>
          <Segmented
            label="Sound"
            value={sound}
            onChange={onSound}
            items={[
              { value: 'full' as SoundMode, label: 'Music + city' },
              { value: 'city' as SoundMode, label: 'City only' },
              { value: 'off' as SoundMode, label: 'Muted' },
            ]}
          />
          <span className="title__hint">{sound === 'off' ? 'You can turn sound on later.' : 'Headphones recommended.'}</span>
        </div>

        <button type="button" className="gbtn" onClick={onAbout} onMouseEnter={onHover}>
          <IconInfo size={18} />
          About the data
        </button>
      </div>

      <div className="title__foot">
        {status && (
          <span className={`status status--${status.tone}`}>
            <span className="dot" />
            {status.text}
          </span>
        )}
        {ready && <span className="title__press">Press Enter to start</span>}
      </div>

      <a className="title__credit" href="https://sael.net/token-town/" target="_blank" rel="noreferrer">
        Inspired by Ryan Sael
      </a>
    </div>
  );
}
