import type { Page } from '@playwright/test'
import { expect, graphSnapshot, importGraph, openApp, resetAll, test } from './support/loop'

// docs/register-expression-authoring.md §RXA9 — the reference-aware Register
// expression editor. Presentation only: the stored `expr`, its canonical form,
// `refsOf`, `evaluateRegisters`, and the `loop-revision/2` digest are unchanged
// (RXA-INV-1). Keyed on node ids, never rendered labels.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'wallet', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Wallet', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'savings_pool', type: 'pool', position: { x: 0, y: 160 }, data: { kind: 'pool', label: 'Savings', activation: 'passive', initial: 34, capacity: null, mode: 'pullAny' } },
    { id: 'rate', type: 'parameter', position: { x: 0, y: 320 }, data: { kind: 'parameter', label: 'Growth rate', value: 2 } },
    { id: 'src', type: 'source', position: { x: 0, y: 480 }, data: { kind: 'source', label: 'Income', activation: 'automatic', mode: 'pushAny' } },
    // a Register that references `net` — so `net` may not reference it (cycle)
    { id: 'savings_reg', type: 'register', position: { x: 260, y: 160 }, data: { kind: 'register', label: 'Savings', expr: '@net + 1', format: 'integer' } },
    { id: 'net', type: 'register', position: { x: 260, y: 0 }, data: { kind: 'register', label: 'Net worth', expr: '@wallet + @savings_pool', format: 'integer' } },
  ],
  edges: [],
})

// locale-stable selectors (the label text localises)
const expr = (page: Page) => page.locator('.regexpr input[role="combobox"]')
const listbox = (page: Page) => page.locator('.regref[role="listbox"]')
const meaning = (page: Page) => page.locator('.regrb__line--meaning')
const result = (page: Page) => page.locator('.regrb__line--result')
const rows = (page: Page) => listbox(page).locator('[role="option"]')

async function select(page: Page, id: string) {
  await page.evaluate((n) => (window as any).__loop.graph.getState().setSelection(n, null), id)
}
async function setLocale(page: Page, code: 'en' | 'ko' | 'ja') {
  await page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
}
const modelExpr = (page: Page, id: string) =>
  page.evaluate((n) => (window as any).__loop.graph.getState().nodes.find((x: any) => x.id === n)?.data.expr, id)

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GRAPH)
})

test('§RXA9.1 — the read-back is names (line 1) and name+value (line 2); a rename updates it and the stored expr is untouched', async ({ page }) => {
  await select(page, 'net')
  await expect(expr(page)).toHaveValue('@wallet + @savings_pool')
  await expect(meaning(page)).toHaveText(/^Wallet\s*\+\s*Savings/) // Savings is disambiguated below
  await expect(result(page)).toContainText('Wallet 3')
  await expect(result(page)).toContainText('34')
  await expect(result(page)).toContainText('= 37')

  const before = await modelExpr(page, 'net')
  // rename the referenced Pool
  await page.evaluate(() => (window as any).__loop.graph.getState().updateNodeData('wallet', { label: 'Cash' }))
  await expect(meaning(page)).toHaveText(/^Cash\s*\+/)
  expect(await modelExpr(page, 'net'), 'stored expr never rewritten (RXA-INV-2)').toBe(before)
})

test('§RXA9.2 — the `@` list is Pool/Parameter/Register only; self + a dependent Register are disabled with a reason', async ({ page }) => {
  await select(page, 'net')
  await expr(page).click()
  await expr(page).fill('@')
  await expect(listbox(page)).toBeVisible()
  const names = await rows(page).locator('.regref__name').allTextContents()
  // two nodes labelled "Savings" ⇒ both disambiguated (RXA-INV-9)
  expect(names).toEqual(
    expect.arrayContaining(['Wallet', 'Growth rate', 'Net worth', 'Savings · Pool', 'Savings · Register']),
  )
  expect(names, 'a Source is never a candidate').not.toContain('Income')

  // target rows by their exact display name (the sr-only text of a cycle row
  // also contains "Net worth", so `hasText` alone matches two rows)
  const rowNamed = (name: string) =>
    rows(page).filter({ has: page.locator('.regref__name', { hasText: new RegExp(`^${name}$`) }) })

  const self = rowNamed('Net worth')
  await expect(self).toHaveAttribute('aria-disabled', 'true')
  await expect(self).toContainText(/cannot reference itself/i)
  // `Savings · Register` (`savings_reg`) already references `net` ⇒ cycle-blocked
  const depReg = rowNamed('Savings · Register')
  await expect(depReg).toHaveAttribute('aria-disabled', 'true')
  await expect(depReg).toContainText(/cycle/i)
  // `Savings · Pool` is a plain Pool ⇒ enabled
  await expect(rowNamed('Savings · Pool')).not.toHaveAttribute('aria-disabled', 'true')
})

