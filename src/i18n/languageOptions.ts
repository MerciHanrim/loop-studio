// docs/localization.md §L5.3 — shared data + search logic for the language
// switch. The desktop toolbar and the mobile More sheet mount the SAME
// `<LanguageSwitch>`; this module holds the parts a shell must not diverge on.

/** The switch shows a search box once the SHIPPED-language count reaches this. */
export const LANGUAGE_SEARCH_THRESHOLD = 6

/** docs/localization.md §L5.6 — the picker's DISPLAY order, over a COPY.
 *
 *  The registry array is DATA: its order is the order languages happened to
 *  ship, and nothing may depend on it. Sorting the array itself would be the
 *  wrong fix — `BASE_ENTRY` was `LOCALES[0]` until this change, so an
 *  alphabetical registry would have silently made the base entry `zh-Hans`
 *  while the base CATALOG stayed `en`. The sort therefore lives here, and
 *  `registry.ts` looks its base entry up by code.
 *
 *  Key: `englishName` under `Intl.Collator('en')`, `code` as a deterministic
 *  tiebreak. `englishName` is the one label that does not move when the UI
 *  language changes. The two alternatives were rejected on that ground: the
 *  localized display name would re-order the list under the user at the exact
 *  moment they are changing language, and the endonym would sort by script
 *  (Latin, then Cyrillic, then CJK) — a grouping nobody asked for.
 *
 *  A DEV/QA pseudo-locale stays SELECTABLE but is not one of the languages a
 *  user has (§L5.4), so it is kept out of the sorted set and appended last,
 *  ordered among its own kind by the same rule. Production ships none. */
export function displayLocaleOrder<T extends { code: string; englishName: string; pseudo?: boolean }>(
  locales: readonly T[],
): T[] {
  const collator = new Intl.Collator('en')
  const byName = (a: T, b: T) =>
    collator.compare(a.englishName, b.englishName) || collator.compare(a.code, b.code)
  const shipped: T[] = []
  const pseudo: T[] = []
  for (const l of locales) (l.pseudo ? pseudo : shipped).push(l)
  return [...shipped.sort(byName), ...pseudo.sort(byName)]
}

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

/** The one CYRILLIC fold, and the reason it is one letter wide (§L5.5).
 *
 *  MEASURED before it existed: `foldForSearch` left `ё` and `е` as different
 *  strings, so with the UI in Russian the entry `Китайский (упрощённый)` could
 *  not be found by typing `упрощенный` — which is how most Russian speakers
 *  type it, since the two letters are freely substituted in running text and
 *  `ё` is a separate key.
 *
 *  It is scoped to a diaeresis sitting on Cyrillic `е` ON PURPOSE. Under NFD
 *  `й` is also `и` plus a combining mark, and `й` is a distinct letter that no
 *  Russian reader would substitute for `и`, so the general rule rejected for
 *  Japanese dakuten would be wrong here too. Both characters are built from
 *  their code points rather than typed, because Cyrillic `е` and Latin `e` are
 *  homoglyphs and a literal here could not be reviewed by eye. */
const CYRILLIC_E = new Set([String.fromCharCode(0x435), String.fromCharCode(0x415)])
const COMBINING_DIAERESIS = String.fromCharCode(0x308)

/** The one TURKISH fold: dotless `ı` searches as `i` (§L5.5).
 *
 *  MEASURED before it existed: `İ` already folded to `i` (it decomposes to
 *  `I` + a combining dot, and the Latin rule above drops the mark), but `ı`
 *  has no decomposition, so with the UI in Turkish the French row —
 *  `Fransızca` — could not be reached by typing `fransizca`. That was the only
 *  failing case; `Ç ç Ö ö Ü ü` already fold through the Latin-mark rule.
 *
 *  This is SEARCH ONLY. Turkish treats `ı` and `i` as different letters, and
 *  nothing here changes rendering, stored values or a catalog string. The
 *  fold exists so a reader on a keyboard without `ı` can still find the row;
 *  it is deliberately one character and NOT `toLocaleLowerCase('tr')`, which
 *  would also map `I` to `ı` and break every other language's search. */
const DOTLESS_I = String.fromCharCode(0x131)

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
 *     both. Hangul jamo, Thai and Arabic marks are left alone for the same
 *     reason, and so is every Cyrillic mark except the single measured case
 *     in `CYRILLIC_E` below.
 *  2. Every space — ASCII, NBSP (U+00A0) and the narrow no-break space
 *     (U+202F) French typography uses — becomes a single ASCII space, so a
 *     typed space matches a typeset one.
 *  3. Two single letters fold that no mark rule could reach, each measured
 *     against a real row a reader could not otherwise find: Cyrillic `ё` to
 *     `е` (`CYRILLIC_E`) and Turkish dotless `ı` to `i` (`DOTLESS_I`).
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
      // …or if it is the one Cyrillic case: a diaeresis on `е`, i.e. `ё`
      if (ch === COMBINING_DIAERESIS && CYRILLIC_E.has(out.slice(-1))) continue
      out += ch
      continue
    }
    out += /[\s  ]/.test(ch) ? ' ' : ch
  }
  // `ı` has no decomposition, so the fold is a plain substitution after the
  // case fold rather than a mark rule.
  return out.normalize('NFC').toLowerCase().split(DOTLESS_I).join('i')
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
