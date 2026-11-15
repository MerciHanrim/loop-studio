import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, iso, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// docs/mobile.md §MV5b (2026-11-15) — the phone's selection panel and the
// Inspector sheet on request, under the `mobile` project.
//
// Until then a selection opened the read-only Inspector sheet by itself. Its
// scrim covered the top bar's More button and the sheet the canvas rail: More
// took two taps, the first threw the selection away, and the canvas could not
// be zoomed or fitted with something selected. Now a selection brings a panel
// of one row above the run bar, with no scrim and no focus move; the sheet
// opens from the panel's Details and closes back to it with the selection
// kept; Deselect, a tap on the empty canvas and Reset view take the selection
// off.
//
// issue #411 (the screen the user opened comes first) is kept in its new form:
// Timeline and the Monte Carlo dialog open over a selection and stay; when
// they close, the panel is there, not a sheet.

type Sel = { overlay: string; node: string | null; edge: string | null; marked: number; mcOpen: boolean }
type Bridge = {
  __loop: {
    ui: { getState: () => { overlay: string } }
    mc: { getState: () => { dialogOpen: boolean } }
    sim: { getState: () => { stepOnce: () => void } }
    rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: object, o?: object) => void }
    i18n: { getState: () => { setLocale: (c: string) => void; activeLocale: string } }
    tour: { getState: () => { startReplay: (p: 'mobile' | 'desktop') => void } }
    graph: {
      getState: () => {
        nodes: { id: string; selected?: boolean; data: { label?: string } }[]
        edges: { id: string; selected?: boolean; source: string; target: string; data?: { flow?: string } }[]
        selectedNodeId: string | null
        selectedEdgeId: string | null
        setSelection: (n: string | null, e: string | null) => void
        onNodesChange: (c: object[]) => void
      }
    }
  }
}

const runBar = (page: Page) => page.locator('.pstrip--mobile')
const panel = (page: Page) => page.locator('.selpanel')
const details = (page: Page) => page.locator('.selpanel__details')
const deselect = (page: Page) => page.locator('.selpanel__x')
const inspector = (page: Page) => page.locator('.sheet--inspector')
const timeline = (page: Page) => page.locator('.timeline--sheet')
const mcDialog = (page: Page) => page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
const sel = (page: Page): Promise<Sel> =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    return {
      overlay: l.ui.getState().overlay,
      node: g.selectedNodeId,
      edge: g.selectedEdgeId,
      marked: g.nodes.filter((n) => n.selected).length + g.edges.filter((e) => e.selected).length,
      mcOpen: l.mc.getState().dialogOpen,
    }
  })
const zoom = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)

/** the boxes the panel has to keep clear of, and the rail that keeps clear of it */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const box = (s: string) => {
      const el = document.querySelector(s)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      topBar: box('.toolbar--mobile')!,
      runBar: box('.pstrip--mobile')!,
      rail: box('.react-flow__controls')!,
      panel: box('.selpanel'),
      details: box('.selpanel__details'),
      x: box('.selpanel__x'),
      name: box('.selpanel__name'),
    }
  })

/** a tap at a node's screen centre, through the mobile pan-capture overlay */
async function tapNode(page: Page, node: Locator): Promise<void> {
  const b = (await node.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}
const tapAt = async (page: Page, x: number, y: number) => {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
}

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node[data-id="ore_stock"]')).toBeVisible()
}
async function loadWithSelection(page: Page) {
  await load(page)
  await tapNode(page, page.locator('.react-flow__node[data-id="ore_stock"]'))
  await expect.poll(() => sel(page)).toMatchObject({ node: 'ore_stock', overlay: 'none' })
  await expect(panel(page)).toBeVisible()
}

/** #424 — a deliberate time wait, only for the reads that claim a screen
 *  STAYS as it is over a selection: nothing marks the moment a late effect
 *  would have changed it; 300 ms is the window in which it must not */
async function settle(page: Page) {
  await page.waitForTimeout(300)
  return sel(page)
}

