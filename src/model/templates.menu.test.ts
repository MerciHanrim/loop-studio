import { describe, expect, it } from 'vitest'
import { MENU_TEMPLATES, TEMPLATES } from './templates'

// 0.28.1 (Hanrim / Lumi, 2026-10-14) — a Template in the menu is a starting
// point a user can grasp and rebuild; Early MMO is a developer stress fixture.
// It stays in TEMPLATES (its node labels still follow a locale switch in a
// document made from it, and the developer data and checks keep reading it),
// but the menu does not offer it.

describe('the Templates the menu offers', () => {
  it('are every Template but Early MMO, in the same order', () => {
    expect(MENU_TEMPLATES.map((t) => t.id)).toEqual(['equilibrium', 'deadlock', 'coffee-roastery', 'gacha-banner-zones'])
  })
  it('Early MMO stays a Template entry, only not in the menu', () => {
    const mmo = TEMPLATES.find((t) => t.id === 'mmo-progression')
    expect(mmo).toBeDefined()
    expect(mmo!.menu).toBe(false)
    expect(TEMPLATES.filter((t) => t.menu === false).map((t) => t.id)).toEqual(['mmo-progression'])
  })
})
