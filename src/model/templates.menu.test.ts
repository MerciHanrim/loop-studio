import { describe, expect, it } from 'vitest'
import { MENU_TEMPLATES, TEMPLATES } from './templates'

// 0.28.1 (Hanrim / Lumi, 2026-10-14) took Early MMO out of the menu as a
// developer stress fixture; 0.30.0 (Hanrim / Lumi, 2026-10-24) puts it back,
// unchanged: the same entry, its start framing and its edit lock. `menu: false`
// stays available for a Template that should not be offered; none uses it now.

describe('the Templates the menu offers', () => {
  it('are every Template, in the same order (Coffee → MMO → Gacha)', () => {
    // 2026-10-20: the general gacha (docs/gacha-general.md), the standard
    // gacha (docs/gacha-standard.md) and the pickup gacha (docs/gacha-pickup.md),
    // before the 3-zone comparison
    expect(MENU_TEMPLATES.map((t) => t.id)).toEqual([
      'equilibrium',
      'deadlock',
      'coffee-roastery',
      'mmo-progression',
      'gacha-general',
      'gacha-standard',
      'gacha-pickup',
      'gacha-banner-zones',
    ])
    expect(TEMPLATES.filter((t) => t.menu === false)).toEqual([])
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
