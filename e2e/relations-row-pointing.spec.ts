import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// The properties panel's Relations rows (src/components/workbench/Relations.tsx):
// pointing at a row identifies its line on the canvas (`edge-hover`); a click
// SELECTS that line, and the panel then shows the line instead of the node, so
// the row goes away under the pointer. Its pointing goes with it: the line stays
// selected, and it is not left drawn as pointed at once the pointer is elsewhere.
//
// Also: Relations reads the model and changes nothing, so under the edit lock
// its rows still select (a line, either end of it), and the document stays as
// it was.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const node = (id: string, kind: string, data: Record<string, unknown>, x: number, y: number) => ({ id, type: kind, position: { x, y }, data: { kind, label: id, ...data } })
const res = (id: string, s: string, t: string) => ({ id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
const DOC = JSON.stringify({
  schema: 'loop-studio/graph/2',
  version: 1,
  nodes: [
    node('src', 'source', { label: 'Supply', activation: 'automatic' }, 0, 0),
    node('pool', 'pool', { label: 'Store', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 320, 0),
    node('sink', 'drain', { label: 'Use', activation: 'automatic' }, 640, 0),
  ],
  edges: [res('e_in', 'src', 'pool'), res('e_out', 'pool', 'sink')],
})

const panel = (page: Page) => page.locator('.app__body > :last-child')
const pick = async (page: Page, name: string) => {
  await page.locator('.wb-left').getByText(name, { exact: true }).first().click()
  await expect(panel(page).locator('.wb-rel')).toBeVisible()
}
const state = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    return {
      hover: l.ui.getState().hoverEdgeId as string | null,
      selectedEdges: (l.graph.getState().edges as { id: string; selected?: boolean }[]).filter((e) => e.selected).map((e) => e.id),
      selectedNodes: (l.graph.getState().nodes as { id: string; selected?: boolean }[]).filter((n) => n.selected).map((n) => n.id),
      drawnHover: [...document.querySelectorAll('.react-flow__edge-path.edge-hover')].map((p) => p.closest('.react-flow__edge')?.getAttribute('data-id')),
    }
  })
const doc = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return JSON.stringify({ nodes: g.nodes.map((n: any) => ({ id: n.id, p: n.position, d: n.data })), edges: g.edges.map((e: any) => ({ id: e.id, s: e.source, t: e.target, d: e.data })) })
  })

// issue #393 C — "Connections that use this value" came from a substring test
// (`expr.includes('@' + id)` / `flow === '@' + id`): a Parameter whose id is
// the start of another's listed the other's connections, and the `@{id}`
// spelling was never listed. The rows now come from the same parsed,
// exact-id scanner the delete check uses (`findReferences`).
test.describe('Relations — connections that use a Parameter (#393 C)', () => {
  const PARAMS = JSON.stringify({
    schema: 'loop-studio/graph/2',
    version: 1,
    nodes: [
      node('a', 'parameter', { label: 'a', value: 2 }, 0, 200),
      node('ab', 'parameter', { label: 'ab', value: 3 }, 0, 320),
      node('src', 'source', { label: 'Supply', activation: 'automatic' }, 0, 0),
      node('pool', 'pool', { label: 'Store', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 320, 0),
      node('sink', 'drain', { label: 'Use', activation: 'automatic' }, 640, 0),
    ],
    edges: [
      { ...res('e_ab', 'src', 'pool'), data: { kind: 'resource', flow: '@ab' } },
      { ...res('e_a_braced', 'pool', 'sink'), data: { kind: 'resource', flow: '@{a}' } },
      // an activator reading `ab`: the old `expr.includes('@a')` listed it under `a`
      { id: 'e_act_ab', source: 'pool', target: 'sink', type: 'loop', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>=@ab' } },
    ],
  })
  const usesRows = (page: Page) => panel(page).locator('.wb-rel__sec[aria-label="Connections that use this value"] .wb-rel__row')
  const rowEdges = (page: Page) => usesRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-edge')))
  // the plain click (not `pick`): with no row at all the panel shows "none" and `.wb-rel` is absent
  const select = (page: Page, name: string) => page.locator('.wb-left').getByText(name, { exact: true }).first().click()

  test('`a` lists only the `@{a}` connection; `ab` lists its flow and its activator', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, PARAMS)
    await select(page, 'a')
    await expect.poll(() => rowEdges(page), 'a: the braced reference, and not ab’s activator').toEqual(['e_a_braced'])
    await select(page, 'ab')
    await expect.poll(() => rowEdges(page), 'ab: its flow and its activator').toEqual(['e_ab', 'e_act_ab'])
  })
})

