'use client';

import { useState } from 'react';
import type { DataMode, ModelTraffic, ProviderSeries, TrafficEvent } from '@/lib/types';
import { flowTrend, trafficState } from '@/lib/analytics/events';
import { formatDay, formatTokens } from '@/lib/format';
import { stateColor, stateLabel, trendLabel } from '../ui/state';
import { IconArrow, IconBolt, IconChevron } from '../ui/icons';

interface Props {
  provider: ProviderSeries | null;
  metrics: ModelTraffic | null;
  events: TrafficEvent[];
  cursorDate: string;
  /** Index of the cursor in the dataset — a week-over-week comparison needs 14 days. */
  cursorIndex: number;
  lastDate: string;
  mode: DataMode;
  totalTokens: number;
}

const level = (v: number | null, lo: number, hi: number) => (v === null ? '—' : v < lo ? 'Low' : v < hi ? 'Moderate' : 'High');
const eventName = (k: string) => k.charAt(0) + k.slice(1).toLowerCase();

export function ModelInfo({ provider, metrics, events, cursorDate, cursorIndex, lastDate, mode, totalTokens }: Props) {
  // Starts minimized so the city stays in view; expand for the full breakdown.
  const [open, setOpen] = useState(false);
  const demo = mode === 'demo';

  if (!provider || !metrics) {
    return (
      <section className="card info">
        <p className="info__kicker">All of Bangalore</p>
        <p className="info__big">
          {formatTokens(totalTokens)}
          <span className="info__unit">tokens on {formatDay(cursorDate, false)}</span>
        </p>
        <p className="info__foot">Pick a model above, or tap a neighbourhood on the map.</p>
      </section>
    );
  }

  const state = trafficState(metrics);
  const trend = flowTrend(metrics);
  const growth = metrics.wowGrowth;
  const myEvents = events.filter((e) => e.providerKey === provider.key || e.kind === 'FLOW SHIFT');
  const color = stateColor(state);

  let delta: React.ReactNode;
  if (growth === null) {
    delta = <span className="delta delta--flat">{cursorIndex >= 13 && metrics.currentTokens > 0 && metrics.previousPeriodTokens === 0 ? 'New this week' : 'No prior week'}</span>;
  } else {
    const up = growth >= 0;
    delta = (
      <span className={`delta ${up ? 'delta--up' : 'delta--down'}`}>
        <IconArrow size={13} down={!up} />
        {Math.abs(Math.round(growth * 100))}%<span className="delta__ctx">vs prior week</span>
      </span>
    );
  }

  return (
    <section className={`card info${open ? '' : ' is-collapsed'}`} aria-live="polite">
      <header className="info__head">
        <div>
          <h2 className="info__title">
            {provider.label}
            <span className="info__place">{provider.corridor}</span>
          </h2>
          <p className="info__model" title={provider.model?.aliasId ? `Resolved from ${provider.model.aliasId}` : 'Newest listed model'}>
            {provider.model?.name ?? 'Model unavailable'}
          </p>
        </div>
        <button type="button" className="icon-btn icon-btn--ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Collapse details' : 'Expand details'}>
          <IconChevron size={16} up={!open} />
        </button>
      </header>

      <div className="info__stat">
        <p className="info__big">
          {formatTokens(metrics.currentTokens)}
          <span className="info__unit">tokens · 7 days</span>
          {demo && <span className="tag">Demo</span>}
        </p>
        <div className="info__row">
          <span className="pill" style={{ ['--c' as string]: color }}>
            <span className="dot" />
            {stateLabel(state)}
          </span>
          {delta}
        </div>
      </div>

      {open && (
        <>
          <dl className="info__grid">
            <div>
              <dt>Latest day</dt>
              <dd>{formatTokens(metrics.dayTokens)}</dd>
            </div>
            <div>
              <dt>30 days</dt>
              <dd>{metrics.thirtyDayTokens === null ? '—' : formatTokens(metrics.thirtyDayTokens)}</dd>
            </div>
            <div>
              <dt>Flow</dt>
              <dd>{trendLabel(trend)}</dd>
            </div>
            <div>
              <dt>Volatility</dt>
              <dd>{level(metrics.volatility, 0.25, 0.6)}</dd>
            </div>
            <div>
              <dt>Spike</dt>
              <dd>{metrics.spikeScore === null ? '—' : `${metrics.spikeScore.toFixed(1)}σ`}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd title={provider.model?.aliasId ?? undefined}>{provider.model?.selection === 'latest-alias' ? 'Latest alias' : 'Newest listed'}</dd>
            </div>
          </dl>

          {metrics.daysBelowCutoff > 0 && <p className="note">Outside OpenRouter’s daily top 50 on {metrics.daysBelowCutoff} of these 7 days — counted as zero.</p>}

          {myEvents.length > 0 && (
            <ul className="events">
              {myEvents.map((e, i) => (
                <li key={`${e.kind}-${i}`}>
                  <span className="events__icon">
                    <IconBolt size={13} />
                  </span>
                  <div>
                    <strong>{eventName(e.kind)}</strong>
                    <span>{e.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="info__foot">
            Week ending {formatDay(cursorDate)} UTC{cursorDate !== lastDate && ` · data through ${formatDay(lastDate, false)}`}. Vehicles show token volume on a log
            scale — not users, requests or revenue.
          </p>
        </>
      )}
    </section>
  );
}
