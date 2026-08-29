import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import {
  AUTHOR_NAME_MAX_BYTES,
  InvalidRevisionContentError,
  PROJECT_SCHEMA,
  PROJECT_VERSION,
  REVISION_ID_RE,
  SecureRandomUnavailableError,
  canonicalContent,
  canonicalJson,
  computeRevisionDiff,
  digestOfCanonical,
  fullContentDigest,
  isProjectId,
  isRevisionId,
  mintId,
  planProposalExport,
  planRevisionExport,
  readProject,
  truncBytes,
} from './revision'

// ── graph builders ─────────────────────────────────────────────────────────

const pool = (id: string, over: Partial<LoopNode['data']> = {}, pos = { x: 0, y: 0 }): LoopNode =>
  ({
    id,
    type: 'pool',
    position: pos,
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...over },
  }) as LoopNode

const gate = (id: string, over: Partial<LoopNode['data']> = {}): LoopNode =>
  ({
    id,
    type: 'gate',
    position: { x: 10, y: 10 },
    data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', ...over },
  }) as LoopNode

const rEdge = (id: string, s: string, t: string, flow = '1'): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

const doc = (nodes: LoopNode[], edges: LoopEdge[] = [], recommendedRunConfig?: unknown) =>
  ({ nodes, edges, ...(recommendedRunConfig ? { recommendedRunConfig } : {}) }) as {
    nodes: LoopNode[]
    edges: LoopEdge[]
    recommendedRunConfig?: never
  }

const FAKE_PROJ = 'proj_ABCDEFGHJKMNPQRSTVWXYZ0123'
const FAKE_REV = 'rev_ABCDEFGHJKMNPQRSTVWXYZ0123'
const FAKE_REV_2 = 'rev_0123456789ABCDEFGHJKMNPQRS'
let idc = 0
// a deterministic mint for tests — exactly 26 Crockford chars after the prefix
const seqMint = (p: 'rev') => `${p}_${String(idc++).padStart(26, '0')}` as string

afterEach(() => vi.unstubAllGlobals())

// ── id validation & secure mint ────────────────────────────────────────────

describe('id format & mint (§R11 / R14.17)', () => {
  it('validators accept the frozen shape and reject everything else', () => {
    expect(isProjectId(FAKE_PROJ)).toBe(true)
    expect(isRevisionId(FAKE_REV)).toBe(true)
    expect(isRevisionId('rev_' + 'A'.repeat(25))).toBe(false) // too short
    expect(isRevisionId('rev_' + 'A'.repeat(27))).toBe(false) // too long
    expect(isRevisionId('rev_ABCDEFGHIJKLMNPQRSTVWXYZ0')).toBe(false) // I,L
    expect(isRevisionId('rev_abcdefghjkmnpqrstvwxyz012')).toBe(false) // lowercase
    expect(isProjectId('rev_ABCDEFGHJKMNPQRSTVWXYZ0123')).toBe(false) // wrong prefix
    expect(isRevisionId(42)).toBe(false)
  })

  it('mintId produces a valid, unique id from secure RNG', () => {
    const a = mintId('rev')
    const b = mintId('rev')
    expect(REVISION_ID_RE.test(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(mintId('proj').startsWith('proj_')).toBe(true)
  })

  it('mintId THROWS when crypto.getRandomValues is unavailable — never Math.random', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => mintId('rev')).toThrow(SecureRandomUnavailableError)
    vi.stubGlobal('crypto', { getRandomValues: () => { throw new Error('blocked') } })
    expect(() => mintId('rev')).toThrow(SecureRandomUnavailableError)
  })
})

// ── canonical projection & digest ──────────────────────────────────────────

