import type { Locator, Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// Issue #307, Lumi's decision (2026-10-05): a real dialog (`aria-modal="true"`)
// is modal for real. While it is the top one, nothing outside it can be reached
// by the pointer, by Tab, or in the accessibility tree - the PWA update bar and
// the phone's run bar included. The update bar keeps its state behind the
// dialog's scrim and is back, usable, the moment the dialog closes; focus
// returns where the dialog's owner says. A phone sheet is NOT modal: with only
// a sheet open the update bar and Play stay usable (docs/mobile.md MV8a, MV5).
//
// Each case below checks the three paths while the dialog is open and again
// after it closes.

const UPDATE = '.pwa-update button:has-text("Update")'
const DISMISS = '.pwa-update button:has-text("Dismiss")'
const PLAY = '.pstrip--mobile button:has-text("Play")'

async function showUpdateBar(page: Page) {
  // dev has no service worker: the store is poked so the bar renders
  await page.evaluate(() =>
    (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop.pwa.setState({ waitingWorker: { fake: true }, dismissedWorker: null }),
  )
  await expect(page.locator('.pwa-update')).toBeVisible()
}

/** does a pointer aimed at the centre of `selector` land on it? */
const pointerReaches = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })

/** Tab and Shift+Tab from where focus is: does focus ever land in `region`? */
async function tabReaches(page: Page, region: string): Promise<boolean> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-tab-start]')) el.removeAttribute('data-tab-start')
    document.activeElement?.setAttribute('data-tab-start', '')
  })
  let reached = false
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.evaluate(() => (document.querySelector('[data-tab-start]') as HTMLElement | null)?.focus())
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press(key)
      reached = await page.evaluate((sel) => Boolean(document.activeElement?.closest(sel)), region)
    }
  }
  // focus goes back where it was, so the caller's next check starts there
  await page.evaluate(() => {
    const start = document.querySelector('[data-tab-start]') as HTMLElement | null
    start?.removeAttribute('data-tab-start')
    start?.focus()
  })
  return reached
}

/** how many buttons with this exact name the accessibility tree exposes */
async function exposedButtons(page: Page, name: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: { role?: { value?: string }; name?: { value?: string }; ignored?: boolean }[] }
  await cdp.detach()
  return nodes.filter((n) => n.role?.value === 'button' && n.name?.value === name && !n.ignored).length
}

/** the three paths to the update bar's buttons (and, on a phone, to Play) */
async function expectUnreachable(page: Page, phone: boolean) {
  expect(await pointerReaches(page, UPDATE), 'pointer reaches Update').toBe(false)
  expect(await pointerReaches(page, DISMISS), 'pointer reaches Dismiss').toBe(false)
  expect(await tabReaches(page, '.pwa-update'), 'Tab reaches the update bar').toBe(false)
  expect(await exposedButtons(page, 'Update'), 'Update in the accessibility tree').toBe(0)
  expect(await exposedButtons(page, 'Dismiss'), 'Dismiss in the accessibility tree').toBe(0)
  if (phone) {
    expect(await pointerReaches(page, PLAY), 'pointer reaches Play').toBe(false)
    expect(await tabReaches(page, '.pstrip--mobile'), 'Tab reaches the run bar').toBe(false)
    expect(await exposedButtons(page, 'Play'), 'Play in the accessibility tree').toBe(0)
  }
}

async function expectReachable(page: Page, phone: boolean) {
  await expect(page.locator('.pwa-update')).toBeVisible()
  await expect(page.locator(UPDATE)).toBeEnabled()
  expect(await pointerReaches(page, UPDATE), 'pointer reaches Update').toBe(true)
  expect(await pointerReaches(page, DISMISS), 'pointer reaches Dismiss').toBe(true)
  expect(await exposedButtons(page, 'Update'), 'Update in the accessibility tree').toBe(1)
  expect(await exposedButtons(page, 'Dismiss'), 'Dismiss in the accessibility tree').toBe(1)
  expect(await page.locator('.pwa-update').evaluate((el) => Boolean(el.closest('[inert]')))).toBe(false)
  expect(await tabReaches(page, '.pwa-update'), 'Tab reaches the update bar').toBe(true)
  if (phone) {
    expect(await pointerReaches(page, PLAY), 'pointer reaches Play').toBe(true)
    expect(await exposedButtons(page, 'Play'), 'Play in the accessibility tree').toBe(1)
    expect(await tabReaches(page, '.pstrip--mobile'), 'Tab reaches the run bar').toBe(true)
  }
}

