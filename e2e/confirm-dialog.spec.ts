import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md Slice 2b — the shared in-app ConfirmDialog contract,
// exercised through the Share disclosure (the first flow moved off
// window.confirm). The point is the DIALOG behaviour; Share-specific assertions
// live in share.spec.ts.

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
  ],
})

const shareBtn = (page: Page) => page.locator('.toolbar__actions button', { hasText: /^Share$/ })
const dlg = (page: Page) => page.locator('.mcdlg--confirm')

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__clip = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void (window as any).__clip.push(t) },
    })
  })
}
const clip = (page: Page) => page.evaluate(() => (window as any).__clip as string[])

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as any).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      simulationRev: g.simulationRev,
      viewport: l.rf.getViewport(),
      status: s.status,
      values: JSON.stringify(s.values),
      hash: location.hash,
      href: location.href,
    }
  })

test.beforeEach(async ({ page }) => {
  await stubClipboard(page)
  await openApp(page)
  await resetAll(page)
  await importGraph(page, G)
})

test('nothing external happens before Confirm; opening + cancelling is a pure no-op', async ({ page }) => {
  const before = await snapshot(page)

  await shareBtn(page).click()
  await expect(dlg(page)).toBeVisible()
  // dialog is OPEN — still no clipboard write, no address-bar change, no doc change
  expect(await clip(page)).toEqual([])
  expect(await snapshot(page)).toEqual(before)

  await dlg(page).getByRole('button', { name: /^cancel$/i }).click()
  await expect(dlg(page)).toHaveCount(0)
  expect(await clip(page)).toEqual([])
  expect(await snapshot(page)).toEqual(before)
})

test('Cancel / Escape / backdrop are the same cancel path', async ({ page }) => {
  const before = await snapshot(page)

  // Escape
  await shareBtn(page).click()
  await expect(dlg(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dlg(page)).toHaveCount(0)
  expect(await clip(page)).toEqual([])

  // backdrop (mousedown on the scrim, outside the dialog box)
  await shareBtn(page).click()
  await expect(dlg(page)).toBeVisible()
  await page.locator('.mcdlg__scrim').click({ position: { x: 5, y: 5 } })
  await expect(dlg(page)).toHaveCount(0)
  expect(await clip(page)).toEqual([])

  expect(await snapshot(page)).toEqual(before)
})

test('focus is trapped, initial focus is Cancel, and it returns to the trigger on close', async ({ page }) => {
  await shareBtn(page).focus()
  await page.keyboard.press('Enter') // open via keyboard
  await expect(dlg(page)).toBeVisible()

  // initial focus on Cancel — so a stray Enter never fires the confirm
  await expect(dlg(page).getByRole('button', { name: /^cancel$/i })).toBeFocused()

  // Tab cycles inside the dialog only (2 buttons → wraps)
  await page.keyboard.press('Tab')
  await expect(dlg(page).getByRole('button', { name: /create link/i })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dlg(page).getByRole('button', { name: /^cancel$/i })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dlg(page)).toHaveCount(0)
  await expect(shareBtn(page)).toBeFocused() // focus back on the opener
})

test('a locale switch while the dialog is open re-renders it in the new locale', async ({ page }) => {
  await shareBtn(page).click()
  await expect(dlg(page)).toContainText('Create a share link?')

  await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('ko'))
  await expect(dlg(page)).toContainText('공유 링크를 만들까요?')
  await expect(dlg(page).getByRole('button', { name: '취소' })).toBeVisible()
  await expect(dlg(page).getByRole('button', { name: '링크 만들기' })).toBeVisible()

  await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('en'))
})

test('double-clicking Confirm runs the effect once', async ({ page }) => {
  await shareBtn(page).click()
  const confirm = dlg(page).getByRole('button', { name: /create link/i })
  await confirm.dblclick()
  await expect(page.locator('.share-pop')).toBeVisible()
  // exactly one clipboard write — the second click hit a closed dialog / busy guard
  expect(await clip(page)).toHaveLength(1)
})
