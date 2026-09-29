import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L9.3 — the canvas content direction contract.
//
// PR A pinned `.react-flow { direction: ltr }` so a diagram does not mirror
// (§L9.2, e2e/rtl-canvas-contract.spec.ts). That pin is correct for GEOMETRY
// and wrong for every string rendered inside it, because the pin cannot tell
// three kinds of text apart:
//
//   USER TEXT      a node label, a frame name, a resource type a person named.
//                  `dir="auto"` — the value's own first strong character
//                  decides, so an Arabic label reads rtl inside an English UI
//                  and a Latin label reads ltr inside an Arabic one.
//   ENGINE TOKENS  a pool value, a `≤ capacity` subtitle, a register's `= expr`,
//                  a signed edge delta. `dir="ltr"` — author order, pinned, so
//                  a leading sign cannot travel to the far end.
//   CATALOG PROSE  a sentence the app wrote: the unreadable-node fallback, the
//                  filter panel, the focus hint, an edge's clamp / blocked note.
//                  The reader's direction, taken from the app's own resolver.
//
// WHY THE ASSERTIONS ARE WHAT THEY ARE
//
// `ar-XB` ships the `en` catalogue verbatim (§L9.2). That is what makes this
// spec able to tell the three apart at all: under `ar-XB` every catalog string
// is still Latin, so `dir="auto"` on catalog prose would resolve LTR and only a
// declared locale direction resolves RTL. The discrimination is the point — a
// test that could not distinguish `auto` from the locale direction would pass
// on either and attest to neither.
//
// Where the shipped attribute and its wrong alternative resolve to the SAME
// computed direction — an engine number is neutral text, and the canvas is
// pinned ltr, so `auto` and `ltr` agree there — the computed value proves
// nothing, and this file says so rather than asserting it twice. Those sites
// are closed two other ways: exhaustively by the source check
// (scripts/check-direction-props.mjs, scripts/check-form-direction.mjs), and
// behaviourally at the two sites where the surrounding direction really is rtl
// and the difference is therefore visible — the register unit inside a pinned
// value, and the signed number inside the clamp note.

type Bridge = {
  __loop: {
    graph: { getState: () => { nodes: { id: string; data: { label?: string } }[] } }
    frame: {
      getState: () => {
        addFrame: (rect: Rect) => string
        adoptFrame: (rect: Rect, label: string) => string
        frames: { id: string; label: string }[]
      }
    }
    ui: { setState: (patch: Record<string, unknown>) => void }
    sim: { getState: () => { advance: () => void; reset: () => void; stateEvents: unknown[] } }
    i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } }
  }
}
type Rect = { x: number; y: number; w: number; h: number }

const AR_LABEL = 'مبيعات'
const AR_UNIT = 'وحدة'

