import { describe, expect, it } from 'vitest'
import { MENU_TEMPLATES, TEMPLATES } from './templates'

// 0.28.1 (Hanrim / Lumi, 2026-10-14) took Early MMO out of the menu as a
// developer stress fixture; 0.30.0 (Hanrim / Lumi, 2026-10-24) puts it back,
// unchanged: the same entry, its start framing and its edit lock. 2026-11-07
// (Hanrim / Lumi): the two basic examples leave the menu, because beside the
// others they show too little. Their files and checks stay.

describe('the Templates the menu offers', () => {
  it('are every Template but the two basic examples, in the same order (Desalination → Coffee roasting batch → Coffee → MMO → Gacha)', () => {
    // 2026-10-20: the general gacha (docs/gacha-general.md), the standard
    // gacha (docs/gacha-standard.md) and the pickup gacha (docs/gacha-pickup.md),
    // before the 3-zone comparison. #471 (2026-11-04): the desalination plant
    // after the two basic examples and before Coffee, so Coffee → MMO → Gacha
    // (Hanrim, 2026-09-13) stays adjacent as decided. 2026-11-14: the coffee roasting
    // batch after the desalination process, the two process examples together
    expect(MENU_TEMPLATES.map((t) => t.id)).toEqual([
      'desalination',
      'coffee-roasting-batch',
      'coffee-roastery',
      'mmo-progression',
      'gacha-general',
      'gacha-standard',
      'gacha-pickup',
      'gacha-banner-zones',
    ])
    expect(TEMPLATES.filter((t) => t.menu === false).map((t) => t.id)).toEqual(['equilibrium', 'deadlock'])
  })
  it('Early MMO comes back with its start framing; it opens editable since issue #428 (locked until v0.31.0)', () => {
    const mmo = TEMPLATES.find((t) => t.id === 'mmo-progression')!
    expect(mmo.initialView).toEqual({
      rect: { x: 44, y: -4, width: 927, height: 368 },
      minZoom: 0.6,
      keep: { x: 48, y: 36, width: 1188, height: 200 },
    })
    expect(mmo.recommendedRunConfig?.canvasLocked).toBeUndefined()
    // the one Template that still opts into the lock, by its own decision (GZ2/GZ3)
    expect(TEMPLATES.filter((t) => t.recommendedRunConfig?.canvasLocked === true).map((t) => t.id)).toEqual(['gacha-banner-zones'])
  })
})
