// Issue #296 — the rule behind `npm run check:change-declaration`, as pure
// functions. `check-change-declaration.mjs` gathers the facts from git and the
// working tree and hands them here; the tests hand it made-up facts.
//
// THE RULE
//
// A change that touches the product, or the app version, declares what it is in
// one new file, `.changes/<slug>.json`:
//
//   { "type": "user-facing", "releaseNoteId": "release:0.15.0" }
//   { "type": "internal", "reason": "why no release note is needed" }
//
// - `user-facing` must change the app version, and its `releaseNoteId` must be
//   the entry for exactly that version, present in the release-note list.
// - `internal` must say why, in words.
// - Exactly one declaration per change. Old declarations are a record: they are
//   never edited, renamed or removed.
//
// A merge to `main` is the production deploy, so a visible change cannot leave
// its note for later. A label or a line in a pull-request description is not
// evidence: only the file is, because it can be checked before a push and it is
// still in the tree after a squash merge.
import { compareVersions, parseVersion } from '../src/releaseNotes/validate.ts'

export const DECLARATION_DIR = '.changes'
const DECLARATION_FILE = /^\.changes\/[a-z0-9][a-z0-9-]*\.json$/
/** the only other file allowed in the folder */
const DECLARATION_README = '.changes/README.md'

/** Does this path ship to users? Source that is not a test, the static files,
 *  and the HTML entry. */
export function isProductPath(path) {
  const p = path.replace(/\\/g, '/')
  if (p === 'index.html') return true
  if (p.startsWith('public/')) return true
  if (p.startsWith('src/')) return !/\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p)
  return false
}

export const isDeclarationPath = (path) => path.replace(/\\/g, '/').startsWith(DECLARATION_DIR + '/')

/** One declaration file's text -> its value, or the reasons it is not one. */
export function parseDeclaration(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { problems: ['it is not valid JSON'] }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { problems: ['it must be a JSON object'] }
  const keys = Object.keys(value).sort()
  if (value.type === 'user-facing') {
    const problems = []
    if (keys.join(',') !== 'releaseNoteId,type') problems.push('a user-facing declaration has exactly "type" and "releaseNoteId"')
    if (typeof value.releaseNoteId !== 'string' || !/^release:.+$/.test(value.releaseNoteId)) problems.push('"releaseNoteId" must be "release:<version>"')
    return problems.length ? { problems } : { value: { type: 'user-facing', releaseNoteId: value.releaseNoteId } }
  }
  if (value.type === 'internal') {
    const problems = []
    if (keys.join(',') !== 'reason,type') problems.push('an internal declaration has exactly "type" and "reason"')
    if (typeof value.reason !== 'string' || value.reason.trim() === '') problems.push('"reason" must say, in words, why no release note is needed')
    return problems.length ? { problems } : { value: { type: 'internal', reason: value.reason } }
  }
  return { problems: ['"type" must be "user-facing" or "internal"'] }
}

/**
 * @param {object} facts
 * @param {{status: string, path: string}[]} facts.changed  every path that differs from the base (status: A, M, D, R…)
 * @param {Record<string, string>} facts.declarationTexts   text of every `.changes/*.json` in the tree now
 * @param {string[]} facts.declarationDirEntries            every file in `.changes/` now
 * @param {string | null} facts.baseVersion                 the app version at the base
 * @param {string} facts.headVersion                        the app version now
 * @param {{id: string, version: string}[]} facts.notes     the release-note list now
 * @returns {{problems: string[], summary: string[]}}
 */
export function evaluateChange(facts) {
  const problems = []
  const summary = []
  const changed = facts.changed.map((c) => ({ status: c.status, path: c.path.replace(/\\/g, '/') }))

  // 1. the folder holds declarations and nothing else, and each one is well formed
  for (const entry of facts.declarationDirEntries.map((e) => e.replace(/\\/g, '/'))) {
    if (entry === DECLARATION_README) continue
    if (!DECLARATION_FILE.test(entry)) problems.push(`${entry}: a declaration is ".changes/<slug>.json", the slug in lower-case letters, digits and hyphens`)
  }
  const parsed = {}
  for (const [path, text] of Object.entries(facts.declarationTexts)) {
    const r = parseDeclaration(text)
    if (r.problems) for (const p of r.problems) problems.push(`${path}: ${p}`)
    else parsed[path.replace(/\\/g, '/')] = r.value
  }

  // 2. old declarations are a record
  for (const c of changed) {
    if (!isDeclarationPath(c.path) || c.path === DECLARATION_README) continue
    if (c.status !== 'A') problems.push(`${c.path}: a declaration that already exists is never edited, renamed or removed (status ${c.status})`)
  }

  // 3. does this change need a declaration, and does it have exactly one?
  const product = changed.filter((c) => isProductPath(c.path))
  const base = parseVersion(facts.baseVersion)
  const head = parseVersion(facts.headVersion)
  if (!head) problems.push(`the app version "${facts.headVersion}" is not x.y.z`)
  const versionChanged = facts.baseVersion !== facts.headVersion
  const added = changed.filter((c) => c.status === 'A' && DECLARATION_FILE.test(c.path))
  const needs = product.length > 0 || versionChanged
  summary.push(`${changed.length} path(s) differ from the base; ${product.length} of them ship to users; app version ${facts.baseVersion ?? '(none)'} -> ${facts.headVersion}`)

  if (added.length > 1) {
    problems.push(`${added.length} declarations were added (${added.map((a) => a.path).join(', ')}); a change has exactly one`)
  } else if (needs && added.length === 0) {
    const why = product.length > 0 ? `it touches the product (${product.slice(0, 3).map((p) => p.path).join(', ')}${product.length > 3 ? ', …' : ''})` : 'it changes the app version'
    problems.push(`this change needs a declaration in ${DECLARATION_DIR}/<slug>.json: ${why}`)
  }

  // 4. what the one declaration promises
  const mine = added.length === 1 ? parsed[added[0].path] : undefined
  if (added.length === 1 && mine) {
    if (mine.type === 'user-facing') {
      summary.push(`declared user-facing (${added[0].path}), release note ${mine.releaseNoteId}`)
      if (!versionChanged) {
        problems.push(`${added[0].path}: a user-facing change changes the app version, and it is still ${facts.headVersion}`)
      } else if (base && head && compareVersions(head, base) <= 0) {
        problems.push(`${added[0].path}: the app version went from ${facts.baseVersion} to ${facts.headVersion}; a user-facing change raises it`)
      }
      if (mine.releaseNoteId !== `release:${facts.headVersion}`) {
        problems.push(`${added[0].path}: "releaseNoteId" is ${mine.releaseNoteId}, and the app version is ${facts.headVersion}; it must be release:${facts.headVersion}`)
      }
      if (!facts.notes.some((n) => n.id === mine.releaseNoteId)) {
        problems.push(`${added[0].path}: there is no release note with the id ${mine.releaseNoteId}`)
      }
    } else {
      summary.push(`declared internal (${added[0].path}): ${mine.reason}`)
    }
  } else if (!needs && added.length === 0) {
    summary.push('nothing that ships to users changed; no declaration is needed')
  }

  return { problems, summary }
}