describe('canonical content & digest (§R4 / R14.3)', () => {
  it('is invariant to node/edge order, key order, capacity null-vs-omitted, whitespace', async () => {
    const a = doc(
      [pool('p2', { capacity: null }), pool('p1', { capacity: 5 })],
      [rEdge('e1', 'p1', 'p2')],
    )
    // b: reversed arrays; p1 omits capacity (=> normalises to null); a stray render field
    const bNodes: LoopNode[] = [
      { id: 'p1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'p1', activation: 'passive', initial: 0, capacity: 5, mode: 'pullAny' }, selected: true } as unknown as LoopNode,
      { id: 'p2', type: 'pool', position: { x: 0, y: 0 }, data: { label: 'p2', kind: 'pool', mode: 'pullAny', activation: 'passive', initial: 0 } } as unknown as LoopNode,
    ]
    const b = doc(bNodes, [rEdge('e1', 'p1', 'p2')])

    expect(await fullContentDigest(a)).toBe(await fullContentDigest(b))
    expect(computeRevisionDiff(canonicalContent(a), canonicalContent(b)).summary.empty).toBe(true)
  })

  it('a sub-pixel move changes the digest and shows one cosmetic position hunk (§R4 no rounding)', async () => {
    const base = doc([pool('p1', {}, { x: 100, y: 40 })])
    const moved = doc([pool('p1', {}, { x: 100.4, y: 40 })])
    expect(await fullContentDigest(base)).not.toBe(await fullContentDigest(moved))
    const d = computeRevisionDiff(canonicalContent(base), canonicalContent(moved))
    expect(d.summary.nodes.changed).toBe(1)
    const fields = d.nodes.changed[0].fields
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ field: 'position', tag: 'cosmetic' })
    expect(d.summary.engineAffecting).toBe(false)
  })

  it('tags label & position cosmetic, engine fields engine (§R5.2 / R14.4)', () => {
    const base = doc([pool('p1', { label: 'Old' }, { x: 0, y: 0 }), gate('g1', { distribution: 'deterministic' })])
    const proposed = doc([pool('p1', { label: 'New' }, { x: 50, y: 0 }), gate('g1', { distribution: 'probabilistic' })])
    const d = computeRevisionDiff(canonicalContent(base), canonicalContent(proposed))
    const p1 = d.nodes.changed.find((c) => c.id === 'p1')!
    expect(p1.fields.find((f) => f.field === 'position')?.tag).toBe('cosmetic')
    expect(p1.fields.find((f) => f.field === 'data.label')?.tag).toBe('cosmetic')
    const g1 = d.nodes.changed.find((c) => c.id === 'g1')!
    expect(g1.fields.find((f) => f.field === 'data.distribution')?.tag).toBe('engine')
    expect(d.summary.engineAffecting).toBe(true)
  })

  it('throws InvalidRevisionContentError on a non-finite number (§R4.1)', () => {
    const bad = doc([pool('p1', {}, { x: Number.NaN, y: 0 })])
    expect(() => canonicalContent(bad)).toThrow(InvalidRevisionContentError)
    const bad2 = doc([pool('p2', { initial: Infinity })])
    expect(() => canonicalContent(bad2)).toThrow(InvalidRevisionContentError)
  })

  it('digestOfCanonical (pure-JS) === fullContentDigest (Web Crypto) — the file:// fallback path (R14.20)', async () => {
    const g = doc([pool('p1', { capacity: 12 }), gate('g1')], [rEdge('e1', 'p1', 'g1', '2D6')])
    expect(digestOfCanonical(canonicalContent(g))).toBe(await fullContentDigest(g))
  })

  it('recommendedRunConfig is normalised into the projection and diffed per key', () => {
    const a = doc([pool('p1')], [], { baseSeed: 1, runs: 200, steps: 30, tracked: ['p1'] })
    const b = doc([pool('p1')], [], { baseSeed: 1, runs: 500, steps: 30, tracked: ['p1'] })
    const d = computeRevisionDiff(canonicalContent(a), canonicalContent(b))
    expect(d.runConfig).toEqual([{ kind: 'changed', key: 'runs', base: 200, proposed: 500 }])
    expect(d.summary.runConfigChanged).toBe(true)
  })
})

