// docs/localization.md §L2.20 — reading the plural blocks out of an ICU message.
//
// WHY THIS IS A MODULE AND NOT A HELPER INSIDE ONE TEST FILE
//
// Every per-locale copy guard needs to look inside `{n, plural, …}`, and the
// obvious way to find those blocks is wrong in a way that goes GREEN:
//
//     message.split(/(?=\{\s*\w+\s*,\s*plural\s*,)/).slice(1)
//
// A zero-width match at index 0 does not split in JavaScript — `'abc'.split(
// /(?=a)/)` is `['abc']` — so `.slice(1)` throws the only block away whenever
// the message STARTS with its plural. MEASURED: 17 of the 19 plural messages
// in this catalog do. `trCopy.test.ts` shipped with that idiom and was
// checking 6 blocks across 19 keys; the other 14 keys were examined as
// nothing, and the test was green because there was nothing left to fail.
//
// The second trap is the repair: a bare depth counter over `{` and `}` cannot
// read `'{'`, ICU's quoted literal brace. It would count an opener that never
// closes, run off the end of the string, and DROP the block — the same silent
// vacuity in a different disguise. Both error paths below therefore throw
// instead of returning less.
//
// So: one walker, one place to fix, and `icuPlural.test.ts` holds the fixtures
// for each shape a catalog message actually takes.

/** In ICU, `'` opens a quoted literal only before `{`, `}` or `#`. Anywhere
 *  else it is an ordinary apostrophe — which matters, because `d'un` and
 *  `{label}'ın` are real catalog text and must not start a quote. */
const QUOTABLE = new Set(['{', '}', '#'])

/** The index just past the apostrophe construct at `i`, or null if the
 *  character there is not one.
 *
 *  `''` has to be tested FIRST, and that is not a refinement — MEASURED: with
 *  only the "quote opens before a brace" rule, `''{label}` made the SECOND
 *  apostrophe an opener (because a `{` follows it), the walk then ran to the
 *  end of the string looking for a close that was never there, and the block
 *  was dropped. `''` is an escaped apostrophe whatever follows it. */
function pastLiteral(s: string, i: number): number | null {
  if (s[i] !== "'") return null
  if (s[i + 1] === "'") return i + 2
  if (!QUOTABLE.has(s[i + 1])) return null
  // Inside the quote, `''` is still one literal apostrophe and does not close
  // it, so this cannot be `indexOf`.
  for (let j = i + 2; j < s.length; j++) {
    if (s[j] !== "'") continue
    if (s[j + 1] === "'") j++
    else return j + 1
  }
  return s.length
}

/** Index of the `}` that closes the `{` at `open`, or -1 if there is none.
 *  Braces inside a quoted literal are text and are not counted. */
function closingBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; ) {
    const skip = pastLiteral(s, i)
    if (skip !== null) {
      i = skip
      continue
    }
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

const OPENER_SOURCE = '\\{\\s*\\w+\\s*,\\s*plural\\s*,'

/** Every `{x, plural, …}` block in a message, outermost first, in order.
 *  Throws on an unbalanced block rather than skipping it — a dropped block is
 *  how a guard goes silently vacuous. */
export function pluralBlocks(message: string): string[] {
  const out: string[] = []
  const opener = new RegExp(OPENER_SOURCE, 'g')
  for (let m = opener.exec(message); m; m = opener.exec(message)) {
    const end = closingBrace(message, m.index)
    if (end === -1) throw new Error('unbalanced plural block at ' + m.index + ': ' + message)
    out.push(message.slice(m.index, end + 1))
    opener.lastIndex = end + 1
  }
  return out
}

const SELECTOR = /^\s*(?:offset\s*:\s*-?\d+\s*)?(zero|one|two|few|many|other|=\d+)\s*\{/

/** The arms of one block, as `[selector, body]`. The body is the raw text
 *  between the arm's braces, nested slots included — the `tr` lesson was that
 *  an arm body is PROSE and a guard that discards it says nothing about the
 *  sentence a reader of a counted message sees. */
export function pluralArms(block: string): [string, string][] {
  const header = new RegExp('^' + OPENER_SOURCE).exec(block)
  if (!header) throw new Error('not a plural block: ' + block)
  const out: [string, string][] = []
  let i = header[0].length
  for (;;) {
    const m = SELECTOR.exec(block.slice(i))
    if (!m) break
    const open = i + m[0].length - 1
    const close = closingBrace(block, open)
    if (close === -1) throw new Error('unbalanced arm `' + m[1] + '` in: ' + block)
    out.push([m[1], block.slice(open + 1, close)])
    i = close + 1
  }
  return out
}
