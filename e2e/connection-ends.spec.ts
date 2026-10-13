import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, iso, openApp, routesSettled, test } from './support/loop'

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
async function selectEdge(page: Page, id: string, open = false): Promise<Locator> {
  const p = await page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).evaluate((el) => {
    const s = el as SVGPathElement
    const q = s.getPointAtLength(s.getTotalLength() * 0.3)
    const m = s.getScreenCTM()!
    return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
  })
  await page.mouse.click(p.x, p.y)
  const ends = page.locator('.inspector .ends')
  await expect(ends).toBeVisible()
  if (open) {
    await ends.locator('.ends__toggle').click()
    await expect(ends.locator('.ends__toggle')).toHaveAttribute('aria-expanded', 'true')
  }
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
    const ends = await selectEdge(page, 'e_leave', true)
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
    const ends = await selectEdge(page, 'e_leave', true)
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
    const ends = await selectEdge(page, 'e_leave', true)
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
    const ends = await selectEdge(page, 'e_leave', true)
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
    const ends = await selectEdge(page, 'e_leave', true)
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
    const ends = await selectEdge(page, 'e_leave', true)
    await to(ends).locator('select').selectOption('waiting')
    await apply(ends).click()
    await page.evaluate(() => (window as unknown as { __loop: { autosave: { flush: () => void } } }).__loop.autosave.flush())
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await expect.poll(async () => (await state(page, 'e_leave')).target).toBe('waiting')
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.ui.getState().setCanvasLocked(true))
    const again = await selectEdge(page, 'e_leave')
    // the Inspector is disabled as a whole: the group cannot be opened, nor its controls used
    await expect(again.locator('.ends__toggle')).toBeDisabled()
    await expect(to(again).locator('select')).toBeDisabled()
  })
})

// The canvas end grips of the one selected connection: the same check and the
// same change as the Ends group, by mouse or touch.
const grip = (page: Page, end: 'source' | 'target') => page.locator(`.end-grip[data-end="${end}"]`)
const centreOf = async (l: Locator) => {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const faceSel = (node: string, handle: string) => `.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${handle}"]`

/** press the grip, move a little so the drag starts (the faces mount then),
 *  then go to `to` (a face selector, or a point) and release */
async function dragGrip(page: Page, end: 'source' | 'target', to: string | { x: number; y: number }, opts: { esc?: boolean } = {}) {
  const a = await centreOf(grip(page, end))
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 20, a.y + 20, { steps: 5 })
  const b = typeof to === 'string' ? await centreOf(page.locator(to)) : to
  await page.mouse.move(b.x, b.y, { steps: 15 })
  if (opts.esc) await page.keyboard.press('Escape')
  await page.mouse.up()
}

