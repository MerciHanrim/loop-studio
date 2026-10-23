import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { pickLocale } from './support/workbenchMenus'

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
 *  Only these are observable in this app: the node and edge descriptions,
 *  everywhere; and React Flow's `<Controls>` (zoom in / out and the rail's own
 *  label) on the phone only — the desktop workbench has no Controls rail, its
 *  zoom is in the status bar (docs/workbench.md §WB8). React Flow 12 never
 *  reads `handle.ariaLabel` at all. Asserting on those would be asserting on `null === null`. */
const ariaStrings = (page: Page) =>
  page.evaluate(() => {
    const desc = (prefix: string) =>
      [...document.querySelectorAll('div[id]')].find((d) => d.id.startsWith(prefix))?.textContent ?? null
    return {
      nodeDesc: desc('react-flow__node-desc'),
      edgeDesc: desc('react-flow__edge-desc'),
    }
  })
const controlsStrings = (page: Page) =>
  page.evaluate(() => {
    const attr = (sel: string, a: string) => document.querySelector(sel)?.getAttribute(a) ?? null
    return {
      controls: attr('.react-flow__controls', 'aria-label'),
      zoomInLabel: attr('.react-flow__controls-zoomin', 'aria-label'),
      zoomInTitle: attr('.react-flow__controls-zoomin', 'title'),
      zoomOutLabel: attr('.react-flow__controls-zoomout', 'aria-label'),
      zoomOutTitle: attr('.react-flow__controls-zoomout', 'title'),
    }
  })

const catalog = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeCatalog)

test.describe("React Flow's ARIA strings follow a language switch", () => {
  test('§L-2b — on the phone, React Flow\'s Controls strings follow a language switch made while the Canvas is mounted', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    const en = await controlsStrings(page)
    const enCat = await catalog(page)
    // precondition: rendered, so nothing below asserts null === null
    for (const [k, v] of Object.entries(en)) expect(v, `${k} must be rendered on the phone`).toBeTruthy()
    const matches = async (code: string) => {
      const now = await controlsStrings(page)
      const cat = await catalog(page)
      expect(now.controls, `controls @ ${code}`).toBe(cat['rf.controls.label'])
      expect(now.zoomInLabel, `zoom-in label @ ${code}`).toBe(cat['rf.controls.zoomIn'])
      expect(now.zoomInTitle, `zoom-in title @ ${code}`).toBe(cat['rf.controls.zoomIn'])
      expect(now.zoomOutLabel, `zoom-out label @ ${code}`).toBe(cat['rf.controls.zoomOut'])
      expect(now.zoomOutTitle, `zoom-out title @ ${code}`).toBe(cat['rf.controls.zoomOut'])
      return now
    }
    expect(await matches('en')).toEqual(en)
    expect(en.controls).toBe(enCat['rf.controls.label'])
    await pickLocale(page, 'ko')
    const ko = await matches('ko')
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ko[k], `${k} must differ from English after switching to ko`).not.toBe(en[k])
    await pickLocale(page, 'en')
    expect(await matches('en')).toEqual(en)
  })

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
    // the desktop workbench renders no Controls rail (its zoom is the status
    // bar's): the rail's strings are checked on the phone, above
    expect(await page.locator('.react-flow__controls').count()).toBe(0)
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

    // §L2.0 (2026-10): en and ko are the only shipped languages, so the
    // non-English → non-English hop (ko → ja) retired with Japanese.

    // and back — no drift, no stale value left behind
    await pickLocale(page, 'en')
    expect(await assertMatchesActiveCatalog('en')).toEqual(en)
  })
})
