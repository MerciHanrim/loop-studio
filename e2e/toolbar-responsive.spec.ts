import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// The toolbar's fixed two-tier contract (src/components/toolbar/*;
// docs/toolbar-responsive.md). Tier 1 (brand + app commands) is always one
// row; Tier 2 (the node palette) is always its own row — the row count never
// varies by width or by locale. Boundary checkpoints:
//   720×720  → MobileTopBar, no desktop toolbar/palette at all
//   721×720  → desktop two-tier begins; Tier 1 must fit even at its widest
//              RevisionChip state
//   820×720  → desktop two-tier checkpoint (the doc's other tested width)
//   1280/1600/1920 → general desktop checkpoints
// Collapse order (which GROUP moves into ⋯ first) is a separate question
// from render order, which is always Module → File → Data → Share →
// Settings → Help, whether inline or inside ⋯.

const htmlLang = (p: Page) => p.evaluate(() => document.documentElement.lang)

async function setLocale(page: Page, code: string) {
  await page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => htmlLang(page)).toBe(code)
  await page.waitForTimeout(120)
}

type RevState = null | { role: 'revision' | 'proposal'; dirty: boolean }

/** Directly drives `useProjectStore`'s `open`/`dirty` fields (bypassing the
 *  real revision-export flow — not needed to exercise `RevisionChip`'s
 *  rendering) so every state — no project, revision × clean/dirty,
 *  proposal × clean/dirty — can be measured, per review condition 4. */
async function setRevisionChip(page: Page, state: RevState): Promise<void> {
  await page.evaluate((s) => {
    const store = (window as any).__loop.project
    if (!s) {
      store.setState({ open: null, dirty: false })
      return
    }
    store.setState({
      open: {
        projectId: 'proj_e2etest',
        revisionId: 'rev_abcdef123456',
        role: s.role,
        parentId: null,
        lineage: [],
        baselineDigest: 'unused-in-this-test',
      },
      dirty: s.dirty,
    })
  }, state)
}

type Metrics = {
  toolbarRows: number
  tier2Rows: number
  docHScroll: boolean
  tier1HScroll: boolean
  anyButtonWraps: boolean
  overlapsInspector: boolean
}

const readMetrics = (page: Page): Promise<Metrics> =>
  page.evaluate(() => {
    const tb = document.querySelector('.toolbar') as HTMLElement
    const palette = document.querySelector('.toolbar__palette') as HTMLElement
    const actions = document.querySelector('.toolbar__actions') as HTMLElement
    const insp = document.querySelector('aside.inspector') as HTMLElement | null
    const r = (e: Element) => e.getBoundingClientRect()

    const kidTops = [...tb.children]
      .filter((c) => getComputedStyle(c).position !== 'absolute' && (c as HTMLElement).offsetParent !== null)
      .map((c) => Math.round(r(c).top))
      .sort((a, b) => a - b)
    let toolbarRows = kidTops.length ? 1 : 0
    for (let i = 1; i < kidTops.length; i++) if (kidTops[i] - kidTops[i - 1] > 6) toolbarRows++

    const chipTops = [...new Set([...palette.querySelectorAll('.chip')].map((c) => Math.round(r(c).top)))]

    const buttons = [...tb.querySelectorAll('.btn, .chip')].filter(
      (b) => getComputedStyle(b).position !== 'absolute' && (b as HTMLElement).offsetParent !== null,
    ) as HTMLElement[]
    const anyButtonWraps = buttons.some((b) => b.scrollHeight > b.clientHeight + 1)

    let overlapsInspector = false
    if (insp) {
      const ir = r(insp)
      overlapsInspector = buttons.some((b) => {
        const br = r(b)
        return br.right > ir.left && br.left < ir.right && br.bottom > ir.top && br.top < ir.bottom
      })
    }

    return {
      toolbarRows,
      tier2Rows: chipTops.length,
      docHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      tier1HScroll: actions.scrollWidth > actions.clientWidth + 1,
      anyButtonWraps,
      overlapsInspector,
    }
  })

