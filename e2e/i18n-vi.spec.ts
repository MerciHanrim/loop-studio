import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Vietnamese (`vi`). docs/localization.md §L2.21.
//
// The contracts worth a real browser are the ones that can only break in the
// PRODUCT:
//   1 every `vi-*` tag reaches `vi`, its neighbours do NOT, and the choice
//     survives a reload — the §L5.2 step-3 / §L5.1 pair, live
//   2 the picker offers Tiếng Việt, LAST in the sorted set, findable by
//     endonym, by English name and by code — and the `đ → d` fold reaches
//     `Tiếng Đức` from an ASCII keyboard, on the real surface
//   3 the ONE plural category renders: a count of 1 takes the same arm as 4
//   4 `84%` — the sign after the number, with nothing between
//   5 the Vietnamese letters come from IBM Plex Sans, not a per-glyph system
//     fallback, at both weights
//   6 the new Vietnamese face does not CHANGE any other locale: it declares
//     U+0300-0301, U+0303-0304, U+0308-0309 and U+0323, which French, Turkish,
//     Spanish and Portuguese all use, and it is declared last so it wins them
//   7 normalisation: official strings are NFC, the CSS claims no glyph the
//     face lacks, NFD input searches, a raw user string is never normalised,
//     and an NFD label renders without tofu, clipping or overlap
//   8 on a 390px viewport nothing Vietnamese is clipped or overlapping
//   9 the eight node kinds read in Vietnamese on the palette
//
// §L2.21's risk is VERTICAL, like Thai's but for a different reason:
// Vietnamese stacks a TONE mark on top of a vowel that may already carry a
// circumflex or a breve — `ế` is two levels above the x-height and `ệ` adds a
// dot below. Whether that is TALLER than every other Latin locale's tallest
// cluster has not been measured and is not claimed here; 8 does not need it to
// be, because it measures this locale's own ink against the box that clips it
// rather than against another locale's.
//
// 6 is the one the reviewer asked for by name. A cmap entry and a matching
// advance width do NOT prove two faces draw the same glyph: the advance can be
// identical while the outline is not, and a zero-advance combining mark has no
// width to compare at all. So that test loads each subset file under its own
// TEMPORARY family name and compares INK, not metadata.

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

// Built from code points. A Vietnamese letter can carry a diacritic on the
// vowel AND a tone mark above it, and the composed forms are not distinguishable
// from their decomposed twins by eye in a source listing.
const TIENG_VIET = String.fromCharCode(0x54, 0x69, 0x1ebf, 0x6e, 0x67, 0x20, 0x56, 0x69, 0x1ec7, 0x74) // Tiếng Việt
const E_CIRC_ACUTE = String.fromCharCode(0x1ebf) // ế — circumflex + acute, two levels
const E_CIRC_DOT = String.fromCharCode(0x1ec7) // ệ — circumflex above, dot below
const D_STROKE = String.fromCharCode(0x111) // đ
const A_BREVE = String.fromCharCode(0x103) // ă
const O_HORN = String.fromCharCode(0x1a1) // ơ
const U_HORN = String.fromCharCode(0x1b0) // ư
const HORN = String.fromCharCode(0x31b) // U+031B COMBINING HORN — in NO Plex subset

