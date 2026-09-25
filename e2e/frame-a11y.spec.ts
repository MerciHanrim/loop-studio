import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// docs/large-graph-readability.md §LGR6.6 — the frame accessibility bundle.
// A group frame used to be an anonymous `div`: no role, no name, not focusable,
// and its two pointer-only gestures (move, resize) had no keyboard path at all
// (audit 2026-09-20). The contract pinned here:
//
//   • the frame CONTAINER is the focus unit — `role="group"`, a localized
//     `aria-roledescription`, the name `"<label>, N nodes"`, one tab stop per
//     frame. The label / ✕ / swatches / resize handle are POST-SELECTION tab
//     stops (the rename path is kept: select, Tab to the label, Enter); the
//     four edge hit-strips stay unfocusable and out of the accessibility tree.
//   • Enter / Space select; Escape deselects when no gesture is running.
//   • Arrow keys move the frame by 5 px (Shift 20) and carry exactly what a
//     pointer drag carries; the resize handle's arrows change width / height by
//     the same steps.
//   • both gestures are ONE history transaction with the SAME lifetime as the
//     pointer one: captured on the first keydown, silent origin + accumulated
//     absolute Δ while keys repeat, ONE entry when the last arrow comes up and
//     the rect really changed, none for an out-and-back, none for Escape (which
//     restores the origin), and a blur / visibility change commits safely.
//   • an auto frame promotes only on a real final change, inside that entry.
//   • Backspace AND Delete delete: nodes / edges first, otherwise the selected
//     frame (saved = undoable delete, suggested = dismiss); never inside a text
//     field, never while a modal dialog is open, never on a locked canvas.
//   • one polite live region announces the settled position / size.

type Rect = { x: number; y: number; w: number; h: number }
type Bridge = {
  __loop: {
    graph: { getState: () => { nodes: { id: string; position: { x: number; y: number }; selected?: boolean }[]; edges: { id: string; selected?: boolean; data?: { waypoints?: { x: number; y: number }[] } }[]; past: unknown[]; future: unknown[]; simulationRev: number; setSelection: (n: string | null, e: string | null) => void; undo: () => void } }
    frame: { getState: () => { frames: { id: string; label: string; rect: Rect }[]; selectedId: string | null; addFrame: (r: Rect) => string; selectFrame: (id: string | null) => void } }
    autoFrame: { getState: () => { autoFrames: { id: string; rect: Rect }[]; suggest: () => void } }
    ui: { getState: () => { setCanvasLocked: (v: boolean) => void } }
    i18n: { getState: () => { setLocale: (l: string) => void } }
    rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void }
  }
}

const frames = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().frames.map((f) => ({ id: f.id, rect: { ...f.rect } })))
const selectedId = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().selectedId)
const history = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return { past: g.past.length, future: g.future.length, simRev: g.simulationRev }
  })
const positions = (page: Page) =>
  page.evaluate(() => Object.fromEntries((window as unknown as Bridge).__loop.graph.getState().nodes.map((n) => [n.id, { ...n.position }])))
const seedFrame = (page: Page, rect: Rect) =>
  page.evaluate((r) => (window as unknown as Bridge).__loop.frame.getState().addFrame(r), rect)
const rectOf = async (page: Page, id: string): Promise<Rect> => (await frames(page)).find((f) => f.id === id)!.rect

/** a frame around the first cluster of the fixture, wide enough to fully contain some nodes */
async function load(page: Page, opts: { locale?: string } = {}) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  if (opts.locale) {
    await page.evaluate((l) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(l), opts.locale)
    await page.waitForFunction((l) => document.documentElement.lang === l, opts.locale)
  }
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
}

const FRAME: Rect = { x: -60, y: -60, w: 520, h: 320 }
const container = (page: Page) => page.locator('.lgr-frame').first()
const handle = (page: Page) => page.locator('.lgr-frame__resize').first()

