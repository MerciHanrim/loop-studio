import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, routesSettled, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// docs/workbench.md §WB5 — the left list finds a node and selects it; the view
// moves only as far as it must (Lumi, 2026-10-19): a node already in view does
// not move it, one outside it is brought just inside the canvas at the current
// zoom. Checked at the default 1280 × 800, where the workbench's canvas is
// 664 px wide: the narrowest common desktop size, not a widened one (Lumi,
// 2026-10-20). The geometry is read from the page, not from the reveal code.

type V = { x: number; y: number; zoom: number }
const view = (page: Page) => page.evaluate(() => (window as any).__loop.rf.getViewport() as V)

/** the node's box with its outside name, against the canvas pane */
const placeOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)!
    const b = el.getBoundingClientRect()
    const l = el.querySelector('.nodef__label')?.getBoundingClientRect() ?? b
    const r = { left: Math.min(b.left, l.left), top: Math.min(b.top, l.top), right: Math.max(b.right, l.right), bottom: Math.max(b.bottom, l.bottom) }
    const p = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
    return {
      inside: r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom,
      // the gap to each pane edge (negative: past it)
      gaps: { left: r.left - p.left, right: p.right - r.right, top: r.top - p.top, bottom: p.bottom - r.bottom },
    }
  }, id)

async function openTemplate(page: Page, key: string) {
  await openApp(page)
  await resetAll(page)
  await pickTemplate(page, key)
  const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await routesSettled(page)
}
const openCoffee = (page: Page) => openTemplate(page, 'coffee-roastery')

test.describe('the left list finds and selects a node (§WB5)', () => {
  test('at 1280 × 800: a node off the canvas, found by search, comes just inside at the same zoom', async ({ page }) => {
    await openCoffee(page)
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 })
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
    await routesSettled(page)
    // a node wholly off the canvas, and its name
    const far = await page.evaluate(() => {
      const p = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
      for (const el of document.querySelectorAll('.react-flow__node')) {
        const r = el.getBoundingClientRect()
        if (r.left > p.right || r.top > p.bottom) return { id: (el as HTMLElement).dataset.id!, name: el.querySelector('.nodef__label')?.textContent?.trim() ?? '' }
      }
      return null
    })
    expect(far, 'a node off the canvas at zoom 1').not.toBeNull()
    expect(far!.name.length).toBeGreaterThan(0)
    const before = await view(page)

    await page.locator('.wb-search input').fill(far!.name)
    const row = page.locator(`.wb-left .wb-row[data-node="${far!.id}"]`)
    await expect(row).toBeVisible()
    await row.click()

    await expect.poll(() => page.evaluate(() => (window as any).__loop.graph.getState().selectedNodeId)).toBe(far!.id)
    await expect.poll(async () => (await placeOf(page, far!.id)).inside).toBe(true)
    const after = await view(page)
    expect(after.zoom, 'the zoom is kept').toBe(before.zoom)
    // the smallest move: on each axis that moved, the node ends at the 24 px
    // margin of the edge it came in from — the nearer of that axis's two
    const g = (await placeOf(page, far!.id)).gaps
    if (after.x !== before.x) expect(Math.abs(Math.min(g.left, g.right) - 24), `x gaps ${g.left} / ${g.right}`).toBeLessThan(1.5)
    if (after.y !== before.y) expect(Math.abs(Math.min(g.top, g.bottom) - 24), `y gaps ${g.top} / ${g.bottom}`).toBeLessThan(1.5)
    expect(after.x !== before.x || after.y !== before.y, 'the view moved').toBe(true)
  })

  test('at 1280 × 800: a node already in view is selected and the view does not move', async ({ page }) => {
    await openCoffee(page)
    const near = await page.evaluate(() => {
      const p = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
      for (const el of document.querySelectorAll('.react-flow__node')) {
        const r = el.getBoundingClientRect()
        if (r.left > p.left + 40 && r.right < p.right - 40 && r.top > p.top + 40 && r.bottom < p.bottom - 60) return (el as HTMLElement).dataset.id!
      }
      return null
    })
    expect(near, 'a node well inside the fitted view').not.toBeNull()
    const before = await view(page)
    await page.locator(`.wb-left .wb-row[data-node="${near}"]`).click()
    await expect.poll(() => page.evaluate(() => (window as any).__loop.graph.getState().selectedNodeId)).toBe(near)
    expect(await view(page)).toEqual(before)
  })
})

