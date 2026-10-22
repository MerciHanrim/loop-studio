import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { pickLocale } from './support/workbenchMenus'

// Help ▸ Example notes (Lumi, 2026-10-20): every example the Templates menu
// offers, explained in the app and readable at any time — no link, no
// one-time tip, nothing stored. The Manage-contextual-tips shell and list;
// each row a disclosure. Keyboard: open from the Help menu, open / close a
// note, Escape closes and focus returns to the Help trigger. A small window:
// the long notes scroll inside the dialog, which stays inside the window.

const helpTrigger = (page: Page, name: RegExp) => page.locator('.toolbar__actions').getByRole('button', { name, exact: false }).filter({ hasText: name }).first()
const dialog = (page: Page) => page.locator('.mcdlg--example-notes')
const activeText = (page: Page) => page.evaluate(() => (document.activeElement?.textContent ?? '').trim())
/** the open note's line breaks that fall INSIDE a word — between two letters
 *  or digits ("뽑기 횟|수"), measured with a Range per character. Its purpose
 *  is no clipped word (Lumi, 2026-10-20): a break at punctuation — beside an
 *  interpunct, a parenthesis, a comma — is an ordinary line break and is not
 *  counted */
const midWordBreaks = (page: Page) =>
  dialog(page)
    .locator('.example-notes__text p')
    .evaluateAll((ps) => {
      const out: string[] = []
      for (const p of ps) {
        const node = p.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE) continue
        const text = node.textContent ?? ''
        const range = document.createRange()
        let prevTop: number | null = null
        for (let c = 0; c < text.length; c++) {
          range.setStart(node, c)
          range.setEnd(node, c + 1)
          const { top } = range.getBoundingClientRect()
          const inWord = /[\p{L}\p{N}]/u.test(text[c - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[c] ?? '')
          if (prevTop !== null && top > prevTop + 1 && inWord) out.push(`${text.slice(Math.max(0, c - 4), c)}|${text.slice(c, c + 4)}`)
          prevTop = top
        }
      }
      return out
    })

