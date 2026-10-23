import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { pickLocale } from './support/workbenchMenus'

// A probabilistic Gate's outgoing rows read result · weight · chance, and each
// of its lines says its chance (Lumi, 2026-10-20; note 94's chance table made
// general — src/engine/gateChance.ts, the engine's own reading). What a static
// reading cannot fix is said to be decided at run time; weights that sum to 0
// say the Gate sends nothing. Reading the panel draws nothing and moves no run.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const node = (id: string, kind: string, data: Record<string, unknown>, x: number, y: number) => ({ id, type: kind, position: { x, y }, data: { kind, label: id, ...data } })
const res = (id: string, s: string, t: string, flow: string) => ({ id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })

// the general gacha's roll, weights by Parameter reference (a v2 document)
const ROLL = JSON.stringify({
  schema: 'loop-studio/graph/2',
  version: 1,
  nodes: [
    node('tickets', 'pool', { label: 'Tickets', activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' }, 300, 0),
    node('g_roll', 'gate', { label: 'Roll', activation: 'automatic', distribution: 'probabilistic', mode: 'pullAny' }, 300, 140),
    node('ssr', 'pool', { label: 'SSR result', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 100, 300),
    node('sr', 'pool', { label: 'SR result', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 300, 300),
    node('r', 'pool', { label: 'R result', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 500, 300),
    node('w_ssr', 'parameter', { label: 'SSR weight', value: 6 }, -100, 0),
    node('w_sr', 'parameter', { label: 'SR weight', value: 51 }, -100, 120),
    node('w_r', 'parameter', { label: 'R weight', value: 943 }, -100, 240),
  ],
  edges: [res('e_in', 'tickets', 'g_roll', '1'), res('e_a', 'g_roll', 'ssr', '@w_ssr'), res('e_b', 'g_roll', 'sr', '@w_sr'), res('e_c', 'g_roll', 'r', '@w_r')],
})

const panel = (page: Page) => page.locator('.app__body > :last-child')
const pick = async (page: Page, name: string) => {
  await page.locator('.wb-left').getByText(name, { exact: true }).first().click()
  await expect(panel(page).locator('.wb-rel')).toBeVisible()
}
const rows = (page: Page) =>
  panel(page)
    .locator('.wb-rel__row--chance')
    .evaluateAll((els) => els.map((e) => [e.querySelector('.wb-rel__name')!.textContent, e.querySelector('.wb-rel__effect')!.textContent, e.querySelector('.wb-rel__chance')!.textContent]))
const setFlow = (page: Page, id: string, flow: string) =>
  page.evaluate(
    ([id, flow]) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const e = g.edges.find((x: { id: string }) => x.id === id)
      g.setEdgeData(id, { ...e.data, flow })
    },
    [id, flow] as const,
  )

test.describe('a probabilistic Gate: result · weight · chance', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, ROLL)
  })

  test('English: each row its weight and chance, the lead and the sum; a line of the Gate says its chance', async ({ page }) => {
    await pick(page, 'Roll')
    expect(await rows(page)).toEqual([
      ['SSR result', '◇ SSR weight · 6', '0.6%'],
      ['SR result', '◇ SR weight · 51', '5.1%'],
      ['R result', '◇ R weight · 943', '94.3%'],
    ])
    await expect(panel(page).locator('.wb-rel__lead')).toHaveText('Picks one result by weight.')
    await expect(panel(page).locator('.wb-rel__cols')).toHaveText('Result · Weight · Chance')
    await expect(panel(page).locator('.wb-rel__sum')).toHaveText('chance = weight ÷ the sum, 1,000')
    // a row selects its line, whose panel says the same chance
    await panel(page).locator('.wb-rel__row--chance[data-edge="e_a"]').click()
    await expect(panel(page).locator('.wb-rel__chanceline')).toHaveText(/^Chance 6 ÷ 1,000 = 0\.6% · of .Roll.’s weights in total$/)
  })

  test('Korean: the same reading', async ({ page }) => {
    await pickLocale(page, 'ko')
    await pick(page, 'Roll')
    expect((await rows(page)).map((r) => r[2])).toEqual(['0.6%', '5.1%', '94.3%'])
    await expect(panel(page).locator('.wb-rel__lead')).toHaveText('가중치에 따라 결과 하나를 고릅니다.')
    await expect(panel(page).locator('.wb-rel__sum')).toHaveText('확률 = 가중치 ÷ 합계 1,000')
    await panel(page).locator('.wb-rel__row--chance[data-edge="e_c"]').click()
    await expect(panel(page).locator('.wb-rel__chanceline')).toHaveText(/^확률 943 ÷ 1,000 = 94\.3% · .Roll.의 가중치 합계 기준$/)
  })

  test('a random weight: every chance is decided at run time, never estimated', async ({ page }) => {
    await setFlow(page, 'e_b', '1-3')
    await pick(page, 'Roll')
    expect((await rows(page)).map((r) => r[1])).toEqual(['◇ SSR weight · 6', '1-3', '◇ R weight · 943'])
    expect((await rows(page)).map((r) => r[2])).toEqual(['At run time', 'At run time', 'At run time'])
    await expect(panel(page).locator('.wb-rel__sum')).toContainText('drawn anew every step')
    await panel(page).locator('.wb-rel__row--chance[data-edge="e_a"]').click()
    await expect(panel(page).locator('.wb-rel__chanceline')).toContainText('decided while the model runs')
  })

  test('weights that sum to 0: the Gate sends nothing', async ({ page }) => {
    for (const id of ['e_a', 'e_b', 'e_c']) await setFlow(page, id, '0')
    await pick(page, 'Roll')
    expect((await rows(page)).map((r) => r[2])).toEqual(['—', '—', '—'])
    await expect(panel(page).locator('.wb-rel__sum')).toHaveText('The weights add up to 0, so this Gate sends nothing.')
  })

  test('a weight that changes updates the chances; reading them moves no run and draws nothing', async ({ page }) => {
    const sim = () =>
      page.evaluate(() => {
        const s = (window as unknown as Bridge).__loop.sim.getState()
        return JSON.stringify({ status: s.status, step: s.stepIndex, values: s.values })
      })
    // a few steps first, from a reset (as the comparison below starts), so the
    // run has a state to keep
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.getState().reset()
      for (let i = 0; i < 3; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
    })
    const before = await sim()
    await pick(page, 'Roll')
    await panel(page).locator('.wb-rel__row--chance[data-edge="e_b"]').click()
    await expect(panel(page).locator('.wb-rel__chanceline')).toBeVisible()
    expect(await sim()).toBe(before)
    // the run continued with the panel open gives what the same steps give
    // with nothing selected: reset, nothing selected, the same four steps
    const withPanel = await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.getState().advance()
      // the store's state after the step (a state object read before it is stale)
      return JSON.stringify((window as unknown as Bridge).__loop.sim.getState().values)
    })
    // nothing selected (the store's selection and each element's own mark)
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.setSelection(null, null)
      g.onEdgesChange(g.edges.filter((e: { selected?: boolean }) => e.selected).map((e: { id: string }) => ({ id: e.id, type: 'select', selected: false })))
    })
    await expect(panel(page).locator('.wb-rel__chanceline')).toHaveCount(0)
    const plain = await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      s.reset()
      for (let i = 0; i < 4; i++) (window as unknown as Bridge).__loop.sim.getState().advance()
      return JSON.stringify((window as unknown as Bridge).__loop.sim.getState().values)
    })
    expect(withPanel).toBe(plain)
    // a weight edited in the document: the rows follow
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().updateNodeData('w_ssr', { value: 49 }))
    await pick(page, 'Roll')
    expect((await rows(page)).map((r) => r[2])).toEqual(['4.7%', '4.9%', '90.4%'])
    await expect(panel(page).locator('.wb-rel__sum')).toHaveText('chance = weight ÷ the sum, 1,043')
  })
})
