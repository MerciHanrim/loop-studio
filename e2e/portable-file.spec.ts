import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { seedPersonalBrowser } from './support/loop'
import { expect, test } from '@playwright/test'
import { capturedExports, installProbe, pathProbe, portableUrl } from './support/mc'
import { expectOneVersionStory, readAboutVersion, readNewestShown, seedWhatsNewSeen } from './support/whatsNew'
import { RELEASE_NOTES } from '../src/releaseNotes/releaseNotes'

// SLICE-2 §5–§6: the portable single-file build opened from file://. No dev
// server, no window.__loop bridge (production build) — driven entirely through
// the DOM. The MC result is read back via the URL.createObjectURL capture in the
// probe (the real Playwright `download` event also fires here). Confirmed by the
// step-1 spike: zero product-code change needed.
//
// file:// constraints (all handled, not worked around):
//  - opaque origin ⇒ localStorage may throw; the app guards load/save in
//    try/catch, and these tests start from a fresh import, not persisted state.
//  - module/blob Workers are unreliable from file:// ⇒ canUseWorkers() returns
//    false and the cooperative path runs — that is the behaviour under test.
//  - single self-contained file ⇒ no fetch of siblings, no HMR.

const RF = 'examples/risky-factory.json'
const HTTP = 'http://localhost:5173'

/** issue #297 - the portable file shows the storage gate EVERY time, with the
 *  temporary session recommended and no way to remember a choice. Every test
 *  here goes through it: `temporary` unless the test is about what a personal
 *  browser stores. */
async function answerPortableGate(page: Page, mode: 'personal' | 'temporary' = 'temporary'): Promise<void> {
  const gate = page.locator('.gate[data-gate="portable"]')
  await expect(gate).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-build'))).toBe('portable')
  // the gate itself: the portable warning, the recommendation, and no remember boxes
  await expect(gate.locator('[data-gate-note="portable"]')).toBeVisible()
  await expect(gate.locator('[data-gate-choice="temporary"] .gate__badge')).toBeVisible()
  await expect(gate.locator('input[type="checkbox"]')).toHaveCount(0)
  await gate.locator(`[data-gate-choice="${mode}"] button`).click()
  await expect(gate).toHaveCount(0)
}

async function openPortable(page: Page, mode: 'personal' | 'temporary' = 'temporary'): Promise<void> {
  await installProbe(page)
  await page.goto(portableUrl())
  expect(await page.evaluate(() => location.protocol)).toBe('file:')
  await answerPortableGate(page, mode)
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  expect(await page.evaluate(() => Boolean((window as any).__loop))).toBe(false)
  // the portable build ships no PWA layer and registers no service worker (§P6).
  // (file:// usually has no `navigator.serviceWorker` at all — either way: none.)
  expect(
    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { regs: 0, controller: false }
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => [])
      return { regs: regs.length, controller: navigator.serviceWorker.controller != null }
    }),
  ).toEqual({ regs: 0, controller: false })
  expect(await page.evaluate(() => document.querySelector('link[rel="manifest"]') != null)).toBe(false)
  await page.locator('input[type="file"]').setInputFiles(RF)
  await expect(page.locator('.react-flow__node')).toHaveCount(18)
}

/** Fill the MC dialog and start the run; leave the dialog closed. */
async function startMc(page: Page, runs: number, steps: number, baseSeed = 1): Promise<void> {
  await page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
  const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
  await expect(dlg).toBeVisible()
  const nums = dlg.locator('.mcdlg__field input[type="number"]')
  await nums.nth(0).fill(String(runs))
  await nums.nth(1).fill(String(steps))
  await nums.nth(2).fill(String(baseSeed))
  const runBtn = dlg.locator('.mcdlg__foot .btn--primary')
  await expect(runBtn).toBeEnabled()
  await runBtn.click()
  await page.keyboard.press('Escape') // close setup; the run keeps going
  await expect(dlg).toBeHidden()
}

/** Open the dialog, assert it is pre-filled from the file's recommendedRunConfig,
 *  and start the run. */
async function startMcPrefilled(page: Page, runs: number, steps: number, baseSeed: number): Promise<void> {
  await page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
  const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
  await expect(dlg).toBeVisible()
  const nums = dlg.locator('.mcdlg__field input[type="number"]')
  await expect(nums.nth(0)).toHaveValue(String(runs))
  await expect(nums.nth(1)).toHaveValue(String(steps))
  await expect(nums.nth(2)).toHaveValue(String(baseSeed))
  const runBtn = dlg.locator('.mcdlg__foot .btn--primary')
  await expect(runBtn).toHaveText(`Run ${runs} runs`)
  await runBtn.click()
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
}

