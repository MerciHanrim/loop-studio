import type { Page } from '@playwright/test'

// issue #337 — reading every painted element of a Pool, a Source, a Drain, a
// Converter and a Gate against its DRAWN outline: the kind chip, each title
// line and each row. A line's glyphs are a DOM Range's rects (a row cut at its
// box where its ellipsis cuts the text), its top / bottom its line BOX; the
// fill's edges are found with `SVGGeometryElement.isPointInFill` along the
// line's top + 1, middle and bottom − 1 (#332's e2e, ./rowFit). All in CSS px
// at the current zoom.

export const OUTLINE_KINDS = ['pool', 'source', 'drain', 'converter', 'gate'] as const

export type OutlineReading = {
  id: string
  kind: string
  role: 'chip' | 'title' | 'value' | 'sub'
  /** the title line's index, 0 for the others */
  line: number
  text: string
  /** px from the fill's left edge to the element, the least over its height */
  startClear: number
  /** px from the element to the fill's right edge, the least */
  endClear: number
  /** a row's start minus the title box's start (the chip + its 6 px gap);
   *  null for the head and for the Gate */
  vsTitle: number | null
  /** the Gate: the element's centre minus the node's; null for the others */
  offCentre: number | null
}

export type NodeBox = { id: string; kind: string; x: number; y: number; w: number; h: number }

type Bridge = { __loop: Record<string, { getState: () => any }> }

/** every kind's cases: short, near-max and two-line titles, each mode and
 *  distribution, a Pool with a long value and capacity, an Arabic title */
export const OUTLINE_GRAPH = (() => {
  const N = (id: string, kind: string, x: number, y: number, data: object) => ({
    id, type: kind, position: { x, y }, data: { kind, label: id, ...data },
  })
  const nodes: object[] = []
  const titles = ['Gold', 'Daily login reward', 'Weekly guild contribution bonus', 'مكافأة تسجيل الدخول اليومية']
  titles.forEach((label, i) => {
    const y = i * 600
    nodes.push(N(`pool ${i}`, 'pool', 0, y, { label, activation: 'passive', initial: 90, capacity: 130, mode: 'pullAny' }))
    nodes.push(N(`pool long ${i}`, 'pool', 300, y, { label, activation: 'passive', initial: 1234567.89, capacity: 9999999, mode: 'pullAny' }))
    nodes.push(N(`source ${i}`, 'source', 0, y + 150, { label, activation: 'automatic', mode: 'pushAny' }))
    nodes.push(N(`source all ${i}`, 'source', 300, y + 150, { label, activation: 'interactive', mode: 'pushAll' }))
    nodes.push(N(`drain ${i}`, 'drain', 0, y + 300, { label, activation: 'automatic', mode: 'pullAny' }))
    nodes.push(N(`drain all ${i}`, 'drain', 300, y + 300, { label, activation: 'onStart', mode: 'pullAll' }))
    nodes.push(N(`converter ${i}`, 'converter', 600, y, { label, activation: 'automatic', mode: 'pullAny' }))
    nodes.push(N(`converter all ${i}`, 'converter', 600, y + 150, { label, activation: 'passive', mode: 'pullAll' }))
    nodes.push(N(`gate ${i}`, 'gate', 600, y + 300, { label, activation: 'automatic', distribution: 'deterministic' }))
    nodes.push(N(`gate p ${i}`, 'gate', 900, y + 300, { label, activation: 'automatic', distribution: 'probabilistic' }))
  })
  return JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges: [] })
})()

