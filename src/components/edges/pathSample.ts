// docs/simulation-playback.md §PB4.8 — a route's points at equal steps along
// its length, computed in script instead of through a detached SVG path's
// `getPointAtLength` (each call walks the path from its start, and a plan for
// a wide graph made thousands of them inside a render).
//
// The length is the curve's arc length, as the browser measures it: a line's
// is exact; a quadratic or cubic Bézier's is integrated (Gauss–Legendre over
// equal spans of its parameter), and a point at a length is found by Newton
// steps on the parameter. Only the absolute commands the app writes (M, L, H,
// V, Q, C, Z) are read; anything else returns null and the caller samples
// through the DOM as before.

type Pt = { x: number; y: number }
type Piece = { kind: 'line' | 'quad' | 'cubic'; p: Pt[]; len: number; spans: number[] }

/** spans of the parameter a curve's length is integrated over */
const SPANS = 32
/** 5-point Gauss–Legendre nodes and weights on [-1, 1] */
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664]
const GL_W = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function evalAt(pc: Piece, t: number): Pt {
  const p = pc.p
  if (pc.kind === 'line') return { x: lerp(p[0]!.x, p[1]!.x, t), y: lerp(p[0]!.y, p[1]!.y, t) }
  const u = 1 - t
  if (pc.kind === 'quad') {
    return {
      x: u * u * p[0]!.x + 2 * u * t * p[1]!.x + t * t * p[2]!.x,
      y: u * u * p[0]!.y + 2 * u * t * p[1]!.y + t * t * p[2]!.y,
    }
  }
  return {
    x: u * u * u * p[0]!.x + 3 * u * u * t * p[1]!.x + 3 * u * t * t * p[2]!.x + t * t * t * p[3]!.x,
    y: u * u * u * p[0]!.y + 3 * u * u * t * p[1]!.y + 3 * u * t * t * p[2]!.y + t * t * t * p[3]!.y,
  }
}

/** |dB/dt| */
function speed(pc: Piece, t: number): number {
  const p = pc.p
  const u = 1 - t
  if (pc.kind === 'quad') {
    const dx = 2 * u * (p[1]!.x - p[0]!.x) + 2 * t * (p[2]!.x - p[1]!.x)
    const dy = 2 * u * (p[1]!.y - p[0]!.y) + 2 * t * (p[2]!.y - p[1]!.y)
    return Math.hypot(dx, dy)
  }
  const dx = 3 * u * u * (p[1]!.x - p[0]!.x) + 6 * u * t * (p[2]!.x - p[1]!.x) + 3 * t * t * (p[3]!.x - p[2]!.x)
  const dy = 3 * u * u * (p[1]!.y - p[0]!.y) + 6 * u * t * (p[2]!.y - p[1]!.y) + 3 * t * t * (p[3]!.y - p[2]!.y)
  return Math.hypot(dx, dy)
}

/** the curve's length between parameters a and b */
function lengthBetween(pc: Piece, a: number, b: number): number {
  const h = (b - a) / 2
  const m = (a + b) / 2
  let s = 0
  for (let i = 0; i < 5; i++) s += GL_W[i]! * speed(pc, m + h * GL_X[i]!)
  return s * h
}

function measure(kind: Piece['kind'], p: Pt[]): Piece {
  const pc: Piece = { kind, p, len: 0, spans: [] }
  if (kind === 'line') {
    pc.len = Math.hypot(p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y)
    return pc
  }
  // cumulative length at the end of each span
  let acc = 0
  for (let k = 0; k < SPANS; k++) {
    acc += lengthBetween(pc, k / SPANS, (k + 1) / SPANS)
    pc.spans.push(acc)
  }
  pc.len = acc
  return pc
}

