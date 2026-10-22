import { beforeAll, describe, expect, it } from 'vitest'
import type { SavedFrame } from '../../model/serialize'
import { TEMPLATES } from '../../model/templates'
import {
  ensureTemplateLabelDict,
  loadedTemplateFrameLabelDict,
  templateLabelDictLocales,
} from './dicts'
import { KNOWN_OFFICIAL_FRAME_LABELS } from './known.generated'
import { __rebuildOfficialTemplateLabelIndex, relabelFramesForLocale } from './relabel'

// docs/template-label-overlay.md §TLO12 — the frame-title half of the locale
// switch, against the REAL dictionaries and the REAL generated index.
//
// WHY THIS FILE EXISTS BESIDE `frameOverlay.test.ts`
//
// That file stubs `TEMPLATES` with `zone_a` / `zone_b` and its own dictionaries,
// which is right for the pure-function contract — and is exactly why it could
// not see this defect. The bug lived in the GENERATED DATA: `known.generated.ts`
// is produced by `scripts/gen-known-labels.mjs`, which located a locale's frame
// map by searching for `export const <locale>Frames`. For a hyphenated code
// that string never matches the real identifier (`zh-HansFrames` against the
// actual `zhHansFrames`), and the helper returned an EMPTY slice without
// complaining. MEASURED on `f76e6f1`: the six hyphenated locales — `zh-Hans`,
// `zh-Hant`, `es-419`, `es-ES`, `pt-BR`, `pt-PT` — contributed ZERO frame
// titles, so `relabelFramesForLocale` read every one of their frame titles as a
// user rename and preserved it forever. A document created in Simplified
// Chinese kept `对比` in an English UI, while its NODE labels switched
// correctly — the node path never needed the export name, so only frames broke.
//
// The contract below is therefore stated over the shipped data, not a fixture.

beforeAll(async () => {
  for (const loc of templateLabelDictLocales) await ensureTemplateLabelDict(loc)
  __rebuildOfficialTemplateLabelIndex()
})

const frame = (id: string, label: string): SavedFrame => ({
  id,
  label,
  rect: { x: 0, y: 0, w: 100, h: 100 },
})

describe('every shipped frame title is in the known-official index', () => {
  it('no locale silently contributes nothing', () => {
    // The failure this pins is not "a title is wrong" but "a locale was
    // skipped": a generator that cannot find one locale's map must not be able
    // to leave that locale out of the index in silence.
    const contributing: string[] = []
    for (const loc of templateLabelDictLocales) {
      const dict = loadedTemplateFrameLabelDict(loc)
      const titles = Object.values(dict ?? {}).flatMap((m) => Object.values(m))
      if (titles.length > 0) contributing.push(loc)
    }
    expect(contributing.slice().sort()).toEqual(templateLabelDictLocales.slice().sort())
  })

  it('every locale x template x frame title appears in its id’s known set', () => {
    const missing: string[] = []
    let checked = 0
    for (const loc of templateLabelDictLocales) {
      const dict = loadedTemplateFrameLabelDict(loc)
      expect(dict, `${loc}: frame dictionary not resident`).toBeDefined()
      for (const tpl of TEMPLATES) {
        for (const f of tpl.graph.frames ?? []) {
          const label = dict?.[tpl.id]?.[f.id]
          // a locale MAY leave a frame untranslated; then the English title
          // stands, and that one is in the set by construction
          if (label === undefined) continue
          checked++
          const known = KNOWN_OFFICIAL_FRAME_LABELS[f.id]
          if (!known || !known.includes(label)) {
            missing.push(`${loc} ${tpl.id}/${f.id} = ${JSON.stringify(label)}`)
          }
        }
      }
    }
    expect(missing).toEqual([])
    // and the walk was not vacuous
    expect(checked).toBeGreaterThan(0)
  })

  it('the hyphenated locales are covered by name, not only by the loop', () => {
    // Named so that narrowing the loop above can never quietly drop exactly the
    // locales this fix is about.
    for (const loc of ['zh-Hans', 'zh-Hant', 'es-419', 'es-ES', 'pt-BR', 'pt-PT']) {
      expect(templateLabelDictLocales, loc).toContain(loc)
      const dict = loadedTemplateFrameLabelDict(loc)
      const titles = Object.values(dict ?? {}).flatMap((m) => Object.values(m))
      expect(titles.length, `${loc}: no frame titles loaded`).toBeGreaterThan(0)
      for (const t of titles) {
        const ids = Object.entries(KNOWN_OFFICIAL_FRAME_LABELS)
          .filter(([, v]) => v.includes(t))
          .map(([k]) => k)
        expect(ids.length, `${loc}: ${JSON.stringify(t)} is in no known set`).toBeGreaterThan(0)
      }
    }
  })
})

describe('a document seeded in one locale still switches', () => {
  // The four titles the gacha Template writes in Simplified Chinese, taken from
  // `zh-Hans.ts`. This is the shape the reported document had.
  const zhHansGacha = [
    frame('zone_comparison', '对比'),
    frame('zone_free', '常驻／免费'),
    frame('zone_standard', '付费常驻'),
    frame('zone_pickup', '付费 UP'),
  ]

  it('zh-Hans frame titles switch to English', () => {
    const out = relabelFramesForLocale(zhHansGacha, 'en').map((f) => f.label)
    expect(out).toEqual(['Comparison', 'General / Free', 'Premium Standard', 'Premium Pickup'])
  })

  it('zh-Hans frame titles switch to Korean', () => {
    const out = relabelFramesForLocale(zhHansGacha, 'ko').map((f) => f.label)
    expect(out).toEqual([
      '비교',
      '일반(무료)',
      '프리미엄 상시',
      '프리미엄 픽업',
    ])
  })

  it('every shipped locale can be reached from a zh-Hans document', () => {
    const bad: string[] = []
    for (const loc of ['en', ...templateLabelDictLocales]) {
      const out = relabelFramesForLocale(zhHansGacha, loc)
      for (const f of out) {
        // it moved off the Simplified Chinese string, unless the target locale
        // IS zh-Hans or its official title happens to be the same string
        const dict = loc === 'en' ? undefined : loadedTemplateFrameLabelDict(loc)
        const want = dict?.['gacha-banner-zones']?.[f.id]
        const expected =
          want ?? TEMPLATES.find((t) => t.id === 'gacha-banner-zones')!.graph.frames!.find((g) => g.id === f.id)!.label
        if (f.label !== expected) bad.push(`${loc} ${f.id}: got ${f.label}, want ${expected}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('a user rename is still preserved, in every direction', () => {
    const renamed = [frame('zone_comparison', 'My own name'), frame('zone_free', '我的分组')]
    for (const loc of ['en', 'ko', 'zh-Hans', 'th']) {
      const out = relabelFramesForLocale(renamed, loc)
      expect(out.map((f) => f.label), loc).toEqual(['My own name', '我的分组'])
      // unchanged input returns the SAME array reference
      expect(out, loc).toBe(renamed)
    }
  })
})
