import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// issue #329 — Focus mode dims the connections outside the focus set
// (docs/large-graph-readability.md §LGR3.1): the path and its arrowhead at 0.26.
// An unsatisfied activator connection is 0.5 inside the focus set and 0.26
// outside it (Focus wins). Under forced colours a dimmed connection is not
// faded: opacity 1 and the sparse `1 5` dash are its tell. These read the
// DRAWN opacity: the class alone was asserted before, and an inline `opacity`
// on every path beat the stylesheet rule unseen.

const STATE = readFileSync(new URL('../examples/state-verification.json', import.meta.url), 'utf8')
const EQUILIBRIUM = readFileSync(new URL('../examples/equilibrium.json', import.meta.url), 'utf8')

type Loop = {
  __loop: Record<string, { getState: () => any }> & { rf: { fitView: (o: object) => void } }
}
type Drawn = { out: boolean; activatorOff: boolean; opacity: string; dash: string; inline: string; marker: string | null }

/** commit `n` steps at the fastest beat, waiting for each transition to settle */
const steps = (page: Page, n: number) =>
  page.evaluate(async (n) => {
    const S = (window as unknown as Loop).__loop.sim
    S.getState().setSpeed(120)
    for (let i = 0; i < n; i++) {
      S.getState().stepOnce()
      while (S.getState().transition) await new Promise((r) => requestAnimationFrame(r))
    }
  }, n)

/** select a node by clicking it, centred first so no panel covers it */
const clickNode = async (page: Page, nodeId: string) => {
  await page.evaluate((id) => (window as unknown as Loop).__loop.rf.fitView({ nodes: [{ id }], duration: 0, maxZoom: 1, padding: 1.5 }), nodeId)
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click()
}

const focusOn = async (page: Page, nodeId: string) => {
  await page.evaluate(() => (window as unknown as Loop).__loop.ui.getState().setFocusMode(true))
  await clickNode(page, nodeId)
  await expect(page.locator('.react-flow__edge.lgr-deemph').first()).toBeAttached()
}

/** per connection: in or out of the focus set, its activator verdict, and the drawn path */
const drawn = (page: Page): Promise<Record<string, Drawn>> =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.react-flow__edge')].map((e) => {
        const p = e.querySelector('path.react-flow__edge-path') as SVGPathElement
        const c = getComputedStyle(p)
        return [
          (e as HTMLElement).dataset.id,
          {
            out: e.classList.contains('lgr-deemph'),
            activatorOff: p.classList.contains('edge-activator-off'),
            opacity: c.opacity,
            dash: c.strokeDasharray,
            inline: p.style.opacity,
            marker: p.getAttribute('marker-end'),
          },
        ]
      }),
    ),
  )

const openStateGraph = async (page: Page) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, STATE)
  await page.locator('.react-flow__node[data-id="gauge_b"]').waitFor()
  // three steps: `a_ga_pd` is an unsatisfied activator, `a_gb_pd` a satisfied one
  await steps(page, 3)
}

