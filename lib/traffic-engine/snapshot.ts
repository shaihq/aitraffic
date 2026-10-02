import type { CorridorDrive, ModelTraffic, TrafficEvent, TrafficPayload } from '../types';
import { computeModelTraffic, normalizeLog, type LogScale } from '../analytics/metrics';
import { eventsFor, flowShift, trafficState } from '../analytics/events';

// Everything the scene, overlay and audio need for one timeline position.

export interface TrafficSnapshot {
  index: number;
  date: string;
  metrics: Record<string, ModelTraffic>;
  drives: CorridorDrive[];
  events: TrafficEvent[];
  /** Whole-ecosystem volume (all OpenRouter tokens) driving the central ring. */
  hubActivity: number;
  totalTokens: number;
}

export function snapshotAt(payload: TrafficPayload, t: number, scale: LogScale, hubScale: LogScale): TrafficSnapshot {
  const metrics: Record<string, ModelTraffic> = {};
  const drives: CorridorDrive[] = [];
  const events: TrafficEvent[] = [];

  for (const p of payload.providers) {
    const m = computeModelTraffic(p, t, scale);
    metrics[p.key] = m;
    drives.push({
      key: p.key,
      available: p.available,
      activity: p.available ? m.activityNormalized : 0,
      growth: m.growthNormalized,
      congestion: m.congestion,
      volatility: m.volatility ?? 0,
      flowSpeed: m.flowSpeed,
      state: trafficState(m),
    });
    if (p.available) events.push(...eventsFor(p, m, t, payload.dates));
  }
  const shift = flowShift(Object.values(metrics).filter((m) => payload.providers.find((p) => p.key === m.providerKey)?.available));
  if (shift) events.push(shift);

  let total = 0;
  for (let i = Math.max(0, t - 6); i <= t; i++) total += payload.totals[i] ?? 0;
  return {
    index: t,
    date: payload.dates[t],
    metrics,
    drives,
    events,
    hubActivity: normalizeLog(total / 7, hubScale),
    totalTokens: payload.totals[t] ?? 0,
  };
}
