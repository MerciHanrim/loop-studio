import { describe, expect, it } from 'vitest'
import {
  JOB_LIMIT_SECONDS,
  JOB_OVERHEAD_SECONDS,
  compareMultisets,
  countPerFile,
  filterFor,
  flattenList,
  median,
  parseShardArg,
  predictedJobSeconds,
  shardCountFromWorkflow,
  splitFiles,
  weigh,
} from './e2e-shards.mjs'

// Issue #311 — the split and its checks, on made-up suites. The command that
// runs them against the real suite is `node scripts/e2e-shards.mjs check`.

/** a --list report: files → { project → test count } */
function listReport(files) {
  let id = 0
  return {
    suites: Object.entries(files).map(([file, projects]) => ({
      title: file,
      file,
      specs: Object.entries(projects).flatMap(([project, n]) =>
        Array.from({ length: n }, (_, i) => ({ title: `t${i}`, id: `s${id++}`, file, tests: [{ projectName: project }] })),
      ),
    })),
  }
}

describe('the suite as listed', () => {
  it('flattens every test with its file and project', () => {
    const tests = flattenList(listReport({ 'a.spec.ts': { chromium: 2, mobile: 1 }, 'b.spec.ts': { chromium: 3 } }))
    expect(tests).toHaveLength(6)
    expect(tests.filter((t) => t.file === 'a.spec.ts' && t.project === 'mobile')).toHaveLength(1)
    expect(new Set(tests.map((t) => t.key)).size).toBe(6)
  })

  it('counts the portable setup with the spec that depends on it', () => {
    const counts = countPerFile(flattenList(listReport({ 'portable-file.spec.ts': { portable: 10 }, 'portable.setup.ts': { 'build-portable': 1 }, 'x.spec.ts': { chromium: 2 } })))
    expect([...counts]).toEqual([
      ['portable-file.spec.ts', 11],
      ['x.spec.ts', 2],
    ])
  })
})

