import { describe, expect, it } from 'vitest'
import { add, div, exactDouble, fromInt, mul, parseDecimal, type Rational, rational, sub, toDouble } from './rational'

// `toDouble` and `exactDouble` were rewritten to do less work for the same result (the engine's
// exact tests call them at every step: issue #572's measurements). The forms they had before are
// kept HERE, unchanged, as the reference, and the two are compared over the ends of the range,
// its boundaries, the ties between two doubles and both sides of them, decimals past both ends,
// the values a document holds, and random fractions and doubles. Every comparison gathers what
// differs and says it in the failure; every sweep states its own time limit; and each way through
// the new forms is counted, so that a comparison that never took one of them fails.
const SWEEP_MS = 120_000

/** `toDouble` as it was: multiply by 10 and divide again until the quotient has 26 digits */
function toDoubleReference(r: Rational): number {
  if (r.num === 0n) return 0
  const neg = r.num < 0n
  let num = neg ? -r.num : r.num
  const den = r.den
  let e = 0
  while (num / den < 10n ** 25n) {
    num *= 10n
    e++
  }
  const v = Number(`${num / den}e-${e}`)
  return neg ? -v : v
}
/** `exactDouble` as it was: the mantissa and the exponent as long integers, reduced by `rational` */
function exactDoubleReference(x: number): Rational {
  if (!Number.isFinite(x)) throw new Error(`rational: not finite: ${x}`)
  if (x === 0) return { num: 0n, den: 1n }
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const hi = view.getUint32(0)
  const lo = view.getUint32(4)
  const sign = hi >>> 31 ? -1n : 1n
  const biased = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let e: number
  if (biased === 0) e = -1074
  else {
    mant |= 1n << 52n
    e = biased - 1075
  }
  return e >= 0 ? rational(sign * mant * 2n ** BigInt(e), 1n) : rational(sign * mant, 2n ** BigInt(-e))
}

const F = new Float64Array(1)
const U = new Uint32Array(F.buffer)
F[0] = 1
const HI = U[1] === 0x3ff00000 ? 1 : 0
const LO = 1 - HI
const fromBits = (hi: number, lo: number): number => {
  U[HI] = hi >>> 0
  U[LO] = lo >>> 0
  return F[0]
}
const bits = (x: number): { hi: number; lo: number } => {
  F[0] = x
  return { hi: U[HI], lo: U[LO] }
}
const up = (x: number): number => {
  // the next double above a finite x >= 0
  F[0] = x
  if (U[LO] === 0xffffffff) {
    U[LO] = 0
    U[HI]++
  } else U[LO]++
  return F[0]
}
const isEven = (x: number): boolean => (bits(x).lo & 1) === 0
// (a generator whose LOW bits are random too: the last bit of a double is what a tie turns on,
// and a plain linear congruential generator's last bit only alternates)
const mixer = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}
const sameR = (a: Rational, b: Rational) => a.num === b.num && a.den === b.den
const text = (r: Rational) => `${r.num}/${r.den}`.slice(0, 90)
const TWO = fromInt(2)
const pow10 = (n: number): Rational => (n >= 0 ? fromInt(10n ** BigInt(n)) : rational(1n, 10n ** BigInt(-n)))

