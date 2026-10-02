import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Two-tier server cache: in-memory for hot reads, on-disk so a restart (or an
// OpenRouter outage) can still serve the most recent dataset, labeled as stale.

interface Entry<T> {
  data: T;
  fetchedAt: number;
}

export interface CacheResult<T> {
  data: T;
  fetchedAt: number;
  /** True when the fetch failed and an expired entry was served instead. */
  stale: boolean;
  error: string | null;
}

const memory = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<CacheResult<unknown>>>();

const CACHE_DIR = process.env.AI_TRAFFIC_CACHE_DIR || path.join(process.cwd(), '.cache', 'openrouter');

function fileFor(key: string) {
  return path.join(CACHE_DIR, `${key.replace(/[^a-z0-9-_]/gi, '_')}.json`);
}

async function readDisk<T>(key: string): Promise<Entry<T> | null> {
  try {
    const raw = await fs.readFile(fileFor(key), 'utf8');
    const parsed = JSON.parse(raw) as Entry<T>;
    return typeof parsed?.fetchedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeDisk<T>(key: string, entry: Entry<T>) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(fileFor(key), JSON.stringify(entry));
  } catch {
    // Read-only filesystems (some serverless hosts) still get the in-memory cache.
  }
}

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<CacheResult<T>> {
  const now = Date.now();
  let entry = memory.get(key) as Entry<T> | undefined;
  if (!entry) {
    const disk = await readDisk<T>(key);
    if (disk) {
      entry = disk;
      memory.set(key, disk);
    }
  }
  if (entry && now - entry.fetchedAt < ttlMs) {
    return { data: entry.data, fetchedAt: entry.fetchedAt, stale: false, error: null };
  }

  const pending = inflight.get(key) as Promise<CacheResult<T>> | undefined;
  if (pending) return pending;

  const run = (async (): Promise<CacheResult<T>> => {
    try {
      const data = await fetcher();
      const fresh = { data, fetchedAt: Date.now() };
      memory.set(key, fresh);
      await writeDisk(key, fresh);
      return { ...fresh, stale: false, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (entry) return { data: entry.data, fetchedAt: entry.fetchedAt, stale: true, error: message };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}
