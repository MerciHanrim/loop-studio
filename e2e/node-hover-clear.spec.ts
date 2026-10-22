import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { MATRIX_GRAPH, MATRIX_IDS } from './support/nodeMatrix'

// The new node's hover form (a thicker outline and the name underlined) clears
// when the pointer leaves. It used to stay on: a click selects the node and a
// focus change re-renders it, which replaces the element the pointer last
// entered; if the pointer then left before the browser hit-tested again, no
// `mouseleave` reached the node (observed: 4 runs in 5 kept it, 2026-10-22).
// The selection and the keyboard focus stay as they are; only the hover form goes.

const Z = { L2: 0.84, L1: 0.6, L0: 0.32 } as const
type Level = keyof typeof Z
type Scheme = 'light' | 'dark' | 'forced'

async function load(page: Page, scheme: Scheme) {
  await page.emulateMedia({ colorScheme: scheme === 'dark' ? 'dark' : 'light', forcedColors: scheme === 'forced' ? 'active' : 'none', reducedMotion: 'reduce' })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, MATRIX_GRAPH)
  await expect(page.locator('.nodef--outside')).toHaveCount(MATRIX_IDS.length)
}
async function setLevel(page: Page, level: Level) {
  await page.evaluate((z) => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport({ x: Math.round(pane.width / 2 - 333 * z), y: Math.round(pane.height / 2 - 210 * z), zoom: z }, { duration: 0 })
  }, Z[level])
  await expect(page.locator('.react-flow__node[data-id="store"] .nodef')).toHaveClass(new RegExp(`lod-${level}\\b`))
}
const store = (page: Page) => page.locator('.react-flow__node[data-id="store"] .nodef')
const hovered = (page: Page) => page.locator('.nodef.is-hover')
/** the pointer goes to the menu bar, off the canvas */
const leave = (page: Page) => page.mouse.move(2, 2)

for (const scheme of ['light', 'dark', 'forced'] as const) {
  for (const level of ['L2', 'L1', 'L0'] as const) {
    test(`${scheme} · ${level}: click a node, move the focus to another, leave at once — no hover form; selection and focus kept`, async ({ page }) => {
      await load(page, scheme)
      await setLevel(page, level)
      // repeated: the lost leave was a race (4 runs in 5)
      for (let i = 0; i < 4; i++) {
        await store(page).click()
        await page.locator('.react-flow__node[data-id="p1"]').focus()
        await leave(page)
        await expect(hovered(page), `round ${i + 1}`).toHaveCount(0)
        await expect(store(page)).toHaveClass(/is-selected/)
        await expect(page.locator('.react-flow__node[data-id="p1"] .nodef')).toHaveClass(/is-focused/)
      }
    })
  }
}

test('the real keyboard: click a node, Tab on, leave at once — no hover form, the selection kept', async ({ page }) => {
  await load(page, 'light')
  await setLevel(page, 'L2')
  for (let i = 0; i < 4; i++) {
    await store(page).click()
    await page.keyboard.press('Tab')
    await leave(page)
    await expect(hovered(page), `round ${i + 1}`).toHaveCount(0)
    await expect(store(page)).toHaveClass(/is-selected/)
  }
})

test('pan and zoom while pointed at, then leave — no hover form', async ({ page }) => {
  await load(page, 'light')
  await setLevel(page, 'L2')
  await store(page).hover()
  await expect(store(page)).toHaveClass(/is-hover/)
  // zoom to L1 under the pointer (the node re-renders at the new level), then leave
  await setLevel(page, 'L1')
  await leave(page)
  await expect(hovered(page)).toHaveCount(0)
  // pan while pointed at, then leave
  await setLevel(page, 'L2')
  await store(page).hover()
  await page.evaluate(() => {
    const rf = (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: object, o: object) => void } } }).__loop.rf
    const v = rf.getViewport()
    rf.setViewport({ x: v.x + 30, y: v.y + 20, zoom: v.zoom }, { duration: 0 })
  })
  await leave(page)
  await expect(hovered(page)).toHaveCount(0)
})

test('pointing still shows the hover form, and moving inside the node keeps it', async ({ page }) => {
  await load(page, 'light')
  await setLevel(page, 'L2')
  const b = (await store(page).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await expect(store(page)).toHaveClass(/is-hover/)
  await page.mouse.move(b.x + b.width / 2 + 6, b.y + b.height / 2 + 6, { steps: 4 })
  await expect(store(page)).toHaveClass(/is-hover/)
  await expect(hovered(page)).toHaveCount(1)
  await leave(page)
  await expect(hovered(page)).toHaveCount(0)
})
