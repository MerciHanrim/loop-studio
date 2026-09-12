import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import type { Page } from '@playwright/test'

// docs/label-timing-authoring.md (CSU8 slice 3) — the Inspector's `timing` /
// `when` preset control on a `label` state edge. Two native radios ("Always" /
// "On source fire"), a per-radio disabled reason, and one group-line summary.
// The control must never freshly author a SEMANTICS-S3.md §S3-5 fail-closed
// combination; an already-stored one (imported, or made ineligible by an
// unrelated edit) is preserved verbatim and only explained, never corrected.

const DEMO = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'poolA', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 100, capacity: null, mode: 'pullAny' } },
    { id: 'gate', type: 'gate', position: { x: 220, y: 0 }, data: { kind: 'gate', label: 'Gate', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'poolB', type: 'pool', position: { x: 440, y: 0 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'poolC', type: 'pool', position: { x: 0, y: 150 }, data: { kind: 'pool', label: 'C', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'gate2', type: 'gate', position: { x: 220, y: 150 }, data: { kind: 'gate', label: 'Gate2', activation: 'automatic', distribution: 'deterministic' } },
    { id: 'poolD', type: 'pool', position: { x: 440, y: 150 }, data: { kind: 'pool', label: 'D', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'poolE', type: 'pool', position: { x: 0, y: 300 }, data: { kind: 'pool', label: 'E', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'poolF', type: 'pool', position: { x: 220, y: 300 }, data: { kind: 'pool', label: 'F', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'poolG', type: 'pool', position: { x: 440, y: 300 }, data: { kind: 'pool', label: 'G', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e_a_gate', source: 'poolA', target: 'gate', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    // m_empty — gate -> poolB, label, EMPTY modifier: both presets disabled (row 7)
    { id: 'm_empty', source: 'gate', target: 'poolB', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '' } },
    // m_afterpull — a Router-sourced, LEGITIMATELY eligible afterPull label
    // (source is a Gate, so "Always" can never be freshly picked on it):
    // used for the §LTA5 path 2 free-text-S test, which never touches radio A.
    { id: 'm_afterpull', source: 'gate', target: 'poolD', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+2', timing: 'afterPull', when: 'source-fired' } },
    // m_afterpull_poolsourced — a Pool-sourced edge STORED as afterPull (as if
    // its source were reconnected after the fact): "Always" IS eligible here
    // (source is a Pool), so this is the "checked-and-disabled B, A is the
    // live escape hatch" case (§LTA4.3) used for the switch-back-to-A test.
    { id: 'm_afterpull_poolsourced', source: 'poolA', target: 'poolF', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+2', timing: 'afterPull', when: 'source-fired' } },
    // m_pool_sourced — a Pool-sourced label, N modifier, no timing: A eligible by default
    { id: 'm_pool_sourced', source: 'poolA', target: 'poolC', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+3' } },
    // m_target_bad — target is a Gate, not a Pool: both disabled (row 6)
    { id: 'm_target_bad', source: 'gate', target: 'gate2', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+1' } },
    // m_unsupported — an imported, hand-edited unsupported combination
    { id: 'm_unsupported', source: 'gate', target: 'poolE', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+1', timing: 'nope', when: 'source-fired' } },
    // m_router_valid — Router source, Pool target, N modifier, no timing yet:
    // classified phase0 (A checked, but disabled — source isn't a Pool), B
    // eligible. A single, isolated edit target for the A -> B Undo test (no
    // preceding same-edge edit to risk graphStore's same-tag coalescing,
    // COALESCE_MS in src/store/graphStore.ts).
    { id: 'm_router_valid', source: 'gate', target: 'poolG', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'label', expr: '+5' } },
  ],
})

type Bridge = { __loop: Record<string, { getState: () => any }> }

const selectEdge = (page: Page, id: string) =>
  page.evaluate((eid) => (window as unknown as Bridge).__loop.graph.getState().setSelection(null, eid), id)

const edgeData = (page: Page, id: string) =>
  page.evaluate(
    (eid) => (window as unknown as Bridge).__loop.graph.getState().edges.find((e: any) => e.id === eid)?.data,
    id,
  )

const simulationRev = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().simulationRev)

const pastLength = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().past.length)

const undo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())

const load = async (page: Page) => {
  await importGraph(page, DEMO)
  await expect(page.locator('.react-flow__node')).toHaveCount(9)
}

// the radiogroup: [0] = Always, [1] = On source fire
const radios = (page: Page) => page.locator('.labeltiming__option input[type="radio"]')
const reasons = (page: Page) => page.locator('.labeltiming__reason')
const groupLine = (page: Page) => page.locator('.labeltiming__groupline')
// the modifier <input> — excludes both the number inputs (delay) and the
// labelTiming radios, which also live under `.inspector .field`
const modifierInput = (page: Page) => page.locator('.inspector .field input:not([type="number"]):not([type="radio"])')

test.describe('label timing — preset radiogroup (docs/label-timing-authoring.md)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await load(page)
  })

  test('default: a Pool-sourced label with no timing shows "Always" checked and eligible, no reasons', async ({ page }) => {
    await selectEdge(page, 'm_pool_sourced')
    await expect(radios(page).nth(0)).toBeChecked()
    await expect(radios(page).nth(0)).toBeEnabled()
    await expect(radios(page).nth(1)).not.toBeChecked()
    await expect(reasons(page)).toHaveCount(1) // only B's (source-not-router)
    expect(await edgeData(page, 'm_pool_sourced')).toEqual({ kind: 'state', mode: 'label', expr: '+3' })
  })

  test('empty modifier: BOTH radios disabled, shared reason beside each, group line matches', async ({ page }) => {
    await selectEdge(page, 'm_empty')
    await expect(radios(page).nth(0)).toBeDisabled()
    await expect(radios(page).nth(1)).toBeDisabled()
    await expect(reasons(page)).toHaveCount(2)
    for (const r of await reasons(page).all()) await expect(r).toContainText(/valid/i)
    await expect(groupLine(page)).toContainText(/valid/i)
  })

  test('target not a Pool: BOTH radios disabled regardless of a valid modifier', async ({ page }) => {
    await selectEdge(page, 'm_target_bad')
    await expect(radios(page).nth(0)).toBeDisabled()
    await expect(radios(page).nth(1)).toBeDisabled()
    await expect(reasons(page).first()).toContainText(/Pool/)
  })

  test('Router source + N modifier: B eligible, A checked-if-default and disabled with a reason; clicking B commits atomically', async ({ page }) => {
    await selectEdge(page, 'm_empty')
    await modifierInput(page).fill('+1')
    await expect(radios(page).nth(0)).toBeDisabled() // source is a Gate, not a Pool
    await expect(radios(page).nth(1)).toBeEnabled()

    const revBefore = await simulationRev(page)
    await radios(page).nth(1).check()
    expect(await edgeData(page, 'm_empty')).toEqual({
      kind: 'state', mode: 'label', expr: '+1', timing: 'afterPull', when: 'source-fired',
    })
    expect(await simulationRev(page)).toBe(revBefore + 1) // exactly one bump (LTA-INV-8)
  })

  test('clicking a disabled radio does nothing — no store mutation', async ({ page }) => {
    await selectEdge(page, 'm_empty')
    await modifierInput(page).fill('+1') // Gate source -> A disabled
    const before = await edgeData(page, 'm_empty')
    const revBefore = await simulationRev(page)
    await radios(page).nth(0).dispatchEvent('click') // force a click on the disabled input
    expect(await edgeData(page, 'm_empty')).toEqual(before)
    expect(await simulationRev(page)).toBe(revBefore)
  })

  test('an afterPull edge whose source is a Pool (already-ineligible-B, live A escape hatch): switching to "Always" deletes both keys atomically (never literal "phase0")', async ({ page }) => {
    await selectEdge(page, 'm_afterpull_poolsourced')
    await expect(radios(page).nth(1)).toBeChecked()
    await expect(radios(page).nth(1)).toBeDisabled() // Pool source -> B ineligible, value preserved
    await expect(radios(page).nth(0)).toBeEnabled() // Pool source -> A is the live escape hatch
    const revBefore = await simulationRev(page)
    await radios(page).nth(0).check()
    const d = await edgeData(page, 'm_afterpull_poolsourced')
    expect(d).toEqual({ kind: 'state', mode: 'label', expr: '+2' })
    expect('timing' in d).toBe(false)
    expect('when' in d).toBe(false)
    expect(await simulationRev(page)).toBe(revBefore + 1)
  })

  test('§LTA5 path 2 — typing +S while on "On source fire" still commits, shows the S-form hint, leaves timing/when untouched', async ({ page }) => {
    await selectEdge(page, 'm_afterpull')
    const expr = modifierInput(page)
    await expr.fill('+S')
    await expect(page.locator('.inspector .field__hint--bad').first()).toContainText(/S/)
    await expect(radios(page).nth(1)).toBeChecked() // still checked
    await expect(radios(page).nth(1)).toBeDisabled() // but now ineligible (s-form)
    expect(await edgeData(page, 'm_afterpull')).toMatchObject({ expr: '+S', timing: 'afterPull', when: 'source-fired' })
    // fail-closed in MEANING (an afterPull source can't read S), so the
    // modifier input itself is flagged invalid too, not just its hint text
    await expect(expr).toHaveAttribute('aria-invalid', 'true')
  })

  test('Undo contract — A -> B is one history entry; one Undo restores the exact prior shape', async ({ page }) => {
    await selectEdge(page, 'm_router_valid')
    const before = await edgeData(page, 'm_router_valid') // { kind, mode, expr: '+5' }, no timing/when
    const pastBefore = await pastLength(page)

    await radios(page).nth(1).check() // the ONLY edit in this test — A -> B
    expect(await pastLength(page)).toBe(pastBefore + 1) // exactly one history entry
    expect(await edgeData(page, 'm_router_valid')).toMatchObject({ timing: 'afterPull', when: 'source-fired' })

    await undo(page)
    expect(await edgeData(page, 'm_router_valid')).toEqual(before) // exact prior shape, byte-for-byte
    // undo() clears the selection (graphStore.ts) — re-select to inspect the UI
    await selectEdge(page, 'm_router_valid')
    await expect(radios(page).nth(1)).not.toBeChecked()
  })

  test('Undo contract — B -> A is one history entry; one Undo restores the exact prior (afterPull) shape', async ({ page }) => {
    await selectEdge(page, 'm_afterpull_poolsourced')
    const before = await edgeData(page, 'm_afterpull_poolsourced') // the stored afterPull shape
    const pastBefore = await pastLength(page)

    await radios(page).nth(0).check() // the ONLY edit in this test — B -> A (the live escape hatch)
    expect(await pastLength(page)).toBe(pastBefore + 1)
    const afterData = await edgeData(page, 'm_afterpull_poolsourced')
    expect('timing' in afterData).toBe(false)

    await undo(page)
    expect(await edgeData(page, 'm_afterpull_poolsourced')).toEqual(before) // timing/when restored exactly
    await selectEdge(page, 'm_afterpull_poolsourced') // undo() clears the selection
    await expect(radios(page).nth(1)).toBeChecked()
  })

  test('an unsupported stored combination: neither radio checked, the raw values appear in the message, eligibility still computed independently', async ({ page }) => {
    await selectEdge(page, 'm_unsupported')
    await expect(radios(page).nth(0)).not.toBeChecked()
    await expect(radios(page).nth(1)).not.toBeChecked()
    await expect(radios(page).nth(1)).toBeEnabled() // Gate source + N modifier -> B eligible
    await expect(radios(page).nth(0)).toBeDisabled()
    await expect(groupLine(page)).toContainText('nope')
    await expect(groupLine(page)).toContainText('source-fired')

    // choosing the eligible preset replaces the unsupported value with the clean shape
    await radios(page).nth(1).check()
    expect(await edgeData(page, 'm_unsupported')).toEqual({
      kind: 'state', mode: 'label', expr: '+1', timing: 'afterPull', when: 'source-fired',
    })
  })

  test('mode switch preserves timing/when; switching back to label re-shows the same preset, not reset to Always', async ({ page }) => {
    await selectEdge(page, 'm_afterpull')
    const modeSel = page.locator('.inspector .field select').nth(1)
    await modeSel.selectOption('trigger')
    expect(await edgeData(page, 'm_afterpull')).toMatchObject({ mode: 'trigger', timing: 'afterPull', when: 'source-fired' })

    await modeSel.selectOption('label')
    await expect(radios(page).nth(1)).toBeChecked() // re-shows afterPull, not reset
  })

  test('only rendered for label mode — hidden for trigger / activator', async ({ page }) => {
    await selectEdge(page, 'm_afterpull')
    await expect(page.locator('.labeltiming')).toBeVisible()
    const modeSel = page.locator('.inspector .field select').nth(1)
    await modeSel.selectOption('activator')
    await expect(page.locator('.labeltiming')).toHaveCount(0)
  })

  test('locked canvas: read-only text, no radio inputs, same information', async ({ page }) => {
    await selectEdge(page, 'm_afterpull')
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
    await expect(radios(page)).toHaveCount(0)
    await expect(page.locator('.inspector')).toContainText(/source fire|소스 실행/)
  })

  test('locked canvas + unsupported value: the long message renders exactly ONCE, not duplicated', async ({ page }) => {
    await selectEdge(page, 'm_unsupported')
    await page.evaluate(() => (window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true))
    await expect(radios(page)).toHaveCount(0)
    const occurrences = await page.locator('.inspector').getByText('nope').count()
    expect(occurrences).toBe(1)
  })

  test('Export -> Import round-trips an afterPull edge byte-for-byte', async ({ page }) => {
    const json = await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().exportJSON())
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().newGraph())
    await importGraph(page, json)
    expect(await edgeData(page, 'm_afterpull')).toEqual({
      kind: 'state', mode: 'label', expr: '+2', timing: 'afterPull', when: 'source-fired',
    })
  })
})