test.describe('phone: a selection brings the selection panel, not the sheet (§MV5b)', () => {
  test('a tapped node: its name, its kind and its current amount, with no sheet, no scrim and no focus move', async ({ page }) => {
    await load(page)
    const railBefore = (await boxes(page)).rail
    await tapNode(page, page.locator('.react-flow__node[data-id="ore_stock"]'))
    await expect(panel(page)).toBeVisible()
    expect(await settle(page)).toMatchObject({ overlay: 'none', node: 'ore_stock', marked: 1 })
    await expect(page.locator('.sheet')).toHaveCount(0)
    await expect(page.locator('.sheet-scrim')).toHaveCount(0)

    // what it says: the name; the kind and the value the Inspector reads out for a Pool
    await expect(panel(page)).toHaveAttribute('aria-label', 'Selection')
    await expect(panel(page).locator('.selpanel__name')).toHaveText('Ore Stock')
    await expect(panel(page).locator('.selpanel__kind')).toHaveText('Pool')
    await expect(panel(page).locator('.selpanel__fact-label')).toHaveText('Current amount')
    await expect(panel(page).locator('.selpanel__fact-value')).toHaveText('8')
    // said, not focused
    await expect(panel(page).locator('.selpanel__text')).toHaveAttribute('role', 'status')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.selpanel')), 'focus moved into the panel').toBe(false)
    // nothing around it is taken away: the More button and the rail are not inert
    expect(await page.evaluate(() => ['.mob-more', '.react-flow__controls-zoomin', '.rf-resetview'].map((s) => !!document.querySelector(s)?.closest('[inert]')))).toEqual([false, false, false])

    // where it is: one row directly above the run bar, two 44 px buttons, the rail 8 px above it
    const b = await boxes(page)
    expect(Math.abs(b.panel!.bottom - b.runBar.top), 'the panel stands on the run bar').toBeLessThanOrEqual(1)
    expect(b.panel!.height).toBeGreaterThanOrEqual(56)
    expect(b.panel!.height).toBeLessThanOrEqual(60)
    expect(Math.min(b.details!.width, b.details!.height, b.x!.width, b.x!.height)).toBeGreaterThanOrEqual(44)
    expect(Math.abs(b.panel!.top - b.rail.bottom - 8), 'the rail’s bottom edge to the panel’s top edge, against 8 px').toBeLessThanOrEqual(1)
    expect(b.rail.bottom, 'the rail moved up for the panel').toBeLessThan(railBefore.bottom + 0.5)
    expect(b.scrollsSideways).toBe(false)
  })

  test('the amount is the Inspector’s own reading: after a step the panel and the sheet say the same number', async ({ page }) => {
    await loadWithSelection(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepOnce())
    const shown = panel(page).locator('.selpanel__fact-value')
    await expect(shown).not.toHaveText('8')
    const inPanel = (await shown.textContent())!
    await details(page).click()
    await expect(inspector(page).getByLabel('Current amount')).toHaveValue(inPanel)
  })

  test('one tap on More opens it and keeps the selection; closing More brings the panel back', async ({ page }) => {
    await loadWithSelection(page)
    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet[aria-label="More"]')).toBeVisible()
    expect(await settle(page)).toMatchObject({ overlay: 'more', node: 'ore_stock', marked: 1 })
    // the sheet covers the panel: it is out of the pointer's, the keyboard's and the reader's way with the rest
    expect(await panel(page).evaluate((el) => !!el.closest('[inert]'))).toBe(true)

    await page.locator('.sheet__x').click()
    await expect(page.locator('.sheet')).toHaveCount(0)
    await expect(panel(page)).toBeVisible()
    expect(await panel(page).evaluate((el) => !!el.closest('[inert]'))).toBe(false)
    expect(await sel(page)).toMatchObject({ overlay: 'none', node: 'ore_stock', marked: 1 })
  })

  test('the rail takes real taps with the panel up: a zoom keeps the selection, Reset view takes it off and the rail goes back down', async ({ page }) => {
    await load(page)
    const railBefore = (await boxes(page)).rail
    await tapNode(page, page.locator('.react-flow__node[data-id="ore_stock"]'))
    await expect(panel(page)).toBeVisible()
    const z0 = await zoom(page)
    await page.locator('.react-flow__controls-zoomin').click()
    await expect.poll(() => zoom(page)).toBeGreaterThan(z0)
    expect(await sel(page)).toMatchObject({ node: 'ore_stock', marked: 1 })
    await expect(panel(page)).toBeVisible()
    const z1 = await zoom(page)
    await page.locator('.react-flow__controls-zoomout').click()
    await expect.poll(() => zoom(page)).toBeLessThan(z1)
    expect(await sel(page)).toMatchObject({ node: 'ore_stock', marked: 1 })

    // Reset view fits the diagram and takes the whole selection off (§LGR3.4): the panel goes with it
    await page.locator('.rf-resetview').click()
    await expect.poll(() => sel(page)).toMatchObject({ node: null, edge: null, marked: 0 })
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(async () => (await boxes(page)).rail.bottom).toBeCloseTo(railBefore.bottom, 0)
  })

  test('Details opens the read-only sheet; Close, its scrim and Escape close the sheet, keep the selection and give focus back to Details', async ({ page }) => {
    await loadWithSelection(page)
    await expect(details(page)).toHaveAttribute('aria-expanded', 'false')
    for (const close of ['Close', 'the scrim', 'Escape'] as const) {
      await details(page).click()
      await expect(inspector(page)).toBeVisible()
      expect(await sel(page)).toMatchObject({ overlay: 'inspector', node: 'ore_stock' })
      await expect(inspector(page).locator('input').first()).toHaveValue('Ore Stock')
      await expect(details(page)).toHaveAttribute('aria-expanded', 'true')
      if (close === 'Close') await inspector(page).locator('.sheet__x').click()
      else if (close === 'the scrim') await page.locator('.sheet-scrim').click({ position: { x: 40, y: 40 } })
      else await page.keyboard.press('Escape')
      await expect(inspector(page), `closed by ${close}`).toHaveCount(0)
      expect(await settle(page), `after ${close}`).toMatchObject({ overlay: 'none', node: 'ore_stock', marked: 1 })
      await expect(panel(page)).toBeVisible()
      // (after a press on the scrim the press itself takes focus to the page, as
      // for every sheet: the shared sheet's behaviour, left as it is)
      if (close !== 'the scrim') await expect(details(page), `focus after ${close}`).toBeFocused()
    }
  })

  test('Deselect takes the selection off; so does a tap on the empty canvas', async ({ page }) => {
    await loadWithSelection(page)
    await deselect(page).click()
    await expect.poll(() => sel(page)).toMatchObject({ node: null, edge: null, marked: 0, overlay: 'none' })
    await expect(panel(page)).toHaveCount(0)

    await tapNode(page, page.locator('.react-flow__node[data-id="ore_stock"]'))
    await expect(panel(page)).toBeVisible()
    // a point of the canvas with no node and no line near it
    const empty = await page.evaluate(() => {
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
      const taken = [...document.querySelectorAll('.react-flow__node, .react-flow__edge, .react-flow__controls')].map((el) => el.getBoundingClientRect())
      for (let y = pane.top + 40; y < pane.bottom - 120; y += 20)
        for (let x = pane.left + 80; x < pane.right - 40; x += 20)
          if (!taken.some((r) => x > r.left - 30 && x < r.right + 30 && y > r.top - 30 && y < r.bottom + 30)) return { x, y }
      return null
    })
    expect(empty, 'an empty point on the canvas').not.toBeNull()
    await tapAt(page, empty!.x, empty!.y)
    await expect.poll(() => sel(page)).toMatchObject({ node: null, edge: null, marked: 0 })
    await expect(panel(page)).toHaveCount(0)
  })

  test('a tapped connection: its two ends as its name, its kind and its Flow', async ({ page }) => {
    await load(page)
    const at = await page.locator('.react-flow__edge path.react-flow__edge-path').first().evaluate((el) => {
      const p = el as SVGPathElement
      const m = p.getPointAtLength(p.getTotalLength() / 2).matrixTransform(p.getScreenCTM()!)
      return { x: m.x, y: m.y }
    })
    await tapAt(page, at.x, at.y)
    await expect(panel(page)).toBeVisible()
    const s = await sel(page)
    expect(s).toMatchObject({ node: null, overlay: 'none', marked: 1 })
    expect(s.edge).not.toBeNull()
    const want = await page.evaluate((id) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const e = g.edges.find((x) => x.id === id)!
      const label = (nid: string) => g.nodes.find((n) => n.id === nid)?.data.label ?? nid
      return { from: label(e.source), to: label(e.target), flow: e.data?.flow ?? null }
    }, s.edge)
    // each end's name is the user's own text: isolated inside the sentence (§L9.4)
    await expect(panel(page).locator('.selpanel__name')).toHaveText(`${iso(want.from)} → ${iso(want.to)}`)
    expect(want.flow, 'the fixture’s first line is a resource line').not.toBeNull()
    // its kind is "Flow" and its field is "Flow": the word is said once, then the Flow as written
    await expect(panel(page).locator('.selpanel__kind')).toHaveText('Flow')
    await expect(panel(page).locator('.selpanel__fact-label')).toHaveCount(0)
    await expect(panel(page).locator('.selpanel__fact-value')).toHaveText(want.flow!)
    // its sheet is the connection's
    await details(page).click()
    await expect(inspector(page)).toBeVisible()
    await inspector(page).locator('.sheet__x').click()
    expect(await sel(page)).toMatchObject({ edge: s.edge, overlay: 'none' })
  })

  test('several nodes selected: how many, and which one the details are of', async ({ page }) => {
    await loadWithSelection(page)
    // two more marks beside the tapped one (on the phone a multi-selection arrives from a wider layout, §MV3c)
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.onNodesChange(g.nodes.filter((n) => !n.selected).slice(0, 2).map((n) => ({ id: n.id, type: 'select', selected: true })))
    })
    await expect(panel(page).locator('.selpanel__name')).toHaveText('3 nodes selected')
    // the node the details are of is the store's anchor, whichever of the three that is
    const anchor = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return g.nodes.find((n) => n.id === g.selectedNodeId)?.data.label ?? null
    })
    expect(anchor).not.toBeNull()
    await expect(panel(page).locator('.selpanel__anchor')).toHaveText(`Details show ${iso(anchor!)}`)
    await expect(panel(page).locator('.selpanel__fact')).toHaveCount(0)
    await details(page).click()
    await expect(inspector(page).locator('.lgr-selection-count')).toHaveText(/3 nodes selected/)
    await expect(inspector(page).locator('input').first()).toHaveValue(anchor!)
  })

  test('a Parameter: its Value with its unit; a kind with no single value: the kind alone', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [
          { id: 'rate', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'Drop rate', value: 2.5, unit: '%' } },
          { id: 'src', type: 'source', position: { x: 0, y: 160 }, data: { kind: 'source', label: 'Mine', activation: 'automatic', mode: 'pushAny' } },
        ],
        edges: [],
      }),
    )
    const pick = (id: string) =>
      page.evaluate((id) => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        g.setSelection(id, null)
        g.onNodesChange(g.nodes.filter((n) => !!n.selected !== (n.id === id)).map((n) => ({ id: n.id, type: 'select', selected: n.id === id })))
      }, id)
    await pick('rate')
    await expect(panel(page).locator('.selpanel__name')).toHaveText('Drop rate')
    await expect(panel(page).locator('.selpanel__kind')).toHaveText('Parameter')
    await expect(panel(page).locator('.selpanel__fact-label')).toHaveText('Value')
    await expect(panel(page).locator('.selpanel__fact-value')).toHaveText('2.5 %')
    await pick('src')
    await expect(panel(page).locator('.selpanel__name')).toHaveText('Mine')
    await expect(panel(page).locator('.selpanel__kind')).toHaveText('Source')
    await expect(panel(page).locator('.selpanel__fact')).toHaveCount(0)
  })
})

