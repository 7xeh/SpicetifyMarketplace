import { t } from "i18next";
import React, { useRef } from "react";

import CloseIcon from "./Icons/CloseIcon";
import SearchIcon from "./Icons/SearchIcon";

type SearchBarProps = {
  value: string;
  placeholder: string;
  status?: string | null;
  onChange: (value: string) => void;
  onClear: () => void;
};

const SearchBar = ({ value, placeholder, status, onChange, onClear }: SearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = () => {
    onClear();
    inputRef.current?.focus();
  };

  return (
    <div className="searchbar--bar__wrapper">
      <div className="marketplace-searchbar">
        <span className="marketplace-searchbar__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          className="searchbar-bar"
          type="search"
          spellCheck={false}
          autoComplete="off"
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !value) return;
            event.preventDefault();
            event.stopPropagation();
            clear();
          }}
        />
        {value ? (
          <button
            type="button"
            className="marketplace-searchbar__clear"
            aria-label={t("grid.clearSearch")}
            title={t("grid.clearSearch")}
            onClick={clear}
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>
      {status ? (
        <span className="marketplace-searchbar__status" aria-live="polite">
          {status}
        </span>
      ) : null}
    </div>
  );
};

export default SearchBar;
