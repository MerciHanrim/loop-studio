import { describe, expect, it } from 'vitest'
import { canonicalPhase, PHASE_ID_MAX, PHASE_LABEL_MAX, PHASES_MAX, phaseAt, readPhases } from './phases'
import { canonicalContent, digestOfCanonical, planRevisionExport } from './revision'
import { deserialize, serialize } from './serialize'
import { semanticDigest } from './workspace'
import type { LoopNode } from './types'

// docs/run-phases.md — the phases of a run as the author named them: a guide beside
// the step, read defensively, written only when there are some, and in neither digest.

const P = (id: string, label: string, from: number, to: number) => ({ id, label, from, to })
const THREE = [P('a', 'Charge', 1, 1), P('b', 'Roast', 2, 13), P('c', 'Cool', 15, 18)]
const pool = { id: 'p', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'P', initial: 1 } } as unknown as LoopNode

describe('readPhases', () => {
  it('keeps a well-formed list as it is, in its key order', () => {
    expect(readPhases(THREE)).toEqual(THREE)
    expect(Object.keys(readPhases([{ to: 3, from: 1, label: 'x', id: 'k', extra: 1 }])[0]!)).toEqual(['id', 'label', 'from', 'to'])
  })

  it('reads nothing from what is not a list', () => {
    for (const raw of [undefined, null, 'x', 3, {}, { 0: THREE[0] }]) expect(readPhases(raw)).toEqual([])
  })

  it('drops a bad entry and keeps the rest', () => {
    const bad = [
      null,
      'x',
      [],
      { label: 'no id', from: 2, to: 3 },
      { id: '', label: 'empty id', from: 2, to: 3 },
      { id: 'x'.repeat(PHASE_ID_MAX + 1), label: 'long id', from: 2, to: 3 },
      { id: 'n', from: 2, to: 3 },
      { id: 'n', label: '   ', from: 2, to: 3 },
      { id: 'n', label: 7, from: 2, to: 3 },
      { id: 'n', label: 'zero', from: 0, to: 3 },
      { id: 'n', label: 'fraction', from: 1.5, to: 3 },
      { id: 'n', label: 'text', from: '2', to: 3 },
      { id: 'n', label: 'backwards', from: 4, to: 3 },
      { id: 'n', label: 'not finite', from: 2, to: Infinity },
    ]
    expect(readPhases([THREE[0], ...bad, THREE[1]])).toEqual([THREE[0], THREE[1]])
  })

  it('keeps the phases in step order and apart: of two that overlap, or one out of order, the first in the file stays', () => {
    expect(readPhases([P('a', 'A', 1, 5), P('b', 'B', 5, 9), P('c', 'C', 6, 9)])).toEqual([P('a', 'A', 1, 5), P('c', 'C', 6, 9)])
    expect(readPhases([P('a', 'A', 6, 9), P('b', 'B', 1, 5), P('c', 'C', 10, 10)])).toEqual([P('a', 'A', 6, 9), P('c', 'C', 10, 10)])
  })

  it('keeps one entry of an id, and a gap between phases', () => {
    expect(readPhases([P('a', 'A', 1, 2), P('a', 'again', 3, 4), P('b', 'B', 8, 9)])).toEqual([P('a', 'A', 1, 2), P('b', 'B', 8, 9)])
  })

  it('cuts a name at the cap by character, and stops at the entry cap', () => {
    const long = '가'.repeat(PHASE_LABEL_MAX + 5)
    expect(readPhases([P('a', long, 1, 1)])[0]!.label).toBe('가'.repeat(PHASE_LABEL_MAX))
    const pair = '😀'.repeat(PHASE_LABEL_MAX + 1)
    expect(Array.from(readPhases([P('a', pair, 1, 1)])[0]!.label)).toHaveLength(PHASE_LABEL_MAX)
    const many = Array.from({ length: PHASES_MAX + 10 }, (_, i) => P(`p${i}`, `P${i}`, i + 1, i + 1))
    expect(readPhases(many)).toHaveLength(PHASES_MAX)
  })

  it('reads the same list from the same input, and its own output', () => {
    const raw = [P('a', 'A', 1, 5), P('b', 'B', 5, 9), { id: 'c' }, P('d', 'D', 12, 12)]
    expect(readPhases(raw)).toEqual(readPhases(raw))
    expect(readPhases(readPhases(raw))).toEqual(readPhases(raw))
  })
})

