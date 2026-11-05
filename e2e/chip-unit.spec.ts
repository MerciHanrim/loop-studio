import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// SEMANTICS-M4.md §M4-11 and docs/edge-routing.md §ER15.3 (#500) — a chip prints
// the unit its field is authored in. The document here is built for this spec and
// is no bundled Template. The rule's cases are in src/model/engineValues.test.ts
// and src/store/routeMap.endRoom.test.ts.

type Bridge = { __loop: Record<string, any> }

const pool = (id: string, x: number, y: number) => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 1000, capacity: null, mode: 'pushAny', resourceType: 'water' } })
const drain = (id: string, x: number, y: number) => ({ id, type: 'drain', position: { x, y }, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } })
const line = (id: string, source: string, target: string, flow: string, unit?: string, route = 'orthogonal') => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, route, ...(unit ? { unit } : {}) } })

const DOCUMENT = JSON.stringify({
  schema: 'loop-studio/graph/4', version: 1,
  nodes: [pool('p1', 0, 0), drain('d1', 400, 0), pool('p2', 0, 160), drain('d2', 400, 160), pool('p3', 0, 320), drain('d3', 400, 320), pool('p4', 0, 480), drain('d4', 400, 480), pool('p5', 0, 640), drain('d5', 400, 640), pool('p6', 0, 800), drain('d6', 400, 800)],
  edges: [line('rate', 'p1', 'd1', '21000', 'CMD'), line('time', 'p2', 'd2', '5', 'L/min'), line('step', 'p3', 'd3', '5', 'L'), line('none', 'p4', 'd4', '5'), line('all', 'p5', 'd5', 'all', 'CMD'), line('stale', 'p6', 'd6', '5', 'gone')],
  kinds: [{ name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'CMD', factor: '1', per: 'd' }] }],
  time: { step: { value: 1, unit: 'h' } },
})

const chip = (page: Page, id: string) => page.locator(`.edge-label[data-edge-id="${id}"]:not(.edge-label--measure)`)

test('a chip prints the unit its field is authored in, and only where the number is in it', async ({ page }) => {
  await openApp(page)
  await importGraph(page, DOCUMENT)
  await expect(chip(page, 'rate')).toHaveText('21000 CMD')
  await expect(chip(page, 'time')).toHaveText('5 L/min')
  await expect(chip(page, 'step')).toHaveText('5 L')
  await expect(chip(page, 'none')).toHaveText('5')
  await expect(chip(page, 'all')).toHaveText('all')
  await expect(chip(page, 'stale')).toHaveText('5')
  await expect(chip(page, 'rate')).toHaveAttribute('dir', 'ltr')
})

test('a chip follows its field, and a reading moves neither the chip nor the line', async ({ page }) => {
  await openApp(page)
  await importGraph(page, DOCUMENT)
  const read = () =>
    page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      return JSON.stringify({ route: l.routeMap.get('rate'), gens: l.routeMap.genCount() })
    })
  const before = await read()
  await page.evaluate(() => {
    const v = (window as unknown as Bridge).__loop.viewUnits.getState()
    v.setViewUnit('water', 'L')
    v.setOutflowView('water', 'L/min')
  })
  await expect(chip(page, 'rate')).toHaveText('21000 CMD')
  expect(await read()).toBe(before)

  await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const e = g.edges.find((x: { id: string }) => x.id === 'rate')
    g.setEdgeData('rate', { ...e.data, unit: undefined })
  })
  await expect(chip(page, 'rate')).toHaveText('21000')
})

test('on a short line the chip leaves the arrow showing', async ({ page }) => {
  await openApp(page)
  const short = JSON.parse(DOCUMENT)
  short.nodes = [pool('a', 0, 0), drain('b', 170, 0), pool('c', 0, 240), drain('d', 170, 240)]
  short.edges = [line('routed', 'a', 'b', '21000', 'CMD'), line('straight', 'c', 'd', '21000', 'CMD', 'straight')]
  await importGraph(page, JSON.stringify(short))
  await expect(chip(page, 'routed')).toHaveText('21000 CMD')
  for (const id of ['routed', 'straight']) {
    // the last 14 flow px of the line are outside the chip
    const covered = await page.evaluate((edge) => {
      const c = document.querySelector(`.edge-label[data-edge-id="${edge}"]:not(.edge-label--measure)`)!.getBoundingClientRect()
      const path = document.querySelector(`[data-id="${edge}"] path.react-flow__edge-path`) as SVGPathElement
      const m = path.getScreenCTM()!
      const total = path.getTotalLength()
      return [0, 7, 14].flatMap((back) => [total - back, back]).some((s) => {
        const p = path.getPointAtLength(s)
        const x = m.a * p.x + m.e
        const y = m.d * p.y + m.f
        return x >= c.left && x <= c.right && y >= c.top && y <= c.bottom
      })
    }, id)
    expect(covered, id).toBe(false)
  }
})
