// Issue #311 — refresh `e2e/shard-weights.json` from the JSON reports of ONE CI
// run's shard jobs (every shard job uploads `test-results/e2e-report.json` as the
// artifact `e2e-report-shard-<i>`).
//
//   gh run download <run id> -p 'e2e-report-shard-*' -D reports
//   node scripts/e2e-shard-weights.mjs <run sha> <report.json>...
//
// For every spec file in the reports, the seconds Playwright reported for its
// tests (every result, so a retry counts the time it really took) are summed,
// `portable.setup.ts` is added to `portable-file.spec.ts`, and that sum becomes
// the newest sample of the file; the oldest sample beyond `samplesPerFile` is
// dropped. A file in the weights but in none of the reports keeps its samples:
// one run's reports are not evidence that a file is gone (`check:e2e-shards`
// is, against the live list). The same run fed in twice is ignored by its sha.
//
// Why a sample per RUN and the median of several, rather than the last run:
// MEASURED on 2026-10-03, two runs of the same tree differed by 56 % on one
// shard; one run is a runner, several are the suite.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HOST_FILE, SETUP_FILE, WEIGHTS_FILE } from './e2e-shards.mjs'

const root = resolve(import.meta.dirname, '..')

/** seconds per spec file from a Playwright JSON report (a finished run, not a --list) */
export function secondsPerFile(report) {
  const out = new Map()
  const walk = (suite, file) => {
    const f = suite.file ?? file
    for (const s of suite.suites ?? []) walk(s, f)
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const ms = (t.results ?? []).reduce((a, r) => a + (r.duration ?? 0), 0)
        const key = f === SETUP_FILE ? HOST_FILE : f
        out.set(key, (out.get(key) ?? 0) + ms / 1000)
      }
    }
  }
  for (const s of report.suites ?? []) walk(s, undefined)
  return out
}

/** the weights document with one more run's samples; pure */
export function addRun(doc, { sha, run, date }, perFile) {
  const k = doc.source?.samplesPerFile ?? 6
  if ((doc.source?.runs ?? []).some((r) => r.sha === sha)) return { doc, added: 0, skipped: `run ${sha} is already a source of these weights` }
  const files = { ...doc.files }
  let added = 0
  for (const [f, secs] of [...perFile].sort(([a], [b]) => (a < b ? -1 : 1))) {
    files[f] = [Math.round(secs * 10) / 10, ...(files[f] ?? [])].slice(0, k)
    added++
  }
  const runs = [{ sha, run, date }, ...(doc.source?.runs ?? [])].slice(0, k)
  return { doc: { ...doc, source: { ...doc.source, runs, samplesPerFile: k }, files }, added, skipped: null }
}

if (process.argv[1]?.endsWith('e2e-shard-weights.mjs')) {
  const [sha, ...paths] = process.argv.slice(2)
  if (!sha || !paths.length) {
    console.error('usage: e2e-shard-weights.mjs <run sha> <report.json>...')
    process.exit(2)
  }
  const perFile = new Map()
  for (const p of paths) {
    for (const [f, s] of secondsPerFile(JSON.parse(readFileSync(p, 'utf8')))) perFile.set(f, (perFile.get(f) ?? 0) + s)
  }
  const path = resolve(root, WEIGHTS_FILE)
  const before = JSON.parse(readFileSync(path, 'utf8'))
  const { doc, added, skipped } = addRun(before, { sha, run: process.env.GITHUB_RUN_ID ?? null, date: new Date().toISOString().slice(0, 10) }, perFile)
  if (skipped) {
    console.log(skipped)
    process.exit(0)
  }
  writeFileSync(path, JSON.stringify(doc, null, 1) + '\n')
  console.log(`${WEIGHTS_FILE}: ${added} files got a sample from run ${sha} (${paths.length} reports)`)
}
