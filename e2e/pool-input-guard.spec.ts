import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// Audit ①-2 — a Pool's Starting amount / Capacity must be a finite number
// ≥ 0. Typing anything else in the Inspector used to commit it straight to
// the store, where `initSim` threw inside a store subscriber (a console
// error, a Reset that kept throwing, a value that survived reload). Now the
// Inspector keeps an invalid draft local (with a hint), and a bad value that
// arrives some other way (a hand-edited file) is surfaced as a run-strip
// notice with Play / Step disabled — never a thrown error.
//
// `test` from ./support/loop fails on ANY console.error / pageerror, which is
// the regression signal for the old behaviour.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const poolId = (page: Page) =>
  page.evaluate(
    () => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.data.kind === 'pool').id,
  )
const poolInitial = (page: Page) =>
  page.evaluate(
    () => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.data.kind === 'pool').data.initial,
  )
const simInitError = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().initError)

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    g.addNodeAt('pool', { x: 200, y: 100 })
    g.addNodeAt('source', { x: 0, y: 100 })
  })
})

test('typing a negative Starting amount stays a local draft with a hint; the store keeps the last valid value', async ({
  page,
}) => {
  const id = await poolId(page)
  await page.evaluate((nid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(nid, null), id)
  const starting = page.locator('.inspector input[type=number]').first()
  await expect(starting).toBeVisible()
  await starting.fill('4')
  expect(await poolInitial(page)).toBe(4)

  await starting.fill('-5')
  await expect(starting).toHaveValue('-5') // the draft is what the user typed…
  await expect(starting).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.inspector .field__hint--bad')).toBeVisible()
  expect(await poolInitial(page)).toBe(4) // …but the store never received it
  expect(await simInitError(page)).toBeNull()

  // Reset still works (it used to throw here), and blur snaps the field back
  await page.locator('.pstrip__group .pb-btn').first().click()
  await starting.blur()
  await expect(starting).toHaveValue('4')
  await expect(page.locator('.inspector .field__hint--bad')).toHaveCount(0)
})

test('a file that carries a negative Pool initial loads, disables Play / Step, and names the reason instead of throwing', async ({
  page,
}) => {
  const bad = await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const doc = JSON.parse(g.exportJSON())
    doc.nodes.find((n: any) => n.data.kind === 'pool').data.initial = -5
    return JSON.stringify(doc)
  })
  await importGraph(page, bad)
  await expect(page.locator('.pstrip__initerr')).toBeVisible()
  await expect(page.locator('.pstrip__initerr')).toContainText(/Cannot run/)
  await expect(page.locator('.pstrip__group .pb-btn--primary')).toBeDisabled()
  expect(await simInitError(page)).toMatch(/initial must be a finite number/)

  // fixing the value in the Inspector recovers the run strip
  const id = await poolId(page)
  await page.evaluate((nid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(nid, null), id)
  await page.locator('.inspector input[type=number]').first().fill('2')
  await expect(page.locator('.pstrip__initerr')).toHaveCount(0)
  await expect(page.locator('.pstrip__group .pb-btn--primary')).toBeEnabled()
  expect(await simInitError(page)).toBeNull()
})

// issue #406 — a Starting amount above the Capacity. Each field is valid on
// its own, so the Inspector commits both; the engine refuses the pair at
// initSim (it used to clamp the value at the first step in silence), the run
// strip names the Pool and both numbers, and the document keeps what was
// typed until the user corrects either field.
const poolCapacity = (page: Page) =>
  page.evaluate(
    () => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.data.kind === 'pool').data.capacity,
  )
const REFUSED = /initial must be ≤ its capacity \(initial 20, capacity 10\)/

test('typing Capacity 10 then Starting amount 20: both stored as typed, Play / Step disabled, the strip names the pair; raising the capacity recovers', async ({
  page,
}) => {
  const id = await poolId(page)
  await page.evaluate((nid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(nid, null), id)
  const starting = page.locator('.inspector input[type=number]').nth(0)
  const capacity = page.locator('.inspector input[type=number]').nth(1)
  await capacity.fill('10')
  await expect.poll(() => poolCapacity(page)).toBe(10)
  await starting.fill('20')
  await expect.poll(() => poolInitial(page)).toBe(20) // committed: the field alone is valid
  await expect(page.locator('.inspector .field__hint--bad')).toHaveCount(0)
  await expect(page.locator('.pstrip__initerr')).toBeVisible()
  await expect(page.locator('.pstrip__initerr')).toContainText(/Cannot run/)
  await expect(page.locator('.pstrip__group .pb-btn--primary')).toBeDisabled()
  expect(await simInitError(page)).toMatch(REFUSED)
  expect(await poolCapacity(page)).toBe(10) // nothing corrected behind the user's back

  await capacity.fill('25')
  await expect(page.locator('.pstrip__initerr')).toHaveCount(0)
  await expect(page.locator('.pstrip__group .pb-btn--primary')).toBeEnabled()
  expect(await simInitError(page)).toBeNull()
})

test('a file whose Pool has initial 20 and capacity 10 loads with both values intact and is refused the same way', async ({
  page,
}) => {
  const bad = await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const doc = JSON.parse(g.exportJSON())
    const p = doc.nodes.find((n: any) => n.data.kind === 'pool')
    p.data.initial = 20
    p.data.capacity = 10
    return JSON.stringify(doc)
  })
  await importGraph(page, bad)
  expect([await poolInitial(page), await poolCapacity(page)]).toEqual([20, 10])
  await expect(page.locator('.pstrip__initerr')).toBeVisible()
  await expect(page.locator('.pstrip__group .pb-btn--primary')).toBeDisabled()
  expect(await simInitError(page)).toMatch(REFUSED)

  // lowering the Starting amount in the Inspector recovers the run strip
  const id = await poolId(page)
  await page.evaluate((nid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(nid, null), id)
  await page.locator('.inspector input[type=number]').first().fill('10')
  await expect(page.locator('.pstrip__initerr')).toHaveCount(0)
  await expect(page.locator('.pstrip__group .pb-btn--primary')).toBeEnabled()
  expect(await simInitError(page)).toBeNull()
})
