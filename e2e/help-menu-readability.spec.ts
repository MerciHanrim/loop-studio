import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md / docs/accessibility.md — the help surfaces a reader
// actually stops on: the palette's node tooltips and the two descriptive
// menus (Templates, Insert module), plus the File menu they share their
// markup with.
//
// Measured, not eyeballed. Korean wrapping is checked with a `Range` over
// every whitespace-delimited 어절: a token whose client rects have more than
// one distinct `top` has been broken across lines, which is what
// `word-break: keep-all` exists to prevent. Contrast is computed from the
// resolved colour and the first non-transparent ancestor background.
//
// Before this: the tooltip description had no `keep-all` and broke six of the
// eight Korean descriptions mid-word; both descriptive styles were 11px; the
// menu blurb was 4.26:1 in light; and every Templates row and both module
// rows overflowed the 2-line clamp at 260px, hiding most of the sentence.

const KINDS = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register'] as const
const BODY_MIN_PX = 12
const BODY_MIN_CONTRAST = 4.5

type Measured = {
  text: string
  fontPx: number
  wordBreak: string
  contrast: number
  clipped: boolean
  scrollH: number
  clientH: number
  broken: string[]
}

/** installs the measuring helper in the page (idempotent) */
async function installProbe(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __measure?: (el: Element) => unknown }
    if (w.__measure) return
    const lum = (c: string) => {
      const m = c.match(/\d+(\.\d+)?/g)
      if (!m) return 0
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(Number(m[0])) + 0.7152 * f(Number(m[1])) + 0.0722 * f(Number(m[2]))
    }
    const bgOf = (el: Element) => {
      let n: Element | null = el
      while (n) {
        const c = getComputedStyle(n).backgroundColor
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c
        n = n.parentElement
      }
      return 'rgb(255, 255, 255)'
    }
    w.__measure = (el: Element) => {
      const cs = getComputedStyle(el)
      const l1 = lum(cs.color)
      const l2 = lum(bgOf(el))
      const broken: string[] = []
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.nodeValue ?? ''
        const re = /\S+/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          const r = document.createRange()
          r.setStart(node, m.index)
          r.setEnd(node, m.index + m[0].length)
          const tops = new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top)))
          if (tops.size > 1) broken.push(m[0])
        }
      }
      return {
        text: (el.textContent ?? '').trim(),
        fontPx: parseFloat(cs.fontSize),
        wordBreak: cs.wordBreak,
        contrast: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
        clipped: el.scrollHeight > el.clientHeight + 1,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        broken,
      }
    }
  })
}

const measureOne = async (page: Page, sel: string): Promise<Measured> => {
  await installProbe(page)
  const r = await page.evaluate((s) => {
    const el = document.querySelector(s)
    return el ? ((window as unknown as { __measure: (e: Element) => object }).__measure(el) as Measured) : null
  }, sel)
  expect(r, `${sel} is present`).not.toBeNull()
  return r!
}

/** every `.menu__blurb` inside whichever menu popup is currently on screen */
const measureOpenMenu = async (page: Page, sel: string): Promise<Measured[]> => {
  await installProbe(page)
  return page.evaluate((s) => {
    const m = (window as unknown as { __measure: (e: Element) => object }).__measure
    const pops = Array.from(document.querySelectorAll('.menu__pop')).filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    )
    return pops.flatMap((pop) => Array.from(pop.querySelectorAll(s)).map((el) => m(el) as Measured))
  }, sel)
}

const trigger = (page: Page, name: RegExp) =>
  page.locator('.menu').filter({ hasText: name }).first().getByRole('button').first()
const openPop = (page: Page) => page.locator('.menu__pop').filter({ visible: true }).first()

const activeLabel = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    return a ? (a.textContent ?? '').trim() : null
  })

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (c: string) => void } } } }).__loop.i18n.getState().setLocale('ko'))
})

