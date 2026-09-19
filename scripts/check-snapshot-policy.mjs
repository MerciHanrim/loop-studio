// Visual snapshot tolerance policy — guard (docs/visual-snapshot-policy.md).
// Runs in `checks`.
//
//   node scripts/check-snapshot-policy.mjs
//
// Every committed Playwright baseline must belong to EXACTLY ONE capture-kind
// policy, and every `toHaveScreenshot` call must go through `snap()` so that no
// shot can silently pick up the global fallback. Concretely:
//
//   1. every e2e/*-snapshots/<stem>-<project>-win32.png is registered in
//      SNAPSHOTS for that project, and its pixel size matches the kind's size
//      (an `element` shot may not have one of the four page/clip sizes);
//   2. every SNAPSHOTS entry has a baseline on disk (no stale registrations);
//   3. every `toHaveScreenshot(` in e2e/**/*.ts is `toHaveScreenshot(...snap(`,
//      and no spec sets `maxDiffPixelRatio` by hand;
//   4. playwright.config.ts uses SNAPSHOT_FALLBACK_RATIO, which is never looser
//      than the loosest policy (desktop-full-page).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { SNAPSHOT_POLICY, SNAPSHOTS, SNAPSHOT_FALLBACK_RATIO, parseBaselineName } from '../e2e/support/snapshot-policy.ts'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)

// ── PNG size without a dependency: IHDR is always the first chunk ──────────
function pngSize(file) {
  const b = readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

const sizedKinds = Object.entries(SNAPSHOT_POLICY).filter(([, p]) => p.size)
const kindOfSize = (w, h) => sizedKinds.find(([, p]) => p.size[0] === w && p.size[1] === h)?.[0] ?? null

// ── 1. files on disk → registry + size ─────────────────────────────────────
const e2eDir = join(root, 'e2e')
const files = []
for (const d of readdirSync(e2eDir)) {
  if (!d.endsWith('-snapshots')) continue
  for (const f of readdirSync(join(e2eDir, d))) if (f.endsWith('.png')) files.push(join(e2eDir, d, f))
}
const seen = new Set()
const perKind = {}
for (const file of files.sort()) {
  const rel = relative(root, file).replace(/\\/g, '/')
  const parsed = parseBaselineName(file.split(/[\\/]/).pop())
  if (!parsed) {
    fail(`${rel}: not a <stem>-<project>-<platform>.png baseline name`)
    continue
  }
  const { stem, project } = parsed
  const kind = SNAPSHOTS[stem]?.[project]
  if (!kind) {
    fail(`${rel}: no policy — register "${stem}" for project "${project}" in e2e/support/snapshot-policy.ts`)
    continue
  }
  seen.add(`${stem}|${project}`)
  const size = pngSize(file)
  if (!size) {
    fail(`${rel}: not a PNG`)
    continue
  }
  const expected = SNAPSHOT_POLICY[kind].size
  if (expected) {
    if (size[0] !== expected[0] || size[1] !== expected[1])
      fail(`${rel}: registered as ${kind} (${expected.join('×')}) but the image is ${size.join('×')}`)
  } else {
    const clash = kindOfSize(size[0], size[1])
    if (clash) fail(`${rel}: registered as element but its ${size.join('×')} is the ${clash} size — register it as ${clash}`)
  }
  perKind[kind] = (perKind[kind] ?? 0) + 1
}

// ── 2. registry → files on disk ────────────────────────────────────────────
for (const [stem, byProject] of Object.entries(SNAPSHOTS)) {
  for (const project of Object.keys(byProject)) {
    if (!seen.has(`${stem}|${project}`)) fail(`SNAPSHOTS lists "${stem}" for "${project}" but no baseline exists on disk`)
  }
}
if (!failed) {
  ok(`${files.length} baselines, each under exactly one policy: ${Object.entries(perKind).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
}

// ── 3. every toHaveScreenshot goes through snap(); no hand-written ratios ───
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      if (!f.endsWith('-snapshots')) walk(p, out)
    } else if (/\.(ts|mts|mjs|js)$/.test(f)) out.push(p)
  }
  return out
}
let calls = 0
for (const file of walk(e2eDir)) {
  const rel = relative(root, file).replace(/\\/g, '/')
  const src = readFileSync(file, 'utf8')
  const lineOf = (idx) => src.slice(0, idx).split('\n').length
  // the call may wrap: `toHaveScreenshot(\n  ...snap(page, …)` — look past whitespace
  for (const m of src.matchAll(/toHaveScreenshot\(\s*/g)) {
    calls++
    if (!src.startsWith('...snap(', m.index + m[0].length))
      fail(`${rel}:${lineOf(m.index)}: toHaveScreenshot must be called as toHaveScreenshot(...snap(page, '<stem>', …))`)
  }
  if (!rel.endsWith('support/snapshot-policy.ts') && !rel.endsWith('support/loop.ts')) {
    for (const m of src.matchAll(/maxDiffPixelRatio/g))
      fail(`${rel}:${lineOf(m.index)}: maxDiffPixelRatio must not be set by hand — the policy in snapshot-policy.ts decides it`)
  }
}
if (!failed) ok(`${calls} toHaveScreenshot calls, all through snap()`)

// ── 4. global fallback ─────────────────────────────────────────────────────
const cfg = readFileSync(join(root, 'playwright.config.ts'), 'utf8')
const loosest = Math.max(...Object.values(SNAPSHOT_POLICY).map((p) => p.maxDiffPixelRatio))
if (!/maxDiffPixelRatio:\s*SNAPSHOT_FALLBACK_RATIO\b/.test(cfg)) fail('playwright.config.ts must set toHaveScreenshot.maxDiffPixelRatio: SNAPSHOT_FALLBACK_RATIO')
else if (SNAPSHOT_FALLBACK_RATIO > loosest) fail(`SNAPSHOT_FALLBACK_RATIO ${SNAPSHOT_FALLBACK_RATIO} is looser than the loosest policy ${loosest}`)
else ok(`global fallback ${SNAPSHOT_FALLBACK_RATIO} = loosest policy (desktop-full-page ${SNAPSHOT_POLICY['desktop-full-page'].maxDiffPixelRatio})`)

if (failed) process.exit(1)
