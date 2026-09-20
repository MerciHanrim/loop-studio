import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// docs/visual-language.md §VL8 "Control boundary" — every 1 px control border
// on a panel (`.btn`, the PlayBar's `.pb-btn`, the Timeline's `.timeline__csv`)
// is drawn in the control tokens (`--line-control` at rest, `--line-control-hover`
// hovered) and keeps ≥ 3:1 (WCAG 1.4.11) against the surface behind it AND
// against its own face, in light and dark. Measured on the REAL composited
// pixels of one representative control per surface token: toolbar (panel),
// Share pop (overlay), Filter panel (raised), Import wizard quick-start
// (sunken), PlayBar strip (panel), Timeline legend (panel). The desktop audit
// (2026-09-20) had the shared `--line-structure` border at 1.78 / 1.86 (light,
// vs panel / vs face), 1.65 overlay, 1.51 sunken, 2.15–2.54 dark, and the
// hovered `--line-strong` at 2.88 on the sunken group — the face contrast
// (1.86 / 2.15) was the same on every surface, so the contract is global.
// Guards: ghost / primary render EXACTLY as they did before this change, label
// text ≥ 4.5:1, the
// `:focus-visible` ring is untouched, disabled stays the WCAG exception
// (`opacity: .4`, `.pb-btn:disabled` → `--line-disabled`), and forced colours
// own the border (ButtonBorder / Highlight / GrayText). No pressed contract —
// no desktop `.btn` carries `aria-pressed`.

