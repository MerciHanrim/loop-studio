import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// issue #625 item 5 (Lumi, 2026-11-27) — `npm run lint` fails on a planted
// correctness error and on one more warning than the cap, and passes on the code
// as it is. The cap is read from the `lint` script, the one place it is set.

const ROOT = resolve(import.meta.dirname, '..')
const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.lint
const CAP = Number(/--max-warnings[ =](\d+)/.exec(script)?.[1])
const OXLINT = join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint')

/** oxlint with the repository's config and the script's cap, on `paths`: its exit code and the counts it
 *  reports. The JSON format is asked for: oxlint picks its default format by environment (on GitHub
 *  Actions it prints `::error …` annotations), and the counts must not depend on that. */
function lint(paths) {
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, [OXLINT, '-c', join(ROOT, '.oxlintrc.json'), '--format', 'json', '--max-warnings', String(CAP), ...paths], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    code = e.status ?? 1
    out = `${e.stdout ?? ''}`
  }
  const diagnostics = JSON.parse(out).diagnostics
  const count = (severity) => diagnostics.filter((d) => d.severity === severity).length
  return { code, warnings: count('warning'), errors: count('error'), out: out.slice(0, 2000) }
}

const dir = mkdtempSync(join(tmpdir(), 'lint-policy-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const probe = (name, text) => {
  const p = join(dir, name)
  writeFileSync(p, text)
  return p
}

describe('the lint policy (#625 item 5)', () => {
  it('the lint script caps the warnings', () => {
    expect(script).toMatch(/^oxlint --max-warnings \d+$/)
    expect(CAP).toBe(88)
  })

  it('the code as it is passes, at the cap', { timeout: 60_000 }, () => {
    const r = lint(['.'])
    expect(r.errors, r.out.slice(-400)).toBe(0)
    expect(r.warnings).toBe(CAP)
    expect(r.code).toBe(0)
  })

  it('a planted correctness error fails: a comparison with NaN, a const reassigned', { timeout: 60_000 }, () => {
    const p = probe('correctness.ts', 'export function f(x: number): boolean {\n  const y = x\n  if (x === NaN) return true\n  // @ts-expect-error a planted reassignment\n  y = 2\n  return y > 0\n}\n')
    const r = lint([p])
    expect(r.errors, r.out).toBeGreaterThanOrEqual(2)
    expect(r.code).not.toBe(0)
  })

  it('one more warning than the cap fails: the code as it is and one new warning', { timeout: 60_000 }, () => {
    // a rule kept as a warning (eslint/no-unused-vars), in a file of its own
    const p = probe('warning.ts', 'export function g(): number {\n  const unused = 1\n  return 2\n}\n')
    const alone = lint([p])
    expect(alone.errors, alone.out).toBe(0)
    expect(alone.warnings).toBe(1)
    const r = lint(['.', p])
    expect(r.warnings).toBe(CAP + 1)
    expect(r.errors).toBe(0)
    expect(r.code).not.toBe(0)
  })
})
