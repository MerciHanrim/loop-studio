import type { Locator, Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// Issue #308 - what the guided tour says, and where focus is, step by step
// (docs/guided-tour.md §GT4, the announcement contract). Each step is said
// ONCE: step 1 by the dialog's name (its title) and description (its body)
// when focus enters it, every later step by one polite, atomic live region,
// written once per Next or Back press. The visible `N / 6` and the title are
// not live, so neither repeats it. Focus starts on Next, stays on Back or
// Next, moves to Next before Back is disabled on step 1, and every exit
// (Done, Escape, the close control), first run or replay, lands on the Help
// button (the overflow button when the toolbar has folded Help into it, More
// on a phone), never on <body>.

const KEY = 'loop-studio/guided-tour/1'

type Bridge = { __loop: { tour: { getState: () => any }; i18n: { getState: () => any } } }

/** the first-run state (no key) or a decided one, before the FIRST boot only */
const seedKey = (page: Page, v: 'completed' | null) =>
  page.addInitScript(
    ([k, val]) => {
      try {
        if (sessionStorage.getItem('__tour_seeded')) return
        sessionStorage.setItem('__tour_seeded', '1')
        if (val == null) localStorage.removeItem(k)
        else localStorage.setItem(k, val)
      } catch {
        /* ignore */
      }
    },
    [KEY, v] as const,
  )

/** Records, from before the app boots: every text the tour's live regions
 *  come to hold (one entry per change, a repeat of the same text is not a new
 *  entry), and every time focus leaves an element for nowhere (no
 *  `relatedTarget`) and is still on <body> once the task is over. A move to
 *  another element (Tab) has a `relatedTarget`; checked in a microtask instead,
 *  a native Tab reads <body> between its focusout and focusin. */
const record = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __said: string[]; __lost: string[] }
    w.__said = []
    w.__lost = []
    const last = new WeakMap<Element, string>()
    const start = () => {
      new MutationObserver((recs) => {
        const touched = new Set<Element>()
        for (const r of recs) {
          const el = (r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement)?.closest('.tour [aria-live]')
          if (el) touched.add(el)
        }
        for (const el of touched) {
          const text = (el.textContent ?? '').trim()
          if (text && last.get(el) !== text) w.__said.push(text)
          last.set(el, text)
        }
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true })
      document.addEventListener(
        'focusout',
        (e) => {
          if ((e as FocusEvent).relatedTarget) return
          const from = (e.target as HTMLElement).className?.toString() ?? ''
          setTimeout(() => {
            if (document.activeElement === document.body || document.activeElement == null) w.__lost.push(from)
          }, 0)
        },
        true,
      )
    }
    if (document.documentElement) start()
    else document.addEventListener('DOMContentLoaded', start)
  })

/** what the live regions said since the last call */
const said = (page: Page) =>
  page.evaluate(() => (window as unknown as { __said: string[] }).__said.splice(0))
const lost = (page: Page) => page.evaluate(() => (window as unknown as { __lost: string[] }).__lost.slice())

const popover = (page: Page) => page.locator('.tour-popover')
const welcome = (page: Page) => page.locator('.tour-card')
const nextBtn = (page: Page) => popover(page).locator('.tour-popover__foot .btn--primary')
const backBtn = (page: Page) => popover(page).locator('.tour-popover__foot .btn:not(.btn--primary)')
const closeBtn = (page: Page) => popover(page).locator('.tour-popover__x')
const announcer = (page: Page) => popover(page).locator('.tour-popover__announce')

/** the step on screen, as its announcement must read in English */
const shownStep = async (page: Page) => {
  const pos = (await popover(page).locator('.tour-popover__pos').textContent())!.trim()
  const title = (await popover(page).locator('.tour-popover__title').textContent())!.trim()
  const body = (await popover(page).locator('.tour-popover__body').textContent())!.trim()
  return { pos, title, body, announcement: `${pos}. ${title}. ${body}` }
}

/** the dialog says step `n` by its name and description; nothing is live but
 *  the one announcer */
async function expectStepDialog(page: Page, n: number) {
  const s = await shownStep(page)
  expect(s.pos).toBe(`${n} / 6`)
  await expect(popover(page)).toHaveAttribute('role', 'dialog')
  // the number and the title together, so step 1 is said with its number
  await expect(popover(page)).toHaveAccessibleName(`${s.pos} ${s.title}`)
  await expect(popover(page)).toHaveAccessibleDescription(s.body)
  const live = page.locator('.tour [aria-live]')
  await expect(live).toHaveCount(1)
  await expect(live).toHaveClass(/tour-popover__announce/)
  await expect(live).toHaveAttribute('aria-live', 'polite')
  await expect(live).toHaveAttribute('aria-atomic', 'true')
  await expect(popover(page).locator('.tour-popover__pos')).not.toHaveAttribute('aria-live', /.*/)
  await expect(popover(page).locator('.tour-popover__title').locator('xpath=ancestor-or-self::*[@aria-live]')).toHaveCount(0)
  return s
}

