import { Fragment, type ReactNode, useMemo } from 'react'

// docs/mmo-multilingual-layout.md §MML1 — Japanese / Chinese node titles must
// wrap on MEANING units. `word-break: normal` alone lets the browser break
// between any two kana / hanzi (`レ|ベル`, `経|験値`, `戦利|品`). We instead find
// the phrase boundaries at RENDER time with `Intl.Segmenter` and mark them with
// `<wbr>`; CSS then restricts breaks to exactly those points (`word-break:
// keep-all`), while `line-break: strict` keeps kinsoku. The stored `data.label`
// is never touched — this is display-only.
//
// `word-break: auto-phrase` (a dictionary phrase-break, Chromium 119+) is the
// better result where supported; the CSS upgrades to it under `@supports` and
// the injected `<wbr>` stay harmless there.

const seg: Record<string, Intl.Segmenter> = {}
const hasSegmenter =
  typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function'

/** Does this locale need phrase segmentation? (CJK without spaces between words) */
export function needsPhrasing(locale: string): boolean {
  const base = locale.toLowerCase().split('-')[0]
  return base === 'ja' || base === 'zh'
}

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

/** Split `title` into phrase segments joined by `<wbr>`. Returns `phrased:false`
 *  (and the plain string) when the locale needs no phrasing or `Intl.Segmenter`
 *  is unavailable — the CSS fallback then applies. */
export function usePhrasedTitle(title: string, locale: string): { node: ReactNode; phrased: boolean } {
  return useMemo(() => {
    if (!needsPhrasing(locale)) return { node: title, phrased: false }
    const s = segmenterFor(locale)
    if (!s) return { node: title, phrased: false }
    const parts: string[] = []
    for (const { segment } of s.segment(title)) parts.push(segment)
    // nothing to break on → let the CSS fallback (`word-break: normal`) wrap it
    if (parts.length <= 1) return { node: title, phrased: false }
    const node: ReactNode[] = []
    parts.forEach((p, i) => {
      node.push(<Fragment key={i}>{p}</Fragment>)
      if (i < parts.length - 1) node.push(<wbr key={`w${i}`} />)
    })
    return { node, phrased: true }
  }, [title, locale])
}
