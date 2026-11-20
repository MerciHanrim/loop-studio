import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { pickLocale } from './support/workbenchMenus'

// issue #477 (Lumi's reviews 1 and 2 of PR #480) — the Gate state LED is
// decorative: it takes no pointer events and is hidden from assistive tech, so
// the state has to be read somewhere else. It joins the node frame's accessible
// name (after `invalid`), and React Flow's focusable node wrapper — the element
// Tab actually reaches, a `role="group"` with no name of its own — is labelled
// by that frame. So a keyboard user who Tabs to the Gate hears the state phrase
// and its reason, in the active language; and the Inspector's status line says
// the same for the selected Gate, with the numbers. The focus is reached with
// REAL key presses and the name is read from the FOCUSED element, as assistive
// tech computes it (Playwright's accessible-name computation), not from a DOM
// attribute on an inner element.

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
const led = (page: Page, id: string) => node(page, id).locator('svg.nodef__led')
const inspectorLine = (page: Page) => page.locator('.inspector p[role="status"][data-gate-state]')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** the id of the node that holds keyboard focus (the React Flow wrapper, or an element inside it) */
const focusedNodeId = (page: Page) => page.evaluate(() => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null)

/** keyboard entry: an empty click puts the pane in focus; Tab walks the nodes
 *  in their order until `id` holds the focus. The pointer is parked away from
 *  every node so no hover state joins the name. */
async function tabTo(page: Page, id: string) {
  await page.mouse.move(5, 5)
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  for (let i = 0; i < 40 && (await focusedNodeId(page)) !== id; i++) await page.keyboard.press('Tab')
  expect(await focusedNodeId(page), `Tab reaches ${id}`).toBe(id)
  // the focused element IS the node wrapper — the name below is the one it exposes
  expect(await page.evaluate(() => document.activeElement?.classList.contains('react-flow__node'))).toBe(true)
  await expect(node(page, id)).toBeFocused()
}

test.describe('#477 — a Gate\'s state reaches the keyboard and assistive tech', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
  })

  test('before a run: no LED, no state in the focused name, no Inspector line', async ({ page }) => {
    await expect(led(page, 'G')).toHaveCount(0)
    await tabTo(page, 'G')
    await expect(node(page, 'G')).toHaveAccessibleName(/^Gate G, /)
    await expect(node(page, 'G')).not.toHaveAccessibleName(/this step/)
    await node(page, 'G').click()
    await expect(inspectorLine(page)).toHaveCount(0)
  })

  test('after a step, Tab to the Gate: the focused element\'s name carries its state and reason; the LED itself is decorative', async ({ page }) => {
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
    // real key presses reach the Gate; the FOCUSED element's accessible name
    // ends in the state phrase, the reason and "focused", after the kind and label
    await tabTo(page, 'G')
    await expect(node(page, 'G')).toHaveAccessibleName(
      new RegExp(`^Gate G, .*${escape(en['node.gate.state.partial'])} ${escape(en['node.gate.why.supply'])}, ${escape(en['node.aria.focused'])}$`),
    )
    // Tab on to the idle Gate: its name carries the idle phrase and no reason
    await tabTo(page, 'H')
    await expect(node(page, 'H')).toHaveAccessibleName(new RegExp(`^Gate H, .*${escape(en['node.gate.state.idle'])}, ${escape(en['node.aria.focused'])}$`))
    await expect(node(page, 'H')).not.toHaveAccessibleName(/held less/)
    // leaving the Gate drops the focus word; the state stays in its name
    await tabTo(page, 'y')
    await expect(node(page, 'G')).toHaveAccessibleName(new RegExp(`${escape(en['node.gate.why.supply'])}$`))
    // the Inspector's status line for the selected Gate: the same phrases and the numbers
    await node(page, 'G').click()
    await expect(inspectorLine(page)).toHaveAttribute('data-gate-state', 'partial')
    await expect(inspectorLine(page)).toHaveText(`${en['node.gate.state.partial']} ${en['node.gate.why.supply']} Moved 3 of 5; its inputs held 3.`)
  })

  test('the focused name follows the active language', async ({ page }) => {
    await advance(page)
    await pickLocale(page, 'ko')
    const ko = await catalog(page)
    expect(ko['node.gate.state.partial']).not.toBe('Passed on a part this step.')
    await tabTo(page, 'G')
    await expect(node(page, 'G')).toHaveAccessibleName(new RegExp(`${escape(ko['node.gate.state.partial'])} ${escape(ko['node.gate.why.supply'])}, ${escape(ko['node.aria.focused'])}$`))
    await node(page, 'G').click()
    await expect(inspectorLine(page)).toContainText(ko['node.gate.state.partial'])
    await pickLocale(page, 'en')
  })
})

