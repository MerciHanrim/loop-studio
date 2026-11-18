import type { LoopEdge, LoopNode } from '../model/types'

// Small graphs made from a seed, for the tests that check a step's rules on many shapes and at
// many scales (issue #572). The same seed always makes the same graph. Every amount of a graph
// can be multiplied by a power of ten, digit for digit, so that a scale changes no ratio.

const P0 = { x: 0, y: 0 }
export type Mode = 'pullAny' | 'pullAll'
export type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }
export const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
export const conv = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode } })
export const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
export const source = (id: string, mode: 'pushAny' | 'pushAll' = 'pushAny'): LoopNode => ({ id, type: 'source', position: P0, data: { kind: 'source', label: id, activation: 'automatic', mode } as LoopNode['data'] })
export const drain = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'drain', position: P0, data: { kind: 'drain', label: id, activation: 'automatic', mode } as LoopNode['data'] })
export const end = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'end', position: P0, data: { kind: 'end', label: id, activation: 'automatic', mode } as LoopNode['data'] })
export const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })

/** `text` × 10^n, digit for digit (no arithmetic, so no rounding) */
export function shift(text: string, n: number): string {
  const [int, frac = ''] = text.split('.')
  let digits = int + frac
  let point = int.length + n
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits
    point = 1
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length)
  return digits.slice(0, point).replace(/^0+(?=\d)/, '') + (point < digits.length ? `.${digits.slice(point)}` : '')
}
export const times = (x: number, n: number) => Number(shift(String(x), n))

/** Two to five Pools (some with a capacity), one to five Gates and Converters (some `pull all`),
 *  lines from Pools into routers, between routers (always from an earlier one to a later one in
 *  id order) and from routers into Pools, every rate a whole number from 1 to 8. Every amount
 *  times 10^n. */
export function plainGraph(seed0: number, n = 0): Graph {
  let seed = seed0 >>> 0
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  const nodes: LoopNode[] = []
  const edges: LoopEdge[] = []
  const nPools = int(2, 5)
  for (let i = 0; i < nPools; i++) {
    const initial = int(0, 14)
    const capacity = rnd() < 0.35 ? initial + int(0, 8) : null
    nodes.push(pool(`p${i}`, times(initial, n), capacity === null ? null : times(capacity, n)))
  }
  const nR = int(1, 5)
  const routers: string[] = []
  for (let i = 0; i < nR; i++) {
    const isGate = rnd() < 0.6
    const id = `${isGate ? 'g' : 'c'}${i}`
    const mode = rnd() < 0.2 ? 'pullAll' : 'pullAny'
    routers.push(id)
    nodes.push(isGate ? gate(id, mode) : conv(id, mode))
  }
  let k = 0
  const add = (s: string, t: string) => edges.push(res(`e${k++}`, s, t, shift(String(int(1, 8)), n)))
  routers.forEach((r, i) => {
    const fromRouters = routers.slice(0, i).filter(() => rnd() < 0.45)
    for (const u of fromRouters) add(u, r)
    const lines = fromRouters.length === 0 ? int(1, 3) : int(0, 2)
    for (let j = 0; j < lines; j++) add(`p${int(0, nPools - 1)}`, r)
  })
  for (const r of routers) {
    const outs = edges.some((e) => e.source === r) ? int(0, 1) : int(1, 2)
    for (let j = 0; j < outs; j++) add(r, `p${int(0, nPools - 1)}`)
  }
  return { nodes, edges }
}

/** The plain graph of `seed` with one Source and lines from it: into routers (a Gate that is
 *  handed something by a Source, a Converter with a Source line) and into Pools (the push
 *  phase). The plain graph itself is not changed: the lines are drawn from another stream of
 *  numbers and their ids sort after `e…`. */
export function graphWithSourceLines(seed0: number, n = 0): Graph {
  const g = plainGraph(seed0, n)
  let seed = (Math.imul(seed0 >>> 0, 2654435761) + 97) >>> 0
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  const routers = g.nodes.filter((x) => x.data.kind !== 'pool').map((x) => x.id)
  const pools = g.nodes.filter((x) => x.data.kind === 'pool').map((x) => x.id)
  let k = 0
  const add = (t: string) => g.edges.push(res(`x${k++}`, 's0', t, shift(String(int(1, 8)), n)))
  for (const r of routers) if (rnd() < 0.4) add(r)
  if (k === 0) add(routers[int(0, routers.length - 1)])
  for (const p of pools) if (rnd() < 0.2) add(p)
  g.nodes.push(source('s0'))
  return g
}

/** The plain graph of `seed` with some lines from a Gate given a rate at or under 1e-9 (an
 *  absolute rate, at every scale): every line out of a Gate (the shares are then large parts of
 *  what it moves) or some of its lines into routers (the shares are then small). */
export function graphWithSmallRates(seed0: number, n = 0): Graph {
  const g = plainGraph(seed0, n)
  let seed = (Math.imul(seed0 >>> 0, 40503) + 12345) >>> 0
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const SMALL = ['0.0000000005', '0.000000001', '0.0000000002', '0.0000000007']
  const kind = (id: string) => g.nodes.find((x) => x.id === id)?.data.kind
  const setFlow = (e: LoopEdge) => ((e.data as { flow: string }).flow = SMALL[Math.floor(rnd() * SMALL.length)])
  for (const x of g.nodes) {
    if (x.data.kind !== 'gate') continue
    const outs = g.edges.filter((e) => e.source === x.id)
    const toRouters = outs.filter((e) => kind(e.target) !== 'pool')
    if (!toRouters.length) continue
    const r = rnd()
    if (r < 0.3) for (const e of outs) setFlow(e)
    else if (r < 0.75) for (const e of toRouters) if (rnd() < 0.7) setFlow(e)
  }
  return g
}
