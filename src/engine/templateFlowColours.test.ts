import { describe, expect, it } from 'vitest'
import { deserialize } from '../model/serialize'
import { canonicalContent, digestOfCanonical, fullContentDigest } from '../model/revision'
import { EXAMPLE_GRAPH_DIGESTS } from '../model/sha256Baseline.fixture'
import type { LoopEdge, LoopNode } from '../model/types'
import { semanticDigest } from '../model/workspace'
import { FLOW_PALETTE } from '../ui/flowColour'
import { COFFEE_ROASTERY_FLOWS } from './coffee-roastery.fixture'
import { GACHA_BANNER_ZONES_FLOWS } from './gachaBannerZonesGraph'
import { MMO_PROGRESSION_FLOWS } from './mmo-progression.fixture'
import { withTemplateFlowColours, type TemplateFlows } from './templateFlowColours'

// docs/flow-colour-and-compact-nodes.md FC-6 — the bundled Templates' flow
// colours: written by each builder into the shipped JSON, three per Template,
// never on a Parameter or a Register, and never a model change.

const EXAMPLE_TEXT = import.meta.glob('../../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (file: string): string => {
  const text = EXAMPLE_TEXT['../../examples/' + file]
  if (text === undefined) throw new Error('missing example ' + file)
  return text
}
const HEX = new Map<string, string>(FLOW_PALETTE.map((p) => [p.id, p.hex]))
const accentOf = (el: { data?: unknown }) => (el.data as { accent?: string } | undefined)?.accent

const node = (id: string, kind: LoopNode['data']['kind']): LoopNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id } }) as unknown as LoopNode
const edge = (id: string, source: string, target: string, kind: 'resource' | 'state' = 'resource'): LoopEdge =>
  ({ id, type: 'loop', source, target, data: { kind } }) as unknown as LoopEdge

describe('withTemplateFlowColours', () => {
  const nodes = [node('a', 'source'), node('b', 'pool'), node('c', 'drain'), node('p', 'parameter'), node('r', 'register')]
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('s', 'a', 'b', 'state')]

  it('colours the listed nodes and the resource edges inside one flow, nothing else', () => {
    const out = withTemplateFlowColours(nodes, edges, { sage: ['a', 'b'], rose: ['c'] })
    expect(out.nodes.map(accentOf)).toEqual(['#74906B', '#74906B', '#B47599', undefined, undefined])
    // `bc` joins two flows and `s` is a state edge: both stay uncoloured
    expect(out.edges.map(accentOf)).toEqual(['#74906B', undefined, undefined])
    expect(nodes.map(accentOf)).toEqual([undefined, undefined, undefined, undefined, undefined]) // inputs untouched
  })

  it('fails closed: a missing id, a Parameter, a Register, or a node under two colours', () => {
    expect(() => withTemplateFlowColours(nodes, edges, { sage: ['nope'] })).toThrow(/no node nope/)
    expect(() => withTemplateFlowColours(nodes, edges, { sage: ['p'] })).toThrow(/parameter/)
    expect(() => withTemplateFlowColours(nodes, edges, { sage: ['r'] })).toThrow(/register/)
    expect(() => withTemplateFlowColours(nodes, edges, { sage: ['a'], rose: ['a'] })).toThrow(/twice/)
  })
})

// the current generated JSON, exactly: its engine digest equals the one recorded
// before the colours (sha256Baseline.fixture.ts), its content and full-content
// digests are pinned here at their values WITH the colours
const TEMPLATES: { file: string; flows: TemplateFlows; colours: string[]; contentDigest: string; fullContentDigest: string }[] = [
  {
    file: 'coffee-roastery.json',
    flows: COFFEE_ROASTERY_FLOWS,
    colours: ['sage', 'gold', 'rose'],
    contentDigest: 'b64fd6264bbf3aa0810ea85a86ca95be1c4bed3f3d6df290d4d222e575d79d71',
    fullContentDigest: 'b64fd6264bbf3aa0810ea85a86ca95be1c4bed3f3d6df290d4d222e575d79d71',
  },
  {
    file: 'gacha-banner-zones.json',
    flows: GACHA_BANNER_ZONES_FLOWS,
    colours: ['sage', 'violet', 'rose'],
    contentDigest: '525fbb11a247b772e948ae10d6bad3c41e4de29be46821e5a210b8540c2e5e47',
    fullContentDigest: '525fbb11a247b772e948ae10d6bad3c41e4de29be46821e5a210b8540c2e5e47',
  },
  {
    file: 'mmo-progression.json',
    flows: MMO_PROGRESSION_FLOWS,
    colours: ['sage', 'gold', 'violet'],
    contentDigest: '947b2fc2319b3dd1692bb1fd41cde79432828a154a6175bd23502f58d525c539',
    fullContentDigest: '947b2fc2319b3dd1692bb1fd41cde79432828a154a6175bd23502f58d525c539',
  },
]

describe('the bundled Templates carry their flow colours', () => {
  for (const t of TEMPLATES) {
    describe(t.file, () => {
      const p = deserialize(read(t.file))
      const doc = { nodes: p.nodes, edges: p.edges, recommendedRunConfig: p.recommendedRunConfig, frames: p.frames, dataImports: p.dataImports }

      it('exactly the listed nodes, in their flow’s palette colour, as stored upper-case #RRGGBB', () => {
        const want = new Map<string, string>()
        for (const [id, ids] of Object.entries(t.flows)) for (const n of ids ?? []) want.set(n, HEX.get(id)!)
        const got = new Map(p.nodes.filter((n) => accentOf(n) !== undefined).map((n) => [n.id, accentOf(n)!]))
        expect(got).toEqual(want)
        expect(Object.keys(t.flows).sort()).toEqual([...t.colours].sort())
      })

      it('never on a Parameter or a Register', () => {
        expect(p.nodes.filter((n) => (n.data.kind === 'parameter' || n.data.kind === 'register') && accentOf(n) !== undefined)).toEqual([])
      })

      it('an edge is coloured exactly when it is a resource edge inside one flow', () => {
        const colourOf = new Map(p.nodes.map((n) => [n.id, accentOf(n)]))
        for (const e of p.edges) {
          const inside = e.data?.kind === 'resource' && colourOf.get(e.source) !== undefined && colourOf.get(e.source) === colourOf.get(e.target)
          expect(accentOf(e), e.id).toBe(inside ? colourOf.get(e.source) : undefined)
        }
      })

      it('the engine digest is the one recorded before the colours: the simulation is unchanged', async () => {
        const recorded = EXAMPLE_GRAPH_DIGESTS.find((g) => g.file === t.file)!
        expect(await semanticDigest({ nodes: p.nodes, edges: p.edges }, p.modelVersion)).toBe(recorded.semanticDigest)
      })

      it('the content and full-content digests change with the colours, pinned at their current values', async () => {
        const recorded = EXAMPLE_GRAPH_DIGESTS.find((g) => g.file === t.file)!
        const content = digestOfCanonical(canonicalContent(doc, { modelVersion: p.modelVersion }))
        const full = await fullContentDigest(doc, p.modelVersion)
        expect(content).toBe(t.contentDigest)
        expect(full).toBe(t.fullContentDigest)
        expect(content).not.toBe(recorded.contentDigest)
        expect(full).not.toBe(recorded.fullContentDigest)
      })
    })
  }
})
