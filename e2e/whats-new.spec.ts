import type { Page } from '@playwright/test'
import { expect, test as shared, waitForAppReady } from './support/loop'
import {
  ANNOUNCED_KEY,
  expectOneVersionStory,
  NEWEST_RELEASE,
  OPENED_KEY,
  PACKAGE_VERSION,
  readAboutVersion,
  readNewestShown,
  VERSION_IS_READ_ONCE,
} from './support/whatsNew'
import { RELEASE_NOTES } from '../src/releaseNotes/releaseNotes'

// docs/release-notes.md, issue #296 — the update notice, the What's new panel
// and the Help menu's `New` marker.
//
// This is the one spec that controls the profile's storage itself. The shared
// fixture pre-dismisses the tour and records the newest release as seen; both
// are switched off here, and each test says exactly what the profile holds.
//
// A structural check of the accessibility tree and of the live region is NOT a
// screen-reader test. What a real screen reader says is checked by hand and is
// recorded in docs/release-notes.md.

const test = shared.extend({
  // no pre-dismissed tour: a test that wants a returning profile seeds one.
  // An override keeps the original fixture's `auto` option.
  // eslint-disable-next-line no-empty-pattern
  _tourSeed: async ({}, run) => run(),
})

const NOTICE = '[data-whatsnew="notice"]'
const LIVE = '[data-whatsnew="live"]'
const PANEL = '[data-whatsnew="panel"]'
const MENU_ITEM = '[data-whatsnew="menu-item"]'
const HELP = '[data-tour="help-trigger"]'
const MORE = '.mob-more'
const TOUR = 'loop-studio/guided-tour/1'
const DOC = 'loop-studio:graph:v1'
const LOCALE = 'loop-studio/ui-locale/1'
const HINTS = 'loop-studio/contextual-help/1'
const VERSION = NEWEST_RELEASE.version
const ID = NEWEST_RELEASE.id as string
/** a profile that skipped the tour once: the plainest returning profile */
const RETURNING = { [TOUR]: 'dismissed' }
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="switch"], [tabindex="0"]'
const LOCALES = ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'es-419', 'pt-BR', 'es-ES', 'pt-PT', 'ru', 'tr', 'th', 'vi', 'it', 'nl', 'ar']

type Boot = { width?: number; height?: number; storage?: Record<string, string>; pwaWaitingAtBoot?: boolean }

/** Load the app on a profile that holds exactly `storage`. The seed is written
 *  once per tab, so a reload keeps whatever the app itself wrote since. */
async function boot(page: Page, { width = 1280, height = 800, storage = {}, pwaWaitingAtBoot = false }: Boot = {}) {
  await page.setViewportSize({ width, height })
  await page.addInitScript(
    ({ live, storage, pwaWaitingAtBoot }) => {
      try {
        if (!sessionStorage.getItem('__whatsnew_seeded')) {
          sessionStorage.setItem('__whatsnew_seeded', '1')
          // issue #297 - a remembered personal browser, so the storage gate does
          // not stand in front of these tests; the mode key is not a trace of a
          // person (src/whatsNew/decide.ts), so "a first visit" stays one
          if (!('loop-studio:storage-mode' in storage)) localStorage.setItem('loop-studio:storage-mode', 'personal')
          for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v)
        }
      } catch {
        /* ignore */
      }
      // every change of the live region's text, from before the app starts
      const w = window as unknown as { __liveChanges: string[] }
      w.__liveChanges = []
      new MutationObserver(() => {
        const text = document.querySelector(live)?.textContent ?? ''
        if (text && w.__liveChanges[w.__liveChanges.length - 1] !== text) w.__liveChanges.push(text)
      }).observe(document, { subtree: true, childList: true, characterData: true })
      // a waiting service worker that exists before the first render
      if (pwaWaitingAtBoot) {
        Object.defineProperty(window, '__loop', {
          configurable: true,
          set(v: { pwa: { setState: (s: unknown) => void } }) {
            v.pwa.setState({ waitingWorker: { test: 'waiting worker 1' }, dismissedWorker: null })
            Object.defineProperty(window, '__loop', { value: v, writable: true, configurable: true })
          },
        })
      }
    },
    { live: LIVE, storage, pwaWaitingAtBoot },
  )
  await page.goto('/')
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  if (storage[LOCALE]) await page.waitForFunction((l) => document.documentElement.lang === l, storage[LOCALE])
}

const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key)
const liveChanges = (page: Page) => page.evaluate(() => (window as unknown as { __liveChanges: string[] }).__liveChanges)

/** the predicate stays true for the whole window: for "it does NOT appear" */
async function holds(page: Page, what: string, read: () => Promise<boolean>, ms = 1500) {
  const end = Date.now() + ms
  for (;;) {
    expect(await read(), what).toBe(true)
    if (Date.now() >= end) return
    await page.waitForTimeout(150)
  }
}
const noticeAbsent = (page: Page) => async () => (await page.locator(NOTICE).count()) === 0

/** the Help menu's rows, in order, with separators as a dash */
async function helpMenuRows(page: Page): Promise<string[]> {
  await page.locator(HELP).click()
  const pop = page.locator('.menu__pop[role="menu"]')
  await expect(pop).toBeVisible()
  return pop.evaluate((el) =>
    [...el.children].map((c) => (c.getAttribute('role') === 'separator' ? '-' : (c.textContent ?? '').replace(/\s+/g, ' ').trim())),
  )
}

