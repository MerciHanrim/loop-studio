# PWA — install & offline (design, non-frozen)

**Status: design confirmed** (2026-08-29, after review) — the §P9 decisions are
settled and guide the implementation slices in §P10. No wire format, no
observable graph/engine semantics: it adds a `manifest.webmanifest` and a
service worker (SW) that precaches the built app shell, so an installed or
offline user runs the same static app. It changes nothing in
[`SEMANTICS.md`](../SEMANTICS.md), [`SEMANTICS-U.md`](../SEMANTICS-U.md), or
[`SEMANTICS-W.md`](../SEMANTICS-W.md), and it carries no `loop-*/N` id — this
file is still revised freely as the implementation lands.

Relevant facts about the app (they make PWA simple here):

- **Zero runtime network requests.** No `fetch()` anywhere in `src/`. Templates
  (`src/model/templates.ts`) and the Risky Factory example
  (`src/engine/risky-factory.fixture.ts`) are built in code, not loaded.
  Fonts are bundled (`@fontsource/*`, self-hosted, hashed assets). So the full
  app is precacheable and, after one load, needs the network for **nothing**.
- **The Monte-Carlo worker is a separate hashed chunk** —
  `dist/assets/mc.worker-<hash>.js`, loaded by a dynamic `import()` in the main
  bundle (the `?worker&inline` query is honoured only by the *portable*
  single-file build). It is precached (the `assets/*.js` glob) and referenced
  from the main JS, so the §P8.2 closure check tracks it (§P6).
- Build: `vite build` → `dist/` (`index.html` + hashed `assets/*`), deployed to
  Cloudflare Pages at `cozy-loop-studio.pages.dev`. `vite build --mode portable`
  → one self-contained `loop-studio.html` for `file://`.
- `__APP_VERSION__` / `__BUILD_SHA__` are already injected via vite `define`;
  `__SHARE_BASE_URL__` was added for `loop-share/1`. `__PWA_ENABLED__` and
  `__PWA_TEST_ORIGIN__` (empty outside the PWA-test build) fit the same pattern
  (§P7) — both are build-time defines, never `window` globals.

---

## P1. Install manifest

`public/manifest.webmanifest`, linked from `index.html`.

| field | value | note |
|---|---|---|
| `name` | `Loop Studio` | |
| `short_name` | `Loop Studio` | fits a home-screen label |
| `description` | `Design and simulate game-economy loop diagrams.` | |
| `id` | `/` | stable install identity across `start_url` changes |
| `start_url` | `/` | Pages root; **no** tracking query |
| `scope` | `/` | the whole origin is the app |
| `display` | `standalone` | app-like; `minimal-ui` is the fallback if a URL bar is wanted |
| `orientation` | *(omit)* | works at any size |
| `background_color` | `#f0efea` | `--surface-ground` (light); paints the launch splash |
| `theme_color` | `#f0efea` | matches the toolbar; also as a `<meta name="theme-color">` with a `prefers-color-scheme: dark` variant `#171a18` |
| `icons` | see below | committed PNGs in `public/icons/` |
| `shortcuts` | *(none for v1)* | "New graph" could be added later |
| `screenshots` | *(none for v1)* | nice for the install dialog; defer |

**Icons — the plain and the maskable image are separate files, not the same
image with two `purpose` values.** A maskable icon must keep all meaning inside
the ~80%-diameter safe zone (the OS clips the rest to a circle / squircle);
reusing the edge-to-edge logo with `purpose: "maskable"` gets the mark cropped.

