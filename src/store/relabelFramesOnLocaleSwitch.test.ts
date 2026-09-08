import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageCatalog } from '../i18n/locales/en'
import enCatalog from '../i18n/locales/en'
import jaCatalog from '../i18n/locales/ja'
import { useI18n } from '../i18n/store'
import type { SavedFrame } from '../model/serialize'
import { STORAGE_KEY } from '../model/serialize'

// docs/template-label-overlay.md §TLO12 — the locale-switch subscription in
// graphStore also re-titles OFFICIAL group frames: the LIVE set and the frame
// sidecar of every undo/redo entry. The three change axes are judged
// independently — `liveNodesChanged`, `liveFramesChanged`, `historyChanged` —
// so a history-only diff still commits new `past`/`future` while a live change
// is what fires (one) autosave. No undo entry / `simulationRev` / `loadRev` /
// `fitRev` / recommended-config touch.
//
// The pure `relabel*ForLocale` functions are mocked here so this file tests only
// the subscription's classification + persistence logic; their own contract is
// in src/i18n/templateLabels/frameOverlay.test.ts.

const FRAME_OFFICIAL: Record<string, Record<string, string>> = {
  f1: { en: 'Inbound supply', ja: '入荷' },
  f2: { en: 'Processing', ja: '加工' },
}
const NODE_OFFICIAL: Record<string, Record<string, string>> = {
  n1: { en: 'Level', ja: 'レベル' },
}
const officialFrameStrings = new Set(Object.values(FRAME_OFFICIAL).flatMap((m) => Object.values(m)))
const officialNodeStrings = new Set(Object.values(NODE_OFFICIAL).flatMap((m) => Object.values(m)))

vi.mock('../i18n/templateLabels/relabel', () => ({
  relabelNodesForLocale: (nodes: readonly any[], loc: string) => {
    let changed = false
    const out = nodes.map((n) => {
      const m = NODE_OFFICIAL[n.id]
      if (m && officialNodeStrings.has(n.data.label) && m[loc] && m[loc] !== n.data.label) {
        changed = true
        return { ...n, data: { ...n.data, label: m[loc] } }
      }
      return n
    })
    return changed ? out : nodes
  },
  relabelFramesForLocale: (frames: readonly SavedFrame[], loc: string) => {
    let changed = false
    const out = frames.map((f) => {
      const m = FRAME_OFFICIAL[f.id]
      if (m && officialFrameStrings.has(f.label) && m[loc] && m[loc] !== f.label) {
        changed = true
        return { ...f, label: m[loc] }
      }
      return f
    })
    return changed ? out : frames
  },
}))

// vitest env is `node` — a Map-backed localStorage so the autosave path is real
class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
const mem = new MemStorage()
vi.stubGlobal('localStorage', mem)

const { useGraphStore } = await import('./graphStore')
const { useFrameStore } = await import('./frameStore')

const frame = (id: string, label: string, x = 0): SavedFrame => ({
  id,
  label,
  rect: { x, y: 0, w: 40, h: 20 },
})
const node = (id: string, label: string) =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { label } }) as any
const historyEntry = (nodes: any[], frames: SavedFrame[] | null) => ({
  nodes,
  edges: [],
  modelVersion: 1 as const,
  sidecar: { p: null, f: frames },
})

const activate = (code: string, catalog: MessageCatalog) =>
  useI18n.setState({ activeLocale: code, activeCatalog: catalog, requestedLocale: code })

const liveTitles = () => useFrameStore.getState().frames.map((f) => f.label)
const setItemSpy = vi.spyOn(mem, 'setItem')
const autosaveWrites = () => setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY).length

beforeEach(() => {
  activate('en', enCatalog)
  useFrameStore.getState().loadFrames([])
  useGraphStore.setState({
    nodes: [],
    edges: [],
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
    simulationRev: 0,
    loadRev: 0,
    fitRev: 0,
  })
  setItemSpy.mockClear()
})
afterEach(() => {
  activate('en', enCatalog)
  useFrameStore.getState().loadFrames([])
  useGraphStore.setState({ nodes: [], past: [], future: [] })
})

