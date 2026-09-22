// docs/localization.md §L5.3 — shared data + search logic for the language
// switch. The desktop toolbar and the mobile More sheet mount the SAME
// `<LanguageSwitch>`; this module holds the parts a shell must not diverge on.

/** The switch shows a search box once the SHIPPED-language count reaches this. */
export const LANGUAGE_SEARCH_THRESHOLD = 6

/** Does the picker render its search box? Counts the languages a user actually
 *  has — a DEV/QA pseudo-locale is selectable and searchable but is not one of
 *  them, so it must not push the count over the threshold and show the box a
 *  language early in dev while production still hides it (§L5.4). */
export function shouldShowLanguageSearch(
  locales: readonly { pseudo?: boolean }[],
): boolean {
  return locales.filter((l) => !l.pseudo).length >= LANGUAGE_SEARCH_THRESHOLD
}

/** true when two labels read the same after trimming + lower-casing. The switch
 *  then shows one line only — a redundant "한국어 / 한국어" adds density, not
 *  meaning (docs/localization.md §L5.3). */
export function labelsEquivalent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** A LATIN letter that a combining mark may legitimately be folded off:
 *  Basic Latin, Latin-1 Supplement, Latin Extended-A/B, and the Latin
 *  Extended Additional block Vietnamese uses. Deliberately NOT "any base" —
 *  see `foldForSearch`. */
const LATIN_BASE = /[A-Za-zÀ-ɏḀ-ỿ]/

/** Normalise one string for the LANGUAGE-PICKER search only (§L5.5).
 *
 *  Two things happen, and both are deliberately narrow:
 *
 *  1. A combining mark is dropped **only when the character it sits on is a
 *     Latin letter**, so `Français` is findable as `francais` or `franc` by
 *     anyone without a French keyboard — and Vietnamese will be too. The
 *     obvious one-liner (`normalize('NFD').replace(/\p{M}/gu, '')`) is WRONG
 *     here: Japanese dakuten / handakuten are combining marks, so it would
 *     collapse か/が and ホ/ポ into the same string and make one query match
 *     both. Hangul jamo, Cyrillic, Thai and Arabic marks are left alone for
 *     the same reason.
 *  2. Every space — ASCII, NBSP (U+00A0) and the narrow no-break space
 *     (U+202F) French typography uses — becomes a single ASCII space, so a
 *     typed space matches a typeset one.
 *
 *  A ligature that decomposition does not reduce to ASCII (`œ`, `æ`) is left
 *  as it is; if a real search need appears it gets an explicit alias rather
 *  than a transliteration rule. */
export function foldForSearch(value: string): string {
  const decomposed = value.normalize('NFD')
  let out = ''
  for (const ch of decomposed) {
    const isMark = /\p{M}/u.test(ch)
    if (isMark) {
      // drop it only if what we have kept so far ends in a Latin letter
      if (LATIN_BASE.test(out.slice(-1))) continue
      out += ch
      continue
    }
    out += /[\s  ]/.test(ch) ? ' ' : ch
  }
  return out.normalize('NFC').toLowerCase()
}

/** Does an entry match the query? Case-, diacritic- and space-insensitive,
 *  over four fields: BCP-47 code, English name, endonym, and the name in the
 *  active UI language (`displayName`, resolved from `displayNameKey`). Both
 *  sides go through `foldForSearch`, so the comparison is symmetric. */
export function matchesLanguageQuery(
  entry: { code: string; englishName: string; nativeName: string },
  displayName: string,
  query: string,
): boolean {
  const q = foldForSearch(query.trim())
  if (q === '') return true
  return [entry.code, entry.englishName, entry.nativeName, displayName].some((s) =>
    foldForSearch(s).includes(q),
  )
}
