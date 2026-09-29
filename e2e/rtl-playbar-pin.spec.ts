import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.3 — the playbar keeps its PHYSICAL button order for
// every reader, because the transport sits with the physical time axis: `⏭`
// must still advance in the direction the timeline runs.
//
// The pin is NOT `direction: ltr` on the container. That would pin the text as
// well, and the labels, the step readout and the accessible names all belong to
// the reader's language. What is physical here is the ORDER of the controls,
// not the writing — so the flex axis is reversed to cancel the reversal
// `direction: rtl` applies to it, and the container's own direction is left
// alone. Half of this file exists to keep that distinction true: an
// order-only assertion would pass just as well on a container someone had
// pinned `ltr` outright.
//
// The clearance check is here for a specific reason. An earlier version of this
// measurement asserted the steady chip's CSS `right` value and its visibility
// and called that "the gap is kept". It is not: the chip is positioned from the
// strip's right edge while the collapse button is placed by a flex spacer, so
// both can be individually correct and still overlap — which is exactly what
// happened when the axis was first reversed without correcting the spacers.
// A distance between two boxes is the only thing that can state that promise.

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
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('dir')))
    .toBe(code === 'ar-XB' ? 'rtl' : 'ltr')
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
    const focusables = [...document.querySelectorAll('.pstrip button, .pstrip input, .pstrip [tabindex]')].filter(
      (el) => !el.hasAttribute('disabled'),
    )
    // a logical anchor OUTSIDE the pin, to prove the rest of the chrome does
    // mirror - the pin is an exception, not the rule
    const anchor = document.querySelector('.toolbar__actions')
    const toolbar = document.querySelector('.toolbar')
    let anchorInlineStart: number | null = null
    if (anchor && toolbar) {
      const a = anchor.getBoundingClientRect()
      const t = toolbar.getBoundingClientRect()
      const rtl = getComputedStyle(toolbar).direction === 'rtl'
      anchorInlineStart = Math.round((rtl ? t.right - a.right : a.x - t.x) * 100) / 100
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
    }
  })

test.describe('the playbar order pin, under a real direction change', () => {
  test('the three containers keep their physical child order', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar-XB')
    const rtl = await readStrip(page)

    expect(ltr.htmlDir).toBe('ltr')
    expect(rtl.htmlDir).toBe('rtl')
    // the pin declares itself, so a silently-dropped rule is visible here
    expect(rtl.ownershipMark).toBe('physical')
    expect(ltr.ownershipMark).toBe('')

    expect(rtl.strip?.visual).toEqual(ltr.strip?.visual)
    expect(rtl.group?.visual).toEqual(ltr.group?.visual)
    expect(rtl.field?.visual).toEqual(ltr.field?.visual)
    // and the markup itself never moved
    expect(rtl.strip?.dom).toEqual(ltr.strip?.dom)
    expect(rtl.group?.dom).toEqual(ltr.group?.dom)
    expect(rtl.field?.dom).toEqual(ltr.field?.dom)
  })

  test('the containers and their text still read in the locale direction', async ({ page }) => {
    await openApp(page)
    await switchLocale(page, 'ar-XB')
    const rtl = await readStrip(page)

    // this is the half of the contract an order-only test cannot see: the pin
    // fixes the ORDER, and everything written inside it belongs to the reader
    expect(rtl.stripDirection).toBe('rtl')
    expect(rtl.groupDirection).toBe('rtl')
    expect(rtl.fieldDirection).toBe('rtl')
    expect(rtl.stepDirection).toBe('rtl')
  })

  test('DOM order, tab order and visual order all agree', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar-XB')
    const rtl = await readStrip(page)

    expect(rtl.focusDom).toEqual(ltr.focusDom)
    expect(rtl.focusVisual).toEqual(ltr.focusVisual)
    // a keyboard user and a sighted user must traverse the strip the same way
    expect(rtl.focusVisual).toEqual(rtl.focusDom)
  })

  test('the steady chip clears the collapse toggle by the same positive gap in both directions', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar-XB')
    const rtl = await readStrip(page)

    expect(ltr.clearance).not.toBeNull()
    expect(rtl.clearance).not.toBeNull()
    expect(ltr.clearance as number).toBeGreaterThan(0)
    expect(rtl.clearance as number).toBeGreaterThan(0)
    expect(Math.abs((rtl.clearance as number) - (ltr.clearance as number))).toBeLessThanOrEqual(0.5)
  })

  test('a logical anchor outside the pin keeps its distance from the inline start', async ({ page }) => {
    await openApp(page)
    const ltr = await readStrip(page)
    await switchLocale(page, 'ar-XB')
    const rtl = await readStrip(page)

    // the pin is the exception. The rest of the chrome mirrors, and "mirrors
    // correctly" is one predicate: the same distance from the container's
    // inline start, whichever edge that is.
    expect(ltr.anchorInlineStart).not.toBeNull()
    expect(Math.abs((rtl.anchorInlineStart as number) - (ltr.anchorInlineStart as number))).toBeLessThanOrEqual(0.5)
  })
})
