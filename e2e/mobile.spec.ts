import type { Page } from '@playwright/test'
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
  test,
} from './support/loop'

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

/** document does not scroll sideways */
async function noHScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  expect(over, 'no horizontal document overflow').toBeLessThanOrEqual(0)
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
    await expect(page.locator('.pstrip__step')).toContainText('step 1')

    await bar.getByRole('button', { name: /Play/ }).click()
    await expect(bar.getByRole('button', { name: /Pause/ })).toBeVisible()
    await bar.getByRole('button', { name: /Pause/ }).click()

    await bar.getByRole('button', { name: 'Reset to step 0' }).click()
    await expect(page.locator('.pstrip__step')).toContainText('step 0')
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
    page.on('dialog', (d) => void d.accept()) // the one-time disclosure
    await more(page).click()
    await sheet(page, 'More').locator('.sheet__row', { hasText: 'Share link' }).click()
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
    await node.click()
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

    // 4 / 5 — double-click + right-click (context menu)
    await node.dblclick()
    await node.click({ button: 'right' })
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

  test('tapping a node opens a read-only Inspector sheet; Close and empty-canvas tap dismiss it', async ({ page }) => {
    await loadDiagram(page)
    const inspector = page.locator('.sheet[aria-label="Inspector — read only"]')
    const node = page.locator('.react-flow__node').first()

    await node.click()
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

    await node.click()
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

  test('Import from the More menu confirms before replacing; cancel keeps the graph, accept swaps it', async ({ page }) => {
    await loadDiagram(page)
    const before = await graphContent(page)
    const fixture = readFixture()
    const fileInput = page.locator('.toolbar--mobile input[type="file"]')

    // cancel
    page.once('dialog', (d) => {
      expect(d.message()).toMatch(/replace/i)
      return void d.dismiss()
    })
    await fileInput.setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(fixture) })
    await page.waitForTimeout(150)
    expect(await graphContent(page), 'cancel keeps the graph').toBe(before)

    // accept
    page.once('dialog', (d) => void d.accept())
    await fileInput.setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(fixture) })
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
    // a genuine first-boot session: no saved graph ⇒ graphStore.pristineSample
    await page.addInitScript(() => {
      try {
        localStorage.clear()
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

    let confirmed = false
    page.on('dialog', (d) => {
      confirmed = true
      return void d.dismiss()
    })

    await openTemplatesSheet(page)
    await page.locator('.sheet[aria-label="Templates"] .sheet__row').first().click()

    await expect(page.locator('.sheet[aria-label="Templates"]')).toBeHidden()
    expect(confirmed, 'no confirm on the pristine sample').toBe(false)
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
    page.once('dialog', (d) => {
      expect(d.message()).toMatch(/replace/i)
      return void d.dismiss()
    })
    await templates.locator('.sheet__row').first().click()
    await page.waitForTimeout(150)
    expect(await graphContent(page), 'cancel keeps the graph').toBe(before)
    expect(await stepIndex(page)).toBe(0)
    expect(await simRev(page), 'cancel does not bump').toBe(revBefore)
    await expect(templates).toBeVisible()

    // accept — replaced with exactly one bump, the sheet closes, focus to More
    page.once('dialog', (d) => void d.accept())
    await templates.locator('.sheet__row').first().click()
    await expect(templates).toBeHidden()
    await expect(more(page)).toBeFocused()
    await expect.poll(() => graphContent(page)).not.toBe(before)
    expect(await simRev(page), 'exactly one simulationRev bump').toBe(revBefore + 1)
  })

  test('pristine first boot shows the "Open a file" card (no account sync); its button opens the picker; it clears once a file loads', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear()
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
    page.once('dialog', (d) => void d.accept())
    await fileInput.setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(readFixture()) })
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
    page.once('dialog', (d) => void d.accept())
    await fileInput.setInputFiles({ name: 'w.json', mimeType: 'application/json', buffer: Buffer.from(wsText) })
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
})
