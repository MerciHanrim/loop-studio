import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/visual-language.md §VL0 follow-up — the node-type hue wash (`.nodef__hue`)
// and the edge-label contrast bump land at a pixel delta small enough that
// canvas-refresh-visual.spec.ts's committed screenshot matrix passes UNCHANGED
// (see PR #141) — those baselines do not actually pin this contract. This file
// locks the underlying wiring with computed-style / DOM assertions instead of
// pixels: every render-priority and colour-token guarantee the design review
// required, so a future edit that quietly breaks one of them fails CI even
// though it might not move enough pixels to fail a screenshot diff.

const FIXTURE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 5, mode: 'pullAny' } },
    { id: 'gate', type: 'gate', position: { x: 520, y: 0 }, data: { kind: 'gate', label: 'Gate', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'conv', type: 'converter', position: { x: 780, y: 0 }, data: { kind: 'converter', label: 'Conv', activation: 'automatic', mode: 'pullAny' } },
    { id: 'sink', type: 'drain', position: { x: 1040, y: 0 }, data: { kind: 'drain', label: 'Sink', activation: 'automatic', mode: 'pullAny' } },
    { id: 'end', type: 'end', position: { x: 1300, y: 0 }, data: { kind: 'end', label: 'End' } },
    { id: 'far', type: 'pool', position: { x: 0, y: 400 }, data: { kind: 'pool', label: 'Far', activation: 'passive', initial: 1, mode: 'pullAny' } },
    { id: 'p1', type: 'parameter', position: { x: 260, y: 400 }, data: { kind: 'parameter', label: 'P', value: 1 } },
  ],
  edges: [
    { id: 'e_sg', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e_gg', type: 'loop', source: 'gold', target: 'gate', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
    { id: 'e_gc', type: 'loop', source: 'gate', target: 'conv', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e_cs', type: 'loop', source: 'conv', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

const HUE_KINDS = ['src', 'gold', 'gate', 'conv', 'sink', 'end'] as const

async function load(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, FIXTURE)
  await expect(page.locator('.react-flow__node[data-id="gold"]')).toBeVisible()
}

test('the node-type hue wash renders on every flow-kind node at the --node-hue-opacity token', async ({ page }) => {
  await load(page)
  const tokenOpacity = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--node-hue-opacity').trim(),
  )
  expect(tokenOpacity).toBe('0.04')

  for (const id of HUE_KINDS) {
    const hue = page.locator(`.react-flow__node[data-id="${id}"] .nodef__hue`)
    await expect(hue).toHaveCount(1)
    const fillOpacity = await hue.evaluate((el) => getComputedStyle(el).fillOpacity)
    expect(fillOpacity).toBe(tokenOpacity)
  }

  // Parameter carries no flow hue by design (§VL0 — `--node-hue` resolves to
  // `--line-structure` there) — the layer still renders (no special-casing),
  // just with the neutral structural line colour instead of a type hue.
  const paramHue = page.locator('.react-flow__node[data-id="p1"] .nodef__hue')
  await expect(paramHue).toHaveCount(1)
  const [paramFill, lineStructure] = await Promise.all([
    paramHue.evaluate((el) => getComputedStyle(el).fill),
    page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--line-structure)'
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    }),
  ])
  expect(paramFill).toBe(lineStructure)
})

