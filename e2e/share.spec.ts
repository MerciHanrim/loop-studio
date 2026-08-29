import type { Dialog, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// SEMANTICS-U.md loop-share/1 — the `Share` button (§U7), the §U3.1 8 KiB hard
// reject, the Clipboard-API fallback, and the boot-time `#g1=` load (§U5),
// exercised through the real UI.

type Bridge = {
  __loop: Record<string, { getState: () => any } & Record<string, unknown>>
}

/** Stub `navigator.clipboard.writeText` so tests can read what was copied and
 *  force the failure path. `window.__clipMode = 'fail'` makes it throw. */
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as any).__clipWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          if ((window as any).__clipMode === 'fail') throw new Error('denied')
          ;(window as any).__clipWrites.push(t)
        },
      },
    })
  })
}

const clipWrites = (page: Page) => page.evaluate(() => (window as any).__clipWrites as string[])
const locationParts = (page: Page) =>
  page.evaluate(() => ({ hash: location.hash, href: location.href, origin: location.origin, pathname: location.pathname }))

/** A real cross-document load of `url` (Playwright treats a hash-only `goto` as
 *  same-document and would not remount `ShareLoader`), then wait for the app to
 *  boot AND for `ShareLoader` to settle the fragment (a `#g<n>` fragment is
 *  gone once consumed; a foreign fragment stays). */
async function freshGoto(page: Page, url: string): Promise<void> {
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.waitForFunction(() => Boolean((window as any).__loop))
  await page.waitForFunction(() => !/^#g\d/.test(location.hash), undefined, { timeout: 5000 })
}

const shareBtn = (page: Page) => page.locator('.toolbar__actions button', { hasText: /^Share$/ })
const sharePop = (page: Page) => page.locator('.share-pop')

/** Build a distinctive graph through the bridge: Source "α ⚙" ─3→ Pool "β 보물". */
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
    const e = (window as unknown as Bridge).__loop.graph.getState().edges[0]
    gs.setEdgeData(e.id, { kind: 'resource', flow: '3' })
  })
}

const labelsOf = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Bridge).__loop.graph.getState().nodes.map((n: any) => n.data.label).sort(),
  )

test.beforeEach(async ({ page }) => {
  await stubClipboard(page)
  await openApp(page)
  await resetAll(page)
})

test('the Share button sits between Import and Export ▾', async ({ page }) => {
  const labels = await page.locator('.toolbar__actions button').allInnerTexts()
  const compact = labels.map((s) => s.trim()).filter(Boolean)
  expect(compact).toContain('Share')
  expect(compact.indexOf('Share')).toBeGreaterThan(compact.indexOf('Import'))
  expect(compact.indexOf('Share')).toBeLessThan(compact.indexOf('Export ▾'))
})

