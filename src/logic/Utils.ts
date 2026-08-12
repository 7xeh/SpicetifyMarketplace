import Chroma from "chroma-js";
import { t } from "i18next";

import type { CardProps } from "../components/Card/Card";
import { LOCALSTORAGE_KEYS } from "../constants";
import type { Author, CardItem, ColourScheme, ResetCategory, SchemeIni, Snippet, SortBoxOption } from "../types/marketplace-types";
import { marketplaceStorage } from "./Storage";

export const getLocalStorageDataFromKey = (key: string, fallback?: unknown) => {
  const data = marketplaceStorage.getItem(key);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  } else {
    return fallback;
  }
};

export const getStringArrayFromKey = (key: string): string[] => {
  const data = getLocalStorageDataFromKey(key, []);
  if (!Array.isArray(data)) return [];
  return data.filter((entry): entry is string => typeof entry === "string");
};

export const getBooleanFromKey = (key: string, fallback: boolean): boolean => {
  const data = getLocalStorageDataFromKey(key, fallback);
  if (typeof data === "boolean") return data;
  if (data === "true") return true;
  if (data === "false") return false;
  return fallback;
};

const matchesBlacklistPattern = (url: string, pattern: string): boolean => {
  if (typeof url !== "string" || typeof pattern !== "string") return false;

  const normalizedUrl = url.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (!normalizedPattern.includes("*")) return normalizedUrl === normalizedPattern;

  const regexPattern = normalizedPattern
    .replace(/\*{2,}/g, "*")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]+");

  try {
    return new RegExp(`^${regexPattern}$`).test(normalizedUrl);
  } catch {
    return false;
  }
};

export const isBlacklisted = (url: string, blacklist: string[]): boolean => {
  if (!Array.isArray(blacklist)) return false;
  return blacklist.some((pattern) => matchesBlacklistPattern(url, pattern));
};

export const getCardTitle = (item?: CardItem | Snippet | null): string => {
  if (!item) return "";
  return (typeof item.title === "string" && item.title) || (typeof item.manifest?.name === "string" && item.manifest.name) || "";
};

export const isRenderableCardItem = (item: unknown): item is CardItem | Snippet => {
  if (!item || typeof item !== "object") return false;
  return getCardTitle(item as CardItem | Snippet).length > 0;
};

export const cardMatchesSearch = (item: CardItem | Snippet | undefined | null, searchValue: string): boolean => {
  if (!searchValue) return true;
  if (!item) return false;

  const haystack: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value) haystack.push(value.toLowerCase());
  };

  push(item.title);
  push(item.manifest?.name);
  push(item.user);
  push(item.repo);

  if (Array.isArray(item.authors)) {
    for (const author of item.authors) push(author?.name);
  }
  if (Array.isArray(item.tags)) {
    for (const tag of item.tags) push(tag);
  }

  return haystack.some((value) => value.includes(searchValue));
};

const hexToRGB = (inputHex: string) => {
  const hex =
    inputHex.length === 3
      ? inputHex
          .split("")
          .map((char) => char + char)
          .join("")
      : inputHex;

  if (hex.length !== 6) {
    throw "Only 3- or 6-digit hex colours are allowed.";
  }

  if (hex.match(/[^0-9a-f]/i)) {
    throw "Only hex colours are allowed.";
  }

  const aRgbHex = hex.match(/.{1,2}/g);
  if (!aRgbHex || aRgbHex.length !== 3) {
    throw "Could not parse hex colour.";
  }

  const aRgb = [Number.parseInt(aRgbHex[0], 16), Number.parseInt(aRgbHex[1], 16), Number.parseInt(aRgbHex[2], 16)];

  return aRgb;
};

export const parseIni = (data: string): SchemeIni => {
  const regex = {
    section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
    param: /^\s*([^=]+?)\s*=\s*(.*?)\s*$/,
    comment: /^\s*;.*$/
  };
  const value: SchemeIni = {};
  const lines = data.split(/[\r\n]+/);
  let section: string | null = null;

  for (const line of lines) {
    if (regex.comment.test(line)) {
      continue;
    }

    if (regex.param.test(line)) {
      if (line.includes("xrdb")) {
        continue;
      }

      const match = line.match(regex.param);
      if (section && match && match.length === 3) {
        const key = match[1].trim();
        const val = match[2].split(";")[0].trim();
        if (!value[section]) {
          value[section] = {};
        }
        value[section][key] = val;
      }
    } else if (regex.section.test(line)) {
      const match = line.match(regex.section);
      if (match) {
        section = match[1];
        value[section] = {};
      }
    }
  }
  return value;
};