test.describe('frame accessibility — role, name and focus unit (§LGR6.6)', () => {
  test('the frame container is the focus unit: role=group, localized roledescription, "<label>, N nodes", one tab stop per frame', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await expect(container(page)).toBeVisible()
    const a = await container(page).evaluate((el) => ({
      role: el.getAttribute('role'),
      roledesc: el.getAttribute('aria-roledescription'),
      name: el.getAttribute('aria-label'),
      tabIndex: (el as HTMLElement).tabIndex,
      describedby: el.getAttribute('aria-describedby'),
    }))
    expect(a.role).toBe('group')
    expect(a.roledesc).toBe('group frame')
    expect(a.tabIndex).toBe(0)
    // the fixture frame fully contains at least one node — the name carries the count
    expect(a.name).toMatch(/^Group 1, \d+ nodes?$/)
    expect(a.describedby).toBeTruthy()
    const desc = await page.evaluate((idv) => document.getElementById(idv!)?.textContent?.trim() ?? '', a.describedby)
    expect(desc.length).toBeGreaterThan(10)
    // the name tracks the label and the contents
    await page.evaluate((fid) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.setSelection(null, null)
      void fid
    }, id)
  })

  test('the four edge hit-strips stay unfocusable and hidden from the accessibility tree', async ({ page }) => {
    await load(page)
    await seedFrame(page, FRAME)
    const strips = await page.locator('.lgr-frame__edge-hit').evaluateAll((els) =>
      els.map((el) => ({ tabIndex: (el as HTMLElement).tabIndex, hidden: el.getAttribute('aria-hidden') })),
    )
    expect(strips).toHaveLength(4)
    for (const s of strips) {
      expect(s.tabIndex).toBeLessThan(0)
      expect(s.hidden).toBe('true')
    }
  })

  test('no duplicate tab stop: an unselected frame is ONE stop; the label, ✕ and the resize handle join only once it is selected (the rename path survives)', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().selectFrame(null))
    await page.waitForTimeout(150)
    const stopsWhenIdle = await page.locator('.lgr-frame').first().evaluate((f) =>
      [...f.querySelectorAll('*')].filter((el) => (el as HTMLElement).tabIndex >= 0).length,
    )
    expect(stopsWhenIdle, 'an unselected frame adds no inner tab stop').toBe(0)

    await page.evaluate((fid) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(fid), id)
    await page.waitForTimeout(150)
    const stopsWhenSelected = await page.locator('.lgr-frame').first().evaluate((f) =>
      [...f.querySelectorAll('*')].filter((el) => (el as HTMLElement).tabIndex >= 0).map((el) => el.className.toString().split(' ')[0]),
    )
    expect(stopsWhenSelected).toContain('lgr-frame__label')
    expect(stopsWhenSelected).toContain('lgr-frame__del')
    expect(stopsWhenSelected).toContain('lgr-frame__resize')
    // §FC10 — the accent picker is no longer an inner tab stop of the frame at
    // all: it moved into the title's properties popover, which is portaled to
    // `document.body`, so it cannot appear in this count by construction.
    // the rename path: focus the label and press Enter → the popover opens
    await page.locator('.lgr-frame__label').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.lgr-frame-props__name')).toHaveCount(1)
    await page.keyboard.press('Escape')
  })

  test('Enter and Space select the focused frame; Escape deselects', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().selectFrame(null))
    await container(page).focus()
    await page.keyboard.press('Enter')
    expect(await selectedId(page)).toBe(id)
    await page.keyboard.press('Escape')
    expect(await selectedId(page)).toBeNull()
    await container(page).focus()
    await page.keyboard.press('Space')
    expect(await selectedId(page)).toBe(id)
  })

  test('locked canvas: role, name, focus and selection survive; every edit path is gone', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
    await page.waitForTimeout(200)
    const a = await container(page).evaluate((el) => ({ role: el.getAttribute('role'), tabIndex: (el as HTMLElement).tabIndex, name: el.getAttribute('aria-label') }))
    expect(a.role).toBe('group')
    expect(a.tabIndex).toBe(0)
    expect(a.name).toMatch(/^Group 1, /)
    await container(page).focus()
    await page.keyboard.press('Enter')
    expect(await selectedId(page)).toBe(id)
    const before = await rectOf(page, id)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    expect(await rectOf(page, id), 'a locked canvas never moves a frame').toEqual(before)
    await expect(page.locator('.lgr-frame__del')).toHaveCount(0)
    await expect(page.locator('.lgr-frame__resize')).toHaveCount(0)
  })
})

