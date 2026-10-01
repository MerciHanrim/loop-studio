import type { Locator, Page } from '@playwright/test'
import {
  boundary,
  computed,
  dist,
  expectBoundary,
  focusStyle,
  keyboardFocus,
  noHover,
  parseRgb,
  probe,
} from './support/boundary'
import { expect, FIXTURE_POOLS_4, importGraph, openApp, readFixture, readRiskyFactory, resetAll, runMc, test } from './support/loop'

// docs/visual-language.md §VL8, the shell branch (2026-10-01). Twelve control
// rules still drew the LAYOUT line (`--line-structure`, 1.78:1 on a light panel)
// as their 1 px boundary after #245 fixed `.btn` / `.pb-btn` / `.timeline__csv`.
// They now draw the control tokens. Measured here on the REAL composited
// pixels, one representative element per rule, in light and dark:
//
//   rest      the boundary is ≥ 3:1 against the surface behind the control
//             and against the control's own face (WCAG 1.4.11)
//   hover     reads differently from rest, and is `--line-control-hover`
//   focus     class A — the boundary takes the solid focus colour, ≥ 3:1, a
//             3 px halo accompanies it, no outline; the reference-insert pill
//             is class B and keeps the opaque outline
//   disabled  not under the 3:1 obligation, but it must read as disabled: the
//             boundary drops to `--line-disabled`
//
// A thirteenth rule joined them in review: the data-import dialogs' text and
// number inputs, paste area and selects were unstyled browser controls and are
// now shell controls. Four representatives are measured (one per element kind).
// Their text starts 4 px inside the box, where the left face sample would land
// on a glyph, so they are measured on the top edge, at the horizontal centre.
//
// `.btn` and the five other controls #245 covered stay in
// `desktop-btn-boundary.spec.ts`, which this branch keeps as the regression.

const REGISTER_DOC = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    { id: 'p1', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'reg', type: 'register', position: { x: 440, y: 0 }, data: { kind: 'register', label: 'Reg', expr: '@p1 * 2' } },
  ],
  edges: [{ id: 'e1', type: 'loop', source: 'src', target: 'p1', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }],
})

const select = (page: Page, id: string) =>
  page.evaluate((nodeId) => (window as any).__loop.graph.getState().setSelection(nodeId, null), id)
const firstNodeOfKind = (page: Page, kind: string) =>
  page.evaluate((k) => (window as any).__loop.graph.getState().nodes.find((n: any) => n.data.kind === k)?.id as string, kind)

type Kind = 'A' | 'B'
type Side = 'left' | 'top'
type Ctl = {
  name: string
  graph: 'risky' | 'register' | 'fixture-mc'
  open: (page: Page) => Promise<Locator>
  /** how the control's focus is drawn (Cozy Shelter tokens v1.1.0 §3) */
  focus: Kind
  /** the rest boundary is the plain `--line-control` token (the pill mixes it with the graph focus colour) */
  plainToken: boolean
  /** hover sets `--line-control-hover` (the pill's hover is the graph focus colour) */
  hoverToken: boolean
  /** how far outside the box the "surface behind" is sampled (default 5 px) */
  out?: number
  /** which edges are measured (default both) */
  sides?: Side[]
}

