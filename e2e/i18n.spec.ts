import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md Slice 1 — the i18n base on the Toolbar + Play bar.
//   • the language control switches the UI language immediately, atomically;
//   • `<html lang>` tracks the active locale;
//   • the choice is persisted at `loop-studio/ui-locale/1`, and a corrupt /
//     unregistered stored value is ignored (browser locale → en);
//   • `?lang=<code>` forces a locale WITHOUT touching localStorage (§L11);
//   • §L12 #5 — a locale switch (any number of times) moves NOTHING that
//     belongs to the document or the committed engine result.
// The full per-locale × device visual matrix is Slice 3.

type Bridge = {
  __loop: Record<string, { getState: () => any }> & {
    revisionIO: { currentTargetDigest: () => string }
    rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: unknown, o?: unknown) => void }
  }
}

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
  ],
})

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

/** the language control cycles registered locales; click until `<html lang>`
 *  matches (bounded). Works for the desktop toolbar and the mobile More sheet. */
async function setLocale(page: Page, code: string, scope = '') {
  for (let i = 0; i < 4 && (await htmlLang(page)) !== code; i++) {
    await page.locator(`${scope} .lang-switch`.trim()).first().click()
    await page.waitForTimeout(80)
  }
  await expect.poll(() => htmlLang(page)).toBe(code)
}

/** every document-owned + committed-engine surface, normalised (§L12 #5) */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      graph: JSON.stringify({
        nodes: g.nodes.map((n: any) => [n.id, n.type, n.position, n.data]),
        edges: g.edges.map((e: any) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data]),
      }),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      simulationRev: g.simulationRev,
      viewport: l.rf.getViewport(),
      d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
      values: s.values,
      stepIndex: s.stepIndex,
      status: s.status,
    }
  })

test.describe('i18n — Slice 1 (desktop Toolbar + Play bar)', () => {
  test('the language control switches the UI immediately and sets <html lang>', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    expect(await htmlLang(page)).toBe('en')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ Play')
    await expect(page.locator('.toolbar__tag')).toHaveText('preview')

    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await stored(page)).toBe('ko')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ 재생')
    await expect(page.locator('.toolbar__tag')).toHaveText('미리보기')
    await expect(page.locator('.toolbar__palette .chip--pool')).toContainText('풀')

    await setLocale(page, 'en')
    await expect.poll(() => htmlLang(page)).toBe('en')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ Play')
  })

  test('creating a node in a Korean UI stores the locale-independent default label', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ko')
    await expect.poll(() => htmlLang(page)).toBe('ko')

    await page.locator('.toolbar__palette .chip--source').click()
    const label = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return g.nodes[g.nodes.length - 1]?.data?.label
    })
    expect(label).toBe('Source') // NOT '소스' — model data is not translated (§L3.4)
  })

  test('a locale switch (×4) moves no GraphDoc / digest / undo / viewport / SimState', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance()
      s.advance()
    })
    await page.evaluate(() =>
      (window as unknown as Bridge).__loop.rf.setViewport({ x: 37, y: -12, zoom: 0.8 }, { duration: 0 }),
    )
    const before = await snapshot(page)

    for (const code of ['ko', 'en', 'ko', 'en']) {
      await setLocale(page, code)
      await expect.poll(() => htmlLang(page)).toBe(code)
    }

    expect(await snapshot(page)).toEqual(before) // byte-for-byte
  })

  test('?lang= forces a locale without touching localStorage; a corrupt stored value is ignored', async ({ page }) => {
    await page.goto('/?lang=ko')
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await stored(page)).toBeNull()

    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'KO_bad_value'))
    await page.goto('/')
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await htmlLang(page)).toBe('en') // fell through to the browser locale → en
    expect(await stored(page)).toBe('KO_bad_value') // left exactly as it was
  })
})

test.describe('i18n — Slice 1 (mobile switch, in the More sheet)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the language control in the More menu switches the UI', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    expect(await htmlLang(page)).toBe('en')

    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet')).toBeVisible()
    await setLocale(page, 'ko', '.sheet')

    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await stored(page)).toBe('ko')
    await expect(page.locator('.toolbar__vr')).toHaveText('보기 및 실행 — 편집은 데스크톱에서')
  })
})
