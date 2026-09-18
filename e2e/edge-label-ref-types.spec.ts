// docs/parameter-activator.md §PA7 / docs/parameter-inputs.md §PI9.1 — an edge
// label that carries an `@id` Parameter reference resolves it ONLY when the
// referenced node is a `parameter` AND `typeof value === 'number' &&
// Number.isFinite(value)`. Every other value shape must render the neutral,
// translated `canvas.edgeLabel.refMissing` — never the raw id, never a coerced
// number.
//
// A characterisation test of behaviour that already ships: it adds no product
// code and changes none. It exists because that rule is easy to break silently
// from a long way away. A narrow-selector experiment on `LoopEdge` carried the
// referenced value through a string key and rebuilt it with `Number(...)`, and
// six value shapes then resolved as finite numbers — `"77"`, `""`, `" 5 "`,
// `"0x10"`, `"1e3"` and `[]`. Nothing in the suite noticed: the drag-route,
// reference-repoint, playback-cue and locale checks all passed that build. Only
// a value-TYPE table caught it, so the table is the point of this file.

import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

const GACHA = readFileSync(new URL('../examples/gacha-banner-zones.json', import.meta.url), 'utf8')

/** the resource path (`parseFlow`) and the activator path (`resolveParamRhs`)
 *  resolve references through different code; both are covered. */
const RESOURCE = { edge: 'e_free_1', param: 'pulls_per_zone' }
const ACTIVATOR = { edge: 'e_standard_12', param: 'zone2_standard_hard_pity' }

/** `null` here means "must render the reference-error label". A string means
 *  "must render exactly this". The `Number(...)` column is the trap each row
 *  guards: every one of those coerces to a finite number. */
const CASES: { name: string; value: unknown; resource: string | null; activator: string | null }[] = [
  { name: 'number', value: 200, resource: '200', activator: '< 199' },
  { name: 'number, small', value: 5, resource: '5', activator: '< 4' },
  { name: 'number, zero', value: 0, resource: '0', activator: '< -1' },
  // -0 is a distinct number in JS (Object.is(-0, 0) is false) but canonicalNumber
  // renders it as "0"; a selector comparing values must not turn that into a
  // different label. It cannot cross the bridge as JSON, so it uses a sentinel.
  { name: 'number, negative zero', value: '__-0__', resource: '0', activator: '< -1' },
  { name: 'number, decimal (canonicalNumber, not fmtAmt)', value: 0.05, resource: '0.05', activator: '< -0.95' },
  { name: 'string "77"            (Number → 77)', value: '77', resource: null, activator: null },
  { name: 'string ""              (Number → 0)', value: '', resource: null, activator: null },
  { name: 'string " 5 "           (Number → 5)', value: ' 5 ', resource: null, activator: null },
  { name: 'string "0x10"          (Number → 16)', value: '0x10', resource: null, activator: null },
  { name: 'string "1e3"           (Number → 1000)', value: '1e3', resource: null, activator: null },
  { name: 'string "abc"           (Number → NaN)', value: 'abc', resource: null, activator: null },
  { name: 'boolean true           (Number → 1)', value: true, resource: null, activator: null },
  { name: 'null                   (Number → 0)', value: null, resource: null, activator: null },
  { name: 'undefined', value: undefined, resource: null, activator: null },
  { name: 'NaN', value: '__NaN__', resource: null, activator: null },
  { name: 'Infinity', value: '__Infinity__', resource: null, activator: null },
  { name: 'array []               (Number → 0)', value: [], resource: null, activator: null },
  { name: 'object {}              (Number → NaN)', value: {}, resource: null, activator: null },
]

/** the label lives in React Flow's EdgeLabelRenderer portal, keyed by edge id */
const labelOf = (page: Page, edgeId: string) =>
  page.evaluate((id) => {
    const el = [...document.querySelectorAll('.react-flow__edgelabel-renderer *')].find(
      (n) => n.getAttribute('data-edge-id') === id,
    )
    return el ? el.textContent : null
  }, edgeId)

