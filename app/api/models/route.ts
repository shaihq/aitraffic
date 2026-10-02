import { NextResponse } from 'next/server';
import { getModels } from '@/lib/openrouter/client';
import { PROVIDERS, matchesProvider, stripProviderPrefix } from '@/lib/provider-mapping/providers';
import { resolveProvider } from '@/lib/provider-mapping/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Inspection endpoint: which "Latest" aliases exist per provider and what the catalog-only
// rule resolves to. /api/traffic refines the choice between families with usage data.
export async function GET() {
  try {
    const { data: catalog, fetchedAt, stale } = await getModels();
    const providers = PROVIDERS.map((p) => ({
      key: p.key,
      label: p.label,
      latestAliases: catalog
        .filter((m) => m.id.startsWith('~') && matchesProvider(m.id, p))
        .map((m) => ({ id: m.id, name: stripProviderPrefix(m.name), target: m.alias_target ?? null })),
      resolved: resolveProvider(p, catalog, null),
    }));
    return NextResponse.json({ fetchedAt: new Date(fetchedAt).toISOString(), stale, providers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Model catalog unavailable' }, { status: 502 });
  }
}
