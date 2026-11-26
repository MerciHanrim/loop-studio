// #538 — the Timeline tabs (Lumi, 2026-11-10). With two or more strips, the pools' chart and
// the strips are two tabs in one analysis area of a fixed height: 216 px with nothing above the
// chart, raised only by the run guide line and the notices, never by a tab. The strips tab shows
// one strip, picked from a list in that tab. The pinned step, the CSV and the picked strip are
// kept across a switch. The tabs are a tablist. One strip stays under the chart. The end labels
// keep clear of the x axis's "step N" label. docs/workbench.md §WB7.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, resetAll, test } from './support/loop'
import { showStrip, stripKeys } from './support/timelineTabs'
import { pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }

const tab = (page: Page, k: 'stock' | 'strips') => page.locator(`.timeline__tabs [data-tab="${k}"]`)
const areaH = (page: Page) => page.locator('.timeline.wb-analysis').evaluate((el) => Math.round(el.getBoundingClientRect().height))
const plotH = (page: Page) => page.locator('.timeline__svg').evaluate((el) => Math.round(el.getBoundingClientRect().height))

async function template(page: Page, id: string, steps: number) {
  await resetAll(page)
  await pickTemplate(page, id)
  await page.waitForTimeout(400)
  await ensureTimelineOpen(page)
  await page.evaluate((k: number) => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) s.advance()
  }, steps)
}

async function csvText(page: Page): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.timeline__csv').click()])
  return readFileSync((await dl.path())!, 'utf8')
}

/** end labels whose box meets an axis label's or another end label's */
const labelTouches = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector('.timeline__svg')!
    const hit = (p: DOMRect, q: DOMRect) => p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5
    const ticks = [...svg.querySelectorAll('text.timeline__tick')]
    const ends = [...svg.querySelectorAll('text.timeline__endlabel')]
    return [
      ...ends.flatMap((e) => ticks.filter((t) => hit(e.getBoundingClientRect(), t.getBoundingClientRect())).map((t) => `end "${e.textContent}" on axis "${t.textContent}"`)),
      ...ends.flatMap((e, i) => ends.slice(i + 1).filter((f) => hit(e.getBoundingClientRect(), f.getBoundingClientRect())).map((f) => `end "${e.textContent}" on end "${f.textContent}"`)),
    ]
  })