/** NaN, Infinity and -0 cannot cross the bridge as JSON (`JSON.stringify(-0)`
 *  is `"0"`), so they are rebuilt in-page from a sentinel. */
const setParamValue = (page: Page, id: string, value: unknown) =>
  page.evaluate(
    ([nodeId, v]) => {
      const real =
        v === '__NaN__'
          ? Number.NaN
          : v === '__Infinity__'
            ? Number.POSITIVE_INFINITY
            : v === '__-0__'
              ? -0
              : v
      ;(window as any).__loop.graph.getState().updateNodeData(nodeId, { value: real })
    },
    [id, value] as const,
  )

test.describe('edge label — @-reference value types', () => {
  test('a reference resolves only for a finite number; every other value shape shows the neutral error label', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, GACHA)

    // the error label as the ACTIVE locale renders it — never hard-code English,
    // and never accept the raw id as a substitute
    const refError = await page.evaluate(() => {
      const i18n = (window as any).__loop.i18n.getState()
      return i18n.activeCatalog['canvas.edgeLabel.refMissing'] as string
    })
    expect(refError, 'the fallback string must exist in the active catalog').toBeTruthy()

    // CONTROL PRECONDITION — the baseline must render a resolved number first,
    // so a suite that silently stopped rendering labels cannot pass by showing
    // the error label everywhere.
    await setParamValue(page, RESOURCE.param, 200)
    await expect.poll(() => labelOf(page, RESOURCE.edge)).toBe('200')
    await setParamValue(page, ACTIVATOR.param, 200)
    await expect.poll(() => labelOf(page, ACTIVATOR.edge)).toBe('< 199')

    for (const c of CASES) {
      await setParamValue(page, RESOURCE.param, c.value)
      await expect
        .poll(() => labelOf(page, RESOURCE.edge), { message: `resource @ref, value = ${c.name}` })
        .toBe(c.resource ?? refError)
      // the raw id must never leak into the label (§ the neutral-fallback rule)
      expect(await labelOf(page, RESOURCE.edge)).not.toContain(RESOURCE.param)

      await setParamValue(page, ACTIVATOR.param, c.value)
      await expect
        .poll(() => labelOf(page, ACTIVATOR.edge), { message: `activator @ref, value = ${c.name}` })
        .toBe(c.activator ?? refError)
      expect(await labelOf(page, ACTIVATOR.edge)).not.toContain(ACTIVATOR.param)
    }
  })

  test('repointing the reference to a different Parameter updates the label, and a dangling id falls back', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, GACHA)

    const refError = await page.evaluate(
      () => (window as any).__loop.i18n.getState().activeCatalog['canvas.edgeLabel.refMissing'] as string,
    )
    expect(refError, 'the fallback string must exist in the active catalog').toBeTruthy()

    const before = await labelOf(page, RESOURCE.edge)
    expect(before, 'control precondition: the label resolves to begin with').toBe('200')

    const original = await page.evaluate(
      (id) => (window as any).__loop.graph.getState().edges.find((e: any) => e.id === id).data,
      RESOURCE.edge,
    )
    const repoint = (flow: string) =>
      page.evaluate(
        ([id, d, f]) => (window as any).__loop.graph.getState().setEdgeData(id, { ...(d as object), flow: f }),
        [RESOURCE.edge, original, flow] as const,
      )

    await repoint('@zone1_free_w_ssr') // a different Parameter, value 6
    await expect.poll(() => labelOf(page, RESOURCE.edge)).toBe('6')

    // a dangling reference must land on the EXACT fallback string of the active
    // language — "not 6, and the id is not visible" would also be satisfied by a
    // blank label or by a different error string
    await repoint('@__no_such_param__')
    await expect.poll(() => labelOf(page, RESOURCE.edge)).toBe(refError)

    await repoint(original.flow)
    await expect.poll(() => labelOf(page, RESOURCE.edge)).toBe('200')
  })
})
