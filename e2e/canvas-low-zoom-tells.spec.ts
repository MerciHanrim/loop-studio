import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-4.1 "Low zoom" (colour review, 2026-11-11) — the
// canvas zoom is a CSS scale that non-scaling strokes do not undo, so:
//  - the selection ring keeps a band of max(2 z, 1.5) px and a gap of max(2.5 z, 0.75) px ON
//    SCREEN (node-local widths = screen px / zoom); zoom 1 keeps the NODE_RINGS 2.5 – 4.5;
//  - on a selected node the invalid ring starts 2 node-local px outside the selection ring;
//  - keyboard focus at L0 / L1 is four corner marks outside the node (a `::before`), at
//    max(3.5, 6.5 z + 1) px out on screen, instead of the inside dashed ring; from L2 the ring;
//  - a pressed tool or status toggle writes its word in `--sel-name`, its ring in `--sel`.
// Pixel-level reads of the same rules (shown share, contrast, ground between ring and outline,
// the corners' area) were taken on the 3-zone gacha Template outside the suite; this spec pins
// the geometry the CSS computes, so a later rule that drops or overrides a floor fails here.

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'gold', type: 'pool', position: { x: 40, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'r_bad', type: 'register', position: { x: 320, y: 200 }, data: { kind: 'register', label: 'Ratio', expr: '1 / (@gold - @gold)', unit: 'gold' } },
  ],
  edges: [],
})

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(GRAPH, 'utf8') })
  await expect(page.locator('.react-flow__node[data-id="r_bad"]')).toBeVisible()
}

/** the zoom, with the Register kept in the pane */
async function zoomTo(page: Page, zoom: number): Promise<void> {
  await page.evaluate((zoom) => {
    const w = window as unknown as { __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } } }
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    w.__loop.rf.setViewport({ x: pane.width / 2 - 380 * zoom, y: pane.height / 2 - 230 * zoom, zoom }, { duration: 0 })
  }, zoom)
  await expect(page.locator('.canvas')).toHaveAttribute('style', new RegExp(`--canvas-zoom: ${zoom}(;|$)`))
}

const px = (l: Locator, prop: 'strokeWidth') => l.evaluate((el, prop) => parseFloat(getComputedStyle(el)[prop]), prop)
const before = (l: Locator) =>
  l.evaluate((el) => {
    const s = getComputedStyle(el, '::before')
    return { content: s.content, top: parseFloat(s.top), left: parseFloat(s.left), fc: s.getPropertyValue('--fc').trim() }
  })

/** the selection ring's node-local widths at `zoom`: [ring stroke, its cut, the invalid cut, the invalid stroke] */
const expected = (zoom: number) => {
  const gap = Math.max(2.5, 0.75 / zoom)
  const to = gap + Math.max(2, 1.5 / zoom)
  const invFrom = to + Math.max(2, 0.75 / zoom)
  return [2 * to, 2 * gap, 2 * invFrom, 2 * (invFrom + Math.max(2, 1.5 / zoom))]
}

