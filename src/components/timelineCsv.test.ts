import { describe, expect, it } from 'vitest'
import { buildGachaBannerZonesGraph } from '../engine/gachaBannerZonesGraph'
import { ko } from '../i18n/templateLabels/ko'
import { parseDelimitedText } from '../model/csv'
import { buildRunCsv, runCsvColumnName } from './timelineCsv'

// docs/data-import.md §CSV — the Timeline's run export.
//
// WHY THE HEADER CARRIES THE NODE ID. It used to be the Pool's LABEL alone, and
// a Template may give several Pools the same label: measured on the shipped
// 3-zone gacha Template, 6 of its 24 column names repeated (tickets ×3,
// pulls-made ×3, SR-count ×3, R-count ×3, pity ×2, ceiling-hits ×2) — in
// English exactly as in a translated overlay, so it was never a locale defect. The numbers were
// right; the NAMES were not usable as independent data columns. Reordering or
// copying columns in a spreadsheet, selecting a column by name in an analysis
// tool, or turning rows into objects (duplicate keys overwrite) all break.
//
// The id is the disambiguator rather than a zone-name prefix because a frame
// stores NO membership — it is derived from geometry (LGR-D9 / R5-D3), so a
// zone prefix would depend on frame layout, would need a decided answer for a
// Pool in no frame / in overlapping frames / in a nested frame, and would
// change when the user moves a rectangle. `ticket_free` cannot.

const POOLS = (ids: string[], label: (id: string) => string) => ids.map((id) => ({ id, label: label(id) }))

describe('runCsvColumnName', () => {
  it('is `label [node-id]`', () => {
    expect(runCsvColumnName({ id: 'ticket_free', label: 'Tickets' })).toBe('Tickets [ticket_free]')
  })

  it('keeps the localized label readable', () => {
    expect(runCsvColumnName({ id: 'ticket_free', label: 'ตั๋ว' })).toBe('ตั๋ว [ticket_free]')
  })

  it('is stable when the label is empty or renamed — the id half never moves', () => {
    expect(runCsvColumnName({ id: 'p1', label: '' })).toBe(' [p1]')
    expect(runCsvColumnName({ id: 'p1', label: 'renamed by the user' })).toBe('renamed by the user [p1]')
  })

  it('names the base unit in the readable half, so the last bracket stays the id (§M4-6)', () => {
    const name = runCsvColumnName({ id: 'p1', label: 'feed', unit: 'm³' })
    expect(name).toBe('feed [m³] [p1]')
    expect(/\[([^\]]+)\]$/.exec(name)?.[1]).toBe('p1')
  })

  it('an empty unit is no unit', () => {
    expect(runCsvColumnName({ id: 'p1', label: 'feed', unit: '' })).toBe('feed [p1]')
  })
})

describe('buildRunCsv', () => {
  const series = [
    { step: 0, values: { a: 0, b: 0 } },
    { step: 1, values: { a: 3, b: 7 } },
  ]

  it('writes CRLF records and ends with one', () => {
    const csv = buildRunCsv(POOLS(['a', 'b'], () => 'P'), series)
    expect(csv).toBe('step,P [a],P [b]\r\n0,0,0\r\n1,3,7\r\n')
  })

  it('a Pool with a unit keeps plain numeric cells (§M4-6)', () => {
    const csv = buildRunCsv([{ id: 'a', label: 'feed', unit: 'm³' }, { id: 'b', label: 'P' }], series)
    expect(csv).toBe('step,feed [m³] [a],P [b]\r\n0,0,0\r\n1,3,7\r\n')
  })

  it('a missing value reads 0, exactly as the chart does', () => {
    const csv = buildRunCsv(POOLS(['a', 'z'], () => 'P'), series)
    expect(csv.split('\r\n')[1]).toBe('0,0,0')
  })

  it('a hostile user label survives LOSSLESSLY — never replaced by a space', () => {
    const pools = [
      { id: 'p1', label: 'a,b' },
      { id: 'p2', label: 'say "hi"' },
      { id: 'p3', label: 'two\nlines' },
    ]
    const csv = buildRunCsv(pools, [{ step: 0, values: { p1: 1, p2: 2, p3: 3 } }])
    const parsed = parseDelimitedText(csv, ',')
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.rows[0]).toEqual([
      'step',
      'a,b [p1]',
      'say "hi" [p2]',
      'two\nlines [p3]',
    ])
  })
})

