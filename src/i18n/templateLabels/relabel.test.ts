import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LoopNode } from '../../model/types'
import {
  __resetTemplateLabelDicts,
  ensureTemplateLabelDict,
} from './dicts'
import {
  __rebuildOfficialTemplateLabelIndex,
  officialTemplateLabelIndex,
  relabelNodesForLocale,
} from './relabel'

// docs/template-label-overlay.md §TLO11 — the safe, exact-match locale switch of
// OFFICIAL bundled-template node labels. Pure-function level here; the graph +
// undo-history wiring is covered by src/store/relabelOnLocaleSwitch.test.ts.
//
// docs/localization.md §L4.5 — per-locale dicts are lazy chunks; a real switch
// loads the target dict first (src/i18n/store.ts). Mirror that here.

async function loadAllDicts() {
  await ensureTemplateLabelDict('ko')
  await ensureTemplateLabelDict('ja')
  __rebuildOfficialTemplateLabelIndex()
}

beforeAll(loadAllDicts)
afterEach(loadAllDicts) // a test that reset the dicts restores them

const node = (id: string, label: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { label } }) as unknown as LoopNode

const labels = (ns: readonly LoopNode[]) => ns.map((n) => n.data.label)

describe('officialTemplateLabelIndex', () => {
  it('collects every shipped-locale string for a shared node id (from the static seed)', () => {
    // `known` is the build-time seed — complete WITHOUT any dict loaded
    __resetTemplateLabelDicts()
    __rebuildOfficialTemplateLabelIndex()
    const idx = officialTemplateLabelIndex()
    expect([...(idx.known.get('level') ?? [])].sort()).toEqual(['Level', 'レベル', '레벨'])
  })

  it('resolves a per-locale target label once that locale is resident', () => {
    const idx = officialTemplateLabelIndex()
    expect(idx.byLocale.get('en')?.get('level')).toBe('Level')
    expect(idx.byLocale.get('ko')?.get('level')).toBe('레벨')
    expect(idx.byLocale.get('ja')?.get('level')).toBe('レベル')
  })

  it('covers the production-line templates that share node ids', () => {
    const idx = officialTemplateLabelIndex()
    // tpl-src is in BOTH equilibrium and deadlock — identical in every locale
    expect(idx.byLocale.get('ja')?.get('tpl-src')).toBe('原料供給')
    expect(idx.ambiguous.has('tpl-src')).toBe(false)
  })

  it('has NO ambiguous shared id — the §TLO11 drift contract', () => {
    expect([...officialTemplateLabelIndex().ambiguous]).toEqual([])
  })
})

describe('relabelNodesForLocale', () => {
  it('switches an official label to the target locale', () => {
    const out = relabelNodesForLocale([node('level', '레벨'), node('gold', '골드')], 'ja')
    expect(labels(out)).toEqual(['レベル', 'ゴールド'])
  })

  it('switches back to the English canonical', () => {
    const out = relabelNodesForLocale([node('level', 'レベル')], 'en')
    expect(labels(out)).toEqual(['Level'])
  })

  it('preserves a user-renamed label (not one of the official strings)', () => {
    const input = [node('level', 'My hero level')]
    const out = relabelNodesForLocale(input, 'ja')
    expect(out).toBe(input) // same reference — nothing changed
    expect(labels(out)).toEqual(['My hero level'])
  })

  it('preserves a `Foo 2` de-dup suffix', () => {
    const out = relabelNodesForLocale([node('gold', '골드 2')], 'ja')
    expect(labels(out)).toEqual(['골드 2'])
  })

  it('ignores a node whose id is not a bundled-template id', () => {
    const out = relabelNodesForLocale([node('n7', '레벨')], 'ja')
    expect(labels(out)).toEqual(['레벨'])
  })

  it('is idempotent — same locale value returns the same array reference', () => {
    const input = [node('level', 'レベル'), node('gold', 'ゴールド')]
    expect(relabelNodesForLocale(input, 'ja')).toBe(input)
  })

  it('falls back to the English canonical for an unknown target locale', () => {
    const out = relabelNodesForLocale([node('level', '레벨')], 'fr')
    expect(labels(out)).toEqual(['Level'])
  })

  it('switches only the official nodes in a mixed graph', () => {
    const input = [
      node('level', '레벨'),
      node('gold', 'my gold'), // user-renamed
      node('xp', '경험치'),
    ]
    const out = relabelNodesForLocale(input, 'ja')
    expect(out).not.toBe(input)
    expect(labels(out)).toEqual(['レベル', 'my gold', '経験値'])
  })

  it('switches the shared production-line ids', () => {
    const out = relabelNodesForLocale(
      [node('tpl-src', '원료 공급'), node('tpl-conv', '가공')],
      'ja',
    )
    expect(labels(out)).toEqual(['原料供給', '加工'])
  })

  it('still classifies a label from a NOT-yet-loaded locale as official (provenance-agnostic seed)', () => {
    // only KO is resident; a node carrying its JA official label must still be
    // recognised as "official" (→ switched), not treated as a user rename
    __resetTemplateLabelDicts()
    __rebuildOfficialTemplateLabelIndex()
    return ensureTemplateLabelDict('ko').then(() => {
      __rebuildOfficialTemplateLabelIndex()
      const out = relabelNodesForLocale([node('level', 'レベル' /* JA, unloaded */)], 'ko')
      expect(labels(out)).toEqual(['레벨'])
    })
  })

  it('a registered locale whose dict is not resident leaves the nodes untouched (no half-English)', () => {
    __resetTemplateLabelDicts()
    __rebuildOfficialTemplateLabelIndex()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = [node('level', 'Level'), node('gold', 'Gold')]
    const out = relabelNodesForLocale(input, 'ja') // 'ja' registered, dict absent
    expect(out).toBe(input) // same reference — nothing rewritten
    expect(labels(out)).toEqual(['Level', 'Gold'])
    expect(err).toHaveBeenCalled()
  })
})
