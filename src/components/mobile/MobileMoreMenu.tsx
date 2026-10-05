import { useCallback, useRef, useState, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { FEEDBACK_URL } from '../../feedback'
import { openTemplate } from '../../i18n/templateLabels'
import { TEMPLATES } from '../../model/templates'
import { WORKSPACE_MAX_BYTES } from '../../model/workspace'
import { useFilterStore } from '../../store/filterStore'
import { useAutoFrameStore, hasAutoFrames } from '../../store/autoFrameStore'
import { WORTH_IT_FLOOR } from '../frames/autoFrames'
import { useGraphStore } from '../../store/graphStore'
import { useMcStore } from '../../store/mcStore'
import { useProjectStore } from '../../store/projectStore'
import { useSimStore } from '../../store/simStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import {
  decideWorkspaceExport,
  planWorkspaceExport,
  type Viewport,
  type WorkspaceFileOption,
} from '../../store/workspaceIO'
import { downloadText } from '../../ui/download'
import { exportProjectRevision, makeProposal } from '../../ui/revisionActions'
import { type ProtectedShareLinkResult, copyShareLink, prepareProtectedShareLink, prepareShareLink, shareKb } from '../../ui/shareAction'
import { useTourStore } from '../../store/tourStore'
import { useWhatsNewStore } from '../../store/whatsNewStore'
import { useHintStore, useTier3Ready, useLargeGraphInteractionGate } from '../../store/hintStore'
import { useT } from '../../i18n'
import { AboutDialog } from '../AboutDialog'
import { AuthorDialog } from '../AuthorDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import { ContextualHelpDialog } from '../ContextualHelpDialog'
import { FilterControls } from '../FilterPanel'
import { InlineHintNote } from '../HintNote'
import { LanguageSwitch } from '../LanguageSwitch'
import { TEMPLATE_KEY } from '../templateKeys'
import { MobileSheet } from './MobileSheet'
import { ThemeToggle } from '../ThemeToggle'
import { WhatsNewPanel } from '../WhatsNewPanel'
import { StoragePrivacyDialog } from '../StoragePrivacyDialog'
import { ShareCreateDialog } from '../toolbar/ShareCreateDialog'
import { selectTemporary, useSessionStore } from '../../store/sessionStore'
import { ArrowIcon } from '../../ui/icons'

// docs/localization.md Slice 2b — Templates replace, the Project-revision
// disclosure, and the Workspace-JSON summary are in-app ConfirmDialogs now;
// `loadGraph` / `exportProjectRevision` / the download run only from Confirm.
type PendingConfirm = { title: string; body: string; confirmLabel: string; run: () => void } | null

// docs/mobile.md §MV6 — the compact top bar's "More" menu and its three
// sub-sheets (Share result / Templates / Export), each an exclusive overlay
// (§MV5 / §MV-D11). Import reuses the shell's hidden file input; Theme cycles
// in place. Heavy logic (share encode, workspace plan/decide) is shared with
// the desktop menus.

