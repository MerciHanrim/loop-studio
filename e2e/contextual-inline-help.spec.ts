import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/contextual-inline-help.md §CIH8 — the contextual-help acceptance set.
// Presentation only: nothing here is serialized, digested, undone, or seen by
// the engine (§CIH7); every test that touches the graph checks the digest is
// unmoved. `window.__loop.hint` is the dev-only zustand-hook bridge for
// `hintStore` (src/main.tsx).

const HINT_KEY = 'loop-studio/contextual-help/1'

type Bridge = {
  __loop: {
    hint: { getState: () => any; setState: (p: object) => void }
    tour: { getState: () => any; setState: (p: object) => void }
    ui: { getState: () => any; setState: (p: object) => void }
    autoFrame: { setState: (p: object) => void }
    graph: { getState: () => any }
    mc: { getState: () => any }
    review: { getState: () => any }
    project: { getState: () => any }
  }
}

const hintNote = (page: Page) => page.locator('.hint-note')
const seenKeys = (page: Page) =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k)
    return raw ? Object.keys(JSON.parse(raw)) : []
  }, HINT_KEY)
const gDigest = (page: Page) =>
  page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }, { modelVersion: g.modelVersion }))
  })

/** force the tour to idle and clear its post-close cooldown, so a hint's own
 *  trigger is the only thing under test (§CIH2.3a is covered separately). */
async function settleTour(page: Page): Promise<void> {
  await page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    l.tour.setState({ phase: 'idle' })
    l.hint.setState({ postTourCooldownActive: false })
  })
}

/** A localStorage where every WRITE throws but reads still work — the
 *  literal "write failure" scenario (e.g. quota exceeded), unlike blanking
 *  the whole API. Pre-seeded with the tour key already `dismissed`: reading
 *  it *works* here (only writing doesn't), and `GuidedTour.tsx`'s
 *  `readTourKey() != null` guard needs that real read to skip scheduling its
 *  own 250ms auto-offer check — otherwise that timer can fire mid-test (a
 *  real race caught on a slower CI runner, not a product bug) and permanently
 *  flip the tour out of idle from underneath an unrelated hint assertion. */
function installWriteOnlyFailure(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const store = new Map<string, string>([['loop-studio/guided-tour/1', 'dismissed']])
    const t = () => {
      throw new Error('quota')
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => store.delete(k),
        key: (i: number) => [...store.keys()][i] ?? null,
        setItem: t,
        clear: t,
        get length() {
          return store.size
        },
      },
    })
  })
}

// a dense, 9-node graph — past WORTH_IT_FLOOR (8) — for the Focus/Filter hint.
const GRAPH_9 = (() => {
  const nodes: unknown[] = []
  const edges: unknown[] = []
  for (let i = 0; i < 9; i++) {
    nodes.push({
      id: `p${i}`,
      type: 'pool',
      position: { x: i * 120, y: 0 },
      data: { kind: 'pool', label: `P${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
    })
    if (i > 0) edges.push({ id: `e${i}`, type: 'loop', source: `p${i - 1}`, target: `p${i}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })
  }
  return JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges })
})()

const REV_DIR = resolve(import.meta.dirname, '..', 'examples', 'revision')
const BASE_REVISION = readFileSync(resolve(REV_DIR, 'base.revision.json'), 'utf8')
const PROPOSAL_CLEAN = readFileSync(resolve(REV_DIR, 'proposal.clean.json'), 'utf8')

test.describe('contextual inline help — empty canvas (§CIH3 #1)', () => {
  test('shows once on a genuinely empty canvas; seen recorded at render time, not on ✕ (§CIH2.1a)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await expect(hintNote(page)).toBeVisible()
    await expect(hintNote(page)).toHaveAttribute('role', 'note')
    // recorded already — no click yet
    expect(await seenKeys(page)).toContain('empty-canvas')
  })

  test('Escape does not dismiss it; the ✕ does', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await expect(hintNote(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(hintNote(page)).toBeVisible()
    await hintNote(page).getByRole('button').click()
    await expect(hintNote(page)).toHaveCount(0)
  })

  test('auto-clears the moment a node exists, and never reappears even if the canvas empties again', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await expect(hintNote(page)).toBeVisible()
    await importGraph(page, GRAPH_9)
    await expect(hintNote(page)).toHaveCount(0)
    await resetAll(page) // back to 0 nodes
    await page.waitForTimeout(200)
    await expect(hintNote(page)).toHaveCount(0) // stays gone for this session
  })

  test('does not render mid-tour', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.setState({ phase: 'running', step: 1 }))
    await page.waitForTimeout(200)
    await expect(hintNote(page)).toHaveCount(0)
  })

  test('a corrupt stored value never blocks the app or the hint (§GT6.3 precedent)', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, 'not json'), HINT_KEY)
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await expect(page.locator('.canvas')).toBeVisible()
    await expect(hintNote(page)).toBeVisible()
  })

  test('a localStorage write failure never blocks the app (non-fatal try/catch)', async ({ page }) => {
    await installWriteOnlyFailure(page)
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await expect(hintNote(page)).toBeVisible()
    await hintNote(page).getByRole('button').click()
    await expect(page.locator('.canvas')).toBeVisible() // still usable
  })

  test('never moves the graph digest / undo stack', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    const before = await gDigest(page)
    const canUndoBefore = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)
    await expect(hintNote(page)).toBeVisible()
    await hintNote(page).getByRole('button').click()
    expect(await gDigest(page)).toBe(before)
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().canUndo)).toBe(canUndoBefore)
  })
})