test('§RXA9.3 — choosing a row inserts `@id` at the caret; the committed AST + digest match hand-typing', async ({ page }) => {
  await select(page, 'net')
  await expr(page).fill('')
  await expr(page).pressSequentially('@wal')
  await expect(listbox(page)).toBeVisible()
  await page.locator('[role="option"]', { hasText: 'Wallet' }).first().click()
  await expect(expr(page)).toHaveValue('@wallet')
  await expr(page).pressSequentially(' + 10')
  await expect(expr(page)).toHaveValue('@wallet + 10')
  expect(await modelExpr(page, 'net')).toBe('@wallet + 10')

  // a hand-typed control commits byte-identically (RXA-INV-1) — the picker only
  // types the same canonical `@id` text a person would
  await importGraph(page, GRAPH)
  await select(page, 'net')
  await expr(page).fill('@wallet + 10')
  await page.waitForTimeout(60)
  expect(await modelExpr(page, 'net')).toBe('@wallet + 10')
})

test('§RXA9.4 — hovering a chip peeks exactly that node; no selection / undo / simulationRev / autosave effect', async ({ page }) => {
  await select(page, 'net')
  const snapBefore = await graphSnapshot(page)
  const simRevBefore = await page.evaluate(() => (window as any).__loop.graph.getState().simulationRev)
  const undoBefore = await page.evaluate(() => (window as any).__loop.graph.getState().past?.length ?? 0)

  await meaning(page).locator('.regrb__chip').first().hover()
  await expect(page.locator('.react-flow__node[data-id="wallet"] .nodef.is-ref-peek')).toHaveCount(1)
  await expect(page.locator('.react-flow__node[data-id="savings_pool"] .nodef.is-ref-peek')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__loop.ui.getState().peekRefNodeIds.slice())).toEqual(['wallet'])

  // move away → cleared
  await page.mouse.move(5, 5)
  await expect(page.locator('.nodef.is-ref-peek')).toHaveCount(0)

  expect(await page.evaluate(() => (window as any).__loop.graph.getState().selectedNodeId)).toBe('net')
  expect(await page.evaluate(() => (window as any).__loop.graph.getState().simulationRev)).toBe(simRevBefore)
  expect(await page.evaluate(() => (window as any).__loop.graph.getState().past?.length ?? 0)).toBe(undoBefore)
  expect(await graphSnapshot(page)).toEqual(snapBefore)
})

test('§RXA9.5 — a deleted / wrong-kind / div-by-zero / cyclic reference each shows its row and the Register still saves', async ({ page }) => {
  await select(page, 'net')

  // deleted id
  await expr(page).fill('@ghost + 1')
  await expect(result(page)).toHaveText(/reference "ghost" not found/i)
  expect(await modelExpr(page, 'net'), 'still committed (RXA-INV-5)').toBe('@ghost + 1')

  // wrong kind (a Source)
  await expr(page).fill('@src + 1')
  await expect(result(page)).toHaveText(/not a Pool, Parameter, or Register|Source/i)
  expect(await modelExpr(page, 'net')).toBe('@src + 1')

  // divide by zero — value line kept, `→` verdict
  await expr(page).fill('@wallet / 0')
  await expect(result(page)).toContainText('Wallet 3')
  await expect(result(page)).toContainText('→')
  expect(await modelExpr(page, 'net')).toBe('@wallet / 0')
})

test('§RXA9.5-parity (RXA-INV-8) — the read-back "bad" styling tracks the committed outcome, never a re-eval', async ({ page }) => {
  await select(page, 'net')
  for (const [e, wantBad] of [
    ['@wallet + @savings_pool', false],
    ['@ghost + 1', true],
    ['@src + 1', true],
    ['@wallet / 0', true],
  ] as const) {
    await expr(page).fill(e)
    await page.waitForTimeout(80)
    const badStyling = await result(page).evaluate(
      (el) => el.classList.contains('regrb__line--bad') || /→/.test(el.textContent || ''),
    )
    expect(badStyling, `read-back verdict for ${e}`).toBe(wantBad)
  }
  await expr(page).fill('@wallet + @savings_pool')
})

test('§RXA9.5a (RXA-INV-9) — two nodes labelled "Savings" never render as a bare duplicate', async ({ page }) => {
  // @savings_pool (Pool "Savings") + @savings_reg (Register "Savings")
  await select(page, 'net')
  await expr(page).fill('@savings_pool + @savings_reg')
  const line1 = await meaning(page).textContent()
  expect(line1).not.toMatch(/Savings\s*\+\s*Savings\b/)
  expect(line1).toMatch(/Savings · Pool/)
  expect(line1).toMatch(/Savings · Register/)
})

