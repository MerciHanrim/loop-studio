import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, snap, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-4 — the flow colour in pixels: every
// node kind and both edge kinds with a palette colour, light and dark, at the
// detail and the map level; and the four node layers at once (invalid,
// selection, the structure line with the colour band, focus) next to a
// selected coloured edge over its underlay.

const NODE = (id: string, kind: string, x: number, y: number, accent: string, extra: Record<string, unknown> = {}) => ({
  id, type: kind, position: { x, y }, data: { kind, label: id, accent, ...extra },
})
const FIXTURE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    NODE('Source', 'source', 0, 0, '#74906B', { activation: 'automatic', mode: 'pushAny' }),
    NODE('Pool', 'pool', 230, 0, '#638EA5', { activation: 'passive', initial: 5, capacity: 50, mode: 'pullAny' }),
    NODE('Gate', 'gate', 460, 0, '#A78243', { activation: 'automatic', distribution: 'deterministic' }),
    NODE('Drain', 'drain', 700, 0, '#B47599', { activation: 'automatic', mode: 'pullAny' }),
    NODE('Converter', 'converter', 0, 170, '#9182A8', { activation: 'automatic', mode: 'pullAny' }),
    NODE('End', 'end', 230, 170, '#B47599', { activation: 'passive' }),
    NODE('Rate', 'parameter', 460, 170, '#638EA5', { value: 3 }),
    NODE('Broken', 'register', 700, 170, '#A78243', { expr: '1 / (@Pool - @Pool)' }),
  ],
  edges: [
    { id: 'r1', type: 'loop', source: 'Source', target: 'Pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2', accent: '#74906B' } },
    { id: 'r2', type: 'loop', source: 'Pool', target: 'Gate', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'r3', type: 'loop', source: 'Gate', target: 'Drain', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', accent: '#B47599' } },
    { id: 's1', type: 'loop', source: 'Pool', target: 'End', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', accent: '#9182A8' } },
  ],
})

async function load(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, FIXTURE)
  await expect(page.locator('.react-flow__node[data-id="Broken"] .nodef')).toHaveClass(/is-invalid/)
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
}
async function view(page: Page, zoom: number): Promise<void> {
  const pane = (await page.locator('.react-flow').boundingBox())!
  // world (430, 120) at the centre of the pane: the left column clears the
  // canvas controls
  await page.evaluate(
    (v) => (window as unknown as { __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } } }).__loop.rf.setViewport(v, { duration: 0 }),
    { x: Math.round(pane.width / 2 - 430 * zoom), y: Math.round(pane.height / 2 - 120 * zoom), zoom },
  )
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
}
const opts = (page: Page) => ({ mask: [page.locator('.react-flow__minimap'), page.locator('.react-flow__attribution')] })

for (const scheme of ['light', 'dark'] as const) {
  for (const [level, zoom] of [['L2', 1], ['L0', 0.4]] as const) {
    test(`flow colours — ${scheme} · ${level}`, async ({ page }) => {
      await load(page, scheme)
      await view(page, zoom)
      await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, `flow-colour-${scheme}-${level}`, opts(page)))
    })
  }
}

test('flow colours — every state at once: invalid, selection, band and focus on the Register; a selected coloured edge', async ({ page }) => {
  await load(page, 'light')
  await view(page, 1)
  // the coloured edge first, at the midpoint of its own path (Control then
  // adds the Register to the selection)
  const mid = await page.evaluate(() => {
    const p = document.querySelector('.react-flow__edge[data-id="r3"] path.react-flow__edge-path') as SVGPathElement
    const pt = p.getPointAtLength(p.getTotalLength() / 2)
    const m = p.getScreenCTM()!
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f }
  })
  await page.mouse.click(mid.x, mid.y)
  await page.locator('.react-flow__node[data-id="Broken"]').click({ modifiers: ['Control'] })
  // a multi-selection may bring up the contextual hint; close it so the shot
  // is the same every run, then give the keyboard focus back to the Register
  const hint = page.locator('.hint-note__x')
  if (await hint.isVisible().catch(() => false)) await hint.click()
  await expect(page.locator('.hint-note')).toHaveCount(0)
  await page.locator('.react-flow__node[data-id="Broken"]').focus()
  await page.mouse.move(2, 2)
  await expect(page.locator('.react-flow__node[data-id="Broken"] .nodef')).toHaveClass(/is-selected.*is-focused|is-focused.*is-selected/)
  await expect(page.locator('.react-flow__edge[data-id="r3"] .edge-select-underlay')).toHaveCount(1)
  await page.waitForTimeout(150)
  await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'flow-colour-states', opts(page)))
})
