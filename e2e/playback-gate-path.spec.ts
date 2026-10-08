import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// issue #330 PR 1 (v0.22.0), docs/simulation-playback.md §PB4.6 — what moved
// where: every Gate output that moved this step is highlighted under its round
// token, an untaken branch keeps its usual look; the step's summed amount rides
// beside the token as a `+N` badge, from `+1`; the connection's OWN label dims
// only while the token or its badge covers it; on a connection outside the
// Focus set every playback cue is drawn at the connection's low strength; the
// reduced-motion and forced-colours forms. A presentation layer only.

const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as any).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const tau = (page: Page) => page.evaluate(() => (window as any).__loop.sim.getState().transition?.tau ?? null)
const flows = (page: Page) => page.evaluate(() => ({ ...((window as any).__loop.sim.getState().transition?.flowByEdge ?? {}) }) as Record<string, number>)

/** a Source sending 1 a step into a buffer Pool, which a Gate pulls from
 *  (`all`, as the Equilibrium Template wires its Gate) and passes on by its two
 *  branch weights. A deterministic Gate splits in proportion (weights 1 : 0 —
 *  only A ever moves; 1 : 1 — both move, half each); a probabilistic one sends
 *  each unit down one branch (1 : 1 — one branch a step) */
const gateGraph = (distribution: 'deterministic' | 'probabilistic', w: [string, string] = distribution === 'deterministic' ? ['1', '0'] : ['1', '1']) =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'src', type: 'source', position: { x: 0, y: 120 }, data: { kind: 'source', label: 'In', activation: 'automatic', mode: 'pushAny' } },
      { id: 'buf', type: 'pool', position: { x: 260, y: 120 }, data: { kind: 'pool', label: 'Buffer', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'g', type: 'gate', position: { x: 520, y: 120 }, data: { kind: 'gate', label: 'Split', activation: 'automatic', distribution } },
      { id: 'a', type: 'pool', position: { x: 820, y: 0 }, data: { kind: 'pool', label: 'Branch A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'b', type: 'pool', position: { x: 820, y: 260 }, data: { kind: 'pool', label: 'Branch B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e_in', type: 'loop', source: 'src', target: 'buf', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
      { id: 'e_g', type: 'loop', source: 'buf', target: 'g', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
      { id: 'e_a', type: 'loop', source: 'g', target: 'a', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: w[0] } },
      { id: 'e_b', type: 'loop', source: 'g', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: w[1] } },
    ],
  })

async function load(page: Page, graph: string) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, graph)
  await call(page, 'reset')
  await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 40, y: 80, zoom: 1 }, { duration: 0 }))
}

/** Play slowly and pause inside [lo, hi] of τ, on a step in which the Gate moved */
async function holdAt(page: Page, lo: number, hi: number) {
  await call(page, 'setSpeed', 4000)
  await call(page, 'play')
  await expect.poll(async () => {
    const t = await tau(page)
    const f = await flows(page)
    return t != null && t > lo && t < hi && ((f.e_a ?? 0) > 0 || (f.e_b ?? 0) > 0) ? 1 : -1
  }, { timeout: 20000 }).toBe(1)
  await call(page, 'pause')
}

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null, forcedColors: null }).catch(() => {})
})

for (const distribution of ['deterministic', 'probabilistic'] as const) {
  test(`${distribution} Gate: the branch that moved is highlighted and carries its token and +N; the other keeps its usual look`, async ({ page }) => {
    await load(page, gateGraph(distribution))
    // the untaken branch's look at rest, for comparison
    const look = (id: string) =>
      page.evaluate((eid) => {
        const p = document.querySelector(`.react-flow__edge[data-id="${eid}"] path.react-flow__edge-path`)!
        const cs = getComputedStyle(p)
        return { stroke: cs.stroke, width: cs.strokeWidth, opacity: cs.opacity, filter: cs.filter }
      }, id)
    const rest = { a: await look('e_a'), b: await look('e_b') }
    await holdAt(page, 0.3, 0.6)
    const f = await flows(page)
    const moved = (f.e_a ?? 0) > 0 ? 'e_a' : 'e_b'
    const idle = moved === 'e_a' ? 'e_b' : 'e_a'
    expect((f[moved] ?? 0) > 0 && (f[idle] ?? 0) === 0, `exactly one branch moved this step: ${JSON.stringify(f)}`).toBe(true)

    await expect(page.locator(`.react-flow__edge[data-id="${moved}"] .pb-path.pb-path--gate`)).toHaveCount(1)
    await expect(page.locator(`.react-flow__edge[data-id="${moved}"] g.pb-move`)).toHaveCount(1)
    await expect(page.locator(`.pb-badge[data-badge-for="${moved}"]`)).toHaveText('+1') // from +1
    // the untaken branch: no cue at all, and its own look unchanged
    await expect(page.locator(`.react-flow__edge[data-id="${idle}"] :is(.pb-path, g.pb-move, .pb-cue)`)).toHaveCount(0)
    await expect(page.locator(`.pb-badge[data-badge-for="${idle}"]`)).toHaveCount(0)
    expect(await look(idle)).toEqual(idle === 'e_a' ? rest.a : rest.b)
    // a connection that is not a Gate output carries its token and badge, but
    // no highlight
    for (const id of ['e_in', 'e_g']) {
      if ((f[id] ?? 0) > 0) await expect(page.locator(`.react-flow__edge[data-id="${id}"] g.pb-move`)).toHaveCount(1)
      await expect(page.locator(`.react-flow__edge[data-id="${id}"] .pb-path`)).toHaveCount(0)
    }
    await call(page, 'pause')
  })
}

