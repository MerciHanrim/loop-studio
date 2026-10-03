import { expect, test, type Page } from '@playwright/test'

// Issue #297, step 1 — browser storage has ONE door: the run-time half.
//
// `npm run check:storage-port` reads the source text, so it cannot see a name
// assembled at run time (`window['local' + 'Storage']`) or a call made from a
// dependency. This spec closes that gap from the other side: it traps the
// browser's storage APIs BEFORE any product code runs, records the call stack
// of every use, and requires each one to pass through
// `src/storage/storagePort.ts` — on every path that touches storage: start-up,
// autosave, a preference, deleting, restoring after a reload, and restoring
// from a share link.
//
// It uses the bare Playwright `test`, not the shared fixture: the fixture
// pre-dismisses the guided tour by writing to `localStorage` itself, which is
// exactly the kind of direct call this spec exists to catch.

type Call = { api: string; op: string; key: string | null; viaPort: boolean; viaBoot: boolean; stack: string }
type Phased = Call & { phase: string }
type Trapped = { __storageCalls: Call[] }

const PORT_FILE = '/src/storage/storagePort.ts'
// issue #302 - the port's second door: the classic script inlined into <head>,
// which reads the theme before the first paint. Its stack frames name the
// document itself, never a module, and it may only read this one key.
const THEME = 'loop-studio:theme'
const GRAPH = 'loop-studio:graph:v1'
const AUTHOR = 'loop-studio:author'
const TOUR = 'loop-studio/guided-tour/1'
const LOCK = 'loop-studio:canvas-locked'
const ANNOUNCED = 'loop-studio/whats-new/announced/1'
const OPENED = 'loop-studio/whats-new/opened/1'

/** Install the trap for every document this page loads, and keep the page on
 *  the local dev server: a generated share link names the PUBLIC address, and
 *  no request may leave for it. */
async function trap(page: Page, baseURL: string): Promise<void> {
  const origin = new URL(baseURL).origin
  await page.route(
    (url) => /^https?:$/.test(url.protocol) && url.origin !== origin,
    (route) => route.abort(),
  )
  await page.addInitScript((portFile) => {
    const calls: Call[] = []
    ;(window as unknown as Trapped).__storageCalls = calls
    const note = (api: string, op: string, key: string | null) => {
      const stack = String(new Error('storage call').stack)
      const frames = stack.split('\n').slice(2)
      // a frame from a module (dev: /src/..., /node_modules/...; build: /assets/...)
      const fromModule = frames.some((f) => /\/(src|node_modules|assets)\//.test(f))
      const viaBoot = !fromModule && api === 'localStorage' && op === 'getItem' && key === 'loop-studio:theme' && document.querySelector('script[data-storage-boot="theme"]') !== null
      calls.push({ api, op, key, viaPort: stack.includes(portFile), viaBoot, stack: frames.slice(0, 5).join(' | ') })
    }
    const proto = Storage.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
    for (const op of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
      const orig = proto[op]
      proto[op] = function (this: Storage, ...a: unknown[]) {
        note(this === window.sessionStorage ? 'sessionStorage' : 'localStorage', op, a.length ? String(a[0]) : null)
        return orig.apply(this, a)
      }
    }
    const idb = IDBFactory.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
    const open = idb.open
    idb.open = function (this: IDBFactory, ...a: unknown[]) {
      note('indexedDB', 'open', String(a[0]))
      return open.apply(this, a)
    }
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
    if (cookie?.get && cookie.set) {
      const { get, set } = cookie
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        get(this: Document) {
          note('cookie', 'get', null)
          return get.call(this)
        },
        set(this: Document, v: string) {
          note('cookie', 'set', null)
          set.call(this, v)
        },
      })
    }
  }, PORT_FILE)
}

const peek = (page: Page) => page.evaluate(() => (window as unknown as Trapped).__storageCalls)
/** wait until the page has made a call matching `op` + `key` */
const seen = (page: Page, op: string, key: string) =>
  expect.poll(async () => (await peek(page)).some((c) => c.op === op && c.key === key), { message: `${op} ${key}` }).toBe(true)

async function boot(page: Page, url = '/'): Promise<void> {
  await page.goto(url)
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas')).toBeVisible()
}

const fileMenu = (page: Page) => page.locator('.toolbar__actions .menu > button', { hasText: /^File ▾$/ })
async function authorDialog(page: Page) {
  await fileMenu(page).click()
  await page
    .locator('.toolbar__actions .menu__pop [role="menuitem"]')
    .filter({ has: page.locator('.menu__name', { hasText: /author/i }) })
    .click()
  return page.locator('.mcdlg--confirm')
}

