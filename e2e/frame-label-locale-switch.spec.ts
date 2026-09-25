import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/template-label-overlay.md §TLO12 — the frame-title half of the locale
// switch, through the REAL UI, for a locale whose code carries a hyphen.
//
// THE TRAP IS DIRECTIONAL, AND THAT IS WHAT THIS SPEC WALKS
//
//   1 the English frame titles ARE in the known-official index, so `en` ->
//     `zh-Hans` switches and the product writes the Chinese titles;
//   2 those Chinese titles were NOT in the index, because
//     `scripts/gen-known-labels.mjs` located a locale's frame map by searching
//     for `export const <locale>Frames` — a string that never matches a
//     hyphenated code (`zh-HansFrames` against the real `zhHansFrames`) — and
//     returned an EMPTY slice in silence;
//   3 so every later switch read the current Chinese title as a USER RENAME
//     and preserved it. Once a document entered one of the six hyphenated
//     locales it was stuck there for every language afterwards, while its NODE
//     labels kept switching correctly.
//
// `coffee-zone-frames.spec.ts` already checked frame titles in the browser —
// for `en`, `ko` and `ja`, all three of them codes the generator could find.
// Every locale it covered was a locale that worked. This spec enters through
// the hyphenated door on purpose.
//
// The Chinese strings are DERIVED from the shipped dictionary inside the page
// and never retyped here: `常驻／免费` carries U+FF0F FULLWIDTH SOLIDUS, which
// no screenshot distinguishes from an ASCII `/` between spaces.

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

const templatesMenu = (page: Page) => page.locator('.toolbar__actions .menu').first()

/** Open the gacha Template from an ENGLISH UI — the entry point of the trap. */
async function openGachaInEnglish(page: Page) {
  await templatesMenu(page).locator('> button').click()
  await templatesMenu(page)
    .locator('.menu__pop [role="menuitem"]', { hasText: /gacha banner comparison/i })
    .click()
  const confirm = page.locator('.mcdlg--confirm .mcdlg__foot .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.lgr-frame')).toHaveCount(4)
}

test('a document that enters a hyphenated locale can still leave it', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'en')

  // 1 — seed in English, the state every user starts from
  await openGachaInEnglish(page)
  const enWant = await dictFrameTitles(page, 'en')
  expect(Object.keys(enWant)).toHaveLength(4)
  const seeded = await docState(page)
  expect(seeded.titles).toEqual(enWant)
  expect(seeded.shape).toMatchObject({ nodes: 63, frames: 4 })

  // 2 — enter the hyphenated locale. This step always worked: the ENGLISH
  //     titles are in the index, so they switch.
  await setLocale(page, 'zh-Hans')
  const zhWant = await dictFrameTitles(page, 'zh-Hans')
  expect(await docState(page).then((s) => s.titles)).toEqual(zhWant)
  // the fixture is really Han, not English that happens to match
  for (const [id, label] of Object.entries(zhWant)) {
    if (label === enWant[id]) continue // a mechanism name kept in English on purpose
    expect(/\p{Script=Han}/u.test(label), `${id}: ${label}`).toBe(true)
  }
  expect(Object.values(zhWant).some((l) => /\p{Script=Han}/u.test(l))).toBe(true)

  // 3 — leave it again. THIS is the step the defect broke: the Chinese titles
  //     were read as user renames and preserved, in every language afterwards.
  await setLocale(page, 'en')
  expect(await docState(page).then((s) => s.titles), 'zh-Hans -> en').toEqual(enWant)

  // 4 — and a third language, so the check is not "English is special"
  await setLocale(page, 'ko')
  expect(await docState(page).then((s) => s.titles), 'en -> ko').toEqual(
    await dictFrameTitles(page, 'ko'),
  )

  // 5 — a relabel moves TITLES only: counts and frame geometry are untouched
  expect(await docState(page).then((s) => s.shape)).toEqual(seeded.shape)
})

test('every hyphenated locale is a door that opens both ways', async ({ page }) => {
  // The defect was never Chinese-specific: all six hyphenated codes missed the
  // same search. Each one is entered from English and left again.
  await openApp(page)
  await resetAll(page)
  await setLocale(page, 'en')
  await openGachaInEnglish(page)
  const enWant = await dictFrameTitles(page, 'en')

  for (const loc of ['zh-Hans', 'zh-Hant', 'es-419', 'es-ES', 'pt-BR', 'pt-PT'] as const) {
    await setLocale(page, loc)
    expect(await docState(page).then((s) => s.titles), `en -> ${loc}`).toEqual(
      await dictFrameTitles(page, loc),
    )
    await setLocale(page, 'en')
    expect(await docState(page).then((s) => s.titles), `${loc} -> en`).toEqual(enWant)
  }
})
