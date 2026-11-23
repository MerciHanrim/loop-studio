import { beforeEach, describe, expect, it } from 'vitest'
import { initSim, step } from '../engine/step'
import type { SavedFrame } from '../model/serialize'
import { useFrameStore } from './frameStore'
import { useGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import { proposedGraph, routeImport, type PendingProposal } from './revisionIO'
import { importFile } from './workspaceIO'

// #619 item 4 — a file whose saved frames repeat an id (or miss one) reads the
// same ids on every read (SEMANTICS-R5.md §R5-1.1). The replacement used to be
// `frame_<time>_<counter>`: each open of one file gave the frame another id, and
// a revision file, read once to verify and once to load, opened already changed.

const pool = (id: string, x: number, initial: number) => ({ id, type: 'pool', position: { x, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } })
const source = { id: 's', type: 'source', position: { x: 200, y: 0 }, data: { kind: 'source', label: 's', activation: 'automatic', mode: 'pushAny' } }
const edge = { id: 'e', type: 'loop', source: 's', target: 'b', sourceHandle: 'r-out', targetHandle: 'l-in', data: { kind: 'resource', flow: '1' } }
const frame = (id: string | undefined, label: string, x: number) => ({ ...(id !== undefined ? { id } : {}), label, rect: { x, y: 0, w: 200, h: 200 } })
const DUP = [frame('frame_dup', 'One', 0), frame('frame_dup', 'Two', 300)]
const MISSING = [frame('frame_one', 'One', 0), frame(undefined, 'No id', 300)]
const UNIQUE = [frame('frame_one', 'One', 0), frame('frame_two', 'Two', 300)]
const PROJECT = {
  schema: 'loop-revision/1',
  version: 1,
  projectId: 'proj_' + '0'.repeat(26),
  revisionId: 'rev_' + '1'.repeat(26),
  parentId: null,
  role: 'revision',
}
const text = (frames: unknown[], project?: unknown) =>
  JSON.stringify({ schema: 'loop-studio/graph/2', version: 1, layoutVersion: 1, nodes: [pool('a', 0, 3), source, pool('b', 400, 0)], edges: [edge], frames, ...(project ? { project } : {}) })

const tick = () => {
  const until = Date.now() + 3
  while (Date.now() < until) {
    /* the old id was time-based: let the clock move between reads */
  }
}
const liveIds = () => (useFrameStore.getState().frames as SavedFrame[]).map((f) => f.id)
const firstStep = () => {
  const g = useGraphStore.getState()
  return step(g.nodes, g.edges, initSim(g.nodes), 1, 2).state.values
}

describe('a repeated or missing frame id reads the same on every open (#619 item 4)', () => {
  beforeEach(() => {
    useGraphStore.getState().newGraph()
    useProjectStore.getState().clear()
  })

  it('opening one file twice gives the same frame ids, and the same first step', async () => {
    for (const frames of [DUP, MISSING]) {
      await importFile(text(frames))
      const first = { ids: liveIds(), run: firstStep() }
      tick()
      await importFile(text(frames))
      expect.soft(liveIds()).toEqual(first.ids)
      expect(firstStep()).toEqual(first.run)
    }
    expect(firstStep()).toEqual({ a: 3, b: 1 }) // the engine does not read frames
  })

  it('a revision file whose header has no content digest opens unchanged', async () => {
    const r = await routeImport(text(DUP, PROJECT))
    expect(r.kind).toBe('revision')
    useProjectStore.getState().refreshDirty() // `openRevisionFromFile` sets false; this compares
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('control: the same revision file with unique ids opens unchanged', async () => {
    await routeImport(text(UNIQUE, PROJECT))
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('a proposal read twice (each Review consumer reads it again) gives the same frame ids', () => {
    // `proposedGraph` reads only the proposal text and the routed version
    const p = { proposedText: text(DUP), modelVersion: 2 } as unknown as PendingProposal
    const a = proposedGraph(p).frames.map((f) => f.id)
    tick()
    expect(proposedGraph(p).frames.map((f) => f.id)).toEqual(a)
  })
})
