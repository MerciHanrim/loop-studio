import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { readParagraph } from './support/textDirection'
import { openFileSubmenu, openViewMenu } from './support/workbenchMenus'

// docs/localization.md §L9.2 / §L2.0a — the layout is fixed; only RTL TEXT reads
// right to left.
//
// THE RULE (Lumi, 2026-10-28; in code 2026-10-29): Loop Studio's LAYOUT stays
// LTR for every language — `<html dir>` is `LAYOUT_DIRECTION`, `ltr` for every
// locale — and only Arabic TEXT reads right to left. The text direction is
// `directionOf`, written to `<html data-text-dir>`; chrome text takes it from
// `unicode-bidi: plaintext` (src/index.css), which changes no `direction`, so
// no flex order and no logical side moves. The arrow ICONS follow the layout;
// the `›` disclosure characters are pinned `dir="ltr"`.
//
// Layout and text must not affect each other, and this file holds both halves
// under the shipped Arabic (`ar`), with the Arabic catalog:
//
//   a  the boxes of the menu bar items, the two side panels, the run-bar
//      controls, the popover anchors and the canvas are in the same order and
//      on the same sides as under `en` and `ko` — measured boxes, not CSS
//   b  a Model list row's value sits at the row's right end as under `en`,
//      while an Arabic name reads rtl inside its own slot (`dir="auto"`)
//   c  the `›` of View ▸ Theme / Language and of File's submenu rows is not
//      mirrored: inside a `dir="ltr"` element, computed ltr, drawn pointing
//      right as under `en`, at the row's right end — and the submenu still
//      opens to the right
//   d  Arabic chrome text reads rtl (computed `unicode-bidi: plaintext`, the
//      paragraph resolved rtl on the glyphs) while its container's
//      `direction` stays `ltr`
//   e  a Latin user name in the Arabic UI still reads ltr (`dir="auto"`), and
//      a number and an expression stay ltr
//
// `ar-XB` (the pseudo-locale, English verbatim with `direction: 'rtl'`) is not
// used here: its English reads ltr under `plaintext`, so it cannot show rtl
// text. It stays for the direction switch itself (rtl-locale-direction.spec.ts).
//
// No baseline image: everything is a measurement.

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } }
  }
}

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale)).toBe(code)
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('data-text-dir', code === 'ar' ? 'rtl' : 'ltr')
}

/** the fixed layout, as boxes: which item sits where, and the panels' sides */
const layoutOf = (page: Page) =>
  page.evaluate(() => {
    const r2 = (v: number) => Math.round(v * 10) / 10
    const shown = (el: Element) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0
    const byX = (els: Element[]) => [...els].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    const box = (sel: string) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { left: r2(b.left), right: r2(b.right), width: r2(b.width) }
    }
    const slots = [...document.querySelectorAll('.toolbar__actions .toolbar__slot')].filter(shown)
    const strip = document.querySelector('.pstrip:not(.pstrip--mobile)')!
    const stripKids = [...strip.children].filter((k) => shown(k) && getComputedStyle(k).position !== 'absolute')
    return {
      // the menu bar: visual order equals DOM order, and that order itself
      menuVisual: byX(slots).map((s) => s.getAttribute('data-group')),
      menuDom: slots.map((s) => s.getAttribute('data-group')),
      brandLeft: box('.toolbar__brand')?.left ?? null,
      left: box('.wb-left'),
      right: box('.rightcol'),
      canvas: box('.react-flow'),
      viewport: innerWidth,
      // the run bar: visual order equals DOM order, by class (language-free)
      stripVisual: byX(stripKids).map((k) => (k as HTMLElement).className.split(/\s+/).find((c) => c.startsWith('pstrip__')) ?? k.className),
      stripDom: stripKids.map((k) => (k as HTMLElement).className.split(/\s+/).find((c) => c.startsWith('pstrip__')) ?? k.className),
    }
  })

/** the menu popover's anchor: its left edge against its trigger's left edge */
const viewAnchor = async (page: Page) => {
  await openViewMenu(page)
  const a = await page.evaluate(() => {
    const t = document.querySelector('.toolbar__actions .wb-viewmenu > .wb-mb')!.getBoundingClientRect()
    const p = document.querySelector('.wb-viewmenu__pop')!.getBoundingClientRect()
    return { offset: Math.round((p.left - t.left) * 10) / 10, below: p.top >= t.bottom - 1 }
  })
  await page.keyboard.press('Escape')
  await expect(page.locator('.wb-viewmenu__pop')).toHaveCount(0)
  return a
}

/** where a `›` is drawn pointing: decoded from the element's own pixels. In `›`
 *  the apex is the middle row's rightmost ink and the top row's ink sits left of
 *  it; in `‹` the other way round. Font-independent, unlike a byte comparison. */
