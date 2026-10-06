import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ensureTimelineOpen, expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-5 / FC-6 (issue #325, PR 2) — the
// flow colour beyond the canvas: the minimap and the timeline take a node's
// colour, the bundled Templates ship theirs, the run and the CSV never change,
// forced colours draw none, the Inspector offers each colour once, and a
// locked canvas shows the editor read-only.

const loop = (page: Page, js: string): Promise<any> => page.evaluate(`(() => { const l = window.__loop; ${js} })()`)

// two Pools and two Registers, one of each coloured, and a coloured edge
const NODES = [
  { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny', accent: '#638EA5' } },
  { id: 'gold', type: 'pool', position: { x: 260, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 10, capacity: 100, mode: 'pullAny', accent: '#B47599' } },
  { id: 'gems', type: 'pool', position: { x: 260, y: 200 }, data: { kind: 'pool', label: 'Gems', activation: 'passive', initial: 0, capacity: 100, mode: 'pullAny' } },
  { id: 'sink', type: 'drain', position: { x: 520, y: 40 }, data: { kind: 'drain', label: 'Spend', activation: 'automatic', mode: 'pullAny', accent: '#A78243' } },
  { id: 'r_col', type: 'register', position: { x: 520, y: 200 }, data: { kind: 'register', label: 'Double gold', expr: '@gold * 2', accent: '#9182A8' } },
  { id: 'r_plain', type: 'register', position: { x: 520, y: 330 }, data: { kind: 'register', label: 'Gems plus one', expr: '@gems + 1' } },
]
const EDGES = [
  { id: 'e1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
  { id: 'e2', type: 'loop', source: 'gold', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', accent: '#74906B' } },
  { id: 'e3', type: 'loop', source: 'src', target: 'gems', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
]
const COLOURED = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: NODES, edges: EDGES })
const strip = <T extends { data: Record<string, unknown> }>(xs: T[]) => xs.map((x) => ({ ...x, data: Object.fromEntries(Object.entries(x.data).filter(([k]) => k !== 'accent')) }))
const PLAIN = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: strip(NODES), edges: strip(EDGES) })

const ROSE = 'rgb(180, 117, 153)'
const VIOLET = 'rgb(145, 130, 168)'

async function load(page: Page, json: string): Promise<void> {
  await resetAll(page)
  await importGraph(page, json)
  await expect(page.locator('.react-flow__node[data-id="r_plain"]')).toBeVisible()
  await expect(page.locator('.react-flow__minimap')).toBeVisible()
}

/** each node's minimap mark fill, by node id (a mark sits at its node's position) */
const minimapFills = (page: Page) =>
  page.evaluate(() => {
    const ns = (window as any).__loop.graph.getState().nodes as { id: string; position: { x: number; y: number } }[]
    const out: Record<string, string> = {}
    for (const r of document.querySelectorAll('.react-flow__minimap-node')) {
      const n = ns.find((m) => m.position.x === +r.getAttribute('x')! && m.position.y === +r.getAttribute('y')!)
      if (n) out[n.id] = getComputedStyle(r).fill
    }
    return out
  })

async function run(page: Page, steps: number): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    await loop(page, 'l.sim.getState().stepOnce()')
    await expect.poll(() => loop(page, 'return l.sim.getState().stepIndex')).toBeGreaterThanOrEqual(i)
  }
  await ensureTimelineOpen(page)
}

/** each drawn series' stroke and dash, by series id; and the legend marks */
type TimelineLook = { lines: Record<string, { stroke: string; dash: string }>; marks: string[] }
const timeline = (page: Page): Promise<TimelineLook> =>
  page.evaluate(() => ({
    lines: Object.fromEntries(
      [...document.querySelectorAll('.timeline__line[data-series]')].map((l) => [
        l.getAttribute('data-series'),
        { stroke: getComputedStyle(l).stroke, dash: getComputedStyle(l).strokeDasharray },
      ]),
    ),
    marks: [...document.querySelectorAll('.timeline__legend .timeline__key')].map((k) => getComputedStyle(k.querySelector('.timeline__mark')!).backgroundColor),
  }))

const series = (page: Page) => loop(page, 'return JSON.stringify(l.sim.getState().series)')

async function csv(page: Page): Promise<string> {
  const btn = page.locator('.timeline__csv').filter({ hasNotText: /▾/ }).first()
  await expect(btn).toBeEnabled()
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
  return readFileSync((await dl.path())!, 'utf8')
}

