import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// SEMANTICS-E.md §E17, §E9, §E16 (issue #572). An amount at or under 1e-9 moves and has no event:
// no line label, no token, and a Pool's own readout may not change a digit. So the app says it
// in two places: the run's list of messages counts the moves of the step that are not shown, and
// the panel of a Pool one of them reached lists them with the Pool's net change over the step.
// And a Gate that passed such an amount on has fired, and its state says so: never "nothing to
// pass on".
// Desktop under `chromium`; the phone's run bar, selection panel and sheet under `mobile`.

type Bridge = {
  __loop: {
    sim: {
      getState: () => {
        advance: () => unknown
        values: Record<string, number> | null
        firedNodeIds: string[]
        gates: { nodeId: string; state: string; why?: string; moved: number }[]
        smallMoves: { moves: { edgeId: string; from: string; to: string; shown: number }[]; netByPool: Record<string, { num: string; den: string }> }
      }
    }
    i18n: { getState: () => { activeCatalog: Record<string, string> } }
  }
}

const pool = (id: string, label: string, x: number, y: number, initial: number) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label, activation: 'passive', initial, capacity: null, mode: 'pullAny' } })
const drain = (id: string, label: string, x: number, y: number) => ({ id, type: 'drain', position: { x, y }, data: { kind: 'drain', label, activation: 'automatic', mode: 'pullAny' } })
const gate = (id: string, label: string, x: number, y: number) => ({ id, type: 'gate', position: { x, y }, data: { kind: 'gate', label, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } })
const line = (id: string, source: string, target: string, flow: string) => ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
const SMALL = '0.0000000005'

// Tank (10) ─5e-10→ Seep,  Tank ─2→ Use            one move not shown beside one that is
// Trickle (1) ─5e-10→ Valve ─1→ Cup                a Gate that passes on an amount not shown
// Dry (0) ─3→ Shut ─1→ Spare                       a Gate with nothing to pass on
const SMALL_MOVES = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    pool('tank', 'Tank', 0, 0, 10),
    drain('seep', 'Seep', 260, 0),
    drain('use', 'Use', 260, 150),
    pool('trickle', 'Trickle', 0, 320, 1),
    gate('valve', 'Valve', 260, 320),
    pool('cup', 'Cup', 520, 320, 0),
    pool('dry', 'Dry', 0, 480, 0),
    gate('shut', 'Shut', 260, 480),
    pool('spare', 'Spare', 520, 480, 0),
  ],
  edges: [line('seeps', 'tank', 'seep', SMALL), line('used', 'tank', 'use', '2'), line('drips', 'trickle', 'valve', SMALL), line('fills', 'valve', 'cup', '1'), line('none', 'dry', 'shut', '3'), line('spare', 'shut', 'spare', '1')],
})
// the same Tank with only the line that is shown
const ALL_SHOWN = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [pool('tank', 'Tank', 0, 0, 10), drain('use', 'Use', 260, 150)],
  edges: [line('used', 'tank', 'use', '2')],
})

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 500
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    return { values: s.values, fired: [...s.firedNodeIds].sort(), gates: s.gates.map((g) => [g.nodeId, g.state, g.moved]), notShown: s.smallMoves.moves.map((m) => m.edgeId), netOf: Object.keys(s.smallMoves.netByPool).sort() }
  })
const catalog = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeCatalog)
const advance = (page: Page) => page.evaluate(() => void (window as unknown as Bridge).__loop.sim.getState().advance())
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
/** the words of an element without the isolates around a name or an amount (U+2066 to U+2069) */
const plain = async (l: Locator) => [...((await l.textContent()) ?? '')].filter((c) => c.codePointAt(0)! < 0x2066 || c.codePointAt(0)! > 0x2069).join('')
const messages = (page: Page) => page.locator(isMobile(page) ? '.pstrip--mobile [data-testid="run-diagnostics"]' : '[data-testid="run-diagnostics"]')
const note = (page: Page) => page.locator('[data-small-moves]')
const filled = (text: string, args: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(args[k]))
/** a tap at a node's screen centre, through the phone's pan-capture overlay */
async function tapNode(page: Page, l: Locator) {
  const b = (await l.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

async function open(page: Page, graph: string) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, graph)
}