const fullyInViewport = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].filter(
      (e) => (e as HTMLElement).getBoundingClientRect().height > 0,
    ).pop() as HTMLElement | undefined
    if (!el) return { found: false, ok: false }
    const r = el.getBoundingClientRect()
    return {
      found: true,
      ok:
        r.top >= -2 &&
        r.left >= -2 &&
        r.right <= window.innerWidth + 2 &&
        r.bottom <= window.innerHeight + 2,
    }
  }, selector)

test.describe('toolbar — the fixed two-tier contract', () => {
  test('720×720 shows the mobile top bar, not the desktop toolbar or palette', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 720 })
    await openApp(page)
    await resetAll(page)
    expect(await page.locator('.toolbar--mobile, .mobile-topbar').count()).toBeGreaterThan(0)
    expect(await page.locator('.toolbar__palette').count()).toBe(0)
  })

  for (const [w, h] of [
    [721, 720],
    [820, 720],
    [1280, 720],
    [1600, 900],
    [1920, 900],
  ] as const) {
    test(`${w}×${h}: exactly 2 rows total, palette is a single row, no h-scroll, no label wrap — EN/JA/KO`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h })
      await openApp(page)
      await resetAll(page)

      for (const code of ['en', 'ja', 'ko']) {
        await setLocale(page, code)
        const m = await readMetrics(page)
        expect(m.toolbarRows, `${code} @ ${w}×${h} — toolbar rows`).toBe(2)
        expect(m.tier2Rows, `${code} @ ${w}×${h} — palette rows`).toBe(1)
        expect(m.anyButtonWraps, `${code} @ ${w}×${h} — label wraps`).toBe(false)
        expect(m.overlapsInspector, `${code} @ ${w}×${h} — overlaps inspector`).toBe(false)
        if (w < 721 || w > 819) {
          // outside the documented 721–819px palette-scroll exception, the
          // document itself must never scroll horizontally
          expect(m.docHScroll, `${code} @ ${w}×${h} — document h-scroll`).toBe(false)
        }
      }
    })
  }

  test('721×720: Tier 1 fits across every RevisionChip state, EN/JA/KO', async ({ page }) => {
    await page.setViewportSize({ width: 721, height: 720 })
    await openApp(page)
    await resetAll(page)

    const states: RevState[] = [
      null,
      { role: 'revision', dirty: false },
      { role: 'revision', dirty: true },
      { role: 'proposal', dirty: false },
      { role: 'proposal', dirty: true },
    ]
    for (const code of ['en', 'ja', 'ko']) {
      await setLocale(page, code)
      for (const state of states) {
        await setRevisionChip(page, state)
        await page.waitForTimeout(60)
        const m = await readMetrics(page)
        const label = `${code} / ${JSON.stringify(state)}`
        expect(m.tier1HScroll, `${label} — Tier 1 internal h-scroll`).toBe(false)
        expect(m.docHScroll, `${label} — document h-scroll`).toBe(false)
      }
    }
  })

  test('resizing wide → narrow (721) → wide recovers the layout, no locale change', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')

    expect((await readMetrics(page)).toolbarRows).toBe(2)

    await page.setViewportSize({ width: 721, height: 720 })
    await page.waitForTimeout(200)
    const narrow = await readMetrics(page)
    expect(narrow.toolbarRows).toBe(2)
    expect(narrow.tier2Rows).toBe(1)
    expect(narrow.docHScroll).toBe(false)

    await page.setViewportSize({ width: 1920, height: 900 })
    await page.waitForTimeout(200)
    expect((await readMetrics(page)).toolbarRows).toBe(2)
  })
})

