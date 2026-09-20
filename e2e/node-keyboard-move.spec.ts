import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// an ORTHOGONAL-routing fixture that is NOT shipped canvas-locked (the MMO and
// gacha templates are, so a node there cannot be moved at all — by design)
const ORTHOGONAL = readFileSync(resolve(import.meta.dirname, '..', 'examples', 'playback-choreography.json'), 'utf8')

// docs/large-graph-readability.md §LGR6.7 — F2: an arrow-key NODE move is an
// undo transaction.
//
// React Flow moves a selected node with the arrow keys (5 px, Shift 20) and
// reports it as a `position` change with `dragging: false`. `onNodesChange`
// commits history only for `dragging: true`, so the move used to create NO
// entry — and, worse, the next `Ctrl+Z` then ate the PREVIOUS unrelated edit
// while the position only *looked* restored (audit 2026-09-20).
//
// The contract pinned here: a Canvas capture-phase arrow keydown opens the same
// transaction the frame gestures use — React Flow keeps doing the movement and
// the announcement — and exactly ONE entry is pushed when the last arrow comes
// up and the positions really changed. The transaction opens ONLY for an arrow
// aimed at a real, selected, draggable React Flow node; a frame, a button, a
// text field, a dialog, the locked canvas and mobile never open one. Escape
// restores the origin, pushes nothing, keeps the selection and announces the
// settled original coordinates once. The pointer path is untouched.

type XY = { x: number; y: number }
type Bridge = {
  __loop: {
    graph: {
      getState: () => {
        nodes: { id: string; position: XY; selected?: boolean; data?: { label?: string } }[]
        edges: { id: string; source: string; target: string; data?: { waypoints?: XY[]; route?: string } }[]
        past: unknown[]
        future: unknown[]
        simulationRev: number
        undo: () => void
        redo: () => void
        onNodesChange: (c: unknown[]) => void
        updateNodeData: (id: string, d: unknown) => void
      }
    }
    frame: { getState: () => { frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[]; addFrame: (r: { x: number; y: number; w: number; h: number }) => string; selectFrame: (id: string | null) => void } }
    ui: { getState: () => { setCanvasLocked: (v: boolean) => void } }
    rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void }
    routeMap: { genCount: () => number }
  }
}

const state = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return {
      past: g.past.length,
      future: g.future.length,
      simRev: g.simulationRev,
      sel: g.nodes.filter((n) => n.selected).map((n) => n.id),
      pos: Object.fromEntries(g.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
      wp: Object.fromEntries(g.edges.filter((e) => e.data?.waypoints?.length).map((e) => [e.id, e.data!.waypoints!.map((p) => ({ ...p }))])),
    }
  })
const live = (page: Page) => page.locator('[id^="react-flow__aria-live"]').first()

async function load(page: Page, fixture = readRiskyFactory()) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, fixture)
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 200, y: 200, zoom: 1 }, { duration: 0 }))
  await page.waitForTimeout(250)
}

/** focus the first node and select it the way a keyboard user does */
async function focusAndSelect(page: Page, nth = 0) {
  await page.locator('.react-flow__node').nth(nth).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  return page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n) => n.selected)!.id)
}
/** a real key repeat: repeated `down` on a key that is still held */
async function holdArrow(page: Page, key: string, times: number) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(key)
    await page.waitForTimeout(40)
  }
  await page.keyboard.up(key)
  await page.waitForTimeout(250)
}

