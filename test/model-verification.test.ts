import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { canonicaliseExpr } from '../src/model/expr'
import {
  initialPoolValues,
  readParameterData,
  readRegisterData,
  registersOfSnapshot,
  resourceTypeMismatches,
} from '../src/model/model'
import {
  canonicalContent,
  computeRevisionDiff,
  digestOfCanonical,
  graphStructureIssues,
  readRevisionSide,
} from '../src/model/revision'
import { normalizeGraph, serialize } from '../src/model/serialize'
import { buildWorkspacePayload, readWorkspace, WORKSPACE_SCHEMA, WORKSPACE_VERSION } from '../src/model/workspace'
import type { LoopEdge, LoopNode } from '../src/model/types'
import {
  buildModelAdvisoryVariant,
  buildModelVerification,
  buildV1Baseline,
  MODEL_VERIFICATION_ABOUT,
} from './model-verification.fixture'

// `examples/model-verification.json` is the hands-on model-language demo. This
// test re-derives every value in `examples/model-verification.expected.json`
// from that graph — a loop-expr/1 + loop-model/1 + loop-revision/2 regression
// guard, and the oracle the desktop / mobile E2E replays.
//
// Regenerate after a deliberate change:  GEN_MODEL_VERIFICATION=1 npm test -- model-verification

const DIR = resolve(import.meta.dirname, '..', 'examples')
const GEN = !!process.env.GEN_MODEL_VERIFICATION
const STEPS = 6
const round = (v: number) => Math.round(v * 1e6) / 1e6

type RegRow = { step: number } & Record<string, number | { invalid: string }>

function rtSeries(nodes: LoopNode[], edges: LoopEdge[]): { pools: Record<string, number[]>; regs: RegRow[] } {
  const poolIds = nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id)
  const regIds = nodes.filter((n) => n.data.kind === 'register').map((n) => n.id)
  const pools: Record<string, number[]> = Object.fromEntries(poolIds.map((id) => [id, []]))
  const regs: RegRow[] = []

  const record = (t: number, values: Record<string, number>) => {
    for (const id of poolIds) pools[id].push(round(values[id] ?? 0))
    const outcomes = registersOfSnapshot(nodes, values)
    const row: RegRow = { step: t }
    for (const id of regIds) {
      const o = outcomes.get(id)
      row[id] = !o ? { invalid: 'MISSING' } : o.invalid ? { invalid: o.code } : round(o.value)
    }
    regs.push(row)
  }

  let st = initSim(nodes)
  record(0, { ...initialPoolValues(nodes), ...st.values }) // S(0): pools at `initial`
  for (let t = 1; t <= STEPS; t++) {
    st = step(nodes, edges, st, 1).state
    record(t, st.values)
  }
  return { pools, regs }
}

/** R(t) for a given S(t), in the oracle's { id: number | {invalid} } shape */
function regRowFrom(nodes: LoopNode[], values: Record<string, number>): Record<string, number | { invalid: string }> {
  const outcomes = registersOfSnapshot(nodes, values)
  const out: Record<string, number | { invalid: string }> = {}
  for (const n of nodes) {
    if (n.data.kind !== 'register') continue
    const o = outcomes.get(n.id)
    out[n.id] = !o ? { invalid: 'MISSING' } : o.invalid ? { invalid: o.code } : round(o.value)
  }
  return out
}

/**
 * loop-workspace/1 stays v1 for the model layer (no loop-workspace/2). Prove it
 * with a real round-trip: step the engine, Export a Workspace, and assert the
 * saved SimState carries pools + step but NOTHING about Registers — no value,
 * no error, no Register series — then re-Import and recompute R(t) from the
 * GraphDoc + the restored S(t). The recomputed values must equal what they were
 * at Export time (§M-INV-2 · SEMANTICS-W.md §W2).
 */
