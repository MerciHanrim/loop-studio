import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

// Issue #301 — the licence view in the About dialog, shared by the dev, the
// production-bundle, the PWA and the portable specs. What the screen shows is
// compared with the SHA-256 the committed manifest pins for that build.

type Build = 'web' | 'pwa' | 'portable'

export const manifestNoticesSha = (build: Build): string =>
  (JSON.parse(readFileSync(resolve('licenses/third-party-manifest.json'), 'utf8')) as { builds: Record<Build, { noticesSha256: string }> }).builds[build].noticesSha256

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

export const aboutDialog = (page: Page): Locator => page.locator('.mcdlg--about')

/** Help ▸ About Loop Studio (desktop) */
export async function openAbout(page: Page): Promise<Locator> {
  await page.locator('[data-tour="help-trigger"]').click()
  await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
  const dlg = aboutDialog(page)
  await expect(dlg).toBeVisible()
  await expect(dlg).toHaveAttribute('data-about-view', 'about')
  return dlg
}

/** About ▸ Third-party open-source licenses: the same dialog, its licence view */
export async function openLicences(page: Page): Promise<Locator> {
  const dlg = aboutDialog(page)
  await dlg.locator('[data-about-licenses]').click()
  await expect(dlg).toHaveAttribute('data-about-view', 'licenses')
  return dlg
}

/** the shown notices: the <pre>'s child node types and its text */
export async function shownNotices(page: Page): Promise<{ kinds: number[]; text: string }> {
  const pre = aboutDialog(page).locator('[data-licenses-text]')
  await expect(pre).toBeVisible()
  return pre.evaluate((el) => ({ kinds: [...el.childNodes].map((n) => n.nodeType), text: el.textContent ?? '' }))
}

/** the shown text is one text node whose bytes are the manifest's for `build` */
export async function expectShownNoticesAre(page: Page, build: Build): Promise<void> {
  const shown = await shownNotices(page)
  expect(shown.kinds, 'the notices are one text node').toEqual([3])
  expect(sha256(shown.text)).toBe(manifestNoticesSha(build))
}
