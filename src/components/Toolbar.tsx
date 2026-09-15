import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { NodeKind } from '../model/types'
import { useProjectStore } from '../store/projectStore'
import { useReviewStore } from '../store/reviewStore'
import { routeImport } from '../store/revisionIO'
import { useIsMobile } from '../ui/media'
import { useI18n } from '../i18n/store'
import { useT, type MessageKey } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { HelpMenu } from './HelpMenu'
import { Logo } from './Logo'
import { DataImportMenu } from './dataImport/DataImportMenu'
import { MobileTopBar } from './mobile/MobileTopBar'
import { ModuleMenu } from './ModuleMenu'
import { RevisionChip } from './RevisionChip'
import { ShareButton } from './ShareButton'
import { Templates } from './Templates'
import { DialogHost } from './toolbar/DialogHost'
import type { ToolbarDialog } from './toolbar/dialogTypes'
import { FileMenu, type FileMenuHandle } from './toolbar/FileMenu'
import { anyMenuOpenSelector, useMenuOpenStore } from './toolbar/menuOpenStore'
import { OverflowMenu, type OverflowMenuHandle } from './toolbar/OverflowMenu'
import { SettingsMenu } from './toolbar/SettingsMenu'
import { ShareSurface } from './toolbar/ShareSurface'
import { isInline, type OverflowItem } from './toolbar/toolbarOverflow'
import { useShareSurface } from './toolbar/useShareSurface'
import { useToolbarOverflow } from './toolbar/useToolbarOverflow'

const DND_TYPE = 'application/loop-node'

// The palette BUTTON label is chrome (keyed); a click still creates a node with
// the locale-independent `defaultData()` label (docs/localization.md §L3.4). The
// tip has three keyed layers — `.name` (also the button's accessible name),
// `.description` (semantic, matched to SEMANTICS-*), `palette.addAction` — each
// on its OWN DOM line, never concatenated (§L13 / Slice 2a). Grouped into three
// bands for Tier 2 (docs/toolbar-responsive.md): 0-2 / 3-5 / 6-7.
const PALETTE: { kind: NodeKind; nameKey: MessageKey; descKey: MessageKey; glyph: string }[] = [
  { kind: 'pool', nameKey: 'palette.pool.name', descKey: 'palette.pool.description', glyph: '◉' },
  { kind: 'source', nameKey: 'palette.source.name', descKey: 'palette.source.description', glyph: '＋' },
  { kind: 'drain', nameKey: 'palette.drain.name', descKey: 'palette.drain.description', glyph: '－' },
  { kind: 'gate', nameKey: 'palette.gate.name', descKey: 'palette.gate.description', glyph: '◇' },
  { kind: 'converter', nameKey: 'palette.converter.name', descKey: 'palette.converter.description', glyph: '⇄' },
  { kind: 'end', nameKey: 'palette.end.name', descKey: 'palette.end.description', glyph: '⊗' },
  { kind: 'parameter', nameKey: 'palette.parameter.name', descKey: 'palette.parameter.description', glyph: '▭' },
  { kind: 'register', nameKey: 'palette.register.name', descKey: 'palette.register.description', glyph: '＝' },
]
const PALETTE_GROUPS = [PALETTE.slice(0, 3), PALETTE.slice(3, 6), PALETTE.slice(6, 8)]

