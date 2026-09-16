import type { Browser, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/template-label-overlay.md — the shared fresh-open Template label overlay:
// a bundled Template opens with the current locale's node `label`s; `openTemplate`
// (the menu overlay) is never re-run on an already-open document, and never on an
// Import / Share / Workspace / autosave document.
//
// §TLO11: a UI-language change re-seeds the OFFICIAL bundled-template labels
// (a label that is EXACTLY one of that node id's shipped-locale strings) in the
// open document — and only those; a user rename is kept.
//
// Boundaries pinned here:
//  - desktop menu open  → current-locale labels
//  - MOBILE More → Templates open → current-locale labels (its own doLoadTemplate)
//  - a language switch re-seeds OFFICIAL labels only; a user rename survives (§TLO11)
//  - a plain reload / autosave restore does NOT re-run the menu overlay (#97 guard)
//  - Import keeps the file's own labels; a later language switch keeps them too
//  - re-open in a different locale order → pristine English canonical

type Loop = Record<string, { getState: () => any }>
const g = (page: Page) => page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState())
const labels = (page: Page) => page.evaluate(() =>
  (window as unknown as { __loop: Loop }).__loop.graph.getState().nodes.map((n: any) => n.data.label),
)
const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => htmlLang(page)).toBe(code)
}

// Templates ▾ is the first `.menu` in the toolbar actions (locale-agnostic).
const templatesBtn = (page: Page) =>
  page.locator('.toolbar__actions .menu').first().locator('> button')
async function pickTemplate(page: Page, hasText: string) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions .menu').first()
    .locator('.menu__pop [role="menuitem"]', { hasText })
    .click()
  // pristine first boot loads without a confirm; if a confirm appears, accept it
  const confirm = page.locator('.dialog button', { hasText: /replace|바꾸기|교체/i })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
}

const MMO_EN = 'Early MMO progression'
const MMO_KO = '초반 MMO 성장'

const GRAPH_STORAGE_KEY = 'loop-studio:graph:v1'
const catValue = (page: Page, key: string) =>
  page.evaluate(
    (k) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog[k] as string,
    key,
  )

