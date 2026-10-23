import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, routesSettled, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-4.3 — a run cue is drawn in the
// colour of the element it is about: a connection's run signals in that
// connection's flow colour, a node's own cues in that node's, the default run
// colour without one; a light colour is drawn as chosen, never swapped for the
// default; under forced colours no flow colour at all.

const SLATE = 'rgb(99, 142, 165)' // the connection's colour
const GOLD = 'rgb(167, 130, 67)' // the pool's colour, not the connection's
const ROSE = 'rgb(180, 117, 153)' // the source's colour
const VIOLET = 'rgb(145, 130, 168)' // the trigger's colour
const LIGHT = 'rgb(244, 224, 77)' // a light colour (1.3:1 on the light canvas)

const FIX = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny', accent: '#B47599' } },
    { id: 'pool', type: 'pool', position: { x: 300, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', accent: '#A78243' } },
    { id: 'drn', type: 'drain', position: { x: 600, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'passive', mode: 'pullAny' } },
    { id: 'plain', type: 'source', position: { x: 0, y: 240 }, data: { kind: 'source', label: 'Plain', activation: 'automatic', mode: 'pushAny' } },
    { id: 'tank', type: 'pool', position: { x: 300, y: 240 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_sp', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3', accent: '#638EA5' } },
    { id: 't_sd', type: 'loop', source: 'src', target: 'drn', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0, accent: '#9182A8' } },
    { id: 'e_plain', type: 'loop', source: 'plain', target: 'tank', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
  ],
})

const sim = (page: Page, body: string) => page.evaluate(`(() => { const s = window.__loop.sim.getState(); ${body} })()`)
const settled = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().activeTransitionId)).toBe(null)

/** a CSS colour (a token or a value) as the computed `rgb(…)` */
const rgb = (page: Page, colour: string) =>
  page.evaluate((c) => {
    const d = document.createElement('div')
    d.style.color = c
    d.style.forcedColorAdjust = 'none' // the token's own value under forced colours too
    document.body.append(d)
    const v = getComputedStyle(d).color
    d.remove()
    return v
  }, colour)

async function load(page: Page, opts: { scheme?: 'light' | 'dark'; reduced?: boolean; forced?: boolean } = {}) {
  await page.emulateMedia({
    colorScheme: opts.scheme ?? 'light',
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    forcedColors: opts.forced ? 'active' : 'none',
  })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, FIX)
  await routesSettled(page)
  await sim(page, 's.reset()')
  await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 40, y: 80, zoom: 1 }, { duration: 0 }))
  // step 1 settles first: from step 2 the trigger delivers its bead too
  await sim(page, 's.setSpeed(600); s.stepOnce()')
  await settled(page)
}

/** start a slow step and hold it mid-travel: the step is paused, then its τ is
 *  set (the same choreography every frame of a Play draws at that τ) */
async function holdTravel(page: Page) {
  await sim(page, 's.setSpeed(3500); s.stepOnce(); s.pause()')
  await page.evaluate(async () => {
    const S = (window as any).__loop.sim
    S.setState({ transition: { ...S.getState().transition, tau: 0.5, phase: 'travel' } })
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  })
}

const edge = (page: Page, id: string, sel: string) => page.locator(`.react-flow__edge[data-id="${id}"] ${sel}`).first()
const node = (page: Page, id: string, sel: string) => page.locator(`.react-flow__node[data-id="${id}"] ${sel}`).first()

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: null, reducedMotion: null, forcedColors: null }).catch(() => {})
})

for (const scheme of ['light', 'dark'] as const) {
  test(`full motion · ${scheme}: a connection's token, badge and state bead take its colour; a node's cues take the node's; uncoloured ones the default`, async ({ page }) => {
    await load(page, { scheme })
    const run = await rgb(page, 'var(--accent)')
    const ink = await rgb(page, 'var(--ink-1)')
    await holdTravel(page)
    await expect(edge(page, 'e_sp', 'g.pb-move .flow-bead')).toHaveCSS('fill', SLATE)
    const badge = page.locator('.pb-badge[data-badge-for="e_sp"]')
    await expect(badge).toHaveCSS('border-top-color', SLATE)
    await expect(badge).toHaveCSS('color', ink) // the amount keeps the primary ink
    await expect(edge(page, 't_sd', 'g.state-move--trigger .state-move__bead')).toHaveCSS('fill', VIOLET)
    // no colour: the default run colour
    await expect(edge(page, 'e_plain', 'g.pb-move .flow-bead')).toHaveCSS('fill', run)
    await expect(page.locator('.pb-badge[data-badge-for="e_plain"]')).toHaveCSS('border-top-color', run)
    // the source's own fired mark: its colour, not its connection's
    await expect(node(page, 'src', '.nodef__fired-ticks')).toHaveCSS('stroke', ROSE)
    await expect(node(page, 'plain', '.nodef__fired-ticks')).toHaveCSS('stroke', run)
    // arrival: the pool's tint is the POOL's colour, never the incoming slate
    await page.evaluate(async () => {
      const S = (window as any).__loop.sim
      S.setState({ transition: { ...S.getState().transition, tau: 0.9, phase: 'arrive' } })
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    })
    await expect(edge(page, 'e_sp', '.pb-cue--arrive')).toHaveCSS('stroke', SLATE)
    await expect(edge(page, 'e_plain', '.pb-cue--arrive')).toHaveCSS('stroke', run)
    await expect(node(page, 'pool', '.nodef__pulse-tint')).toHaveCSS('fill', GOLD)
    await expect(node(page, 'tank', '.nodef__pulse-tint')).toHaveCSS('fill', run)
  })
}

