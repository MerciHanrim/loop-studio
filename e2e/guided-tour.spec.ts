import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, test } from './support/loop'

// docs/guided-tour.md §GT9 — the 19-point acceptance set for the guided
// first-run tour + Help menu + About dialog. UI-chrome only: nothing it does is
// serialized, digested, undone, or seen by the engine (§GT4 / §GT12).

const KEY = 'loop-studio/guided-tour/1'

type Bridge = {
  __loop: {
    tour: { getState: () => any }
    i18n: { getState: () => any }
    graph: { getState: () => any }
    sim: { getState: () => any }
    rf: { getViewport: () => { x: number; y: number; zoom: number } }
    revisionIO: { currentTargetDigest: () => string }
  }
}

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [{ id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } }],
})

/** seed the tour key before the FIRST app boot, overriding the support
 *  fixture's `dismissed` (this page-level init script is registered later, so it
 *  wins). A `sessionStorage` sentinel makes it a one-shot: a later
 *  `page.reload()` keeps whatever the tour just wrote. `null` = first-run state. */
const seedKey = (page: Page, v: 'completed' | 'dismissed' | 'garbage' | null) =>
  page.addInitScript(
    ([k, val]) => {
      try {
        if (sessionStorage.getItem('__tour_seeded')) return
        sessionStorage.setItem('__tour_seeded', '1')
        if (val == null) localStorage.removeItem(k)
        else localStorage.setItem(k, val)
      } catch {
        /* ignore */
      }
    },
    [KEY, v] as const,
  )

/** make every localStorage read + write throw (§GT6.3) */
const breakStorage = (page: Page) =>
  page.addInitScript(() => {
    const t = () => {
      throw new Error('blocked')
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: t, setItem: t, removeItem: t, clear: t, key: t, length: 0 },
    })
  })

const welcome = (page: Page) => page.locator('.tour-card')
const popover = (page: Page) => page.locator('.tour-popover')
const helpBtn = (page: Page) => page.locator('[data-tour="help-trigger"]')
const storedKey = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY)
const tourState = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState())

const openHelp = async (page: Page) => {
  await helpBtn(page).click()
  await expect(helpBtn(page)).toHaveAttribute('aria-expanded', 'true')
}

/** every document-owned + committed-engine surface (§GT9 case 12) */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      graph: JSON.stringify({
        nodes: g.nodes.map((n: any) => [n.id, n.position, n.data, n.selected ?? false]),
        edges: g.edges.map((e: any) => [e.id, e.source, e.target, e.data]),
      }),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      simulationRev: g.simulationRev,
      viewport: l.rf.getViewport(),
      values: JSON.stringify(s.values),
      stepIndex: s.stepIndex,
      status: s.status,
    }
  })

