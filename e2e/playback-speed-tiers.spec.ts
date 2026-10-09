import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// issue #330 PR 3 (v0.24.0) — the speed tiers and the phone profile
// (docs/simulation-playback.md §PB6.1, docs/mobile.md §MV4). Full (≥ 400 ms):
// the token travels with its `+N`; fast (200–399): it travels, `+N` from its
// arrive beat; very fast (< 200): the moved path flashes, then the token
// appears at the end with `+N`. Tier and profile are read once when a step
// starts; Step is always full. The phone draws at most 12 pairs (the first 12
// of the desktop's 24) and no departure ring. A presentation layer only.

type Loop = Record<string, { getState: () => any }>
const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as unknown as { __loop: Loop }).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
    const t = s.transition
    return { step: s.stepIndex as number, tau: (t?.tau ?? null) as number | null, tier: (t?.tier ?? null) as string | null, profile: (t?.profile ?? null) as string | null }
  })
const setViewport = (page: Page, zoom: number, x = 40, y = 120) =>
  page.evaluate(([z, vx, vy]) => (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport({ x: vx, y: vy, zoom: z }, { duration: 0 }), [zoom, x, y] as const)

const EQUILIBRIUM = readFileSync('examples/equilibrium.json', 'utf8')
/** 30 Sources, each pushing 1 a step into its own Pool: 30 moves a step */
const MANY = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: Array.from({ length: 30 }, (_, i) => [
    { id: `s${String(i).padStart(2, '0')}`, type: 'source', position: { x: 0, y: i * 70 }, data: { kind: 'source', label: `S${i}`, activation: 'automatic', mode: 'pushAny' } },
    { id: `p${String(i).padStart(2, '0')}`, type: 'pool', position: { x: 240, y: i * 70 }, data: { kind: 'pool', label: `P${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ]).flat(),
  edges: Array.from({ length: 30 }, (_, i) => {
    const n = String(i).padStart(2, '0')
    return { id: `e${n}`, type: 'loop', source: `s${n}`, target: `p${n}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }
  }),
})

async function load(page: Page, graph: string, zoom = 1) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, graph)
  await call(page, 'reset')
  await setViewport(page, zoom)
}

/** Start a step at `ms` (Play, or Step), then hold it: re-rate to a slow 4000
 *  ms beat (the tier and profile stay as read at the start) and pause once
 *  `pred` holds */
async function startAt(page: Page, ms: number, how: 'play' | 'step') {
  await page.evaluate(([ms, how]) => {
    const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
    s.setSpeed(ms)
    if (how === 'play') s.play()
    else s.stepOnce()
  }, [ms, how] as const)
  await expect.poll(async () => ((await sim(page)).tau != null ? 1 : -1), { timeout: 10000, intervals: [5] }).toBe(1)
  await page.evaluate(() => {
    const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
    s.setSpeed(4000)
  })
}
async function holdWhen(page: Page, pred: (s: Awaited<ReturnType<typeof sim>>) => boolean) {
  await call(page, 'play')
  await expect.poll(async () => (pred(await sim(page)) ? 1 : -1), { timeout: 20000, intervals: [16] }).toBe(1)
  await call(page, 'pause')
}
const token = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"] g.pb-move`)
const badge = (page: Page, id: string) => page.locator(`.pb-badge[data-badge-for="${id}"]`)
const flash = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"] .pb-path--flash`)

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null }).catch(() => {})
})

test('full tier (≥ 400 ms): the token travels with its +N beside it', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await startAt(page, 600, 'play')
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.35 && s.tau < 0.7)
  expect((await sim(page)).tier).toBe('full')
  await expect(token(page, 'tpl-e1')).toHaveCount(1)
  await expect(badge(page, 'tpl-e1')).toHaveText('+3')
  await expect(flash(page, 'tpl-e1')).toHaveCount(0)
})

