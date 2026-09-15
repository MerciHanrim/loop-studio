import { useT } from '../i18n'

/**
 * SEMANTICS-U.md §U7 — a standalone `Share` button. Its confirm→panel flow
 * (the disclosure, link generation, clipboard write, and the copied-link
 * panel) is lifted to `Toolbar.tsx`'s `useShareSurface` + `ShareSurface`
 * (review condition 3) so it survives Share's own group or the `…` overflow
 * menu closing around it — this component only ever renders the trigger and
 * forwards a click to `onOpenConfirm`.
 */
export function ShareButton({
  buttonRef,
  onOpenConfirm,
  busy,
  active,
}: {
  buttonRef?: (el: HTMLButtonElement | null) => void
  onOpenConfirm: () => void
  busy: boolean
  active: boolean
}) {
  const t = useT()

  return (
    <button
      ref={buttonRef}
      type="button"
      className="btn"
      onClick={onOpenConfirm}
      disabled={busy}
      aria-haspopup="dialog"
      aria-expanded={active}
      title={t('share.button.title')}
    >
      {t('share.button')}
    </button>
  )
}
