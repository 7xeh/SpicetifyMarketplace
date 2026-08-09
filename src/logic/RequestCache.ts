const CACHE_PREFIX = "marketplace-cache:";
const MAX_ENTRY_BYTES = 1_000_000;

export const CACHE_TTL = {
  searchPage: 30 * 60 * 1000,
  manifest: 6 * 60 * 60 * 1000,
  repo: 60 * 60 * 1000,
  resource: 6 * 60 * 60 * 1000,
  release: 6 * 60 * 60 * 1000
};

type CacheEntry<T> = {
  t: number;
  v: T;
};

export type CacheHit<T> = {
  value: T;
  age: number;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();

function storageKey(key: string) {
  return `${CACHE_PREFIX}${key}`;
}

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function listCacheKeys(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

function evictOldest(storage: Storage, portion = 0.5) {
  const entries = listCacheKeys(storage).map((key) => {
    let timestamp = 0;
    try {
      timestamp = (JSON.parse(storage.getItem(key) || "{}") as CacheEntry<unknown>).t ?? 0;
    } catch {
      timestamp = 0;
    }
    return { key, timestamp };
  });

  entries.sort((a, b) => a.timestamp - b.timestamp);

  const removeCount = Math.max(1, Math.ceil(entries.length * portion));
  for (const entry of entries.slice(0, removeCount)) {
    storage.removeItem(entry.key);
    memoryCache.delete(entry.key.slice(CACHE_PREFIX.length));
  }
}

export function readCache<T>(key: string): CacheHit<T> | null {
  const cached = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (cached) return { value: cached.v, age: Date.now() - cached.t };

  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(storageKey(key));
  if (!raw) return null;

  try {
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry?.t !== "number") throw new Error("Malformed cache entry");

    memoryCache.set(key, entry);
    return { value: entry.v, age: Date.now() - entry.t };
  } catch {
    storage.removeItem(storageKey(key));
    return null;
  }
}

export function readFreshCache<T>(key: string, ttlMs: number): T | null {
  const hit = readCache<T>(key);
  if (!hit) return null;
  return hit.age <= ttlMs ? hit.value : null;
}

export function writeCache<T>(key: string, value: T) {
  const entry: CacheEntry<T> = { t: Date.now(), v: value };
  memoryCache.set(key, entry);

  const storage = getStorage();
  if (!storage) return;

  let serialized: string;
  try {
    serialized = JSON.stringify(entry);
  } catch (error) {
    console.warn(`Marketplace: could not serialize cache entry "${key}"`, error);
    return;
  }

  if (serialized.length > MAX_ENTRY_BYTES) return;

  try {
    storage.setItem(storageKey(key), serialized);
  } catch {
    try {
      evictOldest(storage);
      storage.setItem(storageKey(key), serialized);
    } catch (error) {
      console.warn(`Marketplace: cache write failed for "${key}"`, error);
    }
  }
}

export function removeCache(key: string) {
  memoryCache.delete(key);
  getStorage()?.removeItem(storageKey(key));
}

export function clearRequestCache() {
  memoryCache.clear();

  const storage = getStorage();
  if (!storage) return;

  for (const key of listCacheKeys(storage)) {
    storage.removeItem(key);
  }
}

export function pruneRequestCache(maxAgeMs: number) {
  const storage = getStorage();
  if (!storage) return;

  const cutoff = Date.now() - maxAgeMs;
  for (const key of listCacheKeys(storage)) {
    try {
      const entry = JSON.parse(storage.getItem(key) || "{}") as CacheEntry<unknown>;
      if ((entry.t ?? 0) < cutoff) {
        storage.removeItem(key);
        memoryCache.delete(key.slice(CACHE_PREFIX.length));
      }
    } catch {
      storage.removeItem(key);
    }
  }
}
