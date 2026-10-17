import type { useStoreApi } from '@xyflow/react'

/**
 * The face handles' measurement when a connection drag begins or ends.
 *
 * Every node mounts its face handles while a connection is dragged (so the
 * drop can choose a face, `nodes.tsx` `facesOn`) and unmounts the unused ones
 * when it ends — every node, in the same commit. A mount or unmount without a
 * size change is invisible to React Flow's ResizeObserver, so the handles'
 * bounds must be measured again; done one node at a time, that was one React
 * Flow store update per node, each run through every store subscriber, and it
 * made the start and the end of a drag on a large diagram slow (share note 58:
 * the 63-node gacha banner Template).
 *
 * So the first node whose layout effect sees the drag state change measures
 * EVERY node in one `updateNodeInternals` call, and the others skip:
 *  - at the start, at once: React applies the whole commit's DOM changes before
 *    any layout effect runs, so every node's new handles are in the DOM,
 *    nothing is painted yet, and React Flow's edges (which reach its store in a
 *    passive effect) have not caught up — the moment each node measured itself
 *    in before;
 *  - at the end, on the next animation frame: the end only removes handles
 *    (every face was mounted during the drag), and a removal is measured late,
 *    as a node's own removal is (a store update in this layout effect would run
 *    React Flow's edge selectors of the previous render, which still look for
 *    the removed handle — React Flow error 008, share note 53);
 *  - a start cancels an end's measurement that is still waiting, so it never
 *    lands on the next drag.
 * Every other change of a node's mounted faces (a selection, a keyboard focus,
 * a document change) is measured by that node alone, as before.
 *
 * One canvas exists, so the state is the module's.
 */
type RfStore = Pick<ReturnType<typeof useStoreApi>, 'getState'>

const state = { on: false, frame: 0 }

/** measure every node's handles in ONE React Flow update */
function measureAll(rfStore: RfStore): void {
  const { domNode, updateNodeInternals } = rfStore.getState()
  const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>()
  domNode?.querySelectorAll<HTMLDivElement>('.react-flow__node').forEach((el) => {
    const id = el.dataset.id
    if (id) updates.set(id, { id, nodeElement: el, force: true })
  })
  if (updates.size) updateNodeInternals(updates, { triggerFitView: false })
}

/** a node's layout effect saw the drag state become `connecting` in this commit */
export function measureFacesForDrag(rfStore: RfStore, connecting: boolean): void {
  // the first node of the commit acts; the others find it done
  if (connecting === state.on) return
  state.on = connecting
  cancelAnimationFrame(state.frame)
  state.frame = 0
  if (connecting) measureAll(rfStore)
  else
    state.frame = requestAnimationFrame(() => {
      state.frame = 0
      measureAll(rfStore)
    })
}

/** tests only: back to no drag, nothing waiting */
export function __resetFaceBatchForTests(): void {
  if (state.frame) cancelAnimationFrame(state.frame)
  state.on = false
  state.frame = 0
}
