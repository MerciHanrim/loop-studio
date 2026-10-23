// Node structure — the Coffee roastery Template under the NEW node
// (`?nodes=outside`): reading, pointing, selection and movement of the new node
// on a real bundled document with three zone frames, and the frames' member
// sets under both structures.
//
// Scope (Lumi / Hanrim, 2026-10-12): this verifies the STRUCTURE's operation on
// Coffee. The Template's existing placement is not a constraint on the
// structure; whatever placement adjustment Coffee turns out to need is reported
// separately (share 21-coffee-verification.md), not asserted here. Today's
// structure is untouched without the switch (last test).
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { waitForAppReady } from './support/appReady'

type Loop = {
  graph: { getState: () => any }
  frame: { getState: () => { frames: { id: string; label: string; rect: { x: number; y: number; w: number; h: number } }[] } }
  rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void; getViewport: () => { x: number; y: number; zoom: number }; fitAll?: () => void; fitView: (o?: object) => void }
}

async function openCoffee(page: Page, structure: 'outside' | 'inside'): Promise<void> {
  // the new node is the default; the previous structure is reached by `?nodes=inside`
  await page.goto(structure === 'outside' ? '/' : '/?nodes=inside')
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  // Templates ▸ Coffee roastery (the same path a user takes)
  const menu = page.locator('.toolbar__actions .menu').first()
  await menu.locator('> button').click()
  // File ▸ Templates (docs/workbench.md §WB2.2)
  await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').click()
  await menu.locator('.menu__pop [role="menuitem"]', { hasText: /Coffee roastery/ }).click()
  const confirm = page.locator('.dialog button, .mcdlg button', { hasText: /replace|Load template/i })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.lgr-frame')).toHaveCount(3)
  await expect(page.locator('.react-flow__node')).toHaveCount(23)
  await expect(page.locator('.react-flow__edge path.react-flow__edge-path')).toHaveCount(11)
}

/** pan so that node `id`'s NAME centre sits in the middle of the view at 100 % */
async function centreName(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((nid) => {
    const root = document.querySelector('.react-flow')!.getBoundingClientRect()
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"] .nodef__name`) as HTMLElement
    const v0 = (window as unknown as { __loop: Loop }).__loop.rf.getViewport()
    const nb = el.getBoundingClientRect()
    // the name's centre in flow px, then a viewport that puts it mid-view
    const fx = (nb.left + nb.width / 2 - root.left - v0.x) / v0.zoom
    const fy = (nb.top + nb.height / 2 - root.top - v0.y) / v0.zoom
    const rf = (window as unknown as { __loop: Loop }).__loop.rf
    rf.setViewport({ x: root.width / 2 - fx, y: root.height / 2 - fy, zoom: 1 }, { duration: 0 })
    return { x: root.left + root.width / 2, y: root.top + root.height / 2 }
  }, id)
}

/** the member set of every frame, by the product's rule (body containment) */
async function members(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const { rectContains } = await import('/src/components/frames/frameGeom.ts')
    const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
    const out: Record<string, string[]> = {}
    for (const f of (window as unknown as { __loop: Loop }).__loop.frame.getState().frames) {
      out[f.id] = g.nodes
        .filter((n: any) => { const el = document.querySelector(`.react-flow__node[data-id="${n.id}"] .nodef`) as HTMLElement; return rectContains(f.rect, { x: n.position.x, y: n.position.y, w: el.offsetWidth, h: el.offsetHeight }) })
        .map((n: any) => n.id)
        .sort()
    }
    return out
  })
}

