import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

// One build, one version. About says which version is running, and it must be the
// version in `package.json`. MEASURED when it went wrong: a dev server that had
// been left running since before the version was raised drew the old number in
// About. `vite.config.ts` reads the version and the commit once, when the server
// or the build starts.
//
// (Kept from `e2e/support/whatsNew.ts`, which compared About with the in-app
// release notes; those were removed in 2026-10.)

/** the app version, from the one file a release raises it in. Read, never
 *  typed: a number written into a test restates the bump instead of checking it */
export const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version

/** said wherever a version on screen is compared with `package.json` */
export const VERSION_IS_READ_ONCE =
  'A dev server reads the version once, when it starts: one left running across a version change keeps the old number. Restart it.'

/** the version line of an OPEN About dialog: `v0.15.0 · build 61ca4a0` */
export async function readAboutVersion(page: Page): Promise<{ version: string; build: string }> {
  const line = (await page.locator('.mcdlg--about .about__version').innerText()).trim()
  const m = /^v(\d+\.\d+\.\d+)(?: · build (\S+))?$/.exec(line)
  expect(m, `the About dialog's version line reads "${line}"`).not.toBeNull()
  return { version: m![1]!, build: m![2] ?? '' }
}

/** About shows the version in `package.json`. */
export function expectAboutIsPackageVersion(about: string): void {
  expect(about, `About shows v${about} and package.json says ${PACKAGE_VERSION}. ${VERSION_IS_READ_ONCE}`).toBe(PACKAGE_VERSION)
}
