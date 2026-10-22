import { expect, type Locator, type Page } from '@playwright/test'

// The workbench's menu bar (docs/workbench.md §WB2), as a user reaches it:
// File holds Templates, View holds Theme and Language. A menu that the bar has
// moved into the ⋯ overflow is reached through ⋯ first. On the phone the same
// settings are rows of the More sheet.

const isMobileLayout = (page: Page) => page.evaluate(() => document.querySelector('.wb-toolrow') == null)

/** whether `a` is shown, once `a` or one of `others` is: a folded control
 *  stays in the DOM, hidden, so neither presence nor a single instant
 *  `isVisible` tells (a page still drawing its menu bar shows none yet) */
async function shownOf(a: Locator, ...others: Locator[]): Promise<boolean> {
  const shown = (l: Locator) => l.isVisible().catch(() => false)
  await expect.poll(async () => {
    for (const l of [a, ...others]) if (await shown(l)) return true
    return false
  }).toBe(true)
  return shown(a)
}

/** a menu bar group's trigger, opening ⋯ first when the group has moved there */
async function trigger(page: Page, group: '.toolbar__filemenu' | '.wb-viewmenu'): Promise<Locator> {
  const inline = page.locator(`.toolbar__actions ${group} > .wb-mb`)
  if (await shownOf(inline, page.locator('.toolbar__overflow-btn'))) return inline
  await page.locator('.toolbar__overflow-btn').click()
  const inMore = page.locator(`.toolbar__overflow-pop ${group} > .wb-mb`)
  await expect(inMore).toBeVisible()
  return inMore
}

/** open View (desktop). Its controls stay open across clicks (a Theme or a
 *  Language is a multi-click adjustment); Escape closes it. */
export async function openViewMenu(page: Page): Promise<void> {
  const t = await trigger(page, '.wb-viewmenu')
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click()
  await expect(t).toHaveAttribute('aria-expanded', 'true')
}

/** a View row — `focus`, `filter`, `activity`, `minimap` (toggles with
 *  `aria-pressed`, as the canvas rail's buttons had) or `reset` — with View
 *  open. View stays open across its rows' clicks; a click elsewhere or
 *  Escape closes it. */
export async function viewRow(page: Page, hook: 'focus' | 'filter' | 'activity' | 'minimap' | 'reset'): Promise<Locator> {
  await openViewMenu(page)
  const row = page.locator(`.wb-viewmenu__pop [data-view-row="${hook}"]`)
  await expect(row).toBeVisible()
  return row
}

type ViewHook = 'focus' | 'filter' | 'activity' | 'minimap' | 'reset'
/** close View with its own trigger — not Escape, which the canvas's own
 *  surfaces (the filter panel, a selection) may also take */
async function closeView(page: Page): Promise<void> {
  const t = page.locator('.toolbar__actions .wb-viewmenu > .wb-mb, .toolbar__overflow-pop .wb-viewmenu > .wb-mb').first()
  if ((await t.getAttribute('aria-expanded').catch(() => null)) === 'true') await t.click()
  await expect(page.locator('.wb-viewmenu__pop')).toHaveCount(0)
}
/** press a View row as a user does — open View, click the row — and close
 *  View again (Reset view closes it itself), so the canvas is not under it */
export async function pressViewRow(page: Page, hook: ViewHook): Promise<void> {
  await (await viewRow(page, hook)).click()
  if (hook !== 'reset') await closeView(page)
}
/** a View toggle's `aria-pressed`, read with View open, then closed again */
export async function viewRowPressed(page: Page, hook: ViewHook): Promise<string | null> {
  const v = await (await viewRow(page, hook)).getAttribute('aria-pressed')
  await closeView(page)
  return v
}

/** a row of Edit, Insert or Run by its visible name, with that menu open */
export async function menuRow(page: Page, menu: 'edit' | 'insert' | 'run', name: string | RegExp): Promise<Locator> {
  const wrap = page.locator(`[data-menu="${menu}"]`)
  const trig = wrap.locator('> .wb-mb')
  if (!(await shownOf(trig, page.locator('.toolbar__overflow-btn')))) {
    await page.locator('.toolbar__overflow-btn').click()
  }
  if ((await trig.getAttribute('aria-expanded')) !== 'true') await trig.click()
  const row = wrap.locator('[role="menuitem"], [role="menuitemcheckbox"]').filter({ has: page.locator('.menu__name', { hasText: name }) })
  await expect(row.first()).toBeVisible()
  return row.first()
}

/** close Edit, Insert or Run by its own trigger (not Escape, which the
 *  canvas may also take) */
export async function closeMenu(page: Page, menu: 'edit' | 'insert' | 'run'): Promise<void> {
  const trig = page.locator(`[data-menu="${menu}"] > .wb-mb`)
  if ((await trig.getAttribute('aria-expanded').catch(() => null)) === 'true') await trig.click()
}
/** a menu row's state, read with its menu open, then closed again:
 *  `enabled`, and `note` — the second line a row shows for a state it is in
 *  (Suggest frames after the graph changed: the rail button's `is-stale`) */
