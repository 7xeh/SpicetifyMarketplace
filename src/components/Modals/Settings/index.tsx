import { t } from "i18next";
import React from "react";

import { LOCALSTORAGE_KEYS, MARKETPLACE_VERSION } from "../../../constants";
import { openModal } from "../../../logic/LaunchModals";
import { getLocalStorageDataFromKey, resetMarketplace, sleep } from "../../../logic/Utils";
import type { Config } from "../../../types/marketplace-types";
import Button from "../../Button";
import ConfigRow from "./ConfigRow";
import DnDList from "./DnDList";

interface Props {
  CONFIG: Config;
  updateAppConfig: (CONFIG: Config) => void;
}

const SettingsModal = ({ CONFIG, updateAppConfig }: Props) => {
  const [modalConfig, setModalConfig] = React.useState({ ...CONFIG });
  const [versionButtonText, setVersionButtonText] = React.useState(t("settings.versionBtn"));
  const updateConfig = (CONFIG: Config) => {
    updateAppConfig({ ...CONFIG });
    setModalConfig({ ...CONFIG });
  };

  const copyVersion = () => {
    Spicetify.Platform.ClipboardAPI.copy(MARKETPLACE_VERSION);
    setVersionButtonText(t("settings.versionCopied"));
    setTimeout(() => setVersionButtonText(t("settings.versionBtn")), 3000);
  };

  const closeButton = document.querySelector("body > generic-modal button.main-trackCreditsModal-closeBtn") as HTMLElement;
  const modalOverlay = document.querySelector("body > generic-modal > div") as HTMLElement;
  if (closeButton && modalOverlay) {
    closeButton.onclick = () => location.reload();
    closeButton.setAttribute("style", "cursor: pointer;");
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) {
        location.reload();
      }
    };
  }

  const AlbumArtColorDropDowns = getLocalStorageDataFromKey(LOCALSTORAGE_KEYS.albumArtBasedColor) ? (
    <>
      <ConfigRow
        name={t("settings.albumArtBasedColorsMode")}
        storageKey="albumArtBasedColorsMode"
        modalConfig={modalConfig}
        updateConfig={updateConfig}
        type="dropdown"
        options={["monochromeDark", "monochromeLight", "analogicComplement", "analogic", "triad", "quad"]}
        description={t("settings.albumArtColorsModeToolTip")}
      />
      <ConfigRow
        name={t("settings.albumArtBasedColorsVibrancy")}
        storageKey="albumArtBasedColorsVibrancy"
        modalConfig={modalConfig}
        updateConfig={updateConfig}
        type="dropdown"
        options={["desaturated", "lightVibrant", "prominent", "vibrant"]}
        description={t("settings.albumArtBasedColorsVibrancyToolTip")}
      />
    </>
  ) : null;

  return (
    <div id="marketplace-config-container">
      <div className="settings-block-top">
        <h2 className="settings-heading">{t("settings.optionsHeading")}</h2>
        <ConfigRow name={t("settings.starCountLabel")} storageKey="stars" modalConfig={modalConfig} updateConfig={updateConfig} />
        <ConfigRow name={t("settings.tagsLabel")} storageKey="tags" modalConfig={modalConfig} updateConfig={updateConfig} />
        <ConfigRow name={t("settings.showArchived")} storageKey="showArchived" modalConfig={modalConfig} updateConfig={updateConfig} />
        <ConfigRow name={t("settings.devToolsLabel")} storageKey="themeDevTools" modalConfig={modalConfig} updateConfig={updateConfig} />
        <ConfigRow name={t("settings.hideInstalledLabel")} storageKey="hideInstalled" modalConfig={modalConfig} updateConfig={updateConfig} />
        <ConfigRow name={t("settings.colourShiftLabel")} storageKey="colorShift" modalConfig={modalConfig} updateConfig={updateConfig} />
        <ConfigRow name={t("settings.albumArtBasedColors")} storageKey="albumArtBasedColors" modalConfig={modalConfig} updateConfig={updateConfig} />
        {AlbumArtColorDropDowns}
      </div>

      <div className="settings-block">
        <h2 className="settings-heading">{t("settings.tabsHeading")}</h2>
        <DnDList modalConfig={modalConfig} updateConfig={updateConfig} />
        <p className="settings-tabs-description">({t("settings.tabsDescription")})</p>
      </div>

      <div className="settings-block">
        <h2 className="settings-heading">{t("settings.resetHeading")}</h2>
        <div className="settings-row">
          <span className="col description">{t("settings.resetDescription")}</span>
          <div className="col action">
            <Button onClick={() => resetMarketplace()}>{t("settings.resetBtn")}</Button>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <h2 className="settings-heading">{t("settings.backupHeading")}</h2>
        <div className="settings-row">
          <span className="col description">{t("settings.backupLabel")}</span>
          <div className="col action">
            <Button onClick={onBackupClick}>{t("settings.backupBtn")}</Button>
          </div>
        </div>
      </div>

      <div className="settings-block-bottom">
        <div className="settings-row">
          <span className="col description">
            {t("grid.spicetifyMarketplace")} {t("settings.versionHeading")} {MARKETPLACE_VERSION}
          </span>
          <div className="col action">
            <Button onClick={copyVersion} classes={["small"]}>
              {versionButtonText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const onBackupClick = async () => {
  let opened = false;

  const observer = new MutationObserver(async () => {
    const settingsModal = document.querySelector(".GenericModal[aria-label='Settings']");
    if (!settingsModal && !opened) {
      opened = true;
      observer.disconnect();
      await sleep(100);
      openModal("BACKUP");
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  Spicetify.PopupModal.hide();
};

export default SettingsModal;
