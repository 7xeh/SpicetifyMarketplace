import { t } from "i18next";
import React, { type DetailedReactHTMLElement } from "react";

import { MAX_TAGS } from "../../constants";

const TagsDiv = (props: { tags: string[]; showTags: boolean }) => {
  const [expanded, setExpanded] = React.useState(false);

  const englishTagMap = {
    [t("grid.externalJS")]: "external JS",
    [t("grid.archived")]: "archived",
    [t("grid.dark")]: "dark",
    [t("grid.light")]: "light"
  };

  const generateTags = (tags: string[]) => {
    const uniqueTags = tags.filter((item, pos, arr) => arr.indexOf(item) === pos);

    return uniqueTags.reduce<
      DetailedReactHTMLElement<
        {
          className: string;
          draggable: false;
          "data-tag": string;
        },
        HTMLElement
      >[]
    >((accum, tag) => {
      const englishTag = englishTagMap[tag] || tag;
      if (props.showTags || tag === t("grid.externalJS") || tag === t("grid.archived")) {
        accum.push(
          React.createElement(
            "li",
            {
              className: "marketplace-card__tag",
              draggable: false,
              "data-tag": englishTag
            },
            tag
          )
        );
      }
      return accum;
    }, []);
  };
  const isPriorityTag = (tag: string) => tag === t("grid.externalJS") || tag === t("grid.archived");
  let baseTags = [...(props.tags ?? [])].sort((a, b) => Number(isPriorityTag(b)) - Number(isPriorityTag(a)));
  let extraTags: string[] = [];
  if (baseTags.length - MAX_TAGS > 1) {
    extraTags = baseTags.slice(MAX_TAGS);
    baseTags = baseTags.slice(0, MAX_TAGS);
  }

  return (
    <div className="marketplace-card__tags-container">
      <ul className="marketplace-card__tags">
        {generateTags(baseTags)}
        {extraTags.length && expanded ? generateTags(extraTags) : null}
      </ul>
      {extraTags.length && !expanded ? (
        <button
          className="marketplace-card__tags-more-btn"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          ...
        </button>
      ) : null}
    </div>
  );
};

export default TagsDiv;
