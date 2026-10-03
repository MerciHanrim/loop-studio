import type { Page } from '@playwright/test'
import { dist, parseRgb, probe, rgbAt } from './support/boundary'
import { ensureTimelineOpen, expect, openApp, test } from './support/loop'

// The shell design branch (2026-10-01) put the LIGHT shell on the shared Cozy
// Shelter tokens. Its contract has two halves, and both are pinned here on the
// values the browser actually computes:
//
//   1. the FUNCTIONAL TOKEN VALUES are identical to what they were before — the
//      node hues, the edge / flow / signal colours, the frame accents, the
//      state colours, the graph's own focus colour, the structure line the
//      node silhouettes and chart axes draw, the node and edge-label
//      elevations. The expected values below are `main 16e64b2`'s, written out;
//      a shell change that reaches one of them fails here.
//   2. the SHELL reads the family layer in light only: dark is Loop's own
//      palette, unchanged, because the family layer has no dark values.
//
// The claim is about token values, and it is deliberately no wider:
//   - opaque data marks (node strokes and hues, edges, signal and state marks)
//     were measured pixel-identical between `main` and this branch;
//   - a TRANSLUCENT functional fill (a frame tint, the 4 % hue wash, the flow
//     trail) composites over the shell background, so its rendered result can
//     differ by up to 6 per channel in light. That is the background changing,
//     not the functional colour.
//   - the canvas's INK is not a functional colour. Node titles, edge-chip text
//     and the flow-token count are information ink (`--text-primary` /
//     `--text-secondary`), and the dot grid and plot grids are non-data
//     structure (`--canvas-grid` / `--chart-grid`, the hairline). They follow
//     the shell in light, keep their values in dark, and take a system colour
//     under forced colours, by role (section 4): the dot grid is not drawn,
//     a plot grid is GrayText.
//
// Section 5 pins the hover fill: it is a role of its own (`--surface-hover`),
// so the rest / hover step did not shrink when sunken joined the family ground.

type Table = Record<string, string>

// (`--node-hue` is not in the tables: it is declared per node class, not on the
//  root, and its annotation-node value is `var(--line-structure)`, pinned here.)
const FUNCTION_LIGHT: Table = {
  '--line-structure': 'rgb(193, 190, 180)',
  '--state-focus': 'rgb(63, 111, 182)',
  '--state-selected': 'rgb(84, 82, 76)',
  '--state-fired': 'rgb(47, 116, 110)',
  '--state-arrival': 'rgb(47, 116, 110)',
  '--state-guide': 'rgb(47, 116, 110)',
  '--state-warning': 'rgb(165, 99, 50)',
  '--warning': 'rgb(165, 99, 50)',
  '--signal-primary': 'rgb(47, 116, 110)',
  '--signal-primary-soft': 'rgb(216, 229, 225)',
  '--edge-resource': 'rgb(173, 170, 161)',
  '--edge-state': 'rgb(193, 190, 181)',
  '--edge-selected': 'rgb(84, 82, 76)',
  '--flow-strength': 'rgb(47, 116, 110)',
  '--flow-trail': 'rgba(47, 116, 110, 0.22)',
  '--activity-edge-glow': 'rgb(47, 116, 110)',
  '--hue-pool': 'rgb(82, 122, 145)',
  '--hue-source': 'rgb(102, 128, 94)',
  '--hue-drain': 'rgb(168, 100, 85)',
  '--hue-gate': 'rgb(154, 118, 57)',
  '--hue-converter': 'rgb(120, 103, 143)',
  '--hue-end': 'rgb(117, 111, 104)',
  '--frame-accent-slate': 'rgb(82, 122, 145)',
  '--frame-accent-sage': 'rgb(102, 128, 94)',
  '--frame-accent-gold': 'rgb(154, 118, 57)',
  '--frame-accent-violet': 'rgb(120, 103, 143)',
  '--frame-accent-rose': 'rgb(158, 90, 131)',
}

