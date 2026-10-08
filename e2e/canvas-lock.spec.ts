import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// The Canvas EDIT lock (uiStore.canvasLocked, seeded from
// `recommendedRunConfig.canvasLocked`). Locked ⇒ nodes don't move / connect,
// nothing deletes, the Inspector is read-only — but selection, the read-only
// Inspector, pan / zoom, the minimap, the Timeline and the sim all still work.
// UI-only: never the GraphDoc / loop-revision digest / undo / simulationRev.

type Bridge = {
  __loop: Record<string, { getState: () => any } & Record<string, unknown>> & {
    rf: { getViewport: () => { x: number; y: number; zoom: number } }
  }
}

/** Source ─1→ P1 ─1→ Drain. */
async function seed(page: Page, canvasLocked?: boolean) {
  await page.evaluate((locked) => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    g.newGraph()
    g.loadDoc({
      nodes: [
        { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
        { id: 'p1', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        { id: 'snk', type: 'drain', position: { x: 440, y: 0 }, data: { kind: 'drain', label: 'Snk', activation: 'automatic', mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e1', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
        { id: 'e2', source: 'p1', target: 'snk', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      ],
    }, { mode: 'document-boundary', canvasLocked: locked === true })
    l.mc.getState().applyRecommended(locked === undefined ? {} : { canvasLocked: locked })
  }, canvasLocked)
}

const locked = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().canvasLocked)

const graphDigest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })
const canUndo = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)
const nodePos = (page: Page, id: string) =>
  page.evaluate(
    (nid) => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.id === nid).position,
    id,
  )

const lockBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-lock')