// ------------------------------------------------------------------ 1
test.describe('every Vietnamese tag reaches vi, and its neighbours do not', () => {
  for (const [tag, want] of [
    ['vi', 'vi'],
    ['vi-VN', 'vi'],
    ['vi-Latn', 'vi'],
    // `vi` IS its own base subtag, so §L5.2 step 3 splits on the first subtag
    // and everything after it is carried for free.
    ['vi-Latn-VN', 'vi'],
    ['vi-VN-u-ca-gregory', 'vi'],
    ['VI-vn', 'vi'],
    // The Southeast-Asian neighbours are separate languages with separate
    // scripts. None of them may borrow `vi`, and none of them is on the
    // roadmap — a probe tag that later ships turns this spec red (§L2.19),
    // which is exactly what `vi` did to `i18n-th.spec.ts`.
    ['km', 'en'],
    ['lo', 'en'],
    ['ms', 'en'],
    ['id', 'en'],
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

test('a stored vi survives a reload, and only the exact code restores', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')
  expect(await stored(page)).toBe('vi')

  await page.reload()
  await expect.poll(() => htmlLang(page)).toBe('vi')

  // §L5.1 — a REGION tag is not a registered code, so it is refused and the
  // app falls back rather than half-applying it.
  await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'vi-VN'))
  await page.reload()
  await expect.poll(() => htmlLang(page)).toBe('en')
})

// ------------------------------------------------------------------ 2
test('the picker offers Tiếng Việt, last, findable without a Vietnamese keyboard', async ({
  page,
}) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')
  await openLanguageMenu(page)

  const codes = await page
    .locator('.lang-menu__pop [role="option"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
  // §L5.6 — `Vietnamese` sorts last among the SHIPPED languages by English
  // name. A DEV/QA pseudo-locale is appended after the sorted set (§L5.4), so
  // it can legitimately follow `vi` in a dev build and is not counted here.
  const shipped = codes.filter((c) => c !== 'en-XA')
  expect(shipped[shipped.length - 1]).toBe('vi')
  expect(shipped.indexOf('vi')).toBe(shipped.indexOf('tr') + 1)

  const row = page.locator('.lang-menu__item[data-locale="vi"]')
  // The endonym and the name in a Vietnamese UI are both `Tiếng Việt`, so
  // §L5.3 hides the redundant second line — the row carries ONE label. The
  // selected row also carries a check mark.
  await expect(row.locator('[lang="vi"]')).toContainText(TIENG_VIET)
  const rowText = (await row.innerText()).replace(/\s+/g, ' ').trim()
  expect(rowText.replace(/^✓\s*/, '')).toBe(TIENG_VIET)

  const search = page.locator('.lang-menu__pop input')
  for (const q of [TIENG_VIET, 'tieng viet', 'viet', 'Vietnamese', 'vi']) {
    await search.fill(q)
    await expect(page.locator('.lang-menu__item[data-locale="vi"]'), q).toHaveCount(1)
  }
})

test('the `đ → d` fold finds German and Portuguese from an ASCII keyboard', async ({ page }) => {
  // §L5.5, on the real surface. With the UI in Vietnamese, German reads
  // `Tiếng Đức` and both Portuguese entries read `Tiếng Bồ Đào Nha …`. `Đ` has
  // no decomposition, so before the fold existed a reader typing `duc` or
  // `bo dao nha` — everything an ASCII keyboard can produce, Telex `dduc`
  // included — found NOTHING. This is the product-level proof that they do.
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')
  await openLanguageMenu(page)
  const search = page.locator('.lang-menu__pop input')

  await search.fill('duc')
  await expect(page.locator('.lang-menu__item[data-locale="de"]')).toHaveCount(1)

  await search.fill('bo dao nha')
  // both Portuguese rows, and nothing else
  await expect(page.locator('.lang-menu__item[data-locale="pt-BR"]')).toHaveCount(1)
  await expect(page.locator('.lang-menu__item[data-locale="pt-PT"]')).toHaveCount(1)
  await expect(page.locator('.lang-menu__item[data-locale="de"]')).toHaveCount(0)

  // …and the fold did not make the picker answer everything: a query that
  // matches no row still matches no row.
  await search.fill('dzzz')
  await expect(page.locator('.lang-menu__item')).toHaveCount(0)
})

// ------------------------------------------------------------------ 3
test('a count of 1 renders the one plural arm, with the digit kept', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')

  // the runtime's own category set — ONE entry
  const cats = await page.evaluate(
    () => new Intl.PluralRules('vi').resolvedOptions().pluralCategories,
  )
  expect(cats).toEqual(['other'])

  const cat = await catalog(page)
  const selectors = [...cat['import.summary'].matchAll(/(zero|one|two|few|many|other)\s*\{/g)].map(
    (m) => m[1],
  )
  expect(selectors).toEqual(['other', 'other'])

  // …and this is what the PRODUCT prints. The quick-start example is 1 table
  // and 4 Parameters, so the same message renders a count of 1 and a count of
  // 4 side by side: in English those are different arms, in Vietnamese they
  // must be the same one, and both must keep the number.
  await page.getByRole('button', { name: 'Dữ liệu ▾' }).click()
  await page.getByRole('menuitem').first().click()
  const dlg = page.locator('.mcdlg--dataimport')
  await expect(dlg).toBeVisible()
  await dlg.getByRole('button', { name: 'Dùng ví dụ này' }).click()

  // `import.status.counts` — three plural blocks in one message
  await expect(dlg.locator('.import__status').first()).toContainText('2 cột Số')
  await expect(dlg.locator('.import__status').first()).toContainText('2 dòng')
  await expect(dlg.locator('.import__status').first()).toContainText('4 tham số')

  await dlg.getByRole('button', { name: 'Tiếp' }).click() // placement
  await expect(dlg.getByText(/4 tham số/)).toBeVisible()
  await dlg.getByRole('button', { name: 'Tiếp' }).click() // review
  // `import.summary`: tables = 1. English would print the `one` arm here.
  const text = (await dlg.innerText()).replace(/\s+/g, ' ')
  expect(text, 'a count of 1 must render the `other` arm, with the digit kept').toContain('1 bảng')
  expect(text).toContain('4 tham số')
  // no English singular leaked through
  expect(text).not.toMatch(/\b1 table\b/)
})

// ------------------------------------------------------------------ 4
test('the percent sign follows the number, with nothing between', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')

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
  expect(m.signIndex, m.text).toBeGreaterThan(m.digitIndex)
  expect(m.codePointBeforeSign, `${m.text}: a digit must sit immediately before the sign`)
    .toBeGreaterThanOrEqual(0x30)
  expect(m.codePointBeforeSign).toBeLessThanOrEqual(0x39)
  expect(m.text).toContain('84%')
})

// ------------------------------------------------------------------ 5
test('Vietnamese letters render in Plex, not a per-glyph fallback', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')

  const result = await page.evaluate(
    async (samples: string[]) => {
      // MEASURED four times now (`ru`, `tr`, `th`, `vi`): `document.fonts.check()`
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
    [A_BREVE, D_STROKE, O_HORN, U_HORN, E_CIRC_ACUTE, E_CIRC_DOT, TIENG_VIET],
  )

  const fellBack: string[] = []
  for (const [cp, m] of Object.entries(result)) {
    if (m.p400 === m.s400 && m.p600 === m.s600) fellBack.push(cp)
  }
  expect(fellBack, 'these letters came from a system font, not Plex Vietnamese').toEqual([])
})