test.describe('phone: the screen the user opened stays over a selection (#411), and the panel is what is under it', () => {
  test('Timeline over a selection stays open; closing it leaves the panel and the selection', async ({ page }) => {
    await loadWithSelection(page)
    const tl = runBar(page).getByRole('button', { name: /^Timeline/ })
    await tl.click()
    await expect(timeline(page)).toBeVisible()
    expect(await settle(page)).toMatchObject({ overlay: 'timeline', node: 'ore_stock' })
    await expect(timeline(page)).toBeVisible()
    await expect(inspector(page)).toHaveCount(0)

    await tl.click()
    await expect(timeline(page)).toBeHidden()
    expect(await settle(page)).toMatchObject({ overlay: 'none', node: 'ore_stock', marked: 1 })
    await expect(panel(page)).toBeVisible()
    await expect(inspector(page)).toHaveCount(0)
  })

  test('the Monte Carlo dialog over a selection stays open; closing it leaves the panel and the selection', async ({ page }) => {
    await loadWithSelection(page)
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    await expect(mcDialog(page)).toBeVisible()
    expect(await settle(page)).toMatchObject({ overlay: 'none', mcOpen: true, node: 'ore_stock' })
    await expect(mcDialog(page)).toBeVisible()

    await page.locator('.mcdlg__x').click()
    await expect(mcDialog(page)).toBeHidden()
    expect(await settle(page)).toMatchObject({ overlay: 'none', mcOpen: false, node: 'ore_stock', marked: 1 })
    await expect(panel(page)).toBeVisible()
    await expect(inspector(page)).toHaveCount(0)
  })
})

