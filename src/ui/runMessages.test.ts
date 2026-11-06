import { describe, expect, it } from 'vitest'
import { buildRunCsv } from '../components/timelineCsv'
import { initSim, step } from '../engine/step'
import type { RunGroupReport, RunNotice } from '../engine/types'
import { unwrapIsolates } from '../i18n/bidiIsolate'
import en from '../i18n/locales/en'
import type { RunFindingCode } from '../model/runRule'
import { GraphFileError } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { importErrorMessage } from './importError'
import { runNoticeText, runRefusalText, runStreak } from './runMessages'

// SEMANTICS-M6.md — what a person reads about a run rule. The words are the catalog's,
// with each slot filled, so a test here reads as the run bar does.

const t = (key: string, params: Record<string, string | number> = {}): string =>
  unwrapIsolates(Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (en as Record<string, string>)[key] ?? key))
const nodes = [{ id: 'ro', data: { kind: 'converter', label: 'Reverse osmosis' } }] as unknown as LoopNode[]

describe('a refusal names the stage, and says what to fix', () => {
  const cases: [RunFindingCode, RegExp][] = [
    ['group-shape', /cannot steer a group with a Gate/],
    ['unknown-tank', /reads a tank/],
    ['bad-tank', /reads a tank/],
    ['bad-tank-unit', /reads a tank/],
    ['unknown-table', /timetable/],
    ['no-step', /timetable/],
    ['no-kind', /timetable/],
    ['bad-unit', /timetable/],
    ['two-kinds', /timetable/],
    ['rated-needed', /100 % line/],
    ['rated-unused', /100 % line/],
    ['rated-missing', /100 % line/],
    ['rated-outside', /100 % line/],
    ['rated-not-a-number', /100 % line/],
    ['rated-no-time', /100 % line/],
    ['rated-zero', /100 % line/],
    ['rated-out-of-range', /100 % line/],
    ['not-a-converter', /cannot be used/],
    ['bad-rule', /cannot be used/],
  ]
  for (const [code, words] of cases) {
    it(code, () => {
      const text = runRefusalText({ code, stage: 'ro' }, nodes, t as never)
      expect(text).toMatch(words)
      expect(text).toContain('Reverse osmosis')
    })
  }

  it('a stage that is gone is named by its id', () => {
    expect(runRefusalText({ code: 'group-shape', stage: 'gone' }, [], t as never)).toContain('gone')
  })
})

describe('a notice says what held the stage, and for how long', () => {
  const held = (state: 'short' | 'stopped', why: 'supply' | 'room' = 'supply'): RunNotice => ({ kind: 'runHeld', group: 'ro', label: 'RO', state, limit: { why, pool: 'Feed', needed: 50, had: 30 } })

  it('short and stopped, supply and room', () => {
    expect(runNoticeText(held('short'), 3, t as never)).toBe('RO ran below its target: Feed held 30 of the 50 it needed. Steps in a row: 3.')
    expect(runNoticeText(held('short', 'room'), 1, t as never)).toBe('RO ran below its target: Feed had room for 30 of 50. Steps in a row: 1.')
    expect(runNoticeText(held('stopped'), 2, t as never)).toBe('RO did not run: Feed held 30 of the 50 it needed. Steps in a row: 2.')
    expect(runNoticeText(held('stopped', 'room'), 2, t as never)).toBe('RO did not run: Feed had room for 30 of 50. Steps in a row: 2.')
  })

  it('the engine’s floor has no Pool to name', () => {
    expect(runNoticeText({ kind: 'runHeld', group: 'ro', label: 'RO', state: 'stopped', limit: null }, 4, t as never)).toBe('RO did not run: its target is too small to move anything. Steps in a row: 4.')
  })

  it('a rule above a full run', () => {
    expect(runNoticeText({ kind: 'runCapped', group: 'ro', label: 'RO', wanted: 1.3 }, 1, t as never)).toBe('The run rule on RO asks for 130 % of a full run, and it stops at 100 %.')
  })

  it('the words never say a target was filled exactly', () => {
    expect(Object.entries(en as Record<string, string>).filter(([k, v]) => k.startsWith('playbar.diag.run') && /exact|filled/i.test(v))).toEqual([])
  })
})

