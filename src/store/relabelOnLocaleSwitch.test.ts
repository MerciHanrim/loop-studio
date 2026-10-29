import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MessageCatalog } from '../i18n/locales/en'
import enCatalog from '../i18n/locales/en'
import koCatalog from '../i18n/locales/ko'
import { useI18n } from '../i18n/store'
import { ensureTemplateLabelDict } from '../i18n/templateLabels/dicts'
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
// commit, so the dict is pre-loaded once here.
//
// The switches below go between English and Korean; any shipped pair behaves
// the same (the per-locale dictionaries are checked in relabel.test.ts). The
// earlier version (Japanese as the second language, and the bundled-module
// pass that was removed with the bundled modules) is in
// `archive/i18n/tests/relabelOnLocaleSwitch.multilocale.test.ts`.

beforeAll(async () => {
  await ensureTemplateLabelDict('ko')
})

const node = (id: string, label: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { label } }) as unknown as LoopNode

const historyEntry = (nodes: LoopNode[]) => ({
  nodes,
  edges: [],
  modelVersion: 1 as const,
  sidecar: { p: null, f: null, d: null },
})

const activate = (code: string, catalog: MessageCatalog) =>
  useI18n.setState({ activeLocale: code, activeCatalog: catalog, requestedLocale: code })

const liveLabels = () => useGraphStore.getState().nodes.map((n) => n.data.label)

beforeEach(() => {
  activate('en', enCatalog)
  useGraphStore.setState({ nodes: [], past: [], future: [], simulationRev: 0 })
})

afterEach(() => {
  activate('en', enCatalog)
  useGraphStore.setState({ nodes: [], past: [], future: [] })
})

describe('official template label — locale switch (§TLO11)', () => {
  it('switches the official labels in the live graph, keeps a user rename', () => {
    useGraphStore.setState({
      nodes: [node('level', 'Level'), node('gold', 'my stash'), node('xp', 'XP')],
    })
    activate('ko', koCatalog)
    expect(liveLabels()).toEqual(['레벨', 'my stash', '경험치'])

    activate('en', enCatalog)
    expect(liveLabels()).toEqual(['Level', 'my stash', 'XP'])
  })

  it('remaps the undo/redo history so a later undo cannot resurrect the old language', () => {
    useGraphStore.setState({
      nodes: [node('level', 'Level')],
      past: [historyEntry([node('level', 'Level'), node('gold', 'Gold')])],
      future: [historyEntry([node('xp', 'XP')])],
    })
    activate('ko', koCatalog)

    expect(useGraphStore.getState().past[0].nodes.map((n) => n.data.label)).toEqual(['레벨', '골드'])
    expect(useGraphStore.getState().future[0].nodes.map((n) => n.data.label)).toEqual(['경험치'])
  })

  it('does not bump simulationRev', () => {
    useGraphStore.setState({ nodes: [node('level', 'Level')], simulationRev: 7 })
    activate('ko', koCatalog)
    expect(useGraphStore.getState().simulationRev).toBe(7)
  })

  it('re-selecting the same locale is a no-op (same nodes reference)', () => {
    useGraphStore.setState({ nodes: [node('level', 'Level')] })
    activate('ko', koCatalog)
    const after = useGraphStore.getState().nodes
    activate('ko', koCatalog) // same locale again
    expect(useGraphStore.getState().nodes).toBe(after)
  })

  it('is idempotent — a switch that needs no change leaves the nodes reference intact', () => {
    // graph already carries the KO labels; a switch to ko must not rewrite them
    useGraphStore.setState({ nodes: [node('level', '레벨'), node('gold', '골드')] })
    const before = useGraphStore.getState().nodes
    activate('ko', koCatalog)
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
