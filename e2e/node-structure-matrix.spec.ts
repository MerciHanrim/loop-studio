import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { MATRIX_GRAPH as GRAPH, MATRIX_IDS as IDS, MATRIX_KIND_OF as KIND_OF, type MatrixId as Id } from './support/nodeMatrix'

const KINDS = ['source', 'pool', 'gate', 'converter', 'drain', 'end', 'parameter', 'register'] as const
/** kinds whose body carries a value row */
const VALUE_KINDS = new Set(['pool', 'parameter', 'register'])
/** kinds whose body carries the inner role symbol (set A) */
const SYMBOL_KINDS = new Set(['source', 'drain', 'gate'])

// Node structure — the NEW node's state matrix (Lumi, 2026-10-12: "every node
// kind at L2 / L1 / L0, in light, dark and forced colours; check that the role
// symbol, the value and the name, and the selection / focus / run marks really
// remain"). The previous body keeps its own matrix in `canvas-refresh-lod` /
// `canvas-refresh-visual` (pinned to `?nodes=inside`); this spec is the new
// default's equivalent, from the rendered DOM and computed styles, not pixels.
//
// The level rule (share 17-implementation-rules.md; Lumi 2026-10-12): L2 and
// L1 show the role (silhouette + inner symbol), the value and the outside name;
// L0 hides the body (and the aux line beside it) and keeps the silhouette, the
// type dot, the NAME (Lumi, 2026-10-20: never hidden all at once by zooming out;
// it shrinks with the view) and every state cue. At every level the node keeps its hit box, and the
// selection ring, the focus ring, the invalid ring + `!` flag, the fired ticks
// and the evaluated bracket all stay present and painted.


const Z = { L2: 1, L1: 0.6, L0: 0.32 } as const
type Level = keyof typeof Z
type Scheme = 'light' | 'dark' | 'forced'

type Loop = {
  rf: { setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration: number }) => void }
  sim: { getState: () => { stepOnce: () => void; firedNodeIds: Iterable<string>; activatedNodeIds: Iterable<string> } }
}

async function load(page: Page, scheme: Scheme): Promise<void> {
  // the scheme before the app mounts; reduced motion so a step settles at once
  // and the cues are the held frame (the mark is the same element either way)
  await page.emulateMedia({
    colorScheme: scheme === 'dark' ? 'dark' : 'light',
    forcedColors: scheme === 'forced' ? 'active' : 'none',
    reducedMotion: 'reduce',
  })
  await openApp(page) // the new node is the default — no switch
  await resetAll(page)
  await importGraph(page, GRAPH)
  await expect(page.locator('.react-flow__node')).toHaveCount(IDS.length)
  await expect(page.locator('.nodef--outside')).toHaveCount(IDS.length)
  await page.evaluate(() => document.fonts.ready)
}

const setLevel = async (page: Page, level: Level) => {
  await page.evaluate((z) => (window as unknown as { __loop: Loop }).__loop.rf.setViewport({ x: 140, y: 120, zoom: z }, { duration: 0 }), Z[level])
  for (const id of IDS) await expect(page.locator(`.react-flow__node[data-id="${id}"] .nodef`)).toHaveClass(new RegExp(`lod-${level}\\b`))
}

type Cell = {
  id: string
  lod: string
  value: string | null
  valueVis: string | null
  valueColor: string | null
  role: boolean
  roleVis: string | null
  roleColor: string | null
  roleTitle: string | null
  name: string | null
  nameVis: string | null
  nameColor: string | null
  nameDeco: string | null
  stroke: string | null
  strokeVis: string | null
  cdot: boolean
  sel: boolean
  selDash: string | null
  selStroke: string | null
  focus: boolean
  focusDash: string | null
  invalid: boolean
  invalidDash: string | null
  flag: string | null
  fired: boolean
  firedForm: string | null
  firedOpacity: number | null
  firedStroke: string | null
  evald: boolean
  evalBorders: string | null
  aria: string | null
  box: [number, number]
}