test.describe('Relations rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 940 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, DOC)
  })

  test('a row pointed at, then clicked: the line stays selected, its pointing ends with the row', async ({ page }) => {
    await pick(page, 'Store')
    const row = panel(page).locator('.wb-rel__row[data-edge="e_out"]')
    await row.hover()
    await expect.poll(async () => (await state(page)).hover, 'pointing at the row identifies its line').toBe('e_out')
    await row.click()
    await expect(panel(page).locator('.wb-rel__sentence')).toBeVisible()
    // the pointer moves off, to the panel's empty foot (no line under it)
    const box = (await panel(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8)
    const s = await state(page)
    expect(s.selectedEdges, 'the click selected the line').toEqual(['e_out'])
    expect(s.hover, 'no line is left pointed at').toBeNull()
    expect(s.drawnHover).toEqual([])
    // and once the line is deselected, nothing is drawn as pointed at either
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.setSelection(null, null)
      g.onEdgesChange(g.edges.filter((e: { selected?: boolean }) => e.selected).map((e: { id: string }) => ({ id: e.id, type: 'select', selected: false })))
    })
    await expect.poll(async () => (await state(page)).drawnHover).toEqual([])
  })

  test('a row reached by the keyboard: focus identifies the line, Enter selects it, and nothing is left pointed at', async ({ page }) => {
    await pick(page, 'Store')
    const row = panel(page).locator('.wb-rel__row[data-edge="e_in"]')
    await row.focus()
    await expect.poll(async () => (await state(page)).hover).toBe('e_in')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.wb-rel__sentence')).toBeVisible()
    const s = await state(page)
    expect(s.selectedEdges).toEqual(['e_in'])
    expect(s.hover).toBeNull()
  })

  test('under the edit lock: a row selects its line and each end selects its node; the document does not change', async ({ page }) => {
    const before = await doc(page)
    await page.locator('.wb-toolrow [data-tool="lock"]').click()
    await expect(page.locator('.canvas.canvas--locked')).toHaveCount(1)
    await pick(page, 'Store')
    const row = panel(page).locator('.wb-rel__row[data-edge="e_out"]')
    await expect(row).toBeEnabled()
    await row.click()
    await expect(panel(page).locator('.wb-rel__sentence')).toBeVisible()
    expect((await state(page)).selectedEdges).toEqual(['e_out'])
    const ends = panel(page).locator('.wb-rel__link')
    await expect(ends).toHaveCount(2)
    await expect(ends.nth(1)).toBeEnabled()
    await ends.nth(1).click()
    await expect.poll(async () => (await state(page)).selectedNodes).toEqual(['sink'])
    // the panel's editing fields stay locked
    await expect(panel(page).locator('input:not([type="hidden"]), select, textarea').first()).toBeDisabled()
    expect(await doc(page), 'reading under the lock changes nothing in the document').toBe(before)
  })
})

// #613 item 6 — the keyboard focus ring of a Relations row was a box-shadow with the outline
// removed, and a link had no ring at all, only a colour. Forced colours drop box-shadows:
// a focused row then differed from an unfocused one by its 1 px border only, and a focused
// link was pixel-identical to an unfocused one (MEASURED on main 5515c4b9). Both now draw an
// outline, which forced colours keep.
test.describe('Relations — the keyboard focus ring of a row and of a link (#613 item 6)', () => {
  const ring = (el: ReturnType<Page['locator']>) =>
    el.evaluate((e) => {
      const c = getComputedStyle(e)
      return { focusVisible: e.matches(':focus-visible'), outline: c.outlineStyle, width: parseFloat(c.outlineWidth), boxShadow: c.boxShadow }
    })
  for (const forced of [false, true])
    for (const [what, sel, selection] of [
      ['row', '.wb-rel__row', { selectedNodeId: 'pool', selectedEdgeId: null }],
      ['link', '.wb-rel__link', { selectedNodeId: null, selectedEdgeId: 'e_in' }],
    ] as const) {
      test(`${forced ? 'forced colours' : 'normal colours'}: a focused ${what} shows a ring`, async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 940 })
        await openApp(page)
        await resetAll(page)
        await importGraph(page, DOC)
        if (forced) await page.emulateMedia({ forcedColors: 'active' })
        await page.evaluate((s) => (window as unknown as { __loop: Record<string, { setState: (x: object) => void }> }).__loop.graph.setState(s), selection)
        const el = panel(page).locator(sel).first()
        await expect(el).toBeVisible()
        await page.mouse.move(2, 2)
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        const bb = (await el.boundingBox())!
        const clip = { x: bb.x - 6, y: bb.y - 6, width: bb.width + 12, height: bb.height + 12 }
        const unfocused = await page.screenshot({ clip })
        await page.keyboard.press('Shift') // a keyboard interaction: the focus below is :focus-visible
        await el.focus()
        const r = await ring(el)
        expect(r.focusVisible, `${what}: focus-visible`).toBe(true)
        if (forced || what === 'link') {
          expect(r.outline, `${what}: an outline ring`).toBe('solid')
          expect(r.width, `${what}: at least 2 px`).toBeGreaterThanOrEqual(2)
        } else {
          // normal colours, the row: a ring, drawn either way
          expect(r.outline !== 'none' || r.boxShadow !== 'none', 'row: a ring').toBe(true)
        }
        if (forced) {
          const focused = await page.screenshot({ clip })
          expect(Buffer.compare(unfocused, focused) !== 0, `${what}: focused looks different from unfocused`).toBe(true)
        }
      })
    }
})