test.describe('node structure — the Coffee roastery Template under the new node', () => {
  test('reading: every node has an outside name, all shown at the whole-diagram fit and inside the view; no name overlaps another body or name', async ({ page }) => {
    await openCoffee(page, 'outside')
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.fitAll!())
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom)).toBeGreaterThan(0)
    const r = await page.evaluate(() => {
      const root = document.querySelector('.react-flow')!.getBoundingClientRect()
      const names = [...document.querySelectorAll('.nodef__name')] as HTMLElement[]
      const bodies = [...document.querySelectorAll('.nodef')] as HTMLElement[]
      const box = (el: HTMLElement) => el.getBoundingClientRect()
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      const idOf = (el: HTMLElement) => el.closest('.react-flow__node')!.getAttribute('data-id')
      let nameName = 0
      let nameBody = 0
      for (const a of names) {
        for (const b of names) if (a !== b && idOf(a)! < idOf(b)! && hit(box(a), box(b))) nameName++
        for (const b of bodies) if (idOf(b) !== idOf(a) && hit(box(a), box(b))) nameBody++
      }
      const inView = names.filter((n) => { const b = box(n); return b.left >= root.left && b.right <= root.right && b.top >= root.top && b.bottom <= root.bottom }).length
      const visible = names.filter((n) => getComputedStyle(n).visibility !== 'hidden').length
      const levels = new Set(bodies.flatMap((b) => [...b.classList].filter((c) => /^lod-L\d$/.test(c))))
      return { names: names.length, visible, inView, nameName, nameBody, levels: [...levels], zoom: (window as unknown as { __loop: Loop }).__loop.rf.getViewport().zoom }
    })
    expect(r.names).toBe(23)
    expect(r.visible, 'names are shown at the fit (level 1 or above)').toBe(23)
    // the three money proxies carry the example's dollar unit (rev 13), on the value row
    for (const id of ['projected_revenue', 'planned_cost', 'projected_operating_margin']) {
      await expect(page.locator(`.react-flow__node[data-id="${id}"] .nodef__unit`)).toHaveText('$/day')
    }
    // the fit may land at any level: at 1280 × 800 with the default panels it is
    // 0.364, level 0, which keeps the names since 2026-10-20 (Lumi; level 0 had
    // hidden every one of them) — the names' own visibility is the check above.
    // Which level the whole-diagram fit SHOULD reach is not decided; what is
    // decided is that the level is the zoom's, by the one rule
    // (src/components/lod.ts, docs/visual-language.md §VL7.2)
    const ruled = await page.evaluate(async (z) => (await import('/src/components/lod.ts')).lodFor(z), r.zoom)
    expect(r.levels, `one level for the whole view, the one zoom ${r.zoom} gives`).toEqual([`lod-${ruled}`])
    expect(r.inView, 'the whole-diagram fit contains every name').toBe(23)
    expect(r.nameName).toBe(0)
    expect(r.nameBody).toBe(0)
  })

  test('pointing: each name answers as its own node; a hover on a name marks that node alone', async ({ page }) => {
    await openCoffee(page, 'outside')
    const ids: string[] = await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.map((n: any) => n.id))
    const wrong: string[] = []
    for (const id of ids) {
      const c = await centreName(page, id)
      await page.waitForTimeout(30)
      const who = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') ?? null, [c.x, c.y])
      if (who !== id) wrong.push(`${id} → ${who}`)
    }
    expect(wrong, 'every name centre answers as its node').toEqual([])
    const c = await centreName(page, 'roasted_stock')
    await page.mouse.move(c.x, c.y)
    await expect(page.locator('.nodef.is-hover')).toHaveCount(1)
    await expect(page.locator('.react-flow__node[data-id="roasted_stock"] .nodef')).toHaveClass(/is-hover/)
    await page.mouse.move(5, 5)
    await expect(page.locator('.nodef.is-hover')).toHaveCount(0)
  })

  test('selection and movement: a click on the name selects the node; a drag of the name moves it and keeps its frame, undone', async ({ page }) => {
    await openCoffee(page, 'outside')
    const before = await members(page)
    const c = await centreName(page, 'roasted_stock')
    await page.mouse.click(c.x, c.y)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().selectedNodeId)).toBe('roasted_stock')
    await page.keyboard.press('Escape')
    const posOf = () => page.evaluate(() => { const n = (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.find((x: any) => x.id === 'roasted_stock'); return { x: n.position.x, y: n.position.y } })
    const p0 = await posOf()
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    await page.mouse.move(c.x + 12, c.y + 6)
    await page.mouse.move(c.x + 48, c.y + 24, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => { const p = await posOf(); return p.x !== p0.x || p.y !== p0.y }).toBe(true)
    const p1 = await posOf()
    expect(p1.x).toBeGreaterThanOrEqual(p0.x + 24)
    expect(p1.x).toBeLessThanOrEqual(p0.x + 64)
    expect(p1.y).toBeGreaterThanOrEqual(p0.y + 8)
    expect(p1.y).toBeLessThanOrEqual(p0.y + 40)
    // a move inside its zone: the frames hold the same sets
    expect(await members(page)).toEqual(before)
    await page.keyboard.press('Control+z')
    await expect.poll(posOf).toEqual(p0)
  })

  test('frames: the three zone frames hold the same member sets under both structures', async ({ page }) => {
    await openCoffee(page, 'outside')
    const outside = await members(page)
    await openCoffee(page, 'inside')
    const inside = await members(page)
    expect(Object.keys(outside).sort()).toEqual(['zone_forecast', 'zone_roasting', 'zone_supply'])
    expect(outside).toEqual(inside)
    expect(outside.zone_supply.length + outside.zone_roasting.length + outside.zone_forecast.length).toBe(18)
  })

  test("today's structure is untouched without the switch", async ({ page }) => {
    await openCoffee(page, 'inside')
    await expect(page.locator('.nodef--outside')).toHaveCount(0)
    await expect(page.locator('.nodef__name')).toHaveCount(0)
    await expect(page.locator('.nodef__title')).toHaveCount(23)
    await expect(page.locator('.lgr-frame__edge-hit')).toHaveCount(12)
  })
})