const CONTROLS: Ctl[] = [
  {
    name: 'Inspector field input (.field input)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await select(page, await firstNodeOfKind(page, 'pool'))
      const el = page.locator('aside.inspector .field input:not([type=checkbox]):not([type=radio])').first()
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'Inspector field select (.field select)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await select(page, await firstNodeOfKind(page, 'pool'))
      const el = page.locator('aside.inspector .field select').first()
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'Monte-Carlo dialog input (.mcdlg__field input)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await page.locator('.pstrip__mc button').click()
      await expect(page.locator('.mcdlg__costlabel').first()).toBeVisible()
      const el = page.locator('.mcdlg[role="dialog"] .mcdlg__field input').first()
      await expect(el).toBeVisible()
      // the dialog focuses its first field on open — start from an unfocused rest state
      await el.evaluate((e) => (e as HTMLElement).blur())
      return el
    },
  },
  {
    name: 'language search (.lang-menu__search)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await page.locator('.toolbar__actions .menu > button', { hasText: /^Settings ▾$/ }).click()
      await page.locator('.lang-switch').first().click()
      const el = page.locator('.lang-menu__search')
      await expect(el).toBeVisible()
      await el.evaluate((e) => (e as HTMLElement).blur())
      return el
    },
  },
  {
    name: 'share URL (.share-pop__url)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await page.locator('.toolbar__actions button.btn', { hasText: /^Share$/ }).click()
      await page.locator('.mcdlg--confirm .mcdlg__foot .btn:last-child').click()
      const el = page.locator('.share-pop__url')
      await expect(el).toBeVisible()
      await el.evaluate((e) => (e as HTMLElement).blur())
      return el
    },
  },
  {
    name: 'PlayBar seed (.pstrip__seed)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      const el = page.locator('.pstrip__seed')
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'minimap toggle (.minimap-toggle)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    // it sits 4 px inside the minimap frame, whose own 1 px line is 5 px away:
    // the default sample would read that line, not the surface behind the toggle
    out: 4,
    open: async (page) => {
      const el = page.locator('.minimap-toggle').first()
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'distribution pool select (.band__pool)',
    graph: 'fixture-mc',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      const el = page.locator('select.band__pool')
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'distribution mean toggle (.band__mean, off)',
    graph: 'fixture-mc',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      const el = page.locator('.band__mean')
      await expect(el).toHaveAttribute('aria-pressed', 'false')
      return el
    },
  },
  {
    name: 'view tab, not selected (.timeline__viewtab)',
    graph: 'fixture-mc',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      const el = page.locator('.timeline__viewtab:not(.is-on)')
      await expect(el).toHaveCount(1)
      return el
    },
  },
  {
    name: 'expression operator key (.regexpr__op)',
    graph: 'register',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await select(page, 'reg')
      const el = page.locator('aside.inspector .regexpr__op').first()
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'reference-insert pill (.regexpr__pick)',
    graph: 'register',
    focus: 'B',
    plainToken: false,
    hoverToken: false,
    // a pill: its left edge is the apex of a curved cap, anti-aliased over two
    // pixels, so only the straight top edge is a boundary measurement
    sides: ['top'],
    open: async (page) => {
      await select(page, 'reg')
      const el = page.locator('aside.inspector .regexpr__pick')
      await expect(el).toBeVisible()
      return el
    },
  },
  {
    name: 'author dialog input (.review__field input)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await openAuthorDialog(page)
      const el = page.locator('.mcdlg--confirm .review__field input')
      await expect(el).toBeVisible()
      await el.evaluate((e) => (e as HTMLElement).blur())
      return el
    },
  },
  {
    name: 'author dialog textarea (.review__field textarea)',
    graph: 'risky',
    focus: 'A',
    plainToken: true,
    hoverToken: true,
    open: async (page) => {
      await openAuthorDialog(page)
      const el = page.locator('.mcdlg--confirm .review__field textarea')
      await expect(el).toBeVisible()
      await page.locator('.mcdlg--confirm .review__field input').evaluate((e) => (e as HTMLElement).blur())
      return el
    },
  },
  ...(
    [
      ['data-import table name (text input)', '.import__nameField input'],
      ['data-import paste area (textarea)', 'textarea.import__paste'],
      ['data-import delimiter (select)', '.import__settingsGroup select'],
      ['data-import header row (number input)', ".import__settingsGroup input[type='number']"],
    ] as const
  ).map(
    ([name, sel]): Ctl => ({
      name,
      graph: 'risky',
      focus: 'A',
      plainToken: true,
      hoverToken: true,
      sides: ['top'],
      open: async (page) => {
        const dlg = await openImportWizard(page)
        const el = dlg.locator(sel).first()
        await el.scrollIntoViewIfNeeded()
        await expect(el).toBeVisible()
        return el
      },
    }),
  ),
]

/** the import wizard with the quick-start example filled in, nothing focused */
async function openImportWizard(page: Page) {
  await page.getByRole('button', { name: 'Data ▾' }).click()
  await page.getByRole('menuitem').first().click()
  const dlg = page.locator('.mcdlg--dataimport')
  await expect(dlg).toBeVisible()
  await dlg.getByRole('button', { name: 'Use this example' }).click()
  await expect(dlg.locator('.import__nameField input').first()).toHaveValue('Items')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  return dlg
}

async function openAuthorDialog(page: Page) {
  await page.locator('.toolbar__actions .menu > button', { hasText: 'File ▾' }).click()
  await page
    .locator('.toolbar__actions .menu__pop [role="menuitem"]')
    .filter({ has: page.locator('.menu__name', { hasText: /author/i }) })
    .click()
  await expect(page.locator('.mcdlg--confirm .review__field').first()).toBeVisible()
}

async function load(page: Page, scheme: 'light' | 'dark', graph: Ctl['graph']) {
  await page.emulateMedia({ colorScheme: scheme })
  await openApp(page)
  await resetAll(page)
  if (graph === 'fixture-mc') {
    await importGraph(page, readFixture())
    await runMc(page, { baseSeed: 1, runs: 20, steps: 6, tracked: FIXTURE_POOLS_4 })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
  } else {
    await importGraph(page, graph === 'register' ? REGISTER_DOC : readRiskyFactory())
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
  }
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready)
  await noHover(page)
}

