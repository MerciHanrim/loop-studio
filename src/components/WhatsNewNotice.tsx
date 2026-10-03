import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { selectUpdateReady, usePwaStore } from '../store/pwaStore'
import { useUiStore } from '../store/uiStore'
import { useWhatsNewStore } from '../store/whatsNewStore'
import { useIsMobile } from '../ui/media'
import { WhatsNewPanel } from './WhatsNewPanel'

// Issue #296 — the one-line update notice.
//
// A profile that was used before sees it once, on the first launch after an
// update: one sentence naming the version, a button that opens the What's new
// panel, and a button that closes it. It never changes the document, the run or
// the selection, it does not take focus, and it does not time out.
//
// WHERE. Desktop: the inline-start top corner of the canvas, so it mirrors in a
// right-to-left layout. Mobile: the PHYSICAL right, just above the run bar, in
// right-to-left too, because the canvas zoom controls stay on the left there.
// Both were measured against every other candidate: no control is covered and
// no element moves.
//
// PRIORITY, instead of moving the card around. Something that needs the same
// space, or that the person asked for, comes first:
//   - the PWA update bar: one automatic notice at a time
//   - an open filter panel (desktop): it uses the same corner
//   - a running tour, and the notes that follow a deliberate action (`blocked`)
// While any of those is up the notice WAITS; if it was already showing it steps
// aside and comes back afterwards, saying nothing again. The canvas's own
// discovery hints wait the other way round, while this notice is showing.
//
// `announced` is recorded when the notice is really rendered (the store does
// that on the first `setNoticeShowing(true)`). A notice that is still waiting
// has announced nothing and will be offered again on the next launch.
//
// FOCUS. Only two things move it:
//   - the person closes the notice or the panel while focus is inside it: focus
//     goes to the Help button (the More button on mobile), where the `New`
//     marker is
//   - the notice steps aside while focus is inside it: the same target, so
//     focus does not fall to the page. If another element already holds focus,
//     for instance the filter button that was just pressed, it stays there.

/** the Help trigger; when the toolbar has folded Help into the overflow menu,
 *  that menu's button; on mobile the More button */
function focusFallback(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-tour="help-trigger"]') ??
    document.querySelector<HTMLElement>('.toolbar__overflow-btn') ??
    document.querySelector<HTMLElement>('[data-tour="mobile-more"]')
  )
}

type Props = {
  /** something with priority is using the canvas: a running tour, or a note
   *  that follows a deliberate action */
  blocked: boolean
}

export function WhatsNewNotice({ blocked }: Props) {
  const t = useT()
  const note = useWhatsNewStore((s) => s.note)
  const pending = useWhatsNewStore((s) => s.noticePending)
  const setNoticeShowing = useWhatsNewStore((s) => s.setNoticeShowing)
  const dismissNotice = useWhatsNewStore((s) => s.dismissNotice)
  const filterPanelOpen = useUiStore((s) => s.filterPanelOpen)
  const updateBar = usePwaStore(selectUpdateReady)
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(false)
  const [said, setSaid] = useState('')
  const noticeRef = useRef<HTMLElement>(null)
  const focusInside = useRef(false)
  const wasVisible = useRef(false)

  // the filter panel is a desktop panel; on mobile filters are a sheet, which
  // covers the notice by itself
  const visible = pending && note !== null && !updateBar && !(filterPanelOpen && !isMobile) && !blocked

  useEffect(() => {
    setNoticeShowing(visible)
    return () => setNoticeShowing(false)
  }, [visible, setNoticeShowing])

  // stepping aside with focus inside: hand focus to a real control instead of
  // letting it fall to the page. `pending` is still true here; a close by the
  // person clears it and is handled where it happens.
  useEffect(() => {
    if (wasVisible.current && !visible && pending && focusInside.current) {
      const active = document.activeElement
      if (!active || active === document.body) focusFallback()?.focus()
    }
    if (!visible) focusInside.current = false
    wasVisible.current = visible
  }, [visible, pending])

  // Mobile: the card sits just above the fixed run bar. The bar's height is not
  // a constant - at 320px it wraps to two rows, and an init error adds one - so
  // the offset is measured, not read from the reserved-height variable.
  useLayoutEffect(() => {
    const el = noticeRef.current
    if (!el) return
    if (!isMobile) {
      el.style.bottom = ''
      return
    }
    const canvas = el.closest('.canvas')
    const bar = document.querySelector('.pstrip--mobile')
    if (!canvas || !bar) return
    const place = () => {
      const c = canvas.getBoundingClientRect()
      const b = bar.getBoundingClientRect()
      const at = canvas.querySelector('.react-flow__attribution')?.getBoundingClientRect()
      // stay above the attribution line too, when it is visible above the bar
      const top = at && at.bottom <= b.top + 1 ? Math.min(at.top, b.top) : b.top
      el.style.bottom = Math.max(0, c.bottom - top) + 8 + 'px'
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(bar)
    ro.observe(canvas)
    window.addEventListener('resize', place)
    const late = window.setTimeout(place, 400) // the attribution mounts with React Flow
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      window.clearTimeout(late)
    }
  }, [isMobile, visible])

  // The announcement is a separate, short, polite sentence, written ONCE, the
  // first time the notice is really on screen. The card itself is a named
  // region, not a live one, and a notice that steps aside and comes back says
  // nothing again. A timer, cleared on cleanup: under StrictMode's double mount
  // the first is cancelled and only the second writes.
  const sentence = note ? t('whatsNew.notice.text', { version: note.version }) : ''
  useEffect(() => {
    if (!visible || said) return
    const id = window.setTimeout(() => setSaid(sentence), 400)
    return () => window.clearTimeout(id)
    // the language at the moment it first shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, said])

  const close = () => {
    // the person closed it: if focus was inside, hand it to a real control
    const hadFocus = noticeRef.current?.contains(document.activeElement) ?? false
    dismissNotice()
    if (hadFocus) focusFallback()?.focus()
  }
  const openPanel = () => {
    dismissNotice()
    setPanelOpen(true)
  }
  // stable, because the dialog's focus effect re-runs when its `onEscape` changes
  const closePanel = useCallback(() => setPanelOpen(false), [])

  return (
    <>
      <div className="sr-only" aria-live="polite" data-whatsnew="live">
        {said}
      </div>
      {visible ? (
        <section
          ref={noticeRef}
          className="whatsnew-notice"
          aria-label={t('whatsNew.notice.region')}
          data-whatsnew="notice"
          onFocus={() => (focusInside.current = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInside.current = false
          }}
        >
          <p className="whatsnew-notice__text">{sentence}</p>
          <span className="whatsnew-notice__actions">
            <button type="button" className="btn btn--sm" onClick={openPanel}>
              {t('whatsNew.notice.open')}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={close}>
              {t('dialog.close')}
            </button>
          </span>
        </section>
      ) : null}
      <WhatsNewPanel open={panelOpen} onClose={closePanel} returnFocusTo={focusFallback} />
    </>
  )
}
