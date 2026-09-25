import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/large-graph-readability-frame-colour.md §FC10 — the frame PROPERTIES
// popover.
//
// The defect this spec pins: the accent picker used to be a swatch row glued
// to the frame's BOTTOM edge, in canvas coordinates. On a frame taller than
// the viewport that put the only colour control off screen — reading the
// frame's TITLE and changing its colour could not both be done from the same
// place. The gacha Template's `zone_pickup` (`Premium Pickup`,
// `{x:2440, y:330, w:1790, h:1000}`) is the shipped example of exactly that,
// so it is the representative case here rather than a synthetic rectangle.
//
// The fix binds name + colour to the INTERACTION that opens them (the title)
// instead of to the frame's geometry: one screen-space popover, portaled out
// of the canvas transform, flipped and clamped inside the viewport.
//
// Scope note (LGR-D12 / D6, 2026-09-20, unchanged by this pass): on mobile and
// on a locked canvas a saved frame is still view + select only. There is no
// popover and no swatch there at all — test 6.

type Loop = Record<string, { getState: () => any }>
type Viewport = { x: number; y: number; zoom: number }

const GACHA = readFileSync(new URL('../examples/gacha-banner-zones.json', import.meta.url), 'utf8')

/** the shipped rect of the frame this whole spec exists for */
const PICKUP = { x: 2440, y: 330, w: 1790, h: 1000 }
const PICKUP_LABEL = 'Premium Pickup'

const ui = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState())

const setLocked = (page: Page, v: boolean) =>
  page.evaluate((x) => (window as unknown as { __loop: Loop }).__loop.ui.getState().setCanvasLocked(x), v)

const viewport = (page: Page): Promise<Viewport> =>
  page.evaluate(() => (window as unknown as { __loop: { rf: { getViewport: () => Viewport } } }).__loop.rf.getViewport())

async function setViewport(page: Page, v: Viewport): Promise<void> {
  await page.evaluate(
    (x) =>
      (window as unknown as { __loop: { rf: { setViewport: (v: Viewport, o: object) => void } } }).__loop.rf.setViewport(
        x,
        { duration: 0 },
      ),
    v,
  )
  // React Flow applies a viewport write asynchronously — verify it took
  await expect.poll(() => viewport(page)).toEqual(v)
}

/** every frame's stored geometry + colour, and the graph's node / edge geometry:
 *  the things this feature must never move. */
type Geometry = {
  frames: { id: string; rect: { x: number; y: number; w: number; h: number }; color: string | null }[]
  nodes: { id: string; x: number; y: number }[]
  edges: { id: string; source: string; target: string }[]
}

function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const l = (window as unknown as { __loop: Loop }).__loop
    const g = l.graph.getState()
    return {
      frames: l.frame.getState().frames.map((f: any) => ({ id: f.id, rect: { ...f.rect }, color: f.color ?? null })),
      nodes: g.nodes.map((n: any) => ({ id: n.id, x: n.position.x, y: n.position.y })),
      edges: g.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
    }
  })
}

const frameEl = (page: Page, label: string) =>
  page.locator('.lgr-frame').filter({ has: page.locator('.lgr-frame__label', { hasText: label }) })
const titleOf = (page: Page, label: string) => page.locator('.lgr-frame__label', { hasText: label })
const popover = (page: Page) => page.locator('.lgr-frame-props')
const nameField = (page: Page) => popover(page).locator('.lgr-frame-props__name')
const swatch = (page: Page, c: string) => popover(page).locator(`.lgr-frame__swatch[data-color="${c}"]`)

const boxOf = async (loc: ReturnType<typeof popover>) => {
  const b = await loc.boundingBox()
  if (!b) throw new Error('no box')
  return b
}

const screenSize = (page: Page) =>
  page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

/** Load the shipped gacha Template and unlock its canvas.
 *  The Template ships `recommendedRunConfig.canvasLocked: true`, so an import
 *  locks the canvas — a real user unlocks it before editing anything, and D6
 *  means no frame edit UI exists at all until they do. */
