import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/register-expression-authoring.md §RXA8 — arm-and-click reference
// insertion. "＋" beside a Register's expression input arms a ONE-SHOT mode;
// the next click on a Pool / Parameter / Register node inserts its `@id` at the
// saved caret, keeps the same Register selected in the Inspector, and disarms.
// Presentation only: the stored `expr`, canonical form, `refsOf`,
// `evaluateRegisters`, and the `loop-revision/2` digest are unchanged
// (RXA-INV-1); the insert is ONE normal edit (RXA-INV-3/5).

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'wallet', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Wallet', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'savings_pool', type: 'pool', position: { x: 0, y: 200 }, data: { kind: 'pool', label: 'Savings', activation: 'passive', initial: 34, capacity: null, mode: 'pullAny' } },
    { id: 'rate', type: 'parameter', position: { x: 0, y: 400 }, data: { kind: 'parameter', label: 'Growth rate', value: 2 } },
    { id: 'src', type: 'source', position: { x: 0, y: 600 }, data: { kind: 'source', label: 'Income', activation: 'automatic', mode: 'pushAny' } },
    // a Register that references `net` — so `net` may not reference it (cycle)
    { id: 'dep_reg', type: 'register', position: { x: 360, y: 200 }, data: { kind: 'register', label: 'Doubled', expr: '@net + 1', format: 'integer' } },
    { id: 'net', type: 'register', position: { x: 360, y: 0 }, data: { kind: 'register', label: 'Net worth', expr: '0', format: 'integer' } },
  ],
  edges: [],
})

// locale-stable selectors
const expr = (page: Page) => page.locator('.regexpr input[role="combobox"]')
const pickBtn = (page: Page) => page.locator('.regexpr__pick')
const hint = (page: Page) => page.locator('.regexpr__hint')
const srStatus = (page: Page) => page.locator('.regexpr .sr-only[role="status"]')
const listbox = (page: Page) => page.locator('.regref[role="listbox"]')
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)

const sel = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().selectedNodeId)
const modelExpr = (page: Page, id: string) =>
  page.evaluate((n) => (window as any).__loop.graph.getState().nodes.find((x: any) => x.id === n)?.data.expr, id)
const pastLen = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().past.length)
const armedState = (page: Page) =>
  page.evaluate(() => {
    const r = (window as any).__loop.ui.getState().refInsert
    return r ? r.editingId : null
  })

async function select(page: Page, id: string) {
  await page.evaluate((n) => (window as any).__loop.graph.getState().setSelection(n, null), id)
}
async function setLocale(page: Page, code: 'en' | 'ko' | 'ja') {
  await page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
}
/** put the caret at `pos` in the expression input */
async function caretTo(page: Page, pos: number) {
  await expr(page).evaluate((el, p) => {
    ;(el as HTMLInputElement).focus()
    ;(el as HTMLInputElement).setSelectionRange(p, p)
  }, pos)
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GRAPH)
  await select(page, 'net')
  await expect(expr(page)).toBeVisible()
})

