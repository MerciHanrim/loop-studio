import desalinationDoc from '../../examples/desalination.json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeShareText, encodeShareText } from '../model/share'
import { checkedRangeOf, modelKey, pauseStages } from '../model/runGuide'
import { deserialize, STORAGE_KEY } from '../model/serialize'
import './editPolicy'
import { flushAutosave, useGraphStore } from './graphStore'
import { recommendedRunConfigForExport } from './mcStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'

// #537 (Lumi, 2026-11-10) — auto-play pauses once per run at the first stop of a core
// process (a stage marked `pauseOnStop`, held "stopped" for lack of supply or of room); the
// later stops stay in the run notices; a stop already passed by a manual Step does not pause
// Play. The desalination Template marks its five water-path stages. The note past the 2,160
// steps it is checked over holds only while the model is the example's.

const S = () => useSimStore.getState()
const G = () => useGraphStore.getState()
const TEMPLATE = JSON.stringify(desalinationDoc)
const CORE = ['adjust', 'dpump', 'filter', 'remin', 'ro']

/** the Template without its six chemical deliveries: the plant stops about 48 days in */
function withoutDeliveries(text: string): string {
  const doc = JSON.parse(text)
  const gone = new Set(doc.nodes.filter((n: { id: string }) => n.id.endsWith('Del')).map((n: { id: string }) => n.id))
  doc.nodes = doc.nodes.filter((n: { id: string }) => !gone.has(n.id))
  doc.edges = doc.edges.filter((e: { source: string; target: string }) => !gone.has(e.source) && !gone.has(e.target))
  return JSON.stringify(doc)
}
const COPY = withoutDeliveries(TEMPLATE)

function open(text: string) {
  G().loadJSON(text)
  S().reset()
}
/** step through the store to `n`, as auto-play does when `running`, and stop at a pause */
function runTo(n: number, running: boolean) {
  while (S().stepIndex < n) {
    if (running) useSimStore.setState({ status: 'running' })
    S().advance()
    if (running && S().status !== 'running') return
  }
  if (running && S().status === 'running') useSimStore.setState({ status: 'paused' })
}

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  G().newGraph()
  S().reset()
})

describe('the core processes are marked in the document (#537)', () => {
  it('the desalination Template marks its five water-path stages, each with its run rule', () => {
    const doc = deserialize(TEMPLATE)
    expect(pauseStages(doc.nodes).sort()).toEqual(CORE)
    for (const id of CORE) expect((doc.nodes.find((n) => n.id === id)!.data as { run?: unknown }).run, id).toBeDefined()
  })

  it('the mark is document data: it survives save and reopen, the autosave record, and a share link', async () => {
    open(TEMPLATE)
    const saved = G().exportJSON(recommendedRunConfigForExport())
    expect(pauseStages(deserialize(saved).nodes).sort()).toEqual(CORE)
    const { payload } = await encodeShareText(saved)
    expect(pauseStages(deserialize(await decodeShareText(payload)).nodes).sort()).toEqual(CORE)
  })
})

