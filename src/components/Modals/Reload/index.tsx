import { t } from "i18next";
import React from "react";
import { getPendingChanges } from "../../../logic/PendingReload";
import { marketplaceStorage } from "../../../logic/Storage";
import Button from "../../Button";

const ReloadModal = () => {
  const changes = getPendingChanges();

  return (
    <div id="marketplace-reload-container">
      <p>{t("reloadModal.description")}</p>
      {changes.length ? (
        <ul className="marketplace-reload-modal__changes">
          {changes.map((change) => (
            <li
              key={`${change.action}:${change.key}`}
              className={`marketplace-reload-modal__change marketplace-reload-modal__change--${change.action}`}
            >
              <span className="marketplace-reload-modal__change-title">{change.title}</span>
              <span className="marketplace-reload-modal__change-action">
                {change.action === "enable" ? t("reloadModal.pendingEnable") : t("reloadModal.pendingDisable")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="marketplace-reload-modal__button-container">
        <Button
          onClick={async () => {
            Spicetify.PopupModal.hide();
            await marketplaceStorage.flush();
            location.reload();
          }}
        >
          {t("reloadModal.reloadNow")}
        </Button>
        <Button
          onClick={() => {
            Spicetify.PopupModal.hide();
          }}
        >
          {t("reloadModal.reloadLater")}
        </Button>
      </div>
    </div>
  );
};

export default ReloadModal;
