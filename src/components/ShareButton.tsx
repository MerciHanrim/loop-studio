import { useEffect, useRef, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { SHARE_DISCLOSURE, prepareShareLink, shareKb } from '../ui/shareAction'

type Panel = { url: string; copied: boolean }

/**
 * SEMANTICS-U.md §U7 — a standalone `Share` button. On click: a one-time
 * disclosure (§U4), then the §U3.1 size check (over `SHARE_MAX_BYTES` ⇒ hard
 * reject: no clipboard write, no address-bar change), then copy the link and
 * show it in a selectable field (the fallback when the Clipboard API is
 * unavailable or denied — the URL is always shown so it can be copied by hand).
 * Never mutates `location`.
 */
export function ShareButton() {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const exportJSON = useGraphStore((s) => s.exportJSON)
  const kb = shareKb

  useEffect(() => {
    if (!panel) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPanel(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [panel])

  useEffect(() => {
    if (panel) urlRef.current?.select()
  }, [panel])

  const onShare = async () => {
    if (busy) return
    setPanel(null)
    if (!window.confirm(SHARE_DISCLOSURE)) return // §U4 — cancel: nothing happens

    setBusy(true)
    try {
      const doc = exportJSON({ ...useMcStore.getState().config })
      const result = await prepareShareLink(doc)

      if (result.status === 'too-large') {
        // §U3.1 hard reject — no clipboard write, no address-bar change
        window.alert(
          `This diagram is too large for a share link (${kb(result.bytes)}; limit ${kb(result.cap)}). ` +
            `Use Export ▾ → Graph JSON and share the file instead.`,
        )
        return
      }

      if (result.status === 'no-base') {
        window.alert(
          'Share is not configured with a public address, so a link cannot be created. Please report this.',
        )
        return
      }

      const url = result.url
      let copied = false
      try {
        await navigator.clipboard.writeText(url)
        copied = true
      } catch {
        copied = false // Clipboard API missing or denied — the field below is the fallback
      }
      setPanel({ url, copied })
    } finally {
      setBusy(false)
    }
  }

  const retryCopy = async () => {
    if (!panel) return
    try {
      await navigator.clipboard.writeText(panel.url)
      setPanel({ ...panel, copied: true })
    } catch {
      urlRef.current?.select()
    }
  }

  return (
    <div className="menu" ref={wrapRef}>
      <button
        type="button"
        className="btn"
        onClick={onShare}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={panel != null}
        title="Copy a link that opens this diagram"
      >
        Share
      </button>
      {panel ? (
        <div className="menu__pop share-pop" role="dialog" aria-label="Share link">
          <div className="share-pop__status">
            {panel.copied ? 'Link copied to the clipboard.' : 'Copy this link:'}
          </div>
          <input
            ref={urlRef}
            className="share-pop__url"
            type="text"
            readOnly
            value={panel.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="share-pop__row">
            <button type="button" className="btn btn--sm" onClick={retryCopy}>
              {panel.copied ? 'Copy again' : 'Copy'}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
