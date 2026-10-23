import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L2.5 — CJK punctuation inside Chinese text must be
// drawn by the locale's CJK font, while ASCII / Latin letters, digits and code
// tokens keep IBM Plex Sans.
//
// RED-FIRST, written against the unmodified product. `--font-sans` starts with
// `'IBM Plex Sans'`, which COVERS U+2014 / U+201C / U+201D / U+2026, so those
// four marks never reach the CJK font — the em dash pair `——` renders as two
// short, disconnected Latin strokes instead of one continuous full-width rule.
//
// Everything here is measured, never eyeballed: `CSS.getPlatformFontsForNode`
// reports the family the engine actually used, and an off-screen canvas scan
// counts the separate inked columns so "the pair is broken in two" is a number.

const SC = [/YaHei/i, /SimSun/i, /SimHei/i, /Noto Sans SC/i, /PingFang SC/i, /Source Han Sans SC/i]
const TC = [/JhengHei/i, /MingLiU/i, /Noto Sans TC/i, /PingFang TC/i, /Source Han Sans TC/i, /正黑/, /明體/]
const LATIN = /IBM Plex/i

type Row = { fonts: string[]; glyphs: number; width: number; runs: number }

/** Render `text` at `lang` on the real app stack and report which platform
 *  fonts drew it, the advance width, and how many separate inked runs it has. */
async function probe(page: Page, lang: string, text: string): Promise<Row> {
  await page.evaluate(
    ({ lang, text }) => {
      document.documentElement.lang = lang
      document.getElementById('cjkp')?.remove()
      const el = document.createElement('div')
      el.id = 'cjkp'
      el.style.cssText =
        'position:fixed;left:2px;top:2px;z-index:99999;font-size:22px;white-space:pre;display:inline-block'
      el.textContent = text
      document.body.append(el)
    },
    { lang, text },
  )
  await page.evaluate(() => document.fonts.ready)

  const cdp = await page.context().newCDPSession(page)
  let fonts: { familyName: string; glyphCount: number }[] = []
  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#cjkp' })
    if (nodeId) fonts = [...(await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts]
  } finally {
    await cdp.detach()
  }

  const m = await page.evaluate(() => {
    const el = document.getElementById('cjkp') as HTMLElement
    const width = el.getBoundingClientRect().width
    const S = 4 // supersample, so a one-pixel gap cannot hide
    const c = document.createElement('canvas')
    c.width = Math.ceil(width * S) + 40 * S
    c.height = 60 * S
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = '#000'
    g.font = `${22 * S}px ${getComputedStyle(el).fontFamily}`
    g.fillText(el.textContent ?? '', 10 * S, 40 * S)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let runs = 0
    let prev = false
    for (let x = 0; x < c.width; x++) {
      let ink = false
      for (let y = 0; y < c.height; y++) {
        if (d[(y * c.width + x) * 4] < 128) {
          ink = true
          break
        }
      }
      if (ink && !prev) runs++
      prev = ink
    }
    return { width: Math.round(width * 100) / 100, runs }
  })

  return {
    fonts: fonts.map((f) => f.familyName),
    glyphs: fonts.reduce((n, f) => n + f.glyphCount, 0),
    ...m,
  }
}

const drawnBy = (r: Row, res: RegExp[]) => r.fonts.some((f) => res.some((re) => re.test(f)))

// ------------------------------------------------------------------ 1
test.describe('the Chinese em dash', () => {
  test('zh-Hans draws —— with the Simplified font, as one continuous rule', async ({ page }) => {
    await openApp(page)
    const r = await probe(page, 'zh-Hans', '——')
    expect(drawnBy(r, SC), `expected an SC family, got ${r.fonts.join()}`).toBe(true)
    expect(r.fonts.some((f) => LATIN.test(f)), 'no Latin family may draw it').toBe(false)
    // a full-width pair at 22px is ~44px; the Latin em dash pair is ~34px
    expect(r.width, 'the pair must be full-width').toBeGreaterThan(42)
    expect(r.runs, 'the two dashes must join into ONE inked run').toBe(1)
  })

  test('zh-Hant draws —— with the Traditional font, as one continuous rule', async ({ page }) => {
    await openApp(page)
    const r = await probe(page, 'zh-Hant', '——')
    expect(drawnBy(r, TC), `expected a TC family, got ${r.fonts.join()}`).toBe(true)
    expect(r.fonts.some((f) => LATIN.test(f)), 'no Latin family may draw it').toBe(false)
    expect(r.width, 'the pair must be full-width').toBeGreaterThan(42)
    expect(r.runs, 'the two dashes must join into ONE inked run').toBe(1)
  })

  test('inside a Han run the dash is not a separate Latin island', async ({ page }) => {
    await openApp(page)
    for (const [lang, fams] of [['zh-Hans', SC], ['zh-Hant', TC]] as const) {
      const r = await probe(page, lang, '資——源')
      expect(r.fonts.filter((f) => LATIN.test(f)), `${lang}: Latin must not appear`).toEqual([])
      expect(drawnBy(r, fams), `${lang}: expected the CJK family`).toBe(true)
      expect(r.glyphs, `${lang}: every glyph resolves — no tofu`).toBe(4)
    }
  })
})

