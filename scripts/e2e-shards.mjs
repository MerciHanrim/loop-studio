// Issue #311 — the e2e suite is split into shards by PREDICTED TIME, not by
// test count, and the split is checked to be a partition of the whole suite.
//
//   node scripts/e2e-shards.mjs plan [N]            print the split for N shards
//   node scripts/e2e-shards.mjs run  i/N [args...]  run shard i of N (what CI calls)
//   node scripts/e2e-shards.mjs check               the union check + the time budget
//
// WHY THIS EXISTS
//
// Playwright's own `--shard=i/N` cuts the ordered list of test groups into N
// pieces of equal test COUNT. Per-test cost in this suite spans more than
// twenty times (a pixel-comparison test at 15 s, a locale check under a
// second), so equal counts give unequal time. MEASURED on 2026-10-03, with
// `--shard` and 1,829 tests: the four shards carried 464 / 454 / 457 / 454
// tests but 981 / 695 / 848 / 614 seconds of tests; the longest shard job took
// 18 min 44 s on `main 16020f2` against a 20-minute job limit, and two runs of
// the same tree differed by 56 % on one shard. A slow runner on an unbalanced
// shard is a red CI with no change in the code.
//
// HOW THE SPLIT IS DECIDED
//
// The unit is the spec FILE (every project it runs under is counted with it,
// and `portable.setup.ts` goes with `portable-file.spec.ts`, which depends on
// it). Each file has a weight: the MEDIAN of its measured seconds over the last
// runs recorded in `e2e/shard-weights.json`, one sample per CI run, so that no
// single runner, fast or slow, sets the number. A file with no sample yet is
// weighted by the suite's median seconds per test times its test count. The
// files are then placed longest-first, each into the shard with the least
// weight so far (LPT). The input is the live `--list` of the suite, so the
// split follows every added or removed spec by itself; only the weights file is
// data, and `scripts/e2e-shard-weights.mjs` refreshes it from the reports the
// shard jobs upload.
//
// WHAT `check` PROVES
//
// 1. Partition. For every shard, Playwright itself is asked (`--list` with that
//    shard's file filter) which tests it would run; the multiset union of the N
//    answers must equal the full `--list`, with no test missing, none twice and
//    none that the full list does not have. That is the real filter on the real
//    config, not this script's idea of it.
// 2. Budget. For every shard, the sum of its files' SLOWEST recorded samples
//    plus the fixed cost of a shard job must stay under the job limit by a
//    margin. The slowest samples stand for the slowest runner in the sample,
//    and the margin is the room the next spec file needs before the split has
//    to grow.
// 3. Hygiene. Every weight belongs to a file the suite still has; a file with
//    no weight is reported (and estimated), and the shard count written in
//    `.github/workflows/ci.yml` is the one the matrix enumerates.
//
// WHAT THIS DOES NOT PROVE: that a shard will finish in time on a runner slower
// than any in the sample, or that a test that got slower since the last sample
// is weighted right; the weights are history, refreshed when a run's reports
// are fed back. It also says nothing about the dist and PWA jobs, which are not
// sharded.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
export const WEIGHTS_FILE = 'e2e/shard-weights.json'
export const WORKFLOW_FILE = '.github/workflows/ci.yml'
export const SETUP_FILE = 'portable.setup.ts'
export const HOST_FILE = 'portable-file.spec.ts'

// MEASURED over 16 CI runs (2026-09-30 to 2026-10-03), per shard job on
// windows-latest: checkout + Node + `npm ci` 22 to 55 s, the Chromium install
// 12 to 44 s, the dev server up and the first test running 9 to 27 s after the
// E2E step starts, teardown 2 to 6 s. 120 s covers the slow end of each.
export const JOB_OVERHEAD_SECONDS = 120
/** `timeout-minutes` of the shard job in ci.yml, in seconds */
export const JOB_LIMIT_SECONDS = 20 * 60
/** how far under the limit the slowest-sample prediction has to stay */
export const MARGIN_SECONDS = 120

