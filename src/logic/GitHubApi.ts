import { t } from "i18next";

import { CACHE_TTL, readCache, readFreshCache, writeCache } from "./RequestCache";

const RATE_LIMIT_STATE_KEY = "github:rate-limit-reset";
const DEFAULT_TIMEOUT_MS = 15000;
const SECONDARY_LIMIT_BACKOFF_MS = 60 * 1000;

export type RemoteResult<T> = {
  data: T | null;
  fromCache: boolean;
  stale: boolean;
  rateLimited: boolean;
  status: number | null;
};

type FetchOptions = {
  cacheKey?: string;
  ttlMs?: number;
  timeoutMs?: number;
  notifyOnRateLimit?: boolean;
  init?: RequestInit;
};

const inflight = new Map<string, Promise<RemoteResult<unknown>>>();

let rateLimitedUntil = readFreshCache<number>(RATE_LIMIT_STATE_KEY, CACHE_TTL.repo) ?? 0;
let notifiedForWindow = 0;

export function getRateLimitResetTime() {
  return rateLimitedUntil;
}

export function isGitHubRateLimited() {
  return Date.now() < rateLimitedUntil;
}

function setRateLimited(untilMs: number) {
  if (untilMs <= rateLimitedUntil) return;
  rateLimitedUntil = untilMs;
  writeCache(RATE_LIMIT_STATE_KEY, untilMs);
}

function notifyRateLimited() {
  if (notifiedForWindow === rateLimitedUntil) return;
  notifiedForWindow = rateLimitedUntil;

  const minutes = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 60000));
  Spicetify?.showNotification?.(t("notifications.rateLimited", { minutes }), true, 5000);
}

function parseRateLimitHeaders(response: Response) {
  const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Date.now() + retryAfter * 1000;

  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = Number.parseInt(response.headers.get("x-ratelimit-reset") || "", 10);
  if (remaining === "0" && Number.isFinite(reset) && reset > 0) return reset * 1000;

  return Date.now() + SECONDARY_LIMIT_BACKOFF_MS;
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function staleResult<T>(cacheKey: string, rateLimited: boolean, status: number | null): RemoteResult<T> {
  const hit = readCache<T>(cacheKey);
  return {
    data: hit ? hit.value : null,
    fromCache: hit !== null,
    stale: hit !== null,
    rateLimited,
    status
  };
}

async function request<T>(url: string, options: FetchOptions, isApi: boolean): Promise<RemoteResult<T>> {
  const { cacheKey = url, ttlMs = CACHE_TTL.searchPage, timeoutMs = DEFAULT_TIMEOUT_MS, notifyOnRateLimit = true, init } = options;

  const fresh = readFreshCache<T>(cacheKey, ttlMs);
  if (fresh !== null) {
    return { data: fresh, fromCache: true, stale: false, rateLimited: false, status: null };
  }

  if (isApi && isGitHubRateLimited()) {
    if (notifyOnRateLimit) notifyRateLimited();
    return staleResult<T>(cacheKey, true, null);
  }

  const existing = inflight.get(cacheKey);
  if (existing) return existing as Promise<RemoteResult<T>>;

  const pending = (async (): Promise<RemoteResult<T>> => {
    try {
      const headers = isApi ? { Accept: "application/vnd.github+json", ...init?.headers } : init?.headers;
      const response = await fetchWithTimeout(url, { ...init, headers }, timeoutMs);

      if (isApi && (response.status === 403 || response.status === 429)) {
        setRateLimited(parseRateLimitHeaders(response));
        if (notifyOnRateLimit) notifyRateLimited();
        return staleResult<T>(cacheKey, true, response.status);
      }

      if (!response.ok) {
        console.warn(`Marketplace: request to ${url} failed with HTTP ${response.status}`);
        return staleResult<T>(cacheKey, false, response.status);
      }

      const data = (await response.json()) as T;
      writeCache(cacheKey, data);

      return { data, fromCache: false, stale: false, rateLimited: false, status: response.status };
    } catch (error) {
      console.warn(`Marketplace: request to ${url} failed`, error);
      return staleResult<T>(cacheKey, false, null);
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, pending as Promise<RemoteResult<unknown>>);
  return pending;
}

export function fetchGitHubJson<T>(url: string, options: FetchOptions = {}) {
  return request<T>(url, options, true);
}

export function fetchJsonResource<T>(url: string, options: FetchOptions = {}) {
  return request<T>(url, { ttlMs: CACHE_TTL.resource, ...options }, false);
}