test.describe('node keyboard move — one gesture, one undo entry (§LGR6.7 / F2)', () => {
  test('a single press is one entry, and one undo puts the node back', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    const b = await state(page)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    const a = await state(page)
    expect(a.pos[id].x - b.pos[id].x, 'React Flow still moves it 5 px').toBe(5)
    expect(a.past - b.past, 'one press = one entry').toBe(1)
    expect(a.simRev, 'a position is never engine content').toBe(b.simRev)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await page.waitForTimeout(250)
    expect((await state(page)).pos[id]).toEqual(b.pos[id])
  })

  test('a held repeat is ONE entry; releasing and pressing again is a second', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    const b = await state(page)
    await holdArrow(page, 'ArrowRight', 5)
    const a1 = await state(page)
    expect(a1.past - b.past, 'the whole burst is one entry').toBe(1)
    expect(a1.pos[id].x - b.pos[id].x).toBe(25)
    await holdArrow(page, 'ArrowRight', 2)
    const a2 = await state(page)
    expect(a2.past - a1.past, 'a second burst is its own entry').toBe(1)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await page.waitForTimeout(250)
    expect((await state(page)).pos[id].x, 'one undo removes only the second burst').toBe(a1.pos[id].x)
  })

  test('Shift accelerates to 20 px inside the same gesture', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    const b = await state(page)
    await page.keyboard.down('Shift')
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(60)
    await page.keyboard.up('ArrowRight')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(250)
    const a = await state(page)
    expect(a.pos[id].x - b.pos[id].x).toBe(20)
    expect(a.past - b.past).toBe(1)
  })

  test('an out-and-back inside one gesture pushes nothing', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    const b = await state(page)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(60)
    await page.keyboard.down('ArrowLeft')
    await page.waitForTimeout(60)
    await page.keyboard.up('ArrowRight')
    await page.keyboard.up('ArrowLeft')
    await page.waitForTimeout(300)
    const a = await state(page)
    expect(a.pos[id]).toEqual(b.pos[id])
    expect(a.past - b.past, 'back where it started ⇒ no entry').toBe(0)
  })

  test('Escape restores the origin, pushes nothing, keeps the selection and announces the original position once; a later Escape deselects', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    const b = await state(page)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(120)
    const moved = await state(page)
    expect(moved.pos[id].x).toBeGreaterThan(b.pos[id].x)
    const beforeCancel = (await live(page).textContent()) ?? ''
    await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
    const a = await state(page)
    expect(a.pos[id], 'origin restored').toEqual(b.pos[id])
    expect(a.past - b.past, 'a cancelled gesture pushes nothing').toBe(0)
    expect(a.sel, 'the first Escape cancels, it does not deselect').toEqual(b.sel)
    const cancelMsg = (await live(page).textContent()) ?? ''
    expect(cancelMsg, 'the restore is announced').not.toBe(beforeCancel)
    expect(cancelMsg, 'and it carries the settled original coordinates').toContain(String(Math.round(b.pos[id].x)))
    // a late keyup changes nothing
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(250)
    expect((await state(page)).past - b.past).toBe(0)
    expect((await live(page).textContent()) ?? '', 'no second announcement').toBe(cancelMsg)
    // the next Escape reaches React Flow and deselects
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    expect((await state(page)).sel, 'the next Escape deselects').toEqual([])
  })

  test('losing focus mid-gesture commits once, and the stray keyup adds nothing', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    const b = await state(page)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(120)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(300)
    const a1 = await state(page)
    expect(a1.past - b.past, 'the open transaction was committed once').toBe(1)
    expect(a1.pos[id].x).toBeGreaterThan(b.pos[id].x)
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(250)
    expect((await state(page)).past - a1.past, 'the stray keyup adds nothing').toBe(0)
  })

  test('undo restores the move and KEEPS the edit that came before it (the F2 regression)', async ({ page }) => {
    await load(page)
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.updateNodeData(g.nodes[1].id, { ...g.nodes[1].data, label: 'MARKER' })
    })
    await page.waitForTimeout(400)
    const id = await focusAndSelect(page)
    const b = await state(page)
    const labelBefore = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes[1].data!.label)
    expect(labelBefore).toBe('MARKER')
    await holdArrow(page, 'ArrowRight', 4)
    expect((await state(page)).pos[id].x).toBe(b.pos[id].x + 20)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await page.waitForTimeout(300)
    expect((await state(page)).pos[id], 'the move is undone').toEqual(b.pos[id])
    expect(
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes[1].data!.label),
      'and the earlier label edit survives',
    ).toBe('MARKER')
  })

  test('multi-selection: every selected node moves by the same Δ in one entry, and undo / redo move them together', async ({ page }) => {
    await load(page)
    const ids = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const pick = g.nodes.slice(0, 3).map((n) => n.id)
      g.onNodesChange(pick.map((id) => ({ id, type: 'select', selected: true })))
      return pick
    })
    await page.locator('.react-flow__node').first().focus()
    await page.waitForTimeout(250)
    const b = await state(page)
    await holdArrow(page, 'ArrowRight', 3)
    const a = await state(page)
    expect(a.past - b.past, 'one entry for the whole selection').toBe(1)
    for (const id of ids) expect(a.pos[id].x - b.pos[id].x, `${id} moved`).toBe(15)
    for (const id of Object.keys(b.pos).filter((k) => !ids.includes(k))) {
      expect(a.pos[id], `${id} untouched`).toEqual(b.pos[id])
    }
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await page.waitForTimeout(300)
    for (const id of ids) expect((await state(page)).pos[id]).toEqual(b.pos[id])
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().redo())
    await page.waitForTimeout(300)
    for (const id of ids) expect((await state(page)).pos[id].x).toBe(b.pos[id].x + 15)
  })

  test('a move touches no waypoint, no frame rect and no simulationRev', async ({ page }) => {
    await load(page)
    const fid = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const xs = g.nodes.map((n) => n.position.x)
      const ys = g.nodes.map((n) => n.position.y)
      return (window as unknown as Bridge).__loop.frame.getState().addFrame({ x: Math.min(...xs) - 40, y: Math.min(...ys) - 40, w: 420, h: 260 })
    })
    await page.waitForTimeout(250)
    const rectBefore = await page.evaluate((id) => ({ ...(window as unknown as Bridge).__loop.frame.getState().frames.find((f) => f.id === id)!.rect }), fid)
    const b = await state(page)
    await focusAndSelect(page)
    await holdArrow(page, 'ArrowRight', 3)
    const a = await state(page)
    expect(a.simRev).toBe(b.simRev)
    expect(a.wp, 'manual waypoints are left to their own contract').toEqual(b.wp)
    expect(
      await page.evaluate((id) => ({ ...(window as unknown as Bridge).__loop.frame.getState().frames.find((f) => f.id === id)!.rect }), fid),
      'a node move never moves a frame',
    ).toEqual(rectBefore)
  })
})

