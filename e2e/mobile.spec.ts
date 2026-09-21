import type { Locator, Page } from '@playwright/test'
import {
  expect,
  graphSnapshot,
  importGraph,
  mcSnapshot,
  openApp,
  readFixture,
  readRiskyFactory,
  resetAll,
  runMc,
  snap,
  test,
} from './support/loop'
import { fixtureFlow } from './support/revision-fixture'

// docs/mobile.md §MV10 — the mobile View/Run layout. Runs under the `mobile`
// Playwright project (390x844 portrait; tests rotate to 844x390). Slice 1 scope:
// dynamic-viewport height, no sideways scroll, safe-area reserved as real space,
// a full-bleed canvas, no minimap, one re-fit on rotation. The fixed run bar,
// the compact top bar, the sheets, and the editing lock land in Slices 2-3.

const PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }

async function loadDiagram(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
}

/** A tap at a node's screen centre. docs/dense-graph-pan.md — on mobile the
 *  pan-capture overlay sits over the canvas, so a node is reached by tapping
 *  *through* it (a short press → the overlay resolves the node and selects it),
 *  not by `locator.click()` (which the overlay would intercept). */
async function tapNode(page: Page, node: Locator): Promise<void> {
  const b = (await node.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

/** document does not scroll sideways */
async function noHScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  expect(over, 'no horizontal document overflow').toBeLessThanOrEqual(0)
}

// Slice 2b — the Share disclosure and the import replace-confirm are in-app
// ConfirmDialogs now (not window.confirm).
async function answerDialog(page: Page, choice: 'accept' | 'cancel', text?: RegExp): Promise<void> {
  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toBeVisible()
  if (text) await expect(dlg).toContainText(text)
  const name =
    choice === 'accept'
      ? /create link|replace|apply|load template|save workspace|save without|export revision/i
      : /^cancel$|^취소$/i
  await dlg.getByRole('button', { name }).click()
  await expect(dlg).toHaveCount(0)
}

function rectInside(inner: { x: number; y: number; width: number; height: number } | null, w: number, h: number, slack = 1): boolean {
  if (!inner) return false
  return (
    inner.x >= -slack &&
    inner.y >= -slack &&
    inner.x + inner.width <= w + slack &&
    inner.y + inner.height <= h + slack
  )
}

test.describe('mobile view/run — Slice 1 layout', () => {
  test('portrait: full-bleed canvas, no minimap, no sideways scroll', async ({ page }) => {
    await loadDiagram(page)
    await noHScroll(page)

    // minimap is not rendered on mobile (§MV-D10)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    // the desktop Inspector column is out of the mobile flow (Slice 3 → sheet)
    await expect(page.locator('.inspector')).toBeHidden()

    const canvas = await page.locator('.canvas').boundingBox()
    expect(canvas).not.toBeNull()
    // canvas spans the full width and takes most of the screen
    expect(canvas!.width).toBeGreaterThanOrEqual(PORTRAIT.width - 2)
    const cover = (canvas!.width * canvas!.height) / (PORTRAIT.width * PORTRAIT.height)
    expect(cover, 'canvas covers most of the viewport').toBeGreaterThan(0.6)
  })

  test('landscape: still no sideways scroll, canvas still fills', async ({ page }) => {
    await loadDiagram(page)
    await page.setViewportSize(LANDSCAPE)
    await page.waitForTimeout(120)
    await noHScroll(page)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)

    const canvas = await page.locator('.canvas').boundingBox()
    expect(canvas!.width).toBeGreaterThanOrEqual(LANDSCAPE.width - 2)
    const cover = (canvas!.width * canvas!.height) / (LANDSCAPE.width * LANDSCAPE.height)
    expect(cover).toBeGreaterThan(0.6)
  })

  test('safe-area insets are reserved as real padding', async ({ page }) => {
    await loadDiagram(page)
    // mock non-zero insets the way a notched device reports them
    await page.addStyleTag({
      content: ':root{--sai-top:47px;--sai-right:0px;--sai-bottom:34px;--sai-left:0px;}',
    })
    await page.waitForTimeout(60)

    const padTop = await page.locator('.toolbar').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))
    const padBottom = await page.locator('.pstrip').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
    expect(padTop, 'toolbar reserves the top inset').toBeGreaterThanOrEqual(47)
    expect(padBottom, 'run strip reserves the bottom inset').toBeGreaterThanOrEqual(34)

    // still no overflow, canvas still fills
    await noHScroll(page)
    const canvas = await page.locator('.canvas').boundingBox()
    expect(canvas!.width).toBeGreaterThanOrEqual(PORTRAIT.width - 2)
  })

  test('dynamic viewport height: the run controls stay on-screen when height shrinks and grows', async ({ page }) => {
    await loadDiagram(page)
    for (const h of [844, 620, 700, 844]) {
      await page.setViewportSize({ width: PORTRAIT.width, height: h })
      await page.waitForTimeout(80)
      const strip = await page.locator('.pstrip').boundingBox()
      expect(strip, `run strip present at height ${h}`).not.toBeNull()
      expect(strip!.y + strip!.height, `run strip bottom within viewport at height ${h}`).toBeLessThanOrEqual(h + 1)
      expect(strip!.y, `run strip top within viewport at height ${h}`).toBeGreaterThanOrEqual(0)
      await noHScroll(page)
    }
  })

  test('rotation re-fits the diagram exactly once; same-orientation pan/zoom does not', async ({ page }) => {
    await loadDiagram(page)
    await page.waitForTimeout(200)

    const viewportTransform = () =>
      page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)

    // pan within portrait — the viewport transform changes, and it is NOT reset
    const before = await viewportTransform()
    const c = (await page.locator('.canvas').boundingBox())!
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    await page.mouse.down()
    await page.mouse.move(c.x + c.width / 2 - 60, c.y + c.height / 2 - 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(120)
    const afterPan = await viewportTransform()
    expect(afterPan, 'pan moved the viewport').not.toBe(before)

    // rotate — a single re-fit brings every node back inside the canvas
    await page.setViewportSize(LANDSCAPE)
    await page.waitForTimeout(300)
    const canvas = (await page.locator('.canvas').boundingBox())!
    const nodes = await page.locator('.react-flow__node').all()
    expect(nodes.length).toBeGreaterThan(0)
    for (const n of nodes) {
      const b = await n.boundingBox()
      expect(rectInside(b, canvas.x + canvas.width, canvas.y + canvas.height, 8), 'node inside canvas after rotation re-fit').toBe(true)
    }
    await noHScroll(page)
  })

  test('resizing back to a desktop width restores the desktop layout', async ({ page }) => {
    await loadDiagram(page)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(150)

    await expect(page.locator('.react-flow__minimap')).toHaveCount(1)
    await expect(page.locator('.inspector')).toBeVisible()
  })

  // docs/visual-language.md §VL7 — the zoom LOD is the same code path on mobile.
  test('zoom LOD works on the mobile canvas — L2 → L0 → L2, no reflow, no sideways scroll', async ({ page }) => {
    await loadDiagram(page)
    const anyNode = page.locator('.react-flow__node .nodef').first()
    const zoom = () =>
      page.evaluate(() => parseFloat(/scale\(([-0-9.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)![1]))
    const lod = () => anyNode.evaluate((el) => (el.className.match(/lod-\w+/) || [''])[0])
    const worldBox = () =>
      anyNode.evaluate((el) => {
        const z = parseFloat(/scale\(([-0-9.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)![1])
        const r = el.getBoundingClientRect()
        return [Math.round(r.width / z), Math.round(r.height / z)]
      })
    const box = await page.locator('.react-flow__pane').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)

    // risky-factory fit-to-view on a phone starts zoomed out — pull in to L2 first
    for (let i = 0; i < 80 && (await zoom()) < 1; i++) await page.mouse.wheel(0, -130)
    expect(await lod()).toBe('lod-L2')
    const b2 = await worldBox()

    for (let i = 0; i < 80 && (await zoom()) > 0.3; i++) await page.mouse.wheel(0, 130)
    expect(await lod()).toBe('lod-L0')
    expect(await worldBox(), 'node footprint identical at L0').toEqual(b2)
    await noHScroll(page)

    for (let i = 0; i < 80 && (await zoom()) < 1; i++) await page.mouse.wheel(0, -130)
    expect(await lod()).toBe('lod-L2')
    expect(await worldBox(), 'footprint restored at L2').toEqual(b2)
  })
})

// ---------------------------------------------------------------------------

test.describe('mobile view/run — Slice 2 chrome', () => {
  const more = (page: Page) => page.getByRole('button', { name: 'More' })
  const runBar = (page: Page) => page.locator('.pstrip--mobile')
  const sheet = (page: Page, label: string) => page.locator(`.sheet[aria-label="${label}"]`)

  async function centreHitsSelf(page: Page, sel: string): Promise<boolean> {
    return page.locator(sel).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return el.contains(top) || top === el
    })
  }

  test('compact top bar: Logo + caption + a single More button, no palette / undo / New', async ({ page }) => {
    await loadDiagram(page)
    await expect(page.locator('.toolbar__palette')).toHaveCount(0)
    await expect(page.locator('.toolbar__vr')).toContainText('view & run')
    await expect(more(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0)
    await expect(page.locator('.pstrip__field')).toHaveCount(0) // no speed / seed
  })

  test('More menu: items present, aria-expanded, Escape closes and returns focus', async ({ page }) => {
    await loadDiagram(page)
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false')
    await more(page).click()
    await expect(sheet(page, 'More')).toBeVisible()
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true')
    for (const label of ['Share link', 'Import', 'Export', 'Templates', 'Theme']) {
      await expect(sheet(page, 'More').getByText(label, { exact: false }).first()).toBeVisible()
    }
    await expect(sheet(page, 'More').locator('.sheet__stamp')).toContainText(/v\d+\.\d+\.\d+/)
    await page.keyboard.press('Escape')
    await expect(sheet(page, 'More')).toBeHidden()
    await expect(more(page)).toBeFocused()
  })

  test('Help sub-sheet: Send feedback is a fixed external link opening a new tab (order + parity with desktop)', async ({
    page,
  }) => {
    await loadDiagram(page)
    await more(page).click()
    await sheet(page, 'More').locator('.sheet__row', { hasText: 'Help' }).click()
    const help = sheet(page, 'Help')
    await expect(help).toBeVisible()
    const rows = help.locator('.sheet__row')
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toHaveText(/Take a tour|둘러보기/)
    await expect(rows.nth(1)).toHaveText(/Contextual help|상황별 도움말/)
    await expect(rows.nth(2)).toHaveText(/Send feedback|피드백 보내기/)
    await expect(rows.nth(3)).toHaveText(/About Loop Studio|Loop Studio 정보/)

    const link = help.locator('a.sheet__row', { hasText: /Send feedback|피드백 보내기/ })
    await expect(link).toHaveAttribute('href', 'https://tally.so/r/9qkk6Y')
    await expect(link).toHaveAttribute('target', '_blank')
    const rel = (await link.getAttribute('rel')) ?? ''
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
    await expect(link).toHaveAttribute('aria-label', /new tab|새 탭|新しいタブ/)
    await expect(link.locator('.menu__ext')).toHaveAttribute('aria-hidden', 'true')

    // tapping it opens the form in a new tab AND closes the Help sheet (parity
    // with the desktop menu, which closes on click). The form request is
    // aborted so CI never actually hits the Tally host.
    await page.context().route('**tally.so**', (r) => r.abort())
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
    await popup.close()
    await expect(help).toBeHidden()
    await page.context().unroute('**tally.so**')
  })

  test('exclusive overlays: opening one closes any other (Timeline / More / Export / MC dialog)', async ({ page }) => {
    await loadDiagram(page)
    await runBar(page).getByRole('button', { name: /^Timeline/ }).click()
    await expect(page.locator('.timeline--sheet')).toBeVisible()

    await more(page).click()
    await expect(page.locator('.timeline--sheet')).toBeHidden()
    await expect(sheet(page, 'More')).toBeVisible()

    await sheet(page, 'More').locator('.sheet__row', { hasText: 'Export' }).click()
    await expect(sheet(page, 'More')).toBeHidden()
    await expect(sheet(page, 'Export')).toBeVisible()

    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    await expect(sheet(page, 'Export')).toBeHidden()
    await expect(page.locator('.mcdlg')).toBeVisible()

    // and opening a sheet again closes the MC dialog
    await page.locator('.mcdlg__x').click()
    await runBar(page).getByRole('button', { name: /^Timeline/ }).click()
    await expect(page.locator('.timeline--sheet')).toBeVisible()
  })

  test('run controls work from the fixed bottom bar', async ({ page }) => {
    await loadDiagram(page)
    const bar = runBar(page)
    await expect(bar).toBeVisible()
    const bb = await bar.boundingBox()
    expect(bb!.y + bb!.height).toBeLessThanOrEqual(PORTRAIT.height + 1)

    await bar.getByRole('button', { name: 'Advance one step' }).click()
    // the bar is tight, so the step counter shows the number only; the full
    // "step N" phrase is its accessible name
    await expect(page.locator('.pstrip__step')).toHaveText('1')
    await expect(page.locator('.pstrip__step')).toHaveAttribute('aria-label', 'step 1')

    await bar.getByRole('button', { name: /Play/ }).click()
    await expect(bar.getByRole('button', { name: /Pause/ })).toBeVisible()
    await bar.getByRole('button', { name: /Pause/ }).click()

    await bar.getByRole('button', { name: 'Reset to step 0' }).click()
    await expect(page.locator('.pstrip__step')).toHaveText('0')
    await expect(page.locator('.pstrip__step')).toHaveAttribute('aria-label', 'step 0')
  })

  test('Monte Carlo dialog fits the viewport and its body scrolls', async ({ page }) => {
    await loadDiagram(page)
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    const dlg = page.locator('.mcdlg')
    await expect(dlg).toBeVisible()
    expect(rectInside(await dlg.boundingBox(), PORTRAIT.width, PORTRAIT.height, 2)).toBe(true)
    const scrolls = await dlg.locator('.mcdlg__body').evaluate(
      (el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight >= el.clientHeight,
    )
    expect(scrolls).toBe(true)
  })

  test('MC dialog inputs are ≥ 16px (no iOS focus-zoom) and blur on close (§MV4b)', async ({ page }) => {
    await loadDiagram(page)
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    const inputs = page.locator('.mcdlg__field input')
    const n = await inputs.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      const px = await inputs.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(px, `input ${i} font-size`).toBeGreaterThanOrEqual(16)
    }
    // the viewport meta must NOT block accessibility zoom
    const vp = await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
    )
    expect(vp).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/)

    // focusing a field then dismissing the dialog drops focus (iOS un-zooms)
    await inputs.first().focus()
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
    await page.locator('.mcdlg__x').click()
    await expect(page.locator('.mcdlg')).toBeHidden()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT')
  })

  test('Timeline sheet opens and closes', async ({ page }) => {
    await loadDiagram(page)
    await runBar(page).getByRole('button', { name: /^Timeline/ }).click()
    await expect(page.locator('.timeline--sheet')).toBeVisible()
    expect(rectInside(await page.locator('.timeline--sheet').boundingBox(), PORTRAIT.width, PORTRAIT.height, 2)).toBe(true)
    await page.locator('.timeline--sheet .sheet__x').click()
    await expect(page.locator('.timeline--sheet')).toBeHidden()
  })

  test('Share from the More menu still creates a link; the URL field is on-screen', async ({ page }) => {
    await loadDiagram(page)
    await more(page).click()
    await sheet(page, 'More').locator('.sheet__row', { hasText: 'Share link' }).click()
    await answerDialog(page, 'accept', /anyone with it/i) // the §U4 disclosure, in-app now
    const field = page.locator('.sheet .share-pop__url')
    await expect(field).toBeVisible()
    expect(rectInside(await field.boundingBox(), PORTRAIT.width, PORTRAIT.height, 2)).toBe(true)
    await expect(field).toHaveValue(/^https:\/\/cozy-loop-studio\.pages\.dev\/#g1=/)
  })

  test('PWA update bar + an open sheet: Close, Update and Play are each visible and clickable', async ({ page }) => {
    await loadDiagram(page)
    // dev has no service worker — poke the store so `.pwa-update` renders
    await page.evaluate(() => {
      const pwa = (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop.pwa
      pwa.setState({ waitingWorker: { fake: true }, dismissedWorker: null })
    })
    await expect(page.locator('.pwa-update')).toBeVisible()

    await more(page).click()
    await expect(sheet(page, 'More')).toBeVisible()

    const targets: Record<string, string> = {
      Update: '.pwa-update button:has-text("Update")',
      Close: '.sheet[aria-label="More"] .sheet__x',
      Play: '.pstrip--mobile button:has-text("Play")',
    }
    for (const [name, sel] of Object.entries(targets)) {
      await expect(page.locator(sel), `${name} visible`).toBeVisible()
      expect(rectInside(await page.locator(sel).boundingBox(), PORTRAIT.width, PORTRAIT.height, 2), `${name} on-screen`).toBe(true)
      expect(await centreHitsSelf(page, sel), `${name} not occluded`).toBe(true)
    }

    // Play still runs with the sheet + bar both up
    await page.locator('.pstrip--mobile button:has-text("Play")').click()
    await expect(page.locator('.pstrip--mobile button:has-text("Pause")')).toBeVisible()
    // the sheet did not close
    await expect(sheet(page, 'More')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------

test.describe('mobile view/run — Slice 3 editing lock', () => {
  const more = (page: Page) => page.getByRole('button', { name: 'More' })

  // the structural content of the graph — id / type / position / data / edge
  // endpoints — with React Flow's transient view-state (selected, dragging,
  // measured, size) stripped, since §MV3a *allows* selection.
  const graphContent = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[]; edges: unknown[] } } } }).__loop.graph.getState()
      const clean = (o: Record<string, unknown>) => {
        const { selected, dragging, measured, width, height, positionAbsolute, resizing, ...rest } =
          o as Record<string, unknown>
        void selected
        void dragging
        void measured
        void width
        void height
        void positionAbsolute
        void resizing
        return rest
      }
      return JSON.stringify({
        nodes: (g.nodes as Record<string, unknown>[]).map(clean),
        edges: (g.edges as Record<string, unknown>[]).map(clean),
      })
    })

  test('structural editing is blocked — GraphDoc byte-identical after each attempt', async ({ page }) => {
    await loadDiagram(page)
    const before = await graphContent(page)
    const snap0 = await graphSnapshot(page)

    const node = page.locator('.react-flow__node').first()
    const nb = (await node.boundingBox())!

    // 1 — drag a node ~120px
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2)
    await page.mouse.down()
    await page.mouse.move(nb.x + nb.width / 2 + 120, nb.y + nb.height / 2 + 80, { steps: 12 })
    await page.mouse.up()
    expect(await graphContent(page), 'after drag').toBe(before)

    // 2 — select + Delete / Backspace
    await tapNode(page, node)
    await page.keyboard.press('Delete')
    await page.keyboard.press('Backspace')
    expect(await graphContent(page), 'after Delete/Backspace').toBe(before)

    // 3 — connect attempt: drag between two handles
    const handles = page.locator('.react-flow__handle')
    if ((await handles.count()) >= 2) {
      const a = (await handles.nth(0).boundingBox())!
      const b = (await handles.nth(1).boundingBox())!
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
      await page.mouse.up()
      expect(await graphContent(page), 'after connect attempt').toBe(before)
    }

    // 4 / 5 — double-click + right-click (context menu). `force` — the pan
    // overlay is the hit target on mobile; the point is that neither mutates.
    await node.dblclick({ force: true })
    await node.click({ button: 'right', force: true })
    expect(await graphContent(page), 'after dblclick + context menu').toBe(before)

    const snap1 = await graphSnapshot(page)
    expect(snap1.nodeCount).toBe(snap0.nodeCount)
    expect(snap1.edgeCount).toBe(snap0.edgeCount)
  })

  test('mobile <-> desktop round-trip leaves the GraphDoc byte-identical', async ({ page }) => {
    await loadDiagram(page)
    const before = await graphContent(page)

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(1) // desktop layout is up
    expect(await graphContent(page), 'after mobile -> desktop').toBe(before)

    await page.setViewportSize(PORTRAIT)
    await page.waitForTimeout(150)
    await expect(page.locator('.pstrip--mobile')).toBeVisible() // mobile layout is back
    expect(await graphContent(page), 'after desktop -> mobile').toBe(before)
  })

  // docs/large-graph-readability.md §LGR12.3 — the selection count on mobile
  test('§LGR12.3 a single tap opens the sheet and shows NO selection count', async ({ page }) => {
    await loadDiagram(page)
    const inspector = page.locator('.sheet[aria-label="Inspector — read only"]')
    await tapNode(page, page.locator('.react-flow__node').first())
    await expect(inspector).toBeVisible()
    // the sheet already IS that node — a "1 node selected" line would be noise
    await expect(page.locator('.lgr-selection-count')).toHaveCount(0)
    await inspector.locator('.sheet__x').click()
    await expect(inspector).toBeHidden()
  })

  test('§MV3c / §LGR12.3 a desktop multi-selection survives the switch to mobile; the sheet shows the anchor and says how many', async ({ page }) => {
    await loadDiagram(page)
    const selectionState = () =>
      page.evaluate(() => {
        const g = (
          window as unknown as {
            __loop: { graph: { getState: () => { nodes: { id: string; selected?: boolean }[]; selectedNodeId: string | null } } }
          }
        ).__loop.graph.getState()
        return { ids: g.nodes.filter((n) => n.selected).map((n) => n.id).sort(), anchor: g.selectedNodeId }
      })

    // desktop width — the full editing UI, where multi-select exists
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(1)
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { fitView: (o: object) => void } } }).__loop.rf.fitView({ padding: 0.3, duration: 0 }),
    )
    await page.waitForTimeout(150)
    const nodes = page.locator('.react-flow__node')
    expect(await nodes.count()).toBeGreaterThanOrEqual(3)
    const centre = async (i: number) => {
      const b = (await nodes.nth(i).boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const c0 = await centre(0)
    await page.mouse.click(c0.x, c0.y)
    // a REAL modifier: React Flow reads its multi-selection key from keydown
    await page.keyboard.down('Control')
    for (const i of [1, 2]) {
      const c = await centre(i)
      await page.mouse.click(c.x, c.y)
    }
    await page.keyboard.up('Control')
    await page.waitForTimeout(150)

    // BEFORE shrinking: exactly these three, an anchor, and the desktop line
    const before = await selectionState()
    expect(before.ids).toHaveLength(3)
    expect(before.anchor).not.toBeNull()
    expect(before.ids).toContain(before.anchor)
    const desktopLine = page.locator('.rightcol .lgr-selection-count')
    await expect(desktopLine).toBeVisible()
    await expect(desktopLine).toHaveText(/3 nodes selected/)

    // → mobile width. §MV3c: a pure presentation change; the selection stays.
    await page.setViewportSize(PORTRAIT)
    await page.waitForTimeout(300)
    await expect(page.locator('.pstrip--mobile')).toBeVisible()
    expect(await selectionState(), 'ids + anchor survive the switch').toEqual(before)
    const inspector = page.locator('.sheet[aria-label="Inspector — read only"]')
    await expect(inspector).toBeVisible()
    // the sheet shows ONE node — the anchor — …
    const anchorLabel = await page.evaluate(
      (id) =>
        (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; data: { label?: string } }[] } } } }).__loop.graph
          .getState()
          .nodes.find((n) => n.id === id)?.data.label ?? null,
      before.anchor,
    )
    await expect(inspector.locator('input').first()).toHaveValue(anchorLabel!)
    // … and says how many are selected, without the desktop unlock wording
    const line = inspector.locator('.lgr-selection-count')
    await expect(line).toHaveText(/3 nodes selected/)
    await expect(line).not.toContainText('unlock')
    // STRUCTURE: inside the sheet, nowhere else (the sheet is an overlay over the
    // canvas, so its rect legitimately intersects `.react-flow` — no rect
    // comparison against the canvas here)
    await expect(page.locator('.lgr-selection-count')).toHaveCount(1)
    await expect(page.locator('.react-flow .lgr-selection-count')).toHaveCount(0)
    // VISIBILITY: all four edges inside the sheet, and nothing paints over it
    const vis = await line.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const sr = el.closest('.sheet')!.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        inside: r.left >= sr.left && r.right <= sr.right && r.top >= sr.top && r.bottom <= sr.bottom,
        occluded: !(hit && el.contains(hit)),
      }
    })
    expect(vis).toEqual({ inside: true, occluded: false })

    // → back to desktop: everything as it was, the line back in the right column
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(300)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(1)
    expect(await selectionState(), 'ids + anchor survive the return').toEqual(before)
    await expect(desktopLine).toBeVisible()
    await expect(desktopLine).toHaveText(/3 nodes selected/)
    await expect(page.locator('.react-flow .lgr-selection-count')).toHaveCount(0)
  })

  test('tapping a node opens a read-only Inspector sheet; Close and empty-canvas tap dismiss it', async ({ page }) => {
    await loadDiagram(page)
    const inspector = page.locator('.sheet[aria-label="Inspector — read only"]')
    const node = page.locator('.react-flow__node').first()

    await tapNode(page, node)
    await expect(inspector).toBeVisible()
    // <fieldset disabled> disables descendants functionally (no per-control
    // attribute), so assert via the :enabled pseudo-class, not [disabled].
    expect(await inspector.locator('input:enabled, select:enabled, textarea:enabled').count()).toBe(0)
    expect(await inspector.locator('input, select').count()).toBeGreaterThan(0) // fields ARE shown
    // the Delete button is disabled by the fieldset AND hidden — never usable
    for (const del of await inspector.locator('.btn--ghost').all()) {
      await expect(del).toBeHidden()
    }

    await inspector.locator('.sheet__x').click()
    await expect(inspector).toBeHidden()

    await tapNode(page, node)
    await expect(inspector).toBeVisible()
    // the dimmed canvas above the sheet is the scrim — a tap there dismisses
    // the sheet and clears the selection (§MV5)
    await page.locator('.sheet-scrim').click({ position: { x: 40, y: 40 } })
    await expect(inspector).toBeHidden()
    expect(await graphContent(page)).toBe(await graphContent(page)) // still no mutation
    const sel = await page.evaluate(
      () => (window as unknown as { __loop: { graph: { getState: () => { selectedNodeId: unknown } } } }).__loop.graph.getState().selectedNodeId,
    )
    expect(sel).toBeNull()
  })

  // docs/label-timing-authoring.md LTA-INV-4 / review round 5 (Hanrim) — the
  // label-timing preset control's mobile read-only rendering was previously
  // exercised only under the desktop `chromium` project (via a `canvasLocked`
  // stand-in), never under the real `mobile` project / sheet. Also covers a
  // real bug the same review found: on mobile BOTH the hidden desktop
  // `.inspector` and MobileInspectorSheet's own `<Inspector />` are mounted at
  // once, so a fixed DOM id on the control would duplicate — `useId()` fixed
  // it (src/components/Inspector.tsx).
  test('a selected label edge shows the read-only timing text in the mobile sheet — no radios anywhere, no duplicate DOM ids', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [
          { id: 'gate', type: 'gate', position: { x: 0, y: 0 }, data: { kind: 'gate', label: 'Gate', activation: 'automatic', distribution: 'deterministic' } },
          { id: 'pool', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'Pool', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        ],
        edges: [
          {
            id: 'm1', source: 'gate', target: 'pool', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop',
            data: { kind: 'state', mode: 'label', expr: '+1', timing: 'afterPull', when: 'source-fired' },
          },
        ],
      }),
    )
    await page.evaluate(
      () => (window as unknown as { __loop: { graph: { getState: () => { setSelection: (n: string | null, e: string | null) => void } } } })
        .__loop.graph.getState()
        .setSelection(null, 'm1'),
    )

    const inspector = page.locator('.sheet[aria-label="Inspector — read only"]')
    await expect(inspector).toBeVisible()
    // no radio inputs ANYWHERE on the page — not just inside the visible
    // sheet, since the hidden desktop Inspector is also mounted and must
    // independently render its own read-only (radio-free) branch too.
    await expect(page.locator('input[type="radio"]')).toHaveCount(0)
    await expect(inspector).toContainText(/source fire/i) // the current preset, as plain text
    await expect(inspector).toContainText(/applied once/i) // the normal preview line, per §LTA6.2

    const duplicateIds = await page.evaluate(() => {
      const counts = new Map<string, number>()
      for (const el of document.querySelectorAll('[id]')) counts.set(el.id, (counts.get(el.id) ?? 0) + 1)
      return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    })
    expect(duplicateIds).toEqual([])
  })

  test('Import from the More menu confirms before replacing; cancel keeps the graph, accept swaps it', async ({ page }) => {
    await loadDiagram(page)
    const before = await graphContent(page)
    const fixture = readFixture()
    const fileInput = page.locator('.toolbar--mobile input[type="file"]')

    // cancel
    await fileInput.setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(fixture) })
    await answerDialog(page, 'cancel', /replace/i)
    await page.waitForTimeout(150)
    expect(await graphContent(page), 'cancel keeps the graph').toBe(before)

    // accept
    await fileInput.setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(fixture) })
    await answerDialog(page, 'accept', /replace/i)
    await expect.poll(() => graphContent(page)).not.toBe(before)
  })

  const simRev = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __loop: { graph: { getState: () => { simulationRev: number } } } }).__loop.graph.getState().simulationRev,
    )
  const stepIndex = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __loop: { sim: { getState: () => { stepIndex: number } } } }).__loop.sim.getState().stepIndex,
    )

  const openTemplatesSheet = async (page: Page) => {
    await more(page).click()
    await page.locator('.sheet[aria-label="More"] .sheet__row', { hasText: 'Templates' }).click()
    await expect(page.locator('.sheet[aria-label="Templates"]')).toBeVisible()
  }

  test('pristine first boot: picking a mobile Template applies with NO confirm, exactly one simulationRev bump, sheet closes + focus to More', async ({ page }) => {
    // a genuine first-boot session: no saved graph ⇒ graphStore.pristineSample.
    // Runs AFTER the shared fixture's tour seed, so re-suppress the first-run
    // Welcome card here (docs/guided-tour.md — it is not what this test is about).
    await page.addInitScript(() => {
      try {
        localStorage.clear()
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
      } catch {
        /* private mode — fine */
      }
    })
    await openApp(page)
    expect(
      await page.evaluate(
        () => (window as unknown as { __loop: { graph: { getState: () => { pristineSample: boolean } } } }).__loop.graph.getState().pristineSample,
      ),
      'session is the pristine first-boot sample',
    ).toBe(true)

    const before = await graphContent(page)
    const revBefore = await simRev(page)

    await openTemplatesSheet(page)
    await page.locator('.sheet[aria-label="Templates"] .sheet__row').first().click()

    await expect(page.locator('.sheet[aria-label="Templates"]')).toBeHidden()
    // no confirm on the pristine sample — the in-app dialog never mounts
    await expect(page.locator('.mcdlg--confirm')).toHaveCount(0)
    await expect(more(page)).toBeFocused()
    await expect.poll(() => graphContent(page)).not.toBe(before) // the template applied
    expect(await simRev(page), 'exactly one simulationRev bump').toBe(revBefore + 1)
  })

  test('modified session: mobile Template confirms; cancel keeps everything, accept replaces via one simulationRev bump + closes the sheet', async ({ page }) => {
    await loadDiagram(page) // importGraph clears pristineSample
    const before = await graphContent(page)
    const revBefore = await simRev(page)
    const templates = page.locator('.sheet[aria-label="Templates"]')

    // cancel — graph + run state + rev untouched, the sheet stays open
    await openTemplatesSheet(page)
    await templates.locator('.sheet__row').first().click()
    await answerDialog(page, 'cancel', /replace/i)
    await page.waitForTimeout(150)
    expect(await graphContent(page), 'cancel keeps the graph').toBe(before)
    expect(await stepIndex(page)).toBe(0)
    expect(await simRev(page), 'cancel does not bump').toBe(revBefore)
    await expect(templates).toBeVisible()

    // accept — replaced with exactly one bump, the sheet closes, focus to More
    await templates.locator('.sheet__row').first().click()
    await answerDialog(page, 'accept', /replace/i)
    await expect(templates).toBeHidden()
    await expect(more(page)).toBeFocused()
    await expect.poll(() => graphContent(page)).not.toBe(before)
    expect(await simRev(page), 'exactly one simulationRev bump').toBe(revBefore + 1)
  })

  test('pristine first boot shows the "Open a file" card (no account sync); its button opens the picker; it clears once a file loads', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear()
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed') // no first-run tour card
      } catch {
        /* private mode */
      }
    })
    await openApp(page)

    const hint = page.locator('.openhint')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('No account sync')
    await expect(hint).toContainText(/Share link/i)
    const openBtn = hint.getByRole('button', { name: 'Open a file' })
    await expect(openBtn).toBeVisible()
    expect(rectInside(await hint.boundingBox(), 390, 844, 2)).toBe(true)

    // the button opens the OS file chooser (same hidden input as More → Import file)
    const chooser = page.waitForEvent('filechooser')
    await openBtn.click()
    await (await chooser).setFiles({
      name: 'g.json',
      mimeType: 'application/json',
      buffer: Buffer.from(readFixture()),
    })

    // a real document loaded → pristine latch clears → the card is gone
    await expect(hint).toBeHidden()
    expect(
      await page.evaluate(
        () => (window as unknown as { __loop: { graph: { getState: () => { pristineSample: boolean } } } }).__loop.graph.getState().pristineSample,
      ),
    ).toBe(false)
  })

  test('mobile Import file accepts both Graph JSON and Workspace JSON', async ({ page }) => {
    await loadDiagram(page)
    const fileInput = page.locator('.toolbar--mobile input[type="file"]')

    // Graph JSON — plain diagram, no workspace restore
    await fileInput.setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(readFixture()) })
    await answerDialog(page, 'accept', /replace/i)
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[] } } } }).__loop.graph.getState().nodes.length,
        ),
      )
      .toBeGreaterThan(0)

    // Workspace JSON — carries a distinctive viewport that must restore
    const wsText: string = await page.evaluate(() => {
      const io = (window as unknown as { __loop: { io: { serializeWorkspaceFile: (p: unknown) => string; collectWorkspacePayload: (v: unknown) => unknown } } }).__loop.io
      return io.serializeWorkspaceFile(io.collectWorkspacePayload({ x: 111, y: 222, zoom: 1.75 }))
    })
    await fileInput.setInputFiles({ name: 'w.json', mimeType: 'application/json', buffer: Buffer.from(wsText) })
    await answerDialog(page, 'accept', /replace/i)
    await expect
      .poll(() => page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform))
      .toContain('scale(1.75)')
  })

  test('a Monte-Carlo run still completes on mobile', async ({ page }) => {
    await loadDiagram(page)
    await runMc(page, { runs: 40, steps: 15 })
    const s = await mcSnapshot(page)
    expect(s.status).toBe('done')
    expect(s.hasResult).toBe(true)
  })
})

