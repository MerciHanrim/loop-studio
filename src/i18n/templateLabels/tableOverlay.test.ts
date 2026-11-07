import { beforeAll, describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../model/templates'
import { ensureTemplateLabelDict } from './dicts'
import { openTemplate } from './index'
import { relabelTablesForLocale } from './relabel'

// docs/template-label-overlay.md §TLO13 — a Template's table takes its name and its
// source from the same overlay as its nodes, on opening and on a language switch.

const tpl = TEMPLATES.find((t) => t.id === 'desalination')!
const EN = { label: 'City water demand', source: 'Example assumption, not measured data' }
const DE = { label: 'Wasserbedarf der Stadt', source: 'Beispielannahme, keine Messdaten' }

describe('a Template table in the reader’s language', () => {
  beforeAll(async () => {
    await ensureTemplateLabelDict('de')
    await ensureTemplateLabelDict('ko')
  })

  it('opens under the language, and the bundled Template is not touched', () => {
    const [table] = openTemplate(tpl, 'de').timetables!
    expect(table).toMatchObject(DE)
    expect(tpl.timetables![0]).toMatchObject(EN)
    expect(openTemplate(tpl, 'en').timetables![0]).toMatchObject(EN)
  })

  it('changes nothing but the two strings', () => {
    const { label: _l, source: _s, ...rest } = openTemplate(tpl, 'de').timetables![0]!
    const { label: _a, source: _b, ...base } = tpl.timetables![0]!
    expect(rest).toEqual(base)
  })

  it('follows a language switch, through a second language and back', () => {
    const de = openTemplate(tpl, 'de').timetables!
    const ko = relabelTablesForLocale(de, 'ko')
    expect(ko[0]!.label).not.toBe(DE.label)
    expect(ko[0]!.source).not.toBe(DE.source)
    expect(relabelTablesForLocale(ko, 'en')[0]).toMatchObject(EN)
  })

  it('keeps a name a person gave the table, and still switches the untouched source', () => {
    const [own] = relabelTablesForLocale([{ ...openTemplate(tpl, 'de').timetables![0]!, label: 'Mein Bedarf' }], 'en')
    expect(own).toMatchObject({ label: 'Mein Bedarf', source: EN.source })
  })

  it('leaves a table of the same id in a person’s own document alone', () => {
    const mine = [{ ...tpl.timetables![0]!, label: 'Our demand', source: 'Our logger' }]
    expect(relabelTablesForLocale(mine, 'de')).toBe(mine)
  })

  it('returns the same array when nothing changes', () => {
    const de = openTemplate(tpl, 'de').timetables!
    expect(relabelTablesForLocale(de, 'de')).toBe(de)
    expect(relabelTablesForLocale([], 'de')).toEqual([])
  })
})
