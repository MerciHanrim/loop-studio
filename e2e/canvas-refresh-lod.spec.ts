import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL7 (zoom LOD) / §VL8 (forced-colors) / §VL10–VL12 —
// Canvas Visual Refresh PR 3. Three world-zoom detail levels:
//   L2 ≥ 0.8   full body + edge flow chip + grid
//   L1 0.45–0.8  title + value only; no grid; no edge chip
//   L0 < 0.45   silhouette + type dot only; no text
// Elision fades SUPPLEMENTARY TEXT ONLY. At every level the node keeps its
// position, size, hit target and silhouette; edges keep class + direction; the
// selection / focus / invalid / run cues and the accessible name all survive.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 0, capacity: 20, mode: 'pullAny', resourceType: 'Gold' } },
    { id: 'split', type: 'gate', position: { x: 480, y: 0 }, data: { kind: 'gate', label: 'Split', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'sink', type: 'drain', position: { x: 720, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
    { id: 'p_rate', type: 'parameter', position: { x: 0, y: 220 }, data: { kind: 'parameter', label: 'Rate', value: 2.5, min: 0, max: 10, unit: 'x' } },
    { id: 'r_flip', type: 'register', position: { x: 240, y: 220 }, data: { kind: 'register', label: 'Flip', expr: '100 / @gold' } }, // invalid while gold === 0
  ],
  edges: [
    { id: 'e_sg', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_gs', type: 'loop', source: 'gold', target: 'split', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
    { id: 'e_sd', type: 'loop', source: 'split', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 's_fb', type: 'loop', source: 'gold', target: 'src', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name: 'g.json',
    mimeType: 'application/json',
    buffer: Buffer.from(GRAPH, 'utf8'),
  })
  await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path')).toHaveCount(1)
  await page.evaluate(() => document.fonts.ready)
}

const zoom = (page: Page) =>
  page.evaluate(() => {
    const t = (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform
    return parseFloat(/scale\(([-0-9.]+)\)/.exec(t)![1])
  })

/** wheel toward a target world-zoom at the canvas centre */
async function zoomTo(page: Page, target: number): Promise<number> {
  const box = (await page.locator('.react-flow__pane').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 80; i++) {
    const z = await zoom(page)
    if (Math.abs(z - target) <= 0.05) return z
    await page.mouse.wheel(0, z > target ? 130 : -130)
    await page.waitForTimeout(25)
  }
  return zoom(page)
}

const lodOf = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"] .nodef`).evaluate((el) => (el.className.match(/lod-\w+/) || [''])[0])

type Geo = { positions: string; boxes: string; edgePaths: string; hitPaths: string; viewport: string; digest: string; canUndo: boolean; canRedo: boolean }
async function geo(page: Page): Promise<Geo> {
  return page.evaluate(() => {
    const l = (window as unknown as { __loop: { graph: { getState: () => any }; revisionIO: { currentTargetDigest: () => string } } }).__loop
    const g = l.graph.getState()
    const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null
    const box = (id: string) => {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"] .nodef`) as HTMLElement | null
      if (!el) return null
      const z = parseFloat(/scale\(([-0-9.]+)\)/.exec(vp!.style.transform)![1])
      const r = el.getBoundingClientRect()
      // world-space footprint — must not change with zoom
      return [id, Math.round(r.width / z), Math.round(r.height / z)]
    }
    return {
      digest: l.revisionIO.currentTargetDigest(),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      positions: JSON.stringify(g.nodes.map((n: any) => [n.id, n.position.x, n.position.y, n.measured?.width ?? null, n.measured?.height ?? null])),
      boxes: JSON.stringify(['src', 'gold', 'split', 'sink', 'p_rate', 'r_flip'].map(box)),
      edgePaths: JSON.stringify([...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => (p as SVGPathElement).getAttribute('d'))),
      hitPaths: JSON.stringify([...document.querySelectorAll('.react-flow__edge path.react-flow__edge-interaction')].map((p) => (p as SVGPathElement).getAttribute('d'))),
      viewport: '', // set by caller when it matters
    }
  })
}

test.describe('Canvas Refresh PR 3 — zoom LOD (§VL7)', () => {
  test('L2 / L1 / L0 switch at the fixed thresholds and only fade supplementary text', async ({ page }) => {
    await load(page)

    // ── L2 (detail) ──
    await zoomTo(page, 1.2)
    expect(await zoom(page)).toBeGreaterThanOrEqual(0.8)
    expect(await lodOf(page, 'gold')).toBe('lod-L2')
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__body')).toBeVisible()
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__sub')).toBeVisible()
    await expect(page.locator('[data-edge-id="e_sg"]')).toBeVisible() // edge flow chip
    await expect(page.locator('.react-flow__background')).toHaveCount(1) // grid on

    // ── L1 (compact) ──
    const z1 = await zoomTo(page, 0.6)
    expect(z1).toBeGreaterThanOrEqual(0.45)
    expect(z1).toBeLessThan(0.8)
    expect(await lodOf(page, 'gold')).toBe('lod-L1')
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__title')).toBeVisible() // title kept
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__value')).toBeVisible() // value kept
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__sub')).toBeHidden() // sub elided
    await expect(page.locator('[data-edge-id="e_sg"]')).toHaveCount(0) // no edge chip
    await expect(page.locator('.react-flow__background')).toHaveCount(0) // grid off entering L1

    // ── L0 (map) ──
    await zoomTo(page, 0.3)
    expect(await zoom(page)).toBeLessThan(0.45)
    expect(await lodOf(page, 'gold')).toBe('lod-L0')
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__body')).toBeHidden() // no text
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__cdot')).toHaveCount(1) // type dot
    await expect(page.locator('.react-flow__background')).toHaveCount(0)
  })

  test('the §VL7.1 required set survives at L0 — role, edge class + direction, rings, invalid, accessible name', async ({ page }) => {
    await load(page)
    await zoomTo(page, 0.3)
    expect(await lodOf(page, 'r_flip')).toBe('lod-L0')

    // role silhouette — parameter's notch path vs register's lozenge, still drawn
    await expect(page.locator('.react-flow__node[data-id="p_rate"] .nodef--parameter .nodef__stroke')).toHaveAttribute('d', /M40 12/)
    await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef--register .nodef__stroke')).toHaveAttribute('d', /M30 12/)

    // edge class + direction — solid vs dashed + the tokenised arrow, unchanged
    const res = await page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path').evaluate((el) => getComputedStyle(el).strokeDasharray)
    const st = await page.locator('.react-flow__edge[data-id="s_fb"] path.react-flow__edge-path').evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(res).toMatch(/none|^0/)
    expect(st).toMatch(/\d/)
    expect(await page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path').getAttribute('marker-end')).toBe('url(#loop-arrow-resource)')

    // invalid Register (gold === 0 at rest) — dashed --warning ring + `!` flag, still there
    await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid')).toHaveCount(1)
    await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__flag')).toHaveText('!')

    // selection + keyboard focus rings — hue-independent, still shown at L0
    await page.locator('.react-flow__node[data-id="gold"]').click()
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__sel')).toHaveCount(1)
    await page.locator('.react-flow__node[data-id="p_rate"]').focus()
    await expect(page.locator('.react-flow__node[data-id="p_rate"] .nodef__focus')).toHaveCount(1)

    // accessible name — on the element for AT even with the body visually hidden
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef')).toHaveAttribute('aria-label', /pool Gold/)

    // hit target — the node's clickable box is the SAME world size as at L2
    const wL0 = await page.locator('.react-flow__node[data-id="gold"] .nodef').evaluate((el) => {
      const z = parseFloat(/scale\(([-0-9.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)![1])
      const r = el.getBoundingClientRect()
      return [Math.round(r.width / z), Math.round(r.height / z)]
    })
    await zoomTo(page, 1.2)
    const wL2 = await page.locator('.react-flow__node[data-id="gold"] .nodef').evaluate((el) => {
      const z = parseFloat(/scale\(([-0-9.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)![1])
      const r = el.getBoundingClientRect()
      return [Math.round(r.width / z), Math.round(r.height / z)]
    })
    expect(wL0).toEqual(wL2)
  })

  test('a zoom sweep + threshold round-trip moves NO geometry and restores the exact state', async ({ page }) => {
    await load(page)
    await zoomTo(page, 1.2)
    const base = await geo(page)
    expect(await lodOf(page, 'gold')).toBe('lod-L2')

    for (const z of [0.6, 0.3, 0.6, 1.2]) await zoomTo(page, z)

    const after = await geo(page)
    expect(after.positions, 'node positions / measured size').toBe(base.positions)
    expect(after.boxes, 'world-space node footprints').toBe(base.boxes)
    expect(after.edgePaths, 'edge routes').toBe(base.edgePaths)
    expect(after.hitPaths, 'edge hit areas').toBe(base.hitPaths)
    expect(after.digest, 'canonical revision digest').toBe(base.digest)
    expect(after.canUndo).toBe(base.canUndo)
    expect(after.canRedo).toBe(base.canRedo)
    // back at L2 ⇒ the full detail view is restored exactly (no hysteresis)
    expect(await lodOf(page, 'gold')).toBe('lod-L2')
    await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__sub')).toBeVisible()
    await expect(page.locator('.react-flow__background')).toHaveCount(1)
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the L2/L1/L0 required set holds in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await load(page)

      for (const [z, want] of [[1.2, 'lod-L2'], [0.6, 'lod-L1'], [0.3, 'lod-L0']] as const) {
        await zoomTo(page, z)
        expect(await lodOf(page, 'gold'), `${scheme} @ ${z}`).toBe(want)
        // required set at every cell: silhouette stroke drawn, invalid ring on r_flip, aria name present
        expect(
          await page.locator('.react-flow__node[data-id="gold"] .nodef__stroke').evaluate((el) => Number(getComputedStyle(el).strokeWidth.replace('px', ''))),
        ).toBeGreaterThan(0)
        await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid')).toHaveCount(1)
        await expect(page.locator('.react-flow__node[data-id="gold"] .nodef')).toHaveAttribute('aria-label', /pool Gold/)
      }
      await page.emulateMedia({ colorScheme: null })
    })
  }

  test('reduced motion × L0 — run cue is the static held highlight, still no travel', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await load(page)
    await zoomTo(page, 0.3)
    await page.locator('.pstrip button[title="Advance one step"]').click()
    // no travelling element at any zoom under reduce…
    await expect(page.locator('.react-flow__edges animateMotion, .flow-move, .state-pulse')).toHaveCount(0)
    // …and the run-in-progress cue (required set) is still present at L0
    await expect(page.locator('.react-flow__edge[data-id="e_sg"] .flow-edge-pulse')).toHaveCount(1)
    await page.emulateMedia({ reducedMotion: null })
  })
})

test.describe('Canvas Refresh PR 3 — forced-colors (§VL8)', () => {
  test('under forced-colors: active, edge class + every required cue stays distinguishable without hue', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page)
    await zoomTo(page, 1.2)

    // resource vs state — solid vs dashed survives the colour override
    const res = await page.locator('.react-flow__edge[data-id="e_sg"] path.react-flow__edge-path').evaluate((el) => getComputedStyle(el).strokeDasharray)
    const st = await page.locator('.react-flow__edge[data-id="s_fb"] path.react-flow__edge-path').evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(res).toMatch(/none|^0/)
    expect(st).toMatch(/\d/)

    // the direction marker is still there and painted
    await expect(page.locator('svg.loop-edge-defs .loop-arrow')).toHaveCount(3)
    const arrowFill = await page.locator('#loop-arrow-resource path').evaluate((el) => getComputedStyle(el).fill)
    expect(arrowFill).toMatch(/^rgb/)

    // node silhouettes drawn; register lozenge vs parameter notch keep their shape
    for (const id of ['gold', 'p_rate', 'r_flip']) {
      const w = await page.locator(`.react-flow__node[data-id="${id}"] .nodef__stroke`).evaluate((el) => Number(getComputedStyle(el).strokeWidth.replace('px', '')))
      expect(w).toBeGreaterThan(0)
    }

    // invalid Register — dashed ring + `!` flag (shape + glyph, not colour)
    await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid')).toHaveCount(1)
    expect(await page.locator('.react-flow__node[data-id="r_flip"] .nodef__invalid').evaluate((el) => getComputedStyle(el).strokeDasharray)).toMatch(/\d/)
    await expect(page.locator('.react-flow__node[data-id="r_flip"] .nodef__flag')).toHaveText('!')

    // selection SOLID vs focus DASHED — the non-colour tell still differs
    await page.locator('.react-flow__node[data-id="gold"]').click()
    await page.locator('.react-flow__node[data-id="r_flip"]').focus()
    const selDash = await page.locator('.react-flow__node[data-id="gold"] .nodef__sel').evaluate((el) => getComputedStyle(el).strokeDasharray)
    const focDash = await page.locator('.react-flow__node[data-id="r_flip"] .nodef__focus').evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(selDash).toMatch(/none|^0/)
    expect(focDash).toMatch(/\d/)

    await page.emulateMedia({ forcedColors: null })
  })
})