// The tour replayed with something selected (docs/guided-tour.md): the tour is
// modal, so the panel's buttons under it cannot be reached until it closes,
// and the panel is as it was after. (Measured 2026-11-15 at four sizes in four
// languages: the tour's popover lies over the panel at the two run bar steps,
// and at the Inspect step on a phone held sideways; it stays whole on screen.)
test.describe('phone: the tour over a selection', () => {
  test('the panel’s buttons are out of reach under the tour and back when it closes; the Inspect step says the new order', async ({ page }) => {
    await loadWithSelection(page)
    const reach = () => page.evaluate(() => ['.selpanel__details', '.selpanel__x'].map((s) => !!document.querySelector(s)?.closest('[inert]')))
    expect(await reach()).toEqual([false, false])
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('mobile'))
    const popover = page.locator('.tour-popover')
    await expect(popover).toBeVisible()
    expect(await reach(), 'inert under the tour').toEqual([true, true])
    await popover.locator('.btn--primary').click()
    await popover.locator('.btn--primary').click()
    await expect(popover.locator('.tour-popover__pos')).toHaveText('3 / 6')
    await expect(popover.locator('.tour-popover__body')).toHaveText('Tap a node or connection to see its summary. Open Details to read its settings. Editing is desktop-only.')
    // the button the step names is the panel's
    await expect(details(page)).toHaveText('Details')
    await popover.locator('.tour-popover__x').click()
    await expect(popover).toHaveCount(0)
    expect(await reach()).toEqual([false, false])
    await expect(panel(page)).toBeVisible()
    expect(await sel(page)).toMatchObject({ overlay: 'none', node: 'ore_stock', marked: 1 })
  })
})

