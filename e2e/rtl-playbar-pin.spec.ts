import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'
import { readParagraph } from './support/textDirection'

// docs/localization.md §L9.3 / §L2.0a — the playbar keeps its PHYSICAL button
// order for every reader, because the transport sits with the physical time
// axis: `⏭` must still advance in the direction the timeline runs.
//
// THE CONTRACT (2026-10-29): the LAYOUT never mirrors — `<html dir>` is `ltr`
// for every locale — and only the TEXT of an RTL language reads right to left.
// So under the shipped Arabic (`ar`) the strip's order is physical simply
// because nothing mirrors. The mirrored-layout pin in src/index.css
// (`[dir='rtl'] .pstrip … { flex-direction: row-reverse; --ls-pstrip-order:
// physical }`) is kept, INERT: it only applies under a `dir="rtl"` ancestor,
// which no locale produces now, so its ownership mark reads empty under `ar`.
//
// The text half of the contract: the labels, the step readout and the
// accessible names belong to the reader's language. They read rtl through
// `unicode-bidi: plaintext` while every container's `direction` stays `ltr` —
// which is what keeps the order physical without pinning the writing. These
// tests run under `ar` (the real Arabic catalog): `ar-XB`'s English strings
// read ltr under `plaintext`, so it cannot show an rtl readout any more; it is
// kept for the switch itself (rtl-locale-direction.spec.ts).
//
// The clearance check is here for a specific reason. An earlier version of this
// measurement asserted the steady chip's CSS `right` value and its visibility
// and called that "the gap is kept". It is not: the chip is positioned from the
// strip's right edge while the collapse button is placed by a flex spacer, so
// both can be individually correct and still overlap — which is exactly what
// happened when the axis was first reversed without correcting the spacers.
// A distance between two boxes is the only thing that can state that promise,
// and the Arabic chip is a different width from the English one.

type Bridge = {
  __loop: { i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } } }
}

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
  // the layout direction stays ltr for every locale; the text direction is
  // what an RTL locale changes
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('data-text-dir', code === 'ar' ? 'rtl' : 'ltr')
}

/** everything this spec asserts, read in ONE pass so no two facts can be
 *  sampled at different moments of the same transition */
const readStrip = (page: Page) =>
  page.evaluate(() => {
    const nameOf = (el: Element) =>
      typeof el.className === 'string' && el.className ? el.className.split(/\s+/)[0] : el.tagName.toLowerCase()
    const laidOut = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).position !== 'absolute'
    }
    const order = (sel: string) => {
      const host = document.querySelector(sel)
      if (!host) return null
      const kids = [...host.children].filter(laidOut)
      return {
        dom: kids.map(nameOf),
        visual: [...kids].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x).map(nameOf),
      }
    }
    const dirOf = (sel: string) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).direction : null
    }
    const strip = document.querySelector('.pstrip')
    const steady = document.querySelector('.pstrip__steady')
    const collapse = document.querySelector('.pstrip__collapse')
    // the clearance the stylesheet promises, whichever side the toggle is on
    let clearance: number | null = null
    if (steady && collapse) {
      const s = steady.getBoundingClientRect()
      const c = collapse.getBoundingClientRect()
      clearance = Math.round((c.x >= s.right ? c.x - s.right : s.x - c.right) * 100) / 100
    }
    // what Tab can reach: enabled AND rendered — a control the row folds into
    // Run settings (`display: none` until it opens, docs/workbench.md §WB7) is
    // in neither the tab order nor the visual order (its box reads x 0)
    const focusables = [...document.querySelectorAll('.pstrip button, .pstrip input, .pstrip [tabindex]')].filter(
      (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0,
    )
    // an anchor OUTSIDE the strip, measured from its container's inline start —
    // under a fixed LTR layout that is the left edge for every reader
    const anchor = document.querySelector('.toolbar__actions')
    const brand = document.querySelector('.toolbar__brand')
    const toolbar = document.querySelector('.toolbar')
    let anchorInlineStart: number | null = null
    let brandInlineStart: number | null = null
    let anchorAfterBrand: number | null = null
    if (anchor && brand && toolbar) {
      const a = anchor.getBoundingClientRect()
      const b = brand.getBoundingClientRect()
      const t = toolbar.getBoundingClientRect()
      const rtl = getComputedStyle(toolbar).direction === 'rtl'
      const r2 = (v: number) => Math.round(v * 100) / 100
      anchorInlineStart = r2(rtl ? t.right - a.right : a.x - t.x)
      brandInlineStart = r2(rtl ? t.right - b.right : b.x - t.x)
      // the brand carries a translated tag, so the menus start where the brand
      // ENDS — the gap between the two is the layout's, the brand's width is
      // the text's
      anchorAfterBrand = r2(rtl ? b.x - a.right : a.x - b.right)
    }
    return {
      htmlDir: document.documentElement.getAttribute('dir'),
      strip: order('.pstrip'),
      group: order('.pstrip__group'),
      field: order('.pstrip__field'),
      stripDirection: strip ? getComputedStyle(strip).direction : null,
      groupDirection: dirOf('.pstrip__group'),
      fieldDirection: dirOf('.pstrip__field'),
      stepDirection: dirOf('.pstrip__step'),
      ownershipMark: strip ? getComputedStyle(strip).getPropertyValue('--ls-pstrip-order').trim() : '',
      clearance,
      focusDom: focusables.map(nameOf),
      focusVisual: [...focusables].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x).map(nameOf),
      anchorInlineStart,
      brandInlineStart,
      anchorAfterBrand,
      toolbarDirection: toolbar ? getComputedStyle(toolbar).direction : null,
      // which side of the collapse toggle the steady chip sits on
      steadySide: steady && collapse ? (collapse.getBoundingClientRect().x >= steady.getBoundingClientRect().right ? 'before' : 'after') : null,
    }
  })

