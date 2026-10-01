import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'

// The dialog layer (src/components/DialogScrim.tsx).
//
// A dialog used to be drawn where it was declared, so its layer depended on its
// ancestors. On mobile, a dialog declared inside a sheet sat in the sheet's
// layer, under the fixed run bar and the "Open a file" card. MEASURED before
// the fix, at 390 px on a profile that still shows that card: the card's button
// was the top element where the contextual-tips dialog's title and close button
// are, and the run bar stayed pressable under the scrim.
//
// This spec opens every kind of dialog a phone can reach, at the two narrow
// widths, on exactly that profile, and requires the dialog to be the top layer
// over everything, with its controls reachable, focus held inside it, and focus
// handed back when it closes.

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const

type Dialog = {
  name: string
  /** the dialog element */
  selector: string
  open: (page: Page) => Promise<void>
}

const more = (page: Page) => page.locator('.mob-more')

/** Activate a sheet row from the keyboard.
 *
 *  Not a pointer click, on purpose. At 320 px the mobile run bar wraps to two
 *  rows and is taller than the space the layout reserves for it (issue #303),
 *  so it lies over the last rows of a sheet and takes a tap aimed at them. That
 *  defect is not this spec's subject and is not hidden by it: the rows are
 *  reached the way a keyboard reaches them, and the pointer is tested where
 *  this change is responsible for it (the dialog's close button, and the first
 *  row of the More sheet under the open-file card). */
const activate = async (page: Page, row: ReturnType<Page['locator']>) => {
  await row.focus()
  await expect(row).toBeFocused()
  await page.keyboard.press('Enter')
}
const helpSheetRow = async (page: Page, text: RegExp) => {
  await more(page).click()
  await activate(page, page.locator('.sheet__row', { hasText: /^Help/ }))
  await activate(page, page.locator('.sheet .sheet__row', { hasText: text }))
}

const DIALOGS: Dialog[] = [
  { name: 'contextual tips', selector: '.mcdlg--contextual-help', open: (page) => helpSheetRow(page, /^Turn contextual tips back on$/) },
  { name: 'What’s new', selector: '[data-whatsnew="panel"]', open: (page) => helpSheetRow(page, /^What’s new/) },
  { name: 'About', selector: '.mcdlg--about', open: (page) => helpSheetRow(page, /^About Loop Studio$/) },
  {
    name: 'export author',
    selector: '.mcdlg',
    open: async (page) => {
      await more(page).click()
      await activate(page, page.locator('.sheet__row', { hasText: /^Export/ }))
      await activate(page, page.locator('.sheet .sheet__row', { hasText: /^Set the export author/ }))
    },
  },
  {
    name: 'share confirmation',
    selector: '.mcdlg--confirm',
    open: async (page) => {
      await more(page).click()
      await activate(page, page.locator('.sheet__row', { hasText: /^Share/ }).first())
    },
  },
  {
    name: 'Monte Carlo',
    selector: '.mcdlg',
    open: async (page) => {
      await page.locator('.pstrip--mobile').getByRole('button', { name: /MC|Monte Carlo/ }).click()
    },
  },
]

async function boot(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas')).toBeVisible()
  // the profile this defect needs: the untouched sample, so the open-file card is up
  await expect(page.locator('.openhint')).toBeVisible()
  await expect(page.locator('.pstrip--mobile')).toBeVisible()
}

