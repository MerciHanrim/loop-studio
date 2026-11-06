import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// SEMANTICS-M6.md — a run rule through the real run path. The document here is built
// for this spec and is no bundled Template. It has no line that reads the table: only
// the rule does, so the run must hand the table to the engine for the rule alone.
// The rule's cases are in src/engine/run-rule.test.ts.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const pool = (id: string, initial: number) => ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny', resourceType: 'water' } })
const line = (id: string, source: string, target: string, flow: string, unit?: string) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, ...(unit ? { unit } : {}) } })

const document = (extraNodes: unknown[] = [], extraEdges: unknown[] = [], target = 'ro') =>
  JSON.stringify({
    schema: 'loop-studio/graph/6', version: 1,
    nodes: [
      pool('tank', 1000),
      { id: 'ro', type: 'converter', position: { x: 240, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAny', run: { table: 'demand', rated: 'feed' } } },
      { ...pool('store', 0), position: { x: 480, y: 0 } },
      ...extraNodes,
    ],
    edges: [line('feed', 'tank', target, '100', 'CMH'), line('product', 'ro', 'store', '100', 'CMH'), ...extraEdges],
    kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }],
    time: { step: { value: 1, unit: 'h' } },
    timetables: [{ id: 'demand', label: 'Demand', source: 'test', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '25']] }],
  })

const advance = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().advance())
const values = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().values as Record<string, number>)

test('a rule that alone reads a table sets the run', async ({ page }) => {
  await openApp(page)
  await importGraph(page, document())
  await advance(page)
  await expect.poll(async () => (await values(page))?.tank).toBe(975)
  await advance(page)
  await expect.poll(async () => (await values(page))?.store).toBe(50)
})

test('a `/graph/6` file opens at version 6, with its rule', async ({ page }) => {
  await openApp(page)
  await importGraph(page, document())
  const run = await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return { version: g.modelVersion, run: g.nodes.find((n: { id: string }) => n.id === 'ro').data.run }
  })
  expect(run).toEqual({ version: 6, run: { table: 'demand', rated: 'feed' } })
})

test('a rule on a group with a Gate moves nothing, and says why', async ({ page }) => {
  await openApp(page)
  const gate = { id: 'g', type: 'gate', position: { x: 120, y: 0 }, data: { kind: 'gate', label: 'Split', activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } }
  await importGraph(page, document([gate], [line('in', 'tank', 'g', '100')], 'ro').replace('"source":"tank","target":"ro"', '"source":"g","target":"ro"'))
  await advance(page)
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().diagnostics?.join(' ') ?? '')).toContain('a run rule cannot steer a group with a Gate')
  expect((await values(page))?.tank ?? 1000).toBe(1000)
})
