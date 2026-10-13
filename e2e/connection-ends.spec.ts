import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, iso, openApp, routesSettled, test } from './support/loop'

// docs/edge-routing.md §ER18 — moving a connection's end from the Inspector's
// Ends group: pick a node and a side, then Apply. One check and one change for
// every surface; a disabled candidate's reason is in its own text; the user's
// bends are kept; a side-only move keeps the run, a node change resets it;
// Revert, a refusal and the same ends record nothing. On the small
// node-structure fixture (e_leave: Treated today → Discharged home, drawn from
// Treated today's bottom to Discharged home's top).

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')
type L = { graph: { getState: () => any; setState: (s: object) => void }; ui: { getState: () => any }; rf: { setViewport: (v: object, o?: object) => void } }

async function open(page: Page) {
  await openApp(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'node-structure-small.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE, 'utf8') })
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await page.evaluate(() => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: 1 }, { duration: 0 }))
  await routesSettled(page)
}

/** a click on the connection's own line, as a user selects it */
async function selectEdge(page: Page, id: string): Promise<Locator> {
  const p = await page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).evaluate((el) => {
    const s = el as SVGPathElement
    const q = s.getPointAtLength(s.getTotalLength() * 0.3)
    const m = s.getScreenCTM()!
    return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
  })
  await page.mouse.click(p.x, p.y)
  const ends = page.locator('.inspector .ends')
  await expect(ends).toBeVisible()
  return ends
}

const state = (page: Page, id: string) =>
  page.evaluate((id) => {
    const g = (window as unknown as { __loop: L }).__loop.graph.getState()
    const e = g.edges.find((x: { id: string }) => x.id === id)
    return { source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data, past: g.past.length as number, rev: g.simulationRev as number }
  }, id)

const from = (ends: Locator) => ends.locator('.ends__end').nth(0)
const to = (ends: Locator) => ends.locator('.ends__end').nth(1)
const apply = (ends: Locator) => ends.getByRole('button', { name: 'Apply' })