test.describe('toolbar — group render order and collapse', () => {
  const rankOf = (label: string): number => {
    if (/insert module|모듈 삽입|モジュールを挿入/i.test(label)) return 0
    if (/^file ▾|^파일 ▾|^ファイル ▾/i.test(label)) return 1
    if (/^data ▾|^데이터 ▾|^データ ▾/i.test(label)) return 2
    if (/^share$|^공유$|^共有$/i.test(label)) return 3
    if (/^settings ▾|^설정 ▾|^設定 ▾/i.test(label)) return 4
    if (/help/i.test(label)) return 5
    return -1
  }
  const overflowLabels = (page: Page) =>
    page
      .locator('.toolbar__overflow-pop > * button, .toolbar__overflow-pop > button')
      .evaluateAll((btns) => btns.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()))

  test('a partial collapse keeps canonical relative order inside ⋯', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)
    // pin the toolbar's own measured width (what the ResizeObserver watches)
    // narrow enough to force a partial collapse, without depending on any
    // locale's real font metrics. The grouped Tier-1 controls (File/Data/
    // Settings each now a single merged trigger) need less width than the
    // old individually-listed items did, so 900px alone no longer collapses
    // anything -- 800px reliably collapses Help+Data only (a real partial).
    await page.addStyleTag({ content: '.toolbar { max-width: 800px !important; }' })
    await page.waitForTimeout(150)

    const moreBtn = page.locator('.toolbar__overflow-btn')
    await expect(moreBtn).toBeVisible()
    await moreBtn.click()
    const labels = await overflowLabels(page)
    const ranks = labels.map(rankOf).filter((r) => r >= 0)
    expect(ranks.length).toBeGreaterThan(0)
    expect(ranks.length).toBeLessThan(6) // genuinely partial, not everything
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1])
  })

  test('every group collapsed still reads Module → File → Data → Share → Settings → Help', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)
    await page.addStyleTag({ content: '.toolbar { max-width: 420px !important; }' })
    await page.waitForTimeout(150)

    await page.locator('.toolbar__overflow-btn').click()
    const labels = await overflowLabels(page)
    const ranks = labels.map(rankOf).filter((r) => r >= 0)
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5])
  })
})

test.describe('toolbar — nested-menu Escape scoping and dialog survival (review condition 3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)
    await page.addStyleTag({ content: '.toolbar { max-width: 420px !important; }' })
    await page.waitForTimeout(150)
  })

  // Export's actions are flattened directly into File's own popover
  // (Hanrim's visual review, 2026-09-15 — a nested `Export ▾` sub-trigger
  // read as a small pill button awkwardly inserted into the popover), so
  // the deepest nesting left is `⋯ → File` (2 levels), not 3.
  test('Escape with ⋯ → File both open closes only File', async ({ page }) => {
    const moreBtn = page.locator('.toolbar__overflow-btn')
    await moreBtn.click()
    const overflowPop = page.locator('.toolbar__overflow-pop')
    await expect(overflowPop).toBeVisible()

    await overflowPop.locator('button', { hasText: /^File ▾$/ }).click()
    const filePop = page.locator('.toolbar__filemenu-pop')
    await expect(filePop).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(filePop).toBeHidden()
    await expect(overflowPop).toBeVisible()
  })

  test('opening Project revision from a collapsed File closes File and ⋯, focus returns to ⋯', async ({
    page,
  }) => {
    const moreBtn = page.locator('.toolbar__overflow-btn')
    await moreBtn.click()
    await page.locator('.toolbar__overflow-pop button', { hasText: /^File ▾$/ }).click()
    await page
      .locator('.toolbar__overflow-pop .menu__item')
      .filter({ has: page.locator('.menu__name', { hasText: 'Project revision' }) })
      .click()

    const dlg = page.locator('.mcdlg--confirm')
    await expect(dlg).toBeVisible()
    await expect(page.locator('.toolbar__filemenu-pop')).toHaveCount(0)
    await expect(page.locator('.toolbar__overflow-pop')).toHaveCount(0)

    await dlg.getByRole('button', { name: /^cancel$/i }).click()
    await expect(dlg).toHaveCount(0)
    await expect(moreBtn).toBeFocused()
  })

  test('opening the same dialog from an inline File returns focus to File’s own trigger', async ({
    page,
  }) => {
    await page.addStyleTag({ content: '.toolbar { max-width: none !important; }' })
    await page.setViewportSize({ width: 1920, height: 900 })
    await page.waitForTimeout(150)

    const fileBtn = page.locator('.toolbar__actions .menu > button', { hasText: /^File ▾$/ })
    await fileBtn.click()
    await page
      .locator('.toolbar__actions .menu__item')
      .filter({ has: page.locator('.menu__name', { hasText: 'Project revision' }) })
      .click()

    const dlg = page.locator('.mcdlg--confirm')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: /^cancel$/i }).click()
    await expect(dlg).toHaveCount(0)
    await expect(fileBtn).toBeFocused()
  })

  test('Take a tour / Send feedback close Help and ⋯ first (no stray popover)', async ({ page }) => {
    const moreBtn = page.locator('.toolbar__overflow-btn')
    await moreBtn.click()
    await page.locator('.toolbar__overflow-pop button[aria-label="Help"]').click()
    const helpPop = page.locator('.menu__pop--right')
    await expect(helpPop).toBeVisible()
    await helpPop.locator('.menu__item', { hasText: /Take a tour/ }).click()
    await expect(page.locator('.toolbar__overflow-pop')).toHaveCount(0)
    await expect(page.locator('.menu__pop--right')).toHaveCount(0)
  })
})

