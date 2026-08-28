import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { capturedExports, installProbe, pathProbe } from './support/mc'

// Runs under playwright.dist.config.ts: production `npm run build` served by
// `vite preview` at the root `/` — the shape Cloudflare Pages serves. No
// window.__loop bridge (prod), so everything is DOM-driven, like the portable
// spec. `vite preview` on localhost is a secure context, so the Monte-Carlo
// Worker path is active here (unlike the portable file:// build).

const RF = 'examples/risky-factory.json'
const ORIGIN = 'http://localhost:4173' // playwright.dist.config.ts baseURL

/** boot the prod build; fail on any console error, page error, failed request,
 *  or cross-origin request */
async function openProd(page: Page): Promise<{ bad: string[] }> {
  const bad: string[] = []
  const origin = ORIGIN
  const local = (u: string) => u.startsWith('data:') || u.startsWith('blob:') || u.startsWith(origin)
  page.on('requestfailed', (r) => {
    if (!local(r.url())) bad.push(`requestfailed ${r.url()} — ${r.failure()?.errorText}`)
  })
  page.on('response', (r) => {
    const u = r.url()
    if (u.startsWith('data:') || u.startsWith('blob:')) return
    if (!u.startsWith(origin)) bad.push(`cross-origin request ${u}`)
    else if (r.status() >= 400) bad.push(`${r.status()} ${u}`)
  })

  await installProbe(page)
  await page.goto('/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  expect(await page.evaluate(() => Boolean((window as any).__loop)), 'no dev bridge in the prod build').toBe(false)
  return { bad }
}

async function runPrefilledMc(page: Page, runs: number, steps: number, seed: number): Promise<void> {
  await page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
  const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
  await expect(dlg).toBeVisible()
  const nums = dlg.locator('.mcdlg__field input[type="number"]')
  await expect(nums.nth(0)).toHaveValue(String(runs)) // pre-filled from recommendedRunConfig
  await expect(nums.nth(1)).toHaveValue(String(steps))
  await expect(nums.nth(2)).toHaveValue(String(seed))
  const runBtn = dlg.locator('.mcdlg__foot .btn--primary')
  await expect(runBtn).toHaveText(`Run ${runs} runs`)
  await expect(runBtn).toBeEnabled()
  await runBtn.click()
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
}

test.describe('production build (Cloudflare Pages shape)', () => {
  test('boots at /, imports Risky Factory, runs the Worker path → 424/500, exports, survives reload', async ({ page }) => {
    const { bad } = await openProd(page)

    // 0 — the build stamp is injected and rendered (vN.N.N[-tag], optional · sha)
    await expect(page.locator('.toolbar__build')).toHaveText(/^v\d+\.\d+\.\d+(-[a-z]+)?( · [0-9a-f]{7})?$/)

    // 1 — Import through the real hidden <input type=file>
    await page.locator('input[type="file"]').setInputFiles(RF)
    await expect(page.locator('.react-flow__node')).toHaveCount(18)

    // 2 — MC dialog is pre-filled from the file's recommendedRunConfig
    await runPrefilledMc(page, 500, 40, 1)

    // 3 — real Worker path (secure-context localhost), correct result
    await expect(page.locator('.dist')).toBeVisible({ timeout: 40_000 })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    const probe = await pathProbe(page)
    expect(probe.wk.ctor, 'Workers constructed on the preview server').toBeGreaterThanOrEqual(2)
    expect(probe.wk.job, 'jobs dispatched to Workers').toBeGreaterThanOrEqual(1)
    await expect(page.locator('.term__line')).toHaveCount(1)
    await expect(page.locator('.term__pct b')).toHaveText('85%')

    // 4 — Export ▾ → JSON; captured via the URL.createObjectURL wrapper
    await page.locator('.dist__stats .menu button', { hasText: 'Export' }).click()
    await page.getByRole('menuitem', { name: 'JSON' }).click()
    const file = (await capturedExports(page)).findLast((e) => e.name.endsWith('.json'))
    expect(file).toBeTruthy()
    const result = JSON.parse(file!.text)
    expect(result.spec).toBe('loop-mc/1')
    expect(result.completedRuns).toBe(500)
    expect(result.endedRuns.atOrBeforeStep.at(-1)).toBe(424)
    expect(result.recommendedRunConfig).toBeUndefined() // MC JSON export, not a graph doc

    // 5 — a graph Export is a valid graph file carrying recommendedRunConfig
    await page.getByRole('button', { name: 'Export', exact: true }).click() // toolbar, not "Export ▾"
    const graphFile = (await capturedExports(page)).findLast((e) => e.name === 'loop-studio-graph.json')
    expect(graphFile).toBeTruthy()
    const graphDoc = JSON.parse(graphFile!.text)
    expect(graphDoc.schema).toBe('loop-studio/graph')
    expect(graphDoc.nodes).toHaveLength(18)
    expect(graphDoc.recommendedRunConfig).toMatchObject({ baseSeed: 1, runs: 500, steps: 40 })

    // 6 — hard reload: the app boots again and restores the graph from storage
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(page.locator('.react-flow__node')).toHaveCount(18)

    // 7 — no console errors (support/loop fixture), no failed / cross-origin requests
    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })
})
