import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { openMonteCarloDialog, openRunSettings } from './support/workbenchMenus'

// issue #422 item 2 (Lumi, 2026-11-01) — Seed, Runs, Steps and Base seed: a
// blank field is being edited, not a value. While it is blank nothing is set
// and the run is not reset; Enter or leaving the field with it blank shows the
// value from before the edit again. A valid number still applies as it is
// typed, by the field's old range rule. Until now a blank became a value at
// once: Seed 0 (and a reset run), Runs and Steps 1, Base seed 0.

type Bridge = {
  __loop: {
    sim: { getState: () => { seed: number; stepIndex: number; stepOnce: () => void } }
    mc: { getState: () => { config: { runs: number; steps: number; baseSeed: number } } }
  }
}
const sim = (page: Page) => page.evaluate(() => { const s = (window as unknown as Bridge).__loop.sim.getState(); return { seed: s.seed, step: s.stepIndex } })
const mc = (page: Page) => page.evaluate(() => { const c = (window as unknown as Bridge).__loop.mc.getState().config; return { runs: c.runs, steps: c.steps, baseSeed: c.baseSeed } })

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
}

/** clear the field with the keyboard, one Backspace per character, from its end */
async function backspaceToBlank(field: Locator) {
  await field.focus()
  await field.press('End')
  const n = (await field.inputValue()).length
  for (let i = 0; i < n; i++) await field.press('Backspace')
  await expect(field).toHaveValue('')
}

test.describe('a blank number field is not a value (#422)', () => {
  test('Seed: blank sets nothing and resets nothing; Enter and leaving the field show the value from before the edit', async ({ page }) => {
    await load(page)
    // one step taken, so a reset would show (it puts the run back to step 0)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepOnce())
    await expect.poll(async () => (await sim(page)).step).toBe(1)
    await openRunSettings(page)
    const field = page.locator('.pstrip__seed')
    const before = await sim(page)
    const shown = String(before.seed)

    await field.fill('')
    await expect(field).toHaveValue('') // a blank is allowed while editing
    expect(await sim(page)).toEqual(before) // no seed set, the run not reset
    await field.press('Enter')
    await expect(field).toHaveValue(shown)
    expect(await sim(page)).toEqual(before)

    await field.fill('')
    expect(await sim(page)).toEqual(before)
    await field.blur()
    await expect(field).toHaveValue(shown)
    expect(await sim(page)).toEqual(before)

    // a valid number still applies as it is typed, and resets the run as before
    await field.fill('7')
    expect(await sim(page)).toEqual({ seed: 7, step: 0 })
    // emptied from 7 with the keyboard, then left: 7 is the value before this edit
    await field.blur()
    await backspaceToBlank(field)
    await field.blur()
    await expect(field).toHaveValue('7')
    expect((await sim(page)).seed).toBe(7)
  })

  test('Runs, Steps and Base seed in the Monte Carlo dialog: the same rule', async ({ page }) => {
    await load(page)
    await openMonteCarloDialog(page)
    const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
    await expect(dlg).toBeVisible()
    const fields = dlg.locator('input[type="number"]')
    await expect(fields).toHaveCount(3)
    const before = await mc(page)

    for (const i of [0, 1, 2]) {
      const field = fields.nth(i)
      const shown = await field.inputValue()
      await field.fill('')
      await expect(field).toHaveValue('')
      expect(await mc(page), `field ${i} blank`).toEqual(before)
      await field.press('Enter')
      await expect(field).toHaveValue(shown)
      expect(await mc(page)).toEqual(before)
      await field.fill('')
      await field.blur()
      await expect(field).toHaveValue(shown)
      expect(await mc(page)).toEqual(before)
      // emptied with the keyboard from the stored value: the value before the edit comes back
      await backspaceToBlank(field)
      await field.blur()
      await expect(field).toHaveValue(shown)
      expect(await mc(page), `field ${i} after backspacing`).toEqual(before)
    }

    // the old range rules for a valid number still apply as it is typed
    await fields.nth(0).fill('0')
    expect((await mc(page)).runs).toBe(1)
    await fields.nth(1).fill('2.7')
    expect((await mc(page)).steps).toBe(2)
    await fields.nth(2).fill('-3')
    expect((await mc(page)).baseSeed).toBe(0)
  })
})
