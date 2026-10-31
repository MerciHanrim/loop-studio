import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './support/loop'

// #420 item (3) — a diagram saved in this browser that the app cannot read.
// Before: the app booted the sample and the first write overwrote the original
// for good, with no sign it had been there. Rule (Lumi): a recovery screen
// before the app starts — Download the saved diagram (never deletes), Try again
// (re-reads in place), Continue in a temporary session (works in memory, the
// saved diagram untouched), Discard (only after its own confirmation); a
// storage that cannot be read at all gets a storage-error screen with Try again
// and the temporary session only. Until a choice, nothing overwrites the
// record: no autosave, no New / Template / import, no share link.

const WORK_KEY = 'loop-studio:graph:v1'
const MINE = { id: 'mine', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'My work', initial: 7 } }
const UNREADABLE: Record<string, string> = {
  'broken JSON': JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [MINE], edges: [] }).slice(0, 60),
  'a newer schema': JSON.stringify({ schema: 'loop-studio/graph/99', version: 1, nodes: [MINE], edges: [] }),
  'a node entry without a position': JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [{ id: 'mine', data: { kind: 'pool' } }], edges: [] }),
  'an empty value': '', // review round 1: the key exists — not "no record"
}
const READABLE = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [MINE], edges: [] })

/** put `text` into the work record once, before the first load of this page */
async function seedRecord(page: Page, text: string): Promise<void> {
  await page.addInitScript(
    ([k, v]) => {
      try {
        if (sessionStorage.getItem('__record_seeded')) return
        sessionStorage.setItem('__record_seeded', '1')
        localStorage.setItem(k, v)
      } catch {
        /* ignore */
      }
    },
    [WORK_KEY, text] as const,
  )
}
const record = (page: Page) => page.evaluate((k) => localStorage.getItem(k), WORK_KEY)
const screen = (page: Page) => page.locator('[data-recovery="unreadable"]')
const button = (page: Page, name: RegExp) => screen(page).getByRole('button', { name })

