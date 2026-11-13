import { beforeAll, describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../model/templates'
import { ensureTemplateLabelDict, templateLabelDictLocales as NON_BASE_LOCALES } from './dicts'
import { openTemplate } from './index'
import { relabelPhasesForLocale } from './relabel'

// docs/run-phases.md — a Template's phase takes its name from the same overlay as its
// nodes and tables, on opening and on a language switch; its steps are never touched.

const tpl = TEMPLATES.find((t) => t.id === 'coffee-roasting-batch')!
const EN = ['Charge', 'Drying', 'Browning', 'Development', 'Drop', 'Cooling', 'Discharge']
const DE = ['Füllen', 'Trocknung', 'Bräunung', 'Entwicklung', 'Entleeren', 'Kühlung', 'Ausgabe']
const names = (phases: readonly { label: string }[]) => phases.map((p) => p.label)

describe('a Template phase in the reader’s language', () => {
  beforeAll(async () => {
    for (const loc of NON_BASE_LOCALES) await ensureTemplateLabelDict(loc)
  })

  it('opens under the language, and the bundled Template is not touched', () => {
    expect(names(openTemplate(tpl, 'de').phases!)).toEqual(DE)
    expect(names(tpl.phases!)).toEqual(EN)
    expect(names(openTemplate(tpl, 'en').phases!)).toEqual(EN)
  })

  it('changes nothing but the name, in every language, and every language has its own seven', () => {
    const steps = tpl.phases!.map((p) => [p.id, p.from, p.to])
    for (const loc of NON_BASE_LOCALES) {
      const opened = openTemplate(tpl, loc).phases!
      expect(opened.map((p) => [p.id, p.from, p.to]), loc).toEqual(steps)
      expect(opened.every((p) => p.label.trim() !== ''), loc).toBe(true)
      expect(new Set(names(opened)).size, loc).toBe(7)
    }
  })

  it('follows a language switch, through a second language and back', () => {
    const de = openTemplate(tpl, 'de').phases!
    const ko = relabelPhasesForLocale(de, 'ko')
    expect(names(ko)).toEqual(['투입', '건조', '갈변', '발달', '드롭', '냉각', '냉각 완료'])
    expect(names(relabelPhasesForLocale(ko, 'en'))).toEqual(EN)
  })

  it('keeps a name a person gave a phase, and a phase of a person’s own document', () => {
    const de = openTemplate(tpl, 'de').phases!
    const own = relabelPhasesForLocale([{ ...de[2]!, label: 'Maillard' }, de[3]!], 'en')
    expect(names(own)).toEqual(['Maillard', 'Development'])
    const mine = [{ id: 'my_phase', label: 'Drying', from: 1, to: 2 }]
    expect(relabelPhasesForLocale(mine, 'de')).toBe(mine)
  })

  it('returns the same array when nothing changes', () => {
    const de = openTemplate(tpl, 'de').phases!
    expect(relabelPhasesForLocale(de, 'de')).toBe(de)
    expect(relabelPhasesForLocale([], 'de')).toEqual([])
  })
})
