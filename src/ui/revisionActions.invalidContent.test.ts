import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./download', () => ({ downloadText: vi.fn() }))

import { canonicalContent, InvalidRevisionContentError, SecureRandomUnavailableError } from '../model/revision'
import type { LoopNode } from '../model/types'
import { t } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import { useGraphStore } from '../store/graphStore'
import { useProjectStore } from '../store/projectStore'
import { downloadText } from './download'
import { exportProjectRevision, makeProposal } from './revisionActions'

// #420 — a node whose kind is not a node kind (a hand-made file keeps it, the
// canvas draws the fallback node). Before: the canonical projection threw a raw
// `TypeError`; Export reported it as a missing secure random source, Make a
// proposal threw out of its click handler, and the debounced dirty check threw
// inside its timer and left the chip saying "unchanged". Now the projection
// throws `InvalidRevisionContentError` naming the node, both exports name the
// cause, and the dirty flag says `true` (content that cannot be projected cannot
// equal a baseline that was). A valid document behaves exactly as before.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const WIDGET = { id: 'w', type: 'widget', position: { x: 0, y: 0 }, data: { kind: 'widget', label: 'Wonder' } } as unknown as LoopNode
const UNNAMED = { id: 'u', type: 'blob', position: { x: 0, y: 40 }, data: { kind: 'blob', label: '' } } as unknown as LoopNode

let seq = 0
const mint = (p: 'proj' | 'rev') => `${p}_${String(seq++).padStart(26, '0')}`
const download = vi.mocked(downloadText)
let warn: ReturnType<typeof vi.spyOn>

const addBadNode = (n: LoopNode = WIDGET) => useGraphStore.setState({ nodes: [...useGraphStore.getState().nodes, n] }, false)
const dropBadNodes = () => useGraphStore.setState({ nodes: useGraphStore.getState().nodes.filter((n) => n.id !== 'w' && n.id !== 'u') }, false)
const unknownKindText = (node: string, kind: string) => t('revision.export.unknownKind', { node: isolateAuto(node), kind: isolateAuto(kind) })

