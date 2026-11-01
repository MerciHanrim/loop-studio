import { afterEach, describe, expect, it } from 'vitest'
import pickupDoc from '../../examples/gacha-pickup.json'
import type { LoopEdge, LoopNode } from '../model/types'
import { useUiStore } from './uiStore'
import {
  __layoutSignatureComputed,
  __resetRouteCache,
  layoutSignature,
  layoutSignatureOnce,
  setNodeNameBox,
  setRouteLabelSize,
  setRouteRunFormSize,
} from './routeMap'

// #421 item 3 (Lumi, 2026-11-01) — the badge plan asks for the layout
// signature once per connection with a token at a step's start; it is now
// computed once per layout. The memo's key is what the signature reads: the
// node and edge arrays (replaced, never written in place, by the graph store),
// the route inputs' `rev` (bumped by every name-box, label-size and run-form
// size change) and the node structure. Each of these, changed, gives the fresh
// signature; nothing changed, no second computation.

type Doc = { nodes: LoopNode[]; edges: LoopEdge[] }
const doc = pickupDoc as unknown as Doc
afterEach(() => __resetRouteCache())

/** the memo agrees with a fresh computation */
const agrees = (nodes: LoopNode[], edges: LoopEdge[]) => expect(layoutSignatureOnce(nodes, edges)).toBe(layoutSignature(nodes, edges))

describe('layoutSignatureOnce (#421)', () => {
  it('the same layout asked many times is computed once', () => {
    const { nodes, edges } = doc
    const before = __layoutSignatureComputed()
    const first = layoutSignatureOnce(nodes, edges)
    for (let i = 0; i < 48; i++) expect(layoutSignatureOnce(nodes, edges)).toBe(first)
    expect(__layoutSignatureComputed() - before).toBe(1)
    expect(first).toBe(layoutSignature(nodes, edges))
  })

  it('a moved node (a new nodes array) gives the new signature', () => {
    const { nodes, edges } = doc
    const a = layoutSignatureOnce(nodes, edges)
    const moved = nodes.map((n, i) => (i === 0 ? { ...n, position: { x: n.position.x + 16, y: n.position.y } } : n))
    expect(layoutSignatureOnce(moved, edges)).not.toBe(a)
    agrees(moved, edges)
  })

  it('a changed connection (a new edges array) gives the new signature', () => {
    const { nodes, edges } = doc
    const a = layoutSignatureOnce(nodes, edges)
    const changed = edges.map((e, i) => (i === 0 ? { ...e, data: { ...(e.data as object), route: 'straight' } } : e)) as LoopEdge[]
    expect(layoutSignatureOnce(nodes, changed)).not.toBe(a)
    agrees(nodes, changed)
  })

  it('a label size, a run-form size and an outside name box — same arrays — each give the new signature', () => {
    const { nodes, edges } = doc
    let last = layoutSignatureOnce(nodes, edges)
    setRouteLabelSize(edges[0].id, 77, 19)
    expect(layoutSignatureOnce(nodes, edges)).not.toBe(last)
    agrees(nodes, edges)
    last = layoutSignatureOnce(nodes, edges)
    setRouteRunFormSize(edges[0].id, 91, 23)
    expect(layoutSignatureOnce(nodes, edges)).not.toBe(last)
    agrees(nodes, edges)
    last = layoutSignatureOnce(nodes, edges)
    setNodeNameBox(nodes[0].id, { dx: 0, dy: 64, w: 50, h: 14 })
    expect(layoutSignatureOnce(nodes, edges)).not.toBe(last)
    agrees(nodes, edges)
    setNodeNameBox(nodes[0].id, null)
  })

  it('the node structure switched gives the new signature', () => {
    const { nodes, edges } = doc
    const was = useUiStore.getState().nodeStructure
    const a = layoutSignatureOnce(nodes, edges)
    useUiStore.setState({ nodeStructure: was === 'outside' ? 'inside' : 'outside' })
    try {
      expect(layoutSignatureOnce(nodes, edges)).not.toBe(a)
      agrees(nodes, edges)
    } finally {
      useUiStore.setState({ nodeStructure: was })
    }
  })

  it('a route cache reset (label sizes cleared without a bump) gives the fresh signature', () => {
    const { nodes, edges } = doc
    setRouteLabelSize(edges[0].id, 60, 18)
    const sized = layoutSignatureOnce(nodes, edges)
    __resetRouteCache()
    expect(layoutSignatureOnce(nodes, edges)).not.toBe(sized)
    agrees(nodes, edges)
  })
})