// ------------------------------------------------------------------ 6
test('the Vietnamese face draws the one mark it shares exactly as the face it took it from', async ({
  page,
}) => {
  // THE REVIEW POINT, and it moved once under measurement.
  //
  // The first version of this test compared the `vietnamese` subset against the
  // `latin` one on `ế`, and they differed. That was the TEST being wrong, not
  // the font: `latin-400.css` (imported by `main.tsx`) declares the family with
  // NO `unicode-range`, so the browser treats it as a candidate for every code
  // point and, for a precomposed letter it does not have, draws the base from
  // Plex and stacks the marks from elsewhere. Same advance, different ink —
  // which is precisely why a cmap entry and a matching advance prove nothing.
  //
  // The overlap that actually matters is between the RANGED faces, because
  // those are the ones whose claim the cascade has to resolve. Derived below
  // from the live stylesheet rather than written down here, and measured to be
  // exactly ONE code point: U+0301 COMBINING ACUTE, which the Cyrillic face
  // has claimed since `ru` shipped (§L2.17 — Russian stress marks) and which
  // the Vietnamese face, declared after it, now wins.
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')

  // The declared ranges, read from the document. `unicodeRange` comes back as
  // the author wrote it, so it is parsed rather than string-compared.
  const ranges = await page.evaluate(() => {
    const out: string[] = []
    ;(document.fonts as unknown as { forEach: (f: (x: FontFace) => void) => void }).forEach((f) => {
      if (f.family.replace(/["']/g, '') !== 'IBM Plex Sans') return
      if (f.weight !== '400') return
      out.push(f.unicodeRange)
    })
    return out
  })
  const parse = (spec: string): [number, number][] =>
    spec
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^U\+/i.test(s))
      .map((s) => {
        const body = s.slice(2)
        if (body.includes('-')) {
          const [a, b] = body.split('-')
          return [parseInt(a, 16), parseInt(b, 16)] as [number, number]
        }
        if (body.includes('?')) {
          return [parseInt(body.replace(/\?/g, '0'), 16), parseInt(body.replace(/\?/g, 'F'), 16)] as [number, number]
        }
        return [parseInt(body, 16), parseInt(body, 16)] as [number, number]
      })
  // The browser normalises the spec it gives back: the authored `U+0102-0103`
  // reads as `U+102-103` here, and the UNRANGED `latin` face reads as the whole
  // of Unicode, `U+0-10FFFF`. Both are why this parses rather than compares
  // strings.
  const viRange = ranges.find((r) => r.includes('U+102-103'))
  expect(viRange, `no Vietnamese face is declared; saw ${JSON.stringify(ranges)}`).toBeTruthy()
  const inSpec = (spec: string, cp: number) => parse(spec).some(([a, b]) => cp >= a && cp <= b)
  // A face that claims ALL of Unicode is not claiming any code point in
  // particular — it is the unranged fallback, and it loses to every ranged
  // face. Counting it here would make every code point look contested.
  const FULL = (spec: string) => parse(spec).some(([a, b]) => a === 0 && b >= 0x10ffff)
  const contenders = ranges.filter((r) => r !== viRange && r.trim() !== '' && !FULL(r))
  expect(contenders.length, 'there must be other ranged faces to contend with').toBeGreaterThan(0)

  const overlap: number[] = []
  for (const [a, b] of parse(viRange!)) {
    for (let cp = a; cp <= b; cp++) {
      if (contenders.some((r) => inSpec(r, cp))) overlap.push(cp)
    }
  }
  expect(
    overlap.map((c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')),
    'the Vietnamese range must overlap exactly one other declared range',
  ).toEqual(['U+0301'])

  // Fetch both subsets, then read their URLs off the resource timeline.
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 64px "IBM Plex Sans"', 'ế́'),
      document.fonts.load('400 64px "IBM Plex Sans"', 'Приве́т'),
    ])
    await document.fonts.ready
  })
  const urls = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /ibm-plex-sans-(vietnamese|cyrillic)-400-normal[^/]*\.woff2$/.test(n)),
  )
  const viUrl = urls.find((u) => u.includes('vietnamese'))
  const cyrUrl = urls.find((u) => /-cyrillic-400/.test(u))
  expect(viUrl, `no vietnamese subset was fetched; saw ${JSON.stringify(urls)}`).toBeTruthy()
  expect(cyrUrl, `no cyrillic subset was fetched; saw ${JSON.stringify(urls)}`).toBeTruthy()

  const probe = await page.evaluate(
    async ([viU, cyrU]) => {
      // Isolated families: neither name appears in any stylesheet, so the
      // cascade cannot decide the answer and no `unicode-range` applies. A
      // third name is never defined at all — that is the control, and what the
      // browser draws for it is the default-font rendering.
      const mk = async (name: string, url: string) => {
        const f = new FontFace(name, `url(${url}) format('woff2')`)
        await f.load()
        ;(document.fonts as unknown as { add: (f: FontFace) => void }).add(f)
      }
      await mk('__probe_vi', viU)
      await mk('__probe_cyr', cyrU)

      const cv = document.createElement('canvas')
      cv.width = 480
      cv.height = 480
      const ctx = cv.getContext('2d', { willReadFrequently: true })!

      const measure = (family: string, text: string) => {
        ctx.clearRect(0, 0, cv.width, cv.height)
        ctx.font = `400 200px "${family}"`
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#000'
        // a bare combining mark is drawn alone — a dotted-circle carrier would
        // add ink of its own and hide the thing being compared
        ctx.fillText(text, 160, 340)
        const m = ctx.measureText(text)
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data
        let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, sum = 0, n = 0
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            const a = d[(y * cv.width + x) * 4 + 3]
            if (a < 8) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
            sum += a
            n++
          }
        }
        return {
          adv: Math.round(m.width * 100) / 100,
          box: maxX < 0 ? null : [minX, minY, maxX, maxY],
          pixels: n,
          alpha: sum,
        }
      }

      const ACUTE = '́'
      return {
        viAcute: measure('__probe_vi', ACUTE),
        cyrAcute: measure('__probe_cyr', ACUTE),
        noneAcute: measure('__no_such_family_at_all', ACUTE),
        // a letter only the Vietnamese file has, and one only the Cyrillic
        // file has: if these two do NOT differ from the control the harness is
        // not distinguishing faces at all and the comparison above is vacuous
        viOnly: measure('__probe_vi', 'ư'),
        viOnlyNone: measure('__no_such_family_at_all', 'ư'),
        cyrOnly: measure('__probe_cyr', 'Ж'),
        cyrOnlyNone: measure('__no_such_family_at_all', 'Ж'),
      }
    },
    [viUrl!, cyrUrl!] as [string, string],
  )

  // Non-vacuity first: each face must be visibly itself.
  expect(probe.viOnly, `ư must come from the vietnamese file: ${JSON.stringify(probe)}`)
    .not.toEqual(probe.viOnlyNone)
  expect(probe.cyrOnly, `Ж must come from the cyrillic file: ${JSON.stringify(probe)}`)
    .not.toEqual(probe.cyrOnlyNone)
  // and the mark itself must be drawn by both, not fallen back on
  expect(probe.viAcute, `the vietnamese file must draw U+0301: ${JSON.stringify(probe)}`)
    .not.toEqual(probe.noneAcute)
  expect(probe.cyrAcute, `the cyrillic file must draw U+0301: ${JSON.stringify(probe)}`)
    .not.toEqual(probe.noneAcute)

  // THE CONTRACT. Identical INK — the outline, not the metadata — so moving
  // U+0301 to the Vietnamese face changes nothing for Russian.
  expect(
    probe.viAcute,
    `U+0301 must draw identically from either subset: ${JSON.stringify(probe)}`,
  ).toEqual(probe.cyrAcute)
})

