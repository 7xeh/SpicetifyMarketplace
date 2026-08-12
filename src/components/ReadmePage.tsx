import React from "react";
import { withTranslation } from "react-i18next";
import { getMarkdownHTML } from "../logic/Utils";
import type { CardType } from "../types/marketplace-types";
import Button from "./Button";
import DownloadIcon from "./Icons/DownloadIcon";
import GitHubIcon from "./Icons/GitHubIcon";
import LoadingIcon from "./Icons/LoadingIcon";
import TrashIcon from "./Icons/TrashIcon";

class ReadmePage extends React.Component<
  {
    data: {
      title: string;
      user: string;
      repo: string;
      branch: string;
      readmeURL: string;
      readmeDir: string;
      type: CardType;
      install: () => void | Promise<void>;
      isInstalled: () => boolean;
    };
    title: string;
    t: (key: string) => string;
  },
  {
    isInstalled: boolean;
    html: string;
    loading: boolean;
  }
> {
  state = {
    isInstalled: this.props.data.isInstalled(),
    html: "",
    loading: true
  };

  scrollbarInterval: ReturnType<typeof setInterval> | null = null;

  getReadmeHTML = async () => {
    return fetch(this.props.data.readmeURL)
      .then((res) => {
        if (!res.ok) throw Spicetify.showNotification(`${this.props.t("readmePage.errorLoading")} (HTTP ${res.status})`, true);
        return res.text();
      })
      .then((readmeText) => getMarkdownHTML(readmeText, this.props.data.user, this.props.data.repo))
      .then((html) => {
        if (!html) Spicetify.Platform.History.goBack();
        return html;
      })
      .catch((err) => {
        console.error(err);
        Spicetify.Platform.History.goBack();
        return null;
      });
  };

  componentDidMount() {
    this.getReadmeHTML().then((html) => {
      if (html === null || html === undefined) return;
      this.setState({ html, loading: false });
    });
  }

  componentWillUnmount() {
    if (this.scrollbarInterval !== null) clearInterval(this.scrollbarInterval);
    this.scrollbarInterval = null;
  }

  componentDidUpdate() {
    const main = document.querySelector("#marketplace-readme")?.closest("main");
    if (main && this.scrollbarInterval === null) {
      this.scrollbarInterval = setInterval(() => {
        if (!document.querySelector("#marketplace-readme")) {
          if (this.scrollbarInterval !== null) clearInterval(this.scrollbarInterval);
          this.scrollbarInterval = null;
          main.style.removeProperty("overflow-y");
          return;
        }
        main.style.overflowY = "visible";
        main.style.overflowY = "auto";
      }, 1000);
    }

    for (const img of Array.from(document.querySelectorAll("#marketplace-readme img"))) {
      img.addEventListener(
        "error",
        (e) => {
          const element = e.target as HTMLImageElement;
          const originalSrc = element.getAttribute("src");
          const fixedSrc =
            originalSrc?.charAt(0) === "/"
              ? `https://raw.githubusercontent.com/${this.props.data.user}/${this.props.data.repo}/${this.props.data.branch}/${originalSrc?.slice(1)}`
              : `${this.props.data.readmeURL.substring(0, this.props.data.readmeURL.lastIndexOf("/"))}/${originalSrc}`;
          element.setAttribute("src", fixedSrc);
        },
        { once: true }
      );
    }
  }

  buttonContent() {
    if (this.props.data.type === "app") {
      return {
        icon: <GitHubIcon />,
        text: this.props.t("github")
      };
    }
    if (this.state.isInstalled) {
      return {
        icon: <TrashIcon />,
        text: this.props.t("remove")
      };
    }
    return {
      icon: <DownloadIcon />,
      text: this.props.t("install")
    };
  }

  render() {
    let expFeatures: Record<string, { value?: string }> = {};
    try {
      expFeatures = JSON.parse(localStorage.getItem("spicetify-exp-features") || "{}") || {};
    } catch (error) {
      console.warn("Marketplace: could not read spicetify-exp-features", error);
    }

    const isGlobalNav = expFeatures.enableGlobalNavBar?.value !== "control" && true;

    const tabBarMargin = {
      marginTop: isGlobalNav ? "60px" : "0px"
    };

    return (
      <section className="contentSpacing">
        <div className="marketplace-header" style={tabBarMargin}>
          <div className="marketplace-header__left">
            <h1>{this.props.title}</h1>
          </div>
          <div className="marketplace-header__right">
            <Button
              classes={["marketplace-header__button"]}
              onClick={(e) => {
                e.preventDefault();
                this.props.data.install();
                this.setState({ isInstalled: !this.state.isInstalled });
              }}
              label={this.buttonContent().text}
            >
              {this.buttonContent().icon} {this.buttonContent().text}
            </Button>
          </div>
        </div>
        {this.state.loading ? (
          <footer className="marketplace-footer">
            <LoadingIcon />
          </footer>
        ) : (
          <div id="marketplace-readme" className="marketplace-readme__container" dangerouslySetInnerHTML={{ __html: this.state.html }} />
        )}
      </section>
    );
  }
}

export default withTranslation()(ReadmePage);
