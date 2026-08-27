// Keyed RNG — spec "loop-rng/1" (SEMANTICS-B1.md §B1.2), frozen.
//
// There is no PRNG object threaded through a run. Every random value is a pure
// total function of a key (seed, step, elementId, purpose, drawIndex):
//
//   canonical key string  →  UTF-8 bytes  →  FNV-1a 32-bit  →  one mulberry32
//   output  →  out / 2^32 ∈ [0, 1)
//
// All integer arithmetic is 32-bit (Math.imul / | 0 / >>> 0). A change to any
// step here is a NEW spec id ("loop-rng/2"), never an in-place edit.

export const RNG_SPEC = 'loop-rng/1'

/** Draw purposes that appear in a key. Extensible; strings, not ints, so test
 *  vectors and diagnostics stay readable. */
export type DrawPurpose = 'flow-range' | 'flow-die' | 'gate-route'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * Proper UTF-8 encoding of a JS string (handles surrogate pairs → 4-byte
 * sequences). Hand-rolled rather than `TextEncoder` to drop the global
 * dependency entirely; byte-identical to `TextEncoder().encode` (asserted in
 * rng.test.ts). All current keys are ASCII, so this is one byte per char.
 */
export function utf8Bytes(str: string): number[] {
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) {
      out.push(c)
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const lo = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        i++
        c = 0x10000 + ((c & 0x3ff) << 10) + (lo & 0x3ff)
        out.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f),
        )
      } else {
        out.push(0xef, 0xbf, 0xbd) // lone high surrogate → U+FFFD (matches TextEncoder)
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd) // lone low surrogate → U+FFFD
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return out
}

/** FNV-1a, 32-bit, over the UTF-8 bytes of `str`. Every intermediate is a uint32. */
export function fnv1a32(str: string): number {
  let h = FNV_OFFSET
  for (const b of utf8Bytes(str)) {
    h ^= b
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h >>> 0
}

export type Sample = {
  /** the canonical key string that was hashed */
  key: string
  /** FNV-1a 32-bit hash of the key (uint32) */
  hash: number
  /** the single mulberry32 output (uint32) */
  out: number
  /** out / 2^32 ∈ [0, 1) */
  u: number
}

/**
 * One draw. Pure: same key ⇒ same result, always. `seed`, `step`, `drawIndex`
 * are non-negative integers; `elementId` must not contain `|` (the id generator
 * guarantees this).
 */
export function sample(
  seed: number,
  step: number,
  elementId: string,
  purpose: DrawPurpose,
  drawIndex: number,
): Sample {
  const key = `${seed}|${step}|${elementId}|${purpose}|${drawIndex}`
  const hash = fnv1a32(key)
  let a = hash | 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const out = (t ^ (t >>> 14)) >>> 0
  return { key, hash, out, u: out / 4294967296 }
}

/** Inclusive uniform integer in [lo, hi] from `u ∈ [0, 1)`. */
export const rangeInt = (lo: number, hi: number, u: number): number =>
  lo + Math.floor(u * (hi - lo + 1))

/** One d-sided die (integer in [1, d]) from `u ∈ [0, 1)`. */
export const die = (d: number, u: number): number => 1 + Math.floor(u * d)

/**
 * Categorical inverse-CDF selection. `weights` are already in the canonical
 * order (SEMANTICS-B1.md §B4.2: outgoing edges by `edge.id` ascending). Returns
 * the selected index, or `-1` if the weights are invalid (any weight `< 0`,
 * `NaN`, `±∞`) or sum to `≤ 0`.
 */
export function categorical(weights: number[], u: number): number {
  let sum = 0
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) return -1
    sum += w
  }
  if (sum <= 0) return -1
  let acc = 0
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / sum
    if (u < acc) return i
  }
  return weights.length - 1 // float-guard: fall through ⇒ last
}