describe('the autosave record keeps the mark (#537)', () => {
  class MemStorage {
    m = new Map<string, string>()
    getItem(k: string) { return this.m.get(k) ?? null }
    setItem(k: string, v: string) { this.m.set(k, String(v)) }
    removeItem(k: string) { this.m.delete(k) }
    clear() { this.m.clear() }
    key(i: number) { return [...this.m.keys()][i] ?? null }
    get length() { return this.m.size }
  }
  let mem: MemStorage
  beforeEach(() => {
    mem = new MemStorage()
    vi.stubGlobal('localStorage', mem)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('the record written after the Template opens holds the five marks', () => {
    open(TEMPLATE)
    flushAutosave()
    const record = JSON.parse(mem.getItem(STORAGE_KEY)!) as { nodes: { id: string; data: { pauseOnStop?: boolean } }[] }
    expect(record.nodes.filter((n) => n.data.pauseOnStop === true).map((n) => n.id).sort()).toEqual(CORE)
  })
})

describe('auto-play pauses once per run at the first stop of a core process (#537)', () => {
  it('the copy without deliveries pauses at step 1161, Discharge adjustment, short of the Water-quality chemical tank', () => {
    open(COPY)
    runTo(1150, false)
    expect(S().autoPause).toBeNull()
    runTo(1300, true)
    expect(S().status).toBe('paused')
    expect(S().stepIndex).toBe(1161)
    expect(S().autoPause).toEqual({ step: 1161, stage: 'Discharge adjustment', cause: 'supply', pool: 'Water-quality chemical tank' })
  }, 60_000)

  it('played on, it does not pause again: the later stops (1172, 1175, 1181) stay in the run notices', () => {
    open(COPY)
    runTo(1150, false)
    runTo(1300, true)
    expect(S().stepIndex).toBe(1161)
    runTo(1300, true)
    expect(S().stepIndex).toBe(1300)
    // the run row keeps the one pause; the notices name the stopped stages
    expect(S().autoPause?.step).toBe(1161)
    expect(S().notices.filter((n) => n.kind === 'runHeld' && n.state === 'stopped').length).toBeGreaterThan(1)
  }, 60_000)

  it('a stop passed by manual steps does not pause Play later', () => {
    open(COPY)
    runTo(1165, false)
    runTo(1300, true)
    expect(S().stepIndex).toBe(1300)
    expect(S().autoPause).toBeNull()
  }, 60_000)

  it('Reset starts a run that pauses again', () => {
    open(COPY)
    runTo(1150, false)
    runTo(1300, true)
    S().reset()
    expect(S().autoPause).toBeNull()
    runTo(1150, false)
    runTo(1300, true)
    expect(S().stepIndex).toBe(1161)
  }, 60_000)

  it('a document with no marked stage never pauses this way', () => {
    const doc = JSON.parse(COPY)
    for (const n of doc.nodes) delete n.data.pauseOnStop
    open(JSON.stringify(doc))
    runTo(1150, false)
    runTo(1300, true)
    expect(S().stepIndex).toBe(1300)
    expect(S().autoPause).toBeNull()
  }, 60_000)

  it('the shipped Template does not pause over its 90 days', () => {
    open(TEMPLATE)
    runTo(2160, true)
    expect(S().stepIndex).toBe(2160)
    expect(S().autoPause).toBeNull()
  }, 120_000)
})

describe('the checked range holds only while the model is the example’s (#537)', () => {
  const at = () => checkedRangeOf(G(), G().modelVersion)

  it('the Template opened: 2,160 steps, 90 days', () => {
    open(TEMPLATE)
    expect(at()).toEqual({ templateId: 'desalination', steps: 2160, days: 90 })
  })

  it('a moved node, a renamed node and a renamed table keep it: none is engine content', () => {
    open(TEMPLATE)
    const sea = G().nodes.find((n) => n.id === 'sea')!
    useGraphStore.setState({ nodes: G().nodes.map((n) => (n.id === 'sea' ? { ...sea, position: { x: sea.position.x + 30, y: sea.position.y } } : n)) })
    G().updateNodeData('sea', { label: 'Meerwasser' })
    useGraphStore.setState({ timetables: G().timetables.map((t) => ({ ...t, label: `${t.label} (renamed)`, source: 'elsewhere' })) })
    expect(at()?.steps).toBe(2160)
  })

  it('a dose changed, a delivery removed, or a rule changed removes it', () => {
    open(TEMPLATE)
    const d = G().edges.find((x) => x.id === 'e_lime_remin')!.data!
    if (d.kind !== 'resource') throw new Error('the lime dose is a resource line')
    G().setEdgeData('e_lime_remin', { ...d, flow: '361' })
    expect(at()).toBeNull()
    open(COPY)
    expect(at()).toBeNull()
  })

  it('saved and reopened, it holds again', () => {
    open(TEMPLATE)
    const saved = G().exportJSON(recommendedRunConfigForExport())
    G().newGraph()
    open(saved)
    expect(at()?.steps).toBe(2160)
  })

  it('the key leaves a table’s name and source out, and nothing else of the table', () => {
    open(TEMPLATE)
    const k = modelKey(G(), G().modelVersion)
    useGraphStore.setState({ timetables: G().timetables.map((t, i) => (i === 0 ? { ...t, points: t.points.map(([a, b]) => [a, b === '3600' ? '3601' : b] as [string, string]) } : t)) })
    expect(modelKey(G(), G().modelVersion)).not.toBe(k)
  })
})