/** the doubles every comparison starts from: the ends, the boundaries, and the ordinary */
function namedDoubles(): number[] {
  const xs: number[] = [0, -0, 1, -1, 0.1, 0.2, 0.3, 0.7, 1 / 3, 2 / 3, 1e-9, 1e9, 1e15, 1e16, 1e22, 1e23, 1e100, 1e300, 123456.789, 0.000001, 4.35, 2.675, 1.005, 0.5, 0.75, 1.5, 3.25]
  xs.push(Number.MIN_VALUE, 2 * Number.MIN_VALUE, 3 * Number.MIN_VALUE, fromBits(0x000fffff, 0xffffffff), fromBits(0x00100000, 0), fromBits(0x00100000, 1)) // the least, the subnormals' end, the least normal
  xs.push(Number.MAX_VALUE, fromBits(0x7fefffff, 0xfffffffe), Number.EPSILON, 1 + Number.EPSILON, 1 - Number.EPSILON / 2, 2 ** 53, 2 ** 53 + 2, 2 ** 53 - 1, 2 ** 52 + 0.5)
  for (const far of [1e-280, 1e280, 1e-281, 1e281, 1e-307, 1e307]) xs.push(far, up(far))
  for (let k = -1074; k <= 1023; k += 7) xs.push(2 ** k, 2 ** k * (1 + Number.EPSILON), 2 ** k * (2 - Number.EPSILON), 2 ** k * 1.5, 2 ** k * 1.0000152587890625)
  return [...xs, ...xs.filter((x) => x !== 0).map((x) => -x)]
}
/** doubles of every kind: random bits in both words, the exponent over its whole span */
function randomDoubles(n: number, seed: number): number[] {
  const next = mixer(seed)
  const xs: number[] = []
  while (xs.length < n) {
    const hi = next()
    // every fifth: runs of zero bits at both ends of the low word; every seventh: a low word of 0
    const lo = xs.length % 7 === 0 ? 0 : xs.length % 5 === 0 ? (next() >>> (next() % 32)) << (next() % 32) : next()
    if (((hi >>> 20) & 0x7ff) === 0x7ff) continue // not finite
    xs.push(fromBits(hi, lo))
  }
  return xs
}

describe('exactDouble gives the fraction it gave before', () => {
  it('on the ends of the range, the boundaries and the ordinary doubles', () => {
    const off: string[] = []
    const xs = namedDoubles()
    for (const x of xs) {
      const a = exactDoubleReference(x)
      const b = exactDouble(x)
      if (!sameR(a, b)) off.push(`${x}: ${text(a)} before, ${text(b)} now`)
    }
    expect(xs.length).toBeGreaterThan(2000)
    expect(off).toEqual([])
  })
  it('on 200,000 doubles of random bits, and every way through it is taken: an integer, a low word that is not 0, a low word of 0, a subnormal', { timeout: SWEEP_MS }, () => {
    const off: string[] = []
    const taken = { integer: 0, lowWord: 0, highWordOnly: 0, subnormal: 0 }
    for (const x of [...randomDoubles(200_000, 11), ...namedDoubles()]) {
      const { hi, lo } = bits(x)
      if (Number.isInteger(x)) taken.integer++
      else if (lo !== 0) taken.lowWord++
      else taken.highWordOnly++
      if (((hi >>> 20) & 0x7ff) === 0 && x !== 0) taken.subnormal++
      const a = exactDoubleReference(x)
      const b = exactDouble(x)
      if (!sameR(a, b) && off.length < 20) off.push(`${x}: ${text(a)} before, ${text(b)} now`)
    }
    expect(off).toEqual([])
    expect(taken.integer).toBeGreaterThan(1000)
    expect(taken.lowWord).toBeGreaterThan(50_000)
    expect(taken.highWordOnly).toBeGreaterThan(5000)
    expect(taken.subnormal).toBeGreaterThan(50)
  })
  it('refuses what is not finite, as before', () => {
    for (const x of [NaN, Infinity, -Infinity]) {
      expect(() => exactDoubleReference(x)).toThrow()
      expect(() => exactDouble(x)).toThrow()
    }
  })
  it('reads both zeros as 0 over 1', () => {
    expect(exactDouble(0)).toEqual({ num: 0n, den: 1n })
    expect(exactDouble(-0)).toEqual({ num: 0n, den: 1n })
  })
  it('gives a reduced fraction with a denominator above 0 (the one form `rational` gives)', () => {
    const off: string[] = []
    for (const x of [...namedDoubles(), ...randomDoubles(5000, 5)]) {
      const b = exactDouble(x)
      const again = rational(b.num, b.den)
      if (b.den <= 0n || !sameR(b, again)) off.push(String(x))
    }
    expect(off).toEqual([])
  })
})

