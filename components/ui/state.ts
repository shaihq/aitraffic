import type { FlowTrend, TrafficStateName } from '@/lib/types';

const COLORS: Record<TrafficStateName, string> = {
  'FREE FLOW': '#34d27b',
  BUSY: '#facc15',
  HEAVY: '#fb923c',
  CONGESTED: '#f05a3c',
  JAMMED: '#d62f2f',
  CLEARING: '#60a5fa',
};

export const stateColor = (s: TrafficStateName | undefined) => (s ? COLORS[s] : '#52525b');

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
export const stateLabel = (s: TrafficStateName) => sentence(s);
export const trendLabel = (t: FlowTrend) => sentence(t);
