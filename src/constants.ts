import { version } from "../package.json";
import type { TabItemConfig } from "./types/marketplace-types";

export const MARKETPLACE_VERSION = version;

export const APP_ID = "sevens-marketplace";

export const APP_NAME = "7's Marketplace";

export const UPSTREAM_APP_IDS = ["marketplace", "spicetify-marketplace"];

export const UPSTREAM_THEME_PLACEHOLDER = "marketplace";

export const THEME_PLACEHOLDER_NAMES = [APP_ID, ...UPSTREAM_APP_IDS];

export const CATALOG_ENABLED: boolean = false;

export const DOM_PREFIX = "sevensMarketplace";

export const SESSION_KEYS = {
  requestTld: `${APP_ID}:request-tld`,
  blacklist: `${APP_ID}:blacklist`,
  runtimeReady: `${APP_ID}:session:runtime-ready`,
  loadedExtensions: `${APP_ID}:session:loaded-extensions`,
  loadedThemeScripts: `${APP_ID}:session:loaded-theme-scripts`
};

export const SESSION_PRESERVED_PREFIX = `${APP_ID}:session:`;

const STORAGE_KEY_PREFIX = "marketplace";

export const STORAGE_PREFIX = `${STORAGE_KEY_PREFIX}:`;

export const settingKey = (name: string) => `${STORAGE_PREFIX}${name}`;

export const LOCALSTORAGE_KEYS = {
  installedExtensions: `${STORAGE_KEY_PREFIX}:installed-extensions`,
  installedSnippets: `${STORAGE_KEY_PREFIX}:installed-snippets`,
  installedThemes: `${STORAGE_KEY_PREFIX}:installed-themes`,
  activeTab: `${STORAGE_KEY_PREFIX}:active-tab`,
  tabs: `${STORAGE_KEY_PREFIX}:tabs`,
  sort: `${STORAGE_KEY_PREFIX}:sort`,
  themeInstalled: `${STORAGE_KEY_PREFIX}:theme-installed`,
  localTheme: `${STORAGE_KEY_PREFIX}:local-theme`,
  albumArtBasedColor: `${STORAGE_KEY_PREFIX}:albumArtBasedColors`,
  albumArtBasedColorMode: `${STORAGE_KEY_PREFIX}:albumArtBasedColorsMode`,
  albumArtBasedColorVibrancy: `${STORAGE_KEY_PREFIX}:albumArtBasedColorsVibrancy`,
  colorShift: `${STORAGE_KEY_PREFIX}:colorShift`
};

export const ALL_TABS: TabItemConfig[] = [
  { name: "Extensions", enabled: true },
  { name: "Themes", enabled: true },
  { name: "Snippets", enabled: true },
  { name: "Apps", enabled: true },
  { name: "Installed", enabled: true }
].filter((tab) => CATALOG_ENABLED || tab.name === "Installed");

export const ITEMS_PER_REQUEST = 100;

export const CUSTOM_APP_PATH = `/${APP_ID}`;

export const MAX_TAGS = 4;

export const SNIPPETS_PAGE_URL = "https://github.com/spicetify/marketplace/blob/main/resources/snippets.json";

export const SNIPPETS_URL = "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/snippets.json";

export const BLACKLIST_URL = "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/blacklist.json";

export const GITHUB_OWNER = "7xeh";

export const GITHUB_NAME = "SpicetifyMarketplace";

export const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_NAME}/releases`;

export const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_NAME}/releases/latest`;

export const UPGRADE_GUIDE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_NAME}#install`;
