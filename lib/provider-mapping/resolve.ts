import type { ResolvedModel } from '../types';
import { PROVIDERS, matchesProvider, stripProviderPrefix, type ProviderDef } from './providers';

// Spec §4 "Latest model rule":
//  1. Prefer an OpenRouter "Latest" family alias (`~author/...-latest`, carries `alias_target`).
//  2. Otherwise use the newest currently listed relevant text model.
//  3. With several Latest families (e.g. Pro + Flash), pick the main one: the family whose
//     resolved model carries the most recent traffic; without usage data fall back to hints.
// Nothing here hardcodes a model name.

export interface CatalogEntry {
  id: string;
  canonical_slug?: string;
  name: string;
  created?: number;
  alias_target?: { name: string; slug: string } | null;
  architecture?: { modality?: string; output_modalities?: string[] };
}

/** Recent token totals keyed by permaslug or id. Null when no usage data exists (demo mode). */
export type UsageLookup = ((keys: string[]) => number) | null;

const NOT_GENERAL_TEXT = /guard|safety|moderat|embed|rerank|tts|whisper|transcri|ocr|\bmt\d|-mt-|-mt\d|translat|contributor|image|audio-only/i;
const SMALL_TIER = /flash|mini|haiku|lite|nano|air|small|tiny/i;

function outputsText(m: CatalogEntry) {
  const out = m.architecture?.output_modalities;
  if (out) return out.includes('text') && !out.includes('image');
  return (m.architecture?.modality ?? 'text->text').endsWith('->text');
}

export function matchKeys(model: ResolvedModel): string[] {
  return [model.permaslug, model.id, model.aliasId].filter((k): k is string => Boolean(k));
}

function byId(catalog: CatalogEntry[]) {
  const map = new Map<string, CatalogEntry>();
  for (const m of catalog) map.set(m.id, m);
  return map;
}

function fromAlias(alias: CatalogEntry, index: Map<string, CatalogEntry>): ResolvedModel {
  const target = alias.alias_target!;
  const concrete = index.get(target.slug);
  return {
    id: target.slug,
    permaslug: concrete?.canonical_slug ?? target.slug,
    name: stripProviderPrefix(concrete?.name ?? target.name),
    aliasId: alias.id,
    aliasName: stripProviderPrefix(alias.name),
    selection: 'latest-alias',
    created: concrete?.created ?? alias.created ?? null,
  };
}

function fromListed(m: CatalogEntry): ResolvedModel {
  return {
    id: m.id,
    permaslug: m.canonical_slug ?? m.id,
    name: stripProviderPrefix(m.name),
    aliasId: null,
    aliasName: null,
    selection: 'newest-listed',
    created: m.created ?? null,
  };
}

function hintRank(provider: ProviderDef, id: string) {
  const hints = provider.familyHints ?? [];
  const i = hints.findIndex((h) => id.includes(h));
  return i < 0 ? hints.length : i;
}

export function resolveProvider(provider: ProviderDef, catalog: CatalogEntry[], usage: UsageLookup): ResolvedModel | null {
  const index = byId(catalog);
  const mine = catalog.filter((m) => matchesProvider(m.id, provider));

  const aliases = mine
    .filter((m) => m.id.startsWith('~') && m.alias_target?.slug && outputsText(m))
    .map((a) => fromAlias(a, index));

  if (aliases.length > 0) {
    if (usage) {
      const scored = aliases.map((r) => ({ r, u: usage(matchKeys(r)) }));
      const best = scored.reduce((a, b) => (b.u > a.u ? b : a));
      if (best.u > 0) return best.r;
    }
    return [...aliases].sort(
      (a, b) =>
        hintRank(provider, a.aliasId!) - hintRank(provider, b.aliasId!) ||
        Number(SMALL_TIER.test(a.aliasId!)) - Number(SMALL_TIER.test(b.aliasId!)) ||
        (b.created ?? 0) - (a.created ?? 0),
    )[0];
  }

  // No alias: newest relevant text model, one entry per canonical slug (":free"/":batch" share it).
  const seen = new Set<string>();
  const candidates = mine
    .filter((m) => !m.id.startsWith('~') && outputsText(m) && !NOT_GENERAL_TEXT.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || Number(a.id.includes(':')) - Number(b.id.includes(':')))
    .filter((m) => {
      const slug = m.canonical_slug ?? m.id;
      if (seen.has(slug)) return false;
      seen.add(slug);
      return true;
    })
    .map(fromListed);

  if (candidates.length === 0) return null;
  // Same-generation siblings are often released together (e.g. "pro" and "flash" on one day);
  // among the newest few, prefer the one that actually carries traffic.
  if (usage) {
    const withTraffic = candidates.slice(0, 4).find((c) => usage(matchKeys(c)) > 0);
    if (withTraffic) return withTraffic;
  }
  return candidates[0];
}

export function resolveAll(catalog: CatalogEntry[], usage: UsageLookup) {
  return PROVIDERS.map((p) => ({ provider: p, model: resolveProvider(p, catalog, usage) }));
}
