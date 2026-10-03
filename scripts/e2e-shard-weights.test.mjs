import { describe, expect, it } from 'vitest'
import { addRun, secondsPerFile } from './e2e-shard-weights.mjs'

// Issue #311 — feeding a run's reports back into the weights, on made-up reports.

const report = (files) => ({
  suites: Object.entries(files).map(([file, durations]) => ({
    file,
    specs: durations.map((ms, i) => ({ id: `${file}:${i}`, tests: [{ projectName: 'chromium', results: ms.map((d) => ({ duration: d })) }] })),
  })),
})

describe('seconds per file from a finished report', () => {
  it('sums every result of every test, so a retry counts the time it took', () => {
    const s = secondsPerFile(report({ 'a.spec.ts': [[1500], [500, 2000]], 'b.spec.ts': [[250]] }))
    expect(s.get('a.spec.ts')).toBe(4)
    expect(s.get('b.spec.ts')).toBe(0.25)
  })

  it('adds the portable setup to the portable spec', () => {
    const s = secondsPerFile(report({ 'portable.setup.ts': [[20000]], 'portable-file.spec.ts': [[1000]] }))
    expect([...s]).toEqual([['portable-file.spec.ts', 21]])
  })
})

describe('adding a run', () => {
  const doc = { source: { runs: [{ sha: 'aaaaaaa' }], samplesPerFile: 3 }, files: { 'a.spec.ts': [10, 11, 12], 'b.spec.ts': [5] } }

  it('prepends the new sample and drops the oldest beyond the limit', () => {
    const { doc: next, added } = addRun(doc, { sha: 'bbbbbbb', run: 1, date: '2026-10-03' }, new Map([['a.spec.ts', 9.96], ['c.spec.ts', 3]]))
    expect(added).toBe(2)
    expect(next.files['a.spec.ts']).toEqual([10, 10, 11])
    expect(next.files['c.spec.ts']).toEqual([3])
    expect(next.files['b.spec.ts']).toEqual([5]) // absent from this run: kept, not dropped
    expect(next.source.runs.map((r) => r.sha)).toEqual(['bbbbbbb', 'aaaaaaa'])
    expect(doc.files['a.spec.ts']).toEqual([10, 11, 12]) // the input is not mutated
  })

  it('ignores a run it already holds', () => {
    const { skipped, doc: same } = addRun(doc, { sha: 'aaaaaaa' }, new Map([['a.spec.ts', 1]]))
    expect(skipped).toMatch(/already/)
    expect(same).toBe(doc)
  })
})