test.describe('node keyboard move — what must NOT open a transaction (§LGR6.7)', () => {
  const seedFrame = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const xs = g.nodes.map((n) => n.position.x)
      const ys = g.nodes.map((n) => n.position.y)
      return (window as unknown as Bridge).__loop.frame.getState().addFrame({ x: Math.min(...xs) - 40, y: Math.min(...ys) - 40, w: 420, h: 260 })
    })

  test('a frame move with a node still selected makes exactly ONE entry — the frame gesture, never a second node one', async ({ page }) => {
    await load(page)
    const fid = await seedFrame(page)
    await focusAndSelect(page)
    await page.evaluate((id) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(id), fid)
    await page.locator('.lgr-frame').first().focus()
    await page.waitForTimeout(250)
    const b = await state(page)
    await holdArrow(page, 'ArrowRight', 3)
    const a = await state(page)
    expect(a.past - b.past, 'the frame gesture alone').toBe(1)
  })

  test('the frame resize handle, the frame ✕ and a toolbar button never open a node transaction', async ({ page }) => {
    await load(page)
    const fid = await seedFrame(page)
    await focusAndSelect(page)
    await page.evaluate((id) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(id), fid)
    await page.waitForTimeout(200)
    // ✕ and a toolbar button move nothing at all
    for (const sel of ['.lgr-frame__del', '.toolbar__actions button.btn']) {
      const b = await state(page)
      await page.locator(sel).first().focus()
      await holdArrow(page, 'ArrowRight', 2)
      const a = await state(page)
      expect(a.past - b.past, `${sel}: no entry`).toBe(0)
      expect(a.pos, `${sel}: nothing moved`).toEqual(b.pos)
    }
    // the resize handle runs the FRAME's own gesture: one entry, no node moved
    const b = await state(page)
    await page.locator('.lgr-frame__resize').first().focus()
    await holdArrow(page, 'ArrowRight', 2)
    const a = await state(page)
    expect(a.past - b.past, 'resize is the frame gesture, one entry').toBe(1)
    expect(a.pos, 'a resize never moves a node').toEqual(b.pos)
  })

  test('a text field swallows the arrows', async ({ page }) => {
    await load(page)
    const fid = await seedFrame(page)
    await focusAndSelect(page)
    await page.evaluate((id) => (window as unknown as Bridge).__loop.frame.getState().selectFrame(id), fid)
    await page.locator('.lgr-frame__label').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.lgr-frame__label--edit')).toHaveCount(1)
    const b = await state(page)
    await holdArrow(page, 'ArrowRight', 3)
    const a = await state(page)
    expect(a.past - b.past).toBe(0)
    expect(a.pos).toEqual(b.pos)
    await page.keyboard.press('Escape')
  })

  test('an open modal dialog blocks the arrows', async ({ page }) => {
    await load(page)
    await focusAndSelect(page)
    await page.locator('.pstrip__mc button').click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
    await page.waitForTimeout(400)
    await page.locator('.mcdlg .btn').first().focus()
    const b = await state(page)
    await holdArrow(page, 'ArrowRight', 3)
    const a = await state(page)
    expect(a.past - b.past).toBe(0)
    expect(a.pos).toEqual(b.pos)
  })

  test('a locked canvas neither moves nor records', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
    await page.waitForTimeout(300)
    const b = await state(page)
    await page.locator('.react-flow__node').first().focus().catch(() => {})
    await holdArrow(page, 'ArrowRight', 3)
    const a = await state(page)
    expect(a.pos[id]).toEqual(b.pos[id])
    expect(a.past - b.past).toBe(0)
  })

  test('every modifier that React Flow really moves on opens a transaction, and the step matches', async ({ page }) => {
    await load(page)
    const id = await focusAndSelect(page)
    // React Flow's node handler has NO modifier gate: every combination moves,
    // and only Shift changes the step (measured 2026-09-20).
    for (const [combo, step] of [
      ['ArrowRight', 5],
      ['Shift+ArrowRight', 20],
      ['Control+ArrowRight', 5],
      ['Alt+ArrowRight', 5],
      ['Meta+ArrowRight', 5],
      ['Control+Shift+ArrowRight', 20],
    ] as const) {
      const b = await state(page)
      await page.keyboard.press(combo)
      await page.waitForTimeout(300)
      const a = await state(page)
      expect(a.pos[id].x - b.pos[id].x, `${combo}: React Flow's step`).toBe(step)
      expect(a.past - b.past, `${combo}: a move React Flow makes is a move we record`).toBe(1)
    }
  })
})

