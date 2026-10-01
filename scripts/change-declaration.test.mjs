import { describe, expect, it } from 'vitest'
import { evaluateChange, isProductPath, parseDeclaration } from './change-declaration.mjs'

// Issue #296 — the change-declaration rule, on made-up facts. The script that
// gathers real facts from git is `check-change-declaration.mjs`.

const INTERNAL = JSON.stringify({ type: 'internal', reason: 'A refactor with no visible change.' })
const USER = (id = 'release:0.15.0') => JSON.stringify({ type: 'user-facing', releaseNoteId: id })
const NOTE = { id: 'release:0.15.0', version: '0.15.0' }

/** facts with sensible defaults; `added` maps a new declaration's slug to its text */
function facts({ changed = [], added = {}, existing = {}, baseVersion = '0.14.0', headVersion = '0.14.0', notes = [], extraEntries = [] } = {}) {
  const declarationTexts = { ...existing }
  const all = [...changed]
  for (const [slug, text] of Object.entries(added)) {
    declarationTexts[`.changes/${slug}.json`] = text
    all.push({ status: 'A', path: `.changes/${slug}.json` })
  }
  return { changed: all, declarationTexts, declarationDirEntries: [...Object.keys(declarationTexts), ...extraEntries], baseVersion, headVersion, notes }
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
  it('documents, tests, CI and the checks themselves do not ship', () => {
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
  it('reads the two shapes', () => {
    expect(parseDeclaration(INTERNAL).value).toEqual({ type: 'internal', reason: 'A refactor with no visible change.' })
    expect(parseDeclaration(USER()).value).toEqual({ type: 'user-facing', releaseNoteId: 'release:0.15.0' })
  })
  const bad = [
    ['not JSON', '{', /not valid JSON/],
    ['not an object', '[]', /must be a JSON object/],
    ['an unknown type', '{"type":"minor"}', /"type" must be/],
    ['no type', '{"reason":"x"}', /"type" must be/],
    ['internal with an empty reason', '{"type":"internal","reason":"  "}', /must say, in words/],
    ['internal with no reason', '{"type":"internal"}', /exactly "type" and "reason"/],
    ['internal with an extra key', '{"type":"internal","reason":"x","releaseNoteId":"release:1.0.0"}', /exactly "type" and "reason"/],
    ['user-facing with no id', '{"type":"user-facing"}', /exactly "type" and "releaseNoteId"/],
    ['user-facing with a bare version', '{"type":"user-facing","releaseNoteId":"0.15.0"}', /must be "release:<version>"/],
    ['user-facing with an extra key', '{"type":"user-facing","releaseNoteId":"release:0.15.0","reason":"x"}', /exactly "type" and "releaseNoteId"/],
  ]
  for (const [name, text, expected] of bad) {
    it(`rejects ${name}`, () => {
      expect(parseDeclaration(text).problems.join('\n')).toMatch(expected)
    })
  }
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
  it('only documents, unit tests, e2e specs and checks changed: still none is needed', () => {
    expect(
      problems({
        changed: [
          { status: 'M', path: 'docs/pwa.md' },
          { status: 'M', path: 'README.md' },
          { status: 'A', path: 'src/store/new.test.ts' },
          { status: 'M', path: 'e2e/mobile.spec.ts' },
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
  it('an internal change may raise the version without a note', () => {
    expect(problems({ changed: [SRC], added: { hotfix: INTERNAL }, headVersion: '0.14.1' })).toEqual([])
  })
  it('two declarations for one change', () => {
    expect(problems({ changed: [SRC], added: { one: INTERNAL, two: INTERNAL } }).join('\n')).toMatch(/2 declarations were added.*exactly one/)
  })
  it('a declaration is allowed, not required, when nothing ships', () => {
    expect(problems({ changed: [{ status: 'M', path: 'docs/pwa.md' }], added: { docs: INTERNAL } })).toEqual([])
  })
})

describe('a user-facing change', () => {
  const good = { changed: [SRC], added: { 'whats-new': USER() }, headVersion: '0.15.0', notes: [NOTE] }
  it('with the version raised and its release note present', () => {
    expect(problems(good)).toEqual([])
  })
  it('without a version change', () => {
    expect(problems({ ...good, headVersion: '0.14.0', added: { 'whats-new': USER('release:0.14.0') }, notes: [{ id: 'release:0.14.0', version: '0.14.0' }] }).join('\n')).toMatch(/changes the app version, and it is still 0\.14\.0/)
  })
  it('with the version lowered', () => {
    expect(problems({ ...good, headVersion: '0.13.9', added: { 'whats-new': USER('release:0.13.9') }, notes: [{ id: 'release:0.13.9', version: '0.13.9' }] }).join('\n')).toMatch(/a user-facing change raises it/)
  })
  it('naming a release note for another version', () => {
    expect(problems({ ...good, added: { 'whats-new': USER('release:0.16.0') }, notes: [NOTE, { id: 'release:0.16.0', version: '0.16.0' }] }).join('\n')).toMatch(/it must be release:0\.15\.0/)
  })
  it('whose release note does not exist', () => {
    expect(problems({ ...good, notes: [] }).join('\n')).toMatch(/there is no release note with the id release:0\.15\.0/)
  })
})

describe('versions are compared as numbers', () => {
  const at = (baseVersion, headVersion) => ({
    changed: [SRC],
    added: { release: USER(`release:${headVersion}`) },
    baseVersion,
    headVersion,
    notes: [{ id: `release:${headVersion}`, version: headVersion }],
  })
  it('0.9.9 -> 0.10.0 is a rise, although "0.10.0" sorts before "0.9.9" as text', () => {
    expect('0.10.0' < '0.9.9').toBe(true)
    expect(problems(at('0.9.9', '0.10.0'))).toEqual([])
    expect(problems(at('0.99.9', '1.0.0'))).toEqual([])
    expect(problems(at('1.9.0', '1.10.0'))).toEqual([])
  })
  it('0.10.0 -> 0.9.9 is a fall', () => {
    expect(problems(at('0.10.0', '0.9.9')).join('\n')).toMatch(/a user-facing change raises it/)
  })
  it('a pre-release or malformed app version is refused, whatever the declaration says', () => {
    for (const bad of ['0.15.0-beta.1', '0.15.0+build.3', 'v0.15.0', '0.15', '0.15.0.1', '01.2.3', 'next']) {
      expect(problems(at('0.14.0', bad)).join('\n'), bad).toMatch(/the app version ".*" is not x\.y\.z/)
      expect(problems({ changed: [SRC], added: { hotfix: INTERNAL }, headVersion: bad }).join('\n'), bad).toMatch(/is not x\.y\.z/)
    }
  })
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