/** the rationals `toDouble` is asked: built to sit on and around every edge */
function rationals(): { r: Rational; what: string }[] {
  const out: { r: Rational; what: string }[] = []
  const push = (r: Rational, what: string) => {
    out.push({ r, what })
    if (r.num !== 0n) out.push({ r: rational(-r.num, r.den), what: `-(${what})` })
  }
  push(fromInt(0), '0')
  // every named double as its exact value, and a hair to each side of it
  for (const x of namedDoubles().filter((x) => x > 0)) {
    const e = exactDoubleReference(x)
    push(e, `the double ${x}`)
    for (const n of [20, 26, 27, 40]) {
      push(mul(e, add(fromInt(1), pow10(-n))), `the double ${x} and one part in 10^${n} more`)
      push(mul(e, sub(fromInt(1), pow10(-n))), `the double ${x} and one part in 10^${n} less`)
    }
  }
  // the ties: half-way between a double and the next, where the lower one is even and where it is odd
  const next = mixer(77)
  const lowers: number[] = [1, 1 + Number.EPSILON, 2 ** 52, 2 ** 52 + 1, 2 ** 53, 2 ** 53 + 2, 0.1, 0.30000000000000004, 1e22, 1e-280, 1e280, 4.9e-300, 3e200, Number.MIN_VALUE, 2 * Number.MIN_VALUE, fromBits(0x000fffff, 0xfffffffe), fromBits(0x7fefffff, 0xfffffffe)]
  for (let i = 0; i < 400; i++) {
    const hi = next() & 0x7fffffff
    if (((hi >>> 20) & 0x7ff) >= 0x7fe) continue
    lowers.push(fromBits(hi, next()))
  }
  for (const lo of lowers) {
    const tie = div(add(exactDoubleReference(lo), exactDoubleReference(up(lo))), TWO)
    push(tie, `the tie above ${lo} (${isEven(lo) ? 'even' : 'odd'})`)
    for (const n of [20, 26, 27, 30, 45]) {
      push(mul(tie, add(fromInt(1), pow10(-n))), `one part in 10^${n} above the tie above ${lo}`)
      push(mul(tie, sub(fromInt(1), pow10(-n))), `one part in 10^${n} below the tie above ${lo}`)
    }
  }
  // decimals of 1 to 40 digits, at exponents over the whole range and past both of its ends
  for (let digits = 1; digits <= 40; digits += 3) {
    for (const exp of [-420, -400, -330, -324, -323, -308, -307, -281, -280, -279, -30, -1, 0, 1, 15, 22, 23, 24, 25, 26, 27, 40, 279, 280, 281, 307, 308, 309, 330]) {
      let s = ''
      for (let i = 0; i < digits; i++) s += String((next() % 9) + 1)
      const r = mul(fromInt(BigInt(s)), pow10(exp - digits + 1))
      push(r, `${s[0]}.${s.slice(1)}e${exp}`)
    }
  }
  // exact powers of ten on both sides of the 26-digit cut, over 1 and over a denominator of every length
  for (let k = 20; k <= 32; k++) {
    push(fromInt(10n ** BigInt(k)), `10^${k}`)
    push(fromInt(10n ** BigInt(k) - 1n), `10^${k} - 1`)
    push(rational(10n ** BigInt(k), 3n), `10^${k} / 3`)
    push(rational(10n ** BigInt(k) - 1n, 10n ** 7n), `(10^${k} - 1) / 10^7`)
    push(rational(1n, 10n ** BigInt(k)), `10^-${k}`)
  }
  // what a document holds: a decimal of up to 15 digits, times a factor, times a step ratio
  for (const d of ['0.1', '0.25', '1.005', '123456789.012345', '0.000000123456789', '999999999999999', '0.3', '7.35', '2.675']) {
    for (const f of ['1', '0.001', '3600', '1000000', '0.0000166666666666667']) {
      for (const ratio of [rational(1n, 1n), rational(1n, 60n), rational(1n, 3600n), rational(7n, 24n), rational(86400n, 1n)]) push(mul(mul(parseDecimal(d)!, parseDecimal(f)!), ratio), `${d} x ${f} x ${ratio.num}/${ratio.den}`)
    }
  }
  // fractions of two random integers, short and long
  for (let i = 0; i < 3000; i++) {
    const size = (n: number) => {
      let v = 0n
      for (let j = 0; j < n; j++) v = (v << 32n) | BigInt(next())
      return v + 1n
    }
    push(rational(size(1 + (i % 7)), size(1 + ((i >> 3) % 7))), `random ${i}`)
  }
  return out
}