async function loadPickup(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GACHA)
  expect((await ui(page)).canvasLocked, 'the Template ships a locked canvas').toBe(true)
  await setLocked(page, false)
  await expect(titleOf(page, PICKUP_LABEL)).toHaveCount(1)
}

/** put `Premium Pickup`'s TITLE near the top of the screen — which is exactly
 *  the situation the defect was reported from: its bottom edge, where the old
 *  swatch row lived, ends up far below the fold. */
async function frameTitleAtTop(page: Page): Promise<void> {
  await setViewport(page, { x: 400 - PICKUP.x, y: 200 - PICKUP.y, zoom: 1 })
}

/** a small single-frame document — used where the gacha Template's size is
 *  irrelevant and only the popover's own behaviour is under test. */
async function loadOneFrame(page: Page, rect = { x: 0, y: 0, w: 320, h: 180 }, label = 'Zone'): Promise<string> {
  await openApp(page)
  await resetAll(page)
  const id = await page.evaluate(
    ([r, l]) => {
      const f = (window as unknown as { __loop: Loop }).__loop.frame.getState()
      const created = f.addFrame(r)
      f.renameFrame(created, l)
      return created as string
    },
    [rect, label] as const,
  )
  await expect(titleOf(page, label)).toHaveCount(1)
  return id
}

