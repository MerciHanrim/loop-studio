import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, runMc, test } from './support/loop'

// Issue #307 — one keyboard contract for every menu, measured on every menu
// (src/ui/useMenuKeyboard.ts states it):
//
//   - Enter / Space open with focus on the first item; a pointer open leaves
//     focus on the button
//   - Arrow Down / Up on the CLOSED button open at the first / last item
//   - inside: Arrow Down / Up step and wrap, Home / End jump, separators and
//     disabled items are never landed on
//   - Escape closes the menu once and returns focus to its button
//   - Tab / Shift+Tab close the menu and move on from its button
//   - a keyboard choice that opens no dialog returns focus to the button; one
//     that opens a dialog gives the dialog focus, and closing it returns here
//
// Settings and the toolbar overflow are disclosures, not menus; Language is a
// combobox; the phone's sheets are dialogs, one active layer at a time.

const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'

/** the popup that belongs to a trigger: inside the trigger's own wrapper */
const popOf = (trigger: Locator): Locator => trigger.locator('xpath=..').locator('[role="menu"]').first()

/** which usable item has focus (-1 = none), and how many there are */
const activeItem = (pop: Locator) =>
  pop.evaluate((p, sel) => {
    const items = [...p.querySelectorAll<HTMLElement>(sel)].filter((e) => e.offsetParent !== null && !(e as HTMLButtonElement).disabled && e.getAttribute('aria-disabled') !== 'true')
    return { index: items.indexOf(document.activeElement as HTMLElement), count: items.length, role: document.activeElement?.getAttribute('role') ?? null }
  }, ITEM)

/** mark the element Tab (or Shift+Tab) reaches from the CLOSED trigger */
async function markNeighbour(page: Page, trigger: Locator, key: 'Tab' | 'Shift+Tab', mark: string): Promise<void> {
  await trigger.focus()
  await page.keyboard.press(key)
  await page.evaluate((m) => document.activeElement?.setAttribute(m, ''), mark)
}
const markedIsFocused = (page: Page, mark: string) => page.evaluate((m) => document.activeElement?.hasAttribute(m) ?? false, mark)

async function expectMenuContract(page: Page, trigger: Locator, prepare: () => Promise<void> = async () => {}): Promise<void> {
  await prepare()
  const pop = popOf(trigger)
  await markNeighbour(page, trigger, 'Tab', 'data-e2e-next')
  await prepare()
  await markNeighbour(page, trigger, 'Shift+Tab', 'data-e2e-prev')
  await prepare()

  // Enter: open at the first item; the keys inside
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(pop).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => activeItem(pop).then((a) => a.index)).toBe(0)
  const { count } = await activeItem(pop)
  expect(count).toBeGreaterThan(1)
  await page.keyboard.press('ArrowDown')
  expect((await activeItem(pop)).index).toBe(1)
  await page.keyboard.press('ArrowUp')
  expect((await activeItem(pop)).index).toBe(0)
  await page.keyboard.press('ArrowUp') // wraps to the last
  expect((await activeItem(pop)).index).toBe(count - 1)
  await page.keyboard.press('ArrowDown') // wraps to the first
  expect((await activeItem(pop)).index).toBe(0)
  await page.keyboard.press('End')
  expect((await activeItem(pop)).index).toBe(count - 1)
  await page.keyboard.press('Home')
  expect((await activeItem(pop)).index).toBe(0)
  // Escape: closed, focus on the button
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // Space: the same entry
  await page.keyboard.press(' ')
  await expect.poll(() => activeItem(pop).then((a) => a.index)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  // the closed button: Arrow Down at the first item, Arrow Up at the last
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => activeItem(pop).then((a) => a.index)).toBe(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => activeItem(pop).then((a) => a.index)).toBe(count - 1)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  // Tab / Shift+Tab: the menu closes and focus moves on from the BUTTON
  await page.keyboard.press('Enter')
  await expect.poll(() => activeItem(pop).then((a) => a.index)).toBe(0)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Tab')
  await expect(pop).toHaveCount(0)
  expect(await markedIsFocused(page, 'data-e2e-next')).toBe(true)
  await prepare()
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => activeItem(pop).then((a) => a.index)).toBe(0)
  await page.keyboard.press('Shift+Tab')
  await expect(pop).toHaveCount(0)
  expect(await markedIsFocused(page, 'data-e2e-prev')).toBe(true)

  // a pointer open leaves focus on the button
  await prepare()
  await trigger.click()
  await expect(pop).toBeVisible()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await page.evaluate(() =>
    document.querySelectorAll('[data-e2e-next], [data-e2e-prev]').forEach((e) => {
      e.removeAttribute('data-e2e-next')
      e.removeAttribute('data-e2e-prev')
    }),
  )
}