function workspaceRoundTrip(nodes: LoopNode[], edges: LoopEdge[]) {
  const AT = 3
  let st = initSim(nodes)
  for (let t = 1; t <= AT; t++) st = step(nodes, edges, st, 1).state
  const beforeExport = regRowFrom(nodes, st.values)

  const payload = buildWorkspacePayload({
    mc: { config: { baseSeed: 1, runs: 10, steps: 10, tracked: [] }, stale: false },
    view: { timeline: 'live', distributionPoolId: null, showMean: false },
    canvas: { x: 0, y: 0, zoom: 1 },
    simulation: {
      seed: 1,
      step: st.step,
      ended: false,
      values: st.values,
      fired: st.fired ?? [],
      triggerQueue: st.triggerQueue ?? [],
      stateEvents: [],
      series: [
        { step: 0, values: pickPools(nodes, initialPoolValues(nodes)) },
        { step: st.step, values: pickPools(nodes, st.values) },
      ],
    },
  })
  const file = JSON.parse(serialize(nodes, edges, undefined, payload)) as { workspace: any }
  const { restored } = readWorkspace(file.workspace, { nodes, edges }, 'x')
  const restoredSim = restored!.simulation!
  const afterImport = regRowFrom(nodes, restoredSim.values)

  const regIds = new Set(nodes.filter((n) => n.data.kind === 'register').map((n) => n.id))
  return {
    wireSchema: file.workspace.schema,
    wireVersion: file.workspace.version,
    simulationKeys: Object.keys(file.workspace.simulation).sort(),
    // no Register id appears anywhere in the saved SimState (values or series)
    savedStateMentionsARegister:
      Object.keys(file.workspace.simulation.values).some((k) => regIds.has(k)) ||
      file.workspace.simulation.series.some((f: { values: Record<string, number> }) =>
        Object.keys(f.values).some((k) => regIds.has(k)),
      ),
    restoredStep: restoredSim.step,
    restoredPoolValues: pickPools(nodes, restoredSim.values),
    exportStep: AT,
    // recompute R(t) from GraphDoc + restored S(t): identical to Export time
    registersRecomputedEqualExport: JSON.stringify(afterImport) === JSON.stringify(beforeExport),
    registersRecomputed: afterImport,
  }
}

const pickPools = (nodes: LoopNode[], v: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    nodes.filter((n) => n.data.kind === 'pool').map((n) => [n.id, round(v[n.id] ?? 0)]),
  )

/**
 * Malformed model payloads — the pure side of the closeout acceptance. The
 * defensive readers refuse a bad value (no `0` / `"0"` stand-in), and an
 * unseatable model node fails `readRevisionSide` at the §R2-1.1 structural gate
 * (stage 'defensive-read') — so a project file with one drops to graph-only,
 * never Review / Apply. The *UI* side of the same guarantees (graph opens,
 * Canvas / Inspector never crash, `unreadable` fallback shown, `project` header
 * dropped) is `e2e/model-nodes.spec.ts`.
 */