| file | size | `purpose` | content |
|---|---|---|---|
| `icons/icon-192.png` | 192×192 | `"any"` | the Logo mark, edge-to-edge |
| `icons/icon-512.png` | 512×512 | `"any"` | same, full-bleed |
| `icons/icon-maskable-512.png` | 512×512 | `"maskable"` | a **separately composed** image — the mark scaled into the central safe zone on the `#f0efea` field, tested against the [maskable.app](https://maskable.app) presets |
| `icons/apple-touch-icon.png` | 180×180 | *(iOS, via `<link>`)* | opaque background, no transparency (iOS does not mask) |

`manifest.icons` lists all three of the first group as distinct entries
([MDN — manifest `icons`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)).

`index.html` also gains `<link rel="manifest">`, `<meta name="theme-color">`
(light + dark), and `<link rel="apple-touch-icon">` (iOS has no manifest icon
support). Installability needs: HTTPS ✓, manifest with name + icons + `display`
+ `start_url` ✓, a registered SW with a fetch handler ✓ (§P2).

---

## P2. Cache targets and version strategy

**Tooling — `vite-plugin-pwa` (Workbox), `generateSW` mode.** It reads the Vite
build and emits a precache manifest automatically, so the cache list can never
drift from the build. Hand-rolling the SW (as with the SHA / deflate fallbacks)
buys nothing here — the precache-and-activate lifecycle is exactly what Workbox
does well, and it is battle-tested. The plugin is added to `plugins` **only for
the Production and PWA-test builds** (`mode === 'pwa'` or
`CF_PAGES_BRANCH === 'main'` — §P7); a plain `npm run build` and the portable
build include it not at all, so they emit no `sw.js`, no `manifest.webmanifest`,
and no injected `<link rel="manifest">` (§P9 D8a, Slice-1 criterion 5).

**Precache — an explicit allow-list, not "whatever is in `dist/`":**

```js
// vite-plugin-pwa → workbox
{
  globDirectory: 'dist',
  globPatterns: [
    'index.html',
    'assets/*.{js,css}',        // hashed app chunks incl. the MC worker chunk
    'assets/*.{woff,woff2}',    // @fontsource — the CSS @font-face lists BOTH
    'manifest.webmanifest',
    'icons/*.png',
  ],
  globIgnores: ['**/*.map', '**/*.LICENSE.txt'],
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // largest chunk ≈ 700 KB today
  cleanupOutdatedCaches: true,  // NOT a default — Workbox keeps old precaches unless told
  navigateFallback: 'index.html',
}
```

Explicitly **excluded**: source maps (`*.map`), any `stats.html` / bundle
report, and anything outside `dist/` — Playwright's `test-results/` and
`playwright-report/` are never in `dist/` and so never match.

**Runtime caching** — none. There are no runtime requests to cache (§P3).

**Cache versioning** — Workbox writes one precache keyed to the build's revision
hashes; with `cleanupOutdatedCaches: true` it deletes precaches from earlier
revisions on `activate`. Because Vite content-hashes asset filenames, a new
deploy is a new precache manifest and a new generation. Scope of the guarantee
is in §P5 — narrowly, *a new navigation / reload never receives a mix of old
and new precached files.*

**Navigation handling** — `index.html` is precached and served for navigation
requests via a Workbox `NavigationRoute` (an app-shell fallback), so a deep
link like `…/#g1=…` resolves offline. Freshness comes from the SW update flow
(§P4), not from re-fetching HTML per load.

---

## P3. Offline-boot scope — from when the guarantee starts

**Offline boot is guaranteed from the point at which, after the first online
load, the service-worker `install` and its precache have completed
successfully** — not merely "after one visit". Until `onOfflineReady` (Workbox's
signal that the precache is populated), a reload offline may still fail. From
that point on the app boots and runs **fully offline** — no feature needs the
network:

- the editor (add / connect / edit / delete, undo-redo, autosave to
  `localStorage`);
- the deterministic engine and single-run timeline (step / play / reset);
- Engine B (seeded RNG, random flows, probabilistic gates);
- **Monte Carlo** — the worker is inlined and precached; the cooperative
  fallback is unaffected;
- state connections (`loop-state/1` + `/2`);
- Import / Export of Graph and Workspace files (OS file dialogs, no network);
- Templates and the Risky Factory example (in-code);
- **opening a share link** — the payload is in the URL; only the *shell* needs
  to be cached, which it is once the precache has completed.

**The one thing that still needs the network:** the first online load (until
`install` + precache finish), including a first-ever visit that lands on a share
link. After the precache completes, nothing.

Not cached, on purpose: the `localStorage` graph (already persistent,
per-origin), any share-link fragment (transient by design — `SEMANTICS-U.md`
§U4).

---

## P4. New-deploy detection and update UX

`registerType: 'prompt'`, `skipWaiting: false`, **`clientsClaim: false`** — the
SW never takes over clients on its own.

### P4.1 The update sequence (nothing automatic)

The store keeps the **waiting `ServiceWorker` object itself** (not just a flag),
so a Dismiss is scoped to that exact worker.

1. **Right after `register()`**, check `registration.waiting` — a SW that
   finished installing before this tab ran would otherwise be missed. If present
   (and there is a `navigator.serviceWorker.controller`, i.e. this is an
   *update*, not a first install), `markWaiting(worker)`.
2. A SW that installs later: on its `statechange` to `installed`, same check.
3. `markWaiting(worker)` — **same object ⇒ no change** (any Dismiss survives a
   visibility/hourly re-poll); a **different object ⇒ the bar shows afresh**
   (`dismissed` cleared). The bar renders while `waitingWorker != null &&
   waitingWorker !== dismissedWorker`.
4. **First install (no controller) shows nothing.**
5. **Only on the user's Update click:** re-read `registration.waiting`. If it is
   gone or no longer `installed`, resync (clear the bar) and do nothing else —
   no message, no reload. Otherwise register a **one-shot
   `controllerchange` listener FIRST**, *then* `postMessage({type:'SKIP_WAITING'})`
   to that worker.
6. On `controllerchange`, `window.location.reload()` **once** — the listener
   removes itself, so repeated events cause no further reload.
7. If the user never clicks Update, the new SW activates on the next cold start
   (all tabs closed), as browsers already do.

**No automatic `skipWaiting`. No automatic reload.** `clientsClaim: false` so a
just-activated SW does not seize control of an open tab.

Because the app issues **no lazy-chunk or runtime asset requests** (§P3), a
cold navigation loads exactly one generation of the shell. The guarantee is
scoped to that: **a new navigation or reload never receives a mixed set of
precached files.** It does *not* claim that two tabs open across an update run
the same generation — the older tab keeps its already-loaded generation until
it is itself reloaded.

### P4.2 The bar, and unsaved state

The **run state is not autosaved** — only the graph is. Applying an update
reloads the page, which resets the live simulation and drops a Monte-Carlo
result that was never exported. The bar says so:

> **A new version of Loop Studio is ready.**
> Applying it reloads the app and **resets the current run and any unsaved
> results.** Your diagram is saved.
> [ Update ] [ Dismiss ]

- **Update** — if a run is in progress (`sim` playing or `mc.status === 'running'`),
  a second `confirm` first (*"A run is in progress. Apply the update and reload
  anyway?"*). Otherwise proceed straight to P4.1 step 3.
- **Dismiss** — hides the bar **for this waiting worker only**. When the *next*
  deploy is detected (a new `waiting` SW), the bar shows again.

`onOfflineReady` → a one-time subtle toast *"Ready to work offline."*

**Update checks** — on registration, then `registration.update()` on
`visibilitychange` → visible, throttled to at most hourly. No Background Sync /
Periodic Sync for v1.

The bar is app state, not a route; it never touches `localStorage` or the graph.

---

## P5. Old cache ↔ new Graph / Workspace / Share formats

Two directions, both already safe because every format is `version`-tagged with
a defensive reader:

1. **Old shell, new-format input.** A user on a not-yet-updated shell opens a
   newer share link or imports a newer Workspace file. The old code runs its
   old readers: `deserialize` rejects an unknown `schema` with a message;
   `readWorkspace` falls back to graph-only on an unsupported `workspace.version`
   (`SEMANTICS-W.md` §W5); `classifyFragment` marks an unknown `g<n>=` as
   unsupported and strips it (`SEMANTICS-U.md` §U6). Nothing corrupts; the user
   is nudged by the §P4 update bar.
2. **New shell, old `localStorage` graph.** `normalizeGraph` / `normalizeNode`
   already backfill missing fields on load — an existing guarantee, unchanged by
   the SW.

Invariant the SW holds: **a fresh navigation / reload gets one consistent
generation of the shell.** Workbox populates the new precache during `install`
and only swaps to it on `activate` (which, with `skipWaiting: false`, is the
next cold start or an explicit Update); content-hashed filenames mean the new
`index.html` only ever references chunks from its own generation. This is *not*
a claim that every open tab runs the same generation across an update — an older
tab keeps its loaded generation until reloaded (§P4.1).

If a future format bump ever needs the *shell* itself gated (not just its
readers), that is a spec change in the relevant `SEMANTICS-*` doc, not a SW
concern.

---

## P6. Worker and portable-build boundaries

- **MC worker.** A separate hashed chunk (`assets/mc.worker-<hash>.js`),
  precached by the `assets/*.js` glob and referenced by a dynamic `import()` in
  the main bundle — the §P8.2 closure check verifies it is in the precache list.
  Worker viability on HTTP is unchanged by SW presence; `canUseWorkers()` and
  the cooperative fallback are untouched. The SW does not special-case worker
  scripts — it serves the chunk from the precache like any other asset.
- **Portable `file://` build.** `vite build --mode portable` **must not**
  include `vite-plugin-pwa` and **must not** register a SW or emit a manifest
  link (`file://` cannot host a SW, and there is nothing to cache — it is one
  file). The `pwa` flag in `vite.config.ts` is `!portable && (mode === 'pwa' ||
  CF_PAGES_BRANCH === 'main')`, and `main.tsx` calls `registerPwa()` only behind
  `if (__PWA_ENABLED__)` (compile-time `false` here → tree-shaken out).
  `e2e/portable-file.spec.ts` gains an assertion that
  `navigator.serviceWorker.controller === null` and `getRegistrations()` is
  empty (Slice 3).

---

## P7. Service worker on Cloudflare Preview

**Do not register the SW on Preview deploys, localhost, or `file://`.** Only the
canonical Production host. A `*.pages.dev` preview subdomain is a distinct
origin, so its cache cannot shadow Production — but registering on ephemeral
preview origins leaves stranded SWs and caches in a reviewer's browser for
hostnames that soon 404.

Registration needs **both** a build flag **and** a runtime-origin check — a
build flag alone is fragile (a Production artifact served from a preview URL, a
cached bundle on the wrong host).

**Build flag** (vite `define`, mirrors `__SHARE_BASE_URL__`). Driven by the
build **mode** (portable-safe, no cross-platform env-var prefix needed) and, on
CI, the Cloudflare branch:

```
// vite.config.ts — `pwa` is true for `vite build --mode pwa` and for the
// Cloudflare Production build; false for `npm run build`, dev, and portable.
const pwa = mode === 'pwa' || process.env.CF_PAGES_BRANCH === 'main'
__PWA_ENABLED__      = JSON.stringify(pwa)
__PWA_TEST_ORIGIN__  = JSON.stringify(pwa && mode === 'pwa' ? (process.env.PWA_TEST_ORIGIN ?? '') : '')
```

- `npm run build:pwa` → `tsc -b && vite build --mode pwa` (plugin on, flag true).
- `npm run build` → plugin off, flag false, no `sw.js` / manifest.
- `npm run build:portable` → `--mode portable`, plugin off.

**Runtime origin allow-list**, checked immediately before `registerSW()`:

```js
const ALLOWED_ORIGINS = ['https://cozy-loop-studio.pages.dev']
// __PWA_TEST_ORIGIN__ is a vite `define` CONSTANT — '' in every build except a
// `--mode pwa` build with PWA_TEST_ORIGIN=<preview origin> in the env. It is NOT
// read from a window global, so a Production bundle has no runtime hook to widen
// the list.
const ok = __PWA_ENABLED__ && (
  ALLOWED_ORIGINS.includes(location.origin) ||
  (__PWA_TEST_ORIGIN__ !== '' && location.origin === __PWA_TEST_ORIGIN__)
)
if (ok && import.meta.env.MODE !== 'portable' && 'serviceWorker' in navigator) registerSW()
```

- **`__PWA_TEST_ORIGIN__` is a build-time define, never a `window` global**
  (lock). In a Production build it inlines to `''`, so the second clause is
  statically dead code and there is no user-reachable way to add an origin at
  runtime. A `--mode pwa` build with `PWA_TEST_ORIGIN` set is the only artifact
  where it is non-empty.
- `localhost`, any `*-<hash>.cozy-loop-studio.pages.dev` **Preview** origin, and
  `file://` never register — even if the artifact contains the SW file.
- A **future custom domain** is added to `ALLOWED_ORIGINS` (source), nothing else.
- The `vite-plugin-pwa` plugin runs only in the **Production and PWA-test
  builds** (§P9 D8a): `sw.js` + `manifest.webmanifest` are emitted there and
  are testable; the portable build and a plain `npm run build` without the flag
  emit neither. The runtime registration call is additionally origin-gated.

---

## P8. Acceptance vectors — automated and manual

### P8.1 Automated (Playwright — as built)

`playwright.pwa.config.ts` → `e2e/pwa.spec.ts` (9 tests, `workers: 1`,
`fullyParallel: false`). The webServer is **`node e2e/support/pwa-serve.mjs`**,
which:

- up front builds **three independent generations** —
  `dist-pwa-a|b|c` with stamps `pwagenA|B|C`, each with
  `PWA_TEST_ORIGIN=http://localhost:4174` baked in;
- serves whichever one a test selected — `POST /__gen?to=a|b|c` switches;
- sends every response `cache-control: no-store` (so the browser HTTP cache
  never masks a generation switch);
- listens on all interfaces so **`http://localhost:4174`** (the *allowed*
  origin) and **`http://127.0.0.1:4174`** (a *non-allowed* origin) reach the
  same bytes.

**No test rebuilds anything.** Update tests just flip the generation and call
`registration.update()`, so they are safe under retries and independent of
order. Each test pins its starting generation (`setGen`) and gets a fresh
`BrowserContext` (clean SW + Cache Storage). Wired into the `e2e` CI job as
`npm run e2e:pwa`.

> Playwright cannot drive a real OS install. The **"installable" check verifies
> the *conditions*** — a linked `manifest.webmanifest` that parses with `name` /
> `display` / `id` / `start_url` / `scope` and 192 + 512 + maskable icons, and a
> registered SW — not `beforeinstallprompt`.

1. **installable + first-visit lifecycle** — manifest parses with the expected
   fields/icons; SW registers and reaches `activated`; the first-visit page is
   **not** controlled and shows **no** `.pwa-update` bar; one reload ⇒
   `controller.scriptURL` ends `/sw.js`, still no bar.
2. **cache == advertised precache** — after install, the single
   `workbox-precache-*` cache's contents (bare paths) equal `/sw.js`'s
   `precacheAndRoute` list exactly — includes `index.html`,
   `manifest.webmanifest`, and an `assets/mc.worker-*.js`.
3. **offline cold boot** — `setOffline(true)`, new page → app boots, add a Pool,
   Step → `step 1`.
4. **offline Monte Carlo** — `setOffline(true)`, new page → run a 40×12 MC → the
   `.dist` panel appears and the DISTRIBUTION tab is active: the **precached
   `mc.worker-*.js` chunk runs a real distribution offline**.
5. **offline `#g1=` deep link** — build a distinctive graph, Share (clipboard
   stubbed), `setOffline(true)`, `goto('/#g1=<payload>')` → the graph loads from
   cache, `location.hash === ''`.
6. **registration gate (real browser)** — open the PWA build from
   **`http://127.0.0.1:4174`**: the `<link rel="manifest">` is present, but
   `getRegistrations()` stays empty and `controller` is `null` — the origin is
   not the baked one. (Plus `isRegistrationAllowed()` unit-tested for the
   Production host / a Preview subdomain / `localhost` / `"null"`.)
7. **update — nothing automatic** — from gen A, switch to gen B + `update()` ⇒
   the bar; a page sentinel survives (no reload), the stamp is unchanged;
   **Dismiss** hides it and a re-`update()` of the *same* worker keeps it
   hidden; switching to gen C + `update()` re-shows the bar (a new worker).
8. **update apply — one reload, clean generation** — **Update** → one `load`
   event → `controller` back; the sentinel is gone (reloaded once); the single
   cache's contents equal gen C's advertised precache; every **rotated** hashed
   chunk from gen A (the stamped `index-*.js`) is absent; the build stamp reads
   `pwagenC`.
9. **update with a run in progress** — Play, then **Update** → the extra
   `confirm` (`/run is in progress/i`); **cancel** ⇒ sentinel survives, the run
   is still `Pause`-state, the stamp is unchanged.

**Portable** — `e2e/portable-file.spec.ts` asserts no SW registration / no
controller / no `<link rel="manifest">` on the `file://` build (§P6).

### P8.2 Build-time checks — precache closure, and the inverse (run in `checks`)

Node scripts (not browser tests). They run against **dedicated build outputs**,
because the PWA plugin's presence itself differs by build (§P9 D8a).

**(a) Precache reference closure — against the PWA build only.**

Run `npm run build:pwa` (a `--mode pwa` build with the PWA plugin on — a plain
`npm run build` has **no** `sw.js` and is not a valid target for this check),
then walk the whole local reference graph:

```
index.html
  → <script src>, <link href> (stylesheet / manifest / icon / apple-touch-icon),
    <link rel="modulepreload">, shell <img src>
  → each referenced CSS file
      → every url(...) inside it  →  .woff / .woff2 / images
  → each referenced JS file
      → "assets/…" / "icons/…" string refs  →  the dynamic-import MC worker
        chunk, any lazy chunk
  → manifest.webmanifest
      → every icons[].src
```

For **every local URL** discovered (resolve relative to its referrer; **skip**
absolute `//` / `http(s)://` URLs, `data:`, and `blob:`), assert it exists in
**both**:

- the Workbox precache list baked into `sw.js` (`precacheAndRoute([…])` /
  `__WB_MANIFEST`), and
- the actual output tree on disk.

`sw.js` and `workbox-*.js` are the service worker itself and are exempt from the
"must be precached" rule. Reading only `index.html` + the manifest would miss a
font or image referenced only from inside a bundled CSS file (that is exactly
how this check first caught the `.woff` fallbacks) or the MC worker chunk
referenced only from JS — hence the CSS `url(...)` and JS string-ref steps. Any
reference the `globPatterns` do not pick up fails the build instead of breaking
offline silently.

**Both PWA build paths are checked** — the `--mode pwa` test build
(`dist-pwa/`) *and* the Cloudflare Production shape
(`CF_PAGES_BRANCH=main npm run build` → `dist/`), so the plugin is proven to
activate on the real deploy path, not just the test flag.

**(b) The inverse — the non-PWA outputs carry nothing PWA.**

Against `npm run build` (plain) **and** `npm run build:portable`:

- no `sw.js` / `workbox-*.js` in the output;
- no `manifest.webmanifest`;
- no `<link rel="manifest">` in the HTML;
- no `registerSW` / service-worker-registration code string in the emitted JS.

As built, in the `checks` CI job (`scripts/check-{no-pwa,pwa-closure}.mjs`):

```
npm run build && npm run build:portable && npm run check:no-pwa   # (b)
npm run build:pwa && npm run check:pwa-closure                    # (a), dist-pwa/
CF_PAGES_BRANCH=main npm run build && node scripts/check-pwa-closure.mjs dist   # (a), Production shape
```

### P8.3 Manual, real device (checklist — not automated)

Lighthouse's **PWA category was removed** (Lighthouse 12; PageSpeed Insights
from Lighthouse 13), so it is **not** a release gate. Instead:

- **Chrome DevTools → Application → Manifest**: no errors or warnings; icons
  render.
- **Application → Service Workers**: the SW is `activated`, its **scope** is
  `/`, and the page shows as **controlled** by it.
- Install through the **browser's own install UI** (omnibox / menu) on desktop
  Chrome / Edge and on Android Chrome; the icon + name are correct.
- Launch the installed app **standalone** on desktop and Android — no URL bar,
  correct splash (`background_color` + icon).
- **iOS Safari → Add to Home Screen** → the app launches standalone
  (`apple-touch-icon` + `apple-mobile-web-app-*` metas; no `beforeinstallprompt`
  on iOS).
- **Airplane mode**: fully quit and cold-launch the installed app — it boots and
  the last diagram loads.
- **After a real redeploy**: the update bar appears in a running instance;
  **Update** → the app reloads and the visible **build stamp changes** to the
  new SHA.

---

## P9. Decisions — resolved (after review)

| # | decision |
|---|---|
| **D1** | manifest per §P1: `Loop Studio`; `id`/`start_url`/`scope` = `/`; `display: standalone`; `#f0efea` (+ dark `#171a18` meta). Icons: **plain 192 + plain 512 (`purpose: "any"`) and a *separately composed* maskable 512 with a real safe zone** — listed as distinct entries — plus a 180 `apple-touch-icon`. |
| **D2** | SW via **`vite-plugin-pwa` `generateSW`** (Workbox), not hand-rolled; plugin excluded from the portable build. |
| **D3** | **Explicit precache allow-list** (§P2): `index.html`, `assets/*.{js,css,woff2}`, `manifest.webmanifest`, `icons/*.png`, `favicon.ico`. `globIgnores` drops `*.map`; `maximumFileSizeToCacheInBytes: 3 MiB`; **`cleanupOutdatedCaches: true`** (explicit — not a Workbox default). No runtime caching. |
| **D4** | Navigations served from the precached `index.html` (`navigateFallback`); freshness via the §P4 update flow. |
| **D5** | `registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`. New SW stays **`waiting`**; on **Update** click → post `SKIP_WAITING` → await `controllerchange` → one `reload()`. **No auto `skipWaiting`, no auto reload.** Checks on `visibilitychange` + hourly. |
| **D5a** | The update bar carries a **data-loss line** ("resets the current run and any unsaved results; your diagram is saved"). **Update** with a run in progress asks once more. **Dismiss** applies to the current waiting worker only; the next deploy re-shows the bar. |
| **D6** | Format compat is the app readers' job (versioned, defensive). SW scope: **a fresh navigation / reload gets one consistent shell generation** — *not* a claim about multiple tabs open across an update. |
| **D7** | MC worker is inlined ⇒ **no SW ↔ worker interaction**; portable build registers no SW and emits no manifest link (`MODE !== 'portable'`). |
| **D8** | Registration needs **both** the `__PWA_ENABLED__` build flag **and** a runtime `location.origin` allow-list check (`https://cozy-loop-studio.pages.dev`, plus the build-define `__PWA_TEST_ORIGIN__` — empty outside the PWA-test build, **not** a `window` global). Preview / localhost / `file://` never register even if the artifact ships the SW. Custom domains join the allow-list later. |
| **D8a** | The `vite-plugin-pwa` plugin (hence `sw.js` + `manifest.webmanifest` + the injected `<link rel="manifest">`) is present **only** in the Production build and the PWA-test build (`--mode pwa` / CF `main`). A plain `npm run build` and the portable build emit **none** of them — asserted by §P8.2(b). `__PWA_TEST_ORIGIN__` is a build define (`''` outside a `--mode pwa` build with `PWA_TEST_ORIGIN` set), never a `window` global. |
| **D9** | Automated: the `pwa` Playwright project per §P8.1 (installable-**conditions**, offline-ready gate, offline boot, offline deep link, no-auto-update, update-apply + build-stamp, update-with-run confirm, no-stale-mix, portable-no-SW, origin-gate) **plus the §P8.2 build checks in `checks`** — (a) precache reference-closure over `index.html → JS/CSS/icon/manifest → CSS url(…) → font/image` against the **`build:pwa`** output, local refs only (`data:` / `blob:` / external skipped), each present in both `sw.js`'s precache list and `dist/`; (b) the inverse — plain `build` and `build:portable` emit no `sw.js` / manifest / manifest-link / registration code. **Lighthouse PWA is not a gate** (category removed). Manual checklist per §P8.3. Playwright "install" = condition checks, not OS install automation. |
| **D10** | PWA ships inside **`v0.4.0`** (with Workspace Export + Shareable URL); the tag waits for it. |

---

## P10. Implementation slices

1. **✅ (landed) manifest object + icons + `index.html` head + build flags.**
   `scripts/gen-icons.mjs` (pure-Node rasteriser + PNG encoder) → committed
   `public/icons/` (plain 192 / 512 `any`, a **separately composed** maskable
   512, an opaque `apple-touch-icon` 180). `src/pwa/manifest.ts` — the manifest
   as a source object (`id`/`start_url`/`scope` = `/`), unit-tested. `index.html`
   gains light/dark `theme-color` + `apple-touch-icon` + iOS `apple-mobile-*`
   metas (harmless in every build). `vite.config.ts`: `__PWA_ENABLED__` /
   `__PWA_TEST_ORIGIN__` defines (§P7); `--mode pwa` builds to `dist-pwa/`
   (Production still emits `dist/`). `checks` CI: `check:icons` (§P9 D1 criteria)
   + `check:no-pwa` (§P8.2(b) — `dist/` and `dist-portable/` carry no
   `sw.js` / manifest / manifest-link / registration code). **No SW, no plugin
   yet.**
2. **✅ (landed) `vite-plugin-pwa` + registration + `.pwa-update` bar + the
   closure checks.** `VitePWA({ registerType:'prompt', injectRegister:false,
   manifest, includeManifestIcons:false, workbox:{ globPatterns, globIgnores,
   maximumFileSizeToCacheInBytes:3MiB, cleanupOutdatedCaches:true,
   navigateFallback:'index.html', skipWaiting:false, clientsClaim:false } })`,
   in `plugins` only when `pwa` (`!portable && (mode==='pwa' || CF main)`).
   `src/pwa/register-sw.ts` — origin-allow-list gate, then `register('sw.js')`,
   then `wireRegistration(reg, navigator.serviceWorker, store)` (pure of
   `navigator` lookups → unit-testable). The **waiting-worker boundary** (§P4.1):
   `registration.waiting` checked right after register; the store holds the
   waiting `ServiceWorker` object so `markWaiting(same)` keeps a Dismiss and
   only `markWaiting(different)` clears it; no controller ⇒ no bar; on Update
   the `controllerchange` one-shot is registered **before** `postMessage`, a
   vanished/moved worker resyncs with no message/reload, and repeated
   `controllerchange` reloads exactly once. `src/pwa/register-sw.test.ts` (10)
   covers the 7 boundary cases + `decideUpdate`. `main.tsx`:
   `if (__PWA_ENABLED__) import('./pwa/register-sw')` (tree-shaken elsewhere).
   `src/components/PwaUpdateBar.tsx` — renders while `waitingWorker != null &&
   waitingWorker !== dismissedWorker`; the data-loss line; `decideUpdate`
   gates a run-in-progress `confirm`.
   `scripts/check-pwa-closure.mjs` (§P8.2a) in `checks`, run against **both**
   `dist-pwa/` and the `CF_PAGES_BRANCH=main npm run build → dist/` shape.
3. **✅ (landed) the `pwa` E2E project** — `playwright.pwa.config.ts` →
   `e2e/pwa.spec.ts` (9 tests, §P8.1), backed by `e2e/support/pwa-serve.mjs`
   which pre-builds three generations (`dist-pwa-a|b|c`, stamps `pwagenA|B|C`)
   and switches which it serves on `POST /__gen?to=` — **no test rebuilds**, so
   the update tests are retry-safe. Covers: installable + first-visit
   lifecycle; cache == advertised precache; offline cold boot; **offline Monte
   Carlo** (the precached worker chunk); offline `#g1=` link; the **real-browser
   registration gate** (`127.0.0.1` origin ⇒ no SW despite the manifest); and
   the update lifecycle (bar / no-auto-reload / per-worker Dismiss / new-gen
   re-show / Update→one-reload→clean-generation→stamp / run-in-progress
   confirm). `register-sw.ts` gains `isRegistrationAllowed()` (also unit-tested).
   `e2e/portable-file.spec.ts` asserts the `file://` build has no SW / no
   controller / no manifest link. `npm run e2e:pwa` in the `e2e` CI job. The
   §P8.2 manual checklist is a one-time real-device run at the release
   checkpoint.
