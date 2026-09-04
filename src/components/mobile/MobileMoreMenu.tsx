import { useState, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { openTemplate } from '../../i18n/templateLabels'
import { TEMPLATES } from '../../model/templates'
import { WORKSPACE_MAX_BYTES } from '../../model/workspace'
import { useFilterStore } from '../../store/filterStore'
import { useFrameStore, hasFrames } from '../../store/frameStore'
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
import { prepareShareLink, shareKb } from '../../ui/shareAction'
import { useTourStore } from '../../store/tourStore'
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
  const focusMode = useUiStore((s) => s.focusMode)
  const activityOverlay = useUiStore((s) => s.activityOverlay)
  const framesExist = useFrameStore(hasFrames)
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

  const [sharePanel, setSharePanel] = useState<{ url: string; copied: boolean } | null>(null)
  const [shareConfirm, setShareConfirm] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [contextualOpen, setContextualOpen] = useState(false)
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
      let copied = false
      try {
        await navigator.clipboard.writeText(result.url)
        copied = true
      } catch {
        copied = false
      }
      setSharePanel({ url: result.url, copied })
      openOverlay('share')
    } finally {
      setShareBusy(false)
    }
  }

  const doLoadTemplate = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl) return
    useSimStore.getState().pause()
    // docs/template-label-overlay.md — deep clone + current-locale label overlay
    const { graph, recommendedRunConfig, modelVersion } = openTemplate(tpl)
    loadGraph(graph, modelVersion) // the existing atomic path — exactly one bump
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
      <MobileSheet title={t('mobile.more')} onClose={() => closeOverlay('more')} returnFocusTo={() => moreBtnRef.current}>
        <button
          type="button"
          className="sheet__row sheet__row--first"
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
        <button type="button" className="sheet__row" onClick={() => openOverlay('export')}>
          {t('export.menuLabel')}<span className="sheet__row-sub">▸</span>
        </button>
        <button type="button" className="sheet__row" onClick={() => openOverlay('templates')}>
          {t('templates.menuLabel')}<span className="sheet__row-sub">▸</span>
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
        <button type="button" className="sheet__row" onClick={() => openOverlay('filter')}>
          {t('canvas.filter.rowLabel')}<span className="sheet__row-sub">▸</span>
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
        {(framesExist || autoFramesExist) && (
          <button
            type="button"
            className="sheet__row"
            onClick={() => {
              useFrameStore.getState().clearFrames()
              useAutoFrameStore.getState().clearAuto()
              closeOverlay('more')
            }}
          >
            {t('canvas.frame.clearAll')}
          </button>
        )}
        <button type="button" className="sheet__row" onClick={resetView}>
          {t('canvas.resetView')}
        </button>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('theme.rowLabel')}<span className="sheet__row-sub"><ThemeToggle /></span>
        </div>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('lang.rowLabel')}<span className="sheet__row-sub"><LanguageSwitch /></span>
        </div>
        <button type="button" className="sheet__row" onClick={() => openOverlay('help')}>
          {t('tour.help.menuLabel')}<span className="sheet__row-sub">▸</span>
        </button>
        <div className="sheet__stamp">
          v{__APP_VERSION__}
          {__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}
        </div>
      </MobileSheet>
      <ConfirmDialog
        open={shareConfirm}
        title={t('share.disclosure.title')}
        body={t('share.disclosure.body')}
        confirmLabel={t('share.disclosure.confirm')}
        onConfirm={runShare}
        onCancel={() => setShareConfirm(false)}
        returnFocusTo={() => document.querySelector<HTMLButtonElement>('.sheet__row--first')}
      />
      {pendingDlg}
      </>
    )
  }

  if (overlay === 'templates') {
    return (
      <>
      <MobileSheet
        title={t('templates.menuLabel')}
        onClose={() => closeOverlay('templates')}
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
      <MobileSheet title={t('export.menuLabel')} onClose={() => closeOverlay('export')} returnFocusTo={backToMore}>
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

  // docs/guided-tour.md §GT7 / docs/contextual-inline-help.md §CIH4 — the
  // mobile Help sub-sheet: `Take a tour`, `Contextual help`, `About Loop Studio`.
  if (overlay === 'help') {
    return (
      <>
      <MobileSheet title={t('tour.help.menuLabel')} onClose={() => closeOverlay('help')} returnFocusTo={backToMore}>
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
        <button type="button" className="sheet__row" onClick={() => setAboutOpen(true)}>
          {t('tour.help.about')}
        </button>
        <ContextualHelpDialog
          open={contextualOpen}
          onClose={() => setContextualOpen(false)}
          returnFocusTo={backToMore}
        />
        <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} returnFocusTo={backToMore} />
      </MobileSheet>
      </>
    )
  }

  // docs/large-graph-readability.md §LGR3.2 / §LGR9 — the mobile Filters
  // sub-sheet. Same ephemeral `filterStore` as desktop.
  if (overlay === 'filter') {
    return (
      <MobileSheet
        title={t('canvas.filter.title')}
        onClose={() => closeOverlay('filter')}
        returnFocusTo={backToMore}
      >
        <FilterControls />
      </MobileSheet>
    )
  }

  if (overlay === 'share' && sharePanel) {
    return (
      <MobileSheet
        title={t('share.panel.label')}
        onClose={() => {
          setSharePanel(null)
          closeOverlay('share')
        }}
        returnFocusTo={backToMore}
      >
        <div className="share-pop__status">
          {sharePanel.copied ? t('share.panel.copied') : t('share.panel.copyThis')}
        </div>
        <input
          className="share-pop__url"
          type="text"
          readOnly
          value={sharePanel.url}
          onFocus={(e) => e.currentTarget.select()}
        />
      </MobileSheet>
    )
  }

  return null
}
