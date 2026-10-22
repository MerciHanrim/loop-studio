import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { OVERFLOW_GRAPH, OVERFLOW_CASES, expectedMeaning, expectedRow, expectedValue, readValueRow } from './support/valueOverflow'

// Node structure — the value OVERFLOW rule of the new node (share
// 17-implementation-rules.md §4.1; Lumi 2026-10-12: "long integers, decimals,
// negatives, units and capacity displays: a clear elision mark, no precision
// change because of space, and the whole value reachable by keyboard and by
// touch — a comment saying 'see the Inspector' is not completion").
//
// The body's width is RESERVED from the document's display format (W1, floor
// 88 / cap 260). A formatted value wider than that keeps its format and its
// precision — the DOM text IS the full formatted value — and is clipped with
// the ellipsis as the elision mark. The whole text is then reachable three
// ways: the pointer tooltip on the row, the Inspector of the keyboard-selected
// node (desktop, this file), and the read-only sheet a tap opens on the phone
// (`node-value-overflow.mobile.spec.ts`).

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)

async function load(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page) // the new node is the default
  await resetAll(page)
  await importGraph(page, OVERFLOW_GRAPH)
  await expect(page.locator('.nodef--outside')).toHaveCount(JSON.parse(OVERFLOW_GRAPH).nodes.length)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport({ x: 80, y: 80, zoom: 1 }, { duration: 0 }))
}

/** select a node the way a keyboard user does: focus it, press Enter */
async function selectByKeyboard(page: Page, id: string): Promise<void> {
  await node(page, id).focus()
  await page.keyboard.press('Enter')
  await expect(node(page, id).locator('.nodef__sel')).toHaveCount(1)
}

test.describe('node structure — a value wider than the reserved body', () => {
  test('the row keeps the document format and precision, the ellipsis is the elision mark, and the whole value is beside the symbol', async ({ page }) => {
    await load(page)
    for (const c of OVERFLOW_CASES) {
      const row = await readValueRow(page, c.id)
      const value = expectedValue(c)
      // the DOM text is the whole formatted value: no rounding, no dropped
      // digits — space never changes what the number says
      expect(row.text, `${c.id}: full text`).toBe(value)
      // it does not fit its symbol, and the mark is the ellipsis: the row is
      // clipped (overflow hidden) with text-overflow ellipsis, its scroll width
      // wider than its box
      expect(row.overflows, `${c.id}: overflows its box (${row.scrollWidth} > ${row.clientWidth})`).toBe(true)
      expect(row.textOverflow, `${c.id}: elision mark`).toBe('ellipsis')
      expect(row.overflow, `${c.id}: clipped`).toBe('hidden')
      // and it is never ONLY cut short (Lumi, 2026-10-19): the line beside the
      // symbol writes it in full, with what it means (a capacity, a unit)
      expect(row.auxValue, `${c.id}: the whole value beside the symbol`).toBe(value)
      expect(row.auxMeaning, `${c.id}: what it means beside the symbol`).toBe(expectedMeaning(c))
      // the pointer path: the whole text on the row's tooltip
      expect(row.title, `${c.id}: tooltip`).toBe(expectedRow(c))
      // the symbol is never grown for the value: the 56 px cell
      expect(row.bodyWidth, `${c.id}: body width`).toBe(56)
    }
  })

  test('a Pool elides, not shrinks: a twelve-digit count keeps the value size', async ({ page }) => {
    await load(page)
    const row = await readValueRow(page, 'p_twelve')
    expect(row.text).toBe('123456789012')
    expect(row.overflows, `overflows (${row.scrollWidth} > ${row.clientWidth})`).toBe(true)
    expect(row.textOverflow).toBe('ellipsis')
    // the glyphs are not scaled down: the row's font size is the symbol node's
    // value type, 16 px (the workbench; the previous body's was 18 px)
    expect(row.fontSize).toBe('16px')
    expect(row.auxValue, 'and written in full beside the symbol').toBe('123456789012')
  })

  test('keyboard path: a keyboard-selected node shows the whole value in the Inspector', async ({ page }) => {
    await load(page)
    // a Pool: starting amount and capacity, as authored, in the number fields
    await selectByKeyboard(page, 'p_cap')
    await expect(page.getByLabel('Starting amount')).toHaveValue('123456789012345')
    await expect(page.getByLabel('Capacity (blank = unlimited)')).toHaveValue('999999999999999')
    // a Parameter: the authored value and the unit
    await selectByKeyboard(page, 'par_neg')
    await expect(page.getByLabel('Value', { exact: true })).toHaveValue('-123456789.125')
    await expect(page.getByLabel('Unit (advisory)')).toHaveValue('credits per second/user')
    // a Register: the read-back's total is the engine's number verbatim (the
    // same digits the row carries, computed by the product's own rule)
    await selectByKeyboard(page, 'reg_big')
    const big = expectedValue(OVERFLOW_CASES.find((c) => c.id === 'reg_big')!).replace(/^= /, '')
    await expect(page.locator('.regrb__total')).toContainText(big)
  })

  test('keyboard path, after a run: the CURRENT count of a Pool is reachable, not only its starting amount', async ({ page }) => {
    await load(page)
    // one step: the Source pushes 1e11 into the uncapped Pool
    await page.evaluate(() => (window as unknown as { __loop: { sim: { getState: () => { stepOnce: () => void } } } }).__loop.sim.getState().stepOnce())
    await expect(node(page, 'p_live').locator('.nodef__value')).toHaveText(/^100000000000$/)
    const row = await readValueRow(page, 'p_live')
    expect(row.overflows, `the twelve-digit count overflows the six-digit reservation (${row.scrollWidth} > ${row.clientWidth})`).toBe(true)
    // the keyboard user selects the Pool: the Inspector must carry the current
    // count in full (the starting amount is 0 — not the value the node shows)
    await selectByKeyboard(page, 'p_live')
    await expect(page.getByLabel('Starting amount')).toHaveValue('0')
    await expect(page.getByLabel('Current amount')).toHaveValue('100000000000')
  })
})
