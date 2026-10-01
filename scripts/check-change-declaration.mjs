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
// with no common ancestor - that is an error, never "nothing changed". The same
// goes for the app version at the base (no package.json there, not JSON, no
// x.y.z version) and for the languages: the catalogs found must be exactly the
// registered set, so a language that lost its catalog is not skipped.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DECLARATION_DIR, compareLanguageSets, evaluateChange, readPackageVersion } from './change-declaration.mjs'
import { shippedCodes } from './registry-source.mjs'
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
  // Both must be read. A base version that cannot be read is an error, never
  // "there was none": with no base nobody can say whether the version moved.
  let baseText = null
  try {
    baseText = git('show', `${base}:package.json`)
  } catch {
    baseText = null
  }
  const baseRead = readPackageVersion(baseText)
  if (baseRead.problem) fail(`package.json at the base ${base.slice(0, 7)}: ${baseRead.problem} - the app version this change started from is unknown`)
  let headText = null
  try {
    headText = readFileSync(resolve(root, 'package.json'), 'utf8')
  } catch {
    headText = null
  }
  const headRead = readPackageVersion(headText)
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
    if (Object.keys(merged).length === 0) fail(`the catalog of ${code.name} has no text at all`)
    catalogs[code.name] = merged
  }
  // "present in every language" is only as good as the list of languages: the
  // catalogs found must be exactly the registered set, not merely more than none
  const localeCount = Object.keys(catalogs).length
  let registered = null
  try {
    registered = shippedCodes()
  } catch (e) {
    fail(`the registered languages could not be read: ${e.message}`)
  }
  let languagesOk = false
  if (registered) {
    const languageProblems = compareLanguageSets(registered, Object.keys(catalogs))
    for (const p of languageProblems) fail(`languages: ${p}`)
    languagesOk = languageProblems.length === 0
    if (languagesOk) ok(`languages: ${localeCount} catalogs, exactly the ${registered.length} registered languages`)
  }

  if (headVersion === null) {
    fail('release notes: not checked, the app version is unknown')
  } else {
    const noteProblems = validateReleaseNotes(RELEASE_NOTES, { packageVersion: headVersion, catalogs })
    for (const p of noteProblems) fail(`release notes: ${p}`)
    if (!noteProblems.length && languagesOk) ok(`release notes: ${RELEASE_NOTES.length} entr${RELEASE_NOTES.length === 1 ? 'y' : 'ies'}, each id, version, date and item valid, every item present in ${localeCount} languages`)
  }

  console.log(`  base  ${base.slice(0, 7)} (${asked})`)
  if (baseVersion === null || headVersion === null) {
    fail('change declaration: not checked, the app version is unknown on one side')
  } else {
    const { problems, summary } = evaluateChange({ changed, declarationTexts, declarationDirEntries, baseVersion, headVersion, notes: RELEASE_NOTES })
    for (const s of summary) console.log(`  note  ${s}`)
    for (const p of problems) fail(p)
    if (!problems.length) ok(`change declaration: ${Object.keys(declarationTexts).length} declaration(s) in ${DECLARATION_DIR}/, all well formed; this change satisfies the rule`)
  }
}

if (failed) {
  console.error('\n  A change to what is built or shipped says so in .changes/<slug>.json. See docs/release-notes.md.')
  process.exit(1)
}
