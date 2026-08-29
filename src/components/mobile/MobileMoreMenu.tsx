import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { TEMPLATES } from '../../model/templates'
import { WORKSPACE_MAX_BYTES } from '../../model/workspace'
import { useGraphStore } from '../../store/graphStore'
import { useMcStore } from '../../store/mcStore'
import { useSimStore } from '../../store/simStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import {
  decideWorkspaceExport,
  planWorkspaceExport,
  type Viewport,
  type WorkspaceFileOption,
} from '../../store/workspaceIO'
import { downloadText } from '../../ui/download'
import { SHARE_DISCLOSURE, prepareShareLink, shareKb } from '../../ui/shareAction'
import { useDialogFocus } from '../useDialogFocus'
import { ThemeToggle } from '../ThemeToggle'

// docs/mobile.md §MV6 — the compact top bar's "More" menu and its three
// sub-sheets (Share result / Templates / Export), each an exclusive overlay
// (§MV5 / §MV-D11). Import reuses the shell's hidden file input; Theme cycles
// in place. Heavy logic (share encode, workspace plan/decide) is shared with
// the desktop menus.

const MiB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`
const backToMore = () => document.querySelector<HTMLButtonElement>('.sheet__row--first')

function Sheet({
  title,
  onClose,
  returnFocusTo,
  children,
}: {
  title: string
  onClose: () => void
  returnFocusTo: () => HTMLElement | null | undefined
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(true, ref, onClose, returnFocusTo)
  return (
    <div className="sheet-scrim" onMouseDown={onClose}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <span className="sheet__title">{title}</span>
          <button type="button" className="sheet__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

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

  const exportJSON = useGraphStore((s) => s.exportJSON)
  const loadGraph = useGraphStore((s) => s.loadGraph)
  const hasContent = useGraphStore((s) => s.nodes.length > 0 || s.edges.length > 0)

  const [sharePanel, setSharePanel] = useState<{ url: string; copied: boolean } | null>(null)

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
    if (hasContent && !window.confirm(`Replace the current diagram with "${tpl.name}"?`)) return
    useSimStore.getState().pause()
    loadGraph(tpl.graph)
    useMcStore.getState().applyRecommended(tpl.recommendedRunConfig)
    closeOverlay()
  }

  const graphJSON = () => {
    downloadText(exportJSON({ ...useMcStore.getState().config }), 'loop-studio-graph.json')
    closeOverlay()
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
      <Sheet title="More" onClose={() => closeOverlay('more')} returnFocusTo={() => moreBtnRef.current}>
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
          Import…
        </button>
        <button type="button" className="sheet__row" onClick={() => openOverlay('export')}>
          Export<span className="sheet__row-sub">▸</span>
        </button>
        <button type="button" className="sheet__row" onClick={() => openOverlay('templates')}>
          Templates<span className="sheet__row-sub">▸</span>
        </button>
        <div className="sheet__row" style={{ cursor: 'default' }}>
          Theme<span className="sheet__row-sub"><ThemeToggle /></span>
        </div>
        <div className="sheet__stamp">
          v{__APP_VERSION__}
          {__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}
        </div>
      </Sheet>
    )
  }

  if (overlay === 'templates') {
    return (
      <Sheet
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
      </Sheet>
    )
  }

  if (overlay === 'export') {
    return (
      <Sheet title="Export" onClose={() => closeOverlay('export')} returnFocusTo={backToMore}>
        <button type="button" className="sheet__row" onClick={graphJSON}>
          Graph JSON<span className="sheet__row-sub">diagram + run settings</span>
        </button>
        <button type="button" className="sheet__row" onClick={workspaceJSON}>
          Workspace JSON<span className="sheet__row-sub">graph + distribution + view</span>
        </button>
      </Sheet>
    )
  }

  if (overlay === 'share' && sharePanel) {
    return (
      <Sheet
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
      </Sheet>
    )
  }

  return null
}
