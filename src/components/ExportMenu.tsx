import { useProjectStore } from '../store/projectStore'
import { WORKSPACE_MAX_BYTES } from '../model/workspace'
import { useGraphStore } from '../store/graphStore'
import { recommendedRunConfigForExport, useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import {
  decideWorkspaceExport,
  planWorkspaceExport,
  type Viewport,
  type WorkspaceFileOption,
} from '../store/workspaceIO'
import { makeProposal } from '../ui/revisionActions'
import { useT } from '../i18n'
import type { ToolbarDialog } from './toolbar/dialogTypes'

const MiB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** §W8 — Graph JSON (today's file) / Workspace JSON (graph + run config +
 *  last completed distribution + view + canvas + a verified sim snapshot) /
 *  Project revision / Make a proposal / Author for exports. Workspace JSON
 *  confirms once (a what's-in / what's-out summary, so there is always a
 *  cancel path) and enforces the §W4 8 MiB cap.
 *
 *  Hanrim's visual review (2026-09-15): these 5 actions render directly as
 *  `File ▾`'s own menu rows (a divider below New/Import), not behind a
 *  nested `Export ▾` sub-trigger — the earlier nested version read as a
 *  small pill button awkwardly inserted into the popover. This component
 *  therefore owns no trigger, no popover, and no open/closed state of its
 *  own; `FileMenu.tsx` renders it as a plain fragment of `.menu__item` rows.
 *
 *  Review condition 3: the Project-revision / Workspace-JSON disclosures and
 *  the Author dialog live in `Toolbar.tsx`'s `DialogHost` (a stable
 *  ancestor) so `File ▾` can close without unmounting a dialog it just
 *  opened. `onOpenDialog` drives those three; `onLeave` is called first by
 *  the two actions that need the same ancestor-close treatment but open no
 *  dialog at all (Graph JSON's plain download, Proposal). */
export function ExportMenuItems({
  getViewport,
  onOpenDialog,
  onLeave,
}: {
  getViewport: () => Viewport
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}) {
  const t = useT()
  const exportJSON = useGraphStore((s) => s.exportJSON)
  const projectOpen = useProjectStore((s) => s.open)

  const graphJSON = () => {
    onLeave()
    download(exportJSON(recommendedRunConfigForExport()), 'loop-studio-graph.json')
  }

  const proposal = () => {
    onLeave()
    const r = makeProposal()
    if (!r.ok) window.alert(r.message)
  }

  // SEMANTICS-R.md §R2.1 — disclose, then (on Confirm, inside `DialogHost`)
  // plan + download + commit.
  const projectRevision = () => {
    onOpenDialog({ kind: 'export-revision' })
  }

  const workspaceJSON = () => {
    const mc = useMcStore.getState()
    const sim = useSimStore.getState()
    const { full, lean } = planWorkspaceExport(getViewport())
    const cap = import.meta.env.DEV
      ? ((window as unknown as { __workspaceMaxBytes?: number }).__workspaceMaxBytes ?? WORKSPACE_MAX_BYTES)
      : WORKSPACE_MAX_BYTES
    const decision = decideWorkspaceExport(full, lean, cap)

    if (decision.kind === 'reject') {
      window.alert(
        t('export.workspace.reject', {
          size: MiB(decision.bytes),
          limit: MiB(WORKSPACE_MAX_BYTES),
        }),
      )
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
    const write = (opt: WorkspaceFileOption) => () => download(opt.text, 'loop-studio-workspace.json')

    if (decision.kind === 'confirm-omit') {
      onOpenDialog({
        kind: 'export-workspace',
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
    onOpenDialog({
      kind: 'export-workspace',
      body: summary,
      confirmLabel: t('export.workspace.confirm'),
      run: write(decision.option),
    })
  }

  return (
    <>
      <div className="menu__divider" role="separator" />
      <button type="button" className="menu__item" role="menuitem" onClick={graphJSON}>
        <span className="menu__name">{t('export.graphJson.name')}</span>
        <span className="menu__blurb">{t('export.graphJson.blurb')}</span>
      </button>
      <button type="button" className="menu__item" role="menuitem" onClick={workspaceJSON}>
        <span className="menu__name">{t('export.workspaceJson.name')}</span>
        <span className="menu__blurb">{t('export.workspaceJson.blurb')}</span>
      </button>
      <button type="button" className="menu__item" role="menuitem" onClick={projectRevision}>
        <span className="menu__name">{t('export.projectRevision.name')}</span>
        <span className="menu__blurb">{t('export.projectRevision.blurb')}</span>
      </button>
      <button
        type="button"
        className="menu__item"
        role="menuitem"
        onClick={proposal}
        disabled={!projectOpen}
        title={projectOpen ? undefined : t('export.proposal.needRevision')}
      >
        <span className="menu__name">{t('export.proposal.name')}</span>
        <span className="menu__blurb">{t('export.proposal.blurb')}</span>
      </button>
      <button
        type="button"
        className="menu__item"
        role="menuitem"
        onClick={() => onOpenDialog({ kind: 'export-author' })}
      >
        <span className="menu__name">{t('export.author.name')}</span>
        <span className="menu__blurb">{t('export.author.blurb')}</span>
      </button>
    </>
  )
}
