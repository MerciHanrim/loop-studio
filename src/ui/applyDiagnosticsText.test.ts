// Review I1 — a name in a review line is isolated ONCE, where it is named, and a
// line (a connection) reads "from → to" left to right in every language: its two
// end names each in their own FSI…PDI, the pair inside one LRI…PDI that keeps
// them. The review used to wrap an already isolated "from → to" in `isolateAuto`
// again, which strips the inner isolates, so the pair took the direction of its
// FIRST name; a comma-joined list of names was isolated as one, the same way.
import { describe, expect, it } from 'vitest'
import { t } from '../i18n'
import type { DiagDoc, TableSplit, UnitMisread } from '../model/applyDiagnostics'
import type { LoopEdge, LoopNode } from '../model/types'
import { diagnosticLines } from './applyDiagnosticsText'

const FSI = '⁨'
const LRI = '⁦'
const PDI = '⁩'

const doc = (labels: Record<string, string>): DiagDoc => ({
  nodes: Object.entries(labels).map(([id, label]) => ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label, initial: 0 } })) as unknown as LoopNode[],
  edges: [
    { id: 'line', source: 'a', target: 'b', data: { kind: 'resource', flow: '1' } },
    { id: 'line2', source: 'b', target: 'c', data: { kind: 'resource', flow: '1' } },
  ] as unknown as LoopEdge[],
  kinds: [],
  time: undefined,
  timetables: [{ id: 'tbl', label: 'Deliveries', source: '', unit: '', timeUnit: 'h', read: 'hold', end: '1', after: 'stop', points: [['0', '1']] }],
  modelVersion: 7,
})

const NAMES = { a: 'قادوس البن', b: 'Drum A1', c: 'Cooler' }
const lines = (findings: { unitMisreads?: UnitMisread[]; tableSplits?: TableSplit[] }) => {
  const d = doc(NAMES)
  return diagnosticLines({ findings: { unitMisreads: findings.unitMisreads ?? [], newRefusals: [], tableSplits: findings.tableSplits ?? [] } as never, result: d, theirs: d }, t).map((l) => l.text)
}
const line = `${LRI}${FSI}قادوس البن${PDI} → ${FSI}Drum A1${PDI}${PDI}`

describe('review lines: each name isolated once, a line as one left-to-right run', () => {
  it('a value named by its unit, on a line: the run keeps both end isolates', () => {
    const [text] = lines({ unitMisreads: [{ elementType: 'edge', id: 'line', unit: 'bag', origin: 'proposed', via: 'unit' }] })
    expect(text).toContain(` ${line} `)
    expect(text).toContain(`${FSI}bag${PDI}`)
  })

  it('a value named by its unit, on a node: one isolate, no run', () => {
    const [text] = lines({ unitMisreads: [{ elementType: 'node', id: 'b', unit: 'bag', origin: 'yours', via: 'unit' }] })
    expect(text).toContain(` ${FSI}Drum A1${PDI} `)
    expect(text).not.toContain(LRI)
  })

  it('values in another base unit: a list of a line and a node, each name its own', () => {
    const [text] = lines({
      unitMisreads: [
        { elementType: 'edge', id: 'line', unit: 'kg', origin: 'proposed', via: 'base', now: 'g' },
        { elementType: 'node', id: 'c', unit: 'kg', origin: 'proposed', via: 'base', now: 'g' },
      ],
    })
    expect(text).toContain(`${line}, ${FSI}Cooler${PDI}`)
  })

  it('a table read from the other side: its readers, each name its own', () => {
    const [text] = lines({
      tableSplits: [{ tableId: 'tbl', label: 'Deliveries', direction: 'taken', readers: [{ elementType: 'edge', id: 'line' }, { elementType: 'node', id: 'c' }] }],
    })
    expect(text).toContain(`${line}, ${FSI}Cooler${PDI}`)
    expect(text).toContain(`${FSI}Deliveries${PDI}`)
  })

  it('control: no name is isolated twice (no FSI directly around another isolate)', () => {
    const texts = lines({
      unitMisreads: [
        { elementType: 'edge', id: 'line', unit: 'bag', origin: 'proposed', via: 'unit' },
        { elementType: 'edge', id: 'line2', unit: 'kg', origin: 'yours', via: 'base', now: 'g' },
      ],
    })
    for (const s of texts) expect(s).not.toMatch(new RegExp(`${FSI}[^${PDI}]*→`))
  })
})
