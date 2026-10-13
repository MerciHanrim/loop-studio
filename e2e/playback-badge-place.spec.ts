import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, routesSettled, test } from './support/loop'

// docs/simulation-playback.md §PB4.8 — the L2 travelling `+N` badge ("T3
// without tail", 2026-10-13): one of four places per connection, fixed for the
// step; shown only while its whole box is clear of both end bodies, on the
// exact geometry. L1, the fast tier's arrival badge and the reduced-motion
// static badge keep today's place and showing. On the Coffee roastery, whose
// three-way fan out of Roasted bean stock stacked its badges before.

const FAN = ['e_online', 'e_cafe_retail', 'e_roasted_bleed']

async function openCoffee(page: Page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await openApp(page)
  await resetAll(page)
  await page.locator('.toolbar__actions .menu').first().locator('> button').click()
  await page.locator('.toolbar__actions .menu').first().locator('.menu__pop [role="menuitem"]', { hasText: 'Coffee roastery operations flow' }).first().click()
  const confirm = page.locator('.mcdlg--confirm')
  if (await confirm.isVisible().catch(() => false)) await confirm.locator('.btn--primary').click()
  await expect.poll(() => page.evaluate(() => (window as any).__loop.graph.getState().nodes.length)).toBeGreaterThan(0)
  await routesSettled(page)
}

const atZoom = (page: Page, zoom: number) =>
  page.evaluate((z) => {
    const l = (window as any).__loop
    const n = l.graph.getState().nodes.find((x: any) => x.id === 'roasted_stock')
    l.rf.setViewport({ x: 640 - n.position.x * z, y: 400 - n.position.y * z, zoom: z }, { duration: 0 })
  }, zoom)

const sim = (page: Page, body: string) => page.evaluate(`(() => { const s = window.__loop.sim.getState(); ${body} })()`)
const settled = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().activeTransitionId)).toBe(null)

/** the step paused at τ (the choreography every frame of a Play draws there) */
const setTau = (page: Page, t: number, tier?: string) =>
  page.evaluate(async ({ t, tier }) => {
    const S = (window as any).__loop.sim
    S.setState({ transition: { ...S.getState().transition, ...(tier ? { tier } : null), tau: t, phase: t < 0.15 ? 'depart' : t < 0.8 ? 'travel' : 'arrive' } })
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  }, { t, tier })

/** every travelling badge on screen: its connection, place, box, and whether
 *  that box meets either end body */
const badges = (page: Page) =>
  page.evaluate(() => {
    const ends = new Map((window as any).__loop.graph.getState().edges.map((e: any) => [e.id, [e.source, e.target]]))
    const box = (el: Element) => el.getBoundingClientRect()
    const meet = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.01 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.01
    return [...document.querySelectorAll('.pb-badge[data-playback-badge="travel"]')].map((el) => {
      const id = el.getAttribute('data-badge-for')!
      const r = box(el)
      const hit = (ends.get(id) as string[]).filter((n) => {
        const b = document.querySelector(`.react-flow__node[data-id="${n}"] .nodef`)
        return b != null && meet(r, box(b))
      })
      return { id, side: el.getAttribute('data-badge-side')!, r: { l: r.left, t: r.top, rr: r.right, b: r.bottom }, hit }
    })
  })

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null }).catch(() => {})
})

test('L2: one place per connection for the whole step, the fan apart, and never a shown badge over an end body', async ({ page }) => {
  test.setTimeout(90_000)
  await openCoffee(page)
  await atZoom(page, 1)
  for (let i = 0; i < 3; i++) {
    await sim(page, 's.setSpeed(600); s.stepOnce()')
    await settled(page)
  }
  await sim(page, 's.setSpeed(3500); s.stepOnce(); s.pause()')
  const places = new Map<string, Set<string>>()
  let shownOnFan = 0
  for (let k = 0; k <= 40; k++) {
    await setTau(page, 0.1 + (0.75 * k) / 40)
    const bs = await badges(page)
    for (const b of bs) {
      expect(b.hit, `${b.id} at τ ${(0.1 + (0.75 * k) / 40).toFixed(3)}`).toEqual([])
      ;(places.get(b.id) ?? places.set(b.id, new Set()).get(b.id)!).add(b.side)
    }
    const fan = bs.filter((b) => FAN.includes(b.id))
    shownOnFan += fan.length
    for (let a = 0; a < fan.length; a++)
      for (let c = a + 1; c < fan.length; c++) {
        const p = fan[a]!.r
        const q = fan[c]!.r
        expect(Math.min(p.rr, q.rr) - Math.max(p.l, q.l) > 0.01 && Math.min(p.b, q.b) - Math.max(p.t, q.t) > 0.01, `${fan[a]!.id} / ${fan[c]!.id}`).toBe(false)
      }
  }
  // each connection kept ONE place through the step
  for (const [id, s] of places) expect([...s], id).toHaveLength(1)
  // the three-way fan: three different places, and each badge is shown on the way
  expect(new Set(FAN.map((id) => [...(places.get(id) ?? [])][0])).size).toBe(3)
  expect(shownOnFan).toBeGreaterThan(0)
  for (const id of FAN) expect(places.has(id), id).toBe(true)
})

test('L2: a badge waits while its box still meets the source body', async ({ page }) => {
  await openCoffee(page)
  await atZoom(page, 1)
  await sim(page, 's.setSpeed(3500); s.stepOnce(); s.pause()')
  // just after leaving: today's badge would sit over the source; now it waits
  await setTau(page, 0.16)
  for (const b of await badges(page)) expect(b.hit, b.id).toEqual([])
})

test('L1 keeps today’s badge: up-right, from the departure', async ({ page }) => {
  await openCoffee(page)
  await atZoom(page, 0.64)
  await sim(page, 's.setSpeed(3500); s.stepOnce(); s.pause()')
  await setTau(page, 0.16)
  const bs = await badges(page)
  expect(bs.length).toBeGreaterThan(0)
  for (const b of bs) expect(b.side, b.id).toBe('up-right') // today's place, `right`
  // shown while it still meets its source body, as before
  expect(bs.some((b) => b.hit.length > 0)).toBe(true)
})

test('the fast tier keeps its arrival-only badge in today’s place; reduced motion keeps the static badge', async ({ page }) => {
  await openCoffee(page)
  await atZoom(page, 1)
  await sim(page, 's.setSpeed(3500); s.stepOnce(); s.pause()')
  await setTau(page, 0.5, 'fast')
  expect(await badges(page)).toEqual([])
  await setTau(page, 0.9, 'fast')
  const arrived = await badges(page)
  expect(arrived.length).toBeGreaterThan(0)
  for (const b of arrived) expect(b.side, b.id).toBe('up-right')
  await sim(page, 's.stepOnce()')
  await settled(page)
  await openCoffee(page, true)
  await atZoom(page, 1)
  await sim(page, 's.setSpeed(600); s.stepOnce()')
  await settled(page)
  const held = page.locator('.pb-badge[data-playback-badge="static"]')
  await expect(held.first()).toBeVisible()
  for (const side of await held.evaluateAll((els) => els.map((e) => e.getAttribute('data-badge-side')))) expect(side).toBe('left')
})
