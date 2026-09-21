import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, snap, test } from './support/loop'

// docs/data-import.md §DI17 — the in-tool guide for the CSV/TSV import
// wizard: the collapsible quick start with its one-click example, the shared
// role help (accessible names on the role selects), the per-table count line,
// inline validation errors, the review breakdown whose numbers are the same
// computation the commit uses, and the post-commit view (first Parameter
// selected, the created area framed inside the USABLE canvas, a one-shot
// hint).

type Node = { id: string; type?: string; data?: { label?: string; value?: number } }

const dialog = (page: Page) => page.locator('.mcdlg--dataimport')
const dataButton = (page: Page) => page.getByRole('button', { name: 'Data ▾' })

type Box = { x: number; y: number; width: number; height: number }

/**
 * Wait for the exact geometry the assertions need, then assert on the sample
 * that passed. The dialog is not one fixed box: it grows when the issue list
 * appears and its body scrolls as cards are added, so a single measurement
 * can catch an intermediate layout. Polling the containment itself -- and
 * keeping the boxes that satisfied it -- makes the assertions and the
 * screenshot read one state instead of three. `axis: 'y'` is for panes that
 * scroll horizontally on their own, where the x bound is not a contract.
 */
async function clippedInsideDialog(page: Page, targets: readonly (readonly [string, Locator])[], axis: 'xy' | 'y' = 'xy') {
  const caught: { dlg: Box; boxes: Box[] } = { dlg: { x: 0, y: 0, width: 0, height: 0 }, boxes: [] }
  await expect
    .poll(
      async () => {
        const d = await dialog(page).boundingBox()
        if (!d) return 'the dialog has no box'
        const boxes: Box[] = []
        const outside: string[] = []
        for (const [name, loc] of targets) {
          const b = await loc.boundingBox()
          if (!b) return `${name} has no box`
          boxes.push(b)
          if (b.y < d.y) outside.push(`${name} top ${Math.round(b.y)} < ${Math.round(d.y)}`)
          if (b.y + b.height > d.y + d.height) outside.push(`${name} bottom ${Math.round(b.y + b.height)} > ${Math.round(d.y + d.height)}`)
          if (axis === 'xy') {
            if (b.x < d.x) outside.push(`${name} left ${Math.round(b.x)} < ${Math.round(d.x)}`)
            if (b.x + b.width > d.x + d.width) outside.push(`${name} right ${Math.round(b.x + b.width)} > ${Math.round(d.x + d.width)}`)
          }
        }
        if (outside.length) return outside.join(' | ')
        caught.dlg = d
        caught.boxes = boxes
        return 'inside'
      },
      { timeout: 15000 },
    )
    .toBe('inside')
  return caught
}

const graph = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: Node[]; selectedNodeId: string | null } } } }).__loop.graph.getState()
    return { nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, data: { label: n.data?.label, value: n.data?.value } })), selectedNodeId: g.selectedNodeId }
  })
const viewport = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }).__loop.rf.getViewport())

async function openWizard(page: Page): Promise<void> {
  await dataButton(page).click()
  await page.getByRole('menuitem').first().click()
  await expect(dialog(page)).toBeVisible()
}

/** The canvas area a user can actually see nodes in: the React Flow pane
 *  minus the zoom Controls column, the minimap's row/column bands (when it
 *  is on screen) and the top-center hint slot (when a hint is showing). The
 *  right column (Inspector) is outside the pane already. */
async function usableCanvasArea(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return page.evaluate(() => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const controls = document.querySelector('.react-flow__controls')?.getBoundingClientRect()
    const mm = document.querySelector('.react-flow__minimap')?.getBoundingClientRect()
    const hint = document.querySelector('.react-flow__panel.top.center')?.getBoundingClientRect()
    let { left, top, right, bottom } = pane
    if (controls && controls.width > 0) left = Math.max(left, controls.right)
    if (mm && mm.width > 0) {
      right = Math.min(right, mm.left)
      bottom = Math.min(bottom, mm.top)
    }
    if (hint && hint.height > 0) top = Math.max(top, hint.bottom)
    return { left, top, right, bottom }
  })
}
async function nodeBox(page: Page, id: string) {
  return page.evaluate((nid) => {
    const r = document.querySelector(`.react-flow__node[data-id="${nid}"]`)!.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }, id)
}

