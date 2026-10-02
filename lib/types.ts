// Shared types between the server data layer, analytics and the client scene.

export type DataMode = 'live' | 'cached' | 'demo';

export type ModelSelection = 'latest-alias' | 'newest-listed';

export interface ResolvedModel {
  /** Concrete OpenRouter model id the traffic is attributed to, e.g. "anthropic/claude-sonnet-5.5". */
  id: string;
  /** Permaslug used by the rankings dataset (OpenRouter `canonical_slug`). */
  permaslug: string;
  /** Human-readable name with the "Provider: " prefix stripped. */
  name: string;
  /** "Latest" family alias that resolved to this model, if one was used. */
  aliasId: string | null;
  aliasName: string | null;
  selection: ModelSelection;
  /** Unix seconds from the catalog. */
  created: number | null;
}

export interface ProviderSeries {
  key: string;
  label: string;
  corridor: string;
  available: boolean;
  unavailableReason: string | null;
  model: ResolvedModel | null;
  /**
   * Tokens per UTC day, aligned to `TrafficPayload.dates`.
   * `null` = the model was not in OpenRouter's daily top-50 that day (value unknown, below cutoff).
   */
  daily: (number | null)[];
}

export interface TrafficPayload {
  mode: DataMode;
  stale: boolean;
  /** `meta.as_of` from the rankings dataset (ISO-8601). Null in demo mode. */
  asOf: string | null;
  /** When this server last successfully fetched the rankings (ISO-8601). */
  fetchedAt: string | null;
  dates: string[];
  /** All OpenRouter tokens per day (top-50 rows + aggregated "other" row). */
  totals: number[];
  /** Tokens of the 50th-ranked model per day — anything not listed was below this. */
  cutoffs: number[];
  providers: ProviderSeries[];
  notice: string | null;
}

/** Spec §5 — normalized, model-centric traffic metrics at one point on the timeline. */
export interface ModelTraffic {
  providerKey: string;
  providerLabel: string;
  modelId: string;
  modelName: string;

  /** Latest-day tokens at the cursor. */
  dayTokens: number;
  /** 7-day sum ending at the cursor. */
  currentTokens: number;
  /** 7-day sum for the week before. */
  previousPeriodTokens: number;
  wowGrowth: number | null;
  thirtyDayTokens: number | null;
  volatility: number | null;
  spikeScore: number | null;
  /** Days in the current 7-day window where the model was below the top-50 cutoff. */
  daysBelowCutoff: number;

  activityNormalized: number;
  growthNormalized: number;
  congestion: number;
  flowSpeed: number;
}

export type TrafficStateName = 'FREE FLOW' | 'BUSY' | 'HEAVY' | 'CONGESTED' | 'JAMMED' | 'CLEARING';
export type FlowTrend = 'INTENSIFYING' | 'STEADY' | 'EASING';

export type TrafficEventKind = 'TRAFFIC SURGE' | 'MAJOR JAM' | 'CLEARING' | 'NEW ROUTE' | 'FLOW SHIFT';

export interface TrafficEvent {
  kind: TrafficEventKind;
  providerKey: string;
  /** Plain-language statement of the data rule that fired. */
  detail: string;
}

/** What the simulation needs per corridor. Everything is 0..1 unless stated. */
export interface CorridorDrive {
  key: string;
  available: boolean;
  activity: number;
  growth: number; // -1..1
  congestion: number;
  volatility: number;
  flowSpeed: number;
  state: TrafficStateName;
}