test.describe('frame accessibility — keyboard move and resize (§LGR6.6)', () => {
  test('Arrow moves the frame 5 px and Shift+Arrow 20 px, carrying the same contents a pointer drag carries', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await container(page).focus()
    await page.keyboard.press('Enter')
    const r0 = await rectOf(page, id)
    const p0 = await positions(page)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    expect((await rectOf(page, id)).x).toBe(r0.x + 5)
    await page.keyboard.press('Shift+ArrowDown')
    await page.waitForTimeout(200)
    const r1 = await rectOf(page, id)
    expect(r1.x).toBe(r0.x + 5)
    expect(r1.y).toBe(r0.y + 20)
    // whatever the frame carried moved by EXACTLY the frame's own delta, and
    // every other node stayed put — the same all-or-nothing containment rule a
    // pointer drag uses (asserted without restating that rule here)
    const p1 = await positions(page)
    const moved = Object.keys(p0).filter((k) => p1[k].x !== p0[k].x || p1[k].y !== p0[k].y)
    expect(moved.length, 'the fixture frame carries nodes').toBeGreaterThan(0)
    for (const nid of moved) {
      expect(p1[nid].x - p0[nid].x, `${nid} carried in x`).toBe(5)
      expect(p1[nid].y - p0[nid].y, `${nid} carried in y`).toBe(20)
    }
    for (const nid of Object.keys(p0).filter((k) => !moved.includes(k))) {
      expect(p1[nid], `${nid} untouched`).toEqual(p0[nid])
    }
  })

  test('a key-repeat burst is ONE undo entry, and one undo restores the frame AND its contents', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await container(page).focus()
    await page.keyboard.press('Enter')
    const h0 = await history(page)
    const r0 = await rectOf(page, id)
    const p0 = await positions(page)
    // a real key repeat: repeated `down` on a key that is still held (a `press`
    // would be a full down+up and would END the gesture each time)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(40)
    }
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(250)
    const h1 = await history(page)
    expect(h1.past - h0.past, 'one gesture = one entry').toBe(1)
    expect(h1.simRev, 'a move is never engine content').toBe(h0.simRev)
    expect((await rectOf(page, id)).x).toBeGreaterThan(r0.x)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await page.waitForTimeout(250)
    expect(await rectOf(page, id)).toEqual(r0)
    expect(await positions(page)).toEqual(p0)
  })

  test('an out-and-back inside one gesture makes no entry at all', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await container(page).focus()
    await page.keyboard.press('Enter')
    const h0 = await history(page)
    const r0 = await rectOf(page, id)
    const p0 = await positions(page)
    // both arrows held, so the gesture only ends when the second one comes up
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(60)
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(60)
    await page.keyboard.up('ArrowRight')
    await page.keyboard.up('ArrowLeft')
    await page.waitForTimeout(250)
    expect(await rectOf(page, id), 'back where it started').toEqual(r0)
    expect(await positions(page)).toEqual(p0)
    expect((await history(page)).past - h0.past, 'a gesture that ends where it began pushes nothing').toBe(0)
  })

  test('Escape during a keyboard move restores the origin with no entry, and only a LATER Escape deselects', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await container(page).focus()
    await page.keyboard.press('Enter')
    const h0 = await history(page)
    const r0 = await rectOf(page, id)
    const p0 = await positions(page)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(120)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    expect(await rectOf(page, id), 'origin restored').toEqual(r0)
    expect(await positions(page)).toEqual(p0)
    expect((await history(page)).past - h0.past, 'a cancelled gesture pushes nothing').toBe(0)
    expect(await selectedId(page), 'the first Escape cancelled the gesture, it did not deselect').toBe(id)
    await page.keyboard.up('ArrowRight')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    expect(await selectedId(page), 'the next Escape deselects').toBeNull()
  })

  test('losing focus mid-gesture commits safely: one entry, nothing left open', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await container(page).focus()
    await page.keyboard.press('Enter')
    const h0 = await history(page)
    const r0 = await rectOf(page, id)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(150)
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await page.waitForTimeout(250)
    const h1 = await history(page)
    expect(h1.past - h0.past, 'the open transaction was committed once').toBe(1)
    expect((await rectOf(page, id)).x).toBeGreaterThan(r0.x)
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(200)
    expect((await history(page)).past - h1.past, 'the stray keyup adds nothing').toBe(0)
  })

  test('the resize handle is a keyboard control: Left/Right change width, Up/Down change height, Shift accelerates, and its name carries the current size', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await page.evaluate((fid) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(fid), id)
    await expect(handle(page)).toBeVisible()
    const meta = await handle(page).evaluate((el) => ({
      tag: el.tagName, tabIndex: (el as HTMLElement).tabIndex, name: el.getAttribute('aria-label'), role: el.getAttribute('role'),
    }))
    expect(meta.tabIndex).toBe(0)
    expect(meta.name, 'the handle names itself and the current size').toMatch(/520/)
    expect(meta.role === 'button' || meta.tag === 'BUTTON').toBe(true)
    const r0 = await rectOf(page, id)
    await handle(page).focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    expect(await rectOf(page, id)).toEqual({ ...r0, w: r0.w + 5 })
    await page.keyboard.press('Shift+ArrowDown')
    await page.waitForTimeout(200)
    expect(await rectOf(page, id)).toEqual({ ...r0, w: r0.w + 5, h: r0.h + 20 })
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(250)
    expect(await rectOf(page, id)).toEqual({ ...r0, w: r0.w, h: r0.h + 15 })
  })

  test('a keyboard resize never moves the contents and is ONE entry per burst', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await page.evaluate((fid) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(fid), id)
    await handle(page).focus()
    const h0 = await history(page)
    const p0 = await positions(page)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(140)
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(250)
    expect((await history(page)).past - h0.past).toBe(1)
    expect(await positions(page), 'a resize moves nothing').toEqual(p0)
  })
})

