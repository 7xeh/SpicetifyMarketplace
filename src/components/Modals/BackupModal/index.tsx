import { t } from "i18next";
import { highlight, languages } from "prismjs/components/prism-core";
import React from "react";
import Editor from "react-simple-code-editor";
import type {} from "wicg-file-system-access";
import "prismjs/components/prism-json";

import { exportMarketplace, importMarketplace } from "../../../logic/Utils";
import Button from "../../Button";

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

const BackupModal = () => {
  const [importText, setImportText] = React.useState("");

  async function saveFile(data: FileSystemWriteChunkType) {
    const date = new Date();
    const newHandle = await showSaveFilePicker({
      id: "marketplace-settings-backup",
      suggestedName: `marketplace-settings-${date.toISOString()}.json`,
      excludeAcceptAllOption: true,
      types: [
        {
          description: "JSON files",
          accept: { "application/json": [".json"] }
        }
      ]
    });

    const writableStream = await newHandle.createWritable();
    await writableStream.write(data);
    await writableStream.close();
  }

  const exportSettings = async () => {
    const settings = exportMarketplace();

    try {
      await saveFile(JSON.stringify(settings, null, 2));
      Spicetify.showNotification(t("backupModal.settingsSaved"));
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        console.error("Failed to save file, copying to clipboard instead:", error);
        Spicetify.Platform.ClipboardAPI.copy(JSON.stringify(settings));
        Spicetify.showNotification(t("backupModal.settingsCopied"));
      }
    }

    Spicetify.PopupModal.hide();
  };

  const importSettings = async (settingsString: string) => {
    if (!settingsString) {
      Spicetify.showNotification(t("backupModal.noDataPasted"));
      return;
    }

    let settings: unknown;
    try {
      settings = JSON.parse(settingsString);
    } catch {
      Spicetify.showNotification(t("backupModal.invalidJSON"));
      return;
    }

    try {
      await importMarketplace(settings);
      location.reload();
    } catch (error) {
      console.error("Failed to import Marketplace backup", error);
      Spicetify.showNotification(error instanceof Error ? error.message : t("backupModal.invalidJSON"), true);
    }
  };

  const importSettingsFromInput = async () => {
    await importSettings(importText);
  };

  const importSettingsFromFile = async () => {
    try {
      const fileHandle = await showOpenFilePicker();
      const file = await fileHandle[0].getFile();
      const text = await file.text();

      await importSettings(text);
    } catch (error) {
      if (isAbortError(error)) return;
      console.error("Failed to read Marketplace backup file", error);
      Spicetify.showNotification(t("backupModal.invalidJSON"), true);
    }
  };

  return (
    <div id="marketplace-backup-container">
      <div className="marketplace-backup-input-container">
        <label htmlFor="marketplace-backup">{t("backupModal.inputLabel")}</label>
        <div className="marketplace-code-editor-wrapper marketplace-code-editor">
          <Editor
            value={importText}
            onValueChange={(text) => setImportText(text)}
            highlight={(text) => highlight(text, languages.json)}
            textareaId="marketplace-import-text"
            textareaClassName="import-textarea"
            readOnly={false}
            className="marketplace-code-editor-textarea"
            placeholder={t("backupModal.inputPlaceholder")}
            style={{}}
          />
        </div>
      </div>

      <Button classes={["marketplace-backup-button"]} onClick={exportSettings}>
        {t("backupModal.exportBtn")}
      </Button>
      <Button classes={["marketplace-backup-button"]} onClick={importSettingsFromInput}>
        {t("backupModal.importBtn")}
      </Button>

      <Button classes={["marketplace-backup-button"]} onClick={importSettingsFromFile}>
        {t("backupModal.fileImportBtn")}
      </Button>
    </div>
  );
};
export default BackupModal;
