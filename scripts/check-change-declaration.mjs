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
// BRANCH, or the previous `main` commit on a push), else `origin/main`. The
// side under review is the working tree, or — `--head <ref>` / `CHANGE_HEAD` —
// a commit: CI passes the pull request's head, because the commit it checks
// out is the pull request's MERGE with the base branch as it is at run time
// (issue #415: compared against a stale `base.sha`, that merge carried a main
// commit's declaration into the count — "2 declarations were added" on a
// comment-only push, minutes after another PR had merged). With a head, the
// base is `merge-base(base, head)` and the diff is `base..head`, committed
// only; the working tree is not read.
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

// ── the base, and the side under review ─────────────────────────────────────
const argOf = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const asked = argOf('--base') ?? process.env.CHANGE_BASE ?? 'origin/main'
/** a commit to review instead of the working tree (`--head` / `CHANGE_HEAD`); null = the working tree */
const headAsked = argOf('--head') ?? process.env.CHANGE_HEAD ?? null
let head = null
if (headAsked) {
  try {
    head = git('rev-parse', '--verify', `${headAsked}^{commit}`).trim()
  } catch {
    fail(`the head to review, "${headAsked}", is not a commit this clone has`)
  }
}
let base = null
if (!asked || /^0+$/.test(asked)) {
  fail(`no base commit to compare with (got "${asked}")`)
} else if (!headAsked || head) {
  try {
    base = git('merge-base', asked, head ?? 'HEAD').trim()
  } catch {
    fail(`git cannot find a common ancestor of "${asked}" and ${head ? headAsked : 'HEAD'} - a shallow clone, or a ref that does not exist`)
  }
}
/** a file's text on the side under review: the head commit, or the working tree */
const nowText = (path) => (head ? showAt(head, path) : readNow(path))

if (base) {
  // ── what differs from the base: with a head, its commits; otherwise the
  //    working tree — committed, staged, unstaged and untracked ──
  const changed = []
  const diffArgs = head ? ['diff', '--name-status', '--no-renames', base, head] : ['diff', '--name-status', '--no-renames', base]
  for (const line of git(...diffArgs).split('\n')) {
    if (!line.trim()) continue
    const [status, ...rest] = line.split('\t')
    changed.push({ status: status[0], path: rest.join('\t') })
  }
  if (!head) {
    for (const path of git('ls-files', '--others', '--exclude-standard').split('\n')) {
      if (path.trim()) changed.push({ status: 'A', path: path.trim() })
    }
  }

  // ── the app version, then and now ──
  // Both must be read. A base version that cannot be read is an error, never
  // "there was none": with no base nobody can say whether the version moved.
  const baseRead = readPackageVersion(showAt(base, 'package.json'))
  if (baseRead.problem) fail(`package.json at the base ${base.slice(0, 7)}: ${baseRead.problem} - the app version this change started from is unknown`)
  const headRead = readPackageVersion(nowText('package.json'))
  if (headRead.problem) fail(`package.json: ${headRead.problem}`)
  const baseVersion = baseRead.version ?? null
  const headVersion = headRead.version ?? null

  // ── every declaration on the side under review ──
  let declarationDirEntries = []
  const declarationTexts = {}
  if (head) {
    const listed = (() => {
      try {
        return git('ls-tree', '--name-only', head, `${DECLARATION_DIR}/`).split('\n')
      } catch {
        return []
      }
    })()
    declarationDirEntries = listed.map((l) => l.trim()).filter(Boolean)
    for (const entry of declarationDirEntries) {
      if (entry.endsWith('.json')) declarationTexts[entry] = showAt(head, entry) ?? ''
    }
  } else {
    const dir = resolve(root, DECLARATION_DIR)
    declarationDirEntries = existsSync(dir) ? readdirSync(dir).map((n) => `${DECLARATION_DIR}/${n}`) : []
    for (const entry of declarationDirEntries) {
      if (entry.endsWith('.json')) declarationTexts[entry] = readFileSync(resolve(root, entry), 'utf8')
    }
  }

  // ── the changelog, then and now: a user-facing change's line goes under
  //    "## Unreleased", and must be new to this change ──
  const changelog = nowText(CHANGELOG)
  const baseChangelog = showAt(base, CHANGELOG)

  console.log(`  base  ${base.slice(0, 7)} (${asked})${head ? `  head  ${head.slice(0, 7)} (${headAsked})` : ''}`)
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
