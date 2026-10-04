import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'
import { capturedExports, installProbe, pathProbe } from './support/mc'
import { expectOneVersionStory, readAboutVersion, readNewestShown } from './support/whatsNew'
import { RELEASE_NOTES } from '../src/releaseNotes/releaseNotes'

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

    // 0 — the build stamp is injected and rendered -- the toolbar redesign
    // removed the visible `.toolbar__build` stamp; it now lives only in the
    // brand row's own title/aria-label tooltip (docs/toolbar-responsive.md)
    const buildTitle = await page.locator('.toolbar__brand').getAttribute('title')
    expect(buildTitle).toMatch(/v\d+\.\d+\.\d+(-[a-z]+)?( · build [0-9a-f]{7})?$/)

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
    await page.locator('.toolbar__actions .menu > button', { hasText: 'File' }).click()
    await page
      .locator('.toolbar__actions .menu__pop')
      .getByRole('menuitem', { name: 'Graph JSON' })
      .click()
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

  test('the "Early MMO progression" Template loads its bundled graph + recommended MC config', async ({ page }) => {
    const { bad } = await openProd(page)

    // Templates ▾ is the first `.menu` in the toolbar actions
    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page
      .locator('.toolbar__actions .menu')
      .first()
      .locator('.menu__pop [role="menuitem"]', { hasText: 'Early MMO progression' })
      .click()
    const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
    if (await confirm.isVisible().catch(() => false)) await confirm.click()

    // the canonical examples/mmo-progression.json is 97 nodes
    await expect(page.locator('.react-flow__node')).toHaveCount(97)

    // the file's recommendedRunConfig pre-fills the Monte-Carlo dialog
    await page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
    const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
    await expect(dlg).toBeVisible()
    const nums = dlg.locator('.mcdlg__field input[type="number"]')
    await expect(nums.nth(0)).toHaveValue('200')
    await expect(nums.nth(1)).toHaveValue('150')
    await expect(nums.nth(2)).toHaveValue('1')
    await expect(dlg.locator('.mcdlg__foot .btn--primary')).toHaveText('Run 200 runs')
    await page.keyboard.press('Escape')

    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  test('the language switch offers exactly the shipped locales — the dev pseudo-locale never reaches Production', async ({
    page,
  }) => {
    const { bad } = await openProd(page)

    await page.locator('.toolbar__actions .menu > button', { hasText: /^Settings$/ }).click()
    await page.locator('.toolbar .lang-switch').click()
    const opts = page.locator('.lang-menu__pop [role="option"]')
    // ar, en, ko, ja, zh-Hans, zh-Hant, fr, de, it, es-419, pt-BR, es-ES, pt-PT,
    // ru, tr, th, vi, nl — NO en-XA
    await expect(opts).toHaveCount(18)
    await expect(page.locator('.lang-menu__pop [data-locale="en-XA"]')).toHaveCount(0)
    // §L5.6 — in PRODUCTION the picker shows exactly the shipped locales, in
    // English-name order, with no pseudo-locale to append. Asserted unsorted
    // here on purpose: the DOM order is the contract.
    expect(await opts.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))).toEqual([
      'ar',
      'zh-Hans',
      'zh-Hant',
      'nl',
      'en',
      'fr',
      'de',
      'it',
      'ja',
      'ko',
      'pt-BR',
      'pt-PT',
      'ru',
      'es-419',
      'es-ES',
      'th',
      'tr',
      'vi',
    ])
    const codes = await opts.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.locale).sort(),
    )
    expect(codes).toEqual([
      'ar',
      'de',
      'en',
      'es-419',
      'es-ES',
      'fr',
      'it',
      'ja',
      'ko',
      'nl',
      'pt-BR',
      'pt-PT',
      'ru',
      'th',
      'tr',
      'vi',
      'zh-Hans',
      'zh-Hant',
    ])
    // §L5.4 — eighteen shipped languages, so the search box is shown (it first
    // reached PRODUCTION at six), and the dev pseudo-locale is still absent.
    await expect(page.locator('.lang-menu__pop input[role="combobox"]')).toHaveCount(1)

    // pick JA, reload — it persists, and still only the three are offered
    await page.locator('.lang-menu__item[data-locale="ja"]').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja')
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja')

    // a hand-planted 'en-XA' in storage is not a registered code in Production —
    // the resolver ignores it and falls back rather than selecting it
    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'en-XA'))
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.lang)).not.toBe('en-XA')

    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  test('a bulk locale switch on the MMO Template keeps edge endpoints aligned with their real handle positions (no window.__loop)', async ({
    page,
  }) => {
    // Confirms src/components/nodes/nodes.tsx's reliance on React Flow's own
    // internal per-node ResizeObserver (docs: the template-label-overlay
    // investigation, 2026-09-16) holds in the ACTUAL shipped bundle, not only
    // under the dev server's React StrictMode. Pure DOM/UI — no window.__loop
    // (tree-shaken out of production) — so node/edge identity is read off
    // data-id / aria-label rather than the graph store.
    const { bad } = await openProd(page)

    // Pin the starting locale explicitly rather than assuming the fresh
    // context's default (navigator.language) — a real, current-locale check
    // (html lang + a representative label), not an assumption. The Settings
    // trigger's own label is itself locale-dependent, so match all three
    // shipped-language spellings (same pattern as e2e/i18n.spec.ts's
    // openSettings), not just the English one.
    const settingsBtn = page.locator('.toolbar__actions .menu > button', { hasText: /^(Settings|설정|設定)$/ })
    await settingsBtn.click()
    await page.locator('.toolbar .lang-switch').click()
    await page.locator('.lang-menu__item[data-locale="ko"]').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')

    await page.locator('.toolbar__actions .menu').first().locator('> button').click()
    await page
      .locator('.toolbar__actions .menu')
      .first()
      .locator('.menu__pop [role="menuitem"]', { hasText: '초반 MMO 성장' })
      .click()
    // locale-independent: the confirm dialog's primary action button by
    // class, not by text (the label is Korean here, since locale is 'ko')
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(97)
    await page.evaluate(() => document.fonts.ready)
    // representative Korean node label, confirming the KO Template actually loaded
    await expect(page.locator('.react-flow__node', { hasText: '레벨' }).first()).toBeVisible()

    async function snapshot() {
      return page.evaluate(() => {
        const nodes: Record<string, { nfH: number }> = {}
        for (const wrap of document.querySelectorAll('.react-flow__node')) {
          const id = (wrap as HTMLElement).dataset.id!
          const nf = wrap.querySelector('.nodef') as HTMLElement | null
          if (nf) nodes[id] = { nfH: nf.offsetHeight }
        }
        const handleCenter = (nodeId: string, handleId: string) => {
          const h = document.querySelector(
            `.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`,
          )
          if (!h) return null
          const r = h.getBoundingClientRect()
          return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
        }
        const toScreen = (path: SVGPathElement, x: number, y: number) => {
          const svg = path.ownerSVGElement
          const ctm = path.getScreenCTM()
          if (!svg || !ctm) return null
          const pt = svg.createSVGPoint()
          pt.x = x
          pt.y = y
          const s = pt.matrixTransform(ctm)
          return { x: s.x, y: s.y }
        }
        const edges: Record<
          string,
          { source: string; target: string; sourceHandleScreen: { x: number; y: number } | null; targetHandleScreen: { x: number; y: number } | null; startScreen: { x: number; y: number } | null; endScreen: { x: number; y: number } | null }
        > = {}
        for (const g of document.querySelectorAll('.react-flow__edge')) {
          const id = (g as HTMLElement).dataset.id!
          // "Edge from <source> to <target>" -- LoopEdge sets no custom
          // ariaLabel, so React Flow's own default (index.js EdgeWrapper) is
          // the only DOM-visible way to recover source/target ids without
          // window.__loop.
          const m = /^Edge from (.+) to (.+)$/.exec(g.getAttribute('aria-label') ?? '')
          if (!m) continue
          const [, source, target] = m
          const p = g.querySelector('path.react-flow__edge-path') as SVGPathElement | null
          // state edges are dashed (LoopEdge.tsx); resource edges are solid —
          // the only DOM-visible way to tell which handle PAIR ('in'/'out' vs
          // 'state-target'/'state-source') an edge uses without window.__loop.
          const isState = p ? getComputedStyle(p).strokeDasharray !== 'none' : false
          const sourceHandle = isState ? 'state-source' : 'out'
          const targetHandle = isState ? 'state-target' : 'in'
          let startScreen = null
          let endScreen = null
          if (p) {
            try {
              const len = p.getTotalLength()
              const start = p.getPointAtLength(0)
              const end = p.getPointAtLength(len)
              startScreen = toScreen(p, start.x, start.y)
              endScreen = toScreen(p, end.x, end.y)
            } catch {
              /* zero-length / detached path -- left null */
            }
          }
          edges[id] = {
            source,
            target,
            sourceHandleScreen: handleCenter(source, sourceHandle),
            targetHandleScreen: handleCenter(target, targetHandle),
            startScreen,
            endScreen,
          }
        }
        return { nodes, edges }
      })
    }
    type Pt = { x: number; y: number }
    const delta = (a: Pt | null, b: Pt | null) => (a && b ? { x: b.x - a.x, y: b.y - a.y } : null)
    const dist = (a: Pt | null, b: Pt | null) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null)
    const TOLERANCE_PX = 3
    // A resized node doesn't guarantee its handle on this edge's side moved
    // (e.g. Position.Top's x only depends on width, fixed at 120px here) —
    // two unmoved (zero-delta) positions would otherwise "agree" trivially
    // without proving anything was actually re-measured.
    const HANDLE_MOVE_EPSILON_PX = 0.5

    const before = await snapshot()

    // switch to a genuinely different, explicitly-verified locale (KO → EN),
    // not an assumed starting state — otherwise a locale switch that silently
    // did nothing could still let the geometry checks below pass vacuously.
    // Settings is now showing its KOREAN label, so reuse the same
    // locale-independent matcher, not the English-only one.
    await settingsBtn.click()
    await page.locator('.toolbar .lang-switch').click()
    await page.locator('.lang-menu__item[data-locale="en"]').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en')
    await expect(page.locator('.react-flow__node', { hasText: 'Level' }).first()).toBeVisible()

    // the switch must have actually changed at least one node's real height —
    // otherwise the edge-alignment checks below would trivially pass with
    // nothing to compare (a false positive this test exists to prevent)
    const afterHeights = await snapshot()
    const anyResized = Object.entries(afterHeights.nodes).some(
      ([id, n]) => before.nodes[id] != null && Math.abs(before.nodes[id].nfH - n.nfH) > 1,
    )
    expect(anyResized, 'expected the KO → EN switch to actually change at least one node height').toBe(true)

    async function fullySettled() {
      const snap = await snapshot()
      // Proves genuine movement was observed and tracked, not merely that
      // some node's height changed — a node can resize without moving every
      // one of its handles (see HANDLE_MOVE_EPSILON_PX above).
      let anyHandleMoved = false
      for (const [id, e] of Object.entries(snap.edges)) {
        const beforeH = before.nodes[e.source]?.nfH
        const afterH = snap.nodes[e.source]?.nfH
        const targetBeforeH = before.nodes[e.target]?.nfH
        const targetAfterH = snap.nodes[e.target]?.nfH
        const sourceResized = beforeH != null && afterH != null && Math.abs(beforeH - afterH) > 1
        const targetResized = targetBeforeH != null && targetAfterH != null && Math.abs(targetBeforeH - targetAfterH) > 1
        if (!sourceResized && !targetResized) continue
        const be = before.edges[id]
        if (sourceResized) {
          const handleMoved = delta(be.sourceHandleScreen, e.sourceHandleScreen)
          const handleMoveDist = handleMoved ? Math.hypot(handleMoved.x, handleMoved.y) : null
          if (handleMoveDist != null && handleMoveDist > HANDLE_MOVE_EPSILON_PX) anyHandleMoved = true
          const d = dist(delta(be.startScreen, e.startScreen), handleMoved)
          if (d == null || d > TOLERANCE_PX) return false
        }
        if (targetResized) {
          const handleMoved = delta(be.targetHandleScreen, e.targetHandleScreen)
          const handleMoveDist = handleMoved ? Math.hypot(handleMoved.x, handleMoved.y) : null
          if (handleMoveDist != null && handleMoveDist > HANDLE_MOVE_EPSILON_PX) anyHandleMoved = true
          const d = dist(delta(be.endScreen, e.endScreen), handleMoved)
          if (d == null || d > TOLERANCE_PX) return false
        }
      }
      return anyHandleMoved
    }
    await expect.poll(fullySettled, { timeout: 5000, intervals: [50] }).toBe(true)

    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })
})

