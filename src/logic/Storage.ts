import { APP_ID, APP_NAME, STORAGE_PREFIX } from "../constants";

const DATABASE_NAME = APP_ID;
const DATABASE_VERSION = 1;
const STORE_NAME = "settings";
const UPSTREAM_DATABASE_NAMES = ["spicetify-marketplace"];
const IMPORT_MARKER_KEY = `${APP_ID}:internal:imported`;
const FALLBACK_PREFIX = `${APP_ID}:fallback:`;
const HYDRATION_RETRY_DELAYS_MS = [150, 400, 1000];

type StoredRecord = {
  key: string;
  value: string;
};

export type StorageDraft = {
  get(key: string): string | undefined;
  has(key: string): boolean;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
};

export type ImportResult = {
  source: string;
  count: number;
};

const MAX_FLUSH_ROUNDS = 10;

const cache = new Map<string, string>();
const pendingWrites = new Set<Promise<unknown>>();
let databasePromise: Promise<IDBDatabase | null> | null = null;
let hydrationPromise: Promise<void> | null = null;
let hydrated = false;
let databaseUnavailable = false;
let mutationQueue: Promise<unknown> = Promise.resolve();

function trackWrite<T>(write: Promise<T>) {
  pendingWrites.add(write);
  void write.catch(() => undefined).finally(() => pendingWrites.delete(write));
  return write;
}

function isMarketplaceKey(key: string) {
  return key.startsWith(STORAGE_PREFIX);
}

function openNamedDatabase(name: string, version?: number, upgrade?: (database: IDBDatabase) => void) {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = version === undefined ? window.indexedDB.open(name) : window.indexedDB.open(name, version);
    } catch (error) {
      console.warn(`${APP_NAME}: could not open the ${name} database`, error);
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn(`${APP_NAME}: the ${name} database is unavailable`, request.error);
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = openNamedDatabase(DATABASE_NAME, DATABASE_VERSION, (database) => {
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "key" });
  }).then((database) => {
    if (!database) databaseUnavailable = true;
    return database;
  });

  return databasePromise;
}

async function runTransaction(mode: IDBTransactionMode, run: (store: IDBObjectStore) => void): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, mode);
    } catch (error) {
      console.warn(`${APP_NAME}: the storage transaction could not be opened`, error);
      settle(false);
      return;
    }

    transaction.oncomplete = () => settle(true);
    transaction.onerror = () => {
      console.warn(`${APP_NAME}: the storage transaction failed`, transaction.error);
      settle(false);
    };
    transaction.onabort = () => {
      console.warn(`${APP_NAME}: the storage transaction was aborted`, transaction.error);
      settle(false);
    };

    try {
      run(transaction.objectStore(STORE_NAME));
    } catch (error) {
      console.warn(`${APP_NAME}: the storage request failed`, error);
      try {
        transaction.abort();
      } catch {
        settle(false);
      }
    }
  });
}

function readAllFrom(database: IDBDatabase): Promise<StoredRecord[]> {
  return new Promise((resolve, reject) => {
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      resolve([]);
      return;
    }

    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve((request.result as StoredRecord[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Storage read failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Storage read aborted"));
  });
}

async function readAllRecords(): Promise<StoredRecord[] | null> {
  const database = await openDatabase();
  if (!database) return null;
  return readAllFrom(database);
}

function readLocalStorageFallback(): StoredRecord[] {
  const records: StoredRecord[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(FALLBACK_PREFIX)) continue;

      const value = window.localStorage.getItem(key);
      if (value !== null) records.push({ key: key.slice(FALLBACK_PREFIX.length), value });
    }
  } catch (error) {
    console.warn(`${APP_NAME}: the localStorage fallback could not be read`, error);
  }

  return records;
}

function writeLocalStorageFallback(updates: StoredRecord[], removals: string[]) {
  try {
    for (const { key, value } of updates) window.localStorage.setItem(`${FALLBACK_PREFIX}${key}`, value);
    for (const key of removals) window.localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
  } catch (error) {
    console.warn(`${APP_NAME}: the localStorage fallback could not be written`, error);
  }
}

function clearLocalStorageFallback(keys: string[]) {
  try {
    for (const key of keys) window.localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
  } catch (error) {
    console.warn(`${APP_NAME}: the localStorage fallback could not be cleared`, error);
  }
}

async function drainLocalStorageFallback() {
  const records = readLocalStorageFallback();
  if (!records.length) return;

  for (const { key, value } of records) cache.set(key, value);
  if (databaseUnavailable) return;

  const persisted = await runTransaction("readwrite", (store) => {
    for (const record of records) store.put(record);
  });

  if (persisted) clearLocalStorageFallback(records.map((record) => record.key));
}

async function persistChanges(updates: StoredRecord[], removals: string[]) {
  if (!updates.length && !removals.length) return;

  const persisted = await runTransaction("readwrite", (store) => {
    for (const record of updates) store.put(record);
    for (const key of removals) store.delete(key);
  });

  if (!persisted) writeLocalStorageFallback(updates, removals);
}

function createDraft(draft: Map<string, string>): StorageDraft {
  return {
    get: (key) => draft.get(key),
    has: (key) => draft.has(key),
    set: (key, value) => void draft.set(key, value),
    delete: (key) => void draft.delete(key),
    keys: () => Array.from(draft.keys())
  };
}