const report = (state: RunGroupReport['state']): RunGroupReport => ({ members: ['ro'], rules: [{ stage: 'ro', wanted: 0.5, target: 0.5 }], target: 0.5, decidedBy: 'ro', capped: false, moved: 0.25, basis: 'feed', state, why: null, cause: null, pool: null, needed: null, had: null })

describe('the steps in a row', () => {
  it('counts back from the head, and a met step ends it', () => {
    const series = [{}, { runs: [report('short')] }, { runs: [report('met')] }, { runs: [report('short')] }, { runs: [report('stopped')] }]
    expect(runStreak(series, 'ro')).toBe(2)
  })
  it('the current step counts as one before the series holds it', () => {
    expect(runStreak([{}], 'ro')).toBe(1)
  })

  it('a group stays one group when the rule that decides it changes, through the real `step()`', () => {
    // `sig` rises by 1 a step, so the Fill rule on `a` falls from 0.7 as the Empty rule
    // on `b` rises from 0.3: `b` decides first, then `a`. Power for 5 of the 300 a run
    // takes holds the group below either target at every step.
    const pool = (id: string, initial: number) => ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } })
    const source = (id: string) => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } })
    const stage = (id: string, run: unknown) => ({ id, type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny', run } })
    const line = (id: string, from: string, to: string, flow: string) => ({ id, source: from, target: to, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow } })
    const nodes = [source('rise'), pool('sig', 3), source('grid'), pool('panel', 5), pool('tank', 1e6), stage('a', { tank: 'sig', level: '10', band: '10', side: 'fill' }), stage('b', { tank: 'sig', level: '0', band: '10', side: 'empty' }), pool('store', 0)] as unknown as LoopNode[]
    const edges = [line('up', 'rise', 'sig', '1'), line('sup', 'grid', 'panel', '5'), line('in', 'tank', 'a', '100'), line('mid', 'a', 'b', '100'), line('pw', 'panel', 'b', '300'), line('out', 'b', 'store', '100')] as unknown as LoopEdge[]

    const series: { runs?: RunGroupReport[] }[] = [{}]
    let st = initSim(nodes)
    for (let i = 0; i < 6; i++) {
      const r = step(nodes, edges, st, 1, 6)
      expect(r.report.diagnostics).toEqual([])
      series.push({ runs: r.report.runs })
      st = r.state
    }
    const reports = series.flatMap((p) => p.runs ?? [])
    expect(reports.every((r) => r.state === 'short')).toBe(true)
    expect(new Set(reports.map((r) => r.decidedBy))).toEqual(new Set(['a', 'b']))
    expect(new Set(reports.map((r) => r.members[0]))).toEqual(new Set(['a']))
    expect(runStreak(series, 'a')).toBe(6)
  })

  it('a member that is not the first does not name the group', () => {
    expect(runStreak([{ runs: [{ ...report('short'), members: ['a', 'ro'], decidedBy: 'ro' }] }], 'ro')).toBe(1)
    expect(runStreak([{ runs: [{ ...report('short'), members: ['a', 'ro'], decidedBy: 'ro' }] }, { runs: [{ ...report('short'), members: ['a', 'ro'], decidedBy: 'a' }] }], 'a')).toBe(2)
  })
})

describe('the run CSV', () => {
  const pools = [{ id: 'tank', label: 'Tank' }]
  const series = [{ step: 0, values: { tank: 10 } }, { step: 1, values: { tank: 5 }, runs: [report('short')] }]

  it('a ruled group adds its target, moved fraction and state, and step 0 has none', () => {
    const rows = buildRunCsv(pools, series, [], [{ id: 'ro', label: 'RO' }]).trim().split('\r\n')
    expect(rows[0]).toBe('step,Tank [tank],RO (target) [ro],RO (moved) [ro],RO (state) [ro]')
    expect(rows[1]).toBe('0,10,,,')
    expect(rows[2]).toBe('1,5,0.5,0.25,short')
  })

  it('a document with no rule writes the same bytes', () => {
    expect(buildRunCsv(pools, series, [], [])).toBe(buildRunCsv(pools, series))
    expect(buildRunCsv(pools, series)).not.toContain('target')
  })
})

describe('a file with a bad rule', () => {
  it('names the stage in the user’s language, with no detail in English', () => {
    const err = new GraphFileError('bad-run-rule', 'The run rule on "ro" was refused: x.', undefined, 'ro')
    expect(importErrorMessage(err, t as never)).toBe('The run rule on ro was refused: one of its fields is missing or not valid.')
  })
})