// ── the release version, as the PRODUCTION build actually shows it ──────────
//
// `package.json` is the single source of truth: `vite.config.ts` reads it into
// `__APP_VERSION__`, which reaches four places — the About dialog, the mobile
// More menu, the toolbar build title, and `meta.tool` inside every exported
// Project revision. Nothing was checking that the number a release bumps is
// the number a user sees, and a stale display would look exactly like a
// correct one.
//
// The expected value is READ FROM `package.json` at test time and never
// written here: hard-coding `0.13.0` would make this pass by restating the
// bump instead of verifying it.
test.describe('production build — the version the release bumped', () => {
  const PKG_VERSION: string = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
  ).version

  test('the build title, the About dialog and an exported revision all carry the package version', async ({
    page,
  }) => {
    // the expectation itself must be a real version, not an empty string that
    // would make every assertion below trivially true
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+$/)

    const { bad } = await openProd(page)
    await installProbe(page)

    // 1 — the toolbar build title: `Loop Studio v<version> · Build <sha>`
    const title = await page
      .locator('.toolbar__brand, .toolbar [title]')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).getAttribute('title') ?? '').find((t) => /Loop Studio v/.test(t)),
      )
    expect(title, 'the toolbar exposes a build title').toBeTruthy()
    expect(title).toContain(`v${PKG_VERSION}`)

    // 2 — the About dialog shows the same number
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem').filter({ hasText: 'About Loop Studio' }).click()
    const about = page.locator('.mcdlg--about')
    await expect(about).toBeVisible()
    await expect(about).toContainText(`v${PKG_VERSION}`)
    await page.keyboard.press('Escape')

    // 3 — `meta.tool` in an exported Project revision. This one is not cosmetic:
    // it is written INTO a file a user keeps and sends to someone else.
    await page.locator('.toolbar__actions .menu > button', { hasText: 'File' }).click()
    await page
      .locator('.toolbar__actions .menu__pop')
      .getByRole('menuitem', { name: 'Project revision' })
      .click()
    const confirm = page.locator('.mcdlg .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()

    await expect
      .poll(async () => (await capturedExports(page)).some((e) => e.name.endsWith('.json')))
      .toBe(true)
    const revFile = (await capturedExports(page)).findLast((e) => e.name.endsWith('.json'))
    expect(revFile, 'a Project revision was exported').toBeTruthy()
    const doc = JSON.parse(revFile!.text) as { project?: { meta?: { tool?: string } } }
    expect(doc.project?.meta?.tool).toBe(`loop-studio/${PKG_VERSION}`)

    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })
})