test.describe('the Inspector Ends group (§ER18)', () => {
  test('shows each end as it is; a node that cannot take the end is disabled with the reason in its text; nothing to apply yet', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    await expect(from(ends).locator('select')).toHaveValue('treated')
    await expect(to(ends).locator('select')).toHaveValue('discharged')
    await expect(from(ends).getByRole('radio', { name: 'Bottom' })).toBeChecked()
    await expect(to(ends).getByRole('radio', { name: 'Top' })).toBeChecked()
    // the group and its parts are named for a screen reader
    await expect(page.locator('.inspector').getByRole('region', { name: 'Ends' })).toBeVisible()
    await expect(from(ends).getByRole('radiogroup', { name: 'Side' })).toBeVisible()
    const toOptions = await to(ends).locator('option').evaluateAll((os) => os.map((o) => ({ text: o.textContent, disabled: (o as HTMLOptionElement).disabled })))
    expect(toOptions).toContainEqual({ text: 'Daily arrivals · Source — no input', disabled: true })
    expect(toOptions).toContainEqual({ text: 'Arrivals per step · Parameter — no ports', disabled: true })
    expect(toOptions).toContainEqual({ text: 'Waiting room · Pool', disabled: false })
    const fromOptions = await from(ends).locator('option').evaluateAll((os) => os.map((o) => ({ text: o.textContent, disabled: (o as HTMLOptionElement).disabled })))
    expect(fromOptions).toContainEqual({ text: 'Discharged home · Drain — no output', disabled: true })
    expect(fromOptions).toContainEqual({ text: 'Waiting-room occupancy · Register — no ports', disabled: true })
    await expect(apply(ends)).toBeDisabled()
    await expect(ends.getByRole('button', { name: 'Revert' })).toBeDisabled()
  })

  test('a side of the same node: nothing changes until Apply; then one undo step, every data field kept, the run kept', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    await to(ends).getByRole('radio', { name: 'Left' }).check()
    expect(await state(page, 'e_leave'), 'a pick alone changes nothing').toEqual(before)
    await apply(ends).click()
    const after = await state(page, 'e_leave')
    expect([after.source, after.target, after.sourceHandle, after.targetHandle]).toEqual([before.source, before.target, 'out', 'in'])
    expect(after.data).toEqual({ ...before.data, ports: { source: 'bottom' } })
    expect(after.past).toBe(before.past + 1)
    expect(after.rev, 'a side is drawing: the run is kept').toBe(before.rev)
    await expect(ends.locator('.ends__status')).toHaveText(`The connection now runs from ${iso('Treated today')} to ${iso('Discharged home')}.`)
    await expect(apply(ends)).toBeDisabled()
    // undo, by the keyboard, from the canvas
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    const undone = await state(page, 'e_leave')
    expect(undone.data).toEqual(before.data)
    expect(undone.rev, 'undoing a side-only move keeps the run').toBe(before.rev)
  })

  test('another node, by the keyboard only: one undo step, the run reset; Revert first returns the pick and records nothing', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    // a pick, then Revert
    await to(ends).locator('select').selectOption('waiting')
    await ends.getByRole('button', { name: 'Revert' }).click()
    await expect(to(ends).locator('select')).toHaveValue('discharged')
    expect(await state(page, 'e_leave')).toEqual(before)
    // the keyboard: focus the To list, choose Waiting room, its Top side, Apply
    await to(ends).locator('select').focus()
    await to(ends).locator('select').selectOption('waiting')
    await page.keyboard.press('Tab')
    await expect(to(ends).getByRole('radio', { name: 'Top' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect(to(ends).getByRole('radio', { name: 'Top' })).toBeChecked()
    await apply(ends).focus()
    await page.keyboard.press('Enter')
    const after = await state(page, 'e_leave')
    expect([after.source, after.target]).toEqual(['treated', 'waiting'])
    expect(after.data).toEqual({ ...before.data, ports: { source: 'bottom', target: 'top' } })
    expect(after.past).toBe(before.past + 1)
    expect(after.rev).toBe(before.rev + 1)
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    expect((await state(page, 'e_leave')).target).toBe('discharged')
  })

  test('a move that would repeat another connection by the drawing rule is refused with its reason; Apply stays disabled; nothing recorded', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    // Triage desk → Treated today already exists (e_treat, out / in)
    await from(ends).locator('select').selectOption('triage')
    await to(ends).locator('select').selectOption('treated')
    const status = ends.locator('.ends__status')
    await expect(status).toHaveText(`${iso('Triage desk')} and ${iso('Treated today')} are already connected this way.`)
    await expect(status).toHaveAttribute('role', 'status')
    await expect(apply(ends)).toBeDisabled()
    await expect(apply(ends)).toHaveAttribute('aria-describedby', (await status.getAttribute('id'))!)
    expect(await state(page, 'e_leave')).toEqual(before)
  })

  test('the user’s bends are kept; one that the new end would put on its stub is said before applying', async ({ page }) => {
    await open(page)
    // a user bend on e_leave 12 px above Treated today's TOP port: clear of
    // today's ends (bottom → top), on the stub once the source moves to the top
    // side (set through the store: the bend editor has its own specs)
    const bend = await page.evaluate(async () => {
      const rm = await import('/src/store/routeMap.ts' as string)
      const g = (window as unknown as { __loop: L }).__loop.graph.getState()
      const n = g.nodes.find((x: { id: string }) => x.id === 'treated')
      const pt = rm.portPoint(n, 'top', 'out') as { x: number; y: number }
      const p = { x: Math.round(pt.x), y: Math.round(pt.y - 12) }
      g.setEdgeRouting('e_leave', { route: 'orthogonal', waypoints: [p] })
      return { p, before: rm.bendRejection(g.nodes, (window as unknown as { __loop: L }).__loop.graph.getState().edges, 'e_leave', p) }
    })
    expect(bend.before, 'the bend is valid where the connection is now').toBeNull()
    const ends = await selectEdge(page, 'e_leave')
    const status = ends.locator('.ends__status')
    await expect(status).toHaveText('')
    await from(ends).getByRole('radio', { name: 'Top' }).check()
    await expect(status).toHaveText('A bend of this connection would be inside a node or next to the new end, and the line will not pass through it. Apply keeps the bends; “Reset to automatic” removes them.')
    // a warning, not a refusal: Apply is still offered, and it keeps the bend
    await expect(apply(ends)).toBeEnabled()
    await apply(ends).click()
    expect((await state(page, 'e_leave')).data.waypoints, 'a move never removes the user’s bends').toEqual([bend.p])
  })

  test('a moved end survives a reload (autosave) and the edit lock disables the group', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    await to(ends).locator('select').selectOption('waiting')
    await apply(ends).click()
    await page.evaluate(() => (window as unknown as { __loop: { autosave: { flush: () => void } } }).__loop.autosave.flush())
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await expect.poll(async () => (await state(page, 'e_leave')).target).toBe('waiting')
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.ui.getState().setCanvasLocked(true))
    const again = await selectEdge(page, 'e_leave')
    await expect(to(again).locator('select')).toBeDisabled()
    await expect(apply(again)).toBeDisabled()
  })
})