/** every tell of every node in one read, at the current level */
const readAll = (page: Page): Promise<Cell[]> =>
  page.evaluate((ids) => {
    const vp = document.querySelector('.react-flow__viewport') as HTMLElement
    const z = parseFloat(/scale\(([-0-9.]+)\)/.exec(vp.style.transform)![1])
    const cs = (el: Element | null) => (el ? getComputedStyle(el) : null)
    const vis = (el: Element | null) => cs(el)?.visibility ?? null
    return ids.map((id) => {
      const root = document.querySelector(`.react-flow__node[data-id="${id}"] .nodef`) as HTMLElement
      const q = (s: string) => root.querySelector(s)
      const value = q('.nodef__value')
      const role = q('.nodef__role')
      const name = q('.nodef__name')
      const stroke = q('.nodef__stroke')
      const sel = q('.nodef__sel')
      const focus = q('.nodef__focus')
      const invalid = q('.nodef__invalid')
      const fired = q('[data-run-cue="effective"]')
      const evald = q('[data-run-cue="evaluated"]')
      const r = root.getBoundingClientRect()
      const ev = cs(evald)
      return {
        id,
        lod: (root.className.match(/lod-\w+/) || [''])[0],
        value: value ? (value.textContent ?? '').replace(/\s+/g, ' ').trim() : null,
        valueVis: vis(value),
        valueColor: cs(value)?.color ?? null,
        role: !!role,
        roleVis: vis(role),
        roleColor: cs(role)?.color ?? null,
        roleTitle: role?.querySelector('title')?.textContent ?? null,
        name: name?.textContent ?? null,
        nameVis: vis(name),
        nameColor: cs(name)?.color ?? null,
        nameDeco: name ? `${cs(name)!.textDecorationLine} ${cs(name)!.textDecorationStyle}` : null,
        stroke: cs(stroke)?.stroke ?? null,
        strokeVis: vis(stroke),
        cdot: !!q('.nodef__cdot'),
        sel: !!sel,
        selDash: cs(sel)?.strokeDasharray ?? null,
        selStroke: cs(sel)?.stroke ?? null,
        focus: !!focus,
        focusDash: cs(focus)?.strokeDasharray ?? null,
        invalid: !!invalid,
        invalidDash: cs(invalid)?.strokeDasharray ?? null,
        flag: q('.nodef__flag')?.textContent ?? null,
        fired: !!fired,
        firedForm: fired ? (fired as SVGElement).getAttribute('class') : null,
        firedOpacity: fired ? Number(cs(fired)!.opacity) : null,
        firedStroke: cs(fired)?.stroke ?? null,
        evald: !!evald,
        evalBorders: ev ? `${ev.borderLeftStyle} ${ev.borderBottomStyle} ${ev.borderTopStyle} ${ev.borderRightStyle}` : null,
        aria: root.getAttribute('aria-label'),
        box: [Math.round(r.width / z), Math.round(r.height / z)] as [number, number],
      }
    })
  }, [...IDS])

/** a painted colour: an `rgb(...)` that is not fully transparent */
const painted = (c: string | null) => !!c && /^rgb/.test(c) && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)

