import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { PACKAGE_VERSION, readAboutVersion, VERSION_IS_READ_ONCE } from './support/appVersion'
import { pickLocale } from './support/workbenchMenus'

// What e2e/whats-new.spec.ts held beyond the in-app release notes, kept when
// those notes were removed (2026-10; restored 2026-10-22):
//   • the Help menu's decided wording, word for word, in English and Korean,
//     and the feedback link's accessible name (the visible ↗ is decorative);
//   • one build, one version, on the dev server too: the build title and About
//     show the version in package.json. MEASURED when it went wrong: a dev
//     server left running across a version change drew the old number
//     (e2e/support/appVersion.ts). The built files are checked in dist.spec,
//     pwa.spec and portable-file.spec; the phone's More-sheet stamp in
//     mobile.spec.

const HELP = '[data-tour="help-trigger"]'

/** the Help menu's rows in order, a separator as '-' */
async function helpMenuRows(page: Page): Promise<string[]> {
  await page.locator(HELP).click()
  const pop = page.locator('.menu__pop[role="menu"]')
  await expect(pop).toBeVisible()
  return pop.evaluate((el) => [...el.children].map((c) => (c.getAttribute('role') === 'separator' ? '-' : (c.textContent ?? '').replace(/\s+/g, ' ').trim())))
}

test.describe('the Help menu, word for word', () => {
  test('desktop, English: two groups, in the decided order and wording', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    expect(await helpMenuRows(page)).toEqual(['Restart the tour', 'Turn contextual tips back on', 'Example notes', '-', 'Send feedback', 'About Loop Studio'])
    await expect(page.getByRole('menuitem', { name: 'Send feedback — opens in a new tab', exact: true })).toBeVisible()
  })

  test('desktop, Korean: the decided wording', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
    expect(await helpMenuRows(page)).toEqual(['둘러보기 다시 시작', '상황별 안내 다시 켜기', '예제 설명', '-', '피드백 보내기 · 영문', 'Loop Studio 정보'])
    await expect(page.getByRole('menuitem', { name: '피드백 보내기 · 영문 — 새 탭에서 열림', exact: true })).toBeVisible()
  })
})

test.describe('one build, one version (the dev server)', () => {
  test('desktop: the build title and About show the version in package.json', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const title = (await page.locator('.toolbar__brand').getAttribute('title')) ?? ''
    expect(/v(\d+\.\d+\.\d+)/.exec(title)?.[1], `the build title reads "${title}". ${VERSION_IS_READ_ONCE}`).toBe(PACKAGE_VERSION)
    await page.locator(HELP).click()
    await page.getByRole('menuitem', { name: 'About Loop Studio', exact: true }).click()
    const about = await readAboutVersion(page)
    expect(about.version, `About shows v${about.version}. ${VERSION_IS_READ_ONCE}`).toBe(PACKAGE_VERSION)
    // the build title and About name the same commit
    if (about.build) expect(title).toContain(about.build)
  })
})
