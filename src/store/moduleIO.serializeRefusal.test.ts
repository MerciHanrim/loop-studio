// Review M1 — when `serialize` refuses the structure a selection makes, "Save
// selected structure" says why through its usual refusal (`ok: false` with a
// reason the menu shows) instead of throwing out of the click handler. Nothing
// the app writes today is refused once the version comes from the shared rule,
// so the refusal is forced here.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refuse = vi.hoisted(() => ({ on: false }))
vi.mock('../model/serialize', async (orig) => {
  const real = (await orig()) as Record<string, unknown> & { serialize: (...a: unknown[]) => string }
  return {
    ...real,
    serialize: (...a: unknown[]) => {
      if (refuse.on) throw new Error('a test refusal')
      return real.serialize(...a)
    },
  }
})

import { useGraphStore } from './graphStore'
import { planSelectionAsModule } from './moduleIO'
import type { LoopNode } from '../model/types'

describe('Save selected structure when the file is refused', () => {
  beforeEach(() => {
    refuse.on = false
    useGraphStore.setState({
      nodes: [{ id: 'tank', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'tank', initial: 0, capacity: null, activation: 'automatic' } }] as unknown as LoopNode[],
      edges: [],
    })
  })

  it('control: a structure the file accepts is planned as a file', () => {
    const plan = planSelectionAsModule(['tank'])
    expect(plan.ok).toBe(true)
  })

  it('a refused file is a refusal with its reason, not a throw', () => {
    refuse.on = true
    let plan: ReturnType<typeof planSelectionAsModule> | undefined
    expect(() => {
      plan = planSelectionAsModule(['tank'])
    }).not.toThrow()
    expect(plan).toEqual({ ok: false, reason: 'This selection could not be saved as a structure: a test refusal.' })
  })
})