const EXAMPLE_CSV = 'item_id,item_name,price,drop_rate\nsword,Steel Sword,4900,10\npotion,Health Potion,300,25'
const BAD_CSV = 'item_id,item_name,price,drop_rate\nsword,Steel Sword,"4,900",10\npotion,Health Potion,,25\nsword,Iron Sword,120,5'

async function pasteWithRoles(page: Page, name: string, csv: string, roles: string[]): Promise<void> {
  await dialog(page).locator('.import__nameField input').last().fill(name)
  await dialog(page).locator('textarea.import__paste').last().fill(csv)
  const head = dialog(page).locator('.import__table').last().locator('.import__preview thead tr').first()
  for (let i = 0; i < roles.length; i++) await head.locator('th').nth(i).locator('select').first().selectOption(roles[i])
}

/** The collapsed quick start must REALLY not render -- not just flip
 *  `aria-expanded` (a `display: flex` on the body once beat the UA's
 *  `[hidden]`): the body is hidden and none of its controls are visible. */
async function expectQuickStart(page: Page, expanded: boolean): Promise<void> {
  const qs = dialog(page).locator('.import__quickstart')
  await expect(qs.locator('.import__quickstartToggle')).toHaveAttribute('aria-expanded', expanded ? 'true' : 'false')
  const body = qs.locator('.import__quickstartBody')
  const controls = [
    qs.getByRole('button', { name: 'Use this example' }),
    qs.getByRole('button', { name: 'Download sample CSV' }),
    qs.getByRole('link', { name: /Full guide/ }),
  ]
  if (expanded) {
    await expect(body).toBeVisible()
    await expect(body).not.toHaveAttribute('hidden', /.*/)
    for (const c of controls) await expect(c).toBeVisible()
  } else {
    await expect(body).toBeHidden()
    await expect(body).toHaveAttribute('hidden', /.*/)
    expect(await body.evaluate((el) => getComputedStyle(el).display)).toBe('none')
    for (const c of controls) await expect(c).toBeHidden()
  }
}

/** `tag:accessible name` for whatever currently has focus. */
const activeDesc = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null
    return e ? `${e.tagName.toLowerCase()}:${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 24) ?? ''}` : ''
  })

/**
 * Capture every animation frame and zero-delay macrotask; the returned
 * function restores them and runs everything that was held, in order.
 *
 * This is how the focus contracts below are pinned WITHOUT a sleep or a
 * raised timeout: the deferred work is not waited for, it is held while the
 * user acts and then released at a chosen moment. If any part of the
 * wizard's focus or scroll ever moves back onto a frame, whatever it left
 * queued lands here — after the user has moved on — and the test fails.
 */
