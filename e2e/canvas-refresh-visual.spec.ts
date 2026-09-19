import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL7 / §VL8 / §VL11.2 / §VL12 — the Canvas Visual
// Refresh acceptance MATRIX, with real pixels, not only the DOM.
//
//   • 12 committed baselines: 2 device (desktop / mobile — the two Playwright
//     projects) × 2 theme (light / dark) × 3 zoom (L2 / L1 / L0), from ONE
//     long-content fixture. Non-deterministic chrome (build stamp) is outside
//     the `.react-flow` clip; the minimap + attribution are masked; fonts are
//     awaited and the run cue is frozen before the shot.
//   • forced-colors: rendered-style evidence for every required cue + a shot.
//   • reduced-motion: per LOD × device — no motion element, static cue kept.
//   • mobile: controls / run bar / update bar / node hit targets / direction
//     marker all inside the viewport; zero horizontal document scroll.

// docs/visual-language.md §VL11.2 — role separation, NOT a cut in multi-script
// support. §MML1 made a long title WRAP in full (no ellipsis), so the whole
// string now reaches the pixel clip. A CJK / Cyrillic / emoji tail then renders
// with whatever glyphs the runner's OS fonts happen to provide — not
// deterministic between Windows builds. So this pixel fixture uses a long
// LATIN-only string (bundled IBM Plex, identical on every machine): it still
// wraps to several lines with no ellipsis, grows the vessel to its ceiling, and
// exercises the unbreakable-token fallback. The multi-script / CJK / Cyrillic /
// emoji stress case moved to `node-long-label.spec.ts`, which asserts the same
// guarantees (full string kept, no sideways spill, silhouette grows, handles
// re-centre) from the DOM and never compares pixels.
const LONG =
  "Trésor d'or — a deliberately very long operating label that wraps across several lines, plus superlongunbreakabletokenwithnospaces"

