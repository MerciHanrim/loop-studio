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
import { DescribedRow } from './toolbar/DescribedMenu'

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
 *  The workbench (docs/workbench.md §WB2.2, 2026-10-23): the four formats are
 *  the rows of File ▸ Export, a submenu row like any other menu's (the
 *  2026-09-15 nested `Export ▾` read as a pill button inside the popover; this
 *  is a menu row). Each row is a name; its description shows in the
 *  submenu's description area. Set the export author… is File's own row
 *  (`AuthorMenuItem`). This component owns no trigger, no popover, and no
 *  open/closed state of its own; `FileMenu.tsx` renders it in the submenu.
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

  const run = t('workbench.file.exportRun')
  return (
    <>
      <DescribedRow name={t('export.graphJson.name')} description={t('export.graphJson.blurb')} action={run} onSelect={graphJSON} />
      <DescribedRow name={t('export.workspaceJson.name')} description={t('export.workspaceJson.blurb')} action={run} onSelect={workspaceJSON} />
      <DescribedRow name={t('export.projectRevision.name')} description={t('export.projectRevision.blurb')} action={run} onSelect={projectRevision} />
      <DescribedRow
        name={t('export.proposal.name')}
        description={t('export.proposal.blurb')}
        action={run}
        onSelect={proposal}
        disabledNote={projectOpen ? undefined : t('export.proposal.needRevision')}
      />
    </>
  )
}

/** File's "Set the export author…" row: its own row in File's settings group,
 *  not an export format (docs/workbench.md §WB2.2) */
export function AuthorMenuItem({ onOpenDialog }: { onOpenDialog: (desc: ToolbarDialog) => void }) {
  const t = useT()
  return <DescribedRow name={t('export.author.name')} description={t('export.author.blurb')} onSelect={() => onOpenDialog({ kind: 'export-author' })} />
}
