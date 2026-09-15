import { beforeEach, describe, expect, it } from 'vitest'
import {
  __setModuleProvenanceForTest,
  clearModuleProvenance,
  detachModuleProvenance,
  moduleProvenanceFor,
  moduleProvenanceSnapshot,
  registerModuleProvenance,
  restoreModuleProvenanceSnapshot,
} from './moduleProvenance'

// docs/bundled-module-label-localization.md §MLS3 / §MLS3.2 — the session-only
// node-id -> (moduleId, canonicalId, lastAppliedLabel) registry, and its
// history-sidecar snapshot/restore pair.

beforeEach(() => {
  clearModuleProvenance()
})

describe('registerModuleProvenance / moduleProvenanceFor', () => {
  it('registers every entry under the given moduleId, with lastAppliedLabel = the applied label', () => {
    registerModuleProvenance(
      [
        { freshId: 'n1', canonicalId: 'supply', label: 'Supply' },
        { freshId: 'n2', canonicalId: 'inbox', label: '입고 대기' },
      ],
      'buffered-step',
    )
    expect(moduleProvenanceFor('n1')).toEqual({ moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' })
    expect(moduleProvenanceFor('n2')).toEqual({ moduleId: 'buffered-step', canonicalId: 'inbox', lastAppliedLabel: '입고 대기' })
  })

  it('is a no-op when moduleId is undefined (a file-inserted module)', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], undefined)
    expect(moduleProvenanceFor('n1')).toBeUndefined()
  })

  it('returns undefined for an untracked node id', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    expect(moduleProvenanceFor('does-not-exist')).toBeUndefined()
  })

  it('tracks two instances of the same module independently (different fresh ids)', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    registerModuleProvenance([{ freshId: 'n2', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    expect(moduleProvenanceFor('n1')?.canonicalId).toBe('supply')
    expect(moduleProvenanceFor('n2')?.canonicalId).toBe('supply')
  })
})

describe('clearModuleProvenance', () => {
  it('wipes every entry', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    clearModuleProvenance()
    expect(moduleProvenanceFor('n1')).toBeUndefined()
    expect(moduleProvenanceSnapshot()).toEqual([])
  })
})

describe('moduleProvenanceSnapshot / restoreModuleProvenanceSnapshot', () => {
  it('round-trips through a snapshot', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    const snap = moduleProvenanceSnapshot()
    clearModuleProvenance()
    expect(moduleProvenanceFor('n1')).toBeUndefined()
    restoreModuleProvenanceSnapshot(snap)
    expect(moduleProvenanceFor('n1')).toEqual({ moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' })
  })

  it('treats null/undefined as empty', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    restoreModuleProvenanceSnapshot(null)
    expect(moduleProvenanceFor('n1')).toBeUndefined()
    expect(moduleProvenanceSnapshot()).toEqual([])
  })
})

describe('detachModuleProvenance', () => {
  it('removes exactly the given node id from the LIVE map', () => {
    registerModuleProvenance(
      [
        { freshId: 'n1', canonicalId: 'supply', label: 'Supply' },
        { freshId: 'n2', canonicalId: 'inbox', label: 'Inbox' },
      ],
      'buffered-step',
    )
    detachModuleProvenance('n1')
    expect(moduleProvenanceFor('n1')).toBeUndefined()
    expect(moduleProvenanceFor('n2')).toBeDefined()
  })

  it('is a no-op for an id with no provenance', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    detachModuleProvenance('does-not-exist')
    expect(moduleProvenanceFor('n1')).toBeDefined()
  })

  it('is idempotent — detaching twice is the same as once', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    detachModuleProvenance('n1')
    detachModuleProvenance('n1')
    expect(moduleProvenanceFor('n1')).toBeUndefined()
  })
})

describe('__setModuleProvenanceForTest', () => {
  it('replaces the map wholesale', () => {
    registerModuleProvenance([{ freshId: 'n1', canonicalId: 'supply', label: 'Supply' }], 'buffered-step')
    __setModuleProvenanceForTest(
      new Map([['n9', { moduleId: 'reward-split', canonicalId: 'wallet', lastAppliedLabel: 'Wallet' }]]),
    )
    expect(moduleProvenanceFor('n1')).toBeUndefined()
    expect(moduleProvenanceFor('n9')).toEqual({ moduleId: 'reward-split', canonicalId: 'wallet', lastAppliedLabel: 'Wallet' })
  })
})
