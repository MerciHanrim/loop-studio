import type { Page } from '@playwright/test'
import { THEME_COLOR } from '../src/theme/theme'
import { expect, openApp, test } from './support/loop'

// The browser's own chrome colour (`<meta name="theme-color">`, the address bar
// and the task switcher) follows the theme the person chose (2026-10, the
// workbench tokens). index.html carries one meta per `prefers-color-scheme`,
// which follows the SYSTEM only; an explicit Light or Dark choice rewrites both
// to that theme's colour (`syncThemeColor` in src/theme/theme.ts), System puts
// each back, and a stored choice is applied before the first paint by the head
// script (src/storage/themeBoot.js).

const metas = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => ({ media: m.media, content: m.content })),
  )
const byScheme = async (page: Page) => {
  const all = await metas(page)
  expect(all, 'one meta per scheme').toHaveLength(2)
  return {
    light: all.find((m) => m.media.includes('light'))!.content,
    dark: all.find((m) => m.media.includes('dark'))!.content,
  }
}
const hex = (rgb: string) =>
  '#' +
  rgb
    .match(/\d+/g)!
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')

async function chooseTheme(page: Page, label: 'Auto' | 'Light' | 'Dark') {
  await page.locator('.wb-viewmenu > .wb-mb').click()
  await page.locator('.theme-menu > button').click()
  await page.locator('.theme-menu__pop [role="menuitemradio"]', { hasText: new RegExp(`^${label}$`) }).click()
  await page.keyboard.press('Escape')
}

test('THEME_COLOR is the stylesheet’s --bg-app in each theme', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await openApp(page)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(hex(bg), `${scheme}: the page ground`).toBe(THEME_COLOR[scheme])
  }
})

test('System keeps one colour per scheme; Light and Dark rewrite both; System puts them back', async ({ page }) => {
  await openApp(page)
  expect(await byScheme(page)).toEqual({ light: THEME_COLOR.light, dark: THEME_COLOR.dark })

  await chooseTheme(page, 'Dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await byScheme(page), 'Dark: the address bar is dark whatever the system says').toEqual({ light: THEME_COLOR.dark, dark: THEME_COLOR.dark })

  await chooseTheme(page, 'Light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await byScheme(page)).toEqual({ light: THEME_COLOR.light, dark: THEME_COLOR.light })

  await chooseTheme(page, 'Auto')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  expect(await byScheme(page), 'System: each meta follows its own scheme again').toEqual({ light: THEME_COLOR.light, dark: THEME_COLOR.dark })
})

// The storage gate ("Before you open Loop Studio") is drawn before anything
// stored is read (issue #297), so it is in the SYSTEM theme — a stored choice
// is one person's setting and is applied only once the profile says it is
// personal. Its first frame is in that theme even before the stylesheet
// arrives (the inline ground in index.html), and its card is the new theme's.
test.describe('the storage gate', () => {
  test.use({ storageMode: 'gate' })
  const firstGround = (page: Page) =>
    page.addInitScript(() => {
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive' && !(window as unknown as { __bg?: string }).__bg) {
          ;(window as unknown as { __bg?: string }).__bg = getComputedStyle(document.documentElement).backgroundColor
        }
      })
    })

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme} system: the gate is in that theme from its first frame`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await firstGround(page)
      await page.goto('/')
      await expect(page.locator('.gate__card')).toBeVisible()
      const early = await page.evaluate(() => (window as unknown as { __bg?: string }).__bg)
      expect(hex(early!), 'the ground before any module ran').toBe(THEME_COLOR[scheme])
      const seen = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement)
        return {
          body: getComputedStyle(document.body).backgroundColor,
          card: getComputedStyle(document.querySelector('.gate__card')!).backgroundColor,
          panel: css.getPropertyValue('--bg-panel').trim(),
          scheme: css.colorScheme,
        }
      })
      expect(hex(seen.body)).toBe(THEME_COLOR[scheme])
      expect(hex(seen.card), 'the card is the theme’s panel').toBe(seen.panel)
      expect(seen.scheme, 'native controls (the checkboxes) follow the theme').toContain(scheme)
    })
  }

  test('a stored Dark choice in a profile that has not answered is not applied: the gate stays in the system theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio:theme', 'dark')
      } catch {
        /* opaque origin */
      }
    })
    await page.goto('/')
    await expect(page.locator('.gate__card')).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
    expect(hex(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))).toBe(THEME_COLOR.light)
  })

  test('answering "personal browser" applies the stored choice; the gate before it stays in the system theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('__seeded')) {
          sessionStorage.setItem('__seeded', '1')
          localStorage.setItem('loop-studio:theme', 'dark')
        }
      } catch {
        /* opaque origin */
      }
    })
    await page.goto('/')
    await expect(page.locator('.gate__card')).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
    await page.locator('[data-gate-choice="personal"] .gate__btn').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor).then(hex)).toBe(THEME_COLOR.dark)
    expect(await byScheme(page), 'and the address bar with it').toEqual({ light: THEME_COLOR.dark, dark: THEME_COLOR.dark })
  })
})

test('a personal profile’s explicit choice wins over the system from the first frame', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('loop-studio:theme', 'light'))
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' && !(window as unknown as { __bg?: string }).__bg) {
        ;(window as unknown as { __bg?: string }).__bg = getComputedStyle(document.documentElement).backgroundColor
      }
    })
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const early = await page.evaluate(() => (window as unknown as { __bg?: string }).__bg)
  expect(hex(early!), 'light at the first frame in a dark system').toBe(THEME_COLOR.light)
})

test('a stored Dark choice sets the colour before any module runs', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('loop-studio:theme', 'dark'))
  // read the metas the moment the head has been parsed, before the bundle runs
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' && !(window as unknown as { __tc?: string[] }).__tc) {
        ;(window as unknown as { __tc?: string[] }).__tc = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)
      }
    })
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const early = await page.evaluate(() => (window as unknown as { __tc?: string[] }).__tc)
  expect(early, 'set by the head script').toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
  expect(await byScheme(page)).toEqual({ light: THEME_COLOR.dark, dark: THEME_COLOR.dark })
})
