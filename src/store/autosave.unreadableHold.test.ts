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