async function holdDeferred(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __held: (() => void)[]; __release: () => void }
    w.__held = []
    const raf = window.requestAnimationFrame
    const st = window.setTimeout
    w.__release = () => {
      window.requestAnimationFrame = raf
      window.setTimeout = st
      for (const cb of w.__held.splice(0)) cb()
    }
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      w.__held.push(() => cb(performance.now()))
      return 0
    }) as unknown as typeof window.requestAnimationFrame
    window.setTimeout = ((fn: unknown, ms?: number, ...rest: unknown[]) => {
      if (typeof fn === 'function' && (ms ?? 0) === 0) {
        w.__held.push(() => (fn as () => void)())
        return 0
      }
      return (st as unknown as (...a: unknown[]) => number)(fn, ms, ...rest)
    }) as unknown as typeof window.setTimeout
  })
  return () => page.evaluate(() => (window as unknown as { __release: () => void }).__release())
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('the quick start is visible before any input; "Use this example" fills a table whose review counts equal the created nodes; the first Parameter is selected and the batch is framed inside the usable canvas', async ({ page }) => {
  await openWizard(page)
  const qs = dialog(page).locator('.import__quickstart')
  await expect(qs).toBeVisible()
  await expectQuickStart(page, true)
  await expect(qs.getByText(/2 rows × 2 Number columns = 4 Parameters/)).toBeVisible()

  await qs.getByRole('button', { name: 'Use this example' }).click()
  await expect(dialog(page).locator('.import__nameField input').first()).toHaveValue('Items')
  await expect(dialog(page).locator('.import__status').first()).toContainText(/item_id/)
  await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)

  const before = await graph(page)
  await dialog(page).getByRole('button', { name: 'Next' }).click() // placement
  await expect(dialog(page).getByText(/4 Parameters on the canvas/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Next' }).click() // review
  const row = dialog(page).locator('.import__reviewTable tbody tr').first()
  await expect(row.locator('td').nth(0)).toHaveText('Items')
  await expect(row.locator('td').nth(1)).toHaveText('2')
  await expect(row.locator('td').nth(2)).toHaveText('2')
  await expect(row.locator('td').nth(3)).toHaveText('4')
  const total = Number(await dialog(page).locator('.import__reviewTotal').textContent())
  expect(total).toBe(4)
  await expect(dialog(page).getByText('Items · Steel Sword · price')).toBeVisible() // label preview

  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()

  const after = await graph(page)
  const created = after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  expect(created).toHaveLength(total) // the review total IS the created count
  expect(after.selectedNodeId).toBe(created[0].id) // exactly one selected, the first
  expect(after.nodes.filter((n) => n.id !== created[0].id).length).toBe(after.nodes.length - 1)

  // one-shot hint, and every created node inside the usable area
  await expect(page.locator('.hint-note', { hasText: /4 Parameters added/ })).toBeVisible()
  await page.waitForTimeout(150)
  const area = await usableCanvasArea(page)
  for (const n of created) {
    const b = await nodeBox(page, n.id)
    expect(b.left).toBeGreaterThanOrEqual(area.left - 1)
    expect(b.top).toBeGreaterThanOrEqual(area.top - 1)
    expect(b.right).toBeLessThanOrEqual(area.right + 1)
    expect(b.bottom).toBeLessThanOrEqual(area.bottom + 1)
  }

  // the quick start collapses after the first success (not an explicit choice) and the hint shows only once
  await openWizard(page)
  await expectQuickStart(page, false) // really collapsed: body hidden, controls not visible
  await dialog(page).locator('.import__quickstartToggle').click()
  await expectQuickStart(page, true)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  expect((await graph(page)).nodes.filter((n) => n.type === 'parameter')).toHaveLength(8)
  await expect(page.locator('.hint-note', { hasText: /Parameters added/ })).toHaveCount(0)
})

test('"Use this example" is idempotent: repeated clicks reuse the example card, and a filled card is never overwritten', async ({ page }) => {
  await openWizard(page)
  const useIt = dialog(page).getByRole('button', { name: 'Use this example' })
  await useIt.click()
  await useIt.click()
  await useIt.click()
  await expect(dialog(page).locator('.import__table')).toHaveCount(1)

  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await openWizard(page)
  await dialog(page).locator('.import__quickstartToggle').click() // (still expanded on this fresh profile; toggling twice keeps it visible)
  await dialog(page).locator('.import__quickstartToggle').click()
  await pasteWithRoles(page, 'Mine', 'k,n\na,1', ['key', 'number'])
  await useIt.click()
  await expect(dialog(page).locator('.import__table')).toHaveCount(2)
  await expect(dialog(page).locator('.import__nameField input').first()).toHaveValue('Mine') // untouched
  await expect(dialog(page).locator('.import__nameField input').nth(1)).toHaveValue('Items')
  await useIt.click()
  await expect(dialog(page).locator('.import__table')).toHaveCount(2) // reused, not added again
})

test('role selects have an accessible name with the column header and are described by the shared role help', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  const keySelect = dialog(page).getByRole('combobox', { name: 'Role for column item_id' })
  await expect(keySelect).toHaveValue('key')
  const describedBy = await keySelect.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`#${describedBy}`)).toContainText(/Unique ID/)
  // the help is rendered ONCE per dialog, not once per table
  await expect(dialog(page).locator('.import__roleHelp')).toHaveCount(1)
  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  await expect(dialog(page).locator('.import__roleHelp')).toHaveCount(1)
  // changing the role re-points the description
  const priceSelect = dialog(page).getByRole('combobox', { name: 'Role for column price' })
  await priceSelect.selectOption('label')
  const d2 = await priceSelect.getAttribute('aria-describedby')
  await expect(page.locator(`#${d2}`)).toContainText(/Name shown/)
})

