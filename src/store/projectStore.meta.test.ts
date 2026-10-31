import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTHOR_NAME_KEY, AUTHOR_NAME_MAX_BYTES, AUTHOR_NOTE_MAX_BYTES, readProjectMeta } from '../model/revision'
import { STORAGE_KEY } from '../model/serialize'

// #420 item (2) — the autosaved project header's `meta` was taken after an
// object check only and spread into every later exported header: a stored
// `title: 42`, `author: "x"`, unknown keys (a 200 000-character one made a
// 201 KB revision file) and over-long author fields all reached the sender's
// files. The recipient's import already drops them (`readProjectMeta`, the
// import path's reader), but the sender's file was still written wrong. Now the
// stored header and every export's header meta go through that same reader; a
// valid meta exports exactly as before.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

let mem: MemStorage
let seq = 0
const mint = (p: 'proj' | 'rev') => `${p}_${String(seq++).padStart(26, '0')}`
const bytes = (s: string) => new TextEncoder().encode(s).length

/** a fresh module graph with the storage port open, as the boot module opens it */
async function freshStores() {
  vi.resetModules()
  const port = await import('../storage/storagePort')
  port.storageSession.use('personal')
  const g = await import('./graphStore')
  const ps = await import('./projectStore')
  return { g, ps }
}

/** promote a one-node document, then replace the stored header's meta and boot again */
async function bootWithStoredMeta(meta: unknown, storedAuthor?: { name?: string; note?: string }) {
  const first = await freshStores()
  first.g.useGraphStore.getState().newGraph()
  first.g.useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  const p = first.ps.useProjectStore.getState().planRevision({ now: '2026-10-31T00:00:00Z', mint })
  if (!p.ok) throw new Error('promote')
  first.ps.useProjectStore.getState().commitRevisionExport(p.plan)
  first.g.flushAutosave()
  const rec = JSON.parse(mem.getItem(STORAGE_KEY)!) as { project: Record<string, unknown> }
  rec.project.meta = meta
  mem.setItem(STORAGE_KEY, JSON.stringify(rec))
  if (storedAuthor) mem.setItem(AUTHOR_NAME_KEY, JSON.stringify(storedAuthor))
  else mem.removeItem(AUTHOR_NAME_KEY)
  return freshStores()
}

/** a dirty revision export (one edit first) and then a proposal; their header meta */
function exportBoth(stores: Awaited<ReturnType<typeof freshStores>>) {
  const { g, ps } = stores
  g.useGraphStore.getState().addNodeAt('source', { x: 200, y: 0 })
  const rev = ps.useProjectStore.getState().planRevision({ now: '2026-10-31T01:00:00Z', mint })
  if (!rev.ok) throw new Error('revision plan')
  ps.useProjectStore.getState().commitRevisionExport(rev.plan)
  const prop = ps.useProjectStore.getState().planProposal({ now: '2026-10-31T02:00:00Z', mint })
  if (!('text' in prop) || !prop.ok) throw new Error('proposal plan')
  return {
    revisionMeta: JSON.parse(rev.text).project.meta as Record<string, unknown>,
    revisionBytes: rev.text.length,
    proposalMeta: JSON.parse(prop.text).project.meta as Record<string, unknown>,
  }
}

const JUNK = {
  title: 42,
  createdAt: { nested: true },
  tool: ['not', 'a', 'string'],
  author: 'Mallory',
  extra: 'an unknown key',
  huge: 'x'.repeat(200_000),
}

beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  seq = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the stored project header meta (#420 item 2)', () => {
  it('a hand-edited meta is read like an imported one: only the known, typed fields remain in the open header', async () => {
    const { ps } = await bootWithStoredMeta(JUNK)
    expect(ps.useProjectStore.getState().open?.meta).toEqual({}) // nothing of JUNK is valid
    expect(ps.useProjectStore.getState().open?.meta).toEqual(readProjectMeta(JUNK) ?? {})
  })

  it('neither a revision nor a proposal carries unknown keys, wrong types or the oversized value', async () => {
    const { revisionMeta, revisionBytes, proposalMeta } = exportBoth(await bootWithStoredMeta(JUNK))
    for (const m of [revisionMeta, proposalMeta]) {
      expect(Object.keys(m).sort()).toEqual(['createdAt', 'tool']) // stamped by the export; no title / author / extra / huge
      expect(typeof m.createdAt).toBe('string')
      expect(typeof m.tool).toBe('string')
    }
    expect(revisionBytes).toBeLessThan(10_000) // was 201 KB with the stored 200 000-character key
  })

  it('a device-local author still replaces the stored one, as before', async () => {
    const { revisionMeta, proposalMeta } = exportBoth(await bootWithStoredMeta(JUNK, { name: 'Ana' }))
    expect(revisionMeta.author).toEqual({ name: 'Ana' })
    expect(proposalMeta.author).toEqual({ name: 'Ana' })
  })

  it('an over-long stored author name and note are truncated to the import limits', async () => {
    const { revisionMeta } = exportBoth(await bootWithStoredMeta({ author: { name: 'N'.repeat(5000), note: 'm'.repeat(50_000) } }))
    const author = revisionMeta.author as { name: string; note: string }
    expect(bytes(author.name)).toBeLessThanOrEqual(AUTHOR_NAME_MAX_BYTES)
    expect(bytes(author.note)).toBeLessThanOrEqual(AUTHOR_NOTE_MAX_BYTES)
    expect(author.name.length).toBeGreaterThan(0)
  })

  it('a valid meta exports exactly as before: title and author kept, createdAt and tool stamped', async () => {
    const VALID = { title: 'Coffee shop economy', createdAt: '2026-08-29T12:00:00Z', author: { name: 'Alex', note: 'tuned the drain rates' }, tool: 'loop-studio/0.5.0' }
    const stores = await bootWithStoredMeta(VALID)
    expect(stores.ps.useProjectStore.getState().open?.meta).toEqual(VALID) // unchanged by the reader
    const { revisionMeta, proposalMeta } = exportBoth(stores)
    for (const m of [revisionMeta, proposalMeta]) {
      expect(m.title).toBe('Coffee shop economy')
      expect(m.author).toEqual({ name: 'Alex', note: 'tuned the drain rates' })
      expect(typeof m.createdAt).toBe('string')
      expect(m.tool).toMatch(/^loop-studio\//)
      expect(Object.keys(m).sort()).toEqual(['author', 'createdAt', 'title', 'tool'])
    }
  })

  it('an unchanged revision still re-exports byte-identically', async () => {
    const { ps } = await bootWithStoredMeta({ title: 'Stable', author: { name: 'Alex' } })
    const a = ps.useProjectStore.getState().planRevision({ now: '2026-10-31T03:00:00Z', mint })
    const b = ps.useProjectStore.getState().planRevision({ now: '2026-10-31T04:00:00Z', mint })
    if (!a.ok || !b.ok) throw new Error('plan')
    expect(b.text).toBe(a.text)
  })

  it('a meta that is not an object reads as empty', async () => {
    const { ps } = await bootWithStoredMeta('just a string')
    expect(ps.useProjectStore.getState().open?.meta).toEqual({})
  })
})
