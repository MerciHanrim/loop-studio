import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/template-label-overlay.md — the shared fresh-open Template label overlay:
// a bundled Template opens with the current locale's node `label`s; the overlay
// is never re-applied to an already-open document, and never applied to an
// Import / Share / Workspace / autosave document.

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
})
