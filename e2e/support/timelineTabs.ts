import type { Page } from '@playwright/test'
import { expect } from './loop'

// #538 — a document with two or more strips shows them in the Timeline's strips tab, one at a
// time, picked from a list by key (`run:<group id>` or `table:<table id>`); a document with one
// strip has no tabs and keeps it under the chart. docs/workbench.md §WB7.

const stripsTab = (page: Page) => page.locator('.timeline__tabs [data-tab="strips"]')

/** open the strips tab (when the document has tabs) and pick `key`; with one strip, nothing */
export async function showStrip(page: Page, key?: string): Promise<void> {
  if ((await stripsTab(page).count()) === 0) return
  if ((await stripsTab(page).getAttribute('aria-selected')) !== 'true') await stripsTab(page).click()
  await expect(stripsTab(page)).toHaveAttribute('aria-selected', 'true')
  if (key) {
    await page.locator('.timeline__strip-pick select').selectOption(key)
    await expect(page.locator('.timeline__strip-pick select')).toHaveValue(key)
  }
}

/** the strips' keys in their order: the picker's options */
export const stripKeys = (page: Page): Promise<string[]> =>
  page.locator('.timeline__strip-pick option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
