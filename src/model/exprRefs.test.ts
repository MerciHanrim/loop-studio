import { describe, expect, it } from 'vitest'
import type { RegisterOutcome } from './model'
import {
  buildRefNames,
  readBackExpr,
  referenceCandidates,
  scoreCandidate,
} from './exprRefs'
import type { LoopNode } from './types'

const KL = (k: string) => ({ pool: 'Pool', parameter: 'Parameter', register: 'Register' })[k]!

const N = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}): LoopNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label, ...extra } }) as unknown as LoopNode

const GRAPH: LoopNode[] = [
  N('wallet', 'pool', 'Wallet'),
  N('savings', 'pool', 'Savings'),
  N('src', 'source', 'Activity'),
  N('target', 'parameter', 'Savings target', { value: 100 }),
  N('negp', 'parameter', 'Negative', { value: -5 }),
  N('net', 'register', 'Net worth', { expr: '@wallet + @savings', format: 'integer' }),
  N('prog', 'register', 'Progress', { expr: '@net / @target', format: 'percent' }),
  N('dupe', 'register', 'Savings', { expr: '1', format: 'integer' }), // shares "Savings" with the pool
]
const poolValue = (id: string) => ({ wallet: 3, savings: 34 })[id] ?? 0
const OUTCOMES = new Map<string, RegisterOutcome>([
  ['net', { invalid: false, value: 37 }],
  ['prog', { invalid: false, value: 0.37 }],
  ['dupe', { invalid: false, value: 1 }],
])

describe('buildRefNames — disambiguation', () => {
  it('a unique label is used bare; a shared label gets · Kind', () => {
    const m = buildRefNames(GRAPH, KL)
    expect(m.get('wallet')).toBe('Wallet')
    expect(m.get('target')).toBe('Savings target')
    // "Savings" is on both a Pool and a Register
    expect(m.get('savings')).toBe('Savings · Pool')
    expect(m.get('dupe')).toBe('Savings · Register')
  })

  it('id tail is appended when the kind also collides', () => {
    const g = [N('p_aaaa', 'pool', 'X'), N('p_bbbb', 'pool', 'X')]
    const m = buildRefNames(g, KL)
    expect(m.get('p_aaaa')).toBe('X · Pool …aaaa')
    expect(m.get('p_bbbb')).toBe('X · Pool …bbbb')
  })
})

describe('referenceCandidates', () => {
  it('lists only Pool / Parameter / Register, sorted by (kind, then name)', () => {
    const c = referenceCandidates(GRAPH, poolValue, OUTCOMES, null, KL)
    expect(c.find((x) => x.id === 'src')).toBeUndefined() // a Source is never listed
    // kind groups in order, each sorted by display name
    expect(c.map((x) => x.kind)).toEqual(['pool', 'pool', 'parameter', 'parameter', 'register', 'register', 'register'])
    expect(c.filter((x) => x.kind === 'pool').map((x) => x.name)).toEqual(['Savings · Pool', 'Wallet'])
    expect(c.filter((x) => x.kind === 'register').map((x) => x.name)).toEqual(
      ['Net worth', 'Progress', 'Savings · Register'],
    )
  })

  it('current values: pool count, param value, register outcome; non-finite ⇒ null', () => {
    const c = referenceCandidates(GRAPH, poolValue, OUTCOMES, null, KL)
    expect(c.find((x) => x.id === 'wallet')!.value).toBe(3)
    expect(c.find((x) => x.id === 'target')!.value).toBe(100)
    expect(c.find((x) => x.id === 'net')!.value).toBe(37)
    expect(c.find((x) => x.id === 'negp')!.value).toBe(-5) // negative is still a finite value
  })

  it('the edited Register is blocked "self"; a Register that depends on it is blocked "cycle"', () => {
    // editing `net` — `prog` references `net`, so choosing `prog` from net's
    // list would create a cycle
    const c = referenceCandidates(GRAPH, poolValue, OUTCOMES, 'net', KL)
    expect(c.find((x) => x.id === 'net')!.block).toEqual({ reason: 'self' })
    expect(c.find((x) => x.id === 'prog')!.block).toEqual({ reason: 'cycle', withName: 'Net worth' })
    // `dupe` does NOT depend on `net` ⇒ not blocked
    expect(c.find((x) => x.id === 'dupe')!.block).toBeNull()
    // a Pool is never blocked
    expect(c.find((x) => x.id === 'wallet')!.block).toBeNull()
  })

  it('insert spelling is canonical (@id for a SAFE_ID)', () => {
    const c = referenceCandidates(GRAPH, poolValue, OUTCOMES, null, KL)
    expect(c.find((x) => x.id === 'wallet')!.insert).toBe('@wallet')
    const g = [N('has space', 'pool', 'S')]
    expect(referenceCandidates(g, () => 0, new Map(), null, KL)[0].insert).toBe('@{has space}')
  })
})