// The panel and the rail together, at the sizes the design was checked on
// (the mock of 2026-11-15): two portrait phones and both turned sideways.
for (const [width, height] of [[390, 844], [360, 800], [844, 390], [800, 360]] as const) {
  test.describe(`phone ${width}x${height}: the panel and the rail fit`, () => {
    test.use({ viewport: { width, height } })
    test('the panel stands on the run bar, the rail 8 px above it and clear of the top bar; nothing scrolls sideways', async ({ page }) => {
      await load(page)
      await expect(page.locator('.toolbar--mobile')).toBeVisible()
      // the node highest on the canvas, so the tap is clear of the panel that will come
      const target = await page.evaluate(() => {
        const top = document.querySelector('.toolbar--mobile')!.getBoundingClientRect().bottom
        const bar = document.querySelector('.pstrip--mobile')!.getBoundingClientRect().top
        let best: { x: number; y: number } | null = null
        for (const el of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
          const r = el.getBoundingClientRect()
          const x = r.left + r.width / 2, y = r.top + r.height / 2
          if (y < top + 30 || y > bar - 30 || x < 70 || x > innerWidth - 20) continue
          if (!best || y < best.y) best = { x, y }
        }
        return best
      })
      expect(target, 'a node on screen to tap').not.toBeNull()
      await tapAt(page, target!.x, target!.y)
      await expect(panel(page)).toBeVisible()
      const b = await boxes(page)
      expect(Math.abs(b.panel!.bottom - b.runBar.top)).toBeLessThanOrEqual(1)
      expect(b.panel!.left).toBeCloseTo(0, 0)
      expect(b.panel!.right).toBeCloseTo(b.viewport.width, 0)
      expect(Math.abs(b.panel!.top - b.rail.bottom - 8), 'rail to panel, against 8 px').toBeLessThanOrEqual(1)
      expect(b.rail.top - b.topBar.bottom, 'rail to top bar').toBeGreaterThanOrEqual(8)
      expect(b.x!.right).toBeLessThanOrEqual(b.viewport.width)
      expect(b.scrollsSideways).toBe(false)
      // the rail still takes a tap there
      const z0 = await zoom(page)
      await page.locator('.react-flow__controls-zoomin').click()
      await expect.poll(() => zoom(page)).toBeGreaterThan(z0)
    })

    // Selecting does not move the canvas, with one exception (2026-11-15): a
    // node that was on screen, is tapped, and would be WHOLLY under the panel.
    // Measured on a phone held sideways after Reset view: the fitted diagram's
    // bottom row. The canvas then moves up only, by just enough for 8 px of
    // the node's symbol to show above the panel.
    test('a tapped node the panel would cover completely is brought up 8 px, straight up; a node partly under it is left where it is', async ({ page }) => {
      await load(page)
      await page.locator('.rf-resetview').click() // the whole diagram in view: small symbols
      await page.waitForTimeout(400)
      const view = () => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
      const symbol = (id: string) =>
        page.evaluate((id) => {
          const r = document.querySelector(`.react-flow__node[data-id="${id}"] .nodef__stroke`)!.getBoundingClientRect()
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }
        }, id)
      /** the canvas moved so that the node's symbol has its top edge at `top` (the zoom and x as they are) */
      const putSymbolTopAt = async (id: string, top: number) => {
        const s = await symbol(id)
        await page.evaluate((dy) => {
          const rf = (window as unknown as Bridge).__loop.rf
          const v = rf.getViewport()
          rf.setViewport({ x: v.x, y: v.y + dy, zoom: v.zoom }, { duration: 0 })
        }, top - s.top)
        await expect.poll(async () => Math.abs((await symbol(id)).top - top)).toBeLessThan(0.5)
      }
      const marks = () =>
        page.evaluate(() => ({
          nodes: document.querySelectorAll('.react-flow__node.selected').length,
          rings: document.querySelectorAll('.nodef.is-selected').length,
        }))
      const id = 'ore_stock'
      const s0 = await symbol(id)
      expect(s0.left, 'the node is clear of the rail').toBeGreaterThan(70)
      expect(s0.height, 'the symbol fits inside the strip the panel takes').toBeLessThan(40)
      const bar = (await boxes(page)).runBar

      // 1 — wholly inside the strip the panel will take: 30 px above the run bar
      await putSymbolTopAt(id, bar.top - 30)
      const v0 = await view()
      const at0 = await symbol(id)
      await tapAt(page, (at0.left + at0.right) / 2, (at0.top + at0.bottom) / 2)
      await expect(panel(page)).toBeVisible()
      await expect.poll(async () => (await sel(page)).node).toBe(id)
      const b1 = await boxes(page)
      const at1 = await symbol(id)
      const v1 = await view()
      expect(Math.abs(b1.panel!.top - 8 - at1.top), 'the symbol’s top edge, against 8 px above the panel').toBeLessThanOrEqual(1)
      expect(v1.zoom, 'the zoom is kept').toBe(v0.zoom)
      expect(v1.x, 'the sideways position is kept').toBe(v0.x)
      expect(Math.abs(v1.y - v0.y - (at1.top - at0.top)), 'the canvas moved straight up by what the symbol moved').toBeLessThanOrEqual(1)
      expect(at1.top).toBeLessThan(at0.top)
      // the selection and its mark are as a tap leaves them, and the rail is where the panel puts it
      expect(await sel(page)).toMatchObject({ node: id, marked: 1, overlay: 'none' })
      expect(await marks()).toEqual({ nodes: 1, rings: 1 })
      expect(Math.abs(b1.panel!.top - b1.rail.bottom - 8), 'rail to panel, against 8 px').toBeLessThanOrEqual(1)
      expect(b1.rail.top - b1.topBar.bottom).toBeGreaterThanOrEqual(8)

      // 2 — partly under the panel (4 px of it above the panel's top edge): nothing moves
      await deselect(page).click()
      await expect(panel(page)).toHaveCount(0)
      await putSymbolTopAt(id, b1.panel!.top - 4)
      const v2 = await view()
      const at2 = await symbol(id)
      expect(at2.bottom, 'the symbol reaches under the panel’s top edge').toBeGreaterThan(b1.panel!.top)
      await tapAt(page, (at2.left + at2.right) / 2, (at2.top + at2.bottom) / 2)
      await expect(panel(page)).toBeVisible()
      await expect.poll(async () => (await sel(page)).node).toBe(id)
      await page.waitForTimeout(200) // nothing marks the moment a move would have come
      expect(await view(), 'the canvas is where it was').toEqual(v2)
      expect(Math.abs((await symbol(id)).top - at2.top)).toBeLessThan(0.5)
      expect(await marks()).toEqual({ nodes: 1, rings: 1 })
      const b2 = await boxes(page)
      expect(Math.abs(b2.panel!.top - b2.rail.bottom - 8)).toBeLessThanOrEqual(1)
    })
  })
}

