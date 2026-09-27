import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.2 — the canvas is a SPACE, not a paragraph.
//
// `<html dir>` follows the UI language, so shipping any RTL locale mirrors the
// app chrome. The React Flow subtree must NOT mirror with it: node positions,
// pan, zoom, edge direction and the source/drain sides of a node face are graph
// coordinates, and mirroring them would contradict the stored `x` of every
// node.
//
// WHY THIS SPEC EXISTS EVEN THOUGH NO RTL LOCALE SHIPS YET
//
// `@xyflow/react/dist/style.css` sets `direction: ltr` on `.react-flow`, so the
// split already holds today — for free, from a vendor file, one line deep, in a
// dependency this repo upgrades like any other. `src/index.css` now declares
// the same thing so the app OWNS the contract; this spec is what makes the
// ownership real. Delete the app's declaration and the vendor still carries it
// and this stays green, which is why the last test here reads the CASCADE and
// not only the computed value.
//
// It sets `dir` on the document directly rather than switching to a locale.
// That is exactly what `src/i18n/store.ts` does from a registry entry's
// `direction`, it needs no Arabic catalog, and it writes nothing to storage —
// so this spec is a standalone check, not another arm of a locale loop.

const DIR_ATTR = 'dir'

async function setDir(page: import('@playwright/test').Page, dir: 'ltr' | 'rtl') {
  await page.evaluate((d) => document.documentElement.setAttribute('dir', d), dir)
  // one layout pass, then read back — no sleep, the attribute is synchronous
  await expect(page.locator('html')).toHaveAttribute(DIR_ATTR, dir)
}

const dirOf = (page: import('@playwright/test').Page, selector: string) =>
  page.locator(selector).evaluate((el) => getComputedStyle(el).direction)

test.describe('the canvas keeps its own direction when the chrome mirrors', () => {
  // `openApp` only — no `resetAll`. The default graph is what gives this spec
  // real nodes to measure, and an emptied canvas would make the geometry test
  // pass over nothing.
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('under dir=rtl the chrome flips and the React Flow subtree does not', async ({ page }) => {
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

  test('node geometry inside the canvas is unchanged when the chrome mirrors', async ({ page }) => {
    // The point of the contract: a diagram does not move when the reader's
    // script changes.
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

  test('the canvas itself does move — the chrome really is mirroring', async ({ page }) => {
    // Without this, the test above would also pass if `dir` did nothing at all.
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
