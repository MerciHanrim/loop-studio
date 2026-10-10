import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { fitCount, frames, zoomOne } from './support/rowFit'
import { layoutClashes, nodeBoxes, OUTLINE_GRAPH, OUTLINE_KINDS, outlineMisfits, readOutline } from './support/outlineFit'

// issue #337 — the Pool, Source, Drain, Converter and Gate outlines have fixed
// px depths (a slant, an arrow, a notch, a waist, the Gate's points), drawn for
// the node's own width, and every painted element — the kind chip, each title
// line, each row — keeps 8 px inside the DRAWN outline at both ends; a row
// starts where the title text starts; the Gate stays centred
// (src/components/nodes/outlineFit.ts). The bundled Templates moved the least
// nodes and widened the least frames so that, in every language, no two nodes
// meet and no node crosses a frame's edge.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const LOCALES = ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'de', 'fr', 'es-ES', 'es-419', 'pt-BR', 'pt-PT', 'it', 'nl', 'ru', 'tr', 'vi', 'th', 'ar']
const TEMPLATE_IDS = ['equilibrium', 'deadlock', 'coffee-roastery', 'mmo-progression', 'gacha-banner-zones']

const load = async (page: Page) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, OUTLINE_GRAPH)
  await page.locator('.react-flow__node[data-id="gate p 3"]').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await zoomOne(page)
  await frames(page, 2)
}

const setLocale = async (page: Page, loc: string) => {
  await page.evaluate((l) => (window as unknown as Bridge).__loop.i18n.getState().setLocale(l), loc)
  await page.waitForFunction((l) => document.documentElement.lang === l, loc)
}

/** open a bundled Template fresh in `loc`, as the menu does; its node count */
const openTemplate = (page: Page, id: string, loc: string) =>
  page.evaluate(
    async ([id, loc]) => {
      const T = await import('/src/model/templates.ts')
      const L = await import('/src/i18n/templateLabels/index.ts')
      await L.ensureTemplateLabelDict(loc)
      const o = L.openTemplate(T.TEMPLATES.find((t) => t.id === id)!, loc)
      ;(window as unknown as Bridge).__loop.graph.getState().loadGraph(o.graph, { canvasLocked: false, modelVersion: o.modelVersion, initialView: null, frames: o.graph.frames })
      return o.graph.nodes.length
    },
    [id, loc] as const,
  )

const savedFrames = (page: Page) =>
  page.evaluate(() => ((window as unknown as Bridge).__loop.frame.getState().frames as { id: string; rect: { x: number; y: number; w: number; h: number } }[]).map((f) => ({ id: f.id, rect: f.rect })))

