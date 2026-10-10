// docs/diagram-layout.md §DL2.1 (issue #344) — a node's CANONICAL box.
//
// The one-time layout conversion and Tidy to grid must give the same result in
// every language, browser and platform, so they never measure the DOM or a
// font. This is the widest box a node's content can take, from the document
// alone: every character is given an UPPER-BOUND advance for its script (any
// of the fonts the supported languages fall back to fits under it), the title
// wraps at its 135 px exactly like `.nodef__title` (two lines at most), and the
// kind's paddings, minimum / maximum widths and height rules apply as
// `src/index.css` and `silhouette.ts` draw them. A runtime value that the
// document does not hold (a Register's result) is given a fixed six-digit width.
// It never changes how a node is drawn; it only decides where nodes may go.

import type { LoopNode, NodeKind } from '../../model/types'
import { BASE_NODE_H, fillSpanAt, isFixedDepth, MAX_NODE_H, VESSEL_INSET_Y, VESSEL_MIN_PAD_Y } from './silhouette'
import { ROW_CLEAR } from './rowFit'

/** the CSS of `.nodef` and its rows (src/index.css) */
const MIN_W = 118
const MIN_W_GATE = 134
const MAX_W = 260
const TITLE_PX = 14
const TITLE_MAX = 135
const TITLE_LH = TITLE_PX * 1.15
const SUB_PX = 12
const SUB_LH = SUB_PX * 1.25
const VALUE_PX = 18
const VALUE_LH = VALUE_PX * 1.15
const CHIP = 8 + 6 // `.nodef__chip` + `.nodef__head` gap
/** `.nodef__body` inline padding per kind, [left, right] */
const PAD: Record<NodeKind, [number, number]> = {
  pool: [12, 12],
  source: [12, 22],
  drain: [22, 12],
  gate: [26, 26],
  converter: [12, 12],
  end: [12, 24],
  parameter: [15, 15],
  register: [15, 15],
}

/** an upper-bound advance in em for one code point */
function advance(cp: number): number {
  // combining marks (Latin, Cyrillic, Thai, Arabic, Hebrew, Devanagari …)
  if ((cp >= 0x0300 && cp <= 0x036f) || cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e) || (cp >= 0x064b && cp <= 0x065f) || cp === 0x200b || cp === 0x200d) return 0
  // CJK, kana, Hangul, full-width forms: one em
  if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3ffff)) return 1
  // narrow Latin glyphs and punctuation
  if (' .,:;\'!|ijlIft()[]'.includes(String.fromCodePoint(cp))) return 0.45
  // upper case, digits, wide Latin (M, W, m, w)
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x30 && cp <= 0x39) || 'mwMW@%&'.includes(String.fromCodePoint(cp))) return 0.82
  return 0.74 // everything else (Latin lower case, Cyrillic, Greek, Arabic, Thai, Vietnamese …)
}

/** an upper bound of `text`'s width at `px`, in CSS px */
export function textWidthBound(text: string, px: number): number {
  let em = 0
  for (const ch of text) em += advance(ch.codePointAt(0)!)
  return em * px
}

const breakable = (cp: number): boolean => advance(cp) === 1 // CJK breaks anywhere
/** where a phrase-breaking (keep-all) line may end, besides a space */
const PHRASE_END = '・、。，）」』·—–-/'

/** the title's lines, wrapped greedily at `TITLE_MAX`: spaces break; with
 *  `cjkBreaks` CJK also breaks between any two characters (`word-break:
 *  normal`), without it only at spaces (`keep-all`, phrase breaking); a token
 *  wider than the line breaks inside (overflow-wrap). The title has no clamp. */
