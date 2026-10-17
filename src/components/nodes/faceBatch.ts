import type { useStoreApi } from '@xyflow/react'

/**
 * The face handles' measurement when a connection drag begins or ends.
 *
 * Every node mounts its face handles while a connection is dragged (so the
 * drop can choose a face, `nodes.tsx` `facesOn`) and unmounts the unused ones
 * when it ends. A mount or unmount without a size change is invisible to React
 * Flow's ResizeObserver, so the handles' bounds must be measured again; done
 * one node at a time, that was one React Flow store update per node, each run
 * through every store subscriber, and it made the start and the end of a drag
 * on a large diagram slow (share note 58: the 63-node gacha banner Template).
 *
 * So the measurement requests of the nodes' layout effects are merged into ONE
 * `updateNodeInternals` call holding every node on the canvas:
 *  - a drag's start: the first request measures every node at once (its new
 *    handles are in the DOM, nothing is painted yet, and React Flow's edges —
 *    which reach its store in a passive effect — have not caught up: the moment
 *    each node measured itself in before); every later request of the same drag
 *    is answered by it;
 *  - a drag's end: every node is measured on the next animation frame. The end
 *    only removes handles (every face was mounted during the drag), and a
 *    removal is measured late, as a node's own removal is (a store update in
 *    the layout effect would run React Flow's edge selectors of the previous
 *    render, which still look for the removed handle — React Flow error 008,
 *    share note 53). The end is taken from React Flow's own connection state
 *    (`connection.inProgress` going false) as well as from the nodes, so a drag
 *    is over even when no node saw it end (every node gone during the drag: its
 *    insert undone, the node structure switched) and the next drag's start is
 *    measured;
 *  - a start cancels an end's frame that has not run yet. A frame is not
 *    cancelled when the canvas goes away: it runs, reads the store and the DOM
 *    then, and finds no canvas (React Flow resets its store on unmount, so
 *    `domNode` is empty) — it measures nothing.
 * Every other change of a node's mounted faces (a selection, a keyboard focus,
 * a document change) is measured by that node alone, as before.
 *
 * The state is each canvas's. `useStoreApi()` hands every component its own
 * wrapper object (`{ getState, setState, subscribe }`, memoized per hook
 * call), so the wrapper cannot be the key — keyed by it, every node had its
 * own state and nothing was merged (share note 58). The key is the store's own
 * `getState`, the same function in every wrapper of one canvas.
 */
type RfStore = Pick<ReturnType<typeof useStoreApi>, 'getState' | 'subscribe'>
type Batch = { on: boolean; frame: number }

const batches = new WeakMap<RfStore['getState'], Batch>()

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

/** the drag is over: one measurement of every node on the next frame */
function endDrag(rfStore: RfStore, b: Batch): void {
  if (!b.on) return
  b.on = false
  cancelAnimationFrame(b.frame)
  b.frame = requestAnimationFrame(() => {
    b.frame = 0
    measureAll(rfStore)
  })
}

function batchOf(rfStore: RfStore): Batch {
  const known = batches.get(rfStore.getState)
  if (known) return known
  const b: Batch = { on: false, frame: 0 }
  batches.set(rfStore.getState, b)
  // the end of a drag as React Flow has it, whether or not a node saw it
  rfStore.subscribe((s, prev) => {
    if (prev.connection.inProgress && !s.connection.inProgress) endDrag(rfStore, b)
  })
  return b
}

/** a node's layout effect saw the drag state become `connecting` */
export function measureFacesForDrag(rfStore: RfStore, connecting: boolean): void {
  const b = batchOf(rfStore)
  if (!connecting) {
    endDrag(rfStore, b)
    return
  }
  // a request of a drag already measured: answered by that measurement
  if (b.on) return
  b.on = true
  cancelAnimationFrame(b.frame)
  b.frame = 0
  measureAll(rfStore)
}
