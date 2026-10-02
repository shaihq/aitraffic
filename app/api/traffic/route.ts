import { NextResponse } from 'next/server';
import { buildTrafficPayload } from '@/lib/openrouter/traffic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Browser → this route → server cache → OpenRouter. The API key never reaches the client.
export async function GET() {
  const payload = await buildTrafficPayload();
  return NextResponse.json(payload, {
    headers: {
      // Source data is aggregated daily; let shared caches hold it briefly.
      'Cache-Control': payload.mode === 'live' ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'no-store',
    },
  });
}