test.describe('contextual inline help — Monte Carlo & Review first open (§CIH3 #2 / #3, priority tier 1)', () => {
  test('Monte Carlo: shows on first open, not on a later re-open', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.mc.getState().openDialog())
    await expect(page.locator('.hint-note--inline')).toBeVisible()
    await expect(page.locator('.hint-note--inline')).toHaveAttribute('role', 'note')
    await page.evaluate(() => (window as unknown as Bridge).__loop.mc.getState().closeDialog())
    await page.evaluate(() => (window as unknown as Bridge).__loop.mc.getState().openDialog())
    await expect(page.locator('.hint-note--inline')).toHaveCount(0)
  })

  test('Review: shows the first time a shared proposal opens for review', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.review.getState().close()
      l.project.getState().clear()
    })
    await page.setInputFiles('.toolbar__actions input[type=file]', {
      name: 'base.json',
      mimeType: 'application/json',
      buffer: Buffer.from(BASE_REVISION),
    })
    await page.setInputFiles('.toolbar__actions input[type=file]', {
      name: 'proposal.json',
      mimeType: 'application/json',
      buffer: Buffer.from(PROPOSAL_CLEAN),
    })
    await expect(page.locator('.review')).toBeVisible()
    await expect(page.locator('.review .hint-note--inline')).toBeVisible()
  })
})

test.describe('contextual inline help — Focus/Filter discovery (§CIH3 #4)', () => {
  test('does not fire hastily right after a large Template/graph load — waits for interaction or the fallback delay', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await importGraph(page, GRAPH_9)
    // immediately after load: neither a real interaction nor the fallback
    // delay has happened yet
    await page.waitForTimeout(150)
    await expect(hintNote(page)).toHaveCount(0)
    // a real canvas interaction satisfies the gate immediately
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await expect(hintNote(page)).toBeVisible()
  })

  test('auto-clears the instant Focus is turned on, and does not reappear when turned back off', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await importGraph(page, GRAPH_9)
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await expect(hintNote(page)).toBeVisible()
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().toggleFocusMode())
    await expect(hintNote(page)).toHaveCount(0)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().toggleFocusMode())
    await page.waitForTimeout(150)
    await expect(hintNote(page)).toHaveCount(0)
  })

  test('yields the shared top-center slot to an existing LGR notice, then re-evaluates once it clears (tier 2 over tier 3, §CIH2.3a)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await importGraph(page, GRAPH_9)
    await page.evaluate(() =>
      (window as unknown as Bridge).__loop.autoFrame.setState({
        autoFrames: [{ id: 'af1', area: 100, label: '', rect: { x: 0, y: 0, w: 10, h: 10 }, members: ['p0', 'p1'] }],
      }),
    )
    await expect(page.locator('.lgr-suggest-note')).toBeVisible()
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await page.waitForTimeout(150)
    await expect(hintNote(page)).toHaveCount(0) // the discovery hint stays out of the way
    // clearing the LGR notice frees the slot — the discovery hint was only
    // ever WAITING (`ready` gate), never permanently burned by the wait
    await page.evaluate(() => (window as unknown as Bridge).__loop.autoFrame.setState({ autoFrames: [] }))
    await expect(page.locator('.lgr-suggest-note')).toHaveCount(0)
    await expect(hintNote(page)).toBeVisible()
  })

  test('already discovered before the hint ever got a chance to show ⇒ never appears afterward', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    // Focus is toggled on-then-off WHILE still under WORTH_IT_FLOOR, well
    // before any of the hint's gates could possibly let it show
    await page.evaluate(() => {
      const ui = (window as unknown as Bridge).__loop.ui.getState()
      ui.toggleFocusMode()
      ui.toggleFocusMode()
    })
    await importGraph(page, GRAPH_9)
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await page.waitForTimeout(150)
    await expect(hintNote(page)).toHaveCount(0) // never shows — already "discovered"
  })

  test('ready flips off mid-tour and back on after it ends + the cooldown clears — the hint is not lost, only delayed', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await importGraph(page, GRAPH_9)
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await expect(hintNote(page)).toBeVisible() // trigger + ready both true
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.setState({ phase: 'running' }))
    await expect(hintNote(page)).toHaveCount(0) // ready → false while the tour runs; NOT burned
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.setState({ phase: 'idle' }))
    await expect(hintNote(page)).toHaveCount(0) // still inside the post-tour cooldown
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.hint.getState().postTourCooldownActive), {
        timeout: 3000,
      })
      .toBe(false)
    await expect(hintNote(page)).toBeVisible() // reappears — trigger was never cleared, only gated
  })

  test('a localStorage write failure never blocks the hint or the app', async ({ page }) => {
    await installWriteOnlyFailure(page)
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await importGraph(page, GRAPH_9)
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await expect(hintNote(page)).toBeVisible()
    await hintNote(page).getByRole('button').click()
    await expect(page.locator('.canvas')).toBeVisible() // still usable
  })
})

