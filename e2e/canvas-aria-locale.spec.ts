import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md Slice 2b — React Flow's own built-in a11y strings are
// localized through the single `ariaLabelConfig` prop on <ReactFlow>.
//
// That object is memoized on `t` so React Flow's `StoreUpdater` stops writing a
// fresh object into its store on every render. `t`'s identity is keyed on
// `[activeLocale, activeCatalog]`, which `setLocale` commits in ONE set (§L4.5),
// so it moves on a language switch and on a lazily-loaded catalog arriving.
// Memoizing on `[]`, or on the locale without the catalog, would freeze these
// strings at whatever language happened to render first — and nothing else in
// the suite would notice, because they are only exposed to assistive tech.
//
// This asserts the strings a user of a screen reader actually receives: they
// must equal the ACTIVE catalog's values at every step, not merely change.

type Bridge = {
  __loop: { i18n: { getState: () => { activeCatalog: Record<string, string>; activeLocale: string } } }
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

/** What React Flow actually puts in the DOM from `ariaLabelConfig`.
 *
 *  Only these are observable in this app: `Canvas` renders
 *  `<Controls showInteractive={false} showFitView={false}>` with its own
 *  Reset-view button, the MiniMap is given an explicit `ariaLabel`, and React
 *  Flow 12 never reads `handle.ariaLabel` at all. Asserting on those would be
 *  asserting on `null === null`. */
const ariaStrings = (page: Page) =>
  page.evaluate(() => {
    const attr = (sel: string, a: string) => document.querySelector(sel)?.getAttribute(a) ?? null
    const desc = (prefix: string) =>
      [...document.querySelectorAll('div[id]')].find((d) => d.id.startsWith(prefix))?.textContent ?? null
    return {
      controls: attr('.react-flow__controls', 'aria-label'),
      zoomInLabel: attr('.react-flow__controls-zoomin', 'aria-label'),
      zoomInTitle: attr('.react-flow__controls-zoomin', 'title'),
      zoomOutLabel: attr('.react-flow__controls-zoomout', 'aria-label'),
      zoomOutTitle: attr('.react-flow__controls-zoomout', 'title'),
      nodeDesc: desc('react-flow__node-desc'),
      edgeDesc: desc('react-flow__edge-desc'),
    }
  })

const catalog = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeCatalog)

/** open Settings ▾ if needed, then pick a locale from the language menu — the
 *  real control, not the store (mirrors `i18n.spec.ts`). */
async function pickLocale(page: Page, code: string) {
  const trigger = page.locator('.lang-switch').first()
  let openedSettings = false
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__actions .menu > button', { hasText: /^(Settings|설정|設定) ▾$/ }).click()
    openedSettings = true
  }
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const item = page.locator(`.lang-menu__item[data-locale="${code}"]`)
  await expect(item).toBeVisible()
  await item.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  // the switch is atomic and only lands once the catalog has loaded (§L4.5)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
  if (openedSettings) await page.keyboard.press('Escape')
}

test.describe("React Flow's ARIA strings follow a language switch", () => {
  test('§L-2b — switching language while the Canvas is mounted re-localizes every observable React Flow ARIA string', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    const en = await ariaStrings(page)
    const enCat = await catalog(page)

    // Control precondition: the surfaces this test reads must actually be in the
    // DOM in English. If a React Flow upgrade stops rendering one of them, this
    // fails loudly instead of the test quietly asserting null === null forever.
    for (const [k, v] of Object.entries(en)) expect(v, `${k} must be rendered`).toBeTruthy()
    expect(en.controls).toBe(enCat['rf.controls.label'])
    expect(en.zoomInLabel).toBe(enCat['rf.controls.zoomIn'])
    expect(en.zoomOutLabel).toBe(enCat['rf.controls.zoomOut'])
    expect(en.edgeDesc).toBe(enCat['rf.edge.a11y'])

    // React Flow picks one of the two node descriptions depending on its own
    // keyboard-a11y flag; resolve which key it used once, in English, rather
    // than hard-coding the choice here.
    const nodeDescKey = (['rf.node.a11yKeyboard', 'rf.node.a11y'] as const).find(
      (k) => enCat[k] === en.nodeDesc,
    )
    expect(nodeDescKey, 'the node description must come from one of the two rf.node.* strings').toBeTruthy()

    const assertMatchesActiveCatalog = async (code: string) => {
      const now = await ariaStrings(page)
      const cat = await catalog(page)
      expect(await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale)).toBe(code)
      expect(now.controls, `controls @ ${code}`).toBe(cat['rf.controls.label'])
      expect(now.zoomInLabel, `zoom-in label @ ${code}`).toBe(cat['rf.controls.zoomIn'])
      expect(now.zoomInTitle, `zoom-in title @ ${code}`).toBe(cat['rf.controls.zoomIn'])
      expect(now.zoomOutLabel, `zoom-out label @ ${code}`).toBe(cat['rf.controls.zoomOut'])
      expect(now.zoomOutTitle, `zoom-out title @ ${code}`).toBe(cat['rf.controls.zoomOut'])
      expect(now.nodeDesc, `node description @ ${code}`).toBe(cat[nodeDescKey!])
      expect(now.edgeDesc, `edge description @ ${code}`).toBe(cat['rf.edge.a11y'])
      return now
    }

    await pickLocale(page, 'ko')
    const ko = await assertMatchesActiveCatalog('ko')
    // and they really moved — a catalog that happened to equal English would
    // make the assertions above pass without anything being re-localized
    for (const k of Object.keys(en) as (keyof typeof en)[])
      expect(ko[k], `${k} must differ from English after switching to ko`).not.toBe(en[k])

    await pickLocale(page, 'ja')
    const ja = await assertMatchesActiveCatalog('ja')
    for (const k of Object.keys(en) as (keyof typeof en)[])
      expect(ja[k], `${k} must differ from Korean after switching to ja`).not.toBe(ko[k])

    // and back — no drift, no stale value left behind
    await pickLocale(page, 'en')
    expect(await assertMatchesActiveCatalog('en')).toEqual(en)
  })
})
