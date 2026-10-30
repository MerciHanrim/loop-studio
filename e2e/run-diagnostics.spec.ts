import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// issue #396 (Lumi, 2026-10-30) — the engine's step diagnostics reach the
// screen. The case: a `50%` flow on a Converter connection is refused (the
// edge contributes 0) and the step's diagnostic names the connection, the
// expression and the number that keeps the old rate. `simStore.diagnostics`
// holds the step's set (replaced per step, emptied by Reset and a document
// change); the run strip shows it on its own line UNDER the run row, so the
// row's one-row fit is untouched; a status region reads it once per change.
// Desktop under `chromium`, the phone's run bar under `mobile`.

type Bridge = {
  __loop: {
    graph: {
      getState: () => {
        nodes: { id: string; data: { kind: string } }[]
        edges: { id: string }[]
        newGraph: () => void
        addNodeAt: (k: string, p: { x: number; y: number }) => void
        updateNodeData: (id: string, d: object) => void
        onConnect: (c: object, kind: string) => unknown
        setEdgeData: (id: string, d: object) => void
      }
    }
    sim: { getState: () => { diagnostics: string[]; stepIndex: number; values: Record<string, number> | null } }
  }
}

/** Pool A (8) ─50%→ Converter C ─1→ Pool B, built through the store; returns the refused edge's id */
const seedConverterPercent = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    g.newGraph()
    g.addNodeAt('pool', { x: 40, y: 120 })
    g.addNodeAt('converter', { x: 300, y: 120 })
    g.addNodeAt('pool', { x: 560, y: 120 })
    const [a, c, b] = (window as unknown as Bridge).__loop.graph.getState().nodes.map((n) => n.id)
    const G = () => (window as unknown as Bridge).__loop.graph.getState()
    G().updateNodeData(a, { initial: 8 })
    G().onConnect({ source: a, target: c, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    G().onConnect({ source: c, target: b, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    const [e1, e2] = G().edges.map((e) => e.id)
    G().setEdgeData(e1, { kind: 'resource', flow: '50%' })
    G().setEdgeData(e2, { kind: 'resource', flow: '1' })
    return e1
  })
/** `n` Pools, each ─50%→ its own Converter ─1→ one target Pool: n refused connections in one step */
const seedManyConverterPercents = (page: Page, n: number) =>
  page.evaluate((count) => {
    const G = () => (window as unknown as Bridge).__loop.graph.getState()
    G().newGraph()
    G().addNodeAt('pool', { x: 900, y: 120 })
    const target = G().nodes[0].id
    for (let i = 0; i < count; i++) {
      G().addNodeAt('pool', { x: 40, y: 60 + i * 90 })
      const a = G().nodes[G().nodes.length - 1].id
      G().updateNodeData(a, { initial: 8 })
      G().addNodeAt('converter', { x: 420, y: 60 + i * 90 })
      const c = G().nodes[G().nodes.length - 1].id
      G().onConnect({ source: a, target: c, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      const eIn = G().edges[G().edges.length - 1].id
      G().setEdgeData(eIn, { kind: 'resource', flow: '50%' })
      G().onConnect({ source: c, target, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      const eOut = G().edges[G().edges.length - 1].id
      G().setEdgeData(eOut, { kind: 'resource', flow: '1' })
    }
  }, n)
/** Source (push all) ─2→ Pool P and ─2→ Drain D (#419 item 2); returns the Drain edge's id and the Pool's id */
const seedPushAllNonPool = (page: Page) =>
  page.evaluate(() => {
    const G = () => (window as unknown as Bridge).__loop.graph.getState()
    G().newGraph()
    G().addNodeAt('source', { x: 40, y: 120 })
    G().addNodeAt('pool', { x: 300, y: 40 })
    G().addNodeAt('drain', { x: 300, y: 220 })
    const [s, p, d] = G().nodes.map((n) => n.id)
    G().updateNodeData(s, { mode: 'pushAll' })
    G().onConnect({ source: s, target: p, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    G().onConnect({ source: s, target: d, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
    const [eP, eD] = G().edges.map((e) => e.id)
    G().setEdgeData(eP, { kind: 'resource', flow: '2' })
    G().setEdgeData(eD, { kind: 'resource', flow: '2' })
    return { eD, p }
  })
const simDiag = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().diagnostics)
const poolValue = (page: Page, id: string) =>
  page.evaluate((pid) => (window as unknown as Bridge).__loop.sim.getState().values?.[pid], id)
const inViewport = async (page: Page, selector: string) => {
  const vp = page.viewportSize()!
  const b = (await page.locator(selector).first().boundingBox())!
  return b.y >= 0 && b.y + b.height <= vp.height && b.x >= 0 && b.x + b.width <= vp.width
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 500

const strip = (page: Page) => page.locator('.pstrip').first()
const diag = (page: Page) => page.locator('[data-testid="run-diagnostics"]').first()
const stepBtn = (page: Page) => strip(page).locator('.pstrip__step-btn')
const resetBtn = (page: Page) => strip(page).locator('.pstrip__reset')
const status = (page: Page) => page.locator('.pstrip-diag__status[role="status"]').first()

test.describe('the run strip shows the step diagnostics (#396)', () => {
  test('a refused percent on a Converter connection: one Step shows the line naming the connection, "50%" and "write 0.5"; a status region carries the same text', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const e1 = await seedConverterPercent(page)
    await expect(diag(page)).toHaveCount(0)

    await stepBtn(page).click()
    await expect(diag(page)).toBeVisible()
    await expect(diag(page).locator('.pstrip__diag-title')).toHaveText(/\(1\)/)
    const items = diag(page).locator('.pstrip__diag-list li')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText(`Edge "${e1}" flow "50%"`)
    await expect(items.first()).toContainText('write 0.5')
    await expect(status(page)).toContainText(`Edge "${e1}" flow "50%"`)
    expect(await simDiag(page)).toHaveLength(1)
  })

  test('a push-all Source with a Drain among its targets (#419 item 2): one Step shows the line naming that connection, and the Pool stays 0', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const { eD, p } = await seedPushAllNonPool(page)
    const line = page.locator('[data-testid="run-diagnostics"]').first()
    await expect(line).toHaveCount(0)
    await page.locator('.pstrip .pstrip__step-btn').first().click()
    await expect(line).toBeVisible()
    const items = line.locator('.pstrip__diag-list li')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText(`Edge "${eD}"`)
    await expect(items.first()).toContainText('not a Pool')
    await expect(items.first()).toContainText('push-all Source moves nothing')
    expect(await poolValue(page, p)).toBe(0)
    await page.locator('.pstrip .pstrip__step-btn').first().click()
    await expect(items).toHaveCount(1) // one line per step, replaced, never piling up
    expect(await poolValue(page, p)).toBe(0)
  })

  test('the next Steps do not pile it up; Reset clears it; a document change clears it', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seedConverterPercent(page)
    await stepBtn(page).click()
    await stepBtn(page).click()
    await stepBtn(page).click()
    await expect(diag(page).locator('.pstrip__diag-list li')).toHaveCount(1)
    await expect(diag(page).locator('.pstrip__diag-title')).toHaveText(/\(1\)/)

    await resetBtn(page).click()
    await expect(diag(page)).toHaveCount(0)
    expect(await simDiag(page)).toEqual([])

    await stepBtn(page).click()
    await expect(diag(page)).toBeVisible()
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().newGraph()) // a document boundary
    await expect(diag(page)).toHaveCount(0)
    expect(await simDiag(page)).toEqual([])
  })

  test('desktop: the line sits under the run row and leaves the row where it was, also with the row folded narrow', async ({ page }) => {
    test.skip(isMobile(page), 'the desktop run strip')
    await openApp(page)
    await resetAll(page)
    await seedConverterPercent(page)
    const rowItems = () =>
      page.evaluate(() => {
        const s = document.querySelector('.pstrip')!
        const r = (el: Element | null) => {
          const b = el!.getBoundingClientRect()
          return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) }
        }
        return { group: r(s.querySelector('.pstrip__group')), step: r(s.querySelector('.pstrip__step')), tl: r(s.querySelector('.pstrip__collapse') ?? s.querySelector('.pstrip__tl')) }
      })
    const before = await rowItems()
    const fitBefore = await strip(page).getAttribute('data-fit')
    await stepBtn(page).click()
    await expect(diag(page)).toBeVisible()
    const after = await rowItems()
    // the row's own arrangement is untouched: the transport group and the step
    // readout keep their x, width and height, and the three stay on one line
    // (the strip grows by the new line only, below them). The Timeline toggle
    // is left out of the x / width check: the first Step gives it its own
    // "new result" wording, which is not this line's doing.
    for (const k of ['group', 'step'] as const) {
      expect({ x: after[k].x, w: after[k].w, h: after[k].h }, k).toEqual({ x: before[k].x, w: before[k].w, h: before[k].h })
    }
    expect(after.tl.h).toBe(before.tl.h)
    // one line: the row centres its items vertically, so the centres meet (tops differ by height)
    const centre = (r: { top: number; h: number }) => r.top + r.h / 2
    expect(Math.abs(centre(after.step) - centre(after.group))).toBeLessThanOrEqual(1)
    expect(Math.abs(centre(after.tl) - centre(after.group))).toBeLessThanOrEqual(1)
    const group = (await strip(page).locator('.pstrip__group').first().boundingBox())!
    const line = (await diag(page).boundingBox())!
    expect(line.y).toBeGreaterThanOrEqual(group.y + group.height - 1) // the line is below the row
    expect(await strip(page).getAttribute('data-fit')).toBe(fitBefore) // the fold step is the row's own, unchanged

    // the folded row (fit step 2 or 3, as run-bar-fit.spec pins it): the line still sits below
    await page.addStyleTag({ content: '.canvas-col { max-width: 360px !important; }' })
    await expect.poll(() => strip(page).getAttribute('data-fit')).toMatch(/^[23]$/)
    const g2 = (await strip(page).locator('.pstrip__group').first().boundingBox())!
    const l2 = (await diag(page).boundingBox())!
    expect(l2.y).toBeGreaterThanOrEqual(g2.y + g2.height - 1)
    await expect(strip(page).locator('.pstrip__settings-btn')).toBeVisible() // the folded row's own controls are intact
  })

  test('desktop: eight refused connections at once — the region is bounded and scrolls, every item is in the list, the run buttons and the Timeline stay on screen', async ({ page }) => {
    test.skip(isMobile(page), 'the desktop run strip')
    await openApp(page)
    await resetAll(page)
    await seedManyConverterPercents(page, 8)
    await stepBtn(page).click()
    await expect(diag(page)).toBeVisible()
    await expect(diag(page).locator('.pstrip__diag-list li')).toHaveCount(8)
    const box = await diag(page).evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }))
    expect(box.client).toBeLessThanOrEqual(96)
    expect(box.scroll).toBeGreaterThan(box.client) // bounded: the rest scrolls
    expect(box.overflowY).toBe('auto')
    // the last item is reachable inside the region
    await diag(page).locator('.pstrip__diag-list li').last().scrollIntoViewIfNeeded()
    expect(await diag(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(diag(page).locator('.pstrip__diag-list li').last()).toBeInViewport()
    // the keyboard can reach and scroll it (a focusable region with a name)
    await expect(diag(page)).toHaveAttribute('tabindex', '0')
    await expect(diag(page)).toHaveAttribute('role', 'region')
    // the run controls, the step readout and the Timeline area stay on screen
    for (const s of ['.pstrip .pstrip__step-btn', '.pstrip .pstrip__reset', '.pstrip .pb-btn--primary', '.pstrip .pstrip__collapse']) {
      expect(await inViewport(page, s), s).toBe(true)
    }
    await expect(page.locator('.timeline__panel')).toBeVisible()
    await stepBtn(page).click() // still usable with the region shown
    await expect(diag(page).locator('.pstrip__diag-list li')).toHaveCount(8)
  })

  test('phone: eight refused connections at once — the bar row is bounded and scrolls, and the bar with its controls stays within the screen', async ({ page }) => {
    test.skip(!isMobile(page), 'the phone run bar')
    await openApp(page)
    await resetAll(page)
    await seedManyConverterPercents(page, 8)
    const bar = page.locator('.pstrip--mobile')
    await bar.locator('.pstrip__step-btn').click()
    const row = bar.locator('[data-testid="run-diagnostics"]')
    await expect(row).toBeVisible()
    await expect(row.locator('.pstrip__diag-list li')).toHaveCount(8)
    const box = await row.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    expect(box.client).toBeLessThanOrEqual(72)
    expect(box.scroll).toBeGreaterThan(box.client)
    await row.locator('.pstrip__diag-list li').last().scrollIntoViewIfNeeded()
    await expect(row.locator('.pstrip__diag-list li').last()).toBeInViewport()
    const vp = page.viewportSize()!
    const b = (await bar.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1)
    for (const s of ['.pstrip--mobile .pstrip__step-btn', '.pstrip--mobile .pstrip__reset', '.pstrip--mobile .pb-btn--primary', '.pstrip--mobile .pstrip__tl']) {
      expect(await inViewport(page, s), s).toBe(true)
    }
    await bar.locator('.pstrip__step-btn').click()
    await expect(row.locator('.pstrip__diag-list li')).toHaveCount(8)
  })

  test('phone: the run bar shows the same line as a row of the bar', async ({ page }) => {
    test.skip(!isMobile(page), 'the phone run bar')
    await openApp(page)
    await resetAll(page)
    const e1 = await seedConverterPercent(page)
    await page.locator('.pstrip--mobile .pstrip__step-btn').click()
    const line = page.locator('.pstrip--mobile [data-testid="run-diagnostics"]')
    await expect(line).toBeVisible()
    await expect(line).toContainText(`Edge "${e1}" flow "50%"`)
    await page.locator('.pstrip--mobile .pstrip__reset').click()
    await expect(line).toHaveCount(0)
  })
})
