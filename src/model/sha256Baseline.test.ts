import { afterEach, describe, expect, it, vi } from 'vitest'
import { deserialize } from './serialize'
import { canonicalContent, digestOfCanonical, fullContentDigest, readRevisionSideAndProject } from './revision'
import { semanticDigest, sha256Hex, sha256Js } from './workspace'
import {
  EXAMPLE_GRAPH_DIGESTS,
  EXAMPLE_REVISION_READS,
  SHA256_PUBLISHED,
  SHA256_VECTORS,
  baselineBytes,
} from './sha256Baseline.fixture'

// Issue #301 - the hand-written SHA-256 was replaced by `@noble/hashes`. The
// fixture holds what the replaced code computed on main 44af9a4, recorded
// before the change: hash vectors, the digests of every example diagram, and
// what the import layer's reader made of every example revision and proposal
// file. The replacement must give the same bytes for all of it, because those
// digests are stored in people's workspace, revision and proposal files.

// the example files' exact text, the way an import reads them
const EXAMPLE_TEXT = import.meta.glob('../../examples/**/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (rel: string): string => {
  const text = EXAMPLE_TEXT['../../examples/' + rel]
  if (text === undefined) throw new Error('missing example ' + rel)
  return text
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SHA-256 after the replacement, against what the replaced code computed', () => {
  it('has the vectors it is meant to have', () => {
    expect(SHA256_VECTORS).toHaveLength(205)
    expect(SHA256_PUBLISHED).toHaveLength(4)
    expect(EXAMPLE_GRAPH_DIGESTS.filter((g) => g.graph)).toHaveLength(12)
    expect(EXAMPLE_REVISION_READS).toHaveLength(8)
  })

  it('every hash vector, lengths 0 to 200 and up to 1 MiB, is byte-identical', () => {
    for (const v of SHA256_VECTORS) expect(sha256Js(baselineBytes(v.len, v.seed)), `length ${v.len}`).toBe(v.hex)
  })

  it('the published vectors still hold', () => {
    const text = (t: string) => (t.startsWith("'a' x ") ? 'a'.repeat(Number(t.slice(6))) : t)
    for (const p of SHA256_PUBLISHED) expect(sha256Js(new TextEncoder().encode(text(p.text)))).toBe(p.hex)
  })

  it('Web Crypto and the synchronous path agree', async () => {
    for (const v of SHA256_VECTORS.filter((x) => x.len % 17 === 0 || x.len > 200)) {
      expect(await sha256Hex(baselineBytes(v.len, v.seed)), `length ${v.len}`).toBe(v.hex)
    }
  })

  it('without Web Crypto, sha256Hex takes the synchronous path and gives the same bytes', async () => {
    vi.stubGlobal('crypto', {})
    for (const v of SHA256_VECTORS.filter((x) => x.len % 23 === 0)) {
      expect(await sha256Hex(baselineBytes(v.len, v.seed)), `length ${v.len}`).toBe(v.hex)
    }
  })
})

// #325 PR 2 - these three Templates gained flow colours after the baseline was
// recorded (docs/flow-colour-and-compact-nodes.md FC-6). A colour is cosmetic:
// their engine digest still equals the recorded one, while their content and
// full-content digests change, as they must, and are pinned at their current
// values in src/engine/templateFlowColours.test.ts. The recorded #301 values
// are kept, checked only by the explicit legacy test below.
const COLOURED_SINCE = new Set(['coffee-roastery.json', 'gacha-banner-zones.json', 'mmo-progression.json'])

// #325 PR 3 (compact nodes) - one more cosmetic addition since the baseline: the
// gacha Template's layout round 7 gave `e_pickup_36` one routing waypoint
// (scripts/gen-gacha-banner-zones-example.ts) so its `+1` label no longer meets
// `e_pickup_34`'s on the shorter nodes. Routing is never engine data, so the
// engine digest still matches; the legacy projection removes exactly this one
// waypoint, and fails if it is not exactly what PR 3 added.
const ADDED_WAYPOINTS: Record<string, Record<string, unknown>> = {
  'gacha-banner-zones.json': { e_pickup_36: [{ x: 3200, y: 650 }] },
}

/** a document's text without what was added after the #301 baseline: the flow
 *  colours (PR 2) and the one PR 3 waypoint - the file as it was recorded */
