import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, runMc, test } from './support/loop'
import { FLOW_PALETTE, NOTICE_STATE_COLOURS, SURFACES } from '../src/ui/flowColour'

// docs/flow-colour-and-compact-nodes.md (issue #325, PR 1) — the flow colour
// through the real UI: the Inspector's Colour section, the canvas drawing and
// its state priority, the file and the run.

/** read `window.__loop.<path>` — a property path through the dev bridge */
const loopGet = (page: Page, path: string): Promise<any> => page.evaluate(`window.__loop.${path}`)

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 40 }, data: { kind: 'source', label: 'Mint', activation: 'automatic', mode: 'pushAny' } },
    { id: 'gold', type: 'pool', position: { x: 260, y: 40 }, data: { kind: 'pool', label: 'Gold', activation: 'passive', initial: 10, capacity: 100, mode: 'pullAny' } },
    { id: 'sink', type: 'drain', position: { x: 520, y: 40 }, data: { kind: 'drain', label: 'Spend', activation: 'automatic', mode: 'pullAny' } },
    { id: 'r_bad', type: 'register', position: { x: 260, y: 220 }, data: { kind: 'register', label: 'Ratio', expr: '1 / (@gold - @gold)' } },
  ],
  edges: [
    { id: 'e1', type: 'loop', source: 'src', target: 'gold', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '3' } },
    { id: 'e2', type: 'loop', source: 'gold', target: 'sink', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 's1', type: 'loop', source: 'gold', target: 'src', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '' } },
  ],
})

async function load(page: Page, json = GRAPH): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, json)
  await expect(page.locator('.react-flow__node[data-id="r_bad"]')).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as { __loop: { rf: { setViewport: (v: unknown, o: unknown) => void } } }).__loop.rf.setViewport({ x: 80, y: 160, zoom: 1 }, { duration: 0 }),
  )
}

const accentOf = (page: Page, kind: 'nodes' | 'edges', id: string) =>
  page.evaluate(
    ([k, i]) => ((window as any).__loop.graph.getState()[k].find((e: { id: string }) => e.id === i)?.data?.accent ?? null) as string | null,
    [kind, id] as const,
  )
const section = (page: Page) => page.locator('.accent-field')
const swatch = (page: Page, name: string) => section(page).getByRole('button', { name, exact: true })
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
/** click an edge at the midpoint of its own hit path. A level edge (both ports
 *  on the same row — issue #344) has a box with no height, which a locator
 *  click cannot land on. */
const clickEdge = async (page: Page, id: string, modifiers: 'Control'[] = []) => {
  const mid = await page.evaluate((i) => {
    const p = document.querySelector(`.react-flow__edge[data-id="${i}"] path.react-flow__edge-interaction`) as SVGPathElement
    const pt = p.getPointAtLength(p.getTotalLength() / 2)
    const m = p.getScreenCTM()!
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f }
  }, id)
  for (const k of modifiers) await page.keyboard.down(k)
  await page.mouse.click(mid.x, mid.y)
  for (const k of modifiers) await page.keyboard.up(k)
}

