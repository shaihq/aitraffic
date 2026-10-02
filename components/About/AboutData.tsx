'use client';

import { useEffect, useRef } from 'react';
import type { TrafficPayload } from '@/lib/types';
import { formatDay, formatIso } from '@/lib/format';
import { IconClose } from '../ui/icons';

interface Props {
  open: boolean;
  onClose: () => void;
  payload: TrafficPayload;
}

export function AboutData({ open, onClose, payload }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="about" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="about__body">
        <header className="about__head">
          <h2>About the data</h2>
          <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </header>
        <p className="about__lead">
          Bengaluru AI Traffic visualizes aggregate model usage routed through OpenRouter. Token volume is shown as traffic volume. It does not represent total AI usage across all
          providers.
        </p>
        <ul>
          <li>Usage is prompt + completion tokens per model, aggregated by OpenRouter into UTC daily buckets.</li>
          <li>
            Each neighbourhood follows one model per provider — the target of OpenRouter’s “Latest” alias when one exists, otherwise the newest listed text model. With
            several Latest families, the one carrying the most recent traffic is shown.
          </li>
          <li>The dataset lists the top 50 models per day. Days a model falls outside it count as zero and are flagged.</li>
          <li>Vehicle counts are a log-compressed picture of volume. A car is not a user, a request, or a fixed number of tokens.</li>
          <li>Congestion reflects unusual surges and day-to-day instability, not popularity — and nothing here measures quality, accuracy or market share.</li>
          <li>
            The city is a simplified miniature of Bangalore. Which neighbourhood hosts which model is just a label — the traffic is AI usage, not real Bangalore road
            traffic.
          </li>
        </ul>
        <p className="about__source">
          {payload.mode === 'demo' ? (
            <>Demo mode — live data is unavailable, so traffic is synthetic and deterministic. {payload.notice}</>
          ) : (
            <>
              Source: OpenRouter (
              <a href="https://openrouter.ai/rankings" target="_blank" rel="noreferrer">
                openrouter.ai/rankings
              </a>
              ), as of {formatIso(payload.asOf)}. Licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                CC BY 4.0
              </a>
              . Usage through {formatDay(payload.dates[payload.dates.length - 1])} UTC.
              {payload.stale && <> Cached copy — last refreshed {formatIso(payload.fetchedAt)}.</>}
            </>
          )}
        </p>
      </div>
    </dialog>
  );
}
