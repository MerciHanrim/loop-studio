import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L9.3 — the arrow meaning units, at runtime.
//
// MEASURED, and it is the premise of the whole layer: none of these glyphs mirrors
// on its own. Unicode mirrors only characters carrying `Bidi_Mirrored` — brackets
// and relational operators — so an arrow keeps pointing the same way while the
// layout mirrors around it. Every arrow is therefore a product decision.
//
// Since issue #298 the arrows that are ICONS (external link, submenu disclosure,
// undo, redo) are drawn by `ArrowIcon` (src/ui/icons.tsx), which ships two
// drawings and picks one by the reader's direction; the choice is readable as
// `data-dir` on the icon. The arrows that are CHARACTERS inside sentences
// (`→` / `←`) still come from `useArrowGlyph`.
//
// The exhaustive layer is scripts/check-arrow-direction.mjs: every mirroring icon
// site is an `ArrowIcon`, every mirroring character comes from the one table, the
// keep glyphs stay literal in recorded places, no mirroring transform anywhere,
// and the catalogue contract across every registered locale. It can say "all of
// them"; a browser cannot.
//
// This file is the behaviour that a source check cannot see:
//
//   * the drawing on screen actually changes with the reader, and changes BACK
//   * undo and redo swap into each other and are still DISTINCT afterwards — the
//     failure a pair of independent drawings produces is that both end up the same
//   * an arrow that KEEPS its orientation keeps it, so the first clause cannot be
//     satisfied by mirroring everything
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

const UNDO = '.toolbar__actions-core button:nth-of-type(1)'
const REDO = '.toolbar__actions-core button:nth-of-type(2)'

test.describe('§L9.3 arrows — the drawing follows the reader, or deliberately does not', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('undo and redo swap, and stay distinct from each other', async ({ page }) => {
    // The whole reason both come out of one table: under an rtl reader undo curves
    // the other way, and it must still be the OPPOSITE of redo, not equal to it.
    const undoLtr = await arrowOf(page, UNDO)
    const redoLtr = await arrowOf(page, REDO)
    expect(undoLtr).toMatchObject({ unit: 'undo', dir: 'ltr' })
    expect(redoLtr).toMatchObject({ unit: 'redo', dir: 'ltr' })
    expect(undoLtr!.d).not.toBe(redoLtr!.d)

    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')

    const undoRtl = await arrowOf(page, UNDO)
    const redoRtl = await arrowOf(page, REDO)
    expect(undoRtl).toMatchObject({ unit: 'undo', dir: 'rtl' })
    expect(redoRtl).toMatchObject({ unit: 'redo', dir: 'rtl' })
    // each is now drawn the way the OTHER was drawn for an ltr reader, and they are
    // still opposite (compared as path tokens: the derived drawing is spaced
    // differently from the authored one)
    const tokens = (d: string) => d.match(/[A-Za-z]|-?[\d.]+/g)
    expect(tokens(undoRtl!.d)).toEqual(tokens(redoLtr!.d))
    expect(tokens(redoRtl!.d)).toEqual(tokens(undoLtr!.d))
    expect(tokens(undoRtl!.d)).not.toEqual(tokens(redoRtl!.d))
  })

  test('en → ar-XB → en puts every reachable arrow back exactly', async ({ page }) => {
    await resetAll(page)
    // a parameter makes the model panels appear, which is where the collapsed
    // panel head renders a submenu-disclosure caret
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.addNodeAt('parameter', { x: 0, y: 0 })
    })
    await expect(page.locator('.rightcol .mpanels')).toBeVisible()

    // COLLAPSE one head first. An expanded head renders the downward chevron, which
    // does not mirror — so with every panel open this test would assert the
    // mirroring of a caret that is not on screen, and pass on the undo/redo pair
    // alone. The inline-end caret has to be rendered for the claim to mean anything.
    await page.locator('.mpanel__toggle').first().click()
    await expect(page.locator('.mpanel__caret svg[data-arrow="submenu"]').first()).toBeVisible()

    const snapshot = () =>
      page.evaluate(() => ({
        undo: document.querySelector('.toolbar__actions-core button:nth-of-type(1) svg')?.getAttribute('data-dir') ?? null,
        redo: document.querySelector('.toolbar__actions-core button:nth-of-type(2) svg')?.getAttribute('data-dir') ?? null,
        carets: Array.from(document.querySelectorAll('.mpanel__caret svg')).map((e) => `${e.getAttribute('data-icon')}:${e.getAttribute('data-dir') ?? 'any'}`),
      }))

    const before = await snapshot()
    expect(before.carets, 'a collapsed head must render the inline-end caret').toContain('submenu:ltr')

    await switchLocale(page, 'ar-XB')
    const during = await snapshot()
    expect(during).not.toEqual(before)
    // the caret specifically moved, not just the undo/redo pair
    expect(during.carets, 'the collapsed head caret mirrors').toContain('submenu:rtl')
    // a collapsed head shows the inline-end caret, which mirrors; an expanded one
    // shows the downward chevron, which has no direction at all
    for (const c of during.carets) expect(['submenu:rtl', 'chevron-down:any']).toContain(c)
    expect(during.carets).not.toContain('submenu:ltr')

    await switchLocale(page, 'en')
    expect(await snapshot()).toEqual(before)
  })

  test('the graph-relation arrow does NOT mirror — it names what the canvas draws', async ({ page }) => {
    // Without this the mirroring clause could be satisfied by flipping everything.
    // This arrow describes the same edge the canvas draws, and the canvas is pinned
    // ltr (§L9.2), so a panel reading it right to left would contradict the picture.
    await resetAll(page)
    await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      g().addNodeAt('parameter', { x: 480, y: 0 })
      const [src, pool, rate] = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(rate, { label: 'Rate', value: 5 })
      g().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' })
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@${rate}` })
    })
    const row = page.locator('.mp-row--flow .mp-row__label')
    await expect(row).toBeVisible()

    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')
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
    expect(before.map((s) => s.icon)).toEqual(expect.arrayContaining(['reset', 'step', 'play']))
    expect(before.every((s) => s.arrow === null), 'no transport icon is a direction-aware arrow').toBe(true)
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')
    expect(await read()).toEqual(before)
  })

  test('nothing is mirrored by a transform — read off the live computed style', async ({ page }) => {
    // The source check bans the pattern in the stylesheet and the components; this
    // reads what the browser actually resolved, which also covers a transform that
    // arrived from a dependency's stylesheet — and an SVG `transform` attribute.
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')

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