// ── issue #296 — the release notes, as the PRODUCTION build carries them ────
//
// The notes are data inside the bundle. These read them through the real
// screen of the real build, where there is no dev bridge to ask.
test.describe('production build — release notes', () => {
  const ITEMS = RELEASE_NOTES.reduce((n, r) => n + r.items.length, 0)

  test('What’s new lists every bundled entry, newest first, and fetches nothing', async ({ page }) => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0)
    const { bad } = await openProd(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.locator('[data-whatsnew="menu-item"]').click()
    const panel = page.locator('[data-whatsnew="panel"]')
    await expect(panel).toBeVisible()
    const versions = await panel.locator('.whatsnew__version').evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? ''))
    expect(versions).toEqual(RELEASE_NOTES.map((n) => 'v' + n.version))
    const items = await panel.locator('li').allTextContents()
    expect(items).toHaveLength(ITEMS)
    for (const text of items) expect(text).not.toMatch(/whatsNew\.|text unavailable|\{/)
    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  // the version About shows and the release What's new starts at are two
  // screens of one build (the rule is in e2e/support/whatsNew.ts)
  test('About and What’s new tell one version story', async ({ page }) => {
    await openProd(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    const about = await readAboutVersion(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.mcdlg')).toHaveCount(0)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.locator('[data-whatsnew="menu-item"]').click()
    await expect(page.locator('[data-whatsnew="panel"]')).toBeVisible()
    expectOneVersionStory(about.version, await readNewestShown(page))
  })

  test.describe('a returning profile that has not been told', () => {
    // the shared fixture still pre-dismisses the tour, which is what makes the
    // profile a returning one; only the "already seen" record is left out
    test.use({ whatsNewSeen: false })

    test('sees the notice for the newest entry once, and not again after a reload', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('.canvas .react-flow')).toBeVisible()
      const notice = page.locator('[data-whatsnew="notice"]')
      await expect(notice).toBeVisible()
      await expect(notice.locator('p')).toContainText(RELEASE_NOTES[0]!.version)
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('loop-studio/whats-new/announced/1')))
        .toBe(RELEASE_NOTES[0]!.id)
      await page.reload()
      await expect(page.locator('.canvas .react-flow')).toBeVisible()
      await expect(page.locator('.react-flow__node').first()).toBeVisible()
      await expect(notice).toHaveCount(0)
    })
  })
})

