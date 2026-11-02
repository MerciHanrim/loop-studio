import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { pickLocale } from './support/workbenchMenus'

// issue #477 (Lumi's review of PR #480) — the Gate state LED is decorative: it
// takes no pointer events and is hidden from assistive tech, so the state has
// to be read somewhere else. It joins the node frame's accessible name (after
// `invalid`), so a keyboard user who focuses the Gate hears the state phrase and
// its reason, in the active language; and the Inspector's status line says the
// same for the selected Gate, with the numbers. This asserts what assistive
// tech actually receives (Playwright's accessible-name computation), not the
// DOM attribute alone.

type Bridge = { __loop: Record<string, { getState: () => any }> }

// T7 of gate-state-design.md §4a: a(3) →5 G →5 x — `partial (supply)`, 3 of 5;
// and b(0) →5 H →5 y — `idle`, a normal zero (D1)
const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'a', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'G', type: 'gate', position: { x: 240, y: 0 }, data: { kind: 'gate', label: 'G', activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } },
    { id: 'x', type: 'pool', position: { x: 480, y: 0 }, data: { kind: 'pool', label: 'x', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'b', type: 'pool', position: { x: 0, y: 200 }, data: { kind: 'pool', label: 'b', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'H', type: 'gate', position: { x: 240, y: 200 }, data: { kind: 'gate', label: 'H', activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } },
    { id: 'y', type: 'pool', position: { x: 480, y: 200 }, data: { kind: 'pool', label: 'y', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'aG', type: 'loop', source: 'a', target: 'G', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
    { id: 'Gx', type: 'loop', source: 'G', target: 'x', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
    { id: 'bH', type: 'loop', source: 'b', target: 'H', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
    { id: 'Hy', type: 'loop', source: 'H', target: 'y', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
  ],
})

const catalog = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeCatalog as Record<string, string>)
const advance = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
const gates = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().gates as { nodeId: string; state: string; why?: string }[])
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
const frame = (page: Page, id: string) => node(page, id).locator('[role="img"]')
const led = (page: Page, id: string) => node(page, id).locator('svg.nodef__led')
const inspectorLine = (page: Page) => page.locator('.inspector p[role="status"][data-gate-state]')

test.describe('#477 — a Gate\'s state reaches the keyboard and assistive tech', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
  })

  test('before a run: no LED, no state in the name, no Inspector line', async ({ page }) => {
    await expect(led(page, 'G')).toHaveCount(0)
    await expect(frame(page, 'G')).not.toHaveAccessibleName(/this step/)
    await node(page, 'G').click()
    await expect(inspectorLine(page)).toHaveCount(0)
  })

  test('after a step, focusing the Gate reads its state and reason; the LED itself is decorative', async ({ page }) => {
    await advance(page)
    expect((await gates(page)).map((g) => [g.nodeId, g.state, g.why])).toEqual([
      ['G', 'partial', 'supply'],
      ['H', 'idle', undefined],
    ])
    const en = await catalog(page)
    // the LED is in the DOM for both Gates, hidden from assistive tech, with no
    // name of its own (a `<title>` inside an aria-hidden SVG reaches nobody)
    await expect(led(page, 'G')).toHaveAttribute('data-gate-state', 'partial')
    await expect(led(page, 'G')).toHaveAttribute('aria-hidden', 'true')
    await expect(led(page, 'G').locator('title')).toHaveCount(0)
    await expect(led(page, 'H')).toHaveAttribute('data-gate-state', 'idle')
    // the keyboard: focus the Gate; the name assistive tech computes carries
    // the state phrase and the reason, after the kind and the label
    await node(page, 'G').focus()
    await expect(node(page, 'G')).toBeFocused()
    await expect(frame(page, 'G')).toHaveAccessibleName(new RegExp(`^Gate G, .*${escape(en['node.gate.state.partial'])} ${escape(en['node.gate.why.supply'])}, ${escape(en['node.aria.focused'])}$`))
    await node(page, 'H').focus()
    await expect(frame(page, 'H')).toHaveAccessibleName(new RegExp(`${escape(en['node.gate.state.idle'])}, ${escape(en['node.aria.focused'])}$`))
    await expect(frame(page, 'H')).not.toHaveAccessibleName(/held less/)
    // the Inspector's status line for the selected Gate: the same phrases and the numbers
    await node(page, 'G').click()
    await expect(inspectorLine(page)).toHaveAttribute('data-gate-state', 'partial')
    await expect(inspectorLine(page)).toHaveText(`${en['node.gate.state.partial']} ${en['node.gate.why.supply']} Moved 3 of 5; its inputs held 3.`)
  })

  test('the name follows the active language', async ({ page }) => {
    await advance(page)
    await pickLocale(page, 'ko')
    const ko = await catalog(page)
    expect(ko['node.gate.state.partial']).not.toBe('Passed on a part this step.')
    await node(page, 'G').focus()
    await expect(frame(page, 'G')).toHaveAccessibleName(new RegExp(`${escape(ko['node.gate.state.partial'])} ${escape(ko['node.gate.why.supply'])}`))
    await node(page, 'G').click()
    await expect(inspectorLine(page)).toContainText(ko['node.gate.state.partial'])
    await pickLocale(page, 'en')
  })
})

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
