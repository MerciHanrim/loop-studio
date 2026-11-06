import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { keepPanelDetailsOpen } from './support/panel'

// SEMANTICS-R12.md (issue #478) — a flow node's icon through the real UI: the
// Inspector's Icon field and its keyboard path, the mark before the name and its
// hide rule, the accessible name, the left panel's row, the file and the run.

const graphDoc = (iconOnGold?: string) =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny', icon: 'sun' } },
      { id: 'gold', type: 'pool', position: { x: 260, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 10, capacity: 100, mode: 'pullAny', ...(iconOnGold ? { icon: iconOnGold } : {}) } },
      { id: 'sink', type: 'drain', position: { x: 520, y: 40 }, data: { kind: 'drain', label: 'Spend', activation: 'automatic', mode: 'pullAny', icon: 'not-registered' } },
      { id: 'p1', type: 'parameter', position: { x: 260, y: 220 }, data: { kind: 'parameter', label: 'Rate', value: 2, icon: 'cloud' } },
    ],
    edges: [
      { id: 'e1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
      { id: 'e2', type: 'loop', source: 'gold', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    ],
  })

async function load(page: Page, json = graphDoc()): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, json)
  await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()
  await setZoom(page, 1)
  await keepPanelDetailsOpen(page)
}

const setZoom = (page: Page, zoom: number) =>
  page.evaluate(
    (z) => (window as unknown as { __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } } }).__loop.rf.setViewport({ x: 80, y: 160, zoom: z }, { duration: 0 }),
    zoom,
  )

const iconOf = (page: Page, id: string) =>
  page.evaluate((i) => ((window as any).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === i)?.data?.icon ?? null) as string | null, id)
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
const mark = (page: Page, id: string) => node(page, id).locator('.nodef__name .nodef__icon')
const field = (page: Page) => page.locator('.icon-field')
const fieldButton = (page: Page) => field(page).locator('.icon-field__button')

test.describe('node icon — the file and the canvas', () => {
  test('a registered id draws before the name; an unregistered id and a Parameter’s value are dropped on read', async ({ page }) => {
    await load(page)
    await expect(mark(page, 'src')).toHaveAttribute('data-icon', 'sun')
    expect(await iconOf(page, 'sink')).toBeNull()
    await expect(mark(page, 'sink')).toHaveCount(0)
    expect(await iconOf(page, 'p1')).toBeNull()
    await expect(mark(page, 'p1')).toHaveCount(0)
    // the mark is the line's first child, before the name's text
    const first = await node(page, 'src').locator('.nodef__name').evaluate((el) => (el.firstElementChild as HTMLElement | null)?.getAttribute('data-icon'))
    expect(first).toBe('sun')
  })

  test('the mark is a detail of the L2 level: it leaves the line, with its gap, at L1 and L0', async ({ page }) => {
    await load(page)
    const display = (z: number) => setZoom(page, z).then(() => mark(page, 'src').evaluate((el) => getComputedStyle(el).display))
    expect(await display(1)).not.toBe('none')
    expect(await display(0.8)).not.toBe('none')
    expect(await display(0.6)).toBe('none')
    expect(await display(0.3)).toBe('none')
    expect(await display(1)).not.toBe('none')
    // it stays in the DOM at every level
    await expect(mark(page, 'src')).toHaveCount(1)
  })

  test('the drawing follows the rendered size: the 24-unit drawing from 20 px up', async ({ page }) => {
    await load(page, graphDoc('nuclear-plant'))
    const paths = async () => mark(page, 'gold').evaluate((el) => el.innerHTML.length)
    await setZoom(page, 1)
    const small = await paths()
    await setZoom(page, 1.5)
    const big = await paths()
    expect(big).not.toBe(small)
  })

  test('the icon is in the frame’s accessible name, after the kind and the label, at every zoom', async ({ page }) => {
    await load(page)
    for (const z of [1, 0.3]) {
      await setZoom(page, z)
      const name = await node(page, 'src').locator('.nodef').getAttribute('aria-label')
      expect(name, `zoom ${z}`).toMatch(/Source Mint, Sun/)
    }
  })

  test('the file round-trips the icon, and a document without one stays without the key', async ({ page }) => {
    await load(page, graphDoc('car'))
    const text = await page.evaluate(() => {
      const s = (window as any).__loop.graph.getState()
      return JSON.stringify(s.nodes.map((n: { id: string; data: { icon?: string } }) => [n.id, n.data.icon ?? null]))
    })
    expect(JSON.parse(text)).toEqual([['src', 'sun'], ['gold', 'car'], ['sink', null], ['p1', null]])
  })
})

