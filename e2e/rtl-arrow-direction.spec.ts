import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L9.3 — the arrow meaning units, at runtime.
//
// MEASURED, and it is the premise of the whole layer: none of these glyphs mirrors
// on its own. Unicode mirrors only characters carrying `Bidi_Mirrored` — brackets
// and relational operators — so an arrow keeps pointing the same way while the
// layout mirrors around it. Every arrow is therefore a product decision.
//
// The exhaustive layer is scripts/check-arrow-direction.mjs: 12 JSX sites all
// taking their character from one table, 10 keep literals in recorded places, no
// mirroring transform anywhere, and the catalogue contract across every registered
// locale. It can say "all of them"; a browser cannot.
//
// This file is the behaviour that a source check cannot see:
//
//   * the character on screen actually changes with the reader, and changes BACK
//   * undo and redo swap into each other and are still DISTINCT afterwards — the
//     failure a pair of independent literals produces is that both end up the same
//   * an arrow that KEEPS its glyph keeps it, so the first clause cannot be
//     satisfied by mirroring everything
//   * nothing is mirrored by a transform, read off the live computed style rather
//     than off the stylesheet
//
// Not every one of the 12 sites is driven here. Four live in the mobile sheet and
// one behind a spreadsheet import; reaching them costs a flow whose failure mode is
// the flow, not the glyph. They are covered exhaustively by the source check, and
// this is said plainly rather than left as a silent gap.

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    i18n: { getState: () => { activeLocale: string; setLocale: (c: string) => void } }
  }
}

/** the table, repeated here ON PURPOSE. A test that imported the same constant the
 *  component reads would agree with it by construction and prove nothing. */
const EXPECTED = {
  undo: { ltr: '↶', rtl: '↷' },
  redo: { ltr: '↷', rtl: '↶' },
  'submenu-disclosure': { ltr: '▸', rtl: '◂' },
  'external-link': { ltr: '↗', rtl: '↖' },
} as const

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
}

const textOf = (page: Page, sel: string) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel)

const UNDO = '.toolbar__actions-core button:nth-of-type(1)'
const REDO = '.toolbar__actions-core button:nth-of-type(2)'

test.describe('§L9.3 arrows — the glyph follows the reader, or deliberately does not', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('undo and redo swap, and stay distinct from each other', async ({ page }) => {
    // The whole reason both come out of one table. Two literals in two files drift
    // into each other: mirror undo, forget redo, and both read `↷`.
    expect(await textOf(page, UNDO)).toBe(EXPECTED.undo.ltr)
    expect(await textOf(page, REDO)).toBe(EXPECTED.redo.ltr)

    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')

    const undoRtl = await textOf(page, UNDO)
    const redoRtl = await textOf(page, REDO)
    expect(undoRtl).toBe(EXPECTED.undo.rtl)
    expect(redoRtl).toBe(EXPECTED.redo.rtl)
    // each became the OTHER's ltr glyph, and they are still opposite
    expect(undoRtl).toBe(EXPECTED.redo.ltr)
    expect(redoRtl).toBe(EXPECTED.undo.ltr)
    expect(undoRtl).not.toBe(redoRtl)
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

    // COLLAPSE one head first. An expanded head renders `▾`, the disclosure-vertical
    // unit, which does not mirror - so with every panel open this test would assert
    // the mirroring of a caret that is not on screen, and pass on the undo/redo pair
    // alone. The inline-end caret has to be rendered for the claim to mean anything.
    await page.locator('.mpanel__toggle').first().click()
    await expect
      .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.mpanel__caret')).map((e) => e.textContent?.trim())))
      .toContain('▸')

    const snapshot = () =>
      page.evaluate(() => ({
        undo: document.querySelector('.toolbar__actions-core button:nth-of-type(1)')?.textContent?.trim() ?? null,
        redo: document.querySelector('.toolbar__actions-core button:nth-of-type(2)')?.textContent?.trim() ?? null,
        carets: Array.from(document.querySelectorAll('.mpanel__caret')).map((e) => e.textContent?.trim() ?? ''),
      }))

    const before = await snapshot()
    expect(before.carets, 'a collapsed head must render the inline-end caret').toContain(
      EXPECTED['submenu-disclosure'].ltr,
    )

    await switchLocale(page, 'ar-XB')
    const during = await snapshot()
    expect(during).not.toEqual(before)
    // the caret specifically moved, not just the undo/redo pair
    expect(during.carets, 'the collapsed head caret mirrors').toContain(EXPECTED['submenu-disclosure'].rtl)
    // a collapsed head shows the inline-end caret, which mirrors; an expanded one
    // shows `▾`, the disclosure-vertical unit, which does not
    for (const c of during.carets) {
      expect([EXPECTED['submenu-disclosure'].rtl, '▾']).toContain(c)
    }
    expect(during.carets).not.toContain(EXPECTED['submenu-disclosure'].ltr)

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
    // §L9.3 — the transport sits with the physical time axis, so `⏭` still advances
    // in the direction the timeline runs.
    const before = await page.evaluate(() => ({
      reset: document.querySelector('.pstrip__reset')?.textContent?.trim() ?? null,
      step: document.querySelector('.pstrip__step-btn')?.textContent?.trim() ?? null,
      all: Array.from(document.querySelectorAll('.pstrip button')).map((b) => b.textContent?.trim() ?? ''),
    }))
    await switchLocale(page, 'ar-XB')
    const after = await page.evaluate(() => ({
      reset: document.querySelector('.pstrip__reset')?.textContent?.trim() ?? null,
      step: document.querySelector('.pstrip__step-btn')?.textContent?.trim() ?? null,
      all: Array.from(document.querySelectorAll('.pstrip button')).map((b) => b.textContent?.trim() ?? ''),
    }))
    expect(after.all).toEqual(before.all)
    expect(before.all.join('')).toContain('⏭')
    expect(before.all.join('')).toContain('⟲')
  })

  test('nothing is mirrored by a transform — read off the live computed style', async ({ page }) => {
    // The source check bans the pattern in the stylesheet and the components; this
    // reads what the browser actually resolved, which also covers a transform that
    // arrived from a dependency's stylesheet.
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
      return bad
    })
    expect(flipped, 'an arrow must be a character, not a flipped box').toEqual([])
  })
})