// 2026-10-20 — a pick from the list selected through React Flow's `setNodes`,
// whose nodes are the DRAWN ones: under Focus mode they carry the fade class,
// and the `replace` changes it sent wrote that class into the document's
// nodes. The picked node stayed faded while selected, and every node faded at
// that moment stayed faded after Focus was turned off. The list now selects
// with the canvas's own `select` changes (`selectOnly`). Read from the page and
// the store: what is drawn faded, and what the document's nodes carry.
test.describe('the left list under Focus mode', () => {
  const focusButton = (page: Page) => page.locator('.wb-status').getByRole('button', { name: 'Focus', exact: true })
  const setFocus = async (page: Page, on: boolean) => {
    if ((await focusButton(page).getAttribute('aria-pressed')) !== String(on)) await focusButton(page).click()
    await expect(focusButton(page)).toHaveAttribute('aria-pressed', String(on))
  }
  const pickInList = (page: Page, id: string) => page.locator(`.wb-left .wb-row[data-node="${id}"]`).click()
  /** the node and its neighbours by the document's connections */
  const focusSetOf = (page: Page, id: string) =>
    page.evaluate((id) => {
      const s = new Set([id])
      for (const e of (window as any).__loop.graph.getState().edges) {
        if (e.source === id) s.add(e.target)
        if (e.target === id) s.add(e.source)
      }
      return [...s].sort()
    }, id)
  /** what the page draws and what the document's elements carry */
  const state = (page: Page) =>
    page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      const drawn = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((el) => el.dataset.id!).sort()
      return {
        selectedNodeId: g.selectedNodeId as string | null,
        selected: g.nodes.filter((n: any) => n.selected).map((n: any) => n.id).sort() as string[],
        unfadedNodes: drawn('.react-flow__node:not(.lgr-deemph)'),
        fadedEdges: drawn('.react-flow__edge.lgr-deemph'),
        // the document's elements never carry a display-only class or `hidden`
        storeClasses: [...g.nodes, ...g.edges].filter((x: any) => x.className || x.hidden).map((x: any) => `${x.id}: ${x.className ?? ''}${x.hidden ? ' hidden' : ''}`) as string[],
      }
    })

  test('A then B from the list: each is shown with its own neighbours; Focus off leaves nothing faded; the document carries no fade', async ({ page }) => {
    await openTemplate(page, 'gacha-general')
    await setFocus(page, true)
    const a = 'roll'
    const b = 'ssr_count'
    const setA = await focusSetOf(page, a)
    const setB = await focusSetOf(page, b)
    expect(setB, 'A is outside B’s focus set, so a fade left on A would show').not.toContain(a)

    await pickInList(page, a)
    await expect.poll(async () => (await state(page)).unfadedNodes).toEqual(setA)
    let s = await state(page)
    expect(s.selectedNodeId).toBe(a)
    expect(s.selected).toEqual([a])
    expect(s.fadedEdges.length, 'the connections outside A’s focus set are faded').toBeGreaterThan(0)
    expect(s.storeClasses).toEqual([])

    await pickInList(page, b)
    await expect.poll(async () => (await state(page)).unfadedNodes).toEqual(setB)
    s = await state(page)
    expect(s.selectedNodeId).toBe(b)
    expect(s.selected).toEqual([b])
    expect(s.unfadedNodes, 'A, picked before, is faded like any node outside B’s set').not.toContain(a)
    expect(s.storeClasses).toEqual([])

    await setFocus(page, false)
    await expect.poll(async () => (await state(page)).fadedEdges).toEqual([])
    s = await state(page)
    expect(s.unfadedNodes.length, 'no node is left faded').toBe(await page.locator('.react-flow__node').count())
    expect(s.selected).toEqual([b])
    expect(s.storeClasses).toEqual([])
  })

  test('a pick from the list and a click on the canvas end the same', async ({ page }) => {
    await openTemplate(page, 'gacha-general')
    await setFocus(page, true)
    await pickInList(page, 'roll')
    await pickInList(page, 'ssr_count')
    await expect.poll(async () => (await state(page)).unfadedNodes).toEqual(await focusSetOf(page, 'ssr_count'))
    const fromList = await state(page)

    // the same two picks by clicking the nodes, each centred first so no panel covers it
    const click = async (id: string) => {
      await page.evaluate((id) => (window as any).__loop.rf.fitView({ nodes: [{ id }], duration: 0, maxZoom: 1, padding: 1.5 }), id)
      await page.locator(`.react-flow__node[data-id="${id}"] .nodef__shape`).click({ force: true })
      await expect.poll(() => page.evaluate(() => (window as any).__loop.graph.getState().selectedNodeId)).toBe(id)
    }
    await click('roll')
    await click('ssr_count')
    await expect.poll(async () => (await state(page)).unfadedNodes).toEqual(fromList.unfadedNodes)
    expect(await state(page)).toEqual(fromList)
  })

  test('a node off the canvas, picked from the list under Focus, still comes just inside, selected and not faded', async ({ page }) => {
    await openTemplate(page, 'gacha-general')
    await setFocus(page, true)
    // a node picked first, so the far one is faded when it is picked
    await pickInList(page, 'target_pulls')
    await expect.poll(async () => (await state(page)).unfadedNodes).toEqual(await focusSetOf(page, 'target_pulls'))
    await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 }))
    await routesSettled(page)
    const far = await page.evaluate(() => {
      const p = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
      for (const el of document.querySelectorAll('.react-flow__node')) {
        const r = el.getBoundingClientRect()
        if (r.left > p.right || r.top > p.bottom) return (el as HTMLElement).dataset.id!
      }
      return null
    })
    expect(far, 'a node off the canvas at zoom 1').not.toBeNull()
    const before = await view(page)
    await pickInList(page, far!)
    await expect.poll(async () => (await placeOf(page, far!)).inside).toBe(true)
    expect((await view(page)).zoom, 'the zoom is kept').toBe(before.zoom)
    await expect.poll(async () => (await state(page)).unfadedNodes).toEqual(await focusSetOf(page, far!))
    const s = await state(page)
    expect(s.selectedNodeId).toBe(far)
    expect(s.storeClasses).toEqual([])
  })
})

