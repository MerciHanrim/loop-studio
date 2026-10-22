import type { Page } from '@playwright/test'
import { dist, parseRgb, probe, rgbAt } from './support/boundary'
import { ensureTimelineOpen, expect, openApp, test } from './support/loop'

// The workbench design tokens (2026-10), pinned on the values the browser
// actually computes. The token set was designed anew from the reviewed
// workbench mock-up (`workbench-free3.html`, dark and `?theme=light`): one set
// of meanings — surfaces, lines, ink, accent, selection and focus, status, node
// kinds, connection meanings, frames, shadows — with a value per theme. Three
// values were corrected from the mock-up (src/index.css measures each);
// correction 1's token (`--ink-4`) was never read and is no longer declared
// (2026-10-21, with `--chart-axis`, `--accent-ink`, `--pos`, `--k-param` and
// `--k-register`). It
// replaced the earlier token set and the Cozy Shelter family layer outright;
// section 3 checks that neither is declared any more.
//
// Section 4 keeps the forced-colours contract: the dot grid is not drawn, a
// plot grid is GrayText. Section 5 pins the hover fill and its rest / hover
// step.

type Table = Record<string, string>

const LIGHT: Table = {
  '--bg-app': 'rgb(227, 230, 234)',
  '--bg-bar': 'rgb(236, 238, 241)',
  '--bg-panel': 'rgb(247, 248, 249)',
  '--bg-head': 'rgb(238, 240, 242)',
  '--bg-raise': 'rgb(226, 229, 233)',
  '--bg-hover': 'rgb(230, 233, 238)',
  '--bg-canvas': 'rgb(241, 242, 244)',
  '--bg-field': 'rgb(255, 255, 255)',
  '--bg-overlay': 'rgb(255, 255, 255)',
  '--bg-node': 'rgb(255, 255, 255)',
  '--label-bg': 'rgb(255, 255, 255)',
  '--line-1': 'rgb(213, 217, 223)',
  '--line-2': 'rgb(191, 197, 205)',
  '--line-3': 'rgb(139, 147, 157)',
  '--line-control': 'rgb(86, 96, 107)', // >= 3:1, not the mock-up's line-2
  '--line-control-hover': 'rgb(57, 66, 76)',
  '--line-disabled': 'rgb(226, 229, 233)',
  '--grid': 'rgb(220, 223, 228)', // correction 3
  '--chart-grid': 'rgb(213, 217, 223)',
  '--ink-1': 'rgb(27, 32, 39)',
  '--ink-2': 'rgb(57, 66, 76)',
  '--ink-3': 'rgb(86, 96, 107)',
  '--ink-disabled': 'rgb(149, 156, 166)', // correction 2
  // the run colour, darkened in its own hue for the Play label (2026-10-21,
  // colour review A); the brand keeps the value it always showed
  '--accent': 'rgb(12, 112, 98)',
  '--accent-soft': 'rgba(12, 112, 98, 0.12)',
  '--accent-trail': 'rgba(12, 112, 98, 0.22)',
  '--accent-glow': 'rgb(12, 112, 98)',
  '--brand': 'rgb(17, 128, 111)',
  '--on-focus': 'rgb(255, 255, 255)',
  '--cue-unmet': 'rgb(86, 96, 107)', // the not-met condition's ring: the tertiary ink in light
  '--sel': 'rgb(36, 99, 209)',
  '--sel-soft': 'rgba(36, 99, 209, 0.12)',
  '--sel-name': 'rgb(31, 86, 194)',
  '--focus': 'rgb(36, 99, 209)',
  '--focus-halo': 'rgba(36, 99, 209, 0.18)',
  '--ok': 'rgb(26, 127, 69)', // 4.71:1 as text on a panel (2026-10-21)
  '--no': 'rgb(173, 62, 42)', // >= 4.5:1 as a glyph on a control face (2026-10-21)
  '--warn': 'rgb(138, 90, 0)',
  '--k-pool': 'rgb(47, 120, 183)',
  '--k-source': 'rgb(61, 138, 82)',
  '--k-drain': 'rgb(181, 83, 47)',
  '--k-converter': 'rgb(122, 92, 196)',
  '--k-gate': 'rgb(143, 122, 18)',
  '--k-end': 'rgb(86, 96, 107)',
  // the run chart's own series tokens (2026-10-21): the kind hues' values and order
  '--series-1': 'rgb(47, 120, 183)',
  '--series-2': 'rgb(143, 122, 18)',
  '--series-3': 'rgb(122, 92, 196)',
  '--series-4': 'rgb(181, 83, 47)',
  '--series-5': 'rgb(61, 138, 82)',
  '--series-6': 'rgb(86, 96, 107)',
  '--m-flow': 'rgb(106, 115, 126)',
  '--m-condition': 'rgb(79, 111, 163)',
  '--m-change': 'rgb(138, 116, 36)',
  '--m-flow-hi': 'rgb(27, 32, 39)',
  '--m-condition-hi': 'rgb(31, 79, 158)',
  '--m-change-hi': 'rgb(107, 86, 0)',
  '--frame-slate': 'rgb(82, 122, 145)',
  '--frame-sage': 'rgb(102, 128, 94)',
  '--frame-gold': 'rgb(154, 118, 57)',
  '--frame-violet': 'rgb(120, 103, 143)',
  '--frame-rose': 'rgb(158, 90, 131)',
}

