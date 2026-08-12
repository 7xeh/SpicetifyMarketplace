import { t } from "i18next";

import { ITEMS_PER_REQUEST, LOCALSTORAGE_KEYS, MARKETPLACE_VERSION } from "../constants";
import { fetchAppManifest, fetchExtensionManifest, fetchThemeManifest, getBlacklist, getTaggedRepos } from "../logic/FetchRemotes";
import { isGitHubRateLimited } from "../logic/GitHubApi";
import { clearRequestCache, pruneRequestCache } from "../logic/RequestCache";
import { hydrateMarketplaceStorage, marketplaceStorage } from "../logic/Storage";
import {
  addExtensionToSpicetifyConfig,
  exportMarketplace,
  getAvailableTLD,
  getLocalStorageDataFromKey,
  getParamsFromGithubRaw,
  getStringArrayFromKey,
  initAlbumArtBasedColor,
  initColorShiftLoop,
  initializeSnippets,
  injectColourScheme,
  injectUserCSS,
  isGithubRawUrl,
  parseCSS,
  resetMarketplace
} from "../logic/Utils";
import type { RepoType } from "../types/marketplace-types";

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

(async function init() {
  if (!Spicetify.LocalStorage || !Spicetify.showNotification) {
    setTimeout(init, 100);
    return;
  }

  const reactSimpleCodeEditorFix = document.createElement("script");
  reactSimpleCodeEditorFix.innerHTML = "const global = globalThis;";
  document.body.appendChild(reactSimpleCodeEditorFix);

  console.log(`Initializing Spicetify Marketplace v${MARKETPLACE_VERSION}`);
  await hydrateMarketplaceStorage();

  window.Marketplace = {
    reset: resetMarketplace,
    export: exportMarketplace,
    clearCache: () => {
      clearRequestCache();
      window.sessionStorage.clear();
      console.log("Marketplace cache cleared, reload to refetch");
    },
    version: MARKETPLACE_VERSION
  };

  const tld = await getAvailableTLD();

  const initializeExtension = (extensionKey: string) => {
    const extensionManifest = getLocalStorageDataFromKey(extensionKey);
    if (!extensionManifest?.extensionURL) return;

    console.debug("Initializing extension: ", extensionManifest);

    const script = document.createElement("script");
    script.defer = true;
    script.src = extensionManifest.extensionURL;

    if (isGithubRawUrl(script.src)) {
      const { user, repo, branch, filePath } = getParamsFromGithubRaw(extensionManifest.extensionURL);
      if (!user || !repo || !branch || !filePath) return;
      script.src = `https://cdn.jsdelivr.${tld}/gh/${user}/${repo}@${branch}/${filePath}`;
      if (filePath.endsWith(".mjs")) script.type = "module";
    }

    script.src = `${script.src}?time=${Date.now()}`;

    document.body.appendChild(script);

    addExtensionToSpicetifyConfig(extensionManifest.manifest?.main);
  };

  const initializeTheme = async (themeKey: string) => {
    const themeManifest = getLocalStorageDataFromKey(themeKey);
    if (!themeManifest || typeof themeManifest !== "object") {
      console.debug("No theme manifest found");
      return;
    }

    console.debug("Initializing theme: ", themeManifest);

    if (themeManifest.schemes) {
      const activeScheme = themeManifest.schemes[themeManifest.activeScheme];
      injectColourScheme(activeScheme);

      // @ts-expect-error: `color_scheme` is read-only type in types
      Spicetify.Config.color_scheme = themeManifest.activeScheme;
      if (activeScheme && marketplaceStorage.getItem(LOCALSTORAGE_KEYS.albumArtBasedColor) === "true") {
        initAlbumArtBasedColor(activeScheme);
      } else if (marketplaceStorage.getItem(LOCALSTORAGE_KEYS.colorShift) === "true") {
        initColorShiftLoop(themeManifest.schemes);
      }
    } else {
      console.warn("No schemes found for theme");
    }

    const existingMarketplaceThemeCSS = document.querySelector("link.marketplaceCSS");
    if (existingMarketplaceThemeCSS) existingMarketplaceThemeCSS.remove();

    try {
      const userCSS = await parseCSS(themeManifest, tld);
      injectUserCSS(userCSS);
    } catch (error) {
      console.error("Marketplace: could not load the installed theme's CSS", error);
      Spicetify.showNotification(t("notifications.themeInstallationError"), true, 5000);
    }

    // @ts-expect-error: `current_theme` is read-only type in types
    Spicetify.Config.current_theme = themeManifest.manifest?.name;

    if (Array.isArray(themeManifest.include) && themeManifest.include.length) {
      for (const script of themeManifest.include) {
        if (typeof script !== "string" || !script) continue;

        const newScript = document.createElement("script");
        let src = script;

        if (isGithubRawUrl(script)) {
          const { user, repo, branch, filePath } = getParamsFromGithubRaw(script);
          if (!user || !repo || !branch || !filePath) continue;
          src = `https://cdn.jsdelivr.${tld}/gh/${user}/${repo}@${branch}/${filePath}`;
          if (filePath.endsWith(".mjs")) newScript.type = "module";
        }
        newScript.src = `${src}?time=${Date.now()}`;
        newScript.classList.add("marketplaceScript");
        document.body.appendChild(newScript);

        addExtensionToSpicetifyConfig(script);
      }
    }
  };

  console.log("Loaded Marketplace extension");

  const installedSnippetKeys = getStringArrayFromKey(LOCALSTORAGE_KEYS.installedSnippets);
  const installedSnippets = installedSnippetKeys.map((key) => getLocalStorageDataFromKey(key)).filter(Boolean);
  initializeSnippets(installedSnippets);

  if (!tld) {
    if (window.navigator.onLine) {
      console.error(new Error("Unable to connect to the CDN, please check your Internet configuration."));
      Spicetify.showNotification(t("notifications.noCdnConnection"), true, 5000);
    } else {
      window.addEventListener("online", init, { once: true });
    }

    return;
  }

  window.sessionStorage.setItem("marketplace-request-tld", tld);

  const installedExtensions = getStringArrayFromKey(LOCALSTORAGE_KEYS.installedExtensions);
  for (const extensionKey of installedExtensions) {
    initializeExtension(extensionKey);
  }

  const localTheme = typeof Spicetify.Config?.current_theme === "string" ? Spicetify.Config.current_theme : "";
  marketplaceStorage.setItem(LOCALSTORAGE_KEYS.localTheme, localTheme);
  const installedTheme = marketplaceStorage.getItem(LOCALSTORAGE_KEYS.themeInstalled);
  if (installedTheme) {
    if (localTheme && localTheme.toLocaleLowerCase() !== "marketplace") {
      Spicetify.showNotification(t("notifications.wrongLocalTheme"), true, 5000);
      return;
    }
    await initializeTheme(installedTheme);
  }
})().catch((error) => console.error("Marketplace: failed to initialise the extension", error));

