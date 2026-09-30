import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L8 / §L9 — Arabic, the eighteenth locale and the FIRST
// shipped one with `direction: 'rtl'`.
//
// PR B built the direction machinery and proved it with `ar-XB`, a pseudo whose
// catalog is `en` verbatim. The RTL layout contracts therefore already have
// their own specs (`e2e/rtl-*.spec.ts`) and are not repeated here.
//
// What this file adds is the thing only a REAL BROWSER can settle: which digits
// Arabic renders. `src/i18n/arNumbers.test.ts` pins the same decision in Node,
// and that is deliberately not enough — Node and the browser ship their own ICU
// data, the resolved numbering system for a bare `ar` is a property of that
// data, and only the browser's answer is what a reader sees. A green Node test
// beside a browser that had resolved `arab` would be a contract asserted on the
// wrong machine.

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const htmlDir = (page: Page) => page.evaluate(() => document.documentElement.dir)

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

test.describe('ar — the Latin-digit decision, settled in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    // `resetAll` reads `window.__loop`, which only exists once the app has
    // booted — so it runs AFTER `openApp`, not before
    await openApp(page)
    await resetAll(page)
  })

  test('the browser resolves `ar` to the `latn` numbering system', async ({ page }) => {
    await setLocale(page, 'ar')
    // the locale really is the RTL one, so this is not passing on a fallback
    await expect.poll(() => htmlDir(page)).toBe('rtl')

    // The tag itself is pinned against the registry in
    // `src/i18n/arNumbers.test.ts` (`numberLocale === 'ar'`). What only this
    // browser can answer is what ITS ICU data resolves that tag to — so the tag
    // is used as a literal here rather than read back out of the store, which
    // would make the assertion depend on the same lookup it is checking.
    const resolved = await page.evaluate(() => ({
      decimal: new Intl.NumberFormat('ar').resolvedOptions().numberingSystem,
      percent: new Intl.NumberFormat('ar', { style: 'percent' }).resolvedOptions().numberingSystem,
      sample: new Intl.NumberFormat('ar').format(1234567.89),
    }))

    expect(resolved.decimal, 'the product decision is Latin digits').toBe('latn')
    expect(resolved.percent, 'percent must take the same numbering system').toBe('latn')
    // every digit in a formatted number is ASCII, checked as code points rather
    // than by comparing the whole string, which would break on a separator change
    const digits = [...resolved.sample].filter((c) => /\p{Nd}/u.test(c))
    expect(digits.length).toBeGreaterThan(0)
    for (const d of digits) expect(d.codePointAt(0)!).toBeLessThanOrEqual(0x39)
  })

  test('the alternative tags still differ, so the choice keeps meaning something', async ({ page }) => {
    // if a future browser stopped distinguishing these, "we chose `ar` over
    // `ar-EG`" would silently stop being a choice at all
    const alt = await page.evaluate(() => ({
      eg: new Intl.NumberFormat('ar-EG').resolvedOptions().numberingSystem,
      explicitArab: new Intl.NumberFormat('ar-u-nu-arab').resolvedOptions().numberingSystem,
      explicitLatn: new Intl.NumberFormat('ar-u-nu-latn').resolvedOptions().numberingSystem,
    }))
    expect(alt.eg).toBe('arab')
    expect(alt.explicitArab).toBe('arab')
    expect(alt.explicitLatn).toBe('latn')
  })

  test('a number rendered in the running UI carries ASCII digits', async ({ page }) => {
    await setLocale(page, 'ar')
    // the step readout is the smallest always-present number in the chrome
    const text = await page.locator('.pstrip__step').first().innerText()
    const digits = [...text].filter((c) => /\p{Nd}/u.test(c))
    expect(digits.length, `no digit found in ${JSON.stringify(text)}`).toBeGreaterThan(0)
    for (const d of digits) {
      expect(
        d.codePointAt(0)!,
        `the UI rendered U+${d.codePointAt(0)!.toString(16).toUpperCase()}, not an ASCII digit`,
      ).toBeLessThanOrEqual(0x39)
    }
  })
})

// docs/localization.md §L9.3 — the tour's step counter, which PR C held open.
//
// `tour.nav.position` is `{n} / {total}` and every one of the eighteen locales
// keeps it verbatim, because there is nothing in it to translate. The held
// question was whether the SLASH ORDER survives an RTL reader, and it is a real
// question rather than a copy review: the string is two number runs with a
// neutral slash between them, so inside an RTL paragraph the runs swap and step
// 2 of 6 reads `6 / 2`.
//
// MEASURED here rather than argued, because "the numbers will swap" is exactly
// the kind of bidi claim that is wrong half the time. The assertion is on the
// GEOMETRY, not on `textContent`: the characters are identical either way, which
// is why nothing caught this before.

