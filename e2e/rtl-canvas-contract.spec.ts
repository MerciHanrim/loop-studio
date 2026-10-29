import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.2 / §L2.0a — the canvas is a SPACE, not a paragraph.
//
// THE CONTRACT (2026-10-29): the app's LAYOUT never mirrors — `<html dir>` is
// `LAYOUT_DIRECTION`, `ltr` for every locale — and only the TEXT of an RTL
// language reads right to left. So under the shipped Arabic (`ar`) nothing
// mirrors: not the chrome, not the canvas. The first describe block below holds
// that for the real locale, measured as boxes.
//
// THE CANVAS PIN IS KEPT AS ITS OWN ASSERTION. Node positions, pan, zoom, edge
// direction and the source/drain sides of a node face are graph coordinates;
// mirroring them would contradict the stored `x` of every node. The pin
// (`.react-flow { direction: ltr }`) is inert under a fixed LTR layout but is
// kept, so it stays correct if a mirrored mode ever returns. The second block
// therefore forces `<html dir="rtl">` ON PURPOSE — a stress state no locale
// produces any more — to prove the pin still breaks the cascade exactly at
// `.react-flow`.
//
// `@xyflow/react/dist/style.css` sets `direction: ltr` on `.react-flow` too —
// for free, from a vendor file, one line deep, in a dependency this repo
// upgrades like any other. `src/index.css` declares the same thing so the app
// OWNS the contract; delete the app's declaration and the vendor still carries
// it and the computed checks stay green, which is why the last test here reads
// the CASCADE and not only the computed value.

const DIR_ATTR = 'dir'

async function setDir(page: import('@playwright/test').Page, dir: 'ltr' | 'rtl') {
  await page.evaluate((d) => document.documentElement.setAttribute('dir', d), dir)
  // one layout pass, then read back — no sleep, the attribute is synchronous
  await expect(page.locator('html')).toHaveAttribute(DIR_ATTR, dir)
}

const dirOf = (page: import('@playwright/test').Page, selector: string) =>
  page.locator(selector).evaluate((el) => getComputedStyle(el).direction)

type Bridge = { __loop: { i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } } } }

async function switchLocale(page: import('@playwright/test').Page, code: string): Promise<void> {
  await page.evaluate((c) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale)).toBe(code)
}

/** each node's box relative to `.react-flow`, plus the canvas's own box in the viewport */
const canvasGeometry = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const flow = document.querySelector('.react-flow')!.getBoundingClientRect()
    return {
      canvas: [Math.round(flow.x), Math.round(flow.width)],
      nodes: Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
        const r = el.getBoundingClientRect()
        return [el.getAttribute('data-id'), Math.round(r.x - flow.x), Math.round(r.y - flow.y)]
      }),
    }
  })

test.describe('under the shipped Arabic nothing mirrors — chrome or canvas', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('under ar the chrome and the React Flow subtree both lay out ltr', async ({ page }) => {
    await switchLocale(page, 'ar')
    // the text direction is rtl (the attribute the chrome-text rule reads) …
    await expect(page.locator('html')).toHaveAttribute('data-text-dir', 'rtl')
    // … and nothing on the layout path takes it
    expect(await dirOf(page, 'html')).toBe('ltr')
    expect(await dirOf(page, '.app')).toBe('ltr')
    expect(await dirOf(page, '.canvas')).toBe('ltr')
    expect(await dirOf(page, '.react-flow')).toBe('ltr')
  })

  test('under ar the canvas stays where it is and no node moves inside it', async ({ page }) => {
    // Measured, not read from CSS: the canvas column's box in the viewport (the
    // chrome did not swap the panel and canvas columns) and every node's box
    // relative to `.react-flow` (the diagram did not mirror).
    const before = await canvasGeometry(page)
    expect(before.nodes.length, 'the default graph should have nodes').toBeGreaterThan(0)
    await switchLocale(page, 'ar')
    expect(await canvasGeometry(page)).toEqual(before)
  })
})

