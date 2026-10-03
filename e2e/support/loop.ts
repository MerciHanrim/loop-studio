import { readFileSync } from 'node:fs'
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { SNAPSHOT_POLICY, snapshotKind } from './snapshot-policy'
import { seedWhatsNewSeen } from './whatsNew'

// Base test: fails automatically on any console.error or uncaught page error,
// plus small helpers for reaching the app's Zustand stores through the dev-only
// `window.__loop` bridge (src/main.tsx).

const IGNORE = [/favicon/i, /\[vite\] connect/i, /Download the React DevTools/i]

export const test = base.extend<{ errors: string[]; _tourSeed: void; whatsNewSeen: boolean }>({
  // Issue #296 — pre-dismissing the tour (below) makes the profile a RETURNING
  // one, and a returning profile that has not been told about the newest
  // release note gets the update notice on its canvas. So the same seed also
  // records that release as announced and opened. `e2e/whats-new.spec.ts`
  // turns this off with `test.use({ whatsNewSeen: false })`.
  whatsNewSeen: [true, { option: true }],
  // docs/guided-tour.md — every spec starts with the first-run Welcome card
  // suppressed so it never intercepts a click. The suppression is the real
  // product mechanism: the stored key set to `dismissed`. Context-scoped so a
  // second page (`context.newPage()`) is covered too. guided-tour.spec.ts
  // overrides this with its own `seedKey(page, …)` (registered later, wins).
  _tourSeed: [
    async ({ context, whatsNewSeen }, use) => {
      if (whatsNewSeen) await seedWhatsNewSeen(context)
      await context.addInitScript(() => {
        try {
          if (!localStorage.getItem('loop-studio/guided-tour/1'))
            localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
        } catch {
          /* opaque origin — a spec that hits this stubs storage itself */
        }
      })
      await use()
    },
    { auto: true },
  ],
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

/** docs/visual-snapshot-policy.md — the ONLY way to take a pixel snapshot.
 *  Resolves the tolerance from the stem + the running project and returns the
 *  `toHaveScreenshot` argument pair, so a call reads
 *  `toHaveScreenshot(...snap(page, 'stem', { mask }))`. An unregistered stem
 *  throws here (and fails scripts/check-snapshot-policy.mjs). */
export function snap(
  _page: Page,
  stem: string,
  extra: { mask?: Locator[]; [option: string]: unknown } = {},
): [string, { maxDiffPixelRatio: number; mask?: Locator[] }] {
  const kind = snapshotKind(stem, base.info().project.name)
  return [`${stem}.png`, { ...extra, maxDiffPixelRatio: SNAPSHOT_POLICY[kind].maxDiffPixelRatio }]
}

// docs/localization.md §L9.4 — the EXACT rendering of an isolated ICU argument.
//
// An isolate is invisible, so a matcher that spans the boundary — `"4,900"`,
// where the quotes belong to the sentence and the value sits isolated between
// them — stops matching although nothing a reader sees changed. The first fix
// for that was an OPTIONAL isolate character, and optional is the wrong shape:
// a pattern that passes with or without the isolate also passes if the isolate
// is later removed, which is the defect these specs are meant to notice.
//
// So these build the exact string instead. On an isolation-mandatory path,
// `iso('4,900')` matches `FSI + "4,900" + PDI` and nothing else — no isolate,
// the wrong kind of isolate, or an extra control inside all read as a failure.
// A path where the value may legitimately render UNISOLATED (an empty or
// whitespace-only value, which the helpers return unchanged) needs its own
// matcher, not a loosened one of these.

const FSI = '⁨'
const LRI = '⁦'
const PDI = '⁩'

/** the exact rendering of a value wrapped by `isolateAuto` */
export const iso = (value: string): string => FSI + value + PDI
/** the exact rendering of a value wrapped by `isolateLtr` */
export const isoLtr = (value: string): string => LRI + value + PDI

export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
}

/**
 * docs/timeline-series-contract.md §7 — the Timeline panel starts COLLAPSED and
 * auto-expands on the first run. A spec that reads the legend or the plot
 * BEFORE any step opens the panel the way a user would: the strip's collapse
 * control (desktop), or the run bar's Timeline toggle (mobile, where the panel
 * is a sheet). A no-op when it is already open.
 */
export async function ensureTimelineOpen(page: Page): Promise<void> {
  const mobile = (page.viewportSize()?.width ?? 1280) < 500
  if (mobile) {
    if (!(await page.locator('.timeline__panel').isVisible().catch(() => false))) {
      const tl = page.locator('.pstrip--mobile .pstrip__tl, .pstrip--mobile button[aria-label*="imeline" i]').first()
      if (await tl.count()) await tl.click()
    }
  } else {
    const collapse = page.locator('.pstrip__collapse')
    if ((await collapse.getAttribute('aria-expanded')) === 'false') {
      await collapse.click()
      // the panel is visible a beat before the canvas has finished shrinking
      // around it — wait for the laid-out height, not the class
      await expect
        .poll(() => page.evaluate(() => document.querySelector('.timeline')!.getBoundingClientRect().height), {
          message: 'the Timeline reached its open height',
        })
        .toBeGreaterThanOrEqual(200)
    }
  }
  await expect(page.locator('.timeline__panel')).toBeVisible()
}

/**
 * The product's own "Reset view" (Canvas.tsx `resetView`: fit the graph, clear
 * filters / focus). A pixel spec that frames the canvas under the app's camera
 * calls this AFTER the layout it wants is final: the camera is otherwise the
 * fit that ran at MOUNT (an import keeps the camera it finds), and the mount
 * happens on the collapsed pane (timeline-series-contract §7) — MEASURED
 * 2026-10-01: a panel opened afterwards leaves that camera centred for the
 * taller pane. Letting the product re-fit at the final layout is the fix; no
 * pixel offset is applied anywhere.
 */
export async function resetView(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^reset view/i }).click()
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

/** Load a serialized graph — same path as the Import button, including applying
 *  the file's `recommendedRunConfig` to the Monte-Carlo config. */
export async function importGraph(page: Page, json: string): Promise<void> {
  await page.evaluate((text) => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    l.mc.getState().applyRecommended(l.graph.getState().loadJSON(text))
  }, json)
}

export const readFixture = (): string =>
  readFileSync(new URL('../../examples/engine-b-verification.json', import.meta.url), 'utf8')

/** The hands-on demo graph (one connected economy, every node kind). */
export const readRiskyFactory = (): string =>
  readFileSync(new URL('../../examples/risky-factory.json', import.meta.url), 'utf8')

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