async function chevronPoints(page: Page, el: Locator): Promise<'right' | 'left' | 'none'> {
  const png = (await el.screenshot()).toString('base64')
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const c = new OffscreenCanvas(img.width, img.height)
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const lum = (i: number) => 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!
    const bg = lum(0)
    const rows: { y: number; xs: number[] }[] = []
    for (let y = 0; y < img.height; y++) {
      const xs: number[] = []
      for (let x = 0; x < img.width; x++) if (Math.abs(lum((y * img.width + x) * 4) - bg) > 60) xs.push(x)
      if (xs.length) rows.push({ y, xs })
    }
    if (rows.length < 3) return 'none'
    const mid = (r: { xs: number[] }) => r.xs.reduce((s, x) => s + x, 0) / r.xs.length
    const top = mid(rows[0]!)
    const centre = mid(rows[Math.floor(rows.length / 2)]!)
    return centre > top + 0.5 ? 'right' : centre < top - 0.5 ? 'left' : 'none'
  }, png)
}

/** a `›` disclosure: its own pin, its computed direction, and whether it is the
 *  rightmost glyph of the row it discloses */
const chevronOf = async (el: Locator, row: Locator) =>
  el.evaluate((node, rowEl) => {
    const rowBox = (rowEl as Element).getBoundingClientRect()
    const own = node.getBoundingClientRect()
    // every other glyph in the row, by Range, so a text run is measured as text
    let rightmostOther = -Infinity
    const walker = document.createTreeWalker(rowEl as Element, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (node.contains(t)) continue
      const s = t.textContent ?? ''
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i]!)) continue
        const r = document.createRange()
        r.setStart(t, i)
        r.setEnd(t, i + 1)
        const b = r.getBoundingClientRect()
        if (b.width > 0) rightmostOther = Math.max(rightmostOther, b.right)
      }
    }
    return {
      inLtrPin: node.closest('[dir]')?.getAttribute('dir') === 'ltr',
      direction: getComputedStyle(node).direction,
      atRowEnd: own.left >= rightmostOther - 0.5,
      fromRowRight: Math.round((rowBox.right - own.right) * 10) / 10,
    }
  }, await row.elementHandle())

