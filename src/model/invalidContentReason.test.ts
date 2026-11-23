import { describe, expect, it } from 'vitest'
import { insertGraph } from './moduleGraph'
import { canonicalContent, InvalidRevisionContentError, validateResultGraph } from './revision'
import type { LoopNode } from './types'

// #619 item 5 — the canonical projection knows why it refuses content: a
// non-finite number at a place, or a model node (Parameter / Register) that
// cannot be read, with the reader's own reason. The result check (selective
// Apply, the data import commit) and the structure insert dropped that and said
// "a non-finite number" for every cause. They now say the cause; a genuine
// non-finite number keeps its sentence and gains where it is.

const pool = (id: string, initial: number) =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } }) as LoopNode
const model = (id: string, kind: 'parameter' | 'register', data: Record<string, unknown>) =>
  ({ id, type: kind, position: { x: 0, y: 100 }, data: { kind, label: id.toUpperCase(), ...data } }) as unknown as LoopNode

const CASES: { name: string; node: LoopNode; reason: string; message: RegExp }[] = [
  {
    name: 'a Register whose expr is not a string',
    node: model('r', 'register', { expr: 42 }),
    reason: 'Node r (register) cannot be read: expr is not a string.',
    message: /^node r \(register\) cannot be read: expr is not a string$/,
  },
  {
    name: 'a Register whose expr does not parse',
    node: model('r', 'register', { expr: '1 +' }),
    reason: 'Node r (register) cannot be read: expr does not parse: "1 +".',
    message: /^node r \(register\) cannot be read: expr does not parse: "1 \+"$/,
  },
  {
    name: 'a Parameter whose value is not a number',
    node: model('p', 'parameter', { value: 'abc' }),
    reason: 'Node p (parameter) cannot be read: value is not a number.',
    message: /^node p \(parameter\) cannot be read: value is not a number$/,
  },
  {
    name: 'a genuine non-finite number (control: the same meaning, now with where)',
    node: pool('inf', Number.POSITIVE_INFINITY),
    reason: 'A node or edge holds a non-finite number (NaN / Infinity): node inf data.initial.',
    message: /^non-finite number in revision content at node inf data\.initial$/,
  },
]

describe('a refusal of content the projection cannot read says why (#619 item 5)', () => {
  for (const c of CASES) {
    it(`${c.name}: the error, the result check and the structure insert`, () => {
      const nodes = [pool('a', 1), c.node]
      let thrown: unknown
      try {
        canonicalContent({ nodes, edges: [] })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(InvalidRevisionContentError)
      expect.soft((thrown as Error).message).toMatch(c.message)

      const v = validateResultGraph(nodes, [])
      expect.soft(v.ok ? [] : v.reasons).toEqual([c.reason])

      const r = insertGraph({ nodes, edges: [], modelVersion: 2 }, { nodes: [pool('m', 1)], edges: [], modelVersion: 2 }, { at: { x: 500, y: 0 } })
      expect(r.ok ? null : r.reason).toBe(`The merged graph is not valid: ${c.reason}`)
    })
  }

  it('the reason names no stack and no source file', () => {
    for (const c of CASES) {
      const v = validateResultGraph([pool('a', 1), c.node], [])
      const text = v.ok ? '' : v.reasons.join(' ')
      expect(text).not.toMatch(/\bat \w+ \(|\.ts\b|InvalidRevisionContentError|Error:/)
    }
  })
})