test.describe('low-zoom selection ring and focus corners (FC-4.1)', () => {
  test('the selection ring keeps its on-screen floors, and the invalid ring stays outside it', async ({ page }) => {
    await load(page)
    const bad = page.locator('.react-flow__node[data-id="r_bad"]')
    const q = (c: string) => bad.locator(c)

    // not selected: the invalid ring is the NODE_RINGS 6.5 – 8.5 at every zoom
    await zoomTo(page, 0.2)
    expect(await px(q('.nodef__inv-cut'), 'strokeWidth')).toBeCloseTo(13, 2)
    expect(await px(q('.nodef__invalid'), 'strokeWidth')).toBeCloseTo(17, 2)

    await bad.focus()
    await page.keyboard.press(' ')
    await expect(q('.nodef__sel')).toHaveCount(1)
    for (const zoom of [1, 0.5, 0.2]) {
      await test.step(`zoom ${zoom}`, async () => {
        await zoomTo(page, zoom)
        const [ring, cut, invCut, inv] = expected(zoom)
        expect(await px(q('.nodef__sel'), 'strokeWidth'), 'ring').toBeCloseTo(ring, 2)
        expect(await px(q('.nodef__sel-cut'), 'strokeWidth'), 'its cut').toBeCloseTo(cut, 2)
        expect(await px(q('.nodef__inv-cut'), 'strokeWidth'), 'invalid cut').toBeCloseTo(invCut, 2)
        expect(await px(q('.nodef__invalid'), 'strokeWidth'), 'invalid ring').toBeCloseTo(inv, 2)
        // on screen: band max(2 z, 1.5), gap max(2.5 z, 0.75); the invalid ring's gap
        // max(2 z, 0.75) and band max(2 z, 1.5), its dashes at least 3 on / 2.25 off
        expect(((ring - cut) / 2) * zoom).toBeCloseTo(Math.max(2 * zoom, 1.5), 2)
        expect((cut / 2) * zoom).toBeCloseTo(Math.max(2.5 * zoom, 0.75), 2)
        expect(((invCut - ring) / 2) * zoom).toBeCloseTo(Math.max(2 * zoom, 0.75), 2)
        expect(((inv - invCut) / 2) * zoom).toBeCloseTo(Math.max(2 * zoom, 1.5), 2)
        const dash = await q('.nodef__invalid').evaluate((el) => getComputedStyle(el).strokeDasharray.split(/[ ,]+/).map(parseFloat))
        expect(dash[0] * zoom).toBeCloseTo(Math.max(4 * zoom, 3), 2)
        expect(dash[1] * zoom).toBeCloseTo(Math.max(3 * zoom, 2.25), 2)
      })
    }
    // zoom 1 is the table: 2.5 – 4.5 and 6.5 – 8.5
    expect(expected(1)).toEqual([9, 5, 13, 17])
  })

  test('keyboard focus is corner marks below L2 and the dashed ring from L2, selected or not', async ({ page }) => {
    await load(page)
    const bad = page.locator('.react-flow__node[data-id="r_bad"]')
    const nodef = bad.locator('.nodef')
    await bad.focus()
    await expect(nodef).toHaveClass(/is-focused/)

    for (const selected of [false, true]) {
      if (selected) {
        await page.keyboard.press(' ')
        await expect(bad.locator('.nodef__sel')).toHaveCount(1)
      }
      await test.step(`${selected ? 'selected' : 'focus only'}, L1 (0.6) and L0 (0.3)`, async () => {
        for (const zoom of [0.6, 0.3]) {
          await zoomTo(page, zoom)
          await expect(nodef).toHaveClass(zoom >= 0.45 ? /lod-L1/ : /lod-L0/)
          await expect(bad.locator('.nodef__focus')).toBeHidden()
          const b = await before(nodef)
          expect(b.content).not.toBe('none')
          // 1 px clear of the amber relation ring, and (this Register is invalid) 1 px clear of
          // the invalid ring's outer edge on a selected node, selected or not
          const off = Math.max(3.5 / zoom, 6.5 + 1 / zoom, expected(zoom)[3] / 2 + 1 / zoom)
          expect(b.top).toBeCloseTo(-off, 2)
          expect(b.left).toBeCloseTo(-off, 2)
        }
      })
      await test.step(`${selected ? 'selected' : 'focus only'}, L2 (0.8)`, async () => {
        await zoomTo(page, 0.8)
        await expect(nodef).toHaveClass(/lod-L2/)
        await expect(bad.locator('.nodef__focus')).toBeVisible()
        expect((await before(nodef)).content).toBe('none')
      })
    }

    // a node that is not invalid: 1 px clear of the amber relation ring only
    const gold = page.locator('.react-flow__node[data-id="gold"]')
    await gold.focus()
    for (const zoom of [0.6, 0.3]) {
      await zoomTo(page, zoom)
      const b = await before(gold.locator('.nodef'))
      expect(b.content).not.toBe('none')
      expect(b.top).toBeCloseTo(-Math.max(3.5 / zoom, 6.5 + 1 / zoom), 2)
    }
  })

  test('forced colours: the corners take Highlight', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page)
    const bad = page.locator('.react-flow__node[data-id="r_bad"]')
    await bad.focus()
    await zoomTo(page, 0.6)
    expect((await before(bad.locator('.nodef'))).fc).toBe('Highlight')
  })
})

