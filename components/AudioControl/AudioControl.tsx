'use client';

import type { SoundMode } from '@/audio/AudioManager';
import { IconMusic, IconSound } from '../ui/icons';

interface Props {
  mode: SoundMode;
  onToggle: () => void;
}

const LABEL: Record<SoundMode, string> = { full: 'Music + city', city: 'City only', off: 'Muted' };

/** Cycles Music + city → City only → Muted. Turning sound on is itself the user gesture. */
export function AudioControl({ mode, onToggle }: Props) {
  return (
    <button
      type="button"
      className={`icon-btn${mode !== 'off' ? ' is-on' : ''}`}
      onClick={onToggle}
      aria-label={`Sound: ${LABEL[mode]}. Click to change.`}
      data-tip={`Sound: ${LABEL[mode]}`}
    >
      {mode === 'full' ? <IconMusic /> : <IconSound on={mode === 'city'} />}
    </button>
  );
}
