import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { catalogSlices } from './catalog-slices.mjs'

// issue #414 — `check-i18n.mjs` reads the slice list from the base locale's
// `index.ts` instead of a list of its own. The same script runs here against
// a fixture tree (LOOP_I18N_LOCALES_DIR / LOOP_I18N_SRC_DIR); before the fix,
// a sixth slice merged by `en/index.ts` was invisible to it — the ICU rules
// never reached the slice and the run printed `ok` — which is the first case.

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/check-i18n.mjs')
const FIVE = ['ui', 'canvas', 'inspector', 'templates', 'dataImport']

const slice = (entries) =>
  `const s = {\n${Object.entries(entries)
    .map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`)
    .join('\n')}\n} as const\n\nexport default s\n`
const indexOf = (slices, base) =>
  `${base ? '' : "import type { MessageCatalog } from '../en'\n"}${slices.map((s) => `import ${s} from './${s}'`).join('\n')}\n\n` +
  (base
    ? `const en = { ${slices.map((s) => `...${s}`).join(', ')} } as const\n\nexport type MessageKey = keyof typeof en\nexport type MessageCatalog = Record<MessageKey, string>\n\nexport default en\n`
    : `const xx = { ${slices.map((s) => `...${s}`).join(', ')} } satisfies MessageCatalog\n\nexport default xx\n`)

/** a fixture tree: en + xx folder locales with the given slices, and a src
 *  file that references every key (so the dead-key scan is satisfied) */
function fixture({ enSlices, xxSlices = enSlices, enFiles, xxFiles, xxExtraFiles = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'loop-i18n-'))
  const locales = join(dir, 'locales')
  const src = join(dir, 'src')
  mkdirSync(join(locales, 'en'), { recursive: true })
  mkdirSync(join(locales, 'xx'), { recursive: true })
  mkdirSync(src, { recursive: true })
  const keys = new Set()
  for (const [name, entries] of Object.entries(enFiles)) {
    writeFileSync(join(locales, 'en', `${name}.ts`), slice(entries))
    for (const k of Object.keys(entries)) keys.add(k)
  }
  for (const [name, entries] of Object.entries(xxFiles)) writeFileSync(join(locales, 'xx', `${name}.ts`), slice(entries))
  for (const [name, text] of Object.entries(xxExtraFiles)) writeFileSync(join(locales, 'xx', name), text)
  writeFileSync(join(locales, 'en', 'index.ts'), indexOf(enSlices, true))
  writeFileSync(join(locales, 'xx', 'index.ts'), indexOf(xxSlices, false))
  writeFileSync(join(src, 'use.ts'), `const t = (k: string) => k\nexport const used = [${[...keys].map((k) => `t('${k}')`).join(', ')}]\n`)
  return { dir, locales, src }
}
const run = ({ locales, src }) =>
  spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LOOP_I18N_LOCALES_DIR: locales, LOOP_I18N_SRC_DIR: src },
  })

const one = (k, v) => ({ [k]: v })
const baseFive = {
  ui: one('ui.hello', 'Hello {name}'),
  canvas: one('canvas.one', 'One'),
  inspector: one('inspector.one', 'Two'),
  templates: one('templates.one', 'Three'),
  dataImport: one('import.one', 'Four'),
}
const GOOD_EXTRA = one('extra.count', '{n, plural, one {# thing} other {# things}}')
const BAD_EXTRA = one('extra.count', '{n, plural, one {# thing}}') // no `other` arm — an ICU rule the check exists for

const made = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})
const make = (opts) => {
  const f = fixture(opts)
  made.push(f.dir)
  return f
}

describe('catalogSlices — the slices a locale index.ts merges, in spread order', () => {
  it('reads the real base locale', () => {
    expect(catalogSlices(resolve(root, 'src/i18n/locales/en/index.ts'))).toEqual(FIVE)
  })
  it('reads a six-slice fixture, in spread order, and refuses what it cannot read', () => {
    const six = [...FIVE, 'extra']
    const f = make({ enSlices: six, enFiles: { ...baseFive, extra: GOOD_EXTRA }, xxFiles: { ...baseFive, extra: GOOD_EXTRA } })
    expect(catalogSlices(join(f.locales, 'en', 'index.ts'))).toEqual(six)
    writeFileSync(join(f.locales, 'xx', 'index.ts'), "import ui from './ui'\nimport canvas from './canvas'\n\nconst xx = { ...ui, 'stray.key': 'x' }\n\nexport default xx\n")
    expect(() => catalogSlices(join(f.locales, 'xx', 'index.ts'))).toThrow(/not a spread/)
    writeFileSync(join(f.locales, 'xx', 'index.ts'), "import ui from './ui'\nimport canvas from './canvas'\n\nconst xx = { ...ui }\n\nexport default xx\n")
    expect(() => catalogSlices(join(f.locales, 'xx', 'index.ts'))).toThrow(/"canvas" is imported .* but not merged/)
  })
})

describe('check-i18n over a fixture tree (#414)', () => {
  it('a sixth slice merged by en/index.ts is CHECKED: an ICU fault inside it fails the run (before #414 the run printed ok)', () => {
    const six = [...FIVE, 'extra']
    const f = make({ enSlices: six, enFiles: { ...baseFive, extra: GOOD_EXTRA }, xxFiles: { ...baseFive, extra: BAD_EXTRA } })
    const r = run(f)
    expect(r.status, r.stdout + r.stderr).toBe(1)
    expect(r.stdout).toMatch(/en\/index\.ts merges 6 slices: ui, canvas, inspector, templates, dataImport, extra/)
    expect(r.stderr).toMatch(/xx:extra\.count — ICU parse error: MISSING_OTHER_CLAUSE/)
  })

  it('the same six slices, all sound: ok, and the slice count comes from the merge', () => {
    const six = [...FIVE, 'extra']
    const f = make({ enSlices: six, enFiles: { ...baseFive, extra: GOOD_EXTRA }, xxFiles: { ...baseFive, extra: GOOD_EXTRA } })
    const r = run(f)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/xx: 6 domain slices, 6 keys, no cross-file duplication, merges to base/)
    expect(r.stdout).toMatch(/check-i18n: ok/)
  })

  it('a locale file that the base merge does not name is a stop — a translation nothing ships', () => {
    const f = make({ enSlices: FIVE, enFiles: baseFive, xxFiles: baseFive, xxExtraFiles: { 'extra.ts': slice(GOOD_EXTRA) } })
    const r = run(f)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/xx: extra\.ts is not a slice en\/index\.ts merges/)
  })

  it('a locale whose index.ts merges the slices in another order, or a different set, is a stop', () => {
    const reordered = make({ enSlices: FIVE, xxSlices: ['canvas', 'ui', 'inspector', 'templates', 'dataImport'], enFiles: baseFive, xxFiles: baseFive })
    const r1 = run(reordered)
    expect(r1.status).toBe(1)
    expect(r1.stderr).toMatch(/xx: index\.ts merges \[canvas, ui, .*\] but en\/index\.ts merges \[ui, canvas, .*\] \(same slices, same order\)/)

    const fewer = make({ enSlices: FIVE, xxSlices: FIVE.slice(0, 4), enFiles: baseFive, xxFiles: baseFive })
    const r2 = run(fewer)
    expect(r2.status).toBe(1)
    expect(r2.stderr).toMatch(/xx: index\.ts merges \[ui, canvas, inspector, templates\] but en\/index\.ts merges/)
  })

  it('the five-slice shape the product has today passes unchanged', () => {
    const f = make({ enSlices: FIVE, enFiles: baseFive, xxFiles: baseFive })
    const r = run(f)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/en\/index\.ts merges 5 slices/)
  })
})