export const unparseIni = (data: SchemeIni) => {
  let output = "";
  for (const key in data) {
    if (Object.hasOwn(data, key)) {
      if (typeof data[key] === "object") {
        output += `[${key}]\n`;
        for (const subKey in data[key]) {
          if (Object.hasOwn(data[key], subKey)) {
            output += `${subKey}=${data[key][subKey]}\n`;
          }
        }
      } else {
        output += `${key}=${data[key]}\n`;
      }
    }
  }
  return output;
};

export const initializeSnippets = (snippets: Snippet[]) => {
  const existingSnippets = document.querySelector("style.marketplaceSnippets");
  if (existingSnippets) existingSnippets.remove();

  const style = document.createElement("style");
  const commentSafe = (value: unknown) => (typeof value === "string" ? value.replace(/\*\//g, "*\\/") : "");

  const styleContent = (Array.isArray(snippets) ? snippets : []).reduce((accum, snippet) => {
    if (!snippet || typeof snippet.code !== "string") return accum;
    return `${accum}/* ${commentSafe(snippet.title)} - ${commentSafe(snippet.description)} */\n${snippet.code}\n`;
  }, "");

  style.textContent = styleContent;
  style.classList.add("marketplaceSnippets");
  document.body.appendChild(style);
};

export const fileToBase64 = (file: File) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = (error) => {
      reject(error);
    };
  });
};

export const processAuthors = (authors: Author[], user: string) => {
  let parsedAuthors: Author[] = [];

  if (authors && authors.length > 0) {
    parsedAuthors = authors.map((author) => ({
      name: author.name,
      url: sanitizeUrl(author.url)
    }));
  } else {
    parsedAuthors.push({
      name: user,
      url: `https://github.com/${user}`
    });
  }

  return parsedAuthors;
};

export const generateSchemesOptions = (schemes: SchemeIni) => {
  if (!schemes) return [];
  return Object.keys(schemes).map((schemeName) => ({ key: schemeName, value: schemeName }) as SortBoxOption);
};

export const generateSortOptions = (t: (key: string) => string) => {
  return [
    { key: "stars", value: t("grid.sort.stars") },
    { key: "newest", value: t("grid.sort.newest") },
    { key: "oldest", value: t("grid.sort.oldest") },
    { key: "lastUpdated", value: t("grid.sort.lastUpdated") },
    { key: "mostStale", value: t("grid.sort.mostStale") },
    { key: "a-z", value: t("grid.sort.aToZ") },
    { key: "z-a", value: t("grid.sort.zToA") }
  ];
};

async function removeMarketplaceData(categories: ResetCategory[]) {
  console.debug("Resetting Marketplace");

  const keysToRemove: string[] = [];

  if (categories.length === 0) {
    for (const key of marketplaceStorage.keys()) {
      if (key.startsWith("marketplace:")) keysToRemove.push(key);
    }
  }

  for (const category of categories) {
    switch (category) {
      case "extensions":
        keysToRemove.push(...getStringArrayFromKey(LOCALSTORAGE_KEYS.installedExtensions));
        keysToRemove.push(LOCALSTORAGE_KEYS.installedExtensions);
        break;

      case "snippets":
        keysToRemove.push(...getStringArrayFromKey(LOCALSTORAGE_KEYS.installedSnippets));
        keysToRemove.push(LOCALSTORAGE_KEYS.installedSnippets);
        break;

      case "theme":
        keysToRemove.push(...getStringArrayFromKey(LOCALSTORAGE_KEYS.installedThemes));
        keysToRemove.push(LOCALSTORAGE_KEYS.installedThemes);
        keysToRemove.push(LOCALSTORAGE_KEYS.themeInstalled);
        break;

      default:
        console.error(`Unknown category: ${category}`);
        break;
    }
  }

  for (const key of new Set(keysToRemove)) {
    await marketplaceStorage.removeItemAsync(key);
    console.debug(`Removed ${key}`);
  }

  console.debug("Marketplace has been reset");
}

export const resetMarketplace = (...categories: ResetCategory[]) => {
  void resetMarketplaceAsync(...categories);
};

export const resetMarketplaceAsync = async (...categories: ResetCategory[]) => {
  await removeMarketplaceData(categories);
  location.reload();
};

export const exportMarketplace = () => {
  const data = {};

  for (const [key, value] of Object.entries(marketplaceStorage.entries())) {
    if (key.startsWith("marketplace:")) {
      data[key] = value;
    }
  }
  return data as JSON;
};

