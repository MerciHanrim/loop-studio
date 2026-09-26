import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Thai (`th`). docs/localization.md §L2.19.
//
// The contracts worth a real browser are the ones that can only break in the
// PRODUCT:
//   1 every `th-*` tag reaches `th`, its neighbours do NOT, and a stored
//     region tag is refused — the §L5.2 step-3 / §L5.1 pair, live
//   2 the picker offers ไทย, in its sorted place, findable by Thai name, by
//     English name and by code; the choice survives a reload
//   3 the ONE plural category renders: a count of 1 takes the same arm as 4,
//     through the product's own formatter, on screen
//   4 `84%` — the sign after the number, with nothing between
//   5 Thai base, ABOVE-combining and BELOW-combining clusters come from IBM
//     Plex Sans Thai, not a per-glyph system fallback
//   6 on a 390px viewport nothing Thai is clipped by its own box's clipper,
//     and no two elements overlap
//   7 the eight node kinds read in Thai on the palette
//
// §L2.19's measured risk is VERTICAL, not horizontal: Thai ink is 19 above +
// 6 below at 18px against Latin's 13 + 4. That is why 6 measures ink against
// the clipping ancestor and neighbour gaps rather than adding a pixel
// baseline — a number says which way it moved, a screenshot only says it did.

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

async function catalog(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __loop: Loop }).__loop.i18n.getState().activeCatalog as Record<
        string,
        string
      >,
  )
}

async function openLanguageMenu(page: Page) {
  const trigger = page.locator('.lang-switch').first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.locator('.toolbar__settingsmenu > button').click()
  }
  if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

// Built from code points. A Thai vowel or tone mark is a separate character
// that renders ON TOP OF the one before it, so `ไทย` and a marked cluster are
// not distinguishable by eye in a source listing.
const THAI = String.fromCharCode(0x0e44, 0x0e17, 0x0e22) // ไทย
const KO = String.fromCharCode(0x0e01) // ก — a bare consonant
const KO_ABOVE = String.fromCharCode(0x0e01, 0x0e34) // ก + sara i, ABOVE the base
const KO_BELOW = String.fromCharCode(0x0e01, 0x0e38) // ก + sara u, BELOW the base
const KO_TONE = String.fromCharCode(0x0e01, 0x0e34, 0x0e49) // base + vowel + tone, STACKED
const DOTTED_CIRCLE = String.fromCharCode(0x25cc) // the isolated-mark carrier

// ------------------------------------------------------------------ 1
test.describe('every Thai tag reaches th, and its neighbours do not', () => {
  for (const [tag, want] of [
    ['th', 'th'],
    ['th-TH', 'th'],
    ['th-Thai', 'th'],
    // `th` IS its own base subtag, so §L5.2 step 3 splits on the first subtag
    // and everything after it is carried for free — including the Thai-digit
    // numbering extension, which must NOT route anywhere else.
    ['th-Thai-TH', 'th'],
    ['th-TH-u-nu-thai', 'th'],
    ['TH-th', 'th'],
    // the Southeast-Asian neighbours are different languages, and `lo` and
    // `km` are scripts of their own — none of them may borrow `th`.
    //
    // `vi` sat in this list until Vietnamese shipped, and turned this spec red
    // the day it did. A probe tag has to name a language this product does NOT
    // have AND does not plan to (§L2.19); `ms` replaces it on both counts.
    ['lo', 'en'],
    ['km', 'en'],
    ['my', 'en'],
    ['ms', 'en'],
  ] as const) {
    test(`${tag} reaches ${want}`, async ({ browser }) => {
      const ctx = await browser.newContext({ locale: tag })
      const page = await ctx.newPage()
      await openApp(page)
      expect(await htmlLang(page)).toBe(want)
      await ctx.close()
    })
  }
})

test('a stored th survives a reload, and only the exact code restores', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'th')
  expect(await stored(page)).toBe('th')

  await page.reload()
  await expect.poll(() => htmlLang(page)).toBe('th')

  // §L5.1 is stricter than §L5.2: `th-TH` RESOLVES, but it is not a registered
  // code, so a stored one is refused rather than silently accepted.
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'th-TH'))
  await page.reload()
  await expect.poll(() => htmlLang(page)).toBe('en')
})