test('inline errors: the summary takes focus, each item is a button that reveals its cell, bad cells are marked, and an edit turns them stale until Next re-checks', async ({ page }) => {
  await openWizard(page)
  await pasteWithRoles(page, 'Bad', BAD_CSV, ['key', 'label', 'number', 'number'])
  await dialog(page).getByRole('button', { name: 'Next' }).click()

  // no separate error step -- the input is still there
  await expect(dialog(page).locator('textarea.import__paste')).toBeVisible()
  const summary = dialog(page).locator('.import__issueSummary[role="alert"]')
  await expect(summary).toContainText(/3 problems/)
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('import__issueSummary')

  const items = dialog(page).locator('.import__issues button.import__issueLink')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText(/"4,900"/)
  await expect(items.nth(0)).toContainText(/price/)
  await expect(items.nth(0)).toContainText(/thousands/i)
  await expect(items.nth(1)).toContainText(/price/)
  await expect(items.nth(2)).toContainText(/"sword"/)
  await expect(dialog(page).locator('.import__preview .is-bad[aria-invalid="true"]')).toHaveCount(3)

  await items.nth(0).click()
  expect(await page.evaluate(() => document.activeElement?.classList.contains('is-bad'))).toBe(true)

  // an edit -> stale: no active warning styling, but a "check again" state
  await dialog(page).locator('textarea.import__paste').fill(EXAMPLE_CSV)
  await expect(dialog(page).locator('.import__preview .is-bad')).toHaveCount(0)
  await expect(dialog(page).locator('[aria-invalid="true"]')).toHaveCount(0)
  await expect(dialog(page).locator('.import__issues.is-stale')).toBeVisible()
  await expect(dialog(page).locator('.import__issueSummary')).toContainText(/check again/i)

  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText('Place on the canvas, no frames')).toBeVisible()
})

for (const [loc, needle] of [
  ['ko', 'price'],
  ['ja', 'price'],
] as const) {
  test(`${loc} -- the invalid-number message carries the value and the header, never the internal code`, async ({ page }) => {
    await page.evaluate((l) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (s: string) => void } } } }).__loop.i18n.getState().setLocale(l), loc)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(loc)
    const btn = page.getByRole('button', { name: loc === 'ko' ? '데이터 ▾' : 'データ ▾', exact: true })
    if (!(await btn.isVisible())) await page.locator('.toolbar__overflow-btn').click()
    await btn.click()
    await page.getByRole('menuitem').first().click()
    await expect(dialog(page)).toBeVisible()
    await pasteWithRoles(page, 'Bad', BAD_CSV, ['key', 'label', 'number', 'number'])
    await dialog(page).locator('.mcdlg__foot .btn--primary').click()
    const first = dialog(page).locator('.import__issues button.import__issueLink').first()
    await expect(first).toContainText('4,900')
    await expect(first).toContainText(needle)
    expect(await first.textContent()).not.toContain('invalid-number')
  })
}

test('a long cell value in an error is truncated and control characters are made visible', async ({ page }) => {
  await openWizard(page)
  const long = 'x'.repeat(300)
  await pasteWithRoles(page, 'Long', `k,n\na,${long}\nb,"1\n2"`, ['key', 'number'])
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  const items = dialog(page).locator('.import__issues button.import__issueLink')
  const t0 = (await items.nth(0).textContent()) ?? ''
  expect(t0).toContain('…')
  expect(t0).not.toContain('x'.repeat(60))
  const t1 = (await items.nth(1).textContent()) ?? ''
  expect(t1).toContain('1⏎2')
})

test('the quick-start collapsed state: a manual toggle persists across reopen and reload, and a first success never overrides an explicit expand', async ({ page }) => {
  await openWizard(page)
  const toggle = () => dialog(page).locator('.import__quickstartToggle')
  await toggle().click()
  await expectQuickStart(page, false)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await openWizard(page)
  await expectQuickStart(page, false) // reopened: the stored state IS the real visibility
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await openWizard(page)
  await expectQuickStart(page, false) // reloaded: still really collapsed
  await toggle().focus()
  await page.keyboard.press('Enter')
  await expectQuickStart(page, true) // explicit expand
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await openWizard(page)
  await expectQuickStart(page, true)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  await openWizard(page)
  await expectQuickStart(page, true) // explicit choice survives the first success
})

