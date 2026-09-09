import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/register-expression-authoring.md §RXA8b — the operator / paren buttons
// under the Register expression input. `×` / `÷` insert the grammar's `*` / `/`;
// operators get one space per side; `( )` wraps a selection or inserts `()`.
// Presentation only: the stored `expr`, canonical form, and the `loop-revision/2`
// digest are unchanged (RXA-INV-1); a button press is one ordinary edit.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'wallet', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Wallet', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'savings_pool', type: 'pool', position: { x: 0, y: 200 }, data: { kind: 'pool', label: 'Savings', activation: 'passive', initial: 34, capacity: null, mode: 'pullAny' } },
    { id: 'net', type: 'register', position: { x: 360, y: 0 }, data: { kind: 'register', label: 'Net worth', expr: '0', format: 'integer' } },
  ],
  edges: [],
})

const expr = (page: Page) => page.locator('.regexpr input[role="combobox"]')
const opByGlyph = (page: Page, glyph: string) =>
  page.locator('.regexpr__ops button', { hasText: glyph })

const modelExpr = (page: Page, id: string) =>
  page.evaluate((n) => (window as any).__loop.graph.getState().nodes.find((x: any) => x.id === n)?.data.expr, id)
const pastLen = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().past.length)
const caret = (page: Page) =>
  expr(page).evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])

async function select(page: Page, id: string) {
  await page.evaluate((n) => (window as any).__loop.graph.getState().setSelection(n, null), id)
}
async function setLocale(page: Page, code: 'en' | 'ko' | 'ja') {
  await page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
}
async function setInput(page: Page, value: string, selStart: number, selEnd = selStart) {
  await expr(page).evaluate(
    (el, [v, s, e]) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      ;(el as HTMLInputElement).focus()
      ;(el as HTMLInputElement).setSelectionRange(s as number, e as number)
    },
    [value, selStart, selEnd] as const,
  )
  // a value whose caret sits in an `@…` token opens the autocomplete popover,
  // which overlays the operator row; dismiss it so button clicks land.
  await expr(page).press('Escape')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GRAPH)
  await select(page, 'net')
  await expect(expr(page)).toBeVisible()
})

test('§RXA8b.1 — the row shows five buttons; × / ÷ insert the grammar operators * and /', async ({ page }) => {
  await expect(page.locator('.regexpr__ops button')).toHaveCount(5)
  await expect(page.locator('.regexpr__ops')).toHaveAttribute('role', 'group')

  await setInput(page, '@wallet', 7)
  await opByGlyph(page, '×').click()
  await expect(expr(page)).toHaveValue('@wallet * ')
  await expr(page).pressSequentially('@savings_pool')
  await expect(expr(page)).toHaveValue('@wallet * @savings_pool')
  expect(await modelExpr(page, 'net')).toBe('@wallet * @savings_pool')

  await setInput(page, '@wallet', 7)
  await opByGlyph(page, '÷').click()
  await expect(expr(page)).toHaveValue('@wallet / ')
})

test('§RXA8b.2 — an operator gets one space per side; an existing space is not doubled; focus + caret return to the input', async ({ page }) => {
  await setInput(page, '12', 1)
  await opByGlyph(page, '＋').click()
  await expect(expr(page)).toHaveValue('1 + 2')
  await expect(expr(page)).toBeFocused()
  expect(await caret(page)).toEqual([4, 4]) // right after "1 + "

  // caret sitting just after an existing space → no second leading space
  await setInput(page, '1 2', 2)
  await opByGlyph(page, '−').click()
  await expect(expr(page)).toHaveValue('1 - 2')
  expect(await expr(page).inputValue()).not.toMatch(/ {2}/)
})

