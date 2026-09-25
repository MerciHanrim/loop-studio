import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, openApp, resetAll, runMc, test } from './support/loop'

// Every CSV this product downloads is BOM-prefixed UTF-8.
//
// WHY THE BYTES, AND WHY IN A BROWSER
//
// Excel on Windows guesses a downloaded `.csv`'s encoding, and with no BOM it
// guesses the system ANSI code page. MEASURED on a real export
// (`loop-studio-run.csv`, 4,148 bytes, valid UTF-8, first bytes `73 74 65 70`
// = `step,`): every Korean header rendered as mojibake — `레벨` came out as
// `ë ë²¨`.
//
// `charset=utf-8` on the Blob does NOT fix it. A downloaded file carries no
// media type, so Excel never sees it: two of the five call sites already set
// it and were mojibake all the same. Only a BOM travels with the bytes, which
// is why this spec reads the SAVED FILE rather than asserting on the Blob.
//
// `src/ui/download.test.ts` holds the other half — that no component can build
// a CSV blob of its own again.

const BOM = [0xef, 0xbb, 0xbf]

type Loop = Record<string, { getState: () => any }>

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

/** The bytes the browser actually wrote to disk. */
async function savedBytes(download: Download): Promise<Buffer> {
  const path = await download.path()
  return readFileSync(path!)
}

function assertBom(bytes: Buffer, what: string) {
  expect([...bytes.subarray(0, 3)], `${what}: must start with a UTF-8 BOM`).toEqual(BOM)
  // exactly one — a second BOM is a stray U+FEFF in the first cell
  expect([...bytes.subarray(3, 6)], `${what}: must not be double-prefixed`).not.toEqual(BOM)
}

function decodeAfterBom(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))
}

/** RFC 4180 records. Every CSV this product downloads ends its rows with CRLF,
 *  and no LF may appear without a CR before it: five of the six used to join
 *  rows with a bare LF while the change-proposal export alone used CRLF, so the
 *  file a user opened depended on which menu item they picked. Counted on the
 *  BYTES, because that is what a spreadsheet reads. */
function assertCrlf(bytes: Buffer, what: string) {
  let lf = 0
  let crlf = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue
    lf++
    if (i > 0 && bytes[i - 1] === 0x0d) crlf++
  }
  expect(lf, `${what}: must contain records at all`).toBeGreaterThan(0)
  expect(crlf, `${what}: every LF must be preceded by CR`).toBe(lf)
  expect([...bytes.subarray(bytes.length - 2)], `${what}: the last record is terminated too`).toEqual([0x0d, 0x0a])
}