/** from the Welcome card, keyboard only: Start tour */
async function startFirstRun(page: Page) {
  await expect(welcome(page)).toBeVisible()
  await welcome(page).getByRole('button', { name: 'Start tour' }).focus()
  await page.keyboard.press('Enter')
  await expect(popover(page)).toBeVisible()
}

/** desktop replay from Help, keyboard only */
async function startReplayDesktop(page: Page) {
  const help = page.locator('[data-tour="help-trigger"]')
  await help.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Restart the tour' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(popover(page)).toBeVisible()
}

/** Next, with focus on it, until the last step */
async function walkToLast(page: Page) {
  for (let n = 2; n <= 6; n++) {
    await expect(nextBtn(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText(`${n} / 6`)
  }
  await expect(nextBtn(page)).toHaveText('Done')
}

type Exit = 'Done' | 'Escape' | 'close control'
async function endBy(page: Page, how: Exit) {
  if (how === 'Done') {
    await walkToLast(page)
    await page.keyboard.press('Enter')
  } else if (how === 'Escape') {
    await page.keyboard.press('Escape')
  } else {
    await closeBtn(page).focus()
    await page.keyboard.press('Enter')
  }
  await expect(popover(page)).toHaveCount(0)
}

/** what Chromium's own accessibility tree says about an element */
async function chromiumAx(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
  await cdp.detach()
  return { role: nodes[0]?.role?.value, name: nodes[0]?.name?.value, description: nodes[0]?.description?.value }
}

async function expectFocusOn(page: Page, target: Locator) {
  await expect(target).toBeFocused()
  expect(await lost(page)).toEqual([])
}

test.describe('the tour says each step once, and keeps focus (desktop)', () => {
  test('first run: the Welcome card and step 1 by name and description, steps 2-6 once each by the live region, focus on Next', async ({ page }) => {
    await seedKey(page, null)
    await record(page)
    await openApp(page)
    await expect(welcome(page)).toBeVisible()
    await expect(welcome(page)).toHaveAccessibleName('Welcome to Loop Studio')
    // the question is the card's description, through aria-describedby
    const describedBy = await welcome(page).getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(welcome(page).locator(`[id="${describedBy}"]`)).toHaveText('A quick two-minute tour of the six parts of the workspace?')
    await expect(welcome(page)).toHaveAccessibleDescription('A quick two-minute tour of the six parts of the workspace?')
    // the Welcome card's own order is unchanged: Skip first
    await expect(welcome(page).getByRole('button', { name: 'Skip' })).toBeFocused()

    expect(await chromiumAx(page, '.tour-card')).toEqual({
      role: 'dialog',
      name: 'Welcome to Loop Studio',
      description: 'A quick two-minute tour of the six parts of the workspace?',
    })

    await startFirstRun(page)
    const first = await expectStepDialog(page, 1)
    await expect(nextBtn(page)).toBeFocused()
    // Chromium's tree: number, title and body, all three, on the dialog itself
    expect(await chromiumAx(page, '.tour-popover')).toEqual({
      role: 'dialog',
      name: `1 / 6 ${first.title}`,
      description: first.body,
    })
    // step 1 is the dialog's name and description: the live region says nothing
    await expect(announcer(page)).toHaveText('')
    expect(await said(page)).toEqual([])

    for (let n = 2; n <= 6; n++) {
      await page.keyboard.press('Enter')
      await expect(popover(page).locator('.tour-popover__pos')).toHaveText(`${n} / 6`)
      const s = await expectStepDialog(page, n)
      await expect(announcer(page)).toHaveText(s.announcement)
      expect(await said(page), `step ${n} is said exactly once`).toEqual([s.announcement])
      await expect(nextBtn(page)).toBeFocused()
    }
    await expect(nextBtn(page)).toHaveText('Done')
    expect(await lost(page)).toEqual([])
  })

  test('Back to step 1 moves focus to Next before Back is disabled; each step back is said once', async ({ page }) => {
    await seedKey(page, 'completed')
    await record(page)
    await openApp(page)
    await startReplayDesktop(page)
    await expect(nextBtn(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('3 / 6')
    await said(page)

    await page.keyboard.press('Shift+Tab')
    await expect(backBtn(page)).toBeFocused()
    await page.keyboard.press('Enter')
    let s = await expectStepDialog(page, 2)
    expect(await said(page)).toEqual([s.announcement])
    await expect(backBtn(page)).toBeFocused()

    await page.keyboard.press('Enter')
    s = await expectStepDialog(page, 1)
    expect(await said(page)).toEqual([s.announcement])
    await expect(backBtn(page)).toBeDisabled()
    await expect(nextBtn(page)).toBeFocused()
    expect(await lost(page), 'focus never fell to <body>').toEqual([])
  })

  test('a language switch mid-tour announces nothing; the next step is said once, in the new language', async ({ page }) => {
    await seedKey(page, 'completed')
    await record(page)
    await openApp(page)
    await startReplayDesktop(page)
    await page.keyboard.press('Enter')
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('2 / 6')
    expect(await said(page)).toHaveLength(1)
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('ko'))
    await expect(nextBtn(page)).toHaveText('다음')
    expect(await said(page)).toEqual([])
    await nextBtn(page).focus()
    await page.keyboard.press('Enter')
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('3 / 6')
    const title = (await popover(page).locator('.tour-popover__title').textContent())!.trim()
    const body = (await popover(page).locator('.tour-popover__body').textContent())!.trim()
    expect(await said(page)).toEqual([`3 / 6. ${title}. ${body}`])
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('en'))
  })

  for (const run of ['first run', 'replay'] as const) {
    for (const how of ['Done', 'Escape', 'close control'] as const) {
      test(`${run}, ended by ${how}: focus lands on the Help button, never on <body>`, async ({ page }) => {
        await seedKey(page, run === 'first run' ? null : 'completed')
        await record(page)
        await openApp(page)
        if (run === 'first run') await startFirstRun(page)
        else await startReplayDesktop(page)
        await endBy(page, how)
        await expectFocusOn(page, page.locator('[data-tour="help-trigger"]'))
      })
    }
  }

  // Help first; the overflow button only when Help is folded into it; More on
  // a phone. Only when none is usable: a menu button of the top bar, never a
  // palette piece and never <body>. At 1280 px the overflow button is in the
  // page but hidden, so with Help hidden this reaches the last resort.
  test('with the Help button gone from view, an exit lands on a menu button of the top bar, not on a palette piece or <body>', async ({ page }) => {
    await seedKey(page, 'completed')
    await record(page)
    await openApp(page)
    await startReplayDesktop(page)
    await page.evaluate(() => {
      const h = document.querySelector<HTMLElement>('[data-tour="help-trigger"]')!
      h.style.display = 'none'
    })
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    // a menu button of the top bar: opening a menu is harmless, while Enter on
    // a palette piece would insert it
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      return {
        body: a === document.body,
        inTopBar: !!a?.closest('header.toolbar'),
        tag: a?.tagName,
        menuButton: !!a && (a.hasAttribute('aria-haspopup') || a.hasAttribute('aria-expanded')),
        inPalette: !!a?.closest('[data-tour="palette"]'),
      }
    })
    expect(where).toEqual({ body: false, inTopBar: true, tag: 'BUTTON', menuButton: true, inPalette: false })
    expect(await lost(page)).toEqual([])
  })
})

