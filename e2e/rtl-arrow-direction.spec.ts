import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openInputsTab } from './support/workbenchMenus'

// docs/localization.md §L9.3 / §L2.0a — the arrow meaning units, at runtime.
//
// THE CONTRACT (2026-10-29): the LAYOUT never mirrors — it is LTR for every
// locale — and only the TEXT of an RTL language reads right to left. An arrow
// ICON points along the layout (a submenu still opens to the right, undo / redo
// still sit in the layout's order), so under the shipped Arabic (`ar`) every
// icon keeps its LTR drawing. These tests run under `ar`, the locale a reader
// sees; `ar-XB` (the pseudo-locale) is only for the switch itself
// (rtl-locale-direction.spec.ts).
//
// MEASURED, and it is the premise of the whole layer: none of these glyphs mirrors
// on its own. Unicode mirrors only characters carrying `Bidi_Mirrored` — brackets
// and relational operators — so an arrow keeps pointing the same way inside an
// RTL paragraph. Every arrow is therefore a product decision.
//
// Since issue #298 the arrows that are ICONS (external link, submenu disclosure,
// undo, redo) are drawn by `ArrowIcon` (src/ui/icons.tsx), which ships two
// drawings and picks one by the LAYOUT direction (`LAYOUT_DIRECTION`); the choice
// is readable as `data-dir` on the icon. The RTL drawings are kept, inert, for a
// mirrored layout that no locale produces now. The arrows that are CHARACTERS
// inside sentences (`→` / `←`) still come from `useArrowGlyph` and follow the
// TEXT direction.
//
// The exhaustive layer is scripts/check-arrow-direction.mjs: every mirroring icon
// site is an `ArrowIcon`, every mirroring character comes from the one table, the
// keep glyphs stay literal in recorded places, no mirroring transform anywhere,
// and the catalogue contract across every registered locale. It can say "all of
// them"; a browser cannot.
//
// This file is the behaviour that a source check cannot see:
//
//   * the drawing on screen does NOT change with an RTL reader, through a round
//     trip — the icons follow the layout, and the layout is fixed
//   * undo and redo keep their own drawings and stay DISTINCT — the failure a
//     pair of independent drawings produces is that both end up the same
//   * the arrows that keep their orientation for every reader keep it
//   * nothing is mirrored by a transform, read off the live computed style rather
//     than off the stylesheet

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    i18n: { getState: () => { activeLocale: string; setLocale: (c: string) => void } }
  }
}

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
}

/** the icon's unit, direction and the path data it is drawn with */
type ArrowRead = { unit: string | null; dir: string | null; d: string } | null
const arrowOf = (page: Page, sel: string): Promise<ArrowRead> =>
  page.evaluate((s) => {
    const svg = document.querySelector(s)?.querySelector('svg[data-arrow]')
    if (!svg) return null
    return {
      unit: svg.getAttribute('data-arrow'),
      dir: svg.getAttribute('data-dir'),
      d: Array.from(svg.querySelectorAll('path'))
        .map((p) => p.getAttribute('d') ?? '')
        .join(' '),
    }
  }, sel)

// the workbench (2026-10): Undo and Redo are the tool row's, drawing the same
// two arrow units (Toolbar.tsx `ArrowIcon unit="undo" | "redo"`)
const UNDO = '.wb-toolrow button:has(svg[data-arrow="undo"])'
const REDO = '.wb-toolrow button:has(svg[data-arrow="redo"])'

/** the TEXT direction became rtl while the LAYOUT stayed ltr — the state every
 *  test below measures in, asserted so a no-op switch cannot pass them */
async function expectArabicReader(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-text-dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
}

