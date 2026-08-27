import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'

// Base test: fails automatically on any console.error or uncaught page error,
// plus small helpers for reaching the app's Zustand stores through the dev-only
// `window.__loop` bridge (src/main.tsx).

const IGNORE = [/favicon/i, /\[vite\] connect/i, /Download the React DevTools/i]

export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) {
          errors.push(`console.error: ${m.text()}`)
        }
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      await use(errors)
      expect(errors, 'no console / page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
}

/** Empty graph + idle sim + no Monte-Carlo result. */
export async function resetAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    l.mc.getState().clear()
    l.sim.getState().reset()
    l.graph.getState().newGraph()
  })
}

export type GraphSnapshot = {
  nodeCount: number
  edgeCount: number
  edges: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null; kind: string }[]
  poolLabels: string[]
}

export function graphSnapshot(page: Page): Promise<GraphSnapshot> {
  return page.evaluate(() => {
    const g = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph.getState()
    return {
      nodeCount: g.nodes.length,
      edgeCount: g.edges.length,
      edges: g.edges.map((e: any) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        kind: e.data?.kind ?? null,
      })),
      poolLabels: g.nodes.filter((n: any) => n.data.kind === 'pool').map((n: any) => n.data.label),
    }
  })
}

export type McSnapshot = {
  status: string
  view: string
  stale: boolean
  progress: number
  message: string
  hasResult: boolean
  resultPools: string[]
  resultConfig: { runs: number; steps: number; baseSeed: number } | null
}

export function mcSnapshot(page: Page): Promise<McSnapshot> {
  return page.evaluate(() => {
    const m = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.mc.getState()
    return {
      status: m.status,
      view: m.view,
      stale: m.stale,
      progress: m.progress,
      message: m.message,
      hasResult: Boolean(m.result),
      resultPools: m.result ? m.result.pools.map((p: any) => p.label) : [],
      resultConfig: m.result
        ? { runs: m.result.config.runs, steps: m.result.config.steps, baseSeed: m.result.config.baseSeed }
        : null,
    }
  })
}

/** Load a serialized graph (same path as the Import button). */
export async function importGraph(page: Page, json: string): Promise<void> {
  await page.evaluate((text) => {
    ;(window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph.getState().loadJSON(text)
  }, json)
}

export const readFixture = (): string =>
  readFileSync(new URL('../../examples/engine-b-verification.json', import.meta.url), 'utf8')

/** The 4 Pool ids the verification fixture's expected.json tracks (Gate In left
 *  out on purpose). Stable — the fixture is committed. */
export const FIXTURE_POOLS_4 = [
  'pool_mtc00jt3_2', // Det Pool
  'pool_mtc00jt4_5', // Dice Pool
  'pool_mtc00jt4_9', // Gate A
  'pool_mtc00jt4_a', // Gate B
]

/** Set the Monte-Carlo config and run to completion through the real store
 *  action (→ real parallel Worker driver on http). Resolves when status is
 *  'done'. */
export async function runMc(
  page: Page,
  config: { baseSeed?: number; runs: number; steps: number; tracked?: string[] },
): Promise<void> {
  await page.evaluate((cfg) => {
    const m = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.mc.getState()
    m.setConfig(cfg)
    return m.run() as Promise<void>
  }, config)
  await expect
    .poll(() => mcSnapshot(page).then((s) => s.status), { timeout: 20_000 })
    .toBe('done')
}

type Box = { x: number; y: number; width: number; height: number }

// The state diamonds straddle the node's top / bottom edge, so their inner half
// is painted over by the node's SVG silhouette and `elementFromPoint` there
// returns the SVG, not the handle. Aim at the OUTER half instead. Resource
// handles (left / right) are clear at the centre.
function aimPoint(handle: string, b: Box): { x: number; y: number } {
  const cx = b.x + b.width / 2
  if (handle === 'state-target') return { x: cx, y: b.y + b.height * 0.15 } // top edge → aim up
  if (handle === 'state-source') return { x: cx, y: b.y + b.height * 0.85 } // bottom edge → aim down
  return { x: cx, y: b.y + b.height / 2 }
}

/** Drag from one React Flow handle to another (a `.react-flow__handle` on each node). */
export async function dragHandle(
  page: Page,
  from: { nodeId: string; handle: string },
  to: { nodeId: string; handle: string },
): Promise<void> {
  const loc = (n: string, h: string) =>
    page.locator(`.react-flow__node[data-id="${n}"] .react-flow__handle[data-handleid="${h}"]`)
  const a = await loc(from.nodeId, from.handle).boundingBox()
  const b = await loc(to.nodeId, to.handle).boundingBox()
  if (!a || !b) throw new Error(`handle not found: ${JSON.stringify({ from, to })}`)
  const p0 = aimPoint(from.handle, a)
  const p1 = aimPoint(to.handle, b)
  await page.mouse.move(p0.x, p0.y)
  await page.mouse.down()
  await page.mouse.move(p0.x + 6, p0.y + 6, { steps: 4 })
  await page.mouse.move((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, { steps: 10 })
  await page.mouse.move(p1.x, p1.y, { steps: 12 })
  await page.mouse.up()
}