const FIXTURE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 320, y: 0 }, data: { kind: 'pool', label: LONG, activation: 'passive', initial: 999999, capacity: 2000000, mode: 'pullAny', resourceType: 'Gold' } },
    { id: 'split', type: 'gate', position: { x: 700, y: 40 }, data: { kind: 'gate', label: 'Split', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'sink', type: 'drain', position: { x: 960, y: 40 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
    { id: 'p_big', type: 'parameter', position: { x: 0, y: 270 }, data: { kind: 'parameter', label: LONG, value: 123456.78, min: -1000, max: 1e9, unit: 'crédits/秒' } },
    { id: 'p_neg', type: 'parameter', position: { x: 360, y: 270 }, data: { kind: 'parameter', label: 'Δ drift', value: -42.5, unit: 'Δ' } },
    { id: 'r_ok', type: 'register', position: { x: 680, y: 270 }, data: { kind: 'register', label: 'Revenue total', expr: '@gold * @p_big', unit: '¤' } },
    { id: 'r_bad', type: 'register', position: { x: 980, y: 270 }, data: { kind: 'register', label: 'Ratio (broken)', expr: '1 / (@gold - @gold)' } },
  ],
  edges: [
    { id: 'e_sg', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_gs', type: 'loop', source: 'gold', target: 'split', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
    { id: 'e_ss', type: 'loop', source: 'split', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 's_fb', type: 'loop', source: 'gold', target: 'src', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

const Z = { L2: 1, L1: 0.6, L0: 0.32 } as const
type Level = keyof typeof Z

const isMobileViewport = (page: Page) => (page.viewportSize()?.width ?? 1280) < 500

async function load(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, FIXTURE) // loadJSON bridge — works on desktop and mobile
  await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path')).toHaveCount(1)
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
}

/** exact, repeatable viewport — a chosen world point centred at a chosen zoom */
async function centreOn(page: Page, wx: number, wy: number, z: number): Promise<void> {
  const vs = page.viewportSize()!
  await page.evaluate(
    ({ z, x, y }) =>
      (window as unknown as { __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } } }).__loop.rf.setViewport(
        { x, y, zoom: z },
        { duration: 0 },
      ),
    { z, x: Math.round(vs.width / 2 - wx * z), y: Math.round(vs.height / 2 - wy * z) },
  )
  await page.waitForTimeout(120)
}

/** the long-content fixture centred at the given detail level */
const setLod = (page: Page, level: Level) => centreOn(page, 480, 180, Z[level])

const zoom = (page: Page) =>
  page.evaluate(() =>
    parseFloat(/scale\(([-0-9.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)![1]),
  )

const step = (page: Page) => page.locator('button[aria-label="Advance one step"], button[title="Advance one step"]').first().click()

const stepIndex = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __loop: { sim: { getState: () => { stepIndex: number } } } }).__loop.sim.getState().stepIndex,
  )

/** The run cue in the matrix / forced-colors shots is a REAL step: src pushes 3
 *  into gold and the `all` split drains the rest, so gold reads 3 (not the
 *  fixture's 999999). Asserted before the shot because a baseline that
 *  disagreed with this state once survived the 2 % pixel gate (review
 *  2026-09-18); L0 has no value row, so the text check is L1/L2 only. */
async function expectStepped(page: Page, level: Level): Promise<void> {
  await expect.poll(() => stepIndex(page)).toBe(1)
  if (level !== 'L0') await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__value')).toHaveText('3')
}

const shotOpts = (page: Page) => ({
  mask: [page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')],
  maxDiffPixelRatio: 0.02,
})

// Desktop shows selection + keyboard focus ON the canvas. Mobile's tap opens the
// read-only Inspector sheet instead (there is no on-canvas selection cue), so on
// the mobile project we leave the node unselected — the mobile matrix cell is
// the honest touch-canvas state.
async function selectFocusGold(page: Page): Promise<void> {
  if (isMobileViewport(page)) return
  await page.locator('.react-flow__node[data-id="gold"]').click()
}
async function focusGold(page: Page): Promise<void> {
  if (isMobileViewport(page)) return
  await page.locator('.react-flow__node[data-id="gold"]').focus()
}
const onCanvasSelection = (page: Page) => !isMobileViewport(page)

// ── 1. the 12-cell pixel matrix ────────────────────────────────────────────
for (const scheme of ['light', 'dark'] as const) {
  for (const level of ['L2', 'L1', 'L0'] as const) {
    test(`matrix — ${scheme} · ${level} (device = project)`, async ({ page }) => {
      await load(page, scheme)
      await selectFocusGold(page) // desktop: select the long-label pool
      // a real run cue, then let the single-shot bead settle + freeze
      await step(page)
      await page.waitForTimeout(1200)
      await focusGold(page) // desktop: keyboard-focus AFTER the run-bar click stole it
      await setLod(page, level)
      await expectStepped(page, level)
      await expect(page.locator('.react-flow')).toHaveScreenshot(`matrix-${scheme}-${level}.png`, shotOpts(page))
    })
  }
}

// ── 2. "only text hides, essential info stays" — the DOM side of the claim ──
test('L2 → L1 → L0 elide only supplementary text; the long label / big + negative values / flag are never truncated away', async ({ page }) => {
  await load(page, 'light')

  // L2: the full long label is on the element (ellipsised in view, complete for AT)
  await setLod(page, 'L2')
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__title')).toHaveText(LONG)
  await expect(page.locator('.react-flow__node[data-id="p_neg"] .nodef__value')).toHaveText(/-42\.5/)
  await expect(page.locator('.react-flow__node[data-id="p_neg"] .nodef__sub')).toHaveText('Δ')
  await expect(page.locator('.react-flow__node[data-id="p_big"] .nodef__value')).toHaveText(/123456\.78|123,456/)
  // `r_ok`'s value + unit line is the WIDEST line of that node (here R(0) =
  // `123456656543.22 ¤`), so it is the one a mis-sized inset clips first
  // (docs/node-shell-content-in-vessel.md): rendered in full, never ellipsised
  await expect(page.locator('.react-flow__node[data-id="r_ok"] .nodef__value')).toContainText('¤')
  expect(
    await page.locator('.react-flow__node[data-id="r_ok"] .nodef__value').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'r_ok value must not ellipsise',
  ).toBe(true)
  await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__flag')).toHaveText('!')
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__body')).toBeVisible()
  // the vessel is never stretched by the label — the node box stays within the cap
  const w = await page.locator('.react-flow__node[data-id="gold"] .nodef').evaluate((el) => el.getBoundingClientRect().width)
  const z = await zoom(page)
  expect(Math.round(w / z)).toBeLessThanOrEqual(262)

  // L1: title + value kept; the `sub` line (unit / capacity / expr) is elided
  await setLod(page, 'L1')
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__title')).toHaveText(LONG)
  await expect(page.locator('.react-flow__node[data-id="p_neg"] .nodef__value')).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id="p_neg"] .nodef__sub')).toBeHidden()
  await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__invalid')).toHaveCount(1)
  await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__flag')).toHaveText('!')

  // L0: no text at all; silhouette + type dot + the required flags remain
  await setLod(page, 'L0')
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__body')).toBeHidden()
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__cdot')).toHaveCount(1)
  await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__invalid')).toHaveCount(1)
  await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__flag')).toHaveText('!')
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef')).toHaveAttribute('aria-label', /^Pool /)
})

// ── 3. forced-colors: rendered-style evidence for every required cue + a shot ─
for (const level of ['L2', 'L0'] as const) {
  test(`forced-colors: active — ${level}: every required cue survives the colour override (rendered style + pixels)`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' })
    await load(page, 'light')
    await selectFocusGold(page) // desktop: select gold
    await step(page)
    await page.waitForTimeout(1000)
    await setLod(page, level)
    await focusGold(page) // desktop: gold now selected + keyboard-focused (§VL3 stacking)

    const dash = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).strokeDasharray)

    // resource SOLID vs state DASHED — the edge class tell
    expect(await dash('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path'), 'resource solid').toMatch(/none|^0/)
    expect(await dash('.react-flow__edge[data-id="s_fb"] path.react-flow__edge-path'), 'state dashed').toMatch(/\d/)

    // direction marker — actually rendered, not display:none / visibility:hidden,
    // and painted to a real colour (this is the "SVG marker disappears" check)
    expect(await page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path').getAttribute('marker-end')).toBe('url(#loop-arrow-resource)')
    const arrow = await page.locator('#loop-arrow-resource path').evaluate((el) => {
      const c = getComputedStyle(el)
      return { fill: c.fill, vis: c.visibility, disp: c.display, op: Number(c.opacity) }
    })
    expect(arrow.vis).not.toBe('hidden')
    expect(arrow.disp).not.toBe('none')
    expect(arrow.op).toBeGreaterThan(0)
    expect(arrow.fill).toMatch(/^rgb/)

    // selection SOLID vs focus DASHED — stacked on the same node (desktop canvas)
    if (onCanvasSelection(page)) {
      expect(await dash('.react-flow__node[data-id="gold"] .nodef__sel'), 'selection solid').toMatch(/none|^0/)
      expect(await dash('.react-flow__node[data-id="gold"] .nodef__focus'), 'focus dashed').toMatch(/\d/)
    }

    // invalid — outer dashed ring + the `!` flag
    expect(await dash('.react-flow__node[data-id="r_bad"] .nodef__invalid'), 'invalid dashed').toMatch(/\d/)
    await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__flag')).toHaveText('!')

    // Parameter tag silhouette (`M14 12 … H1 …`, the left tab) vs Register
    // flattened lozenge (`M14 12 H110 …`, no tab) — the non-colour kind tell
    // (docs/node-shell-content-in-vessel.md)
    await expect(page.locator('.react-flow__node[data-id="p_big"] .nodef--parameter .nodef__stroke')).toHaveAttribute('d', /^M14 12 .* H1 /)
    await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef--register .nodef__stroke')).toHaveAttribute('d', /^M14 12 H110 /)

    await expectStepped(page, level)
    await expect(page.locator('.react-flow')).toHaveScreenshot(`forced-colors-${level}.png`, shotOpts(page))
    await page.emulateMedia({ forcedColors: null })
  })
}