test.describe('frame properties popover (§FC10)', () => {
  test('Premium Pickup: its bottom edge is far below the fold, yet the title opens a popover whose colour picker is fully on screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadPickup(page)
    await frameTitleAtTop(page)

    // the premise — without it this test proves nothing
    const fr = await boxOf(frameEl(page, PICKUP_LABEL))
    const screen = await screenSize(page)
    expect(fr.y + fr.height, 'the frame bottom is below the viewport').toBeGreaterThan(screen.h)
    expect(fr.x + fr.width, 'the frame right edge is past the viewport').toBeGreaterThan(screen.w)
    const title = await boxOf(titleOf(page, PICKUP_LABEL))
    expect(title.y, 'the title itself IS on screen').toBeGreaterThanOrEqual(0)
    expect(title.y).toBeLessThan(screen.h)

    const vp0 = await viewport(page)
    await titleOf(page, PICKUP_LABEL).click()
    await expect(popover(page)).toBeVisible()

    // the whole point: reachable without moving the canvas at all
    await expect(popover(page)).toBeInViewport({ ratio: 1 })
    await expect(nameField(page)).toBeInViewport({ ratio: 1 })
    for (const c of ['slate', 'sage', 'gold', 'violet', 'rose']) {
      await expect(swatch(page, c), `${c} swatch on screen`).toBeInViewport({ ratio: 1 })
    }
    expect(await viewport(page), 'opening it panned / zoomed nothing').toEqual(vp0)
  })

  test('a colour picked in the popover applies to the whole frame immediately', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadPickup(page)
    await frameTitleAtTop(page)

    await titleOf(page, PICKUP_LABEL).click()
    await expect(swatch(page, 'rose'), 'the Template ships this frame rose').toHaveAttribute('aria-pressed', 'true')

    await swatch(page, 'gold').click()
    // the popover stays open — the change is immediate, not a "save" step
    await expect(popover(page)).toBeVisible()
    await expect(swatch(page, 'gold')).toHaveAttribute('aria-pressed', 'true')
    await expect(swatch(page, 'rose')).toHaveAttribute('aria-pressed', 'false')

    // …on the frame itself: the chrome, the painted fill behind the nodes, and
    // the stored document
    await expect(frameEl(page, PICKUP_LABEL)).toHaveAttribute('data-color', 'gold')
    await expect(page.locator('.lgr-frame-back rect.lgr-frame__fill[data-color="gold"]')).toHaveCount(1)
    const stored = (await geometry(page)).frames.find((f) => f.rect.w === PICKUP.w)
    expect(stored?.color).toBe('gold')
  })

  test('opening the popover and recolouring moves nothing — frame, node and edge geometry and the viewport are unchanged', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadPickup(page)
    await frameTitleAtTop(page)

    const g0 = await geometry(page)
    const vp0 = await viewport(page)

    await titleOf(page, PICKUP_LABEL).click()
    await expect(popover(page)).toBeVisible()
    expect(await viewport(page)).toEqual(vp0)
    await swatch(page, 'sage').click()
    await expect(swatch(page, 'sage')).toHaveAttribute('aria-pressed', 'true')

    const g1 = await geometry(page)
    expect(await viewport(page), 'the viewport never moved').toEqual(vp0)
    expect(g1.nodes, 'no node moved').toEqual(g0.nodes)
    expect(g1.edges, 'no edge changed').toEqual(g0.edges)
    expect(
      g1.frames.map((f) => ({ id: f.id, rect: f.rect })),
      'no frame rect changed',
    ).toEqual(g0.frames.map((f) => ({ id: f.id, rect: f.rect })))
    // the accent is the ONLY delta
    expect(g1.frames.filter((f) => f.color !== null).length).toBe(g0.frames.filter((f) => f.color !== null).length)
  })

  test('a new name and a new accent both survive close then reopen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadPickup(page)
    await frameTitleAtTop(page)

    await titleOf(page, PICKUP_LABEL).click()
    await swatch(page, 'violet').click()
    await nameField(page).fill('Pickup zone')
    await nameField(page).press('Enter')
    await expect(popover(page)).toHaveCount(0)

    await expect(titleOf(page, 'Pickup zone')).toHaveCount(1)
    await expect(frameEl(page, 'Pickup zone')).toHaveAttribute('data-color', 'violet')

    await titleOf(page, 'Pickup zone').click()
    await expect(nameField(page)).toHaveValue('Pickup zone')
    await expect(swatch(page, 'violet')).toHaveAttribute('aria-pressed', 'true')
  })

  test('flip and clamp: below the title when there is room, above it when there is not, and never outside the viewport', async ({
    page,
  }) => {
    // the same desktop size as the rest of this spec: the collapsed-canvas
    // geometry the flip needs was MEASURED at 1280x720 (canvas 98..680 of 720),
    // and the playbar lays out differently at narrower widths.
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadOneFrame(page)
    const screen = await screenSize(page)

    // (a) room below — anchored under the title, left-aligned to it
    await setViewport(page, { x: 120, y: 120, zoom: 1 })
    await titleOf(page, 'Zone').click()
    const title = await boxOf(titleOf(page, 'Zone'))
    let box = await boxOf(popover(page))
    expect(box.y, 'below the title').toBeGreaterThanOrEqual(title.y + title.height)
    expect(Math.abs(box.x - title.x), 'left-aligned to the title').toBeLessThanOrEqual(1)
    await expect(popover(page)).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)

    // (b) no room below. Reached the way a user would: COLLAPSE the timeline,
    // which grows the canvas to within ~40 px of the window's bottom edge
    // (measured: 98..680 of 720), then put the title near the bottom of it.
    // Without that the canvas pane stops 240 px short of the window and a
    // frame title can never be low enough to need a flip — a test that skipped
    // this step would be asserting the placement math through a state the
    // product cannot actually show.
    await page.locator('.pstrip__collapse').click()
    await expect(page.locator('.timeline.is-collapsed')).toHaveCount(1)
    // the class flips before the height settles, so poll the thing actually
    // being asserted rather than the class that precedes it
    const bottomOf = () => page.evaluate(() => document.querySelector('.canvas')!.getBoundingClientRect().bottom)
    await expect
      .poll(bottomOf, { message: 'the collapsed layout reaches the window bottom' })
      .toBeGreaterThan(screen.h - 80)
    const canvasBottom = await bottomOf()

    // 100 px, not 40: the title has to stay INSIDE the canvas pane, otherwise
    // clicking it makes Playwright scroll it into view and React Flow's own
    // scroll handling moves the viewport out from under the measurement (it
    // did — the title landed 340 px higher than the arithmetic said). A title
    // the user cannot see is not a case this feature has to place a panel for.
    await setViewport(page, { x: 120, y: Math.round(canvasBottom) - 100, zoom: 1 })
    await titleOf(page, 'Zone').click()
    const lowTitle = await boxOf(titleOf(page, 'Zone'))
    box = await boxOf(popover(page))
    expect(lowTitle.y + lowTitle.height, 'the title is inside the canvas pane, so it is really clickable').toBeLessThanOrEqual(canvasBottom)
    expect(lowTitle.y, 'and it is low enough in the window to leave no room below').toBeGreaterThan(screen.h - 120)
    expect(box.y + box.height, 'flipped above the title').toBeLessThanOrEqual(lowTitle.y + 1)
    await expect(popover(page)).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')

    // (c) no room to the right — clamped inside, not left hanging off screen
    await setViewport(page, { x: screen.w - 20, y: 150, zoom: 1 })
    await titleOf(page, 'Zone').click()
    box = await boxOf(popover(page))
    expect(box.x + box.width, 'clamped inside the right edge').toBeLessThanOrEqual(screen.w)
    expect(box.x, 'and not pushed off the left').toBeGreaterThanOrEqual(0)
    await expect(popover(page)).toBeInViewport({ ratio: 1 })
  })

  test('mobile and a locked canvas stay view + select only: no popover and no swatch anywhere (LGR-D12 / D6)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const id = await loadOneFrame(page)

    // locked desktop canvas
    await setLocked(page, true)
    await expect(page.locator('.lgr-frame__label--static')).toHaveCount(1)
    // `force` on purpose: a static title is `pointer-events: none`, so a real
    // tap there falls through to the canvas. This is that tap.
    await page.locator('.lgr-frame__label--static').click({ force: true })
    await expect(popover(page), 'no properties popover on a locked canvas').toHaveCount(0)
    await expect(page.locator('.lgr-frame__swatch'), 'no swatch on a locked canvas').toHaveCount(0)
    await setLocked(page, false)

    // mobile — a desktop-set accent still RENDERS, it just cannot be changed
    await page.evaluate((i) => (window as unknown as { __loop: Loop }).__loop.frame.getState().setFrameColor(i, 'violet'), id)
    await page.setViewportSize({ width: 390, height: 780 })
    await expect(page.locator('.lgr-frame-back rect.lgr-frame__fill[data-color="violet"]')).toHaveCount(1)
    await expect(page.locator('.lgr-frame__label--static')).toHaveCount(1)
    await page.locator('.lgr-frame__label--static').click({ force: true })
    await expect(popover(page), 'no properties popover on mobile').toHaveCount(0)
    await expect(page.locator('.lgr-frame__swatch'), 'no swatch on mobile').toHaveCount(0)
  })

  test('keyboard: Enter on the title opens it and focuses the name; Tab reaches the swatches; Escape closes it and returns focus to the title', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadOneFrame(page)
    await setViewport(page, { x: 200, y: 200, zoom: 1 })

    await titleOf(page, 'Zone').focus()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeVisible()
    await expect(nameField(page), 'focus lands in the name field').toBeFocused()

    await page.keyboard.press('Tab')
    await expect(popover(page).locator('.lgr-frame__swatch').first(), 'Tab reaches the colour row').toBeFocused()

    // §LGR6.6's destructive-key guard covers the popover as a whole, not just
    // its text field: Delete with a SWATCH focused must not delete the frame
    // the popover is editing.
    await page.keyboard.press('Delete')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.lgr-frame'), 'the frame is still here').toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(titleOf(page, 'Zone'), 'focus comes back to the title').toBeFocused()
  })

  test('Escape cancels the name — it is not committed on the way out', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadOneFrame(page)
    await setViewport(page, { x: 200, y: 200, zoom: 1 })

    await titleOf(page, 'Zone').click()
    // wait for focus before Escape: without this the key can land on the
    // document instead, and the test would pass by not exercising the path.
    await expect(nameField(page)).toBeFocused()
    await nameField(page).fill('Renamed')
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)

    // §FC10 closes on a TASK of its own, and the close focuses the title chip
    // again. That focus move leaves the still-mounted panel, which is exactly
    // the blur the commit path listens to — a cancel must not be turned into a
    // commit by its own focus return.
    await expect(titleOf(page, 'Zone')).toBeFocused()
    expect((await geometry(page)).frames.length).toBe(1)
    await expect(titleOf(page, 'Zone'), 'the name is unchanged').toHaveText('Zone')
    await expect(titleOf(page, 'Renamed')).toHaveCount(0)

    // and reopening shows the stored name, not the abandoned draft
    await titleOf(page, 'Zone').click()
    await expect(nameField(page)).toHaveValue('Zone')
  })

  test('a press outside still COMMITS the name — the ordinary way out is unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadOneFrame(page)
    await setViewport(page, { x: 200, y: 200, zoom: 1 })

    await titleOf(page, 'Zone').click()
    await expect(nameField(page)).toBeFocused()
    await nameField(page).fill('Committed')
    await swatch(page, 'gold').click()

    // the counterpart of the Escape test above: the guard that stops a CANCEL
    // from committing must not also stop the ordinary commit.
    const vp0 = await viewport(page)
    const pane = await panePoint(page)
    await page.mouse.click(pane.x, pane.y)
    await expect(popover(page)).toHaveCount(0)

    await expect(titleOf(page, 'Committed')).toHaveCount(1)
    await expect(frameEl(page, 'Committed')).toHaveAttribute('data-color', 'gold')
    expect(await viewport(page), 'and the dismissing press did not pan').toEqual(vp0)

    await titleOf(page, 'Committed').click()
    await expect(nameField(page)).toHaveValue('Committed')
    await expect(swatch(page, 'gold')).toHaveAttribute('aria-pressed', 'true')
  })

  test('while the popover is open the canvas neither pans nor zooms', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await loadPickup(page)
    await frameTitleAtTop(page)

    await titleOf(page, PICKUP_LABEL).click()
    await expect(popover(page)).toBeVisible()
    const vp0 = await viewport(page)
    const pane = await panePoint(page)

    // a wheel over the canvas does nothing at all, and does NOT dismiss: the
    // canvas is frozen while the popover is open, so there is nothing to react
    // to and nothing to drift from.
    await page.mouse.move(pane.x, pane.y)
    await page.mouse.wheel(0, 240)
    expect(await viewport(page), 'the wheel did not zoom the canvas').toEqual(vp0)
    await expect(popover(page), 'and the popover is still open').toBeVisible()

    // a pane drag dismisses it — and the gesture that dismisses it still does
    // not pan, which is the half that used to break
    await page.mouse.down()
    await page.mouse.move(pane.x - 160, pane.y - 120, { steps: 8 })
    await page.mouse.up()
    expect(await viewport(page), 'the drag did not pan the canvas').toEqual(vp0)
    await expect(popover(page), 'the drag dismissed it').toHaveCount(0)
  })
})

/** A screen point that really is the empty React Flow pane — a drag aimed at a
 *  node or at frame chrome would prove nothing about panning. Scanned rather
 *  than guessed, because the gacha graph is dense. */
async function panePoint(page: Page): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate(() => {
    for (let y = 120; y < window.innerHeight - 60; y += 40) {
      for (let x = 60; x < window.innerWidth - 60; x += 40) {
        const el = document.elementFromPoint(x, y)
        if (el && el.classList.contains('react-flow__pane')) return { x, y }
      }
    }
    return null
  })
  if (!pt) throw new Error('no empty pane point found')
  return pt
}