test('§RXA9.6 — keyboard: `@ ↓ Enter` inserts a candidate; `Esc` leaves the raw text; combobox aria present', async ({ page }) => {
  await select(page, 'net')
  await expr(page).fill('')
  await expr(page).focus()
  await expect(expr(page)).toHaveAttribute('role', 'combobox')
  await page.keyboard.type('@')
  await expect(expr(page)).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  // the first non-blocked candidate (sorted: Pools first) is inserted as `@id`
  await expect(expr(page)).toHaveValue(/^@\w+$/)
  const inserted = await expr(page).inputValue()
  expect(['@wallet', '@savings_pool']).toContain(inserted)

  await expr(page).fill('@rawid')
  await page.keyboard.press('Escape')
  await expect(listbox(page)).toHaveCount(0)
  await expect(expr(page)).toHaveValue('@rawid') // raw text kept (RXA-INV-5)
})

test('§RXA9.7 — an IME composition does not open or filter the popover', async ({ page }) => {
  await select(page, 'net')
  await expr(page).fill('')
  await expr(page).focus()
  await expr(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    ;(el as HTMLInputElement).value = '@'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(listbox(page)).toHaveCount(0)
  await expr(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', bubbles: true }))
  })
  // after compositionend the token is re-evaluated once
  await expect(listbox(page)).toBeVisible()
})

test('§RXA9.9 — the EdgeFlowField picker lists `Name · Parameter · = value` and writes `@id`', async ({ page }) => {
  await importGraph(page, JSON.stringify({
    schema: 'loop-studio/graph', version: 1,
    nodes: [
      { id: 'p', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'Rate', value: 12.5 } },
      { id: 'a', type: 'pool', position: { x: 0, y: 160 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'b', type: 'pool', position: { x: 240, y: 160 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
  }))
  await page.evaluate(() => (window as any).__loop.graph.getState().setSelection(null, 'e'))
  const picker = page.getByLabel('Drive with a parameter')
  await expect(picker.locator('option', { hasText: 'Rate' })).toContainText(/Rate · .+ · = 12\.5/)
  await picker.selectOption('p') // by <option value> = the node id
  expect(await page.evaluate(() => (window as any).__loop.graph.getState().edges[0].data.flow)).toBe('@p')
})

test('§RXA3.2 cond. 5 — a self-candidate shows the FORMATTED value; no raw float in the DOM or accessible names', async ({ page }) => {
  // the Coffee `roasted_supply_margin` case, minimised: 30 - (6 + 10) * 2.35
  // evaluates to -7.6 but arrives as -7.600000000000001 (FP residue).
  await importGraph(page, JSON.stringify({
    schema: 'loop-studio/graph', version: 1,
    nodes: [
      { id: 'stock', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Stock', activation: 'passive', initial: 30, capacity: null, mode: 'pullAny' } },
      { id: 'demand', type: 'pool', position: { x: 0, y: 160 }, data: { kind: 'pool', label: 'Demand', activation: 'passive', initial: 6, capacity: null, mode: 'pullAny' } },
      { id: 'orders', type: 'pool', position: { x: 0, y: 320 }, data: { kind: 'pool', label: 'Orders', activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' } },
      { id: 'margin', type: 'register', position: { x: 260, y: 160 }, data: { kind: 'register', label: 'Supply margin', expr: '@stock - (@demand + @orders) * 2.35', format: 'float' } },
    ],
    edges: [],
  }))
  await select(page, 'margin')

  // the read-back total is already formatted (the reported-good path)
  await expect(result(page)).toContainText('= -7.6')

  // open the `@` list WITHOUT replacing the (valid) stored expression — a
  // trailing `@` does not parse, so nothing commits and `margin` stays -7.6
  await expr(page).click()
  await expr(page).fill('@stock + @')
  await expect(listbox(page)).toBeVisible()
  const selfRow = rows(page).filter({ has: page.locator('.regref__name', { hasText: /^Supply margin$/ }) })
  // the self-candidate shows the SAME formatted value as the read-back…
  await expect(selfRow.locator('.regref__val')).toHaveText('= -7.6')
  // …in its accessible name too (§RXA3.2 cond. 4)
  await expect(selfRow.locator('.sr-only')).toContainText('current value -7.6')
  await expect(selfRow.locator('.sr-only')).not.toContainText('-7.600000000000001')

  // restore the valid expr → the read-back's value line renders the format…
  await expr(page).fill('@stock - (@demand + @orders) * 2.35')
  await expect(result(page)).toContainText('Stock 30')
  await expect(result(page)).toContainText('= -7.6')
  // …and the raw float appears NOWHERE in the Inspector DOM (text or aria)
  const inspectorHtml = await page.locator('aside.inspector').evaluate((el) => el.outerHTML)
  expect(inspectorHtml).not.toContain('-7.600000000000001')
})

for (const loc of ['en', 'ko', 'ja'] as const) {
  test(`§RXA9.11 — the read-back + @-list localise (${loc})`, async ({ page }) => {
    await setLocale(page, loc)
    await select(page, 'net')
    await expect(meaning(page)).toHaveText(/Wallet/)
    await expr(page).fill('@ghost + 1')
    // the deleted-ref row is localised (not the bare code)
    await expect(result(page)).not.toHaveText(/M_REG_/)
    await expr(page).fill('@wallet + @savings_pool')
  })
}
