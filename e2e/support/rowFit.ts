import type { Page } from '@playwright/test'

// issue #332 — reading the value / detail rows of the Pool, Parameter and
// Register nodes against their DRAWN outline: the glyphs' own rect (a DOM
// Range, cut at the row's box where its ellipsis cuts the text) and the fill
// edge found with `SVGGeometryElement.isPointInFill` along the row's top, middle
// and bottom. All in CSS px at the current zoom.

export type RowReading = {
  id: string
  kind: string
  key: 'value' | 'sub'
  text: string
  /** px from the fill's left edge to the first glyph, the least over the row */
  startClear: number
  /** px from the last painted glyph to the fill's right edge, the least */
  endClear: number
  /** the row's first glyph minus the title's first glyph */
  vsTitle: number
  clipped: boolean
}

type Bridge = { __loop: Record<string, { getState: () => any }> & { rf: { setViewport: (v: object, o: object) => void } } }

/** a synthetic graph with every case of the three kinds: 0, two and three
 *  digits, negative, decimal, long, a long unit, an Arabic unit, invalid */
export const ROWS_GRAPH = (() => {
  const N = (id: string, kind: string, x: number, y: number, data: object) => ({
    id, type: kind, position: { x, y }, data: { kind, label: id, ...data },
  })
  return JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      N('Pool 0', 'pool', 0, 0, { activation: 'passive', initial: 0, mode: 'pullAny' }),
      N('Pool 90', 'pool', 220, 0, { activation: 'passive', initial: 90, capacity: 130, mode: 'pullAny' }),
      N('Pool neg', 'pool', 440, 0, { activation: 'passive', initial: -12.5, mode: 'pullAny' }),
      N('Pool long', 'pool', 660, 0, { activation: 'passive', initial: 1234567.89, capacity: 9999999, mode: 'pullAny' }),
      N('Reg 90', 'register', 0, 180, { expr: '90', unit: 'gold' }),
      N('Reg 189', 'register', 220, 180, { expr: '189', unit: 'units per day' }),
      N('Reg long', 'register', 440, 180, { expr: '123456789.123', unit: 'kg' }),
      N('Reg invalid', 'register', 660, 180, { expr: '@missing + 1' }),
      N('Param 90', 'parameter', 0, 360, { value: 90, unit: 'gold' }),
      N('Param 189', 'parameter', 220, 360, { value: 189, unit: 'items per hour' }),
      N('Param ar', 'parameter', 440, 360, { value: 12, unit: 'وحدة في الساعة' }),
      N('Param long', 'parameter', 660, 360, { value: 98765432.1 }),
      N('Source', 'source', 0, 540, { activation: 'automatic', mode: 'pushAny' }),
      N('Drain', 'drain', 220, 540, { activation: 'automatic', mode: 'pullAny' }),
      N('Converter', 'converter', 440, 540, { activation: 'automatic', mode: 'pullAny' }),
    ],
    edges: [],
  })
})()

/** the canvas at zoom 1 with the graph's top-left in view */
export const zoomOne = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.rf.setViewport({ x: 20, y: 20, zoom: 1 }, { duration: 0 }))

export const readRows = (page: Page): Promise<RowReading[]> =>
  page.evaluate(() => {
    const out: RowReading[] = []
    const glyphs = (el: Element) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      const q = [...r.getClientRects()].filter((c) => c.width > 0)
      return q.length ? { left: Math.min(...q.map((c) => c.left)), right: Math.max(...q.map((c) => c.right)) } : null
    }
    for (const n of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
      const f = n.querySelector<HTMLElement>('.nodef')
      const kind = f && [...f.classList].find((c) => /^nodef--/.test(c))?.slice(7)
      if (!f || !kind || !['pool', 'parameter', 'register'].includes(kind)) continue
      const path = f.querySelector<SVGPathElement>('path.nodef__fill')!
      const inv = path.ownerSVGElement!.getScreenCTM()!.inverse()
      const box = f.getBoundingClientRect()
      const z = box.width / f.offsetWidth
      const inside = (x: number, y: number) => path.isPointInFill(new DOMPoint(x, y).matrixTransform(inv))
      const edges = (y: number) => {
        let l = box.left
        let r = box.right
        while (l < box.right && !inside(l, y)) l += 0.25
        while (r > box.left && !inside(r, y)) r -= 0.25
        return [l, r]
      }
      const title = glyphs(f.querySelector('.nodef__title')!)!
      for (const key of ['value', 'sub'] as const) {
        const el = f.querySelector<HTMLElement>(`.nodef__${key}`)
        if (!el) continue
        const g = glyphs(el)
        if (!g) continue
        const eb = el.getBoundingClientRect()
        const clipped = el.scrollWidth > el.clientWidth + 0.5
        const right = clipped ? Math.min(g.right, eb.right) : g.right
        let startClear = Infinity
        let endClear = Infinity
        for (const y of [eb.top + 1, (eb.top + eb.bottom) / 2, eb.bottom - 1]) {
          const [l, r] = edges(y)
          startClear = Math.min(startClear, (g.left - l) / z)
          endClear = Math.min(endClear, (r - right) / z)
        }
        out.push({
          id: n.dataset.id!, kind, key, text: (el.textContent ?? '').trim(),
          startClear: +startClear.toFixed(2), endClear: +endClear.toFixed(2),
          vsTitle: +((g.left - title.left) / z).toFixed(2), clipped,
        })
      }
    }
    return out
  })

/** every row below `clear` px from the outline, or starting before the title */
export const misfits = (rows: RowReading[], clear = 8) =>
  rows
    .filter((r) => r.startClear < clear - 0.3 || r.endClear < clear - 0.3 || r.vsTitle < -0.5)
    .map((r) => `${r.id}.${r.key} "${r.text}" start ${r.startClear} end ${r.endClear} vsTitle ${r.vsTitle}`)

/** how many row-fit measurements the app has taken */
export const fitCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __loop: { rowFit: { count: () => number } } }).__loop.rowFit.count())

/** wait `n` animation frames */
export const frames = (page: Page, n: number) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r))
  }, n)