const toolbarButton = (page: Page, name: string) => page.locator('.toolbar__actions .menu > button', { hasText: name }).first()

test.describe('every menu keeps the one keyboard contract', () => {
  test('Templates', async ({ page }) => {
    await openApp(page)
    await expectMenuContract(page, page.locator('.toolbar__actions-core > .menu > .btn').first())
  })
  test('Insert module', async ({ page }) => {
    await openApp(page)
    await expectMenuContract(page, toolbarButton(page, 'Insert module'))
  })
  test('File, with its separator never landed on', async ({ page }) => {
    await openApp(page)
    await expectMenuContract(page, toolbarButton(page, 'File'))
  })
  test('Data', async ({ page }) => {
    await openApp(page)
    await expectMenuContract(page, toolbarButton(page, 'Data'))
  })
  test('Help, as #306 made it, with its separators never landed on', async ({ page }) => {
    await openApp(page)
    await expectMenuContract(page, page.locator('[data-tour="help-trigger"]'))
  })
  test('Theme, inside Settings: radio items, and Escape closes it alone', async ({ page }) => {
    await openApp(page)
    const settings = page.locator('.toolbar__settingsmenu > button')
    const openSettings = async () => {
      if ((await settings.getAttribute('aria-expanded')) !== 'true') await settings.click()
      await expect(page.locator('.toolbar__settingsmenu-pop')).toBeVisible()
    }
    const theme = page.locator('.theme-menu > button')
    await expectMenuContract(page, theme, openSettings)
    await openSettings()
    await theme.focus()
    await page.keyboard.press('Enter')
    const radios = page.locator('.theme-menu__pop [role="menuitemradio"]')
    await expect(radios).toHaveCount(3)
    await expect(page.locator('.theme-menu__pop [role="menuitemradio"][aria-checked="true"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.theme-menu__pop')).toHaveCount(0)
    await expect(page.locator('.toolbar__settingsmenu-pop')).toBeVisible()
    await expect(theme).toBeFocused()
  })
  test('the Distribution panel’s export menu', async ({ page }) => {
    await openApp(page)
    await importGraph(page, readRiskyFactory())
    await runMc(page, { runs: 20, steps: 10 })
    const trigger = page.locator('.dist .timeline__csv[aria-haspopup="true"]')
    await expect(trigger).toBeEnabled()
    await expectMenuContract(page, trigger)
  })
})

test.describe('the temporary session’s menu', () => {
  // Reached the way a person reaches it, from Settings → Storage and privacy.
  // A profile that STARTS temporary reads no stored key, so the first-run tour
  // would open over the toolbar and take the clicks.
  const toTemporary = async (page: Page) => {
    await openApp(page)
    await page.locator('.toolbar__settingsmenu > button').click()
    await page.locator('[data-settings-row="storage-privacy"]').click()
    const dlg = page.locator('.mcdlg--storage')
    await dlg.locator('[data-storage-action="to-temporary"]').click()
    await dlg.locator('[data-storage-confirm]').click()
    await expect(dlg).toHaveCount(0)
    await expect(page.locator('[data-session-chip="temporary"]')).toBeVisible()
  }
  test('keeps the contract too', async ({ page }) => {
    await toTemporary(page)
    await expectMenuContract(page, page.locator('[data-session-chip="temporary"]'))
  })
  test('a download chosen from the keyboard returns focus to the button', async ({ page }) => {
    await toTemporary(page)
    const chip = page.locator('[data-session-chip="temporary"]')
    await chip.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.session-chip__pop [role="menuitem"]').first()).toBeFocused()
    await page.keyboard.press('Enter') // Export the diagram as a file
    await expect(chip).toBeFocused()
  })
})

