import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'

// #420 item (3) — the pieces under the recovery screen: the store-free reader
// that tells an unreadable record apart, the port's hold on the browser's work
// record, the read check when a temporary session switches back to personal,
// and a share link opened in the temporary session the recovery screen offers.

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
const READABLE = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [MINE], edges: [] })
const BROKEN = READABLE.slice(0, 60)
const NEWER = JSON.stringify({ schema: 'loop-studio/graph/99', version: 1, nodes: [MINE], edges: [] })
const BAD_NODE = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [{ id: 'mine', data: {} }], edges: [] })

let mem: MemStorage
beforeEach(() => {
  mem = new MemStorage()
  vi.stubGlobal('localStorage', mem)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function fresh(mode: 'personal' | 'temporary' = 'personal') {
  vi.resetModules()
  const port = await import('./storagePort')
  port.storageSession.use(mode)
  const ser = await import('../model/serialize')
  return { port, ser }
}

describe('readStoredRecord / classifyStoredText', () => {
  it('tells none, a document, each unreadable record, a newer schema and a refused read apart', async () => {
    const { ser } = await fresh()
    expect(ser.classifyStoredText(null)).toEqual({ kind: 'none' })
    expect(ser.classifyStoredText(READABLE).kind).toBe('ok')
    expect(ser.classifyStoredText(BROKEN)).toEqual({ kind: 'unreadable', text: BROKEN, reason: 'invalid-json', newer: false })
    expect(ser.classifyStoredText(NEWER)).toEqual({ kind: 'unreadable', text: NEWER, reason: 'not-loop-studio', newer: true })
    expect(ser.classifyStoredText(BAD_NODE)).toEqual({ kind: 'unreadable', text: BAD_NODE, reason: 'bad-node', newer: false })
    mem.setItem(STORAGE_KEY, BROKEN)
    expect(ser.readStoredRecord().kind).toBe('unreadable')
    const real = mem.getItem.bind(mem)
    mem.getItem = (k: string) => {
      if (k === STORAGE_KEY) throw new Error('blocked')
      return real(k)
    }
    expect(ser.readStoredRecord()).toEqual({ kind: 'read-failed' })
  })
})

describe('the hold on the browser work record', () => {
  it('refuses writes and removals of the work record only, until released or discarded', async () => {
    const { port } = await fresh()
    mem.setItem(STORAGE_KEY, BROKEN)
    port.storageSession.holdWork()
    expect(() => port.storagePort.setItem(STORAGE_KEY, 'x')).toThrow(port.StorageHeldError)
    expect(() => port.storagePort.removeItem(STORAGE_KEY)).toThrow(port.StorageHeldError)
    expect(() => port.storageSession.removeFromBrowser(STORAGE_KEY)).toThrow(port.StorageHeldError)
    port.storagePort.setItem('loop-studio:theme' as never, 'dark') // any other key goes on
    expect(mem.getItem('loop-studio:theme')).toBe('dark')
    expect(mem.getItem(STORAGE_KEY)).toBe(BROKEN)
    port.storageSession.releaseWork()
    port.storagePort.setItem(STORAGE_KEY, READABLE)
    expect(mem.getItem(STORAGE_KEY)).toBe(READABLE)
    port.storageSession.holdWork()
    port.storageSession.discardHeldWork()
    expect(mem.getItem(STORAGE_KEY)).toBeNull()
    expect(port.storageSession.isWorkHeld()).toBe(false)
  })

  it('a temporary session writes on in memory while the browser record stays held', async () => {
    const { port } = await fresh('temporary')
    mem.setItem(STORAGE_KEY, BROKEN)
    port.storageSession.holdWork()
    port.storagePort.setItem(STORAGE_KEY, READABLE) // the in-memory store
    expect(port.storagePort.getItem(STORAGE_KEY)).toBe(READABLE)
    expect(mem.getItem(STORAGE_KEY)).toBe(BROKEN)
  })
})

describe('a temporary session with an unreadable browser record', () => {
  it('switching to personal is refused, nothing is written, the temporary work stays; a readable record lets it switch', async () => {
    mem.setItem(STORAGE_KEY, BROKEN)
    const { port } = await fresh('temporary')
    const g = await import('../store/graphStore')
    const actions = await import('../store/sessionActions')
    g.useGraphStore.getState().newGraph()
    g.useGraphStore.getState().addNodeAt('source', { x: 0, y: 0 })
    const ids = g.useGraphStore.getState().nodes.map((n) => n.id)
    expect(actions.switchToPersonal()).toEqual({ ok: false, reason: 'unreadable' })
    expect(port.storageSession.mode()).toBe('temporary')
    expect(mem.getItem(STORAGE_KEY)).toBe(BROKEN)
    expect(g.useGraphStore.getState().nodes.map((n) => n.id)).toEqual(ids)
    mem.setItem(STORAGE_KEY, READABLE)
    expect(actions.switchToPersonal()).toEqual({ ok: true })
    expect(port.storageSession.mode()).toBe('personal')
  })

  it('a share link opens into memory, and the browser record stays byte-identical', async () => {
    mem.setItem(STORAGE_KEY, BROKEN)
    const { port, ser } = await fresh('temporary')
    port.storageSession.holdWork() // as the recovery screen leaves it
    const g = await import('../store/graphStore')
    const { encodeShareText } = await import('../model/share')
    const { consumeShareLink } = await import('../store/shareLink')
    const nodes = [{ id: 'shared', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'From link' } }] as unknown as LoopNode[]
    const { payload } = await encodeShareText(ser.serialize(nodes, [] as LoopEdge[]))
    const out = await consumeShareLink({ hash: `#g1=${payload}`, confirm: () => true, stripFragment: () => {} })
    expect(out).toEqual({ kind: 'loaded' })
    expect(g.useGraphStore.getState().nodes.map((n) => n.id)).toEqual(['shared'])
    g.flushAutosave()
    expect(mem.getItem(STORAGE_KEY)).toBe(BROKEN)
  })
})
