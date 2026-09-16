import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Regression, 2026-09-16 (Lumi/Hanrim review): the palette tooltip used to be
// an absolutely-positioned CHILD of `.toolbar__palette`, shown via a CSS
// `:hover`/`:focus-visible` selector. `.toolbar__palette` has had
// `overflow-x: auto` since the two-tier toolbar redesign (PR #207,
// `a58bdef`) for its own 721-819px horizontal-scroll contract — but per the
// CSS spec, an `overflow` axis left as `visible` computes to `auto` once the
// OTHER axis isn't, so `overflow-y` was silently `auto` too, and the tip's
// below-the-chip popout (positioned outside the palette's own box) was
// clipped invisible, EVEN THOUGH its own `display`/`opacity`/`visibility`
// all read as fully "visible" — `expect(...).toBeVisible()` doesn't check
// ancestor clipping, which is exactly why the suite above never caught this.
// `toBeInViewport()` does (it's computed via intersection with the visible,
// unclipped region, same idea as `IntersectionObserver`), so it's the
// assertion this file uses. Fixed by portaling the tip to `document.body`
// (Toolbar.tsx / usePaletteTipPosition) — this file locks in that it stays
// outside the clipped subtree and genuinely renders on screen, at both a
// wide desktop width and the 721px boundary where the palette's horizontal
// scroll is actually active.

const chip = (page: Page, kind: string) => page.locator(`.chip--${kind}`)
const tip = (page: Page, kind: string) => page.locator(`#palette-tip-${kind}`)

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('a wide desktop: the tip renders outside .toolbar__palette and is genuinely on-screen, not just display:flex', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })

  await chip(page, 'source').hover()
  const t = tip(page, 'source')
  await expect(t).toBeVisible()
  await expect(t).toBeInViewport()

  // structural: proves it escaped `.toolbar__palette`'s overflow-clipping
  // subtree, not just that it happens to be positioned low enough this time
  expect(await page.locator('.toolbar__palette .palette-tip').count()).toBe(0)

  const tipBox = await t.boundingBox()
  const paletteBox = await page.locator('.toolbar__palette').boundingBox()
  expect(tipBox).not.toBeNull()
  expect(paletteBox).not.toBeNull()
  // positioned below the palette, as designed — not just "somewhere on screen"
  expect(tipBox!.y).toBeGreaterThanOrEqual(paletteBox!.y + paletteBox!.height - 1)
})

test('721×720 (the width where the palette actually scrolls horizontally): a middle chip and the rightmost chip both show their tip fully on-screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 721, height: 720 })

  await chip(page, 'source').hover()
  await expect(tip(page, 'source')).toBeInViewport()
  await page.locator('.toolbar__brand').hover()

  // the last chip in the row — closest to the right viewport edge, so this
  // also exercises the horizontal clamp (computeBelowAnchorPos), not just
  // the vertical-clipping fix
  await chip(page, 'register').hover()
  const t = tip(page, 'register')
  await expect(t).toBeInViewport()
  const tipBox = await t.boundingBox()
  expect(tipBox).not.toBeNull()
  expect(tipBox!.x).toBeGreaterThanOrEqual(0)
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(721)
})

test('721×720: menu-open suppression and click suppression still hold with the portaled tip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 721, height: 720 })

  // menu-open suppresses it
  await page.locator('.toolbar__actions .menu > button', { hasText: /^Templates ▾$/ }).click()
  await chip(page, 'pool').hover()
  await expect(tip(page, 'pool')).toBeHidden()
  await page.keyboard.press('Escape')

  // leave+re-enter re-arms it, and the re-armed tip is genuinely on-screen
  await page.locator('.toolbar__brand').hover()
  await chip(page, 'pool').hover()
  await expect(tip(page, 'pool')).toBeInViewport()

  // a click suppresses it immediately, even though the pointer never left
  await chip(page, 'pool').click()
  await expect(tip(page, 'pool')).toBeHidden()
})

// [P2] review (Lumi, 2026-09-16): `usePaletteTipPosition` only recomputed on
// the active chip changing and on `window resize` — scrolling
// `.toolbar__palette` itself (real horizontal-scroll overflow at narrow
// widths) moves the hovered chip on screen without either of those firing,
// so a tooltip could stay glued to its old, now-wrong screen position. Fixed
// with a capture-phase `document` 'scroll' listener (useAnchoredPosition.ts),
// which sees a scroll on ANY scrollable descendant — not just `wheel`, which
// a scrollbar drag or a keyboard-driven scroll never dispatches at all. This
// test drives the scroll via `scrollLeft` directly (not a `wheel` event) for
// exactly that reason: it exercises the actual 'scroll' event path shared by
// every input method, not one specific device's gesture.
test('721×720: scrolling the palette itself repositions an already-showing tooltip, not just resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 721, height: 720 })
  // force genuine horizontal overflow regardless of locale/label widths —
  // same technique as toolbar-responsive.spec.ts's narrowed-toolbar cases
  await page.addStyleTag({ content: '.toolbar__palette { max-width: 260px !important; }' })

  const palette = page.locator('.toolbar__palette')
  // keyboard focus, not hover: a real Tab press (not a programmatic
  // `.focus()`, which doesn't set `:focus-visible` at all — confirmed by
  // palette-tooltip.spec.ts's own keyboard test) so the tip stays showing
  // through the scroll below. Hover doesn't survive it in this Chromium
  // build even for a pure `scrollLeft` set with no real mouse movement —
  // an unrelated browser quirk, not what this test is targeting.
  await chip(page, 'pool').focus()
  await page.keyboard.press('Tab') // pool -> source, WITH genuine :focus-visible
  const t = tip(page, 'source')
  await expect(chip(page, 'source')).toBeFocused()
  await expect(t).toBeInViewport()
  const chipBefore = await chip(page, 'source').boundingBox()
  const tipBefore = await t.boundingBox()
  expect(chipBefore).not.toBeNull()
  expect(tipBefore).not.toBeNull()
  // sanity on the alignment this test relies on: left-aligned under the chip
  expect(Math.abs(tipBefore!.x - chipBefore!.x)).toBeLessThan(2)

  // a modest scroll that keeps the chip fully inside the (forced-narrow)
  // palette window — large enough to move it, small enough that the tip's
  // own horizontal clamp (computeBelowAnchorPos) never needs to engage, so
  // this test isolates "does it track scroll" from "does it clamp near an
  // edge" (a separate, already-correct behavior: confirmed manually that a
  // scroll large enough to push the chip off-screen correctly clamps the
  // tip to stay on-screen instead of following it off — that's not a bug).
  await palette.evaluate((el) => {
    el.scrollLeft = 40
  })

  // confirm a genuine scroll actually happened — not a vacuous pass
  const chipAfter = await chip(page, 'source').boundingBox()
  expect(chipAfter).not.toBeNull()
  expect(Math.abs(chipAfter!.x - chipBefore!.x)).toBeGreaterThan(5)

  // the tooltip must track the chip's NEW position, not stay at the old one
  await expect
    .poll(async () => {
      const b = await t.boundingBox()
      return b ? Math.abs(b.x - chipAfter!.x) : null
    })
    .toBeLessThan(2)
})