test.describe('#420 — an unreadable saved diagram', () => {
  for (const [name, text] of Object.entries(UNREADABLE)) {
    test(`${name}: the recovery screen, no app, and the record untouched by time, hiding and leaving`, async ({ page }) => {
      await seedRecord(page, text)
      await page.goto('/')
      await expect(screen(page)).toBeVisible()
      await expect(page.locator('.react-flow')).toHaveCount(0) // the app did not start
      await page.waitForTimeout(2000) // the autosave debounce is 400 ms: give any writer the chance
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('pagehide'))
      })
      expect(await record(page)).toBe(text)
    })
  }

  test('a share link in the address waits: not opened, not stripped, the record untouched', async ({ page }) => {
    const text = UNREADABLE['broken JSON']
    await seedRecord(page, text)
    await page.goto('/#g1=eJxLy0jNzMlXSE7MKVHIzEvLLy0BAEPPBv8')
    await expect(screen(page)).toBeVisible()
    await page.waitForTimeout(1000)
    expect(await page.evaluate(() => location.hash)).toMatch(/^#g1=/)
    expect(await record(page)).toBe(text)
  })

  test('Download the saved diagram: the file is the record byte for byte, and the record stays', async ({ page }) => {
    const text = UNREADABLE['a newer schema']
    await seedRecord(page, text)
    await page.goto('/')
    const [dl] = await Promise.all([page.waitForEvent('download'), button(page, /download/i).click()])
    expect(readFileSync((await dl.path())!, 'utf8')).toBe(text)
    await expect(screen(page)).toBeVisible()
    expect(await record(page)).toBe(text)
  })

  test('Try again re-reads in place: still unreadable keeps the screen; readable opens the app with it', async ({ page }) => {
    const text = UNREADABLE['broken JSON']
    await seedRecord(page, text)
    await page.goto('/')
    await button(page, /try again/i).click()
    await expect(screen(page)).toBeVisible()
    await expect(screen(page)).toContainText(/still/i)
    expect(await record(page)).toBe(text)
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [WORK_KEY, READABLE] as const)
    await button(page, /try again/i).click()
    await expect(screen(page)).toHaveCount(0)
    await expect(page.locator('.react-flow')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    const ids = await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string }[] } } } }).__loop.graph.getState().nodes.map((n) => n.id))
    expect(ids).toEqual(['mine'])
  })

  test('a newer schema says so and offers to reopen the app', async ({ page }) => {
    await seedRecord(page, UNREADABLE['a newer schema'])
    await page.goto('/')
    await expect(screen(page)).toContainText(/newer version/i)
    await expect(button(page, /reopen the app/i)).toBeVisible()
  })

  test('Discard asks first: Cancel keeps record and screen; Confirm removes it and starts the app', async ({ page }) => {
    const text = UNREADABLE['a node entry without a position']
    await seedRecord(page, text)
    await page.goto('/')
    const confirm = page.locator('.mcdlg--confirm')
    await button(page, /discard/i).click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: /^cancel$/i }).click()
    await expect(confirm).toHaveCount(0)
    await expect(screen(page)).toBeVisible()
    expect(await record(page)).toBe(text)
    await button(page, /discard/i).click()
    await confirm.getByRole('button', { name: /^discard$/i }).click()
    await expect(screen(page)).toHaveCount(0)
    await expect(page.locator('.react-flow')).toBeVisible()
    expect(await record(page)).not.toBe(text)
  })

  test('Discard re-reads first: a record that changed after the screen read it is not deleted, and the screen shows what is there now', async ({ page }) => {
    const shown = UNREADABLE['broken JSON']
    const now = UNREADABLE['a newer schema']
    await seedRecord(page, shown)
    await page.goto('/')
    await button(page, /discard/i).click()
    const confirm = page.locator('.mcdlg--confirm')
    await expect(confirm).toBeVisible()
    // another writer between the screen's read and the confirmation (same page:
    // no `storage` event, so only the re-read before removing can catch it)
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [WORK_KEY, now] as const)
    await confirm.getByRole('button', { name: /^discard$/i }).click()
    expect(await record(page)).toBe(now) // nothing deleted
    await expect(screen(page)).toBeVisible()
    await expect(screen(page).locator('[data-recovery-note="changed"]')).toBeVisible()
    await expect(screen(page).locator('[data-recovery-note="newer"]')).toBeVisible() // the screen is now about the newer record
  })

  test('another tab writing while the screen is open updates it; Download then gives what is stored now', async ({ page }) => {
    await seedRecord(page, UNREADABLE['broken JSON'])
    await page.goto('/')
    await expect(screen(page)).toBeVisible()
    const other = await page.context().newPage()
    await other.goto('about:blank')
    await other.goto(page.url())
    const newer = UNREADABLE['a newer schema']
    await other.evaluate(([k, v]) => localStorage.setItem(k, v), [WORK_KEY, newer] as const)
    await expect(screen(page).locator('[data-recovery-note="changed"]')).toBeVisible()
    const [dl] = await Promise.all([page.waitForEvent('download'), button(page, /download/i).click()])
    expect(readFileSync((await dl.path())!, 'utf8')).toBe(newer)
    await other.close()
  })

  test('Continue in a temporary session: the app works in memory, the saved record never changes, a share link opens in memory', async ({ page }) => {
    const text = UNREADABLE['broken JSON']
    await seedRecord(page, text)
    await page.goto('/#g1=eJxLy0jNzMlXSE7MKVHIzEvLLy0BAEPPBv8')
    await button(page, /temporary session/i).click()
    await expect(screen(page)).toHaveCount(0)
    await expect(page.locator('.react-flow')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { addNodeAt: (k: string, p: object) => void } } } }).__loop.graph.getState().addNodeAt('source', { x: 300, y: 0 }))
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    expect(await record(page)).toBe(text)
  })
})

test.describe('#420 — storage that cannot be read', () => {
  test('the storage-error screen offers Try again and a temporary session only; nothing to download or discard', async ({ page }) => {
    await page.addInitScript((k) => {
      const real = Storage.prototype.getItem
      Storage.prototype.getItem = function (key: string) {
        if (key === k && sessionStorage.getItem('__break_read') !== 'off') throw new Error('blocked')
        return real.call(this, key)
      }
    }, WORK_KEY)
    await page.goto('/')
    const err = page.locator('[data-recovery="storage-error"]')
    await expect(err).toBeVisible()
    await expect(err.getByRole('button', { name: /try again/i })).toBeVisible()
    await expect(err.getByRole('button', { name: /temporary session/i })).toBeVisible()
    await expect(err.getByRole('button', { name: /download|discard/i })).toHaveCount(0)
    await expect(page.locator('.react-flow')).toHaveCount(0)
  })
})
