import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { repeatedChangeGroups } from '../model/endMove'
import {
  __resetRouteCache,
  __setRunFormPass,
  __syncFreeSlots,
  __syncFullGeneration,
  besideBox,
  currentRouteGeneration,
  routeDiagnostics,
  setRouteLabelSize,
  setRouteRunFormSize,
} from './routeMap'

// docs/edge-routing.md §ER15.2 — the run-form pass: the labels of a repeated
// Value change group (two or more Value changes with the same ends and stored
// handles) are re-placed LAST by the room they can take in a run, on or beside
// their line; no line and no other label moves; a member with no safe spot
// keeps its place and is reported.

type Box = { x: number; y: number; w: number; h: number }
const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const change = (id: string, s: string, t: string, route?: 'orthogonal'): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', expr: '+1', ...(route ? { route } : {}) } }) as unknown as LoopEdge
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const REST = { w: 30, h: 19 }
const RUN = { w: 160, h: 43 } // the chip's three rows at its width cap (flow px)

const sizes = (ids: string[], run = true) => {
  for (const id of ids) {
    setRouteLabelSize(id, REST.w, REST.h)
    if (run) setRouteRunFormSize(id, RUN.w, RUN.h)
  }
}
/** a routed label's run-form box: beside → hanging from its near edge, else centred */
const runBox = (id: string, r: { label: { x: number; y: number } | null; beside?: { side: 'up' | 'down' | 'left' | 'right' } }): Box =>
  r.beside ? besideBox(r.label!, r.beside.side, RUN, id) : { x: r.label!.x - RUN.w / 2, y: r.label!.y - RUN.h / 2, w: RUN.w, h: RUN.h }
// two Pools far apart: the pair's routes fan out side by side
const wide = () => [node('feed', 0, 0), node('tank', 640, 0)]
const pair = (route?: 'orthogonal') => [change('m1', 'feed', 'tank', route), change('m2', 'feed', 'tank', route)]

beforeEach(() => {
  __resetRouteCache()
})

describe('repeated Value change groups', () => {
  it('two or more Value changes with the same ends and handles form a group; a flow, a reversed pair or another target does not', () => {
    const flow = { ...change('f', 'feed', 'tank'), sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } } as unknown as LoopEdge
    expect(repeatedChangeGroups([...pair(), change('m3', 'feed', 'tank')])).toEqual([['m1', 'm2', 'm3']])
    expect(repeatedChangeGroups([change('a', 'feed', 'tank'), change('b', 'tank', 'feed')])).toEqual([])
    expect(repeatedChangeGroups([change('a', 'feed', 'tank'), flow])).toEqual([])
    expect(repeatedChangeGroups([change('a', 'feed', 'tank'), change('b', 'feed', 'other')])).toEqual([])
  })
})

