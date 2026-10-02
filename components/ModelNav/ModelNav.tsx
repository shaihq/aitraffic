'use client';

import { useEffect, useState } from 'react';
import type { ProviderSeries, TrafficStateName } from '@/lib/types';
import { Segmented } from '../ui/Segmented';
import { IconChevronSide } from '../ui/icons';
import { stateColor } from '../ui/state';

interface Props {
  providers: ProviderSeries[];
  selected: string | null;
  states: Record<string, TrafficStateName>;
  onSelect: (key: string) => void;
}

/** How many model tabs fit at once: four on desktop, three on narrow phones. */
function usePageSize() {
  const [size, setSize] = useState(4);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    const on = () => setSize(mq.matches ? 3 : 4);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return size;
}

/** Model tabs, a page at a time, with chevrons to move between pages. */
export function ModelNav({ providers, selected, states, onSelect }: Props) {
  const size = usePageSize();
  const n = providers.length;
  const maxOffset = Math.max(0, n - size);
  const [offset, setOffset] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);

  // Keep the selected model on screen (e.g. after picking a neighbourhood on the map).
  useEffect(() => {
    const i = providers.findIndex((p) => p.key === selected);
    if (i < 0) return;
    setOffset((o) => (i >= o && i < o + size ? Math.min(o, maxOffset) : Math.min(maxOffset, Math.floor(i / size) * size)));
  }, [selected, providers, size, maxOffset]);

  const page = (step: 1 | -1) => {
    setDir(step > 0 ? 'next' : 'prev');
    setOffset((o) => Math.min(maxOffset, Math.max(0, o + step * size)));
  };

  const visible = providers.slice(offset, offset + size);

  return (
    <nav className="model-nav enter" data-from="top" style={{ ['--d' as string]: '80ms' }} aria-label="AI models">
      <button type="button" className="nav-arrow" onClick={() => page(-1)} disabled={offset === 0} aria-label="Previous models">
        <IconChevronSide size={18} />
      </button>
      <Segmented
        key={offset}
        className={`model-nav__tabs${dir ? ` is-${dir}` : ''}`}
        label="Choose a model"
        value={selected}
        onChange={onSelect}
        items={visible.map((p) => ({
          value: p.key,
          disabled: !p.available,
          title: p.available ? `${p.corridor}${p.model ? ` · ${p.model.name}` : ''}` : p.unavailableReason ?? 'Unavailable',
          label: (
            <>
              <span className="dot" style={{ background: p.available ? stateColor(states[p.key]) : 'transparent' }} />
              {p.label}
            </>
          ),
        }))}
      />
      <button type="button" className="nav-arrow" onClick={() => page(1)} disabled={offset >= maxOffset} aria-label="More models">
        <IconChevronSide size={18} right />
      </button>
    </nav>
  );
}