// ── 1 / 2 — first run & suppression ─────────────────────────────────────────
test.describe('guided tour — first run', () => {
  test('key absent ⇒ the Welcome card appears once after the app settles', async ({ page }) => {
    await seedKey(page, null)
    await openApp(page)
    await expect(welcome(page)).toBeVisible()
    await expect(welcome(page)).toHaveCount(1)
  })

  for (const v of ['completed', 'dismissed'] as const) {
    test(`key = ${v} ⇒ no Welcome card, no auto tour`, async ({ page }) => {
      await seedKey(page, v)
      await openApp(page)
      await page.waitForTimeout(400)
      await expect(welcome(page)).toHaveCount(0)
      await expect(popover(page)).toHaveCount(0)
    })
  }

  test('a corrupt stored value ⇒ treated as absent (card shown), and left untouched', async ({
    page,
  }) => {
    await seedKey(page, 'garbage') // an unrecognised string
    await openApp(page)
    await expect(welcome(page)).toBeVisible() // §GT6 — a bad value must not lock the tour out
    expect(await storedKey(page)).toBe('garbage') // never rewritten before an explicit choice
    await welcome(page).getByRole('button', { name: /Skip|건너뛰기/ }).click()
    expect(await storedKey(page)).toBe('dismissed') // now a real choice is recorded
  })

  test('Skip, then reload ⇒ the card does not return (key = dismissed)', async ({ page }) => {
    await seedKey(page, null)
    await openApp(page)
    await welcome(page).getByRole('button', { name: /Skip|건너뛰기/ }).click()
    await expect(welcome(page)).toHaveCount(0)
    expect(await storedKey(page)).toBe('dismissed')
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await page.waitForTimeout(400)
    await expect(welcome(page)).toHaveCount(0)
    await expect(popover(page)).toHaveCount(0)
  })

  test('finish the tour, then reload ⇒ no card, no auto tour (key = completed)', async ({ page }) => {
    await seedKey(page, null)
    await openApp(page)
    await welcome(page).getByRole('button', { name: /Start tour|투어 시작/ }).click()
    for (let i = 0; i < 5; i++) await popover(page).getByRole('button', { name: /Next|다음/ }).click()
    await popover(page).getByRole('button', { name: /Done|완료/ }).click()
    expect(await storedKey(page)).toBe('completed')
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await page.waitForTimeout(400)
    await expect(welcome(page)).toHaveCount(0)
    await expect(popover(page)).toHaveCount(0)
  })
})

// ── 3 / 4 — Help menu re-entry & contents ───────────────────────────────────
test.describe('guided tour — Help menu', () => {
  test('exactly two working items; no "Contextual help"', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await openHelp(page)
    const items = page.locator('.menu__pop[role="menu"] .menu__item')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText(/Take a tour|둘러보기/)
    await expect(items.nth(1)).toHaveText(/About Loop Studio|Loop Studio 정보/)
    await expect(page.locator('.menu__pop')).not.toContainText(/Contextual help|문맥/)
  })

  test('Take a tour re-opens the tour at step 1 and never rewrites the key', async ({ page }) => {
    await seedKey(page, 'dismissed')
    await openApp(page)
    await openHelp(page)
    await page.locator('.menu__pop .menu__item', { hasText: /Take a tour|둘러보기/ }).click()
    await expect(popover(page)).toBeVisible()
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('1 / 6')
    // walk to the end and finish → replay must NOT rewrite the key
    for (let i = 0; i < 5; i++) await popover(page).getByRole('button', { name: /Next|다음/ }).click()
    await popover(page).getByRole('button', { name: /Done|완료/ }).click()
    expect(await storedKey(page)).toBe('dismissed')
    // and again, exiting via Escape
    await openHelp(page)
    await page.locator('.menu__pop .menu__item', { hasText: /Take a tour|둘러보기/ }).click()
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    expect(await storedKey(page)).toBe('dismissed')
  })
})

// ── 5 — six steps, desktop ─────────────────────────────────────────────────
test.describe('guided tour — walkthrough', () => {
  test('desktop: Next 1→6, Back returns, Done ends; N / 6 correct', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    const pos = popover(page).locator('.tour-popover__pos')
    for (let n = 1; n <= 6; n++) {
      await expect(pos).toHaveText(`${n} / 6`)
      if (n < 6) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    }
    await popover(page).getByRole('button', { name: /Back|이전/ }).click()
    await expect(pos).toHaveText('5 / 6')
    await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    await popover(page).getByRole('button', { name: /Done|완료/ }).click()
    await expect(popover(page)).toHaveCount(0)
  })

  test('Back is disabled on step 1', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    await expect(popover(page).getByRole('button', { name: /Back|이전/ })).toBeDisabled()
  })
})

// ── 6 — locale on first visit ─────────────────────────────────────────────────
test.describe('guided tour — locale (ko browser)', () => {
  test.use({ locale: 'ko-KR' })
  test('a ko browser with no stored locale ⇒ Korean Welcome + tour', async ({ page }) => {
    await seedKey(page, null)
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('loop-studio/ui-locale/1')
      } catch {
        /* ignore */
      }
    })
    await openApp(page)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')
    await expect(welcome(page)).toContainText('환영')
    await welcome(page).getByRole('button', { name: '투어 시작' }).click()
    await expect(popover(page).locator('.tour-popover__title')).toHaveText('조각')
  })
})

