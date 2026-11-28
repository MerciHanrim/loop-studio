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
  return { code, warnings: count('warning'), errors: count('error'), out: out.slice(0, 2000), raw: out }
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
    // 88 on 2026-11-27; 82 once no-unused-vars (1) and no-unsafe-optional-chaining (5) were fixed;
    // 79 once use-memo (1) and immutability (2) were; 75 once four exhaustive-deps warnings were;
    // 69 once Canvas's six were; 68 once TimelineChart's floor was; 66 once Canvas's two refs were;
    // 61 once RouteBends' and FrameLayer's five were; 59 once two set-state resets were;
    // 58 once View's row reset was; 56 once TimelineChart's two refs were
    expect(CAP).toBe(56)
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

  it('the rules moved up are errors: an unused variable, an unsafe optional chain', { timeout: 60_000 }, () => {
    const unused = lint([probe('unused.ts', 'export function g(): number {\n  const unused = 1\n  return 2\n}\n')])
    expect(unused.errors, unused.out).toBe(1)
    expect(unused.out).toMatch(/no-unused-vars/)
    expect(unused.code).not.toBe(0)
    const chain = lint([probe('chain.ts', 'export function h(o?: { a: { b: number } }): number {\n  return (o?.a).b\n}\n')])
    expect(chain.errors, chain.out).toBeGreaterThanOrEqual(1)
    expect(chain.out).toMatch(/no-unsafe-optional-chaining/)
    expect(chain.code).not.toBe(0)
  })

  it('the rules moved up next are errors: a memo keyed on an expression, a prop written to', { timeout: 60_000 }, () => {
    const errorsOf = (r, rule) => JSON.parse(r.raw).diagnostics.filter((d) => d.severity === 'error' && d.code.includes(rule)).length
    const memo = lint([probe('memo.tsx', "import { useMemo } from 'react'\nexport function Tag({ a }: { a: string | null }) {\n  const v = useMemo(() => (a ? a.length : 0), [a !== null])\n  return <div>{v}</div>\n}\n")])
    expect(errorsOf(memo, 'use-memo'), memo.out).toBe(1)
    expect(memo.code).not.toBe(0)
    const prop = lint([probe('prop.tsx', 'export function Box({ o }: { o: { v: number } }) {\n  o.v = 1\n  return <div>{o.v}</div>\n}\n')])
    expect(errorsOf(prop, 'immutability'), prop.out).toBeGreaterThanOrEqual(1)
    expect(prop.code).not.toBe(0)
  })

  it('one more warning than the cap fails: the code as it is and one new warning', { timeout: 60_000 }, () => {
    // a rule kept as a warning (react/only-export-components), in a file of its own
    const p = probe('warning.tsx', 'export function helper(): number {\n  return 1\n}\nexport function Card() {\n  return <div>{helper()}</div>\n}\n')
    const alone = lint([p])
    expect(alone.errors, alone.out).toBe(0)
    expect(alone.warnings).toBe(1)
    const r = lint(['.', p])
    expect(r.warnings).toBe(CAP + 1)
    expect(r.errors).toBe(0)
    expect(r.code).not.toBe(0)
  })
})
