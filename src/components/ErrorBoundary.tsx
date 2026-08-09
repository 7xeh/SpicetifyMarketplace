import { t } from "i18next";
import React from "react";

import { MARKETPLACE_VERSION } from "../constants";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  context?: string;
  compact?: boolean;
  onError?: (error: Error, info: React.ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: null
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const context = this.props.context ?? "Marketplace";
    console.error(`Marketplace crashed in ${context}`, error, info.componentStack);

    this.setState({ componentStack: info.componentStack ?? null });

    try {
      Spicetify?.showNotification?.(t("errorBoundary.notification"), true, 5000);
    } catch (notificationError) {
      console.error(notificationError);
    }

    this.props.onError?.(error, info);
  }

  getDetails() {
    const { error, componentStack } = this.state;

    return [
      `Marketplace ${MARKETPLACE_VERSION}`,
      `Spotify ${Spicetify?.Platform?.version ?? "unknown"}`,
      `Context: ${this.props.context ?? "App"}`,
      "",
      error?.stack || String(error),
      componentStack || ""
    ].join("\n");
  }

  copyDetails = () => {
    const details = this.getDetails();

    try {
      Spicetify.Platform.ClipboardAPI.copy(details);
      Spicetify?.showNotification?.(t("errorBoundary.detailsCopied"));
    } catch (error) {
      console.error(error);
      console.error(details);
    }
  };

  reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.compact) {
      return (
        <div className="marketplace-error marketplace-error--compact">
          <p className="marketplace-error__message">{t("errorBoundary.compact")}</p>
          <button type="button" className="marketplace-error__button" onClick={this.reset}>
            {t("errorBoundary.retry")}
          </button>
        </div>
      );
    }

    return (
      <section className="contentSpacing marketplace-error">
        <h1 className="marketplace-error__title">{t("errorBoundary.title")}</h1>
        <p className="marketplace-error__message">{t("errorBoundary.description")}</p>
        <pre className="marketplace-error__stack">{error.message || String(error)}</pre>
        <div className="marketplace-error__actions">
          <button type="button" className="marketplace-error__button" onClick={this.reset}>
            {t("errorBoundary.retry")}
          </button>
          <button type="button" className="marketplace-error__button" onClick={() => window.location.reload()}>
            {t("errorBoundary.reload")}
          </button>
          <button type="button" className="marketplace-error__button" onClick={this.copyDetails}>
            {t("errorBoundary.copyDetails")}
          </button>
        </div>
      </section>
    );
  }
}