// ── deterministic diff ─────────────────────────────────────────────────────

describe('computeRevisionDiff determinism (§R5 / R14.19)', () => {
  it('shuffling arrays does not change the diff', () => {
    const base = doc([pool('a'), pool('b'), pool('c')], [rEdge('e1', 'a', 'b'), rEdge('e2', 'b', 'c')])
    const proposed = doc([pool('c'), pool('a', { initial: 9 }), pool('d')], [rEdge('e2', 'b', 'c'), rEdge('e1', 'a', 'b', '3')])
    const d1 = computeRevisionDiff(canonicalContent(base), canonicalContent(proposed))
    // reverse both arrays
    const base2 = doc([...base.nodes].reverse(), [...base.edges].reverse())
    const proposed2 = doc([...proposed.nodes].reverse(), [...proposed.edges].reverse())
    const d2 = computeRevisionDiff(canonicalContent(base2), canonicalContent(proposed2))
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2))
    expect(d1.summary).toMatchObject({
      nodes: { added: 1, removed: 1, changed: 1 }, // +d, -b, ~a
      edges: { added: 0, removed: 0, changed: 1 }, // ~e1 flow
    })
  })
})

// ── defensive project reader ───────────────────────────────────────────────

describe('readProject (§R10 / R14.14 / R14.15)', () => {
  const okRevision = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    projectId: FAKE_PROJ,
    revisionId: FAKE_REV,
    parentId: null,
    role: 'revision',
    meta: { title: 'x', author: { name: 'Alex' } },
  }

  it('accepts a strictly-valid revision payload', () => {
    const r = readProject(okRevision)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.project.projectId).toBe(FAKE_PROJ)
      expect(r.project.role).toBe('revision')
      expect(r.proposalBase).toBeUndefined()
    }
  })

  it('drops (never throws) on wrong schema / version', () => {
    expect(readProject({ ...okRevision, version: 2 }).ok).toBe(false)
    expect(readProject({ ...okRevision, version: '1' }).ok).toBe(false)
    expect(readProject({ ...okRevision, schema: 'loop-revision/2' }).ok).toBe(false)
  })

  it('drops on malformed ids / parent', () => {
    expect(readProject({ ...okRevision, projectId: 'proj_short' }).ok).toBe(false)
    expect(readProject({ ...okRevision, revisionId: 123 }).ok).toBe(false)
    expect(readProject({ ...okRevision, parentId: 'nope' }).ok).toBe(false)
  })

  it('a proposal needs a base whose digest matches its content (R-INV-6)', () => {
    const content = canonicalContent(doc([pool('p1')]))
    const good = {
      ...okRevision,
      revisionId: FAKE_REV_2,
      role: 'proposal',
      base: { revisionId: FAKE_REV, contentDigest: digestOfCanonical(content), content },
    }
    const r = readProject(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalBase?.revisionId).toBe(FAKE_REV)

    expect(readProject({ ...good, base: undefined }).ok).toBe(false)
    expect(readProject({ ...good, base: { ...good.base, contentDigest: 'a'.repeat(64) } }).ok).toBe(false)
  })

  it('truncates author name / note to their byte caps', () => {
    const long = 'x'.repeat(200)
    const r = readProject({ ...okRevision, meta: { author: { name: long } } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(new TextEncoder().encode(r.project.meta!.author!.name!).length).toBeLessThanOrEqual(AUTHOR_NAME_MAX_BYTES)
  })
})

// ── pure export planners ───────────────────────────────────────────────────