// ------------------------------------------------------------------ 7
test.describe('normalisation, and the one thing the font does not carry', () => {
  // WHAT THIS DOES NOT ASSERT, and why.
  //
  // U+031B COMBINING HORN is in no IBM Plex Sans subset today, so a DECOMPOSED
  // `ơ` — `o` + U+031B — draws its horn from the system fallback and looks a
  // little different from the precomposed letter. That is a real, measured,
  // DOCUMENTED limitation (§L2.21), and it is recorded in the docs.
  //
  // An earlier version of this file asserted it: `decomposed width === the
  // width with no Plex in the stack`. That was wrong, because it turns a
  // limitation into a PERMANENT CONTRACT — the day IBM Plex ships the horn and
  // the two forms become identical, the product gets better and the test goes
  // red. A test may not stand in the way of its own subject being fixed.
  //
  // So what is pinned below is the set of properties that must hold whether or
  // not the font ever carries U+031B:
  //
  //   a the strings THIS PRODUCT ships are NFC
  //   b the CSS does not claim a glyph the face cannot draw
  //   c an NFD query finds the same row an NFC query finds
  //   d a raw USER string is stored and read back byte-for-byte, never
  //     silently normalised
  //   e an NFD label renders — ink, no tofu — and is neither clipped nor
  //     overlapping

  test('a — every official Vietnamese string the product serves is NFC', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'vi')
    const bad = await page.evaluate(() => {
      const cat = (window as unknown as { __loop: Loop }).__loop.i18n.getState()
        .activeCatalog as Record<string, string>
      return Object.entries(cat)
        .filter(([, v]) => v.normalize('NFC') !== v || /\p{M}/u.test(v))
        .map(([k]) => k)
    })
    expect(bad, 'the live catalog must be NFC with no combining marks').toEqual([])
  })

  test('b — the CSS claims no code point the Vietnamese face cannot draw', async ({ page }) => {
    // The forward-compatible form of "do not promise what you do not have". It
    // is derived from the LIVE stylesheet and the LIVE font file, so it keeps
    // working if the range is later widened to include U+031B: whatever the
    // range says, the face has to back it.
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'vi')
    await page.evaluate(async () => {
      await document.fonts.load('400 64px "IBM Plex Sans"', 'ếưđ')
      await document.fonts.ready
    })
    const viUrl = (
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => /ibm-plex-sans-vietnamese-400-normal[^/]*\.woff2$/.test(n)),
      )
    )[0]
    expect(viUrl, 'the vietnamese subset must have been fetched').toBeTruthy()

    const out = await page.evaluate(async (url: string) => {
      const ranges: string[] = []
      ;(document.fonts as unknown as { forEach: (f: (x: FontFace) => void) => void }).forEach((f) => {
        if (f.family.replace(/["']/g, '') !== 'IBM Plex Sans' || f.weight !== '400') return
        ranges.push(f.unicodeRange)
      })
      // the browser normalises the spec, so `U+0102-0103` reads as `U+102-103`
      const spec = ranges.find((r) => r.includes('U+102-103'))
      if (!spec) return { error: 'no vietnamese face declared', ranges }
      const cps: number[] = []
      for (const part of spec.split(',').map((x) => x.trim())) {
        const body = part.slice(2)
        const [a, b] = body.includes('-') ? body.split('-') : [body, body]
        for (let cp = parseInt(a, 16); cp <= parseInt(b, 16); cp++) cps.push(cp)
      }

      const face = new FontFace('__probe_vi_claims', `url(${url}) format('woff2')`)
      await face.load()
      ;(document.fonts as unknown as { add: (f: FontFace) => void }).add(face)

      const cv = document.createElement('canvas')
      cv.width = 300
      cv.height = 300
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      const shot = (family: string, text: string) => {
        ctx.clearRect(0, 0, cv.width, cv.height)
        ctx.font = `400 140px "${family}"`
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#000'
        ctx.fillText(text, 60, 210)
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data
        let n = 0
        let sum = 0
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] >= 8) {
            n++
            sum += d[i]
          }
        }
        return n + ':' + sum
      }
      const unsupplied: string[] = []
      for (const cp of cps) {
        const ch = String.fromCodePoint(cp)
        if (shot('__probe_vi_claims', ch) === shot('__no_such_family_at_all', ch)) {
          unsupplied.push('U+' + cp.toString(16).toUpperCase().padStart(4, '0'))
        }
      }
      return { declared: cps.length, unsupplied }
    }, viUrl)

    expect((out as { error?: string }).error).toBeUndefined()
    const r = out as { declared: number; unsupplied: string[] }
    // non-vacuous: the range really does declare a three-figure set
    expect(r.declared, 'the declared range must be read, not empty').toBeGreaterThan(100)
    expect(
      r.unsupplied,
      'every code point the CSS declares must be drawn by the face it points at',
    ).toEqual([])
  })

  test('c — an NFD query finds the same row as the NFC one', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'vi')
    await openLanguageMenu(page)
    const search = page.locator('.lang-menu__pop input')
    // `Tiếng Việt` and `Tiếng Bồ Đào Nha`, decomposed — every tone mark and the
    // horn split off their base. An IME that emits NFD, or a paste from a
    // decomposing source, must still find the row.
    for (const [q, code] of [
      [TIENG_VIET.normalize('NFD'), 'vi'],
      ['Tiếng Bồ Đào Nha'.normalize('NFD'), 'pt-PT'],
      // a bare horn on its base, which is the U+031B case itself
      ['Tự động'.normalize('NFD'), null],
    ] as const) {
      await search.fill(q)
      if (code) await expect(page.locator(`.lang-menu__item[data-locale="${code}"]`), q).toHaveCount(1)
    }
    // …and NFC and NFD of the same query select the SAME set of rows
    const rowsFor = async (q: string) => {
      await search.fill(q)
      return page
        .locator('.lang-menu__item')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.locale))
    }
    expect(await rowsFor(TIENG_VIET.normalize('NFD'))).toEqual(
      await rowsFor(TIENG_VIET.normalize('NFC')),
    )
    expect(await rowsFor('o' + HORN)).toEqual(await rowsFor(O_HORN))
  })

  test('d — a raw user string is stored and read back byte-for-byte', async ({ page }) => {
    // The product must not normalise what the USER typed. `ơ` written as
    // `o`+U+031B is a different sequence from U+01A1 and both are valid
    // Vietnamese input; whichever one arrives is the one that has to come back,
    // out of the store AND out of the DOM.
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'vi')

    // `resetAll` leaves an EMPTY canvas, so a node has to be created first —
    // clicking a palette chip adds one with the locale-independent default
    // label (§L3.4), which this test then overwrites with a user string.
    await page.locator('.toolbar__palette .palette-item').first().click()
    await expect(page.locator('.react-flow__node')).toHaveCount(1)

    const NFD = 'Các bể chứa lớn'.normalize('NFD')
    const NFC = NFD.normalize('NFC')
    expect(NFD, 'the fixture must really be decomposed').not.toBe(NFC)

    const out = await page.evaluate((label: string) => {
      const g = (
        window as unknown as {
          __loop: { graph: { getState: () => { nodes: { id: string }[]; updateNodeData: (id: string, p: Record<string, unknown>) => void } } }
        }
      ).__loop.graph.getState()
      const id = g.nodes[0].id
      g.updateNodeData(id, { label })
      const after = (
        window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; data?: { label?: string } }[] } } } }
      ).__loop.graph.getState().nodes.find((n) => n.id === id)
      return { id, stored: after?.data?.label ?? '' }
    }, NFD)

    expect(out.stored, 'the store must keep the exact code points it was given').toBe(NFD)
    expect(out.stored).not.toBe(NFC)

    // and the DOM carries the same sequence, not a normalised one
    const inDom = await page.evaluate(
      (id: string) =>
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)?.innerText ?? '',
      out.id,
    )
    expect(inDom.includes(NFD), `the DOM must not normalise a user label: ${JSON.stringify(inDom)}`).toBe(true)
  })

  test('e — an NFD label renders, without tofu, clipping or overlap', async ({ page }) => {
    // The one that matters to a reader. It does NOT say the NFD label looks the
    // same as the NFC one, and it does not say it looks different — only that
    // it is legible text inside its box. Both remain true if the font later
    // gains U+031B.
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'vi')

    await page.locator('.toolbar__palette .palette-item').first().click()
    await expect(page.locator('.react-flow__node')).toHaveCount(1)

    const NFD = 'Bể chứa lớn'.normalize('NFD')
    const id = await page.evaluate((label: string) => {
      const g = (
        window as unknown as {
          __loop: { graph: { getState: () => { nodes: { id: string }[]; updateNodeData: (id: string, p: Record<string, unknown>) => void } } }
        }
      ).__loop.graph.getState()
      const nid = g.nodes[0].id
      g.updateNodeData(nid, { label })
      return nid
    }, NFD)

    const m = await page.evaluate((nid: string) => {
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nid}"]`)
      if (!el) return { error: 'node not found' }
      const label = (Array.from(el.querySelectorAll<HTMLElement>('*')).find(
        (x) => (x.textContent ?? '').trim() && !Array.from(x.children).some((c) => (c.textContent ?? '').trim()),
      ) ?? el)
      const text = (label.textContent ?? '').trim()
      const cs = getComputedStyle(label)
      const cv = document.createElement('canvas')
      cv.width = 900
      cv.height = 300
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      const ink = (t: string) => {
        ctx.clearRect(0, 0, cv.width, cv.height)
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#000'
        ctx.fillText(t, 20, 200)
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data
        let n = 0
        let minY = 1e9
        let maxY = -1
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            if (d[(y * cv.width + x) * 4 + 3] < 8) continue
            n++
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        return { pixels: n, minY, maxY }
      }
      // U+E000 is Private Use: no font anywhere draws it, so whatever the
      // browser paints for it IS the tofu box. A label whose ink matches a run
      // of tofu boxes is tofu.
      const TOFU = ''
      const mine = ink(text)
      const tofu = ink(TOFU.repeat([...text].length))
      const plain = ink(text.normalize('NFC'))

      // clipping: ink against the box that actually clips
      let p: HTMLElement | null = label.parentElement
      let clipper: HTMLElement | null = null
      while (p) {
        const pcs = getComputedStyle(p)
        if (!/visible/.test(pcs.overflowY) || !/visible/.test(pcs.overflowX)) {
          clipper = p
          break
        }
        p = p.parentElement
      }
      const lb = label.getBoundingClientRect()
      const cb = clipper?.getBoundingClientRect() ?? null
      // overlap with the node's other laid-out children
      const kids = (Array.from((label.parentElement ?? el).children) as HTMLElement[]).filter((k) => {
        const q = k.getBoundingClientRect()
        return q.width > 0 && q.height > 0
      })
      let overlaps = 0
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect()
          const b = kids[j].getBoundingClientRect()
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
          ) {
            overlaps++
          }
        }
      }
      return {
        text,
        mine,
        tofu,
        plain,
        scrollOverflowX: label.scrollWidth - label.clientWidth,
        scrollOverflowY: label.scrollHeight - label.clientHeight,
        outsideClipper: cb
          ? Math.max(cb.top - lb.top, lb.bottom - cb.bottom, cb.left - lb.left, lb.right - cb.right)
          : -999,
        overlaps,
      }
    }, id)

    const r = m as {
      text: string
      mine: { pixels: number; minY: number; maxY: number }
      tofu: { pixels: number; minY: number; maxY: number }
      plain: { pixels: number }
      scrollOverflowX: number
      scrollOverflowY: number
      outsideClipper: number
      overlaps: number
    }
    expect((m as { error?: string }).error).toBeUndefined()
    // the NFD label really did reach the DOM
    expect(r.text.normalize('NFC')).toBe(NFD.normalize('NFC'))
    // it has ink at all…
    expect(r.mine.pixels, 'the label must render something').toBeGreaterThan(50)
    // …and that ink is not a row of tofu boxes
    expect(
      r.mine.pixels === r.tofu.pixels && r.mine.minY === r.tofu.minY && r.mine.maxY === r.tofu.maxY,
      `the NFD label must not be tofu: ${JSON.stringify(r)}`,
    ).toBe(false)
    // the NFC twin also renders — both forms are legible, which is the whole
    // claim. Their appearance is NOT compared: today they differ by the horn,
    // and if the font ever gains U+031B they will not, and both are fine.
    expect(r.plain.pixels, 'the NFC twin must render too').toBeGreaterThan(50)
    // nothing is cut off, nothing collides
    expect(r.scrollOverflowX, 'the NFD label must not be truncated').toBeLessThanOrEqual(1)
    expect(r.scrollOverflowY, 'the NFD label must not be truncated').toBeLessThanOrEqual(1)
    expect(r.outsideClipper, 'the NFD label must sit inside the box that clips it').toBeLessThanOrEqual(0.5)
    expect(r.overlaps, 'the NFD label must not overlap its siblings').toBe(0)
  })
})