/** open a project on the current (valid) graph, as Export ▸ Project revision does */
function promote(): void {
  const p = useProjectStore.getState().planRevision({ now: '2026-10-30T00:00:00Z', mint })
  if (!p.ok) throw new Error('promote plan')
  expect(useProjectStore.getState().commitRevisionExport(p.plan)).toBe('committed')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  seq = 0
  download.mockClear()
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the canonical projection', () => {
  it('an unknown node kind throws InvalidRevisionContentError naming the node, its label and its kind', () => {
    let err: unknown
    try {
      canonicalContent({ nodes: [WIDGET], edges: [] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(InvalidRevisionContentError)
    expect((err as InvalidRevisionContentError).node).toEqual({ id: 'w', label: 'Wonder', kind: 'widget' })
  })

  it('a non-finite number is still InvalidRevisionContentError, with no node named', () => {
    const bad = { id: 'p', type: 'pool', position: { x: Number.NaN, y: 0 }, data: { kind: 'pool', label: 'P' } } as unknown as LoopNode
    let err: unknown
    try {
      canonicalContent({ nodes: [bad], edges: [] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(InvalidRevisionContentError)
    expect((err as InvalidRevisionContentError).node).toBeUndefined()
  })
})

describe('Export ▸ Project revision', () => {
  it('a valid document exports as before: one download, the project opened, not dirty', () => {
    expect(exportProjectRevision()).toEqual({ ok: true })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][1]).toBe('loop-studio-revision.json')
    expect(useProjectStore.getState().open).not.toBeNull()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('an unknown node kind: refused with the node and kind named — not "no secure random" — and nothing downloaded or opened', () => {
    addBadNode()
    const r = exportProjectRevision()
    expect(r).toEqual({ ok: false, message: unknownKindText('Wonder', 'widget') })
    expect(r.ok === false && r.message).not.toBe(t('revision.export.noSecureRandom'))
    expect(download).not.toHaveBeenCalled()
    expect(useProjectStore.getState().open).toBeNull()
  })

  it('a node with an empty name is named by its id', () => {
    addBadNode(UNNAMED)
    expect(exportProjectRevision()).toEqual({ ok: false, message: unknownKindText('u', 'blob') })
  })

  it('each cause keeps its own text; anything else is not a refusal and still throws', () => {
    const plan = vi.spyOn(useProjectStore.getState(), 'planRevision')
    plan.mockImplementationOnce(() => {
      throw new SecureRandomUnavailableError()
    })
    expect(exportProjectRevision()).toEqual({ ok: false, message: t('revision.export.noSecureRandom') })
    plan.mockImplementationOnce(() => {
      throw new InvalidRevisionContentError('frame f rect.x')
    })
    expect(exportProjectRevision()).toEqual({ ok: false, message: t('revision.export.invalidContent') })
    plan.mockImplementationOnce(() => {
      throw new RangeError('a defect')
    })
    expect(() => exportProjectRevision()).toThrow(RangeError)
    expect(download).not.toHaveBeenCalled()
  })
})

describe('Export ▸ Make a proposal', () => {
  it('a valid document exports as before: with an open, unchanged project, one download', () => {
    promote()
    download.mockClear()
    expect(makeProposal()).toEqual({ ok: true })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][1]).toBe('loop-studio-proposal.json')
  })

  it('the existing refusals are unchanged: no project', () => {
    expect(makeProposal()).toEqual({ ok: false, message: t('proposal.needProject') })
  })

  it('an unknown node kind: refused with the node and kind named, instead of throwing out of the click', () => {
    promote()
    download.mockClear()
    addBadNode()
    expect(makeProposal()).toEqual({ ok: false, message: unknownKindText('Wonder', 'widget') })
    expect(download).not.toHaveBeenCalled()
  })

  it('the two shared refusals name neither action, and promise no other export (review round 1)', () => {
    // the same text answers Export ▸ Project revision AND Make a proposal, so it
    // must not say "Project revision"; and a non-finite number would not survive
    // Graph JSON either (JSON writes it as `null`), so no text offers that way
    for (const text of [unknownKindText('Wonder', 'widget'), t('revision.export.invalidContent')]) {
      expect(text).not.toMatch(/Project revision|proposal/i)
      expect(text).not.toMatch(/Graph JSON/)
    }
  })

  it('no secure random source: its own text, instead of throwing out of the click; a defect still throws', () => {
    promote()
    const plan = vi.spyOn(useProjectStore.getState(), 'planProposal')
    plan.mockImplementationOnce(() => {
      throw new SecureRandomUnavailableError()
    })
    expect(makeProposal()).toEqual({ ok: false, message: t('revision.export.noSecureRandom') })
    plan.mockImplementationOnce(() => {
      throw new RangeError('a defect')
    })
    expect(() => makeProposal()).toThrow(RangeError)
  })
})

describe('the dirty flag', () => {
  it('a valid document is judged as before: an edit makes it dirty, undoing the edit makes it clean again', () => {
    promote()
    const before = useGraphStore.getState().nodes
    expect(useProjectStore.getState().dirty).toBe(false)
    const id = before[0].id
    useGraphStore.getState().updateNodeData(id, { label: 'Renamed' })
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(true)
    useGraphStore.setState({ nodes: before }, false)
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('content that cannot be projected is dirty — never "unchanged" — and refreshDirty does not throw', () => {
    promote()
    addBadNode()
    expect(() => useProjectStore.getState().refreshDirty()).not.toThrow()
    expect(useProjectStore.getState().dirty).toBe(true)
  })

  it('the warning is written once per cause, not once per edit; it comes back only after the content projected again', () => {
    promote()
    addBadNode()
    useProjectStore.getState().refreshDirty()
    useGraphStore.getState().addNodeAt('source', { x: 300, y: 0 }) // another edit, the same cause
    useProjectStore.getState().refreshDirty()
    useProjectStore.getState().refreshDirty()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('counts as changed since the last export')
    dropBadNodes()
    useProjectStore.getState().refreshDirty() // projects again: dirty from the edit, no warning
    expect(useProjectStore.getState().dirty).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    addBadNode()
    useProjectStore.getState().refreshDirty()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('the debounced check after an edit (250 ms) no longer throws inside its timer, and sets dirty', () => {
    promote()
    vi.useFakeTimers()
    addBadNode() // the graph subscription schedules the check
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
    expect(useProjectStore.getState().dirty).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
