import { t } from "i18next";
import { highlight, languages } from "prismjs/components/prism-core";
import React from "react";
import Editor from "react-simple-code-editor";
import "prismjs/components/prism-css";

import { LOCALSTORAGE_KEYS } from "../../../constants";
import type { ModalType } from "../../../logic/LaunchModals";
import { marketplaceStorage } from "../../../logic/Storage";
import { fileToBase64, getLocalStorageDataFromKey, getStringArrayFromKey, initializeSnippets } from "../../../logic/Utils";
import Button from "../../Button";
import type { CardProps } from "../../Card/Card";

const SnippetModal = (props: { content?: CardProps; type: ModalType; callback?: () => void }) => {
  const PREVIEW_IMAGE_ID = "marketplace-customCSS-preview";
  const [code, setCode] = React.useState(props.type === "ADD_SNIPPET" ? "" : props.content?.item.code || "");
  const [name, setName] = React.useState(props.type === "ADD_SNIPPET" ? "" : props.content?.item.title || "");
  const [description, setDescription] = React.useState(props.type === "ADD_SNIPPET" ? "" : props.content?.item.description || "");
  const [imageURL, setimageURL] = React.useState(props.type === "ADD_SNIPPET" ? "" : props.content?.item.imageURL || "");

  const processSnippetName = (value: string) => value.replace(/\n/g, "").replaceAll(" ", "-");
  const processName = () => processSnippetName(name);
  const processCode = () => code.replace(/\n/g, "\\n");

  const localStorageKey = `marketplace:installed:snippet:${processName()}`;
  const isInstalled = () => !!getLocalStorageDataFromKey(localStorageKey);
  const [installedLabel, setInstalledLabel] = React.useState(isInstalled());

  const saveSnippet = async () => {
    const processedName = processName();
    const processedDescription = description.trim();

    if (isInstalled() && props.type !== "EDIT_SNIPPET") {
      Spicetify.showNotification(t("snippets.duplicateName"), true);
      return;
    }

    console.debug(`Installing snippet: ${processedName}`);
    const previousName = props.content ? processSnippetName(props.content.item.title || "") : "";
    if (previousName && previousName !== processedName) {
      console.debug(`Deleting outdated snippet: ${previousName}`);

      const previousKey = `marketplace:installed:snippet:${previousName}`;
      await marketplaceStorage.removeItemAsync(previousKey);
      const installedSnippetKeys = getStringArrayFromKey(LOCALSTORAGE_KEYS.installedSnippets);
      const remainingInstalledSnippetKeys = installedSnippetKeys.filter((key: string) => key !== previousKey);
      await marketplaceStorage.setItemAsync(LOCALSTORAGE_KEYS.installedSnippets, JSON.stringify(remainingInstalledSnippetKeys));
    }

    await marketplaceStorage.setItemAsync(
      localStorageKey,
      JSON.stringify({
        title: processedName,
        code,
        description: processedDescription,
        imageURL,
        custom: true
      })
    );

    const installedSnippetKeys = getStringArrayFromKey(LOCALSTORAGE_KEYS.installedSnippets);
    if (installedSnippetKeys.indexOf(localStorageKey) === -1) {
      installedSnippetKeys.push(localStorageKey);
      await marketplaceStorage.setItemAsync(LOCALSTORAGE_KEYS.installedSnippets, JSON.stringify(installedSnippetKeys));
    }
    const installedSnippets = installedSnippetKeys.map((key: string) => getLocalStorageDataFromKey(key)).filter(Boolean);
    initializeSnippets(installedSnippets);

    Spicetify.PopupModal.hide();
    if (props.type === "EDIT_SNIPPET") location.reload();
  };

  const inputElement = React.useRef<HTMLInputElement>(null);
  const FileInputClick = () => {
    inputElement.current?.click();
  };

  return (
    <div id="marketplace-add-snippet-container">
      <div className="marketplace-customCSS-input-container">
        <label htmlFor="marketplace-custom-css">{t("snippets.customCSS")}</label>
        <div className="marketplace-code-editor-wrapper marketplace-code-editor">
          <Editor
            value={code}
            onValueChange={(code) => setCode(code)}
            highlight={(code) => highlight(code, languages.css)}
            textareaId="marketplace-custom-css"
            textareaClassName="snippet-code-editor"
            readOnly={props.type === "VIEW_SNIPPET"}
            placeholder={t("snippets.customCSSPlaceholder")}
            style={{}}
          />
        </div>
      </div>
      <div className="marketplace-customCSS-input-container">
        <label htmlFor="marketplace-customCSS-name-submit">{t("snippets.snippetName")}</label>
        <input
          id="marketplace-customCSS-name-submit"
          className="marketplace-code-editor"
          value={name}
          onChange={(e) => {
            if (props.type !== "VIEW_SNIPPET") setName(e.target.value);
          }}
          placeholder={t("snippets.snippetNamePlaceholder")}
        />
      </div>
      <div className="marketplace-customCSS-input-container">
        <label htmlFor="marketplace-customCSS-description-submit">{t("snippets.snippetDesc")}</label>
        <input
          id="marketplace-customCSS-description-submit"
          className="marketplace-code-editor"
          value={description}
          onChange={(e) => {
            if (props.type !== "VIEW_SNIPPET") setDescription(e.target.value);
          }}
          placeholder={t("snippets.snippetDescPlaceholder")}
        />
      </div>
      <div className="marketplace-customCSS-input-container">
        <label htmlFor={PREVIEW_IMAGE_ID}>
          {t("snippets.snippetPreview")} {props.type !== "VIEW_SNIPPET" && `(${t("snippets.optional")})`}
        </label>
        {imageURL && (
          <label htmlFor={PREVIEW_IMAGE_ID} style={{ textAlign: "center" }}>
            <img className="marketplace-customCSS-image-preview" src={imageURL} alt="Preview" />
          </label>
        )}
      </div>
      {props.type !== "VIEW_SNIPPET" && (
        <>
          <Button onClick={FileInputClick}>
            {imageURL.length ? t("snippets.changeImage") : t("snippets.addImage")}
            <input
              id={PREVIEW_IMAGE_ID}
              type="file"
              style={{ display: "none" }}
              ref={inputElement}
              onChange={async (event) => {
                if (event.target.files?.[0]) {
                  try {
                    const b64 = await fileToBase64(event.target.files?.[0]);
                    if (b64) {
                      setimageURL(b64 as string);
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }
              }}
            />
          </Button>
          <Button onClick={saveSnippet} disabled={!processName() || !processCode()}>
            {t("snippets.saveCSS")}
          </Button>
        </>
      )}
      {props.type === "VIEW_SNIPPET" && (
        <Button
          onClick={() => {
            props.callback?.();
            setInstalledLabel(!installedLabel);
          }}
        >
          {installedLabel ? t("remove") : t("install")}
        </Button>
      )}
    </div>
  );
};
export default SnippetModal;