const DARK: Table = {
  '--bg-app': 'rgb(16, 18, 21)',
  '--bg-bar': 'rgb(22, 24, 28)',
  '--bg-panel': 'rgb(26, 29, 33)',
  '--bg-head': 'rgb(31, 34, 39)',
  '--bg-raise': 'rgb(37, 42, 48)',
  '--bg-hover': 'rgb(46, 51, 58)', // a step stronger than the mock-up's (section 5)
  '--bg-canvas': 'rgb(18, 20, 23)',
  '--bg-field': 'rgb(19, 21, 24)',
  '--bg-overlay': 'rgb(27, 30, 35)',
  '--bg-node': 'rgb(23, 26, 30)',
  '--label-bg': 'rgb(21, 24, 28)',
  '--line-1': 'rgb(43, 47, 54)',
  '--line-2': 'rgb(58, 63, 72)',
  '--line-3': 'rgb(139, 146, 157)',
  '--line-control': 'rgb(164, 171, 181)',
  '--line-control-hover': 'rgb(195, 201, 208)',
  '--line-disabled': 'rgb(37, 42, 48)',
  '--grid': 'rgb(32, 36, 42)',
  '--chart-grid': 'rgb(43, 47, 54)',
  '--ink-1': 'rgb(233, 235, 238)',
  '--ink-2': 'rgb(195, 201, 208)',
  '--ink-3': 'rgb(164, 171, 181)',
  '--ink-disabled': 'rgb(102, 109, 119)', // correction 2
  '--accent': 'rgb(62, 193, 174)',
  '--accent-soft': 'rgba(62, 193, 174, 0.14)',
  '--accent-trail': 'rgba(62, 193, 174, 0.2)',
  '--accent-glow': 'rgba(62, 193, 174, 0.35)',
  '--brand': 'rgb(62, 193, 174)',
  '--on-focus': 'rgb(16, 18, 21)', // white read 2.45:1 on the dark focus blue
  // the not-met condition's ring: never below its old warning colour at the
  // ping's opacities (2026-10-21)
  '--cue-unmet': 'rgb(205, 210, 216)',
  '--sel': 'rgb(111, 166, 255)',
  '--sel-soft': 'rgba(111, 166, 255, 0.15)',
  '--sel-name': 'rgb(185, 209, 255)',
  '--focus': 'rgb(111, 166, 255)',
  '--focus-halo': 'rgba(111, 166, 255, 0.24)',
  '--ok': 'rgb(111, 208, 160)',
  '--no': 'rgb(227, 154, 138)',
  '--warn': 'rgb(227, 193, 138)',
  '--k-pool': 'rgb(111, 168, 214)',
  '--k-source': 'rgb(124, 196, 142)',
  '--k-drain': 'rgb(224, 139, 109)',
  '--k-converter': 'rgb(181, 157, 226)',
  '--k-gate': 'rgb(217, 196, 110)',
  '--k-end': 'rgb(164, 171, 181)',
  '--series-1': 'rgb(111, 168, 214)',
  '--series-2': 'rgb(217, 196, 110)',
  '--series-3': 'rgb(181, 157, 226)',
  '--series-4': 'rgb(224, 139, 109)',
  '--series-5': 'rgb(124, 196, 142)',
  '--series-6': 'rgb(164, 171, 181)',
  '--m-flow': 'rgb(122, 130, 141)',
  '--m-condition': 'rgb(127, 147, 179)',
  '--m-change': 'rgb(168, 160, 122)',
  '--m-flow-hi': 'rgb(211, 216, 223)',
  '--m-condition-hi': 'rgb(183, 203, 239)',
  '--m-change-hi': 'rgb(227, 215, 156)',
  '--frame-slate': 'rgb(120, 166, 190)',
  '--frame-sage': 'rgb(145, 175, 133)',
  '--frame-gold': 'rgb(198, 160, 91)',
  '--frame-violet': 'rgb(169, 155, 192)',
  '--frame-rose': 'rgb(197, 139, 171)',
}

