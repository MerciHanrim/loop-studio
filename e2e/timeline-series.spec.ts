import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  ensureTimelineOpen,
  expect,
  FIXTURE_POOLS_4,
  importGraph,
  openApp,
  readFixture,
  resetAll,
  runMc,
  test,
} from './support/loop'

// docs/timeline-series-contract.md — `recommendedRunConfig.timelineSeries`, the
// stored Timeline series choice, and the surfaces that read it:
//   • three stored states: field ABSENT (internal `auto`, first 8 in document
//     order, never written), `'all'` (every series, future ones included), an
//     explicit sorted id list (exactly those ids);
//   • the header is always ONE ROW; the chip count is not the drawn count;
//   • the series selector (`계열 n/total` → a dialog of checkboxes) replaces the
//     old inline `+N more` chip, which must be unreachable;
//   • `'all'` is reached only through "Show all" — checking every box by hand
//     is an explicit choice of the series that exist NOW (§6.1, decision A);
//   • at least one series while one is eligible; zero eligible ⇒ `0/0`, disabled;
//   • the panel starts collapsed and auto-expands on the first run (§7);
//   • a pure display preference: NEVER in the GraphDoc, the digest, undo or
//     `simulationRev`; every graph Export writes it back; the autosave record
//     persists it (and only it) so a plain reload restores it.

type Bridge = { __loop: Record<string, { getState: () => any } & Record<string, unknown>> }

const STORAGE_KEY = 'loop-studio:graph:v1'