test.describe('the playbar order under the shipped Arabic: physical because nothing mirrors', () => {
  test('the three containers keep their physical child order under ar', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar')
    const rtl = await readStrip(page)

    expect(ltr.htmlDir).toBe('ltr')
    expect(rtl.htmlDir).toBe('ltr')
    // the mirrored-layout pin is inert: no `dir="rtl"` ancestor, no mark
    expect(rtl.ownershipMark).toBe('')
    expect(ltr.ownershipMark).toBe('')

    expect(rtl.strip?.visual).toEqual(ltr.strip?.visual)
    expect(rtl.group?.visual).toEqual(ltr.group?.visual)
    expect(rtl.field?.visual).toEqual(ltr.field?.visual)
    // and the markup itself never moved
    expect(rtl.strip?.dom).toEqual(ltr.strip?.dom)
    expect(rtl.group?.dom).toEqual(ltr.group?.dom)
    expect(rtl.field?.dom).toEqual(ltr.field?.dom)
  })

  test('the containers keep direction ltr while the Arabic step readout reads rtl', async ({ page }) => {
    await openApp(page)
    await switchLocale(page, 'ar')
    const rtl = await readStrip(page)

    // the LAYOUT half: no container takes the text direction
    expect(rtl.stripDirection).toBe('ltr')
    expect(rtl.groupDirection).toBe('ltr')
    expect(rtl.fieldDirection).toBe('ltr')
    expect(rtl.stepDirection).toBe('ltr')

    // the TEXT half, which an order-only test cannot see: the readout is the
    // Arabic catalog's `playbar.step` and reads as an rtl paragraph — the step
    // number, logically last, lands at the LEFT end of the Arabic word, and the
    // text sits flush with the right of its box
    const expected = await page.evaluate(() =>
      String((window as unknown as { __loop: { i18n: { getState: () => { activeCatalog: Record<string, string> } } } }).__loop.i18n.getState().activeCatalog['playbar.step']),
    )
    const step = page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step')
    await expect(step).toHaveText(expected.replace('{n}', '0'))
    const p = await readParagraph(step)
    expect(p.unicodeBidi).toBe('plaintext')
    expect(p.direction).toBe('ltr')
    expect(p.mixed, 'an Arabic word and a digit — a string whose order can show the paragraph direction').toBe(true)
    expect(p.firstIsRightmost, `the first Arabic letter is the rightmost glyph: ${JSON.stringify(p)}`).toBe(true)
    expect(p.lastIsLeftmost, `the step number is the leftmost glyph: ${JSON.stringify(p)}`).toBe(true)
    if (p.slack > 1) expect(p.align).toBe('right')
  })

  test('DOM order, tab order and visual order all agree', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar')
    const rtl = await readStrip(page)

    expect(rtl.focusDom).toEqual(ltr.focusDom)
    expect(rtl.focusVisual).toEqual(ltr.focusVisual)
    // a keyboard user and a sighted user must traverse the strip the same way
    expect(rtl.focusVisual).toEqual(rtl.focusDom)
  })

  test('the steady chip clears the collapse toggle by a positive gap, on the same side, under en and ar', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar')
    const rtl = await readStrip(page)

    expect(ltr.clearance).not.toBeNull()
    expect(rtl.clearance).not.toBeNull()
    expect(ltr.clearance as number).toBeGreaterThan(0)
    expect(rtl.clearance as number).toBeGreaterThan(0)
    // Under the earlier mirrored chrome the same English strings were laid out
    // both ways, so the gap had to be EQUAL. Under `ar` the chip carries a
    // different (Arabic, and here the short) label, so its width — and the gap —
    // is the text's; what the layout owns is the side: the chip stays BEFORE
    // (left of) the collapse toggle for both readers.
    expect(ltr.steadySide).toBe('before')
    expect(rtl.steadySide).toBe('before')
  })

  test('the collapse toggle ends the strip at its physical right end under en and ar', async ({ page }) => {
    // The spacer that places the toggle is the layout's (`margin-inline-start:
    // auto`, inline start = left for both readers), so the toggle is the
    // rightmost control and reaches the strip's right content edge. Not compared
    // as an equal distance: the two readers fold the row at different fit steps
    // (Arabic labels are wider), and at 1280 the English row at its step runs a
    // few px into the strip's padding while the Arabic one has room to spare.
    const end = () =>
      page.evaluate(() => {
        const s = document.querySelector('.pstrip:not(.pstrip--mobile)') as HTMLElement
        const strip = s.getBoundingClientRect()
        const contentRight = strip.right - (parseFloat(getComputedStyle(s).paddingRight) || 0)
        const c = s.querySelector('.pstrip__collapse')!.getBoundingClientRect()
        const others = [...s.children].filter((k) => !k.classList.contains('pstrip__collapse') && getComputedStyle(k).position !== 'absolute' && k.getBoundingClientRect().width > 0)
        return {
          reachesEnd: c.right >= contentRight - 0.5,
          rightmost: others.every((k) => k.getBoundingClientRect().right <= c.left + 0.5),
        }
      })
    await openApp(page)
    expect(await end()).toEqual({ reachesEnd: true, rightmost: true })
    await switchLocale(page, 'ar')
    expect(await end()).toEqual({ reachesEnd: true, rightmost: true })
  })

  test('an anchor outside the strip keeps its place from the left edge under ar', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar')
    const rtl = await readStrip(page)

    // the rest of the chrome does not mirror either. The toolbar lays out ltr
    // for both readers, so its inline start is the LEFT edge; the brand starts
    // the same distance from it, and the menus start the same distance after
    // the brand. (The menus' own offset from the edge is not compared: the
    // brand carries the translated "preview" tag, whose width is the text's.)
    expect(ltr.toolbarDirection).toBe('ltr')
    expect(rtl.toolbarDirection).toBe('ltr')
    expect(ltr.anchorInlineStart).not.toBeNull()
    expect(Math.abs((rtl.brandInlineStart as number) - (ltr.brandInlineStart as number))).toBeLessThanOrEqual(0.5)
    expect(rtl.anchorAfterBrand as number).toBeGreaterThanOrEqual(0)
    expect(Math.abs((rtl.anchorAfterBrand as number) - (ltr.anchorAfterBrand as number))).toBeLessThanOrEqual(0.5)
  })
})