export async function menuRowState(page: Page, menu: 'edit' | 'insert' | 'run', name: string | RegExp): Promise<{ enabled: boolean; note: string | null }> {
  const row = await menuRow(page, menu, name)
  const r = { enabled: await row.isEnabled(), note: (await row.locator('.menu__blurb').count()) > 0 ? await row.locator('.menu__blurb').innerText() : null }
  await closeMenu(page, menu)
  return r
}

/** the desktop canvas tools, always on screen: the tool row's tools and lock
 *  (docs/workbench.md §WB3) and the status bar's Focus and zoom (§WB8) — what
 *  the canvas rail held before 2026-10 */
export const toolButton = (page: Page, tool: 'select' | 'pan' | 'region' | 'frame' | 'lock'): Locator => page.locator(`.wb-toolrow [data-tool="${tool}"]`)
export const statusFocus = (page: Page): Locator => page.locator('.wb-status').getByRole('button', { name: 'Focus', exact: true })
export const statusZoomIn = (page: Page): Locator => page.locator('.wb-status').getByRole('button', { name: 'Zoom in', exact: true })

/** the left list's Inputs tab (docs/workbench.md §WB5) — the Inputs and
 *  Summary panels, moved there from the right column. By its id, so it holds
 *  in any interface language. */
export async function openInputsTab(page: Page): Promise<void> {
  const tab = page.locator('.wb-left [role="tab"][id$="-tab-inputs"]')
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

/** Speed and Seed on screen, as a user reaches them: in the run row, or —
 *  where the row folds them (docs/workbench.md §WB7: at 1024 and 1280 with
 *  the default panels) — in the Run settings popover, opened by its button */
export async function openRunSettings(page: Page): Promise<void> {
  const btn = page.locator('.pstrip:not(.pstrip--mobile) .pstrip__settings-btn')
  if ((await btn.isVisible().catch(() => false)) && (await btn.getAttribute('aria-expanded')) !== 'true') await btn.click()
  await expect(page.locator('.pstrip__seed')).toBeVisible()
}

/** the Monte-Carlo dialog, opened as a user opens it: the run row's button
 *  where the row shows it, else Run ▸ Monte Carlo… (the row folds its button
 *  at 1024 and 1280 with the default panels, docs/workbench.md §WB7). Returns
 *  which way it went. */
export async function openMonteCarloDialog(page: Page): Promise<'row' | 'menu'> {
  const rowBtn = page.locator('.pstrip:not(.pstrip--mobile) .pstrip__mc-btn')
  const wrap = page.locator('[data-menu="run"]')
  const trig = wrap.locator('> .wb-mb')
  const more = page.locator('.toolbar__overflow-btn')
  let via: 'row' | 'menu' = 'row'
  if (await shownOf(rowBtn, trig, more)) await rowBtn.click()
  else {
    via = 'menu'
    // the row by its key, so it holds in any interface language
    if (!(await shownOf(trig, more))) await more.click()
    if ((await trig.getAttribute('aria-expanded')) !== 'true') await trig.click()
    await wrap.locator('[role="menuitem"][data-row="mc"]').click()
  }
  await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
  return via
}

/** open File (desktop) */
export async function openFileMenu(page: Page): Promise<void> {
  const t = await trigger(page, '.toolbar__filemenu')
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click()
  await expect(page.locator('.toolbar__filemenu-pop')).toBeVisible()
}

/** File ▸ Templates ▸ the template `id` (its `data-template`), or the first
 *  one listed. The replace confirmation, when the open document has nodes,
 *  is left to the caller. */
export async function pickTemplate(page: Page, id?: string): Promise<void> {
  await openFileMenu(page)
  const items = page.locator('.toolbar__filemenu-pop [data-template]')
  await (id == null ? items.first() : page.locator(`.toolbar__filemenu-pop [data-template="${id}"]`)).click()
}

/** pick a language with the real control: View ▸ Language on the desktop,
 *  More ▸ Language on the phone; waits until the switch has landed */
export async function pickLocale(page: Page, code: string): Promise<void> {
  const mobile = await isMobileLayout(page)
  if (mobile) await page.locator('[data-tour="mobile-more"]').click()
  else await openViewMenu(page)
  const sw = page.locator(mobile ? '.sheet__row .lang-switch' : '.wb-viewmenu__pop .lang-switch').first()
  await sw.click()
  await expect(sw).toHaveAttribute('aria-expanded', 'true')
  const item = page.locator(`.lang-menu__item[data-locale="${code}"]`)
  await expect(item).toBeVisible()
  await item.click()
  // the switch is atomic and only lands once the catalog has loaded (§L4.5)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
  await page.keyboard.press('Escape')
}