test('L0: the travel pulse takes the connection colour', async ({ page }) => {
  await load(page)
  await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 40, y: 80, zoom: 0.4 }, { duration: 0 }))
  await holdTravel(page)
  await expect(edge(page, 'e_sp', '.pb-l0-pulse')).toHaveCSS('stroke', SLATE)
  await expect(edge(page, 'e_plain', '.pb-l0-pulse')).toHaveCSS('stroke', await rgb(page, 'var(--accent)'))
})

test('reduced motion: the held highlight, the role tells, the static badge and the state highlight take the connection colour', async ({ page }) => {
  await load(page, { reduced: true })
  const run = await rgb(page, 'var(--accent)')
  await sim(page, 's.setSpeed(600); s.stepOnce()')
  await settled(page)
  await expect(edge(page, 'e_sp', '.flow-edge-pulse')).toHaveCSS('stroke', SLATE)
  await expect(edge(page, 'e_sp', '.pb-rm-tell--emit')).toHaveCSS('fill', SLATE)
  await expect(edge(page, 'e_sp', '.pb-rm-tell--converge')).toHaveCSS('fill', SLATE)
  await expect(page.locator('.pb-badge[data-badge-for="e_sp"][data-playback-badge="static"]')).toHaveCSS('border-top-color', SLATE)
  await expect(edge(page, 'e_plain', '.flow-edge-pulse')).toHaveCSS('stroke', run)
  await expect(edge(page, 't_sd', '.state-edge-pulse')).toHaveCSS('stroke', VIOLET)
})

test('a light colour is drawn as chosen: not swapped for the default, not darkened', async ({ page }) => {
  await load(page)
  await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['pool'], ['e_sp'], '#F4E04D'))
  await holdTravel(page)
  await expect(edge(page, 'e_sp', 'g.pb-move .flow-bead')).toHaveCSS('fill', LIGHT)
  await expect(page.locator('.pb-badge[data-badge-for="e_sp"]')).toHaveCSS('border-top-color', LIGHT)
  await expect(page.locator('.pb-badge[data-badge-for="e_sp"]')).toHaveCSS('color', await rgb(page, 'var(--ink-1)'))
})