test('the Data menu\'s "How to prepare a spreadsheet…" opens the wizard with the quick start expanded even when it was collapsed', async ({ page }) => {
  await openWizard(page)
  await dialog(page).locator('.import__quickstartToggle').click()
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await dataButton(page).click()
  await page.getByRole('menuitem', { name: 'How to prepare a spreadsheet…' }).click()
  await expect(dialog(page)).toBeVisible()
  await expectQuickStart(page, true)
  // the full-guide link is a secondary, external path -- present but never required
  const guide = dialog(page).getByRole('link', { name: /Full guide/ })
  await expect(guide).toHaveAttribute('target', '_blank')
  await expect(guide).toHaveAttribute('href', /github\.com\/MerciHanrim\/loop-studio\/blob\/main\/docs\/import-guide\.md$/)
})

test('a 2-table import with a lookup-only table reports "0 (lookup only)" and the same total the commit creates', async ({ page }) => {
  await openWizard(page)
  await pasteWithRoles(page, 'Items', 'item_key,name\na,Sword\nb,Shield', ['key', 'label'])
  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  await pasteWithRoles(page, 'Drops', 'drop_key,item_ref,rate\nd1,a,10\nd2,b,20\nd3,a,30', ['key', 'foreignKey', 'number'])
  const fkTh = dialog(page).locator('.import__table').nth(1).locator('.import__preview thead tr').first().locator('th').nth(1)
  await fkTh.locator('select').nth(1).selectOption({ label: 'Items' })
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  const rows = dialog(page).locator('.import__reviewTable tbody tr')
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText(/0 \(lookup only\)/)
  await expect(rows.nth(1).locator('td').nth(3)).toHaveText('3')
  await expect(dialog(page).locator('.import__reviewTotal')).toHaveText('3')
  const before = await graph(page)
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  expect((await graph(page)).nodes.length - before.nodes.length).toBe(3)
})

test('keyboard only: the quick start, fields, role selects and buttons are reachable in order; Escape returns focus to the Data trigger', async ({ page }) => {
  await dataButton(page).focus()
  await page.keyboard.press('Enter') // opens the Data menu
  await page.keyboard.press('Tab') // the first menu item follows the trigger in DOM order
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  const active = () => page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null
    return e ? `${e.tagName.toLowerCase()}:${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 24) ?? ''}` : ''
  })
  // focus starts on the first field, then Shift+Tab reaches the quick start's
  // last control above it (the second <details> summary), proving the block
  // sits in the Tab ring rather than being skipped
  expect(await active()).toMatch(/^input:/)
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toMatch(/^summary:What is not imported/)
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toMatch(/^summary:Getting data out/)
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toMatch(/^a:Full guide/)
  // activate the example from the keyboard
  const useIt = dialog(page).getByRole('button', { name: 'Use this example' })
  await useIt.focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)
  const keySelect = dialog(page).getByRole('combobox', { name: 'Role for column item_id' })
  await keySelect.focus()
  await page.keyboard.press('Tab')
  expect(await active()).toBe('select:Role for column item_name')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  expect(await active()).toMatch(/^button:Data/)
})

// docs/data-import.md §DI17 — "Use this example" settles its scroll and focus
// before the next thing the user does, and a request it has already made can
// never come back and overwrite where the user went next. Each of these holds
// the frame, lets the user act, and only then releases: the ordering is chosen
// rather than waited for, so there is no sleep and no raised timeout anywhere.
test('a used example never takes focus back from the role select the user moved to', async ({ page }) => {
  await openWizard(page)
  const release = await holdDeferred(page)
  try {
    await dialog(page).getByRole('button', { name: 'Use this example' }).focus()
    await page.keyboard.press('Enter')
    // the card the focus belongs to is already in the DOM
    await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)
    await dialog(page).getByRole('combobox', { name: 'Role for column item_id' }).focus()
    await page.keyboard.press('Tab')
    expect(await activeDesc(page)).toBe('select:Role for column item_name')
  } finally {
    await release()
  }
  expect(await activeDesc(page)).toBe('select:Role for column item_name')
})

