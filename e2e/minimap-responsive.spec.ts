import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/mobile.md §MV-D10 / docs/dense-graph-pan.md — the minimap is a fixed
// ~202×152 overlay; it only earns its space on a canvas pane large enough to
// want an overview. `Canvas.tsx` `minimapFits` renders it only when the
// `.react-flow` pane is at least 640 × 380 px (and never on mobile), so a
// narrow / short desktop window is not two-thirds minimap. This locks:
//   • the threshold (both axes, inclusive), read against the real pane size
//   • the two named cases (1280 shows, 820 hides)
//   • a resize round-trip across the boundary leaves nodes + viewport intact
//   • toggling the minimap never adds horizontal scroll or resizes the pane

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'a', type: 'source', position: { x: 40, y: 60 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
    { id: 'b', type: 'pool', position: { x: 300, y: 60 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'c', type: 'drain', position: { x: 560, y: 60 }, data: { kind: 'drain', label: 'C', activation: 'passive', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e1', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e2', type: 'loop', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

const paneSize = (p: Page) =>
  p.evaluate(() => {
    const rf = document.querySelector('.react-flow') as HTMLElement | null
    return rf ? { w: rf.clientWidth, h: rf.clientHeight } : { w: 0, h: 0 }
  })
const minimapCount = (p: Page) => p.locator('.react-flow__minimap').count()
const viewport = (p: Page) =>
  p.evaluate(() => {
    const rf = (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }).__loop.rf
    return rf.getViewport()
  })
const nodePositions = (p: Page) =>
  p.evaluate(() =>
    Object.fromEntries(
      (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] } } } }).__loop.graph
        .getState()
        .nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    ),
  )

