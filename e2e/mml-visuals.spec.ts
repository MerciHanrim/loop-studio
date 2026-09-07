import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { importGraph, openApp, resetAll, test } from './support/loop'

// docs/mmo-multilingual-layout.md §MML4 — the visual-review capture set, run in
// CI so it does not depend on a flaky local dev server. These are NOT assertion
// tests: each `test` just drives the app and writes PNGs to
// `test-results/mml-visuals/`, which the workflow uploads as an artifact. The
// real gates are the DOM/engine specs (`node-long-label.spec.ts`,
// `mmo-progression.test.ts`, `templates.trajectory.test.ts`, …).

const OUT = resolve(process.cwd(), 'test-results/mml-visuals')
mkdirSync(OUT, { recursive: true })

const MMO = readFileSync(resolve(process.cwd(), 'examples/mmo-progression.json'), 'utf8')
const COFFEE = readFileSync(resolve(process.cwd(), 'examples/coffee-roastery.json'), 'utf8')

// §MML3 initialView for MMO (src/model/templates.ts) + the minimap-safe framing
// from Canvas.tsx `applyInitialView`, reproduced here for the capture.
const MML3 = { rect: { x: 0, y: 0, width: 880, height: 360 }, minZoom: 0.6 }

const kinds = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register'] as const
const SHORT: Record<string, string> = { pool: 'Gold', source: 'Spawn', drain: 'Loss', gate: 'Split', converter: 'Meter', end: 'Done', parameter: 'Rate', register: 'Net' }
// ~24–28 chars — wraps to EXACTLY two lines at the 135px soft-max on every kind
const TWO: Record<string, string> = {
  pool: 'Gold reserve balance total',
  source: 'Daily green-bean intake volume',
  drain: 'Roasting weight shrink loss',
  gate: 'Combat outcome branch split',
  converter: 'XP to level meter conversion',
  end: 'Reached level fifteen milestone',
  parameter: 'Green-bean daily intake (kg)',
  register: 'Net daily operating margin',
}
// ~42–48 chars — longer than any shipped label; wraps to three lines (the
// graceful-degradation stress row: box grows, no spill, no clipped silhouette)
const THREE: Record<string, string> = {
  pool: 'Cumulative regional wholesale demand (kg per day)',
  source: 'Scheduled staff cupping and calibration draw',
  drain: 'Non-recoverable roasting shrinkage and defect loss',
  gate: 'Encounter outcome branch: win / soft-fail / death',
  converter: 'Experience-to-level meter conversion per band',
  end: 'Reached the level fifteen completion milestone',
  parameter: 'Daily green-bean intake operating lever (kg)',
  register: 'Projected net operating gold after expenses',
}
const dataFor = (k: string, label: string) => {
  switch (k) {
    case 'pool': return { kind: k, label, activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' }
    case 'source': return { kind: k, label, activation: 'onStart', rate: 1, mode: 'push' }
    case 'drain': return { kind: k, label, activation: 'passive', rate: 1, mode: 'pullAny' }
    case 'gate': return { kind: k, label, distribution: 'deterministic', mode: 'pullAny', weights: {} }
    case 'converter': return { kind: k, label, activation: 'passive', ratioIn: 1, ratioOut: 1, mode: 'pullAny' }
    case 'end': return { kind: k, label, activation: 'passive', mode: 'pullAny' }
    case 'parameter': return { kind: k, label, value: 4.5, min: 0, max: 10, step: 0.5, unit: 'kg' }
    default: return { kind: k, label, expr: '@p_pool * 2', format: 'float', unit: 'gold' }
  }
}
const silGraph = () => ({
  schema: 'loop-studio/graph',
  version: 1,
  edges: [],
  nodes: [
    { id: 'p_pool', type: 'pool', position: { x: 1180, y: 20 }, data: dataFor('pool', 'Ref') },
    ...kinds.flatMap((k, i) => {
      const y = 20 + i * 176
      return [
        { id: `${k}_a`, type: k, position: { x: 40, y }, data: dataFor(k, SHORT[k]) },
        { id: `${k}_b`, type: k, position: { x: 360, y }, data: dataFor(k, TWO[k]) },
        { id: `${k}_c`, type: k, position: { x: 720, y }, data: dataFor(k, THREE[k]) },
      ]
    }),
  ],
})

const setLocale = async (page: Page, code: string) => {
  await page.evaluate((c) => {
    void (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (c: string) => void } } } }).__loop.i18n.getState().setLocale(c)
  }, code)
  await page.waitForFunction((c) => document.documentElement.lang === c, code, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(900)
  await page.evaluate(() => document.fonts.ready)
}
const setVp = (page: Page, v: object) =>
  page.evaluate((vp) => (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(vp, { duration: 0 }), v)
const fitAll = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: { rf: { fitView: (o: object) => void } } }).__loop.rf.fitView({ padding: 0.06 }))
const frameMML3 = (page: Page) =>
  page.evaluate((iv) => {
    const rf = document.querySelector('.react-flow') as HTMLElement
    const pw = rf.clientWidth, ph = rf.clientHeight
    const minimapFits = pw >= 640 && ph >= 380 // mirrors Canvas.tsx `minimapFits` (non-mobile here)
    const INSET_L = 44, INSET_R = minimapFits ? 224 : 0, INSET_B = minimapFits ? 176 : 0
    const uw = Math.max(160, pw - INSET_L - INSET_R)
    const uh = Math.max(120, ph - INSET_B)
    const rectW = Math.min(iv.rect.width, (uw - 8) / iv.minZoom)
    const pad = 1.06
    const z = Math.min(1.2, Math.max(iv.minZoom, Math.min(uw / (rectW * pad), uh / (iv.rect.height * pad))))
    const contentH = iv.rect.height * z
    ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
      {
        x: INSET_L + 8 - iv.rect.x * z,
        y: contentH <= uh ? uh / 2 - (iv.rect.y + iv.rect.height / 2) * z : 12 - iv.rect.y * z,
        zoom: z,
      },
      { duration: 0 },
    )
  }, MML3)