test('§RXA8b.3 — ( ) wraps the current selection; with no selection it inserts () and puts the caret between', async ({ page }) => {
  // wrap a selection ("@wallet + @savings_pool" is indices 0..23)
  await setInput(page, '@wallet + @savings_pool * 2', 0, 23)
  await opByGlyph(page, '( )').click()
  await expect(expr(page)).toHaveValue('(@wallet + @savings_pool) * 2')
  expect(await modelExpr(page, 'net')).toBe('(@wallet + @savings_pool) * 2')

  // no selection → "()" with the caret inside
  await setInput(page, '1 + ', 4)
  await opByGlyph(page, '( )').click()
  await expect(expr(page)).toHaveValue('1 + ()')
  expect(await caret(page)).toEqual([5, 5])
  await expr(page).pressSequentially('@wallet')
  await expect(expr(page)).toHaveValue('1 + (@wallet)')
})

test('§RXA8b.4 — draft-until-valid holds, and one button press is one undo entry', async ({ page }) => {
  await setInput(page, '@wallet', 7) // a bare @ref is a valid expression — this commits
  await page.waitForTimeout(700) // past COALESCE_MS so the next commit is its own entry
  const past0 = await pastLen(page)

  // press × — "@wallet * " does not parse, so nothing commits (RXA-INV-5)
  await opByGlyph(page, '×').click()
  await expect(expr(page)).toHaveValue('@wallet * ')
  expect(await modelExpr(page, 'net')).toBe('@wallet') // still the last valid commit
  expect(await pastLen(page)).toBe(past0)

  // complete it → exactly one new history entry, reverted by one undo
  await expr(page).pressSequentially('2')
  await expect(expr(page)).toHaveValue('@wallet * 2')
  expect(await modelExpr(page, 'net')).toBe('@wallet * 2')
  expect(await pastLen(page)).toBe(past0 + 1)
  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect(await pastLen(page)).toBe(past0)
  expect(await modelExpr(page, 'net')).toBe('@wallet')
})

test('§RXA8b.5 — keyboard entry of * and ( still works unchanged', async ({ page }) => {
  await setInput(page, '', 0)
  await expr(page).pressSequentially('@wallet*2')
  await expect(expr(page)).toHaveValue('@wallet*2')
  expect(await modelExpr(page, 'net')).toBe('@wallet*2') // grammar is whitespace-insensitive
  await setInput(page, '', 0)
  await expr(page).pressSequentially('(@wallet + 1) * 2')
  expect(await modelExpr(page, 'net')).toBe('(@wallet + 1) * 2')
})

test('§RXA8b.6 — desktop unlocked only: the edit lock removes the operator row with the input', async ({ page }) => {
  await expect(page.locator('.regexpr__ops')).toBeVisible()
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
  await expect(page.locator('.regexpr__ops')).toHaveCount(0)
  await expect(expr(page)).toHaveCount(0)
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(false))
  await expect(page.locator('.regexpr__ops')).toBeVisible()
})

const OP_LABELS = {
  en: [/^Add$/, /^Subtract$/, /^Multiply$/, /^Divide$/, /^Parentheses$/],
  ko: [/^더하기$/, /^빼기$/, /^곱하기$/, /^나누기$/, /^괄호$/],
  ja: [/^加算$/, /^減算$/, /^乗算$/, /^除算$/, /^かっこ$/],
} as const

for (const loc of ['en', 'ko', 'ja'] as const) {
  test(`§RXA8b.7 — the operator buttons carry a localised accessible name, not a bare glyph (${loc})`, async ({ page }) => {
    await setLocale(page, loc)
    const btns = page.locator('.regexpr__ops button')
    for (let i = 0; i < 5; i++) {
      await expect(btns.nth(i)).toHaveAccessibleName(OP_LABELS[loc][i])
    }
    // the visible face is still the math glyph
    await expect(btns.nth(2)).toHaveText('×')
    // a press still inserts the ASCII operator regardless of locale
    await setInput(page, '@wallet', 7)
    await btns.nth(2).click()
    await expect(expr(page)).toHaveValue('@wallet * ')
  })
}
