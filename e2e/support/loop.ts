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

/** Drag from one React Flow handle to another (a `.react-flow__handle` on each node). */
export async function dragHandle(
  page: Page,
  from: { nodeId: string; handle: string },
  to: { nodeId: string; handle: string },
): Promise<void> {
  const src = page.locator(
    `.react-flow__node[data-id="${from.nodeId}"] .react-flow__handle[data-handleid="${from.handle}"]`,
  )
  const dst = page.locator(
    `.react-flow__node[data-id="${to.nodeId}"] .react-flow__handle[data-handleid="${to.handle}"]`,
  )
  const a = await src.boundingBox()
  const b = await dst.boundingBox()
  if (!a || !b) throw new Error(`handle not found: ${JSON.stringify({ from, to })}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}