/** what is on top at each point that matters */
const layers = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const dlg = [...document.querySelectorAll(sel)].pop() as HTMLElement
    const scrim = dlg.closest('.mcdlg__scrim') as HTMLElement
    const b = dlg.getBoundingClientRect()
    const what = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return 'nothing'
      if (el.closest('.mcdlg') === dlg) return 'dialog'
      if (el === scrim) return 'scrim'
      return 'OTHER: ' + (el.className?.toString() || el.tagName).slice(0, 40)
    }
    const centre = (el: Element | null | undefined) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return what(r.left + r.width / 2, r.top + r.height / 2)
    }
    const inset = 10
    const buttons = [...dlg.querySelectorAll('button:not([disabled]), a[href], input, select')].filter((el) => {
      const r = el.getBoundingClientRect()
      // a control scrolled out of the dialog's own scrolling body is reached by scrolling
      return r.width > 0 && r.height > 0 && r.top >= b.top && r.bottom <= b.bottom
    })
    return {
      scrimParentIsBody: scrim.parentElement === document.body,
      insideAnySheet: !!scrim.closest('.sheet, .sheet-scrim'),
      dialog: {
        topLeft: what(b.left + inset, b.top + inset),
        topRight: what(b.right - inset, b.top + inset),
        centre: what(b.left + b.width / 2, b.top + b.height / 2),
        bottomLeft: what(b.left + inset, b.bottom - inset),
        bottomRight: what(b.right - inset, b.bottom - inset),
      },
      controls: buttons.length,
      controlsNotOnTop: buttons.filter((el) => centre(el) !== 'dialog').map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)),
      // what the dialog must be drawn over
      runBar: centre(document.querySelector('.pstrip--mobile')),
      openFileCard: centre(document.querySelector('.openhint')),
      openFileButton: centre(document.querySelector('.openhint__btn')),
      topBar: centre(document.querySelector('.mob-more')),
      insideViewport: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
      pageScrollsSideways: document.documentElement.scrollWidth > innerWidth,
    }
  }, selector)

const OVER = ['dialog', 'scrim']

test.describe('every dialog is the top layer on a phone', () => {
  for (const size of WIDTHS) {
    for (const dialog of DIALOGS) {
      test(`${size.width}px, ${dialog.name}: over the open-file card and the run bar, controls reachable, focus kept and returned`, async ({ page }) => {
        await boot(page, size.width, size.height)
        await dialog.open(page)
        const dlg = page.locator(dialog.selector).last()
        await expect(dlg).toBeVisible()

        const l = await layers(page, dialog.selector)
        // drawn in the shared layer, wherever it was declared
        expect(l.scrimParentIsBody).toBe(true)
        expect(l.insideAnySheet).toBe(false)
        // the whole dialog is on top
        expect(l.dialog).toEqual({ topLeft: 'dialog', topRight: 'dialog', centre: 'dialog', bottomLeft: 'dialog', bottomRight: 'dialog' })
        expect(l.controls).toBeGreaterThan(0)
        expect(l.controlsNotOnTop).toEqual([])
        // and everything else is under it or under its scrim
        expect(OVER).toContain(l.runBar)
        expect(OVER).toContain(l.openFileCard)
        expect(OVER).toContain(l.openFileButton)
        expect(OVER).toContain(l.topBar)
        expect(l.insideViewport).toBe(true)
        expect(l.pageScrollsSideways).toBe(false)

        // focus starts inside the dialog and Tab never leaves it
        const inside = () => page.evaluate((sel) => !![...document.querySelectorAll(sel)].pop()?.contains(document.activeElement), dialog.selector)
        expect(await inside()).toBe(true)
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab')
          expect(await inside(), `Tab ${i + 1}`).toBe(true)
        }
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('Shift+Tab')
          expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true)
        }

        // Escape closes it, and focus lands on a real control, not on the page
        await page.keyboard.press('Escape')
        await expect(page.locator('.mcdlg')).toHaveCount(0)
        const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName ?? 'none', connected: document.activeElement?.isConnected ?? false }))
        expect(focus.tag).not.toBe('BODY')
        expect(focus.connected).toBe(true)
      })
    }

    test(`${size.width}px, contextual tips: its close button is pressed by a real click at its own position`, async ({ page }) => {
      await boot(page, size.width, size.height)
      await helpSheetRow(page, /^Turn contextual tips back on$/)
      const dlg = page.locator('.mcdlg--contextual-help')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.mcdlg__head')).toContainText('Manage contextual tips')
      // a real pointer click where the button is drawn: before the fix the
      // open-file card's button took it
      const x = dlg.locator('.mcdlg__x')
      const box = (await x.boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(dlg).toHaveCount(0)
      // the file picker was not opened by a click that fell through
      await expect(page.locator('.openhint')).toBeVisible()
    })
  }

  test('320px: the first row of the More sheet takes a real click; the open-file card is under the sheet', async ({ page }) => {
    await boot(page, 320, 640)
    await more(page).click()
    const sheet = page.locator('.sheet')
    await expect(sheet).toBeVisible()
    // the sheet and the card really do overlap at this size, so the order matters
    const o = await page.evaluate(() => {
      const s = document.querySelector('.sheet')!.getBoundingClientRect()
      const c = document.querySelector('.openhint')!.getBoundingClientRect()
      const overlap = Math.min(s.bottom, c.bottom) - Math.max(s.top, c.top)
      const x = (Math.max(s.left, c.left) + Math.min(s.right, c.right)) / 2
      const top = overlap > 0 ? document.elementFromPoint(x, Math.max(s.top, c.top) + overlap / 2) : null
      return { overlap: Math.round(overlap), topIsSheet: !!top?.closest('.sheet'), topIsCard: !!top?.closest('.openhint') }
    })
    expect(o.overlap).toBeGreaterThan(0)
    expect(o).toMatchObject({ topIsSheet: true, topIsCard: false })
    // a real pointer click on the first row: before, the card took it
    await sheet.locator('.sheet__row').first().click()
    await expect(page.locator('.mcdlg--confirm')).toBeVisible()
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`forced colours (${scheme}), 390px: the contextual dialog keeps its boundary and stays on top`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme })
      await boot(page, 390, 844)
      await helpSheetRow(page, /^Turn contextual tips back on$/)
      const dlg = page.locator('.mcdlg--contextual-help')
      await expect(dlg).toBeVisible()
      const s = await dlg.evaluate((el) => {
        const c = getComputedStyle(el)
        return { forced: matchMedia('(forced-colors: active)').matches, style: c.borderTopStyle, border: c.borderTopColor, background: c.backgroundColor }
      })
      expect(s.forced).toBe(true)
      expect(s.style).toBe('solid')
      expect(s.border).not.toBe(s.background)
      const l = await layers(page, '.mcdlg--contextual-help')
      expect(l.dialog.topRight).toBe('dialog')
      expect(l.controlsNotOnTop).toEqual([])
    })
  }

  test('right-to-left, 390px: the contextual dialog is on top and its close button is reachable', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio/ui-locale/1', 'ar')
      } catch {
        /* ignore */
      }
    })
    await boot(page, 390, 844)
    await page.waitForFunction(() => document.documentElement.dir === 'rtl')
    await more(page).click()
    await activate(page, page.locator('.sheet__row').last())
    await activate(page, page.locator('.sheet .sheet__row').nth(1))
    const dlg = page.locator('.mcdlg--contextual-help')
    await expect(dlg).toBeVisible()
    const l = await layers(page, '.mcdlg--contextual-help')
    expect(l.dialog).toEqual({ topLeft: 'dialog', topRight: 'dialog', centre: 'dialog', bottomLeft: 'dialog', bottomRight: 'dialog' })
    expect(l.controlsNotOnTop).toEqual([])
    expect(l.pageScrollsSideways).toBe(false)
  })
})

