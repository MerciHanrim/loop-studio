import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MessageCatalog } from '../i18n/locales/en'
import enCatalog from '../i18n/locales/en'
import jaCatalog from '../i18n/locales/ja'
import koCatalog from '../i18n/locales/ko'
import { useI18n } from '../i18n/store'
import { ensureTemplateLabelDict } from '../i18n/templateLabels/dicts'
import {
  clearModuleProvenance,
  moduleProvenanceFor,
  registerModuleProvenance,
  type ModuleProvenanceSnapshot,
} from '../model/moduleProvenance'
import type { LoopNode } from '../model/types'
import { useGraphStore } from './graphStore'

// docs/template-label-overlay.md §TLO11 — a UI-language change re-seeds the
// OFFICIAL bundled-template node labels in the live graph AND the undo/redo
// history. Label-only: no `simulationRev` bump, no history entry. Idempotent.
// The `useI18n.subscribe` wiring lives at the bottom of graphStore.ts; importing
// the store here registers it.
//
// docs/localization.md §L4.5 — `setLocale` loads the target template-label dict
// BEFORE it flips `activeLocale`; `activate()` below mirrors the post-load
// commit, so the dicts are pre-loaded once here.

beforeAll(async () => {
  await ensureTemplateLabelDict('ko')
  await ensureTemplateLabelDict('ja')
})

const node = (id: string, label: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { label } }) as unknown as LoopNode

const historyEntry = (nodes: LoopNode[], m: ModuleProvenanceSnapshot = []) => ({
  nodes,
  edges: [],
  modelVersion: 1 as const,
  sidecar: { p: null, f: null, d: null, m },
})

const activate = (code: string, catalog: MessageCatalog) =>
  useI18n.setState({ activeLocale: code, activeCatalog: catalog, requestedLocale: code })

const liveLabels = () => useGraphStore.getState().nodes.map((n) => n.data.label)

beforeEach(() => {
  activate('en', enCatalog)
  useGraphStore.setState({ nodes: [], past: [], future: [], simulationRev: 0 })
  clearModuleProvenance()
})

afterEach(() => {
  activate('en', enCatalog)
  useGraphStore.setState({ nodes: [], past: [], future: [] })
  clearModuleProvenance()
})

describe('official template label — locale switch (§TLO11)', () => {
  it('switches the official labels in the live graph, keeps a user rename', () => {
    useGraphStore.setState({
      nodes: [node('level', 'Level'), node('gold', 'my stash'), node('xp', 'XP')],
    })
    activate('ko', koCatalog)
    expect(liveLabels()).toEqual(['레벨', 'my stash', '경험치'])

    activate('ja', jaCatalog)
    expect(liveLabels()).toEqual(['レベル', 'my stash', '経験値'])

    activate('en', enCatalog)
    expect(liveLabels()).toEqual(['Level', 'my stash', 'XP'])
  })

  it('remaps the undo/redo history so a later undo cannot resurrect the old language', () => {
    useGraphStore.setState({
      nodes: [node('level', 'Level')],
      past: [historyEntry([node('level', 'Level'), node('gold', 'Gold')])],
      future: [historyEntry([node('xp', 'XP')])],
    })
    activate('ja', jaCatalog)

    expect(useGraphStore.getState().past[0].nodes.map((n) => n.data.label)).toEqual([
      'レベル',
      'ゴールド',
    ])
    expect(useGraphStore.getState().future[0].nodes.map((n) => n.data.label)).toEqual(['経験値'])
  })

  it('does not bump simulationRev', () => {
    useGraphStore.setState({ nodes: [node('level', 'Level')], simulationRev: 7 })
    activate('ja', jaCatalog)
    expect(useGraphStore.getState().simulationRev).toBe(7)
  })

  it('re-selecting the same locale is a no-op (same nodes reference)', () => {
    useGraphStore.setState({ nodes: [node('level', 'Level')] })
    activate('ja', jaCatalog)
    const after = useGraphStore.getState().nodes
    activate('ja', jaCatalog) // same locale again
    expect(useGraphStore.getState().nodes).toBe(after)
  })

  it('is idempotent — a switch that needs no change leaves the nodes reference intact', () => {
    // graph already carries the JA labels; a switch to ja must not rewrite them
    useGraphStore.setState({ nodes: [node('level', 'レベル'), node('gold', 'ゴールド')] })
    const before = useGraphStore.getState().nodes
    activate('ja', jaCatalog)
    expect(useGraphStore.getState().nodes).toBe(before)
  })

  it('leaves a plain user graph (no official ids) untouched', () => {
    const nodes = [node('n1', 'Bank'), node('n2', 'Faucet')]
    useGraphStore.setState({ nodes })
    activate('ko', koCatalog)
    expect(useGraphStore.getState().nodes).toBe(nodes)
    expect(liveLabels()).toEqual(['Bank', 'Faucet'])
  })
})