// ------------------------------------------------------------------ 8
test.describe('the translated mobile UI', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('nothing Vietnamese is clipped, and nothing overlaps', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'vi')
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
          // the ink may leave its own BOX. What must not happen is leaving the
          // box that actually CLIPS.
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
            const inBand = box.top >= c.top - 1 && box.bottom <= c.bottom + 1
            if (inBand && (inkTop < c.top - 0.5 || inkBottom > c.bottom + 0.5)) {
              clipped.push(
                `${sel} "${text.slice(0, 24)}" top ${(c.top - inkTop).toFixed(2)} bottom ${(inkBottom - c.bottom).toFixed(2)}`,
              )
            }
          }
        }
      }
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

    expect(report.clipped, 'Vietnamese ink must not leave the box that clips it').toEqual([])
    expect(report.truncated, 'no Vietnamese string may be truncated by its box').toEqual([])
    expect(report.overlaps, 'no two laid-out elements may overlap').toEqual([])
  })
})

// ------------------------------------------------------------------ 8b
/** One measured text element: its INK against the box that actually clips it.
 *
 *  `Range.getClientRects()` returns LINE BOXES, not glyph ink, so it can only
 *  say where a line starts — the ink itself comes from canvas `TextMetrics`
 *  with the element's COMPUTED font, which is the only probe that sees a tone
 *  mark stacked on a circumflex. */
