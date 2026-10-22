import { describe, expect, it } from 'vitest'
import { evaluateChange, isProductPath, parseDeclaration, readPackageVersion, readUnreleased } from './change-declaration.mjs'

// Issue #296 — the change-declaration rule, on made-up facts. The script that
// gathers real facts from git is `check-change-declaration.mjs`. Revised
// 2026-10: a user-facing change names its line under "## Unreleased" in
// CHANGELOG.md, and no longer raises the app version itself.

const INTERNAL = JSON.stringify({ type: 'internal', reason: 'A refactor with no visible change.' })
const ENTRY = '- **Structures**: save a selection and insert it into another document from the File menu.'
const USER = (line = ENTRY) => JSON.stringify({ type: 'user-facing', changelog: line })
const LEGACY = (id = 'release:0.15.0') => JSON.stringify({ type: 'user-facing', releaseNoteId: id })

const log = (unreleased = [], older = '## v0.28.4 — 2026-10-17\n\n- an older line\n') =>
  `# Changelog\n\nIntro.\n\n## Unreleased\n\n${unreleased.join('\n')}\n\n${older}`
const BASE_LOG = log([])
const HEAD_LOG = log([ENTRY])

/** facts with sensible defaults; `added` maps a new declaration's slug to its text */
function facts({
  changed = [],
  added = {},
  existing = {},
  baseVersion = '0.14.0',
  headVersion = '0.14.0',
  changelog = HEAD_LOG,
  baseChangelog = BASE_LOG,
  extraEntries = [],
} = {}) {
  const declarationTexts = { ...existing }
  const all = [...changed]
  for (const [slug, text] of Object.entries(added)) {
    declarationTexts[`.changes/${slug}.json`] = text
    all.push({ status: 'A', path: `.changes/${slug}.json` })
  }
  return { changed: all, declarationTexts, declarationDirEntries: [...Object.keys(declarationTexts), ...extraEntries], baseVersion, headVersion, changelog, baseChangelog }
}
const problems = (f) => evaluateChange(facts(f)).problems
const SRC = { status: 'M', path: 'src/store/uiStore.ts' }

describe('what is built or shipped', () => {
  it('source, static files and the HTML entry', () => {
    for (const p of ['src/App.tsx', 'src/index.css', 'src/i18n/locales/ko/ui.ts', 'public/icons/icon-192.png', 'index.html', 'src\\store\\uiStore.ts', 'src/pwa/manifest.ts']) expect(isProductPath(p)).toBe(true)
  })
  it('what the builds read outside src/: bundled templates, build settings, dependencies', () => {
    for (const p of [
      'examples/coffee-roastery.json', // imported by src/model/templates.ts
      'vite.config.ts', // web, portable and PWA build, the service-worker settings
      'scripts/locale-chunk.mjs', // imported by vite.config.ts
      'scripts/gen-icons.mjs', // writes the shipped icons
      'package.json', // runtime dependencies, the build commands
      'package-lock.json', // the resolved versions of everything that is bundled
      'tsconfig.app.json',
      'tsconfig.json',
      '.nvmrc',
    ])
      expect(isProductPath(p), p).toBe(true)
  })
  it('a path nobody has classified counts as shipping', () => {
    for (const p of ['wrangler.toml', 'rolldown.config.mjs', 'scripts/new-build-step.mjs', 'assets/logo.svg', 'public/README.md', 'src/notes.md']) expect(isProductPath(p), p).toBe(true)
  })
  it('documents, tests, CI, the archive and the checks themselves do not ship', () => {
    for (const p of [
      'src/store/uiStore.test.ts',
      'src/components/A.test.tsx',
      'scripts/change-declaration.test.mjs',
      'e2e/mobile.spec.ts',
      'e2e/support/loop.ts',
      'test/orthogonalRoute.test.ts',
      'playwright.config.ts',
      'playwright.pwa.config.ts',
      'tsconfig.e2e.json',
      'scripts/check-i18n.mjs',
      'scripts/change-declaration.mjs',
      'scripts/registry-source.mjs',
      'scripts/arrow-units.json',
      'docs/pwa.md',
      'README.md',
      'CHANGELOG.md',
      'examples/README.md',
      'archive/i18n/locales/fr/ui.ts', // archived translations: no build reads them
      '.github/workflows/ci.yml',
      '.gitignore',
      '.oxlintrc.json',
      '.changes/a.json',
      '.changes/README.md',
    ])
      expect(isProductPath(p), p).toBe(false)
  })
})