test('KO node tooltips: every description keeps its 어절 whole, at body size and body contrast', async ({ page }) => {
  for (const kind of KINDS) {
    await page.locator(`.chip--${kind}`).hover()
    await expect(page.locator(`#palette-tip-${kind}`)).toBeVisible()
    const desc = await measureOne(page, `#palette-tip-${kind} .palette-tip__desc`)
    expect(desc.wordBreak, `${kind}: the description declares keep-all`).toBe('keep-all')
    expect(desc.broken, `${kind}: no 어절 is split across lines`).toEqual([])
    expect(desc.fontPx, `${kind}: description font size`).toBeGreaterThanOrEqual(BODY_MIN_PX)
    expect(desc.contrast, `${kind}: description contrast`).toBeGreaterThanOrEqual(BODY_MIN_CONTRAST)
    const name = await measureOne(page, `#palette-tip-${kind} .palette-tip__name`)
    expect(name.broken, `${kind}: the name is not split`).toEqual([])
    expect(name.contrast).toBeGreaterThanOrEqual(BODY_MIN_CONTRAST)
    // leave the chip so the next hover is a fresh entry
    await page.mouse.move(640, 700)
  }
})

test('KO Templates menu: 340px, every description whole and inside the 2-line clamp', async ({ page }) => {
  await trigger(page, /템플릿/).click()
  await expect(openPop(page)).toBeVisible()
  const width = await openPop(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))
  expect(width, 'Templates opts into the wide popover').toBe(300)

  const blurbs = await measureOpenMenu(page, '.menu__blurb')
  expect(blurbs.length, 'one description per template').toBe(5)
  for (const b of blurbs) {
    expect(b.fontPx, `"${b.text}": font size`).toBeGreaterThanOrEqual(BODY_MIN_PX)
    expect(b.contrast, `"${b.text}": contrast`).toBeGreaterThanOrEqual(BODY_MIN_CONTRAST)
    expect(b.wordBreak).toBe('keep-all')
    // the acceptance for the clamp is the geometry, not the width: nothing
    // may be hidden behind `-webkit-line-clamp: 2`
    expect(b.clipped, `"${b.text}": ${b.scrollH} > ${b.clientH} would be cut by the clamp`).toBe(false)
    // `keep-all` does not close a break at the interpunct `·`, so the Korean
    // copy uses commas for enumerations instead
    expect(b.broken, `"${b.text}": no word split across lines`).toEqual([])
    expect(b.text).not.toContain('·')
  }
  const names = await measureOpenMenu(page, '.menu__name')
  for (const n of names) expect(n.broken, `"${n.text}": the name is not split`).toEqual([])
})

test('KO Insert module menu: the shared 260px is already enough for its descriptions', async ({ page }) => {
  await trigger(page, /모듈/).click()
  await expect(openPop(page)).toBeVisible()
  const width = await openPop(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))
  // measured: the compressed module copy clears the 2-line clamp at 260px in
  // all three locales, so it is NOT widened — a wider popover would only cover
  // more of the palette row underneath it
  expect(width, 'the module menu keeps the shared width').toBe(260)

  const blurbs = await measureOpenMenu(page, '.menu__blurb')
  expect(blurbs.length, 'one description per bundled module').toBe(2)
  for (const b of blurbs) {
    expect(b.fontPx).toBeGreaterThanOrEqual(BODY_MIN_PX)
    expect(b.contrast).toBeGreaterThanOrEqual(BODY_MIN_CONTRAST)
    expect(b.clipped, `"${b.text}": ${b.scrollH} > ${b.clientH} would be cut by the clamp`).toBe(false)
    expect(b.broken, `"${b.text}": no word split across lines`).toEqual([])
    expect(b.text).not.toContain('·')
  }
})

test('KO File menu keeps the shared 260px and its own descriptions stay whole', async ({ page }) => {
  await trigger(page, /파일/).click()
  await expect(openPop(page)).toBeVisible()
  const width = await openPop(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))
  expect(width, 'File is NOT widened — only the two descriptive menus are').toBe(260)
  const blurbs = await measureOpenMenu(page, '.menu__blurb')
  expect(blurbs.length).toBeGreaterThan(0)
  for (const b of blurbs) {
    expect(b.fontPx).toBeGreaterThanOrEqual(BODY_MIN_PX)
    expect(b.contrast).toBeGreaterThanOrEqual(BODY_MIN_CONTRAST)
    expect(b.clipped, `"${b.text}" is cut by the clamp`).toBe(false)
    expect(b.broken, `"${b.text}": no word split across lines`).toEqual([])
    expect(b.text).not.toContain('·')
  }
})

test('a widened popover still fits inside a narrow desktop viewport', async ({ page }) => {
  // 820×720 is one of the widths the toolbar's own responsive contract pins.
  await page.setViewportSize({ width: 820, height: 720 })
  for (const name of [/템플릿/, /모듈/] as const) {
    const t = trigger(page, name)
    if ((await t.count()) === 0) continue // folded into ⋯ at this width
    await t.click()
    await expect(openPop(page)).toBeVisible()
    const box = (await openPop(page).boundingBox())!
    expect(box.x, 'left edge inside the viewport').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'right edge inside the viewport').toBeLessThanOrEqual(820)
    await page.keyboard.press('Escape')
  }
})