test('§RXA8.1 — arm, click a Pool: `@id` lands at the caret, the same Register stays selected, one undo entry', async ({ page }) => {
  await expr(page).fill('1 + ')
  await caretTo(page, 4) // end, after "1 + "
  await page.waitForTimeout(700) // past COALESCE_MS so the next commit is its own entry
  const past0 = await pastLen(page)

  await pickBtn(page).click()
  await expect(pickBtn(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.canvas.canvas--ref-insert')).toBeVisible()
  expect(await armedState(page)).toBe('net')

  await node(page, 'wallet').click()

  await expect(expr(page)).toHaveValue('1 + @wallet')
  expect(await modelExpr(page, 'net')).toBe('1 + @wallet')
  // the canvas click never moved the Inspector selection (RXA-INV-3)
  expect(await sel(page)).toBe('net')
  // mode ended immediately
  await expect(pickBtn(page)).toHaveAttribute('aria-pressed', 'false')
  expect(await armedState(page)).toBeNull()
  await expect(page.locator('.canvas.canvas--ref-insert')).toHaveCount(0)
  // focus + caret returned to the input, just past the inserted token
  await expect(expr(page)).toBeFocused()
  expect(await expr(page).evaluate((el) => (el as HTMLInputElement).selectionStart)).toBe('1 + @wallet'.length)

  // exactly one history entry, and a single undo fully reverts the insert —
  // `1 + ` on its own never parsed, so the last committed value was the
  // fixture's `0` (the insert is the one and only new entry, RXA-INV-5)
  expect(await pastLen(page)).toBe(past0 + 1)
  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect(await modelExpr(page, 'net')).toBe('0')
})

test('§RXA8.2 — a selection in the input is replaced; otherwise it inserts at the caret; only `@id`, no operators / whitespace synthesised', async ({ page }) => {
  // caret insert into the middle
  await expr(page).fill('1++2')
  await caretTo(page, 2) // between the two "+"
  await pickBtn(page).click()
  await node(page, 'rate').click()
  await expect(expr(page)).toHaveValue('1+@rate+2') // literally only `@rate`, nothing else

  // selection replace
  await expr(page).fill('@wallet + PLACEHOLDER')
  await expr(page).evaluate((el) => (el as HTMLInputElement).setSelectionRange(10, 21)) // "PLACEHOLDER"
  await pickBtn(page).click()
  await node(page, 'savings_pool').click()
  await expect(expr(page)).toHaveValue('@wallet + @savings_pool')
})

test('§RXA8.3 — self / a cyclic Register / a wrong-kind node are blocked with a reason and the mode stays armed', async ({ page }) => {
  await expr(page).fill('0')
  await caretTo(page, 1)
  await pickBtn(page).click()

  // self
  await node(page, 'net').click()
  await expect(hint(page)).toContainText(/cannot reference itself/i)
  expect(await armedState(page)).toBe('net') // still armed
  expect(await modelExpr(page, 'net')).toBe('0') // nothing inserted

  // a Register that already depends on `net`
  await node(page, 'dep_reg').click()
  await expect(hint(page)).toContainText(/cycle/i)
  expect(await armedState(page)).toBe('net')

  // a Source is not referenceable
  await node(page, 'src').click()
  await expect(hint(page)).toContainText(/Pool, Parameter, or Register/i)
  expect(await armedState(page)).toBe('net')
  expect(await modelExpr(page, 'net')).toBe('0')

  // a valid pick still works afterwards (caret is at end of "0")
  await node(page, 'wallet').click()
  await expect(expr(page)).toHaveValue('0@wallet')
  expect(await armedState(page)).toBeNull()
})

test('§RXA8.4 — Esc, an empty-canvas click, and selecting a different Register all cancel the mode', async ({ page }) => {
  // Esc
  await pickBtn(page).click()
  expect(await armedState(page)).toBe('net')
  await page.keyboard.press('Escape')
  expect(await armedState(page)).toBeNull()
  await expect(pickBtn(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(srStatus(page)).toHaveText(/cancel/i) // the cancel is announced

  // empty-canvas click
  await pickBtn(page).click()
  expect(await armedState(page)).toBe('net')
  await page.locator('.react-flow__pane').click({ position: { x: 12, y: 12 } })
  expect(await armedState(page)).toBeNull()

  // switching the Inspector to another Register unmounts the field → disarm
  await pickBtn(page).click()
  expect(await armedState(page)).toBe('net')
  await select(page, 'dep_reg')
  await expect(expr(page)).toHaveValue('@net + 1')
  expect(await armedState(page)).toBeNull()
})

test('§RXA8.5 — combined: pick from the `@` list, then arm-and-click, in one edit; digest matches hand-typing', async ({ page }) => {
  await expr(page).fill('')
  await expr(page).pressSequentially('@wal')
  await expect(listbox(page)).toBeVisible()
  await page.locator('[role="option"]', { hasText: 'Wallet' }).first().click()
  await expect(expr(page)).toHaveValue('@wallet')

  await expr(page).pressSequentially(' + ')
  await caretTo(page, '@wallet + '.length)
  await pickBtn(page).click()
  await node(page, 'savings_pool').click()
  await expect(expr(page)).toHaveValue('@wallet + @savings_pool')
  expect(await modelExpr(page, 'net')).toBe('@wallet + @savings_pool')

  // byte-identical to a hand-typed control (RXA-INV-1)
  const digestNow = await page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as any).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })
  await importGraph(page, GRAPH)
  await select(page, 'net')
  await expr(page).fill('@wallet + @savings_pool')
  await page.waitForTimeout(60)
  const digestTyped = await page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as any).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })
  expect(digestNow).toBe(digestTyped)
})

