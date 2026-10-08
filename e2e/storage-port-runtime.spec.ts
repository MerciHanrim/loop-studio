import { expect, test, type Page } from '@playwright/test'
import { waitForAppReady, watchPage } from './support/appReady'

// Issue #297 — browser storage has ONE door, and a gate in front of it: the
// run-time half.
//
// `npm run check:storage-port` reads the source text, so it cannot see a name
// assembled at run time (`window['local' + 'Storage']`), a call made from a
// dependency, or WHEN a call happens. This spec closes those gaps from the
// other side: it traps the browser's storage APIs BEFORE any product code
// runs, records the call stack of every use, and requires
//
//   - before the gate is answered: exactly two reads, both of the mode key
//     (the boot script in <head>, then the boot module through the port), and
//     nothing else - no document, no author, no theme, no language;
//   - in a personal browser: every call on every path (start-up, autosave, a
//     preference, deleting, restoring after a reload, restoring from a share
//     link) passes through `src/storage/storagePort.ts` or the boot door;
//   - in a temporary session: no call reaches `localStorage` at all, except
//     the one write of the mode key when the person asked for it, and the
//     browser's storage is byte for byte what it was before the session.
//
// It uses the bare Playwright `test`, not the shared fixture: the fixture
// answers the gate and pre-dismisses the guided tour by writing to
// `localStorage` itself, which is exactly the kind of direct call this spec
// exists to catch.

type Call = { api: string; op: string; key: string | null; viaPort: boolean; viaBoot: boolean; fromModule: boolean; stack: string }
type Phased = Call & { phase: string }
type Trapped = { __storageCalls: Call[] }

const PORT_FILE = '/src/storage/storagePort.ts'
const MODE = 'loop-studio:storage-mode'
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
  await page.addInitScript(
    ({ portFile, bootKeys }) => {
      const calls: Call[] = []
      ;(window as unknown as Trapped).__storageCalls = calls
      const note = (api: string, op: string, key: string | null) => {
        const stack = String(new Error('storage call').stack)
        const frames = stack.split('\n').slice(2)
        // a frame from a module (dev: /src/..., /node_modules/...; build: /assets/...)
        const fromModule = frames.some((f) => /\/(src|node_modules|assets)\//.test(f))
        // the boot door: the classic script in <head>, whose frames name the
        // document, never a module, and which runs while the document is still
        // being parsed - a harness read after load is not it
        const viaBoot =
          !fromModule &&
          document.readyState === 'loading' &&
          api === 'localStorage' &&
          op === 'getItem' &&
          key !== null &&
          bootKeys.includes(key) &&
          document.querySelector('script[data-storage-boot="theme"]') !== null
        calls.push({ api, op, key, viaPort: stack.includes(portFile), viaBoot, fromModule, stack: frames.slice(0, 5).join(' | ') })
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
    },
    { portFile: PORT_FILE, bootKeys: [MODE, THEME] },
  )
}

const peek = (page: Page) => page.evaluate(() => (window as unknown as Trapped).__storageCalls)
/** wait until the page has made a call matching `op` + `key` */
const seen = (page: Page, op: string, key: string) =>
  expect.poll(async () => (await peek(page)).some((c) => c.op === op && c.key === key), { message: `${op} ${key}` }).toBe(true)
/** every Loop Studio entry in the browser's storage, sorted, as the page sees it */
const stored = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('loop-studio'))
      .sort()
      .map((k) => [k, localStorage.getItem(k)] as [string, string | null]),
  )
const htmlState = (page: Page) =>
  page.evaluate(() => ({ lang: document.documentElement.lang, theme: document.documentElement.getAttribute('data-theme') }))

const gate = (page: Page) => page.locator('.gate')
async function answerGate(page: Page, mode: 'personal' | 'temporary', remember: boolean): Promise<void> {
  const choice = gate(page).locator(`[data-gate-choice="${mode}"]`)
  if (remember) await choice.locator('input[type="checkbox"]').check()
  await choice.locator('button').click()
  await expect(gate(page)).toHaveCount(0)
}
async function appUp(page: Page): Promise<void> {
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
}
/** skip the first-run Welcome card through the product's own action, whether
 *  it has been offered yet or not: the key is written through the port either
 *  way, and the scrim is gone */
async function skipTour(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __loop: { tour: { getState: () => { skipWelcome: () => void } } } }).__loop.tour.getState().skipWelcome())
  await expect(page.locator('.tour-scrim')).toHaveCount(0)
}

