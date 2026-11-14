import { useCallback, useEffect, useRef, useState } from 'react'
import { MENU_GAME_TEMPLATES, MENU_TEMPLATES, MENU_TOP_TEMPLATES, TEMPLATES } from '../model/templates'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'
import { openTemplate } from '../i18n/templateLabels'
import { ConfirmDialog } from './ConfirmDialog'
import { TEMPLATE_KEY } from './templateKeys'
import { DescribedRow } from './toolbar/DescribedMenu'
import { useMenuOpenStore } from './toolbar/menuOpenStore'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'
import { useMenuKeyboard, useMenuTrigger } from '../ui/useMenuKeyboard'
import { Icon } from '../ui/icons'

// Replacing the current diagram is confirmed through the shared in-app dialog —
// `loadGraph` runs only from Confirm (docs/localization.md Slice 2b).

/** open a bundled Template: the Templates menu's action, and (the workbench,
 *  2026-10) the File menu's Templates section's */
export function loadTemplate(id: string): void {
  const tpl = TEMPLATES.find((x) => x.id === id)
  if (!tpl) return
  useSimStore.getState().pause() // stop any run before the swap
  // docs/template-label-overlay.md — a deep clone with the current locale's
  // node-label + frame-title overlay; the canonical TEMPLATES[i] is never touched.
  const { graph, recommendedRunConfig, modelVersion, kinds, time, timetables, phases } = openTemplate(tpl)
  // §MML3 — a Template may frame a sub-region on menu-open instead of fit-all.
  // §TLO12 — and may carry group `frames` (undefined ⇒ frameStore cleared, as before).
  // #334 — a document boundary: the history starts empty, and the Template's
  // own lock is part of the swap (applyRecommended then finds it already set)
  useGraphStore.getState().loadGraph(graph, {
    canvasLocked: recommendedRunConfig?.canvasLocked === true,
    modelVersion,
    initialView: tpl.initialView ?? null,
    frames: graph.frames,
    // loop-model/3 and /4 — the Template's kinds table and step length
    kinds,
    time,
    timetables, // loop-model/5
    phases, // docs/run-phases.md
  }) // sim resets off structureRev
  useMcStore.getState().applyRecommended(recommendedRunConfig)
}

/** #545 — while the Templates submenu shows its Games group, the way back to the Templates:
 *  File's submenu keyboard (FileMenu.tsx) calls it first on Escape and Arrow Left, and it
 *  returns true when it went back (so the submenu stays open); null while the Templates show */
export const templateMenuBack: { current: (() => boolean) | null } = { current: null }

const focusRow = (sel: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`.dmenu--sub ${sel}`)?.focus())

/** the rows of the workbench's File ▸ Templates submenu: one per listed
 *  Template, its name; its description shows in the submenu's description
 *  area (docs/workbench.md §WB2.2). `onPick` decides whether to confirm first
 *  (the caller owns the dialog, which must outlive the menu).
 *
 *  #545 (Hanrim / Lumi, 2026-11-10) — the game examples are a group: a "Games ›" row after
 *  the process and industry Templates turns the submenu's rows into the game Templates, under
 *  a "‹ Templates" row that turns them back, as the phone's Templates sheet does. Click,
 *  Enter, Space or Arrow Right on "Games" go in, focus on the first game; the back row,
 *  Escape or Arrow Left go back, focus on "Games". */
export function TemplateMenuItems({ onPick }: { onPick: (id: string) => void }) {
  const t = useT()
  const open = t('workbench.file.open')
  const [games, setGames] = useState(false)
  // the row chosen is replaced either way, so focus moves with it, by key or by pointer:
  // in, to the first game; back, to "Games". Left on a row that is gone, focus would drop
  // to the page, and the submenu's keys (Escape back, the arrows) would stop answering
  const enter = () => {
    setGames(true)
    focusRow(`[data-template="${MENU_GAME_TEMPLATES[0]?.id}"]`)
  }
  const back = () => {
    setGames(false)
    focusRow('[data-template-group="games"]')
  }
  useEffect(() => {
    if (!games) return
    templateMenuBack.current = () => {
      back()
      return true
    }
    return () => {
      templateMenuBack.current = null
    }
  }, [games])
  const row = (tpl: (typeof MENU_TEMPLATES)[number]) => (
    <DescribedRow
      key={tpl.id}
      name={t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].name)}
      description={t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].blurb)}
      action={open}
      onSelect={() => onPick(tpl.id)}
      attrs={{ 'data-template': tpl.id }}
    />
  )
  // the layout's side, pinned ltr (see LanguageSwitch.tsx), as File's own submenu rows
  const chev = (c: string) => (
    <span className="dmenu__chev" aria-hidden="true" dir="ltr">
      {c}
    </span>
  )
  if (games) {
    return (
      <>
        <DescribedRow
          key="back"
          name={t('workbench.menu.templates')}
          onSelect={back}
          attrs={{ 'data-template-back': 'true' }}
          lead={chev('‹')}
        />
        <div className="menu__divider" role="separator" />
        {MENU_GAME_TEMPLATES.map(row)}
      </>
    )
  }
  return (
    <>
      {MENU_TOP_TEMPLATES.map(row)}
      {MENU_GAME_TEMPLATES.length > 0 ? (
        <>
          <div className="menu__divider" role="separator" />
          <DescribedRow
            key="games"
            name={t('templates.group.games')}
            description={t('templates.group.gamesBlurb')}
            onSelect={enter}
            attrs={{ 'data-template-group': 'games', 'aria-haspopup': 'menu' }}
            trail={chev('›')}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight') return
              e.preventDefault()
              e.stopPropagation()
              enter()
            }}
          />
        </>
      ) : null}
    </>
  )
}

export function Templates() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const hasContent = useGraphStore((s) => s.nodes.length > 0 || s.edges.length > 0)

  useOutsideDismiss(open, wrapRef, () => setOpen(false))

  // the menu keyboard contract (issue #307) -- see the hook
  const close = useCallback(() => setOpen(false), [])
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, btnRef, close, entry)

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('templates', open)
    return () => useMenuOpenStore.getState().setOpen('templates', false)
  }, [open])

  const load = loadTemplate

  const pick = (id: string) => {
    setOpen(false)
    if (hasContent) setPending(id)
    else load(id)
  }

  const pendingName = pending
    ? t(TEMPLATE_KEY[pending as keyof typeof TEMPLATE_KEY].name)
    : ''

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        {...triggerProps}
      >
        {t('templates.button')}
        <Icon name="chevron-down" className="icon--caret" />
      </button>
      {open ? (
        <div className="menu__pop menu__pop--scrollable menu__pop--wide" role="menu" ref={popRef}>
          {MENU_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="menu__item"
              role="menuitem"
              onClick={() => pick(tpl.id)}
            >
              <span className="menu__name">
                {t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].name)}
              </span>
              <span className="menu__blurb">
                {t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].blurb)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={pending != null}
        title={t('templates.replace.title')}
        body={t('templates.replace.body', { name: pendingName })}
        confirmLabel={t('templates.replace.confirm')}
        onConfirm={() => {
          const id = pending
          setPending(null)
          if (id != null) load(id)
        }}
        onCancel={() => setPending(null)}
        returnFocusTo={() => btnRef.current}
      />
    </div>
  )
}