test('a deterministic split that moves on every branch highlights every one, each with its own +N', async ({ page }) => {
  await load(page, gateGraph('deterministic', ['1', '1']))
  await holdAt(page, 0.3, 0.6)
  const f = await flows(page)
  expect(f.e_a).toBeGreaterThan(0)
  expect(f.e_b).toBeGreaterThan(0)
  for (const id of ['e_a', 'e_b']) {
    await expect(page.locator(`.react-flow__edge[data-id="${id}"] .pb-path--gate`)).toHaveCount(1)
    await expect(page.locator(`.pb-badge[data-badge-for="${id}"]`)).toHaveText(`+${Number.isInteger(f[id]) ? f[id] : f[id].toFixed(1)}`)
  }
  await call(page, 'pause')
})

test("the connection's own label dims only while the token or its badge covers it", async ({ page }) => {
  await load(page, gateGraph('deterministic'))
  const dimmed = () => page.locator('.edge-label[data-edge-id="e_in"].edge-label--under-token')
  // early in the step the token sits at the source: the label is clear
  await call(page, 'setSpeed', 4000)
  await call(page, 'play')
  await expect.poll(async () => { const t = await tau(page); return t != null && t < 0.12 ? 1 : -1 }, { timeout: 20000 }).toBe(1)
  await call(page, 'pause')
  await expect(dimmed()).toHaveCount(0)
  // mid-travel the token crosses the middle of the connection, where its label is
  let seen = false
  for (let i = 0; i < 60 && !seen; i++) {
    await call(page, 'play')
    await page.waitForTimeout(40)
    await call(page, 'pause')
    if ((await dimmed().count()) === 1) seen = true
  }
  expect(seen, 'the label dims while the token passes over it').toBe(true)
  expect(Number(await dimmed().evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.3, 2)
  // the label never moved
  const box = await page.locator('.edge-label[data-edge-id="e_in"]').boundingBox()
  await call(page, 'reset')
  expect(await page.locator('.edge-label[data-edge-id="e_in"]').boundingBox()).toEqual(box)
  // and only a connection with a token or badge on it ever has a dimmed label
  await holdAt(page, 0.3, 0.6)
  const owners = await page.evaluate(() =>
    [...document.querySelectorAll('.edge-label.edge-label--under-token')].map((el) => (el as HTMLElement).dataset.edgeId),
  )
  for (const id of owners) await expect(page.locator(`.pb-badge[data-badge-for="${id}"]`)).toHaveCount(1)
  await call(page, 'pause')
})

test('Focus mode wins on connections: an out-of-focus connection carries its cues at its own low strength', async ({ page }) => {
  await load(page, gateGraph('deterministic'))
  // focus the Source: e_in is in the focus set, the Gate's outputs are not
  await page.evaluate(() => {
    const l = (window as any).__loop
    l.graph.getState().setSelection('src', null)
    l.ui.getState().setFocusMode(true)
  })
  await holdAt(page, 0.3, 0.6)
  const f = await flows(page)
  const moved = (f.e_a ?? 0) > 0 ? 'e_a' : 'e_b'
  const filterOf = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).filter)
  expect(await filterOf(`.react-flow__edge[data-id="${moved}"] .pb-path`)).toBe('opacity(0.26)')
  expect(await filterOf(`.react-flow__edge[data-id="${moved}"] g.pb-move`)).toBe('opacity(0.26)')
  await expect(page.locator(`.pb-badge[data-badge-for="${moved}"]`)).toHaveClass(/pb-badge--dim/)
  expect(Number(await page.locator(`.pb-badge[data-badge-for="${moved}"]`).evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.26, 2)
  // the in-focus connection's cues are at full strength
  expect(await filterOf('.react-flow__edge[data-id="e_in"] g.pb-move')).toBe('none')
  await expect(page.locator('.pb-badge[data-badge-for="e_in"]')).not.toHaveClass(/pb-badge--dim/)
  await call(page, 'pause')
})