// SEMANTICS-R.md §R7 / §R10.5 — the mobile Review sheet must use the SAME apply
// rules as the desktop panel (revisionActions + projectStore): import opens it
// without mutation, a non-`exact` whole Apply confirms, and Apply is one atomic
// step that mints a new revision.
test.describe('mobile — proposal Review sheet (Slice 1C)', () => {
  test('import opens the sheet with no mutation; non-exact Apply confirms then mints a revision', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    // build a committed revision + a proposal for it, straight through the store
    const built = await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const g = L.graph.getState()
      g.newGraph()
      g.addNodeAt('pool', { x: 0, y: 0 })
      g.addNodeAt('drain', { x: 200, y: 0 })
      const P = L.project.getState()
      const plan = P.planRevision({})
      P.commitRevisionExport(plan.plan)
      const r0 = L.project.getState().open.revisionId
      const prop = P.planProposal({})
      return { proposalText: (prop as { text: string }).text, r0 }
    })

    // the open doc drifts from the base
    await page.evaluate(() =>
      (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph
        .getState()
        .addNodeAt('gate', { x: 400, y: 100 }),
    )
    const before = await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      return { nodes: L.graph.getState().nodes.length, simRev: L.graph.getState().simulationRev }
    })

    await page
      .locator('.toolbar--mobile input[type="file"]')
      .setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(built.proposalText) })

    const sheet = page.locator('.sheet[aria-label="Review proposal"]')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('unverified')

    // import mutated nothing
    const during = await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      return {
        nodes: L.graph.getState().nodes.length,
        simRev: L.graph.getState().simulationRev,
        rev: L.project.getState().open.revisionId,
      }
    })
    expect(during.nodes).toBe(before.nodes)
    expect(during.simRev).toBe(before.simRev)
    expect(during.rev).toBe(built.r0)

    // non-exact ⇒ first tap arms the confirmation, second applies
    await sheet.locator('button', { hasText: 'Apply proposal' }).click()
    await expect(sheet.locator('.review__warn')).toBeVisible()
    await sheet.locator('button', { hasText: 'Apply anyway' }).click()
    await expect(page.locator('.sheet[aria-label="Review proposal"]')).toBeHidden()

    const after = await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const p = L.project.getState().open
      return {
        rev: p.revisionId,
        parent: p.parentId,
        applied: p.appliedProposal ?? null,
        simRev: L.graph.getState().simulationRev,
        step: L.sim.getState().stepIndex,
      }
    })
    expect(after.rev).not.toBe(built.r0)
    expect(after.parent).toBe(built.r0)
    expect(after.applied?.baseId).toBe(built.r0)
    expect(after.simRev).toBe(before.simRev + 1)
    expect(after.step).toBe(0)
  })

  test('per-hunk selection + conflict rules are the same on the mobile sheet (Slice 2)', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('pool', { x: 0, y: 0 })
      G.addNodeAt('drain', { x: 200, y: 0 })
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const r0 = L.project.getState().open.revisionId
      const sid = L.graph.getState().nodes[0].id
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes.push({
        id: 'p_new',
        type: 'pool',
        position: { x: 60, y: 60 },
        data: { kind: 'pool', label: 'New', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
      })
      f.nodes.find((n: { id: string }) => n.id === sid).data.initial = 42
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f), r0, sid }
    })
    // diverge the changed field ⇒ conflict
    await page.evaluate(
      (sid) => (window as unknown as { __loop: any }).__loop.graph.getState().updateNodeData(sid, { initial: 15 }),
      built.sid,
    )

    await page
      .locator('.toolbar--mobile input[type="file"]')
      .setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(built.text) })

    const sheet = page.locator('.sheet[aria-label="Review proposal"]')
    await expect(sheet).toBeVisible()
    await sheet.locator('button', { hasText: 'Choose changes' }).click()

    // the SAME conflict surface as desktop
    const conflict = sheet.locator('.review__field-row--conflict')
    await expect(conflict).toContainText('base')
    await expect(conflict).toContainText('yours')
    await expect(conflict).toContainText('theirs')
    await conflict.locator('label', { hasText: 'keep mine' }).locator('input').check()

    // accept only the "Add p_new" hunk
    await sheet.locator('.review__hunk', { hasText: 'Add node' }).locator('input[type=checkbox]').check()
    await sheet.locator('button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.sheet[aria-label="Review proposal"]')).toBeHidden()

    const after = await page.evaluate((sid) => {
      const L = (window as unknown as { __loop: any }).__loop
      return {
        initial: L.graph.getState().nodes.find((n: any) => n.id === sid)?.data.initial,
        hasPNew: L.graph.getState().nodes.some((n: any) => n.id === 'p_new'),
        parent: L.project.getState().open.parentId,
      }
    }, built.sid)
    expect(after.initial).toBe(15) // conflict kept mine
    expect(after.hasPNew).toBe(true) // the add was taken
    expect(after.parent).toBe(built.r0)
  })

  test('node-removal edge dependency is shown on the sheet and enforced (Slice 2 round 2)', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('pool', { x: 0, y: 0 })
      G.addNodeAt('drain', { x: 200, y: 0 })
      const [a, b] = L.graph.getState().nodes
      L.graph.getState().onConnect({ source: a.id, target: b.id, sourceHandle: 'out', targetHandle: 'in' })
      const eid = L.graph.getState().edges[0].id
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes = f.nodes.filter((n: { id: string }) => n.id !== b.id)
      f.edges = f.edges.filter((e: { id: string }) => e.id !== eid)
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f), eid }
    })

    await page
      .locator('.toolbar--mobile input[type="file"]')
      .setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(built.text) })
    const sheet = page.locator('.sheet[aria-label="Review proposal"]')
    await expect(sheet).toBeVisible()
    await sheet.locator('button', { hasText: 'Choose changes' }).click()

    await expect(sheet.locator('.review__hunk', { hasText: 'Remove node' }).locator('.review__hunk-dep')).toContainText(
      built.eid,
    )
    // node without its dependency ⇒ refused, same rule as desktop
    await sheet.locator('.review__hunk', { hasText: 'Remove edge' }).locator('input[type=checkbox]').uncheck()
    await sheet.locator('.review__hunk', { hasText: 'Remove node' }).locator('input[type=checkbox]').check()
    await sheet.locator('button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(sheet.locator('.review__warn')).toContainText(built.eid)
    await expect(page.locator('.sheet[aria-label="Review proposal"]')).toBeVisible()
  })

  test('structural conflict (local edge onto a removed node) reads the same on the sheet — divergent, node blocked', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('pool', { x: 0, y: 0 })
      G.addNodeAt('drain', { x: 200, y: 0 })
      const [p0, d0] = L.graph.getState().nodes
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes = f.nodes.filter((n: { id: string }) => n.id !== d0.id)
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f), pId: p0.id, dId: d0.id }
    })
    await page
      .locator('.toolbar--mobile input[type="file"]')
      .setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(built.text) })
    const sheet = page.locator('.sheet[aria-label="Review proposal"]')
    await expect(sheet).toBeVisible()
    await page.evaluate(
      ([src, tgt]) =>
        (window as unknown as { __loop: any }).__loop.graph
          .getState()
          .onConnect({ source: src, target: tgt, sourceHandle: 'out', targetHandle: 'in' }),
      [built.pId, built.dId],
    )
    await expect(sheet.locator('.review__class--divergent')).toBeVisible()
    await expect(sheet).not.toContainText('No field conflicts')
    await sheet.locator('button', { hasText: 'Choose changes' }).click()
    const nodeHunk = sheet.locator('.review__hunk', { hasText: 'Remove node' })
    await expect(nodeHunk.locator('.review__hunk-dep--blocked')).toContainText('yours added edge')
    await expect(nodeHunk.locator('input[type=checkbox]')).toBeDisabled()
  })

  // the committed loop-revision/1 oracle produces IDENTICAL results on mobile
  test('verification fixture — same Import→Review→Apply→Undo→Redo oracle as desktop', fixtureFlow('mobile'))
})

