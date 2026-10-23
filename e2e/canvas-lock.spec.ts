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

// the workbench (docs/workbench.md §WB3, §WB8): the desktop canvas has no
// Controls rail. The lock is the tool row's last button, the frame tool is one
// of its canvas tools, zoom and Focus are in the status bar, and Clear all
// frames is in the Edit menu.
const lockBtn = (page: Page) => page.locator('.wb-toolrow [data-tool="lock"]')
const zoomIn = (page: Page) => page.locator('.wb-status').getByRole('button', { name: 'Zoom in', exact: true })
const focusBtn = (page: Page) => page.locator('.wb-status').getByRole('button', { name: 'Focus', exact: true })
const paletteChip = (page: Page, name: string) => page.locator('.toolbar__palette').getByRole('button', { name, exact: true })

test.describe('Canvas edit-lock', () => {
  test('the tool row lock toggle flips uiStore.canvasLocked; React Flow\'s "interactive" button is not shown', async ({ page }) => {
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
    // the Delete button is inert too, and every other control of the editing
    // part; only the Relations rows stay usable — they select, never edit
    // (2026-10-22: e2e/relations-row-pointing.spec.ts)
    const editing = await aside.locator('button:not(.wb-rel__row):not(.wb-rel__link)').all()
    expect(editing.length, 'the editing part has buttons to check').toBeGreaterThan(0)
    for (const b of editing) await expect(b).toBeDisabled()
    await expect(aside.locator('.inspector__head button')).toBeDisabled()
    for (const r of await aside.locator('.wb-rel__row, .wb-rel__link').all()) await expect(r).toBeEnabled()
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

    // zoom via the status bar's (+) button
    const vp0 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    await zoomIn(page).click()
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
  test('locked: the palette, Undo / Redo, Insert saved structure and the data import wizard are disabled and change nothing', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    // the palette's Pool (the left list names the added node "Pool" too)
    await paletteChip(page, 'Pool').click() // an edit, so Undo has something
    await expect(page.locator('.react-flow__node')).toHaveCount(4)
    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)
    const digest0 = await graphDigest(page)
    const pos0 = await nodePos(page, 'p1')

    const pool = paletteChip(page, 'Pool')
    await expect(pool).toBeDisabled()
    await expect(pool).toHaveAttribute('draggable', 'false')
    await pool.click({ force: true })

    const undo = page.locator('.toolbar button[title^="Undo"]')
    await expect(undo).toBeDisabled()
    await expect(page.locator('.toolbar button[title^="Redo"]')).toBeDisabled()
    // the pointer leaves the chip first, as a user's does: the chip's tooltip
    // sits over the canvas's top-left corner in the workbench, and a pointer
    // moving straight from the chip onto it keeps it open (D9)
    await page.mouse.move(5, 795)
    await expect(page.locator('#palette-tip-pool')).toBeHidden()
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')

    // the arrow keys on a selected node
    await page.locator('.react-flow__node[data-id="p1"]').click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')

    await page.getByRole('button', { name: 'File', exact: true }).click()
    const fileRow = (name: string) =>
      page.locator('.toolbar__filemenu-pop [role="menuitem"]').filter({ has: page.locator('.menu__name', { hasText: name }) })
    await expect(fileRow('Insert saved structure…')).toBeDisabled()
    await expect(fileRow('Save selected structure…')).toBeEnabled() // saving the selection is an export
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
    await paletteChip(page, 'Pool').click() // so Undo would have something
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

    // the menus' keyboard skips the disabled rows: from the File trigger, the
    // Arrow keys walk the whole menu and never land on a disabled row such as
    // Insert saved structure
    const file = page.getByRole('button', { name: 'File', exact: true })
    await file.focus()
    await page.keyboard.press('Enter')
    const rows = page.locator('.toolbar__filemenu-pop [role="menuitem"]')
    await expect(rows.first()).toBeVisible()
    expect(await rows.evaluateAll((els) => els.filter((e) => (e as HTMLButtonElement).disabled).length)).toBeGreaterThan(0)
    const total = await rows.count()
    for (let i = 0; i < total + 2; i++) {
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
    await zoomIn(page).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom))
      .toBeGreaterThan(zoom0)
    const focus = focusBtn(page)
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

// #338 — the controls keep their places under the lock: what the lock turns
// off stays where it is, native `disabled`. The desktop canvas had a Controls
// rail for this; in the workbench (docs/workbench.md §WB3) the frame tool,
// Undo / Redo and the palette are in the tool row, so the row's height and
// every button's place are the same locked and unlocked. Clear all frames is
// an Edit menu row, disabled under the lock.
test.describe('Canvas edit-lock — the tool row (#338)', () => {
  /** every button of the tool row: what it is (its tool, kind or name, never
   *  its pressed state) and where it is, relative to the row */
  const row = (page: Page) =>
    page.evaluate(() => {
      const c = document.querySelector('.wb-toolrow')!
      const r = c.getBoundingClientRect()
      return {
        top: r.top,
        height: r.height,
        buttons: [...c.querySelectorAll('button')].map((b) => {
          const q = b.getBoundingClientRect()
          const id = b.dataset.tool ?? b.dataset.connectKind ?? b.getAttribute('aria-label') ?? b.textContent ?? ''
          return { id, left: q.left - r.left, top: q.top - r.top, width: q.width, height: q.height }
        }),
      }
    })
  const frameTool = (page: Page) => page.locator('.wb-toolrow [data-tool="frame"]')
  /** Edit ▸ Clear all frames, with the Edit menu open */
  const clearAll = (page: Page) => page.locator('[data-menu="edit"] [role="menuitem"]').filter({ has: page.locator('.menu__name', { hasText: 'Clear all frames' }) })
  const openEdit = async (page: Page) => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.locator('[data-menu="edit"] [role="menu"]')).toBeVisible()
  }
  const addFrame = (page: Page) =>
    page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().addFrame({ x: -40, y: -40, w: 600, h: 160 }))
  const frameCount = (page: Page) =>
    page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().frames.length)

  test('the tool row keeps the same buttons, each in its place, and its height locked and unlocked, with and without frames, in light, dark and forced colours', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    for (const withFrame of [false, true]) {
      if (withFrame) await addFrame(page)
      for (const scheme of [{ colorScheme: 'light', forcedColors: 'none' }, { colorScheme: 'dark', forcedColors: 'none' }, { colorScheme: 'light', forcedColors: 'active' }] as const) {
        await page.emulateMedia(scheme)
        const tag = `${withFrame ? 'a frame' : 'no frame'}, ${scheme.colorScheme}${scheme.forcedColors === 'active' ? ' forced' : ''}`
        expect(await locked(page)).toBe(false)
        const open = await row(page)
        await lockBtn(page).click()
        await expect(frameTool(page), tag).toBeDisabled()
        const shut = await row(page)
        expect(shut.buttons.map((b) => b.id), tag).toEqual(open.buttons.map((b) => b.id))
        expect(shut.buttons.map((b) => [b.left, b.top, b.width, b.height]), tag).toEqual(open.buttons.map((b) => [b.left, b.top, b.width, b.height]))
        expect([shut.top, shut.height], tag).toEqual([open.top, open.height])
        if (withFrame) {
          await openEdit(page)
          await expect(clearAll(page), tag).toBeDisabled()
          await page.keyboard.press('Escape')
        }
        // a disabled tool reads as disabled: never the enabled tools' colour
        // (Pan, enabled and not pressed, beside the turned-off frame tool)
        const colours = await page.evaluate(() => {
          const c = (s: string) => getComputedStyle(document.querySelector(s)!).color
          return { off: c('.wb-toolrow [data-tool="frame"]'), on: c('.wb-toolrow [data-tool="pan"]') }
        })
        expect(colours.off, tag).not.toBe(colours.on)
        await lockBtn(page).click()
        await expect(frameTool(page), tag).toBeEnabled()
      }
    }
  })

  test('locked: the frame tool and Clear all frames are disabled, the keyboard skips them, and clicking them changes nothing; unlocked they work again', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    await addFrame(page)
    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)
    await expect(frameTool(page)).toBeDisabled()
    // Tab through the tool row never lands on the frame tool
    await page.locator('.wb-toolrow [data-tool="select"]').focus()
    for (let i = 0; i < 40; i++) {
      const at = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        return a?.closest('.wb-toolrow') ? (a.dataset.tool ?? a.dataset.connectKind ?? a.className) : null
      })
      if (at === null) break
      expect(at, `Tab stop ${i + 1}`).not.toBe('frame')
      await page.keyboard.press('Tab')
    }
    // the Edit menu: Clear all frames is disabled, and its arrow keys never land on it
    await openEdit(page)
    await expect(clearAll(page)).toBeDisabled()
    const rows = page.locator('[data-menu="edit"] [role="menuitem"], [data-menu="edit"] [role="menuitemcheckbox"]')
    const total = await rows.count()
    for (let i = 0; i < total + 2; i++) {
      await page.keyboard.press('ArrowDown')
      const name = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? '')
      expect(name, `ArrowDown ${i + 1}`).not.toContain('Clear all frames')
    }
    // a click reaches nothing: no tool armed, the frame still there
    await clearAll(page).click({ force: true })
    await page.keyboard.press('Escape')
    await frameTool(page).click({ force: true })
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().toolArmed)).toBe(false)
    expect(await frameCount(page)).toBe(1)
    // unlocked, both work again
    await lockBtn(page).click()
    await expect(frameTool(page)).toBeEnabled()
    await openEdit(page)
    await clearAll(page).click()
    expect(await frameCount(page)).toBe(0)
  })

  test('locking turns an armed frame tool off; a drag on the empty canvas then pans and draws no frame', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    await frameTool(page).click()
    await expect(frameTool(page)).toHaveAttribute('aria-pressed', 'true')
    await lockBtn(page).click()
    expect(await locked(page)).toBe(true)
    await expect(frameTool(page)).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().toolArmed)).toBe(false)
    const v0 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    const pane = await page.locator('.react-flow__pane').boundingBox()
    const x = pane!.x + pane!.width - 120
    const y = pane!.y + pane!.height - 160
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 80, y - 60, { steps: 6 })
    await page.mouse.up()
    const v1 = await page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport())
    expect([v1.x, v1.y], 'the drag panned').not.toEqual([v0.x, v0.y])
    expect(await frameCount(page)).toBe(0)
  })
})