function malformedAcceptance() {
  const n = (id: string, type: string, data: unknown): LoopNode =>
    ({ id, type, position: { x: 0, y: 0 }, data } as LoopNode)
  const pool = n('p1', 'pool', { kind: 'pool', label: 'P', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' })

  const paramStr = readParameterData({ kind: 'parameter', label: 'x', value: 'lots' })
  const paramInf = readParameterData({ kind: 'parameter', label: 'x', value: Number.POSITIVE_INFINITY })
  const regNum = readRegisterData({ kind: 'register', label: 'x', expr: 42 })
  const regNoParse = readRegisterData({ kind: 'register', label: 'x', expr: 'min(@a,@b)' })
  const dataNotObject = readParameterData('nope')

  // an unseatable register (expr is a number) — the §R2-1.1 gate
  const side = readRevisionSide({ nodes: [pool, n('m1', 'register', { kind: 'register', label: 'x', expr: 42 })], edges: [] })

  // a resource edge onto a model node — structural, refused before a run
  const edgeToModel = graphStructureIssues(
    [pool, n('r1', 'register', { kind: 'register', label: 'r', expr: '1' })],
    [{ id: 'e', source: 'p1', target: 'r1', type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } } as LoopEdge],
  )

  return {
    parameterStringValueRejected: !paramStr.ok,
    parameterInfinityRejected: !paramInf.ok,
    registerNonStringExprRejected: !regNum.ok,
    registerUnparseableExprRejected: !regNoParse.ok,
    dataNotAnObjectRejected: !dataNotObject.ok,
    // no reader ever returns a 0 / "0" stand-in for a bad value
    noZeroStandIn: [paramStr, paramInf, regNum, regNoParse, dataNotObject].every(
      (r) => r.ok || !JSON.stringify(r).match(/"(value|expr)":\s*("0"|0)\b/),
    ),
    unseatableModelNodeFailsStructuralGate: !side.ok && side.stage === 'defensive-read',
    edgeToModelNodeRefused: edgeToModel.length > 0,
  }
}

function derive() {
  const built = buildModelVerification()
  const norm = normalizeGraph(built)
  const v1 = normalizeGraph(buildV1Baseline())

  // 1. canonical expression forms (loop-expr/1 §X8)
  const canonicalExprs = Object.fromEntries(
    norm.nodes
      .filter((n) => n.data.kind === 'register')
      .map((n) => [n.id, canonicaliseExpr((n.data as { expr: string }).expr)]),
  )

  // 2. deterministic S(t) + R(t)
  const trace = rtSeries(norm.nodes, norm.edges)

  // 3. advisory resourceType mismatches (loop-model/1 §M4) — run-neutral
  const byId = new Map(norm.nodes.map((n) => [n.id, n]))
  const mismatches = resourceTypeMismatches({
    resourceEdges: norm.edges
      .filter((e) => (e.data as { kind?: unknown }).kind === 'resource')
      .map((e) => ({ id: e.id, source: e.source, target: e.target, resourceType: (e.data as { resourceType?: unknown }).resourceType })),
    nodeKind: (id) => (byId.get(id)?.data.kind ?? 'missing') as string,
    nodeResourceType: (id) => (byId.get(id)?.data as { resourceType?: unknown } | undefined)?.resourceType,
  })

  // 4. loop-revision/2 — the v2 digest, and R2-INV-2 conservative extension:
  //    the v1 baseline is byte-identical under either projection.
  const v2Digest = digestOfCanonical(canonicalContent(norm, { modelLayer: true }))
  const v1UnderV2 = digestOfCanonical(canonicalContent(v1, { modelLayer: true }))
  const v1UnderV1 = digestOfCanonical(canonicalContent(v1, { modelLayer: false }))

  // 5. the advisory diff — the model graph vs the same graph with ONLY
  //    advisory fields nudged (resourceType, a Register unit). §R2-3: real
  //    revision content, engineAffecting: false, advisoryAffecting: true.
  const advisory = normalizeGraph(buildModelAdvisoryVariant())
  const diff = computeRevisionDiff(
    canonicalContent(norm, { modelLayer: true }),
    canonicalContent(advisory, { modelLayer: true }),
  )

  return {
    about: MODEL_VERIFICATION_ABOUT,
    canonicalExprs,
    pools: trace.pools,
    registers: trace.regs,
    resourceMismatches: mismatches,
    workspaceRoundTrip: workspaceRoundTrip(norm.nodes, norm.edges),
    malformedAcceptance: malformedAcceptance(),
    revision2: {
      v2Digest,
      conservativeExtension: v1UnderV2 === v1UnderV1,
      v1Digest: v1UnderV1,
      advisoryVariantDigest: digestOfCanonical(canonicalContent(advisory, { modelLayer: true })),
      advisoryDiff: {
        nodesChanged: diff.summary.nodes.changed,
        edgesChanged: diff.summary.edges.changed,
        nodesAdded: diff.summary.nodes.added,
        nodesRemoved: diff.summary.nodes.removed,
        engineAffecting: diff.summary.engineAffecting,
        advisoryAffecting: diff.summary.advisoryAffecting,
      },
    },
  }
}

describe('model-language verification fixture', () => {
  const derived = derive()

  if (GEN) {
    it('regenerates examples/model-verification.{json,expected.json}', () => {
      mkdirSync(DIR, { recursive: true })
      const built = buildModelVerification()
      writeFileSync(resolve(DIR, 'model-verification.json'), serialize(built.nodes, built.edges) + '\n')
      writeFileSync(resolve(DIR, 'model-verification.expected.json'), JSON.stringify(derived, null, 2) + '\n')
    })
    return
  }

  it('the committed expected.json still matches', () => {
    const committed = JSON.parse(readFileSync(resolve(DIR, 'model-verification.expected.json'), 'utf8'))
    expect(committed, 'examples/model-verification.expected.json is stale — run: GEN_MODEL_VERIFICATION=1 npm test -- model-verification').toEqual(derived)
  })

  it('the committed graph file round-trips through the serializer unchanged', () => {
    const fixtureDoc = JSON.parse(readFileSync(resolve(DIR, 'model-verification.json'), 'utf8'))
    const built = buildModelVerification()
    expect(fixtureDoc).toEqual(JSON.parse(serialize(built.nodes, built.edges)))
  })

  it('canonical expression forms are the loop-expr/1 §X8 AST text', () => {
    expect(derived.canonicalExprs).toMatchObject({
      r_reserve: '@gold * @p_rate',
      r_head: '@r_reserve + 10',
      r_ratio: '@gold / @mana',
      r_gap: '@r_ratio - 1',
      r_loop: '@r_loop + 1',
    })
  })

  it('R(t): r_ratio is valid while mana > 0 then M_REG_EVAL (÷0); r_gap cascades; r_loop is always M_REG_CYCLE', () => {
    const at = (t: number, id: string) => derived.registers[t][id]
    // mana: 2, 1, 0, 0, … ⇒ r_ratio invalid from t2
    expect(at(0, 'r_ratio')).toBe(5) // 10 / 2
    expect(at(1, 'r_ratio')).toMatchObject({}) // still a number at t1 (mana = 1)
    expect(typeof at(1, 'r_ratio')).toBe('number')
    expect(at(2, 'r_ratio')).toEqual({ invalid: 'M_REG_EVAL' })
    expect(at(2, 'r_gap')).toEqual({ invalid: 'M_REG_DEPENDS_ON_INVALID' })
    for (let t = 0; t <= STEPS; t++) expect(at(t, 'r_loop')).toEqual({ invalid: 'M_REG_CYCLE' })
  })

  it('the invalid Register never halts the run — pools keep advancing after t2', () => {
    const gold = derived.pools.gold
    expect(gold.length).toBe(STEPS + 1)
    expect(gold[STEPS]).toBeGreaterThan(gold[0]) // src(+3) > sink(−2) ⇒ Gold climbs
  })

  it('the advisory resourceType mismatch is reported and is the only finding', () => {
    expect(derived.resourceMismatches).toEqual([
      { edgeId: 'e_gold_sink', endpoint: 'source', nodeId: 'gold', edgeType: 'Mana', nodeType: 'Gold' },
    ])
  })

  it('malformed model payloads: the defensive readers refuse bad values (no 0 stand-in) and an unseatable node fails the structural gate', () => {
    // UI-level acceptance (graph opens, no crash, `unreadable` fallback, project
    // header dropped) is e2e/model-nodes.spec.ts — this pins the pure side.
    expect(derived.malformedAcceptance).toEqual({
      parameterStringValueRejected: true,
      parameterInfinityRejected: true,
      registerNonStringExprRejected: true,
      registerUnparseableExprRejected: true,
      dataNotAnObjectRejected: true,
      noZeroStandIn: true,
      unseatableModelNodeFailsStructuralGate: true,
      edgeToModelNodeRefused: true,
    })
  })

  it('loop-workspace/1 v1 round-trip: the Workspace saves pools + step, never a Register, and R(t) recomputes to the pre-Export values', () => {
    const w = derived.workspaceRoundTrip
    expect(w.wireSchema).toBe(WORKSPACE_SCHEMA) // stays 'loop-workspace/1'
    expect(w.wireVersion).toBe(WORKSPACE_VERSION) // 1 — no loop-workspace/2
    expect(w.simulationKeys).toEqual(['ended', 'fired', 'seed', 'series', 'stateEvents', 'step', 'triggerQueue', 'values'])
    expect(w.savedStateMentionsARegister).toBe(false) // no Register value / error / series in SimState
    expect(w.restoredStep).toBe(w.exportStep) // step restored
    expect(w.restoredPoolValues).toEqual({ gold: 13, mana: 0 }) // S(3) pools restored
    expect(w.registersRecomputedEqualExport).toBe(true) // recomputed from GraphDoc + restored S(t)
    // and the recomputed R(3) is exactly the step-3 oracle row (minus its `step`)
    const { step: _s, ...row3 } = derived.registers[3]
    expect(w.registersRecomputed).toEqual(row3)
  })

  it('loop-revision/2: conservative extension holds; a resourceType / unit nudge is advisory-only', () => {
    expect(derived.revision2.conservativeExtension).toBe(true)
    expect(derived.revision2.v2Digest).toMatch(/^[0-9a-f]{64}$/)
    const d = derived.revision2.advisoryDiff
    expect(d).toMatchObject({ nodesAdded: 0, nodesRemoved: 0, engineAffecting: false, advisoryAffecting: true })
    expect(d.nodesChanged + d.edgesChanged).toBeGreaterThan(0)
    // the two graphs have different content digests — a real revision, just not
    // an engine-affecting one
    expect(derived.revision2.advisoryVariantDigest).not.toBe(derived.revision2.v2Digest)
  })
})
