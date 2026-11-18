// loop-model/4 (SEMANTICS-M4.md) — exact rational arithmetic over decimal
// strings, for the unit contract (#471, `units-display-design.md` rev 6):
// an authored decimal × a unit factor × a step ratio is a rational number;
// the engine reads its nearest double, the balance test compares the
// rationals themselves, and what a surface prints follows R≈ (§M4-5): the
// exact decimal when the rational terminates, otherwise `≈` and 15
// significant digits. Nothing here touches a double except at the two
// boundaries (`toDouble`, `fromDouble`).

/** a rational as a reduced fraction with a positive denominator */
export type Rational = { readonly num: bigint; readonly den: bigint }

const abs = (a: bigint) => (a < 0n ? -a : a)

export function gcd(a: bigint, b: bigint): bigint {
  a = abs(a)
  b = abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

export function rational(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new Error('rational: zero denominator')
  if (den < 0n) {
    num = -num
    den = -den
  }
  const g = gcd(num, den)
  return g > 1n ? { num: num / g, den: den / g } : { num, den }
}

/** the largest exponent `parseDecimal` reads: past every finite double
 *  (±308, plus the 17 digits a shortest form may carry), so no number a
 *  field can hold is refused, while `1e999999999` in a file cannot make
 *  `10n ** 999999999n` hang the page */
export const MAX_DECIMAL_EXPONENT = 400

/** `"12.345"`, `"-0.5"`, `"7"`, `"1e-7"`, `"2.5E3"` → the exact rational; `null`
 *  when the text is not a plain decimal (a sign, digits, one optional point,
 *  one optional exponent of at most `MAX_DECIMAL_EXPONENT` — no spaces, no
 *  `+` prefix, no `Infinity`). */
export function parseDecimal(text: string): Rational | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!m) return null
  if (m[4] && Math.abs(Number(m[4])) > MAX_DECIMAL_EXPONENT) return null
  if ((m[3]?.length ?? 0) > MAX_DECIMAL_EXPONENT) return null
  const sign = m[1] === '-' ? -1n : 1n
  const frac = m[3] ?? ''
  let digits = BigInt(m[2] + frac) * sign
  let scale = frac.length - (m[4] ? Number(m[4]) : 0)
  let den = 1n
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale)
    scale = 0
  } else den = 10n ** BigInt(scale)
  return rational(digits, den)
}

/** the number of significant digits of a plain decimal text (`"0.0450"` → 2;
 *  `"1e-15"` → 1); `null` when the text is not a plain decimal */
export function significantDigits(text: string): number | null {
  const m = /^-?(\d+)(?:\.(\d+))?(?:[eE][+-]?\d+)?$/.exec(text)
  if (!m) return null
  const all = (m[1] + (m[2] ?? '')).replace(/^0+/, '').replace(/0+$/, '')
  return all.length
}

export const MAX_SIGNIFICANT_DIGITS = 15

export function add(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den)
}
export function sub(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den - b.num * a.den, a.den * b.den)
}
export function mul(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den)
}
export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new Error('rational: division by zero')
  return rational(a.num * b.den, a.den * b.num)
}
export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const d = a.num * b.den - b.num * a.den
  return d < 0n ? -1 : d > 0n ? 1 : 0
}
export const equals = (a: Rational, b: Rational) => cmp(a, b) === 0
export const fromInt = (n: number | bigint): Rational => ({ num: BigInt(n), den: 1n })

/** the exact decimal text of a rational whose reduced denominator has no
 *  prime factor but 2 and 5 (`-0.000000000000001`, `7000`, `0.045`), or `null`
 *  when its decimal expansion does not terminate (1/3, 7/24) */
export function terminatingDecimal(r: Rational): string | null {
  if (r.num === 0n) return '0'
  let d = r.den
  let twos = 0
  let fives = 0
  while (d % 2n === 0n) {
    d /= 2n
    twos++
  }
  while (d % 5n === 0n) {
    d /= 5n
    fives++
  }
  if (d !== 1n) return null
  const k = Math.max(twos, fives)
  const digits = r.num * 2n ** BigInt(k - twos) * 5n ** BigInt(k - fives) // r = digits / 10^k
  const neg = digits < 0n
  let s = abs(digits).toString().padStart(k + 1, '0')
  if (k > 0) s = `${s.slice(0, s.length - k)}.${s.slice(s.length - k)}`.replace(/\.?0+$/, '')
  return (neg ? '-' : '') + s
}

/** the nearest double to the rational: the rational written to 25 significant
 *  decimal digits and read by `Number`, which rounds a decimal correctly, so
 *  the result is the double nearest the rational for every value a document
 *  can hold (a 15-digit decimal times a factor and a step ratio) */
