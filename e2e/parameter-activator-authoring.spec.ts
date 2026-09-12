import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import type { Page } from '@playwright/test'

// docs/parameter-activator.md (PA) §PA7 — the Inspector's `@parameter`
// activator authoring surface: a Parameter picker mirroring `EdgeFlowField`,
// an offset control, and a LIVE resolved-value preview — the actual fix for
// §PA2's off-by-one. Engine grammar/evaluation shipped in PR #188
// (loop-state/4); this is the authoring UI on top of it.

const DEMO = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'pity', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Pity', activation: 'passive', initial: 2, capacity: null, mode: 'pullAny' } },
    { id: 'forced', type: 'gate', position: { x: 220, y: 0 }, data: { kind: 'gate', label: 'Forced', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'other', type: 'pool', position: { x: 0, y: 150 }, data: { kind: 'pool', label: 'Other pool', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'hard_pity', type: 'parameter', position: { x: 0, y: 300 }, data: { kind: 'parameter', label: 'Hard pity', value: 3 } },
  ],
  edges: [
    { id: 'act1', source: 'pity', target: 'forced', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'activator', expr: '>= 5' } },
  ],
})

type Bridge = { __loop: Record<string, { getState: () => any }> }

const selectEdge = (page: Page, id: string) =>
  page.evaluate((eid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, eid), id)

const edgeExpr = (page: Page): Promise<string> =>
  page.evaluate(
    () => (window as unknown as Bridge).__loop.graph.getState().edges.find((e: any) => e.id === 'act1')?.data.expr,
  )

const pastLength = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)

const undo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())

const setParamValue = (page: Page, value: number) =>
  page.evaluate(
    (v) => (window as unknown as Bridge).__loop.graph.getState().updateNodeData('hard_pity', { value: v }),
    value,
  )

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

const load = async (page: Page) => {
  await importGraph(page, DEMO)
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await selectEdge(page, 'act1')
}

const paramSelect = (page: Page) => page.locator('.activatorfield__param')
const exprInput = (page: Page) => page.locator('.activatorfield__expr')
const offsetInput = (page: Page) => page.locator('.activatorfield__offset')
const preview = (page: Page) => page.locator('.activatorfield__preview')