function applyDraft(previous: Map<string, string>, next: Map<string, string>) {
  const updates: StoredRecord[] = [];
  const removals: string[] = [];

  for (const [key, value] of next) {
    if (previous.get(key) !== value) updates.push({ key, value });
  }
  for (const key of previous.keys()) {
    if (!next.has(key)) removals.push(key);
  }

  return { updates, removals };
}

function commit(mutate: (draft: StorageDraft) => void) {
  const previous = new Map(cache);
  const draft = new Map(cache);
  mutate(createDraft(draft));

  const { updates, removals } = applyDraft(previous, draft);
  if (!updates.length && !removals.length) return Promise.resolve();

  cache.clear();
  for (const [key, value] of draft) cache.set(key, value);

  return trackWrite(persistChanges(updates, removals));
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function loadIndexedDBCache() {
  const records = await readAllRecords();
  if (!records) return false;

  for (const record of records) cache.set(record.key, record.value);
  return cache.has(IMPORT_MARKER_KEY);
}

async function databaseExists(name: string) {
  const list = (window.indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> })?.databases;
  if (typeof list !== "function") return true;

  try {
    return (await list.call(window.indexedDB)).some((entry) => entry.name === name);
  } catch {
    return true;
  }
}

async function readUpstreamDatabase(name: string): Promise<StoredRecord[]> {
  if (!(await databaseExists(name))) return [];

  const database = await openNamedDatabase(name);
  if (!database) return [];

  try {
    return (await readAllFrom(database)).filter((record) => isMarketplaceKey(record.key));
  } catch (error) {
    console.warn(`${APP_NAME}: could not read the ${name} database`, error);
    return [];
  } finally {
    database.close();
  }
}

function readUpstreamLocalStorage(): StoredRecord[] {
  const records: StoredRecord[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key || !isMarketplaceKey(key)) continue;

      const value = window.localStorage.getItem(key);
      if (value !== null) records.push({ key, value });
    }
  } catch (error) {
    console.warn(`${APP_NAME}: could not read the Spicetify Marketplace localStorage data`, error);
  }

  return records;
}

async function findUpstreamData(): Promise<ImportResult & { records: StoredRecord[] }> {
  for (const name of UPSTREAM_DATABASE_NAMES) {
    const records = await readUpstreamDatabase(name);
    if (records.length) return { source: `IndexedDB "${name}"`, count: records.length, records };
  }

  const records = readUpstreamLocalStorage();
  return { source: "localStorage", count: records.length, records };
}

async function importUpstreamData(overwrite: boolean): Promise<ImportResult> {
  const { source, records } = await findUpstreamData();
  const imported = overwrite ? records : records.filter((record) => !cache.has(record.key));

  for (const { key, value } of imported) cache.set(key, value);

  await persistChanges([...imported, { key: IMPORT_MARKER_KEY, value: "1" }], []);
  cache.set(IMPORT_MARKER_KEY, "1");

  return { source, count: imported.length };
}

export async function hydrateMarketplaceStorage() {
  if (hydrated) return;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    let alreadyImported = false;

    for (let attempt = 0; ; attempt++) {
      try {
        alreadyImported = await loadIndexedDBCache();
        break;
      } catch (error) {
        if (attempt >= HYDRATION_RETRY_DELAYS_MS.length) throw error;
        console.warn(`${APP_NAME}: storage hydration failed, retrying`, error);
        databasePromise = null;
        await new Promise((resolve) => setTimeout(resolve, HYDRATION_RETRY_DELAYS_MS[attempt]));
      }
    }

    await drainLocalStorageFallback();
    alreadyImported = cache.has(IMPORT_MARKER_KEY);

    if (!alreadyImported) {
      const { source, count } = await importUpstreamData(false);
      if (count) console.log(`${APP_NAME}: imported ${count} entries from Spicetify Marketplace (${source}). The original data was left untouched.`);
    }

    hydrated = true;
  })();

  try {
    await hydrationPromise;
  } catch (error) {
    hydrationPromise = null;
    throw error;
  }
}

export async function reimportSpicetifyMarketplaceData() {
  const result = await enqueue(() => importUpstreamData(true));
  console.log(`${APP_NAME}: re-imported ${result.count} entries from Spicetify Marketplace (${result.source})`);
  return result;
}

export const marketplaceStorage = {
  getItem(key: string) {
    return cache.get(key) ?? null;
  },

  setItem(key: string, value: string) {
    void enqueue(() => commit((storage) => storage.set(key, value)));
  },

  async setItemAsync(key: string, value: string) {
    await enqueue(() => commit((storage) => storage.set(key, value)));
  },

  removeItem(key: string) {
    void enqueue(() => commit((storage) => storage.delete(key)));
  },

  async removeItemAsync(key: string) {
    await enqueue(() => commit((storage) => storage.delete(key)));
  },

  async mutateAsync(mutate: (storage: StorageDraft) => void) {
    await enqueue(() => commit(mutate));
  },

  async flush() {
    for (let round = 0; round < MAX_FLUSH_ROUNDS && pendingWrites.size; round++) {
      await Promise.allSettled([...pendingWrites]);
    }

    if (pendingWrites.size) console.warn(`${APP_NAME}: ${pendingWrites.size} storage writes did not settle before flushing`);
  },

  keys() {
    return Array.from(cache.keys());
  },

  entries() {
    return Object.fromEntries(cache.entries()) as Record<string, string>;
  }
};