const fmt = (m: Awaited<ReturnType<typeof boundary>>) => `L ${m.left.vsOut}/${m.left.vsFace} T ${m.top.vsOut}/${m.top.vsFace}`
const expectSides = (name: string, m: Awaited<ReturnType<typeof boundary>>, sides: Side[]) => {
  if (sides.length === 2) return expectBoundary(name, m)
  for (const side of sides) {
    expect(m[side].vsOut, `${name}: ${side} border vs the surface behind the control ≥ 3:1`).toBeGreaterThanOrEqual(3)
    expect(m[side].vsFace, `${name}: ${side} border vs the control's own face ≥ 3:1`).toBeGreaterThanOrEqual(3)
  }
}

test.describe('the thirteen bordered-control rules — real pixels (§VL8 / WCAG 1.4.11)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const ctl of CONTROLS) {
      test(`${scheme}: ${ctl.name} — rest ≥ 3:1, hover and focus read differently, focus is class ${ctl.focus}`, async ({ page }) => {
        await load(page, scheme, ctl.graph)
        const el = await ctl.open(page)
        await noHover(page)
        const sides: Side[] = ctl.sides ?? ['left', 'top']
        const side = sides[0]
        const lineControl = await probe(page, 'var(--line-control)')
        const lineControlHover = await probe(page, 'var(--line-control-hover)')
        const lineFocus = await probe(page, 'var(--line-focus)')

        // ── rest
        const cs = await computed(el)
        expect(cs.width).toBe('1px')
        const rest = await boundary(page, el, ctl.out)
        console.log(`[shell] ${scheme} ${ctl.name} rest: ${fmt(rest)}`)
        expectSides(`${scheme} ${ctl.name} rest`, rest, sides)
        if (ctl.plainToken) expect(cs.border, `${ctl.name}: rest boundary token`).toBe(lineControl)

        // ── hover
        await el.hover()
        await page.waitForTimeout(120)
        const hover = await boundary(page, el, ctl.out)
        console.log(`[shell] ${scheme} ${ctl.name} hover: ${fmt(hover)}`)
        expectSides(`${scheme} ${ctl.name} hover`, hover, sides)
        expect(dist(hover[side].edge, rest[side].edge), `${ctl.name}: hover reads differently from rest`).toBeGreaterThan(6)
        if (ctl.hoverToken) expect((await computed(el)).border, `${ctl.name}: hover boundary token`).toBe(lineControlHover)
        await noHover(page)

        // ── focus
        await keyboardFocus(page, el)
        const fs = await focusStyle(el)
        expect(fs.fv, `${ctl.name}: keyboard focus is visible focus`).toBe(true)
        const focused = await boundary(page, el, ctl.out)
        console.log(`[shell] ${scheme} ${ctl.name} focus: ${fmt(focused)}`)
        if (ctl.focus === 'A') {
          expect(fs.outlineStyle, `${ctl.name}: class A has no outline`).toBe('none')
          expect(fs.border, `${ctl.name}: the boundary takes the solid focus colour`).toBe(lineFocus)
          expect(fs.boxShadow, `${ctl.name}: a 3 px halo accompanies it`).toMatch(/0px 0px 0px 3px/)
          expectSides(`${scheme} ${ctl.name} focused`, focused, sides)
          expect(dist(focused[side].edge, parseRgb(lineFocus)), `${ctl.name}: painted in the focus colour`).toBeLessThan(40)
          expect(dist(focused[side].edge, rest[side].edge), `${ctl.name}: focus reads differently from rest`).toBeGreaterThan(6)
          expect(dist(focused[side].edge, hover[side].edge), `${ctl.name}: focus reads differently from hover`).toBeGreaterThan(6)
        } else {
          expect(fs.outlineStyle, `${ctl.name}: class B keeps the opaque outline`).toBe('solid')
          expect(fs.outlineWidth).toBe('2px')
          expect(fs.outlineColor).toBe(lineFocus)
        }
        await el.evaluate((e) => (e as HTMLElement).blur())
      })
    }

    test(`${scheme}: a disabled Inspector field reads as disabled — its boundary drops to --line-disabled`, async ({ page }) => {
      await load(page, scheme, 'risky')
      await select(page, await firstNodeOfKind(page, 'pool'))
      const input = page.locator('aside.inspector .field input:not([type=checkbox]):not([type=radio])').first()
      await expect(input).toBeVisible()
      const enabled = await boundary(page, input)
      const enabledCs = await computed(input)
      await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
      await expect(input).toBeDisabled()
      await noHover(page)
      const dc = await computed(input)
      expect(dc.border).toBe(await probe(page, 'var(--line-disabled)'))
      expect(dc.color).toBe(await probe(page, 'var(--text-disabled)'))
      expect(dc.border).not.toBe(enabledCs.border)
      const disabled = await boundary(page, input)
      console.log(`[shell] ${scheme} Inspector field disabled: ${fmt(disabled)}`)
      expect(dist(disabled.left.edge, enabled.left.edge), 'the disabled boundary is visibly not the enabled one').toBeGreaterThan(20)
      // hovering a disabled field does not bring the hover boundary back
      await input.hover({ force: true })
      await page.waitForTimeout(120)
      expect((await computed(input)).border).toBe(dc.border)
    })
  }

  test.describe('forced colours', () => {
    test.use({ contextOptions: { forcedColors: 'active' } })

    test('a focused class-A control loses its halo and gets a real Highlight outline back; the clipped pair draw theirs inside the box', async ({ page }) => {
      await openApp(page)
      await resetAll(page)
      await importGraph(page, readRiskyFactory())
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
      const highlight = await probe(page, 'Highlight')

      for (const sel of ['.toolbar__actions .menu > button.btn', '.pstrip .pb-btn:not(.pb-btn--primary):not(:disabled)', '.pstrip__seed', '.minimap-toggle']) {
        const el = page.locator(sel).first()
        await expect(el).toBeVisible()
        await keyboardFocus(page, el)
        const fs = await focusStyle(el)
        expect(fs.fv, sel).toBe(true)
        expect(fs.outlineStyle, `${sel}: a real outline is back`).toBe('solid')
        expect(fs.outlineWidth, sel).toBe('2px')
        expect(fs.outlineColor, sel).toBe(highlight)
        expect(fs.outlineOffset, sel).toBe('2px')
        await el.evaluate((e) => (e as HTMLElement).blur())
      }

      // the one-row legend clips: the trigger's outline is drawn inside its own box
      await page.evaluate(() => {
        const s = (window as any).__loop.sim.getState()
        for (let i = 0; i < 3; i++) s.stepOnce()
      })
      for (const sel of ['.timeline__series', '.timeline__csv']) {
        const el = page.locator(sel)
        await expect(el).toBeVisible()
        await keyboardFocus(page, el)
        const fs = await focusStyle(el)
        expect(fs.outlineStyle, sel).toBe('solid')
        expect(fs.outlineColor, sel).toBe(highlight)
        expect(fs.outlineOffset, `${sel}: inside the box, so the clipping legend cannot cut it`).toBe('-2px')
        await el.evaluate((e) => (e as HTMLElement).blur())
      }

      // the thirteenth rule: the data-import inputs
      const dlg = await openImportWizard(page)
      for (const sel of ['.import__nameField input', 'textarea.import__paste', '.import__settingsGroup select', ".import__settingsGroup input[type='number']"]) {
        const el = dlg.locator(sel).first()
        await el.scrollIntoViewIfNeeded()
        await keyboardFocus(page, el)
        const fs = await focusStyle(el)
        expect(fs.fv, sel).toBe(true)
        expect(fs.outlineStyle, `${sel}: a real outline is back`).toBe('solid')
        expect(fs.outlineColor, sel).toBe(highlight)
        expect(fs.outlineOffset, sel).toBe('2px')
        await el.evaluate((e) => (e as HTMLElement).blur())
      }
    })
  })

  test('the clipped pair in the one-row legend: solid boundary, no outer halo, ≥ 3:1 (light and dark)', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await load(page, scheme, 'risky')
      await page.evaluate(() => {
        const s = (window as any).__loop.sim.getState()
        for (let i = 0; i < 3; i++) s.stepOnce()
      })
      const lineFocus = await probe(page, 'var(--line-focus)')
      for (const sel of ['.timeline__series', '.timeline__csv']) {
        const el = page.locator(sel)
        await expect(el).toBeVisible()
        const rest = await boundary(page, el)
        await keyboardFocus(page, el)
        const fs = await focusStyle(el)
        expect(fs.fv, sel).toBe(true)
        expect(fs.outlineStyle, sel).toBe('none')
        expect(fs.border, sel).toBe(lineFocus)
        expect(fs.boxShadow, `${sel}: the indicator is thickened INWARD, nothing outside to clip`).toMatch(/inset/)
        const focused = await boundary(page, el)
        console.log(`[shell] ${scheme} ${sel} focus (clipped): ${fmt(focused)}`)
        expect(focused.left.vsOut, `${sel}: solid boundary vs the panel ≥ 3:1`).toBeGreaterThanOrEqual(3)
        expect(dist(focused.left.edge, rest.left.edge), `${sel}: focus reads differently from rest`).toBeGreaterThan(6)
        await el.evaluate((e) => (e as HTMLElement).blur())
      }
    }
  })
})
