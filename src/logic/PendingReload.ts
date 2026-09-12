import { APP_NAME, LOCALSTORAGE_KEYS, SESSION_KEYS } from "../constants";
import { marketplaceStorage } from "./Storage";
import { getLocalStorageDataFromKey, getStringArrayFromKey } from "./Utils";

export type LoadedEntry = {
  key: string;
  title: string;
};

export type PendingChange = {
  key: string;
  title: string;
  action: "enable" | "disable";
};

const listeners = new Set<() => void>();

function readEntries(sessionKey: string): LoadedEntry[] {
  try {
    const raw = window.sessionStorage.getItem(sessionKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is LoadedEntry => Boolean(entry) && typeof entry.key === "string" && typeof entry.title === "string");
  } catch {
    return [];
  }
}

function writeEntries(sessionKey: string, entries: LoadedEntry[]) {
  try {
    window.sessionStorage.setItem(sessionKey, JSON.stringify(entries));
  } catch (error) {
    console.warn(`${APP_NAME}: could not record the loaded runtime state`, error);
  }
}

export function recordLoadedExtensions(entries: LoadedEntry[]) {
  writeEntries(SESSION_KEYS.loadedExtensions, entries);
}

export function recordLoadedThemeScripts(entries: LoadedEntry[]) {
  writeEntries(SESSION_KEYS.loadedThemeScripts, entries);
}

export function markRuntimeLoaded() {
  try {
    window.sessionStorage.setItem(SESSION_KEYS.runtimeReady, "1");
  } catch (error) {
    console.warn(`${APP_NAME}: could not record the loaded runtime state`, error);
  }
}

function isRuntimeLoaded() {
  try {
    return window.sessionStorage.getItem(SESSION_KEYS.runtimeReady) === "1";
  } catch {
    return false;
  }
}

function titleForKey(key: string, fallback: string) {
  const stored = getLocalStorageDataFromKey(key);
  if (stored && typeof stored === "object") {
    if (typeof stored.title === "string" && stored.title) return stored.title;
    if (typeof stored.manifest?.name === "string" && stored.manifest.name) return stored.manifest.name;
  }
  return fallback;
}

export function installedThemeScripts(): LoadedEntry[] {
  const themeKey = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.themeInstalled, null);
  if (typeof themeKey !== "string" || !themeKey) return [];

  const theme = getLocalStorageDataFromKey(themeKey);
  if (!theme || !Array.isArray(theme.include)) return [];

  const title = titleForKey(themeKey, themeKey);
  return theme.include
    .filter((script: unknown): script is string => typeof script === "string" && script.length > 0)
    .map((script) => ({ key: script, title }));
}

function diff(loaded: LoadedEntry[], current: LoadedEntry[]): PendingChange[] {
  const loadedKeys = new Set(loaded.map((entry) => entry.key));
  const currentKeys = new Set(current.map((entry) => entry.key));

  const changes: PendingChange[] = [];
  for (const entry of current) {
    if (!loadedKeys.has(entry.key)) changes.push({ key: entry.key, title: entry.title, action: "enable" });
  }
  for (const entry of loaded) {
    if (!currentKeys.has(entry.key)) changes.push({ key: entry.key, title: entry.title, action: "disable" });
  }
  return changes;
}

export function getPendingChanges(): PendingChange[] {
  if (!isRuntimeLoaded()) return [];

  const installedExtensions = getStringArrayFromKey(LOCALSTORAGE_KEYS.installedExtensions)
    .filter((key) => marketplaceStorage.getItem(key) !== null)
    .map((key) => ({ key, title: titleForKey(key, key) }));

  return [
    ...diff(readEntries(SESSION_KEYS.loadedExtensions), installedExtensions),
    ...diff(readEntries(SESSION_KEYS.loadedThemeScripts), installedThemeScripts())
  ];
}

export function notifyPendingChanges() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn(`${APP_NAME}: a pending-reload listener failed`, error);
    }
  }
}

export function subscribePendingChanges(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
