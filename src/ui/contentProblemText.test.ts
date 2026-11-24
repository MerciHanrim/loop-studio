import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import { canonicalContent, contentProblemOf, InvalidRevisionContentError, validateResultGraph, type ContentProblem } from '../model/revision'
import type { LoopEdge, LoopNode } from '../model/types'
import { useFrameStore } from '../store/frameStore'
import { useGraphStore } from '../store/graphStore'
import { contentProblemSentence } from './contentProblemText'

// #619 follow-up — content that cannot be read carries WHERE (a structured
// element) and the message names it: by its label, else its id, with the
// field in words. The e2e (e2e/content-problem-messages.spec.ts) covers a Pool's
// starting amount, an unreadable Register and an unknown kind through the UI;
// these cover the other fields and elements, and the general fallback.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const pool = (data: Record<string, unknown>, position = { x: 0, y: 0 }, label = 'Tank') =>
  ({ id: 'p', type: 'pool', position, data: { kind: 'pool', label, activation: 'passive', initial: 1, mode: 'pullAny', ...data } }) as unknown as LoopNode

function problemOf(nodes: LoopNode[], edges: LoopEdge[] = []): ContentProblem {
  try {
    canonicalContent({ nodes, edges })
  } catch (e) {
    if (e instanceof InvalidRevisionContentError) return contentProblemOf(e)
    throw e
  }
  throw new Error('the projection accepted the content')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
  useGraphStore.getState().newGraph()
})
afterEach(() => vi.unstubAllGlobals())

describe('the projection says where a non-finite number is', () => {
  it('a node: its starting amount, its capacity, its position', () => {
    expect(problemOf([pool({ initial: Infinity })])).toEqual({ kind: 'non-finite', element: { type: 'node', id: 'p', field: 'initial' } })
    expect(problemOf([pool({ capacity: Number.NaN })])).toEqual({ kind: 'non-finite', element: { type: 'node', id: 'p', field: 'capacity' } })
    expect(problemOf([pool({}, { x: Infinity, y: 0 })])).toEqual({ kind: 'non-finite', element: { type: 'node', id: 'p', field: 'position' } })
  })

  it('the model-layer text stays as it was', () => {
    try {
      canonicalContent({ nodes: [pool({ initial: Infinity })], edges: [] })
    } catch (e) {
      expect((e as InvalidRevisionContentError).contentCause).toMatchObject({ kind: 'non-finite', where: 'node p data.initial' })
    }
  })
})

describe('the result check carries the first problem it can name', () => {
  it('an unknown kind first, by node and kind', () => {
    const w = { id: 'w', type: 'widget', position: { x: 0, y: 0 }, data: { kind: 'widget', label: 'Wonder' } } as unknown as LoopNode
    const r = validateResultGraph([w, pool({ initial: Infinity })], [])
    expect(r.ok === false && r.problem).toEqual({ kind: 'unknown-kind', nodeId: 'w', nodeKind: 'widget' })
  })

  it('a non-finite number, with its element', () => {
    const r = validateResultGraph([pool({ initial: Infinity })], [])
    expect(r.ok === false && r.problem).toEqual({ kind: 'non-finite', element: { type: 'node', id: 'p', field: 'initial' } })
  })

  it('nothing to name (a connection to a node that is not there): `other`', () => {
    const e = { id: 'e1', type: 'loop', source: 'p', target: 'gone', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } } as unknown as LoopEdge
    const r = validateResultGraph([pool({})], [e])
    expect(r.ok === false && r.problem).toEqual({ kind: 'other' })
  })
})

describe('the sentence', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [pool({}, { x: 0, y: 0 }, 'Tank'), { ...pool({}), id: 'q', data: { ...pool({}).data, label: '' } } as LoopNode],
      edges: [{ id: 'e1', type: 'loop', source: 'p', target: 'q', data: { kind: 'state', mode: 'trigger', expr: '', label: 'Pulse' } } as unknown as LoopEdge],
    })
    useFrameStore.setState({ frames: [{ id: 'f1', n: 1, label: '', rect: { x: 0, y: 0, w: 10, h: 10 } }] } as never)
  })

  it('names a node by its label, isolated, and by its id when the label is empty', () => {
    const named = contentProblemSentence({ kind: 'non-finite', element: { type: 'node', id: 'p', field: 'initial' } })
    expect(named).toBe(t('content.problem.nonFiniteNodeInitial', { node: isolateAuto('Tank') }))
    const unnamed = contentProblemSentence({ kind: 'non-finite', element: { type: 'node', id: 'q', field: 'capacity' } })
    expect(unnamed).toBe(t('content.problem.nonFiniteNodeCapacity', { node: isolateAuto('q') }))
    expect(contentProblemSentence({ kind: 'non-finite', element: { type: 'node', id: 'p', field: 'position' } })).toBe(
      t('content.problem.nonFiniteNodePosition', { node: isolateAuto('Tank') }),
    )
  })

  it('a connection by its label (delay, bend point), a frame by its id when untitled, an imported row by its key', () => {
    expect(contentProblemSentence({ kind: 'non-finite', element: { type: 'edge', id: 'e1', field: 'delay' } })).toBe(
      t('content.problem.nonFiniteEdgeDelay', { edge: isolateAuto('Pulse') }),
    )
    expect(contentProblemSentence({ kind: 'non-finite', element: { type: 'edge', id: 'e1', field: 'waypoint' } })).toBe(
      t('content.problem.nonFiniteEdgeWaypoint', { edge: isolateAuto('Pulse') }),
    )
    expect(contentProblemSentence({ kind: 'non-finite', element: { type: 'frame', id: 'f1', field: 'rect' } })).toBe(
      t('content.problem.nonFiniteFrame', { frame: isolateAuto('f1') }),
    )
    expect(contentProblemSentence({ kind: 'non-finite', element: { type: 'importRow', id: 'itm_a', field: 'col_1' } })).toBe(
      t('content.problem.nonFiniteRow', { row: isolateAuto('itm_a') }),
    )
  })

  it('an unreadable node and a model node in a version 1 document: the kind by its own name; an unknown kind as the file has it', () => {
    expect(contentProblemSentence({ kind: 'unreadable-model-node', nodeId: 'p', nodeKind: 'register' })).toBe(
      t('content.problem.unreadableNode', { node: isolateAuto('Tank'), kind: t('canvas.nodeKind.register') }),
    )
    expect(contentProblemSentence({ kind: 'model-node-in-v1', nodeId: 'p', nodeKind: 'parameter' })).toBe(
      t('content.problem.modelNodeInV1', { node: isolateAuto('Tank'), kind: t('canvas.nodeKind.parameter') }),
    )
    expect(contentProblemSentence({ kind: 'unknown-kind', nodeId: 'w', nodeKind: 'widget' })).toBe(
      t('content.problem.unknownKind', { node: isolateAuto('w'), kind: isolateAuto('widget') }),
    )
  })

  it('nothing to name: no sentence, so the caller keeps its general text and guesses no cause', () => {
    expect(contentProblemSentence({ kind: 'other' })).toBeNull()
    expect(contentProblemSentence({ kind: 'non-finite' })).toBeNull()
  })
})
