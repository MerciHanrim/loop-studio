import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test, waitForAppReady } from './support/loop'

// docs/localization.md §L5.1 / §L5.2 — how the interface language is DECIDED, and one
// locale-independent storage rule, kept after the per-language specs were archived
// with their languages (§L2.0, 2026-10).
//
// The per-language specs each carried an "the other locales are unaffected" table of
// browser tags and a "a region-tagged stored value is not a code" test. Those were
// never about the language they sat in: they pinned `resolveInitialLocale`
// (src/i18n/registry.ts) in the real bundle. With only `en` and `ko` registered the
// rows that still mean something are kept here.
//
// NOT repeated: what `e2e/i18n.spec.ts` "§L2.0 — retired languages" already pins — a
// stored retired code boots in English, a stored `ko` is kept, `ar-EG` and `ko-KR`
// browsers, and a stored `ko-KR` ignored under an `ar-EG` browser.
//
// The pure resolver, including hypothetical registries, is `src/i18n/registry.test.ts`.
//
// locale-subset-file: the rows probe resolver STEPS, one each; a language with no
// step of its own (a bare code like `ru`) is covered by the registry-wide unit test.
// What only a browser shows is that the BUILT app reads the browser's list and the
// stored key the way that function says.

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

/** store `code` under the locale key, then boot again */
async function bootWithStored(page: Page, code: string): Promise<void> {
  await openApp(page)
  await page.evaluate((c) => localStorage.setItem('loop-studio/ui-locale/1', c), code)
  await page.reload()
  await waitForAppReady(page)
}

// ───────────────────────────────────────────────────────────────────────────
// a single browser tag
// ───────────────────────────────────────────────────────────────────────────

// ported from the "the other shipped locales are unaffected" tables of i18n-de.spec.ts,
// i18n-fr.spec.ts, i18n-es-419.spec.ts, i18n-pt-br.spec.ts and i18n-zh-hant.spec.ts,
// written while those languages were archived (§L2.0, 2026-10) and brought back with
// them (§L2.0a). Each row probes one resolver step, so not every language has one.
// locale-subset: one row per resolver STEP, not per language
for (const [tag, want, why] of [
  ['en-US', 'en', 'the base-subtag step reaches the base locale'],
  // `qaa` — ISO 639-2 reserves `qaa`-`qtz` for LOCAL USE, so this tag can never become
  // a real language and never become registered. It is the "nothing matches" probe:
  // `en-x-probe` would also give `en`, but through the base-subtag match on `en`, so it
  // would pass while proving nothing.
  ['qaa', 'en', 'nothing matches, so the final fallback'],
  // the Chinese-script step maps a REGION onto a registered script locale
  // (restored 2026-10-28, §L2.0a)
  ['zh-CN', 'zh-Hans', 'the script step maps a Simplified region'],
  ['zh-TW', 'zh-Hant', 'the script step maps a Traditional region'],
  ['ar-EG', 'ar', 'a region tag reaches its base language (Arabic, restored)'],
  // restored 2026-10-28 (§L2.0a): a browser in one reaches it again
  ['ja-JP', 'ja', 'a restored language as a browser tag'],
  ['de-DE', 'de', 'a restored language as a browser tag'],
  ['fr-CA', 'fr', 'the base-subtag step, no Canadian catalog'],
  // a regional code that owns its base (`baseFallbackFor`) against one that is the
  // tag itself (§L5.2 step 1 before step 4)
  ['es-MX', 'es-419', 'the base owner takes a region it has no exact code for'],
  ['es-ES', 'es-ES', 'the exact code wins before the base owner'],
  ['pt-AO', 'pt-BR', 'the base owner takes a region it has no exact code for'],
  ['pt-PT', 'pt-PT', 'the exact code wins before the base owner'],
] as const) {
  test.describe(`a ${tag} browser`, () => {
    test.use({ locale: tag })

    test(`with no stored value boots in ${want} — ${why}`, async ({ page }) => {
      await openApp(page)
      expect(await stored(page)).toBeNull()
      await expect.poll(() => htmlLang(page)).toBe(want)
    })
  })
}

// ───────────────────────────────────────────────────────────────────────────
// a browser LIST — every step applies to one tag before the next tag is tried
// ───────────────────────────────────────────────────────────────────────────

/** `navigator.languages` as `tags`. A Playwright context carries ONE `locale`, which is
 *  why the archived specs left the list order to the unit test; the getter is replaced
 *  before the app's first script runs instead, so the built app reads a real list
 *  through its own `navigatorLanguages()`. */
async function browserList(page: Page, tags: readonly string[]): Promise<void> {
  await page.addInitScript((list) => {
    Object.defineProperty(Navigator.prototype, 'languages', { configurable: true, get: () => list.slice() })
  }, [...tags])
}

