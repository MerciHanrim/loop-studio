// Issue #296 — the rule behind `npm run check:change-declaration`, as pure
// functions. `check-change-declaration.mjs` gathers the facts from git and the
// working tree and hands them here; the tests hand it made-up facts.
//
// THE RULE (revised 2026-10, when the in-app release notes were removed)
//
// A change that touches anything a build reads or ships, or the app version,
// declares what it is in one new file, `.changes/<slug>.json`:
//
//   { "type": "user-facing", "changelog": "<a line of the CHANGELOG's Unreleased section>" }
//   { "type": "internal", "reason": "why it needs no changelog entry" }
//
// - `user-facing` records what users notice in `CHANGELOG.md`, under
//   `## Unreleased`, in the same change: the declared line must be in that
//   section now, and must not have been there at the base — an entry an earlier
//   change already wrote does not stand for this one. A release — a change
//   that raises the app version — moves the Unreleased lines into the section
//   of exactly that new version (`## v<x.y.z> — <date>`) in the same change;
//   there, that section is accepted too. No other version's section ever is.
// - `internal` must say why, in words.
// - The app version is raised only when a release is approved, never as part
//   of an ordinary change. A version that changes only goes up, the version at
//   the base must be known (one that cannot be read is an error), and a change
//   of the version alone still needs a declaration.
// - Exactly one declaration per change. Old declarations are a record: they are
//   never edited, renamed or removed. Declarations written before the revision
//   name an in-app release note (`releaseNoteId`); they still parse, as the
//   record they are, but a NEW user-facing declaration names its changelog line.
//
// A merge to `main` is the production deploy, so a visible change cannot leave
// its record for later. A label or a line in a pull-request description is not
// evidence: only the file is, because it can be checked before a push and it is
// still in the tree after a squash merge.

export const DECLARATION_DIR = '.changes'
const DECLARATION_FILE = /^\.changes\/[a-z0-9][a-z0-9-]*\.json$/
/** the only other file allowed in the folder */
const DECLARATION_README = '.changes/README.md'
export const CHANGELOG = 'CHANGELOG.md'
/** the heading of the section that collects what has not shipped in a release */
export const UNRELEASED_HEADING = '## Unreleased'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** `x.y.z` as three numbers, or null for anything that is not exactly that */
export function parseVersion(v) {
  if (typeof v !== 'string') return null
  const m = SEMVER.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** negative when a < b, 0 when equal, positive when a > b */
export function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

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
  // the archived translations (archive/i18n/README.md): no build reads them
  /^archive\//,
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
  const keys = Object.keys(value).sort().join(',')
  if (value.type === 'user-facing') {
    // the record written before 2026-10: it named an in-app release note
    if (keys === 'releaseNoteId,type') {
      if (typeof value.releaseNoteId !== 'string' || !/^release:.+$/.test(value.releaseNoteId)) return { problems: ['"releaseNoteId" must be "release:<version>"'] }
      return { value: { type: 'user-facing', releaseNoteId: value.releaseNoteId } }
    }
    const problems = []
    if (keys !== 'changelog,type') problems.push('a user-facing declaration has exactly "type" and "changelog"')
    if (typeof value.changelog !== 'string' || value.changelog.trim() === '') problems.push('"changelog" must be the line this change adds under "## Unreleased" in CHANGELOG.md')
    else if (/\n/.test(value.changelog)) problems.push('"changelog" is one line of the CHANGELOG, without a line break')
    return problems.length ? { problems } : { value: { type: 'user-facing', changelog: value.changelog } }
  }
  if (value.type === 'internal') {
    const problems = []
    if (keys !== 'reason,type') problems.push('an internal declaration has exactly "type" and "reason"')
    if (typeof value.reason !== 'string' || value.reason.trim() === '') problems.push('"reason" must say, in words, why no changelog entry is needed')
    return problems.length ? { problems } : { value: { type: 'internal', reason: value.reason } }
  }
  return { problems: ['"type" must be "user-facing" or "internal"'] }
}

/**
 * The lines of the CHANGELOG's `## Unreleased` section, trimmed and without
 * blanks: everything from that heading to the next `## ` heading.
 *
 * @param {string | null | undefined} text  the CHANGELOG's text; null when there is none
 * @returns {{lines: string[]} | {problem: string}}
 */
export function readUnreleased(text) {
  return readSection(text, (l) => l.trim() === UNRELEASED_HEADING, `"${UNRELEASED_HEADING}"`)
}

