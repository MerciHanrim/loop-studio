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

  it('carries a complete, self-consistent base.content and round-trips through readProject', () => {
    const p = planProposalExport({ doc: g, project, meta: {}, now: '2026-09-09T00:00:00Z', mint: seqMint })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const file = JSON.parse(p.text)
    expect(file.project.role).toBe('proposal')
    expect(file.project.parentId).toBe(FAKE_REV)
    expect(file.project.base.revisionId).toBe(FAKE_REV)
    // digest self-consistency (R-INV-6)
    const rp = readProject(file.project)
    expect(rp.ok).toBe(true)
    if (rp.ok) {
      // base.content vs the (identical) proposed content ⇒ empty diff
      const proposed = canonicalContent({ nodes: file.nodes, edges: file.edges })
      expect(computeRevisionDiff(rp.proposalBase!.content, proposed).summary.empty).toBe(true)
    }
  })

  it('an edit to the proposed graph shows up as a diff against the carried base', () => {
    const p = planProposalExport({ doc: g, project, meta: {}, now: 'n', mint: seqMint })
    if (!p.ok) throw new Error('plan failed')
    const file = JSON.parse(p.text)
    // simulate the author editing the proposed graph after Make-a-proposal
    file.nodes[0].data.capacity = 99
    const rp = readProject(file.project)
    if (!rp.ok) throw new Error('read failed')
    const d = computeRevisionDiff(rp.proposalBase!.content, canonicalContent({ nodes: file.nodes, edges: file.edges }))
    expect(d.summary.nodes.changed).toBe(1)
    expect(d.nodes.changed[0].fields[0]).toMatchObject({ field: 'data.capacity', base: 7, proposed: 99, tag: 'engine' })
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

