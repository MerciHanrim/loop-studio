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

describe('the digests of real documents are unchanged', () => {
  for (const g of EXAMPLE_GRAPH_DIGESTS.filter((x) => x.graph)) {
    it(`examples/${g.file}: semantic, content and full-content digests`, async () => {
      const p = deserialize(read(g.file))
      const doc = { nodes: p.nodes, edges: p.edges, recommendedRunConfig: p.recommendedRunConfig, frames: p.frames, dataImports: p.dataImports }
      expect(p.modelVersion).toBe(g.modelVersion)
      expect(await semanticDigest({ nodes: p.nodes, edges: p.edges }, p.modelVersion)).toBe(g.semanticDigest)
      expect(digestOfCanonical(canonicalContent(doc, { modelVersion: p.modelVersion }))).toBe(g.contentDigest)
      expect(await fullContentDigest(doc, p.modelVersion)).toBe(g.fullContentDigest)
    })
  }

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