test.describe('the canvas end grips (§ER18)', () => {
  test('only the one selected connection shows grips; a second selection or none shows none', async ({ page }) => {
    await open(page)
    await expect(page.locator('.end-grip')).toHaveCount(0)
    // hover alone: no grips
    const e = page.locator('.react-flow__edge[data-id="e_leave"] path.react-flow__edge-path')
    await e.hover({ force: true })
    await expect(page.locator('.end-grip')).toHaveCount(0)
    await selectEdge(page, 'e_leave')
    await expect(page.locator('.end-grip')).toHaveCount(2)
    // each grip is a named button (Enter opens the side choice; dragging is the pointer's)
    await expect(grip(page, 'target')).toHaveAccessibleName('End of this connection: choose a side')
    await expect(grip(page, 'source')).toHaveAccessibleName('Start of this connection: choose a side')
    // add a node to the selection: no grips
    await page.locator('.react-flow__node[data-id="waiting"]').click({ modifiers: ['Shift'] })
    await expect(page.locator('.end-grip')).toHaveCount(0)
  })

  test('drag the target grip onto another node’s face: moved, one undo step, every data field kept', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    await dragGrip(page, 'target', faceSel('waiting', 'in@top'))
    const after = await state(page, 'e_leave')
    expect([after.source, after.target, after.sourceHandle, after.targetHandle]).toEqual(['treated', 'waiting', 'out', 'in'])
    expect(after.data).toEqual({ ...before.data, ports: { source: 'bottom', target: 'top' } })
    expect(after.past).toBe(before.past + 1)
    expect(after.rev).toBe(before.rev + 1)
  })

  test('drag the source grip to another side of the same node: the run is kept', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    await dragGrip(page, 'source', faceSel('treated', 'out'))
    const after = await state(page, 'e_leave')
    expect([after.source, after.target]).toEqual(['treated', 'discharged'])
    expect(after.data).toEqual({ ...before.data, ports: { target: 'top' } })
    expect(after.past).toBe(before.past + 1)
    expect(after.rev, 'a side is drawing: the run is kept').toBe(before.rev)
  })

  test('a drop the check refuses changes nothing and says why — in the live region and the Ends status line', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    // a resource connection's target onto a Parameter (no ports)
    await dragGrip(page, 'target', faceSel('rate', 'state-target'))
    expect(await state(page, 'e_leave')).toEqual(before)
    const reason = `${iso('Arrivals per step')} has no ports; refer to it from an expression instead.`
    await expect(page.locator('[id^="react-flow__aria-live"]').first()).toContainText(reason)
    await expect(ends.locator('.ends__status')).toHaveText(reason)
  })

  test('a drop on empty canvas, and Esc during the drag, change nothing and record nothing', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    await dragGrip(page, 'target', { x: 600, y: 700 })
    expect(await state(page, 'e_leave')).toEqual(before)
    await dragGrip(page, 'target', faceSel('waiting', 'in@top'), { esc: true })
    expect(await state(page, 'e_leave')).toEqual(before)
    // the drag really ended at Esc: no connection line remains
    await expect(page.locator('.react-flow__connection')).toHaveCount(0)
  })

  test('the phone shows no grips', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // the phone has no toolbar file input: load the fixture as the specs' store helper does
    await openApp(page)
    await importGraph(page, FIXTURE)
    await page.evaluate(() => {
      const l = (window as unknown as { __loop: L }).__loop
      l.graph.getState().setSelection(null, 'e_leave')
      l.graph.setState({ edges: l.graph.getState().edges.map((e: { id: string }) => ({ ...e, selected: e.id === 'e_leave' })) })
    })
    await expect(page.locator('.react-flow__edge[data-id="e_leave"].selected')).toHaveCount(1)
    await expect(page.locator('.end-grip')).toHaveCount(0)
  })

  test('a grip is a 24 px screen target at every zoom, the dot stays small, and on this fixture its target meets no port', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    for (const zoom of [0.5, 1, 2]) {
      await page.evaluate((z) => (window as unknown as { __loop: L }).__loop.rf.setViewport({ x: 40, y: 60, zoom: z }, { duration: 0 }), zoom)
      const m = await page.evaluate(() => {
        const meet = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        return [...document.querySelectorAll('.end-grip')].map((g) => {
          const gb = g.getBoundingClientRect()
          const dot = g.querySelector('.end-grip__dot')!.getBoundingClientRect()
          const ports = [...document.querySelectorAll('.react-flow__handle')].filter((h) => !(h as HTMLElement).hasAttribute('data-off') && meet(gb, h.getBoundingClientRect())).length
          return { w: Math.round(gb.width), h: Math.round(gb.height), dot: Math.round(dot.width), ports }
        })
      })
      expect(m, `zoom ${zoom}`).toEqual([
        { w: 24, h: 24, dot: 10, ports: 0 },
        { w: 24, h: 24, dot: 10, ports: 0 },
      ])
    }
  })

  test('under the edit lock there are no grips', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    await expect(page.locator('.end-grip')).toHaveCount(2)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.ui.getState().setCanvasLocked(true))
    await expect(page.locator('.end-grip')).toHaveCount(0)
  })
})

test.describe('the canvas end grips by touch (§ER18)', () => {
  test.use({ hasTouch: true })
  test('with a touch pointer a grip is a 44 px target that, on this fixture, meets no port', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const m = await page.evaluate(() => {
      const meet = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      return {
        coarse: matchMedia('(any-pointer: coarse)').matches,
        grips: [...document.querySelectorAll('.end-grip')].map((g) => {
          const gb = g.getBoundingClientRect()
          return { w: Math.round(gb.width), h: Math.round(gb.height), ports: [...document.querySelectorAll('.react-flow__handle')].filter((h) => !(h as HTMLElement).hasAttribute('data-off') && meet(gb, h.getBoundingClientRect())).length }
        }),
      }
    })
    expect(m).toEqual({ coarse: true, grips: [{ w: 44, h: 44, ports: 0 }, { w: 44, h: 44, ports: 0 }] })
  })
  test('a touch drag of the target grip onto another node’s face moves the end', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    const cdp = await page.context().newCDPSession(page)
    const a = await centreOf(grip(page, 'target'))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] })
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + 4 * i, y: a.y + 4 * i }] })
    // the drag is in progress: the faces are offered
    await expect(page.locator(faceSel('waiting', 'in@top'))).toHaveCount(1)
    const b = await centreOf(page.locator(faceSel('waiting', 'in@top')))
    for (let i = 1; i <= 15; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + 20 + ((b.x - a.x - 20) * i) / 15, y: a.y + 20 + ((b.y - a.y - 20) * i) / 15 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const after = await state(page, 'e_leave')
    expect([after.source, after.target]).toEqual(['treated', 'waiting'])
    expect(after.past).toBe(before.past + 1)
  })
})

