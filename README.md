# Spicetify Marketplace v2

Continued maintenance of Marketplace v2, forked from [spicetify/marketplace](https://github.com/spicetify/marketplace).

[![Latest release](https://img.shields.io/github/v/release/7xeh/SpicetifyMarketplace?include_prereleases)](https://github.com/7xeh/SpicetifyMarketplace/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/7xeh/SpicetifyMarketplace/total.svg)](https://github.com/7xeh/SpicetifyMarketplace/releases)

Marketplace lets you browse, download, and install extensions, themes, and CSS snippets from within the Spotify desktop client. Custom apps are listed as well, although they still require manual installation.

## Purpose

Spicetify is building Marketplace v3, and that is where their effort belongs. Until v3 is released, however, v2 remains the version people are running, and Spotify continues to ship client updates that break it. Several of those breakages have gone unresolved while work has shifted to the replacement.

This fork exists to keep v2 usable during that gap. The scope is deliberately narrow:

1. Fix defects that make the app unusable.
2. Harden the app against future Spotify client changes.
3. Leave the existing architecture in place.

No rewrite, no rebrand, and no competing roadmap. Marketplace v3 is the intended successor, and this fork is only a bridge to it. Once v3 ships, this project is no longer needed.

## Requirements

- Spotify desktop client
- [Spicetify CLI](https://github.com/spicetify/cli) (the installer will install it if it is missing)

## Installation

### Windows

```powershell
iwr -useb https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.ps1 | iex
```

### macOS and Linux

```bash
curl -fsSL https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.sh | sh
```

The installer detects any existing Marketplace installation, whether it came from upstream or from this fork, removes it, and installs this build in its place.

Settings and installed extensions, themes, and snippets are stored inside Spotify rather than on disk, so they are preserved across the change. Returning to upstream v2, or moving to v3 once it is available, only requires running the corresponding installer.

## Uninstallation

```powershell
iwr -useb https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.ps1 -OutFile "$env:TEMP\mp.ps1"; & "$env:TEMP\mp.ps1" -UninstallOnly
```

```bash
MARKETPLACE_UNINSTALL_ONLY=1 sh -c "$(curl -fsSL https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.sh)"
```

This removes the custom app and its entries in the Spicetify configuration. If `current_theme` is still set to `marketplace`, the placeholder theme directory is kept so Spotify can continue to resolve it; set a different theme first if you want it removed as well. Marketplace data held in Spotify's own storage is left untouched.

## Changes from upstream v2

### Defect fixes

- **Load More no longer crashes the client.** A card with a missing title caused an unhandled `TypeError` during render, which took down the entire grid. See [upstream issue #1215](https://github.com/spicetify/marketplace/issues/1215). The search predicate now tolerates absent fields, and malformed entries are discarded with a console warning rather than propagating.
- **Hard reloads no longer produce a blank page.** The app previously rendered before Spicetify had finished populating its API namespaces, so `Ctrl+Shift+R` could leave the view empty. Rendering is now deferred until the required namespaces are available.
- **Spotify UI changes no longer break mounting.** The tab bar and scroll container are resolved through ordered fallback selector lists backed by a `MutationObserver`, replacing a single hardcoded class name and an unbounded retry loop. If Spotify renames an internal class, the affected feature degrades instead of failing outright.

### Reliability

- React error boundaries wrap the application, each card section, and the tab bar. Failures render a readable message with a copyable stack trace instead of an empty view.
- GitHub responses are cached persistently, so a cold start no longer refetches every repository manifest.
- Rate limiting is handled explicitly. HTTP 403 and 429 responses are detected, the reset window is respected, and cached results are served in place of an empty grid.

### Search and browsing

- Search input is debounced and provides a clear button, `Esc` to reset, and a count of matches against the loaded set.
- An explicit empty state distinguishes "no results in what has loaded so far" from "no results at all", and offers a single action to load the remaining pages and search them.
- Load More is a labelled button with loading and disabled states. Infinite scroll is throttled and triggers before the viewport reaches the bottom, and the end of the list is indicated explicitly.

## Contributing

Issues and pull requests are welcome. If a problem also affects upstream v2, reporting it there as well is encouraged. The intent of this fork is to keep v2 working, not to fragment the ecosystem or divert effort from v3.

Development setup, publishing, and localization are unchanged from upstream:

- [Overview](https://github.com/spicetify/marketplace/wiki)
- [Publishing to Marketplace](https://github.com/spicetify/marketplace/wiki/Publishing-to-Marketplace)
- [Development](https://github.com/spicetify/marketplace/wiki/Development)
- [Translating and localizing Marketplace](https://github.com/spicetify/marketplace/wiki/Localizing-Marketplace)

Publishing is unchanged. Tag a repository with `spicetify-extensions`, `spicetify-themes`, or `spicetify-apps` and it will appear in both this fork and upstream.

## Credits

Marketplace was created by [CharlieS1103](https://github.com/CharlieS1103), [theRealPadster](https://github.com/theRealPadster), and its many contributors. This fork builds directly on their work.

Built with [Spicetify Creator](https://github.com/spicetify/spicetify-creator).

## License

Released under the [MIT License](LICENSE), unchanged from upstream.