function isMarketplaceBackupData(data: unknown): data is Record<string, string> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  if (Object.getPrototypeOf(data) !== Object.prototype) return false;

  const entries = Object.entries(data);
  if (entries.length === 0) return false;

  return entries.every(([key, value]) => key.startsWith("marketplace:") && typeof value === "string");
}

export const importMarketplace = async (data: unknown) => {
  if (!isMarketplaceBackupData(data)) throw new Error("Invalid Marketplace backup data");

  console.debug("Importing Marketplace");
  await removeMarketplaceData([]);
  for (const key in data) {
    await marketplaceStorage.setItemAsync(key, data[key]);
    console.debug(`Imported ${key}`);
  }
};

const SCHEME_KEY_PATTERN = /^[\w-]+$/;

export const injectColourScheme = (scheme: ColourScheme | null) => {
  const existingMarketplaceSchemeCSS = document.querySelector("style.marketplaceCSS.marketplaceScheme");
  if (existingMarketplaceSchemeCSS) existingMarketplaceSchemeCSS.remove();

  if (scheme && typeof scheme === "object") {
    const schemeTag = document.createElement("style");
    schemeTag.classList.add("marketplaceCSS");
    schemeTag.classList.add("marketplaceScheme");

    let injectStr = ":root {";
    const themeIniKeys = Object.keys(scheme);
    for (const key of themeIniKeys) {
      if (!SCHEME_KEY_PATTERN.test(key)) {
        console.warn(`Marketplace: skipping unusable colour scheme key "${key}"`);
        continue;
      }

      const value = typeof scheme[key] === "string" ? scheme[key].trim().replace(/^#/, "") : "";

      let rgb: number[];
      try {
        rgb = hexToRGB(value);
      } catch (error) {
        console.warn(`Marketplace: skipping invalid colour "${scheme[key]}" for "${key}"`, error);
        continue;
      }

      injectStr += `--spice-${key}: #${value};`;
      injectStr += `--spice-rgb-${key}: ${rgb};`;
    }
    injectStr += "}";
    schemeTag.textContent = injectStr;
    document.body.appendChild(schemeTag);
  }
};

export const injectUserCSS = (userCSS?: string) => {
  try {
    const existingUserThemeCSS = document.querySelector("link[href='user.css']");
    if (existingUserThemeCSS) existingUserThemeCSS.remove();

    const existingMarketplaceUserCSS = document.querySelector("style.marketplaceCSS.marketplaceUserCSS");
    if (existingMarketplaceUserCSS) existingMarketplaceUserCSS.remove();

    if (userCSS) {
      const userCssTag = document.createElement("style");
      userCssTag.classList.add("marketplaceCSS");
      userCssTag.classList.add("marketplaceUserCSS");
      userCssTag.textContent = userCSS;
      document.body.appendChild(userCssTag);
    } else {
      const originalUserThemeCSS = document.createElement("link");
      originalUserThemeCSS.setAttribute("rel", "stylesheet");
      originalUserThemeCSS.setAttribute("href", "user.css");
      originalUserThemeCSS.classList.add("userCSS");
      document.body.appendChild(originalUserThemeCSS);
    }
  } catch (error) {
    console.warn(error);
  }
};

export const initColorShiftLoop = (schemes: SchemeIni) => {
  let i = 0;
  const NUM_SCHEMES = schemes ? Object.keys(schemes).length : 0;
  if (!NUM_SCHEMES) return;

  setInterval(() => {
    i = i % NUM_SCHEMES;
    injectColourScheme(Object.values(schemes)[i]);
    i++;
  }, 60 * 1000);
};

export const getColorFromUri = async (uri: string): Promise<string | undefined> => {
  const stored = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.albumArtBasedColorVibrancy, "PROMINENT");
  const vibrancy = String(stored)
    .replace(/([A-Z])/g, "_$1")
    .toUpperCase();

  try {
    const colorOptions = await Spicetify.colorExtractor(uri);
    const color = colorOptions?.[vibrancy] ?? colorOptions?.PROMINENT;

    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
      console.warn(`Marketplace: no usable colour extracted for ${uri}`, color);
      return undefined;
    }

    return color.substring(1);
  } catch (error) {
    console.error(`Marketplace: colour extraction failed for ${uri}`, error);
    return undefined;
  }
};