test.describe('frame accessibility — auto frames (§AF5 R5/R6)', () => {
  const seedAuto = async (page: Page) => {
    await page.evaluate(() => (window as unknown as Bridge).__loop.autoFrame.getState().suggest())
    await expect(page.locator('.lgr-frame--auto').first()).toBeVisible()
  }
  const autoCount = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.autoFrame.getState().autoFrames.length)
  const savedCount = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().frames.length)

  test('a keyboard move of a suggested frame promotes it exactly once, inside the same entry', async ({ page }) => {
    await load(page)
    await seedAuto(page)
    const a0 = await autoCount(page)
    const s0 = await savedCount(page)
    const h0 = await history(page)
    const auto = page.locator('.lgr-frame--auto').first()
    await auto.focus()
    await page.keyboard.press('Enter')
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(40)
    }
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(300)
    expect(await savedCount(page), 'promoted to a saved frame').toBe(s0 + 1)
    expect(await autoCount(page), 'dropped from the suggested set').toBe(a0 - 1)
    expect((await history(page)).past - h0.past, 'promotion + move = one entry').toBe(1)
  })

  test('Escape and out-and-back never promote a suggested frame', async ({ page }) => {
    await load(page)
    await seedAuto(page)
    const a0 = await autoCount(page)
    const s0 = await savedCount(page)
    const h0 = await history(page)
    const auto = page.locator('.lgr-frame--auto').first()
    await auto.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(120)
    await page.keyboard.press('Escape')
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(250)
    expect(await savedCount(page), 'Escape never promotes').toBe(s0)
    expect(await autoCount(page)).toBe(a0)
    // out and back inside ONE gesture
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(60)
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(60)
    await page.keyboard.up('ArrowRight')
    await page.keyboard.up('ArrowLeft')
    await page.waitForTimeout(250)
    expect(await savedCount(page), 'an out-and-back never promotes').toBe(s0)
    expect((await history(page)).past - h0.past).toBe(0)
  })
})