test.describe('Canvas edit-lock', () => {
  test('the Controls lock toggle flips uiStore.canvasLocked and replaces the "interactive" button', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    expect(await locked(page)).toBe(false)
    // React Flow's own "interactive" toggle is gone
    await expect(page.locator('.react-flow__controls-interactive')).toHaveCount(0)

    const btn = lockBtn(page)
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect(btn.locator('svg[data-icon="unlock"]')).toHaveCount(1)
    await btn.click()
    expect(await locked(page)).toBe(true)
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(btn.locator('svg[data-icon="lock"]')).toHaveCount(1)
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
    await btn.click()
    expect(await locked(page)).toBe(false)
  })

  test('a file with recommendedRunConfig.canvasLocked opens locked; absent ⇒ unlocked', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)
    expect(await locked(page)).toBe(true)
    await seed(page) // no field
    expect(await locked(page)).toBe(false)
  })

  test('locked: a node can still be selected and the Inspector opens READ-ONLY', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)

    await page.locator('.react-flow__node[data-id="p1"]').click()
    // selection reached the store → the read-only Inspector shows the node
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId))
      .toBe('p1')
    const aside = page.locator('aside.inspector')
    await expect(aside).toBeVisible()
    const labelInput = aside.locator('input').first()
    await expect(labelInput).toBeVisible()
    await expect(labelInput).toBeDisabled() // <fieldset disabled> — :disabled matches
    await expect(labelInput).toHaveValue('P1') // the value is still shown
    // the Delete button is inert too
    for (const b of await aside.getByRole('button').all()) await expect(b).toBeDisabled()
  })

  test('locked: nodes do not move, connect, or delete; the graph is untouched', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    const digest0 = await graphDigest(page)
    const undo0 = await canUndo(page)
    const pos0 = await nodePos(page, 'p1')

    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)

    // no `.draggable` class ⇒ React Flow won't start a drag
    await expect(page.locator('.react-flow__node[data-id="p1"]')).not.toHaveClass(/draggable/)
    // try to drag it anyway
    const box = await page.locator('.react-flow__node[data-id="p1"]').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + 120, box!.y + 80, { steps: 8 })
    await page.mouse.up()
    // select + Delete
    await page.locator('.react-flow__node[data-id="p1"]').click()
    await page.keyboard.press('Delete')
    await page.keyboard.press('Backspace')

    expect(await nodePos(page, 'p1')).toEqual(pos0)
    expect(
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length),
    ).toBe(3)
    expect(await graphDigest(page)).toBe(digest0) // locking + the failed edits changed nothing
    expect(await canUndo(page)).toBe(undo0)
  })

  test('locked: pan / zoom / the Timeline still work', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)

    // zoom via the Controls (+) button
    const vp0 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    await page.locator('.react-flow__controls-button.react-flow__controls-zoomin').click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom))
      .toBeGreaterThan(vp0.zoom)

    // step the sim (the pure commit path — no animation clock in a bare evaluate)
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      s.reset()
      s.advance()
    })
    expect(
      await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex),
    ).toBeGreaterThan(0)
  })

  test('canvasLocked round-trips: Graph export → import, and Share encode → decode', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    await lockBtn(page).click()

    const rt = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop
      const { recommendedRunConfigForExport } = await import('/src/store/mcStore.ts')
      const shareM = await import('/src/model/share.ts')
      const serM = await import('/src/model/serialize.ts')
      const g = () => l.graph.getState()

      const text = g().exportJSON(recommendedRunConfigForExport())
      const graphDoc = JSON.parse(text)

      // Graph import
      g().newGraph()
      l.ui.getState().setCanvasLocked(false)
      l.mc.getState().applyRecommended(g().loadJSON(text))
      const afterImport = l.ui.getState().canvasLocked

      // Share encode → decode → apply
      const { payload } = await shareM.encodeShareText(text)
      const round = serM.deserialize(await shareM.decodeShareText(payload))
      g().newGraph()
      l.ui.getState().setCanvasLocked(false)
      g().loadDoc({ nodes: round.nodes, edges: round.edges }, { mode: 'document-boundary', canvasLocked: round.recommendedRunConfig?.canvasLocked === true })
      l.mc.getState().applyRecommended(round.recommendedRunConfig)
      const afterShare = l.ui.getState().canvasLocked

      return { graphDocLocked: graphDoc.recommendedRunConfig.canvasLocked, afterImport, afterShare }
    })

    expect(rt.graphDocLocked).toBe(true)
    expect(rt.afterImport).toBe(true)
    expect(rt.afterShare).toBe(true)
  })

  // A plain refresh or a PWA update-and-reload must never silently drop the
  // edit-safety lock — the whole point of "locked" is to guard against an
  // accidental edit, and a reload the user didn't explicitly ask to make is
  // exactly the kind of moment that guard needs to survive.
  test('canvasLocked survives a plain reload, in both directions', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)
    expect(await locked(page)).toBe(true)

    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    expect(await locked(page)).toBe(true)

    // unlock, reload again — the unlocked state must ALSO survive
    await lockBtn(page).click()
    expect(await locked(page)).toBe(false)
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    expect(await locked(page)).toBe(false)
  })

  // Issue #334 — while locked, every user edit is refused, through the real
  // controls: they are disabled, and pressing them anyway changes nothing.
  test('locked: the palette, Undo / Redo, Insert module and the data import wizard are disabled and change nothing', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    await page.getByRole('button', { name: 'Pool', exact: true }).click() // an edit, so Undo has something
    await expect(page.locator('.react-flow__node')).toHaveCount(4)
    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)
    const digest0 = await graphDigest(page)
    const pos0 = await nodePos(page, 'p1')

    const pool = page.getByRole('button', { name: 'Pool', exact: true })
    await expect(pool).toBeDisabled()
    await expect(pool).toHaveAttribute('draggable', 'false')
    await pool.click({ force: true })

    const undo = page.locator('.toolbar button[title^="Undo"]')
    await expect(undo).toBeDisabled()
    await expect(page.locator('.toolbar button[title^="Redo"]')).toBeDisabled()
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')

    // the arrow keys on a selected node
    await page.locator('.react-flow__node[data-id="p1"]').click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')

    await page.getByRole('button', { name: 'Insert module', exact: true }).click()
    const items = page.locator('.menu__pop[role="menu"] [role="menuitem"]')
    const n = await items.count()
    for (let i = 0; i < n - 1; i++) await expect(items.nth(i)).toBeDisabled() // every bundled module + From file
    await expect(items.nth(n - 1)).toBeEnabled() // saving the selection as a module is an export
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Data', exact: true }).click()
    const data = page.locator('.menu__pop[role="menu"] [role="menuitem"]')
    await expect(data.nth(0)).toBeDisabled() // Import
    await expect(data.nth(1)).toBeEnabled() // Manage bindings (its refresh / rename are disabled inside)
    await expect(data.nth(2)).toBeDisabled() // the in-app guide opens the same wizard
    await page.keyboard.press('Escape')

    expect(await graphDigest(page)).toBe(digest0)
    expect(await nodePos(page, 'p1')).toEqual(pos0)
    await expect(page.locator('.react-flow__node')).toHaveCount(4)

    // unlocking lifts it: the palette adds again
    await lockBtn(page).click()
    await expect(pool).toBeEnabled()
    await pool.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
  })

  test('locked: the turned-off controls are really disabled, and the keyboard neither reaches nor runs them', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    await page.getByRole('button', { name: 'Pool', exact: true }).click() // so Undo would have something
    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)
    const digest0 = await graphDigest(page)
    const count0 = await page.locator('.react-flow__node').count()

    // the native `disabled` state, which is also what the accessibility tree reports
    const palette = page.locator('.toolbar__palette button.chip')
    const n = await palette.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      await expect(palette.nth(i)).toBeDisabled()
      expect(await palette.nth(i).evaluate((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    }
    for (const title of ['Undo', 'Redo']) {
      const b = page.locator(`.toolbar button[title^="${title}"]`)
      await expect(b).toBeDisabled()
      expect(await b.evaluate((x) => (x as HTMLButtonElement).disabled)).toBe(true)
    }

    // Tab walks the whole page from the top and never lands on one of them
    const landed = await page.evaluate(() => {
      const off = new Set<Element>([
        ...document.querySelectorAll('.toolbar__palette button.chip'),
        ...document.querySelectorAll('.toolbar button[title^="Undo"], .toolbar button[title^="Redo"]'),
      ])
      return { off: off.size }
    })
    expect(landed.off).toBe(n + 2)
    await page.locator('body').focus()
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab')
      const hit = await page.evaluate(() => {
        const a = document.activeElement
        return !!a && (a.matches('.toolbar__palette button.chip') || a.matches('.toolbar button[title^="Undo"], .toolbar button[title^="Redo"]'))
      })
      expect(hit, `Tab #${i + 1} reached a disabled control`).toBe(false)
    }

    // the menus' keyboard skips the disabled rows: from the Insert module
    // trigger, Arrow keys + Enter land only on the enabled row (Save selection
    // as a module, an export) and never insert anything
    const insert = page.getByRole('button', { name: 'Insert module', exact: true })
    await insert.focus()
    await page.keyboard.press('Enter')
    const rows = page.locator('.menu__pop[role="menu"] [role="menuitem"]')
    await expect(rows.first()).toBeVisible()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowDown')
      const onDisabled = await page.evaluate(() => (document.activeElement as HTMLButtonElement | null)?.disabled === true)
      expect(onDisabled).toBe(false)
    }
    await page.keyboard.press('Escape')

    // and a keyboard press on a disabled palette chip does nothing
    await palette.first().evaluate((b) => (b as HTMLButtonElement).focus())
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')

    expect(await graphDigest(page)).toBe(digest0)
    await expect(page.locator('.react-flow__node')).toHaveCount(count0)
  })

  test('locked: selecting, zooming, Focus, Step and export still work, and leave the document as it was', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)
    const digest0 = await graphDigest(page)

    await page.locator('.react-flow__node[data-id="p1"]').click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId))
      .toBe('p1')
    const zoom0 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)
    await page.locator('.react-flow__controls-button.react-flow__controls-zoomin').click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom))
      .toBeGreaterThan(zoom0)
    const focus = page.locator('.react-flow__controls-button.rf-focus')
    await focus.click()
    await expect(focus).toHaveAttribute('aria-pressed', 'true')
    await focus.click()

    await page.getByRole('button', { name: 'Advance one step' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex))
      .toBeGreaterThan(0)

    await page.getByRole('button', { name: 'File', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.locator('[role="menuitem"]').filter({ hasText: 'Graph JSON' }).first().click()
    const file = JSON.parse(await (await (await download).createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8')))
    expect(file.recommendedRunConfig.canvasLocked).toBe(true)

    expect(await graphDigest(page)).toBe(digest0)
    expect(await locked(page)).toBe(true)
  })

  test('a fresh document load always re-seeds canvasLocked, even over a persisted reload', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, true)
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    expect(await locked(page)).toBe(true) // restored from the reload, per above

    // loading a document with NO canvasLocked field must unlock — an explicit
    // document/Template load always wins over whatever was persisted from a
    // previous session; persistence is only a fallback for a plain reload of
    // the SAME session, never a sticky override of a fresh load.
    await seed(page) // no field ⇒ applyRecommended({})
    expect(await locked(page)).toBe(false)

    // and the other direction: an unlocked persisted state doesn't prevent a
    // freshly-opened locked document from locking.
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    expect(await locked(page)).toBe(false)
    await seed(page, true)
    expect(await locked(page)).toBe(true)
  })
})