// One graph, every content kind on it. `feed` / `tank` reproduce the clamp
// arithmetic e2e/state-ui.spec.ts pins (running 0 → 10 → 9, capacity 8, so `m2`
// carries the −1), and `src` → `blockd` is a trigger into an AUTOMATIC drain,
// which is delivered-but-not-applied and therefore renders the blocked note.
const CANVAS = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    // a user label in Arabic, and a resource type the user named in Arabic
    { id: 'feed', type: 'pool', position: { x: 0, y: 330 }, data: { kind: 'pool', label: AR_LABEL, resourceType: AR_LABEL, activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' } },
    // a user label in Latin, a capacity subtitle, and a Latin resource type
    { id: 'tank', type: 'pool', position: { x: 240, y: 330 }, data: { kind: 'pool', label: 'Gold reserve', resourceType: 'Gold', activation: 'passive', initial: 0, capacity: 8, mode: 'pullAny' } },
    { id: 'tout', type: 'drain', position: { x: 480, y: 330 }, data: { kind: 'drain', label: 'TankOut', activation: 'automatic', mode: 'pullAny' } },
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    // `src` needs somewhere to push: a source only EXECUTES when it has a
    // resource edge, and a trigger is emitted by the execution. The first draft
    // of this fixture left `src` unconnected and the blocked note never
    // appeared — nothing to do with direction.
    { id: 'sink', type: 'pool', position: { x: 0, y: 165 }, data: { kind: 'pool', label: 'Sink', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'blockd', type: 'drain', position: { x: 240, y: 0 }, data: { kind: 'drain', label: 'AutoD', activation: 'automatic', mode: 'pullAny' } },
    // an engine value with a unit the user typed in Arabic: the value is pinned
    // and the unit is not, inside the same element
    { id: 'reg', type: 'register', position: { x: 480, y: 0 }, data: { kind: 'register', label: 'Savings', expr: '1 + 1', unit: AR_UNIT, format: 'integer' } },
    // a parameter's unit goes to `sub` with `subDir="auto"`, where a pool's
    // `≤ capacity` goes to the same element pinned ltr — the same class, two
    // directions, decided by the caller and not by the element
    { id: 'param', type: 'parameter', position: { x: 720, y: 0 }, data: { kind: 'parameter', label: 'Rate', value: 3, unit: AR_UNIT } },
  ],
  edges: [
    { id: 'e_tank_out', source: 'tank', target: 'tout', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '4' } },
    { id: 'e_src_sink', source: 'src', target: 'sink', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    { id: 'm1', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+S' } },
    { id: 'm2', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '-1' } },
    { id: 't_auto', source: 'src', target: 'blockd', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

// A `parameter` whose value is not a number cannot be seated, so the canvas
// renders `UnreadableModelNode` — the one node that is entirely catalog prose.
const UNREADABLE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'bad', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'x', value: 'lots' } },
    { id: 'p', type: 'pool', position: { x: 260, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' } },
  ],
  edges: [],
})

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
}

/** the interface really did mirror — asserted before every direction claim, so
 *  a locale switch that silently failed cannot read as a passing contract */
async function expectChromeMirrored(page: Page, mirrored: boolean): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('dir')))
    .toBe(mirrored ? 'rtl' : 'ltr')
  // and the canvas still does NOT mirror — §L9.2 holds while §L9.3 is measured
  expect(await dirOf(page, '.react-flow')).toBe('ltr')
}

const dirOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).direction : null
  }, selector)

const attrOf = (page: Page, selector: string) =>
  page.evaluate((sel) => document.querySelector(sel)?.getAttribute('dir') ?? null, selector)

/** every measured surface in one pass, so a round trip compares one object */
const dirMap = (page: Page, map: Record<string, string>) =>
  page.evaluate((entries: [string, string][]) => {
    const out: Record<string, string | null> = {}
    for (const [name, sel] of entries) {
      const el = document.querySelector(sel)
      out[name] = el ? getComputedStyle(el).direction : null
    }
    return out
  }, Object.entries(map))

const stepN = (page: Page, n: number) =>
  page.evaluate((k) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) sim.advance()
  }, n)

async function load(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, CANVAS)
  await expect(page.locator('.react-flow__node')).toHaveCount(8)
}

const N = (id: string) => `.react-flow__node[data-id="${id}"]`

