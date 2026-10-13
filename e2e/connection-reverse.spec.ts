import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, openApp, routesSettled, test } from './support/loop'

// docs/edge-routing.md §ER19 — reversing a connection's direction from the
// Inspector's Ends group: Reverse sits beside the folded summary, is its own
// button (it never opens or closes the group), applies at once as one undo
// step and resets the run. A refusal keeps the button focusable with its
// reason beside it; a pick in the group that is not applied makes it wait. On
// the small node-structure fixture: e_treat Triage desk (Gate) → Treated today
// (Pool) can be reversed; e_arrive leaves a Source, e_leave enters a Drain,
// a_open is an activator from a Pool to a Gate.

const FIXTURE = readFileSync(new URL('./fixtures/node-structure-small.json', import.meta.url), 'utf8')
type L = { graph: { getState: () => any }; ui: { getState: () => any }; rf: { setViewport: (v: object, o?: object) => void } }

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

const reverse = (ends: Locator) => ends.getByRole('button', { name: 'Reverse direction' })
const note = (ends: Locator) => ends.locator('.ends__reverse-note')
const toggle = (ends: Locator) => ends.locator('.ends__toggle')

test.describe('Reverse in the Ends group (§ER19)', () => {
  test('folded: Reverse beside the summary with its hint; one press reverses at once, the group stays folded, one undo step, the run reset', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_treat')
    await expect(toggle(ends)).toHaveAttribute('aria-expanded', 'false')
    await expect(ends.locator('.ends__summary')).toHaveText(/Triage desk.*→.*Treated today/)
    await expect(reverse(ends)).toBeVisible()
    await expect(reverse(ends)).not.toHaveAttribute('aria-disabled', 'true')
    await expect(note(ends)).toHaveText('Reverse keeps the amount and condition; they are then read in the new direction.')
    await expect(reverse(ends)).toHaveAccessibleDescription('Reverse keeps the amount and condition; they are then read in the new direction.')
    const before = await state(page, 'e_treat')
    await reverse(ends).click()
    await expect.poll(async () => (await state(page, 'e_treat')).source).toBe('treated')
    const after = await state(page, 'e_treat')
    expect([after.target, after.sourceHandle, after.targetHandle]).toEqual(['triage', 'out', 'in'])
    expect(after.data).toEqual({ ...before.data, ports: { source: 'left', target: 'right' } })
    expect(after.past).toBe(before.past + 1)
    expect(after.rev).toBe(before.rev + 1)
    await expect(toggle(ends), 'Reverse never opens or closes the group').toHaveAttribute('aria-expanded', 'false')
    await expect(ends.locator('.ends__summary')).toHaveText(/Treated today.*→.*Triage desk/)
    // no bends: the result says the reading and what may move, not the bends
    await expect(note(ends)).toHaveText('Reversed. The amount and condition are kept and are now read in the new direction. The automatic route, the line next to each end and the label’s place may change.')
    // one undo step takes it back, and the run is reset again
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await state(page, 'e_treat')).source).toBe('triage')
    const undone = await state(page, 'e_treat')
    expect(undone.data).toEqual(before.data)
    expect(undone.past).toBe(before.past)
    expect(undone.rev).toBe(after.rev + 1)
  })

  test('with bends: they keep their points in reverse order, and the result says so', async ({ page }) => {
    await open(page)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.graph.getState().setEdgeRouting('e_treat', { route: 'orthogonal', waypoints: [{ x: 570, y: 302 }, { x: 622, y: 302 }] }))
    await routesSettled(page)
    const ends = await selectEdge(page, 'e_treat')
    await reverse(ends).click()
    await expect.poll(async () => (await state(page, 'e_treat')).source).toBe('treated')
    expect((await state(page, 'e_treat')).data.waypoints).toEqual([{ x: 622, y: 302 }, { x: 570, y: 302 }])
    await expect(note(ends)).toHaveText('Reversed. The amount and condition are kept and are now read in the new direction. Your bends stay where they were. The automatic route, the line next to each end and the label’s place may change.')
  })

  test('refused, folded: the button stays focusable and says why; pressing it records nothing', async ({ page }) => {
    await open(page)
    for (const [id, reason] of [
      ['e_arrive', /^Daily arrivals has no input, so this connection cannot end there\.$/],
      ['e_leave', /^Discharged home has no output, so this connection cannot start there\.$/],
      ['a_open', /^Reversed, this activator would start at Triage desk, which is not a Pool; an activator needs a Pool as its source\.$/],
    ] as const) {
      const ends = await selectEdge(page, id)
      await expect(toggle(ends)).toHaveAttribute('aria-expanded', 'false')
      await expect(reverse(ends)).toHaveAttribute('aria-disabled', 'true')
      // not natively disabled: it stays in the Tab order, so its reason is read
      expect(await reverse(ends).evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false)
      await reverse(ends).focus()
      await expect(reverse(ends)).toBeFocused()
      // the names are isolated (FSI … PDI) inside the sentence
      await expect.poll(async () => (await note(ends).textContent())!.replace(/[\u2066-\u2069]/g, '')).toMatch(reason)
      const before = await state(page, id)
      await reverse(ends).focus() // aria-disabled: Playwright will not click it, a user can still press it
      await page.keyboard.press('Enter')
      const after = await state(page, id)
      expect([after.source, after.target, after.past, after.rev]).toEqual([before.source, before.target, before.past, before.rev])
    }
  })

  test('a pick in the group that is not applied makes Reverse wait; Revert or Apply ends the wait', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_treat')
    await toggle(ends).click()
    await ends.locator('.ends__end').nth(1).getByRole('radio', { name: 'Top' }).check()
    await expect(reverse(ends)).toHaveAttribute('aria-disabled', 'true')
    await expect(note(ends)).toHaveText('Apply or revert the change you picked first, then reverse.')
    const before = await state(page, 'e_treat')
    await reverse(ends).focus()
    await page.keyboard.press('Enter')
    expect((await state(page, 'e_treat')).past, 'neither the pending pick nor the stored ends are reversed').toBe(before.past)
    await ends.getByRole('button', { name: 'Revert' }).click()
    await expect(reverse(ends)).not.toHaveAttribute('aria-disabled', 'true')
    // Apply, then Reverse reverses the applied ends
    await ends.locator('.ends__end').nth(1).getByRole('radio', { name: 'Top' }).check()
    await ends.getByRole('button', { name: 'Apply' }).click()
    await expect(reverse(ends)).not.toHaveAttribute('aria-disabled', 'true')
    await reverse(ends).click()
    await expect.poll(async () => (await state(page, 'e_treat')).data.ports).toEqual({ source: 'top', target: 'right' })
    await expect(toggle(ends)).toHaveAttribute('aria-expanded', 'true')
  })

  test('by keyboard: Tab from the summary to Reverse, Enter reverses and Space reverses back; focus stays on Reverse', async ({ page }) => {
    await open(page)
    const ends = await selectEdge(page, 'e_treat')
    await toggle(ends).focus()
    await page.keyboard.press('Tab')
    await expect(reverse(ends)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await state(page, 'e_treat')).source).toBe('treated')
    await expect(reverse(ends)).toBeFocused()
    await expect(toggle(ends)).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Space')
    await expect.poll(async () => (await state(page, 'e_treat')).source).toBe('triage')
    await expect(reverse(ends)).toBeFocused()
    expect('ports' in (await state(page, 'e_treat')).data, 'twice is the connection as it was').toBe(false)
  })

  test('under the edit lock Reverse is disabled and nothing changes', async ({ page }) => {
    await open(page)
    await page.evaluate(() => (window as unknown as { __loop: L }).__loop.ui.getState().setCanvasLocked(true))
    const ends = await selectEdge(page, 'e_treat')
    await expect(reverse(ends)).toBeDisabled()
    const before = await state(page, 'e_treat')
    await reverse(ends).click({ force: true })
    expect(await state(page, 'e_treat')).toEqual(before)
  })
})