test.describe('§L9.3 arrows — the icons follow the fixed layout, not the reader', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('undo and redo keep their layout drawings under ar, and stay distinct from each other', async ({ page }) => {
    // Undo / redo sit in the layout's order, and the layout does not mirror for an
    // RTL reader — so each keeps the drawing it has for an English reader, and
    // the two must still be OPPOSITE, not equal.
    const undoLtr = await arrowOf(page, UNDO)
    const redoLtr = await arrowOf(page, REDO)
    expect(undoLtr).toMatchObject({ unit: 'undo', dir: 'ltr' })
    expect(redoLtr).toMatchObject({ unit: 'redo', dir: 'ltr' })
    expect(undoLtr!.d).not.toBe(redoLtr!.d)

    await switchLocale(page, 'ar')
    await expectArabicReader(page)

    const undoAr = await arrowOf(page, UNDO)
    const redoAr = await arrowOf(page, REDO)
    // the same unit, the same (layout) direction, the same path data
    expect(undoAr).toEqual(undoLtr)
    expect(redoAr).toEqual(redoLtr)
    expect(undoAr!.d).not.toBe(redoAr!.d)
  })

  test('en → ar → en leaves every reachable arrow exactly as it was', async ({ page }) => {
    await resetAll(page)
    // a parameter makes the model panels appear, which is where the collapsed
    // panel head renders a submenu-disclosure caret
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.addNodeAt('parameter', { x: 0, y: 0 })
    })
    // the model panels are the left list's Inputs tab (docs/workbench.md §WB5)
    await openInputsTab(page)
    await expect(page.locator('.wb-left .mpanels')).toBeVisible()

    // COLLAPSE one head first. An expanded head renders the downward chevron, which
    // has no direction at all — so with every panel open this test would assert
    // the drawing of a caret that is not on screen, and pass on the undo/redo pair
    // alone. The inline-end caret has to be rendered for the claim to mean anything.
    await page.locator('.mpanel__toggle').first().click()
    await expect(page.locator('.mpanel__caret svg[data-arrow="submenu"]').first()).toBeVisible()

    const snapshot = () =>
      page.evaluate(() => ({
        undo: document.querySelector('.wb-toolrow svg[data-arrow="undo"]')?.getAttribute('data-dir') ?? null,
        redo: document.querySelector('.wb-toolrow svg[data-arrow="redo"]')?.getAttribute('data-dir') ?? null,
        carets: Array.from(document.querySelectorAll('.mpanel__caret svg')).map((e) => `${e.getAttribute('data-icon')}:${e.getAttribute('data-dir') ?? 'any'}`),
      }))

    const before = await snapshot()
    expect(before.carets, 'a collapsed head must render the inline-end caret').toContain('submenu:ltr')

    await switchLocale(page, 'ar')
    await expectArabicReader(page)
    const during = await snapshot()
    // nothing changed: the caret keeps pointing to the inline end of a layout
    // that did not mirror, and so do undo / redo
    expect(during).toEqual(before)
    expect(during.carets, 'the collapsed head caret keeps the ltr drawing').toContain('submenu:ltr')
    expect(during.carets).not.toContain('submenu:rtl')

    await switchLocale(page, 'en')
    expect(await snapshot()).toEqual(before)
  })

  test('the graph-relation arrow does NOT mirror under ar — it names what the canvas draws', async ({ page }) => {
    // This arrow describes the same edge the canvas draws, and the canvas is pinned
    // ltr (§L9.2), so a panel turning it around for an RTL reader would contradict
    // the picture. It is a character in an Arabic row, so this is the TEXT layer.
    await resetAll(page)
    await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      g().addNodeAt('parameter', { x: 480, y: 0 })
      const [src, pool, rate] = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(rate, { label: 'Rate', value: 5 })
      g().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@${rate}` })
    })
    await openInputsTab(page)
    const row = page.locator('.mp-row--flow .mp-row__label')
    await expect(row).toBeVisible()

    await switchLocale(page, 'ar')
    await expectArabicReader(page)
    const text = (await row.textContent()) ?? ''
    expect(text).toContain('→')
    expect(text).not.toContain('←')
  })

  test('the transport controls keep their physical orientation', async ({ page }) => {
    // §L9.3 — the transport sits with the physical time axis, so Step still
    // advances in the direction the timeline runs: its icon carries no direction
    // and its drawing is byte-identical for both readers.
    const read = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.pstrip button svg')).map((svg) => ({
          icon: svg.getAttribute('data-icon'),
          arrow: svg.getAttribute('data-arrow'),
          d: Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d')).join(' '),
        })),
      )
    const before = await read()
    expect(before.map((s) => s.icon)).toEqual(expect.arrayContaining(['run-reset', 'run-step', 'run-play']))
    expect(before.every((s) => s.arrow === null), 'no transport icon is a direction-aware arrow').toBe(true)
    await switchLocale(page, 'ar')
    await expectArabicReader(page)
    expect(await read()).toEqual(before)
  })

  test('nothing is mirrored by a transform — read off the live computed style', async ({ page }) => {
    // The source check bans the pattern in the stylesheet and the components; this
    // reads what the browser actually resolved, which also covers a transform that
    // arrived from a dependency's stylesheet — and an SVG `transform` attribute.
    await switchLocale(page, 'ar')
    await expectArabicReader(page)

    const flipped = await page.evaluate(() => {
      const bad: { tag: string; cls: string; transform: string }[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const t = getComputedStyle(el as Element).transform
        if (!t || t === 'none') continue
        // a 2-D matrix is matrix(a, b, c, d, e, f); `a` is the x scale, and a
        // horizontal flip is what makes it negative
        const m = /^matrix\(([-\d.]+)/.exec(t)
        if (m && Number(m[1]) < 0) {
          bad.push({ tag: el.tagName, cls: (el as HTMLElement).className?.toString?.() ?? '', transform: t })
        }
      }
      for (const el of Array.from(document.querySelectorAll('svg[data-arrow] *'))) {
        if (el.hasAttribute('transform')) bad.push({ tag: el.tagName, cls: 'svg transform attribute', transform: el.getAttribute('transform') ?? '' })
      }
      return bad
    })
    expect(flipped, 'an arrow is a drawing of its own, not a flipped box').toEqual([])
  })
})
