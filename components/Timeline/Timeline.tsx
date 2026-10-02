'use client';

import { useId, useMemo } from 'react';
import { formatDay } from '@/lib/format';
import { Segmented } from '../ui/Segmented';
import { IconPause, IconPlay } from '../ui/icons';

export const RANGES = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 365, label: '1Y' },
] as const;

interface Props {
  dates: string[];
  cursor: number;
  rangeDays: number;
  playing: boolean;
  /** Daily series of the selected corridor (or all traffic) for the chart. */
  series: (number | null)[];
  seriesLabel: string;
  onCursor: (i: number) => void;
  onRange: (days: number) => void;
  onPlay: (p: boolean) => void;
}

const W = 600;
const H = 56;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function Timeline({ dates, cursor, rangeDays, playing, series, seriesLabel, onCursor, onRange, onPlay }: Props) {
  const clip = useId().replace(/:/g, '');
  const start = Math.max(0, dates.length - rangeDays);
  const end = dates.length - 1;

  const chart = useMemo(() => {
    const slice = series.slice(start, end + 1).map((v) => (v && v > 0 ? Math.log10(v) : null));
    const vals = slice.filter((v): v is number => v !== null);
    if (vals.length < 2) return null;
    const lo = Math.min(...vals) - 0.08;
    const hi = Math.max(...vals) + 0.04;
    const n = Math.max(1, slice.length - 1);
    const pts = slice.map((v, i) => [(i / n) * W, v === null ? H : H - 4 - ((v - lo) / (hi - lo)) * (H - 10)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    return { line, area: `${line}L${W},${H}L0,${H}Z`, pts };
  }, [series, start, end]);

  const t = end > start ? (cursor - start) / (end - start) : 1;
  const cx = t * W;
  const cy = chart?.pts[cursor - start]?.[1] ?? H / 2;
  const day = new Date(`${dates[cursor]}T00:00:00Z`).getUTCDay();

  return (
    <section className="card dock" aria-label="Timeline">
      <div className="dock__top">
        <button type="button" className="play" onClick={() => onPlay(!playing)} aria-label={playing ? 'Pause' : 'Play history'}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <div className="dock__date">
          <strong>{formatDay(dates[cursor])}</strong>
          <span>
            {WEEKDAYS[day]} · {seriesLabel}
          </span>
        </div>
        <Segmented
          size="sm"
          label="History range"
          value={rangeDays}
          onChange={onRange}
          items={RANGES.map((r) => ({ value: r.days, label: r.label, disabled: dates.length < Math.min(r.days, 14) }))}
        />
      </div>

      <div className="dock__chart">
        <div className="dock__plot">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`${clip}-g`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#ff9d4d" stopOpacity="0.35" />
                <stop offset="1" stopColor="#ff9d4d" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${clip}-past`}>
                <rect x="0" y="0" width={cx} height={H} />
              </clipPath>
            </defs>
            {chart && (
              <>
                <path d={chart.area} className="dock__area-future" />
                <path d={chart.line} className="dock__line-future" />
                <g clipPath={`url(#${clip}-past)`}>
                  <path d={chart.area} fill={`url(#${clip}-g)`} />
                  <path d={chart.line} className="dock__line" />
                </g>
              </>
            )}
            <line x1={cx} x2={cx} y1="0" y2={H} className="dock__cursor" />
          </svg>
          <span className="dock__knob" style={{ left: `${t * 100}%`, top: `${(cy / H) * 100}%` }} aria-hidden="true" />
        </div>
        <input
          type="range"
          min={start}
          max={end}
          step={1}
          value={cursor}
          onChange={(e) => onCursor(Number(e.target.value))}
          aria-label="Timeline day"
          aria-valuetext={formatDay(dates[cursor])}
        />
      </div>
      <div className="dock__ends">
        <span>{formatDay(dates[start], false)}</span>
        <span>{formatDay(dates[end], false)}</span>
      </div>
    </section>
  );
}
