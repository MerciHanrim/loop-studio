import type { CDPSession, Locator, Page } from '@playwright/test'
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
    i18n: { getState: () => { activeCatalog: Record<string, string>; setLocale: (code: string) => unknown } }
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

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

/** What Chromium's accessibility tree holds for an element: its role, its name, whether it is a
 *  live region, and under it every role that is not plain text with the texts it holds, in order. */
async function axOf(cdp: CDPSession, selector: string) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
  if (!nodeId) return null
  const { node } = await cdp.send('DOM.describeNode', { nodeId })
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const root = nodes.find((x) => x.backendDOMNodeId === node.backendNodeId)
  if (!root || root.ignored) return null
  const byId = new Map(nodes.map((x) => [x.nodeId, x]))
  const roles: string[] = []
  const texts: string[] = []
  const walk = (id: string) => {
    const n = byId.get(id)
    if (!n) return
    const role = n.role?.value ?? ''
    if (role === 'StaticText') texts.push(String(n.name?.value ?? ''))
    else if (!n.ignored && role !== 'InlineTextBox' && role !== 'ListMarker' && n !== root) roles.push(role)
    if (role !== 'StaticText') for (const c of n.childIds ?? []) walk(c)
  }
  walk(root.nodeId)
  const live = root.properties?.find((p) => p.name === 'live')?.value.value
  return { role: String(root.role?.value ?? ''), name: String(root.name?.value ?? ''), live: live === undefined ? null : String(live), roles, texts }
}

/** where each visible character of an element stands on the screen: the characters of its first
 *  line from left to right, and whether any of them is outside the element's own box */
