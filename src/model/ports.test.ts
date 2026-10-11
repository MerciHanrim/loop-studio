import { describe, expect, it } from 'vitest'
import { baseHandleId, defaultFace, faceOf, nameFaceFor, parseHandleId, portsFromHandles, readPorts, rfHandleId } from './ports'
import type { LoopEdge } from './types'

const edge = (over: Partial<LoopEdge> & { data?: unknown }): LoopEdge =>
  ({ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' }, ...over }) as LoopEdge

describe('ports — the face of a connection end (17-implementation-rules.md §2, NS4.2 P1)', () => {
  it('reads only valid faces and drops an empty or malformed payload', () => {
    expect(readPorts({ source: 'top', target: 'left' })).toEqual({ source: 'top', target: 'left' })
    expect(readPorts({ source: 'top' })).toEqual({ source: 'top' })
    expect(readPorts({ source: 'diagonal', target: 'left' })).toEqual({ target: 'left' })
    expect(readPorts({ source: 'diagonal' })).toBeUndefined()
    expect(readPorts({})).toBeUndefined()
    expect(readPorts(null)).toBeUndefined()
    expect(readPorts('top')).toBeUndefined()
    expect(readPorts(undefined)).toBeUndefined()
  })

  it("defaults to today's faces by kind: resource right → left, state bottom → top", () => {
    expect(defaultFace('resource', 'source')).toBe('right')
    expect(defaultFace('resource', 'target')).toBe('left')
    expect(defaultFace('state', 'source')).toBe('bottom')
    expect(defaultFace('state', 'target')).toBe('top')
    expect(faceOf(edge({}), 'source')).toBe('right')
    expect(faceOf(edge({}), 'target')).toBe('left')
    expect(faceOf(edge({ sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 1' } }), 'source')).toBe('bottom')
    expect(faceOf(edge({ sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 1' } }), 'target')).toBe('top')
  })

  it('a stored face wins over the default, per end', () => {
    const e = edge({ data: { kind: 'resource', flow: '1', ports: { source: 'bottom' } } })
    expect(faceOf(e, 'source')).toBe('bottom')
    expect(faceOf(e, 'target')).toBe('left')
  })

  it('maps a face to a DOM handle id and back without touching the document id', () => {
    expect(baseHandleId('resource', 'source')).toBe('out')
    expect(baseHandleId('state', 'target')).toBe('state-target')
    // the default face binds to the plain id a document without faces always had
    expect(rfHandleId('resource', 'source', 'right')).toBe('out')
    expect(rfHandleId('resource', 'target', 'left')).toBe('in')
    expect(rfHandleId('state', 'source', 'bottom')).toBe('state-source')
    expect(rfHandleId('resource', 'source', 'top')).toBe('out@top')
    expect(rfHandleId('state', 'target', 'left')).toBe('state-target@left')
    expect(parseHandleId('out@top')).toEqual({ base: 'out', face: 'top' })
    expect(parseHandleId('out')).toEqual({ base: 'out', face: null })
    expect(parseHandleId('out@nowhere')).toEqual({ base: 'out', face: null })
    expect(parseHandleId(null)).toEqual({ base: null, face: null })
  })

  it('stores only the ends whose face differs from the default', () => {
    expect(portsFromHandles('resource', 'out@bottom', 'in')).toEqual({ source: 'bottom' })
    expect(portsFromHandles('resource', 'out@right', 'in@left')).toBeUndefined()
    expect(portsFromHandles('resource', 'out', 'in@top')).toEqual({ target: 'top' })
    expect(portsFromHandles('state', 'state-source@top', 'state-target@bottom')).toEqual({ source: 'top', target: 'bottom' })
    expect(portsFromHandles('state', 'state-source', 'state-target')).toBeUndefined()
  })
})

describe('the name face — a candidate rule (§4.3): the first port-free face in the order below, right, left, top', () => {
  it('follows the connection set only', () => {
    expect(nameFaceFor(new Set())).toBe('bottom')
    expect(nameFaceFor(new Set(['bottom']))).toBe('right')
    expect(nameFaceFor(new Set(['bottom', 'right']))).toBe('left')
    expect(nameFaceFor(new Set(['bottom', 'right', 'left']))).toBe('top')
    // all busy: below (the lane offset for this case is not designed yet)
    expect(nameFaceFor(new Set(['bottom', 'right', 'left', 'top']))).toBe('bottom')
  })
})
