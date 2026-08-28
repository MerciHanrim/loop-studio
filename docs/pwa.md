# PWA — install & offline (non-frozen)

**Status: notes, not a frozen spec.** The offline-install track (roadmap:
"shareable URLs, offline PWA") has **no wire format and no observable
semantics** — it is a `manifest.webmanifest` plus a service worker that
precaches the built app shell so an installed or offline user runs the same
static app. It changes nothing in [`SEMANTICS-U.md`](../SEMANTICS-U.md), the
graph / engine specs, or [`SEMANTICS-W.md`](../SEMANTICS-W.md). This file may be
revised freely as the implementation lands; it carries no `loop-*/N` id.

## Scope to pin when implemented

- **Precache** — the Vite build's static output only (HTML, JS, CSS, icons,
  fonts if self-hosted). **Not** cached:
  - the `localStorage` graph — already persistent and per-origin;
  - any share-link fragment — transient by design (`SEMANTICS-U.md` §U4/§U5.5);
  - Google Fonts, if used from the CDN — let the browser HTTP-cache them.
- **Update strategy** — when a new build is detected, **prompt the user to
  reload** rather than calling `skipWaiting()` mid-session, so an open diagram
  is never swapped under the user. The prompt is dismissible; the update applies
  on the next natural load regardless.
- **Offline scope** — the app runs fully offline (it is client-only). The one
  exception: *opening a share link* still needs the network the first time, to
  fetch the shell if it is not yet cached.
- **Portable build** — the `file://` single-file build neither needs nor
  registers a service worker; the PWA layer is hosted-build only.

## Verification checklist (roadmap step 4)

- Install prompt appears on the hosted build (Chromium desktop + Android).
- Second visit works with the network disabled (airplane mode / DevTools
  offline): app boots, the last `localStorage` graph loads, editing + run +
  Monte-Carlo all work.
- A new deploy triggers the reload prompt, not a silent swap; declining keeps
  the session; accepting (or a later cold start) serves the new build.
- Lighthouse "Installable" + "PWA optimized" pass on the deployed site.
- The portable `file://` build is unaffected (no SW registration, no manifest
  fetch errors).