// ── 3b. §LGR12.3 — the selection count is not a canvas overlay ──────────────
// docs/large-graph-readability.md §LGR12.3. Measured before the fix, at L0 the
// bottom-centre "N nodes selected" panel covered the top 18.6 px of `p_big`
// (and, with the locked wording, `p_neg` too) — under the 2 % pixel gate, so
// the matrix baselines never caught it. This is the GEOMETRIC guard: the
// readout's rect is disjoint from the canvas and from every node, and nothing
// paints over it. Desktop only — on mobile there is no on-canvas selection
// (see `selectFocusGold`) and the readout has its own rules (mobile.spec.ts).
type Rect = { x: number; y: number; w: number; h: number }
const disjoint = (a: Rect, b: Rect) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
/** the part of a node that is actually on screen: its rect clipped to the
 *  canvas (`.canvas-col` is overflow:hidden, so a node half past the canvas
 *  edge paints nothing beyond it — `getBoundingClientRect` still reports the
 *  full box). `null` when nothing of it is visible. */
const clipTo = (r: Rect, c: Rect): Rect | null => {
  const x = Math.max(r.x, c.x)
  const y = Math.max(r.y, c.y)
  const w = Math.min(r.x + r.w, c.x + c.w) - x
  const h = Math.min(r.y + r.h, c.y + c.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

/** the readout's rect, the canvas rect, every node's rect, and what
 *  `elementFromPoint` finds at the readout's centre (`'self'` = the readout
 *  itself or a descendant) */
const selectionCountGeometry = (page: Page) =>
  page.evaluate(() => {
    const rr = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }
    const count = document.querySelector('.lgr-selection-count')
    if (!count) return null
    const c = rr(count)
    const hit = document.elementFromPoint(c.x + c.w / 2, c.y + c.h / 2)
    return {
      count: c,
      text: count.textContent ?? '',
      inCanvasDom: count.closest('.react-flow') != null,
      inRightColumn: count.closest('.rightcol') != null,
      canvas: rr(document.querySelector('.react-flow')!),
      nodes: [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.getAttribute('data-id'), rect: rr(n) })),
      hit: hit && count.contains(hit) ? 'self' : (hit?.className || hit?.tagName || 'none').toString(),
    }
  })