test.describe('guided tour — locale (en browser)', () => {
  test.use({ locale: 'en-US' })
  test('a non-ko browser ⇒ English Welcome + tour', async ({ page }) => {
    await seedKey(page, null)
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('loop-studio/ui-locale/1')
      } catch {
        /* ignore */
      }
    })
    await openApp(page)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
    await expect(welcome(page)).toContainText('Welcome')
  })
})

// ── 7 — mid-tour locale reactivity (store-driven; §GT4) ─────────────────────
test.describe('guided tour — locale mid-tour', () => {
  test('an external setLocale re-renders the current step, keeps the position', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click() // step 2
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('2 / 6')
    await expect(popover(page).locator('.tour-popover__title')).toHaveText('Canvas')
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('ko'))
    await expect(popover(page).locator('.tour-popover__title')).toHaveText('캔버스')
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('2 / 6') // unchanged
    expect((await tourState(page)).step).toBe(1)
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('en'))
  })
})

// ── 8 — display priority: a busy visit skips the card ENTIRELY (§GT6.1) ─────
test.describe('guided tour — display priority (§GT6.1)', () => {
  test('a dialog up when the check runs ⇒ no card this visit, and none later; a clean reload shows it', async ({
    page,
  }) => {
    await seedKey(page, null)
    // bring a dialog up the instant the store bridge exists — before the
    // one-shot first-run check runs. ONE-SHOT (sentinel) so the later reload is
    // a genuinely clean visit.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__mcOpenedOnce')) return
      const iv = setInterval(() => {
        const l = (window as unknown as { __loop?: { mc?: { getState: () => { openDialog: () => void } } } }).__loop
        if (l?.mc) {
          sessionStorage.setItem('__mcOpenedOnce', '1')
          l.mc.getState().openDialog()
          clearInterval(iv)
        }
      }, 5)
    })
    await openApp(page)
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeVisible()
    await page.waitForTimeout(600) // well past the 250 ms check
    await expect(welcome(page)).toHaveCount(0) // §GT6.1 — skipped this visit

    // closing the dialog must NOT resurrect the card — the visit is over
    await page.locator('.mcdlg[role="dialog"] .mcdlg__x, .mcdlg[role="dialog"] button', { hasText: /Close|Cancel/ }).first().click()
    await expect(page.locator('.mcdlg[role="dialog"]')).toBeHidden()
    await page.waitForTimeout(600)
    await expect(welcome(page)).toHaveCount(0)
    expect(await storedKey(page)).toBeNull() // still first-run

    // a fresh visit with nothing up ⇒ the card appears
    await page.evaluate(() => sessionStorage.removeItem('__tour_seeded')) // let seedKey re-clear
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(welcome(page)).toBeVisible()
  })
})

// ── 9 — backdrop is inert ──────────────────────────────────────────────────
test.describe('guided tour — inert scrim (§GT4)', () => {
  test('a scrim click dismisses nothing and reaches nothing behind it', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    await expect(popover(page)).toBeVisible()
    // click the scrim, well away from the popover
    await page.locator('.tour-scrim').click({ position: { x: 5, y: 5 } })
    await expect(popover(page)).toBeVisible() // not dismissed
    // a click over the Help trigger does not open its menu
    const box = await helpBtn(page).boundingBox()
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(helpBtn(page)).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Escape')
  })
})