// ── issue #302 — the stored theme, before the first paint of the PRODUCTION build
//
// The boot script is inlined into <head> by the build, so this is where it is
// really checked: the dev server inlines it too, but the bundle, its size and
// the order of the head are the build's. The frames come from the browser's
// own screencast, from the new document's first paint on.
test.describe('production build — the stored theme is on before the first paint', () => {
  const seedTheme = (page: Page, stored: string) =>
    page.addInitScript((v) => {
      try {
        if (!sessionStorage.getItem('__theme_seeded')) {
          sessionStorage.setItem('__theme_seeded', '1')
          localStorage.setItem('loop-studio:theme', v)
        }
      } catch {
        /* ignore */
      }
      const w = window as unknown as { __firstFrameTheme?: string | null }
      requestAnimationFrame(() => {
        w.__firstFrameTheme = document.documentElement.getAttribute('data-theme')
      })
    }, stored)

  for (const [name, width, height] of [
    ['desktop', 1280, 800],
    ['mobile', 390, 844],
  ] as const) {
    test(`${name}: dark is on at the first frame, and the boot script is in the head once`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await seedTheme(page, 'dark')
      const { bad } = await openProd(page)
      expect(await page.evaluate(() => (window as unknown as { __firstFrameTheme?: string | null }).__firstFrameTheme)).toBe('dark')
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
      const boot = await page.evaluate(() => [...document.querySelectorAll('script[data-storage-boot]')].map((s) => ({ inHead: !!s.closest('head'), type: s.getAttribute('type'), text: s.textContent ?? '' })))
      expect(boot).toHaveLength(1)
      expect(boot[0]).toMatchObject({ inHead: true, type: null })
      expect(boot[0]!.text).toContain("localStorage.getItem('loop-studio:theme')")
      expect(bad, 'no failed or cross-origin requests').toEqual([])
    })
  }

  test('mobile, dark stored, a slow network: no light or blank frame is painted', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await seedTheme(page, 'dark')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024 })
    const frames: { at: number; data: string }[] = []
    cdp.on('Page.screencastFrame', (f) => {
      frames.push({ at: f.metadata.timestamp ?? 0, data: f.data })
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await cdp.send('Page.enable')
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 400, maxHeight: 400 })
    await page.goto('/')
    await expect(page.locator('.canvas .react-flow')).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(600)
    await cdp.send('Page.stopScreencast').catch(() => {})
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const firstPaintEpoch = await page.evaluate(() => {
      const p = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint')
      return p ? (performance.timeOrigin + p.startTime) / 1000 : null
    })
    expect(firstPaintEpoch).not.toBeNull()
    const own = frames.filter((f) => f.at >= firstPaintEpoch! - 0.02)
    expect(own.length).toBeGreaterThan(0)
    const kinds: string[] = []
    for (const { data } of own) {
      const lum = await page.evaluate(async (src) => {
        const img = new Image()
        await new Promise((ok, bad) => {
          img.onload = ok
          img.onerror = bad
          img.src = src
        })
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const pts: number[] = []
        for (const fx of [0.1, 0.5, 0.9])
          for (const fy of [0.15, 0.5, 0.85]) {
            const [r, g, b] = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
            pts.push(0.2126 * r! + 0.7152 * g! + 0.0722 * b!)
          }
        return pts.reduce((a, b) => a + b, 0) / pts.length
      }, 'data:image/png;base64,' + data)
      kinds.push(lum >= 254 ? 'blank' : lum > 140 ? 'light' : lum < 90 ? 'dark' : 'mixed')
    }
    expect(kinds.filter((k) => k === 'light' || k === 'blank'), `frames: ${kinds.join(',')}`).toEqual([])
    expect(kinds.filter((k) => k === 'dark').length).toBeGreaterThan(0)
  })
})

