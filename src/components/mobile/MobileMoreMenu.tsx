import { useState, type RefObject } from 'react'
import { TEMPLATES } from '../../model/templates'
import { WORKSPACE_MAX_BYTES } from '../../model/workspace'
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
import {
  PROJECT_REVISION_DISCLOSURE,
  exportProjectRevision,
  makeProposal,
} from '../../ui/revisionActions'
import { SHARE_DISCLOSURE, prepareShareLink, shareKb } from '../../ui/shareAction'
import { useT } from '../../i18n'
import { AuthorDialog } from '../AuthorDialog'
import { LanguageSwitch } from '../LanguageSwitch'
import { MobileSheet } from './MobileSheet'
import { ThemeToggle } from '../ThemeToggle'

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
  const t = useT()

  const exportJSON = useGraphStore((s) => s.exportJSON)
  const loadGraph = useGraphStore((s) => s.loadGraph)
  const projectOpen = useProjectStore((s) => s.open)

  const [sharePanel, setSharePanel] = useState<{ url: string; copied: boolean } | null>(null)
  const [authorOpen, setAuthorOpen] = useState(false)

  const onShare = async () => {
    if (!window.confirm(SHARE_DISCLOSURE)) return
    const result = await prepareShareLink(exportJSON({ ...useMcStore.getState().config }))
    if (result.status === 'too-large') {
      window.alert(
        `This diagram is too large for a share link (${shareKb(result.bytes)}; limit ${shareKb(result.cap)}). ` +
          `Use Export → Graph JSON and share the file instead.`,
      )
      return
    }
    if (result.status === 'no-base') {
      window.alert('Share is not configured with a public address, so a link cannot be created.')
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
  }

  const pickTemplate = (id: string) => {
    const tpl = TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    // docs/mobile.md §MV3b — confirm before replacing, unless the session is
    // still the untouched first-boot sample. Cancel: the Templates sheet stays
    // open and nothing changes (no pause, no load, no rev bump).
    if (
      !useGraphStore.getState().pristineSample &&
      !window.confirm(`Replace the current diagram with "${tpl.name}"?`)
    ) {
      return
    }
    useSimStore.getState().pause()
    loadGraph(tpl.graph) // the existing atomic path — exactly one bump
    useMcStore.getState().applyRecommended(tpl.recommendedRunConfig)
    closeOverlay() // accept: the sheet closes, focus returns to the More button
  }

  const graphJSON = () => {
    downloadText(exportJSON({ ...useMcStore.getState().config }), 'loop-studio-graph.json')
    closeOverlay()
  }

  const projectRevision = () => {
    closeOverlay()
    if (!window.confirm(PROJECT_REVISION_DISCLOSURE)) return
    const r = exportProjectRevision()
    if (!r.ok) window.alert(r.message)
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

    const included: string[] = ['run config']
    if (mc.status === 'done' && mc.result) included.push(`the ${mc.config.runs}-run distribution`)
    included.push('the timeline view', 'the canvas position', `the live run at step ${sim.stepIndex}`)
    const summary =
      `Save this workspace?\n\nIncludes: ${included.join(', ')}.\n` +
      `Not included: undo history, selection, theme.`
    const write = (opt: WorkspaceFileOption) => downloadText(opt.text, 'loop-studio-workspace.json')

    if (decision.kind === 'reject') {
      window.alert(
        `This workspace is ${MiB(decision.bytes)} — over the ${MiB(WORKSPACE_MAX_BYTES)} limit even without the distribution. ` +
          `Trim the graph, or use Graph JSON.`,
      )
    } else if (decision.kind === 'confirm-omit') {
      if (
        window.confirm(
          `${summary}\n\nThe distribution makes this ${MiB(decision.full.bytes)} — over the ${MiB(WORKSPACE_MAX_BYTES)} limit. ` +
            `Save without the distribution (${MiB(decision.lean.bytes)})?`,
        )
      ) {
        write(decision.lean)
      }
    } else if (window.confirm(summary)) {
      write(decision.option)
    }
    closeOverlay()
  }

  if (overlay === 'more') {
    return (
      <MobileSheet title={t('mobile.more')} onClose={() => closeOverlay('more')} returnFocusTo={() => moreBtnRef.current}>
        <button
          type="button"
          className="sheet__row sheet__row--first"
          onClick={() => void onShare()}
        >
          Share link
        </button>
        <button
          type="button"
          className="sheet__row"
          onClick={() => {
            closeOverlay('more')
            fileInputRef.current?.click()
          }}
        >
          Import file
          <span className="sheet__row-sub">Graph or Workspace JSON</span>
        </button>
        <button type="button" className="sheet__row" onClick={() => openOverlay('export')}>
          Export<span className="sheet__row-sub">▸</span>
        </button>
        <button type="button" className="sheet__row" onClick={() => openOverlay('templates')}>
          Templates<span className="sheet__row-sub">▸</span>
        </button>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('theme.rowLabel')}<span className="sheet__row-sub"><ThemeToggle /></span>
        </div>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          {t('lang.rowLabel')}<span className="sheet__row-sub"><LanguageSwitch /></span>
        </div>
        <div className="sheet__stamp">
          v{__APP_VERSION__}
          {__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}
        </div>
      </MobileSheet>
    )
  }

  if (overlay === 'templates') {
    return (
      <MobileSheet
        title="Templates"
        onClose={() => closeOverlay('templates')}
        returnFocusTo={backToMore}
      >
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="sheet__row" onClick={() => pickTemplate(t.id)}>
            {t.name}
            <span className="sheet__row-sub">{t.blurb}</span>
          </button>
        ))}
      </MobileSheet>
    )
  }

  if (overlay === 'export') {
    return (
      <MobileSheet title="Export" onClose={() => closeOverlay('export')} returnFocusTo={backToMore}>
        <button type="button" className="sheet__row" onClick={graphJSON}>
          Graph JSON<span className="sheet__row-sub">diagram + run settings</span>
        </button>
        <button type="button" className="sheet__row" onClick={workspaceJSON}>
          Workspace JSON<span className="sheet__row-sub">graph + distribution + view</span>
        </button>
        <button type="button" className="sheet__row" onClick={projectRevision}>
          Project revision<span className="sheet__row-sub">graph + project id &amp; lineage</span>
        </button>
        <button
          type="button"
          className="sheet__row"
          onClick={proposal}
          disabled={!projectOpen}
        >
          Make a proposal<span className="sheet__row-sub">a copy to edit and send back</span>
        </button>
        <button type="button" className="sheet__row" onClick={() => setAuthorOpen(true)}>
          Author for exports…<span className="sheet__row-sub">device-local, unverified label</span>
        </button>
        <AuthorDialog open={authorOpen} onClose={() => setAuthorOpen(false)} returnFocusTo={backToMore} />
      </MobileSheet>
    )
  }

  if (overlay === 'share' && sharePanel) {
    return (
      <MobileSheet
        title="Share link"
        onClose={() => {
          setSharePanel(null)
          closeOverlay('share')
        }}
        returnFocusTo={backToMore}
      >
        <div className="share-pop__status">
          {sharePanel.copied ? 'Link copied to the clipboard.' : 'Copy this link:'}
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
