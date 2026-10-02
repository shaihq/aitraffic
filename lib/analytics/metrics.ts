import type { ModelTraffic, ProviderSeries, TrafficPayload } from '../types';

// Pure metric computation at a timeline cursor (index into payload.dates).
// Token volume is used as a proxy for traffic volume — nothing here counts users or requests.

export interface LogScale {
  minLog: number;
  maxLog: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const val = (v: number | null | undefined) => v ?? 0;

function sum(daily: (number | null)[], from: number, to: number) {
  let s = 0;
  for (let i = Math.max(0, from); i <= to; i++) s += val(daily[i]);
  return s;
}

/**
 * Log-compressed scale tuned to the live distribution of 7-day average daily tokens.
 * Computed once per dataset so scrubbing the timeline shows real change, not re-normalization.
 */
export function computeScale(payload: TrafficPayload): LogScale {
  const logs: number[] = [];
  for (const p of payload.providers) {
    if (!p.available) continue;
    for (let t = 6; t < p.daily.length; t += 3) {
      const avg = sum(p.daily, t - 6, t) / 7;
      if (avg > 0) logs.push(Math.log10(avg));
    }
  }
  if (logs.length === 0) return { minLog: 8, maxLog: 11.5 };
  logs.sort((a, b) => a - b);
  const p05 = logs[Math.floor(logs.length * 0.05)];
  const max = logs[logs.length - 1];
  const minLog = Math.min(p05, max - 1.5) - 0.15;
  return { minLog, maxLog: max + 0.05 };
}

export function totalsScale(payload: TrafficPayload): LogScale {
  const logs = payload.totals.filter((v) => v > 0).map(Math.log10);
  if (logs.length === 0) return { minLog: 10, maxLog: 13 };
  const max = Math.max(...logs);
  return { minLog: Math.min(...logs) - 0.3, maxLog: max + 0.02 };
}

export function normalizeLog(value: number, scale: LogScale) {
  if (value <= 0) return 0;
  return clamp((Math.log10(value) - scale.minLog) / (scale.maxLog - scale.minLog));
}

function weekGrowth(daily: (number | null)[], t: number): number | null {
  if (t - 13 < 0) return null;
  const cur = sum(daily, t - 6, t);
  const prev = sum(daily, t - 13, t - 7);
  if (prev <= 0) return null;
  return cur / prev - 1;
}

export function computeModelTraffic(p: ProviderSeries, t: number, scale: LogScale): ModelTraffic {
  const d = p.daily;
  const dayTokens = val(d[t]);
  const currentTokens = sum(d, t - 6, t);
  const previousPeriodTokens = t - 7 >= 0 ? sum(d, t - 13, t - 7) : 0;
  const wowGrowth = weekGrowth(d, t);
  const thirtyDayTokens = t >= 29 ? sum(d, t - 29, t) : null;

  let daysBelowCutoff = 0;
  for (let i = Math.max(0, t - 6); i <= t; i++) if (d[i] === null) daysBelowCutoff++;

  // Volatility: spread of day-over-day log changes across the last 14 days.
  const changes: number[] = [];
  for (let i = Math.max(1, t - 13); i <= t; i++) {
    const a = val(d[i - 1]);
    const b = val(d[i]);
    if (a > 0 && b > 0) changes.push(Math.log(b / a));
  }
  let volatility: number | null = null;
  if (changes.length >= 5) {
    const mean = changes.reduce((s, c) => s + c, 0) / changes.length;
    const sd = Math.sqrt(changes.reduce((s, c) => s + (c - mean) ** 2, 0) / changes.length);
    volatility = clamp(sd / 0.35);
  }

  // Spike: today's tokens vs the prior 14-day baseline, in standard deviations.
  const base: number[] = [];
  for (let i = Math.max(0, t - 14); i < t; i++) if (val(d[i]) > 0) base.push(val(d[i]));
  let spikeScore: number | null = null;
  if (base.length >= 5 && dayTokens > 0) {
    const mu = base.reduce((s, v) => s + v, 0) / base.length;
    const sd = Math.sqrt(base.reduce((s, v) => s + (v - mu) ** 2, 0) / base.length);
    spikeScore = (dayTokens - mu) / Math.max(sd, mu * 0.1);
  }

  const activityNormalized = normalizeLog(currentTokens / 7, scale);
  const growthNormalized = wowGrowth === null ? 0 : Math.tanh(wowGrowth * 1.5);

  // Congestion reflects surges and instability — NOT popularity. A huge, steady corridor flows.
  const surge = clamp(((spikeScore ?? 0) - 1.5) / 3);
  const instability = volatility ?? 0;
  const growthPressure = clamp((wowGrowth ?? 0) - 0.25) * 0.6;
  const congestion = activityNormalized === 0 ? 0 : clamp(0.08 * activityNormalized + 0.55 * surge + 0.28 * instability + 0.25 * growthPressure);
  const flowSpeed = clamp(1 - 0.85 * congestion - 0.08 * activityNormalized, 0.1, 1);

  return {
    providerKey: p.key,
    providerLabel: p.label,
    modelId: p.model?.id ?? '',
    modelName: p.model?.name ?? '',
    dayTokens,
    currentTokens,
    previousPeriodTokens,
    wowGrowth,
    thirtyDayTokens,
    volatility,
    spikeScore,
    daysBelowCutoff,
    activityNormalized,
    growthNormalized,
    congestion,
    flowSpeed,
  };
}

export { weekGrowth, sum as sumRange };
