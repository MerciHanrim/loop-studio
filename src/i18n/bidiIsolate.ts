// docs/localization.md §L9.4 — the PRODUCER side of bidi isolation.
//
// `./bidiControls.ts` is the analysis half: it names the controls and finds
// them. This is the half that makes one, for the case PR B could not reach with
// markup.
//
// WHERE THIS IS ALLOWED TO BE USED, AND WHERE IT IS NOT
//
// A user value of unknown direction interpolated into a localized sentence
// needs bounding. When the value is its own JSX child, `<bdi dir="auto">` does
// that and this module is not needed — PR B took every such site. What is left
// is the case where the value enters through an ICU ARGUMENT: the sentence and
// the value become ONE string before any element exists, so there is no element
// to put `dir` on, and markup cannot reach inside.
//
// So the rule this module is written to:
//
//   * the isolate goes into the RENDER ARGUMENT, at the call site, never into a
//     catalog value. Every shipped catalog carries zero bidi controls and that
//     is checked separately (`bidiControls.test.ts`); nothing here changes it.
//   * the isolate is DISPLAY ONLY. The value that is stored, digested, exported
//     to a file, written to CSV or put in a share link is the raw one. A control
//     that reached storage would change a digest and travel into other people's
//     documents.
//
// WHY THE VALUE IS STRIPPED BEFORE IT IS WRAPPED
//
// The three families behave differently, and lumping them together gets all
// three wrong:
//
//   * `LRM` / `RLM` / `ALM` are STRONG DIRECTIONAL CHARACTERS, not scopes. They
//     open nothing and close nothing. They act by being strong where the
//     algorithm looks for a strong character — which is enough to flip how the
//     neutrals around them resolve, and enough to decide an `FSI`'s direction.
//   * `LRE` / `RLE` / `LRO` / `RLO` are explicit FORMATTING, and their scope is
//     ended by `PDF` — not by `PDI`. An unterminated one runs to the end of the
//     paragraph.
//   * `LRI` / `RLI` / `FSI` are ISOLATES, and their scope is ended by `PDI`.
//
// The common conclusion, which is what matters here: a bidi formatting or
// control character inside a VALUE can change how the SENTENCE around it is
// resolved — by supplying a strong character the algorithm then uses, or by
// opening or closing a scope this code did not intend. A value's own `PDI` can
// close the isolate placed around it, after which the rest of the sentence sits
// outside the bounding that was the point of adding it.
//
// User data can contain any of them: a spreadsheet cell, a node label and a
// frame name are all free text. So the value is stripped of bidi formatting and
// control characters at the DISPLAY boundary, and the isolate added is then the
// only bidi structure in the argument.
//
// WHAT IS NOT STRIPPED. Only the formatting and control characters above.
// `ZWJ` and `ZWNJ` are joiners — they shape the letters, they do not steer
// direction — and Arabic combining marks are part of the word. Removing either
// would change the text a reader sees, which this must never do. The stripped
// copy is the display copy; the stored value is untouched either way.

import { BANNED_CONTROLS, ISOLATE_OPENERS, PDI } from './bidiControls'

/** FIRST STRONG ISOLATE — the direction is taken from the first strong
 *  character of the wrapped text. The counterpart of `dir="auto"`, for a value
 *  whose direction is NOT known in advance: a spreadsheet cell, a column
 *  header, a frame name a user typed. */
export const FSI = String.fromCharCode(0x2068)

/** LEFT-TO-RIGHT ISOLATE — the direction is forced. The counterpart of
 *  `dir="ltr"`, for a technical token whose direction IS known in advance: a
 *  node id, a generated revision id. */
export const LRI = String.fromCharCode(0x2066)

/** POP DIRECTIONAL ISOLATE — closes any of the three openers. Re-exported so a
 *  call site never has to name a code point. */
export { PDI }

/** The bidi FORMATTING and CONTROL characters, as one character class: the
 *  strong marks, the embedding/override pair openers and their `PDF`
 *  terminator, the three isolate openers and their `PDI` terminator.
 *
 *  Deliberately NOT here: `ZWJ` (U+200D), `ZWNJ` (U+200C) and the Arabic
 *  combining marks. Those shape or compose the text rather than steer its
 *  direction, so removing one would change what a reader sees. */
const ALL_CONTROLS = new Set<string>([...BANNED_CONTROLS.keys(), ...ISOLATE_OPENERS.keys(), PDI])

/** `value` with every bidi formatting and control character removed.
 *
 *  DISPLAY ONLY. The caller keeps the original for storage, digests and export
 *  — the stripped copy exists so the isolate placed around it cannot be ended
 *  or escaped from the inside. */
export function stripBidiControls(value: string): string {
  let out = ''
  for (const ch of value) if (!ALL_CONTROLS.has(ch)) out += ch
  return out
}

/** True when `value` carries nothing an isolate could act on — empty, or only
 *  characters with no directional weight. Wrapping such a value would add two
 *  invisible characters and change nothing, so the helpers return it unchanged.
 *
 *  Whitespace alone counts as nothing: a blank cell must not become a
 *  two-character string, because a caller may be testing it for emptiness. */
function isInert(value: string): boolean {
  return value.length === 0 || value.trim().length === 0
}

/** Wrap a value of UNKNOWN direction for interpolation into a localized
 *  sentence — the `dir="auto"` case, where markup cannot reach.
 *
 *  Returns the value unchanged when there is nothing to isolate, so an empty
 *  cell stays empty and a caller's emptiness check keeps working. */
export function isolateAuto(value: string): string {
  const clean = stripBidiControls(value)
  return isInert(clean) ? clean : FSI + clean + PDI
}

/** Wrap a technical token whose direction is KNOWN to be left-to-right — a node
 *  id, a revision id. `LRI` rather than `FSI` because the answer must not
 *  depend on the token's first character: an id that happened to start with a
 *  digit or a symbol would otherwise take the surrounding paragraph's
 *  direction, which is the failure `dir="ltr"` pins against elsewhere. */
export function isolateLtr(value: string): string {
  const clean = stripBidiControls(value)
  return isInert(clean) ? clean : LRI + clean + PDI
}

/** The text a reader sees, with the isolation removed again — the inverse of
 *  the two helpers above for any value they produced.
 *
 *  This is what a test asserts against, and what an accessible-name comparison
 *  uses: the isolate must not change the text content, only its resolution. */
export function unwrapIsolates(value: string): string {
  return stripBidiControls(value)
}
