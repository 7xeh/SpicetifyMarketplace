import { t } from "i18next";
import React from "react";

import LoadingIcon from "./Icons/LoadingIcon";

type LoadMoreButtonProps = {
  loading: boolean;
  loadingAll: boolean;
  searching: boolean;
  onLoadMore: () => void;
  onLoadAll: () => void;
  onStop: () => void;
};

const LoadMoreButton = ({ loading, loadingAll, searching, onLoadMore, onLoadAll, onStop }: LoadMoreButtonProps) => {
  if (loadingAll) {
    return (
      <div className="marketplace-load-more">
        <div className="marketplace-load-more__spinner">
          <LoadingIcon />
        </div>
        <button type="button" className="marketplace-load-more__button" onClick={onStop}>
          {t("grid.stopLoading")}
        </button>
      </div>
    );
  }

  return (
    <div className="marketplace-load-more">
      <button
        type="button"
        className="marketplace-load-more__button marketplace-load-more__button--primary"
        onClick={onLoadMore}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? t("grid.loading") : t("grid.loadMore")}
      </button>
      {searching ? (
        <button type="button" className="marketplace-load-more__button" onClick={onLoadAll} disabled={loading}>
          {t("grid.loadAll")}
        </button>
      ) : null}
    </div>
  );
};

export default LoadMoreButton;