test.describe('toolbar — Share’s lifted flow (review condition 3)', () => {
  async function stubClipboard(page: Page): Promise<void> {
    await page.addInitScript(() => {
      ;(window as any).__clipWrites = []
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (t: string) => {
            ;(window as any).__clipWrites.push(t)
          },
        },
      })
    })
  }
  const clipWrites = (page: Page) => page.evaluate(() => ((window as any).__clipWrites as string[]).length)

  test('no clipboard write before Confirm; exactly one after; still one after a rapid double-click', async ({
    page,
  }) => {
    await stubClipboard(page)
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)

    const shareBtn = page.locator('.toolbar__actions button', { hasText: /^Share$/ })
    await shareBtn.click()
    const dlg = page.locator('.mcdlg--confirm')
    await expect(dlg).toBeVisible()
    expect(await clipWrites(page)).toBe(0)

    await dlg.getByRole('button', { name: /^cancel$/i }).click()
    expect(await clipWrites(page)).toBe(0)

    await shareBtn.click()
    await expect(dlg).toBeVisible()
    const confirmBtn = dlg.getByRole('button', { name: /create link/i })
    // two separate Playwright click commands (real mouse simulation or
    // `dispatchEvent`) each round-trip through CDP, leaving a real gap for
    // the first click's own effect (dialog closes on confirm) to detach the
    // button before the second command locates it -- a Playwright-harness
    // race, not the `busy`-guard race this test means to exercise. Grabbing
    // one element handle and calling native `.click()` on it twice inside a
    // single page-side script fires both synchronously, back-to-back, before
    // React's commit can remove the button out from under the second.
    const handle = await confirmBtn.elementHandle()
    await handle!.evaluate((el: HTMLElement) => {
      el.click()
      el.click()
    })
    await expect(page.locator('.share-pop')).toBeVisible()
    expect(await clipWrites(page)).toBe(1)
  })

  test('the copied-link panel survives ⋯ closing and stays within the viewport, inline and collapsed', async ({
    page,
  }) => {
    await stubClipboard(page)
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)

    // inline case
    const shareBtn = page.locator('.toolbar__actions button', { hasText: /^Share$/ })
    await shareBtn.click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
    let pop = await fullyInViewport(page, '.share-pop')
    expect(pop.found).toBe(true)
    expect(pop.ok, 'inline share panel on screen').toBe(true)
    await page.locator('.share-pop button', { hasText: /close|닫기|閉じる/i }).click()

    // collapsed case
    await page.addStyleTag({ content: '.toolbar { max-width: 420px !important; }' })
    await page.waitForTimeout(150)
    await page.locator('.toolbar__overflow-btn').click()
    await page.locator('.toolbar__overflow-pop button', { hasText: /^Share$/ }).click()
    await expect(page.locator('.toolbar__overflow-pop')).toHaveCount(0) // closeAncestors ran
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
    pop = await fullyInViewport(page, '.share-pop')
    expect(pop.found).toBe(true)
    expect(pop.ok, 'collapsed share panel on screen, anchored to ⋯').toBe(true)
  })
})