/**
 * The lines of the CHANGELOG's section for exactly `version`: a heading
 * `## v<version>` (then the end of the line, or a space and its date), up to
 * the next `## ` heading. A release change records its lines there (see
 * `evaluateChange`, step 5).
 *
 * @param {string | null | undefined} text
 * @param {string} version  x.y.z
 * @returns {{lines: string[]} | {problem: string}}
 */
export function readReleaseSection(text, version) {
  const heading = `## v${version}`
  return readSection(text, (l) => l === heading || l.startsWith(`${heading} `), `"${heading}"`)
}

function readSection(text, isHeading, name) {
  if (typeof text !== 'string') return { problem: `${CHANGELOG} could not be read` }
  const all = text.replace(/\r\n?/g, '\n').split('\n')
  const at = all.findIndex(isHeading)
  if (at < 0) return { problem: `${CHANGELOG} has no ${name} section` }
  const lines = []
  for (let i = at + 1; i < all.length; i++) {
    if (/^## /.test(all[i])) break
    if (all[i].trim() !== '') lines.push(all[i].trim())
  }
  return { lines }
}

/** Is `entry` one of `lines`, or the text of one of them after a list marker? */
const holds = (lines, entry) => {
  const want = entry.trim()
  return lines.some((l) => l === want || l.replace(/^[-*]\s+/, '') === want.replace(/^[-*]\s+/, ''))
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
 * @param {object} facts
 * @param {{status: string, path: string}[]} facts.changed  every path that differs from the base (status: A, M, D, R…)
 * @param {Record<string, string>} facts.declarationTexts   text of every `.changes/*.json` in the tree now
 * @param {string[]} facts.declarationDirEntries            every file in `.changes/` now
 * @param {string | null} facts.baseVersion                 the app version at the base; anything that is not x.y.z is a problem
 * @param {string} facts.headVersion                        the app version now
 * @param {string | null} facts.changelog                   the CHANGELOG's text now; null when there is none
 * @param {string | null} facts.baseChangelog               the CHANGELOG's text at the base; null when there was none
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
      if (mine.releaseNoteId !== undefined) {
        problems.push(`${added[0].path}: a new user-facing declaration names its line under "${UNRELEASED_HEADING}" in ${CHANGELOG} ("changelog"), not an in-app release note; the in-app notes were removed`)
      } else {
        summary.push(`declared user-facing (${added[0].path}): ${mine.changelog}`)
        // the line is under "## Unreleased" — or, for a release (a change that
        // RAISES the app version), under the section of exactly that new
        // version, which the release writes in the same change. Never another
        // version's section, and never outside "Unreleased" without a raise.
        const raised = Boolean(base && head && versionChanged && compareVersions(head, base) > 0)
        const releaseHeading = `## v${facts.headVersion}`
        const now = readUnreleased(facts.changelog)
        const release = raised ? readReleaseSection(facts.changelog, facts.headVersion) : null
        const inRelease = Boolean(release && !release.problem && holds(release.lines, mine.changelog))
        if (now.problem) {
          problems.push(`${added[0].path}: ${now.problem}`)
        } else if (!holds(now.lines, mine.changelog) && !inRelease) {
          problems.push(
            raised
              ? `${added[0].path}: its "changelog" line is neither under "${UNRELEASED_HEADING}" nor under "${releaseHeading}" in ${CHANGELOG}`
              : `${added[0].path}: its "changelog" line is not under "${UNRELEASED_HEADING}" in ${CHANGELOG}`,
          )
        } else {
          const then = readUnreleased(facts.baseChangelog)
          const thenRelease = raised ? readReleaseSection(facts.baseChangelog, facts.headVersion) : null
          if (!then.problem && holds(then.lines, mine.changelog)) {
            problems.push(`${added[0].path}: its "changelog" line was already under "${UNRELEASED_HEADING}" at the base; an entry an earlier change wrote does not stand for this one`)
          } else if (thenRelease && !thenRelease.problem && holds(thenRelease.lines, mine.changelog)) {
            problems.push(`${added[0].path}: its "changelog" line was already under "${releaseHeading}" at the base; an entry an earlier change wrote does not stand for this one`)
          }
        }
      }
    } else {
      summary.push(`declared internal (${added[0].path}): ${mine.reason}`)
    }
  } else if (!needs && added.length === 0) {
    summary.push('nothing that is built or shipped changed; no declaration is needed')
  }

  return { problems, summary }
}
