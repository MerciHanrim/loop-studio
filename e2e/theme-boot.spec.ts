import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'

// Issue #302 — the stored theme at start-up.
//
// MEASURED before the change (main 16020f2; dev server, production build and
// portable file; desktop and mobile): with `dark` stored, a reload opened in the
// light theme, every painted frame was light, and `data-theme` appeared only
// when the Settings menu or the More sheet was opened. With the module applying
// the theme at start-up the attribute was right, but the browser had already
// painted: one light frame on a phone-sized window (first paint at 36 ms, the
// module at 67 ms) and two on a slow network (952 ms against 1,725 ms).
//
// The contract: the saved `light`, `dark` or `system` is applied before the
// first screen, without opening any menu; a value that is none of the three is
// `system`, safely; no frame is painted in the wrong theme; the storage key and
// its value are not changed by start-up.

const KEY = 'loop-studio:theme'
const attr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))

/** the stored value, and a record of the attribute at the first animation
 *  frame and of every change to it, from before the app starts */
async function seed(page: Page, stored: string | null) {
  await page.addInitScript(
    ({ key, stored }) => {
      // once per tab: an init script runs again on every reload, and a reload
      // must see what the app itself wrote since
      try {
        if (!sessionStorage.getItem('__theme_seeded')) {
          sessionStorage.setItem('__theme_seeded', '1')
          if (stored === null) localStorage.removeItem(key)
          else localStorage.setItem(key, stored)
        }
      } catch {
        /* ignore */
      }
      const w = window as unknown as { __theme: { firstFrame?: string | null; firstFrameAt?: number; changes: [number, string | null][] } }
      w.__theme = { changes: [] }
      new MutationObserver(() => {
        w.__theme.changes.push([Math.round(performance.now()), document.documentElement?.getAttribute('data-theme') ?? null])
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
      requestAnimationFrame(() => {
        w.__theme.firstFrame = document.documentElement.getAttribute('data-theme')
        w.__theme.firstFrameAt = Math.round(performance.now())
      })
    },
    { key: KEY, stored },
  )
}
const record = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __theme: { firstFrame?: string | null; firstFrameAt?: number; changes: [number, string | null][] } }
    const paint = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint')
    return { ...w.__theme, firstPaintAt: paint ? Math.round(paint.startTime) : null, stored: localStorage.getItem('loop-studio:theme') }
  })

const CASES: { stored: string | null; expected: 'dark' | 'light' | null }[] = [
  { stored: 'dark', expected: 'dark' },
  { stored: 'light', expected: 'light' },
  { stored: 'system', expected: null },
  { stored: 'bogus', expected: null },
  { stored: '', expected: null },
  { stored: null, expected: null },
]

for (const [name, width, height] of [
  ['desktop', 1280, 800],
  ['mobile', 390, 844],
] as const) {
  test.describe(`${name}: the stored theme is on before the first screen`, () => {
    for (const c of CASES) {
      test(`stored ${JSON.stringify(c.stored)} -> data-theme ${JSON.stringify(c.expected)}, at the first frame, with no menu opened`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        await seed(page, c.stored)
        await page.goto('/')
        await expect(page.locator('.canvas .react-flow')).toBeVisible()
        const r = await record(page)
        // the first frame the page ever had already carried the answer
        expect(r.firstFrame, 'at the first animation frame').toBe(c.expected)
        expect(await attr(page), 'after the app settled').toBe(c.expected)
        // the attribute never held another value on the way
        expect(r.changes.map(([, v]) => v).filter((v) => v !== c.expected)).toEqual([])
        // no menu or sheet is open
        await expect(page.locator('.menu__pop, .sheet')).toHaveCount(0)
        // start-up wrote nothing back: an unknown value stays as it was
        expect(r.stored).toBe(c.stored)
      })
    }
  })
}