function wrap(title: string, cjkBreaks: boolean, max = TITLE_MAX): number[] {
  const tokens: string[] = []
  let cur = ''
  for (const ch of title) {
    const cp = ch.codePointAt(0)!
    if (ch === ' ') { if (cur) tokens.push(cur); tokens.push(' '); cur = '' }
    else if (cjkBreaks && breakable(cp)) { if (cur) tokens.push(cur); tokens.push(ch); cur = '' }
    else if (!cjkBreaks && PHRASE_END.includes(ch)) { tokens.push(cur + ch); cur = '' } // a phrase ends after it
    else cur += ch
  }
  if (cur) tokens.push(cur)
  const lines: number[] = []
  let w = 0
  // a token too wide for a line breaks inside it; where only phrase / word
  // boundaries may break (keep-all), a line is assumed only 70 % filled
  const chunk = cjkBreaks ? max : max * 0.7
  for (const tok of tokens) {
    const tw = textWidthBound(tok, TITLE_PX)
    if (tok === ' ') { if (w > 0) w += tw; continue }
    if (w > 0 && w + tw > max) { lines.push(Math.min(w, max)); w = 0 }
    let rest = tw
    while (rest > max) { lines.push(max); rest -= chunk }
    w += rest
  }
  if (w > 0 || lines.length === 0) lines.push(Math.min(w, max))
  return lines
}

/** the title's line widths under whichever of the UI languages' break rules
 *  gives MORE lines (Korean keeps words whole, Japanese / Chinese break by
 *  phrase, the rest by word): the canonical box may not depend on the language.
 *  A Parameter's / Register's title wraps narrower (its head keeps a percentage
 *  rim, #332): its LINE COUNT is taken at `narrow` px. */
export function titleLines(title: string, narrow = TITLE_MAX): number[] {
  const a = wrap(title, true, narrow)
  const b = wrap(title, false, narrow)
  const lines = b.length > a.length ? b : a
  if (narrow >= TITLE_MAX) return lines
  // narrow: one line keeps its own width; more lines take the full title box
  return lines.length > 1 ? lines.map(() => TITLE_MAX) : wrap(title, true)
}

/** the width a Parameter's / Register's title wraps at (an upper bound of
 *  its rim-narrowed line, #332) */
const NARROW_TITLE = 96

const fmt = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '000000')

/** the rows under the title: [text, px, own line?] as `nodes.tsx` builds them */
function rows(node: LoopNode): [string, number, boolean][] {
  const d = node.data as unknown as Record<string, unknown>
  const r = (t: string, px: number, line = true): [string, number, boolean] => [t, px, line]
  switch (node.type as NodeKind) {
    case 'pool': {
      const out = [r(fmt(d.initial), VALUE_PX)]
      if (d.capacity != null) out.push(r(`≤ ${String(d.capacity)}`, SUB_PX))
      return out
    }
    case 'source':
    case 'drain':
      return [r(`${String(d.activation ?? '')} · ${String(d.mode ?? '')}`, SUB_PX)]
    case 'gate':
      return [r(String(d.distribution ?? ''), SUB_PX)]
    case 'converter':
      return [r(String(d.mode ?? ''), SUB_PX)]
    case 'parameter': {
      const out = [r(fmt(d.value), VALUE_PX)]
      if (d.unit) out.push(r(String(d.unit), SUB_PX))
      return out
    }
    case 'register':
      return [r(`000000${d.unit ? ` ${String(d.unit)}` : ''}`, VALUE_PX), r(`= ${String(d.expr ?? '')}`, SUB_PX)]
    default:
      return []
  }
}

export type CanonicalBox = { w: number; h: number }

/** issue #337 — a width-parametric kind (./outlineFit) keeps every painted
 *  element `ROW_CLEAR` inside its drawn outline: how far in the outline's left
 *  and right sides reach anywhere over the stack's height (the stack is centred
 *  between the vessel's caps), plus that clearance — an upper bound of where
 *  the fit puts the head and the rows, and of the room it leaves at the end */
function outlineReach(kind: NodeKind, h: number): [number, number] {
  const REF = 1000 // the left side never depends on the width, the right only through it
  const inset = (VESSEL_INSET_Y[kind] ?? 16) / 2 + VESSEL_MIN_PAD_Y
  let l = 0
  let r = 0
  for (let y = inset; y <= h - inset + 1e-9; y += 1) {
    const s = fillSpanAt(kind, h, y, REF)
    if (!s) continue
    l = Math.max(l, s[0])
    r = Math.max(r, REF - s[1])
  }
  return [l + ROW_CLEAR, r + ROW_CLEAR]
}