test.describe('every downloaded CSV is BOM-prefixed UTF-8', () => {
  test('the timeline CSV, with Korean pool labels', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    // a Template gives the timeline real, localized pool labels to write
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page.locator('.menu__pop [role="menuitem"]').first().click()
    const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()

    // run a few steps so the timeline has rows, then show it
    for (let i = 0; i < 3; i++) await page.locator('.pstrip__step, [title*="한 단계"]').first().click()
    const showTimeline = page.locator('.pstrip button', { hasText: /타임라인/ }).first()
    if (await showTimeline.isVisible().catch(() => false)) await showTimeline.click()

    const csvBtn = page.locator('.timeline__csv, button', { hasText: /^CSV$/ }).first()
    await expect(csvBtn).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), csvBtn.click()])
    expect(download.suggestedFilename()).toBe('loop-studio-run.csv')

    const bytes = await savedBytes(download)
    assertBom(bytes, 'timeline CSV')
    assertCrlf(bytes, 'timeline CSV')
    const text = decodeAfterBom(bytes)
    expect(text.startsWith('step,'), 'the body after the BOM is the CSV itself').toBe(true)
    // the Korean labels survive the round trip through the file
    expect(/[가-힣]/.test(text), 'Korean headers must be present: ' + text.slice(0, 80)).toBe(true)
  })

  test('the sample CSV, and it re-imports into this product', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'en')
    await page.getByRole('button', { name: 'Data ▾' }).click()
    await page.getByRole('menuitem').first().click()
    const dlg = page.locator('.mcdlg--dataimport')
    await expect(dlg).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dlg.getByRole('button', { name: 'Download sample CSV' }).click(),
    ])
    const bytes = await savedBytes(download)
    assertBom(bytes, 'sample CSV')
    assertCrlf(bytes, 'sample CSV')

    // ROUND TRIP: paste the downloaded body back into the wizard. The BOM is
    // part of the file, so this is the path a user takes when they open the
    // sample in Excel, save it, and bring it back.
    await dlg.getByRole('button', { name: 'Use this example' }).click()
    const paste = dlg.locator('textarea').first()
    await paste.fill(new TextDecoder('utf-8').decode(bytes))
    await expect(dlg.locator('.import__status').first()).toContainText(/Key:/)
    // the wizard reads the same shape it advertises, BOM and all
    await expect(dlg.locator('.import__status').first()).not.toContainText(/none yet/)
  })

  test('the three Monte-Carlo CSVs, and the JSON beside them has no BOM', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page.locator('.menu__pop [role="menuitem"]').first().click()
    const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()

    // a Monte-Carlo result is what enables the Export menu
    await runMc(page, { baseSeed: 1, runs: 20, steps: 10 })
    // two buttons carry .timeline__csv — the timeline's own CSV and the
    // distribution Export menu. This test wants the menu.
    const exportBtn = page.locator('.timeline__csv[aria-haspopup="true"]')
    await expect(exportBtn).toBeEnabled({ timeout: 60_000 })

    const openExport = async () => {
      if ((await exportBtn.getAttribute('aria-expanded')) !== 'true') await exportBtn.click()
    }

    // the item names are LOCALIZED, so take them from the running catalog
    // rather than hardcoding Korean that would go stale the next time the
    // copy is audited
    const names = await page.evaluate(() => {
      const cat = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
        .activeCatalog as Record<string, string>
      return {
        series: cat['dist.export.seriesCsv'],
        runs: cat['dist.export.runsCsv'],
        summary: cat['dist.export.summaryCsv'],
      }
    })

    for (const [label, file] of [
      [names.series, 'loop-studio-montecarlo-series.csv'],
      [names.runs, 'loop-studio-montecarlo-runs.csv'],
      [names.summary, 'loop-studio-montecarlo-summary.csv'],
    ] as const) {
      await openExport()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.menu__pop [role="menuitem"] .menu__name', { hasText: label }).click(),
      ])
      expect(download.suggestedFilename()).toBe(file)
      const bytes = await savedBytes(download)
      assertBom(bytes, file)
      assertCrlf(bytes, file)
      expect(decodeAfterBom(bytes).length, file + ': body after the BOM').toBeGreaterThan(0)
    }

    // the JSON in the same menu must NOT be prefixed — the BOM belongs to CSV
    await openExport()
    const [json] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.menu__pop [role="menuitem"] .menu__name', { hasText: /^JSON$/ }).click(),
    ])
    const jsonBytes = await savedBytes(json)
    expect([...jsonBytes.subarray(0, 3)], 'JSON must carry no BOM').not.toEqual(BOM)
    expect(() => JSON.parse(jsonBytes.toString('utf8')), 'JSON must parse as-is').not.toThrow()
  })

  test('the change-proposal CSV, with a Korean table and column name', async ({ page }) => {
    // This is the sixth CSV, and the only one that was never broken: its
    // serializer added a BOM of its own (§DI12.3). That responsibility now
    // sits at the download boundary with the other five, so the bytes a user
    // receives must be unchanged — which is what this test is for.
    await openApp(page)
    await resetAll(page)

    const TABLE = '아이템 목록'
    const KEY_COL = '항목키'
    const NAME_COL = '표시이름'
    const NUM_COL = '무게'

    await page.getByRole('button', { name: 'Data ▾' }).click()
    await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
    const wizard = page.getByRole('dialog', { name: 'Import spreadsheet data' })
    await expect(wizard).toBeVisible()

    await wizard.getByLabel('Table name').fill(TABLE)
    await wizard
      .getByPlaceholder('Paste CSV or TSV text here')
      .fill(`${KEY_COL},${NAME_COL},${NUM_COL}\nitm_a,불꽃검,10\nitm_b,무쇠부적,3`)
    const header = wizard.locator('.import__preview thead tr').first()
    await header.locator('select').nth(0).selectOption('key')
    await header.locator('select').nth(1).selectOption('label')
    await header.locator('select').nth(2).selectOption('number')
    await wizard.getByRole('button', { name: 'Next' }).click() // placement
    await wizard.getByRole('button', { name: 'Next' }).click() // review
    await wizard.getByRole('button', { name: 'Import' }).click()
    await expect(wizard).toBeHidden()

    // the export lists CHANGED cells only (§DI-D1), so move one value
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const n = g.nodes.find((x: { data?: { sourceKey?: string } }) => x.data?.sourceKey === 'itm_a')
      g.updateNodeData(n.id, { value: 25 })
    })

    await page.getByRole('button', { name: 'Data ▾' }).click()
    await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
    const manage = page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
    await expect(manage).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      manage.getByRole('button', { name: 'Export change-proposal CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('loop-studio-change-proposal.csv')

    const bytes = await savedBytes(download)
    assertBom(bytes, 'change-proposal CSV')
    assertCrlf(bytes, 'change-proposal CSV')
    const text = decodeAfterBom(bytes)

    // the Korean table name and column header survive, byte for byte. The
    // export also prefixes every text field with a `'` (§DI12.3's leading-quote
    // guard), so match on containment rather than equality.
    expect(text, 'the Korean table name must be intact').toContain(TABLE)
    expect(text, 'the Korean column header must be intact').toContain(NUM_COL)
    expect(text.startsWith('source_table,')).toBe(true)
    expect(text.includes('\r\n'), '§DI12.3 CRLF is unchanged').toBe(true)
    // the changed cell is the one reported
    expect(text).toContain('10,25')

    // ROUND TRIP: the downloaded body goes back into the wizard's paste box —
    // the path a designer takes after editing it in their sheet.
    await page.keyboard.press('Escape')
    await expect(manage).toBeHidden()
    await page.getByRole('button', { name: 'Data ▾' }).click()
    await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
    await expect(wizard).toBeVisible()
    await wizard.getByLabel('Table name').fill('제안 되읽기')
    await wizard.getByPlaceholder('Paste CSV or TSV text here').fill(new TextDecoder('utf-8').decode(bytes))
    // the importer reads it: the Korean header is offered as a mappable column
    await expect(wizard.locator('.import__preview thead tr').first()).toContainText('source_table')
    await expect(wizard.locator('.import__preview tbody').first()).toContainText(TABLE)
  })
})
