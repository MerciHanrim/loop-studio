import { expect, importGraph, openApp, resetAll, test, snap } from './support/loop'
import type { Page } from '@playwright/test'
import { openPanelDetails } from './support/panel'

// State Slice 5 — the Inspector editor for `trigger` / `activator` / `label`
// and the in-canvas feedback (trigger pulse on the delivery step, activator
// tint, label flash + separate clamp note). This layer only presents the
// engine's existing `report.stateEvents`; it must not invent semantics or
// auto-normalise a value the engine would treat as inert.

const DEMO = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Src', activation: 'automatic', mode: 'pushAny' } },
    { id: 'p', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'd', type: 'drain', position: { x: 440, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'passive', mode: 'pullAny' } },
    { id: 'gsrc', type: 'source', position: { x: 0, y: 170 }, data: { kind: 'source', label: 'GSrc', activation: 'automatic', mode: 'pushAny' } },
    { id: 'g', type: 'pool', position: { x: 220, y: 170 }, data: { kind: 'pool', label: 'Gauge', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'autod', type: 'drain', position: { x: 440, y: 170 }, data: { kind: 'drain', label: 'AutoD', activation: 'automatic', mode: 'pullAny' } },
    { id: 'feed', type: 'pool', position: { x: 0, y: 330 }, data: { kind: 'pool', label: 'Feeder', activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' } },
    { id: 'tank', type: 'pool', position: { x: 220, y: 330 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 0, capacity: 8, mode: 'pullAny' } },
    { id: 'tout', type: 'drain', position: { x: 440, y: 330 }, data: { kind: 'drain', label: 'TankOut', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_src_p', source: 'src', target: 'p', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '2' } },
    { id: 'e_p_d', source: 'p', target: 'd', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    { id: 't_trig', source: 'src', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
    { id: 'e_gsrc_g', source: 'gsrc', target: 'g', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    { id: 'a_gate', source: 'g', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'activator', expr: '>= 3' } },
    { id: 't_auto', source: 'src', target: 'autod', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
    { id: 'm1', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+S' } },
    { id: 'm2', source: 'feed', target: 'tank', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '-1' } },
    { id: 'e_tank_out', source: 'tank', target: 'tout', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '4' } },
    { id: 'legacy1', source: 'feed', target: 'p', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'node', expr: '+1' } },
  ],
})

// one Pool → Pool trigger, alone between its ends: a connection that takes
// every state kind (a condition, a change applied always, a trigger)
const LONE_TRIGGER = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'q', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Q', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'r', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'R', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'solo', source: 'q', target: 'r', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 } },
  ],
})

type Bridge = { __loop: Record<string, { getState: () => any }> }

/** the connection's Kind select (the workbench panel's More settings) */
const kindSelect = (page: Page) => page.locator('.inspector details.wb-panel__more label.field', { has: page.locator('.field__label', { hasText: /^Kind$/ }) }).locator('select')

const selectEdge = (page: Page, id: string) =>
  page.evaluate((eid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, eid), id)

const edgeData = (page: Page, id: string) =>
  page.evaluate(
    (eid) => (window as unknown as Bridge).__loop.graph.getState().edges.find((e: any) => e.id === eid)?.data,
    id,
  )

const stepN = (page: Page, n: number) =>
  page.evaluate((k) => {
    const sim = (window as unknown as Bridge).__loop.sim.getState()
    for (let i = 0; i < k; i++) sim.advance()
  }, n)

// docs/simulation-playback.md Slice 3b — the state cue is τ-synced, so it only
// exists while a transition is in flight. Run ONE step through the real
// choreography at a slow beat and hold it mid-`travel` so the cue is on screen;
// `finishStateCue` then settles that same transition with one commit.
async function stepStateCue(page: Page) {
  await page.evaluate(() => {
    const s = (window as unknown as Bridge).__loop.sim.getState()
    s.setSpeed(4000)
    s.stepOnce()
  })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().transition?.tau ?? -1))
    .toBeGreaterThan(0.25)
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().pause())
}
async function finishStateCue(page: Page) {
  await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepOnce())
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().transition))
    .toBe(null)
}

const stateEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stateEvents as any[])

const ev = (list: any[], id: string) => list.find((e) => e.edgeId === id)

const load = async (page: Page) => {
  await importGraph(page, DEMO)
  await expect(page.locator('.react-flow__node')).toHaveCount(9)
}

test.describe('Slice 5 — Inspector editing', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await load(page)
  })

  test('trigger: only the delay field, validated as a whole number ≥ 0, never auto-corrected', async ({ page }) => {
    await selectEdge(page, 't_trig')
    const insp = page.locator('.inspector')
    // the workbench panel: the old Mode select is the connection's Kind select
    // in More settings (Flow / Condition / Change / Trigger — the same three
    // state modes, src/model/connectKind.ts); the second select by position is
    // now the line's shape
    await openPanelDetails(page)
    await expect(kindSelect(page)).toHaveValue('trigger')
    const delay = insp.locator('input[type="number"]')
    await expect(delay).toHaveValue('0')
    // no expr field for trigger — by the fields' own labels: the Kind select
    // now lists "Condition" as an option (measured 2026-10-20)
    await expect(insp.locator('.field__label', { hasText: /^(Condition|Modifier) — / })).toHaveCount(0)

    await delay.fill('2')
    await expect.poll(() => edgeData(page, 't_trig').then((d) => d.delay)).toBe(2)

    await delay.fill('-1')
    await expect(delay).toHaveAttribute('aria-invalid', 'true')
    await expect(insp.locator('.field__hint--bad')).toBeVisible()
    // engine runs it as 0, but the stored value is left exactly as typed
    await expect.poll(() => edgeData(page, 't_trig').then((d) => d.delay)).toBe(-1)

    await delay.fill('')
    await expect.poll(() => edgeData(page, 't_trig').then((d) => d.delay)).toBeUndefined()
  })

  test('activator / label: inline validation mirrors the engine, no auto-normalise', async ({ page }) => {
    await selectEdge(page, 'a_gate')
    const insp = page.locator('.inspector')
    const expr = insp.locator('.field input:not([type="number"]):not([type="radio"])')
    await expect(expr).toHaveValue('>= 3')
    await expect(insp.locator('.field__hint--ok')).toBeVisible()

    await expr.fill('>=')
    await expect(expr).toHaveAttribute('aria-invalid', 'true')
    await expect(insp.locator('.field__hint--bad')).toBeVisible()
    await expect.poll(() => edgeData(page, 'a_gate').then((d) => d.expr)).toBe('>=') // stored verbatim

    await expr.fill('nonsense')
    await expect(insp.locator('.field__hint--bad')).toContainText('no effect')

    await selectEdge(page, 'm1')
    const lexpr = page.locator('.inspector .field input:not([type="number"]):not([type="radio"])')
    await expect(lexpr).toHaveValue('+S')
    // .first() — a `label` edge now also shows the labelTiming group-line hint,
    // which can independently carry `field__hint--ok` (docs/label-timing-authoring.md)
    await expect(page.locator('.inspector .field__hint--ok').first()).toBeVisible()
    await lexpr.fill('*5')
    await expect(lexpr).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('.inspector .field__hint--bad').first()).toBeVisible()
  })

  test('switching mode hides the other fields but keeps their stored values', async ({ page }) => {
    // the switch is the Kind select in More settings, judged by the drawing
    // rules (src/model/connectKind.ts): `t_trig` (Source → Drain) is refused a
    // condition (a Pool source) and a change (Pools at both ends), so the same
    // switch runs on a Pool → Pool trigger with delay 0, which takes all three
    // kinds. (This document's Pool → Pool pairs are labels without a delay;
    // a parallel pair's kind change has its own test below.)
    await importGraph(page, LONE_TRIGGER)
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    await selectEdge(page, 'solo') // delay 0
    await openPanelDetails(page)
    const modeSel = kindSelect(page)
    await modeSel.selectOption('condition')
    await page.locator('.inspector .field input:not([type="number"]):not([type="radio"])').fill('>= 9')
    await modeSel.selectOption('change')
    await page.locator('.inspector .field input:not([type="number"]):not([type="radio"])').fill('+3')
    await modeSel.selectOption('trigger')

    const d = await edgeData(page, 'solo')
    expect(d.mode).toBe('trigger')
    expect(d.delay).toBe(0) // never deleted
    expect(d.expr).toBe('+3') // last-edited expr kept even though trigger ignores it
  })

  test('legacy `node` mode is shown as unsupported and only ever converts on an explicit click', async ({ page }) => {
    // import did NOT rewrite it
    await expect.poll(() => edgeData(page, 'legacy1').then((d) => d.mode)).toBe('node')

    await selectEdge(page, 'legacy1')
    const insp = page.locator('.inspector')
    await expect(insp.locator('.inspector__legacy')).toContainText('Unsupported')
    // the inert mode token is shown verbatim in the note (i18n Slice 2a moved
    // this note into an ICU message, which cannot carry an inline <code> box)
    await expect(insp.locator('.inspector__legacy .inspector__note')).toContainText('node')

    await insp.locator('.inspector__legacy select').selectOption('activator')
    await insp.getByRole('button', { name: /Convert to activator/ }).click()
    const d = await edgeData(page, 'legacy1')
    expect(d.mode).toBe('activator')
    expect(d.expr).toBe('+1') // the old expr string is carried, not discarded
  })

  test('Export → Import round-trips every edited state mode, including trigger delay', async ({ page }) => {
    await selectEdge(page, 't_trig')
    await page.locator('.inspector input[type="number"]').fill('2')
    await selectEdge(page, 'a_gate')
    await page.locator('.inspector .field input:not([type="number"]):not([type="radio"])').fill('> 4')
    await selectEdge(page, 'm2')
    await page.locator('.inspector .field input:not([type="number"]):not([type="radio"])').fill('-2')

    const json = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().newGraph())
    await importGraph(page, json)

    expect(await edgeData(page, 't_trig')).toMatchObject({ kind: 'state', mode: 'trigger', delay: 2 })
    expect(await edgeData(page, 'a_gate')).toMatchObject({ kind: 'state', mode: 'activator', expr: '> 4' })
    expect(await edgeData(page, 'm2')).toMatchObject({ kind: 'state', mode: 'label', expr: '-2' })
  })

  // 2026-10-20 (Lumi): `m1` and `m2` are parallel state connections between the
  // same Pools; the duplicate rule is the stored handles, so a change between
  // the state kinds repeats nothing new — it had refused every change, "already
  // connected this way", because of the other one
  test('a parallel state connection changes its kind; the change survives a reload and an Export → Import, and undo / redo', async ({ page }) => {
    await selectEdge(page, 'm1')
    await openPanelDetails(page)
    await kindSelect(page).selectOption('condition')
    await expect(page.locator('.inspector .inspector__note--warn[role="status"]')).toHaveCount(0)
    await expect.poll(() => edgeData(page, 'm1')).toMatchObject({ kind: 'state', mode: 'activator', expr: '+S' })
    expect(await edgeData(page, 'm2'), 'the other one untouched').toMatchObject({ kind: 'state', mode: 'label', expr: '-1' })

    // saved and opened again: the autosave across a reload
    await page.evaluate(() => (window as unknown as { __loop: { autosave: { flush: () => void } } }).__loop.autosave.flush())
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await expect.poll(() => edgeData(page, 'm1')).toMatchObject({ kind: 'state', mode: 'activator', expr: '+S' })
    expect(await edgeData(page, 'm2')).toMatchObject({ kind: 'state', mode: 'label', expr: '-1' })
    // and a file: Export → Import
    const json = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().newGraph())
    await importGraph(page, json)
    expect(await edgeData(page, 'm1')).toMatchObject({ kind: 'state', mode: 'activator', expr: '+S' })
    expect(await edgeData(page, 'm2')).toMatchObject({ kind: 'state', mode: 'label', expr: '-1' })

    // undo / redo of the change itself (made again after the import, a fresh history)
    await selectEdge(page, 'm2')
    await openPanelDetails(page)
    await kindSelect(page).selectOption('trigger')
    await expect.poll(() => edgeData(page, 'm2')).toMatchObject({ kind: 'state', mode: 'trigger', expr: '-1' })
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())
    await expect.poll(() => edgeData(page, 'm2')).toMatchObject({ kind: 'state', mode: 'label', expr: '-1' })
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().redo())
    await expect.poll(() => edgeData(page, 'm2')).toMatchObject({ kind: 'state', mode: 'trigger', expr: '-1' })
    expect(await edgeData(page, 'm1')).toMatchObject({ kind: 'state', mode: 'activator', expr: '+S' })
  })
})