/** the parameter at length `s` along the piece */
function paramAt(pc: Piece, s: number): number {
  if (pc.kind === 'line') return pc.len > 0 ? s / pc.len : 0
  if (s <= 0) return 0
  if (s >= pc.len) return 1
  let k = 0
  while (k < SPANS - 1 && pc.spans[k]! < s) k++
  const t0 = k / SPANS
  const t1 = (k + 1) / SPANS
  const s0 = k > 0 ? pc.spans[k - 1]! : 0
  const s1 = pc.spans[k]!
  let t = s1 > s0 ? lerp(t0, t1, (s - s0) / (s1 - s0)) : t0
  for (let i = 0; i < 6; i++) {
    const v = speed(pc, t)
    if (v === 0) break
    const next = Math.min(t1, Math.max(t0, t - (s0 + lengthBetween(pc, t0, t) - s) / v))
    if (Math.abs(next - t) < 1e-12) {
      t = next
      break
    }
    t = next
  }
  return t
}

/** the pieces of a single-contour path, or null for anything the app does not write */
function parse(d: string): Piece[] | null {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens || tokens[0] !== 'M') return null
  const pieces: Piece[] = []
  let i = 0
  let cmd = ''
  let cur: Pt = { x: 0, y: 0 }
  let start: Pt = { x: 0, y: 0 }
  let moves = 0
  const isCmd = (tk: string) => /[A-Za-z]/.test(tk)
  const num = (): number | null => {
    const tk = tokens[i]
    if (tk == null || isCmd(tk)) return null
    i++
    return +tk
  }
  const pt = (): Pt | null => {
    const x = num()
    const y = num()
    return x == null || y == null ? null : { x, y }
  }
  while (i < tokens.length) {
    if (isCmd(tokens[i]!)) cmd = tokens[i++]!
    switch (cmd) {
      case 'M': {
        if (++moves > 1) return null
        const p = pt()
        if (!p) return null
        cur = start = p
        cmd = 'L'
        break
      }
      case 'L': {
        const p = pt()
        if (!p) return null
        pieces.push(measure('line', [cur, p]))
        cur = p
        break
      }
      case 'H': {
        const x = num()
        if (x == null) return null
        const p = { x, y: cur.y }
        pieces.push(measure('line', [cur, p]))
        cur = p
        break
      }
      case 'V': {
        const y = num()
        if (y == null) return null
        const p = { x: cur.x, y }
        pieces.push(measure('line', [cur, p]))
        cur = p
        break
      }
      case 'Q': {
        const c = pt()
        const p = pt()
        if (!c || !p) return null
        pieces.push(measure('quad', [cur, c, p]))
        cur = p
        break
      }
      case 'C': {
        const c1 = pt()
        const c2 = pt()
        const p = pt()
        if (!c1 || !c2 || !p) return null
        pieces.push(measure('cubic', [cur, c1, c2, p]))
        cur = p
        break
      }
      case 'Z':
        pieces.push(measure('line', [cur, start]))
        cur = start
        // a closed contour ends the path the app draws
        if (i < tokens.length) return null
        break
      default:
        return null
    }
  }
  return pieces
}

/**
 * The points at `n + 1` equal steps along the path, `n = ceil(length / step)`
 * (at least 1), first and last included; null when the path uses a command
 * this sampler does not read. `countLength`, when given (the browser's own
 * `getTotalLength`, one call), sets `n`, so the count never differs from the
 * browser's by a length on the edge of a step.
 */
export function samplePath(d: string, step: number, countLength?: number): Pt[] | null {
  const pieces = parse(d)
  if (!pieces) return null
  const ends: number[] = []
  let len = 0
  for (const pc of pieces) ends.push((len += pc.len))
  const n = Math.max(1, Math.ceil((countLength ?? len) / step))
  const out: Pt[] = []
  if (pieces.length === 0) {
    for (let i = 0; i <= n; i++) out.push({ x: 0, y: 0 })
    return out
  }
  let k = 0
  for (let i = 0; i <= n; i++) {
    const at = (i / n) * len
    // the first piece (of non-zero length) that ends at or past this length
    while (k < pieces.length - 1 && (ends[k]! < at || pieces[k]!.len === 0)) k++
    const startD = k > 0 ? ends[k - 1]! : 0
    out.push(evalAt(pieces[k]!, paramAt(pieces[k]!, at - startD)))
  }
  return out
}