describe('phaseAt', () => {
  it('finds the phase that covers a step, both ends counted in', () => {
    expect(phaseAt(THREE, 1)?.id).toBe('a')
    expect(phaseAt(THREE, 2)?.id).toBe('b')
    expect(phaseAt(THREE, 13)?.id).toBe('b')
    expect(phaseAt(THREE, 18)?.id).toBe('c')
  })
  it('finds none before the run, in a gap, and past the last phase', () => {
    expect(phaseAt(THREE, 0)).toBeNull()
    expect(phaseAt(THREE, 14)).toBeNull()
    expect(phaseAt(THREE, 19)).toBeNull()
    expect(phaseAt([], 3)).toBeNull()
  })
})

describe('a document with phases', () => {
  const without = serialize([pool], [])

  it('is written as before when it has none', () => {
    expect(serialize([pool], [], undefined, undefined, undefined, 1, undefined, undefined, undefined, undefined, undefined, [])).toBe(without)
    expect(serialize([pool], [], undefined, undefined, undefined, 1, undefined, undefined, undefined, undefined, undefined, undefined)).toBe(without)
    expect('phases' in JSON.parse(without)).toBe(false)
    expect(deserialize(without).phases).toEqual([])
  })

  it('writes the key after the model keys, at any schema, and reads it back', () => {
    const text = serialize([pool], [], { steps: 30 }, { any: 1 }, undefined, 1, undefined, undefined, undefined, undefined, undefined, THREE)
    const doc = JSON.parse(text)
    expect(doc.schema).toBe('loop-studio/graph')
    expect(doc.phases).toEqual(THREE)
    const keys = Object.keys(doc)
    expect(keys.indexOf('phases')).toBeGreaterThan(keys.indexOf('recommendedRunConfig'))
    expect(keys.indexOf('phases')).toBeLessThan(keys.indexOf('workspace'))
    const back = deserialize(text)
    expect(back.phases).toEqual(THREE)
    // a save of what was read, read and saved again, is the same bytes
    const resave = (d: ReturnType<typeof deserialize>) => serialize(d.nodes, d.edges, d.recommendedRunConfig, d.workspace, undefined, d.modelVersion, d.frames, d.dataImports, d.kinds, d.time, d.timetables, d.phases)
    const saved = resave(back)
    expect(JSON.parse(saved).phases).toEqual(THREE)
    expect(resave(deserialize(saved))).toBe(saved)
  })

  it('writes each phase in the wire key order, whatever the object held', () => {
    const loose = [{ to: 2, label: 'A', id: 'a', from: 1, n: 9 }] as never
    const text = serialize([pool], [], undefined, undefined, undefined, 1, undefined, undefined, undefined, undefined, undefined, loose)
    expect(JSON.stringify(JSON.parse(text).phases)).toBe('[{"id":"a","label":"A","from":1,"to":2}]')
    expect(canonicalPhase(loose[0])).toEqual(P('a', 'A', 1, 2))
  })

  it('drops a bad phase on reading and keeps the document', () => {
    const doc = JSON.parse(without)
    doc.phases = [P('a', 'A', 3, 2), P('b', 'B', 4, 6), 'junk']
    const back = deserialize(JSON.stringify(doc))
    expect(back.nodes).toHaveLength(1)
    expect(back.phases).toEqual([P('b', 'B', 4, 6)])
  })

  it('is in neither digest: the engine digest and the revision content are the same with and without', async () => {
    const graph = { nodes: [pool], edges: [] }
    expect(await semanticDigest({ ...graph, phases: THREE } as never, 1)).toBe(await semanticDigest(graph, 1))
    const a = canonicalContent({ ...graph, phases: THREE } as never, { modelVersion: 1 })
    const b = canonicalContent(graph, { modelVersion: 1 })
    expect('phases' in a).toBe(false)
    expect(digestOfCanonical(a)).toBe(digestOfCanonical(b))
  })

  it('rides in a revision file outside its digest, so the file opened as a document keeps the phases', () => {
    const plan = (phases?: typeof THREE) =>
      planRevisionExport({
        doc: { nodes: [pool], edges: [], ...(phases ? { phases } : {}) },
        modelVersion: 1,
        project: { projectId: 'proj_1', revisionId: 'rev_1', parentId: null, lineage: [] },
        dirty: false,
        meta: { tool: 'test', createdAt: '2026-11-13T00:00:00.000Z' },
        now: '2026-11-13T00:00:00.000Z',
        mint: () => 'rev_2',
      } as never)
    const withP = plan(THREE)
    const noP = plan()
    if (!withP.ok || !noP.ok) throw new Error('the revision export was refused')
    expect(deserialize(withP.text).phases).toEqual(THREE)
    expect('phases' in JSON.parse(noP.text)).toBe(false)
    const digest = (text: string) => (JSON.parse(text).project as { contentDigest?: string }).contentDigest
    expect(digest(withP.text)).toBeDefined()
    expect(digest(withP.text)).toBe(digest(noP.text))
  })
})
