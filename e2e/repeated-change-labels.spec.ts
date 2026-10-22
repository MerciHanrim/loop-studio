import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, routesSettled, test } from './support/loop'
import { pickTemplate } from './support/workbenchMenus'

// docs/edge-routing.md §ER15.2 — a repeated Value change group (two Value
// changes Feeder → Tank on the same stored handles: a document may hold one,
// drawing refuses it). Their chips grow in a run (a Δ row, a clamp note); the
// route map's last pass gives each the room its run form can take, on or
// beside its line, with a leader. Checked on the real canvas after one step:
// no chip meets another chip or a node, name or value; nothing moved between
// rest and the step; the leader is inert. A member with no safe spot is
// reported (state-verification's `m_tank_sub`, a known unresolved case).

const st = (id: string, expr: string) => ({ id, source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr } })
const pool = (id: string, label: string, x: number, y: number, initial: number, capacity: number | null) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const DOC = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [pool('feed', 'Feeder', 0, 400, 10, null), pool('tank', 'Tank', 300, 400, 0, 8)],
  edges: [st('m1', '+S'), st('m2', '-1')],
})

type Diag = { groups: number; moved: string[]; unresolved: string[] }
const diag = (page: Page): Promise<Diag> => page.evaluate(() => (window as any).__loop.routeMap.diagnostics().runForm)
const mapNow = (page: Page) =>
  page.evaluate(() => {
    const l = (window as any).__loop
    return JSON.stringify([[...l.routeMap.all()].map(([id, r]: [string, any]) => [id, r.d, r.label, r.beside ?? null]).sort(), [...l.routeMap.free()].map(([id, s]: [string, any]) => [id, s.f, s.at, s.beside ?? null]).sort()])
  })
/** every chip meeting another chip, or a node box / name / value */
const covers = (page: Page) =>
  page.evaluate(() => {
    const vis = (r: DOMRect) => r.width > 0 && r.height > 0
    const chips = [...document.querySelectorAll<HTMLElement>('.edge-label[data-edge-id]:not(.edge-label--measure)')].map((el) => ({ id: el.dataset.edgeId!, r: el.getBoundingClientRect() })).filter((c) => vis(c.r))
    const hit = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
    const parts = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].flatMap((n) => [n, ...n.querySelectorAll<HTMLElement>('.nodef__name, .nodef__value, .nodef__sub')].map((p) => ({ k: `${n.dataset.id} ${p === n ? 'node' : p.className.split(' ')[0]}`, r: p.getBoundingClientRect() })))
    const out: string[] = []
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) if (hit(chips[i].r, chips[j].r)) out.push(`${chips[i].id} × ${chips[j].id}`)
    for (const c of chips) for (const p of parts) if (vis(p.r) && hit(c.r, p.r)) out.push(`${c.id} over ${p.k}`)
    return out
  })
async function view(page: Page) {
  await page.evaluate(() => {
    const l = (window as any).__loop
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    l.rf.setViewport({ x: pane.width / 2 - 180 * 1.2, y: pane.height / 2 - 430 * 1.2, zoom: 1.2 }, { duration: 0 })
  })
  await page.mouse.move(2, 2)
  await routesSettled(page)
}
async function oneStep(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__loop.sim.getState()
    s.reset()
    s.advance()
  })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page)
  await resetAll(page)
})

for (const [name, legacyLayout] of [
  ['Curved (as stored)', false],
  ['routed (opened as a file: migrated to orthogonal)', true],
] as const) {
  test(`${name}: after a step no chip meets another chip or a node / name / value, nothing moved, the leaders are inert`, async ({ page }) => {
    await importGraph(page, DOC, { legacyLayout })
    await view(page)
    await expect.poll(() => diag(page).then((d) => d.groups)).toBe(1)
    expect((await diag(page)).moved.sort()).toEqual(['m1', 'm2'])
    // the run-form copy is the chip at its width cap, three rows tall
    const copy = await page.locator('.edge-label--run-form').first().evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight, cap: getComputedStyle(el).maxWidth, line: parseFloat(getComputedStyle(el).lineHeight) }))
    expect(`${copy.w}px`).toBe(copy.cap)
    expect(copy.h).toBeGreaterThanOrEqual(3 * copy.line)
    const rest = await mapNow(page)
    await oneStep(page)
    // the run's two-row chip and clamp note are on screen
    await expect(page.locator('.edge-label[data-edge-id="m1"] .edge-label__delta')).toBeVisible()
    await expect(page.locator('.edge-label[data-edge-id="m2"] .edge-label__clamp')).toBeVisible()
    expect(await covers(page)).toEqual([])
    expect(await mapNow(page), 'the run moves no line and no label').toBe(rest)
    const leaders = await page.locator('.edge-leader').evaluateAll((gs) =>
      gs.map((g) => ({ pe: getComputedStyle(g).pointerEvents, marker: g.querySelector('path')?.getAttribute('marker-end') ?? null })),
    )
    expect(leaders.length).toBeGreaterThan(0)
    for (const l of leaders) expect(l).toEqual({ pe: 'none', marker: null })
  })
}

test('the pass off gives back exactly the rest placement (the overlap it removes is real)', async ({ page }) => {
  await importGraph(page, DOC, { legacyLayout: true })
  await view(page)
  await page.evaluate(() => (window as any).__loop.routeMap.setRunFormPass(false))
  await routesSettled(page)
  await oneStep(page)
  expect(await covers(page)).toContain('m1 × m2')
  await expect(page.locator('.edge-leader')).toHaveCount(0)
})

test('state-verification: a member with no safe spot is reported unresolved and keeps its place', async ({ page }) => {
  await importGraph(page, readFileSync(new URL('../examples/state-verification.json', import.meta.url), 'utf8'), { legacyLayout: true })
  await routesSettled(page)
  await expect.poll(() => diag(page).then((d) => d.groups)).toBe(1)
  const d = await diag(page)
  expect(d.unresolved).toEqual(['m_tank_sub'])
  expect(d.moved).toEqual(['m_tank_addS'])
})

test('a Templates example (no repeated group): no group, no leader', async ({ page }) => {
  await pickTemplate(page, 'gacha-pickup')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await routesSettled(page)
  expect((await diag(page)).groups).toBe(0)
  await expect(page.locator('.edge-leader')).toHaveCount(0)
})