const HIDE_HINTS = '.hint-note,.lgr-focus-hint,.lgr-suggest-note{display:none!important}'
const hideChrome = (page: Page) =>
  page.addStyleTag({ content: `.react-flow__minimap,.react-flow__controls,${HIDE_HINTS}` })
const shot = (page: Page, name: string) => page.locator('.react-flow').screenshot({ path: `${OUT}/${name}.png` })

// Only the dedicated `mml-visuals` CI job (which sets MML_VISUALS=1) runs this
// producer. The default sharded `e2e` run walks every project, so without this
// guard the heavy multi-locale captures would also execute — and fail — there.
test.skip(!process.env.MML_VISUALS, 'review-artifact producer — run by the mml-visuals job only')

for (const theme of ['light', 'dark'] as const) {
  test.describe(`§MML visuals — ${theme}`, () => {
    test.use({ colorScheme: theme })

    test(`silhouettes 64 / 2-line / 3-line, per kind (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      await openApp(page)
      await resetAll(page)
      await hideChrome(page)
      await importGraph(page, JSON.stringify(silGraph()))
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(500)

      // per-kind: centre the viewport on that kind's row (grid pitch 176, the
      // three variants at flow x 40 / 360 / 720) and shoot the whole pane, so
      // every silhouette is captured in full, nothing cropped
      const lines: Record<string, number> = {}
      for (let i = 0; i < kinds.length; i++) {
        await page.evaluate(
          ({ rowY }) => {
            const rf = document.querySelector('.react-flow') as HTMLElement
            const pw = rf.clientWidth, ph = rf.clientHeight
            ;(window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
              { x: pw / 2 - 470, y: ph / 2 - rowY, zoom: 1 },
              { duration: 0 },
            )
          },
          { rowY: 20 + i * 176 + 45 },
        )
        await page.waitForTimeout(200)
        await page.locator('.react-flow').screenshot({ path: `${OUT}/sil-${theme}-${kinds[i]}.png` })
      }

      // one contact sheet with ALL EIGHT rows in frame + the per-node line
      // counts for the record. A tall pane so nothing is clipped at the bottom.
      await page.setViewportSize({ width: 1200, height: 1560 })
      await page.waitForTimeout(200)
      await setVp(page, { x: 30, y: 16, zoom: 0.82 })
      await page.waitForTimeout(300)
      await shot(page, `contact-silhouettes-${theme}`)
      Object.assign(
        lines,
        await page.evaluate(() => {
          const out: Record<string, number> = {}
          document.querySelectorAll('.react-flow__node').forEach((el) => {
            const id = el.getAttribute('data-id')
            const t = el.querySelector('.nodef__title') as HTMLElement
            if (!id || !t) return
            const lh = parseFloat(getComputedStyle(t).lineHeight) || 16
            out[id] = Math.round(t.offsetHeight / lh)
          })
          return out
        }),
      )
      console.log(`[${theme}] silhouette title line counts:`, JSON.stringify(lines))
    })

    for (const [tpl, str] of [['mmo', MMO], ['coffee', COFFEE]] as const) {
      test(`${tpl} fit + detail, EN/KO/JA (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1000 })
        await openApp(page)
        await resetAll(page)
        await hideChrome(page)
        for (const loc of ['en', 'ko', 'ja'] as const) {
          await setLocale(page, 'en')
          await importGraph(page, str)
          await page.waitForTimeout(300)
          await setLocale(page, loc)
          await fitAll(page)
          await page.waitForTimeout(500)
          await shot(page, `${tpl}-fitall-${theme}-${loc}`)
          await setVp(page, tpl === 'mmo' ? { x: -300, y: -900, zoom: 0.9 } : { x: -60, y: -240, zoom: 0.95 })
          await page.waitForTimeout(400)
          await shot(page, `${tpl}-detail-${theme}-${loc}`)
        }
      })
    }

    for (const w of [1920, 1280, 820] as const) {
      test(`MMO initial screen ${w}px, EN/KO/JA (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: Math.round(w * 0.62) })
        await openApp(page)
        await resetAll(page)
        // hide only the transient canvas hints — the minimap is deliberately
        // left visible so the review sees whether the §MML3 framing sits clear
        // of it (and that it is auto-hidden at the smallest pane)
        await page.addStyleTag({ content: HIDE_HINTS })
        for (const loc of ['en', 'ko', 'ja'] as const) {
          await setLocale(page, 'en')
          await importGraph(page, MMO)
          await page.waitForTimeout(300)
          await setLocale(page, loc)
          await frameMML3(page)
          await page.waitForTimeout(400)
          await shot(page, `mmo-initial-${w}-${theme}-${loc}`)
        }
      })
    }

    test(`states — selected / invalid / Focus (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      await openApp(page)
      await resetAll(page)
      await hideChrome(page)
      await importGraph(page, JSON.stringify({
        schema: 'loop-studio/graph', version: 1, edges: [],
        nodes: [
          { id: 'p_pool', type: 'pool', position: { x: 80, y: 80 }, data: dataFor('pool', TWO.pool) },
          { id: 'reg', type: 'register', position: { x: 520, y: 80 }, data: { kind: 'register', label: TWO.register, expr: '1 / (@p_pool - @p_pool)', unit: 'gold' } },
          { id: 'conv', type: 'converter', position: { x: 80, y: 300 }, data: dataFor('converter', TWO.converter) },
        ],
      }))
      await setVp(page, { x: 40, y: 20, zoom: 1 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(400)
      await page.locator('.react-flow__node[data-id="conv"]').click().catch(() => {})
      await page.waitForTimeout(300)
      await page.locator('.react-flow__node[data-id="conv"]').screenshot({ path: `${OUT}/state-${theme}-selected.png` })
      await page.locator('.react-flow__node[data-id="reg"]').screenshot({ path: `${OUT}/state-${theme}-invalid.png` })
      await importGraph(page, MMO)
      await fitAll(page)
      await page.waitForTimeout(500)
      await shot(page, `state-${theme}-focus-off`)
      await page.locator('.react-flow__node[data-id="z1_enc"]').click().catch(() => {})
      await page.waitForTimeout(200)
      await page.keyboard.press('f').catch(() => {})
      await page.waitForTimeout(600)
      await shot(page, `state-${theme}-focus-on`)
    })
  })
}
