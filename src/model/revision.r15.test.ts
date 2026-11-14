// SEMANTICS-R15.md — the `unchecked` mark of a phase: read, written, projected, and what an
// Apply does with it is in test/revision-phase-mark.test.ts.
import { describe, expect, it } from 'vitest'
import { anyUnchecked, canonicalPhase, clearUnchecked, markUnchecked, readPhases, type DocPhase } from './phases'
import { REVISION_SEMANTICS, canonicalContent, canonicalJson, computeRevisionDiff, computeThreeWay, digestOfCanonical, phaseTimingSplit, readRevisionSide } from './revision'
import type { LoopEdge, LoopNode } from './types'

const nodes: LoopNode[] = [
  { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  { id: 'b', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
] as LoopNode[]
const edges: LoopEdge[] = [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1', route: 'orthogonal' } } as LoopEdge]
const P = (id: string, label: string, from: number, to: number): DocPhase => ({ id, label, from, to })
const PLAIN = [P('dry', 'Drying', 2, 5), P('brown', 'Browning', 6, 9)]
const MARKED = markUnchecked(PLAIN)
const doc = (phases?: DocPhase[]) => canonicalContent({ nodes, edges, ...(phases ? { phases } : {}) }, { modelVersion: 6 })
const side = (phases?: unknown) => readRevisionSide({ nodes, edges, rawDataImportSignal: false, ...(phases !== undefined ? { phases } : {}) } as never)

describe('R15-1 — the stored form', () => {
  it('the mark is `true` or it is not there', () => {
    const read = readPhases([
      { id: 'a', label: 'A', from: 1, to: 1, unchecked: true },
      { id: 'b', label: 'B', from: 2, to: 2, unchecked: false },
      { id: 'c', label: 'C', from: 3, to: 3, unchecked: 'yes' },
      { id: 'd', label: 'D', from: 4, to: 4 },
    ])
    expect(read).toEqual([{ id: 'a', label: 'A', from: 1, to: 1, unchecked: true }, P('b', 'B', 2, 2), P('c', 'C', 3, 3), P('d', 'D', 4, 4)])
    expect(read.map((p) => 'unchecked' in p)).toEqual([true, false, false, false])
  })

  it('is written last, and only when set', () => {
    expect(Object.keys(canonicalPhase({ unchecked: true, to: 5, from: 2, label: 'Drying', id: 'dry' }))).toEqual(['id', 'label', 'from', 'to', 'unchecked'])
    expect(Object.keys(canonicalPhase(PLAIN[0]!))).toEqual(['id', 'label', 'from', 'to'])
  })

  it('marking and clearing are whole: every phase, and back to the plain entries', () => {
    expect(MARKED.every((p) => p.unchecked === true)).toBe(true)
    expect(anyUnchecked(MARKED)).toBe(true)
    expect(clearUnchecked(MARKED)).toEqual(PLAIN)
    expect(anyUnchecked(PLAIN)).toBe(false)
    expect(anyUnchecked([])).toBe(false)
  })
})

describe('R15-2 — the projection and the label', () => {
  it('an unmarked document projects as it did: no byte and no digest moves', () => {
    expect(canonicalJson(doc(clearUnchecked(MARKED)))).toBe(canonicalJson(doc(PLAIN)))
    expect(canonicalJson(doc(PLAIN))).not.toContain('unchecked')
    const s = side(PLAIN)
    expect(s.ok && s.version).toBe('loop-revision/13')
  })

  it('a marked one carries the mark in its content and its digest, and its side is /15', () => {
    expect(canonicalJson(doc(MARKED))).toContain('"unchecked":true')
    expect(digestOfCanonical(doc(MARKED))).not.toBe(digestOfCanonical(doc(PLAIN)))
    const s = side(MARKED)
    expect(s.ok && s.version).toBe('loop-revision/15')
    // one marked phase is enough, and a mark that does not survive the read is none
    const one = side([{ ...PLAIN[0], unchecked: true }, PLAIN[1]])
    expect(one.ok && one.version).toBe('loop-revision/15')
    const none = side([{ ...PLAIN[0], unchecked: 1 }, PLAIN[1]])
    expect(none.ok && none.version).toBe('loop-revision/13')
  })

  it('the header this build writes declares /15', () => {
    expect(REVISION_SEMANTICS).toBe('loop-revision/15')
  })

})

describe('R15-5 — the mark in a diff and a three-way plan', () => {
  it('two documents that differ only in the mark differ in their phases: it is not an empty diff', () => {
    const diff = computeRevisionDiff(doc(PLAIN), doc(MARKED))
    expect(diff.summary.phasesChanged).toBe(true)
    expect(diff.summary.empty).toBe(false)
    expect(diff.summary.engineAffecting).toBe(false)
  })

  it('the phases unit carries it: clean when only the proposal marks, a conflict when the target was marked and the proposal moved the phases', () => {
    expect(computeThreeWay(doc(PLAIN), doc(PLAIN), doc(MARKED)).phases?.verdict).toBe('clean')
    expect(computeThreeWay(doc(MARKED), doc(MARKED), doc(PLAIN)).phases?.verdict).toBe('clean')
    const moved = [P('dry', 'Drying', 2, 7), P('brown', 'Browning', 8, 9)]
    expect(computeThreeWay(doc(PLAIN), doc(MARKED), doc(moved))).toMatchObject({ phases: { verdict: 'conflict' }, nConf: 1 })
  })

  it('taking unmarked phases over marked ones with nothing of the timing in question splits nothing', () => {
    expect(phaseTimingSplit(doc(MARKED), doc(PLAIN), { mode: 'whole' })).toBeNull()
    expect(phaseTimingSplit(doc(MARKED), doc(PLAIN), { mode: 'hunks', phases: 'proposed' })).toBeNull()
  })
})