test.describe('minimap — visible only when the pane can host it', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, GRAPH)
    await expect(page.locator('.react-flow__node[data-id="b"]')).toBeVisible()
  })

  test('threshold: shown ⇒ pane ≥ 640 × 380; pane ≥ 640 × 380 on a desktop-width window ⇒ shown; below either axis ⇒ hidden', async ({ page }) => {
    // the assertion reads the REAL pane size so the 640 × 380 line is exact
    // whatever the surrounding chrome does. `w >= 760` keeps the "sufficient"
    // direction clear of the separate mobile-layout breakpoint (< 720).
    for (const size of [
      { w: 1280, h: 800 },
      { w: 1100, h: 720 },
      { w: 960, h: 700 },
      { w: 900, h: 430 }, // short → pane height under 380
      { w: 760, h: 900 }, // narrow → pane width under 640 once the Inspector column is in
      { w: 640, h: 800 },
      { w: 500, h: 900 },
    ]) {
      await page.setViewportSize({ width: size.w, height: size.h })
      await page.waitForTimeout(150)
      const pane = await paneSize(page)
      const shown = (await minimapCount(page)) === 1
      const label = `window ${size.w}×${size.h} → pane ${pane.w}×${pane.h}, minimap ${shown ? 'shown' : 'hidden'}`
      // necessary: the minimap never renders on a pane below the line
      if (shown) expect(pane.w >= 640 && pane.h >= 380, label).toBe(true)
      // sufficient: at / above the line on a desktop-width window it renders
      if (pane.w >= 640 && pane.h >= 380 && size.w >= 760) expect(shown, label).toBe(true)
      // and it is gone whenever the pane is under the line
      if (pane.w < 640 || pane.h < 380) expect(shown, label).toBe(false)
    }
  })

  test('1280 window shows the minimap; 820 window hides it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()

    await page.setViewportSize({ width: 820, height: 620 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
  })

  test('resizing across the boundary does not reset nodes or the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    // a deliberate, non-default camera
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: -123, y: 45, zoom: 1.37 },
        { duration: 0 },
      ),
    )
    const vp0 = await viewport(page)
    const pos0 = await nodePositions(page)

    for (const size of [
      { w: 560, h: 700 }, // minimap gone
      { w: 1200, h: 800 }, // minimap back
      { w: 700, h: 360 }, // gone again (height)
      { w: 1280, h: 800 }, // back
    ]) {
      await page.setViewportSize({ width: size.w, height: size.h })
      await page.waitForTimeout(150)
    }

    expect(await viewport(page)).toEqual(vp0)
    expect(await nodePositions(page)).toEqual(pos0)
  })

  test('showing / hiding the minimap adds no horizontal scroll and does not resize the pane', async ({ page }) => {
    // measure the pane at a size that shows the minimap
    await page.setViewportSize({ width: 1100, height: 760 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    const paneShown = await paneSize(page)
    const noHScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
    expect(await noHScroll()).toBe(true)
    // the minimap sits inside the pane (an absolute Panel), never past its right edge
    const inside = await page.evaluate(() => {
      const rf = document.querySelector('.react-flow') as HTMLElement
      const mm = document.querySelector('.react-flow__minimap') as HTMLElement
      const r = rf.getBoundingClientRect(), m = mm.getBoundingClientRect()
      return m.right <= r.right + 1 && m.bottom <= r.bottom + 1 && m.left >= r.left - 1
    })
    expect(inside).toBe(true)

    // hide it, then show it again at the SAME window size range — the pane
    // width/height are driven by the layout, not by the minimap
    await page.setViewportSize({ width: 600, height: 760 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    expect(await noHScroll()).toBe(true)

    await page.setViewportSize({ width: 1100, height: 760 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    expect(await paneSize(page)).toEqual(paneShown)
    expect(await noHScroll()).toBe(true)
  })
})

// docs/large-graph-readability.md — the user-facing minimap collapse control
// (MinimapDock). A persisted UI preference (`uiStore.minimapCollapsed`,
// `localStorage` key `loop-studio:minimap-collapsed`), independent of the
// `< 640 × 380` auto-hide. Collapsing / expanding never moves the camera; the
// NEXT Template open frames against whatever the minimap state is then.

// §MML3 — MMO's Template.initialView.minZoom (src/model/templates.ts); a stable
// value also pinned by e2e/template-load-viewport.spec.ts.
const MMO_MIN_ZOOM = 0.6
const MMO_NAME = 'Early MMO progression (levels 1–15)'

const uiState = (p: Page) =>
  p.evaluate(() => (window as unknown as { __loop: { ui: { getState: () => { minimapCollapsed: boolean } } } }).__loop.ui.getState())
const toggleBtn = (p: Page) => p.locator('.minimap-toggle')

/** open MMO through the real Templates menu (the §MML3 framing path) */
async function openMmoFromMenu(page: Page): Promise<void> {
  await page.locator('.toolbar__actions .menu').first().locator('> button').click()
  await page
    .locator('.toolbar__actions .menu')
    .first()
    .locator('.menu__pop [role="menuitem"]', { hasText: MMO_NAME })
    .click()
  const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
  await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
  if (await confirm.count()) await confirm.click()
  await expect(page.locator('.react-flow__node[data-id="char_creation"]')).toBeVisible()
  await page.waitForTimeout(500) // let the fit / measurement-settle effect land
}

const lastInitialView = (p: Page) =>
  p.evaluate(
    () =>
      (
        window as unknown as {
          __loop: { canvas?: { lastInitialView: () => { insetR: number; insetB: number; zoom: number } | null } }
        }
      ).__loop.canvas?.lastInitialView() ?? null,
  )

const onScreen = (p: Page, id: string) =>
  p.evaluate((nid) => {
    const pane = document.querySelector('.react-flow')
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)
    if (!pane || !el) return false
    const a = pane.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    return b.right > a.left + 2 && b.left < a.right - 2 && b.bottom > a.top + 2 && b.top < a.bottom - 2
  }, id)

test.describe('minimap — the collapse / restore control', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    // start from a known-expanded minimap (a prior test may have persisted it)
    await page.evaluate(() => {
      try {
        localStorage.removeItem('loop-studio:minimap-collapsed')
      } catch {
        /* opaque origin */
      }
      ;(window as unknown as { __loop: { ui: { getState: () => { setMinimapCollapsed: (v: boolean) => void } } } }).__loop.ui
        .getState()
        .setMinimapCollapsed(false)
    })
    await resetAll(page)
    await importGraph(page, GRAPH)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
  })

  test('collapse hides the minimap to a same-corner restore button, and the choice persists', async ({ page }) => {
    const mmCorner = await page.evaluate(() => {
      const rf = document.querySelector('.react-flow')!.getBoundingClientRect()
      const m = document.querySelector('.react-flow__minimap')!.getBoundingClientRect()
      return { right: rf.right - m.right, bottom: rf.bottom - m.bottom }
    })

    await toggleBtn(page).click()
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    const collapsed = toggleBtn(page)
    await expect(collapsed).toHaveClass(/is-collapsed/)
    await expect(collapsed).toBeVisible()
    // the restore tile sits where the minimap's own bottom-right corner was
    const btnCorner = await page.evaluate(() => {
      const rf = document.querySelector('.react-flow')!.getBoundingClientRect()
      const b = document.querySelector('.minimap-toggle')!.getBoundingClientRect()
      return { right: rf.right - b.right, bottom: rf.bottom - b.bottom }
    })
    expect(Math.abs(btnCorner.right - mmCorner.right)).toBeLessThanOrEqual(4)
    expect(Math.abs(btnCorner.bottom - mmCorner.bottom)).toBeLessThanOrEqual(4)
    expect((await uiState(page)).minimapCollapsed).toBe(true)

    // persists across a reload
    await page.reload()
    await page.waitForTimeout(300)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await expect(toggleBtn(page)).toHaveClass(/is-collapsed/)

    // the collapsed button restores it
    await toggleBtn(page).click()
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    await expect(toggleBtn(page)).not.toHaveClass(/is-collapsed/)
    expect((await uiState(page)).minimapCollapsed).toBe(false)
  })

  test('the auto-hide and the user choice are independent', async ({ page }) => {
    // user leaves it EXPANDED, then shrinks below the line → nothing docked
    await page.setViewportSize({ width: 560, height: 700 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await expect(page.locator('.minimap-toggle')).toHaveCount(0)
    // grow back → last state was expanded
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()

    // now COLLAPSE, shrink, grow → restored collapsed
    await toggleBtn(page).click()
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await page.setViewportSize({ width: 560, height: 700 })
    await page.waitForTimeout(150)
    await expect(page.locator('.minimap-toggle')).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await expect(toggleBtn(page)).toHaveClass(/is-collapsed/)
  })

  test('toggling moves nothing — viewport, nodes, no re-fit, no h-scroll', async ({ page }) => {
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: -80, y: 33, zoom: 1.24 },
        { duration: 0 },
      ),
    )
    // count camera calls from here on
    await page.evaluate(() => {
      const rf = (window as unknown as { __loop: { rf: Record<string, (...a: unknown[]) => unknown> } }).__loop.rf
      const w = window as unknown as { __mmSpy: { fit: number; set: number } }
      w.__mmSpy = { fit: 0, set: 0 }
      const f = rf.fitView, s = rf.setViewport
      rf.fitView = (...a: unknown[]) => (w.__mmSpy.fit++, f(...a))
      rf.setViewport = (...a: unknown[]) => (w.__mmSpy.set++, s(...a))
    })
    const vp0 = await viewport(page)
    const pos0 = await nodePositions(page)

    await toggleBtn(page).click() // collapse
    await page.waitForTimeout(120)
    await toggleBtn(page).click() // expand
    await page.waitForTimeout(120)
    await toggleBtn(page).click() // collapse
    await page.waitForTimeout(120)

    const spy = await page.evaluate(
      () => (window as unknown as { __mmSpy: { fit: number; set: number } }).__mmSpy,
    )
    expect(spy).toEqual({ fit: 0, set: 0 }) // no re-fit on a toggle
    expect(await viewport(page)).toEqual(vp0)
    expect(await nodePositions(page)).toEqual(pos0)

    // a press + drag ON the button does not leak into a minimap pan / jump
    const btn = await toggleBtn(page).boundingBox()
    await page.mouse.move(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2)
    await page.mouse.down()
    await page.mouse.move(btn!.x + btn!.width / 2 - 30, btn!.y + btn!.height / 2 + 20, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    expect(await viewport(page)).toEqual(vp0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true)
  })

  test('a Template opened while collapsed reserves NO minimap gap; expanded it does', async ({ page }) => {
    // expanded run
    await openMmoFromMenu(page)
    const ivExpanded = await lastInitialView(page)
    expect(ivExpanded, 'applyInitialView ran').not.toBeNull()
    expect(ivExpanded!.insetR).toBe(224)
    expect(ivExpanded!.insetB).toBe(176)
    expect(ivExpanded!.zoom).toBeGreaterThanOrEqual(MMO_MIN_ZOOM - 1e-6)
    expect(await onScreen(page, 'char_creation')).toBe(true)
    expect(await onScreen(page, 'z1_enc')).toBe(true)
    expect(await onScreen(page, 'end15')).toBe(false)
    // sanity: the framed early band does not sit under the minimap
    const clearOfMinimap = await page.evaluate(() => {
      const m = document.querySelector('.react-flow__minimap')!.getBoundingClientRect()
      return ['char_creation', 'active_char', 'z1_enc'].every((id) => {
        const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
        return !el || el.getBoundingClientRect().right <= m.left + 1
      })
    })
    expect(clearOfMinimap).toBe(true)

    // collapse, re-open the same Template at the same pane size
    await toggleBtn(page).click()
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await openMmoFromMenu(page)
    const ivCollapsed = await lastInitialView(page)
    expect(ivCollapsed!.insetR).toBe(0) // no gap for an invisible minimap
    expect(ivCollapsed!.insetB).toBe(0)
    expect(ivCollapsed!.zoom).toBeGreaterThanOrEqual(MMO_MIN_ZOOM - 1e-6)
    // a wider usable width ⇒ same-or-larger fit zoom for the same rect
    expect(ivCollapsed!.zoom).toBeGreaterThanOrEqual(ivExpanded!.zoom - 1e-6)
    expect(await onScreen(page, 'char_creation')).toBe(true)
    expect(await onScreen(page, 'z1_enc')).toBe(true)
    expect(await onScreen(page, 'end15')).toBe(false)
  })

  test('the toggle is keyboard operable with a visible focus ring', async ({ page }) => {
    const btn = toggleBtn(page)
    await btn.focus()
    await expect(btn).toBeFocused()
    const ring = await btn.evaluate((el) => {
      el.focus()
      const s = getComputedStyle(el)
      return { width: s.outlineWidth, style: s.outlineStyle }
    })
    expect(parseFloat(ring.width)).toBeGreaterThan(0)
    expect(ring.style).not.toBe('none')

    await page.keyboard.press('Enter')
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    // the button element is swapped for the collapsed variant — focus it and
    // confirm Space restores
    await toggleBtn(page).focus()
    await page.keyboard.press('Space')
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
  })
})
