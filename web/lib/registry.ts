/**
 * Content registry — the in-memory store of all registered leak.markets items.
 *
 * In production this lives in a Postgres/Supabase table or an on-chain PDA
 * and is populated when users call `lit-decrypt encrypt` (which POSTs metadata
 * to /api/register).  For now we ship seed data so the site is usable from day 1.
 *
 * The `REGISTRY_URL` env var can point to an external JSON file / API that
 * returns ContentEntry[].  If unset, the seed data is used.
 */
import type { ContentEntry } from "./types";

const REGISTRY_URL = process.env.REGISTRY_URL;

const SEED_REGISTRY: ContentEntry[] = [];

let _cache: ContentEntry[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 60 s

export async function getRegistry(): Promise<ContentEntry[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  if (REGISTRY_URL) {
    try {
      const res = await fetch(REGISTRY_URL, { next: { revalidate: 60 } });
      const data: ContentEntry[] = await res.json();
      _cache = data;
      _cacheTime = Date.now();
      return data;
    } catch (e) {
      console.warn("Registry fetch failed, using seed data:", e);
    }
  }

  _cache = SEED_REGISTRY;
  _cacheTime = Date.now();
  return SEED_REGISTRY;
}

/** Register a new content entry (called by /api/register). */
export async function registerContent(entry: ContentEntry): Promise<void> {
  _cache = [...(await getRegistry()), entry];
  _cacheTime = Date.now();
}
