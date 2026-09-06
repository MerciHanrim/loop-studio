// docs/localization.md §L5.3 — shared data + search logic for the language
// switch. The desktop toolbar and the mobile More sheet mount the SAME
// `<LanguageSwitch>`; this module holds the parts a shell must not diverge on.

/** The switch shows a search box once the enabled-locale count reaches this. */
export const LANGUAGE_SEARCH_THRESHOLD = 6

/** Does an entry match the query? Case- and surrounding-whitespace-insensitive,
 *  over four fields: BCP-47 code, English name, endonym, and the name in the
 *  active UI language (`displayName`, resolved from `displayNameKey`). */
export function matchesLanguageQuery(
  entry: { code: string; englishName: string; nativeName: string },
  displayName: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return [entry.code, entry.englishName, entry.nativeName, displayName].some((s) =>
    s.toLowerCase().includes(q),
  )
}