test.describe('the layout is fixed: Arabic lays out as English and Korean', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('a — the menu bar, the side panels, the run bar, the popover anchor and the canvas match en and ko', async ({ page }) => {
    const en = await layoutOf(page)
    const enAnchor = await viewAnchor(page)
    // the English baseline is itself the LTR layout, asserted rather than assumed
    expect(en.menuVisual).toEqual(en.menuDom)
    expect(en.menuVisual.slice(0, 2)).toEqual(['file', 'edit'])
    expect(en.left!.left).toBeLessThanOrEqual(1)
    expect(Math.abs(en.right!.right - en.viewport)).toBeLessThanOrEqual(1)
    expect(en.stripVisual).toEqual(en.stripDom)

    for (const code of ['ko', 'ar']) {
      await switchLocale(page, code)
      const l = await layoutOf(page)
      // the ORDER of the menus and of the run bar's controls (their widths are
      // the text's), each left to right exactly as the DOM, exactly as English
      expect(l.menuVisual, `${code}: menu bar order`).toEqual(en.menuVisual)
      expect(l.menuDom, `${code}: menu bar DOM`).toEqual(en.menuDom)
      expect(l.stripVisual, `${code}: run bar order`).toEqual(en.stripVisual)
      // the brand and the two side panels: the same boxes — the Model list on
      // the left, Properties on the right — and the canvas between them
      expect(l.brandLeft, `${code}: the brand starts the bar`).toBe(en.brandLeft)
      expect(l.left, `${code}: the left panel`).toEqual(en.left)
      expect(l.right, `${code}: the right panel`).toEqual(en.right)
      expect(l.canvas, `${code}: the canvas`).toEqual(en.canvas)
      // the View popover opens under its trigger, from the trigger's left edge
      const a = await viewAnchor(page)
      expect(a.below, `${code}: the popover opens below its trigger`).toBe(true)
      expect(Math.abs(a.offset - enAnchor.offset), `${code}: the popover anchor`).toBeLessThanOrEqual(1)
    }
  })

  test('b — a Model list row keeps its value at the right end; the Arabic name reads rtl in its own slot', async ({ page }) => {
    await resetAll(page)
    const ids = await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      const [a, b] = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(a, { label: 'مخزون الذهب', initial: 42 })
      g().updateNodeData(b, { label: 'Gold reserve', initial: 7 })
      return { arabic: a as string, latin: b as string }
    })
    const read = (id: string) =>
      page.locator(`.wb-left .wb-row[data-node="${id}"]`).evaluate((row) => {
        const rb = row.getBoundingClientRect()
        const cs = getComputedStyle(row)
        const contentRight = rb.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0)
        const name = row.querySelector('.wb-row__name') as HTMLElement
        const val = row.querySelector('.wb-row__val') as HTMLElement
        const nb = name.getBoundingClientRect()
        const vb = val.getBoundingClientRect()
        return {
          rowDirection: cs.direction,
          nameDir: name.getAttribute('dir'),
          nameDirection: getComputedStyle(name).direction,
          valueAfterName: vb.left >= nb.right - 0.5,
          valueFromRight: Math.round((contentRight - vb.right) * 10) / 10,
        }
      })
    await expect(page.locator(`.wb-row[data-node="${ids.arabic}"] .wb-row__val`)).toHaveText('42')
    const en = { arabic: await read(ids.arabic), latin: await read(ids.latin) }
    await switchLocale(page, 'ar')
    const ar = { arabic: await read(ids.arabic), latin: await read(ids.latin) }

    for (const [who, r] of Object.entries(ar)) {
      // the LAYOUT half: the row does not mirror — the value follows the name and
      // ends the row, the same distance from its right edge as in English
      expect(r.rowDirection, `${who}: the row lays out ltr`).toBe('ltr')
      expect(r.valueAfterName, `${who}: the value sits right of the name`).toBe(true)
      expect(Math.abs(r.valueFromRight - en[who as 'arabic' | 'latin'].valueFromRight), `${who}: the value ends the row as in English`).toBeLessThanOrEqual(0.5)
    }
    // the TEXT half: each name takes its own direction from its own script
    expect(ar.arabic.nameDir).toBe('auto')
    expect(ar.arabic.nameDirection, 'the Arabic name reads rtl in its slot').toBe('rtl')
    const p = await readParagraph(page.locator(`.wb-row[data-node="${ids.arabic}"] .wb-row__name`))
    if (p.slack > 1) expect(p.align, 'the Arabic name starts at its slot’s right').toBe('right')
  })

  test('c — the › disclosures are not mirrored, sit at the row end, and the submenu opens to the right', async ({ page }) => {
    const rows = {
      // the chevron is the value's aria-hidden child (the value text itself
      // carries the reader's `dir`, which is also ltr in English)
      theme: { row: '.wb-viewmenu__pop .theme-menu .settings-row', chev: '.wb-viewmenu__pop .theme-menu .settings-row__value > [aria-hidden="true"][dir="ltr"]' },
      language: { row: '.wb-viewmenu__pop .lang-switch', chev: '.wb-viewmenu__pop .lang-switch .settings-row__value > [aria-hidden="true"][dir="ltr"]' },
    } as const
    const readView = async () => {
      await openViewMenu(page)
      const out: Record<string, Awaited<ReturnType<typeof chevronOf>> & { points: string }> = {}
      for (const [k, s] of Object.entries(rows)) {
        const chev = page.locator(s.chev).first()
        await expect(chev).toHaveText(/›/)
        out[k] = { ...(await chevronOf(chev, page.locator(s.row).first())), points: await chevronPoints(page, chev) }
      }
      await page.keyboard.press('Escape')
      return out
    }
    const readFile = async () => {
      const sub = await openFileSubmenu(page, 'templates')
      const parent = page.locator('.toolbar__filemenu-pop [data-submenu="templates"]')
      const chev = parent.locator('.dmenu__chev')
      const c = { ...(await chevronOf(chev, parent)), points: await chevronPoints(page, chev) }
      const opens = await page.evaluate(() => {
        const pop = document.querySelector('.toolbar__filemenu-pop')!.getBoundingClientRect()
        const s = document.querySelector('.toolbar__filemenu .dmenu--sub')!.getBoundingClientRect()
        return s.left >= pop.right - 2 ? 'right' : s.right <= pop.left + 2 ? 'left' : 'over'
      })
      await expect(sub).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      return { ...c, opens }
    }

    const enView = await readView()
    const enFile = await readFile()
    await switchLocale(page, 'ar')
    const arView = await readView()
    const arFile = await readFile()

    for (const [k, c] of [...Object.entries(arView), ['file', arFile] as const]) {
      const en = k === 'file' ? enFile : enView[k]!
      expect(c.inLtrPin, `${k}: the › is inside a dir="ltr" pin`).toBe(true)
      expect(c.direction, `${k}: the › computes ltr`).toBe('ltr')
      expect(en.points, `${k}: the English › points right`).toBe('right')
      expect(c.points, `${k}: the Arabic › still points right, like English`).toBe('right')
      expect(en.atRowEnd, `${k}: the English › ends its row`).toBe(true)
      // soft, so one row's failure does not hide the others' result
      expect.soft(c.atRowEnd, `${k}: the Arabic › ends its row, as in English (${JSON.stringify(c)})`).toBe(true)
    }
    expect(enFile.opens).toBe('right')
    expect(arFile.opens, 'File ▸ Templates still opens to the right').toBe('right')
  })
})