test.describe('#337 every element inside the drawn outline', () => {
  for (const scheme of ['light', 'dark', 'forced'] as const) {
    test(`${scheme}: chip, title lines and rows keep 8 px inside; rows at the title; the Gate centred`, async ({ page }) => {
      if (scheme === 'forced') await page.emulateMedia({ forcedColors: 'active' })
      else await page.emulateMedia({ colorScheme: scheme })
      await load(page)
      const els = await readOutline(page)
      // 40 nodes: each a chip, at least one title line and its rows
      expect(new Set(els.map((e) => e.id)).size).toBe(40)
      expect(els.filter((e) => e.role === 'title' && e.line === 1).length, 'the two-line titles are exercised').toBeGreaterThan(0)
      expect(outlineMisfits(els)).toEqual([])
    })
  }

  test('each outline is drawn for its node: the viewBox is the CSS width, the width at most 260 px', async ({ page }) => {
    await load(page)
    const out = await page.evaluate((kinds) =>
      [...document.querySelectorAll<HTMLElement>('.react-flow__node .nodef')]
        .filter((f) => kinds.some((k) => f.classList.contains(`nodef--${k}`)))
        .map((f) => ({ w: parseFloat(getComputedStyle(f).width), h: f.offsetHeight, vb: f.querySelector('.nodef__shape')!.getAttribute('viewBox')! })),
    [...OUTLINE_KINDS] as string[])
    expect(out.length).toBe(40)
    for (const o of out) {
      const [, , w, h] = o.vb.split(' ').map(Number)
      expect(Math.abs(w - o.w), o.vb).toBeLessThan(0.01)
      expect(h).toBe(o.h)
      expect(o.w).toBeLessThanOrEqual(260)
    }
  })

  test('ar: the same, right to left', async ({ page }) => {
    await load(page)
    await setLocale(page, 'ar')
    await page.waitForFunction(() => document.documentElement.dir === 'rtl')
    await page.evaluate(() => document.fonts.ready)
    await frames(page, 2)
    expect(outlineMisfits(await readOutline(page))).toEqual([])
  })

  test('a longer title widens each kind, the shorter one gives the width back, with a bounded number of measurements', async ({ page }) => {
    await load(page)
    const ids = ['pool 0', 'source 0', 'drain 0', 'converter 0', 'gate 0']
    const widths = () =>
      page.evaluate((ids) => ids.map((id) => parseFloat(getComputedStyle(document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .nodef`)!).width)), ids)
    const setLabels = (label: string) =>
      page.evaluate(([ids, label]) => {
        const g = (window as unknown as Bridge).__loop.graph.getState()
        for (const id of ids) g.updateNodeData(id, { label })
      }, [ids, label] as const)
    const misfits = async () => outlineMisfits((await readOutline(page)).filter((e) => ids.includes(e.id)))
    const w0 = await widths()
    const n0 = await fitCount(page)
    await setLabels('Daily login reward chest')
    await expect.poll(async () => (await widths()).every((w, i) => w > w0[i])).toBe(true)
    await expect.poll(misfits).toEqual([])
    // each node is read at most twice for one change (the natural layout, then
    // once more if its height moved), and never again while nothing changes
    const n1 = await fitCount(page)
    expect(n1 - n0).toBeLessThanOrEqual(2 * ids.length)
    await frames(page, 30)
    expect(await fitCount(page)).toBe(n1)
    await setLabels('Gold')
    await expect.poll(async () => (await widths()).every((w, i) => Math.abs(w - w0[i]) <= 1 / 16)).toBe(true)
    await expect.poll(misfits).toEqual([])
    const n2 = await fitCount(page)
    expect(n2 - n1).toBeLessThanOrEqual(2 * ids.length)
    await frames(page, 30)
    expect(await fitCount(page)).toBe(n2)
  })

  for (const id of TEMPLATE_IDS) {
    test(`${id}, all 18 languages: every element fits, no overlap, no frame crossed on any side, a reopened node fits as a fresh one, measurements bounded`, async ({ page }) => {
      test.slow()
      await openApp(page)
      await resetAll(page)
      const problems: string[] = []
      const open = async (loc: string) => {
        const n = await openTemplate(page, id, loc)
        await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node .nodef').length === n, n)
        await page.evaluate(() => document.fonts.ready)
        // the readings are in CSS px at any zoom (a Template's own fit-all may
        // land after this); zoom 1 only keeps the text at its usual raster
        await zoomOne(page)
        await frames(page, 3)
        return n
      }
      for (const loc of LOCALES) {
        await setLocale(page, loc)
        await frames(page, 3)
        // the previous language's document is open: the same node ids, so
        // React keeps the node components and their last fit
        const c0 = await fitCount(page)
        const n = await open(loc)
        const c1 = await fitCount(page)
        if (c1 - c0 > 2 * n) problems.push(`${loc}: ${c1 - c0} measurements for ${n} nodes`)
        await frames(page, 20)
        if ((await fitCount(page)) !== c1) problems.push(`${loc}: measured while idle`)
        problems.push(...outlineMisfits(await readOutline(page)).map((m) => `${loc}: ${m}`))
        const boxes = await nodeBoxes(page)
        const saved = await savedFrames(page)
        problems.push(...layoutClashes(boxes, saved).map((m) => `${loc}: ${m}`))
        if (id === 'gacha-banner-zones') {
          // the three clashes older than #337: each bottom weight Parameter 8 px
          // inside its zone frame, the two Russian Gates 8 px apart
          const box = (n: string) => boxes.find((b) => b.id === n)!
          const frame = (f: string) => saved.find((s) => s.id === f)!.rect
          for (const [n, f] of [['zone1_free_w_r', 'zone_free'], ['zone3_pickup_w_standard', 'zone_pickup']] as const) {
            const m = frame(f).y + frame(f).h - (box(n).y + box(n).h)
            if (m < 8) problems.push(`${loc}: ${n} ${m} px above the bottom of ${f}`)
          }
          const gap = box('sr_hit_standard').x - (box('forced_ssr_standard').x + box('forced_ssr_standard').w)
          if (gap < 8) problems.push(`${loc}: forced_ssr_standard ${gap.toFixed(2)} px from sr_hit_standard`)
        }
        const reused = await styles(page)
        // the same Template opened fresh, every node mounted anew
        await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().newGraph())
        await frames(page, 2)
        await open(loc)
        problems.push(...styleDiff(await styles(page), reused).map((m) => `${loc}: ${m}`))
      }
      expect(problems).toEqual([])
    })
  }
})

/** every node's inline style (the fit: width, the head's shift, the rows' starts) */
const styles = (page: Page) =>
  page.evaluate(
    () => Object.fromEntries([...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((n) => [n.dataset.id!, n.querySelector('.nodef')!.getAttribute('style')])) as Record<string, string | null>,
  )

/** where a reused node's fit differs from a fresh one's: the same declarations,
 *  each length within 1/16 px (a node's screen position moves each measured
 *  edge by up to a layout unit, 1/64 px, and a width is read from two) */
const styleDiff = (fresh: Record<string, string | null>, reused: Record<string, string | null>) => {
  const parse = (s: string | null) => Object.fromEntries((s ?? '').split(';').map((d) => d.split(':').map((x) => x.trim())).filter(([k]) => k))
  const off: string[] = []
  for (const [id, s] of Object.entries(fresh)) {
    const a = parse(s)
    const b = parse(reused[id] ?? null)
    if (Object.keys(a).sort().join() !== Object.keys(b).sort().join()) off.push(`${id}: fresh "${s}", reused "${reused[id]}"`)
    else for (const k of Object.keys(a)) {
      if (a[k] !== b[k] && !(Math.abs(parseFloat(a[k]) - parseFloat(b[k])) <= 1 / 16)) off.push(`${id} ${k}: ${a[k]} fresh, ${b[k]} reused`)
    }
  }
  return off
}