describe('the run-form pass (§ER15.2)', () => {
  it('routed: the members get run-form room clear of each other and of the nodes; every line is the one without the pass', () => {
    sizes(['m1', 'm2'])
    const on = __syncFullGeneration(wide(), pair('orthogonal'))
    __setRunFormPass(false)
    const off = __syncFullGeneration(wide(), pair('orthogonal'))
    for (const id of ['m1', 'm2']) expect(on.get(id)!.d, `${id} keeps its line`).toBe(off.get(id)!.d)
    const a = runBox('m1', on.get('m1')!)
    const b = runBox('m2', on.get('m2')!)
    expect(hit(a, b), 'the two run forms do not meet').toBe(false)
    for (const n of wide()) expect(hit(a, { ...n.position, w: 130, h: 64 }) || hit(b, { ...n.position, w: 130, h: 64 }), `clear of ${n.id}`).toBe(false)
  })

  it('a member placed beside its line has its leader anchor ON its line, and its near edge `gap` px off it', () => {
    // close Pools: the run form does not fit ON the lines, only beside them
    const close = [node('feed', 0, 0), node('tank', 150, 0)]
    sizes(['m1', 'm2'])
    const on = __syncFullGeneration(close, pair('orthogonal'))
    const beside = ['m1', 'm2'].map((id) => on.get(id)!).filter((r) => r.beside)
    expect(beside.length).toBeGreaterThan(0)
    for (const r of beside) {
      const { anchor, side, gap } = r.beside!
      const onLine = r.points.some((q, i) => i > 0 && Math.min(q.x, r.points[i - 1].x) - 0.01 <= anchor.x && anchor.x <= Math.max(q.x, r.points[i - 1].x) + 0.01 && Math.min(q.y, r.points[i - 1].y) - 0.01 <= anchor.y && anchor.y <= Math.max(q.y, r.points[i - 1].y) + 0.01)
      expect(onLine, 'the anchor is on the line').toBe(true)
      const d = side === 'up' || side === 'down' ? Math.abs(r.label!.y - anchor.y) : Math.abs(r.label!.x - anchor.x)
      expect(d).toBeCloseTo(gap, 5)
    }
  })

  it('the same input gives the same places (twice)', () => {
    sizes(['m1', 'm2'])
    const a = JSON.stringify([...__syncFullGeneration(wide(), pair('orthogonal'))])
    const b = JSON.stringify([...__syncFullGeneration(wide(), pair('orthogonal'))])
    expect(b).toBe(a)
  })

  it('no run-form size known (not measured yet), or a single Value change: exactly the places without the pass', () => {
    sizes(['m1', 'm2'], false)
    const unmeasured = JSON.stringify([...__syncFullGeneration(wide(), pair('orthogonal'))])
    __setRunFormPass(false)
    expect(JSON.stringify([...__syncFullGeneration(wide(), pair('orthogonal'))])).toBe(unmeasured)
    __resetRouteCache()
    sizes(['m1'])
    const one = JSON.stringify([...__syncFullGeneration(wide(), [change('m1', 'feed', 'tank', 'orthogonal')])])
    __setRunFormPass(false)
    expect(JSON.stringify([...__syncFullGeneration(wide(), [change('m1', 'feed', 'tank', 'orthogonal')])])).toBe(one)
  })

  it('no safe spot: the members keep their places exactly, and are reported unresolved', () => {
    // two Pools nearly touching, other nodes all around, and a run form larger
    // than any room between them
    const near = [node('feed', 0, 0), node('tank', 150, 0), node('n', 40, -320), node('s', 40, 260), node('w', -760, 0), node('e', 900, 0)]
    for (const id of ['m1', 'm2']) {
      setRouteLabelSize(id, REST.w, REST.h)
      setRouteRunFormSize(id, 900, 400)
    }
    const on = JSON.stringify([...__syncFullGeneration(near, pair('orthogonal'))])
    __setRunFormPass(false)
    expect(JSON.stringify([...__syncFullGeneration(near, pair('orthogonal'))])).toBe(on)
    __setRunFormPass(true)
    currentRouteGeneration(near, pair('orthogonal'))
    const d = routeDiagnostics().runForm
    expect(d.groups).toBe(1)
    expect(d.unresolved.sort()).toEqual(['m1', 'm2'])
    expect(d.unchanged).toEqual([['m1', 'm2']])
  })

  it('Curved: the members of a group sharing one curve get room apart; a single Curved label keeps its slot', () => {
    sizes(['m1', 'm2'])
    const on = __syncFreeSlots(wide(), pair())
    __setRunFormPass(false)
    const off = __syncFreeSlots(wide(), pair())
    const box = (id: string, s: { at: { x: number; y: number }; beside?: { side: 'up' | 'down' | 'left' | 'right' } }) =>
      s.beside ? besideBox(s.at, s.beside.side, RUN, id) : { x: s.at.x - RUN.w / 2, y: s.at.y - RUN.h / 2, w: RUN.w, h: RUN.h }
    expect(hit(box('m1', on.get('m1')!), box('m2', on.get('m2')!))).toBe(false)
    expect(off.get('m1')).not.toEqual(undefined)
    __resetRouteCache()
    sizes(['m1'])
    const single = __syncFreeSlots(wide(), [change('m1', 'feed', 'tank')]).get('m1')
    __setRunFormPass(false)
    expect(__syncFreeSlots(wide(), [change('m1', 'feed', 'tank')]).get('m1')).toEqual(single)
  })
})
