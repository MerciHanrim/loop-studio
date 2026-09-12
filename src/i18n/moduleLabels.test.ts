import { describe, expect, it } from 'vitest'
import { BUNDLED_MODULES } from '../model/modules'
import { moduleLabelOverlay } from './moduleLabels'

// docs/bundled-module-label-localization.md — the overlay is keyed by each
// bundled module's own canonical node ids; a typo or a drifted module graph
// must fail here rather than silently leave a node in English or write to an
// id that no longer exists.

describe('moduleLabelOverlay', () => {
  it('en has no overlay — canonical English labels are kept as authored', () => {
    for (const m of BUNDLED_MODULES) {
      expect(moduleLabelOverlay(m.id, 'en')).toBeUndefined()
    }
  })

  it('an unknown module id has no overlay in any locale', () => {
    expect(moduleLabelOverlay('not-a-real-module', 'ko')).toBeUndefined()
    expect(moduleLabelOverlay('not-a-real-module', 'ja')).toBeUndefined()
  })

  for (const locale of ['ko', 'ja'] as const) {
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
})