// issue #616 item 1 — a flow row's `◇` marks a reference to a Parameter. Relations read it from
// the text: whatever followed `@` was taken as the id, so on main `ba39e719` `@{rate}` showed
// `◇ {rate}` and `@rate*2`, which the engine refuses (it moves nothing), showed `◇ rate*2`.
// The row now reads the flow as the engine does: a single `@id` or `@{id}` naming a Parameter
// shows `◇` and the Parameter's name; any other text is shown as it is.
test.describe('#616 item 1 — Relations marks only a reference the engine runs', () => {
  const pool = (id: string, label: string, y: number) => node(id, 'pool', { label, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }, 400, y)
  const flow = (id: string, target: string, f: string) => ({ id, source: 'src', target, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: f } })
  const REFS = JSON.stringify({
    schema: 'loop-studio/graph/2',
    version: 1,
    nodes: [
      node('src', 'source', { label: 'Source', activation: 'automatic' }, 0, 0),
      node('rate', 'parameter', { label: 'Rate value', value: 3 }, 0, 300),
      pool('p_plain', 'Plain ref', -300),
      pool('p_braced', 'Braced ref', -150),
      pool('p_expr', 'Expression', 0),
      pool('p_pool', 'Pool ref', 150),
      pool('p_missing', 'Missing ref', 300),
      pool('p_number', 'Number', 450),
    ],
    edges: [
      flow('e_plain', 'p_plain', '@rate'),
      flow('e_braced', 'p_braced', '@{rate}'),
      flow('e_expr', 'p_expr', '@rate*2'),
      flow('e_pool', 'p_pool', '@p_plain'),
      flow('e_missing', 'p_missing', '@nowhere'),
      flow('e_number', 'p_number', '2'),
    ],
  })
  /** each row's effect, by the name of the Pool it leads to (bidi isolates removed) */
  const effects = (page: Page) =>
    panel(page)
      .locator('.wb-rel__row')
      .evaluateAll((els) =>
        Object.fromEntries(els.map((e) => [(e.querySelector('.wb-rel__name')?.textContent ?? '').replace(/[⁦-⁩]/g, ''), (e.querySelector('.wb-rel__effect')?.textContent ?? '').replace(/[⁦-⁩]/g, '')])),
      )
  /** what one step moves into each Pool: the engine's own reading of each flow */
  const movedInOneStep = async (page: Page) => {
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
    return page.evaluate(() => {
      const v = (window as unknown as Bridge).__loop.sim.getState().values as Record<string, number>
      return { p_plain: v.p_plain, p_braced: v.p_braced, p_expr: v.p_expr, p_pool: v.p_pool, p_missing: v.p_missing, p_number: v.p_number }
    })
  }

  test('`@{rate}` reads as the Parameter; `@rate*2`, a Pool and a missing id read as written', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, REFS)
    await pick(page, 'Source')
    const e = await effects(page)
    // soft: every row is checked, so a failure lists each one that reads wrong
    expect.soft(e['Braced ref'], 'a braced reference').toBe('◇ Rate value')
    expect.soft(e.Expression, 'not a reference: the engine moves nothing').toBe('@rate*2')
    expect.soft(e['Pool ref'], 'a reference to a Pool: the engine moves nothing').toBe('@p_plain')
    expect.soft(e['Missing ref'], 'a reference to no node: the engine moves nothing').toBe('@nowhere')
    // the engine agrees: the two references move the Parameter's 3, the others nothing
    expect(await movedInOneStep(page)).toMatchObject({ p_plain: 3, p_braced: 3, p_expr: 0, p_pool: 0, p_missing: 0 })
  })

  test('control: `@rate` and a number read as before', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, REFS)
    await pick(page, 'Source')
    const e = await effects(page)
    expect(e['Plain ref']).toBe('◇ Rate value')
    expect(e.Number).toBe('2')
  })
})