// A row's value (2026-10-25, v0.30.1): the name gives way first. A short value
// is shown whole beside a long name; only a value wider than a third of the
// row is cut short, and the row's name and the value's tooltip still carry it
// whole. Name and value never overlap and stay inside the row.
const LONG = 'Premium Standard · Hard pity ceiling for the pickup zone'
const VALUES = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'p_ten', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: `${LONG} A`, value: 10 } },
    { id: 'p_two', type: 'parameter', position: { x: 0, y: 120 }, data: { kind: 'parameter', label: `${LONG} B`, value: 200 } },
    { id: 'p_big', type: 'parameter', position: { x: 0, y: 240 }, data: { kind: 'parameter', label: `${LONG} C`, value: 123456789012.75 } },
    { id: 'p_short', type: 'parameter', position: { x: 0, y: 360 }, data: { kind: 'parameter', label: 'Rate', value: 123456789012.75 } },
  ],
  edges: [],
})

test.describe('the left list shows each value beside its name', () => {
  test('at 1280 × 800: 10 and 200 whole beside a long name; a very long value cut within a third of the row', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, VALUES)
    const read = (id: string) =>
      page.evaluate((id) => {
        const row = document.querySelector(`.wb-row[data-node="${id}"]`) as HTMLElement
        const name = row.querySelector('.wb-row__name') as HTMLElement
        const val = row.querySelector('.wb-row__val') as HTMLElement
        const rr = row.getBoundingClientRect()
        const nr = name.getBoundingClientRect()
        const vr = val.getBoundingClientRect()
        const cs = getComputedStyle(row)
        return {
          text: val.textContent,
          title: val.title,
          valWhole: val.scrollWidth <= val.clientWidth,
          nameWhole: name.scrollWidth <= name.clientWidth,
          valShare: vr.width / rr.width,
          apart: nr.right <= vr.left + 0.5,
          inside: vr.right <= rr.right - parseFloat(cs.paddingRight) + 0.5 && nr.left >= rr.left,
        }
      }, id)

    for (const [id, text] of [['p_ten', '10'], ['p_two', '200']] as const) {
      const r = await read(id)
      expect(r.text, `${id}: the value`).toBe(text)
      expect(r.valWhole, `${id}: ${text} is shown whole`).toBe(true)
      expect(r.nameWhole, `${id}: the long name gives way`).toBe(false)
      expect(r.apart, `${id}: name and value do not overlap`).toBe(true)
      expect(r.inside, `${id}: inside the row`).toBe(true)
    }
    for (const id of ['p_big', 'p_short']) {
      const r = await read(id)
      expect(r.valWhole, `${id}: a very long value is cut short`).toBe(false)
      expect(r.valShare, `${id}: within a third of the row`).toBeLessThanOrEqual(1 / 3 + 0.01)
      expect(r.title, `${id}: the tooltip keeps it whole`).toBe('123456789012.75')
      expect(r.apart, `${id}: name and value do not overlap`).toBe(true)
      expect(r.inside, `${id}: inside the row`).toBe(true)
    }
    // the name, a comma, and the value whole (the name and the value are flex
    // items, so the name computation may put a space before the comma)
    await expect(page.locator('.wb-row[data-node="p_big"]')).toHaveAccessibleName(/ C ?, 123456789012\.75$/)
    await expect(page.locator('.wb-row[data-node="p_two"]')).toHaveAccessibleName(/ B ?, 200$/)
  })
})