test.describe('flow colour — the Colour section (FC-5)', () => {
  test('a palette colour colours the node; Default removes the key', async ({ page }) => {
    await load(page)
    await node(page, 'gold').click()
    await swatch(page, 'Rose').click()
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#B47599')
    await expect(node(page, 'gold').locator('.nodef')).toHaveAttribute('data-accent', '#B47599')
    await expect(swatch(page, 'Rose')).toHaveAttribute('aria-pressed', 'true')
    await swatch(page, 'Default').click()
    expect(await page.evaluate(() => 'accent' in (window as any).__loop.graph.getState().nodes.find((n: { id: string }) => n.id === 'gold').data)).toBe(false)
    await expect(node(page, 'gold').locator('.nodef')).not.toHaveAttribute('data-accent', /.*/)
  })

  test('an edge takes the colour: line, its own arrow, its label border', async ({ page }) => {
    await load(page)
    // e2 (Gold → Spend): nothing crosses it in this fixture (s1 curves over e1)
    await clickEdge(page, 'e2')
    await swatch(page, 'Slate').click()
    expect(await accentOf(page, 'edges', 'e2')).toBe('#638EA5')
    const path = page.locator('.react-flow__edge[data-id="e2"] path.react-flow__edge-path')
    await expect(path).toHaveCSS('stroke', 'rgb(99, 142, 165)')
    await expect(path).toHaveAttribute('marker-end', 'url(#loop-arrow-accent-638ea5)')
    // condition 3 — one marker per distinct colour, id from the six digits only
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent([], ['e1'], '#638ea5'))
    await expect(page.locator('marker#loop-arrow-accent-638ea5')).toHaveCount(1)
    await expect(page.locator('marker[id*="#"]')).toHaveCount(0)
    await expect(page.locator('.edge-label[data-edge-id="e2"]')).toHaveClass(/has-accent/)
  })

  test('one choice colours every selected node and edge as one undo step; differing colours read Mixed', async ({ page }) => {
    await load(page)
    await node(page, 'src').click()
    await node(page, 'sink').click({ modifiers: ['Control'] })
    await clickEdge(page, 'e2', ['Control'])
    const targets = await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      return {
        nodes: g.nodes.filter((n: { selected?: boolean }) => n.selected).map((n: { id: string }) => n.id).sort(),
        edges: g.edges.filter((e: { selected?: boolean }) => e.selected).map((e: { id: string }) => e.id),
      }
    })
    expect(targets).toEqual({ nodes: ['sink', 'src'], edges: ['e2'] })
    await expect(section(page).locator('.accent-field__count')).toContainText('3')
    const past = await loopGet(page, 'graph.getState().past.length')
    await swatch(page, 'Gold').click()
    for (const [k, id] of [['nodes', 'src'], ['nodes', 'sink'], ['edges', 'e2']] as const) expect(await accentOf(page, k, id)).toBe('#A78243')
    expect(await loopGet(page, 'graph.getState().past.length')).toBe(past + 1)
    // a different colour on one of them: the section reads Mixed, nothing pressed
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['src'], [], '#9182A8'))
    await expect(section(page).locator('.accent-field__mixed')).toBeVisible()
    await expect(section(page).locator('[aria-pressed="true"]')).toHaveCount(0)
    // one undo restores all three at once
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    for (const [k, id] of [['nodes', 'src'], ['nodes', 'sink'], ['edges', 'e2']] as const) expect(await accentOf(page, k, id)).toBeNull()
  })

  test('the browser colour input applies on its real change only (condition 4)', async ({ page }) => {
    await load(page)
    await node(page, 'gold').click()
    const picker = section(page).locator('input[type="color"]')
    // opening it on Default, and live input events, apply nothing
    await picker.click()
    await page.keyboard.press('Escape')
    await picker.evaluate((el: HTMLInputElement) => {
      el.value = '#123456'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(await accentOf(page, 'nodes', 'gold')).toBeNull()
    // the commit is its `change`
    await picker.evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true })))
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#123456')
    // on a mixed selection, opening it applies nothing either
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent([], ['e2'], '#654321'))
    await node(page, 'gold').click()
    await clickEdge(page, 'e2', ['Control'])
    await expect(section(page).locator('.accent-field__mixed')).toBeVisible()
    await picker.click()
    await page.keyboard.press('Escape')
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#123456')
    expect(await accentOf(page, 'edges', 'e2')).toBe('#654321')
  })

  test('the hex field: forgiving input, refused alpha, notices that never block, Escape restores', async ({ page }) => {
    await load(page)
    await node(page, 'gold').click()
    const hex = section(page).getByRole('textbox', { name: 'Hex' })
    await hex.fill(' ff0 ')
    await hex.press('Enter')
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#FFFF00')
    const notices = section(page).locator('.accent-field__notices')
    await expect(notices).toContainText('Hard to see on the light canvas.')
    await expect(notices).toContainText('Hard to see on light nodes.')
    await hex.fill('#3a7bd580')
    await hex.press('Enter')
    await expect(section(page)).toContainText('Transparency is not supported')
    await expect(hex).toHaveAttribute('aria-invalid', 'true')
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#FFFF00')
    await hex.press('Escape')
    await expect(hex).toHaveValue('#FFFF00')
    // a palette colour gives no notice
    await swatch(page, 'Sage').click()
    await expect(notices).toBeEmpty()
    // recent colours: stored newest first; the Recent row leaves out the
    // palette's colours, which the palette row already offers (PR 2, FC-5)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loop-studio:recent-accents') ?? '[]'))).toEqual(['#74906B', '#FFFF00'])
    await expect(section(page).getByRole('group', { name: 'Recent' }).getByRole('button')).toHaveCount(1)
    await expect(section(page).getByRole('group', { name: 'Recent' }).getByRole('button').first()).toHaveAttribute('aria-label', '#FFFF00')
  })

  test('keyboard only: Tab reaches the swatches, Enter and Space apply', async ({ page }) => {
    await load(page)
    await node(page, 'gold').click()
    await section(page).getByRole('button', { name: 'Default' }).focus()
    await page.keyboard.press('Tab')
    await expect(swatch(page, 'Slate')).toBeFocused()
    await page.keyboard.press('Enter')
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#638EA5')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#74906B')
  })
})

