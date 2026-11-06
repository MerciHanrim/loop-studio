import { describe, expect, it } from 'vitest'
import type { RunGroupReport } from '../engine/types'
import type { MessageKey } from '../i18n'
import { unwrapIsolates } from '../i18n/bidiIsolate'
import en from '../i18n/locales/en'
import { apart, FOLDED, percentText, stageTagText } from './stageTag'

// SEMANTICS-M6.md §M6-8 — the tag's words. On the screen: e2e/stage-tag.spec.ts.

const words = (key: MessageKey, params: Record<string, string | number> = {}): string =>
  Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(unwrapIsolates(String(v))), (en as Record<string, string>)[key]!)

const report = (state: RunGroupReport['state'], moved: number, target: number): RunGroupReport => ({ members: ['ro'], rules: [{ stage: 'ro', wanted: target, target }], target, decidedBy: 'ro', capped: false, moved, basis: null, state, why: null, cause: null, pool: null, needed: null, had: null })
const tag = (r: RunGroupReport | null, over: Partial<{ tank: string | null; table: string | null; noLine: boolean }> = {}) => stageTagText(words, { report: r, tank: 'Product', table: 'Demand', noLine: false, ...over })

const catalogs = import.meta.glob<{ default: Record<string, string> }>('../i18n/locales/*/index.ts', { eager: true })

describe('the stage tag', () => {
  it('says each state in its own words', () => {
    expect(tag(null).full).toBe('Run rule · reads Product and Demand')
    expect(tag(report('met', 0.5, 0.5)).full).toBe('Run 50 % · reads Product and Demand')
    expect(tag(report('short', 0.3, 0.5)).full).toBe('Run 30 %, target 50 % · reads Product and Demand')
    expect(tag(report('stopped', 0, 0.5)).full).toBe('Stopped, target 50 % · reads Product and Demand')
    expect(tag(report('off', 0, 0)).full).toBe('Off · reads Product and Demand')
  })

  it('folds in order, and last to `…` alone', () => {
    const t = tag(report('short', 0.3, 0.5))
    expect(t.forms).toEqual([
      { state: 'Run 30 %, target 50 %', rest: 'reads Product and Demand' },
      { state: 'Run 30 %, target 50 %', rest: 'reads Demand' },
      { state: 'Run 30/50 %', rest: FOLDED },
      { state: '', rest: FOLDED },
    ])
    expect(t.widest[0]).toContain('Run <99.99 %, target 99.99 % · reads Product and Demand')
    expect(t.widest[0]).toContain('Run <0.01 %, target <0.01 % · reads Product and Demand')
    expect(t.widest[0]).toContain('Stopped, target 99.99 % · reads Product and Demand')
    expect(t.widest[2]).toContain('Run <99.99/99.99 % …')
    expect(t.widest[3]).toEqual(['…'])
  })

  it('measures the same forms in every state, so a step moves nothing', () => {
    const states = [null, report('met', 0.5, 0.5), report('short', 0.3, 0.5), report('stopped', 0, 0.5), report('off', 0, 0), report('short', 0.2496, 0.2504), report('met', 5e-10, 5e-10)]
    expect(new Set(states.map((r) => JSON.stringify(tag(r).widest))).size).toBe(1)
  })

  it('keeps the tank in every form when no line shows it', () => {
    const t = tag(null, { noLine: true })
    expect(t.noLine).toBe(true)
    expect(t.forms.map((f) => f.rest)).toEqual(['reads Demand · no line to Product: no free port', 'no line to Product: no free port'])
    expect(tag(null, { noLine: true, table: null }).forms.map((f) => f.rest)).toEqual(['no line to Product: no free port'])
  })

  it('says `met` as how far the stage ran, within the ratio too', () => {
    const near = report('met', 0.4999999998, 0.5)
    expect(tag(near).forms[0]!.state).toBe('Run 50 %')
    expect(tag(near).full).not.toMatch(/target|exact|filled|reached|met\b|hit/i)
  })

  it('keeps every language’s `met` words to the run clause alone', () => {
    const langs = Object.entries(catalogs)
    expect(langs).toHaveLength(18)
    for (const [path, { default: c }] of langs) {
      // the held state's words start with the same clause, and only they go on to the target
      expect(c['run.tag.short']!.startsWith(c['run.tag.run']!), path).toBe(true)
      expect(c['run.tag.short']!.length, path).toBeGreaterThan(c['run.tag.run']!.length)
      expect(c['run.tag.run'], path).not.toContain('{target}')
    }
  })

  it('never shows a held stage as if it ran at its target', () => {
    expect(tag(report('short', 0.4996, 0.5)).forms[0]!.state).toBe('Run 49.96 %, target 50 %')
    expect(tag(report('short', 0.4996, 0.5)).forms[2]!.state).toBe('Run 49.96/50 %')
    expect(tag(report('short', 0.4999999, 0.5)).forms[0]!.state).toBe('Run <50 %, target 50 %')
  })

  it('prints a share to two decimals at most, and `<0.01` under that', () => {
    expect(percentText(1)).toBe('100')
    expect(percentText(0.64)).toBe('64')
    expect(percentText(0.004)).toBe('0.4')
    expect(percentText(5e-10)).toBe('<0.01')
    expect(percentText(0)).toBe('0')
  })

  it('says `<` its target when two decimals cannot part the numbers', () => {
    expect(apart(0.4999999, 0.5)).toEqual(['<50', '50'])
    expect(apart(0.9999999, 1)).toEqual(['<100', '100'])
    expect(apart(4e-10, 5e-10)).toEqual(['<0.01', '<0.01'])
  })

  it('never prints a number wider than the one the block is sized by', () => {
    // the shapes the block is sized by: four digits and a point, `<0.01`, and `<` before a
    // run's number only, whose target is then a plain one or `<0.01` too
    const plain = (s: string) => {
      const digits = [...s].filter((c) => c >= '0' && c <= '9').length
      const others = [...s].filter((c) => c < '0' || c > '9')
      return digits <= 4 && others.length <= 1 && others.every((c) => c === '.')
    }
    const alone = (s: string) => plain(s) || s === '<0.01'
    const pair = ([a, b]: [string, string]) => (a === '<0.01' && b === '<0.01') || ((plain(a) || (a.startsWith('<') && plain(a.slice(1))) || a === '<0.01') && plain(b))
    const shares = [0, 1, 1e-12, 5e-10, 9.9e-5, 1e-4, 0.0123, 0.1249999, 0.2496, 0.2504, 0.4996, 0.5, 0.999, 0.9999, 0.99999, 0.9999999]
    for (let i = 1; i < 2000; i++) shares.push(((i * 7919) % 2000) / 2000, 10 ** -((i % 13) + 1) * (i % 9 || 1))
    for (const a of shares) {
      expect(alone(percentText(a)), String(a)).toBe(true)
      // a held stage moved something: with nothing moved the state is `stopped`
      for (const b of [a * 1.0000001, a * 1.0001, a * 1.3, Math.min(1, a + 1e-9)]) if (a > 0 && b > a) expect(pair(apart(a, Math.min(1, b))), `${a} ${b}`).toBe(true)
    }
  })
})
