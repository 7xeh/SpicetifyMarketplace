# Marketplace internals

The source tree carries no explanatory comments. Everything that used to live in a `//` next to
a line of code is collected here instead, reorganised so it reads as one document rather than 400
scattered notes. If you are about to change something and it looks arbitrary, it is probably
explained below.

Only functional directives survive in the source: `@ts-expect-error` and `biome-ignore`. Those are
compiler and linter instructions, not prose. Everything the minifier strips is here.

- [Build and entry points](#build-and-entry-points)
- [Startup order](#startup-order)
- [Remote data](#remote-data)
- [Caching and rate limiting](#caching-and-rate-limiting)
- [Persistent storage](#persistent-storage)
- [The grid](#the-grid)
- [Cards and installation](#cards-and-installation)
- [Themes](#themes)
- [Snippets](#snippets)
- [The tab bar](#the-tab-bar)
- [Readme pages](#readme-pages)
- [Settings, backup and dev tools](#settings-backup-and-dev-tools)
- [Localisation](#localisation)
- [Security invariants](#security-invariants)
- [Cross-file invariants](#cross-file-invariants)
- [Known rough edges](#known-rough-edges)

## Build and entry points

`spicetify-creator` builds two artefacts from one source tree:

| Artefact | Entry | Runs |
| --- | --- | --- |
| `extension.js` | `src/extensions/extension.tsx` | On every Spotify start, always |
| `index.js` + `style.css` | `src/app.tsx` | Only when the user opens the Marketplace tab |

This split is the single most important thing to understand. The extension is what actually
applies your installed theme, extensions and snippets to the client. The custom app is only the
browsing UI. A user who never opens Marketplace still runs the extension on every launch, so
anything expensive or fragile in `extension.tsx` costs every user every start.

The two share `src/logic/*`, which is why several functions carry a "keep in sync" obligation —
see [Cross-file invariants](#cross-file-invariants).

`build:local` minifies, which strips all comments from the output. That is why removing them from
source changes nothing about the shipped bundle.

## Startup order

`extension.tsx` runs two independent async IIFEs.

**`init()`** — the one that matters:

1. Waits (via `setTimeout` self-retry) for `Spicetify.LocalStorage` and `Spicetify.showNotification`.
2. Injects a `const global = globalThis;` script tag. This is a workaround for
   [react-simple-code-editor#86](https://github.com/satya164/react-simple-code-editor/issues/86);
   the editor references a bare `global` that does not exist in the browser.
3. Hydrates storage from IndexedDB (see [Persistent storage](#persistent-storage)).
4. Exposes `window.Marketplace` — `reset()`, `export()`, `clearCache()`, `version`. `reset()` exists
   so a user can recover from a broken state via the dev console without reinstalling.
5. Resolves a working jsDelivr TLD.
6. Loads installed snippets, then extensions, then the theme.

**`initializePreload()`** — warms the manifest cache for the grid in the background so opening the
Marketplace tab is not a cold start. It clears `sessionStorage` first. This runs concurrently with
`init()`, but its `sessionStorage.clear()` is synchronous and happens before `init()` writes
`marketplace-request-tld`, so the two do not race.

Both IIFEs attach a `.catch()`. Without one, a rejection anywhere in startup silently aborts the
rest of theme and extension loading.

### The jsDelivr TLD probe

`getAvailableTLD()` tries `cdn.jsdelivr.net` then `.xyz` with `redirect: "manual"` and looks for
`response.type === "opaqueredirect"`. It doubles as a connectivity check. If neither responds:

- Online → the CDN is blocked or down; notify the user and stop.
- Offline → register a one-shot `online` listener and re-run `init()` when connectivity returns.

The resolved TLD goes into `sessionStorage` as `marketplace-request-tld` so the custom app can reuse
it without probing again.

### Why jsDelivr at all

Installed extensions and theme `include` scripts are `raw.githubusercontent.com` URLs. Those are
served as `text/plain` and are rate limited. Any GitHub raw URL is rewritten to
`cdn.jsdelivr.{tld}/gh/{user}/{repo}@{branch}/{path}` before being injected as a `<script>`.
`.mjs` files get `type="module"`. A `?time=` cache-buster is appended so updates are picked up.

`app.tsx` is much simpler: wait for Spicetify namespaces, set the locale, hydrate storage, build
`CONFIG`, render. It renders `null` until storage is ready — without that gate a hard reload
(Ctrl+Shift+R) renders the grid before `Spicetify.Platform` exists.

## Remote data

Three GitHub topics back the three browsable tabs:

- `spicetify-extensions`
- `spicetify-themes`
- `spicetify-apps`

`getTaggedRepos()` hits `api.github.com/search/repositories?q=topic:{tag}`, 100 items per page
(`ITEMS_PER_REQUEST`, the GitHub maximum). Results are filtered through the blacklist and, unless
the user opted in, archived repos are dropped.

Page 0 and page 1 hit the same endpoint — the `page` param is only appended when truthy. The cache
key is therefore `${tag}-page-${page || 1}`, so both collapse onto one entry instead of issuing the
same request twice.

`page_count` is the unfiltered count of items on the page. Blacklist filtering happens after, and
using the filtered length would corrupt the "have we reached the end" arithmetic.

### Manifests, and the Worker

Each repo's `manifest.json` is fetched from `raw.githubusercontent.com`. Most repos tagged with a
Spicetify topic have no manifest, so this 404s constantly. Doing it on the main thread floods the
console with unsuppressable network errors, so the fetch is delegated to a `Worker` built from a
blob URL. The worker posts back parsed JSON or `null`; the console noise stays in the worker.

The worker has a 15s timeout. Without it, a worker that never answers leaves the promise pending
forever and the grid spins indefinitely.

A manifest may be a single object or an array of them — one repo can ship several items. It is
normalised to an array and validated with a zod schema. Which kind of card it becomes is decided by
which fields are present:

| Fields present | Card type |
| --- | --- |
| `name` + `description` + `main` | Extension |
| `name` + `description` + `usercss` | Theme |
| `name` + `description`, no `main`, no `usercss` | Custom app |

Custom apps have no entry point; they are listed only so the card can link out to the repo.

Repos *with* a manifest are cached for 6h; repos *without* one are re-checked after 1h, on the
theory that a repo may gain a manifest. If a fetch fails and an expired copy exists, the expired
copy is served rather than dropping the repo out of the grid entirely.

Any manifest field that is not an absolute URL is resolved relative to
`raw.githubusercontent.com/{user}/{repo}/{branch}/`.

### Blacklist and snippets

Both are JSON files fetched from the upstream `spicetify/marketplace` repo:

- `resources/blacklist.json` → `{ repos: string[] }`
- `resources/snippets.json` → an array of `{ title, description, code, preview }`

Blacklist entries support a small glob syntax, case-insensitively:

| Pattern | Matches |
| --- | --- |
| `https://github.com/user/repo` | that exact repo |
| `https://github.com/user/*` | every repo from that user |
| `https://github.com/*/name` | that repo name from any user |

`*` compiles to `[^/]+`, so it never spans a path separator. Runs of consecutive `*` are collapsed
before compiling; `[^/]+[^/]+[^/]+…` is the classic shape for catastrophic backtracking, and the
pattern list comes from a remote file.

## Caching and rate limiting

Two layers, both in `src/logic/`.

**`RequestCache.ts`** — a memory `Map` in front of `localStorage`, keyed with a
`marketplace-cache:` prefix. Entries are `{ t: timestamp, v: value }`. Anything over 1 MB is not
persisted. On a quota error it evicts the oldest half and retries once. `pruneRequestCache()` runs
at startup and drops anything older than 7 days.

TTLs:

| Kind | TTL |
| --- | --- |
| Search pages | 30 min |
| Manifests | 6 h |
| Repo metadata | 1 h |
| Blacklist / snippets | 6 h |
| Release check | 6 h |

**`GitHubApi.ts`** — the fetch wrapper everything should go through. It provides:

- Fresh-cache short circuit before any network call.
- In-flight deduplication by cache key, so N cards asking for the same repo make one request.
- A 15s timeout via `AbortController`.
- Rate limit handling: on 403/429 it reads `retry-after`, or `x-ratelimit-remaining: 0` plus
  `x-ratelimit-reset`, or falls back to a 60s backoff. The reset time is persisted, so a reload
  does not immediately re-hammer the API.
- Stale-while-rate-limited: when limited it serves expired cache rather than nothing.
- One notification per rate limit window, not one per request.

Unauthenticated GitHub search is 10 requests/minute. Anything that fetches per-card must use this
wrapper or the "Installed" tab alone will exhaust the budget.

## Persistent storage

`Storage.ts` fronts an IndexedDB store (`spicetify-marketplace` / `settings`) with a synchronous
in-memory `Map`, because the rest of the codebase was written against a synchronous
`localStorage`-shaped API. `hydrateMarketplaceStorage()` loads the whole store into memory, then
migrates any legacy `marketplace:`-prefixed `localStorage` keys across.

Reads are synchronous against the map. Writes update the map immediately and queue an IndexedDB
write. Every queued write is tracked, and `flush()` awaits them — reloading Spotify drops the
in-memory map, so pending writes have to land first. Anything that calls `location.reload()` after
a write should either use the `…Async` variants or call `flush()`.

### Key layout

| Key | Contents |
| --- | --- |
| `marketplace:installed-extensions` | Array of extension storage keys |
| `marketplace:installed-themes` | Array of theme storage keys |
| `marketplace:installed-snippets` | Array of snippet storage keys |
| `marketplace:theme-installed` | The storage key of the active theme |
| `marketplace:local-theme` | `Spicetify.Config.current_theme` as seen at startup |
| `marketplace:activeTab`, `:tabs`, `:sort` | UI state |
| `marketplace:albumArtBasedColors*`, `:colorShift` | Colour behaviour toggles |
| `marketplace:installed:{user}/{repo}/{file}` | An installed extension or theme |
| `marketplace:installed:snippet:{Dashed-Title}` | An installed snippet |

Two levels: a list of keys, and the payload under each key. They can disagree — a partial reset, a
failed write or a manual edit leaves a key listed as installed with no data behind it. Readers must
tolerate that; `getStringArrayFromKey()` exists so a corrupt list returns `[]` instead of throwing
and taking the grid down with it.

Removal order matters: the list is written *before* the payload is deleted, so an interrupted
removal can never leave a dangling list entry pointing at nothing.

Snippet keys replace spaces with dashes. Derive them with `generateKey()` rather than rebuilding
the string by hand, or the lookup will miss for any title containing a space.

## The grid

`Grid.tsx` is the browsing UI, and its paging machinery is the least obvious code in the project.

`requestQueue` is an array of arrays. Each entry represents one in-flight "load a page" operation.
Switching tabs `unshift`s a new queue, and every async loop checks
`this.requestQueue.length > 1 && queue !== this.requestQueue[0]` after each await. If that is true
the old operation returns `-1`, which means "abandon this queue, its results are stale". Without
it, results from the previous tab keep appending to the new tab's card list.

`requestPage` is the GitHub page number, and `0`/`-1` are sentinels rather than real pages — hence
the repeated `this.requestPage > -1 && this.requestPage ? this.requestPage : 1` coercion.

Cards are collected into `this.cardList` (a plain field, not state) and only mirrored into state to
trigger renders. `groupCards()` splits them by type at render time, applies the search filter and
drops duplicates. Each card is cloned with the current `activeThemeKey` purely to force a re-render
when the active theme changes.

The card `key` is `{activeTab}:{user}:{title}`. Including the tab prevents React from reusing a
card component across tabs, which used to leave stale cards on screen.

Other behaviour worth knowing:

- Scroll is throttled to one check per animation frame; the raw scroll event fires far faster than
  the check is worth running.
- Infinite scroll needs a scroll container. `MAIN_VIEW_SCROLL_SELECTORS` lists several because
  Spotify renames these classes between client versions. If none match, the grid logs a warning and
  falls back to the Load More button rather than breaking.
- "Load all" is capped at `MAX_AUTO_LOAD_PAGES` (20) and stops early if nothing new arrives or the
  rate limit trips.
- Search is debounced 250 ms and matches title, manifest name, user, repo, authors and tags.
- The version check compares the latest GitHub release against `MARKETPLACE_VERSION` with semver
  and does not notify on rate limit — a background check should never nag.

The "Installed" tab reads entirely from local storage and returns everything in one pass, so it
never returns a next-page number.

## Cards and installation

`Card.tsx` is a class component holding both `state.installed` and an `isInstalled()` method. The
method reads storage live; the state field exists only to trigger re-renders. After a re-render the
state value goes stale, so anything that must be correct calls the method.

`this.tags` is copied out of `props.item.tags` rather than used directly. Pushing the synthetic
"external JS" and "archived" tags onto the prop array would mutate the shared item and duplicate
those tags on every re-render.

Installing writes a snapshot of the card's props into storage under `generateKey()`, then appends
the key to the relevant installed list. Uninstalling reverses it, list first.

On the "Installed" tab each card re-checks its repo on mount for a new `pushed_at`, and if the repo
has been pushed to since, silently reinstalls to pull the update. This goes through the rate-limit-
aware fetcher; a naive `fetch` per card exhausts the GitHub budget as soon as the user has a handful
of items installed.

Theme installs are gated on `config-xpui.ini` having `current_theme = marketplace`. Without it
Spicetify overwrites `user.css` and the theme silently does not apply, so the install is refused
with a notification. The check is skipped when the local theme is unknown rather than assuming the
worst.

Extensions always prompt for a reload. Themes only prompt when the new or previous theme ships JS
via `include`, since CSS-only changes apply live.

## Themes

A theme manifest points at a `user.css` and optionally a `color.ini` (`schemes`) and a list of JS
files (`include`).

### CSS

`parseCSS()` fetches the stylesheet and rewrites relative `url(...)` references to absolute ones
under the repo's `assets/` directory, because the CSS is injected into a page served from
`xpui.app.spotify.com` where relative paths resolve to nothing. Absolute and `data:` URLs are left
alone.

The rewrite is a single pass over the source. Rewriting occurrence-by-occurrence corrupts any
stylesheet that references the same relative path twice: after the first rewrite the search string
also matches inside the URL just written, so the second replacement lands in the middle of the
first, producing `.../assets/https://.../assets/img.png` and leaving the real second occurrence
untouched.

The result is injected as a `<style class="marketplaceCSS marketplaceUserCSS">` and Spicetify's own
`<link href="user.css">` is removed. Reverting re-adds the link.

### Colour schemes

`color.ini` is parsed into `{ schemeName: { key: hexValue } }`. `xrdb` lines are skipped, as are
comments, and inline `;` comments are trimmed off values.

`injectColourScheme()` turns the active scheme into a `:root` block of `--spice-{key}` and
`--spice-rgb-{key}` custom properties. Both the key and the value are validated:

- Keys must match `/^[\w-]+$/`. A key containing `}` closes the `:root` rule early and everything
  after it becomes a live CSS rule authored by whoever wrote the INI.
- Values must be 3- or 6-digit hex, with an optional leading `#` stripped.

Anything failing validation is skipped with a warning. This is deliberately per-entry: one bad
colour used to throw out of the whole function, leaving the theme with no colours at all.

Two optional dynamic modes exist, and they are mutually exclusive — album-art colours win:

- **Colour shift** cycles through the theme's schemes every 60 s. The interval is intentionally
  never cleared; toggling the setting reloads the page anyway.
- **Album-art colours** extract a colour from the current track via `Spicetify.colorExtractor`
  (which takes a Spotify URI, not an artwork URL) and expand it into a palette via
  `thecolorapi.com`. Keys sharing a colour in the original scheme are grouped so they keep sharing
  one, and groups are ordered by CIE lightness so the palette maps onto light and dark slots
  sensibly. Local files are skipped — Spotify has no artwork for them. An empty palette is
  discarded rather than injected, which would strip the theme's colours.

### Included JS

`include` scripts are injected as `<script>` tags, rewritten through jsDelivr where possible. A
malformed entry is skipped individually; aborting the loop would silently drop every remaining
script in the theme.

## Snippets

Snippets are raw CSS, either from the upstream catalogue or written by the user. All installed
snippets are concatenated into a single `<style class="marketplaceSnippets">`, each preceded by a
`/* title - description */` header.

`*/` inside a title or description is escaped. Otherwise it closes the header comment and the rest
of the "title" becomes live CSS — a snippet can then inject rules it did not declare.

Entries that are not objects with string `code` are skipped, because a snippet key can be listed as
installed while its payload is gone.

User snippets are stored with `custom: true`, which is what makes a card open the editable modal
rather than the read-only viewer.

## The tab bar

Marketplace's tabs are not rendered where they appear. `TopBarContent` renders a `<nav>` inside the
app and then physically moves that DOM node into Spotify's top bar.

Spotify re-renders its top bar on navigation and throws the node away. `attachAndKeepMounted()`
therefore keeps a `MutationObserver` on the container and re-attaches the node whenever it is
detached, coalescing re-attachment to one animation frame. It waits up to 15 s for a container to
exist and, failing that, leaves the tab bar inline rather than losing it entirely.

`TOP_BAR_SELECTORS` lists several selectors for the same reason as the scroll selectors: Spotify
renames them.

The overflow "More" dropdown measures each tab, then reserves space for the *largest* tab rather
than the last one, because any tab can end up being the one that overflows.

## Readme pages

Readmes are rendered by routing to `{CUSTOM_APP_PATH}/readme` with the card's data in history
state. Landing there without state (a direct navigation, a reload) redirects to the main page.

The markdown is not rendered locally. It is POSTed to `api.github.com/markdown` with
`mode: gfm` and the repo as context, and GitHub returns sanitised HTML which is inserted with
`dangerouslySetInnerHTML`. The sanitisation is GitHub's; nothing else scrubs it.

Two workarounds live here:

- Spotify's `<main>` needs its `overflow-y` poked to recompute the scrollbar after content loads.
  An interval does it once a second, and clears itself when the readme leaves the DOM or the
  component unmounts. It must be a single interval — creating one per update leaks them.
- Readme images use paths relative to the repo, which resolve against
  `xpui.app.spotify.com` and 404. An error handler rewrites them to the raw GitHub URL: absolute
  paths against the repo root, relative ones against the readme's directory.

## Settings, backup and dev tools

Closing the settings modal reloads the page. Several settings can only take effect at startup, so
rather than wiring live updates for each, the close button and the overlay are given `onclick`
handlers that reload. They are attached by querying the DOM directly during render because the
modal chrome is Spotify's, outside the React tree.

Opening the backup modal from settings waits for the settings modal to actually leave the DOM via a
`MutationObserver` before opening the next one — Spicetify only tracks one popup at a time. The
observer disconnects on first fire; otherwise several mutations each open a modal.

Backup export writes a JSON file via the File System Access API, falling back to the clipboard if
the picker is unavailable or fails. Cancelling a picker throws `AbortError`, which is not an error
condition and is swallowed. Import validates that the payload is a flat object of
`marketplace:`-prefixed string values before wiping and restoring.

Theme dev tools let you edit the active theme's `color.ini` in place. The "invalid CSS" panel takes
every selector in the injected user CSS and checks whether it matches anything in the document —
a rough way to find rules written against class names Spotify has since renamed.

## Localisation

i18n is initialised from `Spicetify.Locale.getLocale()`, not the embedded browser's locale; they
differ, and the Spotify UI language is the one the user chose. The lookup is wrapped because the
module is evaluated before Spicetify has finished populating its namespaces on a hard reload, and
`App` re-applies the locale after `waitForSpicetify()`.

`escapeValue` is off because React already escapes interpolated values.

## Security invariants

The app renders third-party manifests, CSS and README content. These are the rules that keep that
from turning into code execution. Do not relax them.

**URLs from manifests go through `sanitizeUrl()` before reaching an `href`.** It strips characters
outside `!`–`~` and ` `–`￿` before parsing, then allows only `http:`, `https:` and
`mailto:`. The stripping is the important half: browsers ignore tabs, newlines and control
characters when resolving a URL, so `java\tscript:alert(1)` is a working `javascript:` URL that a
naive `startsWith("javascript:")` check waves through. The sanitised string is what gets returned,
not the original, so nothing smuggles the stripped characters back in.

**Colour scheme keys and values are validated** before being interpolated into a `:root` block. See
[Colour schemes](#colour-schemes).

**Snippet titles and descriptions have `*/` escaped** before being interpolated into a CSS comment.
See [Snippets](#snippets).

**Style tags are populated with `textContent`, not `innerHTML`.** Equivalent for `<style>`, and it
removes the question of whether anything is being parsed as markup.

**Blacklist globs collapse repeated wildcards** before compiling to a regex.

Note what is *not* defended: theme CSS and snippet CSS are arbitrary CSS by design, `include`
scripts are arbitrary JS by design, and installed extensions are arbitrary JS by design. Installing
a theme or extension is a decision to run someone else's code. The invariants above are about
content that should *not* have been able to execute — author links, INI keys, comment headers.

## Cross-file invariants

Because the extension and the app are separate bundles that must agree:

- `initializeSnippets()` and `injectColourScheme()` are used by both. Changing the DOM shape they
  produce — class names, tag placement — breaks the other consumer.
- `injectUserCSS()` exists in `Utils.ts` and there is a near-duplicate code path in `Card.tsx`
  (`fetchAndInjectUserCSS`). They must stay compatible.
- Marker classes are load-bearing: `marketplaceCSS`, `marketplaceScheme`, `marketplaceUserCSS`,
  `marketplaceSnippets`, `marketplaceScript`. Injection removes the previous element by class
  before adding a new one, so renaming one leaks duplicate style tags.
- `Spicetify.Config.current_theme` and `color_scheme` are typed read-only but are written anyway,
  via `@ts-expect-error`. Other Spicetify code reads them to decide what is active.
- `data-card-type` on the grid container is consumed by CSS to render the "no installed X" empty
  state.
- `data-tag` on tag chips carries the *English* tag name so CSS can colour known tags regardless of
  the UI language.
- `src/types/spicetify.d.ts` is vendored from the Spicetify CLI repo and regenerated by
  `pnpm update-types`. Do not hand-edit it — including to strip comments.

## Known rough edges

Carried over from the TODOs that were in the source. None of these are bugs with a known
reproduction; they are places the original authors flagged as unfinished.

**Architecture**

- `Card` stores props on `this` via `Object.assign` *and* in `state` *and* reads storage live. Three
  sources of truth for the same data.
- `Grid` keeps `this.CONFIG` from the constructor, so a config update after mount does not reach it.
  Survivable only because the settings modal reloads the page on close.
- The install/remove/storage code in `Card` is four near-identical blocks that should collapse into
  a lookup.
- `CardItem` and `Snippet` each declare the other's fields as `undefined` so `Card` can accept
  either. They should be a discriminated union.
- `ThemeCardItem` is sketched in the types file but unused; theme-only fields are optional on
  `CardItem` instead.
- Card type branching (`type === "app" ? … : isInstalled ? … : …`) is repeated for the label, the
  icon and the handler.

**Behaviour**

- Sort options that make no sense for snippets (stars, dates) are still offered.
  [react-dropdown#176](https://github.com/fraserxu/react-dropdown/pull/176) would allow disabling
  individual options. Removing them for the snippets tab instead would reset the sort when
  switching tabs, which is worse.
- The colour scheme dropdown does not repopulate after installing a theme without a full reload.
- `parseCSS()` assumes assets live at `{cssUrl}/../assets/`.
- The asset base URL is recomputed on every parse rather than stored at install time.
- Search result sorting for repos with multiple manifests uses the repo's stars for every item.
- `getInvalidCSS()` reports selectors that do not currently match anything, which includes every
  rule for a UI state that simply is not on screen. Treat it as a hint.
- `exportMarketplace()` exports raw storage keys rather than a versioned document.
- `loadPage()` is named confusingly next to GitHub's own pagination.
- `appendInformationToLocalStorage()` in the preloader does not write anything itself; it warms the
  manifest cache as a side effect of fetching.

**Removed dead code**

Several blocks of commented-out code were deleted rather than documented, since git has them:
an alternative `React.createElement` spelling of `LoadingIcon`, a `do/while` sketch of the
preloader's pagination, an unused `extensionURL` for custom apps, and an example colour scheme in
the types file.
