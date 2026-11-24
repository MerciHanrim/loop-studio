import { describe, expect, it } from 'vitest'
import { ACTIONS_APP_ID, decide } from './ci-main-e2e-decision.mjs'

// #615 follow-up (Lumi 2026-11-25) — a push to main skips the e2e jobs only when
// the merge commit holds the tree of a pull request head whose required checks
// passed; everything else, including anything that cannot be determined, runs
// them in full. Made-up GitHub API answers and git, one rule per test.

const A = 'a'.repeat(40) // the previous main
const M = 'b'.repeat(40) // the merge commit on main
const H = 'c'.repeat(40) // the pull request head
const T = 'd'.repeat(40) // the tree both hold
const OTHER_TREE = 'e'.repeat(40)
const ctx = { event: 'push', sha: M, before: A, repo: 'o/r' }

const pr = (over = {}) => ({ number: 7, merged_at: '2026-11-25T00:00:00Z', base: { ref: 'main' }, merge_commit_sha: M, head: { sha: H }, ...over })
const check = (name, over = {}) => ({ id: 1, name, status: 'completed', conclusion: 'success', app: { id: ACTIONS_APP_ID }, ...over })
const greenRuns = () => ({ total_count: 2, check_runs: [check('checks'), check('e2e', { id: 2 })] })

/** a world where every condition holds; `over` replaces parts of it */
function world(over = {}) {
  const w = {
    pulls: [pr()],
    runs: greenRuns(),
    parents: [A],
    fetched: H,
    ancestor: true,
    mergeTree: T,
    headTree: T,
    fetchThrows: false,
    ...over,
  }
  const calls = []
  const api = (path) => {
    calls.push(path)
    if (path === `repos/o/r/commits/${M}/pulls`) return typeof w.pulls === 'function' ? w.pulls() : w.pulls
    if (path === `repos/o/r/commits/${H}/check-runs?per_page=100`) return w.runs
    throw new Error(`unexpected api ${path}`)
  }
  const git = (args) => {
    const a = args.join(' ')
    if (a === `rev-list --parents -n 1 ${M}`) return [M, ...w.parents].join(' ') + '\n'
    if (args[0] === 'fetch') {
      if (w.fetchThrows) throw new Error('fatal: could not fetch refs/pull/7/head')
      return ''
    }
    if (a === 'rev-parse refs/ci/pr-head') return w.fetched + '\n'
    if (a === `merge-base --is-ancestor ${A} ${H}`) {
      if (!w.ancestor) throw new Error('exit 1')
      return ''
    }
    if (a === `rev-parse ${M}^{tree}`) return w.mergeTree + '\n'
    if (a === `rev-parse ${H}^{tree}`) return w.headTree + '\n'
    throw new Error(`unexpected git ${a}`)
  }
  return { io: { api, git }, calls }
}

/** full e2e, for the reason the test is about (never a harness gap: an unexpected call) */
function expectFull(r, reason) {
  expect(r.runE2e).toBe(true)
  expect(r.reason).not.toContain('unexpected')
  expect(r.reason).toMatch(reason)
}

describe('the same tree: e2e skipped', () => {
  it('a squash merge holding the head tree of a pull request whose required checks passed', () => {
    const r = decide(ctx, world().io)
    expect(r.runE2e).toBe(false)
    expect(r.reason).toContain('#7')
  })

  it('a rerun: the latest run of each required check decides', () => {
    const runs = { total_count: 3, check_runs: [check('checks'), check('e2e', { id: 2, conclusion: 'failure' }), check('e2e', { id: 5 })] }
    expect(decide(ctx, world({ runs }).io).runE2e).toBe(false)
  })
})