for (const level of ['L0', 'L2'] as const) {
  test(`§LGR12.3 selection count — ${level}: outside the canvas, off every node, not occluded (unlocked + locked)`, async ({ page }) => {
    test.skip(isMobileViewport(page), 'desktop-only readout; the mobile rules are in mobile.spec.ts')
    await load(page, 'light')
    await selectFocusGold(page)
    await setLod(page, level)
    const setLocked = (v: boolean) =>
      page.evaluate(
        (locked) =>
          (window as unknown as { __loop: { ui: { getState: () => { setCanvasLocked: (x: boolean) => void } } } }).__loop.ui
            .getState()
            .setCanvasLocked(locked),
        v,
      )
    for (const locked of [false, true]) {
      await setLocked(locked)
      await page.waitForTimeout(100)
      const g = await selectionCountGeometry(page)
      expect(g, 'the readout exists while a node is selected').not.toBeNull()
      expect(g!.text).toContain('1 node selected')
      if (locked) expect(g!.text).toContain('unlock editing')
      expect(g!.inCanvasDom, 'not inside the canvas DOM').toBe(false)
      expect(g!.inRightColumn, 'in the right column, above the Inspector').toBe(true)
      expect(disjoint(g!.count, g!.canvas), `rect disjoint from the canvas: ${JSON.stringify(g!.count)} vs ${JSON.stringify(g!.canvas)}`).toBe(true)
      for (const n of g!.nodes) {
        const visible = clipTo(n.rect, g!.canvas)
        if (!visible) continue
        expect(disjoint(g!.count, visible), `rect disjoint from the visible part of node ${n.id}`).toBe(true)
      }
      expect(g!.hit, 'nothing paints over the readout').toBe('self')
    }
    await setLocked(false)
  })
}

