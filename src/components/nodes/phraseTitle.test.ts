import { describe, expect, it } from 'vitest'
import { ja } from '../../i18n/templateLabels/ja'
import { mayBreakBetween, needsPhrasing, phraseTitleParts } from './phraseTitle'

// docs/mmo-multilingual-layout.md §MML1 — the injected `<wbr>` restricts wrap
// points to phrase boundaries, but a `<wbr>` is an EXPLICIT break opportunity
// that overrides `line-break: strict`, so it must never drop a 行頭禁則 char to
// the head of a line (the reported Coffee-JA bug: `・サンプル用`).

/** the visual "lines" a keep-all + `<wbr>` title could wrap into: split the
 *  pieces wherever a `<wbr>` was placed. */
function possibleLines(parts: string[], breakAfter: boolean[]): string[] {
  const lines: string[] = []
  let cur = ''
  parts.forEach((p, i) => {
    cur += p
    if (breakAfter[i]) {
      lines.push(cur)
      cur = ''
    }
  })
  if (cur) lines.push(cur)
  return lines
}

const NO_LINE_START_CHARS = ['・', '、', '。', '！', '？', '）', '」', '』', '】', 'ー', 'ッ', '々']

describe('phraseTitle — kinsoku-safe <wbr> placement', () => {
  it('needsPhrasing is JA / ZH only', () => {
    expect(needsPhrasing('ja')).toBe(true)
    expect(needsPhrasing('zh-Hans')).toBe(true)
    expect(needsPhrasing('en')).toBe(false)
    expect(needsPhrasing('ko')).toBe(false)
  })

  it('never inserts a break before a 行頭禁則 char or after an opening bracket', () => {
    expect(mayBreakBetween('スタッフ', '・カッピング')).toBe(false)
    expect(mayBreakBetween('需要量', '）')).toBe(false)
    expect(mayBreakBetween('（', 'kg/日')).toBe(false)
    expect(mayBreakBetween('スタッフ・', 'カッピング')).toBe(true)
  })

  // the exact reported label, pinned to the shipped string
  it('the Coffee "staff cupping" JA label never starts a line with ・', () => {
    const label = ja['coffee-roastery'].roasted_bleed
    expect(label).toBe('スタッフ・カッピング・サンプル用')
    const seg = phraseTitleParts(label, 'ja')
    expect(seg, 'the label is phrased (has a usable break)').not.toBeNull()
    const lines = possibleLines(seg!.parts, seg!.breakAfter)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.startsWith('・'), `line "${line}"`).toBe(false)
  })

  // every shipped JA node label, across every bundled template
  it('no shipped JA template label can wrap to a 行頭禁則 line head', () => {
    for (const [tpl, dict] of Object.entries(ja)) {
      for (const [id, label] of Object.entries(dict)) {
        const seg = phraseTitleParts(label, 'ja')
        if (!seg) continue
        const lines = possibleLines(seg.parts, seg.breakAfter)
        for (const line of lines) {
          const head = [...line][0] ?? ''
          expect(
            NO_LINE_START_CHARS.includes(head),
            `${tpl}/${id} "${label}" → line "${line}" starts with a forbidden "${head}"`,
          ).toBe(false)
        }
      }
    }
  })

  it('still phrases genuine meaning-unit boundaries (does not glue the whole string)', () => {
    // a compound that SHOULD get an interior break opportunity
    const seg = phraseTitleParts('レベル経験値メーター', 'ja')
    expect(seg).not.toBeNull()
    expect(seg!.breakAfter.some(Boolean)).toBe(true)
  })

  it('returns null for locales / strings that need no phrasing', () => {
    expect(phraseTitleParts('Gold reserve balance', 'en')).toBeNull()
    expect(phraseTitleParts('金', 'ja')).toBeNull() // single segment
  })
})