type Rgb = [number, number, number]
const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const parseRgb = (s: string): Rgb => {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
const r2 = (n: number) => Math.round(n * 100) / 100

/** decode a viewport screenshot in the page and read pixels (deviceScaleFactor 1 → image px = CSS px) */
async function rgbAt(page: Page, png: Buffer, pts: { x: number; y: number }[]): Promise<Rgb[]> {
  return page.evaluate(
    async ({ b64, pts }) => {
      const im = new Image()
      im.src = `data:image/png;base64,${b64}`
      await im.decode()
      const cv = document.createElement('canvas')
      cv.width = im.width
      cv.height = im.height
      const cx = cv.getContext('2d')!
      cx.drawImage(im, 0, 0)
      return pts.map(({ x, y }) => {
        const d = cx.getImageData(Math.round(x), Math.round(y), 1, 1).data
        return [d[0], d[1], d[2]] as [number, number, number]
      })
    },
    { b64: png.toString('base64'), pts },
  )
}

/** the composited boundary of `el`: the darkest-vs-outside column across its left
 *  edge and row across its top edge, the colour 5 px outside (the surface behind
 *  it) and 5 px / 3 px inside (its own face). */
async function boundary(page: Page, el: Locator) {
  const b = (await el.boundingBox())!
  const png = await page.screenshot()
  const cy = b.y + b.height / 2
  const cx = b.x + b.width / 2
  const px = await rgbAt(page, png, [
    { x: b.x - 5, y: cy },
    { x: b.x + 5, y: cy },
    { x: cx, y: b.y - 5 },
    { x: cx, y: b.y + 3 },
    ...[-1, 0, 1, 2].map((o) => ({ x: b.x + o, y: cy })),
    ...[-1, 0, 1, 2].map((o) => ({ x: cx, y: b.y + o })),
  ])
  const [outL, inL, outT, inT] = px
  const pick = (cands: Rgb[], out: Rgb) => cands.reduce((best, c) => (dist(c, out) > dist(best, out) ? c : best))
  const edgeL = pick(px.slice(4, 8), outL)
  const edgeT = pick(px.slice(8, 12), outT)
  return {
    left: { edge: edgeL, out: outL, face: inL, vsOut: r2(ratio(edgeL, outL)), vsFace: r2(ratio(edgeL, inL)) },
    top: { edge: edgeT, out: outT, face: inT, vsOut: r2(ratio(edgeT, outT)), vsFace: r2(ratio(edgeT, inT)) },
  }
}
const expectBoundary = (name: string, m: Awaited<ReturnType<typeof boundary>>) => {
  for (const side of ['left', 'top'] as const) {
    expect(m[side].vsOut, `${name}: ${side} border vs the surface behind the control ≥ 3:1`).toBeGreaterThanOrEqual(3)
    expect(m[side].vsFace, `${name}: ${side} border vs the control's own face ≥ 3:1`).toBeGreaterThanOrEqual(3)
  }
}
const probe = (page: Page, css: string) =>
  page.evaluate((v) => {
    const d = document.createElement('div')
    d.style.color = v
    document.body.append(d)
    const c = getComputedStyle(d).color
    d.remove()
    return c
  }, css)
const computed = (el: Locator) =>
  el.evaluate((e) => {
    const c = getComputedStyle(e)
    return { border: c.borderTopColor, width: c.borderTopWidth, bg: c.backgroundColor, color: c.color, opacity: c.opacity }
  })
const noHover = async (page: Page) => {
  await page.mouse.move(2, 2)
  await page.waitForTimeout(120)
}

/** the six representative controls, one per surface token (+ PlayBar + Timeline) */
type Rep = { name: string; surface: string; open: (page: Page) => Promise<Locator> }
const REPS: Rep[] = [
  {
    name: 'toolbar Templates (.btn)',
    surface: 'panel',
    open: async (page) => page.locator('.toolbar__actions .menu > button.btn', { hasText: /Templates/ }),
  },
  {
    name: 'Share pop Copy (.btn--sm)',
    surface: 'overlay',
    open: async (page) => {
      await page.locator('.toolbar__actions button.btn', { hasText: /^Share$/ }).click()
      await page.locator('.mcdlg--confirm .mcdlg__foot .btn:last-child').click()
      await expect(page.locator('.share-pop .btn').first()).toBeVisible()
      return page.locator('.share-pop .btn').first()
    },
  },
  {
    name: 'Filter panel Clear filters (.btn, enabled)',
    surface: 'raised',
    open: async (page) => {
      await page.evaluate(() => (window as any).__loop.ui.getState().setFilterPanelOpen(true))
      await page.locator('.lgr-filter input[type=checkbox]').first().click()
      const clear = page.locator('.lgr-filter .btn')
      await expect(clear).toBeEnabled()
      return clear
    },
  },
  {
    name: 'Import wizard Download sample CSV (.btn--sm on the sunken quick start)',
    surface: 'sunken',
    open: async (page) => {
      await page.getByRole('button', { name: 'Data ▾' }).click()
      await page.getByRole('menuitem').first().click()
      const btn = page.locator('.mcdlg--dataimport .import__quickstart .btn:not(.btn--primary)').first()
      await expect(btn).toBeVisible()
      return btn
    },
  },
  {
    name: 'PlayBar Step (.pb-btn)',
    surface: 'panel (pstrip)',
    open: async (page) => {
      const step = page.locator('.pstrip .pb-btn:not(.pb-btn--primary):not(:disabled)').first()
      await expect(step).toBeVisible()
      return step
    },
  },
  {
    name: 'Timeline legend CSV (.timeline__csv)',
    surface: 'panel (timeline)',
    open: async (page) => {
      // a run so the CSV button enables (hasRun = series.length >= 2), then show the Timeline
      await page.evaluate(() => {
        const s = (window as any).__loop.sim.getState()
        for (let i = 0; i < 3; i++) s.stepOnce()
      })
      const toggle = page.locator('.pstrip__tl button, .playbar button', { hasText: /timeline/i }).first()
      if (await toggle.isVisible().catch(() => false)) await toggle.click()
      const csv = page.locator('.timeline__legend .timeline__csv')
      await expect(csv).toBeVisible()
      await expect(csv).toBeEnabled()
      return csv
    },
  },
]

async function load(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await noHover(page)
}

test.describe('control boundary contrast (§VL8 / WCAG 1.4.11)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const rep of REPS) {
      test(`${scheme}: ${rep.name} — rest and hover borders ≥ 3:1 vs the ${rep.surface} surface and vs the face; the tokens are --line-control / --line-control-hover`, async ({ page }) => {
        await load(page, scheme)
        const el = await rep.open(page)
        await noHover(page)
        const control = await probe(page, 'var(--line-control)')
        const controlHover = await probe(page, 'var(--line-control-hover)')
        const cs = await computed(el)
        expect(cs.width).toBe('1px')
        expect(cs.opacity).toBe('1')
        expect(ratio(parseRgb(cs.color), parseRgb(cs.bg)), `${rep.name}: label vs face ≥ 4.5`).toBeGreaterThanOrEqual(4.5)
        // the contract is the composited pixel boundary; the token identity is asserted after it
        const rest = await boundary(page, el)
        console.log(`[ctl] ${scheme} ${rep.name} rest: L ${rest.left.vsOut}/${rest.left.vsFace} T ${rest.top.vsOut}/${rest.top.vsFace}`)
        expectBoundary(`${scheme} ${rep.name} rest`, rest)
        await el.hover()
        await page.waitForTimeout(120)
        const hover = await boundary(page, el)
        console.log(`[ctl] ${scheme} ${rep.name} hover: L ${hover.left.vsOut}/${hover.left.vsFace} T ${hover.top.vsOut}/${hover.top.vsFace}`)
        expectBoundary(`${scheme} ${rep.name} hover`, hover)
        expect(dist(hover.left.edge, rest.left.edge), `${rep.name}: hover has its own (stronger) border`).toBeGreaterThan(6)
        expect((await computed(el)).border, `${rep.name}: hover border token`).toBe(controlHover)
        await noHover(page)
        expect(cs.border, `${rep.name}: rest border token`).toBe(control)
      })
    }

    test(`${scheme}: guards — ghost / primary borders, focus ring, disabled opacity and the PlayBar disabled border are unchanged`, async ({ page }) => {
      await load(page, scheme)
      const signal = await probe(page, 'var(--signal-primary)')
      const warning = await probe(page, 'var(--state-warning)')
      const lineStrong = await probe(page, 'var(--line-strong)')
      const focusRing = await probe(page, 'var(--focus-ring)')
      const lineDisabled = await probe(page, 'var(--line-disabled)')
      // ghost (Inspector Delete) — pinned on the RENDERED result, not on the
      // source declarations. `.btn--ghost:hover { border-color: var(--state-warning) }`
      // is (0,2,0) and has always lost to the shared `.btn:hover:not(:disabled)`
      // (0,3,0), so the warning tint has never been painted (no ghost button is
      // ever `disabled`, the one selector state where it could have won). The
      // control-boundary change would otherwise have promoted a hovered ghost to
      // `--line-control-hover`; `.btn--ghost:hover:not(:disabled)` keeps it at
      // `--line-strong`, exactly what shipped. Making the warning tint real is a
      // separate visual decision, deliberately not taken here.
      await page.evaluate(() => {
        const g = (window as any).__loop.graph.getState()
        g.setSelection(g.nodes[0].id, null)
      })
      const ghost = page.locator('aside.inspector .btn--ghost').first()
      await expect(ghost).toBeVisible()
      expect((await computed(ghost)).border, 'ghost at rest: transparent').toBe('rgba(0, 0, 0, 0)')
      await ghost.hover()
      await page.waitForTimeout(120)
      const gh = await computed(ghost)
      expect(gh.border, 'ghost hovered: the pre-change rendered line (--line-strong)').toBe(lineStrong)
      expect(gh.border, 'the unreachable --state-warning is still not painted').not.toBe(warning)
      expect(gh.color).toBe(await probe(page, 'var(--text-primary)'))
      await noHover(page)
      // primary (Monte Carlo Run): --signal-primary at rest AND hovered, the
      // pre-change values — `.btn--primary:hover:not(:disabled)` is (0,3,0) and
      // sits after the shared hover rule, so the control tokens never reach it.
      await page.locator('.pstrip__mc button').click()
      const primary = page.locator('.mcdlg[role="dialog"] .btn--primary').first()
      await expect(primary).toBeVisible()
      // the dialog's cost line resolves asynchronously and reflows the footer —
      // settle it before hovering, and let the CSS assertions retry
      await expect(page.locator('.mcdlg__costlabel').first()).toBeVisible()
      const pr = await computed(primary)
      expect(pr.border, 'primary at rest: --signal-primary').toBe(signal)
      expect(pr.color).toBe(signal)
      await primary.hover()
      await expect(primary, 'primary hovered: still --signal-primary').toHaveCSS('border-top-color', signal)
      await expect(primary, 'primary hovered: the soft fill').toHaveCSS(
        'background-color',
        await probe(page, 'var(--signal-primary-soft)'),
      )
      await noHover(page)
      await page.keyboard.press('Escape')
      await expect(page.locator('.mcdlg[role="dialog"]')).toHaveCount(0)
      // focus-visible ring on a toolbar button: 2 px --focus-ring, offset 2, ≥ 3:1 vs the toolbar
      const tpl = page.locator('.toolbar__actions .menu > button.btn', { hasText: /Templates/ })
      await page.keyboard.press('Shift')
      await tpl.evaluate((e) => (e as HTMLElement).focus())
      await page.waitForTimeout(120)
      const oc = await tpl.evaluate((e) => {
        const c = getComputedStyle(e)
        return { fv: e.matches(':focus-visible'), style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor, offset: c.outlineOffset }
      })
      expect(oc.fv).toBe(true)
      expect(oc.style).toBe('solid')
      expect(oc.width).toBe('2px')
      expect(oc.color).toBe(focusRing)
      const fb = (await tpl.boundingBox())!
      const [ringPx, behind] = await rgbAt(page, await page.screenshot(), [
        { x: fb.x - 3, y: fb.y + fb.height / 2 },
        { x: fb.x - 8, y: fb.y + fb.height / 2 },
      ])
      expect(dist(ringPx, parseRgb(focusRing)), 'the focus ring is painted in --focus-ring').toBeLessThan(40)
      expect(ratio(ringPx, behind), 'focus ring vs the toolbar ≥ 3:1').toBeGreaterThanOrEqual(3)
      await tpl.evaluate((e) => (e as HTMLElement).blur())
      // disabled `.btn`: the WCAG exception is the 0.4 opacity, no enabled-only colour rule
      await page.evaluate(() => (window as any).__loop.ui.getState().setFilterPanelOpen(true))
      const clear = page.locator('.lgr-filter .btn')
      await expect(clear).toBeDisabled()
      const dc = await computed(clear)
      expect(dc.opacity).toBe('0.4')
      expect(dc.border, 'a disabled .btn keeps the same border token (no colour swap on enable)').toBe(await probe(page, 'var(--line-control)'))
      // disabled `.pb-btn`: its own --line-disabled border stays
      const undoLike = page.locator('.pstrip .pb-btn:disabled').first()
      if (await undoLike.count()) expect((await computed(undoLike)).border).toBe(lineDisabled)
    })
  }

  test.describe('forced colours', () => {
    test.use({ contextOptions: { forcedColors: 'active' } })
    test('enabled controls take ButtonBorder, a hovered one Highlight, a disabled one GrayText — the UA owns the border', async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await importGraph(page, readRiskyFactory())
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
      const buttonBorder = await probe(page, 'ButtonBorder')
      const highlight = await probe(page, 'Highlight')
      const grayText = await probe(page, 'GrayText')
      const canvas = parseRgb(await probe(page, 'Canvas'))
      await noHover(page)
      for (const sel of ['.toolbar__actions .menu > button.btn', '.pstrip .pb-btn:not(.pb-btn--primary):not(:disabled)']) {
        const el = page.locator(sel).first()
        await expect(el).toBeVisible()
        expect((await computed(el)).border, `${sel}: enabled = ButtonBorder`).toBe(buttonBorder)
        const b = await boundary(page, el)
        expect(Math.min(b.left.vsOut, b.top.vsOut), `${sel}: boundary vs Canvas`).toBeGreaterThanOrEqual(3)
        expect(ratio(b.left.edge, canvas)).toBeGreaterThanOrEqual(3)
        await el.hover()
        await page.waitForTimeout(120)
        expect((await computed(el)).border, `${sel}: hovered = Highlight`).toBe(highlight)
        await noHover(page)
      }
      await page.evaluate(() => (window as any).__loop.ui.getState().setFilterPanelOpen(true))
      const clear = page.locator('.lgr-filter .btn')
      await expect(clear).toBeDisabled()
      expect((await computed(clear)).border, 'disabled = GrayText').toBe(grayText)
    })
  })
})
