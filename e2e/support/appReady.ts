import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Issue #305 - "the app is up", decided in one place, and a failure that says
// WHY it is not.
//
// On CI a fresh page sometimes shows no toolbar within the 8 s expect timeout
// and the retry passes in about 1.5 s. The failure used to read only "element(s)
// not found", which cannot tell a renderer that stopped answering from an app
// that never rendered, a request that failed, a page error or a closed page.
// This is diagnostics, not a fix for the delay: the readiness condition (the
// toolbar, then the canvas, each visible), the 8 s budget and the retry policy
// are exactly what `openApp` used before.
//
// `watchPage` must be attached BEFORE the navigation it is meant to explain
// (`goto`, `reload`). The shared fixture attaches it to every page of the
// default context and of every context made with `browser.newContext()`
// (support/loop.ts); a spec that takes `test` from `@playwright/test` itself
// calls it before navigating.

/** at most this many distinct entries per list, each at most MAX_TEXT chars,
 *  and the whole report at most MAX_REPORT chars */
const MAX_ENTRIES = 10
const MAX_TEXT = 300
const MAX_REPORT = 4000

/** the repository root as the runner sees it (Playwright runs from it), with
 *  forward slashes, for turning a local path into a repository-relative one */
const REPO_ROOT = process.cwd().replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * A local file path as it may be written to a CI log: relative to the
 * repository (`<repo>/e2e/x.ts`) when it is inside it, otherwise its file name
 * only (`…/x.ts`). Anything that is not an absolute local path is returned as is.
 */