describe('a different tree, or a head whose CI tested a different merge: full e2e', () => {
  it('the merge tree differs from the head tree', () => {
    expectFull(decide(ctx, world({ mergeTree: OTHER_TREE }).io), /merge tree .* is not head .* tree/)
  })

  it('the previous main is not in the head (main moved after the pull request CI)', () => {
    expectFull(decide(ctx, world({ ancestor: false }).io), /tested a different merge/)
  })

  it('the latest required check is not a success', () => {
    for (const [runs, why] of [
      [{ total_count: 2, check_runs: [check('checks'), check('e2e', { id: 2, conclusion: 'failure' })] }, /latest "e2e" check is completed\/failure/],
      [{ total_count: 2, check_runs: [check('checks', { status: 'in_progress', conclusion: null }), check('e2e', { id: 2 })] }, /latest "checks" check is in_progress\/null/],
      [{ total_count: 3, check_runs: [check('checks'), check('e2e', { id: 9, conclusion: 'cancelled' }), check('e2e', { id: 2 })] }, /latest "e2e" check is completed\/cancelled/],
    ]) expectFull(decide(ctx, world({ runs }).io), why)
  })
})

describe('anything that cannot be determined: full e2e', () => {
  it('not a push: a pull request, the schedule, a manual run', () => {
    for (const event of ['pull_request', 'schedule', 'workflow_dispatch']) {
      const { io, calls } = world()
      expectFull(decide({ ...ctx, event }, io), new RegExp(`event "${event}"`))
      expect(calls).toEqual([]) // nothing is even looked up
    }
  })

  it('no previous main, or the push is not one commit on top of it', () => {
    expectFull(decide({ ...ctx, before: '' }, world().io), /no previous main commit/)
    expectFull(decide({ ...ctx, before: '0'.repeat(40) }, world().io), /no previous main commit/)
    expectFull(decide(ctx, world({ parents: [A, H] }).io), /not a single commit/) // a merge commit
    expectFull(decide(ctx, world({ parents: [H] }).io), /not a single commit/) // several commits pushed
    expectFull(decide(ctx, world({ parents: [] }).io), /not a single commit .*parents: none/) // a root commit
  })

  it('no pull request, more than one, or one that is not merged into main with this commit', () => {
    for (const [pulls, why] of [
      [[], /0 merged pull requests/],
      [[pr(), pr({ number: 8 })], /2 merged pull requests/],
      [[pr({ merged_at: null })], /0 merged pull requests/],
      [[pr({ base: { ref: 'release' } })], /0 merged pull requests/],
      [[pr({ merge_commit_sha: H })], /0 merged pull requests/],
      [{ message: 'Not Found' }, /did not return a list/],
    ]) expectFull(decide(ctx, world({ pulls }).io), why)
  })

  it('the pull request lookup fails', () => {
    const r = decide(ctx, world({ pulls: () => { throw new Error('HTTP 502') } }).io)
    expect(r).toEqual({ runE2e: true, reason: 'undetermined: HTTP 502' })
  })

  it('a required check is missing, or comes from another app, or the list is incomplete', () => {
    for (const [runs, why] of [
      [{ total_count: 1, check_runs: [check('checks')] }, /no "e2e" check from GitHub Actions/],
      [{ total_count: 2, check_runs: [check('checks'), check('e2e', { id: 2, app: { id: 1 } })] }, /no "e2e" check from GitHub Actions/],
      [{ total_count: 150, check_runs: [check('checks'), check('e2e', { id: 2 })] }, /could not all be read/],
      [null, /could not all be read/],
    ]) expectFull(decide(ctx, world({ runs }).io), why)
  })

  it('the head cannot be fetched, or is not the head the pull request names', () => {
    expectFull(decide(ctx, world({ fetchThrows: true }).io), /undetermined: fatal: could not fetch/)
    expectFull(decide(ctx, world({ fetched: A }).io), /the fetched head .* is not/)
  })

  it('a tree cannot be read', () => {
    expectFull(decide(ctx, world({ mergeTree: '', headTree: '' }).io), /merge tree {2}is not head/)
  })
})