test('a used example never takes focus away from the failed-check summary', async ({ page }) => {
  await openWizard(page)
  const summary = dialog(page).locator('.import__issueSummary')
  const release = await holdDeferred(page)
  try {
    await dialog(page).getByRole('button', { name: 'Use this example' }).click()
    await dialog(page).locator('textarea.import__paste').fill(BAD_CSV)
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    // §DI17 moves focus to the role="alert" summary so it is announced
    await expect(summary).toBeFocused()
  } finally {
    await release()
  }
  await expect(summary).toBeFocused()
})

test('a second "Use this example" — which re-renders nothing — still settles its focus at once', async ({ page }) => {
  await openWizard(page)
  const useIt = dialog(page).getByRole('button', { name: 'Use this example' })
  const paste = dialog(page).locator('textarea.import__paste')
  await useIt.click()
  await expect(dialog(page).locator('.import__nameField input').first()).toBeFocused()
  const release = await holdDeferred(page)
  try {
    // the example card already exists, so this path changes no state at all --
    // the focus request still has to be honoured, and honoured immediately
    await useIt.click()
    await expect(dialog(page).locator('.import__nameField input').first()).toBeFocused()
    await paste.focus()
    await expect(paste).toBeFocused()
  } finally {
    await release()
  }
  await expect(paste).toBeFocused()
})

test('typing that continues after a used example is not split between the data box and the table name', async ({ page }) => {
  await openWizard(page)
  const paste = dialog(page).locator('textarea.import__paste')
  const name = dialog(page).locator('.import__nameField input')
  const release = await holdDeferred(page)
  try {
    await dialog(page).getByRole('button', { name: 'Use this example' }).click()
    await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)
    // the user replaces the example data with their own
    await paste.focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('a,b')
  } finally {
    await release()
  }
  await page.keyboard.type('\n1,2')
  expect(await paste.inputValue()).toBe('a,b\n1,2')
  expect(await name.inputValue()).toBe('Items')
})

test('a large import (1,200 rows × 2 Number columns) keeps the zoom at the floor, anchors the first node inside the usable area and selects only one node', async ({ page }) => {
  await openWizard(page)
  const rows = Array.from({ length: 1200 }, (_, i) => `r${i},Row ${i},${i},${i * 2}`).join('\n')
  await pasteWithRoles(page, 'Big', `id,name,a,b\n${rows}`, ['key', 'label', 'number', 'number'])
  await expect(dialog(page).locator('.import__status').first()).toContainText(/2,400 Parameters|2400 Parameters/)
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).locator('.import__reviewTotal')).toHaveText(/2,?400/)
  const before = await graph(page)
  const t0 = Date.now()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden({ timeout: 30_000 })
  const elapsed = Date.now() - t0
  console.log(`[diagnostic] 2,400-Parameter commit round-trip: ${elapsed} ms`)
  const after = await graph(page)
  const created = after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  expect(created).toHaveLength(2400)
  expect(after.selectedNodeId).toBe(created[0].id)
  const vp = await viewport(page)
  expect(Math.abs(vp.zoom - IMPORT_FIT_FLOOR)).toBeLessThan(1e-6)
  await page.waitForTimeout(200)
  const area = await usableCanvasArea(page)
  const b = await nodeBox(page, created[0].id)
  expect(b.left).toBeGreaterThanOrEqual(area.left - 1)
  expect(b.top).toBeGreaterThanOrEqual(area.top - 1)
  expect(b.right).toBeLessThanOrEqual(area.right + 1)
  expect(b.bottom).toBeLessThanOrEqual(area.bottom + 1)
})

/** Must equal `IMPORT_FIT_FLOOR` in src/components/dataImport/DataImportWizard.tsx. */
const IMPORT_FIT_FLOOR = 0.5

