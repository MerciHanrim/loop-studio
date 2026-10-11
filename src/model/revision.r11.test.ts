// SEMANTICS-R11.md — the port faces (`data.ports`) in the revision layer.
import { describe, expect, it } from 'vitest'
import {
  REVISION_SEMANTICS,
  buildSelectiveApply,
  canonicalContent,
  canonicalJson,
  computeRevisionDiff,
  computeThreeWay,
  digestOfCanonical,
  fieldTag,
  readProject,
  readRevisionSide,
} from './revision'
import { canonicalPorts } from './ports'
import { normalizeGraph, serialize } from './serialize'
import { canonicalGraphString } from './workspace'
import type { LoopEdge, LoopNode } from './types'

const nodes: LoopNode[] = [
  { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  { id: 'b', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
  { id: 'g', type: 'gate', position: { x: 100, y: 200 }, data: { kind: 'gate', label: 'G', activation: 'automatic', distribution: 'deterministic' } },
] as LoopNode[]
const plain: LoopEdge = { id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1', route: 'orthogonal' } } as LoopEdge
const faced: LoopEdge = { ...plain, data: { ...plain.data, ports: { source: 'bottom', target: 'top' } } } as LoopEdge
const stateEdge: LoopEdge = { id: 's', source: 'a', target: 'g', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'activator', expr: '>= 1' } } as LoopEdge
const graph = (...edges: LoopEdge[]) => ({ nodes, edges })
const side = (...edges: LoopEdge[]) => readRevisionSide({ nodes, edges, rawDataImportSignal: false } as never)

describe('R11-1 — version inference', () => {
  it('a side with a surviving non-default face is loop-revision/11; without one it is what it was', () => {
    const f = side(faced)
    expect(f.ok && f.version).toBe('loop-revision/11')
    const p = side(plain)
    expect(p.ok && p.version).toBe('loop-revision/3')
    // an explicit DEFAULT face carries nothing: not /11
    const def = side({ ...plain, data: { ...plain.data, ports: { source: 'right', target: 'left' } } } as LoopEdge)
    expect(def.ok && def.version).toBe('loop-revision/3')
    // an invalid face is dropped by the reader: not /11
    const bad = side({ ...plain, data: { ...plain.data, ports: { source: 'sideways' } } } as unknown as LoopEdge)
    expect(bad.ok && bad.version).toBe('loop-revision/3')
  })
  it('takes precedence over /10 (straight) and /9 (accent)', () => {
    const both = side({ ...faced, data: { ...faced.data, route: 'straight', accent: '#AA0000' } } as unknown as LoopEdge)
    expect(both.ok && both.version).toBe('loop-revision/11')
  })
  it('the header this build writes declares /11', () => {
    expect(REVISION_SEMANTICS).toBe('loop-revision/11')
  })
})

describe('R11-1.1 — the canonical stored form', () => {
  it('keeps only valid faces that differ from the kind’s default (resource: right → left; state: bottom → top)', () => {
    expect(canonicalPorts('resource', { source: 'right', target: 'left' })).toBeUndefined()
    expect(canonicalPorts('resource', { source: 'bottom', target: 'left' })).toEqual({ source: 'bottom' })
    expect(canonicalPorts('state', { source: 'bottom', target: 'top' })).toBeUndefined()
    expect(canonicalPorts('state', { source: 'right', target: 'top' })).toEqual({ source: 'right' })
    expect(canonicalPorts('resource', { source: 'up' })).toBeUndefined()
    expect(canonicalPorts('resource', null)).toBeUndefined()
  })
  it('the normaliser applies it: an explicit default face normalises away, so two documents that draw alike store alike', () => {
    const explicit = { ...plain, data: { ...plain.data, ports: { source: 'right', target: 'left' } } } as LoopEdge
    const a = serialize(nodes, [plain])
    const b = serialize(normalizeGraph(graph(explicit)).nodes, normalizeGraph(graph(explicit)).edges)
    expect(b).toBe(a)
    expect(b).not.toContain('ports')
    const st = normalizeGraph(graph({ ...stateEdge, data: { ...stateEdge.data, ports: { source: 'bottom', target: 'right' } } } as LoopEdge))
    expect((st.edges[0].data as { ports?: unknown }).ports).toEqual({ target: 'right' })
  })
})

describe('R11-2 / R11-4 — projection, digests and invariants', () => {
  // This pins the canonical-form rule under THIS code (no face ≡ explicit default
  // face). That the faceless projection equals the HISTORICAL /10 one is pinned
  // elsewhere: the pre-/11 content digests in templateFlowColours.test.ts, the
  // unchanged contentDigest values of examples/revision/* (revision-fixture.test),
  // the v0.10.0 legacy files, and the measured v0.25.0 exchange — SEMANTICS-R11.md §R11-4.
  it('INV-1 under this code: an explicit default face projects and digests exactly like no face', () => {
    const explicit = { ...plain, data: { ...plain.data, ports: { source: 'right', target: 'left' } } } as LoopEdge
    const a = canonicalJson(canonicalContent(graph(plain)))
    const b = canonicalJson(canonicalContent(graph(explicit)))
    expect(b).toBe(a)
    expect(a).not.toContain('ports')
    expect(digestOfCanonical(canonicalContent(graph(explicit)))).toBe(digestOfCanonical(canonicalContent(graph(plain))))
  })
  it('INV-2: the engine digest never sees a face; the revision digest does', () => {
    expect(canonicalGraphString(graph(faced))).toBe(canonicalGraphString(graph(plain)))
    expect(digestOfCanonical(canonicalContent(graph(faced)))).not.toBe(digestOfCanonical(canonicalContent(graph(plain))))
  })
  it('the projection emits the canonical form only, trailing, source before target, and never under the literal /1 projection', () => {
    const j = canonicalJson(canonicalContent(graph({ ...plain, data: { ...plain.data, ports: { target: 'top', source: 'bottom' } } } as LoopEdge)))
    expect(j).toContain('"ports":{"source":"bottom","target":"top"}')
    expect(j.indexOf('"ports"')).toBeGreaterThan(j.indexOf('"route"'))
    expect(JSON.stringify(canonicalContent(graph(faced), { modelLayer: false }))).not.toContain('ports')
  })
})

describe('R11-3 — field tag, diff and Apply', () => {
  it('a face change is a cosmetic hunk: diffed, never engine-affecting', () => {
    expect(fieldTag('edge', 'data.ports')).toBe('cosmetic')
    const d = computeRevisionDiff(canonicalContent(graph(plain)), canonicalContent(graph(faced)))
    const e = d.edges.changed.find((c) => c.id === 'e')
    expect(e, 'the edge shows as changed').toBeTruthy()
    expect(e!.fields.map((f) => f.field)).toEqual(['data.ports'])
    expect(e!.fields[0].tag).toBe('cosmetic')
    expect(d.summary.engineAffecting).toBe(false)
  })
  it('a selective Apply that takes the FACELESS side removes the stored faces; taking the faced side adds them', () => {
    const run = (target: { nodes: LoopNode[]; edges: LoopEdge[] }, proposed: { nodes: LoopNode[]; edges: LoopEdge[] }) => {
      const plan = computeThreeWay(canonicalContent(target), canonicalContent(target), canonicalContent(proposed))
      const hunk = plan.hunks.find((h) => h.id === 'e' && h.kind === 'change')!
      expect(hunk.fields!.map((f) => f.field)).toEqual(['data.ports'])
      const fieldChoices = Object.fromEntries(hunk.fields!.map((f) => [f.field, 'proposed' as const]))
      const applied = buildSelectiveApply({ target, proposedFull: proposed, plan, selection: { accept: {}, fieldChoices: { e: fieldChoices } } })
      expect(applied.ok).toBe(true)
      if (!applied.ok) throw new Error('apply failed')
      return applied.edges.find((x) => x.id === 'e')!
    }
    // a faced target takes the faceless proposal: the key is REMOVED, not left as the target had it
    const e1 = run(graph(faced), graph(plain))
    expect('ports' in (e1.data as object)).toBe(false)
    // a faceless target takes the faced proposal: the faces arrive
    const e2 = run(graph(plain), graph(faced))
    expect((e2.data as { ports?: unknown }).ports).toEqual({ source: 'bottom', target: 'top' })
  })
})

describe('R11-6 — a header that declares a newer format', () => {
  const header = (semantics: string | undefined, contentDigest: string) => ({
    schema: 'loop-revision/1',
    version: 1,
    projectId: 'proj_00000000000000000000000000',
    revisionId: 'rev_00000000000000000000000000',
    parentId: null,
    role: 'revision',
    contentDigest,
    lineage: [],
    ...(semantics ? { semantics } : {}),
  })
  const content = canonicalContent(graph(plain))
  const good = digestOfCanonical(content)
  const wrong = good.replace(/^./, (c) => (c === '0' ? '1' : '0'))
  it('a digest that fails under a header newer than this reader is reported as a newer-version file, not as outside editing', () => {
    const r = readProject(header('loop-revision/12', wrong), content)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('newer-semantics')
      expect(r.warning).toMatch(/newer version of Loop Studio/)
      expect(r.warning).not.toMatch(/edited outside/)
    }
  })
  it('a digest that fails under this reader’s own or an older header keeps the outside-editing wording', () => {
    for (const s of ['loop-revision/11', 'loop-revision/9', undefined]) {
      const r = readProject(header(s, wrong), content)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('digest-mismatch')
    }
  })
  it('a newer declaration alone refuses nothing: a verifiable file is accepted', () => {
    const r = readProject(header('loop-revision/12', good), content)
    expect(r.ok, 'the declaration does not gate a file whose digest verifies').toBe(true)
  })
})
