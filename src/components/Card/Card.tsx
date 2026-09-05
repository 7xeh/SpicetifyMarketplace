import { t } from "i18next";
import React, { type Key } from "react";
import { withTranslation } from "react-i18next";

import { APP_ID, APP_NAME, CUSTOM_APP_PATH, LOCALSTORAGE_KEYS, SESSION_KEYS, SNIPPETS_PAGE_URL, THEME_PLACEHOLDER_NAMES } from "../../constants";
import { fetchGitHubJson } from "../../logic/GitHubApi";
import { openModal } from "../../logic/LaunchModals";
import { hasPendingChanges, notifyPendingChanges, wasLoadedThisSession } from "../../logic/PendingReload";
import { CACHE_TTL } from "../../logic/RequestCache";
import { marketplaceStorage, type StorageDraft } from "../../logic/Storage";
import {
  addExtensionToSpicetifyConfig,
  generateKey,
  getLocalStorageDataFromKey,
  initializeSnippets,
  injectUserCSS,
  parseCSS,
  parseIni,
  removeExtensionFromSpicetifyConfig,
  removeInjectedExtensionScript
} from "../../logic/Utils";
import type { CardItem, CardType, Config, SchemeIni, Snippet, VisualConfig } from "../../types/marketplace-types";
import Button from "../Button";
import DownloadIcon from "../Icons/DownloadIcon";
import GitHubIcon from "../Icons/GitHubIcon";
import TrashIcon from "../Icons/TrashIcon";
import Tooltip from "../Tooltip";
import AuthorsDiv from "./AuthorsDiv";
import TagsDiv from "./TagsDiv";

const Spicetify = window.Spicetify;

function readStoredStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

type PreparedTheme = {
  activeScheme: string | null;
  item: CardItem;
  parsedSchemes: SchemeIni;
  record: string;
  userCSS?: string;
};

let themeOperationQueue: Promise<void> = Promise.resolve();