function scrubPath(p: string): string {
  const f = p.replace(/\\/g, '/')
  const i = f.toLowerCase().indexOf(REPO_ROOT.toLowerCase())
  if (i >= 0) return '<repo>' + f.slice(i + REPO_ROOT.length)
  if (/^\/?[A-Za-z]:\//.test(f) || /^\/(home|Users|tmp|var|private|root)\//.test(f)) return '…/' + (f.split('/').pop() ?? '')
  return f
}

/**
 * Free text (a console message, a page error, an assertion's first line) as it
 * may be written to a CI log: every URL in it goes through `safeUrl` (no
 * fragment, no query values), and every local path is made repository-relative
 * or reduced to its file name.
 */
export function scrubText(text: string): string {
  // the repository root FIRST, in every form it can take (either slash style,
  // and percent-encoded inside a URL): it may contain a space, at which the
  // URL and path rules below would stop and leave the rest of the path behind
  let t = text
  for (const root of [REPO_ROOT, REPO_ROOT.replace(/\//g, '\\'), REPO_ROOT.replace(/ /g, '%20')]) {
    let at = t.toLowerCase().indexOf(root.toLowerCase())
    while (at >= 0) {
      t = t.slice(0, at) + '<repo>' + t.slice(at + root.length)
      at = t.toLowerCase().indexOf(root.toLowerCase(), at + '<repo>'.length)
    }
  }
  // one form for a repository path: forward slashes after `<repo>`
  t = t.replace(/<repo>((?:\\[^\s'"`<>()|\\]*)+)/g, (_m, rest: string) => '<repo>' + rest.replace(/\\/g, '/'))
  t = t.replace(/\b(?:https?|wss?|file):\/\/(?:<repo>|[^\s'"`<>()[\]{}|\\^])*/g, (u) => safeUrl(u))
  // a drive-letter path (not the `p:/` inside `http://`) or a home-like POSIX path
  t = t.replace(/(?<![\w.+-])[A-Za-z]:[\\/][^\s'"`<>()|]*/g, (p) => scrubPath(p))
  t = t.replace(/(?<![\w:/.~-])\/(?:home|Users|tmp|var|private|root)\/[^\s'"`<>()|]*/g, (p) => scrubPath(p))
  return t
}

/** ignored console errors, as in the shared `errors` fixture */
const IGNORE_CONSOLE = [/favicon/i, /\[vite\] connect/i, /Download the React DevTools/i]

type Entries = { order: string[]; counts: Map<string, number>; dropped: number }

type Watch = {
  pageErrors: Entries
  consoleErrors: Entries
  failedRequests: Entries
  badResponses: Entries
  crashed: boolean
  closed: boolean
  /** of the CURRENT document: reset whenever the main frame navigates */
  domContentLoaded: boolean
  load: boolean
}

const watches = new WeakMap<Page, Watch>()

const entries = (): Entries => ({ order: [], counts: new Map(), dropped: 0 })

/** one entry per distinct text, counted; past MAX_ENTRIES distinct texts only a
 *  count of what was dropped is kept, so a page that logs in a loop cannot flood
 *  the CI output */
function add(list: Entries, raw: string): void {
  // scrubbed BEFORE the cut, so a cut can never leave half a URL unscrubbed
  const text = scrubText(raw)
  const t = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text
  const n = list.counts.get(t)
  if (n !== undefined) {
    list.counts.set(t, n + 1)
    return
  }
  if (list.order.length >= MAX_ENTRIES) {
    list.dropped++
    return
  }
  list.order.push(t)
  list.counts.set(t, 1)
}

function render(list: Entries): string[] {
  const out = list.order.map((t) => {
    const n = list.counts.get(t) ?? 1
    return n > 1 ? `${t} (x${n})` : t
  })
  if (list.dropped) out.push(`… and ${list.dropped} more`)
  return out
}

/**
 * A URL as it may be written to a CI log: no fragment (a share link carries the
 * whole document there, and a protected one its ciphertext), and every query
 * VALUE masked - which parameter is sensitive is not known here, so none is
 * shown; the names stay. A `data:` URL keeps only its scheme, and a `file:` URL
 * only its file name (the rest is a path on the machine that ran the test).
 */
export function safeUrl(raw: string): string {
  if (raw.startsWith('data:')) return 'data:…'
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return raw.split('#')[0].split('?')[0]
  }
  const decoded = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s.replace(/%3Crepo%3E/gi, '<repo>')
    }
  }
  /** repository-relative, or the file name only */
  const local = (p: string) => {
    const s = scrubPath(p)
    return s.startsWith('<repo>') ? s : '…/' + (s.split('/').pop() ?? '')
  }
  if (u.protocol === 'file:') return 'file:///' + local(decoded(u.pathname))
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return `${u.protocol}${u.pathname}`
  const names = [...u.searchParams.keys()]
  const query = names.length ? '?' + names.map((k) => `${encodeURIComponent(k)}=***`).join('&') : ''
  // the dev server serves a file outside its root as `/@fs/<absolute path>`
  const fs = u.pathname.indexOf('/@fs/')
  const plain = u.pathname.replace(/%3Crepo%3E/gi, '<repo>')
  const path = fs < 0 ? plain : u.pathname.slice(0, fs) + '/@fs/' + local(decoded(u.pathname.slice(fs + '/@fs/'.length)))
  return `${u.protocol}//${u.host}${path}${query}`
}

/** Start recording what happens to `page`. Idempotent: a second call for the
 *  same page adds nothing. */
export function watchPage(page: Page): void {
  if (watches.has(page)) return
  const w: Watch = {
    pageErrors: entries(),
    consoleErrors: entries(),
    failedRequests: entries(),
    badResponses: entries(),
    crashed: false,
    closed: false,
    domContentLoaded: false,
    load: false,
  }
  watches.set(page, w)
  page.on('pageerror', (e) => add(w.pageErrors, e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE_CONSOLE.some((re) => re.test(m.text()))) add(w.consoleErrors, m.text())
  })
  page.on('requestfailed', (r) => add(w.failedRequests, `${r.method()} ${safeUrl(r.url())} - ${r.failure()?.errorText ?? 'failed'}`))
  page.on('response', (r) => {
    if (r.status() >= 400) add(w.badResponses, `${r.status()} ${r.request().method()} ${safeUrl(r.url())}`)
  })
  page.on('crash', () => (w.crashed = true))
  page.on('close', () => (w.closed = true))
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) return
    w.domContentLoaded = false
    w.load = false
  })
  page.on('domcontentloaded', () => (w.domContentLoaded = true))
  page.on('load', () => (w.load = true))
}

/** every page of `context`, the ones it has and the ones it will open */
export function watchContext(context: BrowserContext): void {
  for (const p of context.pages()) watchPage(p)
  context.on('page', watchPage)
}

type Probe = {
  readyState: string
  rootChildren: number
  gate: boolean
  htmlLang: string
  htmlDir: string
  toolbar: { present: boolean; visible: boolean }
  canvas: { present: boolean; visible: boolean }
}

/** one read of the page, bounded: a renderer that does not answer within
 *  `ms` is itself the finding */
async function probe(page: Page, ms: number): Promise<{ probe: Probe | null; answeredInMs: number | null; error?: string }> {
  const t0 = Date.now()
  const read = page.evaluate(() => {
    const vis = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return { present: false, visible: false }
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return { present: true, visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    }
    return {
      readyState: document.readyState,
      rootChildren: document.getElementById('root')?.childElementCount ?? -1,
      gate: Boolean(document.querySelector('.gate')),
      htmlLang: document.documentElement.lang,
      htmlDir: document.documentElement.dir,
      toolbar: vis('.toolbar'),
      canvas: vis('.canvas'),
    }
  })
  try {
    const result = await Promise.race([
      read,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
    ])
    if (result === 'timeout') {
      read.catch(() => undefined)
      return { probe: null, answeredInMs: null }
    }
    return { probe: result, answeredInMs: Date.now() - t0 }
  } catch (e) {
    return { probe: null, answeredInMs: null, error: String((e as Error).message ?? e).split('\n')[0] }
  }
}

/** the furthest step of the boot this page reached, in words */
function stageOf(w: Watch | undefined, p: Probe | null, answered: boolean): string {
  if (w?.closed) return 'page closed'
  if (w?.crashed) return 'renderer crashed'
  if (!answered || !p) return 'renderer did not answer'
  if (p.readyState === 'loading') return 'document still loading'
  if (p.rootChildren <= 0) return 'nothing rendered into #root'
  if (p.gate) return 'storage gate on screen'
  if (!p.toolbar.present) return 'rendered, but no toolbar'
  if (!p.toolbar.visible) return 'toolbar present but not visible'
  if (!p.canvas.present) return 'toolbar up, no canvas'
  if (!p.canvas.visible) return 'canvas present but not visible'
  return 'toolbar and canvas visible'
}

/** The diagnostic report for `page`, as lines. Exported for the helper's own
 *  tests. */
export async function appReadyReport(page: Page, elapsedMs: number, waitingFor: string): Promise<string[]> {
  const w = watches.get(page)
  const closed = w?.closed || page.isClosed()
  const { probe: p, answeredInMs, error } = closed ? { probe: null, answeredInMs: null } : await probe(page, 1000)
  const stage = stageOf(w ? { ...w, closed } : undefined, p, answeredInMs !== null)
  const yn = (b: boolean | undefined) => (b === undefined ? 'unknown' : b ? 'yes' : 'no')
  const vis = (v: { present: boolean; visible: boolean } | undefined) => (v ? `present ${yn(v.present)}, visible ${yn(v.visible)}` : 'unknown')
  const lines = [
    `app not ready after ${elapsedMs} ms, waiting for ${waitingFor}`,
    `stage: ${stage}`,
    `page: ${closed ? 'closed' : w?.crashed ? 'crashed' : 'open'}; renderer ${answeredInMs !== null ? `answered in ${answeredInMs} ms` : error ? `could not be read (${cut(scrubText(error), MAX_TEXT)})` : 'did not answer within 1000 ms'}`,
    `url: ${closed ? '(page closed)' : safeUrl(page.url())}`,
    `document: DOMContentLoaded ${w ? yn(w.domContentLoaded) : 'not watched'}, load ${w ? yn(w.load) : 'not watched'}, readyState ${p?.readyState ?? 'unknown'}`,
    `dom: #root children ${p ? p.rootChildren : 'unknown'}, storage gate ${yn(p?.gate)}, html lang "${cut(p?.htmlLang ?? '?', 40)}" dir "${cut(p?.htmlDir ?? '?', 10)}"`,
    `toolbar: ${vis(p?.toolbar)}; canvas: ${vis(p?.canvas)}`,
  ]
  if (!w) {
    lines.push('page events: not watched (watchPage was not attached before the navigation)')
    return lines
  }
  for (const [title, list] of [
    ['page errors', w.pageErrors],
    ['console errors', w.consoleErrors],
    ['failed requests', w.failedRequests],
    ['4xx/5xx responses', w.badResponses],
  ] as const) {
    const items = render(list)
    lines.push(`${title}: ${items.length ? '' : 'none'}`)
    for (const i of items) lines.push(`  - ${i}`)
  }
  return lines
}

/**
 * Wait until the app is up: the toolbar, then the canvas, each visible - the
 * same condition and the same budget (the project's expect timeout, 8 s) that
 * `openApp` used. On a failure the error carries the diagnostic report, which is
 * also attached to the test as `app-ready-diagnostics`.
 */
export async function waitForAppReady(page: Page, opts: { timeout?: number } = {}): Promise<void> {
  const t0 = Date.now()
  let waitingFor = '.toolbar'
  try {
    await expect(page.locator('.toolbar')).toBeVisible(opts.timeout !== undefined ? { timeout: opts.timeout } : undefined)
    waitingFor = '.canvas'
    await expect(page.locator('.canvas')).toBeVisible(opts.timeout !== undefined ? { timeout: opts.timeout } : undefined)
  } catch (e) {
    const lines = await appReadyReport(page, Date.now() - t0, waitingFor)
    const first = cut(scrubText(String((e as Error).message ?? e).split('\n')[0]), MAX_TEXT)
    const report = capReport([first, ...lines].join('\n'))
    await attach(report)
    throw new Error(report)
  }
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** the whole report at most MAX_REPORT characters, cut at a line boundary */
export function capReport(report: string): string {
  if (report.length <= MAX_REPORT) return report
  const note = `\n… (report cut at ${MAX_REPORT} characters)`
  const room = report.slice(0, MAX_REPORT - note.length)
  const lastBreak = room.lastIndexOf('\n')
  return (lastBreak > 0 ? room.slice(0, lastBreak) : room) + note
}

/** attach to the running test when there is one (the report is also in the
 *  error message, so a missing test info loses nothing) */
async function attach(body: string): Promise<void> {
  try {
    await test.info().attach('app-ready-diagnostics', { body, contentType: 'text/plain' })
  } catch {
    /* outside a test */
  }
}
