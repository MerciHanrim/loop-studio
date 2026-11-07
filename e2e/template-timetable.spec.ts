import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// SEMANTICS-M5.md §M5-10 — a Template that holds a timetable, opened from the menu as a
// person opens it, and stepped with the real button. Import has its own path, so a file
// that runs by import proved nothing here: the Template path once dropped the table, and
// the run refused it. The desalination Template is the bundled one that holds a table.

type Bridge = { __loop: Record<string, any> }

const pinned = JSON.parse(readFileSync(new URL('../examples/desalination.expected.json', import.meta.url), 'utf8')) as { modelVersion: number; checkpoints: { values: Record<string, number> }[] }

const opened = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    return { version: g.modelVersion as number, tables: (g.timetables as { id: string }[]).map((t) => t.id), series: l.sim.getState().timelineSeries as unknown, step: l.sim.getState().stepIndex as number, product: l.sim.getState().values?.product as number | undefined }
  })

test('a Template with a timetable opens from the menu and steps', async ({ page }) => {
  await openApp(page)
  await pickTemplate(page, 'desalination')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(37)

  const state = await opened(page)
  expect(state.version).toBe(pinned.modelVersion)
  expect(state.tables).toEqual(['demand'])
  expect(state.series).toEqual(['brine', 'filtered', 'permeate', 'product'])
  await expect(page.getByText(/Can.t run/)).toHaveCount(0)

  // the real control: the table has moved the Delivery pump by the end of the step
  await page.getByRole('button', { name: 'Advance one step' }).click()
  await expect.poll(async () => (await opened(page)).step).toBe(1)
  expect((await opened(page)).product).toBeCloseTo(pinned.checkpoints[0]!.values.product!, 6)
  await expect(page.locator('[data-run-strip="dpump"]')).toHaveAttribute('aria-label', /target\D+30\D+ran\D+30\D/)
})