test.describe('contextual inline help — post-tour cooldown (§CIH2.3a)', () => {
  test('no discovery hint pile-up immediately after the tour closes', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.tour.setState({ phase: 'running' })
      l.tour.setState({ phase: 'idle' }) // the exit transition that arms the cooldown
    })
    await page.waitForTimeout(200)
    await expect(hintNote(page)).toHaveCount(0) // empty-canvas would otherwise be eligible
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.hint.getState().postTourCooldownActive), {
        timeout: 3000,
      })
      .toBe(false)
    await expect(hintNote(page)).toBeVisible()
  })
})

test.describe('contextual inline help — Help menu dialog (§CIH4)', () => {
  test('lists all four hints; "Show again next time" re-arms without forcing immediate display', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await expect(hintNote(page)).toBeVisible() // marks empty-canvas seen
    await importGraph(page, GRAPH_9) // clear the note off-screen, keep it seen

    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem').filter({ hasText: 'Contextual help' }).click()
    const dlg = page.locator('.mcdlg--contextual-help')
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.contextual-help__row')).toHaveCount(4)

    const emptyRow = dlg.locator('.contextual-help__row').filter({ hasText: 'Empty canvas' })
    await expect(emptyRow.getByRole('button', { name: 'Show again next time' })).toBeEnabled()
    await emptyRow.getByRole('button', { name: 'Show again next time' }).click()
    expect(await seenKeys(page)).not.toContain('empty-canvas')
    // rearm ≠ immediate render — the canvas has 9 nodes right now, condition false
    await expect(hintNote(page)).toHaveCount(0)

    const reviewRow = dlg.locator('.contextual-help__row').filter({ hasText: 'Review' })
    await expect(reviewRow.getByRole('button', { name: 'Show again next time' })).toBeDisabled()
  })
})

test.describe('contextual inline help — mobile (§CIH6)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('empty canvas: no CIH note — MobileOpenFileHint owns this moment, no competition', async ({ page }) => {
    // the natural first-open mobile state: still the built-in sample
    // (pristineSample), never yet edited — exactly when MobileOpenFileHint
    // shows. `resetAll`'s `newGraph()` would itself clear pristineSample, so
    // this checks the real "still pristine" moment, not a forced empty one.
    await openApp(page)
    await settleTour(page)
    await expect(page.locator('.openhint')).toBeVisible()
    await expect(hintNote(page)).toHaveCount(0)

    // even forced to a genuinely empty (non-pristine) graph, the CIH note
    // still never appears on mobile — the gate is unconditional, not merely
    // incidental to the pristine-sample state above.
    await resetAll(page)
    await page.waitForTimeout(200)
    await expect(hintNote(page)).toHaveCount(0)
  })

  test('Focus/Filter discovery shows above the More sheet rows once eligible', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await importGraph(page, GRAPH_9)
    await page.locator('.canvas').dispatchEvent('pointerdown')
    await page.locator('.mob-more').click()
    await expect(page.locator('.hint-note--inline')).toBeVisible()
  })

  test('Help sub-sheet includes Contextual help, opening the shared dialog', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await page.locator('.mob-more').click()
    await page.locator('.sheet__row').filter({ hasText: 'Help' }).click()
    await page.locator('.sheet__row').filter({ hasText: 'Contextual help' }).click()
    await expect(page.locator('.mcdlg--contextual-help')).toBeVisible()
  })
})