// ── the suite, as Playwright lists it ───────────────────────────────────────

/** one listed test: enough to tell two apart and to say which file it is in */
export function flattenList(report) {
  const tests = []
  const walk = (suite, file) => {
    const f = suite.file ?? file
    for (const s of suite.suites ?? []) walk(s, f)
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) tests.push({ file: f, project: t.projectName, key: `${f}#${t.projectName}#${spec.id}` })
    }
  }
  for (const s of report.suites ?? []) walk(s, undefined)
  return tests
}

/** tests per file, with the portable setup counted under its dependent spec */
export function countPerFile(tests) {
  const counts = new Map()
  for (const t of tests) {
    const f = t.file === SETUP_FILE ? HOST_FILE : t.file
    counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return counts
}

/** `playwright test --list --reporter=json [filters]`, parsed; throws on a config error */
export function listSuite(filters = [], cwd = root) {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('@playwright/test/cli', { paths: [cwd] })
  const r = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json', ...filters], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PWTEST_SKIP_TEST_OUTPUT: '1' },
  })
  if (r.status !== 0) throw new Error(`playwright --list failed (exit ${r.status}):\n${r.stderr}\n${r.stdout.slice(0, 2000)}`)
  const start = r.stdout.indexOf('{')
  const report = JSON.parse(r.stdout.slice(start))
  if (report.errors?.length) throw new Error(`playwright --list reported errors:\n${report.errors.map((e) => e.message).join('\n')}`)
  return report
}

// ── weights ─────────────────────────────────────────────────────────────────

