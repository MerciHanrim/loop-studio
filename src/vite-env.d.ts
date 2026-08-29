/// <reference types="vite/client" />

/** Injected by `vite.config.ts` `define` at build time. */
declare const __APP_VERSION__: string
/** Short commit SHA of the build (CF Pages / GitHub Actions / local git), or '' when unknown. */
declare const __BUILD_SHA__: string
/** Fixed public base a Share link is built on (default the Cloudflare Pages URL);
 *  overridable per deploy with `VITE_SHARE_BASE_URL`. */
declare const __SHARE_BASE_URL__: string
/** `true` only in the Production / `--mode pwa` build — gates SW registration. */
declare const __PWA_ENABLED__: boolean
/** Extra allowed origin for the PWA E2E build; `''` (and dead code) everywhere else. */
declare const __PWA_TEST_ORIGIN__: string