test.describe('the dialog layer on desktop', () => {
  test('a dialog opened from the Help menu is in the shared layer, on top, and returns focus to the Help button', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.canvas')).toBeVisible()
    for (const [item, selector] of [
      ['Turn contextual tips back on', '.mcdlg--contextual-help'],
      ['About Loop Studio', '.mcdlg--about'],
    ] as const) {
      await page.locator('[data-tour="help-trigger"]').click()
      await page.getByRole('menuitem', { name: item }).click()
      const dlg = page.locator(selector)
      await expect(dlg).toBeVisible()
      const l = await dlg.evaluate((el) => {
        const scrim = el.closest('.mcdlg__scrim')!
        const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect()
        const top = document.elementFromPoint(toolbar.left + toolbar.width / 2, toolbar.top + toolbar.height / 2)
        return { parentIsBody: scrim.parentElement === document.body, toolbarIsUnder: top === scrim || !!top?.closest('.mcdlg') }
      })
      expect(l).toEqual({ parentIsBody: true, toolbarIsUnder: true })
      await page.keyboard.press('Escape')
      await expect(dlg).toHaveCount(0)
      await expect(page.locator('[data-tour="help-trigger"]')).toBeFocused()
    }
  })

  test('a press on the backdrop closes the dialog, a press inside it does not', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.canvas')).toBeVisible()
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    const dlg = page.locator('.mcdlg--about')
    await expect(dlg).toBeVisible()
    await dlg.locator('.mcdlg__body').click()
    await expect(dlg).toBeVisible()
    await page.locator('.mcdlg__scrim').click({ position: { x: 5, y: 5 } })
    await expect(dlg).toHaveCount(0)
  })
})
