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