test.describe('#329 Focus mode dims the connections outside the focus set', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: outside 0.26 (Focus wins over an unsatisfied activator's 0.5), inside 1 or 0.5, with no inline opacity`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openStateGraph(page)

      const off = await drawn(page)
      expect(off.a_ga_pd).toMatchObject({ out: false, activatorOff: true, opacity: '0.5' })
      expect(off.a_gb_pd).toMatchObject({ out: false, activatorOff: false, opacity: '1' })
      for (const [id, e] of Object.entries(off)) {
        expect(e.inline, `${id}: no inline opacity left to beat the stylesheet`).toBe('')
        if (!e.activatorOff) expect(e.opacity, `${id}: Focus off, full strength`).toBe('1')
      }

      // gauge_a in focus: its unsatisfied activator inside (0.5), the satisfied one outside (0.26)
      await focusOn(page, 'gauge_a')
      const a = await drawn(page)
      expect(a.a_ga_pd).toMatchObject({ out: false, activatorOff: true, opacity: '0.5' })
      expect(a.a_gb_pd).toMatchObject({ out: true, activatorOff: false, opacity: '0.26' })
      expect(a.e_gsrc_ga).toMatchObject({ out: false, opacity: '1' })

      // gauge_b in focus: the unsatisfied activator outside — Focus's 0.26 wins over its 0.5
      await clickNode(page, 'gauge_b')
      await expect.poll(async () => (await drawn(page)).a_ga_pd.out).toBe(true)
      const b = await drawn(page)
      expect(b.a_ga_pd).toMatchObject({ out: true, activatorOff: true, opacity: '0.26' })
      expect(b.a_gb_pd).toMatchObject({ out: false, activatorOff: false, opacity: '1' })
      for (const [id, e] of Object.entries(b)) {
        if (e.out) expect(e.opacity, `${id}: outside the focus set`).toBe('0.26')
        // the arrowhead is the path's own marker, so it is painted at the path's opacity
        expect(e.marker, `${id}: the arrowhead is the path's marker`).toMatch(/^url\(#/)
      }
    })
  }

  test.describe('forced colours', () => {
    test.use({ contextOptions: { forcedColors: 'active' } })
    test('a dimmed connection is not faded: opacity 1 and the `1 5` dash, an unsatisfied activator included', async ({ page }) => {
      await openStateGraph(page)
      await focusOn(page, 'gauge_a')
      const a = await drawn(page)
      // inside the focus set an unsatisfied activator keeps its 0.5, as before
      expect(a.a_ga_pd).toMatchObject({ out: false, activatorOff: true, opacity: '0.5' })
      await clickNode(page, 'gauge_b')
      await expect.poll(async () => (await drawn(page)).a_ga_pd.out).toBe(true)
      const b = await drawn(page)
      expect(b.a_ga_pd).toMatchObject({ out: true, activatorOff: true, opacity: '1', dash: '1px, 5px' })
      for (const [id, e] of Object.entries(b)) {
        if (!e.out) continue
        expect(e.opacity, `${id}: not faded under forced colours`).toBe('1')
        expect(e.dash, `${id}: the sparse dash is the tell`).toBe('1px, 5px')
      }
    })
  })

  test('during a played step the dimmed path is 0.26 and the playback token keeps its strength and colour', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, EQUILIBRIUM)
    await page.locator('.react-flow__node[data-id="tpl-gate"]').waitFor()
    await focusOn(page, 'tpl-src')
    await steps(page, 1)
    await page.evaluate(() => {
      const s = (window as unknown as Loop).__loop.sim.getState()
      s.setSpeed(2400)
      s.stepOnce()
    })
    await page.waitForFunction(() => {
      const t = (window as unknown as Loop).__loop.sim.getState().transition
      return t && t.tau > 0.5
    }, null, { polling: 'raf' })
    await page.evaluate(() => (window as unknown as Loop).__loop.sim.getState().pause())
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__edge')]
        .filter((e) => e.querySelector('.pb-move'))
        .map((e) => ({
          id: (e as HTMLElement).dataset.id,
          out: e.classList.contains('lgr-deemph'),
          path: getComputedStyle(e.querySelector('path.react-flow__edge-path')!).opacity,
          token: getComputedStyle(e.querySelector('.pb-move')!).opacity,
          bead: getComputedStyle(e.querySelector('.flow-bead')!).fill,
        })),
    )
    const inside = rows.filter((r) => !r.out)
    const outside = rows.filter((r) => r.out)
    expect(inside.length, 'a token on an in-focus connection').toBeGreaterThan(0)
    expect(outside.length, 'a token on a dimmed connection').toBeGreaterThan(0)
    for (const r of inside) expect(r.path, r.id).toBe('1')
    for (const r of outside) expect(r.path, r.id).toBe('0.26')
    // the playback cues are unchanged by this fix (#330 decides their Focus policy)
    for (const r of rows) {
      expect(r.token, `${r.id}: the token is not dimmed by this fix`).toBe('1')
      expect(r.bead, `${r.id}: the token keeps the run colour`).toBe(inside[0].bead)
    }
  })
})