test.describe('template label overlay', () => {
  test('MMO opens with the current locale node labels; a later language switch re-seeds the OFFICIAL labels but keeps a user rename', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    let l = await labels(page)
    expect(l).toContain('레벨')
    expect(l).toContain('골드')
    expect(l).not.toContain('Level')

    // the user renames the `gold` node to something of their own
    await page.evaluate(() => {
      const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const gold = gs.nodes.find((n: any) => n.id === 'gold')
      gs.updateNodeData(gold.id, { label: '내 금고' })
    })

    // switch the app language while the KO document is open — the OFFICIAL
    // template labels follow the new language (§TLO11); the user rename does not
    await setLocale(page, 'en')
    l = await labels(page)
    expect(l).toContain('Level') // 레벨 → Level
    expect(l).not.toContain('레벨')
    expect(l).toContain('내 금고') // the user rename is preserved
    expect(l).not.toContain('Gold') // (that node is now '내 금고')

    // …and a fresh EN open is the canonical English
    await resetAll(page)
    await pickTemplate(page, MMO_EN)
    l = await labels(page)
    expect(l).toContain('Level')
    expect(l).toContain('Gold')
    expect(l).not.toContain('레벨')
  })

  test('the equilibrium sample opens with KO node labels under a KO locale, EN canonical under EN', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    // KO menu open → the Korean production-line labels
    await setLocale(page, 'ko')
    const koName = await page.evaluate(
      () =>
        (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog[
          'templates.equilibrium.name'
        ] as string,
    )
    await pickTemplate(page, koName)
    let l = await labels(page)
    expect(l).toContain('원료 재고')
    expect(l).toContain('가공')
    expect(l).not.toContain('Raw inventory')

    // fresh EN open → the English canonical
    await resetAll(page)
    await setLocale(page, 'en')
    await pickTemplate(page, 'Balanced production line')
    l = await labels(page)
    expect(l).toContain('Raw inventory')
    expect(l).toContain('Processing')
    expect(l).not.toContain('원료 재고')
  })

  test('overlay is menu-only: an Import under KO keeps the file\'s own labels', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')

    const G = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Ore Stock', activation: 'passive', initial: 0, mode: 'pullAny' } },
        { id: 'b', type: 'drain', position: { x: 240, y: 0 }, data: { kind: 'drain', label: 'Out', activation: 'automatic', mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
      ],
    })
    await importGraph(page, G)
    const l = await labels(page)
    expect(l.sort()).toEqual(['Ore Stock', 'Out'])
  })

  test('re-open isolation: opening MMO in KO then EN yields the pristine English canonical', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    // mutate the open document
    await page.evaluate(() => {
      const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      gs.setSelection(gs.nodes[0].id, null)
    })

    await resetAll(page)
    await setLocale(page, 'en')
    await pickTemplate(page, MMO_EN)
    const s = await g(page)
    expect(s.nodes.map((n: any) => n.data.label)).toContain('Level')
    expect(s.nodes.map((n: any) => n.data.label)).not.toContain('레벨')
    expect(s.selectedNodeId).toBeNull()
  })

  // Desktop and mobile edit two different `doLoadTemplate` paths — the mobile
  // More → Templates sheet needs its own functional check that the overlay ran.
  test('mobile More → Templates opens MMO with the current-locale (KO) node labels', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
      } catch {
        /* private mode */
      }
    })
    try {
      await openApp(page)
      await resetAll(page)
      await setLocale(page, 'ko')

      const moreLabel = await catValue(page, 'mobile.more') // '더 보기'
      const tplLabel = await catValue(page, 'templates.menuLabel') // '템플릿'
      const mmoName = await catValue(page, 'templates.mmoProgression.name') // '초반 MMO 성장 (1–15레벨)'

      await page.locator('.mob-more').click()
      await page
        .locator(`.sheet[aria-label="${moreLabel}"] .sheet__row`, { hasText: tplLabel })
        .click()
      await page
        .locator(`.sheet[aria-label="${tplLabel}"] .sheet__row`, { hasText: mmoName })
        .click()
      // a non-pristine session confirms the replace first; a pristine one loads
      // straight away
      const confirmLabel = await catValue(page, 'templates.replace.confirm')
      const confirm = page.getByRole('button', { name: confirmLabel })
      if (await confirm.isVisible().catch(() => false)) await confirm.click()

      await expect.poll(() => labels(page).then((l) => l.length)).toBeGreaterThan(50)
      const l = await labels(page)
      expect(l).toContain('레벨')
      expect(l).toContain('골드')
      expect(l).toContain('15레벨 도달')
      expect(l).not.toContain('Level')
    } finally {
      await page.close()
    }
  })

  // #97 found a real autosave-restore defect — pin that the MENU overlay
  // (`openTemplate`) is not re-run on a language switch or a plain reload: a user
  // rename must survive both. The §TLO11 official-label re-seed is separate.
  test('a language switch re-seeds OFFICIAL labels; a plain reload keeps them and never re-runs the menu overlay', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    // KO menu open ⇒ Korean labels; then the user renames a node
    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    expect(await labels(page)).toContain('레벨')
    await page.evaluate(() => {
      const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      const gold = gs.nodes.find((n: any) => n.id === 'gold')
      gs.updateNodeData(gold.id, { label: '내 금고' })
    })

    // switch the app language to EN ⇒ OFFICIAL labels follow, the rename stays
    await setLocale(page, 'en')
    expect(await labels(page)).toContain('Level')
    expect(await labels(page)).not.toContain('레벨')
    expect(await labels(page)).toContain('내 금고')

    // let the autosave debounce persist, then a plain reload
    await expect
      .poll(() =>
        page.evaluate(
          (k) => localStorage.getItem(k)?.includes('내 금고') ?? false,
          GRAPH_STORAGE_KEY,
        ),
      )
      .toBe(true)
    await page.reload()
    await openApp(page)

    // boots in EN (persisted preference); the restored graph is unchanged — the
    // menu overlay is NOT re-run (the rename is intact), and the locale did not
    // change so §TLO11 does nothing either
    expect(await htmlLang(page)).toBe('en')
    const restored = await labels(page)
    expect(restored).toContain('Level')
    expect(restored).toContain('Reached level 15') // official label followed the switch
    expect(restored).toContain('내 금고') // the user rename survived the reload
    expect(restored).not.toContain('레벨')

    // and opening the English Template fresh from the menu is the canonical
    await resetAll(page)
    await pickTemplate(page, MMO_EN)
    const en = await labels(page)
    expect(en).toContain('Level')
    expect(en).not.toContain('레벨')
  })
})

