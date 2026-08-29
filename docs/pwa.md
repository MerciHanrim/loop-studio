# PWA — install & offline (design draft, non-frozen)

**Status: design draft.** No wire format, no observable graph/engine semantics.
It adds a `manifest.webmanifest` and a service worker (SW) that precaches the
built app shell, so an installed or offline user runs the same static app. It
changes nothing in [`SEMANTICS.md`](../SEMANTICS.md),
[`SEMANTICS-U.md`](../SEMANTICS-U.md), or [`SEMANTICS-W.md`](../SEMANTICS-W.md),
and it carries no `loop-*/N` id — this file is revised freely as the work lands.

This draft exists to settle the eight decisions in §P9 before the
implementation PR.

Relevant facts about the app (they make PWA simple here):

- **Zero runtime network requests.** No `fetch()` anywhere in `src/`. Templates
  (`src/model/templates.ts`) and the Risky Factory example
  (`src/engine/risky-factory.fixture.ts`) are built in code, not loaded.
  Fonts are bundled (`@fontsource/*`, self-hosted, hashed assets). So the full
  app is precacheable and, after one load, needs the network for **nothing**.
- **The Monte-Carlo worker is inlined** — `mc.worker.ts?worker&inline` becomes a
  blob URL inside the main JS bundle. There is no separate worker file for the
  SW to serve (§P6).
- Build: `vite build` → `dist/` (`index.html` + hashed `assets/*`), deployed to
  Cloudflare Pages at `cozy-loop-studio.pages.dev`. `vite build --mode portable`
  → one self-contained `loop-studio.html` for `file://`.
- `__APP_VERSION__` / `__BUILD_SHA__` are already injected via vite `define`;
  `__SHARE_BASE_URL__` was added for `loop-share/1`. A `__PWA_ENABLED__` flag
  fits the same pattern (§P7).

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
| `icons` | `192×192`, `512×512` (`purpose: "any"`) + `512×512` (`purpose: "maskable"`) PNG | generated from `src/components/Logo` (the existing SVG mark) into `public/icons/` at build time or committed |
| `shortcuts` | *(none for v1)* | "New graph" could be added later |
| `screenshots` | *(none for v1)* | nice for the install dialog; defer |

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
does well, and it is battle-tested. The plugin is added to `plugins` only when
**not** the portable build (same gate as `viteSingleFile`).

**Precache** — everything `dist/` emits:

- `index.html`
- every hashed `assets/*.js` / `assets/*.css` (includes the inlined MC worker)
- every bundled font (`assets/*.woff2`)
- `manifest.webmanifest`, `icons/*`, `favicon`

Total is ~700 KB (\~286 KB gzipped) — small enough to precache whole.

**Runtime caching** — none. There are no runtime requests to cache.

**Cache versioning** — Workbox names the precache with a build-derived revision
and, on `activate`, deletes any cache that is not the current one. Because Vite
content-hashes asset filenames, a new deploy is a new precache manifest and a
new cache generation; old generations are removed once the new SW activates. A
stale chunk is therefore never served next to a new `index.html` (§P5).

**Navigation handling** — `index.html` is precached and served for navigation
requests via a Workbox `NavigationRoute` (an app-shell fallback), so a deep
link like `…/#g1=…` resolves offline. Freshness comes from the SW update flow
(§P4), not from re-fetching HTML per load.

---

## P3. Offline-boot scope after the first visit

After one successful online load (SW installed, precache complete), the app
boots and runs **fully offline** — there is no feature that needs the network:

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
  to be cached, which it is after the first visit.

**The one thing that still needs the network:** the very first visit to any URL
on the origin (including a first-ever visit that lands on a share link) — to
fetch the shell. After that, nothing.

Not cached, on purpose: the `localStorage` graph (already persistent,
per-origin), any share-link fragment (transient by design — `SEMANTICS-U.md`
§U4).

---

## P4. New-deploy detection and update UX

`registerType: 'prompt'`. The SW installs a new version in the background and
**waits**; it never `skipWaiting()`s mid-session, so an open diagram is never
swapped under the user.

- `onNeedRefresh` → render a small dismissible bar (toolbar-styled, e.g.
  `.pwa-update`): *"A new version of Loop Studio is ready. Reload to update."*
  with **Reload** and **Later**.
  - **Reload** → `updateSW(true)` (message the waiting SW to `skipWaiting`, then
    `window.location.reload()`).
  - **Later** → dismiss; the update applies on the next cold start regardless.
- `onOfflineReady` → a one-time subtle toast *"Ready to work offline."*
- **Update checks** — on initial registration, plus `registration.update()` on
  `visibilitychange` → visible and at most hourly (a throttled timer). No
  Background Sync / periodic-sync API for v1.

The bar is app state, not a route; it does not touch `localStorage` or the
graph.

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

Invariant to hold in the SW: **the shell is always internally consistent.**
Workbox installs the new precache atomically and activates only when every
entry is stored, so a user is always on one whole build — at worst one deploy
behind until they accept the update. Asset-hash rotation guarantees an old
chunk is never mixed with a new `index.html`.

If a future format bump ever needs the *shell* itself gated (not just its
readers), that is a spec change in the relevant `SEMANTICS-*` doc, not a SW
concern.

---

## P6. Worker and portable-build boundaries

- **MC worker.** Inlined into the main bundle (`?worker&inline` → blob URL), so
  the SW never intercepts a worker script — it is bytes inside a precached
  `assets/*.js`. Worker viability on HTTP is unchanged by SW presence;
  `canUseWorkers()` and the cooperative fallback are untouched. A blob-URL
  worker is same-origin and not subject to SW `fetch` interception anyway.
