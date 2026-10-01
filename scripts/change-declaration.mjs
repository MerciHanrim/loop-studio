// Issue #296 — the rule behind `npm run check:change-declaration`, as pure
// functions. `check-change-declaration.mjs` gathers the facts from git and the
// working tree and hands them here; the tests hand it made-up facts.
//
// THE RULE
//
// A change that touches anything a build reads or ships, or the app version,
// declares what it is in
// one new file, `.changes/<slug>.json`:
//
//   { "type": "user-facing", "releaseNoteId": "release:0.15.0" }
//   { "type": "internal", "reason": "why no release note is needed" }
//
// - `user-facing` must raise the app version, and its `releaseNoteId` must be
//   the entry for exactly that version, present in the release-note list.
// - `internal` must say why, in words. It may raise the version too.
// - Whatever is declared, a version that changes only goes up, and the version
//   at the base must be known: one that cannot be read is an error.
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

/**
 * Paths that are never read by a build and never shipped. EVERYTHING ELSE is
 * treated as something that can change what users get.
 *
 * The list is the exclusions, on purpose. A list of what ships goes stale the
 * day a build starts reading a new place, and it goes stale silently: the three
 * builds read far more than `src/` - the bundled templates under `examples/`,
 * `vite.config.ts` (the PWA and service-worker settings, the portable build,
 * the build constants), `scripts/locale-chunk.mjs` which that config imports,
 * the TypeScript settings, and `package.json` with its lockfile, where a
 * DEVELOPMENT dependency such as the service-worker runtime ends up in the
 * shipped files. A path nobody has classified therefore counts as shipping,
 * and the cost of that is one `internal` declaration.
 */
const NEVER_SHIPS = [
  // documents
  /^docs\//,
  /^(?!src\/|public\/).*\.md$/,
  // the declarations themselves
  /^\.changes\//,
  // tests and their configuration
  /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/,
  /^e2e\//,
  /^test\//,
  /^playwright(\.[a-z]+)?\.config\.ts$/,
  /^tsconfig\.e2e\.json$/,
  // CI, lint and repository settings
  /^\.github\//,
  /^\.(gitignore|gitattributes|oxlintrc\.json)$/,
  // the checks, their shared readers and their data
  /^scripts\/check-[a-z0-9-]+\.mjs$/,
  /^scripts\/(change-declaration|catalog-source|registry-source)\.mjs$/,
  /^scripts\/(arrow-units|content-direction|icu-argument-disposition|isolate-obligations)\.json$/,
]

/** Can a change to this path change what a build produces or what users get? */
export function isProductPath(path) {
  const p = path.replace(/\\/g, '/')
  return !NEVER_SHIPS.some((rx) => rx.test(p))
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
 * The app version in a `package.json` text, or the reason there is none.
 *
 * Never a default. The check compares the version at the base with the version
 * now, and a base it could not read used to become `null` and pass as "it was
 * nothing before" - which let a version fall, or a missing file, through.
 *
 * @param {string | null | undefined} text  the file's text; null when it could not be read
 * @returns {{version: string} | {problem: string}}
 */
export function readPackageVersion(text) {
  if (typeof text !== 'string') return { problem: 'it could not be read' }
  let pkg
  try {
    pkg = JSON.parse(text)
  } catch {
    return { problem: 'it is not valid JSON' }
  }
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) return { problem: 'it is not a JSON object' }
  if (!('version' in pkg)) return { problem: 'it has no "version"' }
  if (typeof pkg.version !== 'string') return { problem: `its "version" is ${JSON.stringify(pkg.version)}, not a string` }
  if (!parseVersion(pkg.version)) return { problem: `its "version" is "${pkg.version}", not x.y.z` }
  return { version: pkg.version }
}

