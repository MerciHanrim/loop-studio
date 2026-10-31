import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// #423 item 5 (Lumi, 2026-10-31) — the desktop Review dialog keeps the dialog
// contract every other dialog keeps: focus moves into it when it opens, Tab
// stays inside it, the page behind it is inert, and Escape answers the top
// dialog only — with the "Replace the open diagram?" confirmation over Review,
// one Escape closes the confirmation alone. Before: `role="dialog"` without
// `useDialogFocus` / `pushOverlay` — no focus move, no trap, no `inert`, and
// Escape on a window listener.

type L = Record<string, { getState: () => any; setState: (p: object) => void }> & { revisionIO: Record<string, (...a: any[]) => any> }

/** a project, a proposal of it, then Review — `broken` adds a node of an
 *  unknown kind to the open document first, so Review offers only "Open as a
 *  document", which asks before replacing (#446) */
async function openReview(page: Page, broken: boolean): Promise<void> {
  await page.evaluate(async (bad) => {
    const l = (window as unknown as { __loop: L }).__loop
    let s = 0
    const mint = (p: string) => `${p}_${String(s++).padStart(26, '0')}`
    const g = l.graph.getState()
    g.newGraph()
    g.addNodeAt('pool', { x: 0, y: 0 })
    const plan = l.project.getState().planRevision({ now: '2026-10-31T00:00:00Z', mint })
    l.project.getState().commitRevisionExport(plan.plan)
    const pp = l.project.getState().planProposal({ now: '2026-10-31T01:00:00Z', mint })
    const routed = await l.revisionIO.routeImport(pp.text)
    if (bad)
      l.graph.setState({
        nodes: [...l.graph.getState().nodes, { id: 'w', type: 'widget', position: { x: 40, y: 260 }, data: { kind: 'widget', label: 'Wonder' } }],
      })
    l.review.getState().open(routed)
  }, broken)
  await expect(page.locator('.review')).toBeVisible()
}

const focusInReview = (page: Page) => page.evaluate(() => Boolean(document.activeElement?.closest('.review')))

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('Review takes focus when it opens, and Tab and Shift+Tab stay inside it', async ({ page }) => {
  await openReview(page, false)
  await expect.poll(() => focusInReview(page)).toBe(true)
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(key)
      expect(await focusInReview(page), `${key} × ${i + 1} stays in Review`).toBe(true)
    }
  }
})

test('the page behind Review is inert while it is open, and comes back when it closes', async ({ page }) => {
  await openReview(page, false)
  const toolbarInert = () => page.locator('.toolbar__actions').evaluate((el) => Boolean(el.closest('[inert]')))
  await expect.poll(toolbarInert).toBe(true)
  expect(await page.locator('.review').evaluate((el) => Boolean(el.closest('[inert]')))).toBe(false)
  await page.keyboard.press('Escape')
  await expect(page.locator('.review')).toHaveCount(0)
  await expect.poll(toolbarInert).toBe(false)
})

test('with the replace confirmation over Review, one Escape closes the confirmation only; the next closes Review', async ({ page }) => {
  await openReview(page, true)
  await page.locator('.review__actions button', { hasText: 'Open as a document' }).click()
  const confirm = page.locator('.mcdlg--confirm')
  await expect(confirm).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(page.locator('.review')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.review')).toHaveCount(0)
})