type InkRow = {
  loc: string
  surface: string
  sel: string
  text: string
  fontSize: number
  lineHeight: number
  ascent: number
  descent: number
  /** how far the ink pokes out of the clipping ancestor, px; <= 0 is safe */
  overTop: number
  overBottom: number
  clipped: boolean
}

/** Runs in the page. Measures every visible, text-bearing element matching
 *  `sels`, plus pairwise overlap among the laid-out children of `containers`. */
const INK_PROBE = (arg: { loc: string; surface: string; sels: string[]; containers: string[] }) => {
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  const rows: {
    loc: string
    surface: string
    sel: string
    text: string
    fontSize: number
    lineHeight: number
    ascent: number
    descent: number
    overTop: number
    overBottom: number
    clipped: boolean
  }[] = []
  const overlaps: string[] = []

  for (const sel of arg.sels) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const text = (el.textContent ?? '').trim()
      if (!text) continue
      // LEAF elements only. A container's `textContent` is the concatenation of
      // every descendant, so measuring one treats fifteen laid-out rows as a
      // single line of text and reports hundreds of pixels of imaginary
      // overflow. Measured: `.lang-menu__pop` did exactly that in all five
      // locales before this guard existed.
      if (Array.from(el.children).some((c) => (c.textContent ?? '').trim())) continue
      const box = el.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) continue // not laid out
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const m = ctx.measureText(text)
      const r = document.createRange()
      r.selectNodeContents(el)
      const rects = Array.from(r.getClientRects())
      const lineTop = rects.length ? Math.min(...rects.map((q) => q.top)) : box.top
      const lineBottom = rects.length ? Math.max(...rects.map((q) => q.bottom)) : box.bottom
      const fs = parseFloat(cs.fontSize)
      const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight)
      // FIRST line's ink ceiling and LAST line's ink floor — a wrapped string
      // clips at its own top and bottom, not at one baseline
      const inkTop = lineTop + (lh - fs) / 2 + fs * 0.8 - m.actualBoundingBoxAscent
      const inkBottom = lineBottom - (lh - fs) / 2 - fs * 0.2 + m.actualBoundingBoxDescent

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
      let overTop = -Infinity
      let overBottom = -Infinity
      let clipped = false
      if (clipper) {
        const c = clipper.getBoundingClientRect()
        // only when the element is inside the clipper's visible band — a row
        // scrolled out of a scroll container is not a clip
        const inBand = box.top >= c.top - 1 && box.bottom <= c.bottom + 1
        if (inBand) {
          overTop = c.top - inkTop
          overBottom = inkBottom - c.bottom
          clipped = overTop > 0.5 || overBottom > 0.5
        }
      }
      rows.push({
        loc: arg.loc,
        surface: arg.surface,
        sel,
        text: text.slice(0, 28),
        fontSize: fs,
        lineHeight: Math.round(lh * 100) / 100,
        ascent: Math.round(m.actualBoundingBoxAscent * 100) / 100,
        descent: Math.round(m.actualBoundingBoxDescent * 100) / 100,
        overTop: overTop === -Infinity ? -999 : Math.round(overTop * 100) / 100,
        overBottom: overBottom === -Infinity ? -999 : Math.round(overBottom * 100) / 100,
        clipped,
      })
    }
  }

  for (const cSel of arg.containers) {
    for (const c of Array.from(document.querySelectorAll<HTMLElement>(cSel))) {
      const kids = (Array.from(c.children) as HTMLElement[]).filter((k) => {
        const q = k.getBoundingClientRect()
        return q.width > 0 && q.height > 0 && getComputedStyle(k).position !== 'fixed'
      })
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect()
          const bq = kids[j].getBoundingClientRect()
          const ox = Math.min(a.right, bq.right) - Math.max(a.left, bq.left)
          const oy = Math.min(a.bottom, bq.bottom) - Math.max(a.top, bq.top)
          if (ox > 0.5 && oy > 0.5) {
            overlaps.push(`${arg.loc} ${arg.surface} ${cSel}: ${kids[i].className} x ${kids[j].className}`)
          }
        }
      }
    }
  }
  return { rows, overlaps }
}