// ------------------------------------------------------------------ 2
test('the picker offers ไทย, in place, findable three ways', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'th')
  await openLanguageMenu(page)

  const codes = await page
    .locator('.lang-menu__pop [role="option"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
  // §L5.6 — sorted by ENGLISH name, so `Thai` sits between `Spanish (Spain)`
  // and `Turkish`. A DEV/QA pseudo-locale is appended after the sorted set.
  const shipped = codes.filter((c) => c !== 'en-XA')
  expect(shipped.indexOf('th')).toBe(shipped.indexOf('es-ES') + 1)
  expect(shipped.indexOf('tr')).toBe(shipped.indexOf('th') + 1)

  const row = page.locator('.lang-menu__item[data-locale="th"]')
  // the endonym and the name in a Thai UI are both `ไทย`, so §L5.3 shows one
  // label; the selected row also carries a check mark
  await expect(row.locator('[lang="th"]')).toContainText(THAI)
  expect((await row.innerText()).replace(/\s+/g, ' ').trim().replace(/^✓\s*/, '')).toBe(THAI)

  const search = page.locator('.lang-menu__pop input')
  for (const [q, want] of [
    [THAI, 'th'],
    ['Thai', 'th'],
    ['th', 'th'],
  ] as const) {
    await search.fill(q)
    await expect
      .poll(async () =>
        page
          .locator('.lang-menu__pop [role="option"]')
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale)),
      )
      .toContain(want)
  }
  await search.fill('')
})

// ------------------------------------------------------------------ 3
test('the one plural category renders: 1 takes the same arm as 4', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'th')

  // the runtime's own category set — ONE entry, the first locale here for
  // which that is true
  const cats = await page.evaluate(
    () => new Intl.PluralRules('th').resolvedOptions().pluralCategories,
  )
  expect(cats).toEqual(['other'])

  const cat = await catalog(page)
  // every plural block in the catalog has exactly one arm, and it is `other`
  const selectors = [...cat['import.summary'].matchAll(/(zero|one|two|few|many|other)\s*\{/g)].map(
    (m) => m[1],
  )
  expect(selectors).toEqual(['other', 'other'])

  // …and this is what the PRODUCT prints. The quick-start example is 1 table
  // and 4 Parameters, so the same message renders a count of 1 and a count of
  // 4 side by side: in English those are different arms, in Thai they must be
  // the same one, and both must keep the number.
  await page.getByRole('button', { name: 'ข้อมูล ▾' }).click()
  await page.getByRole('menuitem').first().click()
  const dlg = page.locator('.mcdlg--dataimport')
  await expect(dlg).toBeVisible()
  await dlg.getByRole('button', { name: 'ใช้ตัวอย่างนี้' }).click()

  // `import.status.counts` — three plural blocks in one message
  await expect(dlg.locator('.import__status').first()).toContainText('2 คอลัมน์ตัวเลข')
  await expect(dlg.locator('.import__status').first()).toContainText('2 แถว')
  await expect(dlg.locator('.import__status').first()).toContainText('4 พารามิเตอร์')

  await dlg.getByRole('button', { name: 'ถัดไป' }).click() // placement
  await expect(dlg.getByText(/4 พารามิเตอร์/)).toBeVisible()
  await dlg.getByRole('button', { name: 'ถัดไป' }).click() // review
  // `import.summary`: tables = 1. English would print the `one` arm here.
  const summary = dlg.locator('.import__summary, .import__reviewSummary').first()
  const text = (await dlg.innerText()).replace(/\s+/g, ' ')
  expect(text, 'a count of 1 must render the `other` arm, with the digit kept').toContain(
    '1 ตาราง',
  )
  expect(text).toContain('4 พารามิเตอร์')
  // no English singular leaked through
  expect(text).not.toMatch(/\b1 table\b/)
  await expect(summary.or(dlg)).toBeVisible()
})