test.describe('§L9.3 — user text takes its own direction inside the ltr-pinned canvas', () => {
  test('a node label reads by its own script, not by the interface', async ({ page }) => {
    await load(page)

    // English interface: the Arabic label already reads rtl, because `auto`
    // never asked the interface
    await expectChromeMirrored(page, false)
    expect(await attrOf(page, `${N('feed')} .nodef__title`)).toBe('auto')
    expect(await dirOf(page, `${N('feed')} .nodef__title`)).toBe('rtl')
    expect(await dirOf(page, `${N('tank')} .nodef__title`)).toBe('ltr')

    // Arabic interface: neither label moves. The Latin one staying ltr is the
    // half that inheritance would have got wrong.
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    expect(await dirOf(page, `${N('feed')} .nodef__title`)).toBe('rtl')
    expect(await dirOf(page, `${N('tank')} .nodef__title`)).toBe('ltr')
  })

  test('a frame chip: the user name takes its own direction, the localized default takes the reader’s', async ({
    page,
  }) => {
    await load(page)
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)

    // two frames through the app's own store: one the user named in Latin, one
    // left unnamed so the chip falls back to `canvas.frame.defaultName`
    await page.evaluate(() => {
      const f = (window as unknown as Bridge).__loop.frame.getState()
      f.adoptFrame({ x: 40, y: 560, w: 420, h: 220 }, 'Gold zone')
      f.addFrame({ x: 520, y: 560, w: 420, h: 220 })
    })
    const chips = page.locator('.lgr-frame__label')
    await expect(chips).toHaveCount(2)

    // The catalogue is English under `ar-XB`, so the default name is Latin text
    // too — `auto` would resolve it ltr and only the locale direction makes it
    // rtl. That is exactly what separates the two branches here.
    const named = chips.filter({ hasText: 'Gold zone' })
    const dflt = chips.filter({ hasNotText: 'Gold zone' })
    await expect(named).toHaveCount(1)
    await expect(dflt).toHaveCount(1)
    expect(await named.getAttribute('dir')).toBe('auto')
    expect(await named.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')
    expect(await dflt.getAttribute('dir')).toBe('rtl')
    expect(await dflt.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  })

  test('a read-only frame chip is the same two branches, one boolean apart', async ({ page }) => {
    // §AF-INV-7 — a locked canvas renders the chip as a plain span instead of a
    // disclosure button. It is the branch a probe is most likely to miss (the
    // AX census in e2e/a11y-direction-invisible.spec.ts missed exactly this
    // one), and the direction has to branch on the same boolean the text does.
    await load(page)
    await switchLocale(page, 'ar-XB')
    await page.evaluate(() => {
      const f = (window as unknown as Bridge).__loop.frame.getState()
      f.adoptFrame({ x: 40, y: 560, w: 420, h: 220 }, 'Gold zone')
      f.addFrame({ x: 520, y: 560, w: 420, h: 220 })
      ;(window as unknown as Bridge).__loop.ui.setState({ canvasLocked: true })
    })
    const statics = page.locator('.lgr-frame__label--static')
    await expect(statics).toHaveCount(2)
    expect(await statics.filter({ hasText: 'Gold zone' }).getAttribute('dir')).toBe('auto')
    expect(await statics.filter({ hasNotText: 'Gold zone' }).getAttribute('dir')).toBe('rtl')
  })

  test('a resource type the user named keeps its script; the catalog row beside it does not', async ({
    page,
  }) => {
    await load(page)
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.setState({ filterPanelOpen: true }))
    await expect(page.locator('.lgr-filter')).toBeVisible()

    const row = (text: string) => page.locator('.lgr-filter__row', { hasText: text }).locator('span')
    // three rows in one fieldset, two of them the user's own vocabulary
    expect(await row(AR_LABEL).evaluate((el) => el.getAttribute('dir'))).toBe('auto')
    expect(await row(AR_LABEL).evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
    expect(await row('Gold').first().evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')
    // the untyped row is a catalog string in the same fieldset, and it follows
    // the reader instead
    const untyped = page.locator('.lgr-filter__group', { hasText: 'Gold' }).locator('.lgr-filter__row').last().locator('span')
    expect(await untyped.getAttribute('dir')).toBe('rtl')
    expect(await untyped.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  })
})

test.describe('§L9.3 — engine tokens stay in author order', () => {
  test('the ATTRIBUTE is the contract where the pin and `auto` cannot be told apart', async ({ page }) => {
    // A pool value, a `≤ capacity` subtitle and a register's `= expr` are
    // neutral or Latin text inside a subtree pinned ltr, so `auto` would
    // compute ltr as well. Asserting the computed direction here would look
    // like evidence and be none; the declared attribute is the whole claim, and
    // scripts/check-direction-props.mjs is what makes it exhaustive.
    await load(page)
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)

    expect(await attrOf(page, `${N('tank')} .nodef__value`)).toBe('ltr')
    expect(await attrOf(page, `${N('tank')} .nodef__sub`)).toBe('ltr')
    expect(await attrOf(page, `${N('reg')} .nodef__value`)).toBe('ltr')
    expect(await attrOf(page, `${N('reg')} .nodef__sub`)).toBe('ltr')
    // the same element on a different caller declares the opposite, which is
    // the proof that the direction travels with the VALUE and not the class
    expect(await attrOf(page, `${N('param')} .nodef__sub`)).toBe('auto')
    expect(await dirOf(page, `${N('param')} .nodef__sub`)).toBe('rtl')
    // and the text really is the engine's, not an empty box
    await expect(page.locator(`${N('tank')} .nodef__sub`)).toHaveText('≤ 8')
    await expect(page.locator(`${N('reg')} .nodef__sub`)).toHaveText('= 1 + 1')
  })

  test('a pinned value keeps the number ahead of its unit under a surrounding rtl', async ({ page }) => {
    // The behavioural half, at the one node where the element holds two runs:
    // the engine's number and a unit the user typed in Arabic, in the same box.
    //
    // THE COUNTERFACTUAL IS INHERITANCE, NOT `auto`. The first version of this
    // test set `dir="auto"` on the value expecting it to pick the Arabic unit up
    // and resolve rtl. It resolved LTR, and correctly: HTML's `auto` algorithm
    // ignores text inside a descendant that declares its own `dir`, and
    // `.nodef__unit` declares `dir="auto"`. So `auto` here sees only `2` — no
    // strong character at all — and the flip proves nothing.
    //
    // What the pin actually defends against is INHERITING an rtl direction,
    // which is what happens the day this node renders outside the ltr-pinned
    // canvas, or the day the pin changes. So the ancestor is forced rtl and the
    // attribute is removed: the two runs swap, and putting the attribute back
    // restores the order exactly.
    await load(page)
    await switchLocale(page, 'ar-XB')

    const value = page.locator(`${N('reg')} .nodef__value`)
    await expect(value).toBeVisible()
    await expect(page.locator(`${N('reg')} .nodef__unit`)).toHaveText(new RegExp(AR_UNIT))
    // the unit took its own direction from its own text
    expect(await dirOf(page, `${N('reg')} .nodef__unit`)).toBe('rtl')

    // Measure the TEXT, not the boxes. An earlier draft compared the unit's
    // offset inside `.nodef__value`'s border box and failed at a true
    // assertion: the value element is wider than its own text, so the box
    // offsets say nothing about which run paints first.
    const order = () =>
      page.evaluate((sel) => {
        const v = document.querySelector(sel) as HTMLElement
        const num = v.firstChild as Text
        const r = document.createRange()
        r.setStart(num, 0)
        r.setEnd(num, num.length)
        const unit = v.querySelector('.nodef__unit') as HTMLElement
        return {
          text: num.data,
          attr: v.getAttribute('dir'),
          resolved: getComputedStyle(v).direction,
          numberLeft: Math.round(r.getBoundingClientRect().left),
          unitLeft: Math.round(unit.getBoundingClientRect().left),
        }
      }, `${N('reg')} .nodef__value`)

    const baseline = await order()
    expect(baseline.text, 'the register value should be the engine number').toBe('2')
    expect(baseline.attr).toBe('ltr')
    expect(baseline.unitLeft).toBeGreaterThan(baseline.numberLeft)

    // force the surrounding direction to rtl — the situation the pin exists for
    const stack = page.locator(`${N('reg')} .nodef__stack`)
    await stack.evaluate((el) => el.setAttribute('dir', 'rtl'))
    const forced = await order()
    expect(forced.resolved, 'the pin holds against an rtl ancestor').toBe('ltr')
    expect(forced.unitLeft, 'the number still paints before the unit').toBeGreaterThan(forced.numberLeft)

    // and now without it, same ancestor
    await value.evaluate((el) => el.removeAttribute('dir'))
    const inherited = await order()
    expect(inherited.attr, 'the flip must actually be in place while it is measured').toBe(null)
    expect(inherited.resolved, 'without the pin the element inherits the rtl ancestor').toBe('rtl')
    expect(inherited.unitLeft, 'inherited rtl should move the unit ahead of the number').toBeLessThan(
      inherited.numberLeft,
    )

    // put both back and check the measurement returns to where it started —
    // otherwise the "flip" could have been the restore
    await value.evaluate((el) => el.setAttribute('dir', 'ltr'))
    await stack.evaluate((el) => el.removeAttribute('dir'))
    expect(await order()).toEqual(baseline)
  })

  test('a signed edge delta and the number inside a clamp note both stay ltr', async ({ page }) => {
    await load(page)
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    await stepN(page, 1)

    const delta = page.locator('.edge-label[data-edge-id="m1"] .edge-label__delta')
    await expect(delta).toHaveText('+10')
    expect(await delta.getAttribute('dir')).toBe('ltr')

    // The clamp note is catalog prose WITH a signed number in it, and it is the
    // one site where the surrounding direction is genuinely rtl — so here the
    // computed values differ and both are real evidence.
    const clamp = page.locator('.edge-label[data-edge-id="m2"] .edge-label__clamp')
    await expect(clamp).toHaveText('clamp -1')
    expect(await clamp.getAttribute('dir')).toBe('rtl')
    expect(await clamp.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')

    const num = clamp.locator('span')
    await expect(num).toHaveText('-1')
    expect(await num.getAttribute('dir')).toBe('ltr')
    expect(await num.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')
    // and the sign really is rendered first: `-1` under an inherited rtl would
    // paint `1-`
    const order = await num.evaluate((el) => {
      const text = el.firstChild as Text
      const r = document.createRange()
      r.setStart(text, 0)
      r.setEnd(text, 1)
      const sign = r.getBoundingClientRect()
      r.setStart(text, 1)
      r.setEnd(text, text.length)
      const digits = r.getBoundingClientRect()
      return { signLeft: sign.left, digitsLeft: digits.left }
    })
    expect(order.signLeft, 'the minus sign must paint to the left of the digit').toBeLessThan(order.digitsLeft)
  })
})

test.describe('§L9.3 — catalog prose follows the reader', () => {
  test('the unreadable-node fallback is prose, and it mirrors', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, UNREADABLE)
    await expect(page.locator(`${N('bad')} .nodef__title`)).toContainText(/unreadable/i)

    // English interface first: Latin text either way, so this half only shows
    // the element exists and reads ltr
    expect(await dirOf(page, `${N('bad')} .nodef__title`)).toBe('ltr')

    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    // the catalogue is still English here, so `auto` would have stayed ltr.
    // These two only read rtl because the component asked the app's resolver.
    expect(await attrOf(page, `${N('bad')} .nodef__title`)).toBe('rtl')
    expect(await dirOf(page, `${N('bad')} .nodef__title`)).toBe('rtl')
    expect(await attrOf(page, `${N('bad')} .nodef__sub`)).toBe('rtl')
    expect(await dirOf(page, `${N('bad')} .nodef__sub`)).toBe('rtl')
  })

  test('the filter panel’s own copy mirrors, row labels aside', async ({ page }) => {
    await load(page)
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.setState({ filterPanelOpen: true }))
    await expect(page.locator('.lgr-filter')).toBeVisible()

    for (const sel of [
      '.lgr-filter__title',
      '.lgr-filter__hint',
      '.lgr-filter__group legend',
      '.lgr-filter__count',
    ]) {
      expect(await attrOf(page, sel), `${sel} declares the reader’s direction`).toBe('rtl')
      expect(await dirOf(page, sel), `${sel} reads rtl`).toBe('rtl')
    }
  })

  test('the focus hint mirrors', async ({ page }) => {
    await load(page)
    await switchLocale(page, 'ar-XB')
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.setState({ focusMode: true }))
    const hint = page.locator('.lgr-focus-hint')
    await expect(hint).toBeVisible()
    expect(await hint.getAttribute('dir')).toBe('rtl')
    expect(await hint.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  })

  test('a canvas hint note mirrors — the caller states the direction', async ({ page }) => {
    // `CanvasHintNote` takes a required `dir`; the empty-canvas hint is the
    // product path that renders one.
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const l = window as unknown as { __loop: { tour: { setState: (p: object) => void }; hint: { setState: (p: object) => void } } }
      l.__loop.tour.setState({ phase: 'idle' })
      l.__loop.hint.setState({ postTourCooldownActive: false })
    })
    await switchLocale(page, 'ar-XB')
    const note = page.locator('.hint-note span').first()
    await expect(note).toBeVisible()
    expect(await note.getAttribute('dir')).toBe('rtl')
    expect(await note.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  })

  test('an edge’s blocked note mirrors', async ({ page }) => {
    await load(page)
    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    await stepN(page, 2) // scheduled on step 1, delivered on step 2

    const blocked = page.locator('.edge-label[data-edge-id="t_auto"] .edge-label__blocked')
    await expect(blocked).toBeVisible()
    expect(await blocked.getAttribute('dir')).toBe('rtl')
    expect(await blocked.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  })
})

test.describe('§L9.3 — en → ar-XB → en recovers exactly', () => {
  test('every measured direction comes back, and the document never moved', async ({ page }) => {
    await load(page)
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.frame.getState().adoptFrame({ x: 40, y: 560, w: 420, h: 220 }, 'Gold zone')
      l.frame.getState().addFrame({ x: 520, y: 560, w: 420, h: 220 })
      l.ui.setState({ filterPanelOpen: true, focusMode: true })
    })
    await expect(page.locator('.lgr-frame__label')).toHaveCount(2)
    await expect(page.locator('.lgr-filter')).toBeVisible()
    await stepN(page, 1)
    await expect(page.locator('.edge-label[data-edge-id="m2"] .edge-label__clamp')).toBeVisible()

    const SURFACES = {
      userLabelArabic: `${N('feed')} .nodef__title`,
      userLabelLatin: `${N('tank')} .nodef__title`,
      engineValue: `${N('tank')} .nodef__value`,
      engineSub: `${N('tank')} .nodef__sub`,
      registerValue: `${N('reg')} .nodef__value`,
      userUnit: `${N('param')} .nodef__sub`,
      edgeDelta: '.edge-label[data-edge-id="m1"] .edge-label__delta',
      clampProse: '.edge-label[data-edge-id="m2"] .edge-label__clamp',
      clampNumber: '.edge-label[data-edge-id="m2"] .edge-label__clamp span',
      filterTitle: '.lgr-filter__title',
      filterHint: '.lgr-filter__hint',
      filterCount: '.lgr-filter__count',
      focusHint: '.lgr-focus-hint',
    }

    /** the document itself — nothing here is allowed to move */
    const doc = () =>
      page.evaluate(() => {
        const l = (window as unknown as Bridge).__loop
        return {
          labels: l.graph.getState().nodes.map((n) => n.data.label ?? null),
          frames: l.frame.getState().frames.map((f) => f.label),
        }
      })

    const enDirs = await dirMap(page, SURFACES)
    const enDoc = await doc()

    // the English baseline: the only rtl surface is the one whose VALUE is
    // Arabic, which is what `auto` is for
    expect(enDirs).toEqual({
      userLabelArabic: 'rtl',
      userLabelLatin: 'ltr',
      engineValue: 'ltr',
      engineSub: 'ltr',
      registerValue: 'ltr',
      userUnit: 'rtl',
      edgeDelta: 'ltr',
      clampProse: 'ltr',
      clampNumber: 'ltr',
      filterTitle: 'ltr',
      filterHint: 'ltr',
      filterCount: 'ltr',
      focusHint: 'ltr',
    })

    await switchLocale(page, 'ar-XB')
    await expectChromeMirrored(page, true)
    // exactly the catalog surfaces flip; the user's own text and the engine's
    // numbers do not
    expect(await dirMap(page, SURFACES)).toEqual({
      ...enDirs,
      clampProse: 'rtl',
      filterTitle: 'rtl',
      filterHint: 'rtl',
      filterCount: 'rtl',
      focusHint: 'rtl',
    })

    await switchLocale(page, 'en')
    await expectChromeMirrored(page, false)
    expect(await dirMap(page, SURFACES)).toEqual(enDirs)
    expect(await doc()).toEqual(enDoc)
  })
})
