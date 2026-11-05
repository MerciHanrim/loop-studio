import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import { hasModelLayer, isModelSemanticsLabel, modelSemanticsLabel } from './modelVersion'
import { deserialize, modelVersionForSchema, schemaForModelVersion } from './serialize'
import { canonicalContent } from './revision'
import { canonicalGraphString } from './workspace'
import { parseFlow } from '../engine/flow'
import { parseActivatorExpr } from '../engine/stateExpr'
import { initSim, step } from '../engine/step'

// #471 (the kinds contract, version boundary) — the model-semantics version is
// one axis and a capability is kept by every later version. Before a third
// meaning is added, every site that asked `modelVersion === 2` asks
// `hasModelLayer()` instead, so a version-3 document is read as a model-layer
// document everywhere and nowhere as v1. This file pins that for the engine,
// the canonical projection and the file envelope; `scripts/check-model-version.mjs`
// (`npm run check:model-version`) scans the sources so an equality check
// cannot come back.

const XY = { x: 0, y: 0 }
const source = (id: string): LoopNode => ({ id, type: 'source', position: XY, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } })
const pool = (id: string): LoopNode => ({ id, type: 'pool', position: XY, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } })
const param = (id: string, value: number): LoopNode => ({ id, type: 'parameter', position: XY, data: { kind: 'parameter', label: id, value } as unknown as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow } })

const nodes = [source('s'), pool('b'), param('p', 4)]
const edges = [res('e', 's', 'b', '@p')]
const after1 = (modelVersion: 1 | 2 | 3) => step(nodes, edges, initSim(nodes), 1, modelVersion).state.values['b']

describe('model-semantics version — capability checks (#471 version boundary)', () => {
  it('hasModelLayer: false for 1 and absent, true for 2 and every later version', () => {
    expect(hasModelLayer(undefined)).toBe(false)
    expect(hasModelLayer(1)).toBe(false)
    expect(hasModelLayer(2)).toBe(true)
    expect(hasModelLayer(3)).toBe(true)
  })

  it('the §M2-8 discriminator names the version and is absent for v1', () => {
    expect(modelSemanticsLabel(1)).toBeUndefined()
    expect(modelSemanticsLabel(undefined)).toBeUndefined()
    expect(modelSemanticsLabel(2)).toBe('loop-model/2')
    expect(modelSemanticsLabel(3)).toBe('loop-model/3')
    expect(isModelSemanticsLabel('loop-model/2')).toBe(true)
    expect(isModelSemanticsLabel('loop-model/3')).toBe(true)
    expect(isModelSemanticsLabel('loop-model/1')).toBe(false)
    expect(isModelSemanticsLabel('loop-model/')).toBe(false)
    expect(isModelSemanticsLabel(2)).toBe(false)
  })

  it('the engine at version 3 resolves a Parameter flow as version 2 does, and version 1 does not', () => {
    expect(parseFlow('@p', 3)).toEqual({ kind: 'param', id: 'p' })
    expect(parseFlow('@p', 3)).toEqual(parseFlow('@p', 2))
    expect(parseFlow('@p', 1)).toEqual({ kind: 'const', value: 1 })
    const act3 = parseActivatorExpr('>= @p', 3)
    expect(act3).toEqual(parseActivatorExpr('>= @p', 2))
    expect(act3.ok && act3.rhs.kind).toBe('param')
    expect(parseActivatorExpr('>= @p', 1).ok).toBe(false)
    expect(after1(2)).toBe(4)
    expect(after1(3)).toBe(after1(2))
    expect(after1(1)).toBe(1)
  })

  it('the canonical projection of a version-3 document carries loop-model/3; version 1 carries nothing', () => {
    expect(canonicalGraphString({ nodes, edges }, 3)).toContain('"modelSemantics":"loop-model/3"')
    expect(canonicalGraphString({ nodes, edges }, 2)).toContain('"modelSemantics":"loop-model/2"')
    expect(canonicalGraphString({ nodes, edges }, 1)).not.toContain('modelSemantics')
    expect(canonicalGraphString({ nodes, edges }, 3)).not.toBe(canonicalGraphString({ nodes, edges }, 2))
    expect(canonicalContent({ nodes, edges }, { modelVersion: 3 }).modelSemantics).toBe('loop-model/3')
    expect(canonicalContent({ nodes, edges }, { modelVersion: 1 }).modelSemantics).toBeUndefined()
  })

  it('the file envelope: loop-studio/graph/3 and /4 are readable and writable (the kinds contract, SEMANTICS-M3.md; units, SEMANTICS-M4.md); a later schema still fails closed', () => {
    expect(modelVersionForSchema('loop-studio/graph')).toBe(1)
    expect(modelVersionForSchema('loop-studio/graph/2')).toBe(2)
    expect(modelVersionForSchema('loop-studio/graph/3')).toBe(3)
    expect(modelVersionForSchema('loop-studio/graph/4')).toBe(4)
    expect(modelVersionForSchema('loop-studio/graph/5')).toBe(5)
    expect(modelVersionForSchema('loop-studio/graph/6')).toBeNull()
    expect(schemaForModelVersion(1)).toBe('loop-studio/graph')
    expect(schemaForModelVersion(2)).toBe('loop-studio/graph/2')
    expect(schemaForModelVersion(3)).toBe('loop-studio/graph/3')
    expect(schemaForModelVersion(4)).toBe('loop-studio/graph/4')
    const v3 = JSON.stringify({ schema: 'loop-studio/graph/3', version: 1, nodes: [], edges: [] })
    expect(deserialize(v3).modelVersion).toBe(3)
    const v4 = JSON.stringify({ schema: 'loop-studio/graph/4', version: 1, nodes: [], edges: [] })
    expect(deserialize(v4).modelVersion).toBe(4)
    const v5 = JSON.stringify({ schema: 'loop-studio/graph/5', version: 1, nodes: [], edges: [] })
    expect(deserialize(v5).modelVersion).toBe(5)
    const v6 = JSON.stringify({ schema: 'loop-studio/graph/6', version: 1, nodes: [], edges: [] })
    expect(() => deserialize(v6)).toThrow()
  })
})
