import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canonicalContent,
  canonicalJson,
  digestOfCanonical,
  isModelLayerContent,
} from '../src/model/revision'

// loop-revision/2 golden vector — SEMANTICS-R2.md §R2-4 / §R2-13.
//
// G0 is a v1-content graph (no model layer). G1 = G0 + a parameter, a register,
// and a `Gold` resourceType on pool_gold + e_mint_gold. The oracle pins the
// canonical bytes + digest of G0 as produced by the SHIPPED loop-revision/1
// projection (captured before the v2 extension). The extended projection must:
//   - reproduce those bytes/digest for G0 exactly (R2-INV-2, conservative ext.);
//   - project every G0-shared element of G1 byte-identically;
//   - emit the new parameter/register/resourceType rows in the fixed order;
//   - collapse back to G0's digest when G1's model layer is stripped.
//
// Regenerate the oracle's g1Digest with:  UPDATE_ORACLE=1 npm test -- revision-v2-fixture

const url = (p: string) => new URL(`../examples/revision-v2/${p}`, import.meta.url)
const load = (p: string) => JSON.parse(readFileSync(url(p), 'utf8'))

const G0 = load('G0.json')
const G1 = load('G1.json')
const oracle = load('oracle.json')

const project = (g: { nodes: unknown[]; edges: unknown[]; recommendedRunConfig?: unknown }) =>
  canonicalContent({
    nodes: g.nodes as never,
    edges: g.edges as never,
    recommendedRunConfig: g.recommendedRunConfig as never,
  })

describe('loop-revision/2 golden vector', () => {
  it('the §R2-1 predicate classifies G0 as v1 and G1 as v2 content', () => {
    expect(isModelLayerContent(G0)).toBe(false)
    expect(isModelLayerContent(G1)).toBe(true)
  })

  it('G0: extended projection reproduces the shipped loop-revision/1 bytes and digest', () => {
    const c = project(G0)
    expect(canonicalJson(c)).toBe(oracle.loopRevision1.g0CanonicalJson)
    expect(digestOfCanonical(c)).toBe(oracle.loopRevision1.g0Digest)
  })

  it('G0 digest is byte-stable under key reordering and whitespace (R-INV-4)', () => {
    const shuffled = {
      recommendedRunConfig: G0.recommendedRunConfig,
      edges: [...G0.edges].reverse(),
      nodes: [...G0.nodes].reverse(),
    }
    expect(digestOfCanonical(project(shuffled))).toBe(oracle.loopRevision1.g0Digest)
  })

  it('G1: every G0-shared element projects byte-identically (except the two given a Gold tag)', () => {
    const c0 = project(G0)
    const c1 = project(G1)
    const pick = (arr: { id: string }[], id: string) => JSON.stringify(arr.find((x) => x.id === id))
    for (const n of c0.nodes) {
      if (n.id === 'pool_gold') continue // gains a trailing resourceType in G1
      expect(pick(c1.nodes, n.id)).toBe(JSON.stringify(n))
    }
    for (const e of c0.edges) {
      if (e.id === 'e_mint_gold') continue // gains a trailing resourceType in G1
      expect(pick(c1.edges, e.id)).toBe(JSON.stringify(e))
    }
  })

  it('G1: the new rows appear with the exact §R2-2 field order', () => {
    const c1 = project(G1)
    const param = c1.nodes.find((n) => n.id === 'param_price')!
    const reg = c1.nodes.find((n) => n.id === 'reg_profit')!
    expect(Object.keys(param.data)).toEqual(['kind', 'label', 'value', 'min', 'max', 'step', 'unit'])
    expect(Object.keys(reg.data)).toEqual(['kind', 'label', 'expr', 'unit', 'format'])
    expect(reg.data.expr).toBe('@param_price * @pool_gold - @pool_bank')
    const goldPool = c1.nodes.find((n) => n.id === 'pool_gold')!
    expect(Object.keys(goldPool.data)).toEqual([
      'kind', 'label', 'activation', 'initial', 'capacity', 'mode', 'resourceType',
    ])
    expect(goldPool.data.resourceType).toBe('Gold')
    const mintEdge = c1.edges.find((e) => e.id === 'e_mint_gold')!
    expect(Object.keys(mintEdge.data)).toEqual(['kind', 'flow', 'resourceType'])
  })

  it('G1 with the model layer stripped reproduces exactly G0’s digest (§R2-4)', () => {
    const stripped = {
      nodes: G1.nodes
        .filter((n: { data: { kind: string } }) => n.data.kind !== 'parameter' && n.data.kind !== 'register')
        .map((n: { data: Record<string, unknown> }) => ({
          ...n,
          data: Object.fromEntries(Object.entries(n.data).filter(([k]) => k !== 'resourceType')),
        })),
      edges: G1.edges.map((e: { data: Record<string, unknown> }) => ({
        ...e,
        data: Object.fromEntries(Object.entries(e.data).filter(([k]) => k !== 'resourceType')),
      })),
      recommendedRunConfig: G1.recommendedRunConfig,
    }
    expect(isModelLayerContent(stripped)).toBe(false)
    expect(digestOfCanonical(project(stripped))).toBe(oracle.loopRevision1.g0Digest)
  })

  it('G1 digest is stable (drift guard)', () => {
    const d = digestOfCanonical(project(G1))
    if (process.env.UPDATE_ORACLE) {
      oracle.loopRevision2.g1Digest = d
      writeFileSync(url('oracle.json'), `${JSON.stringify(oracle, null, 2)}\n`)
    }
    expect(oracle.loopRevision2.g1Digest).not.toBe('')
    expect(d).toBe(oracle.loopRevision2.g1Digest)
  })
})