test.describe('the canvas pin holds even under a forced dir=rtl (a mirrored mode no locale produces)', () => {
  // `openApp` only — no `resetAll`. The default graph is what gives this spec
  // real nodes to measure, and an emptied canvas would make the geometry test
  // pass over nothing.
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('under a forced dir=rtl the chrome flips and the React Flow subtree does not', async ({ page }) => {
    expect(await dirOf(page, '.canvas')).toBe('ltr')
    expect(await dirOf(page, '.react-flow')).toBe('ltr')

    await setDir(page, 'rtl')

    // the break lands exactly on `.react-flow`
    expect(await dirOf(page, '.app')).toBe('rtl')
    expect(await dirOf(page, '.canvas')).toBe('rtl')
    expect(await dirOf(page, '.react-flow')).toBe('ltr')
  })

  test('the whole React Flow subtree inherits ltr, not just its root', async ({ page }) => {
    await setDir(page, 'rtl')
    for (const sel of [
      '.react-flow__renderer',
      '.react-flow__pane',
      '.react-flow__viewport',
      '.react-flow__nodes',
      '.react-flow__node >> nth=0',
    ]) {
      expect(await dirOf(page, sel), `${sel} must stay ltr`).toBe('ltr')
    }
  })

  test('node geometry inside the canvas is unchanged when the chrome is forced to mirror', async ({ page }) => {
    // The point of the pin: a diagram does not move even if the chrome ever
    // mirrors again.
    //
    // MEASURED RELATIVE TO `.react-flow`, not to the viewport. The first draft
    // of this test compared `getBoundingClientRect().x` and failed with every
    // node shifted by exactly +300 — which is correct behaviour, not a defect:
    // `.rightcol` is 300 px and swaps sides with `.canvas-col`, so the canvas
    // itself moves across the screen. What must not change is where a node sits
    // INSIDE the canvas, which is what the stored `x`/`y` drive.
    const offsets = () =>
      page.evaluate(() => {
        const origin = document.querySelector('.react-flow')!.getBoundingClientRect()
        return Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
          const r = el.getBoundingClientRect()
          return [el.getAttribute('data-id'), Math.round(r.x - origin.x), Math.round(r.y - origin.y)]
        })
      })

    const before = await offsets()
    expect(before.length, 'the default graph should have nodes').toBeGreaterThan(0)
    await setDir(page, 'rtl')
    expect(await offsets()).toEqual(before)
  })

  test('the canvas itself does move under the forced dir — the stress really mirrors the chrome', async ({ page }) => {
    // Without this, the test above would also pass if the forced `dir` did
    // nothing at all (the 58 logical properties are kept, so it still mirrors).
    const canvasX = () => page.locator('.react-flow').evaluate((el) => Math.round(el.getBoundingClientRect().x))
    const before = await canvasX()
    await setDir(page, 'rtl')
    const after = await canvasX()
    expect(after, 'the canvas column should swap sides with the panel').not.toBe(before)
  })

  test('the app declares the rule itself, so a vendor change cannot silently drop it', async ({
    page,
  }) => {
    // Read the CASCADE, not the computed value: the computed value stays `ltr`
    // on the vendor rule alone, so a computed-style check would attest to
    // someone else's decision.
    //
    // Ours is identified by `--ls-canvas-dir: owned`, declared in the same rule
    // in `src/index.css`, NOT by the stylesheet's URL. FALSIFIED: the first
    // draft filtered on `href` not containing "xyflow", deleting the app's
    // declaration left this green, because Vite serves CSS as an inline
    // `<style>` in dev and every sheet reports `href === null`.
    const rules = await page.evaluate(() => {
      const out: { ltr: boolean; owned: boolean }[] = []
      for (const sheet of Array.from(document.styleSheets)) {
        let list: CSSRuleList
        try {
          list = sheet.cssRules
        } catch {
          continue
        }
        const walk = (rs: CSSRuleList) => {
          for (const r of Array.from(rs)) {
            const nested = (r as CSSGroupingRule).cssRules
            if (nested) walk(nested)
            const style = (r as CSSStyleRule).style
            if (!style || (r as CSSStyleRule).selectorText !== '.react-flow') continue
            out.push({
              ltr: style.getPropertyValue('direction') === 'ltr',
              owned: style.getPropertyValue('--ls-canvas-dir').trim() === 'owned',
            })
          }
        }
        walk(list)
      }
      return out
    })

    expect(
      rules.some((r) => r.ltr),
      'no `.react-flow { direction: ltr }` rule found at all',
    ).toBe(true)
    expect(
      rules.some((r) => r.ltr && r.owned),
      'the app does not declare `.react-flow { direction: ltr }` itself — only @xyflow does, ' +
        'so a dependency upgrade could drop the canvas contract silently',
    ).toBe(true)
  })
})
