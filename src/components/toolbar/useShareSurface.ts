import { useRef, useState } from 'react'
import { useGraphStore } from '../../store/graphStore'
import { recommendedRunConfigForExport } from '../../store/mcStore'
import { type ProtectedShareLinkResult, copyShareLink, prepareProtectedShareLink, prepareShareLink, shareKb } from '../../ui/shareAction'
import { useT } from '../../i18n'

export type ShareSurface =
  | { phase: 'confirm' }
  /** `protected` - the link is a `p1` link: the panel reminds to send the password separately */
  | { phase: 'panel'; url: string; copied: boolean; protected?: boolean }
  | null

/** Share's entire confirm→panel flow, lifted to Toolbar-level (review
 *  condition 3) so it survives File/Data/Share/`…` closing around it — the
 *  same reason `ShareButton` itself no longer owns any of this. `busy`
 *  moving here too is what stops a rapid double-click on the (now
 *  Toolbar-owned) Confirm button from double-running `prepareShareLink` +
 *  the clipboard write. SEMANTICS-U.md §U7 / §U3.1 still hold: nothing
 *  (link generation, clipboard write) happens before Confirm, and it
 *  happens only from inside `confirm()`, called from the Confirm button's
 *  own click event so the clipboard write keeps user activation. */
export function useShareSurface() {
  const t = useT()
  const [surface, setSurface] = useState<ShareSurface>(null)
  const [busy, setBusy] = useState(false)
  // a plain ref, not the `busy` state above: two clicks handled in the same
  // synchronous tick (a genuine rapid double-click) both close over the SAME
  // render's `busy` value, since `setBusy(true)` from the first click doesn't
  // update that closure's `busy` before the second click's own guard check
  // runs — only a ref mutates synchronously in time for the second call to
  // see it. `busy` state stays for UI (disabling the Share trigger).
  const busyRef = useRef(false)
  const exportJSON = useGraphStore((s) => s.exportJSON)

  const openConfirm = () => setSurface({ phase: 'confirm' })
  const cancel = () => setSurface(null)

  const confirm = async () => {
    setSurface(null)
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const doc = exportJSON(recommendedRunConfigForExport())
      const result = await prepareShareLink(doc)

      if (result.status === 'too-large') {
        window.alert(t('share.tooLarge', { size: shareKb(result.bytes), cap: shareKb(result.cap) }))
        return
      }
      if (result.status === 'no-base') {
        window.alert(t('share.noBase'))
        return
      }
      if (result.status === 'no-compression') {
        window.alert(t('share.unavailable'))
        return
      }

      const url = result.url
      // Clipboard API missing or denied ⇒ false: the field below is the fallback
      const copied = await copyShareLink(url)
      setSurface({ phase: 'panel', url, copied })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** Issue #300 — the protected link. The dialog stays open while the key is
   *  derived and shows anything but `ok` itself (over the cap, no public
   *  address, no Web Crypto), so nothing is alerted from here. On `ok` the
   *  LINK is copied - never the password - and the panel opens. */
  const confirmProtected = async (password: string): Promise<ProtectedShareLinkResult> => {
    if (busyRef.current) return { status: 'unavailable' }
    busyRef.current = true
    setBusy(true)
    try {
      const result = await prepareProtectedShareLink(exportJSON(recommendedRunConfigForExport()), password)
      if (result.status !== 'ok') return result
      const copied = await copyShareLink(result.url)
      setSurface({ phase: 'panel', url: result.url, copied, protected: true })
      return result
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const retryCopy = async (): Promise<boolean> => {
    if (surface?.phase !== 'panel') return false
    const ok = await copyShareLink(surface.url)
    if (ok) setSurface({ ...surface, copied: true })
    return ok
  }

  const closePanel = () => setSurface(null)

  return { surface, busy, openConfirm, cancel, confirm, confirmProtected, retryCopy, closePanel }
}