test.describe('flow colour — nothing a run computes changes (FC-2.4)', () => {
  test('a colour change keeps the step and the Monte Carlo result; so do undo and redo', async ({ page }) => {
    await load(page, GRAPH.replace('"expr":"1 / (@gold - @gold)"', '"expr":"@gold"'))
    await runMc(page, { runs: 20, steps: 5 })
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.stepOnce()
    })
    await expect.poll(() => loopGet(page, 'sim.getState().stepIndex')).toBe(1)
    const rev = await loopGet(page, 'graph.getState().simulationRev')
    await node(page, 'gold').click()
    await swatch(page, 'Violet').click()
    await page.evaluate(() => (window as any).__loop.graph.getState().undo())
    await page.evaluate(() => (window as any).__loop.graph.getState().redo())
    expect(await loopGet(page, 'graph.getState().simulationRev')).toBe(rev)
    expect(await loopGet(page, 'sim.getState().stepIndex')).toBe(1)
    expect(await loopGet(page, 'mc.getState().stale')).toBe(false)
  })
})

test.describe('flow colour — through the file (FC-2.6)', () => {
  test('autosave + reload, Graph JSON export, and an invalid value in a file dropped with the element kept', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['gold', 'r_bad'], ['e1', 's1'], '#B47599'))
    await page.evaluate(() => (window as any).__loop.autosave.flush())
    await page.reload()
    await expect(node(page, 'gold')).toBeVisible()
    for (const [k, id] of [['nodes', 'gold'], ['nodes', 'r_bad'], ['edges', 'e1'], ['edges', 's1']] as const) expect(await accentOf(page, k, id)).toBe('#B47599')
    const exported = await loopGet(page, 'graph.getState().exportJSON()')
    expect(exported.match(/"accent": "#B47599"/g)).toHaveLength(4)
    expect(exported).not.toContain('"selected"')
    // a hand-edited file: an invalid colour is dropped, the node kept
    const edited = exported.replace('"accent": "#B47599"', '"accent": "rgba(1,2,3,0.5)"')
    await importGraph(page, edited)
    await expect(node(page, 'gold')).toBeVisible()
    expect(await loopGet(page, 'graph.getState().nodes.length')).toBe(4)
  })

  test('a share link carries the colour', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['gold'], ['e2'], '#74906B'))
    const text = await loopGet(page, 'graph.getState().exportJSON()')
    // the link's own codec, both ways, then the same import path a link opens through
    const decoded = await page.evaluate(async (t) => {
      const share = (window as any).__loop.share
      const { payload } = await share.encodeShareText(t)
      return share.decodeShareText(payload) as Promise<string>
    }, text)
    expect(decoded).toBe(text)
    await resetAll(page)
    await importGraph(page, decoded)
    expect(await accentOf(page, 'nodes', 'gold')).toBe('#74906B')
    expect(await accentOf(page, 'edges', 'e2')).toBe('#74906B')
  })
})