test.describe('the Ends group folds (§ER18)', () => {
  test('collapsed by default: the From → To summary, the pick hidden; the keyboard opens it and still reaches Colour', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    const toggle = ends.locator('.ends__toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText(`${iso('Treated today')} → ${iso('Discharged home')}`)
    await expect(from(ends).locator('select')).toBeHidden()
    await expect(apply(ends)).toBeHidden()
    // the keyboard: Enter on the toggle opens it, the pick is next in order
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(from(ends).locator('select')).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(from(ends).locator('select')).toBeFocused()
    // and on, by Tab, to the Colour section, which scrolls into view
    const colour = page.locator('.inspector .accent-swatch--default')
    for (let i = 0; i < 30 && !(await colour.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(colour).toBeFocused()
    await expect(colour).toBeInViewport()
    // folding it away with a pick not applied drops the pick
    await toggle.click()
    await toggle.click()
    await expect(from(ends).locator('select')).toHaveValue('treated')
  })

  test('a reason stays visible in the group while it is folded', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_leave')
    await dragGrip(page, 'target', faceSel('rate', 'state-target'))
    await expect(ends.locator('.ends__toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(ends.locator('.ends__status')).toBeVisible()
    await expect(ends.locator('.ends__status')).toHaveText(`${iso('Arrivals per step')} has no ports; refer to it from an expression instead.`)
  })
})

test.describe('the grips: the side choice by click, tap or key (§ER18)', () => {
  test('a click on a grip offers that node’s four sides, the current one marked; choosing one moves the end, closes, focus back on the grip', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    await grip(page, 'target').click()
    const picker = page.locator('.end-picker[data-end="target"]')
    await expect(picker).toHaveAttribute('role', 'group')
    await expect(picker.getByRole('button')).toHaveCount(4)
    await expect(picker.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true')
    await expect(picker.getByRole('button', { name: 'Top' })).toBeFocused()
    // the buttons sit around Discharged home only
    const node = (await page.locator('.react-flow__node[data-id="discharged"]').boundingBox())!
    for (const b of await picker.getByRole('button').all()) {
      const r = (await b.boundingBox())!
      const cx = r.x + r.width / 2
      const cy = r.y + r.height / 2
      expect(cx).toBeGreaterThan(node.x - 60)
      expect(cx).toBeLessThan(node.x + node.width + 60)
      expect(cy).toBeGreaterThan(node.y - 60)
      expect(cy).toBeLessThan(node.y + node.height + 60)
    }
    await picker.getByRole('button', { name: 'Left' }).click()
    await expect(picker).toHaveCount(0)
    await expect(grip(page, 'target')).toBeFocused()
    const after = await state(page, 'e_leave')
    expect(after.target).toBe('discharged')
    expect(after.data).toEqual({ ...before.data, ports: { source: 'bottom' } })
    expect(after.past).toBe(before.past + 1)
    expect(after.rev, 'a side is drawing: the run is kept').toBe(before.rev)
  })

  test('the keyboard: Enter on a focused grip opens the sides; Esc closes unchanged, focus back on the grip', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    await grip(page, 'source').focus()
    await page.keyboard.press('Enter')
    const picker = page.locator('.end-picker[data-end="source"]')
    await expect(picker.getByRole('button', { name: 'Bottom' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(grip(page, 'source')).toBeFocused()
    expect(await state(page, 'e_leave')).toEqual(before)
    // a pick by the keyboard
    await page.keyboard.press('Enter')
    await picker.getByRole('button', { name: 'Right' }).focus()
    await page.keyboard.press('Enter')
    // Right is a resource connection's default source side: the stored form drops it
    expect((await state(page, 'e_leave')).data.ports).toEqual({ target: 'top' })
  })

})

test.describe('the grips: the side choice by tap (§ER18)', () => {
  test.use({ hasTouch: true })
  test('a tap offers the sides as a click does, and a tapped side moves the end', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    await grip(page, 'target').tap()
    const picker = page.locator('.end-picker[data-end="target"]')
    await expect(picker.getByRole('button')).toHaveCount(4)
    await picker.getByRole('button', { name: 'Bottom' }).tap()
    await expect(picker).toHaveCount(0)
    expect((await state(page, 'e_leave')).data.ports).toEqual({ source: 'bottom', target: 'bottom' })
  })
})

test.describe('the grips: nothing applied when a drag is cut short (§ER18)', () => {
  test('two connections selected: no grips', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    await expect(page.locator('.end-grip')).toHaveCount(2)
    // a second connection joins the selection by Ctrl+click, React Flow's
    // multi-selection key here (held on the keyboard: `mouse.click` has no
    // modifier option); the same steps select two on main e7efd77 too
    const p = await page.locator('.react-flow__edge[data-id="e_treat"] path.react-flow__edge-path').evaluate((el) => {
      const s = el as SVGPathElement
      const q = s.getPointAtLength(s.getTotalLength() * 0.5)
      const m = s.getScreenCTM()!
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f }
    })
    await page.keyboard.down('Control')
    await page.mouse.click(p.x, p.y)
    await page.keyboard.up('Control')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().edges.filter((e: { selected?: boolean }) => e.selected).length)).toBe(2)
    await expect(page.locator('.end-grip')).toHaveCount(0)
  })

  test('after Esc, moving on and releasing over a valid face applies nothing, and the drag is over', async ({ page }) => {
    await open(page)
    await selectEdge(page, 'e_leave')
    const before = await state(page, 'e_leave')
    const a = await centreOf(grip(page, 'target'))
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(a.x + 20, a.y + 20, { steps: 5 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.react-flow__connection')).toHaveCount(0)
    // moving on after Esc does not bring the drag back
    const b = await centreOf(page.locator('.react-flow__node[data-id="waiting"]'))
    await page.mouse.move(b.x, b.y, { steps: 10 })
    await expect(page.locator('.react-flow__connection')).toHaveCount(0)
    await page.mouse.up()
    expect(await state(page, 'e_leave')).toEqual(before)
  })

  for (const [what, cut] of [
    ['the connection is deselected', 'deselect'],
    ['the connection is deleted', 'delete'],
    ['the edit lock is turned on', 'lock'],
  ] as const) {
    test(`a drag in progress is cancelled when ${what}: nothing applied, no line left`, async ({ page }) => {
      await open(page)
      await selectEdge(page, 'e_leave')
      const n0 = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().edges.length)
      const before = await state(page, 'e_leave')
      const a = await centreOf(grip(page, 'target'))
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      await page.mouse.move(a.x + 20, a.y + 20, { steps: 5 })
      await expect(page.locator('.react-flow__connection')).toHaveCount(1)
      await page.evaluate((cut) => {
        const l = (window as unknown as { __loop: L }).__loop
        const g = l.graph.getState()
        if (cut === 'deselect') {
          g.setSelection(null, null)
          l.graph.setState({ edges: g.edges.map((e: object) => ({ ...e, selected: false })) })
        } else if (cut === 'delete') g.removeEdge('e_leave')
        else l.ui.getState().setCanvasLocked(true)
      }, cut)
      await expect(page.locator('.end-grip')).toHaveCount(0)
      await expect(page.locator('.react-flow__connection')).toHaveCount(0)
      const b = await centreOf(page.locator('.react-flow__node[data-id="waiting"]'))
      await page.mouse.move(b.x, b.y, { steps: 10 })
      await page.mouse.up()
      const edges = await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().edges.map((e: { id: string; target: string }) => ({ id: e.id, target: e.target })))
      if (cut === 'delete') {
        expect(edges.length, 'the deleted connection is not brought back, nothing new drawn').toBe(n0 - 1)
      } else {
        expect(edges.length).toBe(n0)
        expect(await state(page, 'e_leave')).toEqual({ ...before, past: (await state(page, 'e_leave')).past })
        expect((await state(page, 'e_leave')).target).toBe('discharged')
      }
    })
  }
})