/** read from the screenshot's own pixels: the selected + focused + invalid Register's selection
 *  band, invalid band and focus corners. A pixel shows a cue when it is closer to the cue's
 *  colour than half the cue's distance from the canvas ground (an anti-aliased hair of a line
 *  does not count). Per sample along a ring: was the cue seen in its band, and which of the
 *  selection / invalid colours is the OUTERMOST seen along the outward normal. */
async function readCues(page: Page, zoom: number, forced: boolean) {
  const b64 = (await page.screenshot()).toString('base64')
  return page.evaluate(
    async ({ b64, zoom, forced }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const cx = cv.getContext('2d', { willReadFrequently: true })!
      cx.drawImage(img, 0, 0)
      const px = (x: number, y: number) => [...cx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]
      const rgb = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
      const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      const node = document.querySelector('.react-flow__node[data-id="r_bad"]')!
      const nodef = node.querySelector('.nodef') as HTMLElement
      const ground = rgb(getComputedStyle(document.querySelector('.react-flow')!).backgroundColor)
      const probe = document.createElement('span')
      probe.style.cssText = `color:${forced ? 'Highlight' : 'var(--focus)'};forced-color-adjust:none`
      nodef.append(probe)
      const focusC = rgb(getComputedStyle(probe).color)
      probe.remove()
      const sel = node.querySelector('.nodef__sel') as SVGGeometryElement
      const inv = node.querySelector('.nodef__invalid') as SVGGeometryElement
      const selC = rgb(getComputedStyle(sel).stroke)
      const invC = rgb(getComputedStyle(inv).stroke)
      // a pixel is read as a blend of the ground and one cue colour (anti-aliasing): it shows the
      // cue when it is at least half the cue (t ≥ 0.5 along ground → cue), lies close to that
      // blend line, and fits it better than any other cue colour. (Nearest-colour alone misreads
      // in forced (light), where a grey edge of a CanvasText dash is nearer Highlight than black.)
      const cues = [selC, invC, focusC]
      const fit = (p: number[], c: number[]) => {
        const d = [0, 1, 2].map((k) => c[k] - ground[k])
        const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1
        const t = ((p[0] - ground[0]) * d[0] + (p[1] - ground[1]) * d[1] + (p[2] - ground[2]) * d[2]) / dd
        return { t, res: Math.hypot(...[0, 1, 2].map((k) => ground[k] + t * d[k] - p[k])) / Math.sqrt(dd) }
      }
      const is = (p: number[], c: number[]) => {
        const f = fit(p, c)
        return f.t >= 0.5 && f.res < 0.2 && cues.every((o) => dist(o, c) < 1 || fit(p, o).t < 0.5 || fit(p, o).res >= f.res)
      }
      const w = (el: Element) => (parseFloat(getComputedStyle(el).strokeWidth) / 2) * zoom
      const selBand = [w(node.querySelector('.nodef__sel-cut')!), w(sel)]
      const invBand = [w(node.querySelector('.nodef__inv-cut')!), w(inv)]
      const sym = node.querySelector('.nodef__stroke')!.getBoundingClientRect()
      const cxN = sym.left + sym.width / 2, cyN = sym.top + sym.height / 2
      const ring = (el: SVGGeometryElement, band: number[], c: number[]) => {
        const m = el.getScreenCTM()!
        const n = el.getTotalLength()
        const at = (s: number) => { const q = el.getPointAtLength(s); return [m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f] }
        let seen = 0, outer = 0, perim = 0
        const N = 240
        const hits: boolean[] = []
        for (let i = 0; i < N; i++) {
          const [ax, ay] = at((n * i) / N), [bx, by] = at(Math.min(n, (n * i) / N + n / (N * 4)))
          const [qx, qy] = at((n * (i + 1)) / N)
          perim += Math.hypot(qx - ax, qy - ay)
          const len = Math.hypot(bx - ax, by - ay) || 1
          let nx = -(by - ay) / len, ny = (bx - ax) / len
          if (nx * (ax - cxN) + ny * (ay - cyN) < 0) { nx = -nx; ny = -ny }
          let hit = false
          for (let o = band[0] - 0.5; o <= band[1] + 0.5; o += 0.25) if (is(px(ax + nx * o, ay + ny * o), c)) hit = true
          hits.push(hit)
          if (!hit) continue
          seen++
          // the outermost of the two ring colours along this normal, out to 4 px past the invalid band
          let last: 'sel' | 'inv' | null = null
          for (let o = 0; o <= invBand[1] + 4; o += 0.25) {
            const p = px(ax + nx * o, ay + ny * o)
            if (is(p, invC)) last = 'inv'
            else if (is(p, selC)) last = 'sel'
          }
          if (last === 'inv') outer++
        }
        // the median length on screen of an unbroken stretch where the cue shows (a dash)
        const runs: number[] = []
        let run = 0
        for (const h of hits) { if (h) run++; else if (run) { runs.push(run); run = 0 } }
        if (run) runs.push(run)
        runs.sort((u, v) => u - v)
        const medianRunPx = runs.length ? +((runs[Math.floor(runs.length / 2)] * perim) / N).toFixed(2) : 0
        return { seenShare: +(seen / N).toFixed(3), outermostShare: seen ? +(outer / seen).toFixed(3) : 0, medianRunPx }
      }
      // the corner marks: focus-colour pixels in each corner's arm square, on screen
      const box = nodef.getBoundingClientRect()
      const b = getComputedStyle(nodef, '::before')
      const corners = b.content === 'none' ? null : (() => {
        const off = -parseFloat(b.top) * zoom
        // the arm is 3.5 px on screen, at most one node-local px more (rounded up)
        const arm = 3.5
        // per corner square: [focus-colour, invalid-colour] samples
        const sq = (x0: number, y0: number, sx: number, sy: number) => {
          let k = 0, i = 0
          for (let dx = 0; dx < arm + 1; dx += 0.5) for (let dy = 0; dy < arm + 1; dy += 0.5) {
            const p = px(x0 + sx * dx, y0 + sy * dy)
            if (is(p, focusC)) k++
            if (is(p, invC)) i++
          }
          return [k, i]
        }
        return [
          sq(box.left - off, box.top - off, 1, 1),
          sq(box.right + off, box.top - off, -1, 1),
          sq(box.left - off, box.bottom + off, 1, -1),
          sq(box.right + off, box.bottom + off, -1, -1),
        ]
      })()
      return { selection: ring(sel, selBand, selC), invalid: ring(inv, invBand, invC), corners, selBand, invBand }
    },
    { b64, zoom, forced },
  )
}

