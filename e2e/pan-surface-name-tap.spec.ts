import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #421 item 4 (Lumi, 2026-11-01) — the pan-capture layer (the phone, and
// Pan mode on a computer) resolves a tap on a node by geometry. A node's hit
// region is its body, its outside name AND the bridge between them, the boxes
// the node draws (the ones `nameFootprintsOf` reads); where nodes overlap, the
// one drawn on top is chosen. Until now only the body counted: a tap on the
// name selected nothing.

type Bridge = { __loop: { graph: { getState: () => { selectedNodeId: string | null; onNodesChange: (c: unknown[]) => void; nodes: { id: string; position: { x: number; y: number } }[] } }; ui: { setState: (p: object) => void } } }
type Rect = { x: number; y: number; w: number; h: number }
const selected = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().selectedNodeId)
/** nothing selected, as before a tap */
const clear = async (page: Page) => {
  await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { setSelection: (n: null, e: null) => void } } } }).__loop.graph.getState().setSelection(null, null))
  await expect.poll(() => selected(page)).toBeNull()
}
const LAYER = '.react-flow .pan-surface--active'
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

/** the drawn boxes of a node, screen px: body, name, and the bridge between them */
const boxes = (page: Page, id: string) =>
  page.evaluate((nid) => {
    const n = document.querySelector(`.react-flow__node[data-id="${nid}"]`)!
    const r = (el: Element | null) => {
      const b = el?.getBoundingClientRect()
      return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null
    }
    return { body: r(n.querySelector('.nodef')), name: r(n.querySelector('.nodef__name')), bridge: r(n.querySelector('.nodef__bridge')) }
  }, id) as Promise<{ body: Rect | null; name: Rect | null; bridge: Rect | null }>
const centre = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node[data-id="ore_stock"] .nodef__name')).toBeVisible()
}

/** the name and the bridge lie outside the body: the taps below are on them, not on it */
async function nameAndBridge(page: Page, id: string) {
  const b = await boxes(page, id)
  expect(b.body && b.name && b.bridge, 'body, name and bridge drawn').toBeTruthy()
  const inBody = (p: { x: number; y: number }) => p.x >= b.body!.x && p.x <= b.body!.x + b.body!.w && p.y >= b.body!.y && p.y <= b.body!.y + b.body!.h
  const name = centre(b.name!)
  const bridge = centre(b.bridge!)
  expect(inBody(name), 'the name centre is outside the body').toBe(false)
  expect(inBody(bridge), 'the bridge centre is outside the body').toBe(false)
  return { name, bridge }
}

test.describe('phone: a tap on a node’s outside name or its bridge selects the node (#421)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the name, the bridge, and (control) the body', async ({ page }) => {
    await load(page)
    const p = await nameAndBridge(page, 'ore_stock')
    await page.touchscreen.tap(p.name.x, p.name.y)
    await expect.poll(() => selected(page)).toBe('ore_stock')
    await clear(page)
    await page.touchscreen.tap(p.bridge.x, p.bridge.y)
    await expect.poll(() => selected(page)).toBe('ore_stock')
    await clear(page)
    const body = centre((await boxes(page, 'ore_stock')).body!)
    await page.touchscreen.tap(body.x, body.y)
    await expect.poll(() => selected(page)).toBe('ore_stock')
  })
})

test.describe('computer, Pan mode: a click on a node’s outside name or its bridge selects the node (#421)', () => {
  async function panMode(page: Page) {
    await load(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.setState({ panMode: true }))
    await expect(page.locator(LAYER)).toHaveCount(1)
  }

  test('the name and the bridge', async ({ page }) => {
    await panMode(page)
    const p = await nameAndBridge(page, 'ore_stock')
    await page.mouse.click(p.name.x, p.name.y)
    await expect.poll(() => selected(page)).toBe('ore_stock')
    await clear(page)
    await page.mouse.click(p.bridge.x, p.bridge.y)
    await expect.poll(() => selected(page)).toBe('ore_stock')
  })

  test('where a name lies over another node, the node drawn on top is chosen', async ({ page }) => {
    await panMode(page)
    // another node moved so that its body sits over ore_stock's name
    const other = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return g.nodes.find((n) => n.id !== 'ore_stock')!.id
    })
    const nb = (await boxes(page, 'ore_stock')).name!
    const flow = await page.evaluate(({ nid, x, y }) => {
      // screen → flow through the node's own position and box
      const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`)!.getBoundingClientRect()
      const g = (window as unknown as Bridge).__loop.graph.getState()
      const n = g.nodes.find((k) => k.id === nid)!
      const vp = (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform
      const zoom = Number(/scale\(([^)]+)\)/.exec(vp)?.[1] ?? 1)
      return { x: n.position.x + (x - el.x) / zoom, y: n.position.y + (y - el.y) / zoom }
    }, { nid: 'ore_stock', x: nb.x, y: nb.y })
    await page.evaluate(({ id, x, y }) => (window as unknown as Bridge).__loop.graph.getState().onNodesChange([{ type: 'position', id, position: { x, y }, dragging: false }]), { id: other, x: flow.x - 4, y: flow.y - 8 })
    await frames(page)
    const at = centre(nb)
    // which node is drawn on top there: the browser's own stacking, read with the layer out of the way
    const top = await page.evaluate(({ x, y, sel }) => {
      const layer = document.querySelector(sel) as HTMLElement
      layer.style.pointerEvents = 'none'
      const hit = document.elementsFromPoint(x, y).map((e) => e.closest('.react-flow__node')?.getAttribute('data-id')).find((v) => v != null) ?? null
      layer.style.pointerEvents = ''
      return hit
    }, { ...at, sel: LAYER })
    await clear(page)
    expect([other, 'ore_stock']).toContain(top)
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => selected(page)).toBe(top)

    // the other one selected (a selection may change the stacking): the tap
    // still takes whichever node the browser draws on top there
    const under = top === 'ore_stock' ? other : 'ore_stock'
    await clear(page)
    await page.evaluate((id) => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { setSelection: (n: string, e: null) => void; onNodesChange: (c: unknown[]) => void } } } }).__loop.graph.getState()
      g.setSelection(id, null)
      g.onNodesChange([{ type: 'select', id, selected: true }])
    }, under)
    await frames(page)
    const top2 = await page.evaluate(({ x, y, sel }) => {
      const layer = document.querySelector(sel) as HTMLElement
      layer.style.pointerEvents = 'none'
      const hit = document.elementsFromPoint(x, y).map((e) => e.closest('.react-flow__node')?.getAttribute('data-id')).find((v) => v != null) ?? null
      layer.style.pointerEvents = ''
      return hit
    }, { ...at, sel: LAYER })
    expect([other, 'ore_stock']).toContain(top2)
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => selected(page)).toBe(top2)
  })
})
