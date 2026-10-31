import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

// issue #424 item 1 — `check-template-labels.mjs` must hold the dictionary
// loaders (`DICT_LOADERS` in src/i18n/templateLabels/dicts.ts) to EXACTLY the
// registry's non-base locales. Before: a locale dropped from the loaders was
// reported as "ok … no dictionary module — every template opens in English",
// and nothing else that runs in CI noticed it on purpose (reproduced with `ja`
// on main `5c072d96`). The same script runs here with a fixture copy of
// dicts.ts (LOOP_TEMPLATE_DICTS_FILE); everything else is the real tree.

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/check-template-labels.mjs')
const DICTS = readFileSync(resolve(root, 'src/i18n/templateLabels/dicts.ts'), 'utf8')
const JA_LINE = "  ja: () => import('./ja').then((m) => ({ nodes: m.ja, frames: m.jaFrames ?? {} })),\n"

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
/** run the check with `text` standing in for dicts.ts (or the real file) */
function run(text) {
  const env = { ...process.env }
  if (text !== undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'loop-tpl-dicts-'))
    dirs.push(dir)
    const file = join(dir, 'dicts.ts')
    writeFileSync(file, text)
    env.LOOP_TEMPLATE_DICTS_FILE = file
  }
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env })
}

describe('check-template-labels: DICT_LOADERS and the registry name the same locales', () => {
  it('the real tree passes', () => {
    const r = run()
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it('a registry locale dropped from the loaders (ja) fails, by name', () => {
    expect(DICTS).toContain(JA_LINE) // the fixture really removes something
    const r = run(DICTS.replace(JA_LINE, ''))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/FAIL {2}ja: a non-base locale in the registry with no DICT_LOADERS entry/)
    expect(r.stdout).not.toMatch(/ok {4}ja: no dictionary module/)
  })

  it('a loader for a locale the registry does not ship fails, by name', () => {
    const extra = DICTS.replace(JA_LINE, JA_LINE + "  xx: () => import('./ja').then((m) => ({ nodes: m.ja, frames: {} })),\n")
    const r = run(extra)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/FAIL {2}xx: a DICT_LOADERS entry for a locale that is not a non-base locale in the registry/)
  })

  it('a loader block it cannot read fails closed', () => {
    const r = run(DICTS.replace('DICT_LOADERS', 'DICT_LOADERZ'))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/could not read the DICT_LOADERS block/)
  })
})