export function toDouble(r: Rational): number {
  // The quotient is wanted to at least 26 digits, cut there, with the exponent
  // that puts the point back: the least `e ≥ 0` with `num · 10^e ≥ 10^25 · den`,
  // and `floor(num · 10^e / den)`. That `e` used to be found by multiplying by
  // 10 and dividing again, about 26 divisions of long integers. It follows
  // from the two digit counts: with `a` digits in `num` and `b` in `den`,
  // `10^(a-1) ≤ num < 10^a` and `10^(b-1) ≤ den < 10^b`, so the condition
  // fails at `24 + b - a` and holds at `26 + b - a`; the least `e` is
  // `25 + b - a` or the one after (0 where that is below 0: it holds at 0
  // already). One comparison decides, and one division gives the quotient.
  // The text handed to `Number` is the same, character for character
  // (`rationalConversions.test.ts` holds the earlier form and compares).
  if (r.num === 0n) return 0
  const neg = r.num < 0n
  const num = abs(r.num)
  const den = r.den
  let e = 25 + den.toString().length - num.toString().length
  if (e < 0) e = 0
  let scaled = e === 0 ? num : num * 10n ** BigInt(e)
  if (scaled < TEN25 * den) {
    scaled *= 10n
    e++
  }
  const v = Number(`${scaled / den}e-${e}`)
  return neg ? -v : v
}
const TEN25 = 10n ** 25n

const F64 = new Float64Array(1)
const U32 = new Uint32Array(F64.buffer)
F64[0] = 1
const HI = U32[1] === 0x3ff00000 ? 1 : 0 // the word that holds the sign and the exponent
const LO = 1 - HI

/** a double as the exact rational of its BINARY value (`0.1` →
 *  3602879701896397 / 2⁵⁵), not of its shortest decimal — what the engine
 *  actually holds, so a display can say whether it shows that value exactly */
export function exactDouble(x: number): Rational {
  // A double is `mantissa · 2^e`. Over a power of two the reduced fraction is
  // the mantissa less its trailing zero bits, over the power of two that is
  // left: Euclid's algorithm, which `rational` would run, has nothing else to
  // find. An integer is itself over 1. The fraction is the same one as before
  // (`rationalConversions.test.ts` holds the earlier form and compares).
  if (!Number.isFinite(x)) throw new Error(`rational: not finite: ${x}`)
  if (Number.isInteger(x)) return { num: BigInt(x), den: 1n }
  F64[0] = x
  const hi = U32[HI]
  const lo = U32[LO]
  const biased = (hi >>> 20) & 0x7ff
  let mantHi = hi & 0xfffff
  let e = -1074
  if (biased !== 0) {
    mantHi |= 0x100000
    e = biased - 1075
  }
  // not an integer: `e < 0`, and the mantissa has fewer than `-e` trailing zero bits
  const tz = lo !== 0 ? 31 - Math.clz32(lo & -lo) : 32 + (31 - Math.clz32(mantHi & -mantHi))
  const num = BigInt((mantHi * 4294967296 + lo) / 2 ** tz)
  return { num: hi >>> 31 ? -num : num, den: 1n << BigInt(-e - tz) }
}

/** a double as the exact rational of its SHORTEST decimal form (the text
 *  `String(x)` prints, which is the number a user sees and reads back) */
export function fromDouble(x: number): Rational {
  if (!Number.isFinite(x)) throw new Error(`rational: not finite: ${x}`)
  const r = parseDecimal(String(x))
  if (r === null) throw new Error(`rational: cannot read ${x}`)
  return r
}

/** `x` rounded to 15 significant digits, as `Number` prints it */
export function toSignificant15(x: number): number {
  return x === 0 ? 0 : Number(x.toPrecision(MAX_SIGNIFICANT_DIGITS))
}

/** R≈ (SEMANTICS-M4.md §M4-5): what a surface prints for a rational — the
 *  exact decimal when it terminates, otherwise an approximation to 15
 *  significant digits prefixed `≈ `. `approx` says which. A verdict is never
 *  taken from this text. */
export function displayRational(r: Rational): { text: string; approx: boolean } {
  const exact = terminatingDecimal(r)
  if (exact !== null) return { text: exact, approx: false }
  return { text: `≈ ${plainDecimal(toSignificant15(toDouble(r)))}`, approx: true }
}

/** a double's shortest decimal written out in plain digits — never the
 *  exponent form `String` uses below 1e-6 and from 1e21 (`3.3e-19` →
 *  `0.00000000000000000033`), so a person reads every printed value the same way */
export function plainDecimal(x: number): string {
  return terminatingDecimal(fromDouble(x)) ?? String(x)
}

/** the rational re-expressed as a decimal of at most 15 significant digits
 *  when that is exact, else `null` — the test a unit change applies before it
 *  is written (§M4-4) */
export function exactWithin15Digits(r: Rational): string | null {
  const t = terminatingDecimal(r)
  if (t === null) return null
  const n = significantDigits(t)
  return n !== null && n <= MAX_SIGNIFICANT_DIGITS ? t : null
}

/** the rational rounded to 15 significant digits, as a decimal text (through
 *  the nearest double, which is exact at 15 digits for every value here) */
export function roundTo15Digits(r: Rational): string {
  return plainDecimal(toSignificant15(toDouble(r)))
}
