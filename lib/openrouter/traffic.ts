import 'server-only';
import type { ProviderSeries, TrafficPayload } from '../types';
import { PROVIDERS } from '../provider-mapping/providers';
import { matchKeys, resolveAll, type UsageLookup } from '../provider-mapping/resolve';
import { demoDates, demoSeries } from '../demo';
import { getModels, getRankings, hasApiKey, HISTORY_DAYS, type CatalogModel, type RankingsDataset } from './client';

const SELECTION_WINDOW_DAYS = 14;

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

interface IndexedRankings {
  dates: string[];
  byDay: Map<string, number>[];
  totals: number[];
  cutoffs: number[];
}

function indexRankings(ds: RankingsDataset): IndexedRankings | null {
  const days = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const row of ds.rows) {
    const tokens = Number(row.total_tokens);
    if (!Number.isFinite(tokens)) continue;
    totals.set(row.date, (totals.get(row.date) ?? 0) + tokens);
    if (row.model_permaslug === 'other') continue;
    let m = days.get(row.date);
    if (!m) days.set(row.date, (m = new Map()));
    m.set(row.model_permaslug, (m.get(row.model_permaslug) ?? 0) + tokens);
  }
  const populated = [...days.keys()].sort();
  if (populated.length === 0) return null;
  const dates = eachDay(populated[0], populated[populated.length - 1]);
  const byDay = dates.map((d) => days.get(d) ?? new Map<string, number>());
  return {
    dates,
    byDay,
    totals: dates.map((d) => totals.get(d) ?? 0),
    // The dataset lists the top 50 per day; anything absent was below the 50th row.
    cutoffs: byDay.map((m) => (m.size >= 50 ? Math.min(...m.values()) : 0)),
  };
}

function seriesFor(idx: IndexedRankings, keys: string[]): (number | null)[] {
  const unique = [...new Set(keys)];
  return idx.byDay.map((m, i) => {
    let sum = 0;
    let found = false;
    for (const k of unique) {
      const v = m.get(k);
      if (v !== undefined) {
        sum += v;
        found = true;
      }
    }
    if (found) return sum;
    // Fewer than 50 rows that day means every model with traffic was listed → a true zero.
    return idx.cutoffs[i] > 0 ? null : 0;
  });
}

function shell(p: (typeof PROVIDERS)[number]): Omit<ProviderSeries, 'daily' | 'model' | 'available' | 'unavailableReason'> {
  return { key: p.key, label: p.label, corridor: p.corridor };
}

export async function buildTrafficPayload(): Promise<TrafficPayload> {
  let catalog: CatalogModel[] = [];
  let catalogError: string | null = null;
  try {
    catalog = (await getModels()).data;
  } catch (err) {
    catalogError = err instanceof Error ? err.message : String(err);
  }

  let rankings: Awaited<ReturnType<typeof getRankings>> | null = null;
  let rankingsError: string | null = null;
  try {
    rankings = await getRankings();
  } catch (err) {
    rankingsError = err instanceof Error ? err.message : String(err);
  }

  const idx = rankings ? indexRankings(rankings.data) : null;

  if (rankings && idx) {
    const recent = idx.byDay.slice(-SELECTION_WINDOW_DAYS);
    const usage: UsageLookup = (keys) => {
      let s = 0;
      for (const m of recent) for (const k of new Set(keys)) s += m.get(k) ?? 0;
      return s;
    };
    const resolved = resolveAll(catalog, usage);
    const providers: ProviderSeries[] = resolved.map(({ provider, model }) => {
      if (!model) {
        return { ...shell(provider), model: null, daily: idx.dates.map(() => null), available: false, unavailableReason: catalogError ? 'Model catalog unavailable' : 'No current text model listed on OpenRouter' };
      }
      const daily = seriesFor(idx, matchKeys(model));
      const hasData = daily.some((v) => v !== null && v > 0);
      return {
        ...shell(provider),
        model,
        daily,
        available: hasData,
        unavailableReason: hasData ? null : 'Latest model has not appeared in OpenRouter’s daily top 50',
      };
    });
    return {
      mode: rankings.stale ? 'cached' : 'live',
      stale: rankings.stale,
      asOf: rankings.data.asOf,
      fetchedAt: new Date(rankings.fetchedAt).toISOString(),
      dates: idx.dates,
      totals: idx.totals,
      cutoffs: idx.cutoffs,
      providers,
      notice: rankings.stale ? 'OpenRouter is unreachable — showing the most recent cached usage data.' : null,
    };
  }

  // No live or cached usage at all → explicit, deterministic demo mode.
  const resolved = resolveAll(catalog, null);
  const dates = demoDates(HISTORY_DAYS);
  const base = resolved.map(({ provider, model }) => ({
    ...shell(provider),
    model,
    available: true,
    unavailableReason: null,
  }));
  const { series, totals, cutoffs } = demoSeries(base, dates);
  return {
    mode: 'demo',
    stale: false,
    asOf: null,
    fetchedAt: null,
    dates,
    totals,
    cutoffs,
    providers: series,
    notice: !hasApiKey()
      ? 'OPENROUTER_API_KEY is not configured on the server.'
      : `Usage data unavailable (${rankingsError ?? 'empty dataset'}).`,
  };
}