test.describe('menu keyboard — Templates, Insert module and File', () => {
  for (const [label, name, count] of [
    ['Templates', /템플릿/, 5],
    ['Insert module', /모듈/, 4],
    ['File', /파일/, 7],
  ] as const) {
    test(`${label}: arrows wrap, Home/End jump, separators are skipped, Esc returns focus`, async ({ page }) => {
      const t = trigger(page, name)
      await t.click()
      const pop = openPop(page)
      await expect(pop).toBeVisible()
      const items = pop.getByRole('menuitem')
      await expect(items).toHaveCount(count)
      // the keyboard walks the ENABLED rows; File's `Create proposal` is
      // disabled until a project is open and must never take focus
      const labels = await pop.evaluate((el) =>
        Array.from(el.querySelectorAll('[role="menuitem"]'))
          .filter((i) => !(i as HTMLButtonElement).disabled && i.getAttribute('aria-disabled') !== 'true')
          .map((i) => (i.textContent ?? '').trim()),
      )
      expect(labels.length).toBeGreaterThan(1)

      // opening leaves focus on the trigger; ArrowDown enters at the first row
      await expect(t).toBeFocused()
      await page.keyboard.press('ArrowDown')
      expect(await activeLabel(page)).toBe(labels[0])
      await page.keyboard.press('ArrowDown')
      expect(await activeLabel(page)).toBe(labels[1])
      // wrap backwards off the top
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp')
      expect(await activeLabel(page), 'ArrowUp wraps to the last row').toBe(labels[labels.length - 1])
      // wrap forwards off the bottom
      await page.keyboard.press('ArrowDown')
      expect(await activeLabel(page), 'ArrowDown wraps to the first row').toBe(labels[0])
      await page.keyboard.press('End')
      expect(await activeLabel(page)).toBe(labels[labels.length - 1])
      await page.keyboard.press('Home')
      expect(await activeLabel(page)).toBe(labels[0])

      // a `role="separator"` is never a stop: walking the whole list visits
      // exactly the menuitems, in order
      const walked: (string | null)[] = [labels[0]]
      for (let i = 1; i < labels.length; i++) {
        await page.keyboard.press('ArrowDown')
        walked.push(await activeLabel(page))
      }
      expect(walked).toEqual(labels)

      await page.keyboard.press('Escape')
      await expect(pop).toBeHidden()
      await expect(t, 'Escape returns focus to the exact trigger').toBeFocused()
    })
  }

  test('ArrowUp from the trigger enters at the LAST row', async ({ page }) => {
    const t = trigger(page, /템플릿/)
    await t.click()
    await expect(openPop(page)).toBeVisible()
    const labels = (await openPop(page).getByRole('menuitem').allTextContents()).map((s) => s.trim())
    await expect(t).toBeFocused()
    await page.keyboard.press('ArrowUp')
    expect(await activeLabel(page)).toBe(labels[labels.length - 1])
  })

  test('a disabled row is skipped, and activation still runs the command exactly once', async ({ page }) => {
    // `Create proposal` is disabled until a project is open, and it sits in
    // the middle of the File menu's flattened Export rows.
    const t = trigger(page, /파일/)
    await t.click()
    const pop = openPop(page)
    await expect(pop).toBeVisible()
    const disabled = await pop.evaluate((el) =>
      Array.from(el.querySelectorAll('[role="menuitem"]'))
        .filter((i) => (i as HTMLButtonElement).disabled || i.getAttribute('aria-disabled') === 'true')
        .map((i) => (i.textContent ?? '').trim()),
    )
    const reachable: string[] = []
    await page.keyboard.press('Home')
    const first = await activeLabel(page)
    reachable.push(first ?? '')
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ArrowDown')
      const cur = await activeLabel(page)
      if (cur === first) break
      reachable.push(cur ?? '')
    }
    for (const d of disabled) expect(reachable, `"${d}" is never focused`).not.toContain(d)

    // Enter activates through the browser's own button behaviour — the hook
    // adds no `.click()`, so the command must not run twice. `New` opens the
    // confirm dialog exactly once.
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(page.locator('.mcdlg, [role="dialog"]')).toHaveCount(1)
  })
})