const FUNCTION_DARK: Table = {
  '--line-structure': 'rgb(99, 104, 95)',
  '--state-focus': 'rgb(131, 169, 230)',
  '--state-selected': 'rgb(154, 158, 150)',
  '--state-fired': 'rgb(118, 183, 174)',
  '--state-arrival': 'rgb(118, 183, 174)',
  '--state-guide': 'rgb(118, 183, 174)',
  '--state-warning': 'rgb(213, 150, 96)',
  '--warning': 'rgb(213, 150, 96)',
  '--signal-primary': 'rgb(118, 183, 174)',
  '--signal-primary-soft': 'rgb(41, 67, 63)',
  '--edge-resource': 'rgb(87, 91, 86)',
  '--edge-state': 'rgb(71, 75, 71)',
  '--edge-selected': 'rgb(154, 158, 150)',
  '--flow-strength': 'rgb(118, 183, 174)',
  '--flow-trail': 'rgba(118, 183, 174, 0.2)',
  '--activity-edge-glow': 'rgba(118, 183, 174, 0.35)',
  '--hue-pool': 'rgb(120, 166, 190)',
  '--hue-source': 'rgb(145, 175, 133)',
  '--hue-drain': 'rgb(209, 138, 120)',
  '--hue-gate': 'rgb(198, 160, 91)',
  '--hue-converter': 'rgb(169, 155, 192)',
  '--hue-end': 'rgb(166, 160, 153)',
  '--frame-accent-slate': 'rgb(120, 166, 190)',
  '--frame-accent-sage': 'rgb(145, 175, 133)',
  '--frame-accent-gold': 'rgb(198, 160, 91)',
  '--frame-accent-violet': 'rgb(169, 155, 192)',
  '--frame-accent-rose': 'rgb(197, 139, 171)',
}

/** non-colour functional tokens, compared as declared text */
const RAW_LIGHT: Table = {
  '--node-hue-opacity': '0.04',
  '--elev-node': 'drop-shadow(0 1px 1.5px rgba(20, 20, 20, 0.05))',
  '--elev-edge-label': '0 1px 3px rgba(20, 20, 20, 0.14)',
  '--elev-label': '0 1px 2px rgba(20, 20, 20, 0.08)',
}
const RAW_DARK: Table = {
  '--node-hue-opacity': '0.04',
  '--elev-node': 'none',
  '--elev-edge-label': 'none',
  '--elev-label': 'none',
}

/** the light shell on the family layer */
const SHELL_LIGHT: Table = {
  '--surface-ground': 'rgb(247, 247, 245)', // --cs-surface-soft
  '--surface-canvas': 'rgb(253, 253, 252)', // --cs-background
  '--surface-panel': 'rgb(255, 255, 255)', // --cs-panel
  '--surface-raised': 'rgb(255, 255, 255)',
  '--surface-overlay': 'rgb(255, 255, 255)',
  '--surface-sunken': 'rgb(247, 247, 245)', // --cs-surface-soft, the token the ground reads: no warm grey left
  '--surface-hover': 'rgb(233, 232, 226)', // its own role and value: the hover step does not shrink with sunken
  '--line-hairline': 'rgb(217, 221, 228)', // --cs-line
  '--canvas-grid': 'rgb(217, 221, 228)', // the dot grid follows the hairline
  '--chart-grid': 'rgb(217, 221, 228)', // so do the plot grids
  '--line-container': 'rgb(217, 221, 228)',
  '--line-control': 'rgb(108, 116, 110)', // Loop's own (>= 3:1), NOT --cs-control-line
  '--line-control-hover': 'rgb(79, 86, 81)', // its own value — does not follow the shared ink
  '--line-strong': 'rgb(140, 136, 126)',
  '--text-primary': 'rgb(32, 36, 42)', // --cs-ink
  '--text-secondary': 'rgb(96, 104, 115)', // --cs-ink-subtle
  '--text-tertiary': 'rgb(108, 116, 110)',
  '--focus-ring': 'rgb(79, 111, 232)', // --cs-accent: the SOLID focus colour
  '--line-focus': 'rgb(79, 111, 232)',
  '--focus-halo': 'rgba(79, 111, 232, 0.18)', // --cs-focus-ring: the halo, never the solid
}