test.describe('parameter activator authoring (docs/parameter-activator.md §PA7)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await load(page)
  })

  test('a plain literal activator is unaffected — no picker value, existing describe hint', async ({ page }) => {
    await expect(paramSelect(page)).toHaveValue('')
    await expect(preview(page)).toHaveText('target is enabled while the source >= 5')
    await expect(preview(page)).toHaveClass(/field__hint--ok/)
  })

  test('picking the Parameter writes @id, preserves the operator, reveals the offset control', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    expect(await edgeExpr(page)).toBe('>= @hard_pity')
    await expect(offsetInput(page)).toBeVisible()
    await expect(offsetInput(page)).toHaveValue('0')
    await expect(preview(page)).toHaveText('target is enabled while the source >= 3 (= Hard pity, currently 3)')
  })

  test('the headline off-by-one fix: an offset of -1 shows the effective threshold live', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    await offsetInput(page).fill('-1')
    expect(await edgeExpr(page)).toBe('>= @hard_pity - 1')
    await expect(preview(page)).toHaveText('target is enabled while the source >= 2 (= Hard pity − 1, currently 3)')
  })

  test('a positive offset also works and reads naturally', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    await offsetInput(page).fill('2')
    expect(await edgeExpr(page)).toBe('>= @hard_pity + 2')
    await expect(preview(page)).toHaveText('target is enabled while the source >= 5 (= Hard pity + 2, currently 3)')
  })

  test('editing the Parameter value elsewhere updates the live preview without touching the picker', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    await offsetInput(page).fill('-1')
    await setParamValue(page, 6)
    await expect(preview(page)).toHaveText('target is enabled while the source >= 5 (= Hard pity − 1, currently 6)')
    // the stored expr itself never changed — only the live-resolved number did
    expect(await edgeExpr(page)).toBe('>= @hard_pity - 1')
  })

  test('an unknown parameter reference blocks its target with a live warning', async ({ page }) => {
    await exprInput(page).fill('>= @ghost - 1')
    await expect(preview(page)).toContainText('no parameter “ghost”')
    await expect(preview(page)).toContainText('currently blocking its target')
    await expect(preview(page)).toHaveClass(/field__hint--bad/)
  })

  test('a wrong-kind reference (a Pool) blocks its target with a live warning naming the kind', async ({ page }) => {
    await exprInput(page).fill('>= @other - 1')
    await expect(preview(page)).toContainText('“other” is not a parameter (it is a pool)')
    await expect(preview(page)).toContainText('currently blocking its target')
  })

  test('a non-finite Parameter value blocks its target with a live warning', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    // Close the Inputs panel first: its (pre-existing, unrelated) Parameter
    // value <input type="number"> binds `value` straight from node data, and
    // React logs a console.error when that becomes NaN. This test only
    // exercises the Inspector's ActivatorField preview, so avoid rendering
    // the other panel with a non-finite value at all.
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().toggleInputsPanel())
    await setParamValue(page, Number.NaN)
    await expect(preview(page)).toContainText('is not a finite number')
    await expect(preview(page)).toContainText('currently blocking its target')
  })

  test('switching back to "literal value" resets to a plain editable literal', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    await paramSelect(page).selectOption('')
    expect(await edgeExpr(page)).toBe('>= 0')
    await expect(offsetInput(page)).toHaveCount(0)
  })

  test('Undo: exactly one history entry per commit (picker, then offset), not per keystroke', async ({ page }) => {
    const before = await pastLength(page)
    await paramSelect(page).selectOption('hard_pity')
    await page.waitForTimeout(700) // clear graphStore's 600ms same-tag coalescing window
    const afterPick = await pastLength(page)
    await offsetInput(page).fill('-1')
    await page.waitForTimeout(700)
    const afterOffset = await pastLength(page)
    expect(afterPick - before).toBe(1)
    expect(afterOffset - afterPick).toBe(1)

    await undo(page)
    expect(await edgeExpr(page)).toBe('>= @hard_pity')
    await undo(page)
    expect(await edgeExpr(page)).toBe('>= 5')
  })

  test('locked desktop: read-only preview, no picker, no offset, no free-text input', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    await offsetInput(page).fill('-1')
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().toggleCanvasLocked())
    await expect(paramSelect(page)).toHaveCount(0)
    await expect(offsetInput(page)).toHaveCount(0)
    await expect(exprInput(page)).toHaveCount(0)
    await expect(preview(page)).toHaveText('target is enabled while the source >= 2 (= Hard pity − 1, currently 3)')
  })

  test('mobile: the read-only sheet shows the same live preview text', async ({ page }) => {
    await paramSelect(page).selectOption('hard_pity')
    await offsetInput(page).fill('-1')
    // graphStore's autosave write is debounced 400ms behind `persist()` — wait
    // it out so the edit is actually in localStorage before the reload below.
    await page.waitForTimeout(450)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await selectEdge(page, 'act1')
    await expect(page.locator('.sheet--inspector .activatorfield__preview')).toHaveText(
      'target is enabled while the source >= 2 (= Hard pity − 1, currently 3)',
    )
    await expect(page.locator('.activatorfield__param')).toHaveCount(0)
  })

  for (const [code, expected] of [
    ['ko', '소스가 >= 2인 동안 대상이 켜집니다 (= Hard pity − 1, 현재 값 3)'],
    ['ja', 'ソースが >= 2 の間、ターゲットが有効になります（= Hard pity − 1、現在の値 3）'],
  ] as const) {
    test(`${code}: the live preview reads as a natural localized sentence`, async ({ page }) => {
      await paramSelect(page).selectOption('hard_pity')
      await offsetInput(page).fill('-1')
      await setLocale(page, code)
      await expect(preview(page)).toHaveText(expected)
    })
  }
})