describe('a declaration file', () => {
  it('reads the two shapes, and the record written before 2026-10', () => {
    expect(parseDeclaration(INTERNAL).value).toEqual({ type: 'internal', reason: 'A refactor with no visible change.' })
    expect(parseDeclaration(USER()).value).toEqual({ type: 'user-facing', changelog: ENTRY })
    // an old declaration is a record and must still parse, or the whole folder fails
    expect(parseDeclaration(LEGACY()).value).toEqual({ type: 'user-facing', releaseNoteId: 'release:0.15.0' })
  })
  const bad = [
    ['not JSON', '{', /not valid JSON/],
    ['not an object', '[]', /must be a JSON object/],
    ['an unknown type', '{"type":"minor"}', /"type" must be/],
    ['no type', '{"reason":"x"}', /"type" must be/],
    ['internal with an empty reason', '{"type":"internal","reason":"  "}', /must say, in words/],
    ['internal with no reason', '{"type":"internal"}', /exactly "type" and "reason"/],
    ['internal with an extra key', '{"type":"internal","reason":"x","changelog":"y"}', /exactly "type" and "reason"/],
    ['user-facing with nothing named', '{"type":"user-facing"}', /exactly "type" and "changelog"/],
    ['user-facing with an empty line', '{"type":"user-facing","changelog":" "}', /must be the line this change adds/],
    ['user-facing with two lines', '{"type":"user-facing","changelog":"a\\nb"}', /without a line break/],
    ['user-facing with an extra key', '{"type":"user-facing","changelog":"x","reason":"y"}', /exactly "type" and "changelog"/],
    ['a legacy record with a bare version', '{"type":"user-facing","releaseNoteId":"0.15.0"}', /must be "release:<version>"/],
  ]
  for (const [name, text, expected] of bad) {
    it(`rejects ${name}`, () => {
      expect(parseDeclaration(text).problems.join('\n')).toMatch(expected)
    })
  }
})

describe('the Unreleased section of the CHANGELOG', () => {
  it('is everything from its heading to the next release heading, blanks left out', () => {
    expect(readUnreleased(log(['- one', '', '- two']))).toEqual({ lines: ['- one', '- two'] })
    expect(readUnreleased(log([]))).toEqual({ lines: [] })
    // CRLF reads the same
    expect(readUnreleased(log(['- one']).replace(/\n/g, '\r\n'))).toEqual({ lines: ['- one'] })
  })
  it('a CHANGELOG with no such section, or none at all, is a reason, never an empty list', () => {
    expect(readUnreleased('# Changelog\n\n## v0.28.4\n\n- x\n').problem).toMatch(/has no "## Unreleased" section/)
    expect(readUnreleased(null).problem).toMatch(/could not be read/)
  })
})

