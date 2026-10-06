import { describe, expect, it } from 'vitest'
import { defaultData } from './factory'
import { insertGraph } from './moduleGraph'
import {
  buildSelectiveApply,
  canonicalContent,
  computeRevisionDiff,
  computeThreeWay,
  digestOfCanonical,
  fieldTag,
  fullContentDigest,
  readRevisionSide,
} from './revision'
import { deserialize, normalizeGraph, serialize } from './serialize'
import type { LoopEdge, LoopNode, NodeKind } from './types'
import { semanticDigest } from './workspace'

// docs/flow-colour-and-compact-nodes.md FC-2 — the flow colour through the
// file, the digests and the revision layer (SEMANTICS-R9.md).

const KINDS: NodeKind[] = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register']

function node(id: string, kind: NodeKind, x: number, accent?: string): LoopNode {
  const data = { ...(defaultData(kind) as unknown as Record<string, unknown>), label: id, ...(accent ? { accent } : {}) }
  return { id, type: kind, position: { x, y: 0 }, data: data as LoopNode['data'] }
}

/** one node of every kind, a resource edge and a state edge */
function graph(accents: { nodes?: Record<string, string>; r?: string; s?: string } = {}) {
  const nodes = KINDS.map((k, i) => node(k, k, i * 200, accents.nodes?.[k]))
  const edges: LoopEdge[] = [
    {
      id: 'r', type: 'loop', source: 'source', target: 'pool', sourceHandle: 'out', targetHandle: 'in',
      data: { kind: 'resource', flow: '1', ...(accents.r ? { accent: accents.r } : {}) },
    },
    {
      id: 's', type: 'loop', source: 'pool', target: 'gate', sourceHandle: 'state-source', targetHandle: 'state-target',
      data: { kind: 'state', mode: 'trigger', expr: '', ...(accents.s ? { accent: accents.s } : {}) },
    },
  ]
  return { nodes, edges }
}

const EVERY = {
  nodes: Object.fromEntries(KINDS.map((k, i) => [k, ['#638EA5', '#74906B', '#A78243', '#9182A8', '#B47599', '#112233', '#ABCDEF', '#FF0000'][i]!])),
  r: '#123456',
  s: '#654321',
}

const accentOf = (data: unknown) => (data as { accent?: unknown } | undefined)?.accent
const roundTrip = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => deserialize(serialize(g.nodes, g.edges, undefined, undefined, undefined, 2))

describe('the file — FC-2.1 / FC-2.3', () => {
  it('serialize → deserialize keeps the colour on all eight node kinds and both edge kinds', () => {
    const back = roundTrip(graph(EVERY))
    for (const k of KINDS) expect(accentOf(back.nodes.find((n) => n.id === k)!.data), k).toBe(EVERY.nodes[k])
    expect(accentOf(back.edges.find((e) => e.id === 'r')!.data)).toBe('#123456')
    expect(accentOf(back.edges.find((e) => e.id === 's')!.data)).toBe('#654321')
  })

  it('a file without colours gains no `accent` key anywhere', () => {
    const back = roundTrip(graph())
    for (const el of [...back.nodes, ...back.edges]) expect(el.data ? 'accent' in el.data : false).toBe(false)
    expect(serialize(graph().nodes, graph().edges)).not.toContain('accent')
  })

  it('reading upper-cases a lower-case value, and drops an invalid one while keeping the element', () => {
    const g = graph({ nodes: { pool: '#abcdef', parameter: 'red', register: '#12345' }, r: '#3ad', s: 'transparent' })
    const n = normalizeGraph(g)
    expect(accentOf(n.nodes.find((x) => x.id === 'pool')!.data)).toBe('#ABCDEF')
    for (const id of ['parameter', 'register']) {
      const el = n.nodes.find((x) => x.id === id)!
      expect(el, id).toBeDefined()
      expect('accent' in el.data, id).toBe(false)
    }
    for (const id of ['r', 's']) {
      const el = n.edges.find((x) => x.id === id)!
      expect(el, id).toBeDefined()
      expect('accent' in (el.data as object), id).toBe(false)
    }
    expect(n.nodes).toHaveLength(KINDS.length)
    expect(n.edges).toHaveLength(2)
  })

  it('inserting a module keeps its colours on every kind, under fresh ids', () => {
    const mod = { ...graph(EVERY), modelVersion: 2 as const }
    const r = insertGraph({ nodes: [], edges: [], modelVersion: 2 }, mod, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const k of KINDS) {
      const inserted = r.nodes.find((n) => n.id === r.idMap[k])!
      expect(accentOf(inserted.data), k).toBe(EVERY.nodes[k])
    }
    expect(r.edges.map((e) => accentOf(e.data)).sort()).toEqual(['#123456', '#654321'])
  })

  it('selection flags never reach the file: they are temporary UI state', () => {
    const g = graph(EVERY)
    g.nodes[0]!.selected = true
    g.edges[0]!.selected = true
    const text = serialize(g.nodes, g.edges)
    expect(text).not.toContain('"selected"')
  })
})