test('fast tier (200–399 ms): the token travels without +N, which shows from the arrive beat; the tier is read once per step', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await startAt(page, 300, 'play')
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.35 && s.tau < 0.7)
  // re-rated to 4000 ms mid-step, still the fast tier it started with
  expect((await sim(page)).tier).toBe('fast')
  await expect(token(page, 'tpl-e1')).toHaveCount(1)
  await expect(badge(page, 'tpl-e1')).toHaveCount(0)
  await holdWhen(page, (s) => s.tau != null && s.tau >= 0.81 && s.tau < 0.93)
  expect((await sim(page)).tier).toBe('fast')
  await expect(badge(page, 'tpl-e1')).toHaveText('+3')
  // the next step reads the speed it now has (4000 ms): full
  await holdWhen(page, (s) => s.step === 1 && s.tau != null && s.tau > 0.3 && s.tau < 0.7)
  expect((await sim(page)).tier).toBe('full')
  await expect(badge(page, 'tpl-e1')).toHaveCount(1)
})

test('very fast tier (< 200 ms): the moved path flashes, then the token appears at the end with +N', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await startAt(page, 120, 'play')
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.35 && s.tau < 0.7)
  expect((await sim(page)).tier).toBe('veryFast')
  await expect(flash(page, 'tpl-e1')).toHaveCount(1)
  await expect(token(page, 'tpl-e1')).toHaveCount(0)
  await expect(badge(page, 'tpl-e1')).toHaveCount(0)
  await holdWhen(page, (s) => s.tau != null && s.tau >= 0.81 && s.tau < 0.93)
  await expect(flash(page, 'tpl-e1')).toHaveCount(0)
  await expect(token(page, 'tpl-e1')).toHaveCount(1)
  await expect(badge(page, 'tpl-e1')).toHaveText('+3')
  // at the END of the path: the target handle's point
  const at = await page.evaluate(() => {
    const g = document.querySelector('.react-flow__edge[data-id="tpl-e1"] g.pb-move')!
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform')!)!
    const p = document.querySelector('.react-flow__edge[data-id="tpl-e1"] path.react-flow__edge-path') as SVGPathElement
    const end = p.getPointAtLength(p.getTotalLength())
    return Math.hypot(Number(m[1]) - end.x, Number(m[2]) - end.y)
  })
  expect(at).toBeLessThan(1)
})

test('Step draws the full tier whatever the speed', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await startAt(page, 120, 'step')
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.35 && s.tau < 0.7)
  expect((await sim(page)).tier).toBe('full')
  await expect(token(page, 'tpl-e1')).toHaveCount(1)
  await expect(badge(page, 'tpl-e1')).toHaveText('+3')
})

test('the phone profile: the first 12 of the desktop pairs, no departure ring, past 12 a path highlight and an arrival cue', async ({ page }) => {
  // desktop first: the 24 pairs and their departure rings
  await load(page, MANY, 0.6)
  await startAt(page, 600, 'play')
  await holdWhen(page, (s) => s.tau != null && s.tau < 0.12)
  expect((await sim(page)).profile).toBe('desktop')
  const pairs = () => page.evaluate(() => [...document.querySelectorAll('.pb-badge')].map((b) => (b as HTMLElement).dataset.badgeFor!).sort())
  const desktop = await pairs()
  expect(desktop).toHaveLength(24)
  expect(await page.locator('.pb-cue--depart').count()).toBeGreaterThan(0)
  // the phone layout
  await page.setViewportSize({ width: 390, height: 844 })
  await load(page, MANY, 0.6)
  await startAt(page, 600, 'play')
  await holdWhen(page, (s) => s.tau != null && s.tau < 0.12)
  expect((await sim(page)).profile).toBe('phone')
  const phone = await pairs()
  expect(phone).toEqual(desktop.slice(0, 12))
  await expect(page.locator('g.pb-move')).toHaveCount(12)
  await expect(page.locator('.pb-cue--depart')).toHaveCount(0)
  // the 18 past the 12: a path highlight each, and an arrival cue at the arrive beat
  await expect(page.locator('.pb-path--over-cap')).toHaveCount(18)
  await holdWhen(page, (s) => s.tau != null && s.tau >= 0.81 && s.tau < 0.93)
  await expect(page.locator('.pb-cue--arrive')).toHaveCount(30)
  await expect(page.locator('.nodef__pulse')).toHaveCount(30)
})