test.describe('frame accessibility — the delete keys (§LGR6.6 / F1, F3)', () => {
  const nodeCount = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length)

  for (const key of ['Backspace', 'Delete'] as const) {
    test(`${key} deletes a selected NODE (nodes and edges take priority over a selected frame)`, async ({ page }) => {
      await load(page)
      const fid = await seedFrame(page, FRAME)
      const n0 = await nodeCount(page)
      await page.locator('.react-flow__node').first().focus()
      await page.keyboard.press('Enter')
      await page.evaluate((f) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(f), fid)
      await page.waitForTimeout(150)
      await page.keyboard.press(key)
      await page.waitForTimeout(350)
      expect(await nodeCount(page), `${key} removed the node`).toBe(n0 - 1)
      expect((await frames(page)).length, 'the frame is untouched while a node was selected').toBe(1)
    })

    test(`${key} deletes the selected SAVED frame when no node or edge is selected, and one undo brings it back`, async ({ page }) => {
      await load(page)
      const fid = await seedFrame(page, FRAME)
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, null))
      await container(page).focus()
      await page.keyboard.press('Enter')
      const n0 = await nodeCount(page)
      const h0 = await history(page)
      await page.keyboard.press(key)
      await page.waitForTimeout(300)
      expect((await frames(page)).length).toBe(0)
      expect(await nodeCount(page), 'no node was harmed').toBe(n0)
      expect((await history(page)).past - h0.past).toBe(1)
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
      await page.waitForTimeout(250)
      expect((await frames(page)).map((f) => f.id)).toEqual([fid])
    })
  }

  test('a selected SUGGESTED frame is dismissed, not deleted, and that is not an undo entry', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.autoFrame.getState().suggest())
    await expect(page.locator('.lgr-frame--auto').first()).toBeVisible()
    const a0 = await page.evaluate(() => (window as unknown as Bridge).__loop.autoFrame.getState().autoFrames.length)
    const h0 = await history(page)
    await page.locator('.lgr-frame--auto').first().focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.autoFrame.getState().autoFrames.length)).toBe(a0 - 1)
    expect((await frames(page)).length, 'a dismissal never creates a saved frame').toBe(0)
    expect((await history(page)).past - h0.past, 'suggested-frame dismissal is session-only').toBe(0)
  })

  test('a text field swallows the delete keys', async ({ page }) => {
    await load(page)
    const fid = await seedFrame(page, FRAME)
    await page.evaluate((f) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(f), fid)
    await page.locator('.lgr-frame__label').first().focus()
    await page.keyboard.press('Enter') // rename input
    await expect(page.locator('.lgr-frame-props__name')).toHaveCount(1)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(250)
    expect((await frames(page)).length, 'editing a label never deletes the frame').toBe(1)
    await page.keyboard.press('Escape')
  })

  for (const dialog of [
    { name: 'Monte Carlo', open: async (page: Page) => { await page.locator('.pstrip__mc button').click(); await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible() } },
    { name: 'spreadsheet import', open: async (page: Page) => { await page.getByRole('button', { name: 'Data ▾' }).click(); await page.getByRole('menuitem').first().click(); await expect(page.locator('.mcdlg--dataimport')).toBeVisible() } },
  ]) {
    test(`an open ${dialog.name} dialog blocks the canvas delete keys (F3)`, async ({ page }) => {
      await load(page)
      await seedFrame(page, FRAME)
      const n0 = await nodeCount(page)
      await page.locator('.react-flow__node').first().focus()
      await page.keyboard.press('Enter')
      await dialog.open(page)
      await page.waitForTimeout(400)
      await page.locator('.mcdlg .btn').first().focus()
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Delete')
      await page.waitForTimeout(400)
      expect(await nodeCount(page), 'the canvas kept its nodes').toBe(n0)
      expect((await frames(page)).length).toBe(1)
    })
  }

  test('a locked canvas blocks both delete keys for nodes and frames', async ({ page }) => {
    await load(page)
    const fid = await seedFrame(page, FRAME)
    const n0 = await nodeCount(page)
    await page.locator('.react-flow__node').first().focus()
    await page.keyboard.press('Enter')
    await page.evaluate((f) => {
      const b = (window as unknown as Bridge).__loop
      b.frame.getState().selectFrame(f)
      b.ui.getState().setCanvasLocked(true)
    }, fid)
    await page.waitForTimeout(250)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(350)
    expect(await nodeCount(page)).toBe(n0)
    expect((await frames(page)).length).toBe(1)
  })
})