async function queryRepos(type: RepoType, pageNum = 1) {
  let BLACKLIST: string[] = [];
  try {
    const stored = JSON.parse(window.sessionStorage.getItem("marketplace:blacklist") || "[]");
    if (Array.isArray(stored)) BLACKLIST = stored;
  } catch (error) {
    console.warn("Marketplace: could not read the cached blacklist", error);
  }

  return getTaggedRepos(`spicetify-${type}s`, pageNum, BLACKLIST, true);
}

async function loadPageRecursive(type: RepoType, pageNum: number) {
  if (isGitHubRateLimited()) {
    console.debug(`Skipping ${type} preload while rate limited`);
    return;
  }

  const pageOfRepos = await queryRepos(type, pageNum);
  await appendInformationToLocalStorage(pageOfRepos, type);

  const soFarResults = ITEMS_PER_REQUEST * pageNum + pageOfRepos.page_count;
  console.debug({ pageOfRepos });
  const remainingResults = pageOfRepos.total_count - soFarResults;

  console.debug(`Parsed ${soFarResults}/${pageOfRepos.total_count} ${type}s`);
  if (remainingResults > 0) return await loadPageRecursive(type, pageNum + 1);
  console.debug(`No more ${type} results`);
}

(async function initializePreload() {
  console.debug("Preloading extensions and themes...");
  window.sessionStorage.clear();
  pruneRequestCache(MAX_CACHE_AGE_MS);
  const BLACKLIST = await getBlacklist();
  window.sessionStorage.setItem("marketplace:blacklist", JSON.stringify(BLACKLIST));

  await Promise.all([loadPageRecursive("extension", 0), loadPageRecursive("theme", 0), loadPageRecursive("app", 0)]);
})().catch((error) => console.error("Marketplace: failed to preload repos", error));

async function appendInformationToLocalStorage(array, type: RepoType) {
  if (!Array.isArray(array?.items)) return;

  for (const repo of array.items) {
    if (type === "theme") await fetchThemeManifest(repo.contents_url, repo.default_branch, repo.stargazers_count);
    else if (type === "extension") await fetchExtensionManifest(repo.contents_url, repo.default_branch, repo.stargazers_count);
    else if (type === "app") await fetchAppManifest(repo.contents_url, repo.default_branch, repo.stargazers_count);
  }
}
