import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { expect, openApp, resetAll, seedPersonalBrowser, test } from './support/loop'

// SEMANTICS-P.md loop-share-protected/1 (issue #300) — a share link protected
// with a password, through the real UI: the choice in the share dialog, the
// `#p1=` link, and the prompt it opens with.
//
// The unit tests pin the sealed transport against an independent
// implementation. This spec repeats that once in a real browser (a link sealed
// here with node:crypto opens in the app), and otherwise checks what only a
// browser can show: what is on screen before the password, what stays in the
// address bar, what reaches the clipboard and storage, and the order of the
// dialogs.

type Bridge = {
  __loop: Record<string, { getState: () => any } & Record<string, unknown>> & {
    autosave: { flush: () => void }
  }
}

const PASSWORD = 'e2e protected link 42' // never a real one
const SHARE_BASE = 'https://cozy-loop-studio.pages.dev/'
const WORK_KEY = 'loop-studio:graph:v1'

/** loop-share-protected/1, written with node:crypto and node:zlib only */
function nodeSeal(text: string, password: string, plain?: Buffer): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = pbkdf2Sync(Buffer.from(password.normalize('NFC'), 'utf8'), salt, 600000, 32, 'sha256')
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  c.setAAD(Buffer.from('loop-share-protected/1', 'utf8'))
  const ct = Buffer.concat([c.update(plain ?? deflateSync(Buffer.from(text, 'utf8'))), c.final()])
  return Buffer.concat([salt, iv, ct, c.getAuthTag()]).toString('base64url')
}

async function stubClipboard(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    ;(window as any).__clipWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void (window as any).__clipWrites.push(t) },
    })
  })
}
const clipWrites = (page: Page) => page.evaluate(() => (window as any).__clipWrites as string[])

/** count key derivations, from before any page script runs */
async function countDerivations(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    ;(window as any).__derives = 0
    if (!crypto.subtle) return // `about:blank` is not a secure context
    const real = crypto.subtle.deriveKey.bind(crypto.subtle)
    crypto.subtle.deriveKey = ((...a: Parameters<SubtleCrypto['deriveKey']>) => {
      ;(window as any).__derives++
      return real(...a)
    }) as SubtleCrypto['deriveKey']
  })
}

/** a real cross-document load (a hash-only `goto` is same-document, and a link
 *  is consumed at boot only) */
async function freshGoto(page: Page, url: string): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as any).__loop))
}

const shareBtn = (page: Page) => page.locator('.toolbar__actions button', { hasText: /^Share$/ })
const createDialog = (page: Page) => page.locator('.mcdlg--share[data-share-create]')
const field = (page: Page, name: string) => page.locator(`[data-share-protect="${name}"]`)
const prompt = (page: Page) => page.locator('[data-protected-open="prompt"]')
const promptPart = (page: Page, name: string) => page.locator(`[data-protected-open="${name}"]`)
const notice = (page: Page) => page.locator('[data-protected-open="notice"]')
const hashOf = (page: Page) => page.evaluate(() => location.hash)

/** Source "α ⚙" ─3→ Pool "β 보물" - labels that exist nowhere else in the app */
async function seedGraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 240, y: 0 })
    const [s, p] = (window as unknown as Bridge).__loop.graph.getState().nodes
    const gs = (window as unknown as Bridge).__loop.graph.getState()
    gs.updateNodeData(s.id, { label: 'α ⚙' })
    gs.updateNodeData(p.id, { label: 'β 보물' })
    gs.onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  })
}
const labelsOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.map((n: any) => n.data.label).sort())
const revOf = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().simulationRev as number)

/** Share → tick the box → fill both fields → Create link; returns the link */
async function createProtected(page: Page, password = PASSWORD): Promise<string> {
  await shareBtn(page).click()
  await expect(createDialog(page)).toBeVisible()
  await field(page, 'option').check()
  await field(page, 'password').fill(password)
  await field(page, 'confirm').fill(password)
  await createDialog(page).getByRole('button', { name: 'Create link' }).click()
  const url = page.locator('.share-pop__url')
  await expect(url).toBeVisible()
  return url.inputValue()
}