export function readWeights(cwd = root) {
  const path = resolve(cwd, WEIGHTS_FILE)
  if (!existsSync(path)) return { files: {} }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The weight of every file in `counts`: the median sample, or the suite's
 * median seconds per test times the file's test count when it has no sample.
 * Returns {weights: Map file → {median, slowest, samples}, unsampled: [files], stale: [files]}.
 */
export function weigh(counts, weightsDoc) {
  const files = weightsDoc.files ?? {}
  const perTest = []
  for (const [f, samples] of Object.entries(files)) {
    if (counts.has(f) && samples.length && counts.get(f) > 0) perTest.push(median(samples) / counts.get(f))
  }
  const fallbackPerTest = perTest.length ? median(perTest) : 1
  const weights = new Map()
  const unsampled = []
  for (const [f, n] of counts) {
    const samples = files[f] ?? []
    if (samples.length) weights.set(f, { median: median(samples), slowest: Math.max(...samples), samples: samples.length })
    else {
      unsampled.push(f)
      const w = fallbackPerTest * n
      weights.set(f, { median: w, slowest: w, samples: 0 })
    }
  }
  const stale = Object.keys(files).filter((f) => !counts.has(f))
  return { weights, unsampled, stale, fallbackPerTest }
}

// ── the split ───────────────────────────────────────────────────────────────

/**
 * Longest file first, each into the least-loaded shard; ties go to the lower
 * index, so the same inputs always give the same split on every machine.
 */
export function splitFiles(weights, counts, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a positive integer, got ${n}`)
  const order = [...weights.keys()].sort((a, b) => weights.get(b).median - weights.get(a).median || (a < b ? -1 : a > b ? 1 : 0))
  const shards = Array.from({ length: n }, () => ({ files: [], tests: 0, median: 0, slowest: 0 }))
  for (const f of order) {
    let best = 0
    for (let i = 1; i < n; i++) if (shards[i].median < shards[best].median) best = i
    const w = weights.get(f)
    shards[best].files.push(f)
    shards[best].tests += counts.get(f) ?? 0
    shards[best].median += w.median
    shards[best].slowest += w.slowest
  }
  for (const s of shards) s.files.sort()
  return shards
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** a Playwright file filter matching exactly these spec files, under e2e/, on either path separator */
export function filterFor(files) {
  if (!files.length) return null
  return `/[\\\\/]e2e[\\\\/](${files.map(escapeRegExp).join('|')})$/`
}

export function parseShardArg(arg) {
  const m = /^(\d+)\/(\d+)$/.exec(arg ?? '')
  if (!m) throw new Error(`expected i/N, got "${arg}"`)
  const [i, n] = [Number(m[1]), Number(m[2])]
  if (i < 1 || i > n) throw new Error(`shard ${i} is not within 1..${n}`)
  return { i, n }
}

/** the shard count the workflow enumerates, and the one it passes to `run` */
export function shardCountFromWorkflow(yaml) {
  const matrix = /shard:\s*\[([\d,\s]+)\]/.exec(yaml)
  const run = /e2e-shards\.mjs run \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(yaml)
  const list = matrix ? matrix[1].split(',').map((s) => Number(s.trim())).filter(Number.isFinite) : []
  return { matrix: list, passed: run ? Number(run[1]) : null }
}

/** every key of `whole` exactly once across `parts`; returns the problems */
export function compareMultisets(whole, parts) {
  const count = (keys) => {
    const m = new Map()
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }
  const all = count(whole)
  const seen = count(parts.flat())
  const problems = []
  for (const [k, n] of all) {
    const got = seen.get(k) ?? 0
    if (got === 0) problems.push(`missing from every shard: ${k}`)
    else if (got !== n) problems.push(`listed ${got} times across the shards, ${n} in the suite: ${k}`)
  }
  for (const k of seen.keys()) if (!all.has(k)) problems.push(`in a shard but not in the suite: ${k}`)
  return problems
}

export function predictedJobSeconds(shard) {
  return shard.slowest + JOB_OVERHEAD_SECONDS
}

// ── commands ────────────────────────────────────────────────────────────────

function fmt(s) {
  const m = Math.floor(s / 60)
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s`
}

function describe(shards) {
  const lines = []
  shards.forEach((s, i) => {
    const job = predictedJobSeconds(s)
    lines.push(
      `shard ${i + 1}/${shards.length}: ${s.files.length} files, ${s.tests} tests, median ${Math.round(s.median)} s, slowest samples ${Math.round(s.slowest)} s, predicted job ${fmt(job)} (${fmt(JOB_LIMIT_SECONDS - job)} under the limit)`,
    )
  })
  return lines
}

function planFor(n, cwd = root) {
  const list = listSuite([], cwd)
  const tests = flattenList(list)
  const counts = countPerFile(tests)
  const { weights, unsampled, stale, fallbackPerTest } = weigh(counts, readWeights(cwd))
  return { tests, counts, weights, unsampled, stale, fallbackPerTest, shards: splitFiles(weights, counts, n) }
}

function cmdPlan(n) {
  const p = planFor(n)
  console.log(`${p.tests.length} tests in ${p.counts.size} spec files, ${n} shards`)
  for (const l of describe(p.shards)) console.log(l)
  p.shards.forEach((s, i) => console.log(`\nshard ${i + 1}: ${s.files.join(' ')}`))
  if (p.unsampled.length) console.log(`\nno sample yet, estimated at ${p.fallbackPerTest.toFixed(2)} s per test: ${p.unsampled.join(', ')}`)
  if (p.stale.length) console.log(`\nweights for files the suite no longer has: ${p.stale.join(', ')}`)
}

function cmdRun(arg, extra) {
  const { i, n } = parseShardArg(arg)
  const p = planFor(n)
  const shard = p.shards[i - 1]
  console.log(describe(p.shards)[i - 1])
  console.log(`files: ${shard.files.join(' ')}`)
  const filter = filterFor(shard.files)
  if (!filter) {
    console.log('this shard has no files; nothing to run')
    return 0
  }
  const require = createRequire(import.meta.url)
  const cli = require.resolve('@playwright/test/cli', { paths: [root] })
  const r = spawnSync(process.execPath, [cli, 'test', filter, ...extra], { cwd: root, stdio: 'inherit' })
  return r.status ?? 1
}

function cmdCheck() {
  const problems = []
  const notes = []
  const yaml = readFileSync(resolve(root, WORKFLOW_FILE), 'utf8')
  const wf = shardCountFromWorkflow(yaml)
  const n = wf.passed ?? wf.matrix.length
  if (!wf.matrix.length || wf.passed === null) problems.push(`${WORKFLOW_FILE}: could not read the shard matrix and the count passed to "e2e-shards.mjs run"`)
  else if (wf.matrix.length !== wf.passed || wf.matrix.some((v, k) => v !== k + 1)) problems.push(`${WORKFLOW_FILE}: the matrix enumerates [${wf.matrix.join(', ')}] but the run step says ${wf.passed} shards`)
  const limit = /timeout-minutes:\s*(\d+)/.exec(yaml.split('e2e-shard:')[1] ?? '')
  if (limit && Number(limit[1]) * 60 !== JOB_LIMIT_SECONDS) problems.push(`${WORKFLOW_FILE}: the shard job's timeout-minutes is ${limit[1]}, this check assumes ${JOB_LIMIT_SECONDS / 60}`)

  const p = planFor(n || 1)
  notes.push(`${p.tests.length} tests in ${p.counts.size} spec files, ${n} shards, weights from ${WEIGHTS_FILE}`)
  for (const f of p.stale) problems.push(`${WEIGHTS_FILE}: "${f}" is not a spec file the suite lists; remove its entry`)
  if (p.unsampled.length) notes.push(`no sample yet, estimated at ${p.fallbackPerTest.toFixed(2)} s per test: ${p.unsampled.join(', ')}`)

  // 1. the partition, by Playwright's own filter
  const parts = p.shards.map((s) => (s.files.length ? flattenList(listSuite([filterFor(s.files)])).map((t) => t.key) : []))
  problems.push(...compareMultisets(p.tests.map((t) => t.key), parts).slice(0, 40))
  parts.forEach((keys, i) => {
    if (keys.length !== p.shards[i].tests) problems.push(`shard ${i + 1}: Playwright lists ${keys.length} tests for its files, the plan counted ${p.shards[i].tests}`)
  })

  // 2. the budget
  for (const l of describe(p.shards)) notes.push(l)
  p.shards.forEach((s, i) => {
    const job = predictedJobSeconds(s)
    if (job > JOB_LIMIT_SECONDS - MARGIN_SECONDS)
      problems.push(`shard ${i + 1}: predicted ${fmt(job)} on the slowest samples, over the ${fmt(JOB_LIMIT_SECONDS - MARGIN_SECONDS)} budget (${fmt(JOB_LIMIT_SECONDS)} limit less ${fmt(MARGIN_SECONDS)} margin); add a shard to the matrix in ${WORKFLOW_FILE}`)
  })

  for (const l of notes) console.log(l)
  if (problems.length) {
    console.error(`\ncheck:e2e-shards — ${problems.length} problem(s):`)
    for (const pr of problems) console.error(`  ${pr}`)
    return 1
  }
  console.log(`\nok: every listed test is in exactly one of ${n} shards, and every shard is within the budget`)
  return 0
}

if (process.argv[1]?.endsWith('e2e-shards.mjs')) {
  const [cmd, arg, ...rest] = process.argv.slice(2)
  try {
    if (cmd === 'plan') cmdPlan(Number(arg ?? 4))
    else if (cmd === 'run') process.exit(cmdRun(arg, rest))
    else if (cmd === 'check') process.exit(cmdCheck())
    else {
      console.error('usage: e2e-shards.mjs plan [N] | run i/N [playwright args] | check')
      process.exit(2)
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