test.describe('Help ▸ Example notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openApp(page)
    await resetAll(page)
  })

  test('by keyboard: open from Help, open a note, open another (the first closes), Escape returns focus to Help', async ({ page }) => {
    const help = helpTrigger(page, /^Help$/)
    await help.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Example notes' })).toBeVisible()
    // walk the menu to the row
    for (let i = 0; i < 8 && (await activeText(page)) !== 'Example notes'; i++) await page.keyboard.press('ArrowDown')
    expect(await activeText(page)).toBe('Example notes')
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('.mcdlg__head')).toContainText('Example notes')
    // focus is inside the dialog; Tab reaches the first example's row
    expect(await dialog(page).evaluate((d) => d.contains(document.activeElement))).toBe(true)
    const rows = dialog(page).locator('.example-notes__toggle')
    await expect(rows).toHaveCount(7)
    await rows.first().focus()
    await expect(rows.first()).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(rows.first()).toHaveAttribute('aria-expanded', 'true')
    await expect(dialog(page).locator('.example-notes__text')).toContainText('Material supply adds 3 units a step')
    // the next row by Tab, opened with Space: the first one closes
    await page.keyboard.press('Tab')
    await expect(rows.nth(1)).toBeFocused()
    await page.keyboard.press(' ')
    await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'true')
    await expect(rows.first()).toHaveAttribute('aria-expanded', 'false')
    await expect(dialog(page).locator('.example-notes__text')).toHaveCount(1)
    // Enter again closes it
    await page.keyboard.press('Enter')
    await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(help).toBeFocused()
  })

  test('Korean: every menu Template, in the menu’s order, each with its note; the general gacha’s says the denominator and the stop', async ({ page }) => {
    await pickLocale(page, 'ko')
    await helpTrigger(page, /^도움말$/).click()
    await page.getByRole('menuitem', { name: '예제 설명' }).click()
    const names = await dialog(page).locator('.example-notes__toggle .contextual-help__name').allTextContents()
    expect(names).toEqual(['균형 잡힌 생산 라인', '용량 교착', '커피 로스터리 운영 흐름', '일반 가챠', '상시 가챠', '픽업 가챠', '3존 가챠 배너 비교'])
    for (let i = 0; i < names.length; i++) {
      await dialog(page).locator('.example-notes__toggle').nth(i).click()
      await expect(dialog(page).locator('.example-notes__text p').first()).not.toBeEmpty()
      // Korean breaks between words, never inside one (2026-10-20: the notes
      // had no `keep-all` and broke "뽑기 횟|수")
      expect(await midWordBreaks(page), `${names[i]}: no word split across lines`).toEqual([])
    }
    await dialog(page).locator('.example-notes__row[data-example="gacha-general"] .example-notes__toggle').click()
    const text = dialog(page).locator('.example-notes__row[data-example="gacha-general"] .example-notes__text')
    await expect(text).toContainText('SSR 적중률은 목표 뽑기 횟수를 분모로 계산합니다.')
    await expect(text).toContainText('뽑기 횟수가 목표에 도달한 다음 단계에 엔드(뽑기 완료)가 그 1을 가져가고 실행이 끝납니다.')
    // the standard gacha's: the forced SSR goes through the common SSR result,
    // and what that shows in the activity cue and the flow record
    await dialog(page).locator('.example-notes__row[data-example="gacha-standard"] .example-notes__toggle').click()
    const standard = dialog(page).locator('.example-notes__row[data-example="gacha-standard"] .example-notes__text')
    await expect(standard).toContainText('확정 SSR은 그 티켓을 SSR 결과로 보내고 천장 도달 횟수를 1 늘립니다.')
    await expect(standard).toContainText('SSR 결과의 작동 표시와 흐름 기록에는 자연 SSR과 확정 SSR이 함께 나오고')
    await expect(standard).toContainText('연결 관계에 따라 상류에서 하류로 처리되므로')
    // the pickup gacha's: the guarantee is for the next SSR, kept through SR / R
    await dialog(page).locator('.example-notes__row[data-example="gacha-pickup"] .example-notes__toggle').click()
    const pickup = dialog(page).locator('.example-notes__row[data-example="gacha-pickup"] .example-notes__text')
    await expect(pickup).toContainText('보장은 다음 뽑기가 아니라 다음 SSR에 적용됩니다.')
    await expect(pickup).toContainText('SR이나 R이 나와도 보장 상태는 그대로 유지됩니다.')
    // no link anywhere in the dialog
    await expect(dialog(page).locator('a')).toHaveCount(0)
  })

  test('a low window: the dialog stays inside it and a long note scrolls inside the dialog to its end', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 })
    await helpTrigger(page, /^Help$/).click()
    await page.getByRole('menuitem', { name: 'Example notes' }).click()
    await dialog(page).locator('.example-notes__row[data-example="coffee-roastery"] .example-notes__toggle').click()
    const box = await dialog(page).boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(520)
    const body = dialog(page).locator('.mcdlg__body')
    const sizes = await body.evaluate((b) => ({ scroll: b.scrollHeight, client: b.clientHeight }))
    expect(sizes.scroll, 'the note is taller than the room').toBeGreaterThan(sizes.client)
    // the note's last paragraph scrolls into view inside the body
    const last = dialog(page).locator('.example-notes__row[data-example="coffee-roastery"] .example-notes__text p').last()
    await last.scrollIntoViewIfNeeded()
    const lb = await last.boundingBox()
    const bb = await body.boundingBox()
    expect(lb!.y + lb!.height).toBeLessThanOrEqual(bb!.y + bb!.height + 1)
    expect(await body.evaluate((b) => b.scrollTop)).toBeGreaterThan(0)
  })

  test('the phone: More ▸ Help ▸ Example notes, the note scrolls inside the dialog, closing returns to More', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.reload()
    await openApp(page)
    await page.locator('[data-tour="mobile-more"]').click()
    await page.locator('.sheet__row', { hasText: 'Help' }).first().click()
    await page.locator('.sheet__row', { hasText: 'Example notes' }).click()
    await expect(dialog(page)).toBeVisible()
    // Korean at the phone's width: every note, no word split across lines
    await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('ko'))
    await page.waitForFunction(() => document.documentElement.lang === 'ko')
    const toggles = dialog(page).locator('.example-notes__toggle')
    for (let i = 0; i < (await toggles.count()); i++) {
      await toggles.nth(i).click()
      await expect(dialog(page).locator('.example-notes__text p').first()).not.toBeEmpty()
      expect(await midWordBreaks(page), `note ${i + 1}: no word split across lines (ko, 390 px)`).toEqual([])
    }
    await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('en'))
    await page.waitForFunction(() => document.documentElement.lang === 'en')
    // the loop left the last note (the 3-zone comparison's) open; a click would close it
    const zones = dialog(page).locator('.example-notes__row[data-example="gacha-banner-zones"] .example-notes__toggle')
    if ((await zones.getAttribute('aria-expanded')) !== 'true') await zones.click()
    await expect(zones).toHaveAttribute('aria-expanded', 'true')
    const box = await dialog(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(box!.y + box!.height).toBeLessThanOrEqual(700)
    const body = dialog(page).locator('.mcdlg__body')
    expect(await body.evaluate((b) => b.scrollHeight > b.clientHeight)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    // focus is back in a sheet (`backToMore`, as About and the contextual tips do)
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.sheet')))).toBe(true)
  })
})