describe('weights', () => {
  const counts = new Map([
    ['heavy.spec.ts', 10],
    ['light.spec.ts', 10],
    ['new.spec.ts', 4],
  ])
  const doc = { files: { 'heavy.spec.ts': [100, 120, 80], 'light.spec.ts': [10, 12, 8], 'gone.spec.ts': [5] } }

  it('a file with samples is weighted by their median and remembers the slowest', () => {
    const { weights } = weigh(counts, doc)
    expect(weights.get('heavy.spec.ts')).toEqual({ median: 100, slowest: 120, samples: 3 })
    expect(weights.get('light.spec.ts')).toEqual({ median: 10, slowest: 12, samples: 3 })
  })

  it('a file without a sample is estimated at the suite’s median seconds per test, and named', () => {
    const { weights, unsampled, fallbackPerTest } = weigh(counts, doc)
    expect(fallbackPerTest).toBe(median([10, 1])) // 100/10 and 10/10
    expect(weights.get('new.spec.ts')).toEqual({ median: fallbackPerTest * 4, slowest: fallbackPerTest * 4, samples: 0 })
    expect(unsampled).toEqual(['new.spec.ts'])
  })

  it('a weight for a file the suite no longer lists is stale', () => {
    expect(weigh(counts, doc).stale).toEqual(['gone.spec.ts'])
  })

  it('an empty weights document estimates every file at one second per test', () => {
    const { weights, fallbackPerTest } = weigh(counts, { files: {} })
    expect(fallbackPerTest).toBe(1)
    expect(weights.get('heavy.spec.ts').median).toBe(10)
  })

  it('median of an even and an odd list', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('the split', () => {
  const w = (entries) => new Map(entries.map(([f, m, s]) => [f, { median: m, slowest: s ?? m, samples: 1 }]))
  const c = (entries) => new Map(entries.map(([f]) => [f, 1]))

  it('places the longest file first and every next file into the least-loaded shard', () => {
    const entries = [
      ['a.spec.ts', 50],
      ['b.spec.ts', 40],
      ['c.spec.ts', 30],
      ['d.spec.ts', 20],
      ['e.spec.ts', 10],
    ]
    // a → 1 (50) · b → 2 (40) · c → 2, the lighter (70) · d → 1 (70) · e → a tie, the lower index (80)
    const shards = splitFiles(w(entries), c(entries), 2)
    expect(shards.map((s) => s.files)).toEqual([
      ['a.spec.ts', 'd.spec.ts', 'e.spec.ts'],
      ['b.spec.ts', 'c.spec.ts'],
    ])
    expect(shards.map((s) => s.median)).toEqual([80, 70])
  })

  it('is a partition: every file once, whatever the order of the input', () => {
    const entries = Array.from({ length: 37 }, (_, i) => [`f${String(i).padStart(2, '0')}.spec.ts`, ((i * 7919) % 97) + 1])
    const a = splitFiles(w(entries), c(entries), 4)
    const b = splitFiles(w([...entries].reverse()), c(entries), 4)
    const all = a.flatMap((s) => s.files).sort()
    expect(all).toEqual(entries.map(([f]) => f).sort())
    expect(b.map((s) => s.files)).toEqual(a.map((s) => s.files)) // deterministic
  })

  it('breaks a tie in weight by name, and a tie in load by the lower shard', () => {
    const entries = [
      ['b.spec.ts', 10],
      ['a.spec.ts', 10],
      ['c.spec.ts', 10],
    ]
    const shards = splitFiles(w(entries), c(entries), 3)
    expect(shards.map((s) => s.files)).toEqual([['a.spec.ts'], ['b.spec.ts'], ['c.spec.ts']])
  })

  it('sums the slowest samples separately, for the budget', () => {
    const shards = splitFiles(w([['a.spec.ts', 10, 30]]), c([['a.spec.ts']]), 1)
    expect(shards[0]).toMatchObject({ median: 10, slowest: 30 })
    expect(predictedJobSeconds(shards[0])).toBe(30 + JOB_OVERHEAD_SECONDS)
    expect(JOB_LIMIT_SECONDS).toBe(1200)
  })

  it('refuses a shard count that is not a positive integer', () => {
    expect(() => splitFiles(new Map(), new Map(), 0)).toThrow(/positive integer/)
    expect(() => splitFiles(new Map(), new Map(), 2.5)).toThrow(/positive integer/)
  })
})

describe('the file filter handed to Playwright', () => {
  it('matches exactly those files, under e2e/, with either path separator', () => {
    const re = new RegExp(filterFor(['i18n.spec.ts', 'whats-new.spec.ts']).slice(1, -1))
    expect(re.test('C:\\repo\\e2e\\i18n.spec.ts')).toBe(true)
    expect(re.test('/repo/e2e/whats-new.spec.ts')).toBe(true)
    expect(re.test('/repo/e2e/i18n-fr.spec.ts')).toBe(false)
    expect(re.test('/repo/e2e/i18nXspec.ts')).toBe(false) // the dot is a dot
    expect(re.test('/repo/e2e/sub/i18n.spec.ts')).toBe(false)
    expect(re.test('/repo/src/i18n.spec.ts')).toBe(false)
  })

  it('an empty shard has no filter', () => {
    expect(filterFor([])).toBeNull()
  })
})

describe('arguments and the workflow', () => {
  it('parses i/N and refuses what is outside it', () => {
    expect(parseShardArg('2/4')).toEqual({ i: 2, n: 4 })
    expect(() => parseShardArg('0/4')).toThrow(/within/)
    expect(() => parseShardArg('5/4')).toThrow(/within/)
    expect(() => parseShardArg('2')).toThrow(/i\/N/)
  })

  it('reads the matrix and the count the run step passes', () => {
    const yaml = 'matrix:\n  shard: [1, 2, 3, 4]\n  run: node scripts/e2e-shards.mjs run ${{ matrix.shard }}/4\n'
    expect(shardCountFromWorkflow(yaml)).toEqual({ matrix: [1, 2, 3, 4], passed: 4 })
    expect(shardCountFromWorkflow('nothing here')).toEqual({ matrix: [], passed: null })
  })
})

describe('the union check', () => {
  it('passes when every key is in exactly one part', () => {
    expect(compareMultisets(['a', 'b', 'c'], [['a'], ['c', 'b']])).toEqual([])
  })

  it('names a missing, a duplicated and a foreign test', () => {
    const problems = compareMultisets(['a', 'b', 'c'], [['a', 'a'], ['x']])
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/missing.*: b$/), expect.stringMatching(/missing.*: c$/), expect.stringMatching(/2 times.*: a$/), expect.stringMatching(/not in the suite: x$/)]))
    expect(problems).toHaveLength(4)
  })

  it('a key the suite lists twice must appear twice', () => {
    expect(compareMultisets(['a', 'a'], [['a'], ['a']])).toEqual([])
    expect(compareMultisets(['a', 'a'], [['a']])).toEqual([expect.stringMatching(/listed 1 times across the shards, 2 in the suite/)])
  })
})