describe('scoreCandidate — ranking', () => {
  const c = referenceCandidates(GRAPH, poolValue, OUTCOMES, null, KL)
  const byId = (id: string) => c.find((x) => x.id === id)!
  it('name prefix > name substring > id substring > no match', () => {
    expect(scoreCandidate(byId('wallet'), 'wal')).toBe(3) // "Wallet" prefix
    expect(scoreCandidate(byId('net'), 'worth')).toBe(2) // "Net worth" substring
    expect(scoreCandidate(byId('wallet'), 'wallet')).toBe(3) // name matches before id
    expect(scoreCandidate(byId('target'), 'zzz')).toBe(-1)
  })
})

describe('readBackExpr', () => {
  it('valid: meaning tokens are names, result tokens are values, total from the outcome', () => {
    const rb = readBackExpr('@wallet+@savings', GRAPH, poolValue, OUTCOMES, OUTCOMES.get('net'), 'net', KL)
    expect(rb.ok).toBe(true)
    if (!rb.ok) return
    expect(rb.canonical).toBe('@wallet + @savings')
    expect(rb.meaning.map((t) => (t.t === 'ref' ? t.name : t.s)).join('')).toBe('Wallet + Savings · Pool')
    expect(rb.result.kind).toBe('value')
    if (rb.result.kind === 'value') {
      // §RXA3.3 line 2 — `<name> <value>` per reference
      expect(rb.result.parts.map((t: any) => (t.t === 'val' ? `${t.name} ${t.s}` : t.s)).join('')).toBe(
        'Wallet 3 + Savings · Pool 34',
      )
      expect(rb.result.parts.map((t: any) => (t.t === 'val' ? t.s : t.s)).join('')).toBe('3 + 34')
      expect(rb.result.total).toBe('= 37')
    }
  })

  it('the draft not parsing ⇒ ok:false with the parse code + column', () => {
    const rb = readBackExpr('@wallet *', GRAPH, poolValue, OUTCOMES, undefined, 'net', KL)
    expect(rb.ok).toBe(false)
    if (!rb.ok) expect(rb.parse.code).toMatch(/EXPR_/)
  })

  it('empty expression ⇒ result.kind = empty', () => {
    const rb = readBackExpr('', GRAPH, poolValue, OUTCOMES, undefined, 'net', KL)
    expect(rb.ok).toBe(true)
    if (rb.ok) expect(rb.result.kind).toBe('empty')
  })

  it('div-by-zero: keeps the value line, total is the → verdict (no re-eval)', () => {
    const rb = readBackExpr('@wallet / 0', GRAPH, poolValue, OUTCOMES, { invalid: true, code: 'M_REG_EVAL', detail: 'EVAL_DIV_ZERO' }, 'net', KL)
    expect(rb.ok).toBe(true)
    if (rb.ok && rb.result.kind === 'value') {
      expect(rb.result.parts.map((t: any) => t.s).join('')).toBe('3 / 0')
      expect(rb.result.total).toBe('→ EVAL_DIV_ZERO')
    } else {
      throw new Error('expected a value line with a → verdict')
    }
  })

  it('a wrong-kind / missing reference ⇒ result.kind = error, with the code + bad-ref name', () => {
    const rb = readBackExpr('@src + 1', GRAPH, poolValue, OUTCOMES, { invalid: true, code: 'M_REG_WRONG_KIND', detail: 'src' }, 'net', KL)
    expect(rb.ok).toBe(true)
    if (rb.ok && rb.result.kind === 'error') {
      expect(rb.result.code).toBe('M_REG_WRONG_KIND')
      expect(rb.result.badRefId).toBe('src')
      expect(rb.result.badRefName).toBe('Activity')
    } else {
      throw new Error('expected an error result')
    }
  })

  it('the verdict mirrors the outcome exactly — never a second evaluation (RXA-INV-8)', () => {
    // hand the helper an outcome that DISAGREES with a naive re-eval: it must
    // report the OUTCOME's verdict, not recompute
    const rb = readBackExpr('@wallet + @savings', GRAPH, poolValue, OUTCOMES, { invalid: false, value: 999 }, 'net', KL)
    expect(rb.ok && rb.result.kind === 'value' && rb.result.total).toBe('= 999')
  })
})