test.describe('flow colour — the minimap and the timeline (FC-6)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('the minimap fills a coloured node’s mark with its colour; every other mark keeps its kind fill', async ({ page }) => {
    await load(page, PLAIN)
    const plain = await minimapFills(page)
    expect(Object.keys(plain).sort()).toEqual(['gems', 'gold', 'r_col', 'r_plain', 'sink', 'src'])
    await load(page, COLOURED)
    const coloured = await minimapFills(page)
    expect(coloured).toEqual({
      ...plain,
      src: 'rgb(99, 142, 165)',
      gold: ROSE,
      sink: 'rgb(167, 130, 67)',
      r_col: VIOLET,
    })
  })

  test('a coloured Pool or Register draws its series in its colour; the others keep theirs; Registers stay dashed', async ({ page }) => {
    await load(page, PLAIN)
    await run(page, 3)
    const plain = await timeline(page)
    expect(Object.keys(plain.lines).sort()).toEqual(['gems', 'gold', 'r_col', 'r_plain'])

    await load(page, COLOURED)
    await run(page, 3)
    const coloured = await timeline(page)
    expect(coloured.lines).toEqual({
      ...plain.lines,
      gold: { stroke: ROSE, dash: 'none' },
      r_col: { stroke: VIOLET, dash: plain.lines.r_col.dash },
    })
    expect(plain.lines.r_col.dash).toBe('4px, 3px')
    // the legend follows the lines; the coloured edge (Sage) reaches neither
    expect(coloured.marks).toEqual([ROSE, plain.marks[1], VIOLET, plain.marks[3]])
    expect([...Object.values(coloured.lines).map((l) => l.stroke), ...coloured.marks]).not.toContain('rgb(116, 144, 107)')
  })

  test('colours change neither the run nor its CSV', async ({ page }) => {
    await load(page, PLAIN)
    await run(page, 5)
    const plainSeries = await series(page)
    const plainCsv = await csv(page)
    await load(page, COLOURED)
    await run(page, 5)
    expect(await series(page)).toBe(plainSeries)
    expect(await csv(page)).toBe(plainCsv)
  })

  test('under forced colours the minimap and the timeline draw no flow colour', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await load(page, PLAIN)
    await run(page, 3)
    const plain = { minimap: await minimapFills(page), timeline: await timeline(page) }
    await load(page, COLOURED)
    await run(page, 3)
    expect({ minimap: await minimapFills(page), timeline: await timeline(page) }).toEqual(plain)
    // leaving forced colours brings the flow colours back, with no reload
    await page.emulateMedia({ forcedColors: 'none' })
    await expect.poll(async () => (await minimapFills(page)).gold).toBe(ROSE)
    await expect.poll(async () => (await timeline(page)).lines.gold?.stroke).toBe(ROSE)
  })
})