// docs/bundled-module-label-localization.md §MLS4.3 — the module-instance
// pass, chained after §TLO11's Template pass in the same subscription.
describe('official bundled-MODULE label — locale switch (§MLS4.3)', () => {
  it('switches a provenance-tracked node label, keeps a user rename', () => {
    registerModuleProvenance(
      [
        { freshId: 'm1', canonicalId: 'supply', label: 'Supply' },
        { freshId: 'm2', canonicalId: 'inbox', label: 'Inbox' }, // inserted as "Inbox"...
      ],
      'buffered-step',
    )
    // ...then the user renamed it to "my inbox" before any switch happened —
    // live label now diverges from the recorded lastAppliedLabel
    useGraphStore.setState({ nodes: [node('m1', 'Supply'), node('m2', 'my inbox')] })
    activate('ko', koCatalog)
    expect(liveLabels()).toEqual(['공급원', 'my inbox'])
    activate('ja', jaCatalog)
    expect(liveLabels()).toEqual(['供給元', 'my inbox'])
    activate('en', enCatalog)
    expect(liveLabels()).toEqual(['Supply', 'my inbox'])
  })

  // [P1] review round 2, 2026-09-15 — a user rename to ANOTHER locale's
  // official string must be preserved forever, not re-adopted because its
  // current text happens to match an official label somewhere.
  it('[P1] a user rename to another locale\'s official string is preserved through every later switch', () => {
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    // the user retypes it as the official KO string directly, in EN
    useGraphStore.setState({ nodes: [node('m1', '공급원')] })

    activate('ko', koCatalog)
    expect(liveLabels()).toEqual(['공급원']) // unchanged
    expect(moduleProvenanceFor('m1')).toBeUndefined() // detached

    activate('ja', jaCatalog)
    expect(liveLabels()).toEqual(['공급원'])
    activate('en', enCatalog)
    expect(liveLabels()).toEqual(['공급원'])
  })

  it('remaps module labels in the undo/redo history too, using EACH entry\'s own provenance', () => {
    const p: ModuleProvenanceSnapshot = [['m1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }]]
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    useGraphStore.setState({
      nodes: [node('m1', 'Supply')],
      past: [historyEntry([node('m1', 'Supply')], p)],
      future: [historyEntry([node('m1', 'Supply')], p)],
    })
    activate('ja', jaCatalog)
    expect(useGraphStore.getState().past[0].nodes.map((n) => n.data.label)).toEqual(['供給元'])
    expect(useGraphStore.getState().future[0].nodes.map((n) => n.data.label)).toEqual(['供給元'])
  })

  it('a history entry with NO provenance snapshot is never relabeled, even if the live map still tracks that id', () => {
    // the live map tracks m1, but this particular past entry predates the
    // insert (no `m` at all) -- its own copy of m1 must stay untouched
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    useGraphStore.setState({
      nodes: [node('m1', 'Supply')],
      past: [historyEntry([node('m1', 'Unrelated pre-insert node')])], // sidecar.m = []
    })
    activate('ko', koCatalog)
    expect(useGraphStore.getState().past[0].nodes[0].data.label).toBe('Unrelated pre-insert node')
  })

  it('does not bump simulationRev', () => {
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    useGraphStore.setState({ nodes: [node('m1', 'Supply')], simulationRev: 3 })
    activate('ko', koCatalog)
    expect(useGraphStore.getState().simulationRev).toBe(3)
  })

  it('re-selecting the same locale is a no-op (same nodes reference)', () => {
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    useGraphStore.setState({ nodes: [node('m1', 'Supply')] })
    activate('ja', jaCatalog)
    const after = useGraphStore.getState().nodes
    activate('ja', jaCatalog)
    expect(useGraphStore.getState().nodes).toBe(after)
  })

  it('a node with no provenance is left alone, even alongside a tracked one', () => {
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    const nodes = [node('m1', 'Supply'), node('plain', 'Supply')]
    useGraphStore.setState({ nodes })
    activate('ko', koCatalog)
    expect(liveLabels()).toEqual(['공급원', 'Supply'])
  })

  // [P1] review round 3, 2026-09-15 — through the REAL `updateNodeData`
  // action (which now detaches EAGERLY, at the edit itself): a rename back
  // to the exact original applied text, entirely before any locale switch,
  // must not be re-adopted just because the string content matches again.
  it('[P1] Supply -> My Supply -> Supply via updateNodeData, then a switch, stays Supply', () => {
    registerModuleProvenance([{ freshId: 'm1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    useGraphStore.setState({ nodes: [node('m1', 'Supply')] })

    useGraphStore.getState().updateNodeData('m1', { label: 'My Supply' })
    expect(moduleProvenanceFor('m1')).toBeUndefined()
    useGraphStore.getState().updateNodeData('m1', { label: 'Supply' }) // back to the exact original text
    expect(moduleProvenanceFor('m1')).toBeUndefined() // still detached

    activate('ko', koCatalog)
    expect(liveLabels()).toEqual(['Supply']) // NOT retranslated to 공급원
  })
})
