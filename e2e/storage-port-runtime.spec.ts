import { expect, test, type Page } from '@playwright/test'

// Issue #297, step 1 — browser storage has ONE door: the run-time half.
//
// `npm run check:storage-port` reads the source text, so it cannot see a name
// assembled at run time (`window['local' + 'Storage']`) or a call made from a
// dependency. This spec closes that gap from the other side: it traps the
// browser's storage APIs BEFORE any product code runs, records the call stack
// of every use, and requires each one to pass through
// `src/storage/storagePort.ts`.
//
// It uses the bare Playwright `test`, not the shared fixture: the fixture
// pre-dismisses the guided tour by writing to `localStorage` itself, which is
// exactly the kind of direct call this spec exists to catch.

type Call = { api: string; op: string; key: string | null; viaPort: boolean; stack: string }
type Trapped = { __storageCalls: Call[] }

const PORT_FILE = '/src/storage/storagePort.ts'

async function trap(page: Page): Promise<void> {
  await page.addInitScript((portFile) => {
    const calls: Call[] = []
    ;(window as unknown as Trapped).__storageCalls = calls
    const note = (api: string, op: string, key: string | null) => {
      const stack = String(new Error('storage call').stack)
      calls.push({ api, op, key, viaPort: stack.includes(portFile), stack: stack.split('\n').slice(2, 7).join(' | ') })
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

const calls = (page: Page) => page.evaluate(() => (window as unknown as Trapped).__storageCalls)

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas')).toBeVisible()
}

test.describe('browser storage is reached through the port only (run time)', () => {
  test('every storage call the app makes passes through storagePort', async ({ page }) => {
    await trap(page)
    await boot(page)

    // a new profile: the stores read their keys at start-up and the default
    // document is saved without any action
    await expect
      .poll(async () => (await calls(page)).some((c) => c.op === 'setItem' && c.key === 'loop-studio:graph:v1'))
      .toBe(true)

    // onboarding, a preference and a reload - each a different caller
    await page.getByRole('button', { name: 'Skip' }).first().click()
    await expect
      .poll(async () => (await calls(page)).some((c) => c.op === 'setItem' && c.key === 'loop-studio/guided-tour/1'))
      .toBe(true)
    await page.locator('.react-flow__controls-button.rf-lock').click()
    await expect
      .poll(async () => (await calls(page)).some((c) => c.op === 'setItem' && c.key === 'loop-studio:canvas-locked'))
      .toBe(true)
    const firstLoad = await calls(page)

    await page.reload()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await expect
      .poll(async () => (await calls(page)).some((c) => c.op === 'getItem' && c.key === 'loop-studio:graph:v1'))
      .toBe(true)
    const all = [...firstLoad, ...(await calls(page))]

    // the trap is alive: reads and writes were seen, on the keys just exercised
    expect(all.filter((c) => c.op === 'getItem').length).toBeGreaterThan(0)
    expect(all.filter((c) => c.op === 'setItem').length).toBeGreaterThan(0)
    // only localStorage, and every call through the port
    expect([...new Set(all.map((c) => c.api))]).toEqual(['localStorage'])
    expect(all.filter((c) => !c.viaPort)).toEqual([])
  })

  test('the trap itself sees what the source check cannot: a name assembled at run time', async ({ page }) => {
    await trap(page)
    await boot(page)
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(0)
    const before = (await calls(page)).length

    await page.evaluate(() => {
      const w = window as unknown as Record<string, Storage>
      w['local' + 'Storage'].getItem('zz-bypass-probe')
      w['session' + 'Storage'].getItem('zz-bypass-probe')
    })

    const added = (await calls(page)).slice(before).filter((c) => c.key === 'zz-bypass-probe')
    expect(added.map((c) => [c.api, c.op, c.viaPort])).toEqual([
      ['localStorage', 'getItem', false],
      ['sessionStorage', 'getItem', false],
    ])
  })
})