/** FROZEN — the canonical box as it was computed before #337 drew the Pool,
 *  Source, Drain, Converter and Gate for their own width (the content and the
 *  kind's paddings only). Used ONLY by the layout migration, to decide which
 *  nodes a saved frame held as the document was drawn when it was saved
 *  (§DL2.8): a node #337 draws wider stays its frame's. Never changes; pinned
 *  by `canonicalBox.test.ts` over the Templates as they stood before step 4. */
export function legacyCanonicalBoxBeforeOutlineContainment(node: LoopNode): CanonicalBox {
  const kind = node.type as NodeKind
  const title = String((node.data as { label?: unknown }).label ?? '')
  const lines = titleLines(title, kind === 'parameter' || kind === 'register' ? NARROW_TITLE : undefined)
  const rs = rows(node)
  const titleW = lines.length > 1 ? TITLE_MAX : lines[0]
  const content = Math.max(CHIP + titleW, ...rs.map(([t, px]) => textWidthBound(t, px)))
  const [pl, pr] = PAD[kind] ?? [12, 12]
  const w = Math.min(MAX_W, Math.max(kind === 'gate' ? MIN_W_GATE : MIN_W, Math.ceil(content + pl + pr)))
  const stack = lines.length * TITLE_LH + rs.reduce((a, [, px, own]) => a + (own ? (px === VALUE_PX ? VALUE_LH : SUB_LH) : 0), 0)
  const h = Math.max(BASE_NODE_H, Math.min(MAX_NODE_H[kind] ?? 132, Math.ceil(stack + (VESSEL_INSET_Y[kind] ?? 16) + 2 * VESSEL_MIN_PAD_Y) + 2))
  return { w, h }
}

/** the canonical (widest) box of a node, from the document alone */
export function canonicalBox(node: LoopNode): CanonicalBox {
  const kind = node.type as NodeKind
  const title = String((node.data as { label?: unknown }).label ?? '')
  const lines = titleLines(title, kind === 'parameter' || kind === 'register' ? NARROW_TITLE : undefined)
  const rs = rows(node)
  // `boxHeightOf`: the stack (title lines + rows, the body padding outside it)
  // + the kind's vessel inset + the clear gap above and below
  const stack = lines.length * TITLE_LH + rs.reduce((a, [, px, own]) => a + (own ? (px === VALUE_PX ? VALUE_LH : SUB_LH) : 0), 0)
  const h = Math.max(BASE_NODE_H, Math.min(MAX_NODE_H[kind] ?? 132, Math.ceil(stack + (VESSEL_INSET_Y[kind] ?? 16) + 2 * VESSEL_MIN_PAD_Y) + 2 /* line-box rounding */))
  // a wrapped title's box is the full `max-width` (CSS shrink-to-fit), not
  // its longest line
  const titleW = lines.length > 1 ? TITLE_MAX : lines[0]
  const rowW = Math.max(0, ...rs.map(([t, px]) => textWidthBound(t, px)))
  const [pl, pr] = PAD[kind] ?? [12, 12]
  const minW = kind === 'gate' ? MIN_W_GATE : MIN_W
  let need: number
  if (!isFixedDepth(kind)) need = Math.max(CHIP + titleW, rowW) + pl + pr
  else {
    const [L, R] = outlineReach(kind, h)
    // the Gate centres every line; the others start their rows at the title
    need = kind === 'gate' ? Math.max(CHIP + titleW, rowW) + 2 * Math.max(L, R, pl, pr) : CHIP + Math.max(titleW, rowW) + Math.max(pl, L) + Math.max(pr, R)
  }
  const w = Math.min(MAX_W, Math.max(minW, Math.ceil(need)))
  return { w, h }
}