const fileMenu = (page: Page) => page.locator('.toolbar__actions .menu > button', { hasText: /^File$/ })
async function authorDialog(page: Page) {
  await fileMenu(page).click()
  await page
    .locator('.toolbar__actions .menu__pop [role="menuitem"]')
    .filter({ has: page.locator('.menu__name', { hasText: /author/i }) })
    .click()
  return page.locator('.mcdlg--confirm')
}
async function importExample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem').first().click()
  const imp = page.locator('.mcdlg--dataimport')
  await imp.getByRole('button', { name: 'Use this example' }).click()
  await imp.getByRole('button', { name: 'Next' }).click()
  await imp.getByRole('button', { name: 'Next' }).click()
  await imp.getByRole('button', { name: 'Import' }).click()
  await expect(imp).toBeHidden()
  await expect(page.locator('body')).toContainText('Steel Sword')
}

/** the calls recorded so far, moved into `all` under a phase name */
function phases() {
  const all: Phased[] = []
  const take = async (page: Page, phase: string) => {
    const got = await page.evaluate(() => (window as unknown as Trapped).__storageCalls.splice(0))
    all.push(...got.map((c) => ({ ...c, phase })))
    return got
  }
  const inPhase = (phase: string, op: string, key: string) => all.filter((c) => c.phase === phase && c.op === op && c.key === key).length
  const brief = (c: Call) => [c.op, c.key, c.viaBoot ? 'boot' : c.viaPort ? 'port' : 'DIRECT'] as const
  return { all, take, inPhase, brief }
}

// issue #305 - this file takes `test` from @playwright/test, so the shared
// fixture does not watch its page: attach before any navigation
test.beforeEach(({ page }) => watchPage(page))

