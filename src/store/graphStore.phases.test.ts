import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageCatalog } from '../i18n/locales/en'
import enCatalog from '../i18n/locales/en'
import koCatalog from '../i18n/locales/ko'
import { useI18n } from '../i18n/store'
import { openTemplate } from '../i18n/templateLabels'
import { ensureTemplateLabelDict } from '../i18n/templateLabels/dicts'
import { deserialize, loadFromStorage, serialize, STORAGE_KEY } from '../model/serialize'
import { TEMPLATES } from '../model/templates'
import './editPolicy'
import { flushAutosave, useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'

// docs/run-phases.md — the document's phases in the store: they come with a document
// (a file, a Template), go with it, stay through an edit of it, and their names follow
// the language as a Template's other names do.

const g = () => useGraphStore.getState()
const pool = (id: string) => ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id } }) as never
const PH = [
  { id: 'a', label: 'Warm up', from: 1, to: 3 },
  { id: 'b', label: 'Hold', from: 4, to: 9 },
]
const withPhases = serialize([pool('a')], [], undefined, undefined, undefined, 1, undefined, undefined, undefined, undefined, undefined, PH)
const plain = serialize([pool('a')], [])
const coffee = TEMPLATES.find((t) => t.id === 'coffee-roasting-batch')!
const activate = (code: string, catalog: MessageCatalog) => useI18n.setState({ activeLocale: code, activeCatalog: catalog, requestedLocale: code })

beforeAll(async () => {
  await ensureTemplateLabelDict('ko')
})
beforeEach(() => {
  activate('en', enCatalog)
  useUiStore.getState().setCanvasLocked(false)
  g().newGraph()
})

describe('the phases of a document, in the store', () => {
  it('come with a file and are written again by Export', () => {
    g().loadJSON(withPhases)
    expect(g().phases).toEqual(PH)
    expect(deserialize(g().exportJSON()).phases).toEqual(PH)
  })

  it('go with the document: a file without any, a new document, a Template without any', () => {
    g().loadJSON(withPhases)
    g().loadJSON(plain)
    expect(g().phases).toEqual([])
    expect('phases' in JSON.parse(g().exportJSON())).toBe(false)

    g().loadJSON(withPhases)
    g().newGraph()
    expect(g().phases).toEqual([])

    g().loadJSON(withPhases)
    g().loadGraph({ nodes: [pool('t')], edges: [] }, { canvasLocked: false })
    expect(g().phases).toEqual([])
    g().loadDoc({ nodes: [pool('d')], edges: [] }, { mode: 'document-boundary', canvasLocked: false, phases: PH })
    expect(g().phases).toEqual(PH)
    g().loadDoc({ nodes: [pool('d')], edges: [] }, { mode: 'document-boundary', canvasLocked: false })
    expect(g().phases).toEqual([])
  })

  it('stay through an edit, its undo, and a revision Apply, which carries none', () => {
    g().loadJSON(withPhases)
    g().addNodeAt('pool', { x: 200, y: 0 })
    expect(g().phases).toEqual(PH)
    g().undo()
    expect(g().phases).toEqual(PH)
    g().redo()
    g().loadDoc({ nodes: [pool('r')], edges: [] }, { mode: 'revision-apply', modelVersion: 1 })
    expect(g().nodes.map((n) => n.id)).toEqual(['r'])
    expect(g().phases).toEqual(PH)
    g().undo()
    expect(g().phases).toEqual(PH)
  })

  it('are in the autosave record, and absent from it when there are none', () => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    })
    try {
      g().loadJSON(withPhases)
      flushAutosave()
      expect(JSON.parse(m.get(STORAGE_KEY)!).phases).toEqual(PH)
      expect(loadFromStorage()?.phases).toEqual(PH)
      g().loadJSON(plain)
      flushAutosave()
      expect('phases' in JSON.parse(m.get(STORAGE_KEY)!)).toBe(false)
      expect(loadFromStorage()?.phases).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a Template brings its phases under the reader’s language, and they follow a language switch', () => {
    const open = (locale: string) => {
      const o = openTemplate(coffee, locale)
      g().loadGraph(o.graph, { canvasLocked: false, modelVersion: o.modelVersion, kinds: o.kinds, time: o.time, timetables: o.timetables, phases: o.phases })
    }
    open('en')
    expect(g().phases.map((p) => [p.label, p.from, p.to])).toEqual([
      ['Charge', 1, 1],
      ['Drying', 2, 5],
      ['Browning', 6, 9],
      ['Development', 10, 13],
      ['Drop', 14, 14],
      ['Cooling', 15, 18],
      ['Discharge', 19, 19],
    ])
    const rev = g().simulationRev
    const past = g().past
    activate('ko', koCatalog)
    expect(g().phases.map((p) => p.label)).toEqual(['투입', '건조', '갈변', '발달', '드롭', '냉각', '냉각 완료'])
    // a name is not the model: no run reset, no undo entry
    expect(g().simulationRev).toBe(rev)
    expect(g().past).toBe(past)
    activate('en', enCatalog)
    expect(g().phases[2]!.label).toBe('Browning')
    // the bundled Template itself is never touched
    expect(coffee.phases![2]!.label).toBe('Browning')
  })

  it('a name a person changed in the file stays through a language switch', () => {
    const o = openTemplate(coffee, 'en')
    const mine = o.phases!.map((p) => (p.id === 'roast_browning' ? { ...p, label: 'Maillard' } : p))
    g().loadGraph(o.graph, { canvasLocked: false, modelVersion: o.modelVersion, kinds: o.kinds, time: o.time, timetables: o.timetables, phases: mine })
    activate('ko', koCatalog)
    expect(g().phases.find((p) => p.id === 'roast_browning')!.label).toBe('Maillard')
    expect(g().phases.find((p) => p.id === 'roast_drying')!.label).toBe('건조')
  })
})