// ------------------------------------------------------------------ 2
test.describe('Latin, digits and code tokens are untouched', () => {
  test('stay on IBM Plex in both Chinese locales', async ({ page }) => {
    await openApp(page)
    for (const lang of ['zh-Hans', 'zh-Hant']) {
      for (const [text, width] of [
        ['Ag07', 52.13],
        ['資CSV源', 83.84],
        ['資 4900 源', 107.19],
      ] as const) {
        const r = await probe(page, lang, text)
        expect(r.fonts.some((f) => LATIN.test(f)), `${lang} ${text}: IBM Plex must draw the Latin`).toBe(true)
        expect(r.width, `${lang} ${text}: advance width must not move`).toBeCloseTo(width, 1)
      }
    }
  })

  test('full-width marks that already work are not disturbed', async ({ page }) => {
    await openApp(page)
    for (const [lang, fams] of [['zh-Hans', SC], ['zh-Hant', TC]] as const) {
      const r = await probe(page, lang, '（）。')
      expect(drawnBy(r, fams)).toBe(true)
      expect(r.fonts.some((f) => LATIN.test(f))).toBe(false)
      expect(r.width, 'three full-width marks at 22px').toBe(66)
    }
  })
})

// ------------------------------------------------------------------ 3
test.describe('non-Chinese locales', () => {
  test('en, ko and ja keep the Latin em dash and their own CJK fallback', async ({ page }) => {
    await openApp(page)
    for (const lang of ['en', 'ko', 'ja']) {
      const dash = await probe(page, lang, '——')
      expect(dash.fonts.some((f) => LATIN.test(f)), `${lang}: em dash stays on IBM Plex`).toBe(true)
      expect(dash.width, `${lang}: em dash width unchanged`).toBeCloseTo(34.33, 1)
      const latin = await probe(page, lang, 'Ag07')
      expect(latin.width, `${lang}: Latin width unchanged`).toBeCloseTo(52.13, 1)
      expect(
        dash.fonts.some((f) => SC.some((re) => re.test(f)) || TC.some((re) => re.test(f))),
        `${lang}: no Chinese family may be pulled in`,
      ).toBe(false)
    }
  })
})

// ------------------------------------------------------------------ 4
test.describe('the face is a loan, not a dependency', () => {
  test('falls back to IBM Plex when no local() candidate is installed', async ({ page }) => {
    await openApp(page)
    // the same structure with candidates that cannot exist, so this is exactly
    // the machine-without-the-font case rather than a simulation of it
    await page.evaluate(() => {
      const st = document.createElement('style')
      st.textContent = `@font-face { font-family: 'LS Absent Probe';
          src: local('No Such Family 12345'), local('Also Absent 67890');
          unicode-range: U+2014; }
        :lang(zh-Hans) { --font-sans: 'LS Absent Probe', 'IBM Plex Sans',
          'Noto Sans SC', 'Microsoft YaHei UI', sans-serif; }`
      document.head.append(st)
    })
    await page.evaluate(() => document.fonts.ready)
    const r = await probe(page, 'zh-Hans', '資——源')
    expect(r.fonts.some((f) => LATIN.test(f)), 'the dash returns to IBM Plex').toBe(true)
    expect(r.glyphs, 'still no tofu — every glyph resolves').toBe(4)
    expect(r.width, "today's rendering, unchanged").toBeCloseTo(78.33, 1)
  })

  test('fetches no CJK font file — Chinese costs no extra byte', async ({ page }) => {
    const fonts: string[] = []
    page.on('request', (r) => {
      if (r.resourceType() === 'font' || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(r.url())) {
        fonts.push(r.url())
      }
    })
    await openApp(page)
    const baseline = [...fonts]
    await probe(page, 'zh-Hans', '資——源')
    await probe(page, 'zh-Hant', '資——源')
    // the two Chinese faces are `local()` only, so rendering Chinese must not
    // add a single request beyond the Latin subsets the app already ships
    expect(fonts, 'no font request is added by the Chinese locales').toEqual(baseline)
    expect(
      fonts.filter((u) => !/ibm-plex-(sans|mono)-latin/i.test(u)),
      'every fetched font file is a shipped IBM Plex LATIN subset',
    ).toEqual([])
  })
})
