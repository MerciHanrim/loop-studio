import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useT } from '../../i18n'
import { ConfirmDialog } from '../ConfirmDialog'
import { useAnchoredPosition } from './useAnchoredPosition'
import type { ShareSurface as ShareSurfaceState } from './useShareSurface'

type Props = {
  surface: ShareSurfaceState
  /** whichever trigger is currently real — Share's own button when inline,
   *  the `…` trigger when collapsed — captured by `Toolbar.tsx` at the
   *  moment the flow opened. */
  anchorRef: RefObject<HTMLElement | null>
  returnFocusTo: () => HTMLElement | null | undefined
  onConfirm: () => void
  onCancel: () => void
  onRetryCopy: () => Promise<boolean>
  onClosePanel: () => void
}

// Toolbar-level host for Share's confirm→panel flow (review condition 3):
// `ShareButton` itself only ever calls `onOpenConfirm`, so this is the ONLY
// place `.share-pop` is rendered and the only place its interactions
// (outside-click close, Escape close, auto-select the URL, re-copy) live.
// Positioned with `useAnchoredPosition` since the panel's own `.menu`
// (`position: relative`) ancestor no longer exists once lifted here.
export function ShareSurface({
  surface,
  anchorRef,
  returnFocusTo,
  onConfirm,
  onCancel,
  onRetryCopy,
  onClosePanel,
}: Props) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const panelOpen = surface?.phase === 'panel'
  const pos = useAnchoredPosition(anchorRef, panelRef, panelOpen)

  useEffect(() => {
    if (!panelOpen) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClosePanel()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClosePanel()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [panelOpen, onClosePanel])

  useEffect(() => {
    if (panelOpen) urlRef.current?.select()
  }, [panelOpen])

  const retryCopy = () => {
    void onRetryCopy().then((ok) => {
      if (!ok) urlRef.current?.select()
    })
  }

  return (
    <>
      <ConfirmDialog
        open={surface?.phase === 'confirm'}
        title={t('share.disclosure.title')}
        body={t('share.disclosure.body')}
        confirmLabel={t('share.disclosure.confirm')}
        onConfirm={onConfirm}
        onCancel={onCancel}
        returnFocusTo={returnFocusTo}
      />

      {panelOpen && surface.phase === 'panel' ? (
        <div
          ref={panelRef}
          className="menu__pop share-pop"
          role="dialog"
          aria-label={t('share.panel.label')}
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="share-pop__status">
            {surface.copied ? t('share.panel.copied') : t('share.panel.copyThis')}
          </div>
          <input
            ref={urlRef}
            className="share-pop__url"
            type="text"
            readOnly
            value={surface.url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="share-pop__row">
            <button type="button" className="btn btn--sm" onClick={retryCopy}>
              {surface.copied ? t('share.panel.copyAgain') : t('share.panel.copy')}
            </button>
            <button type="button" className="btn btn--sm" onClick={onClosePanel}>
              {t('share.panel.close')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