// docs/template-label-overlay.md §TLO11 — the safe official-template-label
// locale switch: exact string match on (node id + a shipped-locale label), no
// per-document flag, live graph + undo history + persisted record.
test.describe('official template label — locale switch (§TLO11)', () => {
  const rename = (page: Page, id: string, label: string) =>
    page.evaluate(
      ([i, l]) => {
        const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
        gs.updateNodeData(i, { label: l })
      },
      [id, label],
    )
  const simRev = (page: Page) =>
    page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().simulationRev)

  test('KO → JA → EN round-trips the official labels of the bundled templates', async ({ page }) => {
    await openApp(page)
    const cases = [
      { pick: MMO_KO, ko: '레벨', ja: 'レベル', en: 'Level' },
      { pick: '용량 교착', ko: '가공', ja: '加工', en: 'Processing' },
    ]
    for (const c of cases) {
      await resetAll(page)
      await setLocale(page, 'ko')
      await pickTemplate(page, c.pick)
      expect(await labels(page)).toContain(c.ko)
      await setLocale(page, 'ja')
      expect(await labels(page)).toContain(c.ja)
      expect(await labels(page)).not.toContain(c.ko)
      await setLocale(page, 'en')
      expect(await labels(page)).toContain(c.en)
      await setLocale(page, 'ko')
      expect(await labels(page)).toContain(c.ko)
    }
  })

  test('a user-created node and a `Foo 2` de-dup name never switch', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'en')
    await pickTemplate(page, MMO_EN)

    // rename one official node to exactly "<label> 2" and add a brand-new node
    await rename(page, 'gold', 'Gold 2')
    await page.evaluate(() => {
      const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      gs.addNodeAt('pool', { x: 40, y: 40 }) // English default label, e.g. "Pool"
    })
    expect(await labels(page)).toContain('Pool') // the added node's English default

    await setLocale(page, 'ko')
    const after = await labels(page)
    // official labels moved to KO, but "Gold 2" and the new "Pool" are untouched
    expect(after).toContain('Gold 2')
    expect(after).toContain('Pool')
    expect(after).toContain('레벨')
  })

  test('an Imported unmodified template graph also switches — no provenance flag', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'en')

    const G = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'tpl-conv', type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: 'Processing', activation: 'automatic', inRate: '2', outRate: '1' } },
        { id: 'tpl-prod', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'Finished goods', activation: 'passive', initial: 0, mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e', type: 'loop', source: 'tpl-conv', target: 'tpl-prod', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
      ],
    })
    await importGraph(page, G)
    expect((await labels(page)).sort()).toEqual(['Finished goods', 'Processing'])

    await setLocale(page, 'ja')
    expect((await labels(page)).sort()).toEqual(['加工', '完成品在庫'])
  })

  test('the switch does not bump simulationRev; an undo across it keeps the current UI language', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'en')
    await pickTemplate(page, MMO_EN)

    await rename(page, 'gold', 'stash') // one undoable edit, in EN
    const revBeforeSwitch = await simRev(page)
    await setLocale(page, 'ko')
    expect(await simRev(page)).toBe(revBeforeSwitch) // the switch is label-only

    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.graph.getState().undo())
    const l = await labels(page)
    expect(l).toContain('골드') // the pre-rename node came back — in the ACTIVE language
    expect(l).not.toContain('Gold')
    expect(l).toContain('레벨')
  })

  test('the Timeline legend follows the switched labels', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'en')
    await pickTemplate(page, MMO_EN)
    const legend = page.locator('.timeline__legend, .timeline .legend').first()
    await expect(legend).toContainText('Level')

    await setLocale(page, 'ko')
    await expect(legend).toContainText('레벨')
    await expect(legend).not.toContainText('Level')
  })

  test('a non-template node id is never switched — even when its label equals an official string', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    // `sample-pool` carries the exact string "Gold" (an official MMO label), but
    // its id is not a bundled-template id → the switch must leave it alone.
    await page.evaluate(() => {
      const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      gs.loadGraph({
        nodes: [
          { id: 'sample-source', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Faucet', activation: 'automatic', mode: 'pushAny' } },
          { id: 'sample-pool', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 5, mode: 'pullAny' } },
        ],
        edges: [],
      })
    })
    await setLocale(page, 'ko')
    expect((await labels(page)).sort()).toEqual(['Faucet', 'Gold'])
  })

  test('boot reconciles a stored JA preference against KO template labels', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    expect(await labels(page)).toContain('레벨')

    // pin the language preference to JA, keep the KO-labelled graph, reload
    await page.evaluate(() =>
      localStorage.setItem('loop-studio/ui-locale/1', 'ja'),
    )
    await expect
      .poll(() =>
        page.evaluate(
          (k) => localStorage.getItem(k)?.includes('레벨') ?? false,
          GRAPH_STORAGE_KEY,
        ),
      )
      .toBe(true)
    await page.reload()
    await openApp(page)

    expect(await htmlLang(page)).toBe('ja')
    const l = await labels(page)
    expect(l).toContain('レベル') // boot switched the official labels to JA
    expect(l).not.toContain('레벨')
  })

  // A locale switch on the full 97-node MMO template relabels many nodes in
  // one commit. An earlier release-blocking bug (2026-09-16 timing
  // investigation) traced a 5.6-7.1s main-thread stall on an English switch
  // to this app's OWN per-node `updateNodeInternals` calls; removing them
  // entirely (nodes.tsx) — relying on React Flow's own internal per-node
  // ResizeObserver, which was already keeping geometry correct the whole
  // time — fixed the stall with no functional regression (confirmed by an
  // A/B/C comparison, including a dedicated production-bundle check in
  // e2e/dist.spec.ts). These two tests exercise the resulting geometry
  // directly, not just the label text a switch carries.
  test('KO → JA → EN → KO on the full MMO template keeps every node\'s RF-measured height, handle centring, and edge endpoints consistent', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    await page.evaluate(() => document.fonts.ready)

    async function geometrySnapshot() {
      return page.evaluate(() => {
        const wraps = [...document.querySelectorAll('.react-flow__node')] as HTMLElement[]
        return wraps.map((wrap) => {
          const nf = wrap.querySelector('.nodef') as HTMLElement | null
          if (!nf) return { id: wrap.dataset.id!, wrapH: 0, nfH: 0, ports: [] as number[] }
          const nfR = nf.getBoundingClientRect()
          // Port centres come from getBoundingClientRect(), which reflects RF's
          // pan/zoom CSS transform; nfR.height is measured the same way, so the
          // ratio below stays correct at whatever zoom the Template opens at.
          // (offsetHeight, used for wrapH/nfH, is transform-invariant layout
          // size — comparing a scaled port offset against it would be a
          // coordinate-space mismatch, not a real geometry defect.)
          const ports = [...wrap.querySelectorAll('.h--in, .h--out')].map((h) => {
            const r = h.getBoundingClientRect()
            return (r.top + r.bottom) / 2 - nfR.top - nfR.height / 2
          })
          return { id: wrap.dataset.id!, wrapH: wrap.offsetHeight, nfH: nf.offsetHeight, ports }
        })
      })
    }
    // RF's own internal wrapper height must track each node's real rendered
    // height — exactly what a missed re-measure would break (a stale wrapper
    // height, ports off-centre on the real box). React Flow keeps this in
    // sync via its own internal per-node ResizeObserver (no explicit
    // updateNodeInternals call from this app — see nodes.tsx), so poll rather
    // than a fixed sleep: that observer's callback lands on the browser's own
    // schedule, not any fixed delay this app controls.
    async function geometrySettled() {
      const snap = await geometrySnapshot()
      return snap.length > 90 && snap.every((n) => Math.abs(n.wrapH - n.nfH) <= 2)
    }
    // Handle DOM position is CSS-driven off `boxH` directly — it would look
    // right even if `updateNodeInternals` were never called. Edge ROUTING is
    // the real consumer of RF's internal per-node measurement: `sourceX/Y` /
    // `targetX/Y` (LoopEdge.tsx) come from RF's last-recorded handle position,
    // which only advances on an `updateNodeInternals` call.
    //
    // The check is a DELTA, not an absolute alignment: does the edge endpoint
    // move by the same amount the handle itself moved, between two settled
    // snapshots? (Confirmed by direct measurement, 2026-09-16: a Position.Top/
    // Bottom "state" handle's DOM element does NOT sit centred on RF's actual
    // flow-coordinate anchor — e.g. a_z1_xp2lvl_hi's target handle measured
    // ~3.9px from its own bounding-box centre to the path's real endpoint, a
    // fixed rendering-convention offset present identically whether internals
    // updates are batched or individual, i.e. unrelated to this fix. An
    // absolute "endpoint == handle centre" check would misreport that
    // pre-existing baseline offset as a defect. A delta cancels it out and
    // tests exactly the thing `updateNodeInternals` is responsible for.)
    // Endpoints and handle centres are both converted to SCREEN coordinates
    // (via the path's own `getScreenCTM()`) before comparing, so RF's flow
    // coordinates and the CSS pan/zoom transform are never mixed by hand.
    async function edgeAlignment() {
      return page.evaluate(() => {
        const w = window as unknown as { __loop: Loop }
        const edges = w.__loop.graph.getState().edges as {
          id: string
          source: string
          target: string
          sourceHandle: string
          targetHandle: string
        }[]
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
        const out: Record<
          string,
          { d: string; startScreen: { x: number; y: number } | null; endScreen: { x: number; y: number } | null; sourceHandleScreen: { x: number; y: number } | null; targetHandleScreen: { x: number; y: number } | null }
        > = {}
        for (const e of edges) {
          const g = document.querySelector(`.react-flow__edge[data-id="${e.id}"]`)
          const p = g?.querySelector('path.react-flow__edge-path') as SVGPathElement | null
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
              /* zero-length / detached path -- left null, caller treats as unresolved */
            }
          }
          out[e.id] = {
            d: p?.getAttribute('d') ?? '',
            startScreen,
            endScreen,
            sourceHandleScreen: handleCenter(e.source, e.sourceHandle),
            targetHandleScreen: handleCenter(e.target, e.targetHandle),
          }
        }
        return out
      })
    }
    const edgesByNode = await page.evaluate(() => {
      const edges = (window as unknown as { __loop: Loop }).__loop.graph.getState().edges
      const out: Record<string, string[]> = {}
      for (const e of edges as { id: string; source: string; target: string }[]) {
        ;(out[e.source] ??= []).push(e.id)
        ;(out[e.target] ??= []).push(e.id)
      }
      return out
    })
    type Pt = { x: number; y: number }
    const delta = (before: Pt | null, after: Pt | null) =>
      before && after ? { x: after.x - before.x, y: after.y - before.y } : null
    const dist = (a: Pt | null, b: Pt | null) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null)
    // Sub-pixel path-decimal rounding (orthogonalRoute.ts's PATH_DECIMALS) plus
    // float error through the CTM transform — a few px, comfortably tighter
    // than the ~8px slack needed for the handle-centring check above, since
    // this compares two deltas rather than two absolute positions.
    const ENDPOINT_TOLERANCE_PX = 3
    // A resized node doesn't guarantee ITS SPECIFIC handle moved (e.g. a
    // Position.Top handle's x only depends on width, which never changes
    // here) — comparing two zero deltas would trivially "agree" without
    // proving anything moved at all. Only treat a side as checked once its
    // handle has genuinely moved past float/sub-pixel noise.
    const HANDLE_MOVE_EPSILON_PX = 0.5

    await expect.poll(geometrySettled, { timeout: 5000, intervals: [50] }).toBe(true)
    let prevGeo = await geometrySnapshot()
    let prevEdges = await edgeAlignment()

    // resizedEdgeIds() depends only on `prevGeo` (fixed for this switch, taken
    // from the PREVIOUS settle) and a live re-fetch of the current snapshot —
    // so it's safe to call repeatedly from inside a poll.
    async function resizedEdgeIds(snap: Awaited<ReturnType<typeof geometrySnapshot>>) {
      const prevById = new Map(prevGeo.map((n) => [n.id, n]))
      const ids = new Set<string>()
      for (const n of snap) {
        const before = prevById.get(n.id)
        if (!before || Math.abs(before.nfH - n.nfH) <= 1) continue // height didn't change this switch
        for (const edgeId of edgesByNode[n.id] ?? []) ids.add(edgeId)
      }
      return ids
    }

    for (const locale of ['ja', 'en', 'ko'] as const) {
      await setLocale(page, locale)
      // routeMap's rebuild (src/store/routeMap.ts) reacts to RF's `node.measured`
      // — a separate, downstream React commit from the wrapper-height DOM sync
      // `geometrySettled` checks — so it can genuinely still be one commit
      // behind at the instant geometry itself settles. Poll for BOTH conditions
      // together (not a fixed extra delay) so a real, permanent misalignment
      // still fails after the timeout, while a normal one-more-commit lag doesn't.
      async function fullySettled() {
        const snap = await geometrySnapshot()
        if (snap.length <= 90 || !snap.every((n) => Math.abs(n.wrapH - n.nfH) <= 2)) return false
        const edges = await edgeAlignment()
        // Return value proves genuine movement was observed and tracked —
        // not merely that some node's height changed (a node can resize
        // without moving every one of its handles; see HANDLE_MOVE_EPSILON_PX
        // above). Two static deltas would otherwise "agree" vacuously.
        let anyHandleMoved = false
        for (const edgeId of await resizedEdgeIds(snap)) {
          const before = prevEdges[edgeId]
          const after = edges[edgeId]
          if (!before || !after) return false
          const startMoved = delta(before.startScreen, after.startScreen)
          const sourceHandleMoved = delta(before.sourceHandleScreen, after.sourceHandleScreen)
          const endMoved = delta(before.endScreen, after.endScreen)
          const targetHandleMoved = delta(before.targetHandleScreen, after.targetHandleScreen)
          const sourceHandleMoveDist = sourceHandleMoved ? Math.hypot(sourceHandleMoved.x, sourceHandleMoved.y) : null
          const targetHandleMoveDist = targetHandleMoved ? Math.hypot(targetHandleMoved.x, targetHandleMoved.y) : null
          if (sourceHandleMoveDist != null && sourceHandleMoveDist > HANDLE_MOVE_EPSILON_PX) anyHandleMoved = true
          if (targetHandleMoveDist != null && targetHandleMoveDist > HANDLE_MOVE_EPSILON_PX) anyHandleMoved = true
          const startAgreement = dist(startMoved, sourceHandleMoved)
          const endAgreement = dist(endMoved, targetHandleMoved)
          if (startAgreement == null || startAgreement > ENDPOINT_TOLERANCE_PX) return false
          if (endAgreement == null || endAgreement > ENDPOINT_TOLERANCE_PX) return false
        }
        return anyHandleMoved
      }
      await expect.poll(fullySettled, { timeout: 5000, intervals: [50] }).toBe(true)

      const snap = await geometrySnapshot()
      for (const n of snap) {
        for (const offCenter of n.ports) {
          expect(Math.abs(offCenter), `node ${n.id} port centring after ${locale}`).toBeLessThanOrEqual(8)
        }
      }

      const nextEdges = await edgeAlignment()
      const resized = await resizedEdgeIds(snap)
      expect(resized.size, `expected at least one node to resize on the ${locale} switch`).toBeGreaterThan(0)
      let anyHandleMoved = false
      for (const edgeId of resized) {
        const before = prevEdges[edgeId]
        const after = nextEdges[edgeId]
        expect(after, `edge ${edgeId} should still be rendered after ${locale}`).toBeTruthy()
        expect(before, `edge ${edgeId} should have a prior snapshot`).toBeTruthy()
        // primary proof: the path's endpoint moved by the SAME amount its real
        // handle moved — not that it landed on the handle's own DOM centre
        // (see the note above on the fixed state-handle rendering offset).
        const sourceHandleMoved = delta(before.sourceHandleScreen, after.sourceHandleScreen)
        const targetHandleMoved = delta(before.targetHandleScreen, after.targetHandleScreen)
        const sourceHandleMoveDist = sourceHandleMoved ? Math.hypot(sourceHandleMoved.x, sourceHandleMoved.y) : null
        const targetHandleMoveDist = targetHandleMoved ? Math.hypot(targetHandleMoved.x, targetHandleMoved.y) : null
        const startAgreement = dist(delta(before.startScreen, after.startScreen), sourceHandleMoved)
        const endAgreement = dist(delta(before.endScreen, after.endScreen), targetHandleMoved)
        expect(startAgreement, `edge ${edgeId} start-side movement vs source handle movement after ${locale}`).not.toBeNull()
        expect(startAgreement!, `edge ${edgeId} start-side movement vs source handle movement after ${locale}`).toBeLessThanOrEqual(ENDPOINT_TOLERANCE_PX)
        expect(endAgreement, `edge ${edgeId} end-side movement vs target handle movement after ${locale}`).not.toBeNull()
        expect(endAgreement!, `edge ${edgeId} end-side movement vs target handle movement after ${locale}`).toBeLessThanOrEqual(ENDPOINT_TOLERANCE_PX)
        // secondary/supplementary signal, and ONLY for a side whose handle
        // actually moved: a Position.Top/Bottom handle's coordinate along the
        // OTHER axis (e.g. Top's x, which only depends on width — fixed at
        // 120px in this design) legitimately does not move when only height
        // changes, so requiring `d` to differ unconditionally for every
        // resized-node-touching edge would fail a genuinely correct case.
        if (sourceHandleMoveDist != null && sourceHandleMoveDist > HANDLE_MOVE_EPSILON_PX) {
          anyHandleMoved = true
          expect(after.d, `edge ${edgeId} should have a recomputed path after ${locale} (source handle moved)`).not.toBe(before.d)
        }
        if (targetHandleMoveDist != null && targetHandleMoveDist > HANDLE_MOVE_EPSILON_PX) {
          anyHandleMoved = true
          expect(after.d, `edge ${edgeId} should have a recomputed path after ${locale} (target handle moved)`).not.toBe(before.d)
        }
      }
      // resized.size > 0 only proves a NODE'S HEIGHT changed; this proves at
      // least one of its HANDLES actually moved as a result (see
      // HANDLE_MOVE_EPSILON_PX) — otherwise every check above could pass
      // vacuously by comparing two unmoved (zero-delta) positions.
      expect(anyHandleMoved, `expected at least one handle to actually move on the ${locale} switch`).toBe(true)

      prevGeo = snap
      prevEdges = nextEdges
    }
  })

  test('a node deleted immediately after a bulk locale switch leaves no dangling edges (React Flow\'s native re-measure excludes it)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    await page.evaluate(() => document.fonts.ready)

    // 'quest_payout' is one of the nodes whose measured height actually
    // changes on a ko → en switch (confirmed instrumented during the
    // original investigation), so React Flow's own internal ResizeObserver
    // would try to re-measure it.
    const targetId = 'quest_payout'
    const edgesBefore = await page.evaluate(
      (id) =>
        (window as unknown as { __loop: Loop }).__loop.graph
          .getState()
          .edges.filter((e: any) => e.source === id || e.target === id).length,
      targetId,
    )
    expect(edgesBefore).toBeGreaterThan(0) // sanity: it is actually connected

    // Fire the locale switch and, in the SAME synchronous task, delete one of
    // the nodes that would resize — before React Flow's own ResizeObserver
    // callback (async, browser-scheduled) has any chance to run for it. RF's
    // internal `useUpdateNodeInternals` already no-ops for an id with no live
    // DOM element (see node_modules/@xyflow/react's useResizeObserver), so
    // this proves that holds in practice, not just by reading its source.
    await page.evaluate((id) => {
      const w = window as unknown as { __loop: Loop }
      w.__loop.i18n.getState().setLocale('en')
      w.__loop.graph.getState().removeNode(id)
    }, targetId)
    await expect.poll(() => htmlLang(page)).toBe('en')
    // Wait for React's own reconciliation to actually remove the node's DOM
    // element — an observable condition, not a guess at how long that takes.
    await expect(page.locator(`.react-flow__node[data-id="${targetId}"]`)).toHaveCount(0)
    // React Flow's internal ResizeObserver callback runs "in the next
    // rendering step, after layout, before paint" (spec), then its own store
    // update is itself rAF-scheduled — two animation-frame ticks in-page
    // covers that chain without guessing a duration.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )

    const state = await page.evaluate((id) => {
      const gs = (window as unknown as { __loop: Loop }).__loop.graph.getState()
      return {
        nodeGone: !gs.nodes.some((n: any) => n.id === id),
        danglingEdges: gs.edges.filter((e: any) => e.source === id || e.target === id).length,
      }
    }, targetId)
    expect(state.nodeGone).toBe(true)
    expect(state.danglingEdges).toBe(0)
    // the support/loop.ts fixture auto-asserts zero console/page errors for
    // every test — a stale-id RF call surfacing an error would fail it.
  })
})