const legacyProjection = (file: string, text: string): string => {
  const doc = JSON.parse(text) as { nodes: { data: Record<string, unknown> }[]; edges: { id: string; data?: Record<string, unknown> }[] }
  for (const el of [...doc.nodes, ...doc.edges]) if (el.data) delete el.data.accent
  for (const [edgeId, added] of Object.entries(ADDED_WAYPOINTS[file] ?? {})) {
    const edge = doc.edges.find((e) => e.id === edgeId)
    expect(edge?.data?.waypoints, `${file} ${edgeId}: the waypoint PR 3 added`).toEqual(added)
    delete edge!.data!.waypoints
  }
  return JSON.stringify(doc)
}

const docOf = (p: ReturnType<typeof deserialize>) => ({
  nodes: p.nodes,
  edges: p.edges,
  recommendedRunConfig: p.recommendedRunConfig,
  frames: p.frames,
  dataImports: p.dataImports,
})

describe('the digests of real documents are unchanged', () => {
  for (const g of EXAMPLE_GRAPH_DIGESTS.filter((x) => x.graph)) {
    if (COLOURED_SINCE.has(g.file)) {
      it(`examples/${g.file}: the semantic digest (a flow colour is not a model change)`, async () => {
        const p = deserialize(read(g.file))
        expect(p.modelVersion).toBe(g.modelVersion)
        expect(await semanticDigest({ nodes: p.nodes, edges: p.edges }, p.modelVersion)).toBe(g.semanticDigest)
        expect(digestOfCanonical(canonicalContent(docOf(p), { modelVersion: p.modelVersion }))).not.toBe(g.contentDigest)
        expect(await fullContentDigest(docOf(p), p.modelVersion)).not.toBe(g.fullContentDigest)
      })
      continue
    }
    it(`examples/${g.file}: semantic, content and full-content digests`, async () => {
      const p = deserialize(read(g.file))
      const doc = docOf(p)
      expect(p.modelVersion).toBe(g.modelVersion)
      expect(await semanticDigest({ nodes: p.nodes, edges: p.edges }, p.modelVersion)).toBe(g.semanticDigest)
      expect(digestOfCanonical(canonicalContent(doc, { modelVersion: p.modelVersion }))).toBe(g.contentDigest)
      expect(await fullContentDigest(doc, p.modelVersion)).toBe(g.fullContentDigest)
    })
  }

  it('legacy (#301 baseline): the three coloured Templates without their flow colours (PR 2) and the gacha e_pickup_36 waypoint (PR 3) give the recorded digests', async () => {
    const legacy = EXAMPLE_GRAPH_DIGESTS.filter((g) => COLOURED_SINCE.has(g.file))
    expect(legacy.map((g) => g.file).sort()).toEqual([...COLOURED_SINCE].sort())
    for (const g of legacy) {
      const p = deserialize(legacyProjection(g.file, read(g.file)))
      const doc = docOf(p)
      expect(p.modelVersion, g.file).toBe(g.modelVersion)
      expect(await semanticDigest({ nodes: p.nodes, edges: p.edges }, p.modelVersion), g.file).toBe(g.semanticDigest)
      expect(digestOfCanonical(canonicalContent(doc, { modelVersion: p.modelVersion })), g.file).toBe(g.contentDigest)
      expect(await fullContentDigest(doc, p.modelVersion), g.file).toBe(g.fullContentDigest)
    }
  })

  for (const r of EXAMPLE_REVISION_READS) {
    it(`examples/${String(r.file)}: the import reader gives the same outcome`, () => {
      const text = read(String(r.file))
      const obj = JSON.parse(text) as { project: { contentDigest?: string; base?: { contentDigest?: string } } }
      const p = deserialize(text)
      const out = readRevisionSideAndProject(
        { nodes: p.nodes, edges: p.edges, recommendedRunConfig: p.recommendedRunConfig, frames: p.frames, dataImports: p.dataImports, rawDataImportSignal: p.hasRawDataImportSignal },
        obj.project,
        p.modelVersion,
      )
      const row: Record<string, unknown> = {
        file: r.file,
        ok: out.ok,
        stage: out.ok ? null : ((out as { stage?: string }).stage ?? null),
        storedContentDigest: obj.project.contentDigest ?? null,
        storedBaseDigest: obj.project.base?.contentDigest ?? null,
      }
      if (out.ok) {
        row.sideDigest = digestOfCanonical(out.side.content)
        row.projectContentDigest = out.project.contentDigest ?? null
        row.proposalBaseDigest = out.proposalBase?.contentDigest ?? null
        row.sideMatchesStored = row.sideDigest === row.storedContentDigest
      }
      expect(row).toEqual(r)
    })
  }
})
