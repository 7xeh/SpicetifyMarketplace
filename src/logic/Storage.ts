const DATABASE_NAME = "spicetify-marketplace";
const DATABASE_VERSION = 1;
const STORE_NAME = "settings";
const MARKETPLACE_KEY_PREFIX = "marketplace:";
const LOCAL_STORAGE_MIGRATION_KEY = "spicetify-marketplace:internal:local-storage-migrated";
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
  return key.startsWith(MARKETPLACE_KEY_PREFIX);
}

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    if (!window.indexedDB) {
      databaseUnavailable = true;
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "key" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn("Marketplace IndexedDB storage unavailable", request.error);
      databaseUnavailable = true;
      resolve(null);
    };
    request.onblocked = () => {
      databaseUnavailable = true;
      resolve(null);
    };
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
      console.warn("Marketplace IndexedDB transaction could not be opened", error);
      settle(false);
      return;
    }

    transaction.oncomplete = () => settle(true);
    transaction.onerror = () => {
      console.warn("Marketplace IndexedDB transaction failed", transaction.error);
      settle(false);
    };
    transaction.onabort = () => {
      console.warn("Marketplace IndexedDB transaction aborted", transaction.error);
      settle(false);
    };

    try {
      run(transaction.objectStore(STORE_NAME));
    } catch (error) {
      console.warn("Marketplace IndexedDB request failed", error);
      try {
        transaction.abort();
      } catch {
        settle(false);
      }
    }
  });
}

function readAllRecords(): Promise<StoredRecord[] | null> {
  return openDatabase().then((database) => {
    if (!database) return null;

    return new Promise<StoredRecord[] | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();

      request.onsuccess = () => resolve((request.result as StoredRecord[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error("Marketplace IndexedDB read failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Marketplace IndexedDB read aborted"));
    });
  });
}

function writeLocalStorageFallback(updates: StoredRecord[], removals: string[]) {
  try {
    for (const { key, value } of updates) window.localStorage.setItem(key, value);
    for (const key of removals) window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("Marketplace localStorage fallback failed", error);
  }
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

  let migrationComplete = false;
  for (const record of records) {
    if (record.key === LOCAL_STORAGE_MIGRATION_KEY) {
      migrationComplete = true;
      cache.set(record.key, record.value);
      continue;
    }

    cache.set(record.key, record.value);
  }

  return migrationComplete;
}

async function migrateLocalStorage(migrationComplete: boolean) {
  const legacyKeys: string[] = [];
  const records: StoredRecord[] = [];

  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (!key || !isMarketplaceKey(key)) continue;

    legacyKeys.push(key);
    if (migrationComplete || cache.has(key)) continue;

    const value = window.localStorage.getItem(key);
    if (value !== null) records.push({ key, value });
  }

  if (!legacyKeys.length && migrationComplete) return;

  for (const { key, value } of records) cache.set(key, value);

  if (databaseUnavailable) return;

  const persisted = await runTransaction("readwrite", (store) => {
    for (const record of records) store.put(record);
    store.put({ key: LOCAL_STORAGE_MIGRATION_KEY, value: "1" });
  });

  if (!persisted) return;

  cache.set(LOCAL_STORAGE_MIGRATION_KEY, "1");

  for (const key of legacyKeys) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Marketplace could not remove the migrated key ${key}`, error);
    }
  }
}

export async function hydrateMarketplaceStorage() {
  if (hydrated) return;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    let migrationComplete = false;

    for (let attempt = 0; ; attempt++) {
      try {
        migrationComplete = await loadIndexedDBCache();
        break;
      } catch (error) {
        if (attempt >= HYDRATION_RETRY_DELAYS_MS.length) throw error;
        console.warn("Marketplace storage hydration failed, retrying", error);
        databasePromise = null;
        await new Promise((resolve) => setTimeout(resolve, HYDRATION_RETRY_DELAYS_MS[attempt]));
      }
    }

    await migrateLocalStorage(migrationComplete);
    hydrated = true;
  })();

  try {
    await hydrationPromise;
  } catch (error) {
    hydrationPromise = null;
    throw error;
  }
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

    if (pendingWrites.size) console.warn(`Marketplace: ${pendingWrites.size} storage writes did not settle before flushing`);
  },

  keys() {
    return Array.from(cache.keys());
  },

  entries() {
    return Object.fromEntries(cache.entries()) as Record<string, string>;
  }
};