test.describe('no frame is painted in the wrong theme', () => {
  // the browser's own screencast: every frame it painted, classified by the
  // luminance of nine sample points. This is pixels, not the attribute.
  async function paintedFrames(page: Page, go: () => Promise<void>) {
    const cdp = await page.context().newCDPSession(page)
    const frames: { at: number; data: string }[] = []
    cdp.on('Page.screencastFrame', (f) => {
      frames.push({ at: f.metadata.timestamp ?? 0, data: f.data })
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await cdp.send('Page.enable')
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 400, maxHeight: 400 })
    await go()
    await page.waitForTimeout(600)
    await cdp.send('Page.stopScreencast').catch(() => {})
    // the screencast also delivers the previous document (about:blank, white)
    // until the new one is painted: keep the frames from the new document's
    // first paint on. The epoch time of that paint comes from the page itself.
    const firstPaintEpoch = await page.evaluate(() => {
      const p = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint')
      return p ? (performance.timeOrigin + p.startTime) / 1000 : null
    })
    expect(firstPaintEpoch, 'the page reported its first paint').not.toBeNull()
    const own = frames.filter((f) => f.at >= firstPaintEpoch! - 0.02)
    expect(own.length, 'frames painted by the new document').toBeGreaterThan(0)
    const kinds: string[] = []
    for (const { data } of own) {
      const lum = await page.evaluate(async (src) => {
        const img = new Image()
        await new Promise((ok, bad) => {
          img.onload = ok
          img.onerror = bad
          img.src = src
        })
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const pts: number[] = []
        for (const fx of [0.1, 0.5, 0.9])
          for (const fy of [0.15, 0.5, 0.85]) {
            const [r, g, b] = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
            pts.push(0.2126 * r! + 0.7152 * g! + 0.0722 * b!)
          }
        return pts.reduce((a, b) => a + b, 0) / pts.length
      }, 'data:image/png;base64,' + data)
      // white is the blank page, not the light theme (whose ground is #f0efea, luminance 239)
      kinds.push(lum >= 254 ? 'blank' : lum > 140 ? 'light' : lum < 90 ? 'dark' : 'mixed')
    }
    return kinds
  }

  for (const [name, width, height] of [
    ['desktop', 1280, 800],
    ['mobile', 390, 844],
  ] as const) {
    test(`${name}, dark stored: every painted frame is dark`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await seed(page, 'dark')
      const kinds = await paintedFrames(page, async () => {
        await page.goto('/')
        await expect(page.locator('.canvas .react-flow')).toBeVisible()
      })
      expect(kinds.length).toBeGreaterThan(0)
      expect(kinds.filter((k) => k === 'light' || k === 'blank'), `frames: ${kinds.join(',')}`).toEqual([])
      expect(kinds.filter((k) => k === 'dark').length).toBeGreaterThan(0)
    })
  }

  test('mobile, dark stored, a slow network: still no light frame', async ({ page }) => {
    // the dev server serves hundreds of modules, so a throttled load takes a while
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page, 'dark')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    const kinds = await paintedFrames(page, async () => {
      await page.goto('/')
      await expect(page.locator('.canvas .react-flow')).toBeVisible({ timeout: 150_000 })
    })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.filter((k) => k === 'light' || k === 'blank'), `frames: ${kinds.join(',')}`).toEqual([])
    expect(kinds.filter((k) => k === 'dark').length).toBeGreaterThan(0)
  })
})

test.describe('choosing a theme still works, and the choice survives a reload', () => {
  test('desktop: Settings -> Dark, then a reload opens dark before any menu', async ({ page }) => {
    await seed(page, null)
    await page.goto('/')
    await expect(page.locator('.canvas .react-flow')).toBeVisible()
    expect(await attr(page)).toBeNull()
    await page.locator('.toolbar__actions .menu > button', { hasText: /^Settings$/ }).click()
    await page.getByRole('button', { name: /^Theme/ }).click()
    await page.getByRole('menuitemradio', { name: /Dark/ }).click()
    expect(await attr(page)).toBe('dark')
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:theme'))).toBe('dark')
    await page.reload()
    await expect(page.locator('.canvas .react-flow')).toBeVisible()
    const r = await record(page)
    expect(r.firstFrame).toBe('dark')
    expect(await attr(page)).toBe('dark')
    await expect(page.locator('.menu__pop')).toHaveCount(0)
  })

  test('the boot script is in the page once, in <head>, and is the file the check scans', async ({ page }) => {
    await page.goto('/')
    const info = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[data-storage-boot]')]
      return { count: scripts.length, inHead: scripts.every((s) => s.closest('head') !== null), classic: scripts.every((s) => !s.getAttribute('type')), text: scripts[0]?.textContent ?? '' }
    })
    expect(info.count).toBe(1)
    expect(info.inHead).toBe(true)
    expect(info.classic).toBe(true)
    expect(info.text).toContain("localStorage.getItem('loop-studio:theme')")
    expect(info.text).not.toMatch(/setItem|removeItem/)
  })
})
