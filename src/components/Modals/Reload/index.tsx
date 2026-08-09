import { t } from "i18next";
import React from "react";
import { marketplaceStorage } from "../../../logic/Storage";
import Button from "../../Button";

const ReloadModal = () => {
  return (
    <div id="marketplace-reload-container">
      <p>{t("reloadModal.description")}</p>
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
