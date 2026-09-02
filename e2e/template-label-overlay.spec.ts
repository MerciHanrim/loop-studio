import type { Browser, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/template-label-overlay.md — the shared fresh-open Template label overlay:
// a bundled Template opens with the current locale's node `label`s; the overlay
// is never re-applied to an already-open document, and never applied to an
// Import / Share / Workspace / autosave document.
//
// Boundaries pinned here:
//  - desktop menu open  → current-locale labels
//  - MOBILE More → Templates open → current-locale labels (its own doLoadTemplate)
//  - a language switch on an OPEN document does NOT re-translate it
//  - a plain reload / autosave restore does NOT re-run the overlay (#97 guard)
//  - Import keeps the file's own labels
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
  page.locator('.toolbar__actions > .menu').first().locator('> button')
async function pickTemplate(page: Page, hasText: string) {
  await templatesBtn(page).click()
  await page
    .locator('.toolbar__actions > .menu').first()
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
  test('MMO opens with the current locale node labels; a later language switch does NOT re-translate', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    let l = await labels(page)
    expect(l).toContain('레벨')
    expect(l).toContain('골드')
    expect(l).not.toContain('Level')

    // switch the app language while the KO document is open — labels must stay
    await setLocale(page, 'en')
    l = await labels(page)
    expect(l).toContain('레벨') // unchanged — it is now a user document
    expect(l).not.toContain('Level')

    // …and a fresh EN open is the canonical English
    await resetAll(page)
    await pickTemplate(page, MMO_EN)
    l = await labels(page)
    expect(l).toContain('Level')
    expect(l).not.toContain('레벨')
  })

  test('an EN-fallback-listed template (equilibrium) opens in English even under a KO locale', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')

    // the equilibrium entry's KO menu name — resolve it from the store
    const koName = await page.evaluate(() => {
      const l = (window as unknown as { __loop: Loop }).__loop
      const t = l.i18n.getState()
      return t.activeCatalog['templates.equilibrium.name'] ?? 'Flowing equilibrium'
    })
    await pickTemplate(page, koName)

    const l = await labels(page)
    // canonical English labels ("Faucet", "Vault", "Split", "Refine", "Product", "Spill", "Consume")
    expect(l).toContain('Vault')
    expect(l).toContain('Refine')
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

  // #97 found a real autosave-restore defect — pin that "menu open is the ONLY
  // trigger" holds across a language switch AND a plain reload.
  test('a language switch and a plain reload never re-apply the overlay', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    // KO menu open ⇒ Korean labels
    await setLocale(page, 'ko')
    await pickTemplate(page, MMO_KO)
    expect(await labels(page)).toContain('레벨')

    // switch the app language to EN ⇒ the OPEN graph stays Korean
    await setLocale(page, 'en')
    expect(await labels(page)).toContain('레벨')
    expect(await labels(page)).not.toContain('Level')

    // let the autosave debounce persist, then a plain reload
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

    // boots in EN (persisted preference) and restores the KO-labelled graph —
    // the overlay is NOT run on autosave restore
    expect(await htmlLang(page)).toBe('en')
    const restored = await labels(page)
    expect(restored).toContain('레벨')
    expect(restored).toContain('15레벨 도달')
    expect(restored).not.toContain('Level')

    // and opening the English Template fresh from the menu now gives English
    await resetAll(page)
    await pickTemplate(page, MMO_EN)
    const en = await labels(page)
    expect(en).toContain('Level')
    expect(en).not.toContain('레벨')
  })
})
