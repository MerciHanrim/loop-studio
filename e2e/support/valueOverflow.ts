import type { Page } from '@playwright/test'

// Shared by `node-value-overflow.spec.ts` (desktop: keyboard path) and
// `node-value-overflow.mobile.spec.ts` (phone: touch path) — the fixture whose
// formatted values are wider than the body W1 reserves, and the readers.

/** the value cases: what each node shows in full, and why it overflows */
export const OVERFLOW_CASES = [
  // a capped Pool at the 260 px cap: fifteen-digit count and capacity
  { id: 'p_cap', kind: 'pool', initial: 123456789012345, capacity: 999999999999999 },
  // an uncapped Pool with a decimal count: two decimals by the node's format, kept
  // (W1 reserves six digits with an upper-bound advance, so up to ten characters
  // still fit — measured 2026-10-12; thirteen do not)
  { id: 'p_dec', kind: 'pool', initial: 1234567890.891, capacity: null },
  // a negative Parameter with a long unit (the model caps a unit at 24 bytes,
  // `PARAM_UNIT_MAX_BYTES`, so a unit alone can never exceed the body's cap)
  { id: 'par_neg', kind: 'parameter', value: -123456789.125, unit: 'credits per second/user' },
  // a Register whose integer result is eighteen digits
  { id: 'reg_big', kind: 'register', expr: '@p_cap * 1000', format: 'float', unit: '¤' },
  // a percent Register: the format's two decimals, kept
  { id: 'reg_pct', kind: 'register', expr: '@p_dec / 3', format: 'percent' },
] as const

export type OverflowCase = (typeof OVERFLOW_CASES)[number]

export const OVERFLOW_GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'p_cap', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Capped', activation: 'passive', initial: 123456789012345, capacity: 999999999999999, mode: 'pullAny' } },
    { id: 'p_dec', type: 'pool', position: { x: 360, y: 0 }, data: { kind: 'pool', label: 'Decimal', activation: 'passive', initial: 1234567890.891, capacity: null, mode: 'pullAny' } },
    { id: 'p_twelve', type: 'pool', position: { x: 640, y: 0 }, data: { kind: 'pool', label: 'Twelve', activation: 'passive', initial: 123456789012, capacity: null, mode: 'pullAny' } },
    { id: 'par_neg', type: 'parameter', position: { x: 0, y: 180 }, data: { kind: 'parameter', label: 'Negative', value: -123456789.125, unit: 'credits per second/user' } },
    { id: 'reg_big', type: 'register', position: { x: 0, y: 360 }, data: { kind: 'register', label: 'Big result', expr: '@p_cap * 1000', format: 'float', unit: '¤' } },
    { id: 'reg_pct', type: 'register', position: { x: 360, y: 360 }, data: { kind: 'register', label: 'Share', expr: '@p_dec / 3', format: 'percent' } },
    // the run case: an automatic Source pushes 1e11 per step into an uncapped
    // Pool (six-digit reservation) — the count overflows by RUNNING
    { id: 'src', type: 'source', position: { x: 0, y: 540 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'p_live', type: 'pool', position: { x: 360, y: 540 }, data: { kind: 'pool', label: 'Live', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [{ id: 'e_mint', type: 'loop', source: 'src', target: 'p_live', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '100000000000' } }],
})

/** the node's own number format (`nodes.tsx` fmt): integers as they are, otherwise two decimals */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
/** the Register's format (`formatRegisterValue`) */
function fmtRegister(value: number, format?: 'int' | 'float' | 'percent'): string {
  if (format === 'int') return String(Math.round(value))
  if (format === 'percent') {
    const p = value * 100
    return `${Number.isInteger(p) ? p : Number(p.toFixed(2))}%`
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

/** the whole text the value row must carry for a case — computed from the
 *  document numbers by the product's own rules, never read back from the DOM */
export function expectedRow(c: OverflowCase): string {
  switch (c.kind) {
    case 'pool':
      return c.capacity == null ? fmt(c.initial) : `${fmt(c.initial)} / ${c.capacity}`
    case 'parameter':
      return `${fmt(c.value)} ${c.unit}`
    case 'register': {
      const byId = Object.fromEntries(OVERFLOW_CASES.map((x) => [x.id, x])) as Record<string, OverflowCase>
      const value =
        c.id === 'reg_big'
          ? (byId.p_cap as Extract<OverflowCase, { kind: 'pool' }>).initial * 1000
          : (byId.p_dec as Extract<OverflowCase, { kind: 'pool' }>).initial / 3
      const unit = 'unit' in c ? c.unit : undefined
      return `${fmtRegister(value, c.format)}${unit ? ` ${unit}` : ''}`
    }
  }
}

export type ValueRow = {
  text: string
  title: string | null
  overflows: boolean
  scrollWidth: number
  clientWidth: number
  textOverflow: string
  overflow: string
  fontSize: string
  bodyWidth: number
}

/** the rendered value row of a node: its text, tooltip and clipping facts */
export const readValueRow = (page: Page, id: string): Promise<ValueRow> =>
  page.evaluate((nid) => {
    const root = document.querySelector(`.react-flow__node[data-id="${nid}"] .nodef`) as HTMLElement
    const el = root.querySelector('.nodef__value') as HTMLElement
    const s = getComputedStyle(el)
    return {
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      title: el.getAttribute('title'),
      overflows: el.scrollWidth > el.clientWidth,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      textOverflow: s.textOverflow,
      overflow: s.overflowX,
      fontSize: s.fontSize,
      bodyWidth: root.offsetWidth,
    }
  }, id)
