import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { fitCount, frames, misfits, readRows, ROWS_GRAPH, zoomOne } from './support/rowFit'

// issue #332 — a Pool's value and capacity, a Parameter's value and unit and a
// Register's result and `= expr` start where the title text starts and keep
// 8 px inside the DRAWN outline at both ends (./src/components/nodes/rowFit).
// The fit is taken when the content or the size changes, never per frame.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const EXAMPLES = [
  ['coffee-roastery.json', 'cafe_retail_demand_kg'],
  ['gacha-banner-zones.json', 'cmp1_hit_rate_free'],
  ['mmo-progression.json', 'char_creation'],
] as const
const example = (f: string) => readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8')

/** a Source feeding a Pool by 1 a step, a Register reading the Pool */
const RUN_GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'In', activation: 'automatic', mode: 'pushAny' } },
    { id: 'p', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Stock', activation: 'passive', initial: 10, mode: 'pullAny' } },
    { id: 'r', type: 'register', position: { x: 240, y: 160 }, data: { kind: 'register', label: 'Twice', expr: '@p * 2' } },
  ],
  edges: [
    { id: 'e1', source: 'src', target: 'p', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
  ],
})

const load = async (page: Page, json: string, waitId: string) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, json)
  await page.locator(`.react-flow__node[data-id="${waitId}"]`).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await zoomOne(page)
  await frames(page, 2)
}

/** commit `n` steps at the fastest beat, waiting for each transition */
const steps = (page: Page, n: number) =>
  page.evaluate(async (n) => {
    const S = (window as unknown as Bridge).__loop.sim
    S.getState().setSpeed(120)
    for (let i = 0; i < n; i++) {
      S.getState().stepOnce()
      while (S.getState().transition) await new Promise((r) => requestAnimationFrame(r))
    }
  }, n)

const digest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })

test.describe('#332 value and detail rows inside the vessel', () => {
  for (const scheme of ['light', 'dark', 'forced'] as const) {
    test(`${scheme}: every row starts at the title and keeps 8 px inside the outline`, async ({ page }) => {
      if (scheme === 'forced') await page.emulateMedia({ forcedColors: 'active' })
      else await page.emulateMedia({ colorScheme: scheme })
      await load(page, ROWS_GRAPH, 'Converter')
      const rows = await readRows(page)
      expect(rows.length).toBe(21)
      expect(misfits(rows)).toEqual([])
      // the long Pool value is cut short where the slanted side would reach its title
      expect(rows.find((r) => r.id === 'Pool long' && r.key === 'value')!.clipped).toBe(true)
    })
  }

  for (const [file, waitId] of EXAMPLES) {
    test(`${file}: every row fits after ten steps`, async ({ page }) => {
      await load(page, example(file), waitId)
      await steps(page, 10)
      await frames(page, 30) // past the value bump
      expect(misfits(await readRows(page))).toEqual([])
    })
  }

  test('ar: the rows start on the chip side, physically left, Arabic unit included', async ({ page }) => {
    await load(page, ROWS_GRAPH, 'Converter')
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('ar'))
    await page.waitForFunction(() => document.documentElement.dir === 'rtl')
    await page.evaluate(() => document.fonts.ready)
    await frames(page, 2)
    const rows = await readRows(page)
    expect(misfits(rows)).toEqual([])
    const ar = rows.find((r) => r.id === 'Param ar' && r.key === 'sub')!
    expect(ar.vsTitle).toBeGreaterThanOrEqual(-0.5)
    expect(ar.vsTitle).toBeLessThan(1)
  })

  test('the Source, Drain and Converter mode rows are left as they were', async ({ page }) => {
    await load(page, ROWS_GRAPH, 'Converter')
    const out = await page.evaluate(() =>
      ['Source', 'Drain', 'Converter'].map((id) => {
        const f = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .nodef`)!
        return { id, style: f.getAttribute('style') ?? '', margin: getComputedStyle(f.querySelector('.nodef__sub')!).marginLeft }
      }),
    )
    for (const o of out) {
      expect(o.style).not.toContain('--vra')
      expect(o.margin).toBe('0px')
    }
  })

  test('selection, keyboard focus, Focus mode and the activity overlay move no row and take no measurement', async ({ page }) => {
    await load(page, ROWS_GRAPH, 'Converter')
    const before = await readRows(page)
    const n0 = await fitCount(page)
    await page.locator('.react-flow__node[data-id="Reg 189"]').click()
    await page.keyboard.press('Tab')
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.ui.getState().setFocusMode(true)
      l.ui.getState().setActivityOverlay(true)
    })
    await page.locator('.react-flow__node[data-id="Param 189"]').hover()
    await frames(page, 10)
    expect(await fitCount(page)).toBe(n0)
    expect(await readRows(page)).toEqual(before)
  })

  test('the fit leaves the graph alone: the content digest does not move', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, example('mmo-progression.json'))
    const d0 = await digest(page)
    await page.locator('.react-flow__node[data-id="char_creation"]').waitFor()
    await zoomOne(page)
    await frames(page, 10)
    expect(await digest(page)).toBe(d0)
  })

  test('idle, pan and zoom take no measurement', async ({ page }) => {
    await load(page, ROWS_GRAPH, 'Converter')
    const n0 = await fitCount(page)
    await frames(page, 60)
    await page.evaluate(() => {
      const rf = (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf
      rf.setViewport({ x: -200, y: 40, zoom: 0.5 }, { duration: 0 }) // L1: the sub rows hide, nothing reflows
    })
    await frames(page, 10)
    await zoomOne(page)
    await frames(page, 10)
    expect(await fitCount(page)).toBe(n0)
  })

  test('a new number of the same length is read once, on the commit that shows it', async ({ page }) => {
    await load(page, RUN_GRAPH, 'r')
    const value = (id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__value`).textContent()
    expect(await value('p')).toContain('10')
    const n0 = await fitCount(page)
    await steps(page, 1)
    await frames(page, 30)
    expect(await value('p')).toContain('11')
    expect(await value('r')).toContain('22')
    // one read each for the Pool and the Register, none for the frames between
    expect(await fitCount(page) - n0).toBe(2)
  })

  test('playback: a measurement only on the frame a row text changes, never per animation frame', async ({ page }) => {
    await load(page, RUN_GRAPH, 'r')
    const trace = await page.evaluate(async () => {
      const l = (window as unknown as { __loop: Record<string, any> }).__loop
      const sig = () =>
        [...document.querySelectorAll('.nodef--pool, .nodef--parameter, .nodef--register')]
          .map((f) => [...f.querySelectorAll('.nodef__value, .nodef__sub')].map((e) => e.textContent).join('|'))
          .join('#')
      const S = l.sim
      S.getState().setSpeed(120)
      S.getState().play()
      const out: { count: number; sig: string }[] = []
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        out.push({ count: l.rowFit.count(), sig: sig() })
      }
      S.getState().pause()
      return out
    })
    let reads = 0
    let changes = 0
    for (let i = 1; i < trace.length; i++) {
      const read = trace[i].count - trace[i - 1].count
      const changed = trace[i].sig !== trace[i - 1].sig
      if (changed) changes++
      if (read > 0) {
        reads++
        // the read lands on the frame the new text is committed
        expect(changed, `frame ${i}: a measurement without a row change`).toBe(true)
      }
    }
    expect(changes).toBeGreaterThan(3)
    expect(reads).toBe(changes)
    expect(reads).toBeLessThan(trace.length / 4)
  })
})