test('a colour under 3:1 on this canvas gets the neutral case beside its run signals; an ordinary colour, the dark canvas and rest get none', async ({ page }) => {
  await load(page)
  const rim = await rgb(page, 'var(--line-3)')
  await page.evaluate(() => (window as any).__loop.graph.getState().setAccent([], ['e_sp'], '#F4E04D'))
  await holdTravel(page)
  // the colour stays the colour; the case only rims it
  await expect(edge(page, 'e_sp', 'g.pb-move .flow-bead')).toHaveCSS('fill', LIGHT)
  await expect(edge(page, 'e_sp', 'g.pb-move .flow-bead')).toHaveCSS('stroke', rim)
  await expect(edge(page, 'e_sp', 'g.pb-move .flow-bead')).toHaveCSS('paint-order', 'stroke')
  await expect(page.locator('.pb-badge[data-badge-for="e_sp"]')).toHaveClass(/pb-badge--cased/)
  // the trigger keeps an ordinary colour (Violet, 3.46:1): no case
  await expect(edge(page, 't_sd', 'g.state-move--trigger')).not.toHaveAttribute('data-run-case', /.*/)
  await expect(edge(page, 'e_plain', 'g.pb-move')).not.toHaveAttribute('data-run-case', /.*/)
  // on the dark canvas the same colour is 11.8:1: no case
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect(edge(page, 'e_sp', 'g.pb-move')).not.toHaveAttribute('data-run-case', /.*/)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await expect(edge(page, 'e_sp', 'g.pb-move')).toHaveAttribute('data-run-case', '')
  await sim(page, 's.stepOnce()')
  await settled(page)
  // at rest nothing is cased; reduced motion: the held highlight's rim, cut out under the colour
  await expect(page.locator('.run-case, .run-case-ring, [data-run-case]')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sim(page, 's.setSpeed(600); s.stepOnce()')
  await settled(page)
  await expect(edge(page, 'e_sp', '.run-case--pulse .run-case__rim')).toHaveCSS('stroke', rim)
  await expect(edge(page, 'e_sp', '.run-case--pulse .run-case__rim')).toHaveCSS('stroke-width', '4px')
  await expect(edge(page, 'e_sp', '.run-case--pulse .run-case__inner')).toHaveCSS('stroke-width', '2.5px')
  await expect(edge(page, 'e_sp', '.flow-edge-pulse')).toHaveCSS('stroke', LIGHT)
  await expect(edge(page, 'e_plain', '.run-case')).toHaveCount(0)
  // forced colours: the case is not drawn at all
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await expect(edge(page, 'e_sp', '.run-case--pulse')).toHaveCSS('display', 'none')
  await expect(edge(page, 'e_sp', '.pb-rm-tell--converge')).not.toHaveCSS('stroke', rim)
})

test('a light NODE colour: its fired ticks get the case on the canvas, its arrival tint shows a neutral inner edge; an ordinary node colour gets none', async ({ page }) => {
  await load(page)
  const rim = await rgb(page, 'var(--line-3)')
  // the source and the pool light; the plain source keeps no colour, the tank an ordinary one
  await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['src', 'pool'], [], '#BFE3F0'))
  await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['tank'], [], '#638EA5'))
  await expect(node(page, 'src', '.nodef')).toHaveAttribute('data-run-case', 'out in')
  await expect(node(page, 'tank', '.nodef')).not.toHaveAttribute('data-run-case', /.*/)
  await holdTravel(page)
  await expect(node(page, 'src', '.nodef__fired-ticks')).toHaveCSS('stroke', 'rgb(191, 227, 240)')
  await expect(node(page, 'src', '.nodef__fired-case')).toHaveCSS('stroke', rim)
  await expect(node(page, 'plain', '.nodef__fired-case')).toHaveCount(0)
  await page.evaluate(async () => {
    const S = (window as any).__loop.sim
    S.setState({ transition: { ...S.getState().transition, tau: 0.9, phase: 'arrive' } })
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  })
  // the tint keeps the node's colour; only its inner edge is drawn, 1 px, neutral
  await expect(node(page, 'pool', '.nodef__pulse-tint')).toHaveCSS('fill', 'rgb(191, 227, 240)')
  await expect(node(page, 'pool', '.nodef__pulse-line')).toHaveCSS('display', 'inline')
  await expect(node(page, 'pool', '.nodef__pulse-line')).toHaveCSS('stroke', rim)
  await expect(node(page, 'pool', '.nodef__pulse-line')).toHaveCSS('stroke-width', '16px')
  await expect(node(page, 'tank', '.nodef__pulse-line')).toHaveCSS('display', 'none')
  // forced colours: no case; the arrival line is its own system-colour form
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(node(page, 'src', '.nodef__fired-case')).toHaveCSS('display', 'none')
  await expect(node(page, 'pool', '.nodef__pulse-line')).not.toHaveCSS('stroke', rim)
  await expect(node(page, 'tank', '.nodef__pulse-line')).toHaveCSS('display', 'inline')
})

test('forced colours: no run signal draws a flow colour', async ({ page }) => {
  await load(page, { forced: true })
  await holdTravel(page)
  await expect(edge(page, 'e_sp', 'g.pb-move .flow-bead')).not.toHaveCSS('fill', SLATE)
  await expect(page.locator('.pb-badge[data-badge-for="e_sp"]')).not.toHaveCSS('border-top-color', SLATE)
  await expect(node(page, 'src', '.nodef__fired-ticks')).not.toHaveCSS('stroke', ROSE)
  await sim(page, 's.stepOnce()')
  await settled(page)
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await sim(page, 's.setSpeed(600); s.stepOnce()')
  await settled(page)
  await expect(edge(page, 'e_sp', '.flow-edge-pulse')).toHaveCSS('stroke', await rgb(page, 'var(--accent)'))
  await expect(edge(page, 't_sd', '.state-edge-pulse')).toHaveCSS('stroke', await rgb(page, 'var(--accent)'))
})
