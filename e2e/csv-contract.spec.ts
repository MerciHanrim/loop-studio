import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, runMc, test } from './support/loop'

// docs/data-import.md §CSV — the Timeline run CSV's COLUMN NAMES, checked on
// the bytes the browser wrote.
//
// The defect: the header was the Pool's label alone, and the shipped 3-zone
// gacha Template gives three zones the same pool labels. MEASURED on a real
// Thai export, 6 of its 24 names repeated — tickets ×3, pulls-made ×3,
// SR-count ×3, R-count ×3, pity ×2, ceiling-hits ×2 — and identically in
// English, so it was never a locale defect. The numbers were right; the names
// were not independently identifiable, which breaks reordering or copying
// columns in a spreadsheet, selecting a column by name, and any row→object
// conversion (duplicate keys overwrite). Since §L2.0 (2026-10) retired Thai,
// the tests below run in Korean — the locale was incidental, the property is not.
//
// The fix appends the node id: `<label> [<node-id>]`. Not a zone prefix — a
// frame stores NO membership, it is derived from geometry (LGR-D9 / R5-D3), so
// a zone name would depend on where rectangles happen to be. The second test
// here is that contract: frames may be absent, overlapping or nested and the
// header does not move.

type Loop = Record<string, { getState: () => any }>

const savedBytes = async (d: Download): Promise<Buffer> => readFileSync((await d.path())!)

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

/** Parse the downloaded file with THIS PRODUCT'S OWN parser, inside the page.
 *  A hand-rolled split in the test would not prove the round trip a user makes
 *  when they open the file and paste it back. */
async function headerOf(page: Page, bytes: Buffer): Promise<string[]> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return page.evaluate(async (t) => {
    const csv = (await import('/src/model/csv.ts')) as {
      stripBom: (s: string) => string
      parseDelimitedText: (s: string, d: string) => { ok: boolean; rows?: string[][] }
    }
    const r = csv.parseDelimitedText(csv.stripBom(t), ',')
    if (!r.ok || !r.rows) throw new Error('the product could not parse its own export')
    return r.rows[0]
  }, text)
}

/** Load the 3-zone gacha Template through the real Templates menu, by the name
 *  the RUNNING catalog gives it — hardcoding a localized name here would be the same
 *  staleness defect #277 fixed. */
async function loadGachaIn(page: Page, locale: string): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, locale)
  const name = await page.evaluate(
    () =>
      (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog[
        'templates.gachaBannerZones.name'
      ] as string,
  )
  expect(name.length, 'the catalog knows the Template name').toBeGreaterThan(0)
  await page.locator('.toolbar__actions .menu').first().locator('> button').click()
  // File ▸ Templates (docs/workbench.md §WB2.2)
  await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').click()
  // #545 — a game Template, in the submenu's Games group
  await page.locator('.toolbar__filemenu [data-template-group="games"]').click()
  await page.locator('.toolbar__actions .menu').first().locator('.menu__pop [role="menuitem"]', { hasText: name }).click()
  const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  // the Template ships a locked canvas; the timeline export does not need it
  // unlocked, but a later test moves frames, so unlock once here
  await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.ui.getState().setCanvasLocked(false))
}

/** A few committed steps, so the timeline has rows to write. */
async function stepTimes(page: Page, n: number): Promise<void> {
  await page.evaluate((k) => {
    const sim = (window as unknown as { __loop: Loop }).__loop.sim.getState()
    sim.reset()
    for (let i = 0; i < k; i++) sim.stepOnce()
  }, n)
}

async function downloadRunCsv(page: Page): Promise<Buffer> {
  const csvBtn = page.locator('.timeline__csv').filter({ hasNotText: /▾/ }).first()
  await expect(csvBtn).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), csvBtn.click()])
  expect(download.suggestedFilename()).toBe('loop-studio-run.csv')
  return savedBytes(download)
}

const poolIds = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __loop: Loop }).__loop.graph
      .getState()
      .nodes.filter((n: { data: { kind: string } }) => n.data.kind === 'pool')
      .map((n: { id: string }) => n.id),
  )

