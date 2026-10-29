import type { Page } from '@playwright/test'
import { expect, openApp, seedPersonalBrowser, test } from './support/loop'

// docs/localization.md — descriptive copy (`.menu__blurb`, `.palette-tip__desc`)
// must wrap by the rules of the language it is written in.
//
// RED-FIRST. `word-break: keep-all` was added to both classes for KOREAN
// (a particle otherwise breaks mid-word, stranding one character), but it was
// declared unscoped. `keep-all` removes every break opportunity inside a
// space-less CJK sentence, so Japanese and Chinese copy cannot use the second
// line at all and overflows horizontally instead — 10 elements across three
// locales, up to 104px.
//
// The fix scopes `keep-all` to `:lang(ko)` and gives `:lang(ja)` / `:lang(zh)`
// `word-break: normal`, upgraded to `auto-phrase` where the engine ships a
// line-break dictionary — the same shape `.nodef__title` already uses.
//
// §L2.0 (2026-10): Japanese and Chinese are no longer shipped, so the checks of
// their own copy (the CJK overflow sweep and the `:lang(zh)` reach) retired with
// them; the eighteen-locale version is kept in
// `archive/i18n/e2e/descriptive-copy-wrapping.spec.ts`. What stays is the Korean
// contract, the English one, and the computed value for both.

// 2026-10-23: the toolbar menus' descriptive copy is File's, now in its
// description areas (`.dmenu__desc`, docs/workbench.md §WB2.2); no toolbar menu
// shows a `.menu__blurb` any more (the sweep still collects one if it does)
const DESC = ['.dmenu__desc', '.palette-tip__desc'] as const

/** Every rendered descriptive element: an inactive palette tip is
 *  `display: none`, so it is filtered out rather than counted as 0×0. */
const measure = (els: Element[], sel: string) =>
  els
    .filter((el) => (el as HTMLElement).offsetParent !== null || el.clientWidth > 0)
    .map((el) => {
      const cs = getComputedStyle(el)
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
      return {
        sel,
        text: (el.textContent ?? '').trim().slice(0, 34),
        wordBreak: cs.wordBreak,
        overflowX: el.scrollWidth - el.clientWidth,
        overflowY: el.scrollHeight - el.clientHeight,
        lines: Math.round(el.scrollHeight / lh),
      }
    })

type Row = ReturnType<typeof measure> extends (infer R)[] ? R : never

/** Open every toolbar menu (and File's two submenus) and hover every palette
 *  chip, collecting the descriptive copy each one reveals. */
async function sweepDescriptiveCopy(page: Page): Promise<Row[]> {
  const rows: Row[] = []
  const menus = page.locator('.toolbar__actions .menu')
  // File's descriptions are in its description areas (docs/workbench.md
  // §WB2.2): File's own, then each submenu's, opened in turn
  const areaDescs = async (panel: string) =>
    (await page.locator(`${panel} .dmenu__desc:not(.dmenu__hint)`).evaluateAll(measure, '.dmenu__desc')) as Row[]
  for (let i = 0; i < (await menus.count()); i++) {
    await menus.nth(i).locator('> button').click()
    // poll the exact thing we are about to measure: a LAID-OUT blurb. Some
    // menus (Share, Help) carry no blurb at all, so an empty result is fine
    // once the popover itself is open.
    await expect(page.locator('.menu__pop').first()).toBeVisible()
    rows.push(...((await page.locator('.menu__blurb').evaluateAll(measure, '.menu__blurb')) as Row[]))
    const subRows = page.locator('.toolbar__filemenu-pop [data-submenu]')
    if ((await subRows.count()) > 0) {
      rows.push(...(await areaDescs('.toolbar__filemenu-pop')))
      for (let s = 0; s < (await subRows.count()); s++) {
        await subRows.nth(s).click()
        await expect(page.locator('.dmenu--sub')).toBeVisible()
        rows.push(...(await areaDescs('.dmenu--sub')))
      }
      // the submenu first, then File
      await page.keyboard.press('Escape')
    }
    await page.keyboard.press('Escape')
  }
  const chips = page.locator('.palette-item')
  for (let i = 0; i < (await chips.count()); i++) {
    await chips.nth(i).hover()
    await expect
      .poll(() => page.locator('.palette-tip__desc').evaluateAll(measure, 'x').then((r) => r.length))
      .toBeGreaterThan(0)
    rows.push(
      ...((await page
        .locator('.palette-tip__desc')
        .evaluateAll(measure, '.palette-tip__desc')) as Row[]),
    )
  }
  return rows
}

