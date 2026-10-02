import type { ProviderSeries } from './types';
import { mulberry32, hashString } from './random';

// Deterministic synthetic usage, used ONLY when no live or cached OpenRouter data exists.
// The UI labels this "DEMO MODE — LIVE DATA UNAVAILABLE"; these numbers are never presented as real.

export function demoDates(days: number): string[] {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function demoSeries(providers: Omit<ProviderSeries, 'daily'>[], dates: string[]) {
  const n = dates.length;
  const series = providers.map((p, idx) => {
    const rnd = mulberry32(hashString(`demo:${p.key}`));
    const base = Math.pow(10, 9 + rnd() * 2.6); // 1B .. ~400B per day
    const launch = Math.floor(rnd() * n * 0.9); // model "appears" somewhere in the window
    const trend = (rnd() - 0.4) * 1.6;
    const spikeAt = Math.floor(n * (0.5 + rnd() * 0.5));
    const daily = dates.map((_, i) => {
      if (i < launch - 3 && idx % 3 !== 0) return null;
      const t = i / n;
      const ramp = idx % 3 === 0 ? 1 : Math.min(1, Math.max(0.05, (i - launch + 3) / 21));
      const weekly = 1 + 0.12 * Math.sin((i / 7) * Math.PI * 2 + idx);
      const noise = 1 + (rnd() - 0.5) * 0.25;
      const spike = Math.abs(i - spikeAt) < 2 ? 2.4 : 1;
      return Math.round(base * Math.exp(trend * (t - 1)) * ramp * weekly * noise * spike);
    });
    return { ...p, daily };
  });
  const totals = dates.map((_, i) => series.reduce((s, p) => s + (p.daily[i] ?? 0), 0) * 3.2);
  const cutoffs = dates.map(() => 4e8);
  return { series, totals, cutoffs };
}