// audit ①-2 — the engine refusing to initialise (a Pool with a negative
// `initial` from a hand-edited file) must be VISIBLE on the mobile run bar,
// not only a disabled button's hover `title` (which a touch user never sees).
test('run bar: an engine init refusal shows a visible notice under the controls, Play/Step disabled, no sideways overflow', async ({
  page,
}) => {
  await loadDiagram(page)
  const bad = await page.evaluate(() => {
    const g = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph.getState()
    const doc = JSON.parse(g.exportJSON())
    doc.nodes.find((n: any) => n.data.kind === 'pool').data.initial = -5
    return JSON.stringify(doc)
  })
  await importGraph(page, bad)
  const notice = page.locator('.pstrip--mobile .pstrip__initerr')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/Cannot run/)
  const box = (await notice.boundingBox())!
  expect(box.width).toBeGreaterThan(200) // a real row, not a collapsed inline span
  await expect(page.locator('.pstrip--mobile .pb-btn--primary')).toBeDisabled()
  await expect(page.locator('.pstrip--mobile .pb-btn').nth(1)).toBeDisabled() // Step
  await noHScroll(page)
  // fixing the value clears it again (through the bridge — the mobile layout has no editor)
  await page.evaluate(() => {
    const g = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph.getState()
    const p = g.nodes.find((n: any) => n.data.kind === 'pool')
    g.updateNodeData(p.id, { initial: 2 })
  })
  await expect(notice).toHaveCount(0)
  await expect(page.locator('.pstrip--mobile .pb-btn--primary')).toBeEnabled()
})