test.describe('node icon — the gallery is a popover', () => {
  const gallery = (page: Page) => page.getByRole('radiogroup', { name: 'Icon' })
  /** where the Inspector's content is, and how much of it there is */
  const layout = (page: Page) =>
    page.evaluate(() => {
      const panel = document.querySelector('.icon-field')!.closest('aside')!
      return { height: panel.scrollHeight, top: panel.scrollTop, field: document.querySelector('.icon-field')!.getBoundingClientRect().bottom }
    })

  test('it opens over the panel: nothing below it moves, and all of it is on screen', async ({ page }) => {
    await load(page)
    await node(page, 'gold').click()
    await fieldButton(page).scrollIntoViewIfNeeded()
    const closed = await layout(page)
    await fieldButton(page).click()
    await expect(gallery(page)).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('radio', { name: 'None', exact: true })).toBeFocused()
    expect(await layout(page)).toEqual(closed)
    // it is not clipped by the panel's own scroller: the topmost element at its far
    // corner is still the gallery, and it is wider than the panel can show
    const hit = await page.evaluate(() => {
      const g = document.querySelector('.icon-gallery')!
      const r = g.getBoundingClientRect()
      return g.contains(document.elementFromPoint(r.right - 3, r.bottom - 3))
    })
    expect(hit).toBe(true)
  })

  test('near the bottom of the window it opens upward, still whole', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 })
    await load(page)
    await node(page, 'gold').click()
    await fieldButton(page).scrollIntoViewIfNeeded()
    await fieldButton(page).click()
    await expect(gallery(page)).toBeInViewport({ ratio: 1 })
  })

  test('a press outside closes it with no change, and the button toggles it', async ({ page }) => {
    await load(page, graphDoc('wind'))
    await node(page, 'gold').click()
    await fieldButton(page).click()
    await expect(gallery(page)).toBeVisible()
    // inside the Inspector, so the node stays selected and the field stays on screen
    await field(page).locator('.icon-field__title').click()
    await expect(gallery(page)).toHaveCount(0)
    await expect(fieldButton(page)).toBeVisible()
    expect(await iconOf(page, 'gold')).toBe('wind')

    await fieldButton(page).click()
    await expect(gallery(page)).toBeVisible()
    await fieldButton(page).click()
    await expect(gallery(page)).toHaveCount(0)
  })

  test('focus that leaves closes it and stays where it went; Escape on the button closes it too', async ({ page }) => {
    await load(page, graphDoc('wind'))
    await node(page, 'gold').click()
    await fieldButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('radio', { name: 'Wind', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(gallery(page)).toHaveCount(0)
    await expect(fieldButton(page)).not.toBeFocused()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
    expect(await iconOf(page, 'gold')).toBe('wind')

    await fieldButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(gallery(page)).toBeVisible()
    await page.keyboard.press('Shift+Tab')
    await expect(fieldButton(page)).toBeFocused()
    await expect(gallery(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(gallery(page)).toHaveCount(0)
    await expect(fieldButton(page)).toBeFocused()
  })
})

test.describe('node icon — the Inspector’s Icon field', () => {
  test('choose an icon: one undo entry, the mark and the name follow, and the run is not reset', async ({ page }) => {
    await load(page)
    await node(page, 'gold').click()
    await expect(fieldButton(page)).toHaveText('None')
    const rev = await page.evaluate(() => (window as any).__loop.graph.getState().simulationRev)
    await fieldButton(page).click()
    await expect(page.getByRole('radiogroup', { name: 'Icon' })).toBeVisible()
    await page.getByRole('radio', { name: 'Car', exact: true }).click()
    expect(await iconOf(page, 'gold')).toBe('car')
    await expect(mark(page, 'gold')).toHaveAttribute('data-icon', 'car')
    await expect(fieldButton(page)).toHaveText('Car')
    expect(await node(page, 'gold').locator('.nodef').getAttribute('aria-label')).toMatch(/Pool Gold, Car/)
    expect(await page.evaluate(() => (window as any).__loop.graph.getState().simulationRev)).toBe(rev)
    // the gallery closed on the choice, and Undo takes it back
    await expect(page.getByRole('radiogroup', { name: 'Icon' })).toHaveCount(0)
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    expect(await iconOf(page, 'gold')).toBeNull()
    await expect(mark(page, 'gold')).toHaveCount(0)
  })

  test('None removes it', async ({ page }) => {
    await load(page, graphDoc('tree'))
    await node(page, 'gold').click()
    await expect(fieldButton(page)).toHaveText('Tree')
    await fieldButton(page).click()
    await expect(page.getByRole('radio', { name: 'Tree', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('radio', { name: 'None', exact: true }).click()
    expect(await iconOf(page, 'gold')).toBeNull()
  })

  test('the keyboard path: Enter opens on the current option, arrows move, Enter chooses, focus returns, Escape cancels', async ({ page }) => {
    await load(page, graphDoc('wind'))
    await node(page, 'gold').click()
    await fieldButton(page).focus()
    await page.keyboard.press('Enter')
    // focus lands on the current option: a roving tabindex, one stop
    const current = page.getByRole('radio', { name: 'Wind', exact: true })
    await expect(current).toBeFocused()
    await expect(page.locator('.icon-gallery [role="radio"][tabindex="0"]')).toHaveCount(1)
    await page.keyboard.press('ArrowRight')
    // the option after Wind is Strong wind (follow-up 3 of #478 put the weather ids in the picker order)
    await expect(page.getByRole('radio', { name: 'Strong wind', exact: true })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByRole('radio', { name: 'None', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('radio', { name: 'Recycling', exact: true })).toBeFocused()
    // the Tab stop follows focus (Lumi's review of #481): after an arrow move,
    // Tab out and back lands on the option the user left, not on the stored one
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Cloud', exact: true })).toBeFocused()
    await expect(page.locator('.icon-gallery [role="radio"][tabindex="0"]')).toHaveAttribute('data-icon-option', 'cloud')
    await page.keyboard.press('Shift+Tab')
    await expect(fieldButton(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('radio', { name: 'Cloud', exact: true })).toBeFocused()
    await expect(page.locator('.icon-gallery [role="radio"][tabindex="0"]')).toHaveCount(1)
    expect(await iconOf(page, 'gold')).toBe('wind')
    // Escape closes without a change and gives focus back to the button
    await page.keyboard.press('Escape')
    await expect(page.getByRole('radiogroup', { name: 'Icon' })).toHaveCount(0)
    await expect(fieldButton(page)).toBeFocused()
    expect(await iconOf(page, 'gold')).toBe('wind')
    // Enter on an option chooses it and closes, focus back on the button
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    expect(await iconOf(page, 'gold')).toBe('strong-wind')
    await expect(page.getByRole('radiogroup', { name: 'Icon' })).toHaveCount(0)
    await expect(fieldButton(page)).toBeFocused()
  })

  test('a Parameter has no Icon field', async ({ page }) => {
    await load(page)
    await node(page, 'p1').click()
    await expect(field(page)).toHaveCount(0)
  })

  test('a selection of several nodes takes one choice, and a mixed one reads Mixed', async ({ page }) => {
    await load(page)
    await node(page, 'src').click()
    await node(page, 'gold').click({ modifiers: ['Control'] })
    await expect(fieldButton(page)).toHaveText('Mixed')
    await fieldButton(page).click()
    await page.getByRole('radio', { name: 'Water', exact: true }).click()
    expect(await iconOf(page, 'src')).toBe('water')
    expect(await iconOf(page, 'gold')).toBe('water')
  })
})

test.describe('node icon — the left panel', () => {
  test('a row shows the node’s icon in place of the kind mark', async ({ page }) => {
    await load(page)
    const row = page.locator('.wb-row[data-node="src"]')
    await expect(row.locator('svg[data-icon="sun"]')).toHaveCount(1)
    await expect(row.locator('svg[data-kind]')).toHaveCount(0)
    await expect(page.locator('.wb-row[data-node="gold"] svg[data-kind="pool"]')).toHaveCount(1)
  })
})
