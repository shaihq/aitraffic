export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(abs >= 1e13 ? 1 : 2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e11 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${Math.round(n)}`;
}

export function formatPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const p = Math.round(v * 100);
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-01" → "Oct 1, 2026" (dates are UTC days; never shifted to local time). */
export function formatDay(day: string, withYear = true): string {
  const [y, m, d] = day.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

export function formatIso(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDay(d.toISOString().slice(0, 10))} ${d.toISOString().slice(11, 16)} UTC`;
}