// 360 px wide, the 18 languages: the Details button whole, a long name cut
// with an ellipsis and not pushing anything out, the same row height.
const LOCALES = ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'de', 'fr', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'it', 'nl', 'ru', 'tr', 'vi', 'th', 'ar']
const LONG_NAME = 'Rare material conversion workshop (weekend bonus)'
test.describe('phone 360x800, 18 languages: Details and a long name fit the panel', () => {
  test.use({ viewport: { width: 360, height: 800 } })
  for (const locale of LOCALES) {
    test(`${locale}: Details is whole, the long name is cut inside the panel, the rail is 8 px above`, async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await importGraph(
        page,
        JSON.stringify({
          schema: 'loop-studio/graph',
          version: 1,
          nodes: [{ id: 'long', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: LONG_NAME, activation: 'passive', initial: 1234567, capacity: null, mode: 'pullAny' } }],
          edges: [],
        }),
      )
      await page.evaluate((c) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(c), locale)
      await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale)).toBe(locale)
      await page.evaluate(() => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        g.setSelection('long', null)
        g.onNodesChange([{ id: 'long', type: 'select', selected: true }])
      })
      await expect(panel(page)).toBeVisible()
      await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
      const m = await page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(s)!
        const p = q('.selpanel'), d = q('.selpanel__details'), x = q('.selpanel__x'), n = q('.selpanel__name'), sub = q('.selpanel__sub'), v = q('.selpanel__fact-value')
        const r = (el: HTMLElement) => el.getBoundingClientRect()
        return {
          value: { text: v.textContent ?? '', cut: v.scrollWidth > v.clientWidth, right: r(v).right },
          panel: { height: r(p).height, overflows: p.scrollWidth > p.clientWidth },
          details: { text: d.textContent ?? '', width: r(d).width, height: r(d).height, cut: d.scrollWidth > d.clientWidth, left: r(d).left, right: r(d).right },
          x: { width: r(x).width, left: r(x).left, right: r(x).right },
          name: { width: r(n).width, cut: n.scrollWidth > n.clientWidth, ellipsis: getComputedStyle(n).textOverflow, right: r(n).right },
          sub: { right: r(sub).right, overflowsPanelText: r(sub).right > r(d).left },
          viewport: innerWidth,
          scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      test.info().annotations.push({ type: 'panel', description: `${locale}: panel ${Math.round(m.panel.height)} px high; Details "${m.details.text}" ${Math.round(m.details.width)} px; name ${Math.round(m.name.width)} px` })
      // the Details label is whole, and both buttons are on screen
      expect(m.details.text.trim()).not.toBe('')
      expect(m.details.cut, 'the Details label is cut').toBe(false)
      expect(Math.min(m.details.width, m.details.height, m.x.width)).toBeGreaterThanOrEqual(44)
      expect(m.x.right).toBeLessThanOrEqual(m.viewport)
      expect(m.details.right).toBeLessThanOrEqual(m.x.left)
      // the long name is cut with an ellipsis, ends before Details, and still has room to be read
      expect(m.name.cut).toBe(true)
      expect(m.name.ellipsis).toBe('ellipsis')
      expect(m.name.right).toBeLessThanOrEqual(m.details.left)
      expect(m.name.width, 'room for the name').toBeGreaterThanOrEqual(120)
      expect(m.sub.overflowsPanelText, 'the kind-and-value line runs under the buttons').toBe(false)
      // the amount itself is whole: where the line is short its LABEL is cut, never the number
      // (Russian's "Текущее количество" used to push the number out of sight)
      expect(m.value.text).toBe('1234567')
      expect(m.value.cut, 'the value is cut').toBe(false)
      expect(m.value.right).toBeLessThanOrEqual(m.details.left)
      // one row, the same in every language; nothing pushed out
      expect(m.panel.height).toBeGreaterThanOrEqual(56)
      expect(m.panel.height).toBeLessThanOrEqual(60)
      expect(m.panel.overflows).toBe(false)
      expect(m.scrollsSideways).toBe(false)
      const b = await boxes(page)
      expect(Math.abs(b.panel!.bottom - b.runBar.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.panel!.top - b.rail.bottom - 8), 'rail to panel, against 8 px').toBeLessThanOrEqual(1)
      expect(b.rail.top - b.topBar.bottom).toBeGreaterThanOrEqual(8)
    })
  }
})