// The list follows a single node chosen on the canvas (2026-10-27): a row out
// of the list's view comes in by the least scroll; a row in view, a row
// picked in the list (even one cut by its edge) and a multiple selection
// leave the list where it is. Gacha pickup at 1280 × 800: 31 rows, about 17
// in view.
test.describe('the left list follows a single node chosen on the canvas', () => {
  const list = (page: Page) => page.locator('.wb-list')
  const scrollTop = (page: Page) => list(page).evaluate((el) => Math.round(el.scrollTop))
  /** each row: in the list's view whole, above it, below it, or cut by an edge */
  const places = (page: Page) =>
    page.evaluate(() => {
      const l = document.querySelector('.wb-list')!.getBoundingClientRect()
      return [...document.querySelectorAll<HTMLElement>('.wb-list .wb-row')].map((r) => {
        const b = r.getBoundingClientRect()
        const place = b.bottom <= l.top + 0.5 ? 'above' : b.top >= l.bottom - 0.5 ? 'below' : b.top >= l.top - 0.5 && b.bottom <= l.bottom + 0.5 ? 'in' : 'cut'
        return { id: r.dataset.node!, place }
      })
    })
  const placeOfRow = async (page: Page, id: string) => (await places(page)).find((p) => p.id === id)!.place
  /** a node drawn whole inside the canvas pane, so a click lands on it */
  const onCanvas = (page: Page, id: string) =>
    page.evaluate((id) => {
      const b = document.querySelector(`.react-flow__node[data-id="${id}"]`)!.getBoundingClientRect()
      const p = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
      return b.left > p.left + 8 && b.right < p.right - 8 && b.top > p.top + 8 && b.bottom < p.bottom - 8
    }, id)
  async function clickNode(page: Page, id: string, ctrl = false) {
    const b = (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    if (ctrl) await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.up()
    if (ctrl) await page.keyboard.up('Control')
  }
  async function pick(page: Page, where: 'in' | 'below' | 'above', n = 1) {
    const ids: string[] = []
    for (const p of await places(page)) if (p.place === where && (await onCanvas(page, p.id))) ids.push(p.id)
    expect(ids.length, `${n} node(s) with a row ${where} the view, drawn on the canvas`).toBeGreaterThanOrEqual(n)
    return ids
  }
  const toTop = async (page: Page) => {
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await list(page).evaluate((el) => (el.scrollTop = 0))
  }

  test('below or above the view: the list scrolls just enough; in view: it stays', async ({ page }) => {
    await openTemplate(page, 'gacha-pickup')
    await toTop(page)
    const [inView] = await pick(page, 'in')
    await clickNode(page, inView)
    await expect(page.locator(`.wb-row[data-node="${inView}"]`)).toHaveClass(/is-sel/)
    expect(await scrollTop(page), 'a row in view: the list stays').toBe(0)

    await toTop(page)
    const [below] = await pick(page, 'below')
    await clickNode(page, below)
    await expect(page.locator(`.wb-row[data-node="${below}"]`)).toHaveClass(/is-sel/)
    await expect.poll(() => placeOfRow(page, below)).toBe('in')
    // the least scroll: the row's bottom on the list's bottom edge
    const gapBelow = await page.evaluate((id) => {
      const l = document.querySelector('.wb-list')!.getBoundingClientRect()
      return l.bottom - document.querySelector(`.wb-row[data-node="${id}"]`)!.getBoundingClientRect().bottom
    }, below)
    expect(Math.abs(gapBelow), 'the row just inside the bottom edge').toBeLessThan(1)

    await toTop(page)
    await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight))
    const [above] = await pick(page, 'above')
    await clickNode(page, above)
    await expect.poll(() => placeOfRow(page, above)).toBe('in')
    const gapAbove = await page.evaluate((id) => {
      const l = document.querySelector('.wb-list')!.getBoundingClientRect()
      return document.querySelector(`.wb-row[data-node="${id}"]`)!.getBoundingClientRect().top - l.top
    }, above)
    expect(Math.abs(gapAbove), 'the row just inside the top edge').toBeLessThan(1)
  })

  test('a row picked in the list, even one cut by its edge, and a multiple selection leave the list where it is', async ({ page }) => {
    await openTemplate(page, 'gacha-pickup')
    await toTop(page)
    const cut = (await places(page)).find((p) => p.place === 'cut')
    expect(cut, 'a row cut by the bottom edge').toBeTruthy()
    await page.locator(`.wb-row[data-node="${cut!.id}"]`).click({ position: { x: 20, y: 4 } })
    await expect(page.locator(`.wb-row[data-node="${cut!.id}"]`)).toHaveClass(/is-sel/)
    expect(await scrollTop(page), 'a pick in the list: the list stays').toBe(0)

    await toTop(page)
    const [a, b] = await pick(page, 'below', 2)
    await clickNode(page, a)
    await expect.poll(() => placeOfRow(page, a)).toBe('in')
    await list(page).evaluate((el) => (el.scrollTop = 0))
    await clickNode(page, b, true)
    await expect
      .poll(() => page.evaluate(() => (window as any).__loop.graph.getState().nodes.filter((n: any) => n.selected).length))
      .toBe(2)
    expect(await scrollTop(page), 'a multiple selection: the list stays').toBe(0)
  })
})
