import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L2.5 — CJK punctuation inside Chinese text must be
// drawn by the locale's CJK font, while ASCII / Latin letters, digits and code
// tokens keep IBM Plex Sans.
//
// §L2.0 (2026-10) — English and Korean are the shipped languages; Chinese and
// Japanese are archived. The tests that set `html.lang` to `zh-Hans`,
// `zh-Hant` or `ja` to check their own punctuation font, their Latin
// invariance, the absent-font fallback and the no-extra-font-file guard are
// removed here; the eighteen-locale version of this file is kept in
// `archive/i18n/e2e/cjk-punctuation-font.spec.ts`. What stays is the regression
// guard common to the shipped languages: en and ko keep the Latin em dash and
// pull in no Chinese family.
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

test.describe('the shipped locales', () => {
  test('en and ko keep the Latin em dash and pull in no Chinese family', async ({ page }) => {
    await openApp(page)
    for (const lang of ['en', 'ko']) {
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