/** non-colour tokens, compared as declared text */
const RAW_LIGHT: Table = {
  '--node-hue-opacity': '0.04',
  '--dim-opacity': '0.3', // correction 3, measured against the dot grid
  '--shadow-node': 'drop-shadow(0 1px 1.5px rgba(20, 30, 45, 0.05))',
  '--shadow-edge-label': '0 1px 3px rgba(20, 30, 45, 0.14)',
  '--shadow-label': '0 1px 2px rgba(20, 30, 45, 0.08)',
  '--shadow-overlay': '0 10px 28px rgba(20, 30, 45, 0.18)',
}
const RAW_DARK: Table = {
  '--node-hue-opacity': '0.04',
  '--dim-opacity': '0.26',
  '--shadow-node': 'none',
  '--shadow-edge-label': 'none',
  '--shadow-label': 'none',
  '--shadow-overlay': 'none',
}

const resolved = async (page: Page, table: Table) => {
  const out: Table = {}
  for (const token of Object.keys(table)) out[token] = await probe(page, `var(${token})`)
  return out
}
const raw = (page: Page, table: Table) =>
  page.evaluate(
    (tokens) =>
      Object.fromEntries(tokens.map((t) => [t, getComputedStyle(document.documentElement).getPropertyValue(t).trim()])),
    Object.keys(table),
  )

