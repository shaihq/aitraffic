import 'server-only';
import { cached } from './cache';

// Server-side OpenRouter access. The API key is read from the server environment
// only and never leaves this module.

const BASE = 'https://openrouter.ai/api/v1';

/** Usage is aggregated into UTC daily buckets, so a few hours of freshness is plenty. */
export const RANKINGS_TTL_MS = 3 * 60 * 60 * 1000;
export const MODELS_TTL_MS = 6 * 60 * 60 * 1000;
/** How much history to request. The dataset begins 2025-01-01. */
export const HISTORY_DAYS = 365;
const CHUNK_DAYS = 92;
const DATASET_START = '2025-01-01';

export interface CatalogModel {
  id: string;
  canonical_slug?: string;
  name: string;
  created?: number;
  alias_target?: { name: string; slug: string } | null;
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
}

export interface RankingRow {
  date: string;
  model_permaslug: string;
  total_tokens: string;
}

export interface RankingsDataset {
  rows: RankingRow[];
  asOf: string | null;
  startDate: string;
  endDate: string;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function headers(): HeadersInit {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return {
    Accept: 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    'HTTP-Referer': 'https://ai-traffic.local',
    'X-Title': 'Bengaluru AI Traffic',
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    // Never echo request headers; the body is OpenRouter's error message.
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status} for ${new URL(url).pathname}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function getModels() {
  return cached('models', MODELS_TTL_MS, async () => {
    const json = await getJson<{ data: CatalogModel[] }>(`${BASE}/models`);
    if (!Array.isArray(json?.data)) throw new Error('Unexpected models response shape');
    return json.data;
  });
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};

export function getRankings() {
  return cached('rankings-daily', RANKINGS_TTL_MS, async (): Promise<RankingsDataset> => {
    if (!hasApiKey()) throw new Error('OPENROUTER_API_KEY is not set');

    // Most recent completed UTC day.
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const end = isoDay(yesterday);
    let start = addDays(end, -(HISTORY_DAYS - 1));
    if (start < DATASET_START) start = DATASET_START;

    // Fetch newest window first; if an older window fails we still keep recent history.
    const rows: RankingRow[] = [];
    let asOf: string | null = null;
    let earliest = end;
    let chunkEnd = end;
    while (chunkEnd >= start) {
      let chunkStart = addDays(chunkEnd, -(CHUNK_DAYS - 1));
      if (chunkStart < start) chunkStart = start;
      const url = `${BASE}/datasets/rankings-daily?start_date=${chunkStart}&end_date=${chunkEnd}`;
      try {
        const json = await getJson<{ data: RankingRow[]; meta?: { as_of?: string } }>(url);
        if (!Array.isArray(json?.data)) throw new Error('Unexpected rankings response shape');
        rows.push(...json.data);
        asOf = asOf ?? json.meta?.as_of ?? null;
        earliest = chunkStart;
      } catch (err) {
        if (rows.length === 0) throw err;
        break;
      }
      chunkEnd = addDays(chunkStart, -1);
    }
    return { rows, asOf, startDate: earliest, endDate: end };
  });
}