test('the hue wash paints below the plain fill\'s stroke — and below Activity when Activity is on', async ({ page }) => {
  await load(page)
  const shapeOrder = (id: string) =>
    page.locator(`.react-flow__node[data-id="${id}"] .nodef__shape`).evaluate((el) =>
      Array.from(el.children).map((c) => c.getAttribute('class')),
    )

  const idleOrder = await shapeOrder('gold')
  expect(idleOrder.indexOf('nodef__fill')).toBeLessThan(idleOrder.indexOf('nodef__hue'))
  expect(idleOrder.indexOf('nodef__hue')).toBeLessThan(idleOrder.indexOf('nodef__stroke'))

  // turn Activity on and commit a step so `src` (a Source fires every step it
  // pushes — `firedNodeIds`, per simStore.ts) gets a real, non-zero tint —
  // then re-check the SAME shape's child order. (`gold`, a Pool, never
  // appears in `firedNodeIds` itself — only the nodes that take an action do.)
  await page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any; setState: (p: object) => void }> }).__loop
    l.ui.setState({ activityOverlay: true })
    l.sim.getState().stepOnce()
  })
  await expect(page.locator('.react-flow__node[data-id="src"] .nodef__activity')).toHaveCount(1)
  const activeOrder = await shapeOrder('src')
  expect(activeOrder.indexOf('nodef__hue')).toBeLessThan(activeOrder.indexOf('nodef__activity'))
  expect(activeOrder.indexOf('nodef__activity')).toBeLessThan(activeOrder.indexOf('nodef__stroke'))

  const [hueOpacity, activityOpacity] = await Promise.all([
    page.locator('.react-flow__node[data-id="src"] .nodef__hue').evaluate((el) => Number(getComputedStyle(el).fillOpacity)),
    page.locator('.react-flow__node[data-id="src"] .nodef__activity').evaluate((el) => Number(getComputedStyle(el).opacity)),
  ])
  expect(hueOpacity).toBeLessThan(activityOpacity)
})

test('a selected node\'s ring reads far stronger than the hue wash beneath it', async ({ page }) => {
  await load(page)
  await page.locator('.react-flow__node[data-id="gold"]').click()
  const [hueOpacity, selOpacity] = await Promise.all([
    page.locator('.react-flow__node[data-id="gold"] .nodef__hue').evaluate((el) => Number(getComputedStyle(el).fillOpacity)),
    page.locator('.react-flow__node[data-id="gold"] .nodef__sel').evaluate((el) => Number(getComputedStyle(el).strokeOpacity || '1')),
  ])
  expect(hueOpacity).toBeLessThan(selOpacity)
})

test('Focus deemphasis fades the hue wash along with the rest of an out-of-focus node', async ({ page }) => {
  await load(page)
  await page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any; setState: (p: object) => void }> }).__loop
    l.graph.getState().setSelection('gold', null)
    l.ui.setState({ focusMode: true })
  })
  // `end` is far from the 1-hop set around `gold` — it should be dimmed.
  const endNode = page.locator('.react-flow__node[data-id="end"]')
  await expect(endNode).toHaveClass(/lgr-deemph/)
  const hueOpacity = await endNode.locator('.nodef__hue').evaluate((el) => getComputedStyle(el).opacity)
  expect(hueOpacity).toBe('0.26')
})

test('forced-colors: the hue wash is dropped; shape + chip still carry the type', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await load(page)
  const display = await page
    .locator('.react-flow__node[data-id="gold"] .nodef__hue')
    .evaluate((el) => getComputedStyle(el).display)
  expect(display).toBe('none')
  // the non-colour tells survive: silhouette stroke + the type chip
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__stroke')).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id="gold"] .nodef__chip')).toBeVisible()
})

test('edge labels use --line-strong for the border and the dedicated --elev-edge-label shadow token', async ({ page }) => {
  await load(page)
  const label = page.locator('.edge-label').first()
  await expect(label).toBeVisible()

  const [borderColor, lineStrongColor, boxShadow, elevToken] = await Promise.all([
    label.evaluate((el) => getComputedStyle(el).borderTopColor),
    page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--line-strong)'
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    }),
    label.evaluate((el) => getComputedStyle(el).boxShadow),
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--elev-edge-label').trim()),
  ])
  expect(borderColor).toBe(lineStrongColor)
  // light theme's token is a real shadow (not "none") — confirm it's actually
  // wired to the element, not just present on :root unused.
  expect(elevToken).not.toBe('')
  if (elevToken === 'none') expect(boxShadow).toBe('none')
  else expect(boxShadow).not.toBe('none')
})

test('dark theme: --elev-edge-label resolves to none (no floating shadow on a dark canvas)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await load(page)
  const label = page.locator('.edge-label').first()
  await expect(label).toBeVisible()
  const [elevToken, boxShadow] = await Promise.all([
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--elev-edge-label').trim()),
    label.evaluate((el) => getComputedStyle(el).boxShadow),
  ])
  expect(elevToken).toBe('none')
  expect(boxShadow).toBe('none')
})