describe('§TLO12 — frame titles on a locale switch', () => {
  it('re-titles official LIVE frames; keeps a user rename and the "" default', () => {
    useFrameStore.getState().loadFrames([
      frame('f1', 'Inbound supply'),
      frame('f2', 'my processing'),
      frame('fx', ''),
    ])
    activate('ja', jaCatalog)
    expect(liveTitles()).toEqual(['入荷', 'my processing', ''])

    activate('en', enCatalog)
    expect(liveTitles()).toEqual(['Inbound supply', 'my processing', ''])
  })

  it('remaps the frame sidecar of every past / future entry', () => {
    useFrameStore.getState().loadFrames([frame('f1', 'Inbound supply')])
    useGraphStore.setState({
      past: [historyEntry([node('n1', 'Level')], [frame('f1', 'Inbound supply'), frame('f2', 'Processing')])],
      future: [historyEntry([], [frame('f2', 'Processing')])],
    })
    activate('ja', jaCatalog)

    const pastF = (useGraphStore.getState().past[0].sidecar as { f: SavedFrame[] }).f
    const futF = (useGraphStore.getState().future[0].sidecar as { f: SavedFrame[] }).f
    expect(pastF.map((f) => f.label)).toEqual(['入荷', '加工'])
    expect(futF.map((f) => f.label)).toEqual(['加工'])
  })

  it('history-only diff: updates past, leaves the live refs intact, and does NOT autosave', () => {
    activate('ja', jaCatalog) // lastLocaleForLabels = 'ja'
    // contrived-but-valid state: the LIVE graph is already fully EN, while a past
    // entry still carries JA official strings.
    useFrameStore.getState().loadFrames([frame('f1', 'Inbound supply')])
    useGraphStore.setState({
      nodes: [node('n1', 'Level')],
      past: [historyEntry([node('n1', 'レベル')], [frame('f1', '入荷')])],
    })
    const nodesRef = useGraphStore.getState().nodes
    const framesRef = useFrameStore.getState().frames
    setItemSpy.mockClear()

    activate('en', enCatalog) // ja → en: live already EN (no change); past JA → EN (change)

    expect((useGraphStore.getState().past[0].sidecar as { f: SavedFrame[] }).f[0].label).toBe(
      'Inbound supply',
    )
    expect(useGraphStore.getState().past[0].nodes[0].data.label).toBe('Level')
    expect(useGraphStore.getState().nodes).toBe(nodesRef) // live nodes untouched
    expect(useFrameStore.getState().frames).toBe(framesRef) // live frames untouched
    expect(autosaveWrites()).toBe(0) // history-only ⇒ no write
  })

  it('user rename → locale switch → undo/redo preserves the user name', () => {
    useFrameStore.getState().loadFrames([frame('f1', 'Inbound supply')])
    // a real rename — one frame undo entry; the PRE-rename official title lands in `past`
    useFrameStore.getState().renameFrame('f1', 'MyZone')
    expect(liveTitles()).toEqual(['MyZone'])

    activate('ja', jaCatalog)
    expect(liveTitles()).toEqual(['MyZone']) // a user name never switches

    useGraphStore.getState().undo()
    expect(liveTitles()).toEqual(['入荷']) // pre-rename state, in the CURRENT language (never stale EN)

    useGraphStore.getState().redo()
    expect(liveTitles()).toEqual(['MyZone'])
  })

  it('relabelTitles leaves selectedId / toolArmed / nextN untouched', () => {
    useFrameStore.getState().loadFrames([frame('f1', 'Inbound supply')])
    useFrameStore.setState({ selectedId: 'f1', toolArmed: true, nextN: 9 })
    activate('ja', jaCatalog)
    const s = useFrameStore.getState()
    expect(s.frames[0].label).toBe('入荷')
    expect(s.selectedId).toBe('f1')
    expect(s.toolArmed).toBe(true)
    expect(s.nextN).toBe(9)
  })

  it('the whole switch does not bump fitRev / loadRev / simulationRev, nor touch the MC recommended config', () => {
    useFrameStore.getState().loadFrames([frame('f1', 'Inbound supply')])
    useGraphStore.setState({ nodes: [node('n1', 'Level')], fitRev: 5, loadRev: 6, simulationRev: 7 })
    activate('ja', jaCatalog)
    const g = useGraphStore.getState()
    expect(g.fitRev).toBe(5)
    expect(g.loadRev).toBe(6)
    expect(g.simulationRev).toBe(7)
    expect(g.canUndo).toBe(false) // no undo entry was pushed
  })
})
