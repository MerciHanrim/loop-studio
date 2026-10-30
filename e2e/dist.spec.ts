import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test, waitForAppReady } from './support/loop'
import { capturedExports, installProbe, pathProbe } from './support/mc'
import { expectAboutIsPackageVersion, readAboutVersion } from './support/appVersion'
import { PARALLEL_GAP } from '../src/components/edges/orthogonalRoute'
import { edgePortKind, faceOf, rfHandleId, type PortEnd } from '../src/model/ports'
import type { LoopEdge } from '../src/model/types'
import { expectShownNoticesAre, manifestNoticesSha, openAbout, openLicences, sha256 } from './support/licenses'
import { openFileSubmenu, openMonteCarloDialog } from './support/workbenchMenus'

// Runs under playwright.dist.config.ts: production `npm run build` served by
// `vite preview` at the root `/` — the shape Cloudflare Pages serves. No
// window.__loop bridge (prod), so everything is DOM-driven, like the portable
// spec. `vite preview` on localhost is a secure context, so the Monte-Carlo
// Worker path is active here (unlike the portable file:// build).

const RF = 'examples/risky-factory.json'
const ORIGIN = 'http://localhost:4173' // playwright.dist.config.ts baseURL

/** issue #344 §ER14.5 — the DOM side of the route settle contract, for a build
 *  without the dev bridge: two frames (a change that just landed has rendered
 *  and started its generation), then the canvas is no longer aria-busy and
 *  every connection has its path */
async function domRoutesSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  await page.waitForFunction(() => {
    if (document.querySelector('.canvas[aria-busy="true"]')) return false
    const paths = [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')]
    return paths.length > 0 && paths.every((p) => (p.getAttribute('d') ?? '').length > 0)
  })
}

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
  await waitForAppReady(page)
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  expect(await page.evaluate(() => Boolean((window as any).__loop)), 'no dev bridge in the prod build').toBe(false)
  return { bad }
}