test.describe('browser storage is reached through the port only (run time)', () => {
  test('start-up, autosave, a preference, deleting, a reload and a share link all pass through storagePort', async ({
    page,
    baseURL,
  }) => {
    await trap(page, baseURL!)
    const all: Phased[] = []
    /** move what the page recorded so far into `all`, under a phase name */
    const take = async (phase: string) => {
      const got = await page.evaluate(() => (window as unknown as Trapped).__storageCalls.splice(0))
      all.push(...got.map((c) => ({ ...c, phase })))
    }
    const inPhase = (phase: string, op: string, key: string) =>
      all.filter((c) => c.phase === phase && c.op === op && c.key === key).length

    // 1. start-up of a new profile: every store reads its key, and the default
    //    document is saved with no action
    await boot(page)
    await seen(page, 'setItem', GRAPH)
    await take('start-up')
    expect(inPhase('start-up', 'getItem', GRAPH)).toBeGreaterThan(0)
    expect(inPhase('start-up', 'setItem', GRAPH)).toBeGreaterThan(0)
    // issue #296 - a first visit records the newest release note as its baseline,
    // once and with no action, and that write goes through the port like the rest
    expect(inPhase('start-up', 'getItem', ANNOUNCED)).toBeGreaterThan(0)
    expect(inPhase('start-up', 'getItem', OPENED)).toBeGreaterThan(0)
    expect(inPhase('start-up', 'setItem', ANNOUNCED)).toBe(1)
    expect(inPhase('start-up', 'setItem', OPENED)).toBe(0)
    // issue #302 - the theme is read twice at start-up: once by the boot door
    // in <head>, before any module, and once by the module door; nothing else
    // ever comes through the boot door
    const bootReads = all.filter((c) => c.viaBoot)
    expect(bootReads.map((c) => [c.phase, c.op, c.key])).toEqual([['start-up', 'getItem', THEME]])
    expect(all.findIndex((c) => c.viaBoot), 'the boot read is the first storage call of all').toBe(0)
    // exactly three readers, by name: the boot door in <head>, the returning-
    // profile check of the update notice (the theme key is one of the traces
    // it looks for), and the module door, `applyStoredTheme()` in main.tsx.
    // MEASURED with the module door removed: two reads, and the page still
    // opened in the stored theme thanks to the boot door - so the count is
    // pinned, or that door could vanish unnoticed.
    expect(inPhase('start-up', 'getItem', THEME)).toBe(3)

    // 2. onboarding and a preference
    await page.getByRole('button', { name: 'Skip' }).first().click()
    await seen(page, 'setItem', TOUR)
    const lock = page.locator('.react-flow__controls-button.rf-lock')
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'true')
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'false')
    await take('preference')
    expect(inPhase('preference', 'setItem', LOCK)).toBe(2)

    // 3. autosave: an edit (the example spreadsheet) is written without a save action
    await page.getByRole('button', { name: 'Data ▾' }).click()
    await page.getByRole('menuitem').first().click()
    const imp = page.locator('.mcdlg--dataimport')
    await imp.getByRole('button', { name: 'Use this example' }).click()
    await imp.getByRole('button', { name: 'Next' }).click()
    await imp.getByRole('button', { name: 'Next' }).click()
    await imp.getByRole('button', { name: 'Import' }).click()
    await expect(imp).toBeHidden()
    await expect(page.locator('body')).toContainText('Steel Sword')
    await seen(page, 'setItem', GRAPH)
    await take('autosave')

    // the share link of that document, read from the dialog - never opened as given
    await page.locator('.toolbar__actions button.btn', { hasText: /^Share$/ }).click()
    const disclose = page.locator('.mcdlg--confirm .mcdlg__foot .btn').last()
    if (await disclose.count()) await disclose.click()
    const field = page.locator('.share-pop__url')
    await expect(field).toBeVisible()
    const hash = new URL(await field.inputValue()).hash
    expect(hash.startsWith('#g1=')).toBe(true)
    await page.keyboard.press('Escape')

    // 4. deleting: the author record is removed, and File > New drops the document
    let dlg = await authorDialog(page)
    await dlg.locator('.review__field input').fill('Test Person')
    await dlg.locator('.mcdlg__foot .btn').last().click()
    await seen(page, 'setItem', AUTHOR)
    dlg = await authorDialog(page)
    await dlg.locator('.review__field input').fill('')
    await dlg.locator('.mcdlg__foot .btn').last().click()
    await seen(page, 'removeItem', AUTHOR)
    await take('author')
    await fileMenu(page).click()
    await page.getByRole('menuitem', { name: 'New' }).click()
    const sure = page.locator('.mcdlg--confirm')
    if (await sure.count()) await sure.locator('.mcdlg__foot .btn').last().click()
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await seen(page, 'setItem', GRAPH)
    await take('delete')

    // 5. restore: a reload reads the stored document back
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await seen(page, 'getItem', GRAPH)
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await take('restore')

    // 6. share restore: the link, pointed at THIS server, loads the document
    //    and the autosave stores it
    //    (the stored document is no longer the untouched sample, so the loader
    //    asks before replacing it - a native confirm, accepted here)
    let asked = 0
    page.on('dialog', (d) => {
      asked++
      void d.accept()
    })
    await page.goto('about:blank')
    await boot(page, '/' + hash)
    await expect(page.locator('body')).toContainText('Steel Sword')
    expect(asked).toBe(1)
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('')
    await seen(page, 'setItem', GRAPH)
    await take('share restore')

    // every path above was really seen by the trap ...
    for (const phase of ['start-up', 'preference', 'autosave', 'author', 'delete', 'restore', 'share restore'])
      expect(all.filter((c) => c.phase === phase).length, phase).toBeGreaterThan(0)
    expect([...new Set(all.map((c) => c.op))].sort()).toEqual(['getItem', 'removeItem', 'setItem'])
    // ... it was only ever localStorage, and every call went through the port
    expect([...new Set(all.map((c) => c.api))]).toEqual(['localStorage'])
    expect(all.filter((c) => !c.viaPort && !c.viaBoot)).toEqual([])
  })

  test('the trap itself sees what the source check cannot: a name assembled at run time', async ({ page, baseURL }) => {
    await trap(page, baseURL!)
    await boot(page)
    await expect.poll(async () => (await peek(page)).length).toBeGreaterThan(0)
    const before = (await peek(page)).length

    await page.evaluate(() => {
      const w = window as unknown as Record<string, Storage>
      w['local' + 'Storage'].getItem('zz-bypass-probe')
      w['session' + 'Storage'].getItem('zz-bypass-probe')
    })

    const added = (await peek(page)).slice(before).filter((c) => c.key === 'zz-bypass-probe')
    expect(added.map((c) => [c.api, c.op, c.viaPort])).toEqual([
      ['localStorage', 'getItem', false],
      ['sessionStorage', 'getItem', false],
    ])
  })
})
