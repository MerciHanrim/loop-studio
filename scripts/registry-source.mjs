// The one place a build-time checker reads `src/i18n/registry.ts`.
//
// WHY A MODULE AND NOT A REGEX PER CHECKER
//
// A checker cannot `import` the registry: it is TypeScript and it reads
// `import.meta.env.DEV`, so Node would need a transform and a Vite env that a
// plain `node scripts/*.mjs` does not have. So the checkers read the SOURCE.
// That is fine — as long as a parse that finds nothing is an ERROR.
//
// It was not. `check-template-labels.mjs` had:
//
//     const shippedBlock = /SHIPPED_LOCALES[^[]*\[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
//     const NON_BASE = [...shippedBlock.matchAll(/code:\s*'([\w-]+)'/g)].map(...)
//
// The `?? ''` turns "the block moved" into an empty locale list, and the four
// `for (const locale of NON_BASE)` loops below it then iterate zero times and
// report success. Re-indenting the registry, wrapping `SHIPPED_LOCALES` in a
// helper, or changing the closing bracket's column would have disabled the
// whole template-label check while CI stayed green. The two other values in
// that same file (`BASE_LOCALE`, `TEMPLATE_IDS`) already failed loudly; this
// one was the exception.
//
// Every accessor here is fail-closed: it throws rather than return a shape that
// a caller could mistake for "nothing to check". A checker that wants to keep
// its own error formatting catches and reports.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const REGISTRY = 'src/i18n/registry.ts'

export class RegistryParseError extends Error {}

const die = (msg) => {
  throw new RegistryParseError(`${REGISTRY}: ${msg}`)
}

/** The registry source, read once per process. */
let cached = null
function source() {
  if (cached == null) {
    try {
      cached = readFileSync(resolve(ROOT, REGISTRY), 'utf8')
    } catch (e) {
      die(`could not be read (${e.code ?? e.message})`)
    }
    if (cached.trim() === '') die('is empty')
  }
  return cached
}

/** `BASE_LOCALE`, or throw. */
export function baseLocale() {
  const m = /\bBASE_LOCALE\s*=\s*'([a-zA-Z][\w-]*)'/.exec(source())
  if (!m) die('no `BASE_LOCALE = \'…\'` declaration found')
  return m[1]
}

/** The `SHIPPED_LOCALES` array body, or throw.
 *
 *  Deliberately NOT `?? ''`. The bracket walk replaces the old
 *  `\[([\s\S]*?)\n\]` shape, which depended on the closing bracket sitting in
 *  column 0 — a formatting detail, not a contract. */
function shippedBlock() {
  const src = source()
  // Anchor on the DECLARATION, not the first mention: the name also appears in
  // a comment and in `[...SHIPPED_LOCALES, …]` further down.
  const decl = /\bSHIPPED_LOCALES\b[^=\n]*=/.exec(src)
  if (!decl) die('no `SHIPPED_LOCALES = …` declaration found')
  // Start AFTER the `=`, so the `[]` of a type annotation (`LocaleEntry[]`)
  // cannot be mistaken for the array literal — it opens and closes at once, so
  // the walk below would return an empty body and every caller would see zero
  // locales. That is precisely the silent-empty failure this module exists to
  // prevent, and it caught itself here on the first run.
  const open = src.indexOf('[', decl.index + decl[0].length)
  if (open < 0) die('`SHIPPED_LOCALES` is not followed by an array literal')
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  die('`SHIPPED_LOCALES` array literal is not closed')
}

/** Every shipped locale code, in source order. Throws unless the result is a
 *  non-empty, duplicate-free list that contains the base locale. */
export function shippedCodes() {
  const codes = [...shippedBlock().matchAll(/(^|[\s{,])code:\s*'([a-zA-Z][\w-]*)'/g)].map((m) => m[2])
  if (codes.length === 0) die('`SHIPPED_LOCALES` parsed to ZERO codes — the block shape changed')
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i)
  if (dupes.length) die(`duplicate locale code(s): ${[...new Set(dupes)].join(', ')}`)
  const base = baseLocale()
  if (!codes.includes(base)) {
    die(`BASE_LOCALE \`${base}\` is not among the shipped codes (${codes.join(', ')})`)
  }
  return codes
}

/** The shipped codes except the base one. The relationship to `shippedCodes()`
 *  is asserted rather than assumed: exactly one code is removed. */
export function nonBaseCodes() {
  const all = shippedCodes()
  const base = baseLocale()
  const rest = all.filter((c) => c !== base)
  if (rest.length !== all.length - 1) {
    die(`removing the base locale \`${base}\` changed the count by ${all.length - rest.length}, not 1`)
  }
  if (rest.length === 0) die('there are no non-base locales, which cannot be right for this registry')
  return rest
}

/** For tests: forget the cached source. */
export function __reset() {
  cached = null
}
