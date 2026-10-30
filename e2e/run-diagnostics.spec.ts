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
    sim: { getState: () => { diagnostics: string[]; stepIndex: number } }
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
const simDiag = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().diagnostics)
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
