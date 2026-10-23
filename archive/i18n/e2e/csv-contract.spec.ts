import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

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
// conversion (duplicate keys overwrite).
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
 *  the RUNNING catalog gives it — hardcoding Thai here would be the same
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
  test('THAI 3-zone gacha: 24 columns, every name unique, every Pool column carries its node id', async ({ page }) => {
    await loadGachaIn(page, 'th')
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

    // it is still readable: Thai text in front of every id
    const thai = header.slice(1).filter((h) => /[฀-๿]/.test(h))
    expect(thai.length, 'the localized label is kept in front of the id').toBeGreaterThan(10)
  })

  test('frames do not name the columns: none, overlapping and nested all give the SAME header', async ({ page }) => {
    await loadGachaIn(page, 'th')
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
    await loadGachaIn(page, 'th')
    const hostile = 'ตั๋ว, "premium"\nzone 1'
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
})