/** A fresh context at `tag`, with the guided tour pre-dismissed — the shared
 *  `_tourSeed` fixture only reaches the fixture-provided page. */
async function pageAt(page: Page, tag: string) {
  const ctx = await page.context().browser()!.newContext({ locale: tag })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('loop-studio/guided-tour/1', 'dismissed')
    } catch {
      /* storage blocked — the tour card is dismissed by the test instead */
    }
  })
  // issue #296 / #297 - a returning profile that has seen the newest release
  // note and remembers a personal browser, so no storage gate stands in front
  await seedPersonalBrowser(ctx)
  return { ctx, page: await ctx.newPage() }
}

const overflowing = (rows: Row[]) => rows.filter((r) => r.overflowX > 1 || r.overflowY > 1)
const describe1 = (r: Row) => `${r.sel} "${r.text}" ovX=${r.overflowX} lines=${r.lines}`

// ------------------------------------------------------------------ 1
// (retired, §L2.0 (2026-10)) "CJK descriptive copy wraps instead of
// overflowing" checked zh-Hans / zh-Hant / ja copy only; it is kept in
// `archive/i18n/e2e/descriptive-copy-wrapping.spec.ts`.

// ------------------------------------------------------------------ 2
// Korean is why `keep-all` exists; it keeps it, and keeps its line count.
test.describe('Korean keeps its wrapping contract', () => {
  test('keep-all is still applied, and no line breaks mid-syllable', async ({ page }) => {
    const { ctx, page: p } = await pageAt(page, 'ko-KR')
    await openApp(p)
    const rows = await sweepDescriptiveCopy(p)
    expect(overflowing(rows).map(describe1), 'Korean must not overflow').toEqual([])
    expect(
      [...new Set(rows.map((r) => r.wordBreak))],
      'Korean descriptive copy keeps `keep-all`',
    ).toEqual(['keep-all'])
    // 0.28.1: 36, was 38 — the Early MMO blurb (2 lines, measured in the
    // Templates menu's own box) left the menu with its entry.
    // 2026-10-20: 34, was 36 — the workbench's File menu took the Templates
    // in and the Templates menu's 300 px width (en: three template blurbs
    // needed 3 lines at 260 and were clamped); at 300 the two structure rows'
    // Korean blurbs ("선택한 노드와 그 사이 연결을…", "저장해 둔 구조 파일을…")
    // take 1 line instead of 2 (measured per blurb, 300 against 260 px);
    // 2026-10-20: 36 — the General gacha's blurb (2 lines) joined the menu;
    // 38 — the Standard gacha's (2 lines); 40 — the Pickup gacha's (2 lines)
    // 2026-10-23: still 40, measured in File's description areas (272 px)
    // 0.30.0: 42 — the Early MMO blurb (2 lines) is in the menu again
    expect(rows.reduce((n, r) => n + r.lines, 0), 'the agreed Korean line count').toBe(42)

    // measured, not assumed: a break is mid-eojeol when two adjacent
    // NON-space characters end up on different lines
    const chips = p.locator('.palette-item')
    const broken: string[] = []
    for (let i = 0; i < (await chips.count()); i++) {
      await chips.nth(i).hover()
      await expect
        .poll(() => p.locator('.palette-tip__desc').evaluateAll(measure, 'x').then((r) => r.length))
        .toBeGreaterThan(0)
      broken.push(
        ...(await p.evaluate(() => {
          const out: string[] = []
          for (const el of document.querySelectorAll('.palette-tip__desc, .menu__blurb')) {
            if (!(el as HTMLElement).offsetParent) continue
            const node = el.firstChild
            if (!node || node.nodeType !== Node.TEXT_NODE) continue
            const text = node.textContent ?? ''
            const range = document.createRange()
            let prevTop: number | null = null
            for (let c = 0; c < text.length; c++) {
              range.setStart(node, c)
              range.setEnd(node, c + 1)
              const { top } = range.getBoundingClientRect()
              if (prevTop !== null && top > prevTop + 1) {
                const before = text[c - 1]
                const after = text[c]
                if (before?.trim() && after?.trim()) out.push(`${before}|${after}`)
              }
              prevTop = top
            }
          }
          return out
        })),
      )
    }
    expect([...new Set(broken)], 'no Korean word may be split across lines').toEqual([])
    await ctx.close()
  })
})

