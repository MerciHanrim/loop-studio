import { describe, expect, it } from 'vitest'
import { defaultData } from './factory'
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
import { NODE_ICON_IDS, readIcon } from './model'
import { deserialize, normalizeGraph, serialize } from './serialize'
import type { LoopEdge, LoopNode, NodeKind } from './types'
import { semanticDigest } from './workspace'

// SEMANTICS-R12.md — the icon of a flow node through the file, the digests and
// the revision layer.

const FLOW: NodeKind[] = ['pool', 'source', 'drain', 'gate', 'converter', 'end']
const KINDS: NodeKind[] = [...FLOW, 'parameter', 'register']

function node(id: string, kind: NodeKind, x: number, icon?: unknown): LoopNode {
  const data = { ...(defaultData(kind) as unknown as Record<string, unknown>), label: id, ...(icon !== undefined ? { icon } : {}) }
  return { id, type: kind, position: { x, y: 0 }, data: data as LoopNode['data'] }
}

function graph(icons: Partial<Record<NodeKind, unknown>> = {}) {
  const nodes = KINDS.map((k, i) => node(k, k, i * 200, icons[k]))
  const edges: LoopEdge[] = [
    {
      id: 'r', type: 'loop', source: 'source', target: 'pool', sourceHandle: 'out', targetHandle: 'in',
      data: { kind: 'resource', flow: '1' },
    },
  ]
  return { nodes, edges }
}

const flowOnly = (icons: Partial<Record<NodeKind, unknown>> = {}) => {
  const g = graph(icons)
  return { nodes: g.nodes.filter((n) => FLOW.includes(n.data.kind)), edges: g.edges }
}

const iconOf = (n: LoopNode | undefined) => (n?.data as { icon?: unknown } | undefined)?.icon
const roundTrip = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => deserialize(serialize(g.nodes, g.edges, undefined, undefined, undefined, 2))