export const generateColorPalette = async (mainColor: string, numColors: number): Promise<string[]> => {
  const mode = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.albumArtBasedColorMode, "monochrome-light");
  const modeStr = String(mode)
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase();

  try {
    const response = await fetch(`https://www.thecolorapi.com/scheme?hex=${mainColor}&mode=${modeStr}&count=${numColors}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const palette = await response.json();
    if (!Array.isArray(palette?.colors)) throw new Error("Malformed palette response");

    return palette.colors.map((color) => color?.hex?.value?.substring(1)).filter((value): value is string => Boolean(value));
  } catch (error) {
    console.error("Marketplace: could not generate a colour palette", error);
    return [];
  }
};

async function waitForPlayerItem(timeoutMs = 10000): Promise<Spicetify.PlayerTrack | undefined> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const interval = setInterval(() => {
      const item = Spicetify.Player.data?.item;
      if (item?.uri) {
        clearInterval(interval);
        resolve(item);
        return;
      }

      if (Date.now() >= deadline) {
        clearInterval(interval);
        resolve(undefined);
      }
    }, 50);
  });
}

export const initAlbumArtBasedColor = (scheme: ColourScheme) => {
  Spicetify.Player.addEventListener("songchange", async () => {
    await sleep(1000);

    const item = Spicetify.Player.data?.item?.uri ? Spicetify.Player.data.item : await waitForPlayerItem();

    if (item?.uri && !item.isLocal) {
      const uri = item.uri;
      const numColors = new Set(Object.values(scheme)).size;
      const mainColor = await getColorFromUri(uri);
      if (!mainColor) return;

      const newColors = await generateColorPalette(mainColor, numColors);
      if (!newColors.length) return;
      let colorMap = new Map();
      for (const [key, value] of Object.entries(scheme)) {
        if (colorMap.has(value)) {
          colorMap.get(value).push(key);
        } else {
          colorMap.set(value, [key]);
        }
      }
      const orderedColorMap = new Map(
        [...colorMap.entries()].sort((a, b) => {
          const aColor = Chroma(a[0]);
          const bColor = Chroma(b[0]);
          return aColor.get("lab.l") - bColor.get("lab.l");
        })
      );
      colorMap = orderedColorMap;
      const newScheme = { ...scheme };
      for (const [, value] of colorMap.entries()) {
        const newColor = newColors.shift();
        if (newColor) {
          for (const key of value) {
            newScheme[key] = newColor;
          }
        }
      }
      injectColourScheme(newScheme);
    }
  });
};

export const parseCSS = async (themeData: CardItem, defaultTld?: string) => {
  if (!themeData.cssURL) throw new Error("No CSS URL provided");

  const tld = defaultTld || (await getAvailableTLD());

  const userCssUrl = isGithubRawUrl(themeData.cssURL)
    ? `https://cdn.jsdelivr.${tld}/gh/${themeData.user}/${themeData.repo}@${themeData.branch}/${themeData.manifest.usercss}`
    : themeData.cssURL;
  const assetsUrl = userCssUrl.replace("/user.css", "/assets/");

  console.debug("Parsing CSS: ", userCssUrl);
  const response = await fetch(`${userCssUrl}?time=${Date.now()}`);
  if (!response.ok) throw new Error(`Could not fetch ${userCssUrl} (HTTP ${response.status})`);

  const css = await response.text();

  return css.replace(/url\((['"])(?<path>.+?)\1\)/gm, (match, quote, url: string) => {
    if (!url || url.startsWith("http") || url.startsWith("data")) return match;

    return `url(${quote}${assetsUrl}${url.replace(/\.\//g, "")}${quote})`;
  });
};

export const isGithubRawUrl = (url: string) => {
  try {
    return new URL(url).host === "raw.githubusercontent.com";
  } catch {
    return false;
  }
};

export const getParamsFromGithubRaw = (url: string) => {
  const regex_result = url.match(/https:\/\/raw\.githubusercontent\.com\/(?<user>[^/]+)\/(?<repo>[^/]+)\/(?<branch>[^/]+)\/(?<filePath>.+$)/);

  const obj = {
    user: regex_result ? regex_result.groups?.user : null,
    repo: regex_result ? regex_result.groups?.repo : null,
    branch: regex_result ? regex_result.groups?.branch : null,
    filePath: regex_result ? regex_result.groups?.filePath : null
  };

  return obj;
};

export function addToSessionStorage(items, key?) {
  if (!items) return;
  for (const item of items) {
    const itemKey = key || `${item.user}-${item.repo}`;

    const existing = window.sessionStorage.getItem(itemKey);

    let parsed: unknown[] = [];
    try {
      const stored = existing ? JSON.parse(existing) : [];
      if (Array.isArray(stored)) parsed = stored;
    } catch {
      parsed = [];
    }

    parsed.push(item);
    window.sessionStorage.setItem(itemKey, JSON.stringify(parsed));
  }
}
export function getInvalidCSS(): string[] {
  const unparsedCSS = document.querySelector("body > style.marketplaceCSS.marketplaceUserCSS");
  const classNameList = unparsedCSS?.innerHTML;
  const regex = /.-?[_a-zA-Z]+[_a-zA-Z0-9-]*\s*{/g;
  if (!classNameList) return ["Error: Class name list not found; please create an issue"];
  const matches = classNameList.matchAll(regex);
  const invalidCssClassName: string[] = [];
  for (const match of matches) {
    const className = match[0].replace(/{/g, "").trim();
    const classesArr = className.split(" ");
    let element: HTMLCollectionOf<Element> | Element | null;
    for (let i = 0; i < classesArr.length; i++) {
      try {
        element = document.querySelector(`${classesArr[i]}`);
      } catch {
        element = document.getElementsByClassName(`${className}`);
      }
      if (!element) {
        invalidCssClassName.push(className);
      }
    }
  }
  return invalidCssClassName;
}

export async function getMarkdownHTML(markdown: string, user: string, repo: string) {
  try {
    const postBody = {
      text: markdown,
      context: `${user}/${repo}`,
      mode: "gfm"
    };

    const response = await fetch("https://api.github.com/markdown", {
      method: "POST",
      body: JSON.stringify(postBody)
    });
    if (!response.ok) throw Spicetify.showNotification(t("notifications.markdownParsingError", { status: response.status }), true);

    const html = await response.text();

    return html;
  } catch {
    return null;
  }
}

export function sleep(ms: number | undefined) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateKey(props: CardProps) {
  const prefix = props.type === "snippet" ? "snippet:" : `${props.item.user}/${props.item.repo}/`;

  let cardId: string;
  switch (props.type) {
    case "snippet":
      cardId = props.item.title.replaceAll(" ", "-");
      break;
    case "theme":
      cardId = props.item.manifest?.usercss || "";
      break;
    case "extension":
      cardId = props.item.manifest?.main || "";
      break;
    case "app":
      cardId = props.item.manifest?.name?.replaceAll(" ", "-") || "";
      break;
  }

  return `marketplace:installed:${prefix}${cardId}`;
}

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export const sanitizeUrl = (url: string) => {
  if (typeof url !== "string") return "about:blank";

  const stripped = url.replace(/[^\u0021-\u007e\u00a0-\uffff]/g, "");
  if (!stripped) return "about:blank";

  try {
    const parsed = new URL(stripped, "https://github.com");
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) return "about:blank";
  } catch {
    return "about:blank";
  }

  return stripped;
};

export const addExtensionToSpicetifyConfig = (main?: string) => {
  if (!main) return;

  const name = main.split("/").pop();
  if (name && Spicetify.Config.extensions.indexOf(name) === -1) {
    Spicetify.Config.extensions.push(name);
  }
};

const compareNames = (a: CardItem | Snippet, b: CardItem | Snippet) => {
  return getCardTitle(a).localeCompare(getCardTitle(b));
};

const compareCreated = (a: CardItem | Snippet, b: CardItem | Snippet) => {
  if (!a?.created || !b?.created) return 0;

  const aDate = new Date(a.created);
  const bDate = new Date(b.created);
  return bDate.getTime() - aDate.getTime();
};

const compareUpdated = (a: CardItem | Snippet, b: CardItem | Snippet) => {
  if (!a?.lastUpdated || !b?.lastUpdated) return 0;

  const aDate = new Date(a.lastUpdated);
  const bDate = new Date(b.lastUpdated);
  return bDate.getTime() - aDate.getTime();
};

export const sortCardItems = (cardItems: (CardItem | Snippet)[], sortMode: string) => {
  switch (sortMode) {
    case "a-z":
      cardItems.sort((a, b) => compareNames(a, b));
      break;
    case "z-a":
      cardItems.sort((a, b) => compareNames(b, a));
      break;
    case "newest":
      cardItems.sort((a, b) => compareCreated(a, b));
      break;
    case "oldest":
      cardItems.sort((a, b) => compareCreated(b, a));
      break;
    case "lastUpdated":
      cardItems.sort((a, b) => compareUpdated(a, b));
      break;
    case "mostStale":
      cardItems.sort((a, b) => compareUpdated(b, a));
      break;
    default:
      cardItems.sort((a, b) => (b?.stars ?? 0) - (a?.stars ?? 0));
      break;
  }
};

export async function getAvailableTLD() {
  const tlds = ["net", "xyz"];

  for (const tld of tlds) {
    try {
      const response = await fetch(`https://cdn.jsdelivr.${tld}`, { redirect: "manual", cache: "no-cache" });
      if (response.type === "opaqueredirect") return tld;
    } catch (err) {
      console.error(err);
    }
  }
}