// issue #300 - a protected share link in the PRODUCTION bundle: no dev bridge,
// the minified sealed transport, the lazy app chunk
test.describe('production build: a password-protected share link', () => {
  test('is created and opened; a wrong password loads nothing; no request leaves the origin', async ({ page, context }) => {
    const password = 'dist e2e password 19' // never a real one
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
    })
    const { bad } = await openProd(page)
    await page.locator('.toolbar__palette .chip--drain').click()
    const nodes = await page.locator('.react-flow__node').count()
    await page.locator('.toolbar__actions button', { hasText: /^Share$/ }).click()
    const dlg = page.locator('.mcdlg--share[data-share-create]')
    await dlg.locator('[data-share-protect="option"]').check()
    await dlg.locator('[data-share-protect="password"]').fill(password)
    await dlg.locator('[data-share-protect="confirm"]').fill(password)
    await dlg.getByRole('button', { name: 'Create link' }).click()
    const url = await page.locator('.share-pop__url').inputValue()
    expect(url).toMatch(/^https:\/\/cozy-loop-studio\.pages\.dev\/#p1=[A-Za-z0-9_-]+$/)

    // one more node after the link was made: what this browser stores now differs
    // from what the link carries, so the count at the end can only come from the link
    await page.keyboard.press('Escape')
    await page.locator('.toolbar__palette .chip--drain').click()
    await page.waitForFunction(
      (n) => (JSON.parse(localStorage.getItem('loop-studio:graph:v1') ?? '{}').nodes ?? []).length === n,
      nodes + 1,
    )

    const p2 = await context.newPage()
    const warnings: string[] = []
    p2.on('console', (m) => {
      if (m.type() === 'warning' && m.text().startsWith('Loop Studio:')) warnings.push(m.text())
    })
    p2.on('dialog', (d) => void d.accept()) // the stored diagram is not the untouched sample
    await p2.goto(`/#p1=${url.split('#p1=')[1]}`)
    const prompt = p2.locator('[data-protected-open="prompt"]')
    await expect(prompt).toBeVisible()
    await expect(p2.locator('.react-flow__node')).toHaveCount(nodes + 1)
    expect(await p2.evaluate(() => location.hash)).toBe('')
    await prompt.locator('[data-protected-open="password"]').fill('not the password')
    await prompt.getByRole('button', { name: 'Open' }).click()
    await expect(prompt.locator('[data-protected-open="error"]')).toBeVisible()
    expect(warnings).toEqual(['Loop Studio: a protected share link was not opened; the password is wrong or the link is damaged.'])
    await prompt.locator('[data-protected-open="password"]').fill(password)
    await prompt.getByRole('button', { name: 'Open' }).click()
    await expect(prompt).toHaveCount(0)
    await expect(p2.locator('.react-flow__node')).toHaveCount(nodes)
    expect(bad).toEqual([])
  })
})