- **Portable `file://` build.** `vite build --mode portable` **must not**
  include `vite-plugin-pwa` and **must not** register a SW or emit a manifest
  link (`file://` cannot host a SW, and there is nothing to cache — it is one
  file). Registration is gated `if (import.meta.env.MODE !== 'portable' && __PWA_ENABLED__ && 'serviceWorker' in navigator)`.
  `e2e/portable-file.spec.ts` gains an assertion that
  `navigator.serviceWorker.controller === null` and `getRegistrations()` is
  empty.

---

## P7. Service worker on Cloudflare Preview

**Do not register the SW on Preview deploys, localhost, or `file://`.** Only the
canonical Production host. A `*.pages.dev` preview subdomain is a distinct
origin, so its cache cannot shadow Production — but registering on ephemeral
preview origins leaves stranded SWs and caches in a reviewer's browser for
hostnames that soon 404.

Gate with a build flag, mirroring `__SHARE_BASE_URL__`:

```
__PWA_ENABLED__ = JSON.stringify(
  process.env.VITE_PWA === '1' ||
  (process.env.CF_PAGES === '1' && process.env.CF_PAGES_BRANCH === 'main')
)
```

- Production build (`CF_PAGES_BRANCH === 'main'`) → `true`.
- Preview builds, `npm run dev`, `vite preview` without the flag → `false`.
- The PWA E2E project builds with `VITE_PWA=1` explicitly (§P8).

The `vite-plugin-pwa` plugin can still run in every non-portable build (so the
SW file and manifest are emitted and testable); only the **runtime
registration** is flag-gated.

---

## P8. E2E and real-device verification scope

**Automated (Playwright, Chromium — full SW support).** A new `pwa` project:
`vite build` with `VITE_PWA=1`, served by `vite preview`, then:

1. **install + offline-ready** — first load registers the SW; `onOfflineReady`
   fires; `navigator.serviceWorker.controller` becomes non-null.
2. **offline boot** — `context.setOffline(true)`, reload → app boots, the
   `localStorage` graph loads, add-node / Step / Reset work, a small Monte-Carlo
   run completes.
3. **offline deep link** — `setOffline(true)`, navigate to `/#g1=<payload>` →
   the shared graph loads (shell from cache, payload from the URL).
4. **update prompt** — rebuild with a changed asset (or stub a waiting SW);
   reload → the `.pwa-update` bar appears; **Later** keeps the session; **Reload**
   activates the new shell; a cold start also picks it up.
5. **no stale mix** — after an update, assert only the current precache cache
   name exists.
6. **portable** — the `portable` project asserts no SW registration / no
   controller (§P6).
7. **preview gate** — a build **without** `VITE_PWA=1` does not register (assert
   `getRegistrations()` empty).

**Manual, real device (checklist, not automated):**

- install on Android Chrome and on desktop Chrome / Edge; the icon + name +
  splash render;
- airplane-mode cold start of the installed app;
- Lighthouse **Installable** + **PWA optimized** pass on `cozy-loop-studio.pages.dev`;
- a real redeploy shows the update bar; accepting it serves the new build;
- iOS Safari **Add to Home Screen** → standalone boot works (no
  `beforeinstallprompt`; `apple-touch-icon` + `apple-mobile-web-app-*` metas).

---

## P9. Decisions to settle (this draft's purpose)

| # | decision | recommendation |
|---|---|---|
| **D1** | manifest: `name` / `short_name` `Loop Studio`; `id` + `start_url` + `scope` = `/`; `display: standalone`; `background`/`theme` `#f0efea` (+ dark `#171a18` meta); icons 192 / 512 / 512-maskable PNG from the Logo mark | as tabled in §P1 |
| **D2** | SW via **`vite-plugin-pwa` `generateSW`** (Workbox), not hand-rolled; plugin only in non-portable builds | adopt |
| **D3** | **precache the whole `dist/`** (shell + hashed assets + fonts + icons); **no runtime caching**; Workbox build-revision cache name, old generations dropped on activate | adopt |
| **D4** | navigations served from the precached `index.html` (app-shell); freshness via the update flow, not per-load HTML re-fetch | adopt |
| **D5** | `registerType: 'prompt'`; dismissible `.pwa-update` bar; **never** auto-`skipWaiting` mid-session; update checks on `visibilitychange` + hourly | adopt |
| **D6** | format compat is already handled by the versioned defensive readers; the SW's only job is to keep the **shell atomic and single-generation** | adopt; no new code beyond the atomic precache |
| **D7** | MC worker is inlined → **no SW ↔ worker interaction**; portable build registers **no** SW (gated on `MODE !== 'portable'`) | adopt |
| **D8** | **register only on the Production host**, gated by `__PWA_ENABLED__` (`VITE_PWA=1` or `CF_PAGES_BRANCH === 'main'`); Preview / localhost / `file://` do not register | adopt |
| **D9** | E2E: a `pwa` Playwright project (build with `VITE_PWA=1` + `vite preview`) covering install / offline boot / offline deep link / update prompt / no-stale-mix / portable-no-SW / preview-gate; real-device checklist for install + Lighthouse + iOS | adopt |
| **D10** | roadmap / version: PWA ships inside **`v0.4.0`** (with Workspace Export + Shareable URL); the `v0.4.0` tag waits for it | confirmed earlier |

---

## P10. Implementation slices (once §P9 is settled)

1. **manifest + icons + `index.html` head + `__PWA_ENABLED__`** — installable
   metadata, no SW yet.
2. **`vite-plugin-pwa` + flag-gated registration + the `.pwa-update` bar** — the
   offline shell and the update UX.
3. **the `pwa` E2E project + portable no-SW assertion + the real-device
   checklist run.**