test.describe('toolbar — Settings is exempt from ancestor-closing', () => {
  test('clicking Theme inside Settings does not close the Settings menu', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    await openApp(page)
    await resetAll(page)

    const settingsBtn = page.locator('.toolbar__actions .menu > button', { hasText: /^Settings ▾$/ })
    await settingsBtn.click()
    const pop = page.locator('.toolbar__settingsmenu-pop')
    await expect(pop).toBeVisible()
    await pop.locator('.settings-row', { hasText: 'Theme' }).click()
    await expect(pop).toBeVisible()
  })
})

test.describe('toolbar — palette drag state (review condition 5)', () => {
  test('dragging a chip sets [data-dragging] only on that chip, for the duration of the drag', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)

    const before = await page.evaluate(() =>
      [...document.querySelectorAll('.chip')].filter((c) => c.hasAttribute('data-dragging')).length,
    )
    expect(before).toBe(0)

    await page.evaluate(() => {
      const chip = document.querySelector('.chip--pool') as HTMLElement
      const dt = new DataTransfer()
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    })
    const during = await page.evaluate(() => ({
      onPool: document.querySelector('.chip--pool')?.hasAttribute('data-dragging'),
      onSource: document.querySelector('.chip--source')?.hasAttribute('data-dragging'),
    }))
    expect(during.onPool).toBe(true)
    expect(during.onSource).toBe(false)

    await page.evaluate(() => {
      const chip = document.querySelector('.chip--pool') as HTMLElement
      chip.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    })
    const after = await page.evaluate(() => document.querySelector('.chip--pool')?.hasAttribute('data-dragging'))
    expect(after).toBe(false)
  })
})

test.describe('toolbar — an overflowed control is reachable with the mouse and the keyboard', () => {
  test('mouse open, keyboard Escape/Enter', async ({ page }) => {
    // 900px no longer forces a collapse -- the grouped Tier-1 controls need
    // less width than the old individually-listed items did. 850px sat right
    // at the boundary (measured locally as collapsing, but CI's Chromium has
    // slightly different font metrics and did not collapse there) -- 780px
    // keeps real margin below the ~850-870px threshold on either platform
    await page.setViewportSize({ width: 780, height: 900 })
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ja')

    const moreBtn = page.locator('.toolbar__overflow-btn')
    await expect(moreBtn).toBeVisible()
    await expect(moreBtn).toHaveAttribute('aria-haspopup', 'menu')

    await moreBtn.click()
    const pop = page.locator('.toolbar__overflow-pop')
    await expect(pop).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
    await expect(moreBtn).toBeFocused()

    await moreBtn.press('Enter')
    await expect(page.locator('.toolbar__overflow-pop')).toBeVisible()
  })
})

test.describe('toolbar — dropdowns are never clipped by the responsive layout', () => {
  for (const width of [1920, 1280]) {
    test(`Templates + Language open fully on screen at ${width}px, every locale`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page)
      await resetAll(page)

      for (const code of ['en', 'ja', 'ko']) {
        await setLocale(page, code)

        await page.locator('.toolbar__actions .menu > button').first().click() // Templates ▾
        const tpl = await fullyInViewport(page, '.toolbar__actions .menu__pop:not(.toolbar__overflow-pop)')
        expect(tpl.found, `${code} @ ${width} — Templates pop`).toBe(true)
        expect(tpl.ok, `${code} @ ${width} — Templates pop on screen`).toBe(true)
        await page.keyboard.press('Escape')

        const settingsBtn = page.locator('.toolbar__actions .menu > button', { hasText: /^(Settings|설정|設定) ▾$/ })
        await settingsBtn.click()
        const langBtn = page.locator('.toolbar__settingsmenu-pop .lang-switch')
        await langBtn.click()
        const lang = await fullyInViewport(page, '.lang-menu__pop')
        expect(lang.found, `${code} @ ${width} — Language pop`).toBe(true)
        expect(lang.ok, `${code} @ ${width} — Language pop on screen`).toBe(true)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
      }
    })
  }
})