async function runPrefilledMc(page: Page, runs: number, steps: number, seed: number): Promise<void> {
  await openMonteCarloDialog(page)
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
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('Distribution')
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
    await openFileSubmenu(page, 'export')
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
    await waitForAppReady(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(18)

    // 7 — no console errors (support/loop fixture), no failed / cross-origin requests
    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  // The 3-zone comparison, a large Template and the one that opens locked
  // (Early MMO, the previous subject here, opens editable since issue #428).
  test('the "3-zone gacha banner comparison" Template loads its bundled graph + recommended MC config', async ({ page }) => {
    const { bad } = await openProd(page)
    const GACHA = JSON.parse(readFileSync(new URL('../examples/gacha-banner-zones.json', import.meta.url), 'utf8')) as {
      nodes: unknown[]
      recommendedRunConfig: { runs: number; steps: number; baseSeed: number }
    }

    // File ▸ Templates (docs/workbench.md §WB2.2)
    await (await openFileSubmenu(page, 'templates')).locator('[role="menuitem"]', { hasText: '3-zone gacha banner comparison' }).click()
    const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
    if (await confirm.isVisible().catch(() => false)) await confirm.click()

    // every node of the canonical examples/gacha-banner-zones.json
    await expect(page.locator('.react-flow__node')).toHaveCount(GACHA.nodes.length)

    // the file's recommendedRunConfig pre-fills the Monte-Carlo dialog
    const rc = GACHA.recommendedRunConfig
    await openMonteCarloDialog(page)
    const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
    await expect(dlg).toBeVisible()
    const nums = dlg.locator('.mcdlg__field input[type="number"]')
    await expect(nums.nth(0)).toHaveValue(String(rc.runs))
    await expect(nums.nth(1)).toHaveValue(String(rc.steps))
    await expect(nums.nth(2)).toHaveValue(String(rc.baseSeed))
    await expect(dlg.locator('.mcdlg__foot .btn--primary')).toHaveText(new RegExp(`^Run ${rc.runs.toLocaleString('en-US').replace(',', ',?')} runs$`))
    await page.keyboard.press('Escape')

    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  test('the language switch offers exactly the shipped locales — the dev pseudo-locale never reaches Production', async ({
    page,
  }) => {
    const { bad } = await openProd(page)

    await page.locator('.toolbar__actions .wb-viewmenu > .wb-mb').click()
    await page.locator('.toolbar .lang-switch').click()
    const opts = page.locator('.lang-menu__pop [role="option"]')
    // §L2.0a — the restored languages are the shipped locales — NO en-XA (and
    // no ar-XB, which is dev-only and never offered in the picker anyway)
    await expect(opts).toHaveCount(18)
    await expect(page.locator('.lang-menu__pop [data-locale="en-XA"]')).toHaveCount(0)
    // §L5.6 — in PRODUCTION the picker shows exactly the shipped locales, in
    // English-name order, with no pseudo-locale to append. Asserted unsorted
    // here on purpose: the DOM order is the contract.
    expect(await opts.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))).toEqual([
      'ar', 'zh-Hans', 'zh-Hant', 'nl', 'en', 'fr', 'de', 'it', 'ja', 'ko',
      'pt-BR', 'pt-PT', 'ru', 'es-419', 'es-ES', 'th', 'tr', 'vi',
    ])
    // §L5.4 — the shipped languages are past the threshold, so the search box
    // shows, and the pseudo-locale (absent here) never counted towards it.
    await expect(page.locator('.lang-menu__pop input[role="combobox"]')).toHaveCount(1)

    // pick KO, reload — it persists
    await page.locator('.lang-menu__item[data-locale="ko"]').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))).toBe('ko')
    await page.reload()
    await waitForAppReady(page)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ko')

    // and a restored language the same way — its chunk is in the Production
    // build, not only in dev
    await page.locator('.toolbar__actions .wb-viewmenu > .wb-mb').click()
    await page.locator('.toolbar .lang-switch').click()
    await page.locator('.lang-menu__item[data-locale="ja"]').click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ja')
    await page.reload()
    await waitForAppReady(page)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja')

    // a hand-planted 'en-XA' in storage is not a registered code in Production —
    // the resolver ignores it and falls back rather than selecting it
    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'en-XA'))
    await page.reload()
    await waitForAppReady(page)
    expect(await page.evaluate(() => document.documentElement.lang)).not.toBe('en-XA')

    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  // The document is opened from its FILE, as a user's own file is (since
  // 0.28.1, when Early MMO left the menu; back in it since 0.30.0). It is a
  // Template entry, so its node names follow a locale switch; the
  // largest graph with parallel sets, it stays the subject of this check.
  test('a bulk locale switch on the MMO document keeps edge endpoints aligned with their real handle positions (no window.__loop)', async ({
    page,
  }) => {
    // The node structure (v0.26.0): the name sits OUTSIDE a fixed-height body,
    // so a language switch no longer resizes any body — the previous rule
    // (a switch must change some node's height, and each moved handle drags
    // its edge end with it) no longer has anything to move. What a switch must
    // do now, in the ACTUAL shipped bundle: every body keeps its box, every
    // port keeps its place, every name is re-written in the new language, and
    // every connection still starts and ends on a real port of its own nodes.
    // Pure DOM/UI — no window.__loop (tree-shaken out of production) — so
    // node/edge identity is read off data-id / aria-label rather than the
    // graph store.
    const { bad } = await openProd(page)

    // Pin the starting locale explicitly rather than assuming the fresh
    // context's default (navigator.language) — a real, current-locale check
    // (html lang + a representative label), not an assumption. The Settings
    // trigger's own label is itself locale-dependent, so match both
    // shipped-language spellings (same pattern as e2e/i18n.spec.ts's
    // openSettings), not just the English one.
    const settingsBtn = page.locator('.toolbar__actions .wb-viewmenu > .wb-mb')
    // picking a language leaves Settings open; close it, so the next switch's
    // first click opens it again rather than closing it (the Templates menu
    // used to close it, before the MMO document was opened from its file)
    const switchTo = async (locale: string) => {
      await settingsBtn.click()
      await page.locator('.toolbar .lang-switch').click()
      await page.locator(`.lang-menu__item[data-locale="${locale}"]`).click()
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale)
      await page.keyboard.press('Escape')
      await expect(page.locator('.toolbar .lang-switch')).toBeHidden()
    }
    await switchTo('en')

    // open the MMO document from its file (the real file input)
    const MMO_TEXT = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')
    await page.locator('input[type=file][accept*="json"]').first().setInputFiles({ name: 'mmo-progression.json', mimeType: 'application/json', buffer: Buffer.from(MMO_TEXT, 'utf8') })
    // locale-independent: the confirm dialog's primary action button by class
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(97)
    await expect(page.locator('.react-flow__node', { hasText: 'Level' }).first()).toBeVisible()

    // into Korean: the names follow (the document is still a Template entry's)
    await switchTo('ko')
    await page.evaluate(() => document.fonts.ready)
    // representative Korean node label, confirming the KO names are drawn
    await expect(page.locator('.react-flow__node', { hasText: '레벨' }).first()).toBeVisible()
    // issue #344 §ER14.5 — the routed connections are drawn once their first
    // generation commits; the canvas is aria-busy until then (the DOM side of
    // the settle contract `routesSettled` reads in dev). "Before" is read only
    // when every route is drawn.
    await domRoutesSettled(page)

    type Pt = { x: number; y: number }
    type Snap = {
      nodes: Record<string, { w: number; h: number; name: string }>
      handles: Record<string, Pt>
      edges: Record<string, { source: string; target: string; start: Pt | null; end: Pt | null }>
      zoom: number
    }
    async function snapshot(): Promise<Snap> {
      return page.evaluate(() => {
        const centre = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
        }
        const nodes: Record<string, { w: number; h: number; name: string }> = {}
        for (const wrap of document.querySelectorAll('.react-flow__node')) {
          const id = (wrap as HTMLElement).dataset.id!
          const nf = wrap.querySelector('.nodef') as HTMLElement | null
          const name = wrap.querySelector('.nodef__name')
          if (nf) nodes[id] = { w: nf.offsetWidth, h: nf.offsetHeight, name: (name?.textContent ?? '').trim() }
        }
        // every port, by node and DOM handle id — the default faces and the
        // four-side ones alike (a hidden face handle is still laid out where
        // its port is)
        const handles: Record<string, { x: number; y: number }> = {}
        for (const h of document.querySelectorAll('.react-flow__handle')) {
          const el = h as HTMLElement
          handles[`${el.dataset.nodeid}/${el.dataset.handleid}`] = centre(h)
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
        const edges: Record<string, { source: string; target: string; start: { x: number; y: number } | null; end: { x: number; y: number } | null }> = {}
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
          let start = null
          let end = null
          if (p) {
            try {
              const len = p.getTotalLength()
              const s = p.getPointAtLength(0)
              const e = p.getPointAtLength(len)
              start = toScreen(p, s.x, s.y)
              end = toScreen(p, e.x, e.y)
            } catch {
              /* zero-length / detached path -- left null */
            }
          }
          edges[id] = { source, target, start, end }
        }
        const vp = document.querySelector('.react-flow__viewport')
        const zoom = vp ? new DOMMatrixReadOnly(getComputedStyle(vp).transform).a : 1
        return { nodes, handles, edges, zoom }
      })
    }

    // What each connection's two ends must be, from the Template's own
    // document (the KO Template is the same graph with Korean labels): the DOM
    // handle of the port and face the connection USES (src/model/ports.ts —
    // the kind's default face binds to the document's handle id, any other
    // face to `<id>@<face>`), and its place in its parallel set. The router
    // groups a set by both ends' node AND handle (routeMap.ts `pkey`, reversed
    // pairs included), orders it by connection id and moves member i by
    // (i − (n − 1) / 2) · PARALLEL_GAP flow px across the face, the same
    // offset at both ends (orthogonalRoute.ts `fanOffset`, §ER3.7) — so only a
    // real member of a set is off its port, and only by its own offset.
    type DocEdge = Pick<LoopEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'targetHandle' | 'data'>
    const DOC_EDGES = (JSON.parse(readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8')) as { edges: DocEdge[] }).edges
    expect(
      DOC_EDGES.every((e) => (e.data as { route?: unknown }).route === 'orthogonal'),
      'every MMO connection is routed orthogonally (the fan rule below is the orthogonal router’s)',
    ).toBe(true)
    const endKey = (node: string, handle: string | null | undefined) => `${node}:${handle ?? ''}`
    const setKey = (e: DocEdge) => [endKey(e.source, e.sourceHandle), endKey(e.target, e.targetHandle)].sort().join('|')
    const sets = new Map<string, string[]>()
    for (const e of [...DOC_EDGES].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) (sets.get(setKey(e)) ?? sets.set(setKey(e), []).get(setKey(e))!).push(e.id)
    const expected = new Map(
      DOC_EDGES.map((e) => {
        const kind = edgePortKind(e)
        const set = sets.get(setKey(e))!
        const fan = (set.indexOf(e.id) - (set.length - 1) / 2) * PARALLEL_GAP
        const end = (node: string, which: PortEnd) => {
          const face = faceOf(e, which)
          const across = face === 'left' || face === 'right' ? { x: 0, y: fan } : { x: fan, y: 0 }
          return { handle: `${node}/${rfHandleId(kind, which, face)}`, across }
        }
        return [e.id, { source: e.source, target: e.target, setSize: set.length, start: end(e.source, 'source'), end: end(e.target, 'target') }]
      }),
    )
    expect([...expected.values()].some((x) => x.setSize > 1), 'the MMO has parallel sets, so the fan is exercised').toBe(true)

    const ENDPOINT_TOLERANCE_PX = 2
    // every connection starts on the port it uses on its source node and ends
    // on the port it uses on its target node, a parallel member by exactly its
    // own fan offset
    function expectEndpointsOnPorts(snap: Snap, label: string) {
      expect(Object.keys(snap.edges).sort(), `${label}: every MMO connection is drawn`).toEqual([...expected.keys()].sort())
      const off: { id: string; why: string }[] = []
      for (const [id, x] of expected) {
        const e = snap.edges[id]
        if (e.source !== x.source || e.target !== x.target) {
          off.push({ id, why: `drawn ${e.source} → ${e.target}, the document says ${x.source} → ${x.target}` })
          continue
        }
        for (const [which, at, want] of [['start', e.start, x.start], ['end', e.end, x.end]] as const) {
          const h = snap.handles[want.handle]
          if (!h || !at) {
            off.push({ id, why: `${which}: ${h ? 'no path end' : `no handle ${want.handle}`}` })
            continue
          }
          const wx = h.x + want.across.x * snap.zoom
          const wy = h.y + want.across.y * snap.zoom
          const d = Math.hypot(at.x - wx, at.y - wy)
          if (d > ENDPOINT_TOLERANCE_PX) off.push({ id, why: `${which} ${d.toFixed(2)} px from ${want.handle}${want.across.x || want.across.y ? ` + its fan offset` : ''}` })
        }
      }
      expect(off, `${label}: every connection end sits on the port it uses`).toEqual([])
    }

    const before = await snapshot()
    expectEndpointsOnPorts(before, 'KO')

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
    await domRoutesSettled(page)

    const after = await snapshot()
    expect(Object.keys(after.nodes).sort(), 'the same nodes before and after').toEqual(Object.keys(before.nodes).sort())

    // the body keeps its box: the name is outside it, so no translation can
    // grow or shrink a node
    const resized = Object.keys(after.nodes).filter(
      (id) => Math.abs(after.nodes[id].w - before.nodes[id].w) > 0.5 || Math.abs(after.nodes[id].h - before.nodes[id].h) > 0.5,
    )
    expect(resized, 'no body changes its size with the language').toEqual([])

    // every port stays where it was (same viewport, same body — same screen point)
    const HANDLE_EPSILON_PX = 0.5
    expect(Object.keys(after.handles).sort(), 'the same ports before and after').toEqual(Object.keys(before.handles).sort())
    const movedPorts = Object.keys(after.handles).filter(
      (k) => Math.hypot(after.handles[k].x - before.handles[k].x, after.handles[k].y - before.handles[k].y) > HANDLE_EPSILON_PX,
    )
    expect(movedPorts, 'no port moves with the language').toEqual([])

    // the names are the ones re-written: Korean before, English after — a
    // switch that silently did nothing would leave them as they were
    const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/
    const named = Object.keys(after.nodes).filter((id) => before.nodes[id].name !== '')
    expect(named.length, 'the MMO nodes carry an outside name').toBeGreaterThan(80)
    const koBefore = named.filter((id) => HANGUL.test(before.nodes[id].name))
    expect(koBefore.length, 'the KO Template names its nodes in Korean').toBeGreaterThan(named.length / 2)
    const stillKo = named.filter((id) => HANGUL.test(after.nodes[id].name))
    expect(stillKo, 'no name stays in Korean after the switch to English').toEqual([])
    const rewritten = koBefore.filter((id) => after.nodes[id].name !== before.nodes[id].name && /[A-Za-z]/.test(after.nodes[id].name))
    expect(rewritten.length, 'every Korean name is re-written in English').toBe(koBefore.length)

    // and every connection still starts and ends on a real port of its nodes
    expectEndpointsOnPorts(after, 'EN')

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
    await openFileSubmenu(page, 'export')
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

// ── the version the PRODUCTION build reports ────────────────────────────────
//
// The in-app release notes (issue #296) were removed in 2026-10; the changes are
// in the repository's CHANGELOG. What stays is that the build says which version
// it is, and that nothing of the removed notes is left on screen or in storage.
test.describe('production build — the version', () => {
  test('About shows the package.json version', async ({ page }) => {
    const { bad } = await openProd(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    expectAboutIsPackageVersion((await readAboutVersion(page)).version)
    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })

  test('no release-notes entry, notice or stored record is left', async ({ page }) => {
    await openProd(page)
    await page.locator('[data-tour="help-trigger"]').click()
    const items = await page.locator('.menu__pop [role="menuitem"]').allTextContents()
    expect(items.map((s) => s.trim())).not.toContain('What’s new')
    expect(items.some((s) => /what.s new/i.test(s))).toBe(false)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-whatsnew]')).toHaveCount(0)
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('loop-studio/whats-new/')))
    expect(stored, 'the app no longer writes the retired release-note keys').toEqual([])
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

// ── issue #301 — the third-party licences, as the production build serves them
test.describe('production build — the third-party open-source licenses', () => {
  test('About shows the built THIRD_PARTY_NOTICES.txt as text, and its file link opens the same bytes in a new tab', async ({ page, context }) => {
    const { bad } = await openProd(page)
    await openAbout(page)
    const dlg = await openLicences(page)
    await expectShownNoticesAre(page, 'web')
    const link = dlg.locator('[data-licenses-file]')
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/)
    const [tab] = await Promise.all([context.waitForEvent('page'), link.click()])
    await tab.waitForLoadState()
    expect(new URL(tab.url()).pathname).toBe('/THIRD_PARTY_NOTICES.txt')
    expect(await tab.evaluate(() => window.opener)).toBeNull()
    expect(sha256(await (await tab.request.get(tab.url())).text())).toBe(manifestNoticesSha('web'))
    await tab.close()
    expect(bad, 'no failed or cross-origin requests').toEqual([])
  })
})