// ---------------------------------------------------------------------------
// docs/mobile.md §MV5 — a `.btn` on a sheet has a ≥ 3:1 boundary (WCAG 1.4.11)
// against the sheet, against the hovered / focused row (`--surface-sunken`)
// and against its own face, in light and dark, at rest / row-hover / hover /
// focus / pressed. Measured on the REAL composited pixels of the More sheet's
// two toggles (Focus selection, Activity overlay), not on token arithmetic.
// The audit (2026-09-19) had light Off 1.78, light hovered-row 2.88, dark Off
// 2.54 — the shared `.btn` border (`--line-structure`) was never meant for a
// 1 px control boundary on a panel.
// ---------------------------------------------------------------------------
test.describe('sheet .btn boundary contrast (§MV5 / WCAG 1.4.11)', () => {
  type Rgb = [number, number, number]
  const lum = ([r, g, b]: Rgb) => {
    const f = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a: Rgb, b: Rgb) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const parseRgb = (s: string): Rgb => {
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const r2 = (n: number) => Math.round(n * 100) / 100

  /** decode a viewport screenshot in the page and read pixels (deviceScaleFactor 1 → image px = CSS px) */
  async function rgbAt(page: Page, png: Buffer, pts: { x: number; y: number }[]): Promise<Rgb[]> {
    return page.evaluate(
      async ({ b64, pts }) => {
        const im = new Image()
        im.src = `data:image/png;base64,${b64}`
        await im.decode()
        const cv = document.createElement('canvas')
        cv.width = im.width
        cv.height = im.height
        const cx = cv.getContext('2d')!
        cx.drawImage(im, 0, 0)
        return pts.map(({ x, y }) => {
          const d = cx.getImageData(Math.round(x), Math.round(y), 1, 1).data
          return [d[0], d[1], d[2]] as [number, number, number]
        })
      },
      { b64: png.toString('base64'), pts },
    )
  }

  /** the composited boundary of `btn`: the darkest-vs-outside column across its
   *  left edge and row across its top edge, the colour 5 px outside (the row /
   *  sheet behind it) and 5 px inside (its own face, inside the padding). */
  async function boundary(page: Page, btn: Locator) {
    const b = (await btn.boundingBox())!
    const png = await page.screenshot()
    const cy = b.y + b.height / 2
    const cx = b.x + b.width / 2
    const leftCols = [-1, 0, 1, 2].map((o) => ({ x: b.x + o, y: cy }))
    const topRows = [-1, 0, 1, 2].map((o) => ({ x: cx, y: b.y + o }))
    const px = await rgbAt(page, png, [
      { x: b.x - 5, y: cy }, // outside, left
      { x: b.x + 5, y: cy }, // inside face, left padding
      { x: cx, y: b.y - 5 }, // outside, above
      { x: cx, y: b.y + 3 }, // inside face, top padding
      ...leftCols,
      ...topRows,
    ])
    const [outL, inL, outT, inT] = px
    const pick = (cands: Rgb[], out: Rgb) => cands.reduce((best, c) => (dist(c, out) > dist(best, out) ? c : best))
    const edgeL = pick(px.slice(4, 8), outL)
    const edgeT = pick(px.slice(8, 12), outT)
    return {
      left: { edge: edgeL, out: outL, face: inL, vsOut: r2(ratio(edgeL, outL)), vsFace: r2(ratio(edgeL, inL)) },
      top: { edge: edgeT, out: outT, face: inT, vsOut: r2(ratio(edgeT, outT)), vsFace: r2(ratio(edgeT, inT)) },
      faceVsOut: r2(ratio(inL, outL)),
    }
  }

  const expectBoundary = (name: string, m: Awaited<ReturnType<typeof boundary>>) => {
    for (const side of ['left', 'top'] as const) {
      expect(m[side].vsOut, `${name}: ${side} border vs the surface behind the button ≥ 3:1`).toBeGreaterThanOrEqual(3)
      expect(m[side].vsFace, `${name}: ${side} border vs the button face ≥ 3:1`).toBeGreaterThanOrEqual(3)
    }
  }

  const toggles = (page: Page) => page.locator('.sheet .sheet__row-sub > .btn[aria-pressed]')
  const rowOf = (btn: Locator) => btn.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " sheet__row ")][1]')

  async function openMore(page: Page) {
    await page.locator('.mob-more').click() // by class: the accessible name is localized
    await expect(page.locator('.sheet').first()).toBeVisible()
    await expect(toggles(page)).toHaveCount(2)
    await page.mouse.move(2, 2) // no hover anywhere on the sheet
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  }

  /** Tab until `btn` is the active element (the sheet traps focus, so this terminates) */
  async function tabTo(page: Page, btn: Locator) {
    for (let i = 0; i < 25; i++) {
      if (await btn.evaluate((el) => el === document.activeElement)) return
      await page.keyboard.press('Tab')
    }
    throw new Error('toggle never received keyboard focus')
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: both toggles keep a ≥ 3:1 boundary at rest, on a hovered row, hovered, pressed; text ≥ 4.5:1; focus ring + pressed text tell`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await loadDiagram(page)
      await openMore(page)
      const focusRing = await page.evaluate(() => {
        const d = document.createElement('div')
        d.style.color = 'var(--focus-ring)'
        document.body.append(d)
        const c = getComputedStyle(d).color
        d.remove()
        return c
      })
      for (const i of [0, 1]) {
        const btn = toggles(page).nth(i)
        const row = rowOf(btn)
        const name = `${scheme} toggle ${i}`
        await expect(btn).toHaveAttribute('aria-pressed', 'false')
        const offText = (await btn.textContent())!.trim()
        // text on the face
        const cs = await btn.evaluate((el) => {
          const c = getComputedStyle(el)
          return { color: c.color, bg: c.backgroundColor, border: c.borderTopColor, width: c.borderTopWidth, opacity: c.opacity }
        })
        expect(ratio(parseRgb(cs.color), parseRgb(cs.bg)), `${name}: label text vs face ≥ 4.5`).toBeGreaterThanOrEqual(4.5)
        expect(cs.width).toBe('1px')
        expect(cs.opacity).toBe('1')
        // 1. rest
        const rest = await boundary(page, btn)
        console.log(`[btn] ${name} rest: L ${rest.left.vsOut}/${rest.left.vsFace} T ${rest.top.vsOut}/${rest.top.vsFace} face-vs-out ${rest.faceVsOut}`)
        expectBoundary(`${name} rest`, rest)
        // 2. the ROW hovered (pointer on its label) — the surface behind the button turns sunken
        const rb = (await row.boundingBox())!
        await page.mouse.move(rb.x + 24, rb.y + rb.height / 2)
        await page.waitForTimeout(120)
        const rowHover = await boundary(page, btn)
        console.log(`[btn] ${name} row-hover: L ${rowHover.left.vsOut}/${rowHover.left.vsFace} T ${rowHover.top.vsOut}/${rowHover.top.vsFace}`)
        expect(dist(rowHover.left.out, rest.left.out), `${name}: the hovered row really changed the surface behind the button`).toBeGreaterThan(6)
        expectBoundary(`${name} row-hover`, rowHover)
        // 3. the BUTTON hovered
        await btn.hover()
        await page.waitForTimeout(120)
        const hover = await boundary(page, btn)
        console.log(`[btn] ${name} hover: L ${hover.left.vsOut}/${hover.left.vsFace} T ${hover.top.vsOut}/${hover.top.vsFace}`)
        expectBoundary(`${name} hover`, hover)
        expect(dist(hover.left.edge, rest.left.edge), `${name}: hover has its own (stronger) border colour`).toBeGreaterThan(6)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(120)
        // 4. keyboard focus: the global focus-visible ring, 2 px outside the border, in --focus-ring
        await tabTo(page, btn)
        const oc = await btn.evaluate((el) => {
          const c = getComputedStyle(el)
          return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor, offset: c.outlineOffset }
        })
        expect(oc.style).toBe('solid')
        expect(oc.width).toBe('2px')
        expect(oc.color).toBe(focusRing)
        const fb = (await btn.boundingBox())!
        const [ringPx, behind] = await rgbAt(page, await page.screenshot(), [
          { x: fb.x - 3, y: fb.y + fb.height / 2 },
          { x: fb.x - 8, y: fb.y + fb.height / 2 },
        ])
        expect(dist(ringPx, parseRgb(focusRing)), `${name}: the focus ring is painted in --focus-ring`).toBeLessThan(40)
        expect(ratio(ringPx, behind), `${name}: focus ring vs the row ≥ 3:1`).toBeGreaterThanOrEqual(3)
        // 5. pressed via the keyboard: the tell is the label (Off → On) + aria-pressed; the boundary stays ≥ 3:1
        await page.keyboard.press('Space')
        await expect(btn).toHaveAttribute('aria-pressed', 'true')
        const onText = (await btn.textContent())!.trim()
        expect(onText, `${name}: pressed state has a text tell`).not.toBe(offText)
        // drop the focus ring (blur) and the pointer so the pressed boundary is measured at rest
        await btn.evaluate((el) => (el as HTMLElement).blur())
        await page.mouse.move(2, 2)
        await page.waitForTimeout(120)
        const pressed = await boundary(page, btn)
        console.log(`[btn] ${name} pressed: L ${pressed.left.vsOut}/${pressed.left.vsFace} T ${pressed.top.vsOut}/${pressed.top.vsFace}`)
        expectBoundary(`${name} pressed`, pressed)
        // back to Off for the next toggle
        await toggles(page).nth(i).click()
        await expect(toggles(page).nth(i)).toHaveAttribute('aria-pressed', 'false')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(120)
      }
    })

    test(`${scheme}: More-sheet toggle rows — element baseline`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await loadDiagram(page)
      await openMore(page)
      const a = (await rowOf(toggles(page).nth(0)).boundingBox())!
      const b = (await rowOf(toggles(page).nth(1)).boundingBox())!
      const sheet = (await page.locator('.sheet').first().boundingBox())!
      const top = Math.min(a.y, b.y)
      const bottom = Math.max(a.y + a.height, b.y + b.height)
      const clip = { x: sheet.x, y: top - 2, width: sheet.width, height: bottom - top + 4 }
      await expect(page).toHaveScreenshot(...snap(page, `mobile-sheet-toggles-${scheme}`, { clip }))
    })
  }

  test.describe('forced colours', () => {
    test.use({ contextOptions: { forcedColors: 'active' } })
    test('the boundary is the system ButtonBorder (not our token) and stays ≥ 3:1; focus ring still solid', async ({ page }) => {
      await loadDiagram(page)
      await openMore(page)
      const sys = await page.evaluate(() => {
        const d = document.createElement('div')
        d.style.color = 'ButtonBorder'
        document.body.append(d)
        const c = getComputedStyle(d).color
        d.remove()
        return c
      })
      for (const i of [0, 1]) {
        const btn = toggles(page).nth(i)
        const border = await btn.evaluate((el) => getComputedStyle(el).borderTopColor)
        expect(border, `toggle ${i}: forced colours own the border`).toBe(sys)
        const m = await boundary(page, btn)
        console.log(`[btn] forced toggle ${i} rest: L ${m.left.vsOut}/${m.left.vsFace} T ${m.top.vsOut}/${m.top.vsFace}`)
        expectBoundary(`forced toggle ${i}`, m)
        await tabTo(page, btn)
        const oc = await btn.evaluate((el) => {
          const c = getComputedStyle(el)
          return { style: c.outlineStyle, width: c.outlineWidth }
        })
        expect(oc.style).toBe('solid')
        expect(oc.width).toBe('2px')
      }
    })
  })

  // The contract covers EVERY enabled `.btn` in a sheet, not only the two toggles: the Filters
  // sub-sheet's "Clear filters" is `disabled` while nothing is hidden (WCAG 1.4.11 exempts it; it
  // still takes the control border, faded by `.btn:disabled` opacity 0.4) and, once a filter is on,
  // an ordinary enabled button whose boundary must measure ≥ 3:1 too.
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: Filters sheet "Clear filters" — disabled while nothing is hidden, ≥ 3:1 boundary once enabled`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await loadDiagram(page)
      await openMore(page)
      await page.locator('.sheet .sheet__row', { hasText: 'Filters' }).first().click()
      const clear = page.locator('.sheet .lgr-filter__clear')
      await expect(clear).toBeDisabled()
      const off = await clear.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, border: getComputedStyle(el).borderTopColor }))
      expect(off.opacity).toBe('0.4')
      await page.locator('.sheet input[type=checkbox]').first().check()
      await expect(clear).toBeEnabled()
      await page.mouse.move(2, 2)
      await page.waitForTimeout(150)
      const on = await clear.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, border: getComputedStyle(el).borderTopColor }))
      expect(on.opacity).toBe('1')
      expect(on.border, 'the same control border as the toggles').toBe(off.border)
      const m = await boundary(page, clear)
      console.log(`[btn] ${scheme} clear-filters enabled: L ${m.left.vsOut}/${m.left.vsFace} T ${m.top.vsOut}/${m.top.vsFace}`)
      expectBoundary(`${scheme} clear-filters enabled`, m)
    })
  }

  test('EN / KO / JA at 390 and 320 px: the toggles stay inside their rows and the sheet, one line, no sideways scroll', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await loadDiagram(page)
      for (const code of ['en', 'ko', 'ja']) {
        await page.evaluate((c) => {
          const loop = (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (l: string) => void } } } }).__loop
          loop.i18n.getState().setLocale(c)
        }, code)
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
        if (!(await page.locator('.sheet').first().isVisible())) await openMore(page)
        await expect(toggles(page)).toHaveCount(2)
        for (const i of [0, 1]) {
          const btn = toggles(page).nth(i)
          const bb = (await btn.boundingBox())!
          const rb = (await rowOf(btn).boundingBox())!
          const sb = (await page.locator('.sheet').first().boundingBox())!
          expect(rectInside(bb, rb.x + rb.width, rb.y + rb.height) && bb.x >= rb.x - 1 && bb.y >= rb.y - 1, `${code}@${width} toggle ${i} inside its row`).toBe(true)
          expect(bb.x + bb.width, `${code}@${width} toggle ${i} inside the sheet`).toBeLessThanOrEqual(sb.x + sb.width + 1)
          expect(bb.height, `${code}@${width} toggle ${i} label on one line`).toBeLessThan(36)
        }
        await noHScroll(page)
        await page.keyboard.press('Escape')
        await expect(page.locator('.sheet').first()).toBeHidden()
      }
    }
  })
})