/** make a protected link of the seeded graph in a profile of its own */
async function linkFromAnotherProfile(browser: Browser): Promise<{ hash: string; json: string }> {
  const ctx = await browser.newContext()
  await seedPersonalBrowser(ctx)
  await stubClipboard(ctx)
  const page = await ctx.newPage()
  await openApp(page)
  await seedGraph(page)
  const json = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON() as string)
  const url = await createProtected(page)
  await ctx.close()
  return { hash: url.slice(url.indexOf('#')), json }
}

/** forget what this profile stored, so the next boot is the untouched sample */
async function forgetStoredWork(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as Bridge).__loop.autosave.flush()
    localStorage.clear()
  })
}

async function typeAndOpen(page: Page, password: string): Promise<void> {
  await promptPart(page, 'password').fill(password)
  await prompt(page).getByRole('button', { name: 'Open' }).click()
}

test.describe('creating a link', () => {
  test.beforeEach(async ({ page }) => {
    await stubClipboard(page)
    await openApp(page)
    await resetAll(page)
  })

  test('the plain link is the default: the box is unticked, focus starts on Cancel, and the link is a g1 link', async ({ page }) => {
    await shareBtn(page).click()
    await expect(createDialog(page)).toHaveAttribute('data-share-create', 'plain')
    await expect(field(page, 'option')).not.toBeChecked()
    await expect(createDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused()
    await expect(field(page, 'password')).toHaveCount(0)
    await createDialog(page).getByRole('button', { name: 'Create link' }).click()
    const url = await page.locator('.share-pop__url').inputValue()
    expect(url.startsWith(SHARE_BASE + '#g1=')).toBe(true)
    await expect(page.locator('[data-share-protected="note"]')).toHaveCount(0)
  })

  test('the rule and a mismatch are said inside the dialog; nothing is created, and closing forgets everything', async ({ page }) => {
    await shareBtn(page).click()
    await field(page, 'option').check()
    await expect(field(page, 'password')).toBeFocused()
    await expect(field(page, 'password')).toHaveAttribute('autocomplete', 'new-password')
    await expect(field(page, 'confirm')).toHaveAttribute('autocomplete', 'new-password')

    await field(page, 'password').fill('eleven char')
    await field(page, 'confirm').fill('eleven char')
    await createDialog(page).getByRole('button', { name: 'Create link' }).click()
    await expect(field(page, 'problem')).toHaveText('The password needs at least 12 characters.')

    await field(page, 'password').fill(PASSWORD)
    await field(page, 'confirm').fill(PASSWORD + '!')
    await createDialog(page).getByRole('button', { name: 'Create link' }).click()
    await expect(field(page, 'problem')).toHaveText('The two passwords are not the same.')
    await expect(field(page, 'problem')).toHaveAttribute('role', 'alert')

    expect(await clipWrites(page)).toEqual([])
    await expect(page.locator('.share-pop')).toHaveCount(0)

    await createDialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(createDialog(page)).toHaveCount(0)
    await shareBtn(page).click()
    await expect(field(page, 'option')).not.toBeChecked()
    await expect(field(page, 'problem')).toHaveCount(0)
  })

  test('a protected link: `#p1=` on the public base, the LINK copied, the address bar untouched, the password nowhere', async ({ page }) => {
    const before = await page.evaluate(() => location.href)
    const url = await createProtected(page)
    expect(url).toMatch(/^https:\/\/cozy-loop-studio\.pages\.dev\/#p1=[A-Za-z0-9_-]{60,8192}$/)
    expect(await clipWrites(page)).toEqual([url])
    await expect(page.locator('[data-share-protected="note"]')).toHaveText('This link is protected with a password. Send the password separately.')
    expect(await page.evaluate(() => location.href)).toBe(before)
    await expect(createDialog(page)).toHaveCount(0)

    const leaks = await page.evaluate((pw) => {
      const hit: string[] = []
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i)!
          if ((store.getItem(k) ?? '').includes(pw) || k.includes(pw)) hit.push('storage:' + k)
        }
      }
      if (location.href.includes(pw)) hit.push('location')
      if (document.cookie.includes(pw)) hit.push('cookie')
      for (const [name, s] of Object.entries((window as unknown as Bridge).__loop)) {
        if (typeof (s as { getState?: unknown }).getState !== 'function') continue
        let text = ''
        try {
          text = JSON.stringify((s as { getState: () => unknown }).getState())
        } catch {
          text = ''
        }
        if (text.includes(pw)) hit.push('store:' + name)
      }
      return hit
    }, PASSWORD)
    expect(leaks).toEqual([])
    expect(url).not.toContain(encodeURIComponent(PASSWORD))
  })

  test('over the size cap while protecting: said inside the dialog, no alert, nothing copied', async ({ page }) => {
    const alerts: string[] = []
    page.on('dialog', (d) => {
      alerts.push(d.message())
      void d.dismiss()
    })
    await page.evaluate(() => {
      ;(window as unknown as { __shareMaxBytes: number }).__shareMaxBytes = 100
    })
    await shareBtn(page).click()
    await field(page, 'option').check()
    await field(page, 'password').fill(PASSWORD)
    await field(page, 'confirm').fill(PASSWORD)
    await createDialog(page).getByRole('button', { name: 'Create link' }).click()
    await expect(field(page, 'problem')).toContainText('too large for a share link')
    await expect(createDialog(page)).toBeVisible()
    expect(alerts).toEqual([])
    expect(await clipWrites(page)).toEqual([])
    await expect(page.locator('.share-pop')).toHaveCount(0)
  })
})