test.describe('selected + keyboard-focused + invalid: the invalid ring is the outermost and covers nothing (FC-4.1)', () => {
  const MODES = [
    { name: 'light', colorScheme: 'light' as const, forced: false },
    { name: 'dark', colorScheme: 'dark' as const, forced: false },
    { name: 'forced (light)', colorScheme: 'light' as const, forced: true },
    { name: 'forced (dark)', colorScheme: 'dark' as const, forced: true },
  ]
  for (const mode of MODES) {
    test(mode.name, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode.colorScheme, forcedColors: mode.forced ? 'active' : 'none', reducedMotion: 'reduce' })
      await load(page)
      await page.addStyleTag({ content: '.react-flow__attribution{display:none!important}' })
      const bad = page.locator('.react-flow__node[data-id="r_bad"]')
      await bad.focus()
      await page.keyboard.press(' ')
      await expect(bad.locator('.nodef__sel')).toHaveCount(1)
      await page.mouse.move(2, 2)
      for (const [zoom, lod] of [[0.2, 'L0'], [0.6, 'L1'], [1, 'L2']] as const) {
        await test.step(`${lod} (zoom ${zoom})`, async () => {
          await zoomTo(page, zoom)
          await expect(bad.locator('.nodef')).toHaveClass(new RegExp(`lod-${lod}`))
          await expect(bad.locator('.nodef')).toHaveClass(/is-focused/)
          await page.waitForTimeout(150)
          const r = await readCues(page, zoom, mode.forced)
          test.info().annotations.push({ type: `${mode.name} ${lod}`, description: JSON.stringify(r) })
          await page.screenshot({ path: test.info().outputPath(`${lod}.png`), clip: await bad.boundingBox().then((bb) => ({ x: bb!.x - 30, y: bb!.y - 30, width: bb!.width + 60, height: bb!.height + 60 })) })
          // the invalid band begins outside the selection band, on screen
          expect.soft(r.invBand[0], 'invalid starts outside the selection ring').toBeGreaterThan(r.selBand[1])
          // the selection ring shows all round; the dashed invalid ring shows (its dashes) and
          // is the outermost of the two wherever it shows
          // (0.85: the ring at zoom 1, unchanged from before, read 0.896 in dark)
          expect.soft(r.selection.seenShare, 'selection ring shown').toBeGreaterThanOrEqual(0.85)
          // The share is over 240 points spread evenly along the WHOLE ring, dashes and gaps alike,
          // so a `4 3` (or 3 : 2.25) dash shows at about 4/7 ≈ 0.57 at best; 0.50 – 0.64 were read.
          expect.soft(r.invalid.seenShare, 'invalid dashes shown').toBeGreaterThanOrEqual(0.35)
          // and read as dashes: a median dash of at least 2.5 px on screen (with the floor 2.91 –
          // 3.63 measured; without it the dashes were 0.91 – 1.09 px at L0 and 2.18 at L1)
          expect.soft(r.invalid.medianRunPx, 'invalid dashes long enough to read').toBeGreaterThanOrEqual(2.5)
          if (lod === 'L2') {
            expect.soft(r.invalid.outermostShare, 'invalid is the outermost').toBeGreaterThanOrEqual(0.9)
            expect.soft(r.corners, 'no corners from L2').toBeNull()
            await expect.soft(bad.locator('.nodef__focus')).toBeVisible()
          } else {
            // each of the four corner marks shows, and hides none of the invalid dashes: the same
            // frame with the corners taken away has no more invalid-colour pixels in their squares
            const corners = r.corners ?? [[0, 0], [0, 0], [0, 0], [0, 0]]
            for (const [k] of corners) expect.soft(k, 'a corner mark shown').toBeGreaterThanOrEqual(4)
            const style = await page.addStyleTag({ content: '.react-flow__node[data-id="r_bad"] .nodef::before { visibility: hidden !important; }' })
            await page.waitForTimeout(100)
            const without = await readCues(page, zoom, mode.forced)
            await style.evaluate((el) => (el as Element).remove())
            const hidden = without.corners ?? [[0, 0], [0, 0], [0, 0], [0, 0]]
            test.info().annotations.push({ type: `${mode.name} ${lod} corners`, description: JSON.stringify({ with: corners, without: hidden, outermost: without.invalid.outermostShare }) })
            corners.forEach(([, inv], i) => expect.soft(inv, `corner ${i} hides no invalid dash`).toBeGreaterThanOrEqual(hidden[i][1]))
            expect.soft(without.selection.seenShare, 'the corners hide none of the selection ring').toBeLessThanOrEqual(r.selection.seenShare + 0.01)
            // the rings' order is read with the corners taken away: in forced colours the corners
            // are Highlight, the selection's colour, and lie outside both rings at the box corners
            expect.soft(without.invalid.outermostShare, 'invalid is the outermost').toBeGreaterThanOrEqual(0.9)
          }
          await expect(bad.locator('.nodef__flag')).toBeVisible()
        })
      }
    })
  }
})

test.describe('a pressed control writes its word in --sel-name', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(scheme, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await load(page)
      const token = (name: string) =>
        page.evaluate((name) => {
          const el = document.createElement('span')
          el.style.color = `var(${name})`
          document.body.append(el)
          const c = getComputedStyle(el).color
          el.remove()
          return c
        }, name)
      const [selName, sel] = [await token('--sel-name'), await token('--sel')]
      expect(selName).not.toBe(sel)
      for (const pressed of [page.locator('.wb-toolgroup .wb-tb.is-on').first(), page.locator('.wb-status .wb-zb.is-on').first()]) {
        await expect(pressed).toHaveCSS('color', selName)
        await expect(pressed).toHaveCSS('box-shadow', new RegExp(sel.replace(/[()]/g, '\\$&')))
      }
    })
  }
})
