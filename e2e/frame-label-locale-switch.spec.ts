import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/template-label-overlay.md §TLO12 — the frame-title half of the locale
// switch, through the REAL UI, read back from the AUTOSAVED document.
//
// `coffee-zone-frames.spec.ts` checks the titles on screen. This spec checks
// what is SAVED: the gacha Template's four frame titles in the autosave record,
// derived from the shipped dictionary inside the page rather than retyped, and
// that a relabel moves titles only — never counts or geometry.
//
// §L2.0 (2026-10) — English and Korean are the shipped languages. The two
// tests that walked a document into and out of a HYPHENATED locale (`zh-Hans`,
// then all six hyphenated codes: a generator defect left their frame titles out
// of the known-official index, so a document entering one was stuck there)
// retired with those languages: no shipped code carries a hyphen now. The
// eighteen-locale version is kept in
// `archive/i18n/e2e/frame-label-locale-switch.spec.ts`; the unit contract for
// the current pair is `src/i18n/templateLabels/frameLabelCoverage.test.ts`.
//
// What §L2.0 promises instead is that a document whose frame titles were
// written in a RETIRED language keeps them, unchanged, as the user's own
// content on every switch. The last test here walks that.

type Loop = Record<string, { getState: () => any }>

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)

async function setLocale(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as { __loop: Loop }).__loop.i18n.getState().setLocale(c),
    code,
  )
  await expect.poll(() => htmlLang(page)).toBe(code)
}

/** The frame titles the SHIPPED dictionary defines for the gacha Template in
 *  `locale`, read from the dict module itself. `en` falls back to the Template
 *  graph's own canonical titles. */
async function dictFrameTitles(page: Page, locale: string): Promise<Record<string, string>> {
  return page.evaluate(async (loc) => {
    const { TEMPLATES } = await import('/src/model/templates.ts')
    const tpl = TEMPLATES.find((t) => t.id === 'gacha-banner-zones')!
    const canonical: Record<string, string> = {}
    for (const f of tpl.graph.frames ?? []) canonical[f.id] = f.label
    if (loc === 'en') return canonical
    const dicts = await import('/src/i18n/templateLabels/dicts.ts')
    await dicts.ensureTemplateLabelDict(loc)
    const frames = dicts.loadedTemplateFrameLabelDict(loc)?.['gacha-banner-zones'] ?? {}
    const out: Record<string, string> = {}
    for (const id of Object.keys(canonical)) out[id] = frames[id] ?? canonical[id]
    return out
  }, locale)
}

/** `frameId -> label`, plus the shape a relabel must not touch. */
async function docState(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('loop-studio:graph:v1')
    const d = raw ? JSON.parse(raw) : {}
    const frames = (d.frames ?? []) as { id: string; label: string; rect: unknown }[]
    const titles: Record<string, string> = {}
    for (const f of frames) titles[f.id] = f.label
    return {
      titles,
      shape: {
        nodes: (d.nodes ?? []).length,
        edges: (d.edges ?? []).length,
        frames: frames.length,
        rects: frames.map((f) => f.id + ':' + JSON.stringify(f.rect)).sort(),
      },
    }
  })
}

const savedTitles = (page: Page) => docState(page).then((s) => s.titles)

/** The gacha Template opens with editing locked, and a locked document refuses
 *  a rename (#334), so the rename unlocks first, as a user would. */
const renameFrame = (page: Page, id: string, label: string) =>
  page.evaluate(
    ([frameId, title]) => {
      const l = (window as unknown as { __loop: Loop }).__loop
      l.ui.getState().setCanvasLocked(false)
      l.frame.getState().renameFrame(frameId, title)
    },
    [id, label] as const,
  )

const templatesMenu = (page: Page) => page.locator('.toolbar__actions .menu').first()

/** Open the gacha Template from an ENGLISH UI, the state every user starts from. */
async function openGachaInEnglish(page: Page) {
  await templatesMenu(page).locator('> button').click()
  // File ▸ Templates (docs/workbench.md §WB2.2)
  await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').click()
  await templatesMenu(page)
    .locator('.menu__pop [role="menuitem"]', { hasText: /gacha banner comparison/i })
    .click()
  const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.lgr-frame')).toHaveCount(4)
  // `docState` reads the AUTOSAVE record. A template load used to flush one
  // immediately as a side effect of applying its Timeline series default;
  // docs/timeline-series-contract.md §3.2 removed that flush, so the record
  // now lands with the load's own debounced save. Wait for the state the
  // assertions read, not for a fixed time.
  await expect
    .poll(async () => Object.keys((await docState(page)).titles).length, { message: 'the autosave record holds the four frames' })
    .toBe(4)
}