test.describe('a step that moves amounts too small to show says so', () => {
  test('the engine`s side of it: three moves of the step are not shown, the Pools they reached have a net change, and each node that moved one has fired', async ({ page }) => {
    await open(page, SMALL_MOVES)
    await advance(page)
    const s = await sim(page)
    expect(s.notShown).toEqual(['seeps', 'drips', 'fills'])
    expect(s.netOf).toEqual(['cup', 'tank', 'trickle'])
    expect(s.fired).toEqual(['seep', 'use', 'valve'])
    expect(s.values).toMatchObject({ tank: 7.9999999995, trickle: 0.9999999995, cup: 5e-10, dry: 0, spare: 0 })
  })

  test('desktop: the run`s messages count them; Reset and a step with every move shown take the line away', async ({ page }) => {
    test.skip(isMobile(page), 'the desktop run strip')
    await open(page, SMALL_MOVES)
    await expect(messages(page)).toHaveCount(0)
    await advance(page)
    const en = await catalog(page)
    await expect(messages(page)).toBeVisible()
    await expect(messages(page).locator('.pstrip__diag-list li')).toHaveCount(1)
    expect(await plain(messages(page).locator('.pstrip__diag-list li'))).toBe(filled(en['playbar.diag.movesNotShown'], { n: 3 }))
    // the line labels and the readout are as they were: nothing of the small moves is on the canvas
    await expect(page.locator('.edge-label[data-edge-id="seeps"]')).not.toContainText('e-')
    await page.locator('.pstrip__reset').click()
    await expect(messages(page)).toHaveCount(0)

    await open(page, ALL_SHOWN)
    await advance(page)
    expect((await sim(page)).notShown).toEqual([])
    await expect(messages(page)).toHaveCount(0)
  })

  test('desktop: the panel of a Pool they reached lists them and its net change; a Pool they did not reach has no note', async ({ page }) => {
    test.skip(isMobile(page), 'the desktop Inspector')
    await open(page, SMALL_MOVES)
    await advance(page)
    const en = await catalog(page)

    await node(page, 'tank').click()
    await expect(note(page)).toBeVisible()
    await expect(note(page)).toHaveAttribute('role', 'status')
    const lines = note(page).locator('p')
    await expect(lines).toHaveCount(3)
    expect(await plain(lines.nth(0))).toBe(en['inspector.pool.smallMoves.title'])
    // the move that is not shown, with the node at its other end; the one that is shown (2, to Use) is on the canvas, not here
    await expect(note(page).locator('[data-small-move]')).toHaveCount(1)
    expect(await plain(note(page).locator('[data-small-move="seeps"]'))).toBe(filled(en['inspector.pool.smallMoves.out'], { label: 'Seep', amount: '≈ 0.0000000005' }))
    // the net change is over ALL the step's moves: the 2 and the small one
    expect(await plain(note(page).locator('[data-small-moves-net]'))).toBe(filled(en['inspector.pool.smallMoves.net'], { amount: '≈ −2.0000000005' }))
    // the Pool's own readout rounds to two decimals: 8.00 for 7.9999999995, which is what the note is for
    await expect(page.locator('.inspector .field__readout')).toHaveValue('8.00')

    await node(page, 'cup').click()
    expect(await plain(note(page).locator('[data-small-move="fills"]'))).toBe(filled(en['inspector.pool.smallMoves.in'], { label: 'Valve', amount: '0.0000000005' }))
    expect(await plain(note(page).locator('[data-small-moves-net]'))).toBe(filled(en['inspector.pool.smallMoves.net'], { amount: '+0.0000000005' }))

    await node(page, 'spare').click()
    await expect(page.locator('.inspector .field__readout')).toBeVisible()
    await expect(note(page)).toHaveCount(0)

    await node(page, 'tank').click()
    await expect(note(page)).toBeVisible()
    await page.locator('.pstrip__reset').click()
    await expect(note(page)).toHaveCount(0)
  })

  test('desktop: a Gate that passed on an amount that is not shown has fired and reads so; one with nothing to pass on reads idle', async ({ page }) => {
    test.skip(isMobile(page), 'the desktop canvas and Inspector')
    await open(page, SMALL_MOVES)
    await advance(page)
    const en = await catalog(page)
    const s = await sim(page)
    expect(s.fired).toContain('valve')
    expect(s.fired).not.toContain('shut')
    expect(s.gates).toEqual([
      ['shut', 'idle', 0],
      ['valve', 'full', 5e-10],
    ])
    await expect(node(page, 'valve').locator('svg.nodef__led')).toHaveAttribute('data-gate-state', 'full')
    await expect(node(page, 'shut').locator('svg.nodef__led')).toHaveAttribute('data-gate-state', 'idle')
    await node(page, 'valve').click()
    const state = page.locator('.inspector p[role="status"][data-gate-state]')
    await expect(state).toHaveAttribute('data-gate-state', 'full')
    await expect(state).toContainText(en['node.gate.state.full'])
    await expect(state).not.toContainText(en['node.gate.state.idle'])
    await node(page, 'shut').click()
    await expect(state).toHaveAttribute('data-gate-state', 'idle')
  })

  test('phone: the run bar counts them, and the Pool`s details list them and its net change', async ({ page }) => {
    test.skip(!isMobile(page), 'the phone run bar, selection panel and sheet')
    await open(page, SMALL_MOVES)
    await page.locator('.pstrip--mobile .pstrip__step-btn').click()
    const en = await catalog(page)
    await expect(messages(page)).toBeVisible()
    expect(await plain(messages(page).locator('.pstrip__diag-list li'))).toBe(filled(en['playbar.diag.movesNotShown'], { n: 3 }))

    await tapNode(page, node(page, 'tank'))
    await expect(page.locator('.selpanel')).toBeVisible()
    await page.locator('.selpanel__details').click()
    const sheet = page.locator('.sheet--inspector')
    await expect(sheet).toBeVisible()
    const inSheet = sheet.locator('[data-small-moves]')
    await expect(inSheet).toBeVisible()
    expect(await plain(inSheet.locator('[data-small-move="seeps"]'))).toBe(filled(en['inspector.pool.smallMoves.out'], { label: 'Seep', amount: '≈ 0.0000000005' }))
    expect(await plain(inSheet.locator('[data-small-moves-net]'))).toBe(filled(en['inspector.pool.smallMoves.net'], { amount: '≈ −2.0000000005' }))
    // the note is inside the sheet and inside the screen
    const box = (await inSheet.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })

  test('phone: a Gate that passed on an amount that is not shown reads so in its details', async ({ page }) => {
    test.skip(!isMobile(page), 'the phone selection panel and sheet')
    await open(page, SMALL_MOVES)
    await page.locator('.pstrip--mobile .pstrip__step-btn').click()
    const en = await catalog(page)
    // (the step commits when its animation ends: the state is asked for until it is there)
    await expect
      .poll(async () => (await sim(page)).gates)
      .toEqual([
        ['shut', 'idle', 0],
        ['valve', 'full', 5e-10],
      ])
    await tapNode(page, node(page, 'valve'))
    await page.locator('.selpanel__details').click()
    const state = page.locator('.sheet--inspector p[role="status"][data-gate-state]')
    await expect(state).toHaveAttribute('data-gate-state', 'full')
    await expect(state).toContainText(en['node.gate.state.full'])
  })
})