test.describe('ar — the tour step counter keeps its order', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('`{n} / {total}` reads n-then-total for an Arabic reader', async ({ page }) => {
    await setLocale(page, 'ar')
    await page.evaluate(() =>
      (window as unknown as { __loop: { tour: { getState: () => { startReplay: (m: string) => void } } } }).__loop.tour
        .getState()
        .startReplay('desktop'),
    )
    const pos = page.locator('.tour-popover__pos')
    await expect(pos).toBeVisible()
    // advance once so the two numbers differ and a swap is visible at all
    await page.locator('.tour-popover__foot .btn--primary').click()
    await expect(pos).toHaveText('2 / 6')

    const measured = await pos.evaluate((el) => {
      const t = el.firstChild as Text
      const rect = (from: number, to: number) => {
        const r = document.createRange()
        r.setStart(t, from)
        r.setEnd(t, to)
        const b = r.getBoundingClientRect()
        return { left: b.left, right: b.right }
      }
      const i = t.data.indexOf('/')
      return {
        text: t.data,
        n: rect(0, i),
        total: rect(i + 1, t.data.length),
        direction: getComputedStyle(el).direction,
      }
    })

    expect(measured.text).toBe('2 / 6')
    // the step number paints to the LEFT of the total, the way `2 / 6` is read in
    // every locale that ships this string — including the RTL one, because a
    // counter is a pinned numeric pair and not a sentence
    expect(
      measured.n.right,
      `"${measured.text}" rendered with the step number to the RIGHT of the total — the runs swapped`,
    ).toBeLessThanOrEqual(measured.total.left + 1)
  })
})

// docs/localization.md §L9.3 — `import.qs.mapping`, the second half of the C3.5
// disposition.
//
// That the four column names stay VERBATIM is settled by
// `scripts/example-columns.test.ts`: they are the header row of `EXAMPLE_CSV`, so
// translating one would describe a column the example does not have. Keeping the
// bytes is not the same question as rendering them in the right order, and the
// tour counter is the reason to ask separately — there the value needed no
// translation and the ELEMENT was the defect.
//
// Here the paragraph is PROSE that pairs a column name with a role name, so it
// takes the reader's direction, and the contract is that logical order maps to
// right-to-left: `item_id` rightmost, `drop_rate` leftmost. The `<pre>` above it
// is `dir="ltr"` instead, because that one is literal CSV where the layout is the
// data — the two elements sit next to each other and are ruled differently on
// purpose.

test.describe('ar — the quick-start column mapping keeps its order', () => {
  test('the four CSV column names read right-to-left, in the order the file has them', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ar')

    await page.getByRole('button', { name: /Data|بيانات/ }).click()
    await page.getByRole('menuitem').first().click()
    const dlg = page.locator('.mcdlg--dataimport')
    await expect(dlg).toBeVisible()
    const mapping = dlg.locator('.import__quickstartMapping')
    if (!(await mapping.isVisible().catch(() => false))) {
      await dlg.locator('.import__quickstartToggle').click()
    }
    await expect(mapping).toBeVisible()

    const measured = await mapping.evaluate((el) => {
      const t = el.firstChild as Text
      const names = ['item_id', 'item_name', 'price', 'drop_rate']
      const at = (needle: string) => {
        const i = t.data.indexOf(needle)
        if (i < 0) return null
        const r = document.createRange()
        r.setStart(t, i)
        r.setEnd(t, i + needle.length)
        const b = r.getBoundingClientRect()
        return { left: b.left, right: b.right, top: Math.round(b.top) }
      }
      return {
        text: t.data,
        direction: getComputedStyle(el).direction,
        boxes: names.map((n) => ({ name: n, box: at(n) })),
      }
    })

    // the element really is the reader's direction, unlike the `<pre>` above it
    expect(measured.direction, 'prose takes the reader’s direction').toBe('rtl')
    for (const b of measured.boxes) {
      expect(b.box, `\`${b.name}\` is in the rendered text`).not.toBeNull()
    }

    // RTL: what comes first in the string paints furthest RIGHT. Compared on a
    // per-line basis so a wrap is a wrap and not a reordering.
    const boxes = measured.boxes.map((b) => ({ name: b.name, ...b.box! }))
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1]!
      const cur = boxes[i]!
      if (prev.top === cur.top) {
        expect(
          cur.right,
          `\`${cur.name}\` must paint to the LEFT of \`${prev.name}\` in an rtl paragraph`,
        ).toBeLessThanOrEqual(prev.left + 1)
      } else {
        expect(cur.top, `\`${cur.name}\` wrapped, so it must be on a later line`).toBeGreaterThan(prev.top)
      }
    }

    // and each name is internally intact — a single Latin run never reorders, but
    // asserting it is what distinguishes "the tokens moved" from "a token broke"
    const compact = measured.text.replace(/\s+/g, '')
    for (const n of ['item_id', 'item_name', 'price', 'drop_rate']) {
      expect(compact, `\`${n}\` survives as one run`).toContain(n)
    }
  })
})
