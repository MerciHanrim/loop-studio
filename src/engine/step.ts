import type { LoopEdge, LoopNode, PoolData } from '../model/types'
import type { SimState, StepResult } from './types'

/**
 * Vertical-slice execution only.
 *
 * Handles: Source (push), Pool (hold), Drain (pull), numeric flow labels,
 * `automatic` / `onStart` activation, capacity clamping. Everything else in
 * SEMANTICS.md — gates, converters, dice, state connections, pull-all, triggers
 * — is deliberately not here yet. This exists so the playback loop has real
 * timing and state to design against.
 */

function numeric(raw: string | undefined): number {
  const n = Number(String(raw ?? '').trim())
  return Number.isFinite(n) ? n : 1
}

function edgeFlow(e: LoopEdge): string {
  return e.data && e.data.kind === 'resource' ? e.data.flow : '1'
}

export function initSim(nodes: LoopNode[]): SimState {
  const values: Record<string, number> = {}
  for (const n of nodes) {
    if (n.data.kind === 'pool') values[n.id] = (n.data as PoolData).initial
  }
  return { step: 0, values, ended: false }
}

export function step(nodes: LoopNode[], edges: LoopEdge[], prev: SimState): StepResult {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const resEdges = edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')
  const snap = { ...prev.values }
  const delta: Record<string, number> = {}
  const move = (id: string, v: number) => {
    delta[id] = (delta[id] ?? 0) + v
  }
  const events: StepResult['events'] = []
  const fired: string[] = []

  const firesNow = (n: LoopNode) =>
    n.data.activation === 'automatic' ||
    (n.data.activation === 'onStart' && prev.step === 0)

  const isPool = (id: string) => byId.get(id)?.data.kind === 'pool'

  for (const n of nodes) {
    if (!firesNow(n)) continue

    if (n.data.kind === 'source') {
      fired.push(n.id)
      for (const e of resEdges) {
        if (e.source !== n.id || !isPool(e.target)) continue
        const amt = numeric(edgeFlow(e))
        if (amt > 0) {
          move(e.target, amt)
          events.push({ edgeId: e.id, from: e.source, to: e.target, amount: amt })
        }
      }
    } else if (n.data.kind === 'drain') {
      fired.push(n.id)
      for (const e of resEdges) {
        if (e.target !== n.id) continue
        const want = numeric(edgeFlow(e))
        const avail = (snap[e.source] ?? 0) + (delta[e.source] ?? 0)
        const take = Math.max(0, Math.min(want, avail))
        if (take > 0) {
          move(e.source, -take)
          events.push({ edgeId: e.id, from: e.source, to: e.target, amount: take })
        }
      }
    }
  }

  const values: Record<string, number> = { ...prev.values }
  for (const id of Object.keys(values)) {
    let v = (values[id] ?? 0) + (delta[id] ?? 0)
    if (v < 0) v = 0
    const node = byId.get(id)
    const cap = node && node.data.kind === 'pool' ? (node.data as PoolData).capacity : null
    if (cap != null && v > cap) v = cap
    values[id] = Math.round(v * 1e6) / 1e6
  }

  return {
    state: { step: prev.step + 1, values, ended: false },
    events,
    firedNodeIds: fired,
  }
}
