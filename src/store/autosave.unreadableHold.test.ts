import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../model/serialize'

// #420 item (3) — the save boundary. A stored record the app cannot read was
// replaced by the sample at boot and silently overwritten by the first write;
// the original then existed nowhere. Rule (Lumi): until the person chooses
// (download / try again / discard / a temporary session), NOTHING may overwrite
// it. The boot screen keeps the stores from ever starting in that state; this
// test is the defence behind it: if the stores DO start over an unreadable
// record (any path), every write of the record is refused, the record stays
// byte-identical, and the refusal is a visible autosave failure (`held`), never
// a silent skip. Written before the fix: on main every case below fails.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const MINE = { id: 'mine', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'My work', initial: 7 } }
const UNREADABLE: Record<string, string> = {
  'broken JSON': JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [MINE], edges: [] }).slice(0, 60),
  'a newer schema': JSON.stringify({ schema: 'loop-studio/graph/99', version: 1, nodes: [MINE], edges: [] }),
  'a node entry without a position': JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [{ id: 'mine', data: { kind: 'pool' } }], edges: [] }),
  // review round 1: the key exists and holds an empty string — that is a record
  // this build cannot read, not "no record"
  'an empty value': '',
}
const VALID_FILE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [{ id: 'other', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Other' } }],
  edges: [],
})

let mem: MemStorage
beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/** the stores of a fresh module graph, started in a personal session over `text` */
async function bootOver(text: string) {
  mem.setItem(STORAGE_KEY, text)
  vi.resetModules()
  const port = await import('../storage/storagePort')
  port.storageSession.use('personal')
  const g = await import('./graphStore')
  await import('./projectStore')
  const a = await import('./autosaveStore')
  return { g, a }
}

describe('the stores started over an unreadable record never overwrite it', () => {
  for (const [name, text] of Object.entries(UNREADABLE)) {
    it(`${name}: an edit, New, a file, a header and a series write all leave it byte-identical, as a visible held failure`, async () => {
      const { g, a } = await bootOver(text)
      const writes: Array<[string, () => void]> = [
        ['an edit, flushed', () => {
          g.useGraphStore.getState().addNodeAt('source', { x: 300, y: 0 })
          g.flushAutosave()
        }],
        ['New', () => g.useGraphStore.getState().newGraph()],
        ['opening a graph file', () => void g.useGraphStore.getState().loadJSON(VALID_FILE)],
        ['a project header write', () => g.setAutosaveProjectHeader(null)],
        ['a Timeline series write', () => g.setAutosaveTimelineSeries('all')],
        ['persistNow (a session switch)', () => g.persistNow()],
      ]
      for (const [what, write] of writes) {
        write()
        g.flushAutosave()
        expect(mem.getItem(STORAGE_KEY), what).toBe(text)
      }
      expect(a.useAutosaveStore.getState()).toMatchObject({ failed: true, reason: 'held' })
    })
  }

  it('a readable record is written as before (no hold)', async () => {
    const { g, a } = await bootOver(VALID_FILE)
    g.useGraphStore.getState().addNodeAt('pool', { x: 300, y: 0 })
    g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).not.toBe(VALID_FILE)
    expect((JSON.parse(mem.getItem(STORAGE_KEY)!) as { nodes: unknown[] }).nodes).toHaveLength(2)
    expect(a.useAutosaveStore.getState().failed).toBe(false)
  })

  it('a running tab: another tab writing a record this build cannot read (a newer version) is never overwritten by the next save', async () => {
    // review round 1 — an older tab already open, a newer tab saves its newer
    // record, then the older tab's autosave fires: the change check right
    // before the write sees a record it did not write and cannot read
    const { g, a } = await bootOver(VALID_FILE)
    g.useGraphStore.getState().addNodeAt('pool', { x: 300, y: 0 })
    g.flushAutosave()
    expect(a.useAutosaveStore.getState().failed).toBe(false)
    const newer = UNREADABLE['a newer schema']
    mem.setItem(STORAGE_KEY, newer) // the other tab
    g.useGraphStore.getState().addNodeAt('source', { x: 600, y: 0 })
    g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).toBe(newer)
    expect(a.useAutosaveStore.getState()).toMatchObject({ failed: true, reason: 'held' })
    g.useGraphStore.getState().addNodeAt('drain', { x: 900, y: 0 }) // and every save after it
    g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).toBe(newer)
  })

  it('a running tab: another tab of the same version writing a READABLE record is overwritten as before (last writer wins; stated limit)', async () => {
    const { g, a } = await bootOver(VALID_FILE)
    const other = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [{ id: 'theirs', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Theirs' } }], edges: [] })
    mem.setItem(STORAGE_KEY, other)
    g.useGraphStore.getState().addNodeAt('source', { x: 600, y: 0 })
    g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).not.toBe(other)
    expect(a.useAutosaveStore.getState().failed).toBe(false)
  })

  it('a tab saving again and again with no other writer never holds itself', async () => {
    const { g, a } = await bootOver(VALID_FILE)
    for (let i = 0; i < 5; i++) {
      g.useGraphStore.getState().addNodeAt('pool', { x: 100 * i, y: 200 })
      g.flushAutosave()
    }
    expect(a.useAutosaveStore.getState().failed).toBe(false)
    expect((JSON.parse(mem.getItem(STORAGE_KEY)!) as { nodes: unknown[] }).nodes).toHaveLength(6)
  })

  it('no record at all is written as before (a first run, no hold)', async () => {
    mem.clear()
    vi.resetModules()
    const port = await import('../storage/storagePort')
    port.storageSession.use('personal')
    const g = await import('./graphStore')
    const a = await import('./autosaveStore')
    g.useGraphStore.getState().addNodeAt('pool', { x: 300, y: 0 })
    g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).not.toBeNull()
    expect(a.useAutosaveStore.getState().failed).toBe(false)
  })
})
