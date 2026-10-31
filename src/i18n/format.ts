// docs/localization.md §L4.1 / §L4.4 — the `intl-messageformat` (FormatJS)
// wrapper. Full ICU syntax; the compiled formatter is cached keyed by
// `(locale, key, message)` so a re-render never re-parses.
//
// `tryFormat` NEVER throws and NEVER returns a raw ICU pattern: on any failure —
// a bad pattern (which CI §L12 #1 rejects, so it should not ship) OR a missing /
// wrong-kind runtime parameter (which CI cannot see) — it returns `null` so the
// caller can fall back (active message → `en` message → a generic localised
// notice, §L4.4). A dev-only warning names the key + locale + error; it never
// logs the raw message or the parameter values (§L4.4 rule 6).

import IntlMessageFormat from 'intl-messageformat'

export type FormatParams = Record<string, string | number> | undefined

// The cache key's separator is an ordinary SPACE (#424: it was named `NUL`,
// which it never was). Neither a locale code nor a catalog key contains a
// space, so the first two spaces still split the key unambiguously.
const SPACE = ' '
const cache = new Map<string, IntlMessageFormat>()

function compiled(locale: string, key: string, message: string): IntlMessageFormat {
  const ck = locale + SPACE + key + SPACE + message
  let f = cache.get(ck)
  if (!f) {
    f = new IntlMessageFormat(message, locale)
    cache.set(ck, f)
  }
  return f
}

/** Format one ICU message, or return `null` if it cannot be formatted for ANY
 *  reason (never throws, never leaks the pattern). */
export function tryFormat(
  locale: string,
  key: string,
  message: string,
  params?: FormatParams,
): string | null {
  try {
    const out = compiled(locale, key, message).format(params as never)
    return typeof out === 'string' ? out : String(out)
  } catch (err) {
    if (import.meta.env.DEV) {
      // key + locale + the error CLASS only — never `err.message` (FormatJS
      // embeds the raw pattern in it), never the params (§L4.4 rule 6)
      const cls = (err as { name?: string })?.name ?? 'Error'
      console.warn(`[i18n] could not format "${key}" (${locale}): ${cls}`)
    }
    return null
  }
}

/** test / probe hook */
export function __formatCacheSize(): number {
  return cache.size
}
