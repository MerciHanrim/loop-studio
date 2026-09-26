import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

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

const DESC = ['.menu__blurb', '.palette-tip__desc'] as const

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

/** Open every toolbar menu and hover every palette chip, collecting the
 *  descriptive copy each one reveals. */
async function sweepDescriptiveCopy(page: Page): Promise<Row[]> {
  const rows: Row[] = []
  const menus = page.locator('.toolbar__actions .menu')
  for (let i = 0; i < (await menus.count()); i++) {
    await menus.nth(i).locator('> button').click()
    // poll the exact thing we are about to measure: a LAID-OUT blurb. Some
    // menus (Share, Help) carry no blurb at all, so an empty result is fine
    // once the popover itself is open.
    await expect(page.locator('.menu__pop')).toBeVisible()
    rows.push(...((await page.locator('.menu__blurb').evaluateAll(measure, '.menu__blurb')) as Row[]))
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
  return { ctx, page: await ctx.newPage() }
}

const overflowing = (rows: Row[]) => rows.filter((r) => r.overflowX > 1 || r.overflowY > 1)
const describe1 = (r: Row) => `${r.sel} "${r.text}" ovX=${r.overflowX} lines=${r.lines}`

// ------------------------------------------------------------------ 1
// The ten elements that overflow today, by locale. Chinese was the reported
// case; Japanese has the same cause on the same selectors and is worse.
test.describe('CJK descriptive copy wraps instead of overflowing', () => {
  for (const [lang, tag] of [
    ['zh-Hans', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['ja', 'ja-JP'],
  ] as const) {
    test(`${lang}: no menu blurb or palette tooltip overflows`, async ({ page }) => {
      const { ctx, page: p } = await pageAt(page, tag)
      await openApp(p)
      const rows = await sweepDescriptiveCopy(p)
      expect(rows.length, 'the sweep must actually find copy').toBeGreaterThan(15)
      expect(
        overflowing(rows).map(describe1),
        `${lang} descriptive copy must wrap, not spill`,
      ).toEqual([])
      await ctx.close()
    })
  }
})

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
    expect(rows.reduce((n, r) => n + r.lines, 0), 'the agreed Korean line count').toBe(38)

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
    expect(rows.reduce((n, r) => n + r.lines, 0), 'the English line count is unchanged').toBe(40)
    await ctx.close()
  })
})

// ------------------------------------------------------------------ 4
test.describe('the computed value says what the CSS means', () => {
  test('ko keep-all, ja/zh phrase-aware (or normal without a dictionary), en default', async ({
    page,
  }) => {
    const supportsAutoPhrase = await page.evaluate(() =>
      CSS.supports('word-break', 'auto-phrase'),
    )
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

  test('`:lang(zh)` reaches BOTH Chinese locales, not just one', async ({ page }) => {
    const seen: Record<string, string> = {}
    for (const [lang, tag] of [
      ['zh-Hans', 'zh-CN'],
      ['zh-Hant', 'zh-TW'],
    ] as const) {
      const { ctx, page: p } = await pageAt(page, tag)
      await openApp(p)
      expect(await p.evaluate(() => document.documentElement.lang), `${lang} html lang`).toBe(lang)
      const rows = await sweepDescriptiveCopy(p)
      seen[lang] = [...new Set(rows.map((r) => r.wordBreak))].join()
      await ctx.close()
    }
    expect(seen['zh-Hans'], 'the script subtag must not stop `:lang(zh)` matching').toBe(
      seen['zh-Hant'],
    )
    expect(seen['zh-Hans']).not.toBe('keep-all')
  })
})

// ------------------------------------------------------------------ 5
// This list froze at the locales that existed when it was written: `fr` (#259)
// and `de` (#262) each shipped without being added, and because the sweep LOOPS
// a list rather than asserting a count, nothing went red — it just stopped
// covering two languages. Each of those has its own length sweep in
// `i18n-fr.spec.ts` / `i18n-de.spec.ts`, but over a different selector set, so
// `.menu__blurb` and `.palette-tip__desc` were genuinely unmeasured there.
// docs/localization.md §L2.11a item 8 is what should have caught it.
//
// The list stays explicit — each locale needs its own browser context and tag —
// so ADDING A LANGUAGE MUST ADD A ROW HERE. Neither the title nor the comments
// name a count: a number would be one more thing that silently goes stale, which
// is the very failure this change exists to fix.
//
// One test PER LOCALE, not one test that loops the list. It was a single test
// until `vi` made it the 15th locale: the sweep opens a fresh context, loads the
// app, opens every menu and hovers every chip, so its cost is proportional to
// the number of locales, and one test's 30 s budget is not. It ran 24.3 s
// locally and timed out on CI, twice, without reaching a single assertion. A
// per-locale test makes each case's runtime independent of how many locales
// ship, so the budget stops being a function of the list's length. It also names
// the failing locale in the test title instead of inside an accumulated array.
// Section 1 above already reads this way.
test.describe('every shipped locale', () => {
  for (const [lang, tag] of [
    ['en', 'en-US'],
    ['ko', 'ko-KR'],
    ['ja', 'ja-JP'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['fr', 'fr-FR'],
    ['de', 'de-DE'],
    ['es-419', 'es-MX'],
    ['pt-BR', 'pt-AO'],
    ['es-ES', 'es-ES'],
    ['pt-PT', 'pt-PT'],
    ['ru', 'ru-RU'],
    ['tr', 'tr-TR'],
    ['th', 'th-TH'],
    ['vi', 'vi-VN'],
    ['it', 'it-IT'],
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