/** Opens every CLOSED surface in turn and measures it: each toolbar menu, each
 *  palette tooltip, and the language picker. The tooltips and menu popovers are
 *  the point — they render at the smallest type in the product and are the only
 *  places a two-level Vietnamese cluster has been seen to come close to its
 *  clipper. */
async function sweepClosedSurfaces(page: Page, loc: string) {
  const rows: InkRow[] = []
  const overlaps: string[] = []
  const take = async (surface: string, sels: string[], containers: string[]) => {
    const out = await page.evaluate(INK_PROBE, { loc, surface, sels, containers })
    rows.push(...(out.rows as InkRow[]))
    overlaps.push(...out.overlaps)
  }

  // the always-open chrome first
  await take('toolbar', ['.palette-item', '.toolbar__vr', '.btn'], ['.toolbar__palette'])

  const menus = page.locator('.toolbar__actions .menu')
  for (let i = 0; i < (await menus.count()); i++) {
    await menus.nth(i).locator('> button').click()
    await expect(page.locator('.menu__pop')).toBeVisible()
    await take(
      `menu[${i}]`,
      ['.menu__pop .menu__name', '.menu__pop .menu__blurb', '.menu__pop .menu__ext'],
      ['.menu__pop'],
    )
    await page.keyboard.press('Escape')
  }

  const chips = page.locator('.palette-item')
  for (let i = 0; i < (await chips.count()); i++) {
    await chips.nth(i).hover()
    await expect.poll(() => page.locator('.palette-tip__desc:visible').count()).toBeGreaterThan(0)
    await take(
      `tip[${i}]`,
      ['.palette-tip__name', '.palette-tip__desc', '.palette-tip__how'],
      ['.palette-tip'],
    )
  }

  await openLanguageMenu(page)
  // the row's label is a `.menu__name` inside `.lang-menu__item`, so the item
  // itself is a container and only the spans inside it are measured
  await take(
    'language picker',
    ['.lang-menu__pop .menu__name', '.lang-menu__pop .menu__blurb'],
    ['.lang-menu__list'],
  )
  await page.keyboard.press('Escape')

  return { rows, overlaps }
}

