import type { Browser, Page } from '@playwright/test'
import { expect, openApp, safeUrl, test, waitForAppReady } from './support/loop'

// Issue #305 - the readiness helper and its failure report
// (support/appReady.ts). Each failure case runs in a context made with
// `browser.newContext()`, which the shared fixture watches like any spec's own
// context; the default `page`, which the `errors` fixture holds to "no console
// or page errors", is used only where the app really boots. The stub pages are
// served by `page.route` from the dev server's own origin; no request leaves it.
//
// A short `timeout` is passed only here, so a failure is reached quickly; every
// other caller uses the project's expect timeout (8 s), unchanged.

const SHORT = { timeout: 600 }

/** a watched page in a fresh context, with `path` answered by `html` */
async function stubPage(browser: Browser, path: string, html: string): Promise<Page> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.route(`**${path}*`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }))
  return page
}

/** the error waitForAppReady throws, or a failure if it does not */
async function failure(page: Page, opts = SHORT): Promise<string> {
  try {
    await waitForAppReady(page, opts)
  } catch (e) {
    return String((e as Error).message)
  }
  throw new Error('waitForAppReady did not fail')
}

const EMPTY_ROOT = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>'

test.describe('waitForAppReady', () => {
  test('success: the app boots and the helper returns, with no report', async ({ page }) => {
    await openApp(page)
    await waitForAppReady(page)
    expect(test.info().attachments.map((a) => a.name)).not.toContain('app-ready-diagnostics')
  })

  test('timeout: nothing rendered - the stage, the document events, the DOM, and a URL without its fragment or query values', async ({ browser }) => {
    const page = await stubPage(browser, '/__app-ready/blank', EMPTY_ROOT)
    await page.goto('/__app-ready/blank?token=s3cret&lang=ko#g1=PAYLOAD')
    const msg = await failure(page)
    expect(msg).toContain("waiting for .toolbar")
    expect(msg).toContain('stage: nothing rendered into #root')
    expect(msg).toContain('page: open; renderer answered in')
    expect(msg).toMatch(/url: http:\/\/(localhost|127\.0\.0\.1):\d+\/__app-ready\/blank\?token=\*\*\*&lang=\*\*\*\n/)
    expect(msg).toContain('document: DOMContentLoaded yes, load yes, readyState complete')
    expect(msg).toContain('dom: #root children 0, storage gate no, html lang "en"')
    expect(msg).toContain('toolbar: present no, visible no; canvas: present no, visible no')
    expect(msg).toContain('page errors: none')
    expect(msg).toContain('failed requests: none')
    expect(msg).not.toContain('s3cret')
    expect(msg).not.toContain('PAYLOAD')
    const urlLine = msg.split('\n').find((l) => l.startsWith('url: '))
    expect(urlLine).not.toContain('#')
    // the same report is attached to the test
    expect(test.info().attachments.map((a) => a.name)).toContain('app-ready-diagnostics')
    await page.context().close()
  })

  test('timeout on the canvas: the toolbar is up, the canvas never comes', async ({ browser }) => {
    const page = await stubPage(browser, '/__app-ready/half', '<!doctype html><html><body><div id="root"><header class="toolbar">t</header></div></body></html>')
    await page.goto('/__app-ready/half')
    const msg = await failure(page)
    expect(msg).toContain('waiting for .canvas')
    expect(msg).toContain('stage: toolbar up, no canvas')
    expect(msg).toContain('toolbar: present yes, visible yes; canvas: present no, visible no')
    await page.context().close()
  })

  // issue #305 - where the time went: Node's clock and the renderer's, apart
  test('timeline: the Node side and the renderer side are reported separately, each with its own marks', async ({ browser }) => {
    const page = await stubPage(
      browser,
      '/__app-ready/late-toolbar',
      '<!doctype html><html lang="en"><body><div id="root"></div><script>setTimeout(() => { document.documentElement.lang = "en"; document.getElementById("root").innerHTML = \'<header class="toolbar">t</header>\' }, 150)</script></body></html>',
    )
    await page.goto('/__app-ready/late-toolbar')
    const msg = await failure(page)
    expect(msg).toContain('waiting for .canvas')
    // Node's clock: the document events before the wait (negative), the toolbar during it, the verdict
    expect(msg).toMatch(/node timeline \(ms from the wait start\): navigated -\d+, DOMContentLoaded -?\d+, load -?\d+; toolbar visible \d+; gave up \d+/)
    // the renderer's clock: its own marks, and where the wait started on that clock
    expect(msg).toMatch(/renderer timeline \(ms from navigation start, read at \d+ ; the wait started at -?\d+\): lang set \d+, #root \d+, toolbar attached \d+ \/ visible \d+, canvas visible -/)
    expect(msg).toMatch(/renderer work: \d+ frames, longest gap \d+ ms ending at \d+; long tasks \d+, \d+ ms in all/)
    expect(msg).toMatch(/navigation: response end \d+, DOMContentLoaded \d+, load \d+; requests \d+, catalog requests 0 ending at -; slowest/)
    expect(msg).not.toContain('late trace')
    await page.context().close()
  })

  test('a renderer busy at the deadline: the probe goes unanswered, and the late trace is collected when it answers', async ({ browser }) => {
    // after load, the main thread is held for 2.5 s: the 600 ms wait fails, the
    // 1 s probe cannot run, and the same read comes back once the task ends
    const page = await stubPage(
      browser,
      '/__app-ready/busy',
      '<!doctype html><html lang="en"><body><div id="root"></div><script>addEventListener("load", () => setTimeout(() => { const t = performance.now(); while (performance.now() - t < 2500) {} }, 50))</script></body></html>',
    )
    await page.goto('/__app-ready/busy')
    const msg = await failure(page)
    expect(msg).toContain('stage: renderer did not answer')
    expect(msg).toContain('did not answer within 1000 ms')
    expect(msg).toMatch(/late trace: the renderer answered \d+ ms after the deadline; stage then: nothing rendered into #root/)
    // the late read carries the long task that held the renderer
    const late = msg.slice(msg.indexOf('late trace'))
    const longest = Number(/longest (\d+) ms at/.exec(late)?.[1])
    expect(longest, 'the blocking task is in the late trace').toBeGreaterThanOrEqual(2000)
    await page.context().close()
  })

  test('the slowest request is named, with its query values masked; requests are not listed one by one', async ({ browser }) => {
    const page = await stubPage(
      browser,
      '/__app-ready/slow-page',
      '<!doctype html><html lang="en"><body><div id="root"></div><script src="/__app-ready/slow.js?key=s3cret"></script></body></html>',
    )
    await page.route('**/__app-ready/slow.js*', async (r) => {
      await new Promise((res) => setTimeout(res, 400))
      await r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* slow */' })
    })
    await page.goto('/__app-ready/slow-page')
    const msg = await failure(page)
    expect(msg).toMatch(/slowest \d+ ms from \d+, http:\/\/(localhost|127\.0\.0\.1):\d+\/__app-ready\/slow\.js\?key=\*\*\*/)
    expect(Number(/slowest (\d+) ms/.exec(msg)?.[1])).toBeGreaterThanOrEqual(300)
    expect(msg).not.toContain('s3cret')
    expect(msg.match(/slow\.js/g)?.length).toBe(1)
    await page.context().close()
  })

  test('a document without a boot trace says so', async ({ browser }) => {
    // every context the fixture sees is traced (even `browser.newPage()` goes
    // through `browser.newContext()`), so the trace is removed from this document
    const page = await stubPage(browser, '/__app-ready/untraced', EMPTY_ROOT)
    await page.goto('/__app-ready/untraced')
    await page.evaluate(() => delete (window as unknown as { __appReadyTrace?: unknown }).__appReadyTrace)
    const msg = await failure(page)
    expect(msg).toContain('renderer timeline: not recorded (no boot trace in this document)')
    await page.context().close()
  })

  test('page errors and console errors are listed, counted and capped', async ({ browser }) => {
    const script = [
      'for (let i = 0; i < 30; i++) console.error("console-305 same");',
      'for (let i = 0; i < 15; i++) console.error("console-305 distinct " + i);',
      'setTimeout(() => { throw new Error("boom-305") }, 0);',
    ].join('\n')
    const page = await stubPage(browser, '/__app-ready/errors', `<!doctype html><html><body><div id="root"></div><script>${script}</script></body></html>`)
    await page.goto('/__app-ready/errors')
    const msg = await failure(page)
    expect(msg).toMatch(/page errors: \n {2}- boom-305\n/)
    expect(msg).toContain('  - console-305 same (x30)')
    expect(msg).toContain('  - console-305 distinct 0')
    expect(msg).toContain('  - console-305 distinct 8')
    expect(msg).not.toContain('console-305 distinct 9')
    // 16 distinct texts, 10 kept: the other 6 are only counted
    expect(msg).toContain('  - … and 6 more')
    await page.context().close()
  })

  test('a failed request and a 4xx response are listed, with query values masked', async ({ browser }) => {
    const page = await stubPage(
      browser,
      '/__app-ready/requests',
      '<!doctype html><html><body><div id="root"></div><script src="/__app-ready/missing.js?key=abc"></script><img src="/__app-ready/nope.png"></body></html>',
    )
    await page.route('**/__app-ready/missing.js*', (r) => r.abort('failed'))
    await page.route('**/__app-ready/nope.png', (r) => r.fulfill({ status: 404, body: '' }))
    await page.goto('/__app-ready/requests')
    const msg = await failure(page)
    expect(msg).toMatch(/failed requests: \n {2}- GET http:\/\/[^/]+\/__app-ready\/missing\.js\?key=\*\*\* - net::ERR_FAILED\n/)
    expect(msg).toMatch(/4xx\/5xx responses: \n {2}- 404 GET http:\/\/[^/]+\/__app-ready\/nope\.png/)
    expect(msg).not.toContain('abc')
    await page.context().close()
  })

  test('URLs and local paths inside console and page-error TEXT leave no fragment, no query value and no local path', async ({ browser }) => {
    const root = process.cwd()
    const fwd = root.replace(/\\/g, '/')
    const hostile = [
      'fetch http://localhost:5173/a?token=SECRET1&lang=ko#g1=FRAGMENT1',
      'open file:///C:/Users/someone/private/a.txt?x=SECRET2#FRAGMENT2',
      `module http://localhost:5173/@fs/${encodeURI(fwd)}/node_modules/dep.js?v=SECRET3`,
      'module http://localhost:5173/@fs/D:/elsewhere/hidden/other.js',
      `at ${root}\\e2e\\x.ts:1:2`,
      `at ${fwd}/e2e/y.ts:3:4`,
      'at C:\\Users\\someone\\private\\b.ts:5:6',
      'at /home/someone/private/c.ts:7:8',
    ].join(' | ')
    const page = await stubPage(browser, '/__app-ready/hostile', EMPTY_ROOT)
    await page.goto('/__app-ready/hostile')
    await page.evaluate((text) => {
      console.error(text)
      setTimeout(() => {
        throw new Error(text)
      }, 0)
    }, hostile)
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete')
    const msg = await failure(page)
    for (const leak of ['SECRET1', 'SECRET2', 'SECRET3', 'FRAGMENT1', 'FRAGMENT2', 'someone', 'private', 'elsewhere', 'hidden', root, fwd, encodeURI(fwd)]) {
      expect(msg, `the report must not carry ${JSON.stringify(leak)}`).not.toContain(leak)
    }
    // what is left is useful: the scheme, host and path, the query NAMES, and a
    // repository-relative path or a file name
    expect(msg).toContain('http://localhost:5173/a?token=***&lang=***')
    expect(msg).toContain('file:///…/a.txt')
    expect(msg).toContain('http://localhost:5173/@fs/<repo>/node_modules/dep.js?v=***')
    expect(msg).toContain('http://localhost:5173/@fs/…/other.js')
    expect(msg).toContain('<repo>/e2e/x.ts:1:2')
    expect(msg).toContain('<repo>/e2e/y.ts:3:4')
    expect(msg).toContain('…/b.ts:5:6')
    expect(msg).toContain('…/c.ts:7:8')
    // both channels went through it
    expect(msg).toMatch(/page errors: \n {2}- fetch http/)
    expect(msg).toMatch(/console errors: \n {2}- fetch http/)
    await page.context().close()
  })

  test('one very long message is cut, and so is the whole report', async ({ browser }) => {
    const page = await stubPage(browser, '/__app-ready/long', EMPTY_ROOT)
    await page.goto('/__app-ready/long')
    await page.evaluate(() => {
      console.error('L'.repeat(50_000))
      for (let i = 0; i < 12; i++) console.error(`distinct-${i} ` + 'M'.repeat(5_000))
      for (let i = 0; i < 12; i++) setTimeout(() => {
        throw new Error(`boom-${i} ` + 'N'.repeat(5_000))
      }, 0)
    })
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete')
    const msg = await failure(page)
    // each entry at most 300 characters (plus the cut mark and the list prefix)
    for (const line of msg.split('\n')) expect(line.length, line.slice(0, 60)).toBeLessThanOrEqual(320)
    // and the whole report at most 4000
    expect(msg.length).toBeLessThanOrEqual(4000)
    expect(msg).toContain('… (report cut at 4000 characters)')
    expect(msg).not.toContain('L'.repeat(301))
    await page.context().close()
  })

  test('a page closed while it is awaited reports a closed page', async ({ browser }) => {
    const page = await stubPage(browser, '/__app-ready/closing', EMPTY_ROOT)
    await page.goto('/__app-ready/closing')
    const waited = failure(page, { timeout: 5000 })
    await page.close()
    const msg = await waited
    expect(msg).toContain('stage: page closed')
    expect(msg).toContain('page: closed')
    expect(msg).toContain('url: (page closed)')
    await page.context().close()
  })

  test('a crashed renderer is reported as a crash', async ({ browser }) => {
    const page = await stubPage(browser, '/__app-ready/crash', EMPTY_ROOT)
    await page.goto('/__app-ready/crash')
    const crashed = page.waitForEvent('crash')
    const cdp = await page.context().newCDPSession(page)
    void cdp.send('Page.crash').catch(() => undefined)
    await crashed
    const msg = await failure(page)
    expect(msg).toContain('stage: renderer crashed')
    expect(msg).toContain('page: crashed')
    await page.context().close()
  })
})

test.describe('safeUrl', () => {
  test('drops the fragment, masks every query value, and keeps no local path', () => {
    expect(safeUrl('http://localhost:5173/a/b?pw=secret&lang=ko#g1=abc')).toBe('http://localhost:5173/a/b?pw=***&lang=***')
    expect(safeUrl('https://x.pages.dev/#p1=cipher')).toBe('https://x.pages.dev/')
    expect(safeUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(safeUrl('file:///C:/somewhere/dist-portable/index.html#g1=abc')).toBe('file:///…/index.html')
    const repo = encodeURI(process.cwd().replace(/\\/g, '/'))
    expect(safeUrl(`file:///${repo}/dist-portable/index.html#g1=abc`)).toBe('file:///<repo>/dist-portable/index.html')
    expect(safeUrl(`http://localhost:5173/@fs/${repo}/node_modules/x.js?v=1`)).toBe('http://localhost:5173/@fs/<repo>/node_modules/x.js?v=***')
    expect(safeUrl('http://localhost:5173/@fs/C:/other/place/y.js')).toBe('http://localhost:5173/@fs/…/y.js')
    expect(safeUrl('data:text/html,<p>x</p>')).toBe('data:…')
    expect(safeUrl('about:blank')).toBe('about:blank')
    expect(safeUrl('not a url?x=1#y')).toBe('not a url')
  })
})
