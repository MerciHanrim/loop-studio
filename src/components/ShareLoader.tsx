import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { consumeShareLink } from '../store/shareLink'

/**
 * Consumes a `#g1=` share link once, on mount (SEMANTICS-U.md §U5). Renders
 * nothing. Must live inside the React Flow provider so a successful load can
 * re-fit the view to the shared graph.
 */
export function ShareLoader() {
  const { fitView } = useReactFlow()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // StrictMode double-invoke / any re-mount
    ran.current = true
    void consumeShareLink().then((outcome) => {
      if (outcome.kind === 'loaded') {
        fitView({ padding: 0.3, maxZoom: 1.2, duration: 0 })
      }
    })
  }, [fitView])

  return null
}