describe('does this change need a declaration', () => {
  it('nothing that ships changed: none is needed', () => {
    expect(problems({ changed: [{ status: 'M', path: 'docs/pwa.md' }, { status: 'M', path: 'e2e/mobile.spec.ts' }, { status: 'M', path: 'src/store/uiStore.test.ts' }] })).toEqual([])
  })
  it('a product file changed and nothing was declared', () => {
    expect(problems({ changed: [SRC] }).join('\n')).toMatch(/needs a declaration.*touches what is built or shipped \(src\/store\/uiStore\.ts\)/)
  })
  it('a dependency, the lockfile or a build setting changed and nothing was declared', () => {
    for (const path of ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/locale-chunk.mjs', 'examples/deadlock.json', 'tsconfig.app.json']) {
      expect(problems({ changed: [{ status: 'M', path }] }).join('\n'), path).toMatch(/needs a declaration.*touches what is built or shipped/)
    }
  })
  it('only documents, unit tests, e2e specs, the archive and checks changed: still none is needed', () => {
    expect(
      problems({
        changed: [
          { status: 'M', path: 'docs/pwa.md' },
          { status: 'M', path: 'README.md' },
          { status: 'A', path: 'src/store/new.test.ts' },
          { status: 'M', path: 'e2e/mobile.spec.ts' },
          { status: 'A', path: 'archive/i18n/e2e/i18n-fr.spec.ts' },
          { status: 'M', path: 'scripts/check-i18n.mjs' },
          { status: 'M', path: '.github/workflows/ci.yml' },
        ],
      }),
    ).toEqual([])
  })
  it('a product file deleted, a static file added, the HTML entry edited: each needs one', () => {
    for (const c of [{ status: 'D', path: 'src/old.ts' }, { status: 'A', path: 'public/new.png' }, { status: 'M', path: 'index.html' }]) {
      expect(problems({ changed: [c] }).join('\n')).toMatch(/needs a declaration/)
    }
  })
  it('only the app version changed: that needs one too', () => {
    expect(problems({ changed: [{ status: 'M', path: 'package.json' }], headVersion: '0.14.1' }).join('\n')).toMatch(/needs a declaration.*built or shipped \(package\.json\)/)
    // the version is watched on its own too, wherever it is kept
    expect(problems({ changed: [], headVersion: '0.14.1' }).join('\n')).toMatch(/needs a declaration.*changes the app version/)
  })
  it('an internal declaration with a reason satisfies it', () => {
    expect(problems({ changed: [SRC], added: { 'storage-port': INTERNAL } })).toEqual([])
  })
  it('a release raises the version under a declaration of its own', () => {
    expect(problems({ changed: [SRC], added: { release: INTERNAL }, headVersion: '0.14.1' })).toEqual([])
    expect(problems({ changed: [SRC], added: { release: INTERNAL }, headVersion: '0.15.0' })).toEqual([])
    expect(problems({ changed: [SRC], added: { release: INTERNAL }, baseVersion: '0.9.9', headVersion: '0.10.0' })).toEqual([])
  })
  it('no change may lower the version', () => {
    expect(problems({ changed: [SRC], added: { hotfix: INTERNAL }, headVersion: '0.13.0' }).join('\n')).toMatch(/went from 0\.14\.0 to 0\.13\.0; a version that changes only goes up/)
    expect(problems({ changed: [SRC], added: { hotfix: INTERNAL }, baseVersion: '0.10.0', headVersion: '0.9.9' }).join('\n')).toMatch(/only goes up/)
    expect(problems({ changed: [SRC], added: { visible: USER() }, headVersion: '0.13.0' }).join('\n')).toMatch(/only goes up/)
    // and a fall is a fall with nothing else changed, and with nothing declared
    expect(problems({ changed: [], headVersion: '0.13.9' }).join('\n')).toMatch(/only goes up/)
  })
  it('the version at the base must be known', () => {
    for (const unknown of [null, '', 'next', '0.14', 'v0.14.0', '0.14.0-beta.1']) {
      const p = problems({ changed: [SRC], added: { hotfix: INTERNAL }, baseVersion: unknown, headVersion: '0.14.0' }).join('\n')
      expect(p, String(unknown)).toMatch(/the app version at the base .* is not x\.y\.z/)
    }
  })
  it('two declarations for one change', () => {
    expect(problems({ changed: [SRC], added: { one: INTERNAL, two: INTERNAL } }).join('\n')).toMatch(/2 declarations were added.*exactly one/)
  })
  it('a declaration is allowed, not required, when nothing ships', () => {
    expect(problems({ changed: [{ status: 'M', path: 'docs/pwa.md' }], added: { docs: INTERNAL } })).toEqual([])
  })
})

describe('a user-facing change', () => {
  const good = { changed: [SRC, { status: 'M', path: 'CHANGELOG.md' }], added: { structures: USER() } }
  it('with its line added under Unreleased, and the version left alone', () => {
    expect(problems(good)).toEqual([])
  })
  it('does NOT need to raise the version — that waits for an approved release', () => {
    expect(problems({ ...good, headVersion: '0.14.0', baseVersion: '0.14.0' })).toEqual([])
  })
  it('the line may be named with or without its list marker', () => {
    expect(problems({ ...good, added: { structures: USER(ENTRY.replace(/^- /, '')) } })).toEqual([])
  })
  it('whose line is not in the CHANGELOG', () => {
    expect(problems({ ...good, changelog: BASE_LOG }).join('\n')).toMatch(/its "changelog" line is not under "## Unreleased"/)
  })
  it('whose line sits under an older release, not under Unreleased', () => {
    const misplaced = log([], `## v0.28.4 — 2026-10-17\n\n${ENTRY}\n`)
    expect(problems({ ...good, changelog: misplaced }).join('\n')).toMatch(/is not under "## Unreleased"/)
  })
  it('whose line an earlier change already wrote', () => {
    expect(problems({ ...good, baseChangelog: HEAD_LOG }).join('\n')).toMatch(/was already under "## Unreleased" at the base/)
  })
  it('with no Unreleased section, or no CHANGELOG at all', () => {
    expect(problems({ ...good, changelog: '# Changelog\n\n## v0.28.4\n\n- x\n' }).join('\n')).toMatch(/has no "## Unreleased" section/)
    expect(problems({ ...good, changelog: null }).join('\n')).toMatch(/could not be read/)
  })
  it('a NEW declaration in the old shape, naming an in-app release note, is refused', () => {
    expect(problems({ ...good, added: { visible: LEGACY('release:0.15.0') }, headVersion: '0.15.0' }).join('\n')).toMatch(/names its line under "## Unreleased".*not an in-app release note/)
  })
  it('old declarations in the old shape stay valid records', () => {
    expect(problems({ ...good, existing: { '.changes/whats-new.json': LEGACY() } })).toEqual([])
  })
})

