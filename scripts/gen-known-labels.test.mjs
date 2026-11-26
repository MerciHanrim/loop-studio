import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

// issue #621 item 2 — `gen-known-labels.mjs` read the registry with a regex:
// a locale code in double quotes was dropped, and a re-indented closing `]`
// made the non-base list empty. Either way the generator wrote a smaller
// `known.generated.ts` (the Korean, or every translated, official label gone)
// and from then on `--check` compared that file with the same wrong read, so
// `check-template-labels` stayed green (reproduced on main `b88c63e2`).
//
// The generator runs here as a process with a fixture registry
// (LOOP_REGISTRY_FILE) and a scratch output file (LOOP_KNOWN_LABELS_OUT); the
// rest is the real tree, and the committed file is never rewritten.

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/gen-known-labels.mjs')
const REGISTRY = readFileSync(resolve(root, 'src/i18n/registry.ts'), 'utf8')
const COMMITTED = readFileSync(resolve(root, 'src/i18n/templateLabels/known.generated.ts'), 'utf8')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const scratchDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'loop-known-labels-'))
  dirs.push(d)
  return d
}

/** run the generator; `registry` stands in for registry.ts, `out` for the output file */
function run({ registry, out, check = false } = {}) {
  const env = { ...process.env }
  delete env.LOOP_REGISTRY_FILE
  delete env.LOOP_KNOWN_LABELS_OUT
  if (registry !== undefined) {
    const file = join(scratchDir(), 'registry.ts')
    writeFileSync(file, registry)
    env.LOOP_REGISTRY_FILE = file
  }
  if (out !== undefined) env.LOOP_KNOWN_LABELS_OUT = out
  return spawnSync(process.execPath, [script, ...(check ? ['--check'] : [])], { cwd: root, encoding: 'utf8', env })
}
/** regenerate into a fresh scratch file and return the run and what it wrote */
function regenerate(registry) {
  const out = join(scratchDir(), 'known.generated.ts')
  const r = run({ registry, out })
  return { r, written: existsSync(out) ? readFileSync(out, 'utf8') : null }
}

/** `text` with `from` replaced exactly once (fails the test if it is not there once) */
function once(text, from, to) {
  const n = text.split(from).length - 1
  expect(n, `fixture: ${JSON.stringify(from)} occurs once`).toBe(1)
  return text.replace(from, to)
}

// the closing `]` of SHIPPED_LOCALES: the first `\n  },\n]\n` after its declaration
const shippedStart = REGISTRY.indexOf('const SHIPPED_LOCALES')
const shippedEnd = REGISTRY.indexOf('\n  },\n]\n', shippedStart)

describe('gen-known-labels: the normal registry', () => {
  it('regenerates the committed file byte for byte', () => {
    const { r, written } = regenerate(undefined)
    expect(r.status, r.stderr).toBe(0)
    expect(written).toBe(COMMITTED)
  })
  it('`--check` passes on the committed file', () => {
    const r = run({ check: true })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('is up to date')
  })
  it('`--check` fails on a file that lost one label (control)', () => {
    const out = join(scratchDir(), 'known.generated.ts')
    writeFileSync(out, once(COMMITTED, '"Active character", ', ''))
    const r = run({ out, check: true })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('is STALE')
  })
})

describe('gen-known-labels: the registry read does not depend on quoting or indentation', () => {
  it('a locale code in double quotes keeps that locale (`ko`)', () => {
    const { r, written } = regenerate(once(REGISTRY, "code: 'ko',", 'code: "ko",'))
    expect(r.status, r.stderr).toBe(0)
    expect(written).toBe(COMMITTED)
  })
  it("an indented closing `]` keeps every locale", () => {
    expect(shippedStart).toBeGreaterThan(0)
    expect(shippedEnd).toBeGreaterThan(shippedStart)
    const fixture = REGISTRY.slice(0, shippedEnd) + '\n  },\n  ]\n' + REGISTRY.slice(shippedEnd + '\n  },\n]\n'.length)
    const { r, written } = regenerate(fixture)
    expect(r.status, r.stderr).toBe(0)
    expect(written).toBe(COMMITTED)
  })
})

describe('gen-known-labels: no non-base locale is a failure, never a smaller file', () => {
  it('a registry that ships only the base locale stops the generator and writes nothing', () => {
    // keep SHIPPED_LOCALES' first entry (`en`) and drop the rest
    const enEnd = REGISTRY.indexOf('\n  },\n', shippedStart) + '\n  },'.length
    expect(REGISTRY.slice(shippedStart, enEnd)).toContain("code: 'en'")
    expect(REGISTRY.slice(shippedStart, enEnd)).not.toContain("code: 'ko'")
    const fixture = REGISTRY.slice(0, enEnd) + '\n]\n' + REGISTRY.slice(shippedEnd + '\n  },\n]\n'.length)
    const { r, written } = regenerate(fixture)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no non-base locales')
    expect(written).toBeNull()
  })
})