// ------------------------------------------------------------------ 4
test('the percent sign follows the number, with nothing between', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'th')

  const m = await page.evaluate(() => {
    const cat = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
      .activeCatalog as Record<string, string>
    const text = cat['playbar.mc.progress'].replace('{pct}', '84')
    const i = text.indexOf('%')
    return {
      text,
      signIndex: i,
      digitIndex: text.search(/\d/),
      codePointBeforeSign: i > 0 ? text.codePointAt(i - 1)! : -1,
    }
  })
  // AFTER the number — the opposite of `tr` (§L2.18), the same as `en`
  expect(m.signIndex, m.text).toBeGreaterThan(m.digitIndex)
  // and touching it: the character immediately before the sign is a DIGIT, so
  // there is no space of any kind — plain, no-break or narrow
  expect(m.codePointBeforeSign, `${m.text}: a digit must sit immediately before the sign`)
    .toBeGreaterThanOrEqual(0x30)
  expect(m.codePointBeforeSign).toBeLessThanOrEqual(0x39)
  expect(m.text).toContain('84%')
})

// ------------------------------------------------------------------ 5
test('Thai base, above-mark and below-mark clusters render in Plex, not a fallback', async ({
  page,
}) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'th')

  const result = await page.evaluate(
    async (samples: string[]) => {
      // MEASURED three times now (`ru`, `tr`, `th`): `document.fonts.check()`
      // returns true for glyphs the browser does not have. Only a width
      // comparison against a deliberately ABSENT family can see a per-glyph
      // fallback — and the load must be explicit, or the control reads as a
      // fallback too because nothing has been fetched yet.
      const all = samples.join('')
      await Promise.all([
        document.fonts.load('400 64px "IBM Plex Sans"', all),
        document.fonts.load('600 64px "IBM Plex Sans"', all),
      ])
      await document.fonts.ready
      const width = (text: string, family: string, weight: number) => {
        const s = document.createElement('span')
        s.textContent = text
        s.style.cssText = `position:absolute;left:-9999px;white-space:pre;font-size:64px;font-weight:${weight};font-family:${family};`
        document.body.appendChild(s)
        const w = s.getBoundingClientRect().width
        s.remove()
        return Math.round(w * 100) / 100
      }
      const PLEX = `'IBM Plex Sans', system-ui, sans-serif`
      const ABSENT = `'Nonexistent Family XYZ', system-ui, sans-serif`
      const out: Record<string, { p400: number; s400: number; p600: number; s600: number }> = {}
      for (const sample of samples) {
        const s = sample.repeat(20)
        out[[...sample].map((c) => c.codePointAt(0)!.toString(16)).join('+')] = {
          p400: width(s, PLEX, 400),
          s400: width(s, ABSENT, 400),
          p600: width(s, PLEX, 600),
          s600: width(s, ABSENT, 600),
        }
      }
      return out
    },
    [KO, KO_ABOVE, KO_BELOW, KO_TONE, THAI, DOTTED_CIRCLE],
  )

  const fellBack: string[] = []
  for (const [cp, m] of Object.entries(result)) {
    if (m.p400 === m.s400 && m.p600 === m.s600) fellBack.push(cp)
  }
  expect(fellBack, 'these clusters came from a system font, not Plex Thai').toEqual([])
})

