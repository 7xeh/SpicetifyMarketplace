# 7's Marketplace

Continued maintenance of Spicetify Marketplace v2, forked from [spicetify/marketplace](https://github.com/spicetify/marketplace).

[![Latest release](https://img.shields.io/github/v/release/7xeh/SpicetifyMarketplace?include_prereleases)](https://github.com/7xeh/SpicetifyMarketplace/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/7xeh/SpicetifyMarketplace/total.svg)](https://github.com/7xeh/SpicetifyMarketplace/releases)

It lets you browse, download, and install extensions, themes, and CSS snippets from within the Spotify desktop client. Custom apps are listed as well, although they still require manual installation.

It installs alongside the official Spicetify Marketplace rather than on top of it: a separate custom app (`sevens-marketplace`), a separate placeholder theme, and a separate storage database. Installing this does not overwrite, disable, or erase an existing Marketplace install.

## Purpose

Spicetify is building Marketplace v3, and that is where their effort belongs. Until v3 is released, however, v2 remains the version people are running, and Spotify continues to ship client updates that break it. Several of those breakages have gone unresolved while work has shifted to the replacement.

This fork exists to keep v2 usable during that gap. The scope is deliberately narrow:

1. Fix defects that make the app unusable.
2. Harden the app against future Spotify client changes.
3. Leave the existing architecture in place.

No rewrite and no competing roadmap. Marketplace v3 is the intended successor, and this fork is only a bridge to it. Once v3 ships, this project is no longer needed.

It carries its own name and app id purely so it can sit next to the official Marketplace instead of replacing it — earlier builds shared both, which meant reinstalling one clobbered the other.

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

The installer only replaces previous installs of *this* fork. An official Spicetify Marketplace found in `CustomApps/marketplace` is left alone, and both appear in the sidebar. (Builds of this fork before v1.3.0 installed themselves as `marketplace`; the installer recognises those by their contents and reclaims that folder.)

### Your existing setup

Settings and installed extensions, themes, and snippets live inside Spotify rather than on disk. On first launch this fork **copies** what the official Marketplace has — from its IndexedDB store, or from `localStorage` on older versions — into its own database, and leaves the originals exactly where they are. Both apps keep working, and from then on each tracks its own installs.

If you ever need to pull that copy again, run this in the Spotify devtools console:

```js
await SevensMarketplace.importFromSpicetifyMarketplace()
```

Returning to upstream v2, or moving to v3 once it is available, only requires running the corresponding installer.

## Uninstallation

```powershell
iwr -useb https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.ps1 -OutFile "$env:TEMP\mp.ps1"; & "$env:TEMP\mp.ps1" -UninstallOnly
```

```bash
MARKETPLACE_UNINSTALL_ONLY=1 sh -c "$(curl -fsSL https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.sh)"
```

This removes the custom app and its entries in the Spicetify configuration. If `current_theme` is still set to `sevens-marketplace`, the placeholder theme directory is kept so Spotify can continue to resolve it; set a different theme first if you want it removed as well. Data held in Spotify's own storage is left untouched, as is any official Marketplace install.

## Changes from upstream v2

### Defect fixes

- **Load More no longer crashes the client.** A card with a missing title caused an unhandled `TypeError` during render, which took down the entire grid. See [upstream issue #1215](https://github.com/spicetify/marketplace/issues/1215). The search predicate now tolerates absent fields, and malformed entries are discarded with a console warning rather than propagating.
- **Removing an extension now persists.** Writes to IndexedDB were fire and forget, while the reload prompt called `location.reload()` immediately. A removal issues two writes, so an interrupted reload could apply one and lose the other, leaving an extension listed as installed but absent from the Installed tab. See [upstream issue #1186](https://github.com/spicetify/marketplace/issues/1186). Pending writes are now tracked and flushed before any reload, and an install or removal writes the payload and its install list in a single transaction, so a failure cannot leave the two disagreeing.
- **Removed extensions stop running.** Removing one now also drops it from `Spicetify.Config.extensions` and takes its `<script>` back out of the DOM. Code that already ran cannot be unloaded, so the reload prompt lists exactly what is still live and what has yet to start, driven by a diff of what actually loaded against what is installed rather than a guess.
- **Album art based colours now work.** `Spicetify.colorExtractor` expects a Spotify URI, but the artwork URL was being passed instead, so extraction failed on every track. See [upstream issue #1098](https://github.com/spicetify/marketplace/issues/1098). The track URI is now used, local files are skipped, and an unusable result is logged and ignored rather than throwing.
- **Hard reloads no longer produce a blank page.** The app previously rendered before Spicetify had finished populating its API namespaces, so `Ctrl+Shift+R` could leave the view empty. Rendering is now deferred until the required namespaces are available.
- **Spotify UI changes no longer break mounting.** The tab bar and scroll container are resolved through ordered fallback selector lists backed by a `MutationObserver`, replacing a single hardcoded class name and an unbounded retry loop. If Spotify renames an internal class, the affected feature degrades instead of failing outright.

### Installing side by side

- The custom app, its placeholder theme, its IndexedDB database, its cached GitHub responses, and the `<style>` and `<script>` tags it injects are all namespaced to this fork. An official Marketplace install running at the same time no longer fights it over any of them.
- Earlier builds migrated `marketplace:` keys out of `localStorage` and **deleted the originals**, which wiped the official Marketplace's installs. The first-launch import is now a copy and never removes anything.
- Restoring the modal shell Spotify stopped styling. `Spicetify.PopupModal` builds its markup from Spotify's old Track Credits modal; those classes were deleted in the client, leaving settings and every other modal with no padding, a close button dropped below the title, and no scroll container. Ported from [upstream PR for `fix/popupmodal-shell-styling`](https://github.com/spicetify/marketplace/tree/fix/popupmodal-shell-styling).

### Reliability

- React error boundaries wrap the application, each card section, and the tab bar. Failures render a readable message with a copyable stack trace instead of an empty view.
- GitHub responses are cached persistently, so a cold start no longer refetches every repository manifest.
- Rate limiting is handled explicitly. HTTP 403 and 429 responses are detected, the reset window is respected, and cached results are served in place of an empty grid.
- A `setInterval` in the album art colour watcher was never cleared, leaking a timer on every track change. It now clears on resolution and times out.
- The update checker points at this repository rather than upstream, so it no longer offers an upstream release that would replace this build. A crash in the changelog parser on releases with a single section was also fixed.

### Search and browsing

- Search input is debounced and provides a clear button, `Esc` to reset, and a count of matches against the loaded set.
- An explicit empty state distinguishes "no results in what has loaded so far" from "no results at all", and offers a single action to load the remaining pages and search them.
- Load More is a labelled button with loading and disabled states. Infinite scroll is throttled and triggers before the viewport reaches the bottom, and the end of the list is indicated explicitly.

## Contributing

Issues and pull requests are welcome. If a problem also affects upstream v2, reporting it there as well is encouraged. The intent of this fork is to keep v2 working, not to fragment the ecosystem or divert effort from v3.

[docs/INTERNALS.md](docs/INTERNALS.md) documents how the project fits together — architecture, the
non-obvious workarounds, storage layout, security invariants, and the outstanding TODOs. Read it
before changing anything that looks arbitrary.

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