// Issue #593 (Lumi's review of PR #595) — `upstream` reads differently by state. A `pull all` Gate g0 is
// 0.5 short of its own lines (A holds 4.5 of 5), so the plan sets its piece to 0; it hands one part to g1,
// which has no line of its own, and one part to g2, which also takes 4 of its own from D. g2 moves, so
// g1 is held with nothing arrived from what feeds it (`held` / `upstream`, a phrase of its own), and g2
// passes on a part with its own lines whole (`partial` / `upstream`, "supplied in part"). Both phrases
// are read where a person reads them: the focused node's accessible name and the Inspector's line, in
// English and in Korean.
const pos = (x: number, y: number) => ({ x, y })
const M12 = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    // (within the 480 by 200 the fixture above uses, so every node is in view at the default zoom)
    { id: 'A', type: 'pool', position: pos(0, 0), data: { kind: 'pool', label: 'A', activation: 'passive', initial: 4.5, capacity: null, mode: 'pullAny' } },
    { id: 'B', type: 'pool', position: pos(0, 200), data: { kind: 'pool', label: 'B', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } },
    { id: 'g0', type: 'gate', position: pos(120, 100), data: { kind: 'gate', label: 'g0', activation: 'automatic', distribution: 'deterministic', mode: 'pullAll' } },
    { id: 'g1', type: 'gate', position: pos(240, 0), data: { kind: 'gate', label: 'g1', activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } },
    { id: 'Q', type: 'pool', position: pos(360, 0), data: { kind: 'pool', label: 'Q', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'D', type: 'pool', position: pos(120, 200), data: { kind: 'pool', label: 'D', activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' } },
    { id: 'g2', type: 'gate', position: pos(240, 200), data: { kind: 'gate', label: 'g2', activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } },
    { id: 'R', type: 'pool', position: pos(360, 200), data: { kind: 'pool', label: 'R', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'a', type: 'loop', source: 'A', target: 'g0', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
    { id: 'b', type: 'loop', source: 'B', target: 'g0', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '5' } },
    { id: 'h1', type: 'loop', source: 'g0', target: 'g1', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'h2', type: 'loop', source: 'g0', target: 'g2', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'd', type: 'loop', source: 'D', target: 'g2', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '4' } },
    { id: 'q', type: 'loop', source: 'g1', target: 'Q', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'r', type: 'loop', source: 'g2', target: 'R', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

test.describe('#593 — `upstream` on a held Gate and on a part, on screen', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, M12)
    await advance(page)
    expect((await gates(page)).map((g) => [g.nodeId, g.state, g.why])).toEqual([
      ['g0', 'held', 'pullAll'],
      ['g1', 'held', 'upstream'],
      ['g2', 'partial', 'upstream'],
    ])
  })

  for (const locale of ['en', 'ko'] as const) {
    test(`${locale}: the held Gate says nothing arrived, the Gate that passed a part says it was supplied in part`, async ({ page }) => {
      if (locale !== 'en') await pickLocale(page, locale)
      const c = await catalog(page)
      const held = `${c['node.gate.state.held']} ${c['node.gate.why.upstreamHeld']}`
      const part = `${c['node.gate.state.partial']} ${c['node.gate.why.upstream']}`
      expect(c['node.gate.why.upstreamHeld']).not.toBe(c['node.gate.why.upstream'])
      // the focused node's accessible name: the state, then the reason, then "focused"
      await tabTo(page, 'g1')
      await expect(node(page, 'g1')).toHaveAccessibleName(new RegExp(`^${escape(c['canvas.nodeKind.gate'])} g1, .*${escape(held)}, ${escape(c['node.aria.focused'])}$`))
      await expect(node(page, 'g1')).not.toHaveAccessibleName(new RegExp(escape(c['node.gate.why.upstream'])))
      await tabTo(page, 'g2')
      await expect(node(page, 'g2')).toHaveAccessibleName(new RegExp(`^${escape(c['canvas.nodeKind.gate'])} g2, .*${escape(part)}, ${escape(c['node.aria.focused'])}$`))
      await expect(node(page, 'g2')).not.toHaveAccessibleName(new RegExp(escape(c['node.gate.why.upstreamHeld'])))
      // the Inspector's line for each, with its numbers after the phrases
      await node(page, 'g1').click()
      await expect(inspectorLine(page)).toHaveAttribute('data-gate-state', 'held')
      await expect(inspectorLine(page)).toHaveText(new RegExp(`^${escape(held)} `))
      await node(page, 'g2').click()
      await expect(inspectorLine(page)).toHaveAttribute('data-gate-state', 'partial')
      await expect(inspectorLine(page)).toHaveText(new RegExp(`^${escape(part)} `))
      if (locale !== 'en') await pickLocale(page, 'en')
    })
  }
})