test.describe('the run CSV names every column independently', () => {
  test('KOREAN 3-zone gacha: 24 columns, every name unique, every Pool column carries its node id', async ({ page }) => {
    await loadGachaIn(page, 'ko')
    await stepTimes(page, 4)
    const header = await headerOf(page, await downloadRunCsv(page))

    expect(header[0]).toBe('step')
    expect(header, 'step + one column per Pool').toHaveLength(24)
    expect(new Set(header).size, 'every column name is unique: ' + header.join(' | ')).toBe(24)

    // the premise: the LABELS alone still repeat, so uniqueness really is the
    // id's doing and not an accident of this Template's wording
    const labels = header.slice(1).map((h) => h.replace(/ \[[^\]]+\]$/, ''))
    expect(new Set(labels).size, 'the labels alone are NOT unique').toBeLessThan(labels.length)

    // and the id half is exactly the graph's Pool ids, in order
    const ids = header.slice(1).map((h) => /\[([^\]]+)\]$/.exec(h)?.[1])
    expect(ids).toEqual(await poolIds(page))

    // it is still readable: Korean (Hangul syllable) text in front of every id
    const korean = header.slice(1).filter((h) => /[가-힣]/.test(h))
    expect(korean.length, 'the localized label is kept in front of the id').toBeGreaterThan(10)
  })

  test('frames do not name the columns: none, overlapping and nested all give the SAME header', async ({ page }) => {
    await loadGachaIn(page, 'ko')
    await stepTimes(page, 3)
    const withShippedFrames = await headerOf(page, await downloadRunCsv(page))
    expect(
      await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.frame.getState().frames.length),
      'the Template really does ship frames',
    ).toBeGreaterThan(0)

    // (a) no frames at all — the ordinary graph
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.frame.getState().clearFrames())
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.frame.getState().frames.length))
      .toBe(0)
    expect(await headerOf(page, await downloadRunCsv(page)), 'no frames').toEqual(withShippedFrames)

    // (b) two OVERLAPPING frames, plus one NESTED inside another
    await page.evaluate(() => {
      const f = (window as unknown as { __loop: Loop }).__loop.frame.getState()
      f.addFrame({ x: 0, y: 0, w: 2600, h: 1200 }) // covers zones 1-2
      f.addFrame({ x: 1200, y: 200, w: 2600, h: 1200 }) // overlaps it, covers 2-3
      f.addFrame({ x: 1300, y: 300, w: 400, h: 300 }) // nested inside both
    })
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.frame.getState().frames.length))
      .toBe(3)
    expect(await headerOf(page, await downloadRunCsv(page)), 'overlapping + nested frames').toEqual(withShippedFrames)
  })

  test('a Pool label with a comma, a quote and a newline survives the download LOSSLESSLY', async ({ page }) => {
    await loadGachaIn(page, 'ko')
    // '티켓' is the gacha Template's own Korean Pool label (templateLabels/ko.ts)
    const hostile = '티켓, "premium"\nzone 1'
    const id = (await poolIds(page))[0]
    await page.evaluate(
      ([nodeId, label]) =>
        (window as unknown as { __loop: Loop }).__loop.graph.getState().updateNodeData(nodeId, { label }),
      [id, hostile] as const,
    )
    await stepTimes(page, 2)

    const header = await headerOf(page, await downloadRunCsv(page))
    // the old writer replaced every one of those characters with a space
    expect(header).toContain(`${hostile} [${id}]`)
    expect(header, 'still one column per Pool, the quoting did not split one in two').toHaveLength(24)
    expect(new Set(header).size).toBe(24)
  })

  // issue #616 item 4 — a column name that begins with `=`, `+`, `-` or `@` is read as a
  // formula when the file is opened in a spreadsheet. The downloaded header guards each
  // such cell with one leading `'`, as the change-proposal export does; every other
  // name, and every number under them, is written as before.
  test('a Pool name that begins with = + - @ is guarded in the downloaded header; plain names and the numbers are not', async ({ page }) => {
    await loadGachaIn(page, 'ko')
    await stepTimes(page, 2)
    const before = await rowsOf(page, await downloadRunCsv(page))
    const ids = await poolIds(page)
    const signed = ['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd']
    await page.evaluate(
      ([nodeIds, labels]) => {
        const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
        labels.forEach((label, i) => g.updateNodeData(nodeIds[i], { label }))
      },
      [ids.slice(0, 4), signed] as const,
    )
    await stepTimes(page, 2)
    const after = await rowsOf(page, await downloadRunCsv(page))
    expect(after[0].slice(1, 5)).toEqual(signed.map((s, i) => `'${s} [${ids[i]}]`))
    // control: the step column and every other name are byte for byte the names before
    expect(after[0][0]).toBe('step')
    expect(after[0].slice(5)).toEqual(before[0].slice(5))
    expect(after[0].slice(5).some((h) => h.startsWith("'")), 'no plain name is guarded').toBe(false)
    // the numbers are the same numbers
    expect(after.slice(1)).toEqual(before.slice(1))
  })
})