test('§RXA8.6 — canvas operations do not regress: while NOT armed a node still selects; while armed a node click never selects it and no drag/connect happens', async ({ page }) => {
  const positions = () =>
    page.evaluate(() =>
      Object.fromEntries(
        (window as any).__loop.graph.getState().nodes.map((n: any) => [n.id, `${n.position.x},${n.position.y}`]),
      ),
    )
  const edgeCount = () => page.evaluate(() => (window as any).__loop.graph.getState().edges.length)
  const pos0 = await positions()
  const edges0 = await edgeCount()

  // not armed: a node click selects as usual
  await node(page, 'wallet').click()
  expect(await sel(page)).toBe('wallet')
  await select(page, 'net')

  // armed: clicking `savings_pool` inserts but does NOT select it
  await expr(page).fill('0')
  await caretTo(page, 1)
  await pickBtn(page).click()
  await node(page, 'savings_pool').click()
  expect(await sel(page)).toBe('net')
  await expect(expr(page)).toHaveValue('0@savings_pool')

  // the graph structure (positions / edges) is untouched by any of it
  expect(await positions()).toEqual(pos0)
  expect(await edgeCount()).toBe(edges0)
})

test('§RXA8.7 — provided only in the desktop unlocked state: the edit lock removes the ＋ button', async ({ page }) => {
  await expect(pickBtn(page)).toBeVisible()
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
  await expect(pickBtn(page)).toHaveCount(0)
  await expect(expr(page)).toHaveCount(0) // the whole input is gone in the read-only view
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(false))
  await expect(pickBtn(page)).toBeVisible()
})

test('§RXA8.7b — the insert action carries VISIBLE text (not just a glyph), on its own line under the input, and its accessible name is that text with no duplication', async ({ page }) => {
  const btn = pickBtn(page)
  // visible label, idle
  await expect(btn).toHaveText(/Insert reference/)
  const idleText = (await btn.textContent())?.trim() ?? ''
  expect(idleText.length).toBeGreaterThan(2) // not a bare "＋"
  await expect(btn).toHaveAccessibleName(idleText) // no aria-label / title doubling the text
  await expect(btn).not.toHaveAttribute('title', /.+/)
  await expect(btn).not.toHaveAttribute('aria-label', /.+/)
  // it sits BELOW the input, not on its row (its bottom is past the input's)
  const inputBox = await expr(page).boundingBox()
  const btnBox = await btn.boundingBox()
  expect(btnBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 1)
  // the input keeps a sane width — the button never squeezed it
  expect(inputBox!.width).toBeGreaterThan(180)

  // armed: a distinct visible label + the active style; still one clean AX name
  await btn.click()
  await expect(btn).toHaveText(/Selecting a reference/)
  await expect(btn).toHaveClass(/is-armed/)
  const armedText = (await btn.textContent())?.trim() ?? ''
  await expect(btn).toHaveAccessibleName(armedText)
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
})

test('§RXA8.8 — the mode announces enter / block-reason / insert to the status region', async ({ page }) => {
  await expr(page).fill('0')
  await caretTo(page, 1)

  await pickBtn(page).click()
  await expect(srStatus(page)).toHaveText(/armed|Click a node/i)

  await node(page, 'net').click() // blocked (self)
  await expect(srStatus(page)).toContainText(/cannot reference itself/i)

  await node(page, 'wallet').click() // inserted
  await expect(srStatus(page)).toContainText(/Wallet/)
  await expect(expr(page)).toHaveValue('0@wallet')
})

const PICK_LABEL = {
  en: { idle: /^＋ Insert reference$/, armed: /^Selecting a reference$/ },
  ko: { idle: /^＋ 참조 삽입$/, armed: /^참조 선택 중$/ },
  ja: { idle: /^＋ 参照を挿入$/, armed: /^参照を選択中$/ },
} as const

for (const loc of ['en', 'ko', 'ja'] as const) {
  test(`§RXA8.9 — the insert button label, hint, and block reason localise (${loc})`, async ({ page }) => {
    await setLocale(page, loc)
    await expect(pickBtn(page)).toHaveText(PICK_LABEL[loc].idle)
    await expr(page).fill('0')
    await caretTo(page, 1)
    await pickBtn(page).click()
    await expect(pickBtn(page)).toHaveText(PICK_LABEL[loc].armed)
    await expect(hint(page)).toBeVisible()
    await expect(hint(page)).not.toHaveText(/regExpr\.insert/) // a real string, not the key
    await node(page, 'src').click()
    await expect(hint(page)).not.toHaveText(/regExpr\.insert/)
    await node(page, 'wallet').click()
    await expect(expr(page)).toHaveValue('0@wallet')
  })
}