test.describe('#538 — the Timeline tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
  })

  test('the desalination Template: two tabs in one 216 px area; the strips tab shows the picked strip; the height never changes', async ({ page }) => {
    await template(page, 'desalination', 48)
    await expect(page.getByRole('tablist', { name: 'Timeline' })).toBeVisible()
    await expect(tab(page, 'stock')).toHaveText('Pools')
    await expect(tab(page, 'strips')).toHaveText('Timetables and run rules')
    await expect(tab(page, 'stock')).toHaveAttribute('aria-selected', 'true')
    expect(await areaH(page), 'the area opens at 216 px, not raised for 13 strips').toBe(216)
    expect(await plotH(page)).toBe(140)
    await expect(page.locator('.timeline__rates')).toBeHidden()

    await tab(page, 'strips').click()
    expect(await areaH(page), 'the strips tab keeps the height').toBe(216)
    await expect(page.locator('.timeline__plot')).toBeHidden()
    await expect(page.locator('.timeline__rates[role="tabpanel"]')).toBeVisible()
    await expect(page.locator('.timeline__rates[role="tabpanel"]')).toHaveAttribute('aria-labelledby', (await tab(page, 'strips').getAttribute('id'))!)
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
    const keys = await stripKeys(page)
    expect(keys).toHaveLength(13)
    expect(keys[0]).toBe('table:demand')
    // the chips give way on the strips tab; Series and CSV stay
    await expect(page.locator('.timeline__keyrow')).toHaveClass(/is-off/)
    await expect(page.locator('.timeline__series')).toBeVisible()
    await expect(page.locator('.timeline__csv')).toBeVisible()
    for (const key of keys) {
      await showStrip(page, key)
      await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
      expect(await areaH(page), `${key}: the area keeps its height`).toBe(216)
    }
  })

  test('both panels stay in the document, each a tabpanel named by its tab; the hidden one takes no height and no Tab stop', async ({ page }) => {
    await template(page, 'desalination', 24)
    /** each tab, its panel by `aria-controls`, and what the panel is */
    const panels = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.timeline__tabs [role="tab"]')].map((t) => {
          const p = document.getElementById(t.getAttribute('aria-controls') ?? '')
          return {
            tab: t.getAttribute('data-tab'),
            selected: t.getAttribute('aria-selected'),
            panel: !!p,
            role: p?.getAttribute('role') ?? null,
            labelledByTab: !!p && p.getAttribute('aria-labelledby') === t.id,
            hidden: p ? p.hidden : null,
            height: p ? Math.round(p.getBoundingClientRect().height) : null,
          }
        }),
      )
    /** Tab both ways from the chosen tab: any stop inside a hidden panel */
    const stopsInHidden = async (k: 'stock' | 'strips') => {
      const hits: string[] = []
      for (const key of ['Tab', 'Shift+Tab']) {
        await tab(page, k).focus()
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press(key)
          if (await page.evaluate(() => !!document.activeElement?.closest('[role="tabpanel"][hidden]'))) hits.push(`${key} ${i + 1}`)
        }
      }
      return hits
    }

    const onPools = await panels()
    expect(onPools).toEqual([
      { tab: 'stock', selected: 'true', panel: true, role: 'tabpanel', labelledByTab: true, hidden: false, height: expect.any(Number) },
      { tab: 'strips', selected: 'false', panel: true, role: 'tabpanel', labelledByTab: true, hidden: true, height: 0 },
    ])
    expect(onPools[0]!.height, 'the Pools panel holds the 140 px chart').toBeGreaterThanOrEqual(140)
    expect(await areaH(page)).toBe(216)
    // the hidden panel is out of the accessibility tree too: one tabpanel is exposed
    await expect(page.locator('.timeline.wb-analysis').getByRole('tabpanel')).toHaveCount(1)
    expect(await stopsInHidden('stock'), 'Tab never stops inside the hidden strips panel').toEqual([])

    await tab(page, 'strips').click()
    const onStrips = await panels()
    expect(onStrips[0]).toMatchObject({ tab: 'stock', selected: 'false', panel: true, role: 'tabpanel', labelledByTab: true, hidden: true, height: 0 })
    expect(onStrips[1]).toMatchObject({ tab: 'strips', selected: 'true', panel: true, role: 'tabpanel', labelledByTab: true, hidden: false })
    expect(await areaH(page)).toBe(216)
    await expect(page.locator('.timeline.wb-analysis').getByRole('tabpanel')).toHaveCount(1)
    expect(await stopsInHidden('strips'), 'Tab never stops on the hidden chart').toEqual([])
  })

  test('a switch keeps the pinned step, the CSV and the picked strip', async ({ page }) => {
    await template(page, 'desalination', 48)
    await page.locator('.timeline__plot').focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    const reading = page.locator('.timeline__reading')
    await expect(reading).toHaveAttribute('data-step', '47')
    const before = await reading.innerText()
    const csvStock = await csvText(page)

    await showStrip(page, 'run:dpump')
    await expect(reading, 'the chart’s reading box stands beside the chart, so it shows on the pools tab only').toHaveCount(0)
    // the strips tab reads the pinned step on the picked strip: its guide, its values, a status line
    const strip = page.locator('[data-run-strip="dpump"]')
    await page.mouse.move(5, 5)
    await expect(strip.locator('.timeline__rate-guide--pin'), 'the pinned step’s guide on the strip').toHaveCount(1)
    await expect(strip.locator('.timeline__rate-value')).toHaveText(/^Step 47: target .+ %, ran .+ %$/)
    await expect(page.locator('[data-strip-reading="dpump"]'), 'a screen reader hears the pinned step').toHaveText(/^Step 47: target/)
    // the guide stands at the pinned step: the same fraction of the strip's span as the chart's pin line
    const guideX = await strip.locator('.timeline__rate-guide--pin').getAttribute('x1')
    expect(Number(guideX)).toBeGreaterThan(0)
    expect(await csvText(page), 'the CSV does not depend on the tab').toBe(csvStock)
    // a plain timetable strip reads the step too, in its own wording
    await showStrip(page, 'table:demand')
    // (the value and the unit are bidi-isolated, U+2066 / U+2068 to U+2069, as the chart's are)
    await expect(page.locator('.timeline__rates .timeline__rate-value')).toHaveText(/^Step 47: \W?3600\W? \W?CMD\W?$/u)
    await expect(page.locator('[data-strip-reading="demand"]')).toHaveText(/^Step 47: \W?3600\W? \W?CMD\W?$/u)

    await tab(page, 'stock').click()
    await expect(reading, 'the pinned step comes back with the chart').toHaveAttribute('data-step', '47')
    expect(await reading.innerText(), 'with the same reading').toBe(before)
    await showStrip(page, 'run:dpump')
    await expect(page.locator('.timeline__strip-pick select'), 'the picked strip is kept').toHaveValue('run:dpump')
    await expect(page.locator('[data-run-strip="dpump"]')).toBeVisible()
  })

  test('the strips tab moves the pinned step from the keyboard, and the Pools tab reads where it went', async ({ page }) => {
    await template(page, 'desalination', 48)
    await page.locator('.timeline__plot').focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.timeline__reading')).toHaveAttribute('data-step', '47')
    await showStrip(page, 'run:dpump')
    await page.mouse.move(5, 5)
    const read = page.locator('.timeline__strip-read')
    await expect(read).toHaveAttribute('role', 'group')
    await read.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('[data-run-strip="dpump"] .timeline__rate-value')).toHaveText(/^Step 45:/)
    await expect(page.locator('[data-strip-reading="dpump"]')).toHaveText(/^Step 45:/)
    await page.keyboard.press('End')
    await expect(page.locator('[data-strip-reading="dpump"]')).toHaveText(/^Step 48:/)
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('[data-strip-reading="dpump"]')).toHaveText(/^Step 47:/)
    // the Pools tab reads the step the strip moved it to
    await tab(page, 'stock').click()
    await expect(page.locator('.timeline__reading')).toHaveAttribute('data-step', '47')
    // back on the strip, Escape lets the step go: no pinned guide, nothing said
    await tab(page, 'strips').click()
    await read.focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-run-strip="dpump"] .timeline__rate-guide--pin')).toHaveCount(0)
    await tab(page, 'stock').click()
    await expect(page.locator('.timeline__reading')).toHaveCount(0)
  })

  test('the keyboard: one Tab stop, Left / Right / Home / End move and choose, then Tab reaches the picker past the hidden chips', async ({ page }) => {
    await template(page, 'desalination', 24)
    await expect(tab(page, 'stock')).toHaveAttribute('tabindex', '0')
    await expect(tab(page, 'strips')).toHaveAttribute('tabindex', '-1')
    await tab(page, 'stock').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'strips')).toBeFocused()
    await expect(tab(page, 'strips')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'stock')).toHaveAttribute('tabindex', '-1')
    await page.keyboard.press('Home')
    await expect(tab(page, 'stock')).toBeFocused()
    await expect(tab(page, 'stock')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(tab(page, 'strips')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(tab(page, 'stock')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    // Tab on from the chosen tab: never a hidden chip, and the picker is reached
    const select = page.locator('.timeline__strip-pick select')
    let reached = false
    for (let i = 0; i < 8 && !reached; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('.timeline__keyrow')), `Tab ${i + 1} is not on a hidden chip`).toBe(false)
      reached = await select.evaluate((el) => el === document.activeElement)
    }
    expect(reached, 'Tab reaches the strip picker').toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
    // the next stop is the strip, which reads and moves the pinned step
    await page.keyboard.press('Tab')
    await expect(page.locator('.timeline__strip-read')).toBeFocused()
  })

  test('one strip: no tabs, the strip under the chart as before', async ({ page }) => {
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    await expect(page.locator('.react-flow__node')).toHaveCount(43)
    // the deliveries and five of the six run rules taken out (the demand table is read only by
    // the Delivery pump's rule): only the Thickener's run strip is left
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      for (const id of ['naoclDel', 'coagDel', 'antiDel', 'limeDel', 'naocl2Del', 'adjDel']) g.removeNode(id)
      for (const id of ['filter', 'ro', 'remin', 'dpump', 'adjust']) g.setRunRule(id, null)
    })
    await ensureTimelineOpen(page)
    await expect(page.locator('.timeline__tabs')).toHaveCount(0)
    await expect(page.locator('.timeline__rates svg.timeline__rate')).toHaveCount(1)
    await expect(page.locator('.timeline__plot')).toBeVisible()
  })

  test('the end labels keep clear of the axis labels and of each other, the MMO Deaths at step 30 among them', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    for (const [id, steps] of [['mmo-progression', 30], ['mmo-progression', 60], ['gacha-banner-zones', 30], ['desalination', 30], ['coffee-roastery', 30]] as const) {
      await template(page, id, steps)
      await page.waitForTimeout(300)
      expect(await plotH(page), `${id} at ${steps}: the chart at its floor`).toBe(140)
      expect(await labelTouches(page), `${id} at step ${steps}`).toEqual([])
      if (id === 'mmo-progression' && steps === 30) await test.info().attach('MMO at step 30: the end labels', { body: await page.locator('.timeline.wb-analysis').screenshot(), contentType: 'image/png' })
    }
  })

  test('the phone: the sheet keeps its stacked strips, no tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    // the phone has no desktop File menu: the Template's file, imported
    await importGraph(page, readFileSync(new URL('../examples/desalination.json', import.meta.url), 'utf8'))
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      for (let i = 0; i < 4; i++) s.advance()
    })
    await ensureTimelineOpen(page)
    await expect(page.locator('.timeline__tabs')).toHaveCount(0)
    await expect.poll(() => page.locator('.timeline__rates svg.timeline__rate').count()).toBeGreaterThan(1)
  })
})