// ------------------------------------------------------------------ 3
test.describe('English is untouched', () => {
  test('no overflow and the same line count', async ({ page }) => {
    const { ctx, page: p } = await pageAt(page, 'en-US')
    await openApp(p)
    const rows = await sweepDescriptiveCopy(p)
    expect(overflowing(rows).map(describe1)).toEqual([])
    // 0.28.1: 38, was 40 — the Early MMO blurb (2 lines) left the Templates menu;
    // 2026-10-20: 40 — the General gacha's blurb (2 lines) joined it; 42 — the
    // Standard gacha's (2 lines); 44 — the Pickup gacha's (2 lines);
    // 2026-10-23: still 44, measured in File's description areas (272 px)
    // 0.30.0: 46 — the Early MMO blurb (2 lines) is in the menu again
    expect(rows.reduce((n, r) => n + r.lines, 0), 'the English line count is unchanged').toBe(46)
    await ctx.close()
  })
})

// ------------------------------------------------------------------ 4
test.describe('the computed value says what the CSS means', () => {
  test('ko keep-all, ja and zh phrase-aware (or normal without a dictionary), en default', async ({ page }) => {
    const supportsAutoPhrase = await page.evaluate(() => CSS.supports('word-break', 'auto-phrase'))
    const cjk = supportsAutoPhrase ? 'auto-phrase' : 'normal'
    for (const [lang, tag, want] of [
      ['ko', 'ko-KR', 'keep-all'],
      ['ja', 'ja-JP', cjk],
      ['zh-Hans', 'zh-CN', cjk],
      ['zh-Hant', 'zh-TW', cjk],
      ['en', 'en-US', 'normal'],
    ] as const) {
      const { ctx, page: p } = await pageAt(page, tag)
      await openApp(p)
      const rows = await sweepDescriptiveCopy(p)
      expect([...new Set(rows.map((r) => r.wordBreak))], `${lang} word-break`).toEqual([want])
      await ctx.close()
    }
  })

  // (retired, §L2.0 (2026-10)) "`:lang(zh)` reaches BOTH Chinese locales" —
  // kept in `archive/i18n/e2e/descriptive-copy-wrapping.spec.ts`.
})

// ------------------------------------------------------------------ 5
// This list once froze at the locales that existed when it was written: `fr`
// (#259) and `de` (#262) each shipped without being added, and because the sweep
// LOOPS a list rather than asserting a count, nothing went red — it just stopped
// covering two languages. docs/localization.md §L2.11a item 8 is what should
// have caught it.
//
// §L2.0: the list is the shipped languages (en, de, ja, ko); the
// eighteen-locale version is kept in
// `archive/i18n/e2e/descriptive-copy-wrapping.spec.ts`. The list stays explicit —
// each locale needs its own browser context and tag — so ADDING A LANGUAGE MUST
// ADD A ROW HERE.
//
// One test PER LOCALE, not one test that loops the list: the sweep opens a fresh
// context, loads the app, opens every menu and hovers every chip, so its cost is
// proportional to the number of locales, and one test's 30 s budget is not (a
// single looping test timed out on CI at fifteen locales). A per-locale test
// also names the failing locale in the test title.
test.describe('every shipped language', () => {
  for (const [lang, tag] of [
    ['en', 'en-US'],
    ['de', 'de-DE'],
    ['ja', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
  ] as const) {
    test(`${lang}: all descriptive copy fits`, async ({ page }) => {
      const { ctx, page: p } = await pageAt(page, tag)
      await openApp(p)
      const rows = await sweepDescriptiveCopy(p)
      for (const sel of DESC) {
        expect(rows.some((r) => r.sel === sel), `${lang}: ${sel} must be measured`).toBe(true)
      }
      expect(
        overflowing(rows).map((r) => `${lang} ${describe1(r)}`),
        `no descriptive copy overflows in ${lang}`,
      ).toEqual([])
      await ctx.close()
    })
  }
})