// docs/toolbar-responsive.md — the canonical Tier-1 render order, ALWAYS this
// sequence whether inline or inside the ⋯ menu (review condition 2). Which
// subset has collapsed is a separate, narrower question decided by
// `OVERFLOW_ORDER`/`isInline` in `toolbarOverflow.ts` — never this array.
const GROUP_ORDER: OverflowItem[] = ['module', 'file', 'data', 'share', 'settings', 'help']

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const [draggingKind, setDraggingKind] = useState<NodeKind | null>(null)
  // Hanrim's UX report (2026-09-15): clicking a palette chip to create a node
  // left its hover tooltip stuck open (DOM focus remains on the button after
  // a mouse click, and the old CSS keyed the tooltip off `:focus-within`,
  // which does not distinguish mouse-click focus from keyboard focus). A
  // click or a drag-start suppresses that ONE chip's tooltip immediately,
  // even if the pointer never left it; only leaving and re-entering the same
  // chip (or a fresh drag) clears the suppression. Keyboard Tab access is
  // handled separately, by CSS `:focus-visible` (below) — browsers do not
  // treat a mouse-activated button click as `:focus-visible`.
  const [suppressedTip, setSuppressedTip] = useState<NodeKind | null>(null)
  // Hanrim's UX report (2026-09-15): a palette hover tooltip could show at
  // the same time as an open Tier-1 menu (Templates/Module/File/Data/
  // Settings/Help/⋯) or Share's result panel — two competing overlay
  // layers. `anyMenuOpen` suppresses ALL palette tooltips (hover AND
  // keyboard `:focus-visible`, via CSS `!important`) for as long as
  // anything is open; `hoveredKind` tracks which chip (if any) the pointer
  // is currently over, so that when a menu closes, that ONE chip's tooltip
  // can be kept suppressed (not immediately popping back just because the
  // pointer never left it) until the pointer actually leaves and re-enters.
  const [hoveredKind, setHoveredKind] = useState<NodeKind | null>(null)
  const menuOpenFromStore = useMenuOpenStore(anyMenuOpenSelector)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const newGraph = useGraphStore((s) => s.newGraph)
  const undo = useGraphStore((s) => s.undo)
  const redo = useGraphStore((s) => s.redo)
  const canUndo = useGraphStore((s) => s.canUndo)
  const canRedo = useGraphStore((s) => s.canRedo)
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow()
  const isMobile = useIsMobile()
  const t = useT()
  const activeLocale = useI18n((s) => s.activeLocale)
  const projectOpen = useProjectStore((s) => s.open != null)
  const { layout, measuring, setToolbar, setBrand, setCore, setMore, setItem } = useToolbarOverflow(
    activeLocale,
    projectOpen,
  )
  const share = useShareSurface()
  const anyMenuOpen = menuOpenFromStore || share.surface?.phase === 'panel'

  // the moment a menu/panel closes, keep whatever chip is still under the
  // pointer suppressed — otherwise its tooltip would pop back immediately
  // just because the pointer never left it (Hanrim's UX report, 2026-09-15)
  // `useLayoutEffect`, not `useEffect` — the CSS `[data-menu-open]` rule that
  // suppresses tooltips while a menu is open is removed the instant this
  // render paints; a plain `useEffect` (which fires AFTER paint) sets
  // `suppressedTip` too late, leaving a real one-frame window where a still-
  // hovered chip's tooltip can flash visible before this catches up. Caught
  // by e2e under load (palette-tooltip-menu-suppression.spec.ts), not just
  // in theory.
  const wasMenuOpenRef = useRef(false)
  useLayoutEffect(() => {
    if (wasMenuOpenRef.current && !anyMenuOpen) setSuppressedTip(hoveredKind)
    wasMenuOpenRef.current = anyMenuOpen
  }, [anyMenuOpen, hoveredKind])

  // review condition 3 — the group's own trigger (real only while inline)
  // and the ⋯ trigger (always real), so a lifted dialog's `returnFocusTo`
  // (or Share's anchor) can resolve to whichever was the actual starting
  // point, captured BEFORE that point closes.
  const moduleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const fileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dataTriggerRef = useRef<HTMLButtonElement | null>(null)
  const shareTriggerRef = useRef<HTMLButtonElement | null>(null)
  const helpTriggerRef = useRef<HTMLButtonElement | null>(null)
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null)
  const fileMenuRef = useRef<FileMenuHandle>(null)
  const overflowMenuRef = useRef<OverflowMenuHandle>(null)
  const returnFocusElRef = useRef<HTMLElement | null>(null)
  const shareAnchorElRef = useRef<HTMLElement | null>(null)

  const [activeDialog, setActiveDialog] = useState<ToolbarDialog>(null)

  const addCentered = (kind: NodeKind) => {
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const cx = (rect ? rect.left + rect.width / 2 : window.innerWidth / 2) + (Math.random() * 80 - 40)
    const cy = (rect ? rect.top + rect.height / 2 : window.innerHeight / 2) + (Math.random() * 80 - 40)
    addNodeAt(kind, screenToFlowPosition({ x: cx, y: cy }))
  }

  const onDragStart = (e: DragEvent, kind: NodeKind) => {
    e.dataTransfer.setData(DND_TYPE, kind)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingKind(kind)
    setSuppressedTip(kind)
  }
  const onDragEnd = () => {
    setDraggingKind(null)
    setSuppressedTip(null)
  }

  // SEMANTICS-R.md §R10 — one routed import. A proposal opens the non-destructive
  // Review overlay and changes nothing; everything else loads as before, and a
  // revision file also adopts its project header.
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(
      async (text) => {
        try {
          const r = await routeImport(text)
          if (r.kind === 'proposal') {
            useReviewStore.getState().open(r)
            return
          }
          if (r.outcome.canvas) setViewport(r.outcome.canvas, { duration: 0 })
          const warnings = [
            ...(r.kind === 'project-dropped' ? [r.warning] : []),
            ...('structuralWarning' in r && r.structuralWarning ? [r.structuralWarning] : []),
            ...r.outcome.warnings,
          ]
          if (warnings.length) window.alert(warnings.join('\n'))
        } catch (err) {
          window.alert(err instanceof Error ? err.message : t('import.readError'))
        }
      },
      () => window.alert(t('import.readError')),
    )
  }

  // docs/mobile.md §MV6 — the mobile layout replaces the whole editing toolbar
  // with a compact bar (Logo + a More menu). Desktop is untouched below.
  if (isMobile) return <MobileTopBar />

  // ── the toolbar's fixed two-tier contract ───────────────────────────────
  // Tier 1 (project/app commands) is always one row; Tier 2 (the palette) is
  // always its own row. The overflow controller decides only how many
  // trailing GROUPS sit in the ⋯ menu — never a row/wrap branch, never the
  // locale. `measuring` is one pre-paint pass with everything expanded so
  // widths can be read; it never paints.
  const collapsed = measuring ? 0 : layout.collapsed
  const inline = (id: OverflowItem) => isInline(id, collapsed)

  const buildTitle = t('toolbar.buildTitle', { version: __APP_VERSION__, sha: __BUILD_SHA__ })

  // review condition 3 — every lifted flow's ancestor-close + focus-return
  // contract, in one place. `closeAncestors` closes File's own popover
  // (only relevant for File itself and whatever it wraps, i.e. Export) and
  // the ⋯ overflow menu (whenever the acting group is currently collapsed
  // into it) — called BEFORE any dialog/surface state is set, so a group
  // never has a stale nested-menu selector to worry about. Settings
  // (Theme/Language) is the one deliberate exception: nothing here is ever
  // wired to it.
  const closeAncestors = (origin: 'file' | 'data' | 'share' | 'help' | 'module', collapsedNow: boolean) => {
    if (origin === 'file') fileMenuRef.current?.close()
    if (collapsedNow) overflowMenuRef.current?.close()
  }
  const groupTriggerRef: Partial<Record<OverflowItem, RefObject<HTMLButtonElement | null>>> = {
    module: moduleTriggerRef,
    file: fileTriggerRef,
    data: dataTriggerRef,
    share: shareTriggerRef,
    help: helpTriggerRef,
  }
  const captureReturnFocus = (id: OverflowItem): boolean => {
    const collapsedNow = !inline(id)
    returnFocusElRef.current = collapsedNow
      ? moreTriggerRef.current
      : (groupTriggerRef[id]?.current ?? null)
    return collapsedNow
  }
  const onOpenDialogFor =
    (origin: 'file' | 'data' | 'help' | 'module', id: OverflowItem) => (desc: ToolbarDialog) => {
      const collapsedNow = captureReturnFocus(id)
      closeAncestors(origin, collapsedNow)
      setActiveDialog(desc)
    }
  const onLeaveFor = (origin: 'file' | 'help' | 'module', id: OverflowItem) => () => {
    const collapsedNow = captureReturnFocus(id)
    closeAncestors(origin, collapsedNow)
  }
  const onOpenConfirmShare = () => {
    const collapsedNow = captureReturnFocus('share')
    shareAnchorElRef.current = collapsedNow ? moreTriggerRef.current : shareTriggerRef.current
    closeAncestors('share', collapsedNow)
    share.openConfirm()
  }

  const importButton = (
    <button
      type="button"
      className="menu__item"
      role="menuitem"
      onClick={() => {
        const collapsedNow = captureReturnFocus('file')
        closeAncestors('file', collapsedNow)
        fileRef.current?.click()
      }}
    >
      <span className="menu__name">{t('toolbar.import')}</span>
    </button>
  )
  const newButton = (
    <button
      type="button"
      className="menu__item"
      role="menuitem"
      onClick={() => {
        const collapsedNow = captureReturnFocus('file')
        closeAncestors('file', collapsedNow)
        setConfirmNew(true)
      }}
    >
      <span className="menu__name">{t('toolbar.new')}</span>
    </button>
  )

  const groupSlot = (id: OverflowItem) => {
    switch (id) {
      case 'module':
        return (
          <ModuleMenu
            buttonRef={(el) => (moduleTriggerRef.current = el)}
            onOpenDialog={onOpenDialogFor('module', 'module')}
            onLeave={onLeaveFor('module', 'module')}
          />
        )
      case 'file':
        return (
          <FileMenu
            ref={fileMenuRef}
            buttonRef={(el) => (fileTriggerRef.current = el)}
            newButton={newButton}
            importButton={importButton}
            getViewport={getViewport}
            onOpenDialog={onOpenDialogFor('file', 'file')}
            onLeave={onLeaveFor('file', 'file')}
          />
        )
      case 'data':
        return (
          <DataImportMenu
            buttonRef={(el) => (dataTriggerRef.current = el)}
            onOpenDialog={onOpenDialogFor('data', 'data')}
          />
        )
      case 'share':
        return (
          <ShareButton
            buttonRef={(el) => (shareTriggerRef.current = el)}
            onOpenConfirm={onOpenConfirmShare}
            busy={share.busy}
            active={share.surface != null}
          />
        )
      case 'settings':
        return <SettingsMenu />
      case 'help':
        return (
          <HelpMenu
            buttonRef={(el) => (helpTriggerRef.current = el)}
            onOpenDialog={onOpenDialogFor('help', 'help')}
            onLeave={onLeaveFor('help', 'help')}
          />
        )
    }
  }

  return (
    <header className="toolbar" data-measuring={measuring ? '' : undefined} ref={setToolbar}>
      <div className="toolbar__brand" title={buildTitle} aria-label={buildTitle} ref={setBrand}>
        <span className="toolbar__mark">
          <Logo />
        </span>
        <span className="toolbar__word">Loop Studio</span>
        <span className="toolbar__tag">{t('toolbar.preview')}</span>
      </div>

      <div className="toolbar__palette" data-tour="palette" data-menu-open={anyMenuOpen ? '' : undefined}>
        {PALETTE_GROUPS.map((group, i) => (
          <span className="palette-group" key={i}>
            {i > 0 ? <span className="palette-divider" aria-hidden="true" /> : null}
            {group.map((p) => (
              <span
                key={p.kind}
                className="palette-item"
                data-tip-suppressed={suppressedTip === p.kind ? '' : undefined}
                onMouseEnter={() => setHoveredKind(p.kind)}
                onMouseLeave={() => {
                  setHoveredKind((k) => (k === p.kind ? null : k))
                  setSuppressedTip((k) => (k === p.kind ? null : k))
                }}
              >
                <button
                  type="button"
                  className={`chip chip--${p.kind}`}
                  draggable
                  data-dragging={draggingKind === p.kind ? '' : undefined}
                  onDragStart={(e) => onDragStart(e, p.kind)}
                  onDragEnd={onDragEnd}
                  onClick={() => {
                    addCentered(p.kind)
                    setSuppressedTip(p.kind)
                  }}
                  aria-describedby={`palette-tip-${p.kind}`}
                >
                  <span className="chip__glyph" aria-hidden="true">
                    {p.glyph}
                  </span>
                  {t(p.nameKey)}
                </button>
                <span className="palette-tip" role="tooltip" id={`palette-tip-${p.kind}`}>
                  <span className="palette-tip__name">{t(p.nameKey)}</span>
                  <span className="palette-tip__desc">{t(p.descKey)}</span>
                  <span className="palette-tip__how">{t('palette.addAction')}</span>
                </span>
              </span>
            ))}
          </span>
        ))}
      </div>

      <div className="toolbar__actions" data-tour="files">
        <div className="toolbar__actions-core" ref={setCore}>
          <button
            type="button"
            className="btn btn--icon"
            onClick={undo}
            disabled={!canUndo}
            title={t('toolbar.undo.title')}
          >
            ↶
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={redo}
            disabled={!canRedo}
            title={t('toolbar.redo.title')}
          >
            ↷
          </button>
          <Templates />
          <RevisionChip />
        </div>

        {GROUP_ORDER.filter((id) => inline(id)).map((id) => (
          <span className="toolbar__slot" key={id} ref={setItem(id)}>
            {groupSlot(id)}
          </span>
        ))}

        <OverflowMenu
          ref={overflowMenuRef}
          ghost={collapsed === 0}
          buttonRef={(el) => {
            moreTriggerRef.current = el
            setMore(el)
          }}
        >
          {GROUP_ORDER.filter((id) => !inline(id)).map((id) => (
            <span key={id}>{groupSlot(id)}</span>
          ))}
        </OverflowMenu>

        <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />
      </div>

      <ConfirmDialog
        open={confirmNew}
        title={t('toolbar.newGraph.title')}
        body={t('toolbar.newGraph.body')}
        confirmLabel={t('toolbar.newGraph.confirm')}
        onConfirm={() => {
          setConfirmNew(false)
          newGraph()
        }}
        onCancel={() => setConfirmNew(false)}
        returnFocusTo={() => returnFocusElRef.current}
      />

      <DialogHost
        activeDialog={activeDialog}
        onClose={() => setActiveDialog(null)}
        returnFocusTo={() => returnFocusElRef.current}
      />
      <ShareSurface
        surface={share.surface}
        anchorRef={shareAnchorElRef}
        returnFocusTo={() => returnFocusElRef.current}
        onConfirm={share.confirm}
        onCancel={share.cancel}
        onRetryCopy={share.retryCopy}
        onClosePanel={share.closePanel}
      />
    </header>
  )
}
