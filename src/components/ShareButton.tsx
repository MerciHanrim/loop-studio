import { useEffect, useRef, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { prepareShareLink, shareKb } from '../ui/shareAction'
import { useT } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'

type Panel = { url: string; copied: boolean }

/**
 * SEMANTICS-U.md §U7 — a standalone `Share` button. On click: a one-time
 * disclosure (§U4), now an in-app ConfirmDialog (docs/localization.md Slice 2b).
 * NOTHING happens until Confirm: no diagram export, no link build, no clipboard
 * write, no address-bar change — Cancel / Escape / backdrop leave everything
 * untouched. On Confirm (inside its click event, so the clipboard write keeps
 * user activation): the §U3.1 size check (over `SHARE_MAX_BYTES` ⇒ hard reject),
 * then copy the link and show it in a selectable field. Never mutates `location`.
 */
export function ShareButton() {
  const t = useT()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const exportJSON = useGraphStore((s) => s.exportJSON)

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

  // Confirm click — the ONLY place a side effect starts. `busy` blocks a
  // double-click from running the export/clipboard twice.
  const runShare = async () => {
    setConfirming(false)
    if (busy) return
    setBusy(true)
    try {
      const doc = exportJSON({ ...useMcStore.getState().config })
      const result = await prepareShareLink(doc)

      if (result.status === 'too-large') {
        window.alert(t('share.tooLarge', { size: shareKb(result.bytes), cap: shareKb(result.cap) }))
        return
      }
      if (result.status === 'no-base') {
        window.alert(t('share.noBase'))
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
        ref={btnRef}
        type="button"
        className="btn"
        onClick={() => {
          setPanel(null)
          setConfirming(true)
        }}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={panel != null || confirming}
        title={t('share.button.title')}
      >
        {t('share.button')}
      </button>

      <ConfirmDialog
        open={confirming}
        title={t('share.disclosure.title')}
        body={t('share.disclosure.body')}
        confirmLabel={t('share.disclosure.confirm')}
        onConfirm={runShare}
        onCancel={() => setConfirming(false)}
        returnFocusTo={() => btnRef.current}
      />

      {panel ? (
        <div className="menu__pop share-pop" role="dialog" aria-label={t('share.panel.label')}>
          <div className="share-pop__status">
            {panel.copied ? t('share.panel.copied') : t('share.panel.copyThis')}
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
              {panel.copied ? t('share.panel.copyAgain') : t('share.panel.copy')}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setPanel(null)}>
              {t('share.panel.close')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