test('the profile is fixed for the step: a resize mid-step changes nothing until the next step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await load(page, MANY, 0.6)
  await startAt(page, 600, 'play')
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.3 && s.tau < 0.6)
  await expect(page.locator('g.pb-move')).toHaveCount(12)
  // to a desktop width, mid-step
  await page.setViewportSize({ width: 1400, height: 900 })
  await setViewport(page, 0.6)
  await page.waitForTimeout(300)
  expect((await sim(page)).profile).toBe('phone')
  await expect(page.locator('g.pb-move')).toHaveCount(12)
  // the next step takes the new layout
  await holdWhen(page, (s) => s.step === 1 && s.tau != null && s.tau > 0.3 && s.tau < 0.6)
  expect((await sim(page)).profile).toBe('desktop')
  await expect(page.locator('g.pb-move')).toHaveCount(24)
})

test('the phone: ⋯ → Playback speed offers four speeds, Normal by default, and a choice sets the speed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await load(page, EQUILIBRIUM)
  await page.locator('[data-tour="mobile-more"]').click()
  await expect(page.locator('[data-more-row="speed"]')).toContainText('Normal')
  await page.locator('[data-more-row="speed"]').click()
  const rows = page.locator('[data-speed]')
  await expect(rows).toHaveCount(4)
  expect(await rows.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.speed, e.getAttribute('aria-pressed'), e.textContent]))).toEqual([
    ['slow', 'false', 'Slow1 s a step'],
    ['normal', 'true', 'Normal0.6 s a step'],
    ['fast', 'false', 'Fast0.3 s a step'],
    ['veryFast', 'false', 'Very fast0.12 s a step'],
  ])
  for (const r of await rows.all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.locator('[data-speed="fast"]').click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().speedMs)).toBe(300)
  await page.locator('[data-tour="mobile-more"]').click()
  await expect(page.locator('[data-more-row="speed"]')).toContainText('Fast')
  await page.locator('[data-more-row="speed"]').click()
  await expect(page.locator('[data-speed="fast"]')).toHaveAttribute('aria-pressed', 'true')
  // Escape goes back one level, to the More sheet
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-more-row="speed"]')).toBeFocused()
})

test('reduced motion keeps its static form within 24 on the phone too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await load(page, MANY, 0.6)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await call(page, 'stepOnce')
  await expect.poll(async () => (await sim(page)).tau).toBe(null)
  await expect(page.locator('g.pb-move')).toHaveCount(0)
  await expect(page.locator('.pb-badge[data-playback-badge="static"]')).toHaveCount(24)
})

test('the tiers are a view only: values at 120 ms equal the same steps advanced without cues', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await call(page, 'setSpeed', 120)
  await call(page, 'play')
  await expect.poll(async () => (await sim(page)).step, { timeout: 20000 }).toBeGreaterThanOrEqual(8)
  await call(page, 'pause')
  // Pause holds an in-flight step (§PB5.1); Step finishes it
  if ((await sim(page)).tau != null) await call(page, 'stepOnce')
  await expect.poll(async () => (await sim(page)).tau).toBe(null)
  const played = await page.evaluate(() => {
    const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
    return { step: s.stepIndex as number, values: { ...s.values } }
  })
  await call(page, 'reset')
  for (let i = 0; i < played.step; i++) await call(page, 'advance')
  expect(await page.evaluate(() => ({ ...(window as unknown as { __loop: Loop }).__loop.sim.getState().values }))).toEqual(played.values)
})