// docs/mobile.md §MV5 / WCAG 1.4.3 — a sheet row's secondary label keeps its
// 4.5:1 in the states that change the row's background. `.sheet__row:hover`
// and `.sheet__row:focus-visible` swap the row onto `--surface-sunken`, and in
// LIGHT that pulled `--text-tertiary` (#6c746e) from 4.61:1 on the panel down
// to 3.92:1 — measured on 2026-09-21 across all three sheets that use the
// class. Dark is unaffected (its sunken surface is DARKER than the panel, so
// the same token rises 6.46 → 8.03:1) and forced colours are owned by the UA
// (21:1, and the hover background is not applied at all). The hover rule is
// not gated by `(hover: hover)`, so a coarse pointer reaches it too: after a
// tap the row was measured still matching `:hover`.
//
// Disabled rows are the WCAG 1.4.3 exception and are deliberately left alone —
// both the native `:disabled` button and any future `[aria-disabled="true"]`
// row.
test.describe('sheet row secondary label contrast (§MV5 / WCAG 1.4.3)', () => {
  type Rgb = [number, number, number]
  const lum = ([r, g, b]: Rgb) => {
    const f = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a: Rgb, b: Rgb) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const parseRgb = (s: string): Rgb => {
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const r2 = (n: number) => Math.round(n * 100) / 100

  /** the sub-label's resolved colour and the first non-transparent backdrop
   *  above the row, read together with the state that produced them */
  const read = (row: Locator) =>
    row.evaluate((el) => {
      let n: Element | null = el
      let bg = 'rgb(255, 255, 255)'
      while (n) {
        // the first backdrop that actually PAINTS: forced colours leave
        // `rgba(255, 255, 255, 0)` on ancestors, which a name-based check
        // would wrongly accept as the background
        const c = getComputedStyle(n).backgroundColor
        const parts = c.match(/rgba?\(([^)]+)\)/)
        const alpha = parts ? Number((parts[1].split(',')[3] ?? '1').trim()) : 1
        if (c && c !== 'transparent' && alpha > 0) {
          bg = c
          break
        }
        n = n.parentElement
      }
      const sub = el.querySelector('.sheet__row-sub')
      return {
        sub: sub ? getComputedStyle(sub).color : null,
        subText: sub ? (sub.textContent ?? '') : '',
        bg,
        hovered: el.matches(':hover'),
        focusVisible: el.matches(':focus-visible'),
        nativeDisabled: (el as HTMLButtonElement).disabled === true,
        ariaDisabled: el.getAttribute('aria-disabled') === 'true',
        /** a sub that only wraps a control never paints in the sub colour */
        wrapsControl: !!el.querySelector('.sheet__row-sub button, .sheet__row-sub .btn'),
      }
    })

  const nameOf = (row: Locator) =>
    row.evaluate((el) => (el.childNodes[0]?.textContent ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24))

  async function openSheet(page: Page, which: 'More' | 'Templates' | 'Export') {
    await page.locator('.mob-more').click() // by class: the accessible name is localized
    const more = page.locator('.sheet[aria-label="More"]')
    await expect(more).toBeVisible()
    if (which !== 'More') {
      await more.locator('.sheet__row', { hasText: which }).click()
      await expect(page.locator(`.sheet[aria-label="${which}"]`)).toBeVisible()
    }
    await page.mouse.move(2, 2) // nothing hovered until a case asks for it
    return page.locator(`.sheet[aria-label="${which}"]`)
  }

  /** every row whose sub-label is really painted in the sub colour */
  async function textSubRows(page: Page, sheet: Locator) {
    const all = sheet.locator('.sheet__row').filter({ has: page.locator('.sheet__row-sub') })
    const out: Locator[] = []
    for (let i = 0; i < (await all.count()); i++) {
      const row = all.nth(i)
      if (!(await read(row)).wrapsControl) out.push(row)
    }
    return out
  }

  async function hover(page: Page, row: Locator) {
    await row.scrollIntoViewIfNeeded()
    const b = (await row.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  }

  /** Tab from the sheet's close button until `row` has focus. Returns false
   *  when the row is not in the tab ring at all (a disabled button). */
  async function tabToRow(page: Page, row: Locator) {
    await row.evaluate((el) => (el.closest('.sheet')!.querySelector('.sheet__x') as HTMLElement).focus())
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab')
      if (await row.evaluate((el) => el === document.activeElement)) return true
    }
    return false
  }

  const SHEETS = ['More', 'Templates', 'Export'] as const

  test('light: every enabled secondary label keeps ≥ 4.5:1 while its row is hovered, in all three sheets', async ({ page }) => {
    await loadDiagram(page)
    const bad: string[] = []
    let checked = 0
    for (const which of SHEETS) {
      const sheet = await openSheet(page, which)
      for (const row of await textSubRows(page, sheet)) {
        const name = await nameOf(row)
        await hover(page, row)
        const s = await read(row)
        expect(s.hovered, `${which}/${name}: the pointer did not reach the row`).toBe(true)
        if (s.nativeDisabled || s.ariaDisabled) continue
        checked++
        const r = ratio(parseRgb(s.sub!), parseRgb(s.bg))
        console.log(`[sub] ${which}/${name} hover ${s.sub} on ${s.bg} = ${r2(r)}:1`)
        if (r < 4.5) bad.push(`${which}/${name} ${r2(r)}:1`)
      }
      await page.keyboard.press('Escape')
    }
    expect(checked, 'the walk must reach every text sub-label: 5 More + 5 Templates + 4 enabled Export').toBe(14)
    expect(bad, 'hovered secondary labels below 4.5:1').toEqual([])
  })

  test('light: the same while focus-visible, including the ▸ submenu markers', async ({ page }) => {
    await loadDiagram(page)
    const bad: string[] = []
    const markers: string[] = []
    for (const which of SHEETS) {
      const sheet = await openSheet(page, which)
      for (const row of await textSubRows(page, sheet)) {
        const name = await nameOf(row)
        const pre = await read(row)
        if (pre.nativeDisabled || pre.ariaDisabled) continue
        const reached = await tabToRow(page, row)
        expect(reached, `${which}/${name}: an enabled row must be in the tab ring`).toBe(true)
        const s = await read(row)
        expect(s.focusVisible, `${which}/${name}: keyboard focus must be focus-visible`).toBe(true)
        const r = ratio(parseRgb(s.sub!), parseRgb(s.bg))
        console.log(`[sub] ${which}/${name} focus ${s.sub} on ${s.bg} = ${r2(r)}:1`)
        if (r < 4.5) bad.push(`${which}/${name} ${r2(r)}:1`)
        if (which === 'More' && s.subText.includes('▸')) markers.push(name)
      }
      await page.keyboard.press('Escape')
    }
    // the four submenu rows carry their affordance IN the sub-label, so they
    // are covered by the same contract rather than by the row's own text
    expect(markers.sort(), 'the ▸ markers are part of this contract').toEqual(['Export', 'Filters', 'Help', 'Templates'])
    expect(bad, 'focused secondary labels below 4.5:1').toEqual([])
  })

  test('what must not change: resting, native-disabled and aria-disabled rows, forced colours, a coarse pointer and dark', async ({ page }) => {
    await loadDiagram(page)
    const sheet = await openSheet(page, 'Export')
    const rows = sheet.locator('.sheet__row')

    // 1. resting is untouched — the panel behind a transparent row
    const first = rows.first()
    const rest = await read(first)
    expect(rest.hovered).toBe(false)
    const restRatio = ratio(parseRgb(rest.sub!), parseRgb(rest.bg))
    console.log(`[sub] resting ${rest.sub} on ${rest.bg} = ${r2(restRatio)}:1`)
    expect(restRatio, 'the resting secondary label is unchanged and already passes').toBeGreaterThanOrEqual(4.5)
    const restingColour = rest.sub

    // 2. a natively disabled row keeps the resting colour even when hovered —
    //    WCAG 1.4.3 exempts it and the sheet gives it no other treatment
    const disabled = sheet.locator('.sheet__row[disabled]')
    await expect(disabled).toHaveCount(1)
    await hover(page, disabled)
    const dis = await read(disabled)
    expect(dis.nativeDisabled).toBe(true)
    expect(dis.hovered, 'a disabled button still matches :hover').toBe(true)
    expect(dis.sub, 'a disabled row is not lifted').toBe(restingColour)

    // 3. the same for a row marked disabled through ARIA
    await first.evaluate((el) => el.setAttribute('aria-disabled', 'true'))
    await page.mouse.move(2, 2)
    await hover(page, first)
    const ar = await read(first)
    expect(ar.ariaDisabled).toBe(true)
    expect(ar.hovered).toBe(true)
    expect(ar.sub, 'an aria-disabled row is not lifted either').toBe(restingColour)
    await first.evaluate((el) => el.removeAttribute('aria-disabled'))


    // 4. forced colours: the UA owns the row, so our rule must be inert —
    //    every state resolves to the same system colour it did at rest, for
    //    the enabled rows and for the disabled one, and the contrast the
    //    system provides is kept
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' })
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
    await page.mouse.move(2, 2)
    const fcEnabledRest = await read(first)
    await hover(page, first)
    const fcEnabledHover = await read(first)
    expect(fcEnabledHover.hovered).toBe(true)
    expect(fcEnabledHover.sub, 'forced colours: an enabled row is untouched by our rule').toBe(fcEnabledRest.sub)
    await page.mouse.move(2, 2)
    const fcDisRest = await read(disabled)
    await hover(page, disabled)
    const fcDisHover = await read(disabled)
    expect(fcDisHover.hovered).toBe(true)
    expect(fcDisHover.sub, 'forced colours: a disabled row is untouched too').toBe(fcDisRest.sub)
    // the system's own colours, and the contrast they carry, are preserved
    const sys = await page.evaluate(() => {
      const probe = (c: string) => {
        const d = document.createElement('div')
        d.style.color = c
        document.body.append(d)
        const v = getComputedStyle(d).color
        d.remove()
        return v
      }
      return { canvasText: probe('CanvasText'), grayText: probe('GrayText') }
    })
    expect(fcEnabledRest.sub, 'forced colours: an enabled sub is the system text colour').toBe(sys.canvasText)
    for (const [name, s] of [
      ['enabled rest', fcEnabledRest],
      ['enabled hover', fcEnabledHover],
      ['disabled rest', fcDisRest],
      ['disabled hover', fcDisHover],
    ] as const) {
      const r = ratio(parseRgb(s.sub!), parseRgb(s.bg))
      console.log(`[sub] forced ${name} ${s.sub} on ${s.bg} = ${r2(r)}:1`)
      expect(r, `forced colours: ${name} keeps the system contrast`).toBeGreaterThanOrEqual(4.5)
    }
    expect(sys.grayText, 'GrayText resolves to something of its own').not.toBe(sys.canvasText)
    await page.emulateMedia({ forcedColors: 'none' })

    // 5. a coarse pointer: this whole project runs `isMobile` + `hasTouch`, so
    //    every ratio above was measured with `(hover: none)` / `(pointer:
    //    coarse)` — and the hover rule is NOT gated behind a fine pointer, so
    //    a tap can LEAVE a row hovered. In that residual state the enabled row
    //    must still be corrected and the disabled ones must still be exempt.
    const media = await page.evaluate(() => ({
      hover: matchMedia('(hover: none)').matches,
      coarse: matchMedia('(pointer: coarse)').matches,
    }))
    expect(media, 'these are coarse-pointer measurements').toEqual({ hover: true, coarse: true })
    await page.mouse.move(2, 2)
    const db = (await disabled.boundingBox())!
    await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2) // a disabled button runs nothing
    const tapped = await read(disabled)
    expect(tapped.hovered, 'hover survives a tap on a coarse pointer').toBe(true)
    expect(tapped.sub, 'residual hover does not lift a native-disabled row').toBe(restingColour)
    await disabled.evaluate((el) => el.setAttribute('aria-disabled', 'true'))
    const tappedAria = await read(disabled)
    expect(tappedAria.ariaDisabled).toBe(true)
    expect(tappedAria.hovered).toBe(true)
    expect(tappedAria.sub, 'residual hover does not lift an aria-disabled row either').toBe(restingColour)
    await disabled.evaluate((el) => el.removeAttribute('aria-disabled'))
    // the enabled row, reached by the same coarse pointer, IS corrected
    await hover(page, first)
    const coarseEnabled = await read(first)
    expect(coarseEnabled.hovered).toBe(true)
    const cr = ratio(parseRgb(coarseEnabled.sub!), parseRgb(coarseEnabled.bg))
    console.log(`[sub] coarse enabled hover ${coarseEnabled.sub} on ${coarseEnabled.bg} = ${r2(cr)}:1`)
    expect(cr, 'a coarse pointer gets the corrected label').toBeGreaterThanOrEqual(4.5)

    // 6. dark never had the problem: its sunken surface is darker than the
    //    panel, so hovering RAISES the ratio
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.mouse.move(2, 2)
    const darkRest = await read(first)
    await hover(page, first)
    const darkHover = await read(first)
    const dr = ratio(parseRgb(darkRest.sub!), parseRgb(darkRest.bg))
    const dh = ratio(parseRgb(darkHover.sub!), parseRgb(darkHover.bg))
    console.log(`[sub] dark rest ${r2(dr)}:1 → hover ${r2(dh)}:1`)
    expect(dr).toBeGreaterThanOrEqual(4.5)
    expect(dh).toBeGreaterThanOrEqual(4.5)
    expect(dh, 'dark hover is not a regression of dark rest').toBeGreaterThan(dr)
  })
})
