import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import type { CDPSession, Page } from '@playwright/test'
import { expect, openApp, resetAll, test, waitForAppReady } from './support/loop'

// #613 item 5 — an Escape typed while an input method is composing belongs to
// the composition (it cancels or ends it); the dialog's own Escape (useDialogFocus)
// closed the dialog on that same key. On the protected-link prompt that threw away
// the link, which is already gone from the address. The composition is real
// (Chromium's `Input.imeSetComposition`), so the keydown carries
// `isComposing: true` as a browser sends it. Controls: once the composition is
// committed, Escape closes the dialog as before.

const PASSWORD = 'e2e protected link 42' // never a real one
/** loop-share-protected/1, written with node:crypto and node:zlib only (as e2e/share-protected.spec.ts) */
function nodeSeal(text: string, password: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = pbkdf2Sync(Buffer.from(password.normalize('NFC'), 'utf8'), salt, 600000, 32, 'sha256')
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  c.setAAD(Buffer.from('loop-share-protected/1', 'utf8'))
  const ct = Buffer.concat([c.update(deflateSync(Buffer.from(text, 'utf8'))), c.final()])
  return Buffer.concat([salt, iv, ct, c.getAuthTag()]).toString('base64url')
}
const DOC = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [{ id: 'p', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 1, mode: 'pullAny' } }], edges: [] })

/** start a real composition in the focused field, then press Escape as a key */
async function composeThenEscape(cdp: CDPSession): Promise<void> {
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
}
/** the keydowns the page saw, with their composing flag (to assert the composing path is taken) */
async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __keys: { key: string; isComposing: boolean }[] }
    w.__keys = []
    window.addEventListener('keydown', (e) => w.__keys.push({ key: e.key, isComposing: e.isComposing }), true)
  })
}
const keys = (page: Page) => page.evaluate(() => (window as unknown as { __keys: { key: string; isComposing: boolean }[] }).__keys)

test.describe('an Escape inside an input-method composition does not close the dialog (#613 item 5)', () => {
  test('the data import wizard stays open; after the composition, Escape closes it', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.getByRole('button', { name: 'Data' }).click()
    await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
    const wizard = page.getByRole('dialog', { name: 'Import spreadsheet data' })
    await expect(wizard).toBeVisible()
    const name = wizard.getByLabel('Table name')
    await name.focus()
    await recordKeys(page)
    const cdp = await page.context().newCDPSession(page)

    await composeThenEscape(cdp)
    expect(await keys(page)).toEqual([{ key: 'Escape', isComposing: true }])
    await page.waitForTimeout(300) // room for a close that should not come
    await expect(wizard).toBeVisible()

    // control: the composition committed, a plain Escape closes the wizard
    await cdp.send('Input.insertText', { text: '한' })
    await page.keyboard.press('Escape')
    await expect(wizard).toBeHidden()
  })

  test('the protected-link prompt stays open, so the link is not lost; after the composition, Escape cancels as before', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.goto('about:blank')
    await page.goto('/#p1=' + nodeSeal(DOC, PASSWORD))
    await waitForAppReady(page)
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    const prompt = page.locator('[data-protected-open="prompt"]')
    await expect(prompt).toBeVisible()
    const password = page.locator('[data-protected-open="password"]')
    await password.focus()
    await recordKeys(page)
    const cdp = await page.context().newCDPSession(page)

    await composeThenEscape(cdp)
    expect(await keys(page)).toEqual([{ key: 'Escape', isComposing: true }])
    await page.waitForTimeout(300)
    await expect(prompt).toBeVisible()

    // control: the composition committed, a plain Escape cancels the prompt as before
    await cdp.send('Input.insertText', { text: '한' })
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveCount(0)
  })
})