export const readOutline = (page: Page): Promise<OutlineReading[]> =>
  page.evaluate((kinds) => {
    const out: OutlineReading[] = []
    const rects = (el: Element) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return [...r.getClientRects()].filter((c) => c.width > 0.5)
    }
    for (const n of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
      const f = n.querySelector<HTMLElement>('.nodef')
      const kind = f && [...f.classList].find((c) => /^nodef--/.test(c))?.slice(7)
      if (!f || !kind || !kinds.includes(kind)) continue
      const path = f.querySelector<SVGPathElement>('path.nodef__fill')!
      const inv = path.ownerSVGElement!.getScreenCTM()!.inverse()
      const box = f.getBoundingClientRect()
      const z = box.width / parseFloat(getComputedStyle(f).width)
      const inside = (x: number, y: number) => path.isPointInFill(new DOMPoint(x, y).matrixTransform(inv))
      // a 0.25 CSS px step at any zoom
      const step = 0.25 * z
      const edges = (y: number) => {
        let l = box.left
        let r = box.right
        while (l < box.right && !inside(l, y)) l += step
        while (r > box.left && !inside(r, y)) r -= step
        return [l, r]
      }
      const clear = (left: number, right: number, top: number, bottom: number) => {
        let s = Infinity
        let e = Infinity
        for (const y of [top + 1, (top + bottom) / 2, bottom - 1]) {
          const [l, r] = edges(y)
          s = Math.min(s, (left - l) / z)
          e = Math.min(e, (r - right) / z)
        }
        return { startClear: +s.toFixed(2), endClear: +e.toFixed(2) }
      }
      const centre = (box.left + box.right) / 2
      const gate = kind === 'gate'
      const id = n.dataset.id!
      const chip = f.querySelector<HTMLElement>('.nodef__chip')!.getBoundingClientRect()
      // the Gate centres its head (chip + title) as one: its centre is read on the chip's entry
      const head = f.querySelector<HTMLElement>('.nodef__head')!.getBoundingClientRect()
      out.push({
        id, kind, role: 'chip', line: 0, text: '', ...clear(chip.left, chip.right, chip.top, chip.bottom), vsTitle: null,
        offCentre: gate ? +(((head.left + head.right) / 2 - centre) / z).toFixed(2) : null,
      })
      // each title line: its glyphs, its line box
      const title = f.querySelector<HTMLElement>('.nodef__title')!
      const tb = title.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(title).lineHeight) * z
      const lines = new Map<number, { left: number; right: number }>()
      for (const q of rects(title)) {
        const i = Math.max(0, Math.round(((q.top + q.bottom) / 2 - tb.top - lh / 2) / lh))
        const L = lines.get(i)
        lines.set(i, L ? { left: Math.min(L.left, q.left), right: Math.max(L.right, q.right) } : { left: q.left, right: q.right })
      }
      for (const [i, L] of lines) {
        out.push({ id, kind, role: 'title', line: i, text: title.textContent ?? '', ...clear(L.left, L.right, tb.top + i * lh, tb.top + (i + 1) * lh), vsTitle: null, offCentre: null })
      }
      const titleAt = chip.right + 6 * z
      for (const role of ['value', 'sub'] as const) {
        const el = f.querySelector<HTMLElement>(`.nodef__${role}`)
        if (!el) continue
        const g = rects(el)
        if (!g.length) continue
        const eb = el.getBoundingClientRect()
        const clipped = el.scrollWidth > el.clientWidth + 0.5
        const left = Math.min(...g.map((q) => q.left))
        const right = clipped ? Math.min(Math.max(...g.map((q) => q.right)), eb.right) : Math.max(...g.map((q) => q.right))
        out.push({
          id, kind, role, line: 0, text: (el.textContent ?? '').trim(), ...clear(left, right, eb.top, eb.bottom),
          vsTitle: gate ? null : +((left - titleAt) / z).toFixed(2),
          offCentre: gate ? +(((left + right) / 2 - centre) / z).toFixed(2) : null,
        })
      }
    }
    return out
  }, [...OUTLINE_KINDS] as string[])

/** every element under `clear` px from the outline, a row not at the title,
 *  a Gate line off its centre */
export const outlineMisfits = (els: OutlineReading[], clear = 8) =>
  els
    .filter((e) =>
      e.startClear < clear - 0.3 || e.endClear < clear - 0.3 ||
      (e.vsTitle !== null && Math.abs(e.vsTitle) > 0.5) ||
      (e.offCentre !== null && Math.abs(e.offCentre) > 1))
    .map((e) => `${e.id} ${e.role}${e.role === 'title' ? ` line ${e.line}` : ''} "${e.text}" start ${e.startClear} end ${e.endClear} vsTitle ${e.vsTitle} offCentre ${e.offCentre}`)

/** every node's stored position and drawn size, in flow px */
export const nodeBoxes = (page: Page): Promise<NodeBox[]> =>
  page.evaluate(() => {
    const pos = new Map<string, { x: number; y: number }>(
      ((window as unknown as Bridge).__loop.graph.getState().nodes as { id: string; position: { x: number; y: number } }[]).map((g) => [g.id, g.position]),
    )
    return [...document.querySelectorAll<HTMLElement>('.react-flow__node')].flatMap((n) => {
      const f = n.querySelector<HTMLElement>('.nodef')
      const p = pos.get(n.dataset.id!)
      if (!f || !p) return []
      const kind = [...f.classList].find((c) => /^nodef--/.test(c))?.slice(7) ?? ''
      return [{ id: n.dataset.id!, kind, x: p.x, y: p.y, w: parseFloat(getComputedStyle(f).width), h: f.offsetHeight }]
    })
  })

/** every pair of nodes that overlap, and every node that crosses a saved
 *  frame's edge (partly inside, partly out) */
export const layoutClashes = (boxes: NodeBox[], frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[]) => {
  const E = 0.01
  const out: string[] = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]
    const b = boxes[j]
    if (a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E) out.push(`${a.id} × ${b.id}`)
  }
  for (const fr of frames) {
    const R = fr.rect
    for (const n of boxes) {
      const meets = n.x < R.x + R.w - E && R.x < n.x + n.w - E && n.y < R.y + R.h - E && R.y < n.y + n.h - E
      const within = n.x >= R.x - E && n.y >= R.y - E && n.x + n.w <= R.x + R.w + E && n.y + n.h <= R.y + R.h + E
      if (meets && !within) out.push(`${n.id} crosses ${fr.id} (node ${n.x},${n.y} ${n.w.toFixed(1)}×${n.h}; frame ${R.x},${R.y} ${R.w}×${R.h})`)
    }
  }
  return out
}
