// #625 item 5 (Lumi, 2026-11-28) — a dialog of `useDialogFocus`'s own, mounted in the page by a test
// (imported through the dev server, as other specs import `/src` modules), for a case no app dialog
// reaches today: the owner re-renders while the dialog is open and passes a different
// `returnFocusTo`. Every app caller's `returnFocusTo` reads a ref or the page when called, so their
// focus lands the same whichever callback is used.
//
// Three buttons stand outside the dialog: the opener (a click opens the dialog), A and B.
// `returnFocusTo` names A until the host receives a `dfh-retarget` event, then B. Escape closes.

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useDialogFocus } from '../../src/components/useDialogFocus'

export function mountDialogFocusHarness(host: HTMLElement): { unmount: () => void } {
  function Harness() {
    const [open, setOpen] = useState(false)
    const [target, setTarget] = useState<'a' | 'b'>('a')
    const ref = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      const retarget = () => setTarget('b')
      host.addEventListener('dfh-retarget', retarget)
      return () => host.removeEventListener('dfh-retarget', retarget)
    }, [])
    const returnFocusTo = target === 'a' ? () => document.getElementById('dfh-a') : () => document.getElementById('dfh-b')
    useDialogFocus(open, ref, () => setOpen(false), returnFocusTo)
    return (
      <div data-dialog-focus-harness="">
        <button id="dfh-opener" type="button" onClick={() => setOpen(true)}>
          opener
        </button>
        <button id="dfh-a" type="button">
          A
        </button>
        <button id="dfh-b" type="button">
          B
        </button>
        {open ? (
          <div ref={ref} role="dialog" aria-label="harness" id="dfh-dialog">
            <button id="dfh-inside" type="button">
              inside
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  const root = createRoot(host)
  root.render(<Harness />)
  return { unmount: () => root.unmount() }
}
