import { readFileSync } from 'node:fs'
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

// #615 item 2 — a field that allows a blank (Pool capacity: blank = unlimited;
// a Parameter's Min, Max and Step) stores its value as you type. A number input
// reports a half-typed `-` or `1e` as an empty value, the same as a blank, so
// typing a minus cleared the capacity to unlimited, saved it and reset the run,
// and it stayed so when `-5` was refused. The browser tells them apart
// (`validity.badInput`, measured true for `-` and `1e`, false for a real blank):
// a half-typed number is now an edit in progress — nothing stored, the hint
// shown, the stored value shown again on leaving. A real blank still clears.
test.describe('a half-typed number in a field that allows a blank is not stored as a blank (#615 item 2)', () => {
  type G = { __loop: { graph: { getState: () => any; setState: (s: unknown) => void }; autosave: { flush: () => void } } }
  const field = (page: Page, label: string) => page.getByLabel(label, { exact: true })

  async function scene(page: Page): Promise<string> {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFileSync(new URL('../examples/state-verification.json', import.meta.url), 'utf8'))
    await page.evaluate(() => (window as unknown as G).__loop.graph.getState().addNodeAt('parameter', { x: 900, y: 600 }))
    return page.evaluate(() => (window as unknown as G).__loop.graph.getState().nodes.at(-1).id as string)
  }
  /** the stored value, what the autosave wrote, and the run's step */
  const state = (page: Page, node: string, key: string) =>
    page.evaluate(
      ({ node, key }) => {
        const l = (window as unknown as G).__loop
        l.autosave.flush()
        const d = l.graph.getState().nodes.find((n: { id: string }) => n.id === node).data
        const rec = JSON.parse(localStorage.getItem('loop-studio:graph:v1') ?? 'null')
        const saved = rec?.nodes?.find((n: { id: string }) => n.id === node)?.data
        return { stored: d[key] ?? null, saved: saved?.[key] ?? null, step: (window as unknown as { __loop: { sim: { getState: () => { stepIndex: number } } } }).__loop.sim.getState().stepIndex }
      },
      { node, key },
    )
  const select = (page: Page, id: string) => page.evaluate((id) => (window as unknown as G).__loop.graph.setState({ selectedNodeId: id, selectedEdgeId: null }), id)

  /** set `start`, take one step of the run, then type `keys` after select-all */
  async function typeOver(page: Page, node: string, label: string, start: string, keys: string[]) {
    await select(page, node)
    const f = field(page, label)
    await f.fill(start)
    await f.press('Tab')
    await stepOnce(page)
    // the run's step just before typing (a repeated start value resets nothing)
    const stepBefore = await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepIndex: number } } } }).__loop.sim.getState().stepIndex)
    // held as an element: an invalid hint joins the field's accessible name
    const el = (await f.elementHandle())!
    await el.click()
    await el.press('Control+a')
    for (const k of keys) await el.press(k)
    return { el, stepBefore }
  }

  const BLANK_ALLOWED = [
    ['Pool capacity', 'buffer', 'Capacity (blank = unlimited)', 'capacity', '10'],
    ['Parameter Min', 'PARAM', 'Min (advisory)', 'min', '2'],
    ['Parameter Max', 'PARAM', 'Max (advisory)', 'max', '50'],
    ['Parameter Step', 'PARAM', 'Step (advisory)', 'step', '5'],
  ] as const

  for (const [name, nodeKey, label, key, start] of BLANK_ALLOWED) {
    test(`${name}: \`-\` and \`1e\` store nothing, keep the run, show the hint, and show the value again on leaving; a real blank still clears`, async ({ page }) => {
      const pid = await scene(page)
      const node = nodeKey === 'PARAM' ? pid : nodeKey
      // `-`: nothing stored, the run kept. `1e`: the `1` on the way is a valid
      // number and is stored as you type (as in every such field, the controls
      // too); the `e` must not then clear it.
      for (const [input, keys, value, runKept, shown] of [
        ['-', ['Minus'], Number(start), true, start],
        ['1e', ['1', 'e'], 1, false, '1'],
      ] as const) {
        const { el, stepBefore } = await typeOver(page, node, label, start, [...keys])
        const kept = { stored: value, saved: value, step: runKept ? stepBefore : 0 }
        expect.soft(await state(page, node, key), `${input}: typing`).toEqual(kept)
        expect.soft(await el.getAttribute('aria-invalid'), `${input}: the field says it is not a number yet`).toBe('true')
        // the capacity field has a visible hint (Min, Max and Step have none, for any input)
        if (key === 'capacity') await expect.soft(page.getByText('Enter a number that is 0 or greater.'), `${input}: the hint`).toBeVisible()
        await el.press('Tab')
        expect.soft(await el.inputValue(), `${input}: on leaving, the stored value again`).toBe(shown)
        expect(await state(page, node, key), `${input}: after leaving`).toEqual(kept)
      }
      // control: a real blank still clears (and, being a change, resets the run)
      const { el } = await typeOver(page, node, label, start, ['Backspace'])
      await el.press('Tab')
      expect(await state(page, node, key)).toEqual({ stored: null, saved: null, step: 0 })
    })
  }

  test('controls — Pool starting amount and Parameter value (no blank): `-` and a blank store nothing, as before', async ({ page }) => {
    const pid = await scene(page)
    for (const [node, label, key, start] of [['buffer', 'Starting amount', 'initial', '7'], [pid, 'Value', 'value', '4']] as const) {
      for (const keys of [['Minus'], ['Backspace']]) {
        const { el, stepBefore } = await typeOver(page, node, label, start, keys)
        expect.soft(await state(page, node, key)).toEqual({ stored: Number(start), saved: Number(start), step: stepBefore })
        await el.press('Tab')
        expect(await el.inputValue()).toBe(start)
      }
    }
  })
})
