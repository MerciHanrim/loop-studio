import { useEffect, useRef } from 'react'
import { useGraphStore } from '../store/graphStore'
import { consumeShareLink } from '../store/shareLink'
import { useTourStore } from '../store/tourStore'

/**
 * Consumes a `#g1=` share link once, on mount (SEMANTICS-U.md §U5). Renders
 * nothing. A successful load asks the Canvas for its fit of the shared graph
 * (issue #616 item 3): the app's fit (useFitAll), which counts the names outside
 * the nodes, once React Flow has measured them. It used to call React Flow's own
 * `fitView`, which knows only the node boxes, so a name on the outer side could
 * be cut until Reset view.
 */
export function ShareLoader() {
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // StrictMode double-invoke / any re-mount
    ran.current = true
    void consumeShareLink().then((outcome) => {
      if (outcome.kind === 'loaded') useGraphStore.getState().requestFit()
      // docs/guided-tour.md §GT6.1 — the boot sequence (incl. a `#g1=` restore)
      // has settled; the first-run Welcome card may now be considered.
      useTourStore.getState().markAppSettled()
    })
  }, [])

  return null
}