test.describe('browser storage is reached through the port only, and only behind the gate (run time)', () => {
  test('a new profile: nothing but the mode key is read before the gate; then every path passes through storagePort', async ({
    page,
    baseURL,
  }) => {
    await trap(page, baseURL!)
    const { all, take, inPhase, brief } = phases()

    // 0. the gate of a profile that never answered: on screen, with exactly two
    //    storage calls behind it - the boot script's read of the mode key, then
    //    the boot module's read of the same key through the port. No document,
    //    no author, no theme, no language.
    await page.goto('/')
    await expect(gate(page)).toBeVisible()
    await expect(page.locator('.toolbar')).toHaveCount(0)
    const beforeGate = await take(page, 'gate')
    expect(beforeGate.map(brief)).toEqual([
      ['getItem', MODE, 'boot'],
      ['getItem', MODE, 'port'],
    ])
    expect(await htmlState(page)).toEqual({ lang: 'en', theme: null })

    // 1. personal browser, remembered: the mode key is written, the stores read
    //    their keys, and the default document is saved with no action
    await answerGate(page, 'personal', true)
    await appUp(page)
    await seen(page, 'setItem', GRAPH)
    await take(page, 'start-up')
    expect(all.filter((c) => c.phase === 'start-up')[0] && brief(all.filter((c) => c.phase === 'start-up')[0]!)).toEqual(['setItem', MODE, 'port'])
    expect(inPhase('start-up', 'setItem', MODE)).toBe(1)
    expect(inPhase('start-up', 'getItem', GRAPH)).toBeGreaterThan(0)
    expect(inPhase('start-up', 'setItem', GRAPH)).toBeGreaterThan(0)
    // issue #296 - a first visit records the newest release note as its baseline,
    // once and with no action, and that write goes through the port like the rest
    expect(inPhase('start-up', 'getItem', ANNOUNCED)).toBeGreaterThan(0)
    expect(inPhase('start-up', 'getItem', OPENED)).toBeGreaterThan(0)
    expect(inPhase('start-up', 'setItem', ANNOUNCED)).toBe(1)
    expect(inPhase('start-up', 'setItem', OPENED)).toBe(0)
    // issue #302 / #297 - at this start the boot door read NO theme (the mode
    // was not yet remembered when the page loaded); the two module readers are
    // the returning-profile check of the update notice and `applyStoredTheme()`
    expect(all.filter((c) => c.viaBoot && c.phase === 'start-up')).toEqual([])
    expect(inPhase('start-up', 'getItem', THEME)).toBe(2)

    // 2. onboarding and a preference. A profile with no tour key is offered the
    //    Welcome card once the app has settled; WHEN that is differs between this
    //    machine and the CI runner, and its scrim covers every control, so it is
    //    skipped through the product's own action as soon as the app is up
    //    (before the offer: the key is written and the offer reads it; after:
    //    the card closes) rather than by a click that races it.
    await skipTour(page)
    await seen(page, 'setItem', TOUR)
    const lock = page.locator('.react-flow__controls-button.rf-lock')
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'true')
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'false')
    await take(page, 'preference')
    expect(inPhase('preference', 'setItem', LOCK)).toBe(2)

    // 3. autosave: an edit (the example spreadsheet) is written without a save action
    await importExample(page)
    await seen(page, 'setItem', GRAPH)
    await take(page, 'autosave')

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
    await take(page, 'author')
    await fileMenu(page).click()
    await page.getByRole('menuitem', { name: 'New' }).click()
    const sure = page.locator('.mcdlg--confirm')
    if (await sure.count()) await sure.locator('.mcdlg__foot .btn').last().click()
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await seen(page, 'setItem', GRAPH)
    await take(page, 'delete')

    // 5. restore: a reload of a REMEMBERED personal browser shows no gate, and
    //    the boot door now reads the mode key and then the theme, before any
    //    module; the stored document is read back
    await page.reload()
    await waitForAppReady(page)
    await expect(gate(page)).toHaveCount(0)
    await seen(page, 'getItem', GRAPH)
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await take(page, 'restore')
    const restore = all.filter((c) => c.phase === 'restore')
    expect(restore.slice(0, 2).map(brief)).toEqual([
      ['getItem', MODE, 'boot'],
      ['getItem', THEME, 'boot'],
    ])
    expect(restore.filter((c) => c.viaBoot).length, 'the boot door reads exactly those two').toBe(2)
    // three module readers of the theme at a remembered start: the returning-
    // profile check, the module door, and nothing else
    expect(inPhase('restore', 'getItem', THEME)).toBe(3)

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
    await page.goto('/' + hash)
    await appUp(page)
    await expect(page.locator('body')).toContainText('Steel Sword')
    expect(asked).toBe(1)
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('')
    await seen(page, 'setItem', GRAPH)
    await take(page, 'share restore')

    // every path above was really seen by the trap ...
    for (const phase of ['gate', 'start-up', 'preference', 'autosave', 'author', 'delete', 'restore', 'share restore'])
      expect(all.filter((c) => c.phase === phase).length, phase).toBeGreaterThan(0)
    expect([...new Set(all.map((c) => c.op))].sort()).toEqual(['getItem', 'removeItem', 'setItem'])
    // ... it was only ever localStorage, and every call went through the port or the boot door
    expect([...new Set(all.map((c) => c.api))]).toEqual(['localStorage'])
    expect(all.filter((c) => !c.viaPort && !c.viaBoot)).toEqual([])
  })

  test('a used profile, temporary session: nothing stored is shown or read, nothing but the mode key is written, and the storage is byte for byte what it was', async ({
    page,
    baseURL,
  }) => {
    await trap(page, baseURL!)
    const { all, take, inPhase, brief } = phases()

    // what the previous person left: a dark theme, Korean, a name and a document
    // with a label of their own; and no answer to the gate
    const previous = {
      [THEME]: 'dark',
      'loop-studio/ui-locale/1': 'ko',
      [AUTHOR]: JSON.stringify({ name: 'Previous Person', note: 'their note' }),
      [TOUR]: 'dismissed',
      [GRAPH]: JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [{ id: 'p1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'PreviousPersonWork', value: 7 } }],
        edges: [],
      }),
    }
    await page.addInitScript((seed) => {
      // once per tab, before the trap counts: a reload must see what the app
      // itself did since (nothing, is the claim)
      try {
        if (!sessionStorage.getItem('__previous_seeded')) {
          sessionStorage.setItem('__previous_seeded', '1')
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)
        }
      } catch {
        /* ignore */
      }
    }, previous)

    // 0. the gate: in the BROWSER's language and the SYSTEM theme, not the
    //    previous person's, with their label nowhere on the page, and two mode
    //    reads behind it
    await page.goto('/')
    await expect(gate(page)).toBeVisible()
    const before = await stored(page)
    expect(before.map(([k]) => k)).toEqual(Object.keys(previous).sort())
    expect(await htmlState(page)).toEqual({ lang: 'en', theme: null })
    await expect(page.locator('body')).not.toContainText('PreviousPersonWork')
    await expect(page.locator('body')).not.toContainText('Previous Person')
    // the seed's own writes and the `stored()` read above are the test's, not
    // the app's: everything a module or the boot door did is the mode key
    const appCalls = (await take(page, 'gate')).filter((c) => c.viaPort || c.viaBoot)
    expect(appCalls.map(brief)).toEqual([
      ['getItem', MODE, 'boot'],
      ['getItem', MODE, 'port'],
    ])

    // 1. temporary, remembered: the app starts from nothing - English, the
    //    system theme, the sample document, an empty author - and the one write
    //    that reaches localStorage is the mode key
    await answerGate(page, 'temporary', true)
    await appUp(page)
    await skipTour(page) // the tour key is not read in a temporary session, so the card would be offered; its write goes to memory
    expect(await htmlState(page)).toEqual({ lang: 'en', theme: null })
    await expect(page.locator('body')).not.toContainText('PreviousPersonWork')
    expect(await page.evaluate(() => (window as unknown as { __loop: { storage: { mode: () => string } } }).__loop.storage.mode())).toBe('temporary')
    const dlg = await authorDialog(page)
    await expect(dlg.locator('.review__field input').first()).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)

    // 2. work in the session: a preference, the example spreadsheet, a theme -
    //    the autosave and the toggles run, and none of it reaches localStorage
    // (#334 — the data import is an edit, which the lock refuses: import
    // first, then lock)
    await importExample(page)
    const lock = page.locator('.react-flow__controls-button.rf-lock')
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(700) // past the 400 ms autosave debounce
    const session = (await take(page, 'session')).filter((c) => c.viaPort || c.viaBoot)
    expect(session.map(brief)).toEqual([['setItem', MODE, 'port']])
    expect(inPhase('session', 'setItem', MODE)).toBe(1)
    expect(await stored(page)).toEqual([...before, [MODE, 'temporary']].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))

    // 3. the shared document: a link opened in a remembered temporary session
    //    loads it and stores none of it
    const payload = await page.evaluate(async () => {
      const w = window as unknown as { __loop: { graph: { getState: () => { exportJSON: () => string } }; share: { encodeShareText: (t: string) => Promise<{ payload: string }> } } }
      return (await w.__loop.share.encodeShareText(w.__loop.graph.getState().exportJSON())).payload
    })
    await page.goto('about:blank')
    await page.goto('/#g1=' + payload)
    await expect(gate(page)).toHaveCount(0)
    await appUp(page)
    await expect(page.locator('body')).toContainText('Steel Sword')
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('')
    await page.waitForTimeout(700)
    const shared = (await take(page, 'share')).filter((c) => c.viaPort || c.viaBoot)
    expect(shared.map(brief)).toEqual([
      ['getItem', MODE, 'boot'],
      ['getItem', MODE, 'port'],
    ])
    expect(await stored(page)).toEqual([...before, [MODE, 'temporary']].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))

    // 4. a reload keeps nothing of the session and reads nothing of the previous person
    await page.reload()
    await expect(gate(page)).toHaveCount(0)
    await appUp(page)
    await expect(page.locator('body')).not.toContainText('Steel Sword')
    await expect(page.locator('body')).not.toContainText('PreviousPersonWork')
    expect(await htmlState(page)).toEqual({ lang: 'en', theme: null })
    const reload = (await take(page, 'reload')).filter((c) => c.viaPort || c.viaBoot)
    expect(reload.map(brief)).toEqual([
      ['getItem', MODE, 'boot'],
      ['getItem', MODE, 'port'],
    ])

    // nothing was ever anything but localStorage, and no call from the app's
    // own code (a module frame) bypassed the port: the direct calls on record
    // are this test's seed and its `stored()` reads, which run from the harness
    const app = all.filter((c) => c.viaPort || c.viaBoot || c.fromModule)
    expect([...new Set(app.map((c) => c.api))]).toEqual(['localStorage'])
    expect(app.filter((c) => !c.viaPort && !c.viaBoot)).toEqual([])
  })

  test('the trap itself sees what the source check cannot: a name assembled at run time', async ({ page, baseURL }) => {
    await trap(page, baseURL!)
    await page.goto('/')
    await answerGate(page, 'personal', false)
    await appUp(page)
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