test.describe('flow colour — the Inspector offers each colour once (FC-5)', () => {
  const field = (page: Page) => page.locator('.accent-field')
  const row = (page: Page, name: string) => field(page).getByRole('group', { name, exact: true })
  const rowSwatches = (page: Page, name: string) =>
    row(page, name).evaluateAll((rs) => rs.flatMap((r) => [...r.querySelectorAll('.accent-swatch')].map((b) => b.getAttribute('aria-label'))))
  const pressed = (page: Page) => field(page).locator('[aria-pressed="true"]')

  test('Recent leaves out the palette’s colours; In this document leaves out both; the current colour is pressed once', async ({ page }) => {
    await openApp(page)
    await load(page, PLAIN)
    // a colour only the document has
    await loop(page, `l.graph.getState().setAccent(['r_plain'], [], '#123456')`)

    // a palette colour, chosen: it stays in the palette row only
    await page.locator('.react-flow__node[data-id="gold"]').click()
    await field(page).getByRole('button', { name: 'Rose', exact: true }).click()
    expect(await rowSwatches(page, 'Recent')).toEqual([])
    await expect(row(page, 'Recent')).toHaveCount(0)
    expect(await rowSwatches(page, 'In this document')).toEqual(['#123456'])
    await expect(pressed(page)).toHaveCount(1)
    await expect(field(page).getByRole('button', { name: 'Rose', exact: true })).toHaveAttribute('aria-pressed', 'true')

    // a colour off the palette, typed: Recent offers it, the document row no longer
    await page.locator('.react-flow__node[data-id="sink"]').click()
    const hex = field(page).locator('.accent-field__hex input')
    await hex.fill('#336699')
    await hex.press('Enter')
    expect(await rowSwatches(page, 'Recent')).toEqual(['#336699'])
    expect(await rowSwatches(page, 'In this document')).toEqual(['#123456'])
    await expect(pressed(page)).toHaveCount(1)
    await expect(row(page, 'Recent').getByRole('button', { name: '#336699', exact: true })).toHaveAttribute('aria-pressed', 'true')

    // a node with the document-only colour: pressed once, in the document row
    await page.locator('.react-flow__node[data-id="r_plain"]').click()
    await expect(pressed(page)).toHaveCount(1)
    await expect(row(page, 'In this document').getByRole('button', { name: '#123456', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  test('a locked canvas: the hex field and the colour input read as disabled; the swatches keep showing the colour', async ({ page }) => {
    await openApp(page)
    await load(page, COLOURED)
    await page.locator('.react-flow__node[data-id="gold"]').click()
    await page.locator('.react-flow__controls-button.rf-lock').click()
    await expect(page.locator('.canvas.canvas--locked')).toBeVisible()
    const ro = page.locator('fieldset.inspector-ro--desktop')
    const look = (loc: Locator) =>
      loc.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { disabled: (el as HTMLInputElement).disabled || el.matches(':disabled'), color: cs.color, border: cs.borderTopColor, cursor: cs.cursor, bg: cs.backgroundColor, opacity: cs.opacity, ring: cs.boxShadow }
      })
    const ref = await look(ro.getByRole('textbox', { name: 'Label', exact: true }))
    const hex = await look(ro.locator('.accent-field__hex input'))
    const picker = await look(ro.locator('.accent-field__picker input[type="color"]'))
    expect(ref.disabled && hex.disabled && picker.disabled).toBe(true)
    expect({ color: hex.color, border: hex.border }).toEqual({ color: ref.color, border: ref.border })
    expect(picker.border).toBe(ref.border)
    expect(picker.cursor).not.toBe('pointer')
    const rose = await look(ro.locator('.accent-field').getByRole('button', { name: 'Rose', exact: true }))
    expect(rose).toMatchObject({ disabled: true, bg: ROSE, opacity: '1' })
    expect(rose.ring).not.toBe('none')
    expect(rose.border).not.toBe(ref.border)
  })
})

test.describe('flow colour — the bundled Templates (FC-6)', () => {
  const TEMPLATES = [
    { name: 'Coffee roastery operations flow', waitFor: 'cafe_retail_demand_kg', file: 'coffee-roastery.json' },
    { name: '3-zone gacha banner comparison', waitFor: 'cmp1_hit_rate_free', file: 'gacha-banner-zones.json' },
    { name: 'Early MMO progression (levels 1–15)', waitFor: 'char_creation', file: 'mmo-progression.json' },
  ]
  for (const t of TEMPLATES) {
    test(`${t.name}: opens with its three flow colours, on the canvas and the minimap`, async ({ page }) => {
      const doc = JSON.parse(readFileSync(new URL(`../examples/${t.file}`, import.meta.url), 'utf8')) as { nodes: { id: string; data: { accent?: string } }[] }
      const want = Object.fromEntries(doc.nodes.filter((n) => n.data.accent).map((n) => [n.id, n.data.accent!]))
      expect(new Set(Object.values(want)).size).toBe(3)

      await openApp(page)
      await page.locator('.toolbar__actions .menu').first().locator('> button').click()
      await page.locator('.toolbar__actions .menu').first().locator('.menu__pop [role="menuitem"]', { hasText: t.name }).click()
      const confirm = page.locator('.mcdlg--confirm').getByRole('button', { name: /load template/i })
      await confirm.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {})
      if (await confirm.count()) await confirm.click()
      await expect(page.locator(`.react-flow__node[data-id="${t.waitFor}"]`)).toBeVisible()

      // the store holds exactly the file's colours, and every coloured node is drawn with one
      expect(await loop(page, `return Object.fromEntries(l.graph.getState().nodes.filter((n) => n.data.accent).map((n) => [n.id, n.data.accent]))`)).toEqual(want)
      await expect(page.locator('.react-flow__node .nodef[data-accent]')).toHaveCount(Object.keys(want).length)
      const fills = await minimapFills(page)
      const toRgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
      for (const [id, hex] of Object.entries(want)) expect(fills[id], id).toBe(toRgb(hex))
    })
  }
})
