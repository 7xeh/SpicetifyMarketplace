# Spicetify Marketplace v2

Continued maintenance of Marketplace v2, forked from [spicetify/marketplace](https://github.com/spicetify/marketplace).

<p>
  <a href="https://github.com/7xeh/SpicetifyMarketplace/releases/latest">
    <img src="https://img.shields.io/github/v/release/7xeh/SpicetifyMarketplace?include_prereleases">
  </a>
  <a href="https://github.com/7xeh/SpicetifyMarketplace/releases">
    <img src="https://img.shields.io/github/downloads/7xeh/SpicetifyMarketplace/total.svg">
  </a>
  <a href="https://github.com/7xeh/SpicetifyMarketplace/commits/main">
    <img src="https://img.shields.io/github/commit-activity/m/7xeh/SpicetifyMarketplace">
  </a>
</p>

Customize your Spotify client directly from within [Spicetify](https://github.com/spicetify/cli).

Marketplace lets you **browse, download, and install** extensions, themes, and CSS snippets without leaving Spotify. Custom apps are listed too, though those still need manual installation.

## Why this fork exists

Spicetify is building Marketplace v3. That's the right call, and it's where their attention should be — but v3 isn't out yet, and v2 is what everyone is running in the meantime.

Spotify doesn't pause for that. It keeps shipping client updates that break things, and v2 has been sitting with bugs that make it unusable while the effort goes into its replacement.

So this fork keeps v2 alive until v3 lands. That's the whole scope: fix what's broken, harden it against the next Spotify update, leave the architecture alone. No rewrite, no rebrand, no competing vision — v3 is the future, this is just the bridge to it.

When v3 ships, this fork has done its job.

## Install

**Windows** (PowerShell):

```powershell
iwr -useb https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.ps1 | iex
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.sh | sh
```

The installer detects an existing Marketplace install — whether it came from upstream or from here — removes it cleanly, and replaces it. It will install Spicetify for you if it isn't already present.

Your settings and installed extensions, themes, and snippets live inside Spotify's own storage and survive the swap. Going back to upstream v2 — or moving to v3 when it arrives — is just running their installer instead.

To remove it:

```powershell
iwr -useb https://raw.githubusercontent.com/7xeh/SpicetifyMarketplace/main/resources/install.ps1 -OutFile "$env:TEMP\mp.ps1"; & "$env:TEMP\mp.ps1" -UninstallOnly
```

## What's different from upstream v2

**Fixes**

- **Load More no longer crashes the app** ([upstream #1215](https://github.com/spicetify/marketplace/issues/1215)) — a card with a missing title took down the entire grid mid-render. The search predicate is now total, and malformed items are dropped with a warning instead of taking everything with them.
- **No more white screen on a hard reload** — Marketplace rendered before Spicetify finished loading its APIs, so `Ctrl+Shift+R` could leave you staring at nothing. It now waits for what it needs.
- **Survives Spotify UI changes** — the tab bar and scroll container are resolved through fallback selector lists with a `MutationObserver`, instead of one hardcoded class name and an infinite retry loop. If Spotify renames something, Marketplace degrades instead of disappearing.

**Reliability**

- React error boundaries around the app, each card section, and the tab bar. A failure shows a readable message with a copyable stack trace, not a blank page.
- Aggressive caching of GitHub responses, so a cold start doesn't re-fetch hundreds of manifests every time you open Spotify.
- Real rate-limit handling: HTTP 403/429 is detected, the reset time is respected, and cached results are served instead of an empty grid.

**Search and browsing**

- Debounced search with a clear button, <kbd>Esc</kbd> to reset, and a count showing how much of the loaded set matched.
- A proper "no results" state that tells you when the answer is "load more" rather than "it doesn't exist" — plus a one-click "load everything and search".
- A real Load More button with loading and disabled states, throttled infinite scroll that starts early, and an end-of-list marker.

## Contributing

Issues and pull requests are welcome. If your problem also affects upstream v2, filing it there too is worth doing — the point of this fork is to keep v2 working, not to fragment the ecosystem or pull effort away from v3.

Development setup, publishing your own extensions and themes, and localization are unchanged from upstream:

- [Overview](https://github.com/spicetify/marketplace/wiki)
- [Publishing to Marketplace](https://github.com/spicetify/marketplace/wiki/Publishing-to-Marketplace)
- [Development](https://github.com/spicetify/marketplace/wiki/Development)
- [Translating/Localizing Marketplace](https://github.com/spicetify/marketplace/wiki/Localizing-Marketplace)

Publishing works exactly as before — tag your repo `spicetify-extensions`, `spicetify-themes`, or `spicetify-apps` and it shows up in both.

## Credits

Marketplace was built by [CharlieS1103](https://github.com/CharlieS1103), [theRealPadster](https://github.com/theRealPadster), and everyone who has contributed to it over the years. This fork is their work with the rough edges sanded off, and it keeps the original MIT license.

Go support [Spicetify](https://github.com/spicetify/cli) and Marketplace v3 — that's where this all ends up.

Made with [Spicetify Creator](https://github.com/spicetify/spicetify-creator).