function queueThemeOperation<T>(operation: () => Promise<T>) {
  const result = themeOperationQueue.then(operation);
  themeOperationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export type CardProps = {
  item: CardItem | Snippet;
  CONFIG: Config;
  updateColourSchemes: (SchemeIni, string) => void;
  updateActiveTheme: (string) => void;
  type: CardType;
  visual: VisualConfig;
  activeThemeKey?: string;
};

export class Card extends React.Component<
  CardProps,
  {
    installed: boolean;
    stars: number;
    tagsExpanded: boolean;
    externalUrl: string;
    lastUpdated: string | undefined;
    created: string | undefined;
  }
> {
  tags: string[];

  menuType: typeof Spicetify.ReactComponent.Menu;
  localStorageKey: string;
  key: Key | null = null;
  type = Card;

  constructor(props: CardProps) {
    super(props);

    this.menuType = Spicetify.ReactComponent.Menu;

    this.localStorageKey = generateKey(props);

    Object.assign(this, props);

    const tags = Array.isArray(props.item.tags) ? props.item.tags.filter((tag): tag is string => typeof tag === "string") : [];
    if (props.item.include?.length) tags.push(t("grid.externalJS"));
    if (props.item.archived) tags.push(t("grid.archived"));
    this.tags = [...new Set(tags)];

    this.state = {
      installed: marketplaceStorage.getItem(this.localStorageKey) !== null,

      stars: this.props.item.stars || 0,
      tagsExpanded: false,
      externalUrl: this.props.item.user && this.props.item.repo ? `https://github.com/${this.props.item.user}/${this.props.item.repo}` : "",
      lastUpdated: this.props.item.user && this.props.item.repo ? this.props.item.lastUpdated : undefined,
      created: this.props.item.user && this.props.item.repo ? this.props.item.created : undefined
    };
  }

  isInstalled() {
    return marketplaceStorage.getItem(this.localStorageKey) !== null;
  }

  mounted = false;

  handleOperationError(error: unknown) {
    console.error(`${APP_NAME}: could not update ${this.props.type} "${this.props.item.title}"`, error);
    Spicetify.showNotification(t("notifications.marketplaceOperationError"), true);
  }

  async componentDidMount() {
    this.mounted = true;

    try {
      await this.refreshInstalledItem();
    } catch (error) {
      this.handleOperationError(error);
    }
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  async refreshInstalledItem() {
    if (this.props.CONFIG.activeTab !== "Installed" || this.props.type === "snippet") return;

    const { user, repo } = this.props.item;
    if (!user || !repo) return;

    const url = `https://api.github.com/repos/${user}/${repo}`;
    const { data } = await fetchGitHubJson<{ stargazers_count?: number; pushed_at?: string }>(url, {
      cacheKey: `repo:${user}/${repo}`,
      ttlMs: CACHE_TTL.repo,
      notifyOnRateLimit: false
    });

    if (!data || !this.mounted) return;

    const { stargazers_count, pushed_at } = data;

    const nextStars = typeof stargazers_count === "number" && this.props.CONFIG.visual.stars ? stargazers_count : this.state.stars;
    const nextUpdated = typeof pushed_at === "string" ? pushed_at : this.state.lastUpdated;
    const hasNewUpdate = typeof pushed_at === "string" && this.state.lastUpdated !== pushed_at;

    if (nextStars !== this.state.stars || nextUpdated !== this.state.lastUpdated) {
      console.debug(`Refreshed ${user}/${repo}: ★ ${nextStars}, pushed at ${nextUpdated}`);
      this.setState({ stars: nextStars, lastUpdated: nextUpdated });
    }

    if (!hasNewUpdate) return;

    switch (this.props.type) {
      case "extension":
        await this.installExtension();
        break;
      case "theme":
        await this.installTheme(true);
        break;
    }
  }

  async buttonClicked() {
    try {
      await this.performButtonAction();
    } catch (error) {
      this.handleOperationError(error);
    }
  }

  async performButtonAction() {
    if (this.props.type === "extension") {
      if (this.isInstalled()) {
        console.debug("Extension already installed, removing");
        await this.removeExtension();
      } else {
        await this.installExtension();
      }

      this.promptReloadIfNeeded();
    } else if (this.props.type === "theme") {
      await this.toggleTheme();
      this.promptReloadIfNeeded();
    } else if (this.props.type === "app") {
      window.open(this.state.externalUrl, "_blank");
    } else if (this.props.type === "snippet") {
      if (this.isInstalled()) {
        console.debug("Snippet already installed, removing");
        await this.removeSnippet();
      } else {
        await this.installSnippet();
      }
    } else {
      console.error("Unknown card type");
    }
  }

  promptReloadIfNeeded() {
    notifyPendingChanges();
    if (hasPendingChanges()) openModal("RELOAD");
  }

  async installExtension() {
    console.debug(`Installing extension ${this.localStorageKey}`);
    if (!this.props.item) {
      Spicetify.showNotification(t("notifications.extensionInstallationError"), true);
      return;
    }

    const { manifest, title, subtitle, authors, user, repo, branch, imageURL, extensionURL, readmeURL, lastUpdated, created } = this.props.item;
    const record = JSON.stringify({
      manifest,
      type: this.props.type,
      title,
      subtitle,
      authors,
      user,
      repo,
      branch,
      imageURL,
      extensionURL,
      readmeURL,
      stars: this.state.stars,
      tags: this.tags,
      lastUpdated,
      created
    });

    await marketplaceStorage.mutateAsync((storage: StorageDraft) => {
      storage.set(this.localStorageKey, record);
      const installedExtensions = readStoredStringArray(storage.get(LOCALSTORAGE_KEYS.installedExtensions));
      if (!installedExtensions.includes(this.localStorageKey)) {
        storage.set(LOCALSTORAGE_KEYS.installedExtensions, JSON.stringify([...installedExtensions, this.localStorageKey]));
      }
    });

    if (wasLoadedThisSession(this.localStorageKey)) addExtensionToSpicetifyConfig(manifest?.main);

    console.debug("Installed");
    this.setState({ installed: true });
  }

  async removeExtension() {
    console.debug(`Removing extension ${this.localStorageKey}`);

    const stored = getLocalStorageDataFromKey(this.localStorageKey);

    await marketplaceStorage.mutateAsync((storage: StorageDraft) => {
      storage.delete(this.localStorageKey);
      const installedExtensions = readStoredStringArray(storage.get(LOCALSTORAGE_KEYS.installedExtensions));
      storage.set(LOCALSTORAGE_KEYS.installedExtensions, JSON.stringify(installedExtensions.filter((key) => key !== this.localStorageKey)));
    });

    removeInjectedExtensionScript(this.localStorageKey);
    removeExtensionFromSpicetifyConfig(stored?.manifest?.main);

    console.debug("Removed");
    this.setState({ installed: false });
  }

  async prepareTheme(update = false): Promise<PreparedTheme | null> {
    const item = this.props.item as CardItem;
    if (!item) {
      Spicetify.showNotification(t("notifications.themeInstallationError"), true);
      return null;
    }

    let parsedSchemes: SchemeIni = {};
    let currentScheme: string | null = null;

    if (update) {
      const { schemes, activeScheme } = getLocalStorageDataFromKey(this.localStorageKey, {}) || {};
      parsedSchemes = schemes && typeof schemes === "object" ? schemes : {};
      currentScheme = typeof activeScheme === "string" ? activeScheme : null;
    } else if (item.schemesURL) {
      try {
        const schemesResponse = await fetch(item.schemesURL);
        if (!schemesResponse.ok) throw new Error(`HTTP ${schemesResponse.status}`);
        const colourSchemes = await schemesResponse.text();
        parsedSchemes = parseIni(colourSchemes);
      } catch (error) {
        console.warn(`Marketplace: could not load colour schemes from ${item.schemesURL}`, error);
      }
    }

    const activeScheme = currentScheme || Object.keys(parsedSchemes)[0] || null;
    console.debug(parsedSchemes, activeScheme);

    const {
      manifest,
      title,
      subtitle,
      authors,
      user,
      repo,
      branch,
      imageURL,
      extensionURL,
      readmeURL,
      cssURL,
      schemesURL,
      include,
      lastUpdated,
      created
    } = item;

    const record = JSON.stringify({
      manifest,
      type: this.props.type,
      title,
      subtitle,
      authors,
      user,
      repo,
      branch,
      imageURL,
      extensionURL,
      readmeURL,
      stars: this.state.stars,
      tags: this.tags,
      cssURL,
      schemesURL,
      include,
      schemes: parsedSchemes,
      activeScheme,
      lastUpdated,
      created
    });

    let userCSS: string | undefined;
    if (!item.include?.length) {
      const tld = window.sessionStorage.getItem(SESSION_KEYS.requestTld) || undefined;
      userCSS = await parseCSS(item, tld);
    }

    return { activeScheme, item, parsedSchemes, record, userCSS };
  }

  async installPreparedTheme({ activeScheme, item, parsedSchemes, record, userCSS }: PreparedTheme, previousThemeKey?: string | null) {
    console.debug(`Installing theme ${this.localStorageKey}`);

    await marketplaceStorage.mutateAsync((storage: StorageDraft) => {
      const installedThemes = readStoredStringArray(storage.get(LOCALSTORAGE_KEYS.installedThemes)).filter(
        (key) => key !== previousThemeKey && key !== this.localStorageKey
      );
      if (previousThemeKey && previousThemeKey !== this.localStorageKey) storage.delete(previousThemeKey);
      storage.set(this.localStorageKey, record);
      storage.set(LOCALSTORAGE_KEYS.installedThemes, JSON.stringify([...installedThemes, this.localStorageKey]));
      storage.set(LOCALSTORAGE_KEYS.themeInstalled, this.localStorageKey);
    });

    console.debug("Installed");

    if (!item.include?.length) {
      injectUserCSS(userCSS);
      this.props.updateActiveTheme(this.localStorageKey);
      this.props.updateColourSchemes(parsedSchemes, activeScheme as string);

      const name = this.props.item.manifest?.name;
      // @ts-expect-error: Cannot assign to 'current_theme' because it is a read-only property
      if (name) Spicetify.Config.current_theme = name;
      // @ts-expect-error: Cannot assign to 'color_scheme' because it is a read-only property
      if (activeScheme) Spicetify.Config.color_scheme = activeScheme;
    } else if (previousThemeKey && previousThemeKey !== this.localStorageKey) {
      injectUserCSS();
      this.props.updateActiveTheme(null);
      this.props.updateColourSchemes(null, null);

      // @ts-expect-error: Cannot assign to 'current_theme' because it is a read-only property
      Spicetify.Config.current_theme = APP_ID;
      // @ts-expect-error: Cannot assign to 'color_scheme' because it is a read-only property
      Spicetify.Config.color_scheme = APP_ID;
    }

    this.setState({ installed: true });
  }

  async installTheme(update = false) {
    await queueThemeOperation(async () => {
      const preparedTheme = await this.prepareTheme(update);
      const activeThemeKey = marketplaceStorage.getItem(LOCALSTORAGE_KEYS.themeInstalled);
      if (preparedTheme) await this.installPreparedTheme(preparedTheme, activeThemeKey);
    });
  }

  async toggleTheme() {
    return queueThemeOperation(async () => {
      const themeKey = marketplaceStorage.getItem(LOCALSTORAGE_KEYS.themeInstalled);

      if (this.isInstalled()) {
        console.debug("Theme already installed, removing");
        await this.removeThemeNow(this.localStorageKey);
        return;
      }

      const localTheme = marketplaceStorage.getItem(LOCALSTORAGE_KEYS.localTheme);
      if (localTheme && !THEME_PLACEHOLDER_NAMES.includes(localTheme.toLowerCase())) {
        Spicetify.showNotification(t("notifications.wrongLocalTheme"), true, 5000);
        return;
      }

      const preparedTheme = await this.prepareTheme();
      if (!preparedTheme) return;

      await this.installPreparedTheme(preparedTheme, themeKey);
    });
  }

  async removeThemeNow(defaultThemeKey?: string | null) {
    const themeKey = defaultThemeKey || marketplaceStorage.getItem(LOCALSTORAGE_KEYS.themeInstalled);
    const themeValue = themeKey && marketplaceStorage.getItem(themeKey);

    if (!themeKey || !themeValue) return;

    console.debug(`Removing theme ${themeKey}`);

    await marketplaceStorage.mutateAsync((storage: StorageDraft) => {
      storage.delete(themeKey);
      storage.delete(LOCALSTORAGE_KEYS.themeInstalled);
      const installedThemes = readStoredStringArray(storage.get(LOCALSTORAGE_KEYS.installedThemes));
      storage.set(LOCALSTORAGE_KEYS.installedThemes, JSON.stringify(installedThemes.filter((key) => key !== themeKey)));
    });

    console.debug("Removed");

    injectUserCSS();
    this.props.updateActiveTheme(null);
    this.props.updateColourSchemes(null, null);

    // @ts-expect-error: Cannot assign to 'current_theme' because it is a read-only property
    Spicetify.Config.current_theme = APP_ID;
    // @ts-expect-error: Cannot assign to 'color_scheme' because it is a read-only property
    Spicetify.Config.color_scheme = APP_ID;

    this.setState({ installed: false });
  }

  async installSnippet() {
    console.debug(`Installing snippet ${this.localStorageKey}`);

    const record = JSON.stringify({
      code: this.props.item.code,
      title: this.props.item.title,
      description: this.props.item.description,
      imageURL: this.props.item.imageURL
    });

    await marketplaceStorage.mutateAsync((storage: StorageDraft) => {
      storage.set(this.localStorageKey, record);
      const installedSnippetKeys = readStoredStringArray(storage.get(LOCALSTORAGE_KEYS.installedSnippets));
      if (!installedSnippetKeys.includes(this.localStorageKey)) {
        storage.set(LOCALSTORAGE_KEYS.installedSnippets, JSON.stringify([...installedSnippetKeys, this.localStorageKey]));
      }
    });

    this.refreshSnippets();
    this.setState({ installed: true });
  }

  async removeSnippet() {
    await marketplaceStorage.mutateAsync((storage: StorageDraft) => {
      storage.delete(this.localStorageKey);
      const installedSnippetKeys = readStoredStringArray(storage.get(LOCALSTORAGE_KEYS.installedSnippets));
      storage.set(LOCALSTORAGE_KEYS.installedSnippets, JSON.stringify(installedSnippetKeys.filter((key) => key !== this.localStorageKey)));
    });

    this.refreshSnippets();
    this.setState({ installed: false });
  }

  refreshSnippets() {
    const installedSnippetKeys = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.installedSnippets, []);
    if (!Array.isArray(installedSnippetKeys)) return;

    initializeSnippets(installedSnippetKeys.map((key) => getLocalStorageDataFromKey(key)).filter(Boolean));
  }

  openReadme() {
    if (this.props.item?.manifest?.readme) {
      Spicetify.Platform.History.push({
        pathname: `${CUSTOM_APP_PATH}/readme`,
        state: {
          data: {
            title: this.props.item.title,
            user: this.props.item.user,
            repo: this.props.item.repo,
            branch: this.props.item.branch,
            readmeURL: this.props.item.readmeURL,
            type: this.props.type,
            install: this.buttonClicked.bind(this),
            isInstalled: this.isInstalled.bind(this)
          }
        }
      });
    } else {
      Spicetify.showNotification(t("notifications.noReadmeFile"), true);
    }
  }

  render() {
    const IS_INSTALLED = this.isInstalled();

    if (this.props.CONFIG.activeTab === "Installed" && !IS_INSTALLED) {
      console.debug("Card item not installed");
      return null;
    }

    const cardClasses = ["main-card-card", `marketplace-card--${this.props.type}`];
    if (IS_INSTALLED) cardClasses.push("marketplace-card--installed");

    const detail: string[] = [];
    if (this.props.type !== "snippet" && this.props.visual.stars) {
      detail.push(`★ ${this.state.stars}`);
    }

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Not static
      <div
        className={cardClasses.join(" ")}
        onClick={() => {
          if (this.props.type === "snippet") {
            if (getLocalStorageDataFromKey(this.localStorageKey)?.custom) return openModal("EDIT_SNIPPET", undefined, undefined, this.props);

            openModal("VIEW_SNIPPET", undefined, undefined, this.props, this.buttonClicked.bind(this));
          } else this.openReadme();
        }}
      >
        <div className="main-card-draggable" draggable="true">
          <div className="main-card-imageContainer">
            <div className="main-cardImage-imageWrapper">
              <div>
                <img
                  alt=""
                  aria-hidden="false"
                  draggable="false"
                  loading="lazy"
                  src={this.props.item.imageURL}
                  className="main-image-image main-cardImage-image"
                  onError={(e) => {
                    e.currentTarget.setAttribute(
                      "src",
                      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII"
                    );

                    e.currentTarget.closest(".main-cardImage-imageWrapper")?.classList.add("main-cardImage-imageWrapper--error");
                  }}
                />
              </div>
            </div>
          </div>
          <div className="main-card-cardMetadata">
            <a
              draggable="false"
              title={this.props.type === "snippet" ? this.props.item.title : this.props.item.manifest?.name}
              className="main-cardHeader-link"
              dir="auto"
              href={this.props.type !== "snippet" ? this.state.externalUrl : SNIPPETS_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="main-cardHeader-text main-type-balladBold">{this.props.item.title}</div>
            </a>
            <div className="main-cardSubHeader-root main-type-mestoBold marketplace-cardSubHeader">
              {this.props.item.authors && <AuthorsDiv authors={this.props.item.authors} />}
              <span>{detail.join(" ‒ ")}</span>
            </div>
            <p className="marketplace-card-desc">
              {this.props.type === "snippet" ? this.props.item.description : this.props.item.manifest?.description}
            </p>
            {this.props.item.lastUpdated && (
              <p className="marketplace-card-desc">
                {t("grid.lastUpdated", {
                  val: new Date(this.props.item.lastUpdated),
                  formatParams: {
                    val: { year: "numeric", month: "long", day: "numeric" }
                  }
                })}
              </p>
            )}
            {this.tags.length ? (
              <div className="marketplace-card__bottom-meta main-type-mestoBold">
                <TagsDiv tags={this.tags} showTags={this.props.CONFIG.visual.tags} />
              </div>
            ) : null}
            {IS_INSTALLED && <div className="marketplace-card__bottom-meta main-type-mestoBold">✓ {t("grid.installed")}</div>}
            <Tooltip label={this.props.type === "app" ? t("github") : IS_INSTALLED ? t("remove") : t("install")} renderInline={true}>
              <div className="main-card-PlayButtonContainer">
                <Button
                  classes={["marketplace-installButton"]}
                  type="circle"
                  label={this.props.type === "app" ? t("github") : IS_INSTALLED ? t("remove") : t("install")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void this.buttonClicked();
                  }}
                >
                  {this.props.type === "app" ? <GitHubIcon /> : IS_INSTALLED ? <TrashIcon /> : <DownloadIcon />}
                </Button>
              </div>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  }
}

export default withTranslation()(Card);
