import { describe, expect, it } from 'vitest'
import { NODE_ICON_KINDS, readIcon } from './model'
import { canonicalContent, digestOfCanonical } from './revision'
import { deserialize } from './serialize'
import { semanticDigest } from './workspace'

// #478 (2026-11-04) — the bundled examples' node icons. An icon is a visual
// mark before a node's name with no simulation meaning (SEMANTICS-R12.md), put
// only where the meaning is plain: water, electricity, the sea and the city in
// the desalination process (a chemical tank carries none: a capsule reads as
// medicine), the MMO's Gold-denominated Pools and its Water / Food
// Pools, the factory's Recycler, the roastery's dessert line. Not inferred from
// names at run time; the verification fixtures, the generic Templates and the
// gacha tickets stay unmarked, and no sales Drain carries cash (it receives
// goods). This file pins every icon, and that the icons are the only change:
// without them each file has main's content digest, and with them its engine
// digest is the same.

const EXAMPLE_TEXT = import.meta.glob('../../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const GRAPHS = Object.entries(EXAMPLE_TEXT)
  .map(([path, text]) => [path.replace('../../examples/', ''), text] as const)
  .filter(([file]) => !file.endsWith('.expected.json'))

/** every icon of every bundled example, by file and node id */
const ICONS: Record<string, Record<string, string>> = {
  'coffee-roastery.json': { dessert_prep_src: 'food', dessert_stock: 'food' },
  'desalination.json': {
    sea: 'wave', outfall: 'wave', city: 'house', cake: 'water',
    basin: 'water', filtered: 'water', permeate: 'water', product: 'water', brine: 'water', backwash: 'water',
    gridA: 'electricity', gridB: 'electricity', gridC: 'electricity',
    panelA: 'electricity', panelB: 'electricity', panelC: 'electricity', recovered: 'electricity',
  },
  'mmo-progression.json': {
    gold: 'game-currency', gold_earned: 'game-currency', vendor_revenue: 'game-currency',
    repair_spend: 'game-currency', resupply_spend: 'game-currency', training_spend: 'game-currency',
    water: 'water', water_bought: 'water', water_consumed: 'water',
    food: 'food', food_bought: 'food', food_consumed: 'food',
  },
  'risky-factory.json': { recycler: 'recycling' },
}

/** the content digest of each file above with its icons taken off — main's file before #478 */
const WITHOUT_ICONS: Record<string, string> = {
  'coffee-roastery.json': '1bb29617ad5888570bdfd22c2db8c6faf268c04a8fdb15181880ff0a185b0545',
  'desalination.json': '5c125f0d02a2295383136fc6ab42240032f15aa6d53e95522fc33bbc82ddcfd6', // #471: the process example; #533: its chemical deliveries
  'mmo-progression.json': '41674ea763b2330552878d7bbe72c88c2794a12ad406e98a5a478e9a430ed983',
  'risky-factory.json': '76f4a6a98749fbd93bc3ec2c22d8b3d7aa990b1e905fb8064aa4c8c0d83e792b',
}

const strip = (text: string): string => {
  const doc = JSON.parse(text) as { nodes: { data?: Record<string, unknown> }[] }
  for (const n of doc.nodes) if (n.data) delete n.data.icon
  return JSON.stringify(doc)
}
const contentOf = (p: ReturnType<typeof deserialize>) =>
  digestOfCanonical(canonicalContent({ nodes: p.nodes, edges: p.edges, recommendedRunConfig: p.recommendedRunConfig, frames: p.frames, dataImports: p.dataImports }, { modelVersion: p.modelVersion }))

describe('the bundled examples carry node icons only where the meaning is plain (#478)', () => {
  it('reads all 14 bundled graphs', () => {
    expect(GRAPHS.length).toBe(14)
  })

  for (const [file, text] of GRAPHS) {
    it(`${file}: exactly the listed icons, as read`, () => {
      const p = deserialize(text)
      const got = Object.fromEntries(p.nodes.filter((n) => (n.data as { icon?: string }).icon !== undefined).map((n) => [n.id, (n.data as { icon?: string }).icon]))
      expect(got).toEqual(ICONS[file] ?? {})
      // the file's own text says the same (nothing dropped on read)
      const raw = JSON.parse(text) as { nodes: { id: string; data: { kind: string; icon?: unknown } }[] }
      for (const n of raw.nodes) {
        if (n.data.icon === undefined) continue
        expect(readIcon(n.data.icon), `${file} ${n.id}`).toBe(n.data.icon)
        expect(NODE_ICON_KINDS.has(n.data.kind), `${file} ${n.id} is a flow node`).toBe(true)
      }
    })
  }

  for (const file of Object.keys(ICONS)) {
    it(`${file}: the icons are the only change — the engine digest is the same with them, and without them the content is main's`, async () => {
      const text = EXAMPLE_TEXT['../../examples/' + file]!
      const p = deserialize(text)
      const bare = deserialize(strip(text))
      expect(await semanticDigest({ nodes: p.nodes, edges: p.edges }, p.modelVersion)).toBe(await semanticDigest({ nodes: bare.nodes, edges: bare.edges }, bare.modelVersion))
      expect(contentOf(bare)).toBe(WITHOUT_ICONS[file])
      expect(contentOf(p)).not.toBe(WITHOUT_ICONS[file])
    })
  }
})
