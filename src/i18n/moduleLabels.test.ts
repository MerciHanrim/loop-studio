import { describe, expect, it } from 'vitest'
import { BUNDLED_MODULES } from '../model/modules'
import { moduleLabelLocales, moduleLabelOverlay } from './moduleLabels'
import { LOCALES } from './registry'

// docs/bundled-module-label-localization.md — the overlay is keyed by each
// bundled module's own canonical node ids; a typo or a drifted module graph
// must fail here rather than silently leave a node in English or write to an
// id that no longer exists.
//
// The locale list is DERIVED from the registry, not written out here. That is
// the whole point of this file: `zh-Hans`, `zh-Hant` and `fr` each shipped
// with a complete catalog and complete Template labels, and each still
// inserted modules whose node labels were English, because the old version of
// this test looped a hardcoded `['ko', 'ja']` — it could only ever check the
// locales that already worked.

/** every locale a user can pick, minus `en`, whose canonical graph labels ARE
 *  the English text, and minus the dev pseudo-locale */
const NEEDS_OVERLAY = LOCALES.filter((l) => !l.pseudo && l.code !== 'en').map((l) => l.code)

describe('moduleLabelOverlay', () => {
  it('en has no overlay — canonical English labels are kept as authored', () => {
    for (const m of BUNDLED_MODULES) {
      expect(moduleLabelOverlay(m.id, 'en')).toBeUndefined()
    }
  })

  it('an unknown module id has no overlay in any locale', () => {
    for (const locale of NEEDS_OVERLAY) {
      expect(moduleLabelOverlay('not-a-real-module', locale)).toBeUndefined()
    }
  })

  // the guard that was missing: a NEW shipped language with no overlay fails
  // here, before anyone can notice it only by inserting a module and reading
  // English node names in a translated UI
  it('every shipped locale except en has an overlay, and no extra locale does', () => {
    expect([...moduleLabelLocales()].sort()).toEqual([...NEEDS_OVERLAY].sort())
  })

  for (const locale of NEEDS_OVERLAY) {
    it(`${locale}: every bundled module has a complete, non-stale, non-empty overlay`, () => {
      for (const m of BUNDLED_MODULES) {
        const overlay = moduleLabelOverlay(m.id, locale)
        expect(overlay, `${m.id} / ${locale} — no overlay at all`).toBeDefined()
        const canonicalIds = m.doc.nodes.map((n) => n.id)
        const overlayIds = Object.keys(overlay!)

        const missing = canonicalIds.filter((id) => !(id in overlay!))
        expect(missing, `${m.id} / ${locale} — missing label for: ${missing.join(', ')}`).toEqual([])

        const stale = overlayIds.filter((id) => !canonicalIds.includes(id))
        expect(stale, `${m.id} / ${locale} — stale key(s), no such node: ${stale.join(', ')}`).toEqual([])

        for (const id of overlayIds) {
          expect(overlay![id].trim(), `${m.id} / ${locale} / ${id} — empty label`).not.toBe('')
        }
      }
    })
  }

  // Each locale must own its map. This checks OBJECT IDENTITY, not content:
  // two independently written translations may legitimately coincide — the
  // two Chinese scripts already share `分配` for `allocate` and `支出` for
  // `spending`, and a future pair could coincide entirely. What must never
  // happen is two locales pointing at the SAME mutable object, where editing
  // one silently edits the other.
  it('no two locales share the same overlay object', () => {
    const seen = new Map<object, string>()
    for (const locale of NEEDS_OVERLAY) {
      for (const m of BUNDLED_MODULES) {
        const overlay = moduleLabelOverlay(m.id, locale)!
        const prev = seen.get(overlay)
        expect(prev, `${m.id} — ${locale} reuses ${prev}'s overlay object`).toBeUndefined()
        seen.set(overlay, locale)
      }
    }
  })
})