// issue #616 item 4 — a header cell that begins with `=`, `+`, `-` or `@` is read
// as a formula when the file is opened in a spreadsheet. Such a cell gets one
// leading `'`, the guard the change-proposal export uses; every other header
// cell, and every data cell, is written exactly as before.
describe('a header cell that begins with = + - @ is guarded', () => {
  const FORMULA_POOLS = [
    { id: 'p1', label: '=SUM(A1:A9)' },
    { id: 'p2', label: '+1+1' },
    { id: 'p3', label: '-2+3' },
    { id: 'p4', label: '@cmd' },
    { id: 'gold', label: 'Gold' },
  ]
  const series = [{ step: 0, values: { p1: 0, p2: 0, p3: 0, p4: 0, gold: -2 } }]
  const rows = (csv: string) => {
    const parsed = parseDelimitedText(csv, ',')
    expect(parsed.ok).toBe(true)
    return parsed.ok ? parsed.rows : []
  }

  it('Pool columns: the four formula-like names get one leading `\'`; `step` and a plain name do not', () => {
    const [head, row] = rows(buildRunCsv(FORMULA_POOLS, series))
    expect(head).toEqual(['step', "'=SUM(A1:A9) [p1]", "'+1+1 [p2]", "'-2+3 [p3]", "'@cmd [p4]", 'Gold [gold]'])
    // data cells are never guarded: a negative number stays a number
    expect(row).toEqual(['0', '0', '0', '0', '0', '-2'])
  })

  it('timetable-line and rule columns are guarded the same way', () => {
    const [head] = rows(
      buildRunCsv([], [{ step: 0, values: {} }], [{ edgeId: 'e1', label: '=feed', unit: 'kg' }], [{ id: 'g1', label: '+rule' }]),
    )
    expect(head).toEqual(['step', "'=feed (planned) [kg] [e1]", "'=feed (moved) [kg] [e1]", "'+rule (target) [g1]", "'+rule (moved) [g1]", "'+rule (state) [g1]"])
  })

  // the file with shown values: src/model/viewUnits.test.ts, which has a real view

  it('control: a header with no formula-like cell is byte for byte what it was', () => {
    expect(buildRunCsv(POOLS(['a', 'b'], () => 'P'), [{ step: 0, values: { a: 0, b: 0 } }])).toBe('step,P [a],P [b]\r\n0,0,0\r\n')
    const [head] = rows(buildRunCsv([{ id: 'x', label: 'a=b' }, { id: 'y', label: 'Gold-2' }, { id: 'z', label: ' =lead space' }], [{ step: 0, values: {} }]))
    // only the FIRST character decides; a sign inside the name is ordinary text
    expect(head).toEqual(['step', 'a=b [x]', 'Gold-2 [y]', ' =lead space [z]'])
  })
})

describe('the 3-zone gacha Template — the case this exists for', () => {
  const pools = buildGachaBannerZonesGraph()
    .nodes.filter((n) => n.data.kind === 'pool')
    .map((n) => ({ id: n.id, label: n.data.label }))
  // §L2.0 (2026-10) — the overlaid language is Korean (it was Thai; that version
  // is in `archive/i18n/tests/timelineCsv.multilocale.test.ts`)
  const korean = ko['gacha-banner-zones']

  it('has Pools whose LABELS repeat — the premise', () => {
    const labels = pools.map((p) => p.label)
    expect(new Set(labels).size).toBeLessThan(labels.length)
  })

  it('every column name is unique in English', () => {
    const names = ['step', ...pools.map(runCsvColumnName)]
    expect(new Set(names).size).toBe(names.length)
  })

  it('every column name is unique in KOREAN, and there are 24 of them', () => {
    const koreanPools = pools.map((p) => ({ id: p.id, label: korean[p.id] ?? p.label }))
    // the overlay really is applied — otherwise this would silently re-test English
    expect(koreanPools.filter((p) => p.label !== (pools.find((q) => q.id === p.id) as { label: string }).label).length)
      .toBeGreaterThan(0)
    const names = ['step', ...koreanPools.map(runCsvColumnName)]
    expect(names).toHaveLength(24)
    expect(new Set(names).size).toBe(24)
  })

  it('the id half alone is already unique, so the name cannot collide whatever the label says', () => {
    const ids = pools.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
