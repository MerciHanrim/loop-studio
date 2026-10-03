import type { Locator, Page } from '@playwright/test'
import {
  boundary,
  computed,
  dist,
  expectBoundary,
  focusStyle,
  keyboardFocus,
  noHover,
  parseRgb,
  probe,
  ratio,
  rgbAt,
} from './support/boundary'
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
// Guards: ghost (no rest border, `--line-strong` hovered) and primary
// (`--signal-primary`) keep their own borders, label text ≥ 4.5:1, disabled
// stays the WCAG exception (`opacity: .4`, `.pb-btn:disabled` →
// `--line-disabled`), and forced colours own the border (ButtonBorder /
// Highlight / GrayText). No pressed contract — no desktop `.btn` carries
// `aria-pressed`.
//
// Focus (Cozy Shelter tokens v1.1.0 §3, the shell branch): a `.btn` has a
// visible boundary, so its focus indicator is that boundary in the solid focus
// colour plus a 3 px halo, with no outline; a ghost button has none, so it
// keeps the opaque outline. The other bordered controls (thirteen rules) are measured in
// `shell-control-boundary.spec.ts`.

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
      await page.getByRole('button', { name: 'Data' }).click()
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

    test(`${scheme}: guards — ghost / primary borders, the focus boundary + halo, disabled opacity and the PlayBar disabled border`, async ({ page }) => {
      await load(page, scheme)
      const signal = await probe(page, 'var(--signal-primary)')
      const lineStrong = await probe(page, 'var(--line-strong)')
      const controlHoverToken = await probe(page, 'var(--line-control-hover)')
      const focusRing = await probe(page, 'var(--focus-ring)')
      const lineDisabled = await probe(page, 'var(--line-disabled)')
      // ghost (Inspector Delete) — outside the control-boundary contract: no
      // border at rest, `--line-strong` hovered. That pair needs its own (0,3,0)
      // rule to outrank the shared `.btn:hover:not(:disabled)`, so it is pinned
      // here to catch a silent promotion to the control token.
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
      expect(gh.border, 'ghost hovered: --line-strong, not the control token').toBe(lineStrong)
      expect(gh.border, 'ghost hovered: never the control-boundary token').not.toBe(controlHoverToken)
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
      // focus on a bordered toolbar button (class A): the BOUNDARY is the solid
      // indicator — `--line-focus`, ≥ 3:1 against the toolbar AND the face, on
      // real pixels — a halo accompanies it, and there is no outline
      const tpl = page.locator('.toolbar__actions .menu > button.btn', { hasText: /Templates/ })
      const restEdge = (await boundary(page, tpl)).left.edge
      await keyboardFocus(page, tpl)
      const fs = await focusStyle(tpl)
      expect(fs.fv).toBe(true)
      expect(fs.outlineStyle, 'class A: the border stands in for the outline').toBe('none')
      expect(fs.border, 'the boundary takes the solid focus colour').toBe(focusRing)
      expect(fs.boxShadow, 'a 3 px halo accompanies it').toMatch(/0px 0px 0px 3px/)
      const focused = await boundary(page, tpl)
      console.log(`[ctl] ${scheme} toolbar Templates (.btn) focus: L ${focused.left.vsOut}/${focused.left.vsFace} T ${focused.top.vsOut}/${focused.top.vsFace}`)
      expectBoundary(`${scheme} toolbar .btn focused`, focused)
      expect(dist(focused.left.edge, parseRgb(focusRing)), 'the boundary is painted in the focus colour').toBeLessThan(40)
      expect(dist(focused.left.edge, restEdge), 'focus reads differently from rest').toBeGreaterThan(6)
      // the halo alone must never be the indicator: it is far below 3:1
      const fb = (await tpl.boundingBox())!
      const [haloPx, behind] = await rgbAt(page, await page.screenshot(), [
        { x: fb.x - 2, y: fb.y + fb.height / 2 },
        { x: fb.x - 8, y: fb.y + fb.height / 2 },
      ])
      expect(ratio(haloPx, behind), 'the halo is a companion, not the indicator').toBeLessThan(3)
      expect(dist(haloPx, behind), 'the halo is painted').toBeGreaterThan(3)
      await tpl.evaluate((e) => (e as HTMLElement).blur())
      // a ghost button has no boundary at rest (class B): the opaque outline stays
      await keyboardFocus(page, ghost)
      const gf = await focusStyle(ghost)
      expect(gf.fv).toBe(true)
      expect(gf.outlineStyle).toBe('solid')
      expect(gf.outlineWidth).toBe('2px')
      expect(gf.outlineColor).toBe(focusRing)
      await ghost.evaluate((e) => (e as HTMLElement).blur())
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