test.describe('where focus goes after a choice', () => {
  test('an insert chosen from the keyboard returns focus to the button; chosen with the pointer, focus is left as it was', async ({ page }) => {
    await openApp(page)
    const trigger = toolbarButton(page, 'Insert module')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(popOf(trigger).locator('[role="menuitem"]').first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(trigger).toBeFocused()
    // the pointer: open and choose by mouse - focus is not pulled to the button
    await trigger.click()
    await popOf(trigger).locator('[role="menuitem"]').first().click()
    await expect(popOf(trigger)).toHaveCount(0)
    await expect(trigger).not.toBeFocused()
  })
  test('an outside link chosen from the keyboard returns focus to Help', async ({ page, context }) => {
    await openApp(page)
    await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
    const help = page.locator('[data-tour="help-trigger"]')
    await help.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp') // Send feedback, before About
    await expect(page.locator('a[role="menuitem"]')).toBeFocused()
    const popup = context.waitForEvent('page')
    await page.keyboard.press('Enter')
    await (await popup).close()
    await expect(help).toBeFocused()
  })
  test('an item that opens a dialog gives it focus, and closing it returns to the button', async ({ page }) => {
    await openApp(page)
    const help = page.locator('[data-tour="help-trigger"]')
    await help.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown') // Turn contextual tips back on
    await page.keyboard.press('Enter')
    const dlg = page.locator('.mcdlg--contextual-help')
    await expect(dlg).toBeVisible()
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(help).toBeFocused()
  })
  test('the Templates confirmation returns to Templates', async ({ page }) => {
    await openApp(page)
    const trigger = page.locator('.toolbar__actions-core > .menu > .btn').first()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter') // the first Template; the sample document is not empty
    const confirm = page.locator('.mcdlg--confirm')
    await expect(confirm).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
})

test.describe('Settings and the toolbar overflow are disclosures', () => {
  test('Settings: no menu role, focus stays on the button, Tab goes in, Escape comes back', async ({ page }) => {
    await openApp(page)
    const btn = page.locator('.toolbar__settingsmenu > button')
    await expect(btn).not.toHaveAttribute('aria-haspopup', /.+/)
    await btn.focus()
    await page.keyboard.press('Enter')
    const pop = page.locator('.toolbar__settingsmenu-pop')
    await expect(pop).toBeVisible()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(btn).toHaveAttribute('aria-controls', (await pop.getAttribute('id'))!)
    await expect(pop).toHaveAttribute('role', 'group')
    await expect(pop.locator('[role="menuitem"]')).toHaveCount(0)
    await expect(btn).toBeFocused()
    await page.keyboard.press('ArrowDown') // nothing: Tab moves inside
    await expect(btn).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('.theme-menu > button')).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.locator('[data-settings-row="storage-privacy"]')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(btn).toBeFocused()
  })
})

test.describe('the toolbar overflow, at a width where it holds groups', () => {
  test.use({ viewport: { width: 760, height: 800 } })
  test('a disclosure; a keyboard choice made in a group inside it returns to its button', async ({ page, context }) => {
    await openApp(page)
    await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
    const more = page.locator('.toolbar__overflow-btn')
    await expect(more).toBeVisible()
    await expect(more).not.toHaveAttribute('aria-haspopup', /.+/)
    await more.focus()
    await page.keyboard.press('Enter')
    const pop = page.locator('.toolbar__overflow-pop')
    await expect(pop).toHaveAttribute('role', 'group')
    await expect(more).toBeFocused()
    // a menu inside it: Help sits here at 760 px (MEASURED: Data, Settings, Help)
    const help = pop.locator('[data-tour="help-trigger"]')
    await expect(help).toHaveCount(1)
    await help.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    const popup = context.waitForEvent('page')
    await page.keyboard.press('Enter') // Send feedback
    await (await popup).close()
    await expect(pop).toHaveCount(0)
    await expect(more).toBeFocused()
  })
})

// Issue #307 - MEASURED with Narrator + Edge on a comparison page: a button
// whose `aria-controls` names a panel that is not in the DOM while closed is
// never read as "expanded" once it opens, even when re-read; the same button
// with `aria-controls` present only while the panel exists is. So every
// trigger whose panel mounts on open carries `aria-controls` only while open.
async function expectControlsOnlyWhileOpen(page: Page, btn: Locator, prepare: () => Promise<void> = async () => {}) {
  await prepare()
  await expect(btn).toHaveAttribute('aria-expanded', 'false')
  await expect(btn).not.toHaveAttribute('aria-controls')
  for (const how of ['Escape', 'press again'] as const) {
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    const id = (await btn.getAttribute('aria-controls')) ?? ''
    expect(id, 'aria-controls names the open panel').not.toBe('')
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1)
    await expect(page.locator(`[id="${id}"]`)).toBeVisible()
    if (how === 'Escape') {
      await btn.focus()
      await page.keyboard.press('Escape')
    } else {
      await btn.click()
    }
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(btn).not.toHaveAttribute('aria-controls')
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(0)
  }
}

test.describe('aria-controls names a panel only while it exists', () => {
  test('Settings', async ({ page }) => {
    await openApp(page)
    await expectControlsOnlyWhileOpen(page, page.locator('.toolbar__settingsmenu > button'))
  })
  test('File', async ({ page }) => {
    await openApp(page)
    await expectControlsOnlyWhileOpen(page, toolbarButton(page, 'File'))
  })
  test('Theme, inside Settings', async ({ page }) => {
    await openApp(page)
    await page.locator('.toolbar__settingsmenu > button').click()
    await expectControlsOnlyWhileOpen(page, page.locator('.theme-menu > button'))
    // closing Theme left Settings open
    await expect(page.locator('.toolbar__settingsmenu-pop')).toBeVisible()
  })
  test('Temporary session', async ({ page }) => {
    await openApp(page)
    await page.locator('.toolbar__settingsmenu > button').click()
    await page.locator('[data-settings-row="storage-privacy"]').click()
    const dlg = page.locator('.mcdlg--storage')
    await dlg.locator('[data-storage-action="to-temporary"]').click()
    await dlg.locator('[data-storage-confirm]').click()
    await expect(dlg).toHaveCount(0)
    await expectControlsOnlyWhileOpen(page, page.locator('[data-session-chip="temporary"]'))
  })
})

test.describe('aria-controls on the toolbar overflow, at a width where it holds groups', () => {
  test.use({ viewport: { width: 760, height: 800 } })
  test('⋯', async ({ page }) => {
    await openApp(page)
    await expectControlsOnlyWhileOpen(page, page.locator('.toolbar__overflow-btn'))
  })
})

test.describe('Language is a combobox', () => {
  test('Arrow Down on the closed row starts at the first language, Arrow Up at the last; focus stays in the search field', async ({ page }) => {
    await openApp(page)
    await page.locator('.toolbar__settingsmenu > button').click()
    const row = page.locator('.toolbar__settingsmenu-pop .lang-switch')
    const active = () =>
      page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null
        const id = a?.getAttribute('aria-activedescendant')
        const opts = [...document.querySelectorAll('[role="listbox"] [role="option"]')]
        return { input: a?.tagName === 'INPUT', index: id ? opts.findIndex((o) => o.id === id) : -2, count: opts.length }
      })
    await row.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => active().then((a) => a.input && a.index === 0)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(row).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => active().then((a) => a.input && a.index === a.count - 1)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(row).toBeFocused()
  })
})

