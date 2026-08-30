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

// a deliberately overflowing label. The VISIBLE (pre-ellipsis) part is Latin +
// accents — covered by the bundled IBM Plex face, so the pixels are
// deterministic across machines; the multi-script / emoji tail lives only in
// the DOM (asserted separately) and never reaches the clip.
const LONG = "Trésor d'or — a deliberately very long label that overflows · 黄金の保管庫 · Хранилище · 🪙"

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
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef')).toHaveAttribute('aria-label', /pool /)
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

    // Parameter notch silhouette vs Register lozenge — the non-colour kind tell
    await expect(page.locator('.react-flow__node[data-id="p_big"] .nodef--parameter .nodef__stroke')).toHaveAttribute('d', /M40 12/)
    await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef--register .nodef__stroke')).toHaveAttribute('d', /M30 12/)

    await expect(page.locator('.react-flow')).toHaveScreenshot(`forced-colors-${level}.png`, shotOpts(page))
    await page.emulateMedia({ forcedColors: null })
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
      page.locator('.react-flow__edges animateMotion, .flow-move, .flow-bead, .flow-trail, .state-pulse, .state-flash'),
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
