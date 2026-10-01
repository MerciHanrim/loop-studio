// Issue #296 — a change to anything that is built or shipped declares what it is.
//
//   node scripts/check-change-declaration.mjs [--base <ref>]
//
// Compares the working tree with the commit it branched from and applies the
// rule in `change-declaration.mjs`: a change to what is built or shipped, or to
// the app version, adds exactly one `.changes/<slug>.json` saying whether it is
// `user-facing` (then the version and the release note come in the same change)
// or `internal` (then it says why). It also validates the release-note list
// itself: ids, versions, dates, three to five items, and every item present in
// every language.
//
// The base is `--base`, else `CHANGE_BASE` (CI passes the pull request's base
// commit, or the previous `main` commit on a push), else `origin/main`.
//
// FAILS CLOSED. If git cannot say what changed - no such ref, a shallow clone
// with no common ancestor - that is an error, never "nothing changed".
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DECLARATION_DIR, evaluateChange } from './change-declaration.mjs'
import { validateReleaseNotes } from '../src/releaseNotes/validate.ts'

const root = resolve(import.meta.dirname, '..')
let failed = false
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failed = true
}
const ok = (m) => console.log(`  ok    ${m}`)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

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
  let baseVersion = null
  try {
    baseVersion = JSON.parse(git('show', `${base}:package.json`)).version ?? null
  } catch {
    baseVersion = null
  }
  const headVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version

  // ── every declaration in the tree ──
  const dir = resolve(root, DECLARATION_DIR)
  const declarationDirEntries = existsSync(dir) ? readdirSync(dir).map((n) => `${DECLARATION_DIR}/${n}`) : []
  const declarationTexts = {}
  for (const entry of declarationDirEntries) {
    if (entry.endsWith('.json')) declarationTexts[entry] = readFileSync(resolve(root, entry), 'utf8')
  }

  // ── the release-note list, and every language's catalog ──
  const { RELEASE_NOTES } = await import(pathToFileURL(resolve(root, 'src/releaseNotes/releaseNotes.ts')).href)
  const localesDir = resolve(root, 'src/i18n/locales')
  const catalogs = {}
  for (const code of readdirSync(localesDir, { withFileTypes: true })) {
    if (!code.isDirectory()) continue
    // a locale folder merges its slices in `index.ts`, which Node's type
    // stripping cannot follow (extensionless imports); merge the slices here
    const merged = {}
    for (const file of readdirSync(join(localesDir, code.name))) {
      if (!file.endsWith('.ts') || file === 'index.ts' || file.endsWith('.test.ts')) continue
      Object.assign(merged, (await import(pathToFileURL(join(localesDir, code.name, file)).href)).default)
    }
    catalogs[code.name] = merged
  }
  const localeCount = Object.keys(catalogs).length
  if (localeCount === 0) fail('found no language catalog under src/i18n/locales - refusing to call the release notes complete')

  const noteProblems = validateReleaseNotes(RELEASE_NOTES, { packageVersion: headVersion, catalogs })
  for (const p of noteProblems) fail(`release notes: ${p}`)
  if (!noteProblems.length) ok(`release notes: ${RELEASE_NOTES.length} entr${RELEASE_NOTES.length === 1 ? 'y' : 'ies'}, each id, version, date and item valid, every item present in ${localeCount} languages`)

  const { problems, summary } = evaluateChange({ changed, declarationTexts, declarationDirEntries, baseVersion, headVersion, notes: RELEASE_NOTES })
  console.log(`  base  ${base.slice(0, 7)} (${asked})`)
  for (const s of summary) console.log(`  note  ${s}`)
  for (const p of problems) fail(p)
  if (!problems.length) ok(`change declaration: ${Object.keys(declarationTexts).length} declaration(s) in ${DECLARATION_DIR}/, all well formed; this change satisfies the rule`)
}

if (failed) {
  console.error('\n  A change to what is built or shipped says so in .changes/<slug>.json. See docs/release-notes.md.')
  process.exit(1)
}
