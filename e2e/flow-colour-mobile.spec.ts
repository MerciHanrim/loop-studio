import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/flow-colour-and-compact-nodes.md FC-5 / docs/mobile.md — on a phone a
// flow colour set on desktop renders, and the read-only Inspector sheet shows
// the Colour section with every control disabled. Runs under the `mobile`
// project (390 x 844, touch).

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny', accent: '#638EA5' } },
    { id: 'gold', type: 'pool', position: { x: 200, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 10, capacity: 100, mode: 'pullAny', accent: '#B47599' } },
  ],
  edges: [
    { id: 'e1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3', accent: '#A78243' } },
  ],
})

/** a tap through the phone's pan-capture overlay (as in mobile.spec.ts) */
async function tapNode(page: Page, node: Locator): Promise<void> {
  const b = (await node.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

test('a desktop-set flow colour renders on the phone; the sheet shows it with every control disabled', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, GRAPH)
  const gold = page.locator('.react-flow__node[data-id="gold"]')
  await expect(gold).toBeVisible()
  await expect(gold.locator('.nodef')).toHaveAttribute('data-accent', '#B47599')
  await expect(gold.locator('.nodef__band')).toHaveCSS('stroke', 'rgb(180, 117, 153)')
  await expect(page.locator('.react-flow__edge[data-id="e1"] path.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(167, 130, 67)')

  await tapNode(page, gold)
  const sheet = page.locator('.sheet[aria-label="Inspector — read only"]')
  await expect(sheet).toBeVisible()
  const colour = sheet.locator('.accent-field')
  await expect(colour).toBeVisible()
  await expect(colour.getByRole('button', { name: 'Rose', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const controls = colour.locator('button, input')
  const n = await controls.count()
  expect(n).toBeGreaterThan(6)
  for (let i = 0; i < n; i++) await expect(controls.nth(i)).toBeDisabled()

  // the two inputs READ as disabled, like the sheet's other read-only fields
  // (the shared disabled rule in index.css): same ink and boundary as the Label
  // field, and the colour input loses its pointer cursor
  const hex = colour.locator('.accent-field__hex input')
  const picker = colour.locator('.accent-field__picker input[type="color"]')
  await expect(hex).toBeDisabled()
  await expect(picker).toBeDisabled()
  const reference = sheet.getByRole('textbox', { name: 'Label', exact: true })
  await expect(reference).toBeDisabled()
  const look = (loc: Locator) =>
    loc.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { color: cs.color, border: cs.borderTopColor, cursor: cs.cursor }
    })
  const ref = await look(reference)
  const hexLook = await look(hex)
  expect(hexLook.color).toBe(ref.color)
  expect(hexLook.border).toBe(ref.border)
  const pickerLook = await look(picker)
  expect(pickerLook.border).toBe(ref.border)
  expect(pickerLook.cursor).not.toBe('pointer')

  // the swatches still SHOW the current colour: full colour, the pressed ring,
  // and no disabled boundary, for the palette and the document row alike
  for (const name of ['Rose', '#B47599']) {
    const s = colour.getByRole('button', { name, exact: true })
    await expect(s).toHaveAttribute('aria-pressed', 'true')
    const st = await s.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, opacity: cs.opacity, filter: cs.filter, ring: cs.boxShadow, border: cs.borderTopColor }
    })
    expect(st).toMatchObject({ bg: 'rgb(180, 117, 153)', opacity: '1', filter: 'none' })
    expect(st.ring).not.toBe('none')
    expect(st.border).not.toBe(ref.border)
  }

  // a tap on a disabled swatch changes nothing
  await colour.getByRole('button', { name: 'Slate', exact: true }).click({ force: true })
  expect(
    await page.evaluate(() => (window as any).__loop.graph.getState().nodes.find((x: { id: string }) => x.id === 'gold').data.accent),
  ).toBe('#B47599')
})