test('forced colours: the highlight is told by width, the badge is a system-colour pill, dimming is a dash', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await load(page, gateGraph('deterministic'))
  await holdAt(page, 0.3, 0.6)
  const f = await flows(page)
  const moved = (f.e_a ?? 0) > 0 ? 'e_a' : 'e_b'
  const path = await page.locator(`.react-flow__edge[data-id="${moved}"] .pb-path`).evaluate((el) => {
    const cs = getComputedStyle(el)
    return { width: cs.strokeWidth, opacity: cs.opacity, dash: cs.strokeDasharray }
  })
  expect(path).toEqual({ width: '4px', opacity: '1', dash: 'none' })
  const badge = await page.locator(`.pb-badge[data-badge-for="${moved}"]`).evaluate((el) => {
    const cs = getComputedStyle(el)
    return { style: cs.borderTopStyle, adjust: cs.forcedColorAdjust, opacity: cs.opacity }
  })
  expect(badge).toEqual({ style: 'solid', adjust: 'none', opacity: '1' })
  await call(page, 'reset')
  // outside the focus set: not faded, dashed
  await page.evaluate(() => {
    const l = (window as any).__loop
    l.graph.getState().setSelection('src', null)
    l.ui.getState().setFocusMode(true)
  })
  await holdAt(page, 0.3, 0.6)
  const f2 = await flows(page)
  const moved2 = (f2.e_a ?? 0) > 0 ? 'e_a' : 'e_b'
  const dim = await page.locator(`.react-flow__edge[data-id="${moved2}"] .pb-path`).evaluate((el) => {
    const cs = getComputedStyle(el)
    return { dash: cs.strokeDasharray, filter: cs.filter }
  })
  expect(dim).toEqual({ dash: '1px, 5px', filter: 'none' })
  const dimBadge = await page.locator(`.pb-badge[data-badge-for="${moved2}"]`).evaluate((el) => {
    const cs = getComputedStyle(el)
    return { style: cs.borderTopStyle, opacity: cs.opacity }
  })
  expect(dimBadge).toEqual({ style: 'dashed', opacity: '1' })
  await call(page, 'pause')
})

test('reduced motion: nothing travels; the moved paths, arrival tells and +N stay static for the step', async ({ page }) => {
  await load(page, gateGraph('deterministic'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await call(page, 'stepOnce')
  await expect.poll(() => tau(page)).toBe(null)
  await expect(page.locator('g.pb-move, .pb-badge[data-playback-badge="travel"]')).toHaveCount(0)
  const active = await page.evaluate(() => ({ ...(window as any).__loop.sim.getState().activeByEdge }) as Record<string, number>)
  const moved = Object.keys(active).filter((k) => active[k] > 0).sort()
  expect(moved.length).toBeGreaterThan(0)
  for (const id of moved) {
    await expect(page.locator(`.pb-badge[data-badge-for="${id}"][data-playback-badge="static"]`)).toHaveText(`+${active[id]}`)
    await expect(page.locator(`.react-flow__edge[data-id="${id}"] .flow-edge-pulse`)).toHaveCount(1)
  }
  // held, not faded, through a pause
  await page.waitForTimeout(500)
  await expect(page.locator('.pb-badge[data-playback-badge="static"]')).toHaveCount(moved.length)
  // cleared on Reset
  await call(page, 'reset')
  await expect(page.locator('.pb-badge')).toHaveCount(0)
})

test('the cues are a view only: the committed values and the document match a run without them', async ({ page }) => {
  await load(page, gateGraph('probabilistic'))
  const digest = () => page.evaluate(() => (window as any).__loop.revisionIO.currentTargetDigest())
  const d0 = await digest()
  await call(page, 'setSpeed', 120)
  for (let i = 0; i < 6; i++) {
    await call(page, 'stepOnce')
    await expect.poll(() => tau(page)).toBe(null)
  }
  const played = await page.evaluate(() => ({ ...(window as any).__loop.sim.getState().values }))
  await call(page, 'reset')
  for (let i = 0; i < 6; i++) await call(page, 'advance')
  const advanced = await page.evaluate(() => ({ ...(window as any).__loop.sim.getState().values }))
  expect(played).toEqual(advanced)
  expect(await digest()).toBe(d0)
})
