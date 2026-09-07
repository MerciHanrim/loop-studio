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
})