test.describe('the tour at 760 px: Help is folded into the overflow button', () => {
  test.use({ viewport: { width: 760, height: 800 } })
  for (const run of ['first run', 'replay'] as const) {
    test(`${run}, ended by Escape: focus lands on the overflow button`, async ({ page }) => {
      await seedKey(page, run === 'first run' ? null : 'completed')
      await record(page)
      await openApp(page)
      if (run === 'first run') {
        await startFirstRun(page)
      } else {
        const more = page.locator('.toolbar__overflow-btn')
        await more.focus()
        await page.keyboard.press('Enter')
        const help = page.locator('.toolbar__overflow-pop [data-tour="help-trigger"]')
        await help.focus()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('menuitem', { name: 'Restart the tour' })).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(popover(page)).toBeVisible()
      }
      await expect(nextBtn(page)).toBeFocused()
      await endBy(page, 'Escape')
      await expectFocusOn(page, page.locator('.toolbar__overflow-btn'))
    })
  }
})

test.describe('the tour on a phone: the same contract', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  async function startReplayPhone(page: Page) {
    await page.locator('[data-tour="mobile-more"]').click()
    await page.locator('.sheet').getByRole('button', { name: /^Help/ }).click()
    await page.locator('.sheet').getByRole('button', { name: 'Restart the tour' }).click()
    await expect(popover(page)).toBeVisible()
  }

  test('first run: step 1 by name and description with focus on Next, every later step once', async ({ page }) => {
    await seedKey(page, null)
    await record(page)
    await openApp(page)
    await expect(welcome(page)).toHaveAccessibleDescription('A quick two-minute tour of the six parts of the workspace?')
    await startFirstRun(page)
    await expectStepDialog(page, 1)
    await expect(nextBtn(page)).toBeFocused()
    expect(await said(page)).toEqual([])
    for (let n = 2; n <= 6; n++) {
      await page.keyboard.press('Enter')
      await expect(popover(page).locator('.tour-popover__pos')).toHaveText(`${n} / 6`)
      const s = await expectStepDialog(page, n)
      expect(await said(page), `step ${n} is said exactly once`).toEqual([s.announcement])
      await expect(nextBtn(page)).toBeFocused()
    }
  })

  for (const run of ['first run', 'replay'] as const) {
    for (const how of ['Done', 'Escape', 'close control'] as const) {
      test(`${run}, ended by ${how}: focus lands on More, never on <body>`, async ({ page }) => {
        await seedKey(page, run === 'first run' ? null : 'completed')
        await record(page)
        await openApp(page)
        if (run === 'first run') await startFirstRun(page)
        else await startReplayPhone(page)
        await expect(nextBtn(page)).toBeFocused()
        await endBy(page, how)
        await expectFocusOn(page, page.locator('[data-tour="mobile-more"]'))
      })
    }
  }
})
