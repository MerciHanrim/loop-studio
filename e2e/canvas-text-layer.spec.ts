import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// docs/canvas-text-layer.md — the canvas text layer in the browser, on the 3-zone gacha Template
// (four zones). The placement rules themselves are unit-tested (textPlacement.test.ts).

type Bridge = { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: unknown, o?: unknown) => void } } }

async function overview(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await pickTemplate(page, 'gacha-banner-zones')
  await expect(page.locator('.react-flow__node')).toHaveCount(63)
  await page.locator('.toolbar__actions .wb-viewmenu > .wb-mb').click()
  await page.locator('.wb-viewmenu__pop [data-view-row="reset"]').click()
  await expect(page.locator('.canvas-text__chip[data-kind="zone"]')).toHaveCount(4)
  // the routes settled: a name's place is only kept from then on (before, it is provisional)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __loop: { routeMap: { pending: () => boolean } } }).__loop.routeMap.pending()))
    .toBe(false)
  await page.waitForTimeout(200)
}
const zoomTo = (page: Page, zoom: number) =>
  page.evaluate((zoom) => { const rf = (window as unknown as Bridge).__loop.rf; const v = rf.getViewport(); rf.setViewport({ ...v, zoom }, { duration: 0 }) }, zoom)
const panBy = (page: Page, dx: number, dy: number) =>
  page.evaluate(([dx, dy]) => { const rf = (window as unknown as Bridge).__loop.rf; const v = rf.getViewport(); rf.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 0 }) }, [dx, dy])
/** each zone chip's offset from its zone's own box, on screen */
const zoneOffsets = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.canvas-text__chip[data-kind="zone"]')].map((c) => {
      const r = c.getBoundingClientRect()
      const fr = [...document.querySelectorAll('.lgr-frame')].find((f) => (f.querySelector('.lgr-frame__label')?.textContent ?? '').trim() === c.textContent)!.getBoundingClientRect()
      return { text: c.textContent, dx: Math.round(r.left - fr.left), dy: Math.round(r.top - fr.top) }
    }),
  )