describe('the digests — FC-2.5', () => {
  it('the engine digest is unchanged by setting, changing and removing colours', async () => {
    const plain = await semanticDigest(graph())
    expect(await semanticDigest(graph(EVERY))).toBe(plain)
    expect(await semanticDigest(graph({ nodes: { pool: '#000000' }, r: '#FFFFFF' }))).toBe(plain)
  })

  it('…and by selection flags', async () => {
    const g = graph()
    g.nodes[1]!.selected = true
    g.edges[1]!.selected = true
    expect(await semanticDigest(g)).toBe(await semanticDigest(graph()))
  })

  it('the full revision digest moves with a colour and comes back without it', async () => {
    const plain = await fullContentDigest(graph())
    const coloured = await fullContentDigest(graph({ nodes: { pool: '#638EA5' } }))
    expect(coloured).not.toBe(plain)
    expect(await fullContentDigest(graph({ nodes: { pool: '#B47599' } }))).not.toBe(coloured)
    expect(await fullContentDigest(graph({ s: '#638EA5' }))).not.toBe(plain)
    expect(await fullContentDigest(graph())).toBe(plain)
  })

  it('equal colours give equal digests whatever case the file used', async () => {
    expect(await fullContentDigest(graph({ nodes: { gate: '#abcdef' } }))).toBe(
      await fullContentDigest(graph({ nodes: { gate: '#ABCDEF' } })),
    )
  })

  it('a document with no colour projects byte-identically to before (no `accent` key, trailing order kept)', () => {
    const c = canonicalContent(graph())
    expect(JSON.stringify(c)).not.toContain('accent')
    const pool = canonicalContent(graph({ nodes: { pool: '#638EA5' } })).nodes.find((n) => n.id === 'pool')!
    expect(Object.keys(pool.data).at(-1)).toBe('accent')
  })

  it('the literal loop-revision/1 projection never emits it', () => {
    const g = graph({ nodes: { pool: '#638EA5', source: '#74906B' }, r: '#123456' })
    // v1 content has no Parameter / Register (that projection refuses them)
    const flowOnly = { nodes: g.nodes.filter((n) => n.data.kind !== 'parameter' && n.data.kind !== 'register'), edges: g.edges }
    const c = canonicalContent(flowOnly, { modelLayer: false })
    expect(JSON.stringify(c)).not.toContain('accent')
  })
})

describe('the revision layer — SEMANTICS-R9.md', () => {
  // a flow-only graph (no Parameter / Register), so the colour is the ONLY
  // reason for any version above loop-revision/1
  const flow = (accent?: string) => {
    const g = graph({ nodes: accent ? { pool: accent } : {} })
    return { nodes: g.nodes.filter((n) => n.data.kind !== 'parameter' && n.data.kind !== 'register'), edges: g.edges }
  }

  it('a side with a surviving colour is loop-revision/9; without one it is what it was', () => {
    const side = readRevisionSide(flow('#638EA5'))
    expect(side.ok && side.version).toBe('loop-revision/9')
    const plain = readRevisionSide(flow())
    expect(plain.ok && plain.version).toBe('loop-revision/1')
    const dropped = readRevisionSide(flow('nope'))
    expect(dropped.ok && dropped.version).toBe('loop-revision/1')
  })

  it('a stored digest over the /9 projection verifies', () => {
    const g = flow('#638EA5')
    const digest = digestOfCanonical(canonicalContent(g))
    const side = readRevisionSide(g, digest)
    expect(side.ok && side.digestVerified).toBe(true)
  })

  it('`accent` is a cosmetic field on a node and on an edge', () => {
    expect(fieldTag('node', 'data.accent')).toBe('cosmetic')
    expect(fieldTag('edge', 'data.accent')).toBe('cosmetic')
  })

  it('a colour-only change is cosmetic: no engine or advisory hunk', () => {
    const d = computeRevisionDiff(canonicalContent(graph()), canonicalContent(graph({ nodes: { pool: '#638EA5' }, r: '#123456' })))
    expect(d.summary.empty).toBe(false)
    expect(d.summary.engineAffecting).toBe(false)
    expect(d.summary.advisoryAffecting).toBe(false)
  })

  it('a selective Apply can add, change and remove a colour', () => {
    const cases: [string | undefined, string | undefined][] = [
      [undefined, '#638EA5'],
      ['#638EA5', '#B47599'],
      ['#638EA5', undefined],
    ]
    for (const [from, to] of cases) {
      const base = graph({ nodes: from ? { pool: from } : {} })
      const proposed = graph({ nodes: to ? { pool: to } : {} })
      const baseC = canonicalContent(base)
      const plan = computeThreeWay(baseC, canonicalContent(base), canonicalContent(proposed))
      const hunk = plan.hunks.find((h) => h.id === 'pool' && h.kind === 'change')!
      expect(hunk.fields!.map((f) => f.field)).toEqual(['data.accent'])
      const applied = buildSelectiveApply({
        target: base,
        proposedFull: proposed,
        plan,
        selection: { accept: {}, fieldChoices: { pool: { 'data.accent': 'proposed' } } },
      })
      expect(applied.ok).toBe(true)
      if (applied.ok) expect(accentOf(applied.nodes.find((n) => n.id === 'pool')!.data), `${from} -> ${to}`).toBe(to)
    }
  })
})