for (const [scheme, colours, rawT] of [
  ['light', LIGHT, RAW_LIGHT],
  ['dark', DARK, RAW_DARK],
] as const) {
  test.describe(`workbench tokens — ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
    })

    test('1. every colour token computes to its workbench value', async ({ page }) => {
      expect(await resolved(page, colours)).toEqual(colours)
    })

    test('2. the non-colour tokens, and the browser controls follow the theme', async ({ page }) => {
      expect(await raw(page, rawT)).toEqual(rawT)
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme)
    })
  })
}

test.describe('workbench tokens — nothing of the earlier sets is left', () => {
  test('3. no earlier theme token and no family-layer token is declared; the two radius axes', async ({ page }) => {
    await openApp(page)
    const declared = await page.evaluate(() => {
      const names = new Set<string>()
      for (const sheet of [...document.styleSheets]) {
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          continue
        }
        const walk = (list: CSSRuleList) => {
          for (const r of [...list]) {
            if (r instanceof CSSStyleRule) for (const p of [...r.style]) if (p.startsWith('--')) names.add(p)
            if ('cssRules' in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules)
          }
        }
        walk(rules)
      }
      return [...names]
    })
    const old = declared.filter((n) =>
      /^--(cs|surface|text|signal|state|hue|elev|frame-accent)-|^--line-(hairline|structure|container|strong|focus)$|^--(canvas-grid|flow-strength|flow-trail|activity-edge-glow|focus-ring|warning)$|^--edge-(resource|state|selected|flow|condition|change)/.test(n),
    )
    expect(old, 'the earlier vocabulary is gone').toEqual([])
    expect(declared).toEqual(expect.arrayContaining(['--bg-app', '--ink-1', '--m-flow', '--k-pool', '--sel']))
    // (a custom property's computed value is its substituted value)
    expect(await raw(page, { '--radius': '', '--control-radius': '' })).toEqual({ '--radius': '8px', '--control-radius': '5px' })
    // a standard button is a control; a compact control keeps its own radius
    const radius = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius)
    expect(await radius('.toolbar__actions .btn')).toBe('5px')
    expect(await radius('.pstrip .pb-btn')).toBe('5px')
    expect(await radius('.palette-item .chip, .chip')).toBe('5px')
    expect(await radius('.pstrip__seed'), 'a compact control keeps its own radius').toBe('5px')
    expect(await radius('.minimap-toggle'), 'a compact control keeps its own radius').toBe('4px')
  })
})

// SVG fill and stroke are not recoloured by forced colours. Each grid names a
// system colour, by its role: the dot grid is a decorative position aid —
// thousands of GrayText dots would compete with the nodes and edges — so it is
// the Canvas colour and is not seen; a plot grid is a line values are read
// against, so it is GrayText.
test.describe('workbench tokens — forced colours', () => {
  test.use({ contextOptions: { forcedColors: 'active' } })

  test('4. the canvas dot grid is the Canvas colour (not seen); a plot grid is the system GrayText', async ({ page }) => {
    await openApp(page)
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
    const grayText = await probe(page, 'GrayText')
    const canvasColour = await probe(page, 'Canvas')
    // `color` is a property forced colours override, so a token is resolved
    // through `fill` here — the property the grids actually use, and one the UA
    // leaves alone. That is the whole reason the grid tokens exist: the
    // hairline is still the light theme value when it is used as SVG paint.
    const paint = (css: string) =>
      page.evaluate((v) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        el.style.fill = v
        document.body.append(el)
        const c = getComputedStyle(el).fill
        el.remove()
        return c
      }, css)
    const hairline = await paint('var(--line-1)')
    expect(hairline, 'SVG paint is not recoloured: the hairline is still the light value').toBe('rgb(213, 217, 223)')
    expect(grayText, 'the system colour is not the hairline').not.toBe(hairline)
    expect(await paint('var(--grid)')).toBe(canvasColour)
    expect(await paint('var(--chart-grid)')).toBe(grayText)

    // the dot grid in the DOM (it exists from the L2 zoom up, which is where
    // the starter graph opens): its paint is the canvas's own colour, and the
    // canvas behind it is that colour too, so no dot is seen
    const dot = page.locator('.react-flow__background circle').first()
    await expect(dot).toHaveCount(1)
    expect(await dot.evaluate((el) => getComputedStyle(el).fill)).toBe(canvasColour)
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    // a 48 x 48 patch of empty canvas, three grid periods wide: every pixel is the canvas colour
    const patch: { x: number; y: number }[] = []
    for (let dx = 0; dx < 48; dx++) for (let dy = 0; dy < 48; dy++) patch.push({ x: pane.x + pane.width - 120 + dx, y: pane.y + 80 + dy })
    const seen = await rgbAt(page, await page.screenshot(), patch)
    const offCanvas = seen.filter((c) => dist(c, parseRgb(canvasColour)) > 0).length
    console.log(`[tokens] forced colours: canvas grid fill ${canvasColour} (Canvas), ${offCanvas} of ${seen.length} sampled canvas pixels differ from Canvas; plot grid ${grayText} (GrayText); light hairline is ${hairline}`)
    expect(offCanvas, 'no dot is painted on the empty canvas').toBe(0)

    // a plot grid line, on real pixels
    await ensureTimelineOpen(page)
    // (a horizontal SVG line has a zero-height box, so it is never "visible" to
    //  a locator: it is located by its own rectangle instead)
    const line = page.locator('.timeline__grid').first()
    await expect(line).toHaveCount(1)
    expect(await line.evaluate((el) => getComputedStyle(el).stroke)).toBe(grayText)
    const b = await line.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width }
    })
    expect(b.width).toBeGreaterThan(100)
    const cx = b.x + b.width / 2
    const column = await rgbAt(page, await page.screenshot(), [-1, 0, 1].map((o) => ({ x: cx, y: b.y + o })))
    console.log(`[tokens] forced colours: Timeline grid line pixels ${JSON.stringify(column)}`)
    // a 1 px line on a pixel boundary is anti-aliased over two rows, so the
    // painted pixel is a BLEND of GrayText and the surface. It must sit on the
    // line between those two colours, and nowhere near the light hairline.
    const gray = parseRgb(grayText)
    const surface = parseRgb(await probe(page, 'Canvas'))
    const px = column.reduce((best, c) => (dist(c, surface) > dist(best, surface) ? c : best))
    const t = (surface[0] - px[0]) / (surface[0] - gray[0])
    expect(t, 'the line is painted (a real share of GrayText)').toBeGreaterThan(0.3)
    const blend = surface.map((s, i) => s + t * (gray[i] - s)) as [number, number, number]
    expect(dist(px, blend), 'the painted pixel is a GrayText / surface blend').toBeLessThan(25)
    expect(dist(px, parseRgb(hairline)), 'and it is not the light hairline').toBeGreaterThan(60)
  })
})

// The hover fill is a role of its own (`--bg-hover`), and its step from rest
// must stay visible: that is why dark hover is a step stronger than the
// mock-up's (src/index.css).
for (const scheme of ['light', 'dark'] as const) {
  test(`5. ${scheme}: a hovered menu item is filled with --bg-hover, and the step from rest stays visible`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openApp(page)
    const hoverFill = await probe(page, 'var(--bg-hover)')

    await page.locator('.toolbar__actions .menu > button', { hasText: 'File' }).click()
    const item = page.locator('.toolbar__actions .menu__pop .menu__item').first()
    await expect(item).toBeVisible()
    await page.mouse.move(2, 2)
    await page.waitForTimeout(120)
    const b = (await item.boundingBox())!
    // inside the row's padding, clear of its text: 3 px in from the start edge
    const at = [{ x: b.x + 3, y: b.y + b.height / 2 }]
    const [rest] = await rgbAt(page, await page.screenshot(), at)
    await item.hover()
    await page.waitForTimeout(120)
    expect(await item.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(hoverFill)
    const [hovered] = await rgbAt(page, await page.screenshot(), at)
    const step = Math.round(dist(rest, hovered))
    console.log(`[tokens] ${scheme} menu item: rest ${JSON.stringify(rest)} hover ${JSON.stringify(hovered)} step ${step}`)
    expect(dist(hovered, parseRgb(hoverFill)), 'the hovered row is painted in --bg-hover').toBeLessThan(3)
    expect(step, 'the rest / hover step stays visible').toBeGreaterThanOrEqual(scheme === 'light' ? 30 : 35)
  })
}