// ───────────────────────────────────────────────────────── who is told
test.describe('who gets the automatic notice', () => {
  test('a first visit: no notice, the newest id is recorded as the baseline, the marker shows', async ({ page }) => {
    await boot(page)
    // the first-run Welcome card is up; the notice is not
    await expect.poll(() => stored(page, ANNOUNCED_KEY)).toBe(ID)
    await holds(page, 'no notice on a first visit', noticeAbsent(page))
    expect(await stored(page, OPENED_KEY)).toBeNull()
    expect(await liveChanges(page)).toEqual([])
    await page.getByRole('button', { name: 'Skip' }).first().click()
    await holds(page, 'still no notice after the tour is skipped', noticeAbsent(page), 800)
    expect(await helpMenuRows(page)).toContain('What’s new New')
  })

  test('a first visit, launched a second time on the same release: still nothing', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Skip' }).first().click()
    await expect.poll(() => stored(page, TOUR)).toBe('dismissed')
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await holds(page, 'no notice on the second launch', noticeAbsent(page))
    expect(await liveChanges(page)).toEqual([])
  })

  test('only the auto-saved sample document in storage: a first visit, not a returning profile', async ({ page }) => {
    await boot(page)
    // the app saves the default sample by itself
    await expect.poll(() => stored(page, DOC)).not.toBeNull()
    // a profile that holds the document and nothing else: no record, no trace
    await page.evaluate(([a, t]) => {
      localStorage.removeItem(a)
      localStorage.removeItem(t)
    }, [ANNOUNCED_KEY, TOUR])
    // issue #297 - the gate's answer is stored beside it, and is not a trace either
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([DOC, 'loop-studio:storage-mode'].sort())
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await expect.poll(() => stored(page, ANNOUNCED_KEY)).toBe(ID)
    await holds(page, 'the document alone is not a trace', noticeAbsent(page))
  })

  for (const [name, storage] of [
    ['the tour was skipped', { [TOUR]: 'dismissed' }],
    ['a theme was chosen', { 'loop-studio:theme': 'dark' }],
    ['a language was chosen', { [LOCALE]: 'en' }],
    ['the minimap was collapsed', { 'loop-studio:minimap-collapsed': '1' }],
  ] as const) {
    test(`a returning profile (${name}): the notice shows once`, async ({ page }) => {
      await boot(page, { storage })
      // a profile that never met the tour gets its Welcome card first
      const skip = page.getByRole('button', { name: 'Skip' })
      if (!(TOUR in storage)) await skip.first().click()
      await expect(page.locator(NOTICE)).toBeVisible()
      await expect(page.locator(NOTICE + ' p')).toHaveText(`Loop Studio was updated to ${VERSION}`)
      // recorded the moment it is on screen; reading it is a separate fact
      await expect.poll(() => stored(page, ANNOUNCED_KEY)).toBe(ID)
      expect(await stored(page, OPENED_KEY)).toBeNull()

      await page.reload()
      await expect(page.locator('.canvas')).toBeVisible()
      await holds(page, 'the notice does not repeat', noticeAbsent(page))
    })
  }

  test('a profile told about an older entry is told about the newest, with no other trace', async ({ page }) => {
    await boot(page, { storage: { [ANNOUNCED_KEY]: 'release:0.0.1' } })
    await page.getByRole('button', { name: 'Skip' }).first().click()
    await expect(page.locator(NOTICE)).toBeVisible()
    await expect.poll(() => stored(page, ANNOUNCED_KEY)).toBe(ID)
  })

  test('a profile already told about the newest entry sees nothing', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await holds(page, 'up to date', noticeAbsent(page))
    expect(await liveChanges(page)).toEqual([])
  })
})

// ───────────────────────────────────────────────────────── closing and reading
test.describe('closing the notice and opening the panel are different things', () => {
  test('Close: the notice goes and stays gone, the marker stays', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    await page.locator(NOTICE).getByRole('button', { name: 'Close' }).click()
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await expect(page.locator(PANEL)).toHaveCount(0)
    expect(await stored(page, OPENED_KEY)).toBeNull()
    expect(await helpMenuRows(page)).toContain('What’s new New')
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await holds(page, 'closed for good', noticeAbsent(page))
    expect(await helpMenuRows(page)).toContain('What’s new New')
  })

  test('See what’s new: the panel lists every entry, and opening it clears the marker', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    await page.locator(NOTICE).getByRole('button', { name: 'See what’s new' }).click()
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'What’s new' })).toBeVisible()
    expect(await page.evaluate((p) => !!document.activeElement?.closest(p), PANEL)).toBe(true)
    await expect.poll(() => stored(page, OPENED_KEY)).toBe(ID)

    // every entry, newest first, each with its version, its date and its items
    const entries = panel.locator('.whatsnew__entry')
    await expect(entries).toHaveCount(RELEASE_NOTES.length)
    for (const [i, note] of RELEASE_NOTES.entries()) {
      const entry = entries.nth(i)
      await expect(entry.locator('.whatsnew__version')).toContainText('v' + note.version)
      await expect(entry.locator('time')).toHaveAttribute('datetime', note.date)
      await expect(entry.locator('time')).toHaveText(note.date)
      const items = await entry.locator('li').allTextContents()
      expect(items).toHaveLength(note.items.length)
      for (const [j, text] of items.entries()) {
        expect(text.length, note.items[j]).toBeGreaterThan(20)
        expect(text).not.toBe(note.items[j])
        expect(text).not.toContain('text unavailable')
      }
    }
    expect(RELEASE_NOTES.map((n) => n.version)).toEqual(['0.21.3', '0.21.2', '0.21.1', '0.21.0', '0.20.0', '0.19.0','0.18.2', '0.18.1', '0.18.0', '0.17.2', '0.17.1', '0.17.0', '0.16.0', '0.15.3', '0.15.2', '0.15.1', '0.15.0', '0.14.0'])

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    // focus goes to the Help button, where the marker was
    await expect(page.locator(HELP)).toBeFocused()
    const rows = await helpMenuRows(page)
    expect(rows).toContain('What’s new')
    expect(rows).not.toContain('What’s new New')
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    expect(await helpMenuRows(page)).toContain('What’s new')
  })

  test('reading the notes from the Help menu withdraws a notice that is still showing', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    await expect(page.locator(NOTICE)).toBeVisible()
    await page.locator(HELP).click()
    await page.locator(MENU_ITEM).click()
    await expect(page.locator(PANEL)).toBeVisible()
    // the entry has just been read: there is nothing left to announce
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator(PANEL)).toHaveCount(0)
    await holds(page, 'the notice does not come back', noticeAbsent(page), 800)
    await expect(page.locator(HELP)).toBeFocused()
  })

  test('reading the notes while the notice was only waiting: it is not offered on the next launch', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, 'loop-studio:filter-panel': '1' } })
    await expect(page.locator('.lgr-filter')).toBeVisible()
    await page.locator(HELP).click()
    await page.locator(MENU_ITEM).click()
    await expect.poll(() => stored(page, OPENED_KEY)).toBe(ID)
    expect(await stored(page, ANNOUNCED_KEY)).toBeNull()
    await page.keyboard.press('Escape')
    await page.locator('.lgr-filter__x').click()
    await holds(page, 'nothing left to announce', noticeAbsent(page), 800)
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await holds(page, 'nor on the next launch', noticeAbsent(page))
  })

  test('the panel opens from the Help menu at any time, and focus returns to the Help button', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await page.locator(HELP).click()
    await page.locator(MENU_ITEM).click()
    await expect(page.locator(PANEL)).toBeVisible()
    await expect(page.locator('.menu__pop')).toHaveCount(0)
    await expect.poll(() => stored(page, OPENED_KEY)).toBe(ID)
    await page.locator(PANEL).getByRole('button', { name: 'Close' }).click()
    await expect(page.locator(PANEL)).toHaveCount(0)
    await expect(page.locator(HELP)).toBeFocused()
    // and again, with nothing unread
    await page.locator(HELP).click()
    await expect(page.locator(MENU_ITEM)).toHaveText('What’s new')
    await page.locator(MENU_ITEM).click()
    await expect(page.locator(PANEL)).toBeVisible()
    await page.locator('.mcdlg__scrim').click({ position: { x: 5, y: 5 } })
    await expect(page.locator(PANEL)).toHaveCount(0)
  })
})

