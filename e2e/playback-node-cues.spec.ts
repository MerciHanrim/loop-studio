import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// issue #330 PR 2 (v0.23.0) — the cues INSIDE a node (docs/simulation-playback.md
// §PB2.1 / §PB9, docs/simulation-playback-ordering.md §PBO3): the Pool arrival
// pulse, a soft tint of the silhouette from 7 px inside that starts when the
// first round token arrives and carries on across the settle (the value still
// changes at settle); and the Converter's conversion mark (option A), a 10 px
// ⇄ drawing at the node's own spot — inside the outline by 6 px and clear of
// its text — shown from the Converter's onset, faded after the settle, taking
// the type dot's place at L0. Focus mode never dims them; reduced motion holds
// them static for the step; forced colours draw the pulse as a 2 px system-
// colour line under the text. A presentation layer only.

type Loop = Record<string, { getState: () => any }>
const call = (page: Page, fn: string, ...a: unknown[]) =>
  page.evaluate(([f, args]) => (window as unknown as { __loop: Loop }).__loop.sim.getState()[f as string](...(args as unknown[])), [fn, a] as const)
const sim = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
    return { step: s.stepIndex as number, tau: (s.transition?.tau ?? null) as number | null, flow: { ...(s.transition?.flowByEdge ?? {}) } as Record<string, number> }
  })
const setViewport = (page: Page, zoom: number, x = 40, y = 120) =>
  page.evaluate(([z, vx, vy]) => (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport({ x: vx, y: vy, zoom: z }, { duration: 0 }), [zoom, x, y] as const)

const EQUILIBRIUM = readFileSync('examples/equilibrium.json', 'utf8')

/** 30 Sources, each pushing 1 a step into its own Pool: 30 moves a step, six
 *  past the 24 token-and-badge pairs */
const CAP_GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: Array.from({ length: 30 }, (_, i) => [
    { id: `s${i}`, type: 'source', position: { x: 0, y: i * 80 }, data: { kind: 'source', label: `S${i}`, activation: 'automatic', mode: 'pushAny' } },
    { id: `p${i}`, type: 'pool', position: { x: 260, y: i * 80 }, data: { kind: 'pool', label: `P${i}`, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ]).flat(),
  edges: Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, type: 'loop', source: `s${i}`, target: `p${i}`, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } })),
})

async function load(page: Page, graph: string, zoom = 1) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, graph)
  await call(page, 'reset')
  await setViewport(page, zoom)
}

/** Play slowly and pause once `pred` holds (τ-based) */
async function holdWhen(page: Page, pred: (s: Awaited<ReturnType<typeof sim>>) => boolean) {
  await call(page, 'setSpeed', 4000)
  await call(page, 'play')
  await expect.poll(async () => (pred(await sim(page)) ? 1 : -1), { timeout: 30000, intervals: [16] }).toBe(1)
  await call(page, 'pause')
}

