import { useEffect, useRef, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { t } from '../i18n'

// docs/simulation-playback.md Slice 3c — a polite live region so a screen reader
// can follow the run without watching the canvas.
//
//   • authoritative state changes (play / pause / end / reset) announce
//     immediately and always carry the committed step;
//   • plain step progress announces `Step N`, throttled to one message per
//     ANNOUNCE_MIN_MS — during a fast Play the deferred message is LATEST-WINS
//     (it reads the current committed step when it fires, not a stale one);
//   • the deferred message is bound to a generation `(simulationRev, stepFloor)`
//     so Reset / Import / Undo / Redo / a graph edit / a Workspace load / a
//     scrub / end all cancel any queued `Step N` before it can speak;
//   • a Step press flips `idle → paused` as an internal side effect — that is
//     reported as `Step N`, never `Paused`. Only the user's Pause button
//     produces a `Paused` message. Speed / zoom / selection produce nothing.
//
// Read-only over the state machine: it subscribes to `status` / `stepIndex` and
// the graph's `simulationRev`, and never calls into the store.
const ANNOUNCE_MIN_MS = 900

type Gen = { simulationRev: number; stepFloor: number }

export function PlaybackAnnouncer() {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const simulationRev = useGraphStore((s) => s.simulationRev)

  const [message, setMessage] = useState('')
  const prev = useRef({ status, stepIndex, simulationRev })
  const lastAt = useRef(0)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; gen: Gen } | null>(null)

  useEffect(() => {
    const cancelPending = () => {
      if (pending.current) {
        clearTimeout(pending.current.timer)
        pending.current = null
      }
    }
    // fire a deferred (throttled) step announcement — latest-wins, and only if
    // its generation is still current
    const flushDeferred = (gen: Gen) => {
      pending.current = null
      const s = useSimStore.getState()
      const rev = useGraphStore.getState().simulationRev
      if (rev !== gen.simulationRev) return // the document changed
      if (s.stepIndex < gen.stepFloor) return // rewound (Reset / scrub)
      if (s.status === 'idle' || s.status === 'ended') return // superseded
      lastAt.current = Date.now()
      setMessage(t('a11y.playback.stepN', { n: s.stepIndex }))
    }

    const p = prev.current
    const now = Date.now()

    if (status !== p.status) {
      // authoritative — always immediate, always cancels a queued step message
      cancelPending()
      const stepped = stepIndex > p.stepIndex
      setMessage(
        status === 'running'
          ? t('a11y.playback.started')
          : status === 'ended'
            ? t('a11y.playback.endedAtStep', { n: stepIndex })
            : status === 'idle'
              ? t('a11y.playback.resetToZero')
              : stepped
                ? t('a11y.playback.stepN', { n: stepIndex }) // a Step press, not a user Pause
                : t('a11y.playback.pausedAtStep', { n: stepIndex }),
      )
      lastAt.current = now
    } else if (simulationRev === p.simulationRev && stepIndex === p.stepIndex + 1) {
      // single-step progress within one document: Step press or a Play tick
      if (now - lastAt.current >= ANNOUNCE_MIN_MS) {
        cancelPending()
        lastAt.current = now
        setMessage(t('a11y.playback.stepN', { n: stepIndex }))
      } else if (!pending.current) {
        // inside the throttle window — schedule ONE latest-wins announcement
        const gen: Gen = { simulationRev, stepFloor: stepIndex }
        const delay = ANNOUNCE_MIN_MS - (now - lastAt.current)
        pending.current = { gen, timer: setTimeout(() => flushDeferred(gen), delay) }
      }
      // a timer already pending will pick up the newest step when it fires
    } else if (stepIndex !== p.stepIndex || simulationRev !== p.simulationRev) {
      // a jump, a rewind, or a document change ⇒ kill any queued step message
      cancelPending()
    }

    prev.current = { status, stepIndex, simulationRev }
  }, [status, stepIndex, simulationRev])

  // safety: drop any pending timer if this (single, app-lifetime) region ever
  // unmounts
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer)
    },
    [],
  )

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-playback-announce>
      {message}
    </div>
  )
}