test.describe('Slice 5 — in-canvas feedback', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await load(page)
  })

  test('trigger delay 0: a pulse rides the edge on the delivery step (fired + 0 + 1)', async ({ page }) => {
    await stepN(page, 1) // Src fires step 1 → schedules for step 2; nothing delivered yet
    expect(ev(await stateEvents(page), 't_trig')).toBeUndefined()

    await stepStateCue(page) // step 2 — delivery, choreographed
    await expect(page.locator('.react-flow__edge[data-id="t_trig"] .state-move--trigger')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="t_trig"] .state-move[data-playback-phase]')).toHaveCount(1)
    await finishStateCue(page)
    expect(ev(await stateEvents(page), 't_trig')?.effect.delivered).toBe(true)
  })

  test('trigger delay 2: no delivery until step 4', async ({ page }) => {
    await selectEdge(page, 't_trig')
    await page.locator('.inspector input[type="number"]').fill('2')
    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())

    await stepN(page, 3)
    expect(ev(await stateEvents(page), 't_trig')).toBeUndefined()
    await stepN(page, 1) // step 4 = 1 + 2 + 1
    expect(ev(await stateEvents(page), 't_trig')?.effect.delivered).toBe(true)
  })

  test('applied:false is delivered but marked blocked — automatic target and gated-closed passive', async ({ page }) => {
    await stepN(page, 1)
    await stepStateCue(page) // step 2, choreographed
    // t_auto → an automatic Drain: pulse delivered, no execution effect — the
    // travelling cue is drawn blocked (hollow warning bead)
    await expect(page.locator('.react-flow__edge[data-id="t_auto"] .state-move--trigger.state-move--blocked')).toHaveCount(1)
    await finishStateCue(page)
    const auto = ev(await stateEvents(page), 't_auto')
    expect(auto.effect).toEqual({ kind: 'trigger', delivered: true, applied: false })
    await expect(page.locator('.edge-label[data-edge-id="t_auto"] .edge-label__blocked')).toBeVisible()

    // t_trig → passive D, but Gauge (0,+1/step) is below ">= 3" until it opens
    expect(ev(await stateEvents(page), 't_trig')?.effect.applied).toBe(false)
    await expect(page.locator('.edge-label[data-edge-id="t_trig"] .edge-label__blocked')).toBeVisible()

    // once the gauge crosses the threshold the same pulse is applied
    await stepN(page, 3) // step 5 — S[Gauge] = 4 ≥ 3
    expect(ev(await stateEvents(page), 't_trig')?.effect).toEqual({
      kind: 'trigger',
      delivered: true,
      applied: true,
    })
    await expect(page.locator('.edge-label[data-edge-id="t_trig"] .edge-label__blocked')).toHaveCount(0)
  })

  test('activator: steady tint flips with satisfied, and the engine event agrees', async ({ page }) => {
    await stepN(page, 2) // S[Gauge] = 1  →  ">= 3" false
    expect(ev(await stateEvents(page), 'a_gate')?.effect.satisfied).toBe(false)
    await expect(page.locator('.edge-label[data-edge-id="a_gate"].edge-label--on')).toHaveCount(0)

    await stepN(page, 3) // step 5, S[Gauge] = 4  →  true
    expect(ev(await stateEvents(page), 'a_gate')?.effect.satisfied).toBe(true)
    await expect(page.locator('.edge-label[data-edge-id="a_gate"].edge-label--on')).toHaveCount(1)
  })

  test('label: the flash direction follows raw delta; the applied change shows only when it says more; the clamp shows as a separate note', async ({ page }) => {
    await stepN(page, 1)
    const list = await stateEvents(page)
    // ascending edge.id: m1 (+S = +10) then m2 (-1); running 0 → 10 → 9, clamp 8 ⇒ m2 carries −1
    expect(ev(list, 'm1').effect).toEqual({ kind: 'label', delta: 10, clampAdjustment: 0 })
    expect(ev(list, 'm2').effect).toEqual({ kind: 'label', delta: -1, clampAdjustment: -1 })

    // 2026-10-21: the applied change shows only when it says more than the set
    // value — m1 (+S → +10) shows "+S" over "Δ +10" (two lines and the Δ, not
    // the colour alone), read as "set +S, applied change +10"; m2 (-1 → -1)
    // repeats its set value, so its chip shows "-1" alone (the clamp note stays)
    const m1 = page.locator('.edge-label[data-edge-id="m1"]')
    await expect(m1).toHaveClass(/edge-label--two/)
    const rows = m1.locator('.edge-label__row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toHaveText('+S')
    await expect(rows.nth(1)).toHaveText('Δ+10')
    await expect(m1.locator('.edge-label__delta')).toHaveText('+10')
    await expect(m1.locator('.sr-only')).toHaveText('set +S, applied change +10')
    for (let i = 0; i < 2; i++) await expect(rows.nth(i)).toHaveAttribute('aria-hidden', 'true')
    // the second line is under the first
    const [top, bottom] = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
    expect(bottom).toBeGreaterThan(top)
    const m2 = page.locator('.edge-label[data-edge-id="m2"]')
    await expect(m2).not.toHaveClass(/edge-label--two/)
    await expect(m2.locator('.edge-label__delta, .edge-label__row, .sr-only')).toHaveCount(0)
    await expect(m2.locator('.edge-label__clamp')).toHaveText('clamp -1')
  })

  test('label: the τ cue rides toward the target for +, away for −', async ({ page }) => {
    await stepStateCue(page) // step 1 — the label step, choreographed
    await expect(page.locator('.react-flow__edge[data-id="m1"] .state-move--label.state-move--in')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="m2"] .state-move--label.state-move--out')).toHaveCount(1)
    // the cue carries the signed delta
    await expect(page.locator('.react-flow__edge[data-id="m1"] .state-move__n')).toHaveText('+10')
    await expect(page.locator('.react-flow__edge[data-id="m2"] .state-move__n')).toHaveText('-1')
    await finishStateCue(page)
    const list = await stateEvents(page)
    expect(ev(list, 'm1').effect).toEqual({ kind: 'label', delta: 10, clampAdjustment: 0 })
    expect(ev(list, 'm2').effect).toEqual({ kind: 'label', delta: -1, clampAdjustment: -1 })
  })

  test('effects clear on Reset and on an edit; an edit also rewinds the sim to step 0', async ({ page }) => {
    await stepN(page, 3)
    expect((await stateEvents(page)).length).toBeGreaterThan(0)

    await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().reset())
    expect(await stateEvents(page)).toEqual([])
    await expect(page.locator('.state-pulse, .state-flash, .edge-label__delta')).toHaveCount(0)

    await stepN(page, 2)
    await selectEdge(page, 'a_gate')
    await page.locator('.inspector .field input:not([type="number"]):not([type="radio"])').fill('>= 1')
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().stepIndex))
      .toBe(0)
    await expect(page.locator('.state-pulse, .state-flash')).toHaveCount(0)
  })

  test('prefers-reduced-motion: a static edge highlight instead of a travelling bead', async ({ page, context }) => {
    await context.grantPermissions([])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await load(page)

    await stepN(page, 2)
    await expect(page.locator('.react-flow__edge[data-id="t_trig"] .state-edge-pulse')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge[data-id="t_trig"] .state-pulse')).toHaveCount(0)
    await page.emulateMedia({ reducedMotion: null })
  })
})

test.describe('Slice 5 — Inspector snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await load(page)
    await selectEdge(page, 'm2')
  })

  test('light', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await expect(page.locator('.inspector')).toHaveScreenshot(...snap(page, 'state-inspector-light'))
  })

  test('dark', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await expect(page.locator('.inspector')).toHaveScreenshot(...snap(page, 'state-inspector-dark'))
  })
})