const MiB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`
// a sub-sheet returns focus to the top bar's More button when it closes
const backToMore = () => document.querySelector<HTMLButtonElement>('.mob-more')

export function MobileMoreMenu({
  fileInputRef,
  moreBtnRef,
  getViewport,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>
  moreBtnRef: RefObject<HTMLButtonElement | null>
  getViewport: () => Viewport
}) {
  const overlay = useUiStore(selectOverlay)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  // issue #307 - Escape in a sub-sheet goes back ONE level: to the More sheet,
  // with focus on the row that opened the sub-sheet. Close and a tap on the
  // scrim still close everything, as they always did.
  const returnRow = useRef<string | null>(null)
  const backToMoreFrom = (row: string, before?: () => void) => () => {
    before?.()
    returnRow.current = row
    openOverlay('more')
  }
  const moreInitialFocus = () => {
    const row = returnRow.current
    // forgotten after this task, not at once: StrictMode runs a mount effect
    // twice, and both runs must land on the same row
    setTimeout(() => {
      returnRow.current = null
    })
    return row ? document.querySelector<HTMLElement>(`.sheet [data-more-row="${row}"]`) : null
  }
  const focusMode = useUiStore((s) => s.focusMode)
  const activityOverlay = useUiStore((s) => s.activityOverlay)
  const autoFramesExist = useAutoFrameStore(hasAutoFrames)
  // §AF2.2 — "Suggest frames" only offered when the whole graph is big enough
  const suggestEligible =
    useGraphStore(
      (s) =>
        s.nodes.filter((n) => {
          const k = (n.data as { kind?: string } | undefined)?.kind ?? String(n.type)
          return k !== 'parameter' && k !== 'register'
        }).length,
    ) >= WORTH_IT_FLOOR
  const t = useT()
  // §L9.3 — a direction-aware CHARACTER from the shared table, never a transform
  const { fitView } = useReactFlow()

  const exportJSON = useGraphStore((s) => s.exportJSON)
  const loadGraph = useGraphStore((s) => s.loadGraph)
  const projectOpen = useProjectStore((s) => s.open)

  // docs/contextual-inline-help.md §CIH3 #4 / §CIH6 — Focus/Filter discovery,
  // mobile's one-line note above the More sheet's Focus/Filter rows. Shares
  // the `focus-filter-discovery` hintId (and its `seen` flag) with the
  // desktop canvas Panel version — whichever platform shows it first is
  // enough. `focusOrFilterEverUsed` (Canvas.tsx marks it, either platform —
  // shared `uiStore` state) covers Filter too even though it has no sticky
  // mobile toggle of its own.
  const nodeCount = useGraphStore((s) => s.nodes.length)
  const tourIdleMobile = useTourStore((s) => s.phase === 'idle')
  const tier3ReadyMobile = useTier3Ready()
  const largeGraphGateMobile = useLargeGraphInteractionGate()
  const focusOrFilterEverUsed = useHintStore((s) => s.focusOrFilterEverUsed)
  const focusFilterHintTrigger = nodeCount >= WORTH_IT_FLOOR && !focusOrFilterEverUsed
  const focusFilterHintReady = tourIdleMobile && tier3ReadyMobile && largeGraphGateMobile

  // docs/large-graph-readability.md §LGR3.4 / LGR-D4 — Reset view (mobile): fit
  // the graph + clear the exploration lens (filters + focused node). UI-only.
  const resetView = () => {
    useFilterStore.getState().clear()
    useGraphStore.getState().setSelection(null, null)
    void fitView({ padding: 0.3, maxZoom: 1.2 })
    closeOverlay('more')
  }

  // `copies` counts the successful copies of THIS link, so the status line is
  // announced again each time the button below copies it again
  const [sharePanel, setSharePanel] = useState<{ url: string; copied: boolean; copies: number; protected?: boolean } | null>(null)
  const shareUrlRef = useRef<HTMLInputElement>(null)
  const [shareConfirm, setShareConfirm] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  // issue #297 — the Storage and privacy area, and whether this is a temporary session
  const [storageOpen, setStorageOpen] = useState(false)
  const temporary = useSessionStore(selectTemporary)
  const [contextualOpen, setContextualOpen] = useState(false)
  // issue #296 — the What's new panel and the marker that says it is unread
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const closeWhatsNew = useCallback(() => setWhatsNewOpen(false), [])
  const whatsNewUnread = useWhatsNewStore((s) => s.unread)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)

  // docs/localization.md Slice 2b — the §U4 disclosure is an in-app ConfirmDialog
  // now. `runShare` (export + link build + clipboard) starts only from Confirm.
  const runShare = async () => {
    setShareConfirm(false)
    if (shareBusy) return
    setShareBusy(true)
    try {
      const result = await prepareShareLink(exportJSON({ ...useMcStore.getState().config }))
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
      const copied = await copyShareLink(result.url)
      setSharePanel({ url: result.url, copied, copies: copied ? 1 : 0 })
      openOverlay('share')
    } finally {
      setShareBusy(false)
    }
  }

  // issue #300 — the protected link, through the same dialog and the same
  // shared action as desktop. Anything but `ok` is shown inside the dialog; on
  // `ok` the LINK is copied (never the password) and the result sheet opens.
  const runProtectedShare = async (password: string): Promise<ProtectedShareLinkResult> => {
    if (shareBusy) return { status: 'unavailable' }
    setShareBusy(true)
    try {
      const result = await prepareProtectedShareLink(exportJSON({ ...useMcStore.getState().config }), password)
      if (result.status !== 'ok') return result
      const copied = await copyShareLink(result.url)
      setShareConfirm(false)
      setSharePanel({ url: result.url, copied, copies: copied ? 1 : 0, protected: true })
      openOverlay('share')
      return result
    } finally {
      setShareBusy(false)
    }
  }

  // issue #300 — the result sheet's Copy button. The automatic copy above
  // happens once; a clipboard that was overwritten since, or a browser that
  // refused that first write, left no way back to a link that takes a password
  // typed twice to make again. This copies the SAME link (never a password, the
  // sheet never has one) and nothing is created again. Where the clipboard
  // refuses, the field is selected whole for a manual copy.
  const copyShareAgain = async () => {
    const panel = sharePanel
    if (!panel) return
    const ok = await copyShareLink(panel.url)
    setSharePanel((p) => (p && p.url === panel.url ? { ...p, copied: ok, copies: ok ? p.copies + 1 : p.copies } : p))
    if (!ok) {
      const el = shareUrlRef.current
      el?.focus()
      el?.setSelectionRange(0, el.value.length) // `select()` alone does not select on iOS
    }
  }

  const doLoadTemplate = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl) return
    useSimStore.getState().pause()
    // docs/template-label-overlay.md — deep clone + current-locale label overlay
    const { graph, recommendedRunConfig, modelVersion } = openTemplate(tpl)
    loadGraph(graph, modelVersion, tpl.initialView ?? null, graph.frames) // §MML3 — one bump; MMO frames its early band
    useMcStore.getState().applyRecommended(recommendedRunConfig)
    closeOverlay()
  }

  const pickTemplate = (id: string) => {
    // docs/mobile.md §MV3b — confirm before replacing, unless the session is
    // still the untouched first-boot sample. Cancel leaves everything untouched.
    if (useGraphStore.getState().pristineSample) {
      doLoadTemplate(id)
      return
    }
    setPendingConfirm({
      title: t('templates.replace.title'),
      body: t('templates.replace.body', {
        name: t(TEMPLATE_KEY[id as keyof typeof TEMPLATE_KEY].name),
      }),
      confirmLabel: t('templates.replace.confirm'),
      run: () => doLoadTemplate(id),
    })
  }

  const graphJSON = () => {
    downloadText(exportJSON({ ...useMcStore.getState().config }), 'loop-studio-graph.json')
    closeOverlay()
  }

  const projectRevision = () => {
    setPendingConfirm({
      title: t('export.projectRevision.disclosure.title'),
      body: t('export.projectRevision.disclosure.body'),
      confirmLabel: t('export.projectRevision.disclosure.confirm'),
      run: () => {
        closeOverlay()
        const r = exportProjectRevision()
        if (!r.ok) window.alert(r.message)
      },
    })
  }

  const proposal = () => {
    closeOverlay()
    const r = makeProposal()
    if (!r.ok) window.alert(r.message)
  }

  const workspaceJSON = () => {
    const mc = useMcStore.getState()
    const sim = useSimStore.getState()
    const { full, lean } = planWorkspaceExport(getViewport())
    const cap = import.meta.env.DEV
      ? ((window as unknown as { __workspaceMaxBytes?: number }).__workspaceMaxBytes ??
        WORKSPACE_MAX_BYTES)
      : WORKSPACE_MAX_BYTES
    const decision = decideWorkspaceExport(full, lean, cap)
    const write = (opt: WorkspaceFileOption) => () => {
      downloadText(opt.text, 'loop-studio-workspace.json')
      closeOverlay()
    }

    if (decision.kind === 'reject') {
      window.alert(
        t('export.workspace.reject', { size: MiB(decision.bytes), limit: MiB(WORKSPACE_MAX_BYTES) }),
      )
      closeOverlay()
      return
    }

    const items = [t('export.workspace.item.runConfig')]
    if (mc.status === 'done' && mc.result)
      items.push(t('export.workspace.item.distribution', { runs: mc.config.runs }))
    items.push(
      t('export.workspace.item.timeline'),
      t('export.workspace.item.canvas'),
      t('export.workspace.item.liveRun', { step: sim.stepIndex }),
    )
    const summary = `${t('export.workspace.included', { items: items.join(', ') })}\n${t('export.workspace.excluded')}`

    if (decision.kind === 'confirm-omit') {
      setPendingConfirm({
        title: t('export.workspace.title'),
        body: `${summary}\n\n${t('export.workspace.omit.body', {
          full: MiB(decision.full.bytes),
          limit: MiB(WORKSPACE_MAX_BYTES),
          lean: MiB(decision.lean.bytes),
        })}`,
        confirmLabel: t('export.workspace.omit.confirm'),
        run: write(decision.lean),
      })
      return
    }
    setPendingConfirm({
      title: t('export.workspace.title'),
      body: summary,
      confirmLabel: t('export.workspace.confirm'),
      run: write(decision.option),
    })
  }

  const pendingDlg = (
    <ConfirmDialog
      open={pendingConfirm != null}
      title={pendingConfirm?.title ?? ''}
      body={pendingConfirm?.body ?? ''}
      confirmLabel={pendingConfirm?.confirmLabel ?? ''}
      onConfirm={() => {
        const p = pendingConfirm
        setPendingConfirm(null)
        p?.run()
      }}
      onCancel={() => setPendingConfirm(null)}
      returnFocusTo={backToMore}
    />
  )

  if (overlay === 'more') {
    return (
      <>
      <MobileSheet key="more" title={t('mobile.more')} onClose={() => closeOverlay('more')} returnFocusTo={() => moreBtnRef.current} initialFocus={moreInitialFocus}>
        <button
          type="button"
          className="sheet__row sheet__row--first"
          data-more-row="share"
          onClick={() => setShareConfirm(true)}
        >
          {t('share.panel.label')}
        </button>
        <button
          type="button"
          className="sheet__row"
          onClick={() => {
            closeOverlay('more')
            fileInputRef.current?.click()
          }}
        >
          {t('mobile.more.import')}
          <span className="sheet__row-sub">{t('mobile.more.importSub')}</span>
        </button>
        <button type="button" className="sheet__row" data-more-row="export" onClick={() => openOverlay('export')}>
          {t('export.menuLabel')}<span className="sheet__row-sub"><ArrowIcon unit="submenu" /></span>
        </button>
        <button type="button" className="sheet__row" data-more-row="templates" onClick={() => openOverlay('templates')}>
          {t('templates.menuLabel')}<span className="sheet__row-sub"><ArrowIcon unit="submenu" /></span>
        </button>
        <InlineHintNote id="focus-filter-discovery" trigger={focusFilterHintTrigger} ready={focusFilterHintReady}>
          {t('hint.focusFilter.body')}
        </InlineHintNote>
        {/* docs/large-graph-readability.md §LGR9 — the Focus toggle lives here
            on mobile (not in the canvas controls). Same uiStore.focusMode. */}
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('canvas.focus.rowLabel')}
          <span className="sheet__row-sub">
            <button
              type="button"
              className="btn"
              onClick={() => useUiStore.getState().toggleFocusMode()}
              aria-pressed={focusMode}
              title={focusMode ? t('canvas.focus.off') : t('canvas.focus.on')}
            >
              {focusMode ? t('canvas.focus.stateOn') : t('canvas.focus.stateOff')}
            </button>
          </span>
        </div>
        {/* docs/large-graph-readability.md §LGR3.2 / §LGR9 — Filters + Reset view
            on mobile. Filters opens a sub-sheet; Reset view is a one-shot. */}
        <button type="button" className="sheet__row" data-more-row="filter" onClick={() => openOverlay('filter')}>
          {t('canvas.filter.rowLabel')}<span className="sheet__row-sub"><ArrowIcon unit="submenu" /></span>
        </button>
        {/* docs/large-graph-readability.md §LGR6 / §LGR9 — on mobile the
            Activity overlay toggles here, and drawn frames can be viewed +
            cleared; frame *drawing* is desktop-only. */}
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('canvas.activity.rowLabel')}
          <span className="sheet__row-sub">
            <button
              type="button"
              className="btn"
              onClick={() => useUiStore.getState().toggleActivityOverlay()}
              aria-pressed={activityOverlay}
              title={activityOverlay ? t('canvas.activity.on') : t('canvas.activity.off')}
            >
              {activityOverlay ? t('canvas.focus.stateOn') : t('canvas.focus.stateOff')}
            </button>
          </span>
        </div>
        {/* docs/…-auto-frames.md §AF-INV-7 — on mobile, "Suggest frames" is a
            More-sheet action (no canvas control); auto frames still render. */}
        {(suggestEligible || autoFramesExist) && (
          <button
            type="button"
            className="sheet__row"
            onClick={() => {
              useAutoFrameStore.getState().suggest()
              closeOverlay('more')
            }}
          >
            {t('canvas.frame.suggestRow')}
          </button>
        )}
        {autoFramesExist && (
          <button
            type="button"
            className="sheet__row"
            onClick={() => {
              useAutoFrameStore.getState().clearAuto()
              closeOverlay('more')
            }}
          >
            {t('canvas.frame.clearSuggestedRow')}
          </button>
        )}
        {/* D6 (2026-09-20, docs/large-graph-readability.md LGR-D12) — a SAVED
            frame on mobile is view + select only, so there is no row that
            deletes one ("Clear all frames" is desktop-only, and off under the
            edit-lock there too). Only the session-only "Clear suggested frames"
            row above stays. */}
        <button type="button" className="sheet__row" onClick={resetView}>
          {t('canvas.resetView')}
        </button>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('theme.rowLabel')}<span className="sheet__row-sub"><ThemeToggle /></span>
        </div>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('lang.rowLabel')}<span className="sheet__row-sub"><LanguageSwitch /></span>
        </div>
        {/* issue #297 - the Storage and privacy area; in a temporary session the
            row also carries the standing reminder that no work is saved here */}
        <button type="button" className="sheet__row" data-settings-row="storage-privacy" onClick={() => setStorageOpen(true)}>
          {t('storage.menuLabel')}
          {temporary ? <span className="sheet__row-sub" data-session-chip="temporary">{t('session.temporary.chip')}</span> : null}
        </button>
        <button type="button" className="sheet__row" data-more-row="help" onClick={() => openOverlay('help')}>
          {t('tour.help.menuLabel')}<span className="sheet__row-sub"><ArrowIcon unit="submenu" /></span>
        </button>
        <div className="sheet__stamp" dir="ltr">
          v{__APP_VERSION__}
          {__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}
        </div>
      </MobileSheet>
      <ShareCreateDialog
        open={shareConfirm}
        temporary={temporary}
        onCreatePlain={runShare}
        onCreateProtected={runProtectedShare}
        onCancel={() => setShareConfirm(false)}
        returnFocusTo={() => document.querySelector<HTMLButtonElement>('.sheet__row--first')}
      />
      {/* issue #297 - the Storage and privacy area, opened from its row above */}
      <StoragePrivacyDialog
        open={storageOpen}
        onClose={() => setStorageOpen(false)}
        returnFocusTo={() => document.querySelector<HTMLButtonElement>('[data-settings-row="storage-privacy"]')}
      />
      {pendingDlg}
      </>
    )
  }

  if (overlay === 'templates') {
    return (
      <>
      <MobileSheet
        key="templates"
        title={t('templates.menuLabel')}
        onClose={() => closeOverlay('templates')}
        onEscape={backToMoreFrom('templates')}
        returnFocusTo={backToMore}
      >
        {TEMPLATES.map((tpl) => (
          <button key={tpl.id} type="button" className="sheet__row" onClick={() => pickTemplate(tpl.id)}>
            {t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].name)}
            <span className="sheet__row-sub">
              {t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].blurb)}
            </span>
          </button>
        ))}
      </MobileSheet>
      {pendingDlg}
      </>
    )
  }

  if (overlay === 'export') {
    return (
      <>
      <MobileSheet key="export" title={t('export.menuLabel')} onClose={() => closeOverlay('export')} onEscape={backToMoreFrom('export')} returnFocusTo={backToMore}>
        <button type="button" className="sheet__row" onClick={graphJSON}>
          {t('export.graphJson.name')}<span className="sheet__row-sub">{t('export.graphJson.blurb')}</span>
        </button>
        <button type="button" className="sheet__row" onClick={workspaceJSON}>
          {t('export.workspaceJson.name')}<span className="sheet__row-sub">{t('export.workspaceJson.blurb')}</span>
        </button>
        <button type="button" className="sheet__row" onClick={projectRevision}>
          {t('export.projectRevision.name')}<span className="sheet__row-sub">{t('export.projectRevision.blurb')}</span>
        </button>
        <button
          type="button"
          className="sheet__row"
          onClick={proposal}
          disabled={!projectOpen}
        >
          {t('export.proposal.name')}<span className="sheet__row-sub">{t('export.proposal.blurb')}</span>
        </button>
        <button type="button" className="sheet__row" onClick={() => setAuthorOpen(true)}>
          {t('export.author.name')}<span className="sheet__row-sub">{t('export.author.blurb')}</span>
        </button>
        <AuthorDialog open={authorOpen} onClose={() => setAuthorOpen(false)} returnFocusTo={backToMore} />
      </MobileSheet>
      {pendingDlg}
      </>
    )
  }

  // docs/guided-tour.md §GT7 / docs/contextual-inline-help.md §CIH4 /
  // docs/release-notes.md — the mobile Help sub-sheet, in the same three groups
  // and the same order as the desktop Help menu: restart the tour and turn the
  // contextual tips back on; What's new, with its `New` marker; Send feedback
  // (external link, new tab) and About Loop Studio.
  if (overlay === 'help') {
    return (
      <>
      <MobileSheet key="help" title={t('tour.help.menuLabel')} onClose={() => closeOverlay('help')} onEscape={backToMoreFrom('help')} returnFocusTo={backToMore}>
        <button
          type="button"
          className="sheet__row"
          onClick={() => {
            closeOverlay() // close the sheet so the tour overlay is visible
            useTourStore.getState().startReplay('mobile')
          }}
        >
          {t('tour.help.takeTour')}
        </button>
        <button type="button" className="sheet__row" onClick={() => setContextualOpen(true)}>
          {t('help.contextual.menuLabel')}
        </button>
        <div className="menu__divider" role="separator" />
        <button type="button" className="sheet__row" data-whatsnew="menu-item" onClick={() => setWhatsNewOpen(true)}>
          {t('whatsNew.title')}
          {whatsNewUnread ? <span className="sheet__row-sub">{t('whatsNew.newMarker')}</span> : null}
        </button>
        <div className="menu__divider" role="separator" />
        <a
          className="sheet__row"
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('tour.help.feedbackAria')}
          onClick={() => closeOverlay('help')}
        >
          {t('tour.help.feedback')} <ArrowIcon unit="external-link" className="menu__ext" />
        </a>
        <button type="button" className="sheet__row" onClick={() => setAboutOpen(true)}>
          {t('tour.help.about')}
        </button>
        <ContextualHelpDialog
          open={contextualOpen}
          onClose={() => setContextualOpen(false)}
          returnFocusTo={backToMore}
        />
        <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} returnFocusTo={backToMore} />
        <WhatsNewPanel open={whatsNewOpen} onClose={closeWhatsNew} returnFocusTo={backToMore} />
      </MobileSheet>
      </>
    )
  }

  // docs/large-graph-readability.md §LGR3.2 / §LGR9 — the mobile Filters
  // sub-sheet. Same ephemeral `filterStore` as desktop.
  if (overlay === 'filter') {
    return (
      <MobileSheet
        key="filter"
        title={t('canvas.filter.title')}
        onClose={() => closeOverlay('filter')}
        onEscape={backToMoreFrom('filter')}
        returnFocusTo={backToMore}
      >
        <FilterControls />
      </MobileSheet>
    )
  }

  if (overlay === 'share' && sharePanel) {
    return (
      <MobileSheet
        key="share"
        title={t('share.panel.label')}
        onClose={() => {
          setSharePanel(null)
          closeOverlay('share')
        }}
        onEscape={backToMoreFrom('share', () => setSharePanel(null))}
        returnFocusTo={backToMore}
      >
        {/* a live region: the keyed child is replaced on every successful copy, so
            "copied" is said again when the button copies the same link again */}
        <div className="share-pop__status" role="status" data-share-status={sharePanel.copied ? 'copied' : 'manual'}>
          <span key={sharePanel.copies}>{sharePanel.copied ? t('share.panel.copied') : t('share.panel.copyThis')}</span>
        </div>
        {sharePanel.protected ? (
          <div className="share-pop__status share-pop__status--protected" data-share-protected="note">
            {t('share.panel.protected')}
          </div>
        ) : null}
        <input dir="ltr"
          ref={shareUrlRef}
          className="share-pop__url"
          type="text"
          readOnly
          value={sharePanel.url}
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="share-pop__row">
          <button type="button" className="btn" data-share-copy={sharePanel.copied ? 'again' : 'first'} onClick={() => void copyShareAgain()}>
            {sharePanel.copied ? t('share.panel.copyAgain') : t('share.panel.copy')}
          </button>
        </div>
      </MobileSheet>
    )
  }

  return null
}
