import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { menuRow, pickTemplate } from './support/workbenchMenus'

// docs/workbench.md — Run ▸ Play is the run bar's primary button in the menu
// bar: after a run has ended it reads Replay and starts again from step 0, as
// the run bar's button does (PlayBar `onPrimary`: reset, then play). Before
// this, the menu row read Play and called play() on the ended run, which
// carried on past the end.

type Bridge = { __loop: { sim: { getState: () => any } } }
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    return { step: s.stepIndex as number, status: s.status as string, first: s.series[0]?.step as number }
  })

async function endedGeneral(page: Page): Promise<number> {
  await pickTemplate(page, 'gacha-general')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(17)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // run to the end one step at a time (the store's own step, no animation)
  const end = await page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState
    s().setSpeed(20)
    s().reset()
    for (let i = 0; i < 400 && s().status !== 'ended'; i++) s().advance()
    return { status: s().status as string, step: s().stepIndex as number }
  })
  expect(end.status).toBe('ended')
  return end.step
}

test.describe('Run ▸ Play after the run has ended', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
  })

  test('the row reads Replay and starts the run again from step 0, as the run bar does', async ({ page }) => {
    const end = await endedGeneral(page)
    // the run bar's button names the same action
    await expect(page.locator('.pstrip:not(.pstrip--mobile) .pb-btn--primary')).toHaveText('Replay')
    const row = await menuRow(page, 'run', /^Replay$/)
    await expect(row).toBeEnabled()
    await row.click()
    // started again: back to step 0 and running, not stepping on past the end
    await expect.poll(async () => (await sim(page)).status).toBe('running')
    const now = await sim(page)
    expect(now.step, 'the run restarted rather than continuing past the end').toBeLessThan(end)
    expect(now.first).toBe(0)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
  })

  test('the run bar’s Replay, for comparison: the same start from step 0', async ({ page }) => {
    const end = await endedGeneral(page)
    await page.locator('.pstrip:not(.pstrip--mobile) .pb-btn--primary').click()
    await expect.poll(async () => (await sim(page)).status).toBe('running')
    const now = await sim(page)
    expect(now.step).toBeLessThan(end)
    expect(now.first).toBe(0)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
  })

  test('a graph that cannot be initialised: Play and Step are disabled in the menu, as on the run bar', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { __loop: { sim: { setState: (s: object) => void } } }).__loop.sim.setState({ initError: 'test' }))
    await expect(page.locator('.pstrip:not(.pstrip--mobile) .pb-btn--primary')).toBeDisabled()
    await expect(await menuRow(page, 'run', /^Play$/)).toBeDisabled()
    await expect(await menuRow(page, 'run', /^Step$/)).toBeDisabled()
  })
})