test.describe('canvas text layer (docs/canvas-text-layer.md)', () => {
  test('zone names on the layer below 8 px, gone above it; the zone chips keep their place but show nothing', async ({ page }) => {
    await overview(page)
    const layer = page.locator('.canvas-text')
    await expect(layer).toHaveCSS('pointer-events', 'none')
    await expect(layer).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.lgr-frame.is-layer-named')).toHaveCount(4)
    // the layer's names are the chips' titles; the chips' own text is transparent
    const titles = await page.locator('.lgr-frame .lgr-frame__label').allTextContents()
    expect((await page.locator('.canvas-text__chip[data-kind="zone"]').allTextContents()).sort()).toEqual(titles.map((s) => s.trim()).sort())
    await expect(page.locator('.lgr-frame.is-layer-named .lgr-frame__label').first()).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    // each name stands on its zone's top border at 12 px
    await expect(page.locator('.canvas-text__chip[data-kind="zone"]').first()).toHaveCSS('font-size', '12px')
    // at 8 / 11 and above the chips speak for themselves again
    await zoomTo(page, 0.75)
    await expect(page.locator('.canvas-text__chip')).toHaveCount(0)
    await expect(page.locator('.lgr-frame.is-layer-named')).toHaveCount(0)
  })

  test('the layer takes no clicks: a zone chip under its name still opens the zone, a node under a name is still the node', async ({ page }) => {
    await overview(page)
    // every point of every layer name hits something under the layer, never the layer
    const hits = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.canvas-text__chip')].map((c) => {
        const r = c.getBoundingClientRect()
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { onLayer: !!e?.closest('.canvas-text'), frameChip: !!e?.closest('.lgr-frame__label') }
      }),
    )
    expect(hits.every((h) => !h.onLayer)).toBe(true)
    // the layer changes nothing for the pointer: at the centre of every name, the element the
    // pointer reaches is the same with the layer drawn and with it removed
    const reached = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.canvas-text__chip')].map((c) => {
          const r = c.getBoundingClientRect()
          const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return e ? `${e.tagName}.${e.getAttribute('class') ?? ''}|${e.closest('[data-id]')?.getAttribute('data-id') ?? ''}` : ''
        }),
      )
    const withLayer = await reached()
    const without = await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>('.canvas-text')!
      const chips = [...layer.querySelectorAll<HTMLElement>('.canvas-text__chip')].map((c) => c.getBoundingClientRect())
      layer.style.display = 'none'
      const out = chips.map((r) => { const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? `${e.tagName}.${e.getAttribute('class') ?? ''}|${e.closest('[data-id]')?.getAttribute('data-id') ?? ''}` : '' })
      layer.style.display = ''
      return out
    })
    expect(withLayer).toEqual(without)
    // a real click on a node under the layer still selects that node
    const pity = page.locator('.react-flow__node[data-id="pity_pickup"]')
    await pity.locator('.nodef__stroke').click({ force: true })
    await expect(pity.locator('.nodef')).toHaveClass(/is-selected/)
  })

  test('keyboard: a zone named on the layer still takes focus and selection, and its chip shows a focus ring', async ({ page }) => {
    await overview(page)
    // a Template opens under the edit lock, where a zone's chip is display-only text; unlocked, it
    // is the button that opens the zone's properties
    await page.evaluate(() => (window as unknown as { __loop: { ui: { getState: () => { setCanvasLocked: (b: boolean) => void } } } }).__loop.ui.getState().setCanvasLocked(false))
    const zone = page.locator('.lgr-frame.is-layer-named', { has: page.locator('.lgr-frame__label', { hasText: 'Premium Pickup' }) })
    // the zone itself is the focus unit: its own ring (a pseudo-element) is drawn while its name is
    // on the layer. A key press first, so the browser treats the focus as keyboard focus
    // (:focus-visible), as a Tab would
    await page.keyboard.press('Shift')
    await zone.focus()
    await expect(zone).toBeFocused()
    const ring = await zone.evaluate((el) => { const s = getComputedStyle(el, '::after'); return { style: s.borderTopStyle, width: s.borderTopWidth } })
    expect(ring).toEqual({ style: 'solid', width: '2px' })
    // the ZONE focused: its name on the layer takes a DASHED ring (the chip's is solid)
    const name = page.locator('.canvas-text__chip[data-kind="zone"]', { hasText: 'Premium Pickup' })
    await expect(name).toHaveAttribute('data-focus', 'zone')
    await expect(name).toHaveCSS('outline-style', 'dashed')
    await expect(name).toHaveCSS('outline-width', '2px')
    // the other names are not marked
    await expect(page.locator('.canvas-text__chip[data-focus]')).toHaveCount(1)
    // Enter selects it; Tab then reaches its chip, which draws its focus ring though its text is hidden
    await page.keyboard.press('Enter')
    await expect(zone).toHaveClass(/is-selected/)
    const chip = zone.locator('.lgr-frame__label')
    await chip.focus()
    await expect(chip).toBeFocused()
    expect(await chip.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
    await expect(chip).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    // the CHIP focused: the name the reader sees shows the focus too (the layer itself takes no focus)
    await expect(name).toHaveAttribute('data-focus', 'chip')
    await expect(name).toHaveCSS('outline-style', 'solid')
    await expect(name).toHaveCSS('outline-width', '2px')
    await page.keyboard.press('Enter')
    await expect(page.locator('.lgr-frame-props, [role="dialog"]').first()).toBeVisible()
  })

  test('the selected name: one selection only (several selected → no name), at 12 px beside its node, gone with the selection', async ({ page }) => {
    await overview(page)
    const pity = page.locator('.react-flow__node[data-id="pity_pickup"]')
    await pity.locator('.nodef__stroke').click({ force: true })
    await page.mouse.move(2, 2)
    const chip = page.locator('.canvas-text__chip[data-kind="node"]')
    await expect(chip).toHaveText('Pity')
    await expect(chip).toBeVisible()
    // it covers no node symbol
    const covers = await page.evaluate(() => {
      const r = document.querySelector('.canvas-text__chip[data-kind="node"]')!.getBoundingClientRect()
      return [...document.querySelectorAll('.react-flow__node .nodef__stroke')].some((s) => { const b = s.getBoundingClientRect(); return r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom })
    })
    expect(covers).toBe(false)
    // a second node added to the selection: no name (one only)
    await page.locator('.react-flow__node[data-id="ticket_pickup"] .nodef__stroke').click({ force: true, modifiers: ['ControlOrMeta'] })
    await expect(page.locator('.react-flow__node .nodef.is-selected')).toHaveCount(2)
    await expect(chip).toHaveCount(0)
    // the selection cleared: no name
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
    await expect(chip).toHaveCount(0)
  })

  test('a new place waits for the routes to settle, and never for good: held unsettled, the name still appears', async ({ page }) => {
    await overview(page)
    // hold the routes unsettled, as a route generation that never finishes would: `busy` set, and
    // the app's own writes kept from clearing it. Then ask for a NEW place: select a node.
    await page.evaluate(() => {
      const inputs = (window as unknown as { __loop: { routeMap: { inputs: { setState: (p: object) => void; getState: () => { busy: boolean } } } } }).__loop.routeMap.inputs
      const set = inputs.setState
      ;(window as unknown as { __unhold: () => void }).__unhold = () => { inputs.setState = set }
      inputs.setState = (p: object) => set({ ...p, busy: true })
      set({ busy: true })
    })
    // the times the name's chip is held back and shown, recorded in the page as they happen
    await page.evaluate(() => {
      const w = window as unknown as { __held: { from: number | null; to: number | null } }
      w.__held = { from: null, to: null }
      new MutationObserver(() => {
        const c = document.querySelector<HTMLElement>('.canvas-text__chip[data-kind="node"]')
        if (!c) return
        if (c.dataset.hidden === 'provisional') w.__held.from ??= performance.now()
        else if (w.__held.from !== null && !c.dataset.hidden) w.__held.to ??= performance.now()
      }).observe(document.querySelector('.canvas-text')!, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-hidden'] })
    })
    await page.locator('.react-flow__node[data-id="pity_pickup"] .nodef__stroke').click({ force: true })
    await page.mouse.move(2, 2)
    const chip = page.locator('.canvas-text__chip[data-kind="node"]')
    // first provisional: placed, not shown
    await expect(chip).toHaveAttribute('data-hidden', 'provisional')
    await expect(chip).toHaveCSS('visibility', 'hidden')
    // then shown after the wait (SETTLE_WAIT_MS, 1.5 s), the routes still held
    await expect(chip).not.toHaveAttribute('data-hidden', /.+/, { timeout: 5000 })
    await expect(chip).toBeVisible()
    // measured in the page, from the moment the name was held back to the moment it was shown:
    // never longer than SETTLE_WAIT_MS (1.5 s), and not much shorter (the routes were never settled)
    const held = await page.evaluate(() => { const h = (window as unknown as { __held: { from: number; to: number } }).__held; return h.to - h.from })
    test.info().annotations.push({ type: 'held-ms', description: String(Math.round(held)) })
    expect(held).toBeLessThanOrEqual(1500)
    expect(held).toBeGreaterThanOrEqual(1300)
    expect(await page.evaluate(() => (window as unknown as { __loop: { routeMap: { inputs: { getState: () => { busy: boolean } } } } }).__loop.routeMap.inputs.getState().busy)).toBe(true)
    await page.evaluate(() => (window as unknown as { __unhold: () => void }).__unhold())
  })

  test('the places are kept over a pan', async ({ page }) => {
    await overview(page)
    await page.locator('.react-flow__node[data-id="pity_pickup"] .nodef__stroke').click({ force: true })
    await page.mouse.move(2, 2)
    const side = await page.locator('.canvas-text__chip[data-kind="node"]').getAttribute('data-side')
    const before = await zoneOffsets(page)
    await panBy(page, 60, -30)
    await expect.poll(() => zoneOffsets(page)).toEqual(before)
    await expect(page.locator('.canvas-text__chip[data-kind="node"]')).toHaveAttribute('data-side', side!)
  })
})

