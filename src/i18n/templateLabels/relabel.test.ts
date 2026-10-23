import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LoopNode } from '../../model/types'
import {
  __resetTemplateLabelDicts,
  ensureTemplateLabelDict,
  templateLabelDictLocales,
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
//
// §L2.0 (2026-10) — English and Korean are the supported languages, so Korean is
// the one dictionary here. The eighteen-locale version of this file is in
// `archive/i18n/tests/relabel.multilocale.test.ts`.

// registry-driven: a language that ships a dictionary adds a DICT_LOADERS entry,
// and this helper must pick it up without being edited again.
async function loadAllDicts() {
  for (const loc of templateLabelDictLocales) await ensureTemplateLabelDict(loc)
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
    // one entry per shipped locale — adding a language adds its string here
    expect([...(idx.known.get('level') ?? [])].sort()).toEqual(['Level', '레벨'])
  })

  it('a label from an archived language is not in the seed — such a node is the user’s', () => {
    // §L2.0 — a document made in Japanese keeps its names: they are no longer
    // official strings, so no locale switch rewrites them
    const idx = officialTemplateLabelIndex()
    expect(idx.known.get('level')?.has('レベル')).toBe(false)
    const input = [node('level', 'レベル')]
    expect(relabelNodesForLocale(input, 'ko')).toBe(input)
    expect(relabelNodesForLocale(input, 'en')).toBe(input)
  })

  it('resolves a per-locale target label once that locale is resident', () => {
    const idx = officialTemplateLabelIndex()
    expect(idx.byLocale.get('en')?.get('level')).toBe('Level')
    expect(idx.byLocale.get('ko')?.get('level')).toBe('레벨')
  })

  it('covers the production-line templates that share node ids', () => {
    const idx = officialTemplateLabelIndex()
    // tpl-src is in BOTH equilibrium and deadlock — identical in every locale
    expect(idx.byLocale.get('ko')?.get('tpl-src')).toBe('원료 공급')
    expect(idx.ambiguous.has('tpl-src')).toBe(false)
  })

  it('has NO ambiguous shared id — the §TLO11 drift contract', () => {
    expect([...officialTemplateLabelIndex().ambiguous]).toEqual([])
  })
})

describe('relabelNodesForLocale', () => {
  it('switches an official label to the target locale', () => {
    const out = relabelNodesForLocale([node('level', 'Level'), node('gold', 'Gold')], 'ko')
    expect(labels(out)).toEqual(['레벨', '골드'])
  })

  it('switches back to the English canonical', () => {
    const out = relabelNodesForLocale([node('level', '레벨')], 'en')
    expect(labels(out)).toEqual(['Level'])
  })

  it('preserves a user-renamed label (not one of the official strings)', () => {
    const input = [node('level', 'My hero level')]
    const out = relabelNodesForLocale(input, 'ko')
    expect(out).toBe(input) // same reference — nothing changed
    expect(labels(out)).toEqual(['My hero level'])
  })

  it('preserves a `Foo 2` de-dup suffix', () => {
    const out = relabelNodesForLocale([node('gold', '골드 2')], 'en')
    expect(labels(out)).toEqual(['골드 2'])
  })

  it('ignores a node whose id is not a bundled-template id', () => {
    const out = relabelNodesForLocale([node('n7', '레벨')], 'en')
    expect(labels(out)).toEqual(['레벨'])
  })

  it('is idempotent — same locale value returns the same array reference', () => {
    const input = [node('level', '레벨'), node('gold', '골드')]
    expect(relabelNodesForLocale(input, 'ko')).toBe(input)
  })

  it('falls back to the English canonical for an unknown target locale', () => {
    // `qaa` is ISO 639-2's permanently reserved local-use range: an "unknown
    // locale" probe must be a code the product can never register, or this row
    // silently starts asserting the opposite of what it was written to assert.
    const out = relabelNodesForLocale([node('level', '레벨')], 'qaa')
    expect(labels(out)).toEqual(['Level'])
  })

  it('switches only the official nodes in a mixed graph', () => {
    const input = [
      node('level', 'Level'),
      node('gold', 'my gold'), // user-renamed
      node('xp', 'XP'),
    ]
    const out = relabelNodesForLocale(input, 'ko')
    expect(out).not.toBe(input)
    expect(labels(out)).toEqual(['레벨', 'my gold', '경험치'])
  })

  it('switches the shared production-line ids', () => {
    const out = relabelNodesForLocale([node('tpl-src', '원료 공급'), node('tpl-conv', '가공')], 'en')
    const idx = officialTemplateLabelIndex()
    expect(labels(out)).toEqual([idx.byLocale.get('en')?.get('tpl-src'), idx.byLocale.get('en')?.get('tpl-conv')])
    expect(labels(out)).not.toContain('원료 공급')
  })

  it('still classifies a label from a NOT-yet-loaded locale as official (provenance-agnostic seed)', () => {
    // no dictionary is resident; a node carrying its KO official label must
    // still be recognised as "official" (→ switched to the base), not treated
    // as a user rename
    __resetTemplateLabelDicts()
    __rebuildOfficialTemplateLabelIndex()
    const out = relabelNodesForLocale([node('level', '레벨' /* KO, unloaded */)], 'en')
    expect(labels(out)).toEqual(['Level'])
  })

  it('a registered locale whose dict is not resident leaves the nodes untouched (no half-English)', () => {
    __resetTemplateLabelDicts()
    __rebuildOfficialTemplateLabelIndex()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = [node('level', 'Level'), node('gold', 'Gold')]
    const out = relabelNodesForLocale(input, 'ko') // 'ko' registered, dict absent
    expect(out).toBe(input) // same reference — nothing rewritten
    expect(labels(out)).toEqual(['Level', 'Gold'])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