/**
 * The languages that have a catalog must be EXACTLY the registered ones.
 *
 * "Every item has text in every language" is only as good as the list of
 * languages it walks. Counting the catalog folders and refusing zero let
 * seventeen of eighteen pass: the release notes would be called complete in a
 * language nobody looked at.
 *
 * @param {string[]} registered  the shipped language codes, from the registry
 * @param {string[]} found       the languages a catalog was loaded for
 * @returns {string[]} problems
 */
export function compareLanguageSets(registered, found) {
  const problems = []
  if (!Array.isArray(registered) || registered.length === 0) return ['the registry lists no shipped language']
  const dupes = (list) => [...new Set(list.filter((c, i) => list.indexOf(c) !== i))]
  for (const c of dupes(registered)) problems.push(`the registry lists the language ${c} more than once`)
  for (const c of dupes(found)) problems.push(`the language ${c} has more than one catalog`)
  const missing = registered.filter((c) => !found.includes(c))
  const extra = found.filter((c) => !registered.includes(c))
  if (missing.length) problems.push(`${missing.length} registered language(s) have no catalog: ${missing.join(', ')}`)
  if (extra.length) problems.push(`${extra.length} catalog(s) belong to no registered language: ${extra.join(', ')}`)
  return problems
}

/**
 * @param {object} facts
 * @param {{status: string, path: string}[]} facts.changed  every path that differs from the base (status: A, M, D, R…)
 * @param {Record<string, string>} facts.declarationTexts   text of every `.changes/*.json` in the tree now
 * @param {string[]} facts.declarationDirEntries            every file in `.changes/` now
 * @param {string | null} facts.baseVersion                 the app version at the base; anything that is not x.y.z is a problem
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

  // 3. the app version, then and now. Both must be known: with no base version
  //    nobody can say whether it changed, and "unknown" must not read as "fine".
  //    A version that changes only goes up, whatever the declaration says.
  const product = changed.filter((c) => isProductPath(c.path))
  const base = parseVersion(facts.baseVersion)
  const head = parseVersion(facts.headVersion)
  if (!base) problems.push(`the app version at the base ${JSON.stringify(facts.baseVersion ?? null)} is not x.y.z, so nobody can say whether this change moved it`)
  if (!head) problems.push(`the app version "${facts.headVersion}" is not x.y.z`)
  const versionChanged = facts.baseVersion !== facts.headVersion
  if (base && head && versionChanged && compareVersions(head, base) <= 0) {
    problems.push(`the app version went from ${facts.baseVersion} to ${facts.headVersion}; a version that changes only goes up, whatever the change declares`)
  }

  // 4. does this change need a declaration, and does it have exactly one?
  const added = changed.filter((c) => c.status === 'A' && DECLARATION_FILE.test(c.path))
  const needs = product.length > 0 || versionChanged
  summary.push(`${changed.length} path(s) differ from the base; ${product.length} of them are built or shipped; app version ${facts.baseVersion ?? '(none)'} -> ${facts.headVersion}`)

  if (added.length > 1) {
    problems.push(`${added.length} declarations were added (${added.map((a) => a.path).join(', ')}); a change has exactly one`)
  } else if (needs && added.length === 0) {
    const why = product.length > 0 ? `it touches what is built or shipped (${product.slice(0, 3).map((p) => p.path).join(', ')}${product.length > 3 ? ', …' : ''})` : 'it changes the app version'
    problems.push(`this change needs a declaration in ${DECLARATION_DIR}/<slug>.json: ${why}`)
  }

  // 5. what the one declaration promises
  const mine = added.length === 1 ? parsed[added[0].path] : undefined
  if (added.length === 1 && mine) {
    if (mine.type === 'user-facing') {
      summary.push(`declared user-facing (${added[0].path}), release note ${mine.releaseNoteId}`)
      if (!versionChanged) {
        problems.push(`${added[0].path}: a user-facing change raises the app version, and it is still ${facts.headVersion}`)
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
    summary.push('nothing that is built or shipped changed; no declaration is needed')
  }

  return { problems, summary }
}