// ── 10 — localStorage unavailable ──────────────────────────────────────────
test.describe('guided tour — localStorage unavailable (§GT6.3)', () => {
  test('the app boots, the card is offered once, closing still works', async ({ page }) => {
    await seedKey(page, null) // enable the trigger; storage is broken next
    await breakStorage(page)
    await openApp(page)
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(welcome(page)).toBeVisible()
    await welcome(page).getByRole('button', { name: /Skip|건너뛰기/ }).click()
    await expect(welcome(page)).toHaveCount(0)
    // no crash, and it does not loop back on a re-render
    await page.locator('body').click()
    await page.waitForTimeout(300)
    await expect(welcome(page)).toHaveCount(0)
    // errors fixture (auto) asserts no console / page errors
  })
})

// ── 11 — overlay geometry ──────────────────────────────────────────────────
test.describe('guided tour — geometry', () => {
  test('every step: popover in the viewport, no document x-scroll, chrome unchanged', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    const geom = () =>
      page.evaluate(() => {
        const tb = document.querySelector('.toolbar') as HTMLElement
        const cv = document.querySelector('.canvas') as HTMLElement
        return {
          toolbarH: Math.round(tb.getBoundingClientRect().height),
          canvasTop: Math.round(cv.getBoundingClientRect().top),
          d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
          docScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
    await expect
      .poll(async () => {
        const g = await geom()
        return g.d.length > 0 && g.d.every(Boolean)
      })
      .toBe(true)
    const before = await geom()

    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    for (let n = 1; n <= 6; n++) {
      const pop = await popover(page).boundingBox()
      const vw = page.viewportSize()!.width
      const vh = page.viewportSize()!.height
      expect(pop!.x).toBeGreaterThanOrEqual(-1)
      expect(pop!.x + pop!.width).toBeLessThanOrEqual(vw + 1)
      expect(pop!.y).toBeGreaterThanOrEqual(-1)
      expect(pop!.y + pop!.height).toBeLessThanOrEqual(vh + 1)
      const g = await geom()
      expect(g.docScrollX).toBeLessThanOrEqual(1)
      if (n < 6) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    }
    await page.keyboard.press('Escape')
    expect(await geom()).toEqual(before) // toolbar / canvas / edge d untouched
  })
})

// ── 11b — the spotlight ring stays fully on screen (regression) ────────────
// The Canvas / Inspector / Playback / Timeline targets touch a viewport edge;
// the highlight border must not be half-clipped there (§GT4 forced-colors).
test.describe('guided tour — spotlight clamp', () => {
  // [step index, target selector] for the edge-touching regions of each script
  const DESKTOP: [number, string][] = [
    [1, '.canvas'],
    [2, 'aside.inspector'],
    [3, '.pstrip'],
    [4, '.timeline'],
  ]
  const MOBILE: [number, string][] = [
    [1, '.canvas'],
    [3, '.pstrip--mobile'],
  ]

  const checkSpotOnScreen = async (page: Page, platform: 'desktop' | 'mobile') => {
    await page.evaluate(
      (p) => (window as unknown as Bridge).__loop.tour.getState().startReplay(p),
      platform,
    )
    for (const [step, sel] of platform === 'mobile' ? MOBILE : DESKTOP) {
      await page.evaluate((s) => {
        const store = (window as unknown as Bridge).__loop.tour
        while (store.getState().step < s) store.getState().next()
        while (store.getState().step > s) store.getState().back()
      }, step)
      const spot = page.locator('.tour-spot')
      await expect(spot).toBeVisible()
      const box = await spot.evaluate((el) => {
        const b = el.getBoundingClientRect()
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
      })
      const vw = page.viewportSize()!.width
      const vh = page.viewportSize()!.height
      // the whole border line is inside the viewport, on every edge
      expect(box.left, `${sel} left`).toBeGreaterThanOrEqual(2)
      expect(box.top, `${sel} top`).toBeGreaterThanOrEqual(2)
      expect(box.right, `${sel} right`).toBeLessThanOrEqual(vw - 2)
      expect(box.bottom, `${sel} bottom`).toBeLessThanOrEqual(vh - 2)
      // …but the ring still covers its target (not moved off it)
      const tgt = await page.evaluate((s) => {
        const el = document.querySelector(s)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      }, sel)
      expect(tgt, `${sel} present`).not.toBeNull()
      const overlapW = Math.min(box.right, tgt!.right) - Math.max(box.left, tgt!.left)
      const overlapH = Math.min(box.bottom, tgt!.bottom) - Math.max(box.top, tgt!.top)
      expect(overlapW, `${sel} overlaps x`).toBeGreaterThan(20)
      expect(overlapH, `${sel} overlaps y`).toBeGreaterThan(20)
    }
    await page.keyboard.press('Escape')
  }

  test('desktop — ring fully visible on Canvas / Inspector / Playback / Timeline', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await checkSpotOnScreen(page, 'desktop')
  })

  test('390 px — the ring on Canvas + the run bar is fully visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await checkSpotOnScreen(page, 'mobile')
  })

  test('forced-colors — the same, and the ring keeps a non-hue outline', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await checkSpotOnScreen(page, 'desktop')
    // the spot has an outline under forced-colors (not hue-only)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    const outline = await page.locator('.tour-spot').evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
  })

  test('opening the tour leaves layout / viewport / node boxes unchanged', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await expect.poll(() => page.locator('.react-flow__edge path.react-flow__edge-path').count()).toBeGreaterThan(0)
    const geom = () =>
      page.evaluate(() => ({
        toolbar: JSON.stringify(document.querySelector('.toolbar')!.getBoundingClientRect()),
        canvasTop: Math.round(document.querySelector('.canvas')!.getBoundingClientRect().top),
        viewport: (window as unknown as Bridge).__loop.rf.getViewport(),
        nodes: [...document.querySelectorAll('.react-flow__node')].map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect()
          return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]
        }),
      }))
    const before = await geom()
    await page.evaluate(() => {
      const t = (window as unknown as Bridge).__loop.tour
      t.getState().startReplay('desktop')
      for (let i = 0; i < 5; i++) t.getState().next()
      for (let i = 0; i < 3; i++) t.getState().back()
    })
    await expect(page.locator('.tour-popover')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.tour-popover')).toHaveCount(0)
    expect(await geom()).toEqual(before)
  })
})