const stripPct = async (page: Page): Promise<number | null> => {
  const el = page.locator('.pstrip__mcprog')
  if (!(await el.count())) return null
  const m = (await el.innerText()).match(/(\d+)\s*%/)
  return m ? Number(m[1]) : null
}

async function exportJsonText(page: Page): Promise<string> {
  await page.locator('.dist__stats .menu button', { hasText: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'JSON' }).click()
  const exports = await capturedExports(page)
  const json = exports.findLast((e) => e.name.endsWith('.json'))
  expect(json, 'a .json export was captured on file://').toBeTruthy()
  return json!.text
}

/** toolbar `File ▾` → `Workspace JSON` (accepts the in-app summary dialog) */
async function exportWorkspaceText(page: Page): Promise<string> {
  await page.locator('.toolbar__actions .menu > button', { hasText: 'File' }).click()
  await page.locator('.toolbar__actions .menu__pop').getByRole('menuitem', { name: 'Workspace JSON' }).click()
  await page.locator('.mcdlg--confirm').getByRole('button', { name: /save workspace/i }).click()
  const exports = await capturedExports(page)
  const ws = exports.findLast((e) => e.name === 'loop-studio-workspace.json')
  expect(ws, 'a workspace export was captured on file://').toBeTruthy()
  return ws!.text
}