describe('versions are compared as numbers', () => {
  const at = (baseVersion, headVersion) => ({ changed: [SRC], added: { release: INTERNAL }, baseVersion, headVersion })
  it('0.9.9 -> 0.10.0 is a rise, although "0.10.0" sorts before "0.9.9" as text', () => {
    expect(['0.9.9', '0.10.0'].sort()).toEqual(['0.10.0', '0.9.9'])
    expect(problems(at('0.9.9', '0.10.0'))).toEqual([])
    expect(problems(at('0.99.9', '1.0.0'))).toEqual([])
    expect(problems(at('1.9.0', '1.10.0'))).toEqual([])
  })
  it('0.10.0 -> 0.9.9 is a fall', () => {
    expect(problems(at('0.10.0', '0.9.9')).join('\n')).toMatch(/a version that changes only goes up/)
  })
  it('a pre-release or malformed app version is refused, whatever the declaration says', () => {
    for (const bad of ['0.15.0-beta.1', '0.15.0+build.3', 'v0.15.0', '0.15', '0.15.0.1', '01.2.3', 'next']) {
      expect(problems(at('0.14.0', bad)).join('\n'), bad).toMatch(/the app version ".*" is not x\.y\.z/)
      expect(problems({ changed: [SRC], added: { visible: USER() }, headVersion: bad }).join('\n'), bad).toMatch(/is not x\.y\.z/)
    }
  })
})

describe('the app version in a package.json text', () => {
  it('reads an x.y.z version', () => {
    expect(readPackageVersion('{"name":"loop-studio","version":"0.14.0"}')).toEqual({ version: '0.14.0' })
  })
  const BAD = [
    ['a file that could not be read', null, /could not be read/],
    ['an undefined text', undefined, /could not be read/],
    ['an empty file', '', /not valid JSON/],
    ['text that is not JSON', '{ version: 0.14.0 }', /not valid JSON/],
    ['a JSON array', '[]', /not a JSON object/],
    ['JSON null', 'null', /not a JSON object/],
    ['no version field', '{"name":"loop-studio"}', /has no "version"/],
    ['a null version', '{"version":null}', /not a string/],
    ['a numeric version', '{"version":14}', /not a string/],
    ['an empty version', '{"version":""}', /not x\.y\.z/],
    ['a pre-release version', '{"version":"0.15.0-beta.1"}', /not x\.y\.z/],
    ['a two-part version', '{"version":"0.15"}', /not x\.y\.z/],
  ]
  for (const [name, text, why] of BAD) {
    it(`gives a reason, never a default, for ${name}`, () => {
      const r = readPackageVersion(text)
      expect(r.version).toBeUndefined()
      expect(r.problem).toMatch(why)
    })
  }
})

describe('declarations are a record', () => {
  const old = { '.changes/earlier.json': INTERNAL }
  it('an existing one edited, removed or renamed', () => {
    for (const status of ['M', 'D', 'R']) {
      expect(problems({ existing: old, changed: [{ status, path: '.changes/earlier.json' }] }).join('\n')).toMatch(/never edited, renamed or removed/)
    }
  })
  it('an existing one that is malformed fails even when this change does not touch it', () => {
    expect(problems({ existing: { '.changes/earlier.json': '{"type":"internal"}' }, changed: [{ status: 'M', path: 'docs/pwa.md' }] }).join('\n')).toMatch(/\.changes\/earlier\.json: an internal declaration has exactly/)
  })
  it('a file in the folder that is not a declaration', () => {
    for (const entry of ['.changes/Upper.json', '.changes/notes.txt', '.changes/a_b.json', '.changes/.json']) {
      expect(problems({ extraEntries: [entry] }).join('\n')).toMatch(/a declaration is "\.changes\/<slug>\.json"/)
    }
  })
  it('the README in the folder is allowed', () => {
    expect(problems({ extraEntries: ['.changes/README.md'], changed: [{ status: 'M', path: '.changes/README.md' }] })).toEqual([])
  })
  it('a new file with a bad name does not count as the declaration', () => {
    const p = problems({ changed: [SRC, { status: 'A', path: '.changes/Bad Name.json' }], extraEntries: ['.changes/Bad Name.json'] })
    expect(p.join('\n')).toMatch(/needs a declaration/)
  })
})
