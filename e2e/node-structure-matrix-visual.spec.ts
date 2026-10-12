import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, snap, test } from './support/loop'
import { MATRIX_GRAPH, MATRIX_IDS } from './support/nodeMatrix'

// Node structure — the NEW node's pixel matrix: every kind, at L2 / L1 / L0, in
// light, dark and forced colours, with a selected Pool, a keyboard-focused
// Parameter, an invalid Register, a fired Source (ticks) and the evaluated
// bracket on the empty chain — the same scene `node-structure-matrix.spec.ts`
// reads from the DOM. Desktop only (the phone has no on-canvas selection or
// focus cue). The baselines are reviewed per row before they are committed
// (Lumi, 2026-10-12); `snap()` applies the desktop-canvas-clip tolerance.

const Z = { L2: 1, L1: 0.6, L0: 0.32 } as const
type Level = keyof typeof Z
type Scheme = 'light' | 'dark' | 'forced'

type Loop = {
  rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void }
  sim: { getState: () => { stepOnce: () => void; firedNodeIds: Iterable<string> } }
}

async function load(page: Page, scheme: Scheme): Promise<void> {
  await page.emulateMedia({
    colorScheme: scheme === 'dark' ? 'dark' : 'light',
    forcedColors: scheme === 'forced' ? 'active' : 'none',
    reducedMotion: 'reduce',
  })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, MATRIX_GRAPH)
  await expect(page.locator('.nodef--outside')).toHaveCount(MATRIX_IDS.length)
  await page.evaluate(() => document.fonts.ready)
}

/** the scene's centre (the compact 3 × 4 grid with its names, about 760 × 420) at a level, exactly */
async function setLevel(page: Page, level: Level): Promise<void> {
  const z = Z[level]
  // the viewport is pane-relative: centre the scene in the PANE (980 x 462 with
  // the timeline open), not in the page, or the bottom row falls below the clip
  await page.evaluate((zz) => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    ;(window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: Math.round(pane.width / 2 - 380 * zz), y: Math.round(pane.height / 2 - 210 * zz), zoom: zz }, { duration: 0 })
  }, z)
  for (const id of MATRIX_IDS) await expect(page.locator(`.react-flow__node[data-id="${id}"] .nodef`)).toHaveClass(new RegExp(`lod-${level}\\b`))
  await page.waitForTimeout(120)
}

for (const scheme of ['light', 'dark', 'forced'] as const) {
  for (const level of ['L2', 'L1', 'L0'] as const) {
    test(`node matrix — ${scheme} · ${level}`, async ({ page }) => {
      await load(page, scheme)
      // one committed step (the Source fires; the empty chain is evaluated)
      await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().stepOnce())
      await expect.poll(() => page.evaluate(() => [...(window as unknown as { __loop: Loop }).__loop.sim.getState().firedNodeIds])).toContain('feed')
      await setLevel(page, 'L2')
      await page.locator('.react-flow__node[data-id="store"] .nodef').click()
      await expect(page.locator('.react-flow__node[data-id="store"] .nodef__sel')).toHaveCount(1)
      await page.locator('.react-flow__node[data-id="p1"]').focus()
      await expect(page.locator('.react-flow__node[data-id="p1"] .nodef__focus')).toHaveCount(1)
      await page.mouse.move(2, 2) // no hover form in the shot
      await setLevel(page, level)
      await expect(page.locator('.react-flow__node[data-id="r_bad"] .nodef__flag')).toHaveText('!')
      await expect(page.locator('.react-flow')).toHaveScreenshot(
        ...snap(page, `node-matrix-${scheme}-${level}`, { mask: [page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')] }),
      )
    })
  }
}