test.describe('node keyboard move — the pointer path is untouched (§LGR6.7)', () => {
  test('a pointer drag is still exactly one entry, and a keyboard move right after it is a separate one', async ({ page }) => {
    await load(page)
    const b = await state(page)
    const box = (await page.locator('.react-flow__node').first().boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const afterDrag = await state(page)
    expect(afterDrag.past - b.past, 'the drag is one entry, never two').toBe(1)
    await page.locator('.react-flow__node').first().focus()
    await holdArrow(page, 'ArrowRight', 2)
    const afterKeys = await state(page)
    expect(afterKeys.past - afterDrag.past, 'the keyboard move is its own entry').toBe(1)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await page.waitForTimeout(250)
    expect((await state(page)).pos, 'one undo removes only the keyboard move').toEqual(afterDrag.pos)
  })

  test('a pointerdown closes an open keyboard transaction instead of mixing the two', async ({ page }) => {
    await load(page)
    await focusAndSelect(page)
    const b = await state(page)
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(120)
    await page.mouse.click(10, 400) // somewhere harmless on the page
    await page.waitForTimeout(300)
    const a = await state(page)
    expect(a.past - b.past, 'the keyboard transaction committed once on pointerdown').toBe(1)
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(200)
    expect((await state(page)).past - a.past).toBe(0)
  })
})

test.describe('node keyboard move — orthogonal routing (§LGR6.7 / §ER3.9)', () => {
  test('routes follow the move, and the history push itself causes no extra rebuild', async ({ page }) => {
    await load(page, ORTHOGONAL)
    await page.waitForTimeout(800)
    // pick a node an ORTHOGONAL edge is actually attached to, and centre it so
    // that edge is on screen and re-renders
    const id = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const orth = g.edges.find((e) => e.data?.route === 'orthogonal')!
      const n = g.nodes.find((x) => x.id === orth.source)!
      ;(window as unknown as Bridge).__loop.rf.setViewport({ x: 640 - n.position.x, y: 300 - n.position.y, zoom: 1 }, { duration: 0 })
      return orth.source
    })
    await page.waitForTimeout(500)
    await page.evaluate((nid) => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.onNodesChange(g.nodes.map((n) => ({ id: n.id, type: 'select', selected: n.id === nid })))
    }, id)
    await page.locator(`.react-flow__node[data-id="${id}"]`).focus()
    await page.waitForTimeout(300)
    expect(
      await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.filter((n) => n.selected).map((n) => n.id)),
      'the routed node is the selected one',
    ).toEqual([id])
    const b = await state(page)
    const gen0 = await page.evaluate(() => (window as unknown as Bridge).__loop.routeMap.genCount())
    await holdArrow(page, 'ArrowRight', 3)
    const gen1 = await page.evaluate(() => (window as unknown as Bridge).__loop.routeMap.genCount())
    const a = await state(page)
    expect(a.pos[id].x - b.pos[id].x, 'the node moved').toBe(15)
    expect(gen1, 'the route map followed the move').toBeGreaterThan(gen0)
    expect(a.past - b.past, 'and it is one entry').toBe(1)
    // the commit at keyup must not force another rebuild on top of the last move
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.routeMap.genCount()), 'the push adds no rebuild of its own').toBe(gen1)
  })
})