test.describe('vertical metrics, with the real strings and the computed font', () => {
  // §L2.21. Vietnamese stacks a TONE mark on a vowel that may already carry a
  // circumflex or a breve, so its ink ceiling is higher than plain Latin's.
  // Measured HERE rather than asserted from the alphabet, and measured against
  // the box that actually CLIPS rather than against the element's own box —
  // ink routinely leaves its own box and that is not a defect.
  //
  // Four other locales run the identical probe in the same test. They are the
  // REGRESSION arm: Latin (`en`), Turkish (`tr`, dotted/dotless `i` plus
  // cedillas), Cyrillic (`ru`) and Thai (`th`, the tallest stack shipped before
  // this one). If adding the Vietnamese face had disturbed any of them, it
  // would show as ink moving here.
  test('nothing is clipped and nothing overlaps, in vi or in the four regression locales', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)

    const all: InkRow[] = []
    const overlaps: string[] = []
    for (const loc of ['vi', 'en', 'tr', 'ru', 'th'] as const) {
      await setLocale(page, loc)
      const out = await sweepClosedSurfaces(page, loc)
      all.push(...out.rows)
      overlaps.push(...out.overlaps)
    }

    // the sweep must actually have reached the closed surfaces
    const surfaces = new Set(all.map((r) => r.surface))
    const summary = ['vi', 'en', 'tr', 'ru', 'th'].map((loc) => {
      const r = all.filter((x) => x.loc === loc)
      const clipped = r.filter((x) => x.overTop !== -999)
      // The language picker renders every row in its OWN script whatever the
      // UI language is — `简体中文`, `ไทย`, `Русский` — so its ink says
      // nothing about the ACTIVE locale. It stays in the clipping and overlap
      // contract, because it is a real closed surface that must not clip; it
      // is excluded from the per-locale ink comparison, which is about this
      // locale's own copy.
      const own = r.filter((x) => x.surface !== 'language picker')
      return {
        loc,
        measured: r.length,
        withClipper: clipped.length,
        ownCopy: own.length,
        maxAscent: Math.max(...own.map((x) => x.ascent)),
        maxDescent: Math.max(...own.map((x) => x.descent)),
        worstTopMargin: Math.min(...clipped.map((x) => -x.overTop)),
        worstBottomMargin: Math.min(...clipped.map((x) => -x.overBottom)),
      }
    })
    expect(all.length, 'the sweep must find text').toBeGreaterThan(450)
    expect([...surfaces].filter((x) => x.startsWith('menu[')).length).toBeGreaterThan(2)
    expect([...surfaces].filter((x) => x.startsWith('tip[')).length).toBe(8)
    expect(surfaces.has('language picker')).toBe(true)
    // 99 text elements per locale, 80 of them inside a clipping ancestor — so
    // "nothing is clipped" is a statement about 80 real measurements, not about
    // an empty list. The other 19 have no `overflow` ancestor at all and so
    // cannot be clipped by anything; they are counted, not asserted on.
    for (const row of summary) {
      expect(row.measured, `${row.loc} must be measured`).toBeGreaterThan(90)
      expect(row.withClipper, `${row.loc}: clipper coverage`).toBeGreaterThan(70)
      expect(row.ownCopy, `${row.loc}: own-copy elements`).toBeGreaterThan(60)
    }

    // NON-VACUITY, and the §L2.21 vertical claim, measured rather than
    // asserted from the alphabet. MEASURED, at the product's own font sizes,
    // 99 elements per locale of which 80 sit inside something that clips:
    //
    //   locale   max ink ascent   max ink descent   worst top   worst bottom
    //   en            10 px             3 px         +8.80 px     +14.56 px
    //   ru            10 px             3 px        +12.80 px      +8.72 px
    //   tr            12 px             3 px        +13.80 px      +7.22 px
    //   vi            13 px             3 px        +10.80 px      +7.35 px
    //   th            14 px             5 px         +9.80 px     +12.56 px
    //
    // Vietnamese IS the tallest Latin locale shipped — the stacked tone mark is
    // +3px over plain Latin — and Thai is still taller overall. Every clearance
    // is positive, so nothing is clipped anywhere. If the probe were measuring
    // the BOX instead of the INK, every locale would read the same.
    const asc = Object.fromEntries(summary.map((r) => [r.loc, r.maxAscent]))
    expect(asc.vi, 'a stacked Vietnamese cluster must out-reach plain Latin').toBeGreaterThan(asc.en)
    expect(asc.vi).toBeGreaterThan(asc.tr)
    expect(asc.th, 'Thai is still the tallest stack shipped').toBeGreaterThan(asc.vi)

    expect(
      all.filter((r) => r.clipped).map((r) => `${r.loc} ${r.surface} ${r.sel} "${r.text}" top ${r.overTop} bottom ${r.overBottom}`),
      'no ink may leave the box that clips it, in any of the five locales',
    ).toEqual([])
    expect(overlaps, 'no two laid-out elements may overlap').toEqual([])
  })
})

// ------------------------------------------------------------------ 9
test('the eight node kinds read in Vietnamese on the palette', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')

  const labels = await page
    .locator('.toolbar__palette .palette-item')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/^[^\p{L}]+/u, '').trim()))
  const cat = await catalog(page)
  // derived from the catalog, in palette order — the contract is that the
  // PRODUCT shows what the audited catalog says, not that the words are these
  // particular ones (§L2.21 leaves several open for a native review).
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
})

// ------------------------------------------------------------------ NFC
test('what reaches the DOM is NFC, with no combining mark left over', async ({ page }) => {
  // The catalog is checked for this in `viCopy.test.ts`. What is checked HERE
  // is the other end: React, the ICU formatter and the DOM all leave it alone,
  // so what a screen reader and a copy-paste get is the composed form.
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'vi')

  const bad = await page.evaluate(() => {
    const out: string[] = []
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.nodeValue ?? ''
      if (!t.trim()) continue
      if (t.normalize('NFC') !== t || /\p{M}/u.test(t)) out.push(t.slice(0, 40))
    }
    return out
  })
  expect(bad, 'every text node must be NFC and free of combining marks').toEqual([])
})