/** dark: Loop's own palette, every value as it was */
const SHELL_DARK: Table = {
  '--surface-ground': 'rgb(23, 26, 24)',
  '--surface-canvas': 'rgb(32, 35, 32)',
  '--surface-panel': 'rgb(39, 42, 39)',
  '--surface-raised': 'rgb(50, 54, 50)',
  '--surface-overlay': 'rgb(43, 48, 44)',
  '--surface-sunken': 'rgb(20, 23, 21)',
  '--surface-hover': 'rgb(20, 23, 21)', // the dark hover fill is what it was
  '--line-hairline': 'rgb(60, 64, 60)',
  '--canvas-grid': 'rgb(60, 64, 60)', // the dark grid is what it was
  '--chart-grid': 'rgb(60, 64, 60)',
  '--line-container': 'rgb(99, 104, 95)', // what containers drew before the split
  '--line-control': 'rgb(167, 175, 168)',
  '--line-control-hover': 'rgb(200, 206, 200)',
  '--line-strong': 'rgb(138, 143, 136)',
  '--text-primary': 'rgb(239, 242, 237)',
  '--text-secondary': 'rgb(200, 206, 200)',
  '--text-tertiary': 'rgb(167, 175, 168)',
  '--focus-ring': 'rgb(131, 169, 230)',
  '--line-focus': 'rgb(131, 169, 230)',
  '--focus-halo': 'rgba(131, 169, 230, 0.24)',
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

for (const [scheme, fn, rawT, shell] of [
  ['light', FUNCTION_LIGHT, RAW_LIGHT, SHELL_LIGHT],
  ['dark', FUNCTION_DARK, RAW_DARK, SHELL_DARK],
] as const) {
  test.describe(`shell tokens — ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
    })

    test('1. every functional colour computes to its pre-branch value', async ({ page }) => {
      expect(await resolved(page, fn)).toEqual(fn)
      expect(await raw(page, rawT)).toEqual(rawT)
    })

    test(`2. the shell: ${scheme === 'light' ? 'the family layer, through the aliases' : "Loop's own dark palette, unchanged"}`, async ({ page }) => {
      expect(await resolved(page, shell)).toEqual(shell)
    })
  })
}

test.describe('shell tokens — the family layer itself', () => {
  test('the nineteen canonical --cs-* tokens are declared with the family values', async ({ page }) => {
    await openApp(page)
    const CS: Table = {
      '--cs-ink': '#20242a',
      '--cs-ink-subtle': '#606873',
      '--cs-font-sans': "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, -apple-system, 'Segoe UI', sans-serif",
      '--cs-background': '#fdfdfc',
      '--cs-panel': '#ffffff',
      '--cs-surface-soft': '#f7f7f5',
      '--cs-line': '#d9dde4',
      '--cs-control-line': '#e1e3e6',
      '--cs-accent': '#4f6fe8',
      '--cs-accent-strong': '#3d58c4',
      '--cs-focus-ring': 'rgba(79, 111, 232, .18)',
      '--cs-success': '#28734b',
      '--cs-warning': '#92651b',
      '--cs-danger': '#cf4b56',
      '--cs-radius': '12px',
      '--cs-control-radius': '8px',
      '--cs-shadow-soft': '0 1px 2px rgba(20, 27, 38, .04), 0 8px 24px rgba(20, 27, 38, .055)',
      '--cs-ci-ink': '#20242a',
      '--cs-ci-inverse': '#ffffff',
    }
    expect(Object.keys(CS)).toHaveLength(19)
    expect(await raw(page, CS)).toEqual(CS)
  })

  test('3. the two radius axes, and the canvas ink that follows the shell by design', async ({ page }) => {
    await openApp(page)
    // (a custom property's computed value is its substituted value)
    expect(await raw(page, { '--radius': '', '--control-radius': '' })).toEqual({
      '--radius': '12px',
      '--control-radius': '8px',
    })
    // a standard button is a control; a compact chip keeps its own radius
    const radius = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius)
    expect(await radius('.toolbar__actions .btn')).toBe('8px')
    expect(await radius('.pstrip .pb-btn')).toBe('8px')
    expect(await radius('.palette-item .chip, .chip')).toBe('8px')
    expect(await radius('.pstrip__seed'), 'a compact control keeps its own radius').toBe('5px')
    expect(await radius('.minimap-toggle'), 'a compact control keeps its own radius').toBe('4px')
  })
})

// SVG fill and stroke are not recoloured by forced colours. Before the grids had
// their own tokens they were painted in the shell hairline, so the light palette
// showed through a high-contrast theme. Each now names a system colour, by its
// role: the dot grid is a decorative position aid — thousands of GrayText dots
// would compete with the nodes and edges — so it is the Canvas colour and is
// not seen; a plot grid is a line values are read against, so it is GrayText.
test.describe('shell tokens — forced colours', () => {
  test.use({ contextOptions: { forcedColors: 'active' } })

  test('4. the canvas dot grid is the Canvas colour (not seen); a plot grid is the system GrayText', async ({ page }) => {
    await openApp(page)
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
    const grayText = await probe(page, 'GrayText')
    const canvasColour = await probe(page, 'Canvas')
    // `color` is a property forced colours override, so a shell token is
    // resolved through `fill` here — the property the grids actually use, and
    // one the UA leaves alone. That is the whole reason the tokens exist: the
    // hairline is still the light shell value when it is used as SVG paint.
    const paint = (css: string) =>
      page.evaluate((v) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        el.style.fill = v
        document.body.append(el)
        const c = getComputedStyle(el).fill
        el.remove()
        return c
      }, css)
    const hairline = await paint('var(--line-hairline)')
    expect(hairline, 'SVG paint is not recoloured: the hairline is still the light shell value').toBe('rgb(217, 221, 228)')
    expect(grayText, 'the system colour is not the shell hairline').not.toBe(hairline)
    expect(await paint('var(--canvas-grid)')).toBe(canvasColour)
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
    console.log(`[shell] forced colours: canvas grid fill ${canvasColour} (Canvas), ${offCanvas} of ${seen.length} sampled canvas pixels differ from Canvas; plot grid ${grayText} (GrayText); light hairline is ${hairline}`)
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
    console.log(`[shell] forced colours: Timeline grid line pixels ${JSON.stringify(column)}`)
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
    expect(dist(px, parseRgb(hairline)), 'and it is not the light shell hairline').toBeGreaterThan(60)
  })
})

// The hover fill used to read the sunken surface. When sunken joined the family
// ground, a hovered row on a white panel would have stepped by an RGB distance
// of 15 instead of 33. Hover is a role of its own now and keeps its values.
for (const scheme of ['light', 'dark'] as const) {
  test(`5. ${scheme}: a hovered menu item is filled with --surface-hover, and the step from rest is what it was`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openApp(page)
    const hoverFill = await probe(page, 'var(--surface-hover)')
    const sunken = await probe(page, 'var(--surface-sunken)')
    if (scheme === 'light') expect(hoverFill, 'hover does not follow the sunken surface').not.toBe(sunken)

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
    console.log(`[shell] ${scheme} menu item: rest ${JSON.stringify(rest)} hover ${JSON.stringify(hovered)} step ${step}`)
    expect(dist(hovered, parseRgb(hoverFill)), 'the hovered row is painted in --surface-hover').toBeLessThan(3)
    // (before the branch a menu row stepped 16 in light — warm overlay to warm
    //  sunken — and 41 in dark; hover following the family ground would be 15)
    expect(step, 'the rest / hover step did not shrink').toBeGreaterThanOrEqual(scheme === 'light' ? 30 : 35)
  })
}