/** Source ─1→ P1 ─1→ Drain ; Source ─1→ P2 ; plus two Registers (4 series). */
async function seed(page: Page, timelineSeries?: string[] | 'all') {
  await page.evaluate((ts) => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    g.newGraph()
    const nodes = [
      { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
      { id: 'p1', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'p2', type: 'pool', position: { x: 200, y: 120 }, data: { kind: 'pool', label: 'P2', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'snk', type: 'drain', position: { x: 400, y: 0 }, data: { kind: 'drain', label: 'Snk', activation: 'automatic', mode: 'pullAny' } },
      { id: 'reg_a', type: 'register', position: { x: 600, y: 0 }, data: { kind: 'register', label: 'Reg A', expr: '@p1 + @p2' } },
      { id: 'reg_b', type: 'register', position: { x: 600, y: 120 }, data: { kind: 'register', label: 'Reg B', expr: '@p1 * 2' } },
    ]
    const edges = [
      { id: 'e1', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'e2', source: 'src', target: 'p2', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'e3', source: 'p1', target: 'snk', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    ]
    g.loadDoc({ nodes, edges })
    l.mc.getState().applyRecommended(ts ? { timelineSeries: ts } : {})
  }, timelineSeries)
}

/** Source ─→ Drain only: NO Pool and NO Register — zero eligible series (§6.2). */
async function seedNoSeries(page: Page) {
  await page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    g.newGraph()
    g.loadDoc({
      nodes: [
        { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
        { id: 'snk', type: 'drain', position: { x: 400, y: 0 }, data: { kind: 'drain', label: 'Snk', activation: 'automatic', mode: 'pullAny' } },
      ],
      edges: [{ id: 'e1', source: 'src', target: 'snk', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
    })
    l.mc.getState().applyRecommended({})
  })
}

/** N Pools fed by one Source, no field ⇒ `auto` (the cap case). */
async function seedPools(page: Page, n: number) {
  await page.evaluate((count) => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    g.newGraph()
    const nodes: unknown[] = [
      { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    ]
    const edges: unknown[] = []
    for (let i = 0; i < count; i++) {
      const id = `q${String(i).padStart(2, '0')}`
      nodes.push({ id, type: 'pool', position: { x: 200, y: i * 60 }, data: { kind: 'pool', label: `Q${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })
      edges.push({ id: `e_${id}`, source: 'src', target: id, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } })
    }
    g.loadDoc({ nodes, edges })
    l.mc.getState().applyRecommended({})
  }, n)
}

const seriesState = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().timelineSeries)

/** what the autosave record stores under `recommendedRunConfig.timelineSeries` */
const storedField = (page: Page) =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k)
    if (!raw) return 'NO_RECORD'
    const rrc = JSON.parse(raw).recommendedRunConfig
    return rrc && 'timelineSeries' in rrc ? rrc.timelineSeries : 'ABSENT'
  }, STORAGE_KEY)

const graphDigest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })

const canUndo = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)

const stepN = (page: Page, n: number) =>
  page.evaluate((k) => {
    const l = (window as unknown as Bridge).__loop
    l.sim.getState().reset()
    for (let i = 0; i < k; i++) l.sim.getState().stepOnce()
  }, n)

const addPool = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as Bridge).__loop.graph.getState().addNodeAt('pool', { x: 300, y: 300 })
  })

const reload = async (page: Page) => {
  await page.reload()
  await expect(page.locator('.canvas')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
}

const trigger = (page: Page) => page.locator('.timeline__series')
const popover = (page: Page) => page.locator('.tl-series')
const legend = (page: Page) => page.locator('.timeline__legend')
const chip = (page: Page, label: string) => legend(page).locator('.timeline__key', { hasText: label })

async function openSelector(page: Page) {
  await trigger(page).click()
  await expect(popover(page)).toBeVisible()
}

/** the legend's geometry — the things §5 pins */
const headerGeometry = (page: Page) =>
  page.evaluate(() => {
    const legend = document.querySelector('.timeline__legend') as HTMLElement
    const kids = [...legend.children] as HTMLElement[]
    // one row ⇔ every child's box shares a horizontal band: the lowest top is
    // above the highest bottom. (Tops alone differ on one row — a bordered
    // trigger, a 9px CSV control and a chip are centred at different heights.)
    const boxes = kids.map((el) => el.getBoundingClientRect())
    const oneRow = Math.max(...boxes.map((b) => b.top)) < Math.min(...boxes.map((b) => b.bottom))
    const trig = document.querySelector('.timeline__series')!.getBoundingClientRect()
    const head = document.querySelector('.timeline__head')!.getBoundingClientRect()
    const plot = document.querySelector('.timeline__plot')!.getBoundingClientRect()
    const legendBox = legend.getBoundingClientRect()
    // `scrollWidth` is blind to overflow on the START side (the row is
    // end-aligned), so clipping is asserted from the boxes themselves
    const allInside = boxes.every((b) => b.left >= legendBox.left - 0.5 && b.right <= legendBox.right + 0.5)
    return {
      rows: oneRow ? 1 : 2,
      allInside,
      chips: legend.querySelectorAll('.timeline__key').length,
      headH: head.height,
      plotH: plot.height,
      triggerInside: trig.left >= legendBox.left - 0.5 && trig.right <= legendBox.right + 0.5 && trig.right <= window.innerWidth,
      triggerH: trig.height,
      overflow: legend.scrollWidth - legend.clientWidth,
      moreChips: document.querySelectorAll('.timeline__key--more').length,
    }
  })

test.describe('recommendedRunConfig.timelineSeries — the three stored states', () => {
  test('an explicit list ⇒ exactly those series are drawn; the selector shows every series with those checked; no "+N more" exists', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'reg_a'])
    expect(await seriesState(page)).toEqual(['p1', 'reg_a'])
    await ensureTimelineOpen(page)

    await expect(chip(page, 'P1')).toBeVisible()
    await expect(chip(page, 'Reg A')).toBeVisible()
    await expect(chip(page, 'P2')).toHaveCount(0)
    await expect(trigger(page)).toHaveText('Series 2/4')
    await expect(trigger(page)).toHaveAttribute('aria-label', 'Choose chart series, 2 of 4 shown')
    await expect(trigger(page)).toHaveAttribute('aria-haspopup', 'dialog')
    // §6.3 — the old inline expansion is gone, not accompanied
    await expect(page.locator('.timeline__key--more')).toHaveCount(0)

    await openSelector(page)
    const boxes = popover(page).getByRole('checkbox')
    await expect(boxes).toHaveCount(4)
    await expect(popover(page).getByRole('checkbox', { name: 'P1' })).toBeChecked()
    await expect(popover(page).getByRole('checkbox', { name: 'Reg A' })).toBeChecked()
    await expect(popover(page).getByRole('checkbox', { name: 'P2' })).not.toBeChecked()
    await expect(popover(page).getByRole('checkbox', { name: 'Reg B' })).not.toBeChecked()

    // check P2 → it joins the drawn set and the legend
    await popover(page).getByRole('checkbox', { name: 'P2' }).check()
    expect(await seriesState(page)).toEqual(['p1', 'p2', 'reg_a'])
    await expect(chip(page, 'P2')).toBeVisible()
    await expect(trigger(page)).toHaveText('Series 3/4')
    // …and it is written immediately, as a user action must be
    expect(await storedField(page)).toEqual(['p1', 'p2', 'reg_a'])
  })

  test('no field ⇒ "auto": the first 8 in document order are drawn (lines, not just chips) and the record stays without the field', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seedPools(page, 12)
    expect(await seriesState(page)).toBe('auto')
    await stepN(page, 4) // a run — and the §7 auto-expand
    await expect(page.locator('.timeline__panel')).toBeVisible()

    await expect(trigger(page)).toHaveText('Series 8/12')
    // the cap applies to what is RENDERED (§4): 8 lines and 8 beads, not 12
    await expect(page.locator('.timeline__line:not(.timeline__line--register)')).toHaveCount(8)
    await expect(page.locator('.timeline__bead')).toHaveCount(8)
    // document order: Q0..Q7, not an alphabetical or arbitrary eight
    await openSelector(page)
    for (let i = 0; i < 12; i++) {
      const box = popover(page).getByRole('checkbox', { name: `Q${i}`, exact: true })
      if (i < 8) await expect(box).toBeChecked()
      else await expect(box).not.toBeChecked()
    }
    // the automatic default is NEVER written — after the load's own debounced
    // autosave (400ms) has run, the field is still absent (§3.2)
    await page.waitForTimeout(600)
    expect(await storedField(page)).toBe('ABSENT')
  })

  test('checking every box by hand stores the EXPLICIT array — a series added later is not drawn; Show all stores "all" — a series added later IS drawn; Reset removes the field', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await ensureTimelineOpen(page)
    await openSelector(page)

    for (const label of ['P2', 'Reg A', 'Reg B']) {
      await popover(page).getByRole('checkbox', { name: label }).check()
    }
    // §6.1 decision A: every current id, as an explicit array — NOT 'all'
    expect(await seriesState(page)).toEqual(['p1', 'p2', 'reg_a', 'reg_b'])
    expect(await storedField(page)).toEqual(['p1', 'p2', 'reg_a', 'reg_b'])
    await expect(trigger(page)).toHaveText('Series 4/4')

    // a fifth series appears: the explicit choice does not widen to include it
    await addPool(page)
    await expect(trigger(page)).toHaveText('Series 4/5')
    expect(await seriesState(page)).toEqual(['p1', 'p2', 'reg_a', 'reg_b'])

    // the named action is the ONLY way to 'all'
    const showAll = popover(page).getByRole('button', { name: 'Show all' })
    // …and its future-inclusive meaning is said in words, bound as its description
    await expect(showAll).toHaveAccessibleDescription('Shows every series, including ones added later.')
    await showAll.click()
    expect(await seriesState(page)).toBe('all')
    expect(await storedField(page)).toBe('all')
    await expect(trigger(page)).toHaveText('Series 5/5')
    // a sixth series appears: 'all' draws it
    await addPool(page)
    await expect(trigger(page)).toHaveText('Series 6/6')

    // reset to automatic: the field is REMOVED, not written as anything
    await popover(page).getByRole('button', { name: 'Reset to automatic selection' }).click()
    expect(await seriesState(page)).toBe('auto')
    expect(await storedField(page)).toBe('ABSENT')
    await expect(trigger(page)).toHaveText('Series 6/6') // six ≤ the cap of eight
  })

  test('"all" is a STORED choice: a plain reload comes back as "all" because the record holds it, distinct from "auto"', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await ensureTimelineOpen(page)
    await openSelector(page)
    await popover(page).getByRole('button', { name: 'Show all' }).click()
    expect(await seriesState(page)).toBe('all')

    await reload(page)
    expect(await seriesState(page)).toBe('all')
    expect(await storedField(page)).toBe('all')
    await ensureTimelineOpen(page)
    await expect(trigger(page)).toHaveText('Series 4/4')
  })

  test('a plain reload keeps an explicit subset (the autosave record carries it)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await ensureTimelineOpen(page)
    await expect(trigger(page)).toHaveText('Series 1/4')

    await reload(page)
    expect(await seriesState(page)).toEqual(['p1'])
    await ensureTimelineOpen(page)
    await expect(chip(page, 'P1')).toBeVisible()
    await expect(chip(page, 'P2')).toHaveCount(0)
    await expect(trigger(page)).toHaveText('Series 1/4')
  })

  test('a document with NO field reloads to "auto" — and the record still carries no field', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    expect(await seriesState(page)).toBe('auto')
    await reload(page)
    expect(await seriesState(page)).toBe('auto')
    expect(await storedField(page)).toBe('ABSENT')
    await ensureTimelineOpen(page)
    await expect(trigger(page)).toHaveText('Series 4/4')
    for (const label of ['P1', 'P2', 'Reg A', 'Reg B']) await expect(chip(page, label)).toBeVisible()
  })

  test('deleted / unknown ids in the list are dropped silently — the known series still draw', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'ghost-1', 'ghost-2'])
    await ensureTimelineOpen(page)
    await expect(chip(page, 'P1')).toBeVisible()
    await expect(trigger(page)).toHaveText('Series 1/4')
  })

  test('reload restores timelineSeries AND canvasLocked; the MC config is not re-applied', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await page.evaluate(() => {
      const l = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      l.mc.getState().applyRecommended({ canvasLocked: true, baseSeed: 123, runs: 777, steps: 55, timelineSeries: ['p1'] })
    })
    expect(await page.evaluate(() => (window as any).__loop.ui.getState().canvasLocked)).toBe(true)

    await reload(page)
    expect(await seriesState(page)).toEqual(['p1'])
    expect(await page.evaluate(() => (window as any).__loop.ui.getState().canvasLocked)).toBe(true)
    const cfg = await page.evaluate(() => ({ ...(window as any).__loop.mc.getState().config }))
    expect(cfg.baseSeed).not.toBe(123)
    expect(cfg.runs).not.toBe(777)
    expect(cfg.steps).not.toBe(55)
  })
})

test.describe('the series selector — dialog behaviour, minimum one, zero series', () => {
  test('opens as a labelled dialog with focus inside; Escape closes and returns focus to the trigger; an outside click closes without stealing focus', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await ensureTimelineOpen(page)

    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    await openSelector(page)
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
    // `role="dialog"` named by its visible title through aria-labelledby
    await expect(page.getByRole('dialog', { name: 'Chart series' })).toBeVisible()
    const controls = await trigger(page).getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    await expect(page.locator(`[id="${controls}"]`)).toHaveClass(/tl-series/)
    // focus moved into the popover
    expect(await page.evaluate(() => document.activeElement?.closest('.tl-series') != null)).toBe(true)

    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('timeline__series'))).toBe(true)

    // outside pointerdown closes; a click inside does not
    await openSelector(page)
    await popover(page).locator('.tl-series__title').click()
    await expect(popover(page)).toBeVisible()
    await page.locator('.canvas').click({ position: { x: 40, y: 40 } })
    await expect(popover(page)).toHaveCount(0)
  })

  test('the popover never changes the chart height, and the chart height holds while it scrolls its own list', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seedPools(page, 30)
    await ensureTimelineOpen(page)
    const before = await headerGeometry(page)
    await openSelector(page)
    const list = popover(page).locator('.tl-series__list')
    // its own scroll box — 30 rows do not fit the fixed maximum height
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    const after = await headerGeometry(page)
    expect(after.plotH).toBe(before.plotH)
    expect(after.headH).toBe(before.headH)
  })

  test('at least one series: unchecking the last one is refused — the box springs back, a message shows, the line is still drawn; the legend chip is refused the same way', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await stepN(page, 4)
    await expect(page.locator('.timeline__panel')).toBeVisible()
    await expect(page.locator('.timeline__line:not(.timeline__line--register)')).toHaveCount(1)

    await openSelector(page)
    const box = popover(page).getByRole('checkbox', { name: 'P1' })
    await box.uncheck().catch(() => {}) // Playwright may report the sprung-back state as a failure to uncheck
    await expect(box).toBeChecked()
    await expect(popover(page).locator('.tl-series__note')).toHaveText('At least one series stays selected.')
    expect(await seriesState(page)).toEqual(['p1'])
    await expect(page.locator('.timeline__line:not(.timeline__line--register)')).toHaveCount(1)
    // an accepted change clears the note
    await popover(page).getByRole('checkbox', { name: 'P2' }).check()
    await expect(popover(page).locator('.tl-series__note')).toHaveText('')
    await page.keyboard.press('Escape')

    // the chip goes through the same store guard: hide P2, then P1 is the last
    await chip(page, 'P2').click()
    expect(await seriesState(page)).toEqual(['p1'])
    await chip(page, 'P1').click()
    expect(await seriesState(page)).toEqual(['p1'])
    await expect(chip(page, 'P1')).toBeVisible()
  })

  test('zero eligible series: 0 lines, the trigger reads 0/0 and is disabled, the popover cannot open', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seedNoSeries(page)
    await stepN(page, 3)
    await expect(page.locator('.timeline__panel')).toBeVisible()
    await expect(page.locator('.timeline__line')).toHaveCount(0)
    await expect(trigger(page)).toHaveText('Series 0/0')
    await expect(trigger(page)).toBeDisabled()
    await expect(trigger(page)).toHaveAttribute('aria-label', 'Choose chart series, 0 of 0 shown')
    await trigger(page).click({ force: true }).catch(() => {})
    await expect(popover(page)).toHaveCount(0)
  })

  test('a selector toggle changes NO graph digest / undo state / sim result', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    const digest0 = await graphDigest(page)
    const undo0 = await canUndo(page)
    await stepN(page, 4)
    const step0 = await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)

    await expect(page.locator('.timeline__panel')).toBeVisible()
    await openSelector(page)
    await popover(page).getByRole('checkbox', { name: 'P2' }).check()

    expect(await graphDigest(page)).toBe(digest0)
    expect(await canUndo(page)).toBe(undo0)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex)).toBe(step0)
    expect(await seriesState(page)).toEqual(['p1', 'p2'])
  })
})

test.describe('the header is always one row (contract §5)', () => {
  const MMO = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')
  /** the shipped example with its curated field REMOVED — the user-authored,
   *  55-series, no-field population this contract exists for */
  const mmoNoField = () => {
    const doc = JSON.parse(MMO)
    delete doc.recommendedRunConfig.timelineSeries
    return JSON.stringify(doc)
  }

  for (const width of [1440, 800]) {
    test(`55 series, auto, at ${width}px: one row, 8 drawn, the plot keeps its height, the trigger stays inside`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page)
      await resetAll(page)
      await importGraph(page, mmoNoField())
      expect(await seriesState(page)).toBe('auto')
      await stepN(page, 6)
      await expect(page.locator('.timeline__panel')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)

      await expect(trigger(page)).toHaveText('Series 8/55')
      await expect(page.locator('.timeline__line:not(.timeline__line--register)')).toHaveCount(8)
      const g = await headerGeometry(page)
      expect(g.rows, 'every legend child on the same row').toBe(1)
      expect(g.overflow, 'nothing clipped').toBeLessThanOrEqual(0)
      expect(g.allInside, 'every child inside the legend box — nothing hidden by overflow').toBe(true)
      expect(g.chips).toBeGreaterThanOrEqual(1)
      expect(g.chips, 'chips are what FIT, never more than drawn').toBeLessThanOrEqual(8)
      expect(g.plotH, 'the plot keeps its room').toBeGreaterThanOrEqual(160)
      expect(g.triggerInside).toBe(true)
      expect(g.triggerH).toBeLessThan(26)
      expect(g.moreChips).toBe(0)
    })
  }

  test('an explicit list longer than one row: still one row; the trigger, not the chips, carries the count', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, JSON.stringify({ ...JSON.parse(MMO), recommendedRunConfig: { timelineSeries: 'all' } }))
    expect(await seriesState(page)).toBe('all')
    await ensureTimelineOpen(page)
    await page.evaluate(() => document.fonts.ready)
    await expect(trigger(page)).toHaveText('Series 55/55')
    const g = await headerGeometry(page)
    expect(g.rows).toBe(1)
    expect(g.overflow).toBeLessThanOrEqual(0)
    expect(g.allInside).toBe(true)
    expect(g.chips).toBeLessThan(55)
    expect(g.plotH).toBeGreaterThanOrEqual(160)
  })
})

test.describe('the Timeline panel state (contract §7)', () => {
  test('starts collapsed, auto-expands on the first step, and after a user toggle no automatic transition happens again', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page)
    const collapse = page.locator('.pstrip__collapse')
    await expect(page.locator('.timeline.is-collapsed')).toHaveCount(1)
    await expect(collapse).toHaveAttribute('aria-expanded', 'false')

    await stepN(page, 1)
    await expect(page.locator('.timeline__panel')).toBeVisible()
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')

    // the user folds it: from here on run / pause / reset never override that
    await collapse.click()
    await expect(page.locator('.timeline.is-collapsed')).toHaveCount(1)
    await stepN(page, 3)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    await stepN(page, 2)
    await expect(page.locator('.timeline.is-collapsed')).toHaveCount(1)
    await expect(collapse).toHaveAttribute('aria-expanded', 'false')
    // and nothing about this reached storage
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => /timeline|collapse/i.test(k)))).toBe(false)
  })

  test('a completed Monte-Carlo run counts as the first run — the distribution view is in this panel', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFixture())
    await expect(page.locator('.timeline.is-collapsed')).toHaveCount(1)
    await runMc(page, { baseSeed: 1, runs: 20, steps: 6, tracked: FIXTURE_POOLS_4 })
    await expect(page.locator('.timeline__panel')).toBeVisible()
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
  })
})

test.describe('round trips — every graph Export writes the choice back', () => {
  test('Graph JSON: export → import → export round-trips timelineSeries and the graph', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'reg_b'])

    const rt = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      const g = () => l.graph.getState()
      const rrc1 = { ...l.mc.getState().config }
      const text1 = g().exportJSON({ ...rrc1, timelineSeries: [...(l.sim.getState().timelineSeries as string[])].sort() })
      const d1 = JSON.parse(text1)
      g().newGraph()
      l.mc.getState().applyRecommended({ baseSeed: 9, runs: 2, steps: 2, tracked: [] })
      l.mc.getState().applyRecommended(g().loadJSON(text1))
      const seriesAfter = l.sim.getState().timelineSeries
      const text2 = g().exportJSON({ ...l.mc.getState().config, timelineSeries: [...(l.sim.getState().timelineSeries as string[])].sort() })
      const d2 = JSON.parse(text2)
      return { d1, d2, seriesAfter, nodeIds: g().nodes.map((n: any) => n.id) }
    })

    expect(rt.seriesAfter).toEqual(['p1', 'reg_b'])
    expect(rt.d1.recommendedRunConfig.timelineSeries).toEqual(['p1', 'reg_b'])
    expect(rt.d2.recommendedRunConfig.timelineSeries).toEqual(['p1', 'reg_b'])
    expect(rt.d2.nodes).toEqual(rt.d1.nodes)
    expect(rt.d2.edges).toEqual(rt.d1.edges)
    expect(rt.nodeIds.sort()).toEqual(['p1', 'p2', 'reg_a', 'reg_b', 'snk', 'src'])
  })

  test('Workspace JSON: export → import → export preserves timelineSeries and the graph', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1', 'p2', 'reg_a'])

    const rt = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop
      const io = l.io as any
      const g = () => l.graph.getState()
      const text1 = io.serializeWorkspaceFile(io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
      const d1 = JSON.parse(text1)
      g().newGraph()
      l.mc.getState().applyRecommended({ baseSeed: 3, runs: 1, steps: 1, tracked: [] })
      await io.importFile(text1)
      const seriesAfter = l.sim.getState().timelineSeries
      const text2 = io.serializeWorkspaceFile(io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
      const d2 = JSON.parse(text2)
      return { d1, d2, seriesAfter }
    })

    expect(rt.seriesAfter).toEqual(['p1', 'p2', 'reg_a'])
    expect(rt.d1.recommendedRunConfig.timelineSeries).toEqual(['p1', 'p2', 'reg_a'])
    expect(rt.d2.recommendedRunConfig.timelineSeries).toEqual(['p1', 'p2', 'reg_a'])
    expect(rt.d2.nodes).toEqual(rt.d1.nodes)
    expect(rt.d2.edges).toEqual(rt.d1.edges)
  })

  test('Share: create → restore preserves timelineSeries (encode → #g1= → decode)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p2', 'reg_a'])

    const applied = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop
      const shareM = await import('/src/model/share.ts')
      const serM = await import('/src/model/serialize.ts')
      const g = () => l.graph.getState()
      const text = g().exportJSON({
        ...l.mc.getState().config,
        timelineSeries: [...(l.sim.getState().timelineSeries as string[])].sort(),
      })
      const { payload } = await shareM.encodeShareText(text)
      const roundText = await shareM.decodeShareText(payload)
      const parsed = serM.deserialize(roundText)
      g().newGraph()
      l.mc.getState().applyRecommended({ baseSeed: 7, runs: 1, steps: 1, tracked: [] })
      g().loadDoc({ nodes: parsed.nodes, edges: parsed.edges })
      l.mc.getState().applyRecommended(parsed.recommendedRunConfig)
      return {
        series: l.sim.getState().timelineSeries,
        rrcTs: (parsed.recommendedRunConfig as any)?.timelineSeries,
        nodeIds: g().nodes.map((n: any) => n.id).sort(),
      }
    })

    expect(applied.rrcTs).toEqual(['p2', 'reg_a'])
    expect(applied.series).toEqual(['p2', 'reg_a'])
    expect(applied.nodeIds).toEqual(['p1', 'p2', 'reg_a', 'reg_b', 'snk', 'src'])
  })

  // Curating the legend must NOT narrow the run CSV — `downloadCsv` writes every
  // Pool column regardless of `timelineSeries`.
  test('the run CSV keeps every Pool column even when the legend shows a subset', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seed(page, ['p1'])
    await stepN(page, 4) // a run so the CSV button enables (hasRun = series.length >= 2)
    await expect(page.locator('.timeline__panel')).toBeVisible()
    await expect(chip(page, 'P2')).toHaveCount(0)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.timeline__legend .timeline__csv').click(),
    ])
    expect(download.suggestedFilename()).toBe('loop-studio-run.csv')
    const fs = await import('node:fs/promises')
    const csv = (await fs.readFile(await download.path(), 'utf8')).replace(/^﻿/, '')
    const header = csv.split('\r\n')[0].split(',')
    expect(header).toEqual(['step', 'P1 [p1]', 'P2 [p2]'])
  })
})