test.describe('flow colour — drawing and state priority (FC-4)', () => {
  test('the rings keep their spatial order and all four show at once on one Register (condition 2)', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['r_bad'], [], '#A78243'))
    await node(page, 'r_bad').click() // selects and focuses
    await page.mouse.move(5, 5)
    const f = node(page, 'r_bad').locator('.nodef')
    await expect(f).toHaveClass(/is-selected/)
    await expect(f).toHaveClass(/is-focused/)
    await expect(f).toHaveClass(/is-invalid/)
    await expect(f).toHaveClass(/has-accent/)
    // sample the pixels on a vertical line through the flat top edge
    const box = (await node(page, 'r_bad').boundingBox())!
    const topY = box.y + 12 // the Register silhouette's top edge, viewBox y 12 = px
    const shot = await page.screenshot({ clip: { x: box.x + 20, y: topY - 12, width: box.width - 40, height: 24 } })
    const rows = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      const out: string[][] = []
      for (let y = 0; y < img.height; y++) {
        const row: string[] = []
        for (let x = 0; x < img.width; x += 2) {
          const d = g.getImageData(x, y, 1, 1).data
          row.push(`${d[0]},${d[1]},${d[2]}`)
        }
        out.push(row)
      }
      return out
    }, shot.toString('base64'))
    const near = (rgb: string, hex: string, tol = 40) => {
      const [r, g, b] = rgb.split(',').map(Number)
      const [R, G, B] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return Math.abs(r! - R!) + Math.abs(g! - G!) + Math.abs(b! - B!) <= tol
    }
    const rowHas = (dy: number, hex: string) => rows[12 + dy]!.some((p) => near(p, hex))
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return { warning: cs.getPropertyValue('--warning').trim(), selected: cs.getPropertyValue('--state-selected').trim(), focus: cs.getPropertyValue('--state-focus').trim() }
    })
    expect(rowHas(-8, tokens.warning) || rowHas(-7, tokens.warning), 'invalid ring, outermost').toBe(true)
    expect(rowHas(-4, tokens.selected) || rowHas(-3, tokens.selected), 'selection ring, outside').toBe(true)
    expect(rowHas(1, '#A78243') || rowHas(2, '#A78243'), 'colour band, just inside').toBe(true)
    expect(rowHas(5, tokens.focus) || rowHas(6, tokens.focus), 'focus ring, innermost').toBe(true)
    // nothing is painted in the gap between the selection ring and the structure line
    expect(rowHas(-2, tokens.selected) && rowHas(-2, tokens.warning)).toBe(false)
  })

  test('a faint colour never erases the node’s neutral structure line', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['gold'], [], '#FDFDFC'))
    const stroke = node(page, 'gold').locator('.nodef__stroke')
    const structure = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--line-structure').trim())
    await expect(stroke).toHaveCSS('stroke', await page.evaluate((h) => {
      const d = document.createElement('div')
      d.style.color = h
      document.body.append(d)
      const c = getComputedStyle(d).color
      d.remove()
      return c
    }, structure))
    await expect(node(page, 'gold').locator('.nodef__band')).toHaveCount(1)
  })

  test('a selected coloured edge keeps its colour over the underlay; a state edge stays dashed', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent([], ['e2', 's1'], '#9182A8'))
    await clickEdge(page, 'e2')
    const path = page.locator('.react-flow__edge[data-id="e2"] path.react-flow__edge-path')
    await expect(path).toHaveCSS('stroke', 'rgb(145, 130, 168)')
    await expect(path).toHaveCSS('stroke-width', '2px')
    await expect(page.locator('.react-flow__edge[data-id="e2"] .edge-select-underlay')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="s1"] path.react-flow__edge-path')).toHaveCSS('stroke-dasharray', '4px, 4px')
  })

  test('Focus mode dims a colour with its node; forced colours draw no flow colour at all', async ({ page }) => {
    await load(page)
    await page.evaluate(() => (window as any).__loop.graph.getState().setAccent(['sink'], ['e2'], '#B47599'))
    await node(page, 'src').click()
    await page.evaluate(() => (window as any).__loop.ui.getState().setFocusMode(true))
    await expect(node(page, 'sink')).toHaveClass(/lgr-deemph/)
    await expect(node(page, 'sink').locator('.nodef__band')).toHaveCSS('opacity', '0.26')
    await page.evaluate(() => (window as any).__loop.ui.getState().setFocusMode(false))
    await page.emulateMedia({ forcedColors: 'active' })
    await expect(node(page, 'sink').locator('.nodef__band')).toHaveCSS('display', 'none')
    await expect(node(page, 'sink').locator('.nodef__chip')).not.toHaveCSS('background-color', 'rgb(180, 117, 153)')
    await expect(page.locator('.react-flow__edge[data-id="e2"] path.react-flow__edge-path')).not.toHaveCSS('stroke', 'rgb(180, 117, 153)')
    await page.emulateMedia({ forcedColors: 'none' })
  })
})

test.describe('flow colour — the pinned colours are the stylesheet’s', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`surfaces and notice state colours match the ${scheme} tokens; no frame token holds a palette value`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
      const v = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement)
        const g = (n: string) => cs.getPropertyValue(n).trim().toLowerCase()
        return {
          canvas: g('--surface-canvas'), node: g('--surface-raised'),
          signal: g('--signal-primary'), focus: g('--state-focus'), warning: g('--warning'),
          frames: ['slate', 'sage', 'gold', 'violet', 'rose'].map((c) => g(`--frame-accent-${c}`)),
        }
      })
      // a token may be declared through another one; resolve to a hex the same way
      expect({ canvas: v.canvas, node: v.node }).toEqual(SURFACES[scheme])
      expect(v.signal).toBe(NOTICE_STATE_COLOURS.signal[scheme])
      expect(v.focus).toBe(NOTICE_STATE_COLOURS.focus[scheme])
      expect(v.warning).toBe(NOTICE_STATE_COLOURS.warning[scheme])
      for (const p of FLOW_PALETTE) expect(v.frames).not.toContain(p.hex.toLowerCase())
    })
  }
})