test.describe('creating without Web Crypto', () => {
  test('the choice is disabled and says why; the plain link still works', async ({ browser }) => {
    const ctx = await browser.newContext()
    await seedPersonalBrowser(ctx)
    await stubClipboard(ctx)
    await ctx.addInitScript(() => Object.defineProperty(Crypto.prototype, 'subtle', { configurable: true, get: () => undefined }))
    const page = await ctx.newPage()
    await openApp(page)
    await shareBtn(page).click()
    await expect(field(page, 'option')).toBeDisabled()
    await expect(field(page, 'unavailable')).toContainText('needs a current browser and a secure (HTTPS) address')
    await createDialog(page).getByRole('button', { name: 'Create link' }).click()
    expect((await page.locator('.share-pop__url').inputValue()).startsWith(SHARE_BASE + '#g1=')).toBe(true)
    await ctx.close()
  })
})

test.describe('opening a link', () => {
  let hash = ''
  let json = ''
  test.beforeAll(async ({ browser }) => {
    ;({ hash, json } = await linkFromAnotherProfile(browser))
  })

  test('nothing of the shared diagram exists before the password; a wrong one changes nothing; the right one loads it once', async ({ page }) => {
    await freshGoto(page, '/' + hash)
    await expect(prompt(page)).toBeVisible()
    expect(await hashOf(page)).toBe('') // the fragment is gone as soon as the bytes are in memory
    await expect(promptPart(page, 'password')).toBeFocused()
    await expect(promptPart(page, 'password')).toHaveAttribute('autocomplete', 'current-password')
    await expect(promptPart(page, 'storage-note')).toHaveText('Once opened, the diagram is kept in this browser like any other diagram.')
    await expect(prompt(page).getByRole('button', { name: 'Open' })).toBeDisabled()

    // nothing from the link: not in the document's own data, not in the accessibility tree
    const sample = await labelsOf(page)
    expect(sample).not.toContain('α ⚙')
    const tree = await page.locator('body').ariaSnapshot()
    expect(tree).not.toContain('α ⚙')
    expect(tree).not.toContain('β 보물')
    await expect(prompt(page)).not.toContainText(/node|byte|KB/i) // and nothing derived from the ciphertext

    const rev = await revOf(page)
    await typeAndOpen(page, 'not the password at all')
    await expect(promptPart(page, 'error')).toHaveText('The password is wrong, or the link is damaged. Check the password and try again.')
    await expect(promptPart(page, 'error')).toHaveAttribute('role', 'alert')
    // what was typed is kept, selected, and focused
    const input = await promptPart(page, 'password').evaluate((el: HTMLInputElement) => ({
      value: el.value,
      selected: el.selectionStart === 0 && el.selectionEnd === el.value.length,
      focused: document.activeElement === el,
    }))
    expect(input).toEqual({ value: 'not the password at all', selected: true, focused: true })
    expect(await labelsOf(page)).toEqual(sample)
    expect(await revOf(page)).toBe(rev)

    await typeAndOpen(page, PASSWORD)
    await expect(prompt(page)).toHaveCount(0)
    expect(await labelsOf(page)).toEqual(['α ⚙', 'β 보물'])
    expect(await revOf(page)).toBe(rev + 1) // exactly one load
  })

  test('a wrong password and a damaged link show the same text and write the same console line', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'warning' && m.text().startsWith('Loop Studio:')) warnings.push(m.text())
    })
    await freshGoto(page, '/' + hash)
    await typeAndOpen(page, 'not the password at all')
    const wrongText = await promptPart(page, 'error').innerText()
    const wrongLines = warnings.splice(0)

    // one character changed in the middle: still well-formed, no longer authentic
    const i = 4 + 70
    const damaged = hash.slice(0, i) + (hash[i] === 'A' ? 'B' : 'A') + hash.slice(i + 1)
    await freshGoto(page, '/' + damaged)
    await typeAndOpen(page, PASSWORD)
    const damagedText = await promptPart(page, 'error').innerText()

    expect(wrongLines).toHaveLength(1)
    expect(warnings).toEqual(wrongLines)
    expect(damagedText).toBe(wrongText)
    await expect(prompt(page)).toBeVisible() // the same state: a prompt that can be answered again
  })

  test('a broken link shows a notice with no password field and loses its fragment; an unknown version keeps it', async ({ page }) => {
    for (const broken of ['#p1=AAAA', '#p1', '#p1x', '#p1=' + 'A'.repeat(8193)]) {
      await freshGoto(page, '/' + broken)
      await expect(notice(page)).toHaveAttribute('data-notice', 'damaged')
      await expect(notice(page)).toHaveAttribute('role', 'alertdialog')
      await expect(promptPart(page, 'password')).toHaveCount(0)
      expect(await hashOf(page), broken.slice(0, 12)).toBe('')
    }
    await freshGoto(page, '/#p2=AAAABBBB')
    await expect(notice(page)).toHaveAttribute('data-notice', 'newer')
    await expect(notice(page)).toContainText('newer version of Loop Studio')
    expect(await hashOf(page)).toBe('#p2=AAAABBBB')
    await notice(page).getByRole('button', { name: 'Close' }).click()
    await expect(notice(page)).toHaveCount(0)
    expect(await hashOf(page)).toBe('#p2=AAAABBBB')
  })

  test('a modified session is asked before it is replaced: Cancel keeps it, OK replaces it', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().addNodeAt('drain', { x: 40, y: 40 }))
    const mine = await labelsOf(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.autosave.flush())

    const asked: string[] = []
    let answer = false
    page.on('dialog', (d) => {
      asked.push(d.message())
      void (answer ? d.accept() : d.dismiss())
    })
    await freshGoto(page, '/' + hash)
    await typeAndOpen(page, PASSWORD)
    await expect(prompt(page)).toHaveCount(0)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Open the shared diagram?')
    expect(await labelsOf(page)).toEqual(mine)

    answer = true
    await freshGoto(page, '/' + hash)
    await typeAndOpen(page, PASSWORD)
    await expect(prompt(page)).toHaveCount(0)
    expect(asked).toHaveLength(2)
    expect(await labelsOf(page)).toEqual(['α ⚙', 'β 보물'])
  })

  test('Escape cancels the prompt: the document is untouched and the link has to be opened again', async ({ page }) => {
    await freshGoto(page, '/' + hash)
    const sample = await labelsOf(page)
    await expect(prompt(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(prompt(page)).toHaveCount(0)
    expect(await labelsOf(page)).toEqual(sample)
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)
  })

  test('two fast submits derive one key', async ({ page }) => {
    await countDerivations(page)
    await freshGoto(page, '/' + hash)
    await promptPart(page, 'password').fill(PASSWORD)
    await prompt(page).getByRole('button', { name: 'Open' }).dblclick()
    await expect(prompt(page)).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__derives)).toBe(1)
  })

  test('a link sealed by an independent implementation opens; sealed content that is not a diagram is refused without a retry', async ({ page }) => {
    await freshGoto(page, '/#p1=' + nodeSeal(json, PASSWORD))
    await typeAndOpen(page, PASSWORD)
    await expect(prompt(page)).toHaveCount(0)
    expect(await labelsOf(page)).toEqual(['α ⚙', 'β 보물'])

    await forgetStoredWork(page)
    await freshGoto(page, '/#p1=' + nodeSeal('this is sealed correctly and is not a diagram', PASSWORD))
    const sample = await labelsOf(page) // the untouched first-boot sample again
    expect(sample).not.toContain('α ⚙')
    await typeAndOpen(page, PASSWORD)
    await expect(notice(page)).toHaveAttribute('data-notice', 'content')
    await expect(promptPart(page, 'password')).toHaveCount(0)
    expect(await labelsOf(page)).toEqual(sample)
  })

  test('without Web Crypto the link is not opened, the reason is shown, and the fragment stays', async ({ browser }) => {
    const ctx = await browser.newContext()
    await seedPersonalBrowser(ctx)
    await ctx.addInitScript(() => Object.defineProperty(Crypto.prototype, 'subtle', { configurable: true, get: () => undefined }))
    const page = await ctx.newPage()
    await freshGoto(page, '/' + hash)
    await expect(notice(page)).toHaveAttribute('data-notice', 'unavailable')
    await expect(notice(page)).toContainText('needs a current browser and a secure (HTTPS) address')
    expect(await hashOf(page)).toBe(hash)
    await ctx.close()
  })
})

