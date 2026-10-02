import type { FlowTrend, ModelTraffic, ProviderSeries, TrafficEvent, TrafficStateName } from '../types';
import { sumRange, weekGrowth } from './metrics';

// Descriptive traffic vocabulary (spec §14) and data-derived events (spec §17).
// Every event states the rule that triggered it; none claims a cause.

export function trafficState(m: ModelTraffic): TrafficStateName {
  if (m.currentTokens === 0) return m.previousPeriodTokens > 0 ? 'CLEARING' : 'FREE FLOW';
  if ((m.spikeScore ?? 0) >= 3 && m.congestion >= 0.5) return 'JAMMED';
  if (m.congestion >= 0.42) return 'CONGESTED';
  if ((m.wowGrowth ?? 0) <= -0.2) return 'CLEARING';
  if (m.activityNormalized >= 0.72) return 'HEAVY';
  if (m.activityNormalized >= 0.45) return 'BUSY';
  return 'FREE FLOW';
}

export function flowTrend(m: ModelTraffic): FlowTrend {
  const g = m.wowGrowth ?? 0;
  if (g >= 0.1) return 'INTENSIFYING';
  if (g <= -0.1) return 'EASING';
  return 'STEADY';
}

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;

export function eventsFor(p: ProviderSeries, m: ModelTraffic, t: number, dates: string[]): TrafficEvent[] {
  const out: TrafficEvent[] = [];
  const d = p.daily;

  if (m.wowGrowth !== null && m.wowGrowth >= 0.5 && m.previousPeriodTokens > 0) {
    out.push({ kind: 'TRAFFIC SURGE', providerKey: p.key, detail: `7-day tokens ${pct(m.wowGrowth)} vs the previous 7 days.` });
  }

  if (m.spikeScore !== null && m.spikeScore >= 3) {
    let mu = 0;
    let n = 0;
    for (let i = Math.max(0, t - 14); i < t; i++) {
      if ((d[i] ?? 0) > 0) {
        mu += d[i]!;
        n++;
      }
    }
    mu = n ? mu / n : 0;
    if (mu > 0 && m.dayTokens >= 2 * mu) {
      out.push({ kind: 'MAJOR JAM', providerKey: p.key, detail: `${dates[t]} usage was ${(m.dayTokens / mu).toFixed(1)}× its 14-day average (${m.spikeScore.toFixed(1)}σ).` });
    }
  }

  const prevWeek = t >= 7 ? weekGrowth(d, t - 7) : null;
  if (m.wowGrowth !== null && m.wowGrowth <= -0.3 && prevWeek !== null && prevWeek <= -0.1) {
    out.push({ kind: 'CLEARING', providerKey: p.key, detail: `Two consecutive weekly declines (${pct(prevWeek)}, then ${pct(m.wowGrowth)}).` });
  }

  if (t >= 42 && m.currentTokens > 0 && sumRange(d, t - 42, t - 14) === 0) {
    let first = t - 13;
    while (first < t && (d[first] ?? 0) === 0) first++;
    out.push({ kind: 'NEW ROUTE', providerKey: p.key, detail: `First appeared in OpenRouter's daily top 50 on ${dates[first]} after 4+ weeks absent.` });
  }
  return out;
}

export function flowShift(metrics: ModelTraffic[]): TrafficEvent | null {
  const meaningful = metrics.filter((m) => m.wowGrowth !== null && m.activityNormalized > 0.25);
  if (meaningful.length < 2) return null;
  const up = meaningful.reduce((a, b) => (b.wowGrowth! > a.wowGrowth! ? b : a));
  const down = meaningful.reduce((a, b) => (b.wowGrowth! < a.wowGrowth! ? b : a));
  if (up.wowGrowth! >= 0.25 && down.wowGrowth! <= -0.25) {
    return {
      kind: 'FLOW SHIFT',
      providerKey: up.providerKey,
      detail: `${up.providerLabel} ${pct(up.wowGrowth!)} while ${down.providerLabel} ${pct(down.wowGrowth!)} week over week.`,
    };
  }
  return null;
}