/** what the update bar says and offers, to compare before and after */
const barState = (page: Page) =>
  page.locator('.pwa-update').evaluate((el) => ({
    text: el.textContent?.replace(/\s+/g, ' ').trim(),
    buttons: [...el.querySelectorAll('button')].map((b) => `${b.textContent?.trim()}:${(b as HTMLButtonElement).disabled}`),
  }))

async function closeAndCheck(page: Page, dialog: Locator, before: Awaited<ReturnType<typeof barState>>, focused: Locator, phone: boolean) {
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(focused).toBeFocused()
  expect(await barState(page)).toEqual(before)
  await expectReachable(page, phone)
}

test.describe('desktop: a real dialog makes the page behind it unreachable', () => {
  test('About: the update bar is covered and inert while it is open, and back, unchanged, when it closes', async ({ page }) => {
    await openApp(page)
    await showUpdateBar(page)
    await expectReachable(page, false)
    const before = await barState(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    const dialog = page.locator('.mcdlg--about')
    await expect(dialog).toBeVisible()
    await expectUnreachable(page, false)
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    await closeAndCheck(page, dialog, before, page.locator('[data-tour="help-trigger"]'), false)
  })

  test('an update that arrives while About is open joins the inert background', async ({ page }) => {
    await openApp(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    const dialog = page.locator('.mcdlg--about')
    await expect(dialog).toBeVisible()
    await showUpdateBar(page)
    await expect.poll(() => page.locator('.pwa-update').evaluate((el) => Boolean(el.closest('[inert]')))).toBe(true)
    await expectUnreachable(page, false)
    const before = await barState(page)
    await closeAndCheck(page, dialog, before, page.locator('[data-tour="help-trigger"]'), false)
  })

  test('the guided tour: the update bar is covered and inert while the tour is up, and back when it is dismissed', async ({ page }) => {
    await openApp(page)
    await showUpdateBar(page)
    const before = await barState(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'Restart the tour' }).click()
    const tour = page.locator('.tour-popover[role="dialog"]')
    await expect(tour).toBeVisible()
    await expectUnreachable(page, false)
    // the tour's own scrim is part of its modal layer, not of the page behind:
    // it is not inert, and it takes the click it exists to swallow
    expect(await page.locator('.tour-scrim').evaluate((el) => Boolean(el.closest('[inert]')))).toBe(false)
    await page.locator('.tour-scrim').click({ position: { x: 5, y: 5 } })
    await expect(tour).toBeVisible()
    await tour.locator('button').first().focus()
    await closeAndCheck(page, tour, before, page.locator('[data-tour="help-trigger"]'), false)
  })

  // The product opens no dialog over another today (the tour and a
  // confirmation are kept apart, docs/guided-tour.md §GT6.1), so the stack is
  // driven directly, through the same module the app uses.
  test('nested modals: only the top one can be reached; a pure live region stays live; everything comes back in order', async ({ page }) => {
    await openApp(page)
    const r = await page.evaluate(async () => {
      const m = (await import('/src/ui/overlayStack.ts')) as typeof import('../src/ui/overlayStack')
      const make = (html: string) => {
        const el = document.createElement('div')
        el.innerHTML = html
        document.body.append(el)
        return el
      }
      const task = () => new Promise((resolve) => setTimeout(resolve, 0))
      const live = make('<p aria-live="polite">announcements</p>').firstElementChild as HTMLElement
      const notice = make('<div role="status">a notice <button>Act</button></div>').firstElementChild as HTMLElement
      // inert before anything opened, and a direct child of <body>: exactly
      // where the stack walks and would set and clear inert itself
      const preInert = make('<button>already inert</button>')
      preInert.inert = true
      const a = make('<button>first</button>')
      const b = make('<button>second</button>')
      const inert = (el: Element) => Boolean(el.closest('[inert]'))
      // a control of the app behind: #root itself stays, because the app's
      // own pure live regions inside it stay live
      const app = document.querySelector('[data-tour="help-trigger"]')!
      const offA = m.pushOverlay(a, 'modal')
      const one = { a: inert(a), app: inert(app), live: inert(live), notice: inert(notice), preInert: inert(preInert) }
      const offB = m.pushOverlay(b, 'modal')
      const two = { a: inert(a), b: inert(b), app: inert(app), live: inert(live) }
      // the observer works while a modal is open: a late element is inert
      // once a task has passed
      const late = make('<button>late</button>')
      await task()
      const lateWhileOpen = inert(late)
      offB()
      const back = { a: inert(a), app: inert(app), late: inert(late) }
      offA()
      const none = {
        a: inert(a),
        b: inert(b),
        app: inert(app),
        notice: inert(notice),
        late: inert(late),
        preInert: preInert.inert,
        inertLeft: [...document.querySelectorAll('[inert]')].filter((el) => el !== preInert).length,
      }
      // the observer is gone once the last modal closed: an element added now,
      // given the same task for a callback to run, stays active
      const after = make('<button>after</button>')
      await task()
      const afterClose = inert(after)
      for (const el of [live.parentElement, notice.parentElement, preInert, a, b, late, after]) el?.remove()
      return { one, two, lateWhileOpen, back, none, afterClose }
    })
    expect(r.one).toEqual({ a: false, app: true, live: false, notice: true, preInert: true })
    expect(r.two).toEqual({ a: true, b: false, app: true, live: false })
    expect(r.lateWhileOpen).toBe(true)
    expect(r.back).toEqual({ a: false, app: true, late: true })
    expect(r.none).toEqual({ a: false, b: false, app: false, notice: false, late: false, preInert: true, inertLeft: 0 })
    expect(r.afterClose).toBe(false)
  })

  test('a sheet makes only what its scrim covers inert, and never releases an element inert before it opened', async ({ page }) => {
    await openApp(page)
    const r = await page.evaluate(async () => {
      const m = (await import('/src/ui/overlayStack.ts')) as typeof import('../src/ui/overlayStack')
      const make = (attrs: string) => {
        const wrap = document.createElement('div')
        wrap.innerHTML = `<div ${attrs}><button>x</button></div>`
        document.body.append(wrap)
        return wrap.firstElementChild as HTMLElement
      }
      // both are marked as covered by sheets, the set the sheet entry manages
      const covered = make('data-covered-by-sheets=""')
      const coveredPreInert = make('data-covered-by-sheets=""')
      coveredPreInert.inert = true
      const sheet = make('class="fake-sheet"')
      const off = m.pushOverlay(sheet, 'sheet')
      const open = { covered: covered.inert, coveredPreInert: coveredPreInert.inert, sheet: sheet.inert }
      off()
      const closed = { covered: covered.inert, coveredPreInert: coveredPreInert.inert }
      for (const el of [covered, coveredPreInert, sheet]) el.parentElement?.remove()
      return { open, closed }
    })
    expect(r.open).toEqual({ covered: true, coveredPreInert: true, sheet: false })
    expect(r.closed).toEqual({ covered: false, coveredPreInert: true })
  })
})

test.describe('phone: a real dialog makes the page behind it unreachable; a sheet does not', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the MC dialog: the update bar and the run bar are covered and inert, and back when it closes', async ({ page }) => {
    await openApp(page)
    await showUpdateBar(page)
    await expectReachable(page, true)
    const before = await barState(page)
    const mc = page.locator('.pstrip--mobile').getByRole('button', { name: 'Monte Carlo' })
    await mc.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('.mcdlg')
    await expect(dialog).toBeVisible()
    await expectUnreachable(page, true)
    await closeAndCheck(page, dialog, before, mc, true)
  })

  test('the Storage dialog over the More sheet: only the dialog is active; closing it returns to its row, and the sheet is non-modal again', async ({ page }) => {
    await openApp(page)
    await showUpdateBar(page)
    await page.locator('.mob-more').focus()
    await page.keyboard.press('Enter')
    const more = page.locator('.sheet[aria-label="More"]')
    await expect(more).toBeVisible()
    // a sheet alone: Update, Dismiss and Play stay usable
    await expectReachable(page, true)
    const before = await barState(page)
    const row = more.locator('[data-settings-row="storage-privacy"]')
    await row.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('.mcdlg--storage')
    await expect(dialog).toBeVisible()
    expect(await more.evaluate((d) => Boolean(d.closest('[inert]')))).toBe(true)
    await expectUnreachable(page, true)
    await closeAndCheck(page, dialog, before, row, true)
    await expect(more).toBeVisible()
    await expect(more).not.toHaveAttribute('aria-modal')
    expect(await more.evaluate((d) => Boolean(d.closest('[inert]')))).toBe(false)
    // the sheet is still open, so what its scrim covers stays inert: closing
    // the dialog gives back only what the dialog took
    await expect(page.locator('.openhint')).toBeVisible()
    for (const covered of ['.mob-more', '.openhint', '.canvas']) {
      expect(await page.locator(covered).evaluate((el) => Boolean(el.closest('[inert]'))), `${covered} inert`).toBe(true)
    }
  })
})