test.describe('the first-run Welcome card', () => {
  test('waits behind the prompt and comes after it', async ({ browser }) => {
    const { hash } = await linkFromAnotherProfile(browser)
    // a remembered personal browser that has never seen the tour
    const ctx = await browser.newContext()
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio:storage-mode', 'personal')
      } catch {
        /* opaque origin */
      }
    })
    const page = await ctx.newPage()
    await freshGoto(page, '/' + hash)
    await expect(prompt(page)).toBeVisible()
    await page.waitForTimeout(2500) // the card is offered once the app settles; it must not settle yet
    await expect(page.locator('.tour-card')).toHaveCount(0)
    await typeAndOpen(page, PASSWORD)
    await expect(prompt(page)).toHaveCount(0)
    await expect(page.locator('.tour-card')).toBeVisible()
    await ctx.close()
  })
})

test.describe('with the storage gate (issue #297)', () => {
  test.use({ storageMode: 'gate' })

  test('the gate names the waiting link and keeps its fragment; a temporary session opens it and stores no document', async ({ page, browser }) => {
    const { hash } = await linkFromAnotherProfile(browser)
    await page.goto('about:blank')
    await page.goto('/' + hash)
    const gate = page.locator('.gate')
    await expect(gate).toBeVisible()
    await expect(page.locator('[data-gate-note="share-link"]')).toBeVisible()
    expect(await hashOf(page)).toBe(hash) // read and tidied by the app, after the gate
    await expect(prompt(page)).toHaveCount(0)

    await gate.locator('[data-gate-choice="temporary"]').locator('button').click()
    await expect(prompt(page)).toBeVisible()
    expect(await hashOf(page)).toBe('')
    await expect(promptPart(page, 'storage-note')).toHaveText('In this temporary session the opened diagram is not kept in this browser.')
    await typeAndOpen(page, PASSWORD)
    await expect(prompt(page)).toHaveCount(0)
    await page.waitForFunction(() => Boolean((window as any).__loop))
    expect(await labelsOf(page)).toEqual(['α ⚙', 'β 보물'])
    await page.evaluate(() => (window as unknown as Bridge).__loop.autosave.flush())
    const keys = await page.evaluate(() => Object.keys(localStorage))
    expect(keys).not.toContain(WORK_KEY)
    expect(keys.filter((k) => k.startsWith('loop-studio:graph'))).toEqual([])
  })
})