// issue #616 item 4 follow-up — the three Monte-Carlo CSVs write a Pool's name in
// the runs file's header and in the series and summary files' `pool` cells. A name
// that begins with `=`, `+`, `-` or `@` gets one leading `'` there; checked on the
// downloaded bytes, against the same run downloaded with plain names.
test.describe('the Monte-Carlo CSVs guard a Pool name that begins with = + - @', () => {
  const graph = (names: string[]) =>
    JSON.stringify({
      schema: 'loop-studio/graph/2',
      version: 1,
      nodes: [
        { id: 'S', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
        ...names.map((label, i) => ({ id: `p${i + 1}`, type: 'pool', position: { x: 300, y: i * 120 }, data: { kind: 'pool', label, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })),
      ],
      edges: names.map((_, i) => ({ id: `e${i + 1}`, source: 'S', target: `p${i + 1}`, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1-3' } })),
    })
  const FILES = [
    ['dist.export.runsCsv', 'loop-studio-montecarlo-runs.csv'],
    ['dist.export.seriesCsv', 'loop-studio-montecarlo-series.csv'],
    ['dist.export.summaryCsv', 'loop-studio-montecarlo-summary.csv'],
  ] as const
  async function downloadMc(page: Page, names: string[]): Promise<Record<string, string[][]>> {
    await importGraph(page, graph(names))
    await runMc(page, { baseSeed: 1, runs: 6, steps: 3, tracked: [] })
    const exportBtn = page.locator('.timeline__csv[aria-haspopup="true"]')
    await expect(exportBtn).toBeEnabled({ timeout: 60_000 })
    const out: Record<string, string[][]> = {}
    for (const [key, file] of FILES) {
      const label = await page.evaluate((k) => ((window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog as Record<string, string>)[k], key)
      if ((await exportBtn.getAttribute('aria-expanded')) !== 'true') await exportBtn.click()
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.menu__pop [role="menuitem"] .menu__name', { hasText: label }).click()])
      expect(download.suggestedFilename()).toBe(file)
      out[file] = await rowsOf(page, await savedBytes(download))
    }
    return out
  }

  test('runs header and series / summary `pool` cells: only the four signed names get a leading `\'`; the numbers are the plain run\'s', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const plain = await downloadMc(page, ['P1', 'P2', 'P3', 'P4', 'Gold'])
    const signed = await downloadMc(page, ['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd', 'Gold'])
    const guarded = ["'=SUM(A1:A9)", "'+1+1", "'-2+3", "'@cmd", 'Gold']

    const runs = signed['loop-studio-montecarlo-runs.csv']
    expect(runs[0]).toEqual(['run', 'seed', ...guarded])
    expect(runs.slice(1), 'runs: the same numbers').toEqual(plain['loop-studio-montecarlo-runs.csv'].slice(1))

    const series = signed['loop-studio-montecarlo-series.csv']
    expect(series[0], 'series header untouched').toEqual(plain['loop-studio-montecarlo-series.csv'][0])
    expect(series.slice(1, 6).map((r) => r[1])).toEqual(guarded)
    const dropName = (rows: string[][], at: number) => rows.slice(1).map((r) => r.filter((_, i) => i !== at))
    expect(dropName(series, 1), 'series: the same numbers').toEqual(dropName(plain['loop-studio-montecarlo-series.csv'], 1))

    const summary = signed['loop-studio-montecarlo-summary.csv']
    expect(summary.slice(1).map((r) => r[0])).toEqual(guarded)
    expect(dropName(summary, 0), 'summary: the same numbers').toEqual(dropName(plain['loop-studio-montecarlo-summary.csv'], 0))
  })
})

/** every row of a downloaded CSV, through the product's own parser */
async function rowsOf(page: Page, bytes: Buffer): Promise<string[][]> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return page.evaluate(async (t) => {
    const csv = (await import('/src/model/csv.ts')) as {
      stripBom: (s: string) => string
      parseDelimitedText: (s: string, d: string) => { ok: boolean; rows?: string[][] }
    }
    const r = csv.parseDelimitedText(csv.stripBom(t), ',')
    if (!r.ok || !r.rows) throw new Error('the product could not parse its own export')
    return r.rows
  }, text)
}