const onScreen = (l: Locator) =>
  l.evaluate((el) => {
    const out: { c: string; x: number; y: number }[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? ''
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        const b = r.getBoundingClientRect()
        if (b.width > 0) out.push({ c: text[i], x: b.x, y: Math.round(b.y) }) // (an isolate has no width)
      }
    }
    const top = Math.min(...out.map((o) => o.y))
    return {
      firstLine: out.filter((o) => o.y === top).sort((a, b) => a.x - b.x).map((o) => o.c).join(''),
      overflows: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth,
    }
  })

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

  // What a screen reader is given, read off Chromium's accessibility tree (no speech is checked
  // here), in English and in Arabic: the count is an item of the run's list of messages, and the
  // status region beside it, which is there before the step and empty, takes the same words, so
  // the change is one that is announced; the Pool's note is a status region of three paragraphs.
  for (const code of ['en', 'ar']) {
    test(`desktop, ${code}: the accessibility tree holds the count as a message that is announced, and the Pool's note as a status of three paragraphs`, async ({ page }) => {
      test.skip(isMobile(page), 'the desktop run strip and Inspector')
      await open(page, SMALL_MOVES)
      await setLocale(page, code)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Accessibility.enable')
      const announced = page.locator('.pstrip-diag__status')
      await expect(announced).toHaveCount(1)
      await expect(announced).toHaveText('')
      expect(await axOf(cdp, '.pstrip-diag__status')).toMatchObject({ role: 'status', live: 'polite', texts: [] })

      await advance(page)
      const words = await catalog(page)
      const counted = filled(words['playbar.diag.movesNotShown'], { n: 3 })
      await expect(messages(page)).toBeVisible()
      const title = (await messages(page).locator('.pstrip__diag-title').textContent()) ?? ''
      expect(title).toContain('1')
      expect(await axOf(cdp, '[data-testid="run-diagnostics"]')).toEqual({ role: 'region', name: title, live: null, roles: ['list', 'listitem'], texts: [title, counted] })
      await expect(announced).toHaveText(`${title}: ${counted}`)
      expect(await axOf(cdp, '.pstrip-diag__status')).toMatchObject({ role: 'status', live: 'polite', texts: [`${title}: ${counted}`] })

      await node(page, 'tank').click()
      await expect(note(page)).toBeVisible()
      const ax = await axOf(cdp, '[data-small-moves]')
      expect(ax).toMatchObject({ role: 'status', live: 'polite', roles: ['paragraph', 'paragraph', 'paragraph'] })
      // the amounts are plain digits, each inside a left-to-right isolate; the name inside a first-strong one
      expect(ax!.texts).toEqual([
        words['inspector.pool.smallMoves.title'],
        filled(words['inspector.pool.smallMoves.out'], { label: '⁨Seep⁩', amount: '⁦≈ 0.0000000005⁩' }),
        filled(words['inspector.pool.smallMoves.net'], { amount: '⁦≈ −2.0000000005⁩' }),
      ])
    })
  }

  test('desktop, Arabic: the words read right to left and each amount stays whole and left to right, at the left of its line; nothing overflows', async ({ page }) => {
    test.skip(isMobile(page), 'the desktop run strip and Inspector')
    await open(page, SMALL_MOVES)
    await setLocale(page, 'ar')
    await advance(page)
    const ar = await catalog(page)
    await expect(page.locator('html')).toHaveAttribute('data-text-dir', 'rtl')
    await expect(messages(page)).toBeVisible()
    const item = messages(page).locator('.pstrip__diag-list li')
    expect(await plain(item)).toBe(filled(ar['playbar.diag.movesNotShown'], { n: 3 }))
    const counted = await onScreen(item)
    // an Arabic sentence: its first word is at the right end, its full stop at the left
    expect(counted.firstLine.startsWith('.')).toBe(true)
    expect(counted.firstLine).toContain(' .3 :') // "…: 3. …" as it stands on the screen, the number in its place
    expect(counted.overflows).toBe(false)

    await node(page, 'tank').click()
    await expect(note(page)).toBeVisible()
    const out = await onScreen(note(page).locator('[data-small-move="seeps"]'))
    const net = await onScreen(note(page).locator('[data-small-moves-net]'))
    // the amount is not turned round by the Arabic around it, and neither is its sign
    expect(out.firstLine.startsWith('≈ 0.0000000005 :Seep ')).toBe(true)
    expect(net.firstLine.startsWith('≈ −2.0000000005 :')).toBe(true)
    expect(out.overflows || net.overflows).toBe(false)
    expect(await note(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await node(page, 'cup').click()
    expect((await onScreen(note(page).locator('[data-small-moves-net]'))).firstLine.startsWith('+0.0000000005 :')).toBe(true)
    await node(page, 'valve').click()
    const state = page.locator('.inspector p[role="status"][data-gate-state]')
    await expect(state).toHaveAttribute('data-gate-state', 'full')
    await expect(state).toContainText('0.0000000005')
    expect(await state.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })

  test('phone, Arabic: the run bar`s line and the Pool`s note in the sheet stay inside the screen, each amount whole', async ({ page }) => {
    test.skip(!isMobile(page), 'the phone run bar and sheet')
    await open(page, SMALL_MOVES)
    await setLocale(page, 'ar')
    await page.locator('.pstrip--mobile .pstrip__step-btn').click()
    const ar = await catalog(page)
    await expect(messages(page)).toBeVisible()
    expect(await plain(messages(page).locator('.pstrip__diag-list li'))).toBe(filled(ar['playbar.diag.movesNotShown'], { n: 3 }))
    const bar = (await messages(page).boundingBox())!
    expect(bar.x).toBeGreaterThanOrEqual(0)
    expect(bar.x + bar.width).toBeLessThanOrEqual(390)
    expect(await messages(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

    await tapNode(page, node(page, 'tank'))
    await page.locator('.selpanel__details').click()
    const inSheet = page.locator('.sheet--inspector [data-small-moves]')
    await expect(inSheet).toBeVisible()
    expect((await onScreen(inSheet.locator('[data-small-moves-net]'))).firstLine.startsWith('≈ −2.0000000005 :')).toBe(true)
    const box = (await inSheet.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await inSheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
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