describe('planRevisionExport (§R2.1 / R2.2 / R14.2 / R14.16)', () => {
  const g = doc([pool('p1', { initial: 3 }), pool('p2')], [rEdge('e1', 'p1', 'p2')])
  const project = { projectId: FAKE_PROJ, revisionId: FAKE_REV, parentId: null as string | null, lineage: [] as string[] }
  const meta = { createdAt: '2026-01-01T00:00:00Z', title: 'T' }

  it('not dirty ⇒ keeps the revisionId + parentId; byte-identical re-export (R14.2 / R2.2)', () => {
    const p1 = planRevisionExport({ doc: g, project, dirty: false, meta, now: '2026-09-09T00:00:00Z', mint: seqMint })
    const p2 = planRevisionExport({ doc: g, project, dirty: false, meta, now: '2026-12-31T23:59:59Z', mint: seqMint })
    expect(p1.ok && p2.ok).toBe(true)
    if (p1.ok && p2.ok) {
      expect(p1.pendingHeader.revisionId).toBe(FAKE_REV)
      expect(p1.pendingHeader.parentId).toBeNull()
      expect(p1.text).toBe(p2.text) // `now` is irrelevant on the not-dirty path
      const file = JSON.parse(p1.text)
      expect(file.project).toMatchObject({ schema: PROJECT_SCHEMA, version: 1, revisionId: FAKE_REV, role: 'revision' })
      expect(file.project.meta.createdAt).toBe('2026-01-01T00:00:00Z') // verbatim
      expect(file.schema).toBe('loop-studio/graph') // still a valid Graph file (R-INV-1)
    }
  })

  it('dirty ⇒ mints a new revisionId, parentId = old, createdAt = now, lineage grows', () => {
    const p = planRevisionExport({ doc: g, project, dirty: true, meta, now: '2026-09-09T00:00:00Z', mint: seqMint })
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.pendingHeader.revisionId).toMatch(/^rev_0+[0-9]$/)
      expect(p.pendingHeader.revisionId).not.toBe(FAKE_REV)
      expect(p.pendingHeader.parentId).toBe(FAKE_REV)
      expect(p.pendingHeader.lineage).toEqual([FAKE_REV])
      expect(JSON.parse(p.text).project.meta.createdAt).toBe('2026-09-09T00:00:00Z')
      // baselineDigest is the digest of what was written
      expect(p.pendingHeader.baselineDigest).toBe(digestOfCanonical(canonicalContent(g)))
    }
  })

  it('dirty + secure-RNG failure ⇒ the planner throws, nothing is produced (R-INV-12)', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() =>
      planRevisionExport({ doc: g, project, dirty: true, meta, now: 'now' }),
    ).toThrow(SecureRandomUnavailableError)
  })

  it('over the byte cap ⇒ { ok: false, reason: "too-large" } — no text (R14.16)', () => {
    const p = planRevisionExport({ doc: g, project, dirty: false, meta, now: 'now', mint: seqMint, maxBytes: 50 })
    expect(p).toMatchObject({ ok: false, reason: 'too-large', cap: 50 })
    expect((p as { text?: string }).text).toBeUndefined()
  })
})