const pulseOf = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__pulse`)
const markOf = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__conv`)
const valueOf = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .nodef__value`).innerText()

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null, forcedColors: null }).catch(() => {})
})

test('the Pool pulse starts when the token arrives, the value changes at settle, and the settle does not restart it', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  // mid-travel on the first step: the token is still on its way, no pulse yet
  await holdWhen(page, (s) => s.step === 0 && s.tau != null && s.tau > 0.4 && s.tau < 0.7)
  await expect(pulseOf(page, 'tpl-vault')).toHaveCount(0)
  // the arrive beat (local τ 0.8) before the settle (0.95): the pulse plays,
  // keyed on the step it belongs to, and the value has not changed yet
  await call(page, 'play')
  await expect.poll(async () => { const s = await sim(page); return s.step === 0 && s.tau != null && s.tau >= 0.81 && s.tau < 0.93 ? 1 : -1 }, { timeout: 20000, intervals: [16] }).toBe(1)
  await call(page, 'pause')
  await expect(pulseOf(page, 'tpl-vault')).toHaveCount(1)
  await expect(pulseOf(page, 'tpl-vault')).toHaveAttribute('data-pulse-step', '1')
  expect(await valueOf(page, 'tpl-vault')).toBe('0')
  await pulseOf(page, 'tpl-vault').evaluate((el) => el.setAttribute('data-probe', 'same'))
  // the settle commits the value; the same pulse element carries on
  await call(page, 'play')
  await expect.poll(async () => (await sim(page)).step, { timeout: 20000, intervals: [16] }).toBe(1)
  await call(page, 'pause')
  expect(await valueOf(page, 'tpl-vault')).toBe('3')
  await expect(pulseOf(page, 'tpl-vault')).toHaveAttribute('data-probe', 'same')
  // it is inside the silhouette only: a tint, no line outside forced colours
  const look = await pulseOf(page, 'tpl-vault').evaluate((g) => ({
    tint: getComputedStyle(g.querySelector('.nodef__pulse-tint')!).display,
    line: getComputedStyle(g.querySelector('.nodef__pulse-line')!).display,
    mask: g.querySelector('.nodef__pulse-tint')!.getAttribute('mask'),
  }))
  expect(look.tint).not.toBe('none')
  expect(look.line).toBe('none')
  expect(look.mask).toMatch(/-pul\)$/)
})

test('past the 24 pairs and at L0, every Pool that received still pulses at the arrival', async ({ page }) => {
  await load(page, CAP_GRAPH, 0.6)
  await holdWhen(page, (s) => s.step === 0 && s.tau != null && s.tau >= 0.81 && s.tau < 0.93)
  await expect(page.locator('.nodef__pulse')).toHaveCount(30)
  await expect(page.locator('.pb-path--over-cap')).toHaveCount(6)
  // L0: no token, the pulse is the same
  await setViewport(page, 0.3)
  await expect(page.locator('g.pb-move')).toHaveCount(0)
  await expect(page.locator('.nodef__pulse')).toHaveCount(30)
})

test('the conversion mark shows from the Converter onset, at its own spot inside the outline and clear of its text, and fades after the settle', async ({ page }) => {
  await load(page, EQUILIBRIUM, 1.5)
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.4 && s.tau < 0.7 && ((s.flow['tpl-e3'] ?? 0) > 0 || (s.flow['tpl-e5'] ?? 0) > 0))
  await expect(markOf(page, 'tpl-conv')).toHaveAttribute('data-conv-mark', 'live')
  const geo = await page.locator('.react-flow__node[data-id="tpl-conv"] .nodef').evaluate((f) => {
    const m = f.querySelector('.nodef__conv')!.getBoundingClientRect()
    const fill = f.querySelector('path.nodef__fill') as SVGPathElement
    const inv = fill.ownerSVGElement!.getScreenCTM()!.inverse()
    const scale = f.getBoundingClientRect().width / parseFloat(getComputedStyle(f).width)
    const inFill = (x: number, y: number) => fill.isPointInFill(new DOMPoint(x, y).matrixTransform(inv))
    let out = 0
    for (let i = 0; i <= 40; i++) {
      const t = i / 40
      for (const [x, y] of [[m.left + t * m.width, m.top], [m.left + t * m.width, m.bottom], [m.left, m.top + t * m.height], [m.right, m.top + t * m.height]]) {
        for (let a = 0; a < 16; a++) {
          const r = (6 - 0.25) * scale
          if (!inFill(x + Math.cos((a / 8) * Math.PI) * r, y + Math.sin((a / 8) * Math.PI) * r)) out++
        }
      }
    }
    const range = document.createRange()
    const boxes: DOMRect[] = []
    for (const sel of ['.nodef__title', '.nodef__sub']) {
      range.selectNodeContents(f.querySelector(sel)!)
      boxes.push(...[...range.getClientRects()].filter((r) => r.width > 0.5))
    }
    const hits = boxes.filter((b) => !(m.right <= b.left || m.left >= b.right || m.bottom <= b.top || m.top >= b.bottom)).length
    return { out, hits, size: m.width / scale }
  })
  // (#337: the Converter's width is a fraction of a px, so the size read back
  // through the zoom carries a float error far below a px)
  expect({ out: geo.out, hits: geo.hits }).toEqual({ out: 0, hits: 0 })
  expect(geo.size).toBeCloseTo(10, 3)
  // after the settle it fades
  await call(page, 'play')
  await expect.poll(async () => markOf(page, 'tpl-conv').getAttribute('data-conv-mark'), { timeout: 20000, intervals: [16] }).toBe('done')
  await call(page, 'pause')
  expect(await markOf(page, 'tpl-conv').evaluate((el) => getComputedStyle(el).animationName)).toBe('convOut')
})

test('at L0 the conversion mark takes the type dot’s place', async ({ page }) => {
  await load(page, EQUILIBRIUM, 0.35)
  await holdWhen(page, (s) => s.tau != null && s.tau > 0.4 && s.tau < 0.7 && (s.flow['tpl-e5'] ?? 0) > 0)
  await expect(markOf(page, 'tpl-conv')).toHaveClass(/nodef__conv--map/)
  await expect(page.locator('.react-flow__node[data-id="tpl-conv"] .nodef__cdot')).toHaveCount(0)
  await expect(page.locator('.react-flow__node[data-id="tpl-vault"] .nodef__cdot')).toHaveCount(1)
  expect(await markOf(page, 'tpl-conv').evaluate((el) => parseFloat(getComputedStyle(el).width))).toBe(18)
})

test('Focus mode never dims the pulse or the mark of a node outside the focus set', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    const l = (window as unknown as { __loop: Loop }).__loop
    l.graph.getState().setSelection('tpl-src', null)
    l.ui.getState().setFocusMode(true)
  })
  for (let i = 0; i < 4; i++) {
    await call(page, 'stepOnce')
    await expect.poll(async () => (await sim(page)).tau).toBe(null)
  }
  await expect(page.locator('.react-flow__node[data-id="tpl-prod"]')).toHaveClass(/lgr-deemph/)
  await expect(page.locator('.react-flow__node[data-id="tpl-conv"]')).toHaveClass(/lgr-deemph/)
  const strength = (sel: string) =>
    page.locator(sel).evaluate((el) => {
      let o = 1
      for (let e: Element | null = el; e && !e.classList.contains('react-flow__node'); e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
      return o
    })
  expect(await strength('.react-flow__node[data-id="tpl-prod"] .nodef__pulse')).toBe(1)
  expect(await strength('.react-flow__node[data-id="tpl-conv"] .nodef__conv')).toBe(1)
  // the node itself is dimmed
  expect(Number(await page.locator('.react-flow__node[data-id="tpl-prod"] .nodef__fill').evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.26, 2)
})

test('reduced motion: the pulse tint and the mark are static, held through a pause, cleared on Reset', async ({ page }) => {
  await load(page, EQUILIBRIUM)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (let i = 0; i < 3; i++) {
    await call(page, 'stepOnce')
    await expect.poll(async () => (await sim(page)).tau).toBe(null)
  }
  await expect(markOf(page, 'tpl-conv')).toHaveAttribute('data-conv-mark', 'done')
  const still = async () => ({
    pulse: await pulseOf(page, 'tpl-prod').evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).opacity]),
    mark: await markOf(page, 'tpl-conv').evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).opacity]),
  })
  expect(await still()).toEqual({ pulse: ['none', '1'], mark: ['none', '1'] })
  await page.waitForTimeout(700)
  expect(await still()).toEqual({ pulse: ['none', '1'], mark: ['none', '1'] })
  await call(page, 'reset')
  await expect(page.locator('.nodef__pulse, .nodef__conv')).toHaveCount(0)
})

test('forced colours: the pulse is a 2 px system-colour line under the text, the mark takes the same colour', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await load(page, EQUILIBRIUM, 1.5)
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  for (let i = 0; i < 3; i++) {
    await call(page, 'stepOnce')
    await expect.poll(async () => (await sim(page)).tau).toBe(null)
  }
  const look = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'Highlight'
    document.body.appendChild(probe)
    const highlight = getComputedStyle(probe).color
    probe.remove()
    const g = document.querySelector('.react-flow__node[data-id="tpl-prod"] .nodef__pulse')!
    const line = g.querySelector('.nodef__pulse-line')!
    const mark = document.querySelector('.react-flow__node[data-id="tpl-conv"] .nodef__conv path')!
    return {
      tint: getComputedStyle(g.querySelector('.nodef__pulse-tint')!).display,
      line: getComputedStyle(line).display,
      lineStroke: getComputedStyle(line).stroke === highlight,
      // the 2 px band: a stroke 2 × 9 px wide, masked to more than 7 px inside
      lineWidth: line.getAttribute('stroke-width'),
      markStroke: getComputedStyle(mark).stroke === highlight,
      // drawn in the node's SVG, which sits under the HTML text
      underText: g.closest('svg')!.compareDocumentPosition(document.querySelector('.react-flow__node[data-id="tpl-prod"] .nodef__body')!) === Node.DOCUMENT_POSITION_FOLLOWING,
    }
  })
  expect(look).toEqual({ tint: 'none', line: 'inline', lineStroke: true, lineWidth: '18', markStroke: true, underText: true })
})

// The 450-instance regression: every Converter of every bundled Template, in
// every shipped language — the mark's spot exists, lies inside the drawn
// outline by 6 px and clear of the title, mode text and chip by 1 px, and is
// the same on a fresh mount and after a language round trip (no re-fit drift).
const LOCALES = ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'de', 'fr', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'it', 'nl', 'ru', 'tr', 'vi', 'th', 'ar']
const CONVERTER_TEMPLATES: [string, number][] = [
  ['equilibrium', 1],
  ['deadlock', 1],
  ['mmo-progression', 23],
]

for (const [tpl, perLocale] of CONVERTER_TEMPLATES) {
  test(`${tpl}: every Converter's mark spot, in all 18 languages, is inside the outline by 6 px, clear of its text, and stable`, async ({ page }) => {
    test.setTimeout(180_000)
    await openApp(page)
    await resetAll(page)
    const measure = (loc: string, fresh: boolean) =>
      page.evaluate(
        async ([tpl, loc, fresh]) => {
          const l = (window as unknown as { __loop: Loop & { rf: { setViewport: (v: object, o: object) => void; getViewport: () => { zoom: number } } } }).__loop
          const raf = async (n: number) => { for (let i = 0; i < n; i++) await new Promise((q) => requestAnimationFrame(q)) }
          l.i18n.getState().setLocale(loc)
          while (document.documentElement.lang !== loc) await raf(1)
          if (fresh) {
            l.graph.getState().newGraph()
            await raf(3)
            const T = await import('/src/model/templates.ts')
            const L = await import('/src/i18n/templateLabels/index.ts')
            await L.ensureTemplateLabelDict(loc)
            const o = L.openTemplate(T.TEMPLATES.find((t: { id: string }) => t.id === tpl)!, loc)
            l.graph.getState().loadGraph(o.graph, { canvasLocked: false, modelVersion: o.modelVersion, initialView: null, frames: o.graph.frames })
          }
          await document.fonts.ready
          for (let i = 0; i < 20; i++) {
            l.rf.setViewport({ x: 20, y: 20, zoom: 1 }, { duration: 0 })
            await raf(4)
            if (Math.abs(l.rf.getViewport().zoom - 1) < 1e-6) break
          }
          await raf(12)
          const rows: { id: string; spot: string | null; out: number; hits: number }[] = []
          const convIds = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].filter((n) => n.querySelector('.nodef--converter')).map((n) => n.dataset.id!)
          for (const cid of convIds) {
            // bring it into view: the fill test reads the drawn shape on screen
            const pos = l.graph.getState().nodes.find((n: { id: string }) => n.id === cid).position
            l.rf.setViewport({ x: 300 - pos.x, y: 300 - pos.y, zoom: 1 }, { duration: 0 })
            await raf(3)
            const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(cid)}"]`)!
            const f = node.querySelector<HTMLElement>('.nodef.nodef--converter')!
            const spot = f.dataset.convSpot ?? null
            let out = -1
            let hits = -1
            if (spot) {
              const [sx, sy] = spot.split(',').map(Number)
              const box = f.getBoundingClientRect()
              const fill = f.querySelector('path.nodef__fill') as SVGPathElement
              const inv = fill.ownerSVGElement!.getScreenCTM()!.inverse()
              const inFill = (x: number, y: number) => fill.isPointInFill(new DOMPoint(x, y).matrixTransform(inv))
              const [x0, y0] = [box.left + sx, box.top + sy]
              out = 0
              for (let i = 0; i <= 40; i++) {
                const t = (i / 40) * 10
                for (const [x, y] of [[x0 + t, y0], [x0 + t, y0 + 10], [x0, y0 + t], [x0 + 10, y0 + t]]) {
                  for (let a = 0; a < 16; a++) if (!inFill(x + Math.cos((a / 8) * Math.PI) * 5.75, y + Math.sin((a / 8) * Math.PI) * 5.75)) out++
                }
              }
              const range = document.createRange()
              const boxes: DOMRect[] = []
              for (const sel of ['.nodef__title', '.nodef__sub']) {
                const el = f.querySelector(sel)
                if (!el) continue
                range.selectNodeContents(el)
                boxes.push(...[...range.getClientRects()].filter((r) => r.width > 0.5))
              }
              const chip = f.querySelector('.nodef__chip')?.getBoundingClientRect()
              if (chip) boxes.push(chip)
              hits = boxes.filter((b) => !(x0 + 10 <= b.left - 0.75 || x0 >= b.right + 0.75 || y0 + 10 <= b.top - 0.75 || y0 >= b.bottom + 0.75)).length
            }
            rows.push({ id: (node as HTMLElement).dataset.id!, spot, out, hits })
          }
          return rows.sort((a, b) => a.id.localeCompare(b.id))
        },
        [tpl, loc, fresh] as const,
      )
    let total = 0
    const bad: string[] = []
    let freshEn: string | null = null
    for (const loc of LOCALES) {
      const rows = await measure(loc, true)
      expect(rows.length, `${tpl} ${loc}: Converters`).toBe(perLocale)
      total += rows.length
      for (const r of rows) if (!r.spot || r.out !== 0 || r.hits !== 0) bad.push(`${loc} ${r.id} ${JSON.stringify(r)}`)
      if (loc === 'en') freshEn = JSON.stringify(rows.map((r) => [r.id, r.spot]))
    }
    expect(bad, bad.join('\n')).toEqual([])
    expect(total).toBe(perLocale * LOCALES.length)
    // the same document, back in English after 17 other languages: the same spots
    const back = await measure('en', false)
    expect(JSON.stringify(back.map((r) => [r.id, r.spot]))).toBe(freshEn)
  })
}