test.describe('§L5.2 a browser language list', () => {
  for (const [tags, want, why] of [
    [['qaa', 'ko-KR'], 'ko', 'an unsupported first tag is skipped and the next one decides'],
    [['xx-XX', 'ko-KR'], 'ko', 'an unknown language as a BROWSER tag is skipped'],
    [['ja-JP', 'ko-KR'], 'ja', 'a restored language first in the list decides'],
    [['qaa', 'en-US', 'ko-KR'], 'en', 'the first tag that matches wins, not the last'],
  ] as const) {
    test(`[${tags.join(', ')}] boots in ${want} — ${why}`, async ({ page }) => {
      // ported from the per-tag ordering note of i18n-es-419.spec.ts / i18n-pt-br.spec.ts,
      // which are archived with their languages (§L2.0, 2026-10)
      await browserList(page, tags)
      await openApp(page)
      expect(await page.evaluate(() => [...navigator.languages]), 'the list really reached the page').toEqual([...tags])
      expect(await stored(page)).toBeNull()
      await expect.poll(() => htmlLang(page)).toBe(want)
    })
  }
})

// ───────────────────────────────────────────────────────────────────────────
// a stored value
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L5.1 a stored value that is not a code', () => {
  test.use({ locale: 'ko-KR' })

  test('a region-tagged stored value (en-US) is ignored, not repaired — the browser decides', async ({ page }) => {
    // ported from "a region-tagged value is not a code" in i18n-de.spec.ts /
    // i18n-fr.spec.ts / i18n-es-419.spec.ts / i18n-pt-br.spec.ts, which are archived
    // with their languages (§L2.0, 2026-10). Under a Korean browser the two readings
    // give different answers: repaired, `en-US` would become `en`; ignored, the
    // browser's `ko-KR` decides. And unlike a stored RETIRED code it does not force
    // English.
    await bootWithStored(page, 'en-US')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await stored(page), 'read, never rewritten').toBe('en-US')
  })

  test('an unregistered stored value that was never a language (qaa) is ignored the same way', async ({ page }) => {
    // ported from "an unregistered value falls back" in i18n-zh-hant.spec.ts, which is
    // archived with Traditional Chinese (§L2.0, 2026-10)
    await bootWithStored(page, 'qaa')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await stored(page)).toBe('qaa')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// a user string is never normalised
// ───────────────────────────────────────────────────────────────────────────

test.describe('a raw user string', () => {
  test.use({ locale: 'en-US' })

  test('is stored and read back byte-for-byte, not Unicode-normalised', async ({ page }) => {
    // ported from i18n-vi.spec.ts ("d — a raw user string is stored and read back
    // byte-for-byte"), which is archived with Vietnamese (§L2.0, 2026-10). Nothing in
    // it depended on the Vietnamese catalogue: the product must not normalise what the
    // USER typed, in any interface language. The label stays Vietnamese — it is user
    // content, and a decomposed tone mark on a vowel that already carries one is the
    // case where NFD and NFC really differ. `ơ` written as `o` + U+031B is a different
    // sequence from U+01A1 and both are valid input; whichever arrives has to come
    // back, out of the store AND out of the DOM.
    await openApp(page)
    await resetAll(page)
    expect(await htmlLang(page)).toBe('en')

    const NFD = 'Các bể chứa lớn'.normalize('NFD')
    const NFC = NFD.normalize('NFC')
    expect(NFD, 'the fixture must really be decomposed').not.toBe(NFC)

    const out = await page.evaluate((label: string) => {
      const g = () =>
        (
          window as unknown as {
            __loop: {
              graph: {
                getState: () => {
                  nodes: { id: string; data?: { label?: string } }[]
                  addNodeAt: (kind: string, at: { x: number; y: number }) => void
                  updateNodeData: (id: string, p: Record<string, unknown>) => void
                }
              }
            }
          }
        ).__loop.graph.getState()
      g().addNodeAt('pool', { x: 0, y: 0 })
      const id = g().nodes[0]!.id
      g().updateNodeData(id, { label })
      return { id, stored: g().nodes.find((n) => n.id === id)?.data?.label ?? '' }
    }, NFD)

    expect(out.stored, 'the store must keep the exact code points it was given').toBe(NFD)
    expect(out.stored).not.toBe(NFC)

    // and the DOM carries the same sequence, not a normalised one
    await expect
      .poll(
        () =>
          page.evaluate(
            (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)?.textContent ?? '',
            out.id,
          ),
        { message: 'the DOM must not normalise a user label' },
      )
      .toContain(NFD)
  })
})