test.describe('portable file://', () => {
  test('the production bundle carries NO dev-only bridges / helpers (tree-shaken)', () => {
    // docs/edge-routing.md — `__loop.routeMap` (genCount / reset / get) and
    // docs/simulation-playback.md — the `deepFreeze` prepared-payload guard —
    // exist only behind `if (import.meta.env.DEV)`. A plain production build must
    // ship none of them. `window.__loop` absence is already asserted at boot in
    // openPortable(); this pins the tree-shake at the byte level.
    const html = readFileSync(resolve('dist-portable/loop-studio.html'), 'utf8')
    for (const marker of [
      '__routeGenCount',
      '__resetRouteCache',
      '__loop.routeMap',
      'routeMap:{genCount',
      'deepFreeze',
      '__edgeRenders', // Slice 3c-c dev-only render probe
      '__budgetComputes', // Slice 3c-c dev-only budget-sort probe
      // NOTE on what these markers prove. A marker that is an IDENTIFIER
      // (`devLocaleOverride`, `devPseudoLocales`, `deepFreeze`, `__routeGenCount`
      // …) is renamed by the minifier, so its absence is consistent with the code
      // shipping under another name — useful as a smoke signal, not as proof.
      // A marker that is a STRING LITERAL is never renamed, so `en-XA` / `ar-XB`
      // absence really is evidence the entries were tree-shaken.
      // The authority for the locale codes is `scripts/check-no-pseudo-locales.mjs`,
      // which DERIVES them from the registry source (so a new pseudo-locale is
      // covered the day it is added, unlike this hand-kept list) and runs inside
      // each build command's own completion contract, over all three artefacts.
      'devLocaleOverride', // i18n Slice 1 — the dev-only `?lang=` reader
      'devPseudoLocales', // i18n Slice 1 — the dev-only QA pseudo-locale factory
      'en-XA', // the QA pseudo-locale code — a string literal, so this is real evidence
      'ar-XB', // §L9.2 — the RTL pseudo-locale code, likewise
      '__formatCacheSize', // i18n format-cache test probe
    ]) {
      expect(html, `production bundle still contains "${marker}"`).not.toContain(marker)
    }
  })

  // issue #296 - the release notes ship inside the single file: the panel reads
  // them on file://, with no server to ask and no service worker to cache them
  test('What’s new opens from Help and lists every bundled entry', async ({ page }) => {
    await openPortable(page)
    await page.locator('[data-tour="help-trigger"]').click()
    await page.locator('[data-whatsnew="menu-item"]').click()
    const panel = page.locator('[data-whatsnew="panel"]')
    await expect(panel).toBeVisible()
    const versions = await panel.locator('.whatsnew__version').evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? ''))
    expect(versions).toEqual(RELEASE_NOTES.map((n) => 'v' + n.version))
    expect(await panel.locator('li').count()).toBe(RELEASE_NOTES.reduce((n, r) => n + r.items.length, 0))
    const newest = await readNewestShown(page)
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    // and About, in the same file, shows the version that list starts at
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    expectOneVersionStory((await readAboutVersion(page)).version, newest)
  })

  // issue #302 / #297 - the single file carries the boot script in its head, but
  // the portable file shows the gate every time and reads nothing before it: a
  // stored dark theme, even beside a stored `personal` mode key (which another
  // local file could have written into the shared file:// storage), is NOT on at
  // the first frame. It is applied by the module door only after the person
  // chooses the personal browser, and only when storage is readable.
  test('the boot script is in the single file, reads nothing before the gate, and a stored dark theme appears only after choosing the personal browser', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __firstFrameTheme?: string | null; __storageReadable?: boolean }
      try {
        localStorage.setItem('loop-studio:storage-mode', 'personal')
        localStorage.setItem('loop-studio:theme', 'dark')
        w.__storageReadable = localStorage.getItem('loop-studio:theme') === 'dark'
      } catch {
        w.__storageReadable = false
      }
      requestAnimationFrame(() => {
        w.__firstFrameTheme = document.documentElement.getAttribute('data-theme')
      })
    })
    await installProbe(page)
    await page.goto(portableUrl())
    const atGate = await page.evaluate(() => {
      const w = window as unknown as { __firstFrameTheme?: string | null; __storageReadable?: boolean }
      return { readable: w.__storageReadable, firstFrame: w.__firstFrameTheme, now: document.documentElement.getAttribute('data-theme'), boot: document.querySelectorAll('head script[data-storage-boot]').length }
    })
    const readable = atGate.readable === true
    expect(atGate.boot).toBe(1)
    expect(atGate.firstFrame, 'no stored theme at the first frame of the portable file').toBeNull()
    expect(atGate.now).toBeNull()
    await answerPortableGate(page, 'personal')
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(readable ? 'dark' : null)
  })

  test('a temporary session in the portable file ignores the stored theme and stores nothing', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio:theme', 'dark')
      } catch {
        /* unreadable storage: the test below still holds */
      }
    })
    const snapshot = () =>
      page.evaluate(() => {
        try {
          return Object.keys(localStorage)
            .filter((k) => k.startsWith('loop-studio'))
            .sort()
            .map((k) => [k, localStorage.getItem(k)])
        } catch {
          return 'unreadable'
        }
      })
    await installProbe(page)
    await page.goto(portableUrl())
    // what the storage holds AT the gate: the test's theme and the harness's own
    // seeds (`installProbe` dismisses the tour and marks the release as seen);
    // the gate is on screen although a mode key is among them - the portable
    // file ignores it
    const before = await snapshot()
    await answerPortableGate(page, 'temporary')
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull()
    await page.locator('input[type="file"]').setInputFiles(RF)
    await expect(page.locator('.react-flow__node')).toHaveCount(18)
    await page.waitForTimeout(700) // past the autosave debounce
    // the import and the autosave it triggers left the browser's storage byte for byte as it was
    expect(await snapshot()).toEqual(before)
  })

  test('boots, imports, runs on the cooperative path, exports 424 / 500', async ({ page }) => {
    test.setTimeout(60_000)
    await openPortable(page)
    // the dialog is pre-filled from the file's recommendedRunConfig (500 × 40, seed 1)
    await startMcPrefilled(page, 500, 40, 1)

    await expect(page.locator('.dist')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    expect((await pathProbe(page)).wk.ctor, 'no Worker on file://').toBe(0)

    await expect(page.locator('.term__line')).toHaveCount(1)
    await expect(page.locator('.term__bead')).toHaveCount(1)
    await expect(page.locator('.term__empty')).toHaveCount(0)
    await expect(page.locator('.term__pct b')).toHaveText('85%')

    const dl = page.waitForEvent('download', { timeout: 3_000 }).then((d) => d.suggestedFilename()).catch(() => null)
    const text = await exportJsonText(page)
    console.log('[portable] real download event:', (await dl) ?? 'did not fire')

    const r = JSON.parse(text)
    expect(r.spec).toBe('loop-mc/1')
    expect(r.config).toMatchObject({ baseSeed: 1, runs: 500, steps: 40 })
    expect(r.completedRuns).toBe(500)
    expect(r.endedRuns.atOrBeforeStep).toHaveLength(41)
    expect(r.endedRuns.atOrBeforeStep.at(-1)).toBe(424)
  })

  test('progress is observed mid-run via the strip, then DISTRIBUTION appears', async ({ page }) => {
    test.setTimeout(60_000)
    await openPortable(page)
    await startMc(page, 12_000, 40) // big enough to see the % climb

    let sawMid = false
    await expect
      .poll(async () => {
        const pct = await stripPct(page)
        if (pct !== null && pct > 0 && pct < 100) sawMid = true
        return (await page.locator('.dist').count()) > 0 ? 'done' : 'running'
      }, { timeout: 40_000 })
      .toBe('done')

    expect(sawMid, 'the strip showed 0 < NN% < 100 while running').toBe(true)
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
  })

  test('cancel from the strip stops progress and shows no partial result', async ({ page }) => {
    test.setTimeout(60_000)
    await openPortable(page)
    await startMc(page, 12_000, 40) // 12000·41·8 = 3.9M cells, under the limit, still multi-second

    // catch it running with visible progress
    await expect.poll(() => stripPct(page), { timeout: 30_000 }).toBeGreaterThan(0)
    const atCancel = await stripPct(page)

    await page.locator('.pstrip__mc button', { hasText: 'Cancel' }).click()

    await expect(page.locator('.pstrip__mcprog')).toHaveCount(0)
    await expect(page.locator('.pstrip__mc button')).toContainText('Cancelled')

    // the last % seen does not advance afterwards, and no DISTRIBUTION shows up
    await page.waitForTimeout(1_000)
    const laterPct = await stripPct(page) // null now (prog element gone)
    expect(laterPct === null || laterPct <= (atCancel ?? 0)).toBeTruthy()
    await expect(page.locator('.dist')).toHaveCount(0)
    expect((await pathProbe(page)).wk.ctor).toBe(0)
  })

  test('byte-equal: portable file:// result === http result (recommended 500 × 40)', async ({ browser }) => {
    test.setTimeout(90_000)

    // both sides import risky-factory the real way, so both pick up the file's
    // recommendedRunConfig (500 × 40, seed 1, the 6 tracked Pools) — no manual
    // config on either side.
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await seedPersonalBrowser(pctx) // issue #297 - no storage gate in front of this context
    const ppage = await pctx.newPage()
    await openPortable(ppage)
    await startMcPrefilled(ppage, 500, 40, 1)
    await expect(ppage.locator('.dist')).toBeVisible({ timeout: 30_000 })
    const portableJson = await exportJsonText(ppage)
    expect((await pathProbe(ppage)).wk.ctor).toBe(0) // was cooperative
    await pctx.close()

    const hctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })

    await seedPersonalBrowser(hctx) // issue #297 - no storage gate in front of this context
    const hpage = await hctx.newPage()
    await hpage.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio:storage-mode', 'personal') // issue #297 - no gate on the hosted side
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
      } catch {
        /* ignore */
      }
    })
    await seedWhatsNewSeen(hpage)
    await installProbe(hpage)
    await hpage.goto(HTTP)
    await hpage.waitForFunction(() => Boolean((window as any).__loop))
    await hpage.locator('input[type="file"]').setInputFiles(RF)
    await expect(hpage.locator('.react-flow__node')).toHaveCount(18)
    await hpage.evaluate(async () => {
      await (window as any).__loop.mc.getState().run() // config already = recommended
    })
    const httpJson = await hpage.evaluate(() => JSON.stringify((window as any).__loop.mc.getState().result))
    await hctx.close()

    // whole MonteCarloResult, nothing excluded
    expect(JSON.parse(portableJson)).toEqual(JSON.parse(httpJson))
  })

  test('Workspace round-trip on file:// — SHA-256 digest works, result restores non-stale', async ({ page }) => {
    test.setTimeout(60_000)
    await openPortable(page)
    await startMc(page, 60, 8, 1) // small, fast — fills the dialog fields
    await expect(page.locator('.dist')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.dist__stale')).toHaveCount(0)

    const wsText = await exportWorkspaceText(page)
    const ws = JSON.parse(wsText).workspace
    expect(ws.schema).toBe('loop-workspace/1')
    expect(ws.mc.result).toBeDefined()
    // the digest was minted on file:// (crypto.subtle or the pure-JS fallback)
    expect(ws.mc.resultGraphDigest).toMatch(/^[0-9a-f]{64}$/)

    // re-import the captured workspace file, unchanged
    await page.locator('input[type="file"]').setInputFiles({
      name: 'loop-studio-workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(wsText, 'utf8'),
    })
    // graph reloads (18 nodes) and the distribution comes back NOT stale —
    // proof the file:// digest recomputed to the same value
    await expect(page.locator('.react-flow__node')).toHaveCount(18)
    await expect(page.locator('.dist')).toBeVisible()
    await expect(page.locator('.dist__stale')).toHaveCount(0)
    // nothing auto-ran: the play control is idle
    await expect(page.locator('.pb-btn', { hasText: 'Play' })).toBeVisible()
  })

  /** Open the real portable page, click Share (accepting the §U4 disclosure),
   *  and return the URL shown in the field + what hit the (stubbed) clipboard.
   *  `killCompressionStream` forces the self-contained fixed-Huffman deflate. */
  async function shareFromPortable(
    browser: import('@playwright/test').Browser,
    killCompressionStream: boolean,
  ): Promise<{ url: string; clip: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await seedPersonalBrowser(ctx) // issue #297 - no storage gate in front of this context
    const page = await ctx.newPage()
    await page.addInitScript((kill: boolean) => {
      if (kill) {
        // @ts-expect-error removing a global for the test
        delete window.CompressionStream
      }
      ;(window as any).__clip = []
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t: string) => void (window as any).__clip.push(t) },
      })
    }, killCompressionStream)
    await openPortable(page) // imports risky-factory (18 nodes)
    // the §U4 disclosure is an in-app ConfirmDialog now (docs/localization.md 2b)
    await page.locator('.toolbar__actions button', { hasText: /^Share$/ }).click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
    const url = await page.locator('.share-pop__url').inputValue()
    const clip = await page.evaluate(() => (window as any).__clip as string[])
    await ctx.close()
    return { url, clip }
  }

  /** Open a `#g1=` payload on the hosted build and assert the 18-node graph. */
  async function openPayloadOnHttp(
    browser: import('@playwright/test').Browser,
    payload: string,
  ): Promise<void> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await seedPersonalBrowser(ctx) // issue #297 - no storage gate in front of this context
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try {
        localStorage.setItem('loop-studio:storage-mode', 'personal') // issue #297 - no gate on the hosted side
        localStorage.setItem('loop-studio/guided-tour/1', 'dismissed') // no first-run card
      } catch {
        /* ignore */
      }
    })
    // issue #296 - and this returning profile has already seen the newest release note
    await seedWhatsNewSeen(page)
    await page.goto(`${HTTP}/#g1=${payload}`)
    await page.waitForFunction(() => Boolean((window as any).__loop))
    await page.waitForFunction(() => location.hash === '') // ShareLoader consumed + stripped
    await expect(page.locator('.react-flow__node')).toHaveCount(18)
    const shape = await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      return { nodes: g.nodes.length, rev: g.simulationRev, sim: (window as any).__loop.sim.getState().status }
    })
    expect(shape).toMatchObject({ nodes: 18, rev: 1 })
    expect(shape.sim).not.toBe('running')
    await ctx.close()
  }

  // codec check (keep): the pure-JS fixed-Huffman deflate output decodes on the
  // native path across contexts.
  test('pure-JS deflate link (file://) decodes on the hosted build', async ({ browser }) => {
    test.setTimeout(60_000)
    const { url } = await shareFromPortable(browser, /* kill CompressionStream */ true)
    await openPayloadOnHttp(browser, url.split('#g1=')[1])
  })

  // real user path: the Share button on the actual file:// screen must produce a
  // link a recipient can open — the FIXED public base, never `null/` (file://
  // has `location.origin === "null"`), never a local path.
  test('Share on file:// builds a production URL, not null/... , and it round-trips', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const { url, clip } = await shareFromPortable(browser, /* keep CompressionStream */ false)

    expect(url).toMatch(/^https:\/\/cozy-loop-studio\.pages\.dev\/#g1=[A-Za-z0-9_-]+$/)
    expect(url).not.toContain('null/')
    expect(url).not.toContain('file:')
    expect(url.toLowerCase()).not.toContain('c:/') // no local absolute path leaked
    expect(clip).toEqual([url]) // the field and the clipboard agree

    await openPayloadOnHttp(browser, url.split('#g1=')[1])
  })
})