// ── 4. reduced-motion, per LOD × device ────────────────────────────────────
for (const level of ['L2', 'L1', 'L0'] as const) {
  test(`reduced-motion — ${level}: no travelling element at any zoom, the static run cue is kept`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await load(page, 'light')
    await step(page)
    await setLod(page, level)
    await expect(
      page.locator('.react-flow__edges animateMotion, .flow-move, .flow-bead, .flow-trail, .state-move'),
    ).toHaveCount(0)
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] .flow-edge-pulse')).toHaveCount(1)
    await page.emulateMedia({ reducedMotion: null })
  })
}

// ── 5. mobile viewport & safe-area (mobile project only) ───────────────────
test.describe('mobile viewport & safe-area', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 500, 'mobile project only')

  for (const level of ['L2', 'L1', 'L0'] as const) {
    test(`${level}: controls / run bar / update bar fit; a centred node is not occluded by chrome; no sideways scroll`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await load(page, 'light')
      // force the PWA update bar into the layout too (dev has no SW)
      await page.evaluate(() =>
        (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop.pwa.setState({
          waitingWorker: { fake: true },
          dismissedWorker: null,
        }),
      )
      await expect(page.locator('.pwa-update')).toBeVisible()
      await step(page)
      // centre a SHORT-label node so its own box fits — the long-label case is
      // exercised by the pixel matrix, not by "fits a phone"
      await centreOn(page, 700, 40, Z[level])

      const vw = page.viewportSize()!
      const inside = (b: { x: number; y: number; width: number; height: number } | null, slack = 1) =>
        !!b && b.x >= -slack && b.y >= -slack && b.x + b.width <= vw.width + slack && b.y + b.height <= vw.height + slack

      // chrome MUST fit the phone viewport
      const controls = await page.locator('.react-flow__controls').boundingBox()
      const runBar = await page.locator('.pstrip--mobile').boundingBox()
      const updateBar = await page.locator('.pwa-update').boundingBox()
      expect(inside(controls), 'React Flow controls fit').toBe(true)
      expect(inside(runBar), 'fixed run bar fits').toBe(true)
      expect(inside(updateBar), 'PWA update bar fits').toBe(true)
      // the run bar and the update bar stack, they do not overlap
      expect(runBar!.y >= updateBar!.y + updateBar!.height - 1 || updateBar!.y >= runBar!.y + runBar!.height - 1, 'run bar / update bar do not overlap').toBe(true)

      // a centred node's hit target is inside the viewport AND clear of the run bar
      const node = await page.locator('.react-flow__node[data-id="split"]').boundingBox()
      expect(inside(node, 2), 'centred node hit target inside viewport').toBe(true)
      expect(node!.y + node!.height <= runBar!.y + 1, 'centred node is not occluded by the run bar').toBe(true)

      // the direction marker renders on mobile
      await expect(page.locator('svg.loop-edge-defs .loop-arrow')).toHaveCount(3)
      const edge = page.locator('.react-flow__edge[data-id="e_gs"] path.react-flow__edge-path')
      expect(await edge.getAttribute('marker-end')).toBe('url(#loop-arrow-resource)')
      const eb = await edge.boundingBox()
      expect(!!eb && eb.x + eb.width > 0 && eb.x < vw.width && eb.y + eb.height > 0 && eb.y < vw.height, 'edge (with its arrow) is on-canvas').toBe(true)

      // the document itself never scrolls sideways
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement
        return el.scrollWidth - el.clientWidth
      })
      expect(overflow, 'no horizontal document overflow').toBeLessThanOrEqual(0)
    })
  }
})
