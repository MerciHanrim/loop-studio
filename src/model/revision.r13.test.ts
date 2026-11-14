// SEMANTICS-R13.md — the phases of a run (`phases`, docs/run-phases.md) in the revision layer.
import { describe, expect, it } from 'vitest'
import {
  REVISION_SEMANTICS,
  buildSelectiveApply,
  canonicalContent,
  canonicalJson,
  computeRevisionDiff,
  computeThreeWay,
  countThreeWayConflicts,
  digestOfCanonical,
  phaseTimingSplit,
  readProject,
  readRevisionSide,
} from './revision'
import type { DocPhase } from './phases'
import type { Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString } from './workspace'

const nodes: LoopNode[] = [
  { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  { id: 'b', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
] as LoopNode[]
const edges: LoopEdge[] = [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1', route: 'orthogonal' } } as LoopEdge]
const P = (id: string, label: string, from: number, to: number): DocPhase => ({ id, label, from, to })
const OLD = [P('dry', 'Drying', 2, 5), P('brown', 'Browning', 6, 9)]
const NEW = [P('dry', 'Drying', 2, 7), P('brown', 'Browning', 8, 9)]
const MINE = [P('dry', 'Drying', 2, 4), P('brown', 'Browning', 5, 9)]
const table = (at: string): Timetable => ({ id: 't', label: 'T', source: 's', unit: 'kg per min', timeUnit: 'min', read: 'hold', end: '13', after: 'zero', points: [['0', '0'], ['1', '1.2'], [at, '0.25']] })
const time = { step: { value: 1, unit: 'min' as const } }
const kinds = [{ name: 'mass', conserved: true, units: [{ name: 'kg', factor: '1' }] }]
/** the content of a document at model version 6, where tables and a step length are read */
const doc = (o: { phases?: DocPhase[]; at?: string; nodes?: LoopNode[] } = {}) =>
  canonicalContent({ nodes: o.nodes ?? nodes, edges, kinds, time, ...(o.at ? { timetables: [table(o.at)] } : {}), ...(o.phases ? { phases: o.phases } : {}) }, { modelVersion: 6 })
const side = (phases?: unknown) => readRevisionSide({ nodes, edges, rawDataImportSignal: false, ...(phases !== undefined ? { phases } : {}) } as never)

describe('R13-1 — version inference', () => {
  it('a side with a surviving phase is loop-revision/13; without one it is what it was', () => {
    const with13 = side(OLD)
    expect(with13.ok && with13.version).toBe('loop-revision/13')
    const without = side()
    expect(without.ok && without.version).toBe('loop-revision/3')
    // a `phases` block of which nothing survives the read is no phases
    for (const none of [[], [{ id: 'x' }], 'junk']) {
      const s = side(none)
      expect(s.ok && s.version).toBe('loop-revision/3')
    }
  })
  it('the side’s content carries the phases, so a stored digest verifies with them in and fails with them changed', () => {
    const s = side(OLD)
    if (!s.ok) throw new Error('side')
    expect(s.content.phases).toEqual(OLD)
    const digest = digestOfCanonical(s.content)
    const ok = readRevisionSide({ nodes, edges, phases: OLD } as never, digest)
    expect(ok.ok && ok.digestVerified).toBe(true)
    expect(readRevisionSide({ nodes, edges, phases: NEW } as never, digest).ok).toBe(false)
  })
  it('the header this build writes declares /13', () => {
    expect(REVISION_SEMANTICS).toBe('loop-revision/13')
  })
})

describe('R13-2 / R13-INV — the projection', () => {
  it('phases are the last key before the model-semantics label, in file order and wire key order', () => {
    const c = doc({ phases: [{ to: 5, from: 2, label: 'Drying', id: 'dry' } as DocPhase, OLD[1]!], at: '5' })
    const keys = Object.keys(c)
    expect(keys.slice(-3)).toEqual(['timetables', 'phases', 'modelSemantics'])
    expect(JSON.stringify(c.phases)).toBe('[{"id":"dry","label":"Drying","from":2,"to":5},{"id":"brown","label":"Browning","from":6,"to":9}]')
  })
  it('R13-INV-1 — no surviving phase ⇒ the canonical bytes are the ones before this document', () => {
    expect(canonicalJson(doc({ phases: [], at: '5' }))).toBe(canonicalJson(doc({ at: '5' })))
    expect(canonicalJson(doc({ phases: [P('x', ' ', 1, 1)], at: '5' }))).toBe(canonicalJson(doc({ at: '5' })))
  })
  it('R13-INV-2 — the engine digest does not see phases', () => {
    const g = { nodes, edges, kinds, time, timetables: [table('5')] }
    expect(canonicalGraphString({ ...g, phases: OLD } as never, 6)).toBe(canonicalGraphString(g, 6))
  })
})

describe('R13-4 — the diff and the three-way hunk', () => {
  it('a phases-only change is one hunk: not an empty diff, never engine-, advisory- or provenance-affecting', () => {
    const d = computeRevisionDiff(doc({ phases: OLD, at: '5' }), doc({ phases: NEW, at: '5' }))
    expect(d.phases).toEqual({ base: OLD, proposed: NEW })
    expect(d.summary).toMatchObject({ phasesChanged: true, empty: false, engineAffecting: false, advisoryAffecting: false, provenanceAffecting: false, timetablesChanged: false })
    // added, and removed
    expect(computeRevisionDiff(doc(), doc({ phases: NEW })).phases).toEqual({ base: null, proposed: NEW })
    expect(computeRevisionDiff(doc({ phases: OLD }), doc()).phases).toEqual({ base: OLD, proposed: null })
    expect(computeRevisionDiff(doc({ phases: OLD }), doc({ phases: OLD })).summary).toMatchObject({ phasesChanged: false, empty: true })
  })

  it('the hunk is clean on a target still at the base, a no-op on one already there, a conflict on a third list', () => {
    const base = doc({ phases: OLD })
    const proposed = doc({ phases: NEW })
    expect(computeThreeWay(base, doc({ phases: OLD }), proposed).phases).toMatchObject({ kind: 'phases', verdict: 'clean', yours: OLD, proposed: NEW })
    expect(computeThreeWay(base, doc({ phases: NEW }), proposed).phases?.verdict).toBe('noop')
    const third = computeThreeWay(base, doc({ phases: MINE }), proposed)
    expect(third.phases?.verdict).toBe('conflict')
    // a conflict is counted: a whole Apply over the user's own phases is confirmed first
    expect(third.nConf).toBe(1)
    expect(countThreeWayConflicts(base, doc({ phases: MINE }), proposed)).toBe(1)
    expect(computeThreeWay(base, doc({ phases: OLD }), proposed).nConf).toBe(0)
    // no hunk when the proposal did not change the phases
    expect(computeThreeWay(base, doc({ phases: MINE }), doc({ phases: OLD })).phases).toBeUndefined()
  })

  it('a chosen Apply returns the proposal’s phases only when the hunk is taken, and an empty list to clear them', () => {
    const plan = computeThreeWay(doc({ phases: OLD }), doc({ phases: OLD }), doc({ phases: NEW }))
    const run = (phases: 'proposed' | 'yours' | undefined, theirs: DocPhase[] | undefined) =>
      buildSelectiveApply({ target: { nodes, edges }, proposedFull: { nodes, edges, ...(theirs ? { phases: theirs } : {}) }, plan, selection: { accept: {}, fieldChoices: {}, ...(phases ? { phases } : {}) } })
    const taken = run('proposed', NEW)
    expect(taken.ok && taken.phases).toEqual(NEW)
    const kept = run('yours', NEW)
    expect(kept.ok && 'phases' in kept).toBe(false)
    const unset = run(undefined, NEW)
    expect(unset.ok && 'phases' in unset).toBe(false)
    const cleared = run('proposed', undefined)
    expect(cleared.ok && cleared.phases).toEqual([])
  })
})

describe('R13-5 — the graph-level engine keys are named in the summary', () => {
  it('a proposal that changed only its timetables is not an empty diff, and is engine-affecting', () => {
    const d = computeRevisionDiff(doc({ at: '5' }), doc({ at: '7' }))
    expect(d.summary).toMatchObject({ timetablesChanged: true, stepLengthChanged: false, kindsChanged: false, phasesChanged: false, empty: false, engineAffecting: true })
    expect(d.nodes.changed).toEqual([])
  })
  it('so is one that changed only the step length, or only the kinds table', () => {
    const base = canonicalContent({ nodes, edges, kinds, time }, { modelVersion: 6 })
    const step = canonicalContent({ nodes, edges, kinds, time: { step: { value: 5, unit: 'min' } } }, { modelVersion: 6 })
    expect(computeRevisionDiff(base, step).summary).toMatchObject({ stepLengthChanged: true, timetablesChanged: false, empty: false, engineAffecting: true })
    const other = canonicalContent({ nodes, edges, kinds: [{ ...kinds[0]!, conserved: false }], time }, { modelVersion: 6 })
    expect(computeRevisionDiff(base, other).summary).toMatchObject({ kindsChanged: true, empty: false, engineAffecting: true })
    expect(computeRevisionDiff(base, base).summary).toMatchObject({ kindsChanged: false, stepLengthChanged: false, timetablesChanged: false, empty: true, engineAffecting: false })
  })
})

describe('R13-6 — phase names and timing from different sides', () => {
  const target = doc({ phases: OLD, at: '5' })
  it('a whole Apply of a proposal that moved the tables and left the phases: the timing changes, the names stay', () => {
    expect(phaseTimingSplit(target, doc({ phases: OLD, at: '7' }), { mode: 'whole' })).toBe('timing-only')
    // also when it is the step length that changed
    const step = canonicalContent({ nodes, edges, kinds, time: { step: { value: 5, unit: 'min' } }, timetables: [table('5')], phases: OLD }, { modelVersion: 6 })
    expect(phaseTimingSplit(target, step, { mode: 'whole' })).toBe('timing-only')
  })
  it('a whole Apply of a proposal that moved both, or only the phases, splits nothing', () => {
    expect(phaseTimingSplit(target, doc({ phases: NEW, at: '7' }), { mode: 'whole' })).toBeNull()
    expect(phaseTimingSplit(target, doc({ phases: NEW, at: '5' }), { mode: 'whole' })).toBeNull()
    expect(phaseTimingSplit(target, doc({ phases: OLD, at: '5' }), { mode: 'whole' })).toBeNull()
  })
  it('a whole Apply onto a document without phases has no name to go wrong', () => {
    expect(phaseTimingSplit(doc({ at: '5' }), doc({ at: '7' }), { mode: 'whole' })).toBeNull()
    // and one that removes the phases leaves none
    expect(phaseTimingSplit(target, doc({ at: '7' }), { mode: 'whole' })).toBeNull()
  })
  it('choosing changes never takes the timing: keeping the phases splits nothing, taking them puts the proposal’s names on the target’s tables', () => {
    const proposed = doc({ phases: NEW, at: '7' })
    expect(phaseTimingSplit(target, proposed, { mode: 'hunks', phases: 'yours' })).toBeNull()
    expect(phaseTimingSplit(target, proposed, { mode: 'hunks', phases: undefined })).toBeNull()
    expect(phaseTimingSplit(target, proposed, { mode: 'hunks', phases: 'proposed' })).toBe('phases-only')
    // the same tables on both sides: taking the phases is only a renaming
    expect(phaseTimingSplit(target, doc({ phases: NEW, at: '5' }), { mode: 'hunks', phases: 'proposed' })).toBeNull()
    // taking a proposal's EMPTY list leaves no name on the target's tables
    expect(phaseTimingSplit(target, doc({ at: '7' }), { mode: 'hunks', phases: 'proposed' })).toBeNull()
  })
})

describe('R13-7 — what a reader that does not know /13 is told', () => {
  // the header check of this build, given the content a build before /13 projects (no phases):
  // the digest fails, and the header's declaration says why
  it('a /14 header whose digest fails is "a newer version", so a /13 header is that to a /12 build by the same rule', () => {
    const withPhases = digestOfCanonical(doc({ phases: OLD }))
    const asOlderBuildProjects = doc() // no `phases` in its projection
    const r = readProject(
      { schema: 'loop-revision/1', version: 1, projectId: 'proj_00000000000000000000000000', revisionId: 'rev_00000000000000000000000000', parentId: null, role: 'revision', contentDigest: withPhases, lineage: [], semantics: 'loop-revision/14' },
      asOlderBuildProjects,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('newer-semantics')
  })
})
