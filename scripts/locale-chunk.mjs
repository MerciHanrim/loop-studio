// docs/localization.md §L4.5 / docs/pwa.md §P8 — the ONE pattern that both the
// Workbox `runtimeCaching` rule (vite.config.ts) and the precache-closure check
// (check-pwa-closure.mjs) use to recognise a lazily-loaded locale chunk.
//
// A per-locale UI catalog is emitted as `assets/locale-<code>-<hash>.js` and a
// per-locale template-label dict as `assets/tmpl-labels-<code>-<hash>.js`
// (chunk names are pinned in vite.config.ts). `<code>` is a BCP-47 tag that may
// carry a script subtag with an uppercase letter (`zh-Hans`, `zh-Hant`), so the
// locale segment allows `[A-Za-z0-9-]`.
//
// The `(?:^|\/)` prefix lets the SAME regex match a bare pathname
// (`assets/locale-ko-abc.js`, from the closure check walking sw.js) AND a full
// request URL (`https://host/assets/locale-ko-abc.js`, what Workbox tests a
// `runtimeCaching.urlPattern` RegExp against). It is passed to Workbox as the
// RegExp itself — never wrapped in a callback, which `generateSW` cannot
// serialise with an external reference intact.
export const LOCALE_CHUNK_RE =
  /(?:^|\/)assets\/(?:locale|tmpl-labels)-[A-Za-z0-9-]+-[A-Za-z0-9_-]+\.js$/

// issue #625 item 4 — which response to such a URL the runtime cache keeps: a 200
// served as JavaScript, nothing else. The host answers a file it does not have
// with the app's HTML page and a 200 (measured on the production site,
// 2026-11-27), so a status check alone kept that page as the chunk, and
// CacheFirst served it for that URL from then on. Workbox's `cacheWillUpdate`
// plugin hook: the response to keep, or null to keep nothing.
//
// It is passed to Workbox as this function itself; `generateSW` writes its text
// into `sw.js`, so it must not refer to anything outside its own body.
export async function localeChunkCacheWillUpdate({ response }) {
  if (!response || response.status !== 200) return null
  const type = response.headers.get('content-type') || ''
  return /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)\b/i.test(type) ? response : null
}
