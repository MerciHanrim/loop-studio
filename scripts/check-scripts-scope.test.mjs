import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

// issue #621 items 3–6 — four check scripts that passed an error placed just
// outside what they read (reproduced on main `b88c63e2`):
//   3  check-arrow-direction merged five hand-listed catalogue slices, and its
//      pair-count check `expected = X + (checked − X)` could never fire;
//   4  check-form-direction declared EXPRESSION_FIELDS and never read it, so an
//      expression field could declare dir="auto";
//   5  check-functional-glyphs read a JSX expression only inside an element,
//      not inside a fragment;
//   6  check-mobile-query and check-arrow-direction read src/index.css only.
// Each case runs the real script on a COPY of `src/` (LOOP_CHECK_ROOT) with
// one planted change; the real tree is never edited.

const root = resolve(import.meta.dirname, '..')
const TIMEOUT = 120_000

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** a copy of src/ (and the arrow manifest), with `plant(at)` applied to it */
function tree(plant) {
  const dir = mkdtempSync(join(tmpdir(), 'loop-check-scope-'))
  dirs.push(dir)
  cpSync(resolve(root, 'src'), join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'scripts'))
  cpSync(resolve(root, 'scripts/arrow-units.json'), join(dir, 'scripts/arrow-units.json'))
  const at = (rel) => join(dir, rel)
  if (plant) plant(at)
  return dir
}
function run(script, dir) {
  const r = spawnSync(process.execPath, [resolve(root, 'scripts', script)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LOOP_CHECK_ROOT: dir },
  })
  return { status: r.status, out: r.stdout + r.stderr }
}
/** replace `from` with `to` in a file of the copy, exactly once */
function edit(file, from, to) {
  const text = readFileSync(file, 'utf8')
  const n = text.split(from).length - 1
  if (n !== 1) throw new Error(`fixture: ${JSON.stringify(from)} occurs ${n} times in ${file}`)
  writeFileSync(file, text.replace(from, to))
}
const append = (file, text) => writeFileSync(file, readFileSync(file, 'utf8') + text)

describe('the real tree passes every changed check', () => {
  for (const s of ['check-arrow-direction.mjs', 'check-form-direction.mjs', 'check-functional-glyphs.mjs', 'check-mobile-query.mjs']) {
    it(s, () => {
      const r = run(s, tree())
      expect(r.status, r.out).toBe(0)
    }, TIMEOUT)
  }
})

