import { Fragment, type ReactNode, useMemo } from 'react'

// docs/mmo-multilingual-layout.md §MML1 — Japanese / Chinese node titles must
// wrap on MEANING units. `word-break: normal` alone lets the browser break
// between any two kana / hanzi (`レ|ベル`, `経|験値`, `戦利|品`). We instead find
// the phrase boundaries at RENDER time with `Intl.Segmenter` and mark them with
// `<wbr>`; CSS then restricts breaks to exactly those points (`word-break:
// keep-all`). The stored `data.label` is never touched — this is display-only.
//
// A `<wbr>` is an EXPLICIT break opportunity that overrides `line-break: strict`,
// so it must not be placed where it would drop a 行頭禁則 char (`・、。` closing
// brackets, sound mark, small kana…) to the head of a line, or strand a 行末禁則
// opening bracket — see `mayBreakBetween`. (`word-break: auto-phrase`, the
// Chromium 119+ dictionary phrase-break the CSS upgrades to under `@supports`,
// gets kinsoku right on its own; the surviving `<wbr>` stay harmless there.)

const seg: Record<string, Intl.Segmenter> = {}
const hasSegmenter =
  typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function'

/** Does this locale need phrase segmentation? (CJK without spaces between words) */
export function needsPhrasing(locale: string): boolean {
  const base = locale.toLowerCase().split('-')[0]
  return base === 'ja' || base === 'zh'
}

// 行頭禁則 / 行末禁則 — an injected `<wbr>` is an EXPLICIT break opportunity and
// overrides `line-break: strict`, so a `<wbr>` must not be placed where it would
// let a "cannot start a line" char (・、。 closing brackets, sound mark, small
// kana, iteration marks) begin the next line, or split off a "cannot end a
// line" opening bracket. Subset sufficient for node labels.
const NO_LINE_START =
  /^[・、。，．,.!?！？：；)\]}）］｝」』】〕〉》〞”’ー〜～%‰°々ゝゞヽヾぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ]/u
const NO_LINE_END = /[([{（［｛「『【〔〈《〝“‘]$/u

function segmenterFor(locale: string): Intl.Segmenter | null {
  if (!hasSegmenter) return null
  const base = locale.toLowerCase().split('-')[0]
  if (!seg[base]) {
    try {
      seg[base] = new Intl.Segmenter(base, { granularity: 'word' })
    } catch {
      return null
    }
  }
  return seg[base]
}

/** May a `<wbr>` sit between `prev` and `next`? No, if it would drop a 行頭禁則
 *  char to the head of a line, or break right after a 行末禁則 opening bracket. */
export function mayBreakBetween(prev: string, next: string): boolean {
  return !NO_LINE_START.test(next) && !NO_LINE_END.test(prev)
}

/** The phrase pieces of `title` and, for each gap, whether a `<wbr>` goes there.
 *  `null` when the locale needs no phrasing, `Intl.Segmenter` is unavailable, or
 *  no gap survives kinsoku — the CSS fallback then wraps the plain string. */
export function phraseTitleParts(
  title: string,
  locale: string,
): { parts: string[]; breakAfter: boolean[] } | null {
  if (!needsPhrasing(locale)) return null
  const s = segmenterFor(locale)
  if (!s) return null
  const parts: string[] = []
  for (const { segment } of s.segment(title)) parts.push(segment)
  if (parts.length <= 1) return null
  const breakAfter = parts.map((p, i) =>
    i < parts.length - 1 ? mayBreakBetween(p, parts[i + 1]) : false,
  )
  return breakAfter.some(Boolean) ? { parts, breakAfter } : null
}

/** Split `title` into phrase segments joined by `<wbr>`. Returns `phrased:false`
 *  (and the plain string) when the locale needs no phrasing or `Intl.Segmenter`
 *  is unavailable — the CSS fallback then applies. */
export function usePhrasedTitle(title: string, locale: string): { node: ReactNode; phrased: boolean } {
  return useMemo(() => {
    const seg = phraseTitleParts(title, locale)
    if (!seg) return { node: title, phrased: false }
    const node: ReactNode[] = []
    seg.parts.forEach((p, i) => {
      node.push(<Fragment key={i}>{p}</Fragment>)
      if (seg.breakAfter[i]) node.push(<wbr key={`w${i}`} />)
    })
    return { node, phrased: true }
  }, [title, locale])
}