describe('planProposalExport (§R6 / R14.5)', () => {
  const g = doc([pool('p1', { capacity: 7 }), gate('g1')], [rEdge('e1', 'p1', 'g1')])
  const project = { projectId: FAKE_PROJ, revisionId: FAKE_REV, lineage: [] as string[] }

  it('DIRTY origin ⇒ { ok:false, reason:"dirty-origin" } — no id, no file (review round 2)', () => {
    const p = planProposalExport({ doc: g, project, dirty: true, meta: {}, now: 'n', mint: seqMint })
    expect(p).toEqual({ ok: false, reason: 'dirty-origin' })
    expect((p as { text?: string }).text).toBeUndefined()
    // and no id was consumed
    const before = idc
    planProposalExport({ doc: g, project, dirty: true, meta: {}, now: 'n', mint: seqMint })
    expect(idc).toBe(before)
  })

  it('carries a complete, self-consistent base.content and round-trips through readProject', () => {
    const p = planProposalExport({ doc: g, project, dirty: false, meta: {}, now: '2026-09-09T00:00:00Z', mint: seqMint })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const file = JSON.parse(p.text)
    expect(file.project.role).toBe('proposal')
    expect(file.project.parentId).toBe(FAKE_REV)
    expect(file.project.base.revisionId).toBe(FAKE_REV)
    // R-INV-6 + the §R10 header integrity digest of the proposed content
    const proposed = canonicalContent({ nodes: file.nodes, edges: file.edges })
    expect(file.project.contentDigest).toBe(digestOfCanonical(proposed))
    const rp = readProject(file.project, proposed)
    expect(rp.ok).toBe(true)
    if (rp.ok) {
      expect(computeRevisionDiff(rp.proposalBase!.content, proposed).summary.empty).toBe(true)
    }
  })

  it('an edit to the proposed graph shows up as a diff against the carried base', () => {
    const p = planProposalExport({ doc: g, project, dirty: false, meta: {}, now: 'n', mint: seqMint })
    if (!p.ok) throw new Error('plan failed')
    const file = JSON.parse(p.text)
    file.nodes[0].data.capacity = 99 // author edits the proposed graph
    // readProject WITHOUT the graph still parses the header (base check only)
    const rp = readProject(file.project)
    if (!rp.ok) throw new Error('read failed')
    const d = computeRevisionDiff(rp.proposalBase!.content, canonicalContent({ nodes: file.nodes, edges: file.edges }))
    expect(d.summary.nodes.changed).toBe(1)
    expect(d.nodes.changed[0].fields[0]).toMatchObject({ field: 'data.capacity', base: 7, proposed: 99, tag: 'engine' })
  })
})

// ── header content-digest cross-check (§R10 / review round 2) ───────────────

describe('readProject header integrity digest', () => {
  const g = doc([pool('p1', { initial: 4 }), pool('p2')], [rEdge('e1', 'p1', 'p2', '2')])
  const project = { projectId: FAKE_PROJ, revisionId: FAKE_REV, parentId: null as string | null, lineage: [] as string[] }

  it('a revision file whose graph was edited but header left stale ⇒ project dropped, graph still opens', () => {
    const p = planRevisionExport({ doc: g, project, dirty: false, meta: {}, now: 'n', mint: seqMint })
    if (!p.ok) throw new Error('plan')
    const file = JSON.parse(p.text)
    // tamper: edit the graph, leave project.contentDigest as-is
    file.nodes[0].data.initial = 999
    const loaded = canonicalContent({ nodes: file.nodes, edges: file.edges })
    const r = readProject(file.project, loaded)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.warning).toMatch(/does not match its graph/i)
    // untouched file passes
    const clean = readProject(JSON.parse(p.text).project, canonicalContent(g))
    expect(clean.ok).toBe(true)
  })

  it('a proposal file whose proposed graph was edited but header left stale ⇒ dropped', () => {
    const p = planProposalExport({ doc: g, project: { ...project }, dirty: false, meta: {}, now: 'n', mint: seqMint })
    if (!p.ok) throw new Error('plan')
    const file = JSON.parse(p.text)
    file.edges[0].data.flow = '9' // tamper the proposed content
    const loaded = canonicalContent({ nodes: file.nodes, edges: file.edges })
    expect(readProject(file.project, loaded).ok).toBe(false)
  })

  it('no cross-check when the loaded graph is not supplied (header shape only)', () => {
    const p = planRevisionExport({ doc: g, project, dirty: false, meta: {}, now: 'n', mint: seqMint })
    if (!p.ok) throw new Error('plan')
    const file = JSON.parse(p.text)
    file.nodes[0].data.initial = 42
    expect(readProject(file.project).ok).toBe(true) // no graph ⇒ no digest check
  })

  it('a malformed contentDigest is dropped when a graph is supplied', () => {
    const p = planRevisionExport({ doc: g, project, dirty: false, meta: {}, now: 'n', mint: seqMint })
    if (!p.ok) throw new Error('plan')
    const file = JSON.parse(p.text)
    file.project.contentDigest = 'ZZZZ'
    expect(readProject(file.project, canonicalContent(g)).ok).toBe(false)
  })
})