describe('item 3 — check-arrow-direction', () => {
  const ARROW_KEY = "  'r621.plant': 'Next →',\n"
  it('reads a slice the locale merges, not a hand list: an unclaimed arrow in a sixth `en` slice fails', () => {
    const dir = tree((at) => {
      writeFileSync(at('src/i18n/locales/en/extra.ts'), `const extra = {\n${ARROW_KEY}} as const\n\nexport default extra\n`)
      edit(at('src/i18n/locales/en/index.ts'), "import dataImport from './dataImport'\n", "import dataImport from './dataImport'\nimport extra from './extra'\n")
      edit(at('src/i18n/locales/en/index.ts'), '...dataImport }', '...dataImport, ...extra }')
    })
    const r = run('check-arrow-direction.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('en `r621.plant`: → belongs to no meaning unit')
  }, TIMEOUT)
  it('control: the same arrow in `en/ui.ts` fails', () => {
    const dir = tree((at) => edit(at('src/i18n/locales/en/ui.ts'), 'const ui = {\n', `const ui = {\n${ARROW_KEY}`))
    const r = run('check-arrow-direction.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('en `r621.plant`: → belongs to no meaning unit')
  }, TIMEOUT)
  it('the pair count fires on its own: a governed key removed from `de` is reported as a pair short', () => {
    const dir = tree((at) =>
      edit(at('src/i18n/locales/de/ui.ts'), "  'review.hunk.framesTake': 'Die Rahmen des Vorschlags übernehmen ({yours} → {theirs})',\n", ''),
    )
    const r = run('check-arrow-direction.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/de: 11 mandatory pair\(s\) evaluated, the manifest declares 12/)
  }, TIMEOUT)
})

describe('item 4 — check-form-direction reads EXPRESSION_FIELDS', () => {
  it('an expression field declaring dir="auto" fails', () => {
    const dir = tree((at) => edit(at('src/components/RegisterExprField.tsx'), '<input dir="ltr"\n          id={`${listId}-input`}', '<input dir="auto"\n          id={`${listId}-input`}'))
    const r = run('check-form-direction.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/an expression field \(src\/components\/RegisterExprField\.tsx:RegisterExprField:draft\) declares dir="auto"/)
  }, TIMEOUT)
  it('a listed expression field that matches no input fails, never a skip', () => {
    const dir = tree((at) => edit(at('src/components/RegisterExprField.tsx'), '          value={draft}\n', "          value={draft ?? ''}\n"))
    const r = run('check-form-direction.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('src/components/RegisterExprField.tsx:RegisterExprField:draft is listed as an expression field and matches 0 inputs')
  }, TIMEOUT)
  it('control: a number field declaring dir="auto" fails', () => {
    const dir = tree((at) => edit(at('src/components/DraftNumberInput.tsx'), '    <input\n      dir="ltr"\n      {...rest}', '    <input\n      dir="auto"\n      {...rest}'))
    const r = run('check-form-direction.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('a number field declares dir="auto"')
  }, TIMEOUT)
})

describe('item 5 — check-functional-glyphs reads a JSX expression in a fragment', () => {
  const component = (body) => `export function R621Plant() {\n  return ${body}\n}\n`
  it('a replaced glyph in `<>{…}</>` fails', () => {
    const dir = tree((at) => writeFileSync(at('src/components/R621Plant.tsx'), component("<>{'✕'}</>")))
    const r = run('check-functional-glyphs.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('src/components/R621Plant.tsx:2: renders `✕` (close) in JSX expression')
  }, TIMEOUT)
  it('control: the same glyph in `<span>{…}</span>` fails', () => {
    const dir = tree((at) => writeFileSync(at('src/components/R621Plant.tsx'), component("<span>{'✕'}</span>")))
    const r = run('check-functional-glyphs.mjs', dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('src/components/R621Plant.tsx:2: renders `✕` (close) in JSX expression')
  }, TIMEOUT)
})

describe('item 6 — the CSS checks read every stylesheet under src/', () => {
  const BREAKPOINT = '\n@media (max-width: 1100px) {\n  .r621-plant { display: none; }\n}\n'
  const FLIP = '\n.r621-plant { transform: scaleX(-1); }\n'
  it('check-mobile-query: a second breakpoint in workbench.css fails', () => {
    const r = run('check-mobile-query.mjs', tree((at) => append(at('src/components/workbench/workbench.css'), BREAKPOINT)))
    expect(r.status).toBe(1)
    expect(r.out).toContain('unexpected @media query in src/components/workbench/workbench.css: (max-width: 1100px)')
  }, TIMEOUT)
  it('check-mobile-query control: the same block in index.css fails', () => {
    const r = run('check-mobile-query.mjs', tree((at) => append(at('src/index.css'), BREAKPOINT)))
    expect(r.status).toBe(1)
    expect(r.out).toContain('unexpected @media query in src/index.css: (max-width: 1100px)')
  }, TIMEOUT)
  it('check-arrow-direction: a mirroring transform in workbench.css fails', () => {
    const r = run('check-arrow-direction.mjs', tree((at) => append(at('src/components/workbench/workbench.css'), FLIP)))
    expect(r.status).toBe(1)
    expect(r.out).toContain('src/components/workbench/workbench.css: contains a mirroring transform')
  }, TIMEOUT)
  it('check-arrow-direction control: the same rule in index.css fails', () => {
    const r = run('check-arrow-direction.mjs', tree((at) => append(at('src/index.css'), FLIP)))
    expect(r.status).toBe(1)
    expect(r.out).toContain('src/index.css: contains a mirroring transform')
  }, TIMEOUT)
})