for (const scheme of ['light', 'dark', 'forced'] as const) {
  test(`${scheme}: every kind keeps its role, value, name and state cues through L2 / L1 / L0`, async ({ page }) => {
    await load(page, scheme)

    // one committed step: the Source fires (`effective`); the empty chain's
    // Gate / Converter / End / Drain are activated without acting (`evaluated`)
    await page.evaluate(() => (window as unknown as { __loop: Loop }).__loop.sim.getState().stepOnce())
    const readHead = () =>
      page.evaluate(() => {
        const s = (window as unknown as { __loop: Loop }).__loop.sim.getState()
        return { fired: [...s.firedNodeIds].sort(), activated: [...s.activatedNodeIds].sort() }
      })
    await expect.poll(async () => (await readHead()).fired).toContain('feed')
    const head = await readHead()
    const evaluated = head.activated.filter((id) => !head.fired.includes(id))
    expect(evaluated.length, 'at least one node is activated without acting').toBeGreaterThan(0)

    // selection on the capped Pool (a real click on its body), keyboard focus on
    // the Parameter — both set once at L2 and expected to persist through the
    // levels (a zoom never changes selection or focus)
    await setLevel(page, 'L2')
    await page.locator('.react-flow__node[data-id="store"] .nodef').click()
    await expect(page.locator('.react-flow__node[data-id="store"] .nodef__sel')).toHaveCount(1)
    await page.locator('.react-flow__node[data-id="p1"]').focus()
    await expect(page.locator('.react-flow__node[data-id="p1"] .nodef__focus')).toHaveCount(1)

    const boxes: Record<Level, Record<string, [number, number]>> = { L2: {}, L1: {}, L0: {} }
    for (const level of ['L2', 'L1', 'L0'] as const) {
      await setLevel(page, level)
      const cells = await readAll(page)
      const shown = level !== 'L0'
      for (const c of cells) {
        const id = c.id as Id
        const kind = KIND_OF[id]
        const at = `${scheme} ${level} ${id} (${kind})`
        expect(c.lod, at).toBe(`lod-${level}`)
        boxes[level][id] = c.box

        // the silhouette: drawn and painted at every level; the type dot at L0 only
        expect(c.strokeVis, `${at}: silhouette`).toBe('visible')
        expect(painted(c.stroke), `${at}: silhouette painted (${c.stroke})`).toBe(true)
        expect(c.cdot, `${at}: type dot`).toBe(level === 'L0')

        // the name — outside, the label, visible and painted at every level
        expect(c.name, `${at}: name text`).toBeTruthy()
        expect(c.nameVis, `${at}: name`).toBe('visible')
        expect(painted(c.nameColor), `${at}: name painted (${c.nameColor})`).toBe(true)

        // the value row — present on the value kinds (an invalid Register shows its
        // placeholder, never a number), visible at L2 / L1, hidden at L0
        if (VALUE_KINDS.has(kind)) {
          expect(c.value, `${at}: value text`).toBeTruthy()
          // (the symbol nodes, 2026-10-19: a register's readout reads `= …`, its
          // placeholder too; a pool's capacity is on the line beside its symbol,
          // shown with the name)
          if (id === 'r_bad') expect(c.value, `${at}: invalid shows no number`).toBe('= —')
          if (id === 'store') {
            expect(c.value, `${at}: the count`).toMatch(/^\d+$/)
            const aux = page.locator('.react-flow__node[data-id="store"] .nodef__aux')
            await expect(aux, `${at}: the capacity beside it`).toHaveText('≤ 20')
            // the capacity goes with the count it qualifies (hidden at L0); the name beside it stays
            expect(await aux.evaluate((el) => getComputedStyle(el).visibility), `${at}: capacity`).toBe(shown ? 'visible' : 'hidden')
          }
          expect(c.valueVis, `${at}: value`).toBe(shown ? 'visible' : 'hidden')
          if (shown) expect(painted(c.valueColor), `${at}: value painted`).toBe(true)
          expect(c.role, `${at}: no symbol on a value kind`).toBe(false)
        } else if (SYMBOL_KINDS.has(kind)) {
          // the inner role symbol (set A): visible with the body, in the text colour,
          // and its word is in the accessible name
          expect(c.role, `${at}: role symbol`).toBe(true)
          expect(c.roleVis, `${at}: role symbol`).toBe(shown ? 'visible' : 'hidden')
          if (shown) expect(painted(c.roleColor), `${at}: symbol painted (${c.roleColor})`).toBe(true)
          expect(c.roleTitle, `${at}: symbol word`).toBeTruthy()
          expect(c.aria, `${at}: aria carries the symbol word`).toContain(`, ${c.roleTitle}`)
          expect(c.value, `${at}: no value on a symbol kind`).toBeNull()
        } else {
          // Converter / End: the silhouette alone
          expect(c.role, `${at}: no symbol`).toBe(false)
          expect(c.value, `${at}: no value`).toBeNull()
        }

        // the accessible name — kind word + label at every level
        expect(c.aria, `${at}: aria`).toMatch(new RegExp(`^\\S+ ${c.name}`))

        // the state cues — present at every level, in their own forms
        expect(c.sel, `${at}: selection ring`).toBe(id === 'store')
        expect(c.focus, `${at}: focus ring`).toBe(id === 'p1')
        expect(c.invalid, `${at}: invalid ring`).toBe(id === 'r_bad')
        expect(c.flag, `${at}: invalid flag`).toBe(id === 'r_bad' ? '!' : null)
        expect(c.fired, `${at}: fired mark`).toBe(head.fired.includes(id))
        expect(c.evald, `${at}: evaluated mark`).toBe(evaluated.includes(id))
        if (c.sel) {
          expect(c.selDash, `${at}: selection solid`).toMatch(/none|^0/)
          expect(painted(c.selStroke), `${at}: selection painted`).toBe(true)
        }
        if (c.focus) {
          expect(c.focusDash, `${at}: focus dashed`).toMatch(/\d/)
          // the name's own focus form (dashed underline) while the name is shown
          if (shown) expect(c.nameDeco, `${at}: focused name`).toBe('underline dashed')
        }
        if (c.invalid) expect(c.invalidDash, `${at}: invalid dashed`).toMatch(/\d/)
        if (c.fired) {
          // the new node's fired mark is the ticks ring (the static element), painted
          expect(c.firedForm, `${at}: ticks`).toContain('nodef__fired-ticks')
          expect(c.firedOpacity, `${at}: ticks opacity`).toBeGreaterThan(0)
          expect(painted(c.firedStroke), `${at}: ticks painted (${c.firedStroke})`).toBe(true)
        }
        if (c.evald) expect(c.evalBorders, `${at}: open bracket (left + bottom)`).toBe('solid solid none none')
      }
    }

    // the hit box never changes with the level (world size)
    for (const id of IDS) {
      expect(boxes.L1[id], `${id} box at L1`).toEqual(boxes.L2[id])
      expect(boxes.L0[id], `${id} box at L0`).toEqual(boxes.L2[id])
      expect(boxes.L2[id][1], `${id} compact height`).toBe(56)
    }
  })
}

test('the matrix covers every kind', async () => {
  expect(new Set(Object.values(KIND_OF))).toEqual(new Set(KINDS))
})
