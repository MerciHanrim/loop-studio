import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/module-system.md §MS5 — the Inputs / Summary panels in the desktop right
// column. Pure reads of the live `parameter` / `register` nodes: no persistence,
// no file, no digest (§MS5.3). Every row is read-through.

type GS = {
  nodes: { id: string; selected?: boolean; data?: { kind?: string; label?: string; value?: number } }[]
  edges: { id: string; source: string; target: string; data?: { kind?: string; flow?: string } }[]
  past: unknown[]
  simulationRev: number
  modelVersion: number
}
const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return {
      nodes: g.nodes.map((n) => ({ id: n.id, selected: n.selected, data: n.data })),
      edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data })),
      past: g.past,
      simulationRev: g.simulationRev,
      modelVersion: g.modelVersion,
    }
  })

const inputsPanel = (page: Page) => page.locator('.rightcol .mpanel').first()
const summaryPanel = (page: Page) => page.locator('.rightcol .mpanel').nth(1)

/** a v1 graph: pool + 2 parameters + 1 valid register (@p1 + @p2) + 1 invalid
 *  register (@nope). Returns the node ids. */
async function seedModelGraph(page: Page) {
  return page.evaluate(() => {
    const g = () => (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
    g().newGraph()
    g().addNodeAt('pool', { x: 0, y: 0 })
    g().addNodeAt('parameter', { x: 200, y: 0 })
    g().addNodeAt('parameter', { x: 400, y: 0 })
    g().addNodeAt('register', { x: 200, y: 200 })
    g().addNodeAt('register', { x: 400, y: 200 })
    const [pool, p1, p2, rOk, rBad] = g().nodes.map((n: { id: string }) => n.id)
    g().updateNodeData(p1, { label: 'Rate', value: 5 })
    g().updateNodeData(p2, { label: 'Bonus', value: 2 })
    g().updateNodeData(rOk, { label: 'Total', expr: `@${p1} + @${p2}`, unit: 'gold' })
    g().updateNodeData(rBad, { label: 'Broken', expr: '@nope + 1' })
    return { pool, p1, p2, rOk, rBad }
  })
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('the panels are absent with no Parameter / Register, and appear once one exists (§MS5.3)', async ({ page }) => {
  await resetAll(page)
  await page.evaluate(() => (window as any).__loop.graph.getState().addNodeAt('pool', { x: 0, y: 0 }))
  await expect(page.locator('.rightcol .mpanels')).toHaveCount(0)

  await page.evaluate(() => (window as any).__loop.graph.getState().addNodeAt('parameter', { x: 100, y: 0 }))
  await expect(page.locator('.rightcol .mpanels')).toBeVisible()
  await expect(inputsPanel(page)).toBeVisible()
})

test('Inputs lists every Parameter; editing a value is one history entry and one undo restores it', async ({ page }) => {
  const { p1 } = await seedModelGraph(page)
  const rows = inputsPanel(page).locator('.mp-row:not(.mp-row--flow)')
  await expect(rows).toHaveCount(2) // the two parameters

  const pastBefore = (await gs(page)).past.length
  const field = rows.filter({ hasText: 'Rate' }).locator('input[type=number]')
  await field.fill('12')
  await field.blur()

  await expect
    .poll(async () => (await gs(page)).nodes.find((n) => n.id === p1)!.data!.value)
    .toBe(12)
  expect((await gs(page)).past.length).toBe(pastBefore + 1) // one commit, like the Inspector

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect((await gs(page)).nodes.find((n) => n.id === p1)!.data!.value).toBe(5)
})

test('a non-finite Parameter value (NaN / Infinity) renders the input blank, not as an invalid value prop', async ({
  page,
}) => {
  const { p1 } = await seedModelGraph(page)
  const field = inputsPanel(page)
    .locator('.mp-row:not(.mp-row--flow)')
    .filter({ hasText: 'Rate' })
    .locator('input[type=number]')

  await page.evaluate((id) => (window as any).__loop.graph.getState().updateNodeData(id, { value: NaN }), p1)
  await expect(field).toHaveValue('') // the errors fixture also fails the test on any console.error

  await page.evaluate((id) => (window as any).__loop.graph.getState().updateNodeData(id, { value: Infinity }), p1)
  await expect(field).toHaveValue('')
})

test('v2 graph: Inputs also lists each @param flow edge as a read-only pointer', async ({ page }) => {
  await page.evaluate(() => {
    const g = () => (window as any).__loop.graph.getState()
    g().newGraph()
    g().addNodeAt('source', { x: 0, y: 0 })
    g().addNodeAt('pool', { x: 200, y: 0 })
    g().addNodeAt('parameter', { x: 0, y: 200 })
    const [s, p, rate] = g().nodes.map((n: { id: string }) => n.id)
    g().updateNodeData(rate, { label: 'Rate', value: 3 })
    g().onConnect({ source: s, target: p, sourceHandle: 'out', targetHandle: 'in' })
    g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@${rate}` })
  })
  expect((await gs(page)).modelVersion).toBe(2)

  const flowRow = inputsPanel(page).locator('.mp-row--flow')
  await expect(flowRow).toHaveCount(1)
  await expect(flowRow).toContainText('flow via')
  await expect(flowRow).toContainText('Rate')
  await expect(flowRow.locator('input')).toHaveCount(0) // read-only — no editable field
})

test('Summary shows R(t) + unit and a Show-calculation toggle; an invalid Register shows no value', async ({ page }) => {
  await seedModelGraph(page)
  const rows = summaryPanel(page).locator('.mp-row--reg')
  await expect(rows).toHaveCount(2)

  const ok = rows.filter({ hasText: 'Total' })
  await expect(ok).toContainText('7') // 5 + 2 at step 0
  await expect(ok).toContainText('gold')
  await ok.getByRole('button', { name: /show calculation/i }).click()
  await expect(ok.locator('.mp-row__expr')).toHaveText(`@${(await gs(page)).nodes[1].id} + @${(await gs(page)).nodes[2].id}`)
  await ok.getByRole('button', { name: /hide calculation/i }).click()
  await expect(ok.locator('.mp-row__expr')).toHaveCount(0)

  const bad = rows.filter({ hasText: 'Broken' })
  await expect(bad).toContainText(/no value/i)
})

test('read-through: clicking a row label selects the node and jumps the canvas to it', async ({ page }) => {
  await seedModelGraph(page) // a cluster near the origin; the camera fits it
  // add one Parameter far away — centring it needs a big translate change
  const farId = await page.evaluate(() => {
    const g = () => (window as any).__loop.graph.getState()
    g().addNodeAt('parameter', { x: 2400, y: 1600 })
    const id = g().nodes[g().nodes.length - 1].id
    g().updateNodeData(id, { label: 'Far' })
    return id
  })
  const translate = async () => {
    const s = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? ''
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(s)
    return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) }
  }
  const before = await translate()

  await inputsPanel(page).locator('.mp-row__label', { hasText: 'Far' }).click()

  await expect.poll(async () => (await gs(page)).nodes.find((n) => n.id === farId)?.selected).toBe(true)
  await expect
    .poll(async () => {
      const now = await translate()
      return Math.hypot(now.x - before.x, now.y - before.y)
    })
    .toBeGreaterThan(400) // the canvas jumped to the far node
})

test('collapse state persists across a reload (own localStorage keys)', async ({ page }) => {
  await seedModelGraph(page)
  const head = inputsPanel(page).locator('.mpanel__toggle')
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => localStorage.getItem('loop-studio:inputs-panel'))).toBe('0')

  await page.reload()
  await openApp(page)
  await seedModelGraph(page)
  await expect(inputsPanel(page).locator('.mpanel__toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(inputsPanel(page).locator('.mpanel__body')).toHaveCount(0)
})

test('under the canvas edit-lock the value input is disabled but read-through and Show calculation still work', async ({ page }) => {
  const { rOk } = await seedModelGraph(page)
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))

  await expect(inputsPanel(page).locator('.mp-row input[type=number]').first()).toBeDisabled()

  const reg = summaryPanel(page).locator('.mp-row--reg').filter({ hasText: 'Total' })
  await reg.getByRole('button', { name: /show calculation/i }).click()
  await expect(reg.locator('.mp-row__expr')).toBeVisible()
  await reg.locator('.mp-row__label').click()
  await expect.poll(async () => (await gs(page)).nodes.find((n) => n.id === rOk)?.selected).toBe(true)
})

test('the panels never touch the document — no simulationRev bump, no key in any export', async ({ page }) => {
  await seedModelGraph(page)
  const revBefore = (await gs(page)).simulationRev
  const exportBefore = await page.evaluate(() => (window as any).__loop.graph.getState().exportJSON())

  // toggle a calc, collapse a panel, expand it again
  await summaryPanel(page).locator('.mp-row__calcbtn').first().click()
  await inputsPanel(page).locator('.mpanel__toggle').click()
  await inputsPanel(page).locator('.mpanel__toggle').click()

  expect((await gs(page)).simulationRev).toBe(revBefore)
  const exportAfter = await page.evaluate(() => (window as any).__loop.graph.getState().exportJSON())
  expect(exportAfter).toBe(exportBefore)
  expect(exportAfter).not.toContain('panel')
})

test('the panels are desktop-only — absent at a narrow (mobile) viewport', async ({ page }) => {
  await seedModelGraph(page)
  await expect(page.locator('.rightcol .mpanels')).toBeVisible()
  await page.setViewportSize({ width: 700, height: 900 })
  await page.reload()
  await expect(page.locator('.toolbar--mobile')).toBeVisible()
  await expect(page.locator('.mpanels')).toHaveCount(0)
})

// docs/module-system.md §MS5 / the post-#153 UX cleanup — a long node name in a
// panel row wraps to at most TWO lines (was hard-clipped to one), the full name
// is available on hover, and the value column stays aligned. Flow-pointer rows
// keep their single line.
async function seedLongLabels(page: Page) {
  return page.evaluate(() => {
    const g = () => (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
    g().newGraph()
    g().addNodeAt('parameter', { x: 0, y: 0 })
    g().addNodeAt('parameter', { x: 200, y: 0 })
    g().addNodeAt('register', { x: 0, y: 200 })
    g().addNodeAt('register', { x: 200, y: 200 })
    g().addNodeAt('register', { x: 400, y: 200 })
    const [pLong, pShort, rLong, rShort, rBig] = g().nodes.map((n: { id: string }) => n.id)
    g().updateNodeData(pLong, {
      label: 'Projected daily operating cost per finished batch including packaging and delivery',
      value: 12,
    })
    g().updateNodeData(pShort, { label: 'Rate', value: 3 })
    g().updateNodeData(rLong, { label: 'Projected daily operating margin', expr: `@${pShort} * 2`, unit: 'kKRW/day' })
    g().updateNodeData(rShort, { label: 'Net', expr: `@${pShort}`, unit: 'kKRW/day' })
    // a value wider than --mp-val-w (96px) — forces the grow path
    g().updateNodeData(rBig, { label: 'Wide', expr: `@${pShort} * 100000`, unit: 'kKRW/day' })
    return { pLong, pShort, rLong, rShort, rBig }
  })
}

const lineCountOf = (loc: Locator) =>
  loc.evaluate((el) => {
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
    return Math.round((el as HTMLElement).getBoundingClientRect().height / lh)
  })

test.describe('panel rows — 2-line names + aligned value column', () => {
  test('a long NAME label clamps to 2 lines; a short one stays 1; flow rows stay 1', async ({ page }) => {
    await seedLongLabels(page)
    await page.evaluate(() => document.fonts.ready)

    const longReg = summaryPanel(page).locator('.mp-row--reg', { hasText: 'Projected daily operating margin' })
    const clamp = await longReg.locator('.mp-row__label--name').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { clamp: cs.webkitLineClamp, overflow: cs.overflow, ws: cs.whiteSpace }
    })
    expect(clamp).toMatchObject({ clamp: '2', overflow: 'hidden', ws: 'normal' })
    expect(await lineCountOf(longReg.locator('.mp-row__label--name'))).toBe(2)
    // clamped, not overflowing the row
    const escapes = await longReg.evaluate((li) => {
      const lab = li.querySelector('.mp-row__label--name')!.getBoundingClientRect()
      return lab.bottom > li.getBoundingClientRect().bottom + 1
    })
    expect(escapes).toBe(false)

    // a genuinely 3+-line name really clamped: scrollHeight beats clientHeight
    const overflows = await inputsPanel(page)
      .locator('.mp-row', { hasText: 'Projected daily operating cost per finished batch including' })
      .locator('.mp-row__label--name')
      .evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(overflows).toBe(true)

    // short name = 1 line
    const shortReg = summaryPanel(page).locator('.mp-row--reg', { hasText: 'Net' })
    expect(await lineCountOf(shortReg.locator('.mp-row__label--name'))).toBe(1)
  })

  test('a v2 flow-pointer row keeps ONE line (base .mp-row__label, no --name)', async ({ page }) => {
    await page.evaluate(() => {
      const g = () => (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 200, y: 0 })
      g().addNodeAt('parameter', { x: 0, y: 200 })
      const [s, p, rate] = g().nodes.map((n: { id: string }) => n.id)
      // long source/target names so the pointer text is long
      g().updateNodeData(s, { label: 'Continuous green-bean intake source' })
      g().updateNodeData(p, { label: 'Roasted finished-goods buffer stock' })
      g().updateNodeData(rate, { label: 'Rate', value: 3 })
      g().onConnect({ source: s, target: p, sourceHandle: 'out', targetHandle: 'in' })
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@${rate}` })
    })
    await page.evaluate(() => document.fonts.ready)
    const flowLabel = inputsPanel(page).locator('.mp-row--flow .mp-row__label')
    await expect(flowLabel).not.toHaveClass(/mp-row__label--name/)
    const info = await flowLabel.evaluate((el) => {
      const cs = getComputedStyle(el)
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
      return { ws: cs.whiteSpace, lines: Math.round(el.getBoundingClientRect().height / lh), title: el.getAttribute('title'), text: el.textContent }
    })
    expect(info.ws).toBe('nowrap')
    expect(info.lines).toBe(1)
    expect(info.title).toBe(info.text) // the rendered "A → B"
  })

  test('the full name is on the label as a title', async ({ page }) => {
    await seedLongLabels(page)
    const regLabel = summaryPanel(page)
      .locator('.mp-row--reg', { hasText: 'Projected daily operating margin' })
      .locator('.mp-row__label--name')
    await expect(regLabel).toHaveAttribute('title', 'Projected daily operating margin')
    const paramLabel = inputsPanel(page)
      .locator('.mp-row', { hasText: 'Projected daily operating cost per finished batch including' })
      .locator('.mp-row__label--name')
    await expect(paramLabel).toHaveAttribute(
      'title',
      'Projected daily operating cost per finished batch including packaging and delivery',
    )
  })

  test('normal register values form a fixed column — both edges align', async ({ page }) => {
    await seedLongLabels(page)
    await page.evaluate(() => document.fonts.ready)
    const edges = await summaryPanel(page).evaluate((panel) => {
      const vals = [...panel.querySelectorAll('.mp-row--reg .mp-row__val')] as HTMLElement[]
      // exclude the deliberately-wide 'Wide' row
      return vals
        .filter((v) => !v.closest('.mp-row--reg')!.textContent!.includes('Wide'))
        .map((v) => {
          const r = v.getBoundingClientRect()
          return { left: Math.round(r.left), right: Math.round(r.right) }
        })
    })
    expect(edges.length).toBeGreaterThanOrEqual(2)
    expect(new Set(edges.map((e) => e.right)).size).toBe(1) // one right edge
    expect(new Set(edges.map((e) => e.left)).size).toBe(1) // one left edge → fixed width
  })

  test('an over-long value grows the column left, never overlaps the name, no h-scroll', async ({ page }) => {
    await seedLongLabels(page)
    await page.evaluate(() => document.fonts.ready)
    const m = await summaryPanel(page).evaluate((panel) => {
      const wide = [...panel.querySelectorAll('.mp-row--reg')].find((li) => li.textContent!.includes('Wide'))!
      const normal = [...panel.querySelectorAll('.mp-row--reg')].find((li) => li.textContent!.includes('Net'))!
      const wr = wide.querySelector('.mp-row__val')!.getBoundingClientRect()
      const wl = wide.querySelector('.mp-row__label--name')!.getBoundingClientRect()
      const wm = wide.querySelector('.mp-row__main')!.getBoundingClientRect()
      const nr = normal.querySelector('.mp-row__val')!.getBoundingClientRect()
      const panelBox = panel.getBoundingClientRect()
      return {
        noOverlap: Math.round(wl.right) + 6 <= Math.round(wr.left),
        insideMain: Math.round(wr.right) <= Math.round(wm.right) + 1,
        grewLeft: Math.round(wr.left) < Math.round(nr.left),
        rightAligned: Math.abs(Math.round(wr.right) - Math.round(nr.right)) <= 1,
        hScroll: panel.scrollWidth - panel.clientWidth,
        valInside: Math.round(wr.right) <= Math.round(panelBox.right) + 1,
      }
    })
    expect(m.noOverlap).toBe(true)
    expect(m.insideMain).toBe(true)
    expect(m.grewLeft).toBe(true)
    expect(m.rightAligned).toBe(true)
    expect(m.hScroll).toBeLessThanOrEqual(1)
    expect(m.valInside).toBe(true)
  })
})