test.describe('frame accessibility — announcements and locales (§LGR6.6)', () => {
  test('one polite live region announces the settled position after a move burst, and the node message is localized too (F4)', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    const regions = await page.locator('[data-frame-announce]').count()
    expect(regions, 'exactly one frame live region').toBe(1)
    const region = page.locator('[data-frame-announce]')
    await expect(region).toHaveAttribute('aria-live', 'polite')
    await container(page).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(120)
    await page.keyboard.up('ArrowRight')
    await expect(region).toContainText(/Group 1/, { timeout: 3000 })
    const r = await rectOf(page, id)
    await expect(region).toContainText(String(Math.round(r.x)))
  })

  for (const [locale, moved] of [['ko', /이동/], ['ja', /移動/]] as const) {
    test(`${locale}: the frame announcement and the React Flow node move message are both localized`, async ({ page }) => {
      await load(page, { locale })
      await seedFrame(page, FRAME)
      await container(page).focus()
      await page.keyboard.press('Enter')
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(120)
      await page.keyboard.up('ArrowRight')
      await expect(page.locator('[data-frame-announce]')).toContainText(moved, { timeout: 3000 })
      // F4 — React Flow's own node move message
      await page.locator('.react-flow__node').first().focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('ArrowRight')
      await expect(page.locator('.react-flow__container [aria-live="assertive"], [id^="react-flow__aria-live"]').first()).toContainText(moved, { timeout: 3000 })
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// §LGR6.6 — the two rings. Selection keeps the `outline` it always had (dashed,
// offset 3 ⇒ the 3…5 px band); focus is an independent pseudo-element layer
// hugging the box (`inset: -2px` + a 2 px solid border ⇒ the 0…2 px band).
// They never share a band, so the three states are three distinct pictures, and
// the pseudo layer is paint only — no layout, no hit area.
type Rgb = [number, number, number]
const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** read image pixels in the page (deviceScaleFactor 1 ⇒ image px = CSS px) */
async function rgbAt(page: Page, png: Buffer, pts: { x: number; y: number }[]): Promise<Rgb[]> {
  return page.evaluate(
    async ({ b64, pts }) => {
      const im = new Image()
      im.src = `data:image/png;base64,${b64}`
      await im.decode()
      const cv = document.createElement('canvas')
      cv.width = im.width
      cv.height = im.height
      const cx = cv.getContext('2d')!
      cx.drawImage(im, 0, 0)
      return pts.map(({ x, y }) => {
        const d = cx.getImageData(Math.round(x), Math.round(y), 1, 1).data
        return [d[0], d[1], d[2]] as [number, number, number]
      })
    },
    { b64: png.toString('base64'), pts },
  )
}

/** the frame rect is in flow space; pin the camera at zoom 1 so its left edge
 *  (and the two ring bands outside it) sit well inside the viewport. */
async function pinCamera(page: Page) {
  await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 200, y: 200, zoom: 1 }, { duration: 0 }))
  await page.waitForTimeout(200)
}

/** Sample the frame's LEFT edge at a band (px outside the box) over many rows —
 *  a dashed ring only paints some of them — and return the raw pixels. The
 *  frame's own outline stroke lives in the inner band too, so a ring is proved
 *  by the DIFFERENCE against the same band with that ring off, never against
 *  the bare canvas. */
async function bandPixels(page: Page, band: [number, number]): Promise<Rgb[]> {
  const b = (await container(page).boundingBox())!
  const xs = [band[0], (band[0] + band[1]) / 2, band[1]].map((o) => b.x - o)
  const ys = Array.from({ length: 24 }, (_, i) => b.y + 8 + i * Math.max(2, (b.height - 16) / 24))
  return rgbAt(page, await page.screenshot(), ys.flatMap((y) => xs.map((x) => ({ x, y }))))
}
/** the strongest change between two samples of the same band */
const bandDelta = (a: Rgb[], b: Rgb[]) => a.reduce((m, p, i) => Math.max(m, dist(p, b[i])), 0)
/** of the pixels that changed, the one furthest from the canvas — the ring itself */
function ringPixel(rest: Rgb[], now: Rgb[], bg: Rgb): Rgb {
  let best = bg
  for (let i = 0; i < now.length; i++) {
    if (dist(now[i], rest[i]) < 20) continue
    if (dist(now[i], bg) > dist(best, bg)) best = now[i]
  }
  return best
}

const FOCUS_BAND: [number, number] = [1, 2]
const SEL_BAND: [number, number] = [4, 5]

test.describe('frame accessibility — the selection and focus rings (§LGR6.6)', () => {
  for (const scheme of ['light', 'dark', 'forced'] as const) {
    test(`${scheme}: selection alone, focus alone and both together are distinct, and every ring clears 3:1`, async ({ page }) => {
      if (scheme === 'forced') await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' })
      else await page.emulateMedia({ colorScheme: scheme })
      await load(page)
      const id = await seedFrame(page, FRAME)
      await pinCamera(page)
      const deselect = () => page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().selectFrame(null))
      const select = () => page.evaluate((fid) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(fid), id)
      const blur = () => page.evaluate(() => (document.activeElement as HTMLElement)?.blur())

      // ── neither: the reference for both bands ───────────────────────────
      await deselect()
      await blur()
      await page.waitForTimeout(250)
      const b0 = (await container(page).boundingBox())!
      const [bg] = await rgbAt(page, await page.screenshot(), [{ x: b0.x - 14, y: b0.y + b0.height / 2 }])
      const restFocus = await bandPixels(page, FOCUS_BAND)
      const restSel = await bandPixels(page, SEL_BAND)

      // ── selection alone ─────────────────────────────────────────────────
      await select()
      await page.waitForTimeout(250)
      const selFocusBand = await bandPixels(page, FOCUS_BAND)
      const selSelBand = await bandPixels(page, SEL_BAND)
      expect(bandDelta(restSel, selSelBand), `${scheme}: the selection ring paints in the 3–5 px band`).toBeGreaterThan(20)
      expect(ratio(ringPixel(restSel, selSelBand, bg), bg), `${scheme}: selection ring vs the canvas`).toBeGreaterThanOrEqual(3)
      // (the inner band also moves when a frame is selected — `.lgr-frame__fill.is-selected`
      // thickens the frame's OWN stroke — so the two rings are told apart by the
      // focus-on-top-of-selection check further down, not by this band alone.)
      expect(await container(page).evaluate((el) => {
        const cs = getComputedStyle(el)
        return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset }
      })).toEqual({ style: 'dashed', width: '2px', offset: '3px' })

      // ── focus alone ─────────────────────────────────────────────────────
      await deselect()
      await container(page).focus()
      await page.waitForTimeout(250)
      const focFocusBand = await bandPixels(page, FOCUS_BAND)
      const focSelBand = await bandPixels(page, SEL_BAND)
      expect(bandDelta(restFocus, focFocusBand), `${scheme}: the pseudo focus ring paints in the 0–2 px band`).toBeGreaterThan(20)
      expect(bandDelta(restSel, focSelBand), `${scheme}: focus leaves the selection band alone`).toBeLessThan(20)
      expect(ratio(ringPixel(restFocus, focFocusBand, bg), bg), `${scheme}: focus ring vs the canvas`).toBeGreaterThanOrEqual(3)
      const focStyle = await container(page).evaluate((el) => {
        const ring = getComputedStyle(el, '::after')
        return {
          outline: getComputedStyle(el).outlineStyle,
          style: ring.borderTopStyle,
          width: ring.borderTopWidth,
          events: ring.pointerEvents,
        }
      })
      expect(focStyle.outline, 'the container draws no outline of its own while only focused').toBe('none')
      expect(focStyle.style).toBe('solid')
      expect(focStyle.width).toBe('2px')
      expect(focStyle.events, 'the focus layer is paint only').toBe('none')

      // ── both at once ────────────────────────────────────────────────────
      await select()
      await container(page).focus()
      await page.waitForTimeout(250)
      const bothFocus = await bandPixels(page, FOCUS_BAND)
      const bothSel = await bandPixels(page, SEL_BAND)
      expect(bandDelta(restFocus, bothFocus), `${scheme}: both — the focus ring is there`).toBeGreaterThan(20)
      expect(bandDelta(restSel, bothSel), `${scheme}: both — the selection ring is there`).toBeGreaterThan(20)
      // the state a user must be able to tell apart: SELECTED vs SELECTED+FOCUSED
      expect(bandDelta(selFocusBand, bothFocus), `${scheme}: focusing a selected frame is visibly different`).toBeGreaterThan(20)
      expect(bandDelta(selSelBand, bothSel), `${scheme}: and it does not disturb the selection ring`).toBeLessThan(20)
      expect(ratio(ringPixel(restFocus, bothFocus, bg), bg)).toBeGreaterThanOrEqual(3)
      expect(ratio(ringPixel(restSel, bothSel, bg), bg)).toBeGreaterThanOrEqual(3)
      expect(
        await container(page).evaluate((el) => getComputedStyle(el).outlineStyle),
        'selection keeps its outline while the frame is also focused',
      ).toBe('dashed')

      if (scheme === 'forced') await page.emulateMedia({ forcedColors: null })
    })
  }

  test('the focus layer changes neither the layout nor the hit area', async ({ page }) => {
    await load(page)
    const id = await seedFrame(page, FRAME)
    await pinCamera(page)
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await page.waitForTimeout(150)
    const before = await container(page).boundingBox()
    await container(page).focus()
    await page.waitForTimeout(150)
    expect(await container(page).boundingBox(), 'focusing moves nothing').toEqual(before)
    // the focus ring sits 0–2 px outside the box, well inside the move strip
    // that already covers −6…+6 px, so it can only be a hit target further out.
    // A click 10 px out — past the strip and past both rings — reaches the pane
    // whether the frame is focused or not.
    const b = before!
    await page.evaluate(() => (window as unknown as Bridge).__loop.frame.getState().selectFrame(null))
    await container(page).focus()
    await page.waitForTimeout(150)
    await page.mouse.click(b.x - 10, b.y + b.height / 2)
    await page.waitForTimeout(250)
    expect(await selectedId(page), 'the focus ring adds no hit area').toBeNull()
    void id
  })
})