test('visual: the quick start with the example loaded, and the inline error state (element captures)', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)
  // "Use this example" moves focus to the table name on the NEXT animation
  // frame, and the same frame scrolls the dialog body down to reach it -- so
  // wait for that focus to land before resetting the scroll, or the deferred
  // `scrollIntoView` undoes the reset and the quick start leaves the clip.
  await expect(dialog(page).locator('.import__nameField input').first()).toBeFocused()
  // the baseline must protect the quick start's COPY, so scroll back to the
  // top and prove every guarded piece is inside the dialog's clip before
  // capturing.
  await dialog(page).locator('.mcdlg__body').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.evaluate(() => document.fonts.ready)
  const qs = dialog(page).locator('.import__quickstart')
  const guarded = [
    ['toggle', qs.locator('.import__quickstartToggle')],
    ['lead', qs.locator('.import__quickstartLead')],
    ['example', qs.locator('.import__example')],
    ['mapping line', qs.getByText(/item_id: Key · item_name: Label · price: Number · drop_rate: Number/)],
    ['count line', qs.getByText(/2 rows × 2 Number columns = 4 Parameters/)],
    ['use example', qs.getByRole('button', { name: 'Use this example' })],
    ['download CSV', qs.getByRole('button', { name: 'Download sample CSV' })],
    ['full guide', qs.getByRole('link', { name: /Full guide/ })],
  ] as const
  const quickStart = await clippedInsideDialog(page, guarded)
  for (const b of quickStart.boxes) {
    expect(b.y).toBeGreaterThanOrEqual(quickStart.dlg.y)
    expect(b.y + b.height).toBeLessThanOrEqual(quickStart.dlg.y + quickStart.dlg.height)
    expect(b.x).toBeGreaterThanOrEqual(quickStart.dlg.x)
    expect(b.x + b.width).toBeLessThanOrEqual(quickStart.dlg.x + quickStart.dlg.width)
  }
  // the `↗` external-link glyph comes from a fallback font whose
  // rasterisation differs between a local Windows machine and the CI runner
  // -- mask that one small span only. (The mapping line used `→` for the
  // same reason and is now written with `:` so it stays pixel-guarded.)
  await expect(dialog(page)).toHaveScreenshot(...snap(page, 'data-import-quickstart', { mask: [qs.locator('.menu__ext')] }))
  // the inline-error scene is captured from the REAL error experience: the
  // user was at the table (where "Use this example" left them -- a second
  // click reuses the example card and restores that scroll position), then
  // pressed Next and focus moved to the summary
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  // "Use this example" scrolls to that card and focuses its name field inside
  // the commit that fills it, so this is already true here -- it is asserted
  // rather than waited for, and it is what lets the Next below hand focus to
  // the summary and keep it.
  await expect(dialog(page).locator('.import__nameField input').first()).toBeFocused()
  await dialog(page).locator('textarea.import__paste').fill(BAD_CSV)
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  const summary = dialog(page).locator('.import__issueSummary')
  await expect(summary).toBeFocused()
  // pin the scene the baseline protects: the focused summary at the top of
  // the body, with the table's issue list and its marked cells below it
  await summary.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  // the dialog is re-measured here: it grew when the issue list appeared, so
  // the quick-start scene's box is not the clip these pieces live in.
  const guardedErr = [
    ['summary', summary],
    ['issue link', dialog(page).locator('.import__issues button.import__issueLink').first()],
    ['bad cell', dialog(page).locator('.import__preview .is-bad').first()],
  ] as const
  const errScene = await clippedInsideDialog(page, guardedErr, 'y')
  for (const b of errScene.boxes) {
    expect(b.y).toBeGreaterThanOrEqual(errScene.dlg.y)
    expect(b.y + b.height).toBeLessThanOrEqual(errScene.dlg.y + errScene.dlg.height)
  }
  await expect(dialog(page)).toHaveScreenshot(...snap(page, 'data-import-inline-errors'))
})

// docs/data-import.md §DI17 / docs/mobile.md §MV1 — the wizard stays
// desktop-only: the mobile More sheet offers file import (Graph / Workspace
// JSON) and nothing spreadsheet-related. Pinned so the boundary is a
// decision, not an accident.
test.describe('mobile boundary', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('the mobile More sheet has no spreadsheet-import entry and the wizard is unreachable', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click()
    const sheet = page.locator('.sheet, [role="dialog"]').last()
    await expect(sheet.getByRole('button', { name: 'Import file' })).toBeVisible()
    await expect(page.getByRole('button', { name: /spreadsheet/i })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /spreadsheet/i })).toHaveCount(0)
    await expect(page.locator('.mcdlg--dataimport')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Data ▾' })).toHaveCount(0)
  })
})
