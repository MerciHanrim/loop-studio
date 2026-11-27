// Type declaration for locale-chunk.mjs (a plain-ESM module so the check
// scripts can `import` it under bare `node`, and vite.config.ts can share it).
export const LOCALE_CHUNK_RE: RegExp
/** issue #625 item 4 — the locale-chunk runtime cache, and its name before #625 */
export const LOCALE_CHUNK_CACHE: string
export const LOCALE_CHUNK_CACHE_BEFORE_625: string
/** issue #625 item 4 — Workbox `cacheWillUpdate`: keep a 200 served as JavaScript, else null */
export function localeChunkCacheWillUpdate(param: { response?: Response | null }): Promise<Response | null>