describe('toDouble gives the double it gave before', () => {
  it('on every rational of the comparison, and every way through it is taken: no digit to add, the count of digits as worked out, and one digit more', { timeout: SWEEP_MS }, () => {
    const all = rationals()
    const off: string[] = []
    // the ways through the new form, worked out here from the same two digit counts
    const taken = { noDigitToAdd: 0, asWorkedOut: 0, oneMore: 0 }
    for (const { r, what } of all) {
      const a = toDoubleReference(r)
      const b = toDouble(r)
      if (!Object.is(a, b) && off.length < 20) off.push(`${what}: ${a} before, ${b} now`)
      if (r.num === 0n) continue
      const num = r.num < 0n ? -r.num : r.num
      const e = 25 + r.den.toString().length - num.toString().length
      if (e <= 0) taken.noDigitToAdd++
      else if (num * 10n ** BigInt(e) < 10n ** 25n * r.den) taken.oneMore++
      else taken.asWorkedOut++
    }
    expect(all.length).toBeGreaterThan(30_000)
    expect(off).toEqual([])
    expect(taken.noDigitToAdd).toBeGreaterThan(1000)
    expect(taken.asWorkedOut).toBeGreaterThan(1000)
    expect(taken.oneMore).toBeGreaterThan(1000)
  })
  it('on the exact value of 100,000 doubles of random bits: it reads each back', { timeout: SWEEP_MS }, () => {
    const off: string[] = []
    for (const x of randomDoubles(100_000, 3)) {
      const r = exactDoubleReference(x)
      const a = toDoubleReference(r)
      const b = toDouble(r)
      if ((!Object.is(a, b) || a !== x) && off.length < 20) off.push(`${x}: ${a} before, ${b} now`)
    }
    expect(off).toEqual([])
  })
  it('past the largest double gives Infinity, and under half the least gives 0, as before', () => {
    const big = mul(exactDoubleReference(Number.MAX_VALUE), fromInt(10))
    expect(toDoubleReference(big)).toBe(Infinity)
    expect(toDouble(big)).toBe(Infinity)
    expect(toDouble(rational(-big.num, big.den))).toBe(-Infinity)
    const small = div(exactDoubleReference(Number.MIN_VALUE), fromInt(1000))
    expect(toDoubleReference(small)).toBe(0)
    expect(toDouble(small)).toBe(0)
  })
  it('keeps what the earlier form did at a tie it cut short: the result is the earlier double, not always the nearest', () => {
    // half-way between 1 + 2^-52 (odd) and the next double: the quotient is cut at 26 digits, so
    // it reads as just under the tie and goes DOWN, to the odd double. Unchanged on purpose: this
    // change is about the work done, not about the result.
    const lower = 1 + Number.EPSILON
    const tie = div(add(exactDoubleReference(lower), exactDoubleReference(up(lower))), TWO)
    expect(toDoubleReference(tie)).toBe(lower)
    expect(toDouble(tie)).toBe(lower)
  })
})
