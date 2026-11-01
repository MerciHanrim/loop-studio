import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { openMonteCarloDialog, openRunSettings } from './support/workbenchMenus'

// issue #422 item 2 (Lumi, 2026-11-01) — Seed, Runs, Steps and Base seed:
// typing changes the field's draft only; a valid number is set when the edit
// is confirmed, by Enter or by leaving the field. A blank confirmed sets
// nothing: the value from before the edit, and the run's step, stay as they
// were. A valid number keeps the field's old range rule. Until now every
// keystroke was set at once: a blank became Seed 0 (resetting the run), Runs
// and Steps 1, Base seed 0, and clearing `500` set `50` and `5` on the way.

type Bridge = {
  __loop: {
    sim: { getState: () => { seed: number; stepIndex: number; stepOnce: () => void } }
    mc: { getState: () => { config: { runs: number; steps: number; baseSeed: number } } }
  }
}
const sim = (page: Page) => page.evaluate(() => { const s = (window as unknown as Bridge).__loop.sim.getState(); return { seed: s.seed, step: s.stepIndex } })
const mc = (page: Page) => page.evaluate(() => { const c = (window as unknown as Bridge).__loop.mc.getState().config; return { runs: c.runs, steps: c.steps, baseSeed: c.baseSeed } })
const stepOnce = async (page: Page) => {
  const at = (await sim(page)).step
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepOnce())
  await expect.poll(async () => (await sim(page)).step).toBe(at + 1)
}

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
}

/** clear the field with the keyboard, one Backspace per character, from its
 *  end, reading `read` after every key: it must stay `same` all the way */
async function backspaceToBlank(field: Locator, read: () => Promise<object>, same: object) {
  await field.focus()
  await field.press('End')
  const n = (await field.inputValue()).length
  for (let i = 0; i < n; i++) {
    await field.press('Backspace')
    expect(await read(), `after Backspace ${i + 1} of ${n}`).toEqual(same)
  }
  await expect(field).toHaveValue('')
}

test.describe('a number field sets its value on Enter or blur; a blank sets nothing (#422)', () => {
  test('Seed: clearing 500 a character at a time sets nothing and keeps the run’s step; Enter or blur on the blank shows 500', async ({ page }) => {
    await load(page)
    await openRunSettings(page)
    const field = page.locator('.pstrip__seed')
    // a three-digit seed, set by Enter (a new seed resets the run), then a step taken
    await field.fill('500')
    expect((await sim(page)).seed).not.toBe(500) // typing alone sets nothing
    await field.press('Enter')
    expect((await sim(page)).seed).toBe(500)
    await stepOnce(page)
    const before = await sim(page)
    expect(before).toEqual({ seed: 500, step: 1 })

    // cleared one character at a time, then left: nothing set, the step kept
    await backspaceToBlank(field, () => sim(page), before)
    await field.blur()
    await expect(field).toHaveValue('500')
    expect(await sim(page)).toEqual(before)

    // the same, confirmed by Enter
    await backspaceToBlank(field, () => sim(page), before)
    await field.press('Enter')
    await expect(field).toHaveValue('500')
    expect(await sim(page)).toEqual(before)

    // a valid number typed is set on blur, and resets the run as a new seed does
    await field.fill('7')
    expect(await sim(page)).toEqual(before)
    await field.blur()
    expect(await sim(page)).toEqual({ seed: 7, step: 0 })
  })

  test('Runs, Steps and Base seed in the Monte Carlo dialog: the same rule, and the old range rules', async ({ page }) => {
    await load(page)
    await openMonteCarloDialog(page)
    const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
    await expect(dlg).toBeVisible()
    const fields = dlg.locator('input[type="number"]')
    await expect(fields).toHaveCount(3)
    // multi-digit values, each set by Enter, so clearing them passes through shorter numbers
    for (const [i, v] of [[0, '500'], [1, '40'], [2, '123']] as const) {
      await fields.nth(i).fill(v)
      await fields.nth(i).press('Enter')
    }
    const before = await mc(page)
    expect(before).toEqual({ runs: 500, steps: 40, baseSeed: 123 })

    for (const i of [0, 1, 2]) {
      const field = fields.nth(i)
      const shown = await field.inputValue()
      await backspaceToBlank(field, () => mc(page), before)
      await field.blur()
      await expect(field).toHaveValue(shown)
      expect(await mc(page), `field ${i} after blur`).toEqual(before)
      await backspaceToBlank(field, () => mc(page), before)
      await field.press('Enter')
      await expect(field).toHaveValue(shown)
      expect(await mc(page), `field ${i} after Enter`).toEqual(before)
    }

    // a valid number is set on confirm, by the old range rules
    await fields.nth(0).fill('0')
    expect(await mc(page)).toEqual(before)
    await fields.nth(0).press('Enter')
    expect((await mc(page)).runs).toBe(1)
    await expect(fields.nth(0)).toHaveValue('1')
    await fields.nth(1).fill('2.7')
    await fields.nth(1).blur()
    expect((await mc(page)).steps).toBe(2)
    await fields.nth(2).fill('-3')
    await fields.nth(2).press('Enter')
    expect((await mc(page)).baseSeed).toBe(0)
  })
})