// ── canonical wire golden vector (§R4 / review round 2) ────────────────────
// A frozen literal for one representative GraphDoc. Any change to the field
// order, default normalisation, number handling, or the digest algorithm
// breaks this — a regression that pure invariance tests can miss.

const GOLDEN_NODES: LoopNode[] = [
  // pool: explicit capacity 0, sub-pixel x, -0 y
  pool('n_pool', { label: 'Café ☕', initial: 3, capacity: 0 }, { x: 12.5, y: -0 }),
  // pool: capacity omitted ⇒ normalises to null; label omitted ⇒ id
  { id: 'n_pool2', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', activation: 'passive', initial: 0, mode: 'pullAll' } } as unknown as LoopNode,
  { id: 'n_src', type: 'source', position: { x: -40, y: 8 }, data: { kind: 'source', label: 'src', activation: 'automatic', mode: 'pushAll' } } as LoopNode,
  { id: 'n_drain', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'drain', activation: 'passive', mode: 'pullAny' } } as LoopNode,
  gate('n_gate', { label: 'Gate 관문', distribution: 'probabilistic' }), // mode omitted ⇒ pullAny
  { id: 'n_conv', type: 'converter', position: { x: 5.25, y: 5.75 }, data: { kind: 'converter', label: 'conv', activation: 'onStart', mode: 'pullAll' } } as LoopNode,
  { id: 'n_end', type: 'end', position: { x: 300, y: 0 }, data: { kind: 'end', label: 'END', activation: 'passive' } } as unknown as LoopNode, // mode omitted ⇒ pullAny
]
const GOLDEN_EDGES: LoopEdge[] = [
  rEdge('e_res', 'n_src', 'n_pool', '2D6'),
  { id: 'e_state', type: 'loop', source: 'n_pool', target: 'n_gate', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 5' } } as LoopEdge, // delay omitted ⇒ 0
]
const golden = () => doc(GOLDEN_NODES, GOLDEN_EDGES, { baseSeed: 7, runs: 100, steps: 20, tracked: ['n_pool'] })

// —— frozen literals — captured from the projection; DO NOT hand-edit.
// If a legitimate spec change moves these, update BOTH here and bump the
// commit message; an accidental drift fails these three tests. ——
const GOLDEN_JSON =
  '{"nodes":[{"id":"n_conv","position":{"x":5.25,"y":5.75},"data":{"kind":"converter","label":"conv","activation":"onStart","mode":"pullAll"}},{"id":"n_drain","position":{"x":200,"y":0},"data":{"kind":"drain","label":"drain","activation":"passive","mode":"pullAny"}},{"id":"n_end","position":{"x":300,"y":0},"data":{"kind":"end","label":"END","activation":"passive","mode":"pullAny"}},{"id":"n_gate","position":{"x":10,"y":10},"data":{"kind":"gate","label":"Gate 관문","activation":"automatic","distribution":"probabilistic","mode":"pullAny"}},{"id":"n_pool","position":{"x":12.5,"y":0},"data":{"kind":"pool","label":"Café ☕","activation":"passive","initial":3,"capacity":0,"mode":"pullAny"}},{"id":"n_pool2","position":{"x":0,"y":0},"data":{"kind":"pool","label":"Pool","activation":"passive","initial":0,"capacity":null,"mode":"pullAll"}},{"id":"n_src","position":{"x":-40,"y":8},"data":{"kind":"source","label":"src","activation":"automatic","mode":"pushAll"}}],"edges":[{"id":"e_res","source":"n_src","target":"n_pool","sourceHandle":"out","targetHandle":"in","data":{"kind":"resource","flow":"2D6"}},{"id":"e_state","source":"n_pool","target":"n_gate","sourceHandle":"state-source","targetHandle":"state-target","data":{"kind":"state","mode":"activator","expr":">= 5","delay":0}}],"recommendedRunConfig":{"baseSeed":7,"runs":100,"steps":20,"tracked":["n_pool"]}}'
const GOLDEN_HEX = '36738f559b411ebf2b7b19fc82e14fab5902106774621eab9cc6b47cc1db4ce4'

describe('canonical wire golden vector', () => {
  it('canonicalJson is byte-exact against the frozen literal', () => {
    expect(canonicalJson(canonicalContent(golden()))).toBe(GOLDEN_JSON)
  })

  it('digest is byte-exact — pure-JS AND Web Crypto both equal the frozen hex', async () => {
    expect(digestOfCanonical(canonicalContent(golden()))).toBe(GOLDEN_HEX)
    expect(await fullContentDigest(golden())).toBe(GOLDEN_HEX)
  })

  it('shuffled array + key order produce the identical json + digest', () => {
    const shuffledNodes = [...GOLDEN_NODES].reverse().map((n) => ({
      ...n,
      data: Object.fromEntries(Object.entries(n.data as Record<string, unknown>).reverse()) as LoopNode['data'],
    }))
    const shuffled = doc(shuffledNodes as LoopNode[], [...GOLDEN_EDGES].reverse(), {
      tracked: ['n_pool'], steps: 20, runs: 100, baseSeed: 7,
    })
    expect(canonicalJson(canonicalContent(shuffled))).toBe(GOLDEN_JSON)
    expect(digestOfCanonical(canonicalContent(shuffled))).toBe(GOLDEN_HEX)
  })
})

// ── UTF-8 file-size boundary (§R11 / review round 2) ───────────────────────

describe('REVISION_FILE_MAX_BYTES boundary', () => {
  const project = { projectId: FAKE_PROJ, revisionId: FAKE_REV, parentId: null as string | null, lineage: [] as string[] }

  it('exactly cap ⇒ ok; cap+1 ⇒ too-large; measured in UTF-8 with multi-byte chars', () => {
    // pad a label with 3-byte chars so the file size lands on a chosen boundary
    const make = (padChars: number) =>
      planRevisionExport({
        doc: doc([pool('p1', { label: '한'.repeat(padChars) })]),
        project,
        dirty: false,
        meta: {},
        now: 'n',
        mint: seqMint,
        maxBytes: 999_999, // set below from a probe
      })
    // probe the size for a small pad, then choose maxBytes on the boundary
    const probe = make(10)
    if (!probe.ok) throw new Error('probe')
    const atCap = planRevisionExport({
      doc: doc([pool('p1', { label: '한'.repeat(10) })]),
      project, dirty: false, meta: {}, now: 'n', mint: seqMint, maxBytes: probe.bytes,
    })
    const overCap = planRevisionExport({
      doc: doc([pool('p1', { label: '한'.repeat(10) })]),
      project, dirty: false, meta: {}, now: 'n', mint: seqMint, maxBytes: probe.bytes - 1,
    })
    expect(atCap.ok).toBe(true)
    expect(overCap).toMatchObject({ ok: false, reason: 'too-large', cap: probe.bytes - 1 })
    // the reported byte count is the real UTF-8 length (each 한 is 3 bytes)
    if (atCap.ok) expect(atCap.bytes).toBe(probe.bytes)
  })
})

// ── misc ───────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('truncBytes never splits a multi-byte char', () => {
    const s = '가나다라마' // 3 bytes each = 15
    expect(truncBytes(s, 15)).toBe(s)
    expect(truncBytes(s, 10)).toBe('가나다') // 9 bytes; the 4th char would overflow
    expect(new TextEncoder().encode(truncBytes(s, 10)).length).toBeLessThanOrEqual(10)
  })

  it('canonicalJson is whitespace-free', () => {
    const j = canonicalJson(canonicalContent(doc([pool('p1')])))
    expect(j).not.toMatch(/\s/)
    expect(JSON.parse(j)).toBeTruthy()
  })
})

