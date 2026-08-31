import { useEffect, useRef, useState } from 'react'
import { useSimStore } from '../store/simStore'

// docs/simulation-playback.md Slice 3c — a polite live region so a screen reader
// can follow the run without watching the canvas. Status changes (play / pause /
// end / reset) announce immediately; plain step progress is throttled to at most
// one message per ANNOUNCE_MIN_MS so a fast Play does not flood the buffer.
// Read-only: it subscribes to `status` / `stepIndex` and never touches the store
// or the choreography.
const ANNOUNCE_MIN_MS = 900

export function PlaybackAnnouncer() {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)

  const [message, setMessage] = useState('')
  const prevStatus = useRef(status)
  const prevStep = useRef(stepIndex)
  const lastAt = useRef(0)

  useEffect(() => {
    const now = Date.now()

    if (status !== prevStatus.current) {
      const stepped = stepIndex > prevStep.current
      const msg =
        status === 'running'
          ? 'Playback started'
          : status === 'ended'
            ? `Run ended at step ${stepIndex}`
            : status === 'idle'
              ? 'Run reset to step 0'
              : // 'paused' — a Step press flips idle→paused as a side effect; that
                // is step progress, not a pause the user asked for
                stepped
                ? `Step ${stepIndex}`
                : `Playback paused at step ${stepIndex}`
      prevStatus.current = status
      prevStep.current = stepIndex
      lastAt.current = now
      setMessage(msg)
      return
    }

    if (stepIndex !== prevStep.current && stepIndex > 0) {
      prevStep.current = stepIndex
      const throttled = status === 'running' && now - lastAt.current < ANNOUNCE_MIN_MS
      if (!throttled) {
        lastAt.current = now
        setMessage(`Step ${stepIndex}`)
      }
    }
  }, [status, stepIndex])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-playback-announce>
      {message}
    </div>
  )
}