// §CTL5 — the lines are read over several frames (2026-11-15). One read of every line of the
// Early MMO (144 lines, about 52,000 points) was a single frame of about 0.9 s; now the layer
// samples for at most 16 ms in a frame (40 ms while a name waits for the lines) and goes on in
// the frames after. Read from the layer's own record of its reads (dev builds).
test.describe('canvas text layer — the lines are read over several frames (§CTL5)', () => {
  type Read = { t: number; ms: number; lines: boolean; sampled: number; left: number; budget: number; points: number }
  type MmoBridge = { __loop: { rf: { fitView: (o: object) => void; getViewport: () => { zoom: number } }; routeMap: { pending: () => boolean }; graph: { getState: () => { nodes: { id: string; selected?: boolean }[]; edges: unknown[]; setSelection: (n: string | null, e: string | null) => void; onNodesChange: (c: object[]) => void } } }; __canvasTextReads?: Read[] }
  const MMO = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')
  const lineReads = (page: Page) => page.evaluate(() => ((window as unknown as MmoBridge).__canvasTextReads ?? []).filter((r) => r.lines))
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]
  /** the MMO at the overview (a zoom that puts a selected name on the layer), its routes settled */
  async function openMmo(page: Page): Promise<void> {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => { (window as unknown as MmoBridge).__canvasTextReads = [] })
    await importGraph(page, MMO)
    await expect(page.locator('.react-flow__node')).toHaveCount(97)
    await page.evaluate(() => (window as unknown as MmoBridge).__loop.rf.fitView({ duration: 0, padding: 0.1 }))
    await expect.poll(() => page.evaluate(() => (window as unknown as MmoBridge).__loop.rf.getViewport().zoom)).toBeLessThan(0.5)
  }
  /** the read has ended: lines were read, and the last read of them left none */
  const whole = async (page: Page) => {
    await expect.poll(async () => { const rs = await lineReads(page); return rs.length > 0 && rs[rs.length - 1].left === 0 }, { timeout: 20_000 }).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as unknown as MmoBridge).__loop.routeMap.pending()), { timeout: 20_000 }).toBe(false)
    await page.waitForTimeout(400)
    await expect.poll(async () => { const rs = await lineReads(page); return rs[rs.length - 1].left }, { timeout: 20_000 }).toBe(0)
  }

  test('the Early MMO: many short reads instead of one long one, and every line read by the end', async ({ page }) => {
    await openMmo(page)
    await whole(page)
    const rs = await lineReads(page)
    const edges = await page.evaluate(() => (window as unknown as MmoBridge).__loop.graph.getState().edges.length)
    expect(edges).toBe(144)
    // the read was split: reads that left lines for the next frame, then one that left none
    expect(rs.filter((r) => r.left > 0).length, 'reads that left lines for a later frame').toBeGreaterThanOrEqual(5)
    expect(rs[rs.length - 1].left).toBe(0)
    // every line was sampled (a line whose route changed while the routes settled, more than once)
    expect(rs.reduce((s, r) => s + r.sampled, 0), 'lines sampled in all').toBeGreaterThanOrEqual(edges)
    // the points of the whole read: about 52,000 for these 144 lines at 3 world px
    expect(rs[rs.length - 1].points).toBeGreaterThan(40_000)
    // each read keeps to its budget. A stalled machine can stretch one read, so the reading
    // held is the typical one, with room for a slow runner; the single 0.9 s read is far outside it
    expect(new Set(rs.map((r) => r.budget)), 'no name waits here: the 16 ms budget').toEqual(new Set([16]))
    test.info().annotations.push({ type: 'line-reads', description: `${rs.length} reads, median ${median(rs.map((r) => r.ms))} ms, longest ${Math.max(...rs.map((r) => r.ms))} ms` })
    expect(median(rs.map((r) => r.ms)), 'the typical read, ms').toBeLessThan(60)
  })

  test('a name asked for while the lines are being read waits for them, with the larger budget, and then shows', async ({ page }) => {
    await openMmo(page)
    // at once, before the read can have ended: select the node nearest the pane's centre
    const id = await page.evaluate(() => {
      const w = window as unknown as MmoBridge
      const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
      let best = '', bd = Infinity
      for (const el of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const r = el.getBoundingClientRect()
        const d = Math.hypot(r.left + r.width / 2 - (pane.left + pane.width / 2), r.top + r.height / 2 - (pane.top + pane.height / 2))
        if (d < bd && el.querySelector('.nodef__name')?.textContent?.trim()) { bd = d; best = el.dataset.id! }
      }
      const g = w.__loop.graph.getState()
      g.setSelection(best, null)
      g.onNodesChange([{ id: best, type: 'select', selected: true }])
      return best
    })
    expect(id).not.toBe('')
    const chip = page.locator('.canvas-text__chip[data-kind="node"]')
    // held back first (the lines are not known yet, and the routes are settling) ...
    await expect(chip).toHaveAttribute('data-hidden', 'provisional')
    // ... then shown, never hidden for good
    await expect(chip).not.toHaveAttribute('data-hidden', /.+/, { timeout: 10_000 })
    await expect(chip).toBeVisible()
    await whole(page)
    const rs = await lineReads(page)
    // while the name waited the layer read with the larger budget
    expect(rs.some((r) => r.budget === 40), 'reads with the 40 ms budget while the name waited').toBe(true)
    expect(rs[rs.length - 1].left).toBe(0)
    // and the name is still shown once everything is read, on a side
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('data-side', /^\d@(8|14)$/)
  })

  test('a smaller document: its lines are read whole too', async ({ page }) => {
    await overview(page)
    const rs = await page.evaluate(() => ((window as unknown as MmoBridge).__canvasTextReads ?? []).filter((r) => r.lines))
    // the 3-zone gacha's lines (about 16,000 points) take a few frames at 16 ms each; the read
    // of them ends whole
    expect(rs.length).toBeGreaterThan(0)
    expect(rs[rs.length - 1].left).toBe(0)
    expect(rs[rs.length - 1].points).toBeGreaterThan(5000)
  })
})