// ── 12 / 13 — invariance & payload ─────────────────────────────────────────
test.describe('guided tour — invariance', () => {
  test('walking the whole tour changes no GraphDoc / digest / undo / viewport / SimState', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await page.evaluate(() => {
      const s = (window as unknown as Bridge).__loop.sim.getState()
      s.advance()
      s.advance()
    })
    await expect.poll(() => page.locator('.react-flow__edge path.react-flow__edge-path').count()).toBeGreaterThan(0)
    const before = await snapshot(page)

    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    for (let i = 0; i < 5; i++) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    await popover(page).getByRole('button', { name: /Back|이전/ }).click()
    await popover(page).getByRole('button', { name: /Back|이전/ }).click()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)

    expect(await snapshot(page)).toEqual(before)
  })

  test('a run keeps playing while the tour is walked', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().play())
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().status)).toBe('running')
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    for (let i = 0; i < 5; i++) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    await popover(page).getByRole('button', { name: /Done|완료/ }).click()
    expect(await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().status)).toBe('running')
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
  })

  test('no `tour` / `guided-tour` key in any export; digest identical with the key set vs absent', async ({ page }) => {
    await seedKey(page, null)
    await openApp(page)
    await importGraph(page, G)
    await expect.poll(() => page.locator('.react-flow__edge path.react-flow__edge-path').count()).toBeGreaterThan(0)
    const exp = () =>
      page.evaluate(() => {
        const l = (window as unknown as Bridge).__loop as any
        return {
          digest: l.revisionIO.currentTargetDigest(),
          graph: l.graph.getState().exportJSON({}),
          ws: l.io.serializeWorkspaceFile(l.io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 })),
        }
      })
    const absent = await exp()
    // finish the tour so the key is written
    await welcome(page).getByRole('button', { name: /Start tour|투어 시작/ }).click()
    for (let i = 0; i < 5; i++) await popover(page).getByRole('button', { name: /Next|다음/ }).click()
    await popover(page).getByRole('button', { name: /Done|완료/ }).click()
    expect(await storedKey(page)).toBe('completed')
    const withKey = await exp()
    expect(withKey.digest).toBe(absent.digest) // §GT9 case 13
    expect(withKey.graph).toBe(absent.graph)
    expect(withKey.graph + withKey.ws).not.toMatch(/guided-tour|"tour"/)
  })
})