test('happy path: disclosure → link copied, shown selectably, address bar untouched', async ({
  page,
}) => {
  await seedGraph(page)
  const before = await locationParts(page)

  page.once('dialog', (d: Dialog) => {
    expect(d.type()).toBe('confirm')
    expect(d.message()).toMatch(/anyone with the link/i)
    void d.accept()
  })
  await shareBtn(page).click()

  await expect(sharePop(page)).toBeVisible()
  await expect(page.locator('.share-pop__status')).toHaveText(/copied/i)
  const url = await page.locator('.share-pop__url').inputValue()
  expect(url).toMatch(/^https?:\/\/[^#]+#g1=[A-Za-z0-9_-]+$/)
  expect(url.startsWith(before.origin + before.pathname + '#g1=')).toBe(true)

  expect(await clipWrites(page)).toEqual([url]) // exactly what the field shows
  const after = await locationParts(page)
  expect(after.href).toBe(before.href) // Share never touches the address bar
  expect(after.hash).toBe('')
})

test('disclosure cancelled ⇒ nothing: no popover, no clipboard write, no address change', async ({
  page,
}) => {
  await seedGraph(page)
  const before = await locationParts(page)
  page.once('dialog', (d) => void d.dismiss())
  await shareBtn(page).click()
  await page.waitForTimeout(200)
  await expect(sharePop(page)).toHaveCount(0)
  expect(await clipWrites(page)).toEqual([])
  expect((await locationParts(page)).href).toBe(before.href)
})

test('Clipboard API denied ⇒ the link is still shown for manual copy', async ({ page }) => {
  await seedGraph(page)
  await page.evaluate(() => ((window as any).__clipMode = 'fail'))
  page.once('dialog', (d) => void d.accept())
  await shareBtn(page).click()

  await expect(sharePop(page)).toBeVisible()
  await expect(page.locator('.share-pop__status')).toHaveText(/copy this link/i)
  const url = await page.locator('.share-pop__url').inputValue()
  expect(url).toContain('#g1=')
  expect(await clipWrites(page)).toEqual([]) // nothing landed on the clipboard
})

test('over 8 KiB ⇒ alert, and NEITHER the clipboard NOR the address bar change', async ({
  page,
}) => {
  await seedGraph(page)
  await page.evaluate(() => ((window as any).__shareMaxBytes = 200)) // DEV seam: tiny cap
  const before = await locationParts(page)

  const seen: string[] = []
  page.on('dialog', (d) => {
    seen.push(`${d.type()}:${d.message().slice(0, 20)}`)
    void d.accept() // accept the disclosure AND dismiss-via-accept the alert
  })
  await shareBtn(page).click()
  await page.waitForTimeout(300)

  expect(seen.some((s) => s.startsWith('alert'))).toBe(true)
  await expect(sharePop(page)).toHaveCount(0)
  expect(await clipWrites(page)).toEqual([])
  expect((await locationParts(page)).href).toBe(before.href)
})

test('round-trip: opening the copied link restores the graph and strips the fragment', async ({
  page,
}) => {
  await seedGraph(page)
  const expected = await labelsOf(page)

  page.once('dialog', (d) => void d.accept())
  await shareBtn(page).click()
  const url = await page.locator('.share-pop__url').inputValue()

  // clear persistence so the shared link opens on a pristine boot (no prompt)
  await page.evaluate(() => localStorage.clear())
  await freshGoto(page, url)

  expect(await labelsOf(page)).toEqual(expected)
  expect((await locationParts(page)).hash).toBe('')
  const st = await page.evaluate(() => {
    const L = (window as unknown as Bridge).__loop
    return { sim: L.sim.getState().status, rev: L.graph.getState().simulationRev, pristine: L.graph.getState().pristineSample }
  })
  expect(st.sim).not.toBe('running')
  expect(st.rev).toBe(1) // exactly one bump from the load
  expect(st.pristine).toBe(false)
})

test('foreign fragment (#section) is left in the address bar; app boots normally', async ({
  page,
}) => {
  await freshGoto(page, '/#section-2')
  expect((await locationParts(page)).hash).toBe('#section-2')
})

test('an unsupported `#g2=` link boots normally and the dead fragment is stripped', async ({
  page,
}) => {
  await freshGoto(page, '/#g2=AAAABBBB')
  expect((await locationParts(page)).hash).toBe('')
  // no console.error (the base fixture asserts this); a console.warn is expected
})

test('a malformed `#g1` link boots normally and the fragment is stripped', async ({ page }) => {
  await freshGoto(page, '/#g1')
  expect((await locationParts(page)).hash).toBe('')
})

test('a modified session prompts before replacing; Cancel keeps the graph, OK replaces it', async ({
  page,
}) => {
  await seedGraph(page)
  const original = await labelsOf(page)

  page.once('dialog', (d) => void d.accept()) // disclosure
  await shareBtn(page).click()
  const url = await page.locator('.share-pop__url').inputValue()

  // diverge the graph so the next boot is NOT pristine, and let the store's
  // debounced (400 ms) localStorage save land before we navigate away
  await page.evaluate(() => {
    const gs = (window as unknown as Bridge).__loop.graph.getState()
    gs.addNodeAt('end', { x: 500, y: 0 })
    gs.updateNodeData(gs.nodes.at(-1).id, { label: 'DIVERGED' })
  })
  await page.waitForTimeout(600)

  // Cancel the replace → keep the diverged graph, fragment still stripped
  page.once('dialog', (d) => {
    expect(d.message()).toMatch(/replaced/i)
    void d.dismiss()
  })
  await freshGoto(page, url)
  expect(await labelsOf(page)).toContain('DIVERGED')
  expect((await locationParts(page)).hash).toBe('')

  // Accept the replace → the shared graph wins
  page.once('dialog', (d) => void d.accept())
  await freshGoto(page, url)
  expect(await labelsOf(page)).toEqual(original)
  expect((await locationParts(page)).hash).toBe('')
})