test.describe('the hook’s items', () => {
  test('separators, disabled, aria-disabled and hidden items are never landed on', async ({ page }) => {
    await openApp(page)
    const roles = await page.evaluate(async () => {
      const { usableItems } = await import('/src/ui/useMenuKeyboard.ts')
      const pop = document.createElement('div')
      const add = (role: string, name: string, mut?: (b: HTMLButtonElement) => void) => {
        const b = document.createElement('button')
        b.setAttribute('role', role)
        b.textContent = name
        mut?.(b)
        pop.append(b)
      }
      add('menuitem', 'a')
      const sep = document.createElement('div')
      sep.setAttribute('role', 'separator')
      pop.append(sep)
      add('menuitem', 'disabled', (b) => (b.disabled = true))
      add('menuitem', 'aria-disabled', (b) => b.setAttribute('aria-disabled', 'true'))
      add('menuitem', 'hidden', (b) => (b.hidden = true))
      add('menuitemradio', 'b')
      add('menuitemcheckbox', 'c')
      document.body.append(pop)
      const names = usableItems(pop).map((e) => e.textContent)
      pop.remove()
      return names
    })
    expect(roles).toEqual(['a', 'b', 'c'])
  })
})

test.describe('the phone: sheets are dialogs, one active layer at a time', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  const more = (page: Page) => page.locator('.mob-more')
  const sheet = (page: Page, name: string) => page.locator(`.sheet[role="dialog"][aria-label="${name}"]`)
  const activeModals = (page: Page) =>
    page.evaluate(() => [...document.querySelectorAll('[aria-modal="true"]')].filter((d) => !d.closest('[inert]')).map((d) => d.getAttribute('aria-label') ?? d.querySelector('[id]')?.textContent ?? '?'))

  async function openMore(page: Page): Promise<void> {
    await more(page).focus()
    await page.keyboard.press('Enter')
    await expect(sheet(page, 'More')).toBeVisible()
  }

  const isInert = (page: Page, selector: string) => page.evaluate((sel) => Boolean(document.querySelector(sel)?.closest('[inert]')), selector)
  const showUpdateBar = async (page: Page) => {
    // dev has no service worker: the store is poked so the bar renders
    await page.evaluate(() => (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop.pwa.setState({ waitingWorker: { fake: true }, dismissedWorker: null }))
    await expect(page.locator('.pwa-update')).toBeVisible()
  }

  // Lumi's decision D (2026-10-05): a sheet is NOT modal, so the run bar and
  // the PWA update bar stay usable while it is open (docs/mobile.md MV-D11,
  // MV-D18, MV-D19). Only what its scrim covers for the pointer leaves the
  // keyboard and screen-reader order too.
  test('the More sheet is not modal: focus goes in, the run bar and the update bar stay reachable, Tab leaves it, Escape returns to More', async ({ page }) => {
    await openApp(page)
    await showUpdateBar(page)
    await openMore(page)
    const s = sheet(page, 'More')
    await expect(s).not.toHaveAttribute('aria-modal')
    expect(await s.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    expect(await activeModals(page)).toEqual([])
    // covered by the scrim: out of the keyboard order too
    expect(await isInert(page, '.mob-more')).toBe(true)
    expect(await isInert(page, '.canvas')).toBe(true)
    // on top of the scrim: reachable
    expect(await isInert(page, '.pstrip--mobile')).toBe(false)
    expect(await isInert(page, '.pwa-update')).toBe(false)
    // Tab out of the sheet's last control reaches the run bar, not the canvas
    const last = s.locator('button:not([disabled])').last()
    await last.focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.pstrip--mobile')))).toBe(true)
    // Shift+Tab out of its first control reaches the update bar
    await s.locator('.sheet__x').focus()
    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.pwa-update')))).toBe(true)
    // Play runs without closing the sheet
    await page.locator('.pstrip--mobile button', { hasText: 'Play' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pstrip--mobile button', { hasText: 'Pause' })).toBeVisible()
    await expect(s).toBeVisible()
    await page.locator('.pstrip--mobile button', { hasText: 'Pause' }).click()
    // Escape from the run bar still closes the sheet, the one open entry
    await page.keyboard.press('Escape')
    await expect(s).toHaveCount(0)
    await expect(more(page)).toBeFocused()
    expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0)
  })

  for (const [row, name] of [
    ['export', 'Export'],
    ['templates', 'Templates'],
    ['filter', 'Filters'],
    ['help', 'Help'],
  ] as const) {
    test(`${name}: focus goes in, not modal, Escape goes back to the row in More; Close still closes everything`, async ({ page }) => {
      await openApp(page)
      await openMore(page)
      const r = sheet(page, 'More').locator(`[data-more-row="${row}"]`)
      await r.focus()
      await page.keyboard.press('Enter')
      const sub = sheet(page, name)
      await expect(sub).toBeVisible()
      expect(await sub.evaluate((d) => d.contains(document.activeElement))).toBe(true)
      await expect(sub).not.toHaveAttribute('aria-modal')
      expect(await activeModals(page)).toEqual([])
      expect(await isInert(page, '.pstrip--mobile')).toBe(false)
      await page.keyboard.press('Escape')
      await expect(sub).toHaveCount(0)
      await expect(sheet(page, 'More')).toBeVisible()
      await expect(sheet(page, 'More').locator(`[data-more-row="${row}"]`)).toBeFocused()
      // the pointer's way out is unchanged: Close closes it all
      await sheet(page, 'More').locator(`[data-more-row="${row}"]`).click()
      await sheet(page, name).locator('.sheet__x').click()
      await expect(page.locator('.sheet')).toHaveCount(0)
      await expect(more(page)).toBeFocused()
    })
  }

  test('a dialog over the More sheet is the one modal layer, the update bar included; Escape closes it alone and returns to its row', async ({ page }) => {
    await openApp(page)
    await showUpdateBar(page)
    await openMore(page)
    const row = page.locator('[data-settings-row="storage-privacy"]')
    await row.focus()
    await page.keyboard.press('Enter')
    const dlg = page.locator('.mcdlg--storage')
    await expect(dlg).toBeVisible()
    expect(await isInert(page, '.sheet[aria-label="More"]')).toBe(true)
    expect(await isInert(page, '.pstrip--mobile')).toBe(true)
    // docs/mobile.md MV8a: a real dialog covers the update bar too
    expect(await isInert(page, '.pwa-update')).toBe(true)
    expect((await activeModals(page)).length).toBe(1)
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(sheet(page, 'More')).toBeVisible()
    await expect(row).toBeFocused()
    expect(await page.evaluate(() => Boolean(document.querySelector('.sheet[aria-label="More"]')?.closest('[inert]')))).toBe(false)
  })

  // The dialogs a sub-sheet opens name the top bar's More button as their
  // return target, which is outside the sub-sheet still open: focus goes back
  // to the row that opened the dialog instead. MEASURED before that rule, while
  // the page behind was inert: focus fell to <body>.
  for (const [row, name, item, selector] of [
    ['help', 'Help', /^About Loop Studio$/, '.mcdlg--about'],
    ['export', 'Export', /^Set the export author/, '.mcdlg'],
  ] as const) {
    test(`a dialog opened from ${name}: Escape closes it alone and focus returns to its row in ${name}`, async ({ page }) => {
      await openApp(page)
      await openMore(page)
      await sheet(page, 'More').locator(`[data-more-row="${row}"]`).focus()
      await page.keyboard.press('Enter')
      const sub = sheet(page, name)
      const opener = sub.locator('.sheet__row', { hasText: item })
      await opener.focus()
      await page.keyboard.press('Enter')
      const dlg = page.locator(selector).last()
      await expect(dlg).toBeVisible()
      expect((await activeModals(page)).length).toBe(1)
      await page.keyboard.press('Escape')
      await expect(page.locator('.mcdlg')).toHaveCount(0)
      await expect(sub).toBeVisible()
      await expect(opener).toBeFocused()
    })
  }
})