// issue #614 item 3 (Lumi, 2026-11-26) — the strips share one rule: a step covers (k − 1, k],
// as the rate strip's own comment says and draws. The run strip drew step k over [k, k + 1],
// one step later on the same x axis. Read on the desalination Template: the rate strip of
// `naoclDeliveries` gives each step's span (one piece per step), and the run strip of `filter`
// must stand at that step's value inside it.
test.describe('#614 item 3 — the run strip and the rate strip put a step in the same place', () => {
  const STEPS = 40
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await template(page, 'desalination', STEPS)
  })

  /** the rate strip's moved line: one `M x0 y H x1` piece per step, in step order */
  const ratePieces = async (page: Page) => {
    await showStrip(page, 'table:naoclDeliveries')
    const d = (await page.locator('.timeline__rates svg.timeline__rate path.timeline__rate-moved').first().getAttribute('d')) ?? ''
    return [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)/g)].map((m) => ({ x0: Number(m[1]), x1: Number(m[3]) }))
  }
  /** the run strip's ran line as horizontal pieces, its axis ends, and each step's share */
  const runStrip = async (page: Page) => {
    await showStrip(page, 'run:filter')
    const svg = page.locator('[data-run-strip="filter"]')
    const d = (await svg.locator('path.timeline__rate-line').getAttribute('d')) ?? ''
    const segs: { x0: number; x1: number; y: number }[] = []
    let x = 0
    let y = 0
    let first: number | null = null
    for (const [, cmd, a, b] of d.matchAll(/([MHVL])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
      if (cmd === 'M' || cmd === 'L') {
        x = Number(a)
        y = Number(b)
        first ??= x
      } else if (cmd === 'H') {
        if (Number(a) !== x) segs.push({ x0: Math.min(x, Number(a)), x1: Math.max(x, Number(a)), y })
        x = Number(a)
      } else y = Number(a)
    }
    const axis = await svg.locator('line.timeline__axis').first().evaluate((l) => ({ top: Number(l.getAttribute('y1')), bottom: Number(l.getAttribute('y2')) }))
    const shares = await page.evaluate(() =>
      ((window as unknown as Bridge).__loop.sim.getState().series as { step: number; runs?: { members: string[]; moved: number }[] }[]).map((p) => p.runs?.find((r) => r.members[0] === 'filter')?.moved ?? null),
    )
    return { segs, first, last: x, axis, shares }
  }

  test('at the middle of each step’s span on the rate strip, the run strip stands at that step’s share', async ({ page }) => {
    const pieces = await ratePieces(page)
    expect(pieces, 'the rate strip draws one piece per step').toHaveLength(STEPS)
    const run = await runStrip(page)
    const yOf = (v: number) => run.axis.bottom - v * (run.axis.bottom - run.axis.top)
    const yAt = (x: number) => run.segs.find((s) => s.x0 < x && x < s.x1)?.y ?? null
    const wrong: string[] = []
    let checked = 0
    for (let k = 2; k <= STEPS; k++) {
      const v = run.shares[k]
      const before = run.shares[k - 1]
      // a step whose share equals the one before it cannot tell the two rules apart
      if (v == null || before == null || Math.abs(yOf(v) - yOf(before)) < 0.02) continue
      checked++
      const p = pieces[k - 1]!
      const y = yAt((p.x0 + p.x1) / 2)
      if (y === null || Math.abs(y - yOf(v)) > 0.006) wrong.push(`step ${k}: at y ${y}, its share is at ${yOf(v).toFixed(2)}`)
    }
    expect(checked, 'steps whose share differs from the step before').toBeGreaterThan(20)
    expect(wrong).toEqual([])
  })

  test('control: both strips span the same steps on the same x axis, from step 0 to the last', async ({ page }) => {
    const pieces = await ratePieces(page)
    const run = await runStrip(page)
    expect(Math.abs(run.first! - pieces[0]!.x0), 'both start at step 0').toBeLessThan(1)
    expect(Math.abs(run.last - pieces.at(-1)!.x1), 'both end at the last step').toBeLessThan(1)
  })

  test('the pointer inside a step’s span reads that step on both strips', async ({ page }) => {
    const pieces = await ratePieces(page)
    // 30 % into step 20's span, from its start: nearer step 19's end than step 20's
    const p = pieces[19]!
    const at = p.x0 + 0.3 * (p.x1 - p.x0)
    const readAt = async (svg: ReturnType<Page['locator']>) => {
      const box = (await svg.boundingBox())!
      await page.mouse.move(box.x + at, box.y + box.height / 2)
      // an available table's reading is `.timeline__rate-reading`; a run strip's, `.timeline__rate-value`
      const text = (await svg.locator('.timeline__rate-reading, .timeline__rate-value').textContent()) ?? ''
      await page.mouse.move(5, 5)
      return Number(/Step (\d+)/.exec(text)?.[1] ?? NaN)
    }
    expect(await readAt(page.locator('.timeline__rates svg.timeline__rate').first()), 'the rate strip').toBe(20)
    await showStrip(page, 'run:filter')
    expect(await readAt(page.locator('[data-run-strip="filter"]')), 'the run strip').toBe(20)
  })
})