// ── 14 — a11y ──────────────────────────────────────────────────────────────
test.describe('guided tour — a11y', () => {
  test('Escape ends; focus is trapped and returns to the trigger', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await openHelp(page)
    await page.locator('.menu__pop .menu__item', { hasText: /Take a tour|둘러보기/ }).click()
    await expect(popover(page)).toBeVisible()
    // Tab a few times — focus stays inside the popover
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(
        () => !!document.querySelector('.tour-popover')?.contains(document.activeElement),
      )
      expect(inside).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(helpBtn(page)).toBeFocused()
  })
})

// ── 15 — missing target ────────────────────────────────────────────────────
test.describe('guided tour — missing target (§GT4)', () => {
  test('a step whose anchor is gone shows the centred card and still navigates', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => document.querySelector('[data-tour="timeline"]')?.setAttribute('data-tour', 'x'))
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    for (let i = 0; i < 4; i++) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click() // step 5 = timeline
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('5 / 6')
    await expect(popover(page)).toHaveClass(/tour-popover--centred/)
    await expect(page.locator('.tour-spot')).toHaveCount(0)
    await popover(page).getByRole('button', { name: /Back|이전/ }).click()
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('4 / 6')
    await page.keyboard.press('Escape')
  })
})

// ── 16 / 17 — reduced-motion & forced-colors ───────────────────────────────
test.describe('guided tour — viewing conditions', () => {
  test.use({ reducedMotion: 'reduce' })
  test('reduced-motion: the popover / spot have no transition between steps', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    const durs = await page.evaluate(() =>
      ['.tour-popover', '.tour-spot'].map((s) => {
        const el = document.querySelector(s)
        return el ? getComputedStyle(el).transitionDuration : '0s'
      }),
    )
    for (const d of durs) expect(d).toBe('0s') // no move / slide / fade (§GT4)
  })

  test.describe('forced-colors', () => {
    test.use({ forcedColors: 'active' })
    test('the spotlight + popover stay outlined without relying on hue', async ({ page }) => {
      await seedKey(page, 'completed')
      await openApp(page)
      await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
      // a border (kept by forced-colors as a system border) OR an outline
      const spot = await page.locator('.tour-spot').evaluate((el) => {
        const c = getComputedStyle(el)
        return { border: c.borderTopStyle, borderW: parseFloat(c.borderTopWidth), outline: c.outlineStyle }
      })
      const pop = await page.locator('.tour-popover').evaluate((el) => getComputedStyle(el).borderTopStyle)
      expect(spot.border !== 'none' && spot.borderW > 0).toBeTruthy()
      expect(pop).not.toBe('none')
      await page.keyboard.press('Escape')
    })
  })
})

// ── 18 — long Korean, 390 px ───────────────────────────────────────────────
test.describe('guided tour — long Korean at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('the popover wraps and stays on-screen; no horizontal document scroll', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('ko'))
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ko')
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('mobile'))
    for (let n = 1; n <= 6; n++) {
      const pop = await popover(page).boundingBox()
      expect(pop!.x).toBeGreaterThanOrEqual(-1)
      expect(pop!.x + pop!.width).toBeLessThanOrEqual(391)
      const sx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(sx).toBeLessThanOrEqual(1)
      if (n < 6) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    }
    await page.keyboard.press('Escape')
  })

  test('mobile step 6 points at the closed More button and opens no sheet', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('mobile'))
    for (let i = 0; i < 5; i++) await popover(page).getByRole('button', { name: /^(Next|다음)$/ }).click()
    await expect(popover(page).locator('.tour-popover__pos')).toHaveText('6 / 6')
    await expect(page.locator('.sheet')).toHaveCount(0) // no More sheet
    await popover(page).getByRole('button', { name: /Done|완료/ }).click()
  })
})

