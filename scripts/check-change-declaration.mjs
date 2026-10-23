// Issue #296 — a change to anything that is built or shipped declares what it is.
//
//   node scripts/check-change-declaration.mjs [--base <ref>]
//
// Compares the working tree with the commit it branched from and applies the
// rule in `change-declaration.mjs`: a change to what is built or shipped, or to
// the app version, adds exactly one `.changes/<slug>.json` saying whether it is
// `user-facing` (then the line it adds under `## Unreleased` in CHANGELOG.md
// comes in the same change) or `internal` (then it says why). The app version is
// raised only when a release is approved, and then it only goes up.
//
// Revised 2026-10: the in-app release notes were removed, and with them this
// check's validation of their list and their languages.
//
// The base is `--base`, else `CHANGE_BASE` (CI passes the pull request's base
// commit, or the previous `main` commit on a push), else `origin/main`.
//
// FAILS CLOSED. If git cannot say what changed - no such ref, a shallow clone
// with no common ancestor - that is an error, never "nothing changed". The same
// goes for the app version at the base (no package.json there, not JSON, no
// x.y.z version).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHANGELOG, DECLARATION_DIR, evaluateChange, readPackageVersion } from './change-declaration.mjs'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
/** a file's text at `ref`, or null when it is not there */
const showAt = (ref, path) => {
  try {
    return git('show', `${ref}:${path}`)
  } catch {
    return null
  }
}
/** a file's text in the working tree, or null when it is not there */
const readNow = (path) => {
  try {
    return readFileSync(resolve(root, path), 'utf8')
  } catch {
    return null
  }
}

// ── the base ────────────────────────────────────────────────────────────────
const arg = process.argv.indexOf('--base')
const asked = (arg >= 0 ? process.argv[arg + 1] : undefined) ?? process.env.CHANGE_BASE ?? 'origin/main'
let base = null
if (!asked || /^0+$/.test(asked)) {
  fail(`no base commit to compare with (got "${asked}")`)
} else {
  try {
    base = git('merge-base', asked, 'HEAD').trim()
  } catch {
    fail(`git cannot find a common ancestor of "${asked}" and HEAD - a shallow clone, or a ref that does not exist`)
  }
}

if (base) {
  // ── what differs from the base: committed, staged, unstaged and untracked ──
  const changed = []
  for (const line of git('diff', '--name-status', '--no-renames', base).split('\n')) {
    if (!line.trim()) continue
    const [status, ...rest] = line.split('\t')
    changed.push({ status: status[0], path: rest.join('\t') })
  }
  for (const path of git('ls-files', '--others', '--exclude-standard').split('\n')) {
    if (path.trim()) changed.push({ status: 'A', path: path.trim() })
  }

  // ── the app version, then and now ──
  // Both must be read. A base version that cannot be read is an error, never
  // "there was none": with no base nobody can say whether the version moved.
  const baseRead = readPackageVersion(showAt(base, 'package.json'))
  if (baseRead.problem) fail(`package.json at the base ${base.slice(0, 7)}: ${baseRead.problem} - the app version this change started from is unknown`)
  const headRead = readPackageVersion(readNow('package.json'))
  if (headRead.problem) fail(`package.json: ${headRead.problem}`)
  const baseVersion = baseRead.version ?? null
  const headVersion = headRead.version ?? null

  // ── every declaration in the tree ──
  const dir = resolve(root, DECLARATION_DIR)
  const declarationDirEntries = existsSync(dir) ? readdirSync(dir).map((n) => `${DECLARATION_DIR}/${n}`) : []
  const declarationTexts = {}
  for (const entry of declarationDirEntries) {
    if (entry.endsWith('.json')) declarationTexts[entry] = readFileSync(resolve(root, entry), 'utf8')
  }

  // ── the changelog, then and now: a user-facing change's line goes under
  //    "## Unreleased", and must be new to this change ──
  const changelog = readNow(CHANGELOG)
  const baseChangelog = showAt(base, CHANGELOG)

  console.log(`  base  ${base.slice(0, 7)} (${asked})`)
  if (baseVersion === null || headVersion === null) {
    fail('change declaration: not checked, the app version is unknown on one side')
  } else {
    const { problems, summary } = evaluateChange({ changed, declarationTexts, declarationDirEntries, baseVersion, headVersion, changelog, baseChangelog })
    for (const s of summary) console.log(`  note  ${s}`)
    for (const p of problems) fail(p)
    if (!problems.length) ok(`change declaration: ${Object.keys(declarationTexts).length} declaration(s) in ${DECLARATION_DIR}/, all well formed; this change satisfies the rule`)
  }
}

if (failed) {
  console.error('\n  A change to what is built or shipped says so in .changes/<slug>.json. See docs/release-notes.md.')
  process.exit(1)
}