describe('the registry', () => {
  it('lists the twenty-nine ids (the first list and its three follow-ups), each a stable ASCII word', () => {
    expect(NODE_ICON_IDS).toHaveLength(29)
    for (const id of NODE_ICON_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect(new Set(NODE_ICON_IDS).size).toBe(29)
    // the picker's groups split the list at the first industry id, and End lands on the last
    expect(NODE_ICON_IDS[15]).toBe('airplane')
    expect(NODE_ICON_IDS[28]).toBe('recycling')
  })

  it('reads a registered id and nothing else', () => {
    expect(readIcon('nuclear-plant')).toBe('nuclear-plant')
    expect(readIcon('rain-cloud')).toBe('rain-cloud')
    expect(readIcon('recycling')).toBe('recycling')
    expect(readIcon('cash')).toBe('cash')
    for (const id of ['snow', 'temperature', 'lightning-risk', 'partly-cloudy', 'strong-wind', 'typhoon', 'oil', 'coal', 'drink', 'food', 'house', 'cargo-ship']) expect(readIcon(id)).toBe(id)
    for (const bad of ['', 'Cloud', 'snow-cloud', 7, null, undefined, {}, ['cloud']]) expect(readIcon(bad)).toBeUndefined()
  })
})

describe('the file', () => {
  it('serialize → deserialize keeps the icon on the six flow kinds', () => {
    const icons = Object.fromEntries(FLOW.map((k, i) => [k, NODE_ICON_IDS[i]]))
    const back = roundTrip(graph(icons))
    for (const k of FLOW) expect(iconOf(back.nodes.find((n) => n.id === k)), k).toBe(icons[k])
  })

  it('a file without icons gains no `icon` key', () => {
    expect(serialize(graph().nodes, graph().edges)).not.toContain('icon')
  })

  it('a value that is not a registered id is dropped and the node kept', () => {
    const n = normalizeGraph(graph({ pool: 'snow-cloud', source: 4, gate: 'CLOUD' }))
    for (const id of ['pool', 'source', 'gate']) {
      const el = n.nodes.find((x) => x.id === id)!
      expect(el, id).toBeDefined()
      expect('icon' in el.data, id).toBe(false)
    }
    expect(n.nodes).toHaveLength(KINDS.length)
  })

  it('a value on a Parameter or Register is dropped on read', () => {
    const back = roundTrip(graph({ parameter: 'cloud', register: 'sun', pool: 'tree' }))
    for (const id of ['parameter', 'register']) expect('icon' in back.nodes.find((n) => n.id === id)!.data, id).toBe(false)
    expect(iconOf(back.nodes.find((n) => n.id === 'pool'))).toBe('tree')
  })
})

describe('the digests', () => {
  it('the engine digest is unchanged by setting, changing and removing icons', async () => {
    const plain = await semanticDigest(graph())
    expect(await semanticDigest(graph({ pool: 'cloud', gate: 'car' }))).toBe(plain)
    expect(await semanticDigest(graph({ pool: 'water' }))).toBe(plain)
  })

  it('the full revision digest moves with an icon and comes back without it', async () => {
    const plain = await fullContentDigest(graph())
    const withIcon = await fullContentDigest(graph({ pool: 'cloud' }))
    expect(withIcon).not.toBe(plain)
    expect(await fullContentDigest(graph({ pool: 'wind' }))).not.toBe(withIcon)
    expect(await fullContentDigest(graph())).toBe(plain)
  })

  it('an icon on a Register changes no revision (it is dropped on read)', async () => {
    expect(await fullContentDigest(normalizeGraph(graph({ register: 'sun' })))).toBe(await fullContentDigest(normalizeGraph(graph())))
  })

  it('a document with no icon projects byte-identically to before; with one, `icon` is last', () => {
    expect(JSON.stringify(canonicalContent(graph()))).not.toContain('icon')
    const pool = canonicalContent(graph({ pool: 'cloud' })).nodes.find((n) => n.id === 'pool')!
    expect(Object.keys(pool.data).at(-1)).toBe('icon')
  })

  it('an icon after the flow colour keeps `accent` before `icon`', () => {
    const g = graph({ pool: 'cloud' })
    ;(g.nodes[0]!.data as { accent?: string }).accent = '#638EA5'
    const pool = canonicalContent(g).nodes.find((n) => n.id === 'pool')!
    expect(Object.keys(pool.data).slice(-2)).toEqual(['accent', 'icon'])
  })

  it('the literal loop-revision/1 projection never emits it', () => {
    expect(JSON.stringify(canonicalContent(flowOnly({ pool: 'cloud' }), { modelLayer: false }))).not.toContain('icon')
  })
})

describe('the revision layer — SEMANTICS-R12.md', () => {
  it('a side with a surviving icon is loop-revision/12; without one it is what it was', () => {
    const side = readRevisionSide(flowOnly({ pool: 'cloud' }))
    expect(side.ok && side.version).toBe('loop-revision/12')
    const plain = readRevisionSide(flowOnly())
    expect(plain.ok && plain.version).toBe('loop-revision/1')
    const dropped = readRevisionSide(flowOnly({ pool: 'nope' }))
    expect(dropped.ok && dropped.version).toBe('loop-revision/1')
  })

  it('a stored digest over the /12 projection verifies', () => {
    const g = flowOnly({ pool: 'cloud' })
    const side = readRevisionSide(g, digestOfCanonical(canonicalContent(g)))
    expect(side.ok && side.digestVerified).toBe(true)
  })

  it('`icon` is a cosmetic node field', () => {
    expect(fieldTag('node', 'data.icon')).toBe('cosmetic')
  })

  it('an icon-only change is cosmetic: no engine or advisory hunk', () => {
    const d = computeRevisionDiff(canonicalContent(graph()), canonicalContent(graph({ pool: 'cloud' })))
    expect(d.summary.empty).toBe(false)
    expect(d.summary.engineAffecting).toBe(false)
    expect(d.summary.advisoryAffecting).toBe(false)
  })

  it('a selective Apply can add, change and remove an icon', () => {
    const cases: [string | undefined, string | undefined][] = [
      [undefined, 'cloud'],
      ['cloud', 'car'],
      ['cloud', undefined],
    ]
    for (const [from, to] of cases) {
      const base = graph(from ? { pool: from } : {})
      const proposed = graph(to ? { pool: to } : {})
      const baseC = canonicalContent(base)
      const plan = computeThreeWay(baseC, canonicalContent(base), canonicalContent(proposed))
      const hunk = plan.hunks.find((h) => h.id === 'pool' && h.kind === 'change')!
      expect(hunk.fields!.map((f) => f.field)).toEqual(['data.icon'])
      const applied = buildSelectiveApply({
        target: base,
        proposedFull: proposed,
        plan,
        selection: { accept: {}, fieldChoices: { pool: { 'data.icon': 'proposed' } } },
      })
      expect(applied.ok).toBe(true)
      if (applied.ok) expect(iconOf(applied.nodes.find((n) => n.id === 'pool')), `${from} -> ${to}`).toBe(to)
    }
  })
})