// ── 19 — About dialog ──────────────────────────────────────────────────────
test.describe('guided tour — About dialog (§GT7.1)', () => {
  test('opens from Help, shows the build stamp, copyright is locale-invariant', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    const stamp = await page.locator('.toolbar__build').innerText()

    await openHelp(page)
    await page.locator('.menu__pop .menu__item', { hasText: /About Loop Studio|Loop Studio 정보/ }).click()
    const dlg = page.locator('.mcdlg--about')
    await expect(dlg).toBeVisible()
    // same version + sha as the toolbar stamp
    const sha = stamp.replace(/^v[\d.\-a-z]+\s*·?\s*/, '').trim()
    if (sha) await expect(dlg.locator('.about__version')).toContainText(sha)
    await expect(dlg).toContainText('Copyright © 2026 Hanrim. All rights reserved.')
    // the GitHub repository link — fixed href, opens in a new tab, EN text + aria
    const repoLink = dlg.locator('.about__by a')
    await expect(repoLink).toHaveAttribute('href', 'https://github.com/MerciHanrim/loop-studio')
    await expect(repoLink).toHaveAttribute('target', '_blank')
    await expect(repoLink).toHaveText('GitHub repository')
    await expect(repoLink).toHaveAttribute('aria-label', 'Loop Studio GitHub repository')
    const enNote = await dlg.locator('.about__note').innerText()

    // KO: copyright line byte-identical; the note + the repo link text/aria switch
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('ko'))
    await expect(dlg).toContainText('Copyright © 2026 Hanrim. All rights reserved.')
    await expect(dlg.locator('.about__by')).toContainText('제작:')
    await expect(repoLink).toHaveText('GitHub 저장소')
    await expect(repoLink).toHaveAttribute('aria-label', 'Loop Studio GitHub 저장소')
    await expect(repoLink).toHaveAttribute('href', 'https://github.com/MerciHanrim/loop-studio') // href never changes
    expect(await dlg.locator('.about__note').innerText()).not.toBe(enNote)

    // §GT9 case 19 — each of Escape / backdrop / close returns focus to the Help trigger
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(helpBtn(page)).toBeFocused()

    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('en'))
    for (const how of ['backdrop', 'close'] as const) {
      await openHelp(page)
      await page.locator('.menu__pop .menu__item', { hasText: /About Loop Studio/ }).click()
      await expect(dlg).toBeVisible()
      if (how === 'backdrop') {
        // a mousedown on the scrim, away from any focusable chrome, closes it
        await page.locator('.mcdlg__scrim').dispatchEvent('mousedown')
      } else {
        await dlg.locator('.mcdlg__x').click()
      }
      await expect(dlg).toHaveCount(0)
      await expect(helpBtn(page)).toBeFocused()
    }
  })

  test('opening + closing About mutates nothing; no payload key', async ({ page }) => {
    await seedKey(page, 'completed')
    await openApp(page)
    await importGraph(page, G)
    await expect.poll(() => page.locator('.react-flow__edge path.react-flow__edge-path').count()).toBeGreaterThan(0)
    const before = await snapshot(page)
    await openHelp(page)
    await page.locator('.menu__pop .menu__item', { hasText: /About Loop Studio/ }).click()
    await expect(page.locator('.mcdlg--about')).toBeVisible()
    await page.locator('.mcdlg--about .mcdlg__x').click()
    await expect(page.locator('.mcdlg--about')).toHaveCount(0)
    expect(await snapshot(page)).toEqual(before)
  })
})
