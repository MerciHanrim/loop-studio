import type { Locator } from '@playwright/test'

// docs/localization.md §L9.2 / §L2.0a — how a string READS, measured on screen.
//
// Since 2026-10-29 the layout is LTR for every locale and only RTL TEXT reads
// right to left: the chrome text gets its reading direction from
// `unicode-bidi: plaintext` (src/index.css), which changes no `direction`. So a
// computed `direction` cannot tell whether an Arabic sentence reads rtl — it is
// `ltr` either way. What can tell is where the glyphs land:
//
//   * ALIGNMENT — `text-align: start` follows each paragraph's own direction
//     under `plaintext`, so in a box wider than its text an rtl paragraph sits
//     flush RIGHT. Only meaningful when the box has slack (`slack` > 1 px).
//   * ORDER — in an rtl paragraph the first logical character is the rightmost
//     glyph and the last logical character the leftmost. For a string that is
//     Arabic throughout this holds in an ltr paragraph too (an Arabic run is
//     drawn right to left either way), so it only discriminates when the string
//     mixes Arabic with a digit or a Latin letter (`mixed`).
//
// The helper reports the facts; each test asserts the ones its string can show.

export type Paragraph = {
  /** the element's own computed `direction` — the LAYOUT side of the contract */
  direction: string
  unicodeBidi: string
  textAlign: string
  /** the visible text, in logical order */
  text: string
  /** the string has an Arabic letter AND a digit / Latin letter */
  mixed: boolean
  /** px between the text's union box and the content box, per side */
  gapLeft: number
  gapRight: number
  /** content width minus text width */
  slack: number
  /** 'right' / 'left' when the box has slack and the text sits on that side */
  align: 'left' | 'right' | 'none'
  /** the first logical character is the rightmost glyph */
  firstIsRightmost: boolean
  /** the last logical character is the leftmost glyph */
  lastIsLeftmost: boolean
}

export function readParagraph(el: Locator): Promise<Paragraph> {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node)
    const chars: { ch: string; left: number; right: number }[] = []
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const s = t.textContent ?? ''
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) continue
        const range = document.createRange()
        range.setStart(t, i)
        range.setEnd(t, i + 1)
        const r = range.getBoundingClientRect()
        // a character in a hidden branch (display: none) has no box
        if (r.width === 0 && r.height === 0) continue
        chars.push({ ch: s[i], left: r.left, right: r.right })
      }
    }
    const box = node.getBoundingClientRect()
    const px = (v: string) => parseFloat(v) || 0
    const contentLeft = box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft)
    const contentRight = box.right - px(cs.borderRightWidth) - px(cs.paddingRight)
    const textLeft = Math.min(...chars.map((c) => c.left))
    const textRight = Math.max(...chars.map((c) => c.right))
    const gapLeft = Math.round((textLeft - contentLeft) * 10) / 10
    const gapRight = Math.round((contentRight - textRight) * 10) / 10
    const slack = Math.round((contentRight - contentLeft - (textRight - textLeft)) * 10) / 10
    const text = chars.map((c) => c.ch).join('')
    const first = chars[0]
    const last = chars[chars.length - 1]
    return {
      direction: cs.direction,
      unicodeBidi: cs.unicodeBidi,
      textAlign: cs.textAlign,
      text,
      mixed: /\p{Script=Arabic}/u.test(text) && /[0-9A-Za-z]/.test(text),
      gapLeft,
      gapRight,
      slack,
      align: slack <= 1 ? 'none' : gapRight <= 1 && gapLeft > 1 ? 'right' : gapLeft <= 1 && gapRight > 1 ? 'left' : 'none',
      firstIsRightmost: first != null && first.right >= textRight - 0.5,
      lastIsLeftmost: last != null && last.left <= textLeft + 0.5,
    }
  })
}