test('the gacha frame titles switch en -> ko -> en in the saved document; a user rename survives', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'en')

  // 1 — seed in English
  await openGachaInEnglish(page)
  const enWant = await dictFrameTitles(page, 'en')
  expect(Object.keys(enWant)).toHaveLength(4)
  const seeded = await docState(page)
  expect(seeded.titles).toEqual(enWant)
  expect(seeded.shape).toMatchObject({ nodes: 63, frames: 4 })

  // 2 — to Korean: every official title switches, and really is Korean
  await setLocale(page, 'ko')
  const koWant = await dictFrameTitles(page, 'ko')
  expect(await savedTitles(page), 'en -> ko').toEqual(koWant)
  for (const [id, label] of Object.entries(koWant)) {
    expect(label, `${id}: the ko dictionary must translate it`).not.toBe(enWant[id])
    expect(/\p{Script=Hangul}/u.test(label), `${id}: ${label}`).toBe(true)
  }

  // 3 — and back: the Korean titles are official too, so they are not read as
  //     user renames and preserved
  await setLocale(page, 'en')
  expect(await savedTitles(page), 'ko -> en').toEqual(enWant)

  // 4 — a user rename stays through both directions; the other three move
  await renameFrame(page, 'zone_free', 'My free banner')
  await expect.poll(() => savedTitles(page), { message: 'the rename is saved' }).toEqual({
    ...enWant,
    zone_free: 'My free banner',
  })
  await setLocale(page, 'ko')
  await expect.poll(() => savedTitles(page), { message: 'en -> ko with a rename' }).toEqual({
    ...koWant,
    zone_free: 'My free banner',
  })
  await setLocale(page, 'en')
  await expect.poll(() => savedTitles(page), { message: 'ko -> en with a rename' }).toEqual({
    ...enWant,
    zone_free: 'My free banner',
  })

  // 5 — a relabel moves TITLES only: counts and frame geometry are untouched
  expect(await docState(page).then((s) => s.shape)).toEqual(seeded.shape)
})

test('§L2.0 — frame titles from a retired language are kept as the user’s on every switch', async ({ page }) => {
  // A document made in Simplified Chinese before §L2.0 carries the gacha
  // Template's Chinese titles. Those were official then; now no dictionary
  // ships them, so they are user content and must never be rewritten. The two
  // English-titled frames are still official and still switch.
  //
  // The titles are the ones `frameLabelCoverage.test.ts` pins. `常驻／免费`
  // carries U+FF0F FULLWIDTH SOLIDUS, written as an escape so no reader takes it
  // for an ASCII `/`.
  const RETIRED = { zone_comparison: '对比', zone_free: '常驻／免费' }

  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'en')
  await openGachaInEnglish(page)
  const enWant = await dictFrameTitles(page, 'en')
  for (const [id, label] of Object.entries(RETIRED)) await renameFrame(page, id, label)
  await expect
    .poll(() => savedTitles(page), { message: 'the retired-language titles are saved' })
    .toEqual({ ...enWant, ...RETIRED })
  const seeded = await docState(page)

  // reopen it, as a returning user would: the saved document is what boots
  await openApp(page)
  await expect.poll(() => savedTitles(page), { message: 'reopened unchanged' }).toEqual({ ...enWant, ...RETIRED })

  await setLocale(page, 'ko')
  const koWant = await dictFrameTitles(page, 'ko')
  await expect.poll(() => savedTitles(page), { message: 'en -> ko' }).toEqual({ ...koWant, ...RETIRED })

  await setLocale(page, 'en')
  await expect.poll(() => savedTitles(page), { message: 'ko -> en' }).toEqual({ ...enWant, ...RETIRED })

  await setLocale(page, 'ko')
  await expect.poll(() => savedTitles(page), { message: 'en -> ko, again' }).toEqual({ ...koWant, ...RETIRED })

  expect(await docState(page).then((s) => s.shape)).toEqual(seeded.shape)
})