// ------------------------------------------------------------------ 6
test.describe('the translated mobile UI', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('nothing Thai is clipped, and nothing overlaps', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'th')
    await page.locator('.btn.mob-more').click()
    await expect(page.locator('.sheet').first()).toBeVisible()

    const report = await page.evaluate(() => {
      const cv = document.createElement('canvas')
      const ctx = cv.getContext('2d')!
      const clipped: string[] = []
      const truncated: string[] = []
      const SELS = [
        '.toolbar--mobile .toolbar__vr',
        '.btn.mob-more',
        '.sheet__title',
        '.sheet__row',
        '.sheet__row-sub',
      ]
      for (const sel of SELS) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          const text = (el.textContent ?? '').trim()
          if (!text) continue
          if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
            truncated.push(`${sel} "${text.slice(0, 24)}"`)
          }
          const cs = getComputedStyle(el)
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
          const m = ctx.measureText(text)
          const r = document.createRange()
          r.selectNodeContents(el)
          const rects = Array.from(r.getClientRects())
          const box = el.getBoundingClientRect()
          const lineTop = rects.length ? Math.min(...rects.map((q) => q.top)) : box.top
          const fs = parseFloat(cs.fontSize)
          const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight)
          const baseline = lineTop + (lh - fs) / 2 + fs * 0.8
          const inkTop = baseline - m.actualBoundingBoxAscent
          const inkBottom = baseline + m.actualBoundingBoxDescent
          // the ink may leave its own BOX — measured, and it does, by 2.1px on
          // the top-bar caption. What must not happen is leaving the box that
          // actually CLIPS.
          let p = el.parentElement
          let clipper: HTMLElement | null = null
          while (p) {
            const pcs = getComputedStyle(p)
            if (!/visible/.test(pcs.overflowY) || !/visible/.test(pcs.overflowX)) {
              clipper = p
              break
            }
            p = p.parentElement
          }
          if (clipper) {
            const c = clipper.getBoundingClientRect()
            // only when the element itself is inside the clipper's visible
            // band — a row scrolled out of a scroll container is not a clip
            const inBand = box.top >= c.top - 1 && box.bottom <= c.bottom + 1
            if (inBand && (inkTop < c.top - 0.5 || inkBottom > c.bottom + 0.5)) {
              clipped.push(
                `${sel} "${text.slice(0, 24)}" top ${(c.top - inkTop).toFixed(2)} bottom ${(inkBottom - c.bottom).toFixed(2)}`,
              )
            }
          }
        }
      }
      // pairwise overlap among the laid-out children of each container
      const overlaps: string[] = []
      for (const cSel of ['.toolbar--mobile', '.sheet']) {
        const c = document.querySelector<HTMLElement>(cSel)
        if (!c) continue
        const kids = (Array.from(c.children) as HTMLElement[]).filter((k) => {
          const q = k.getBoundingClientRect()
          return q.width > 0 && q.height > 0 && getComputedStyle(k).position !== 'fixed'
        })
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].getBoundingClientRect()
            const b = kids[j].getBoundingClientRect()
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (ox > 0.5 && oy > 0.5) {
              overlaps.push(`${cSel}: ${kids[i].className} x ${kids[j].className}`)
            }
          }
        }
      }
      return { clipped, truncated, overlaps }
    })

    expect(report.clipped, 'Thai ink must not leave the box that clips it').toEqual([])
    expect(report.truncated, 'no Thai string may be truncated by its box').toEqual([])
    expect(report.overlaps, 'no two laid-out elements may overlap').toEqual([])
  })
})

// ------------------------------------------------------------------ 7
test('the eight node kinds read in Thai on the palette', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'th')

  await expect(
    page.locator('.toolbar__actions .menu > button').filter({ hasText: /ไฟล์/ }),
  ).toBeVisible()

  const labels = await page
    .locator('.toolbar__palette .palette-item')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/^[^\p{L}]+/u, '').trim()))
  const cat = await catalog(page)
  // derived from the catalog, in palette order — the contract is that the
  // PRODUCT shows what the audited catalog says, not that the words are these
  // particular ones (§L2.19 leaves several of them open for a native review).
  expect(labels).toEqual([
    cat['palette.pool.name'],
    cat['palette.source.name'],
    cat['palette.drain.name'],
    cat['palette.gate.name'],
    cat['palette.converter.name'],
    cat['palette.end.name'],
    cat['palette.parameter.name'],
    cat['palette.register.name'],
  ])
  // …and they really are Thai, so the check cannot pass on eight English words
  for (const l of labels) expect(l, l).toMatch(/\p{Script=Thai}/u)
  expect(new Set(labels).size).toBe(8)
})