test.describe('the text reads by its own direction inside the fixed layout', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('d — Arabic chrome text reads rtl while its container keeps direction ltr', async ({ page }) => {
    await switchLocale(page, 'ar')
    // View ▸ Reset view and File ▸ New: menu names in boxes wider than their text,
    // so the paragraph's own direction shows as its alignment
    await openViewMenu(page)
    const viewName = page.locator('.wb-viewmenu__pop .menu__item:not(.wb-viewmenu__toggle) .menu__name').last()
    const view = await readParagraph(viewName)
    const viewPop = await page.locator('.wb-viewmenu__pop').evaluate((el) => getComputedStyle(el).direction)
    await page.keyboard.press('Escape')

    for (const [where, p] of [['View menu item', view]] as const) {
      expect(p.text, `${where}: Arabic text`).toMatch(/\p{Script=Arabic}/u)
      expect(p.unicodeBidi, `${where}: plaintext carries the reading direction`).toBe('plaintext')
      expect(p.direction, `${where}: its own direction stays ltr`).toBe('ltr')
      expect(p.slack, `${where}: a box wider than the text`).toBeGreaterThan(1)
      expect(p.align, `${where}: the rtl paragraph starts at the right: ${JSON.stringify(p)}`).toBe('right')
    }
    expect(viewPop, 'the View popover lays out ltr').toBe('ltr')

    // a mixed string, read by ORDER: the run bar's step readout — the Arabic
    // word first (rightmost), the number last (leftmost)
    const step = await readParagraph(page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step'))
    expect(step.mixed).toBe(true)
    expect(step.unicodeBidi).toBe('plaintext')
    expect(step.direction).toBe('ltr')
    expect(step.firstIsRightmost && step.lastIsLeftmost, `the step readout reads rtl: ${JSON.stringify(step)}`).toBe(true)
    const stripDir = await page.locator('.pstrip:not(.pstrip--mobile)').evaluate((el) => getComputedStyle(el).direction)
    expect(stripDir, 'the run bar lays out ltr').toBe('ltr')
  })

  test('e — a Latin user name still reads ltr in the Arabic UI; a number and an expression stay ltr', async ({ page }) => {
    await resetAll(page)
    const ids = await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      g().addNodeAt('parameter', { x: 480, y: 0 })
      const [src, pool, rate] = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(pool, { label: 'Gold reserve' })
      g().updateNodeData(rate, { label: 'Rate', value: -12.5 })
      g().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@${rate} - 2` })
      return { pool: pool as string, rate: rate as string }
    })
    await switchLocale(page, 'ar')

    // the Latin user name: `dir="auto"` resolves ltr from its own text, and the
    // text starts at its slot's LEFT even though the interface reads rtl
    const name = page.locator(`.wb-left .wb-row[data-node="${ids.pool}"] .wb-row__name`)
    await expect(name).toHaveText('Gold reserve')
    expect(await name.getAttribute('dir')).toBe('auto')
    const np = await readParagraph(name)
    expect(np.direction, 'the Latin name reads ltr').toBe('ltr')
    if (np.slack > 1) expect(np.align, 'the Latin name starts at its slot’s left').toBe('left')

    // a negative number: pinned ltr, the sign painted BEFORE the digits
    const val = page.locator(`.wb-left .wb-row[data-node="${ids.rate}"] .wb-row__val`)
    await expect(val).toHaveText('-12.50')
    expect(await val.getAttribute('dir')).toBe('ltr')
    const order = await val.evaluate((el) => {
      const t = el.firstChild as Text
      const r = document.createRange()
      r.setStart(t, 0)
      r.setEnd(t, 1)
      const sign = r.getBoundingClientRect().left
      r.setStart(t, 1)
      r.setEnd(t, t.length)
      return { sign, digits: r.getBoundingClientRect().left, direction: getComputedStyle(el).direction }
    })
    expect(order.direction).toBe('ltr')
    expect(order.sign, 'the minus sign paints left of the digits').toBeLessThan(order.digits)

    // an expression: the connection's flow field in Properties keeps ltr
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.setSelection(null, g.edges[0].id)
    })
    const flow = page.locator('.rightcol input[dir="ltr"]').first()
    await expect(flow).toBeVisible()
    await expect(flow).toHaveValue(new RegExp(`@${ids.rate} - 2`))
    expect(await flow.evaluate((el) => getComputedStyle(el).direction), 'the expression field stays ltr').toBe('ltr')
  })
})