// ───────────────────────────────────────────────────────── the Help menu
test.describe('the Help menu', () => {
  test('desktop, English: three groups, in the decided order', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    expect(await helpMenuRows(page)).toEqual([
      'Restart the tour',
      'Turn contextual tips back on',
      '-',
      'What’s new New',
      '-',
      'Send feedback',
      'About Loop Studio',
    ])
    await expect(page.getByRole('menuitem', { name: 'Send feedback — opens in a new tab' })).toBeVisible()
  })

  test('desktop, Korean: the decided wording', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID, [LOCALE]: 'ko' } })
    expect(await helpMenuRows(page)).toEqual([
      '둘러보기 다시 시작',
      '상황별 안내 다시 켜기',
      '-',
      '새로운 기능 새로움',
      '-',
      '피드백 보내기 · 영문',
      'Loop Studio 정보',
    ])
    await page.getByRole('menuitem', { name: '상황별 안내 다시 켜기' }).click()
    const dialog = page.getByRole('dialog', { name: '상황별 안내 관리' })
    await expect(dialog).toBeVisible()
    // nothing has been seen yet on this profile, so every row waits
    await expect(dialog.getByRole('button', { name: '표시 예정' }).first()).toBeDisabled()
  })

  test('the contextual dialog: a seen note offers "Show next time it applies"', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID, [HINTS]: '{"empty-canvas":true}' } })
    await page.locator(HELP).click()
    await page.getByRole('menuitem', { name: 'Turn contextual tips back on' }).click()
    const dialog = page.getByRole('dialog', { name: 'Manage contextual tips' })
    await expect(dialog).toBeVisible()
    const rearm = dialog.getByRole('button', { name: 'Show next time it applies' })
    await expect(rearm).toHaveCount(1)
    await rearm.click()
    await expect(dialog.getByRole('button', { name: 'Show next time it applies' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Will show' }).first()).toBeDisabled()
  })

  // "Read it again from Help, at any time" has to hold for a keyboard too.
  // MEASURED before this: Enter or Space opened the menu and left focus on the
  // Help button, and the arrow keys did nothing. Only Tab reached the items. A
  // screen reader follows focus, so it had none of the menu to read.
  for (const key of ['Enter', 'Space'] as const) {
    test(`keyboard, ${key}: focus enters the menu at its first item, the arrows reach What’s new, and closing the panel returns to Help`, async ({ page }) => {
      await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
      await page.locator(HELP).focus()
      await page.keyboard.press(key)
      const menu = page.locator('.menu__pop[role="menu"]')
      await expect(menu).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Restart the tour' })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(page.getByRole('menuitem', { name: 'Turn contextual tips back on' })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      // the separator is skipped, and the item says that it is unread
      await expect(page.getByRole('menuitem', { name: 'What’s new New' })).toBeFocused()
      await expect(page.locator(MENU_ITEM)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator(PANEL)).toBeVisible()
      await expect(menu).toHaveCount(0)
      await expect(page.locator(PANEL).locator('.mcdlg__x')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page.locator(PANEL)).toHaveCount(0)
      await expect(page.locator(HELP)).toBeFocused()
    })
  }

  test('keyboard: the arrows wrap, Home and End jump, and Escape closes the menu once and returns to Help', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await page.locator(HELP).focus()
    await page.keyboard.press('Enter')
    const first = page.getByRole('menuitem', { name: 'Restart the tour' })
    const last = page.getByRole('menuitem', { name: 'About Loop Studio' })
    await expect(first).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(last).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(first).toBeFocused()
    await page.keyboard.press('End')
    await expect(last).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('menuitem', { name: 'Send feedback — opens in a new tab' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.menu__pop')).toHaveCount(0)
    await expect(page.locator(HELP)).toBeFocused()
    // one Escape, one thing closed: nothing behind the menu was dismissed with it
    await expect(page.locator('.canvas')).toBeVisible()
  })

  test('opened with the mouse: focus stays on the Help button, and Arrow Down then enters at the first item', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await page.locator(HELP).click()
    await expect(page.locator('.menu__pop[role="menu"]')).toBeVisible()
    await expect(page.locator(HELP)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Restart the tour' })).toBeFocused()
  })

  test('keyboard, Korean: the item is read as 새로운 기능, with its marker', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID, [LOCALE]: 'ko' } })
    await page.locator(HELP).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: '둘러보기 다시 시작' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: '새로운 기능 새로움' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '새로운 기능' })).toBeVisible()
  })

  test('mobile: the Help sheet has the same order, and the panel opens from it', async ({ page }) => {
    await boot(page, { width: 390, height: 844, storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await page.locator(MORE).click()
    await page.locator('.sheet__row', { hasText: /^Help/ }).click()
    const sheet = page.locator('.sheet')
    await expect(sheet.locator('.sheet__title')).toHaveText('Help')
    const rows = await sheet.evaluate((el) =>
      [...el.querySelectorAll('.sheet__row, [role="separator"]')].map((c) =>
        c.getAttribute('role') === 'separator' ? '-' : (c.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    )
    expect(rows).toEqual(['Restart the tour', 'Turn contextual tips back on', '-', 'What’s newNew', '-', 'Send feedback', 'About Loop Studio'])
    await page.locator(MENU_ITEM).click()
    await expect(page.locator(PANEL)).toBeVisible()
    await expect.poll(() => stored(page, OPENED_KEY)).toBe(ID)
    await expect(page.locator(MENU_ITEM)).toHaveText('What’s new')
    // the panel is the top layer: on this pristine profile the "Open a file" card
    // and the run bar are both on screen, and neither is drawn over it
    await expect(page.locator('.openhint')).toHaveCount(1)
    const onTop = await page.locator(PANEL).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const points = [[r.left + r.width / 2, r.top + 12], [r.left + 16, r.top + r.height / 2], [r.left + r.width / 2, r.bottom - 12]]
      return points.every(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[data-whatsnew="panel"]'))
    })
    expect(onTop).toBe(true)
    // the panel fits the phone
    const fits = await page.locator(PANEL).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
    })
    expect(fits).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────── one version
// About says which version is running; the notice and What's new say which
// release is the newest. `e2e/support/whatsNew.ts` has the rule and the
// measurement that led to it.
test.describe('one build, one version', () => {
  test('desktop: the build title, About, the notice and What’s new tell one story', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    await expect(page.locator(NOTICE).locator('p')).toContainText(VERSION)
    const title = (await page.locator('.toolbar__brand').getAttribute('title')) ?? ''
    expect(/v(\d+\.\d+\.\d+)/.exec(title)?.[1], `the build title reads "${title}". ${VERSION_IS_READ_ONCE}`).toBe(PACKAGE_VERSION)

    await page.locator(HELP).click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    const about = await readAboutVersion(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.mcdlg')).toHaveCount(0)

    await page.locator(HELP).click()
    await page.locator(MENU_ITEM).click()
    await expect(page.locator(PANEL)).toBeVisible()
    expectOneVersionStory(about.version, await readNewestShown(page))
  })

  test('mobile: the More sheet’s stamp, About and What’s new tell the same story', async ({ page }) => {
    await boot(page, { width: 390, height: 844, storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await page.locator(MORE).click()
    const stamp = (await page.locator('.sheet__stamp').innerText()).trim()
    expect(/^v(\d+\.\d+\.\d+)/.exec(stamp)?.[1], `the More sheet's stamp reads "${stamp}". ${VERSION_IS_READ_ONCE}`).toBe(PACKAGE_VERSION)
    await page.locator('.sheet__row', { hasText: /^Help/ }).click()
    await page.locator('.sheet .sheet__row', { hasText: /^About Loop Studio$/ }).click()
    const about = await readAboutVersion(page)

    // a fresh launch, so the second dialog does not depend on what closing the first one leaves open
    await page.reload()
    await expect(page.locator('.canvas')).toBeVisible()
    await page.locator(MORE).click()
    await page.locator('.sheet__row', { hasText: /^Help/ }).click()
    await page.locator(MENU_ITEM).click()
    await expect(page.locator(PANEL)).toBeVisible()
    expectOneVersionStory(about.version, await readNewestShown(page))
  })
})

// ───────────────────────────────────────────────────────── the end of the list
// The list scrolls inside the panel. MEASURED at 320 px before the list took
// keyboard focus: the two entries are 611 px tall in a 409 px box, the wheel and
// a finger reached the last line, and the keyboard did not. The only control in
// the panel was its close button, so Tab had nowhere to go, and the arrow, Page
// and End keys scroll what holds focus.

/** where the list is, and whether its last line is really on screen */
const panelEnd = (page: Page) =>
  page.evaluate((panelSel) => {
    const panel = document.querySelector(panelSel)!
    const list = panel.querySelector('.whatsnew') as HTMLElement
    const lines = [...panel.querySelectorAll('li')]
    const last = lines[lines.length - 1]!
    const lr = last.getBoundingClientRect()
    const br = list.getBoundingClientRect()
    const onTop = [
      [lr.left + 4, lr.top + 3],
      [lr.left + lr.width / 2, lr.top + lr.height / 2],
      [lr.right - 4, lr.bottom - 3],
    ].every(([x, y]) => last.contains(document.elementFromPoint(x!, y!)))
    return {
      overflows: list.scrollHeight > list.clientHeight + 1,
      moved: list.scrollTop > 0,
      atEnd: list.scrollTop + list.clientHeight >= list.scrollHeight - 1,
      lastLineShown: lr.top >= br.top - 0.5 && lr.bottom <= br.bottom + 0.5 && lr.top >= 0 && lr.bottom <= innerHeight && onTop,
      lastEntry: [...panel.querySelectorAll('.whatsnew__version')].pop()?.firstChild?.textContent ?? '',
    }
  }, PANEL)

/** a sheet row, from the keyboard: at 320 px the wrapped run bar lies over a
 *  sheet's last rows and takes a tap aimed at them (issue #303) */
const activate = async (page: Page, row: ReturnType<Page['locator']>) => {
  await row.focus()
  await expect(row).toBeFocused()
  await page.keyboard.press('Enter')
}

test.describe('the end of the list can be reached', () => {
  for (const locale of LOCALES) {
    test(`320px ${locale}: the last line of the oldest entry, with the keyboard and with the wheel`, async ({ page }) => {
      await boot(page, { width: 320, height: 568, storage: { ...RETURNING, [ANNOUNCED_KEY]: ID, [LOCALE]: locale } })
      await page.locator(MORE).click()
      await activate(page, page.locator('.sheet button.sheet__row').last())
      await activate(page, page.locator(MENU_ITEM))
      const panel = page.locator(PANEL)
      await expect(panel).toBeVisible()
      const list = panel.locator('.whatsnew')
      const close = panel.locator('.mcdlg__x')

      const atOpen = await panelEnd(page)
      expect(atOpen.lastEntry).toBe('v' + RELEASE_NOTES[RELEASE_NOTES.length - 1]!.version)
      // why this size: the list does not fit, so its end has to be scrolled to
      expect(atOpen.overflows, 'the list is taller than the panel at this size').toBe(true)
      expect(atOpen.lastLineShown).toBe(false)

      // the keyboard: the list is the panel's second stop, and it shows a focus ring
      await expect(close).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(list).toBeFocused()
      const stop = await list.evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          role: el.getAttribute('role'),
          named: document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent === el.closest('.mcdlg')?.querySelector('.mcdlg__head span')?.textContent,
          // the list fills the panel edge to edge, so its ring is drawn inside it
          ring: el.matches(':focus-visible') ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}` : 'none',
        }
      })
      expect(stop).toEqual({ role: 'group', named: true, ring: 'solid 2px -2px' })
      await page.keyboard.press('ArrowDown')
      await expect.poll(async () => (await panelEnd(page)).moved).toBe(true)
      await page.keyboard.press('End')
      await expect.poll(() => panelEnd(page)).toMatchObject({ atEnd: true, lastLineShown: true })
      // and Tab still does not leave the panel
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(list).toBeFocused()

      // the wheel, from the top again
      await list.evaluate((el) => {
        el.scrollTop = 0
      })
      expect((await panelEnd(page)).lastLineShown).toBe(false)
      const box = (await panel.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      // real wheel turns, at most WHEEL_TURNS of them: the list grows with every
      // release, and at 0.19.0 one 4000 px turn no longer reached its end in
      // fr, de and ru. The end criterion is unchanged; not reaching it within
      // the turns fails.
      const WHEEL_TURNS = 5
      const scrollTop = () => list.evaluate((el) => el.scrollTop)
      for (let turn = 0; turn < WHEEL_TURNS; turn++) {
        await page.mouse.wheel(0, 4000)
        // let the turn land: the list's position stops moving
        let last = -1
        await expect.poll(async () => {
          const now = await scrollTop()
          const settled = now === last
          last = now
          return settled
        }, { intervals: [100] }).toBe(true)
        const at = await panelEnd(page)
        if (at.atEnd && at.lastLineShown) break
      }
      await expect.poll(() => panelEnd(page)).toMatchObject({ atEnd: true, lastLineShown: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    })
  }

  test('desktop: the list is a named stop after the close button, and Escape still returns focus to Help', async ({ page }) => {
    await boot(page, { storage: { ...RETURNING, [ANNOUNCED_KEY]: ID } })
    await page.locator(HELP).click()
    await page.locator(MENU_ITEM).click()
    const panel = page.locator(PANEL)
    await expect(panel.locator('.mcdlg__x')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('group', { name: 'What’s new' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(panel.locator('.mcdlg__x')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('group', { name: 'What’s new' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(page.locator(HELP)).toBeFocused()
  })
})

// ───────────────────────────────────────────────────────── where it sits
const SIZES = [
  { name: '320', width: 320, height: 640, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '800', width: 800, height: 800, mobile: false },
  { name: '1280', width: 1280, height: 800, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false },
] as const

/** what the notice covers and where it is */
const measure = (page: Page) =>
  page.evaluate(
    ({ notice, sel }) => {
      const n = document.querySelector(notice) as HTMLElement
      const nb = n.getBoundingClientRect()
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
      }
      const pressable = (el: Element) => {
        const s = getComputedStyle(el)
        return (el as HTMLInputElement).type !== 'file' && Number(s.opacity) > 0 && s.pointerEvents !== 'none'
      }
      const hit = (r: DOMRect) => !(r.right <= nb.left || r.left >= nb.right || r.bottom <= nb.top || r.top >= nb.bottom)
      const label = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
      const controls = [...document.querySelectorAll(sel)].filter((el) => visible(el) && pressable(el) && !el.closest(notice) && !el.closest('.react-flow__node') && !el.closest('.react-flow__edge'))
      const canvas = document.querySelector('.canvas')!.getBoundingClientRect()
      const attribution = document.querySelector('.react-flow__attribution')?.getBoundingClientRect()
      const runbar = document.querySelector('.pstrip')?.getBoundingClientRect()
      return {
        insideViewport: nb.left >= 0 && nb.top >= 0 && nb.right <= innerWidth && nb.bottom <= innerHeight,
        insideCanvas: nb.left >= canvas.left && nb.right <= canvas.right && nb.top >= canvas.top && nb.bottom <= canvas.bottom,
        controls: controls.length,
        covered: controls.filter((el) => hit(el.getBoundingClientRect())).map(label),
        inLeftHalf: nb.left + nb.width / 2 < canvas.left + canvas.width / 2,
        inTopHalf: nb.top + nb.height / 2 < canvas.top + canvas.height / 2,
        aboveAttribution: attribution ? nb.bottom <= attribution.top : null,
        aboveRunBar: runbar ? nb.bottom <= runbar.top : null,
        dir: document.documentElement.dir || 'ltr',
      }
    },
    { notice: NOTICE, sel: INTERACTIVE },
  )

/** the box of every piece of chrome, to see whether the notice moves anything */
const chromeRects = (page: Page) =>
  page.evaluate((notice) =>
    [...document.querySelectorAll('.toolbar, .toolbar *, .app__body, .canvas, .canvas-col > *, aside.inspector, aside.inspector *, .pstrip, .pstrip *, .react-flow__controls, .react-flow__minimap, .react-flow__node')]
      .filter((el) => !el.closest(notice))
      .map((el) => {
        const r = el.getBoundingClientRect()
        return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',')
      }),
    NOTICE,
  )

test.describe('where the notice sits', () => {
  for (const size of SIZES) {
    for (const locale of ['en', 'ko', 'ar'] as const) {
      test(`${size.name}px ${locale}: covers no control, moves nothing, sits where the design says`, async ({ page }) => {
        await boot(page, { width: size.width, height: size.height, storage: { ...RETURNING, [LOCALE]: locale } })
        await expect(page.locator('.react-flow__node').first()).toBeVisible()
        await expect(page.locator(NOTICE)).toBeVisible()
        // the mobile card is placed against the measured run bar; wait for that
        if (size.mobile) await expect.poll(async () => (await measure(page)).aboveRunBar).toBe(true)
        const m = await measure(page)
        expect(m.controls).toBeGreaterThan(5)
        expect(m.insideViewport).toBe(true)
        expect(m.insideCanvas).toBe(true)
        expect(m.covered).toEqual([])
        if (size.mobile) {
          // physical right, at the bottom, above the run bar and the attribution - in right-to-left too
          expect(m.inLeftHalf).toBe(false)
          expect(m.inTopHalf).toBe(false)
          expect(m.aboveRunBar).toBe(true)
          expect(m.aboveAttribution).not.toBe(false)
        } else {
          // the canvas's inline-start top corner: left in left-to-right, right in right-to-left
          expect(m.inTopHalf).toBe(true)
          expect(m.inLeftHalf).toBe(m.dir !== 'rtl')
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)

        // nothing moves when it goes away, so nothing moved when it came
        const before = await chromeRects(page)
        await page.locator(NOTICE).getByRole('button').last().click()
        await expect(page.locator(NOTICE)).toHaveCount(0)
        const after = await chromeRects(page)
        expect(before.length).toBeGreaterThan(20)
        expect(after).toEqual(before)
      })
    }
  }

  test('320px Korean: the decided sentence, on one line, broken only between words', async ({ page }) => {
    await boot(page, { width: 320, height: 640, storage: { ...RETURNING, [LOCALE]: 'ko' } })
    const notice = page.locator(NOTICE)
    await expect(notice).toBeVisible()
    await expect(notice.locator('p')).toHaveText(`Loop Studio ${VERSION} 업데이트 완료`)
    await expect(notice.getByRole('button')).toHaveText(['새로운 기능 보기', '닫기'])
    const m = await notice.evaluate((n) => {
      const p = n.querySelector('p') as HTMLElement
      const buttons = [...n.querySelectorAll('button')] as HTMLElement[]
      return {
        wordBreak: getComputedStyle(n).wordBreak,
        lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
        overflowsItself: n.scrollWidth > n.clientWidth,
        buttonRows: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        clipped: buttons.some((b) => b.scrollWidth > b.clientWidth),
      }
    })
    expect(m).toEqual({ wordBreak: 'keep-all', lines: 1, overflowsItself: false, buttonRows: 1, clipped: false })
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`forced colours (${scheme}): the card and the marker keep a visible boundary`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme })
      await boot(page, { storage: RETURNING })
      await expect(page.locator(NOTICE)).toBeVisible()
      const card = await page.locator(NOTICE).evaluate((el) => {
        const c = getComputedStyle(el)
        return { forced: matchMedia('(forced-colors: active)').matches, style: c.borderTopStyle, width: c.borderTopWidth, border: c.borderTopColor, background: c.backgroundColor }
      })
      expect(card.forced).toBe(true)
      expect(card.style).toBe('solid')
      expect(card.width).toBe('1px')
      expect(card.border).not.toBe(card.background)
      await page.locator(HELP).click()
      const badge = await page.locator(MENU_ITEM + ' .menu__badge').evaluate((el) => {
        const c = getComputedStyle(el)
        const row = getComputedStyle(el.closest('.menu__item')!)
        return { style: c.borderTopStyle, border: c.borderTopColor, background: row.backgroundColor }
      })
      expect(badge.style).toBe('solid')
      expect(badge.border).not.toBe(badge.background)
    })
  }
})

// ───────────────────────────────────────────────────────── accessibility contract
test.describe('the notice does not interrupt', () => {
  for (const size of [SIZES[1], SIZES[3]]) {
    for (const locale of ['en', 'ar'] as const) {
      test(`${size.name}px ${locale}: no focus, one polite sentence, a named region, both buttons in the tab order`, async ({ page }) => {
        await boot(page, { width: size.width, height: size.height, storage: { ...RETURNING, [LOCALE]: locale } })
        const notice = page.locator(NOTICE)
        await expect(notice).toBeVisible()

        // it does not take focus
        expect(await page.evaluate((n) => !!document.activeElement?.closest(n), NOTICE)).toBe(false)

        // one short polite sentence, once; the card is a named region and not a live one
        const live = page.locator(LIVE)
        await expect(live).toHaveAttribute('aria-live', 'polite')
        const text = (await notice.locator('p').textContent()) ?? ''
        expect(text).toContain(VERSION)
        await expect(live).toHaveText(text)
        expect(await notice.getAttribute('aria-live')).toBeNull()
        await expect(page.getByRole('region', { name: (await notice.getAttribute('aria-label')) as string })).toBeVisible()
        const buttons = (await notice.getByRole('button').allTextContents()).map((b) => b.trim())
        expect(buttons).toHaveLength(2)

        // it does not time out, and it does not speak again
        await holds(page, 'the notice stays', async () => (await notice.count()) === 1, 3000)
        expect(await liveChanges(page)).toEqual([text])

        // both buttons are in the ordinary tab order, in reading order, before any node
        const order: string[] = []
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press('Tab')
          const f = await page.evaluate((n) => {
            const a = document.activeElement as HTMLElement | null
            return { inNotice: !!a?.closest(n), inNode: !!a?.closest('.react-flow__node'), text: (a?.textContent ?? '').trim() }
          }, NOTICE)
          order.push(f.inNotice ? 'notice:' + f.text : f.inNode ? 'node' : 'other')
          if (order.filter((o) => o.startsWith('notice:')).length === 2) break
        }
        expect(order.filter((o) => o.startsWith('notice:'))).toEqual(buttons.map((b) => 'notice:' + b))
        expect(order.slice(0, order.findIndex((o) => o.startsWith('notice:')))).not.toContain('node')

        // Close, by keyboard: only the notice goes, and focus lands on Help / More
        await expect(notice.getByRole('button').last()).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(notice).toHaveCount(0)
        await expect(page.locator(PANEL)).toHaveCount(0)
        await expect(page.locator(size.mobile ? MORE : HELP)).toBeFocused()
        expect(await liveChanges(page)).toEqual([text])
      })
    }
  }

  test('closing with the mouse, focus elsewhere: focus is left where it was', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    await expect(page.locator(NOTICE)).toBeVisible()
    const templates = page.locator('.toolbar__actions .menu > button').first()
    await templates.focus()
    await expect(templates).toBeFocused()
    const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))
    // a mouse click on a button moves focus to it in Chromium, so the close is
    // made without one: the pointer never touches focus here
    await page.locator(NOTICE).getByRole('button').last().dispatchEvent('click')
    await expect(page.locator(NOTICE)).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))).toBe(before)
  })

  test('mobile: the panel opened from the notice returns focus to the More button', async ({ page }) => {
    await boot(page, { width: 390, height: 844, storage: RETURNING })
    await page.locator(NOTICE).getByRole('button').first().click()
    await expect(page.locator(PANEL)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator(PANEL)).toHaveCount(0)
    await expect(page.locator(MORE)).toBeFocused()
  })
})

// ───────────────────────────────────────────────────────── priority
test.describe('one thing at a time, by priority', () => {
  test('800px, the filter panel open at start: the notice waits, announces nothing, then shows', async ({ page }) => {
    await boot(page, { width: 800, height: 800, storage: { ...RETURNING, 'loop-studio:filter-panel': '1' } })
    await expect(page.locator('.lgr-filter')).toBeVisible()
    await holds(page, 'waiting behind the filter panel', noticeAbsent(page), 2000)
    expect(await stored(page, ANNOUNCED_KEY)).toBeNull()
    expect(await liveChanges(page)).toEqual([])

    await page.locator('.lgr-filter__x').click()
    await expect(page.locator(NOTICE)).toBeVisible()
    await expect.poll(() => stored(page, ANNOUNCED_KEY)).toBe(ID)
    await expect.poll(async () => (await liveChanges(page)).length).toBe(1)
    expect((await measure(page)).covered).toEqual([])
  })

  test('a notice that only ever waited is offered again on the next launch', async ({ page }) => {
    await boot(page, { width: 800, height: 800, storage: { ...RETURNING, 'loop-studio:filter-panel': '1' } })
    await holds(page, 'waiting', noticeAbsent(page), 1200)
    await page.reload()
    await expect(page.locator('.lgr-filter')).toBeVisible()
    await page.locator('.lgr-filter__x').click()
    await expect(page.locator(NOTICE)).toBeVisible()
  })

  for (const width of [800, 1280]) {
    test(`${width}px, the filter panel opened over the notice: it steps aside, focus stays on the pressed button, and it returns silently`, async ({ page }) => {
      await boot(page, { width, height: 800, storage: RETURNING })
      await expect(page.locator(NOTICE)).toBeVisible()
      await expect.poll(async () => (await liveChanges(page)).length).toBe(1)

      const filterButton = page.locator('.react-flow__controls-button.rf-filter')
      await filterButton.click()
      await expect(page.locator('.lgr-filter')).toBeVisible()
      await expect(page.locator(NOTICE)).toHaveCount(0)
      await expect(filterButton).toBeFocused()
      // nothing sits on the panel's own close button
      const closeOnTop = await page.evaluate(() => {
        const b = document.querySelector('.lgr-filter__x') as HTMLElement
        const r = b.getBoundingClientRect()
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b
      })
      expect(closeOnTop).toBe(true)

      await page.locator('.lgr-filter__x').click()
      await expect(page.locator(NOTICE)).toBeVisible()
      await holds(page, 'no second announcement', async () => (await liveChanges(page)).length === 1, 1000)
      expect((await measure(page)).covered).toEqual([])
    })
  }

  test('focus inside the notice when it steps aside: focus moves to the Help button, not to the page', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    const open = page.locator(NOTICE).getByRole('button').first()
    await open.focus()
    await expect(open).toBeFocused()
    // a new deploy arrives: the update bar has priority
    await page.evaluate(() => {
      const l = (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop
      l.pwa.setState({ waitingWorker: { test: 'waiting worker' }, dismissedWorker: null })
    })
    await expect(page.locator('.pwa-update')).toBeVisible()
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await expect(page.locator(HELP)).toBeFocused()
  })

  test('mobile, focus inside the notice when it steps aside: focus moves to the More button', async ({ page }) => {
    await boot(page, { width: 390, height: 844, storage: RETURNING })
    const open = page.locator(NOTICE).getByRole('button').first()
    await open.focus()
    await page.evaluate(() => {
      const l = (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop
      l.pwa.setState({ waitingWorker: { test: 'waiting worker' }, dismissedWorker: null })
    })
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await expect(page.locator(MORE)).toBeFocused()
  })

  test('the update bar comes first: one automatic notice at a time', async ({ page }) => {
    await boot(page, { storage: RETURNING, pwaWaitingAtBoot: true })
    await expect(page.locator('.pwa-update')).toBeVisible()
    await holds(page, 'the notice waits for the update bar', noticeAbsent(page), 2000)
    expect(await stored(page, ANNOUNCED_KEY)).toBeNull()
    expect(await liveChanges(page)).toEqual([])
    // the marker does not wait
    expect(await helpMenuRows(page)).toContain('What’s new New')
    await page.keyboard.press('Escape')

    await page.locator('.pwa-update').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.locator('.pwa-update')).toHaveCount(0)
    await expect(page.locator(NOTICE)).toBeVisible()
    await expect.poll(() => stored(page, ANNOUNCED_KEY)).toBe(ID)

    // another deploy while the notice is up: the bar returns, the notice steps aside
    await page.evaluate(() => {
      const l = (window as unknown as { __loop: { pwa: { setState: (s: unknown) => void } } }).__loop
      l.pwa.setState({ waitingWorker: { test: 'waiting worker 2' } })
    })
    await expect(page.locator('.pwa-update')).toBeVisible()
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await page.locator('.pwa-update').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.locator(NOTICE)).toBeVisible()
    // the sentence is written once the notice has really been on screen for a moment
    await expect.poll(async () => (await liveChanges(page)).length).toBe(1)
    await holds(page, 'said once', async () => (await liveChanges(page)).length === 1, 1000)
  })

  test('800px: the empty-canvas hint waits for the notice and is not used up while it waits', async ({ page }) => {
    test.setTimeout(45_000)
    await boot(page, { width: 800, height: 800, storage: RETURNING })
    await expect(page.locator(NOTICE)).toBeVisible()
    await page.evaluate(() => {
      const l = (window as unknown as { __loop: { graph: { getState: () => { newGraph: () => void } } } }).__loop
      l.graph.getState().newGraph()
    })
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    // longer than the hint's own delays: without the rule it shows after about four seconds
    await holds(page, 'the hint waits', async () => (await page.locator('.hint-note').count()) === 0, 6000)
    await expect(page.locator(NOTICE)).toBeVisible()
    expect((await stored(page, HINTS)) ?? '').not.toContain('empty-canvas')

    await page.locator(NOTICE).getByRole('button').last().click()
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await expect(page.locator('.hint-note')).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => (await stored(page, HINTS)) ?? '').toContain('empty-canvas')
  })

  test('a note that follows a deliberate action comes first: the notice waits while focus mode asks for a selection', async ({ page }) => {
    await boot(page, { width: 800, height: 800, storage: { ...RETURNING, 'loop-studio:focus-mode': '1' } })
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await holds(page, 'waiting for the focus-mode note', noticeAbsent(page), 1500)
    expect(await stored(page, ANNOUNCED_KEY)).toBeNull()
    // selecting a node satisfies focus mode; the note goes and the notice shows
    await page.locator('.react-flow__node').first().click()
    await expect(page.locator(NOTICE)).toBeVisible()
  })

  test('a tour replay hides the notice and brings it back afterwards', async ({ page }) => {
    await boot(page, { storage: RETURNING })
    await expect(page.locator(NOTICE)).toBeVisible()
    await page.locator(HELP).click()
    await page.getByRole('menuitem', { name: 'Restart the tour' }).click()
    await expect(page.locator(NOTICE)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator(NOTICE)).toBeVisible()
    await expect.poll(async () => (await liveChanges(page)).length).toBe(1)
    await holds(page, 'said once', async () => (await liveChanges(page)).length === 1, 800)
  })
})

// ───────────────────────────────────────────────────────── every language
test.describe('every shipped language carries the notice and every release note', () => {
  for (const locale of LOCALES) {
    test(`${locale}: the sentence names the version, and the panel has text for every item`, async ({ page }) => {
      await boot(page, { storage: { ...RETURNING, [LOCALE]: locale } })
      const notice = page.locator(NOTICE)
      await expect(notice).toBeVisible()
      const sentence = (await notice.locator('p').textContent()) ?? ''
      expect(sentence).toContain(VERSION)
      expect(sentence).toContain('Loop Studio')
      expect(sentence).not.toContain('{')
      if (locale !== 'en') expect(sentence).not.toBe(`Loop Studio was updated to ${VERSION}`)
      await notice.getByRole('button').first().click()
      const items = await page.locator(PANEL + ' li').allTextContents()
      expect(items).toHaveLength(RELEASE_NOTES.reduce((n, r) => n + r.items.length, 0))
      expect(new Set(items).size).toBe(items.length)
      for (const text of items) {
        expect(text.trim().length).toBeGreaterThan(8)
        expect(text).not.toMatch(/whatsNew\.|text unavailable|\{/)
      }
      // the version line reads left to right in every language
      await expect(page.locator(PANEL + ' .whatsnew__version').first()).toHaveAttribute('dir', 'ltr')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    })
  }
})
