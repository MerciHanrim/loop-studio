import { describe, expect, it } from 'vitest'
import type { ModuleProvenanceSnapshot } from '../model/moduleProvenance'
import type { LoopNode } from '../model/types'
import { relabelModuleNodesForLocale } from './moduleLabelSync'

// docs/bundled-module-label-localization.md §MLS3.1 / §MLS4.3 — the pure
// per-instance relabel rule. A node is switched iff its CURRENT label is
// EXACTLY the `lastAppliedLabel` this feature itself last recorded for it;
// anything else means something else changed it since (almost always a user
// edit) and the node is detached from its provenance snapshot PERMANENTLY —
// never re-examined by string content again (review round 2, 2026-09-15:
// the retired "official in ANY shipped locale" rule wrongly re-adopted a
// user rename that happened to coincide with another locale's official
// string).

const node = (id: string, label: string): LoopNode =>
  ({ id, type: 'source', position: { x: 0, y: 0 }, data: { label } }) as unknown as LoopNode

const prov = (
  entries: readonly (readonly [string, { moduleId: string; canonicalId: string; lastAppliedLabel: string }])[],
): ModuleProvenanceSnapshot => entries

describe('relabelModuleNodesForLocale', () => {
  it('switches a provenance-tracked node whose label matches its recorded lastAppliedLabel', () => {
    const p0 = prov([['n1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }]])
    const r1 = relabelModuleNodesForLocale([node('n1', 'Supply')], 'ko', p0)
    expect(r1.nodes[0].data.label).toBe('공급원')
    expect(r1.provenance[0][1].lastAppliedLabel).toBe('공급원') // bookkeeping follows the write

    const r2 = relabelModuleNodesForLocale(r1.nodes, 'ja', r1.provenance)
    expect(r2.nodes[0].data.label).toBe('供給元')

    const r3 = relabelModuleNodesForLocale(r2.nodes, 'en', r2.provenance)
    expect(r3.nodes[0].data.label).toBe('Supply')
  })

  it('[P1] a user rename to ANOTHER locale\'s official string is preserved through every later switch', () => {
    // inserted in EN ("Supply"), then the user directly retypes it as the
    // official KO string — this must NOT be treated as still-managed, even
    // though "공급원" is a real official label in some locale.
    const p0 = prov([['n1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }]])
    const renamed = [node('n1', '공급원')] // user edit, lastAppliedLabel still says "Supply"

    const toKo = relabelModuleNodesForLocale(renamed, 'ko', p0)
    expect(toKo.nodes[0].data.label).toBe('공급원') // unchanged
    expect(toKo.provenance).toEqual([]) // detached

    const toJa = relabelModuleNodesForLocale(toKo.nodes, 'ja', toKo.provenance)
    expect(toJa.nodes[0].data.label).toBe('공급원')
    expect(toJa.provenance).toEqual([])

    const toEn = relabelModuleNodesForLocale(toJa.nodes, 'en', toJa.provenance)
    expect(toEn.nodes[0].data.label).toBe('공급원')
  })

  it('leaves an arbitrary user-edited label untouched and detaches it', () => {
    const p0 = prov([['n1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }]])
    const r = relabelModuleNodesForLocale([node('n1', 'My Own Source')], 'ko', p0)
    expect(r.nodes[0].data.label).toBe('My Own Source')
    expect(r.provenance).toEqual([])
  })

  it('within one instance, only the still-managed nodes keep translating', () => {
    const p0 = prov([
      ['n1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }],
      ['n2', { moduleId: 'buffered-step', canonicalId: 'inbox', lastAppliedLabel: 'Inbox' }],
    ])
    const r = relabelModuleNodesForLocale([node('n1', 'Renamed by user'), node('n2', 'Inbox')], 'ko', p0)
    expect(r.nodes[0].data.label).toBe('Renamed by user')
    expect(r.nodes[1].data.label).toBe('입고 대기')
    expect(r.provenance.map(([id]) => id)).toEqual(['n2']) // n1 detached, n2 stays
  })

  it('tracks two instances of the same module independently', () => {
    const p0 = prov([
      ['n1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }],
      ['n2', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }],
    ])
    const r = relabelModuleNodesForLocale([node('n1', 'Supply'), node('n2', 'Renamed')], 'ko', p0)
    expect(r.nodes[0].data.label).toBe('공급원')
    expect(r.nodes[1].data.label).toBe('Renamed')
  })

  it('leaves a node with no provenance entry untouched', () => {
    const nodes = [node('plain', 'Supply')]
    const r = relabelModuleNodesForLocale(nodes, 'ko', [])
    expect(r.nodes).toBe(nodes)
    expect(r.nodes[0].data.label).toBe('Supply')
  })

  it('is idempotent — a same-locale re-apply keeps the same node AND provenance references', () => {
    const p0 = prov([['n1', { moduleId: 'buffered-step', canonicalId: 'supply', lastAppliedLabel: 'Supply' }]])
    const r1 = relabelModuleNodesForLocale([node('n1', 'Supply')], 'ko', p0)
    const r2 = relabelModuleNodesForLocale(r1.nodes, 'ko', r1.provenance)
    expect(r2.nodes).toBe(r1.nodes)
    expect(r2.provenance).toBe(r1.provenance)
  })

  it('an empty provenance snapshot is a no-op, same references', () => {
    const nodes = [node('n1', 'Supply')]
    const r = relabelModuleNodesForLocale(nodes, 'ko', [])
    expect(r.nodes).toBe(nodes)
    expect(r.provenance).toEqual([])
  })

  it('falls back to the EN canonical when the target locale has no overlay entry', () => {
    const p0 = prov([['n1', { moduleId: 'reward-split', canonicalId: 'activity', lastAppliedLabel: 'Activity' }]])
    const r = relabelModuleNodesForLocale([node('n1', 'Activity')], 'en', p0)
    expect(r.nodes[0].data.label).toBe('Activity')
  })
})
