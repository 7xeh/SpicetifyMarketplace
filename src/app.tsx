import i18n, { t } from "i18next";
import React from "react";
import { initReactI18next, withTranslation } from "react-i18next";

import "./styles/styles.scss";
import ErrorBoundary from "./components/ErrorBoundary";
import Grid from "./components/Grid";
import ReadmePage from "./components/ReadmePage";
import { ALL_TABS, CUSTOM_APP_PATH, LOCALSTORAGE_KEYS, settingKey } from "./constants";
import { waitForSpicetify } from "./logic/SpicetifyReady";
import { hydrateMarketplaceStorage, marketplaceStorage } from "./logic/Storage";
import { getBooleanFromKey, getLocalStorageDataFromKey } from "./logic/Utils";
import locales from "./resources/locales";
import type { Config, TabItemConfig } from "./types/marketplace-types";

const getClientLocale = () => {
  try {
    return Spicetify?.Locale?.getLocale?.() || navigator.language || "en";
  } catch {
    return navigator.language || "en";
  }
};

i18n.use(initReactI18next).init({
  resources: locales,
  lng: getClientLocale(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false
  }
});

class App extends React.Component<
  {
    t: (key: string) => string;
  },
  {
    count: number;
    CONFIG: Config;
    storageReady: boolean;
    storageUnreadable: boolean;
  }
> {
  state = {
    count: 0,
    CONFIG: {} as Config,
    storageReady: false,
    storageUnreadable: false
  };

  CONFIG: Config;
  constructor(props) {
    super(props);
    this.CONFIG = {} as Config;
  }

  createConfig() {
    const tabsData = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.tabs, null);
    let tabs: TabItemConfig[] = [];
    try {
      tabs = tabsData;

      if (!Array.isArray(tabs)) {
        throw new Error("Could not parse marketplace tabs key");
      }
      if (tabs.length === 0) {
        throw new Error("Empty marketplace tabs key");
      }
      if (tabs.filter((tab) => !tab).length > 0) {
        throw new Error("Falsey marketplace tabs key");
      }
    } catch {
      tabs = ALL_TABS;
      marketplaceStorage.setItem(LOCALSTORAGE_KEYS.tabs, JSON.stringify(tabs));
    }

    let schemes = {};
    let activeScheme = null;
    try {
      const installedThemeKey = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.themeInstalled, null);
      if (installedThemeKey) {
        const installedTheme = getLocalStorageDataFromKey(installedThemeKey, null);
        if (!installedTheme) throw new Error("No installed theme data");

        schemes = installedTheme.schemes;
        activeScheme = installedTheme.activeScheme;
      } else {
        console.debug("No theme set as installed");
      }
    } catch (err) {
      console.error(err);
    }

    const config = {
      visual: {
        stars: getBooleanFromKey(settingKey("stars"), true),
        tags: getBooleanFromKey(settingKey("tags"), true),
        showArchived: getBooleanFromKey(settingKey("showArchived"), false),
        hideInstalled: getBooleanFromKey(settingKey("hideInstalled"), false),
        colorShift: getBooleanFromKey(settingKey("colorShift"), false),
        themeDevTools: getBooleanFromKey(settingKey("themeDevTools"), false),
        albumArtBasedColors: getBooleanFromKey(settingKey("albumArtBasedColors"), false),
        albumArtBasedColorsMode: getLocalStorageDataFromKey(settingKey("albumArtBasedColorsMode")) || "monochrome-light",
        albumArtBasedColorsVibrancy: getLocalStorageDataFromKey(settingKey("albumArtBasedColorsVibrancy")) || "PROMINENT",
        type: getBooleanFromKey(settingKey("type"), false),
        followers: getBooleanFromKey(settingKey("followers"), false)
      },
      tabs,
      activeTab: getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.activeTab, tabs[0]),
      theme: {
        activeThemeKey: getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.themeInstalled, null),
        schemes,
        activeScheme
      },
      sort: getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.sort, "stars")
    };

    if (!config.activeTab || !config.tabs.filter((tab) => tab.name === config.activeTab).length) {
      config.activeTab = config.tabs[0].name;
    }

    return config;
  }

  async componentDidMount() {
    await waitForSpicetify();

    const clientLocale = getClientLocale();
    if (clientLocale !== i18n.language) await i18n.changeLanguage(clientLocale);

    try {
      await hydrateMarketplaceStorage();
    } catch (error) {
      console.error("Marketplace storage could not be read", error);
      this.setState({ storageUnreadable: true });
      return;
    }

    this.CONFIG = this.createConfig();
    this.setState({
      CONFIG: this.CONFIG,
      storageReady: true
    });
  }

  updateConfig = (config: Config) => {
    this.CONFIG = { ...config };
    console.debug("updated config", this.CONFIG);
    this.setState({
      CONFIG: { ...config }
    });
  };

  renderRoute() {
    const { location, replace } = Spicetify.Platform.History;
    if (location.pathname === `${CUSTOM_APP_PATH}/readme`) {
      if (!location.state?.data) {
        replace(CUSTOM_APP_PATH);
        return null;
      }
      return <ReadmePage title={t("readmePage.title")} data={location.state.data} />;
    }

    return <Grid title={t("grid.spicetifyMarketplace")} CONFIG={this.CONFIG} updateAppConfig={this.updateConfig} />;
  }

  render() {
    if (this.state.storageUnreadable) return <div className="marketplace-storage-error">{t("grid.storageUnreadable")}</div>;
    if (!this.state.storageReady) return null;

    return <ErrorBoundary context="App">{this.renderRoute()}</ErrorBoundary>;
  }
}

export default withTranslation()(App);
