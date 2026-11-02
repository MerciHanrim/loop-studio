import { beforeEach, describe, expect, it } from 'vitest'
import { deserialize, serialize } from '../model/serialize'
import { useGraphStore } from './graphStore'

// SEMANTICS-R12.md — a node's icon is one undo entry, never a simulation
// change, and only the six flow kinds take one.

const S = () => useGraphStore.getState()
const rev = () => S().simulationRev
const iconOf = (id: string) => (S().nodes.find((n) => n.id === id)?.data as { icon?: unknown } | undefined)?.icon

function nodes() {
  S().newGraph()
  S().addNodeAt('source', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 200, y: 0 })
  S().addNodeAt('parameter', { x: 400, y: 0 })
  const [a, b, p] = S().nodes
  return { a: a!.id, b: b!.id, p: p!.id }
}

beforeEach(() => S().newGraph())

describe('setIcon', () => {
  it('sets an icon on several flow nodes as ONE undo entry, with no simulation change', () => {
    const { a, b } = nodes()
    const r = rev()
    const past = S().past.length
    S().setIcon([a, b], 'car')
    expect(S().past.length).toBe(past + 1)
    expect(rev()).toBe(r)
    expect(iconOf(a)).toBe('car')
    expect(iconOf(b)).toBe('car')
  })

  it('undo and redo restore each node’s previous icon or its absence, and never bump the run', () => {
    const { a, b } = nodes()
    S().setIcon([a], 'cloud')
    S().setIcon([a, b], 'tree')
    const r = rev()
    S().undo()
    expect(iconOf(a)).toBe('cloud')
    expect('icon' in S().nodes.find((n) => n.id === b)!.data).toBe(false)
    S().redo()
    expect(iconOf(b)).toBe('tree')
    expect(rev()).toBe(r)
  })

  it('null removes the key, and re-applying the current icon adds no entry', () => {
    const { a } = nodes()
    S().setIcon([a], 'sun')
    const past = S().past.length
    S().setIcon([a], 'sun')
    expect(S().past.length).toBe(past)
    S().setIcon([a], null)
    expect('icon' in S().nodes.find((n) => n.id === a)!.data).toBe(false)
    expect(S().past.length).toBe(past + 1)
  })

  it('a value that is not a registered id is refused: nothing changes, no entry', () => {
    const { a } = nodes()
    const past = S().past.length
    const before = S().nodes
    S().setIcon([a], 'rain-cloud')
    expect(S().past.length).toBe(past)
    expect(S().nodes).toBe(before)
  })

  it('a Parameter in the list is left alone', () => {
    const { a, p } = nodes()
    S().setIcon([a, p], 'wind')
    expect(iconOf(a)).toBe('wind')
    expect('icon' in S().nodes.find((n) => n.id === p)!.data).toBe(false)
    const past = S().past.length
    S().setIcon([p], 'wind')
    expect(S().past.length).toBe(past)
  })

  it('updateNodeData with an icon does not reset the run either', () => {
    const { a } = nodes()
    const r = rev()
    S().updateNodeData(a, { icon: 'water' } as never)
    expect(iconOf(a)).toBe('water')
    expect(rev()).toBe(r)
  })

  it('the icon goes through the file: saved, and read back on the same node', () => {
    const { a } = nodes()
    S().setIcon([a], 'nuclear-plant')
    const back = deserialize(serialize(S().nodes, S().edges))
    expect((back.nodes.find((n) => n.id === a)!.data as { icon?: unknown }).icon).toBe('nuclear-plant')
  })
})
