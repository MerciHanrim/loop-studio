// docs/localization.md §L9.4 — invisible bidi control characters in catalog
// text: what they are, and the one shape in which one may legitimately ship.
//
// WHY THIS IS A MODULE AND NOT A `.includes()` INSIDE ONE TEST
//
// Sixteen of these characters are zero-width. A reviewer cannot see one in a
// diff, a failing test that prints the string prints nothing useful, and a
// `\u` escape typed into a source file is exactly the authoring channel that
// has written a real NUL into this repo before. So they are built from code
// points, named, and checked by a function with its own fixtures.
//
// THE CONTRACT IS NOT "NEVER"
//
// Every shipped catalog today has zero, and that is right: a control sitting in
// running prose is almost always a translator's workaround for a layout bug
// that belongs in the layout. But an RTL locale reaches cases where markup
// cannot go — `aria-label`, `title` and `placeholder` are attributes, and there
// are 115 such call sites in `src/components`. Where an element-level `dir`
// cannot fix a value because RTL prose and an LTR token share ONE attribute,
// an isolate is the mechanism the platform actually provides.
//
// So the rule is: default zero, and a per-key allowlist that has to be argued
// and that only accepts the well-formed shape.

/** Characters this repo's CATALOGS may not contain: the directional MARKS and
 *  the deprecated embedding/override codes.
 *
 *  This is a LOOP STUDIO POLICY, not a statement about Unicode. `LRM`, `RLM`
 *  and `ALM` are perfectly ordinary characters and the platform emits them all
 *  the time — `Intl.NumberFormat('ar')` wraps a negative number and a
 *  percentage in LRM, and a render layer is free to produce them. The rule here
 *  is narrower: a TRANSLATOR must not type one into a catalog value.
 *
 *  The reason is scope. None of these has an end, so its effect runs past the
 *  value into whatever is rendered next — and a catalog value does not know
 *  what it will be concatenated with, which attribute it will land in, or what
 *  sits beside it on screen. An isolate does have an end, which is why the
 *  openers below are treated differently. */
export const BANNED_CONTROLS: ReadonlyMap<string, string> = new Map([
  [String.fromCharCode(0x200e), 'LRM'],
  [String.fromCharCode(0x200f), 'RLM'],
  [String.fromCharCode(0x061c), 'ALM'],
  [String.fromCharCode(0x202a), 'LRE'],
  [String.fromCharCode(0x202b), 'RLE'],
  [String.fromCharCode(0x202c), 'PDF'],
  [String.fromCharCode(0x202d), 'LRO'],
  [String.fromCharCode(0x202e), 'RLO'],
])

/** The ISOLATE openers. Unlike the marks above these have an explicit end, so
 *  their effect is bounded by the string itself and a catalog CAN reason about
 *  them. `FSI` picks the direction from the first strong character it wraps. */
export const ISOLATE_OPENERS: ReadonlyMap<string, string> = new Map([
  [String.fromCharCode(0x2066), 'LRI'],
  [String.fromCharCode(0x2067), 'RLI'],
  [String.fromCharCode(0x2068), 'FSI'],
])

/** The one closer, for all three openers. */
export const PDI = String.fromCharCode(0x2069)

export type BidiFinding =
  | { kind: 'banned'; name: string; at: number }
  | { kind: 'unpaired-open'; name: string; at: number }
  | { kind: 'unpaired-close'; name: 'PDI'; at: number }

/** Everything wrong with `value`, in source order.
 *
 *  Two separate failures, deliberately not merged: a BANNED character is wrong
 *  wherever it sits, while an isolate is wrong only when it does not pair. A
 *  test that reported both as "has bidi controls" could not tell a translator
 *  which of the two mistakes they made. */
export function bidiFindings(value: string): BidiFinding[] {
  const out: BidiFinding[] = []
  const open: { name: string; at: number }[] = []
  let i = 0
  for (const ch of value) {
    const banned = BANNED_CONTROLS.get(ch)
    if (banned) out.push({ kind: 'banned', name: banned, at: i })
    const opener = ISOLATE_OPENERS.get(ch)
    if (opener) open.push({ name: opener, at: i })
    else if (ch === PDI) {
      if (open.length === 0) out.push({ kind: 'unpaired-close', name: 'PDI', at: i })
      else open.pop()
    }
    i += ch.length
  }
  for (const o of open) out.push({ kind: 'unpaired-open', name: o.name, at: o.at })
  return out.sort((a, b) => a.at - b.at)
}

/** The isolate pairs in `value`, as opener names. Empty for every string that
 *  uses none — which is every catalog value today. */
export function isolatesIn(value: string): string[] {
  const names: string[] = []
  const open: string[] = []
  for (const ch of value) {
    const opener = ISOLATE_OPENERS.get(ch)
    if (opener) open.push(opener)
    else if (ch === PDI && open.length > 0) names.push(open.pop()!)
  }
  return names
}

/** Does `value` carry any bidi control at all, banned or not? */
export function hasAnyBidiControl(value: string): boolean {
  for (const ch of value) {
    if (BANNED_CONTROLS.has(ch) || ISOLATE_OPENERS.has(ch) || ch === PDI) return true
  }
  return false
}
