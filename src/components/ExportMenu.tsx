import { useEffect, useRef, useState } from 'react'
import { WORKSPACE_MAX_BYTES } from '../model/workspace'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { useProjectStore } from '../store/projectStore'
import { useSimStore } from '../store/simStore'
import {
  decideWorkspaceExport,
  planWorkspaceExport,
  type Viewport,
  type WorkspaceFileOption,
} from '../store/workspaceIO'
import { exportProjectRevision, makeProposal } from '../ui/revisionActions'
import { useT } from '../i18n'
import { AuthorDialog } from './AuthorDialog'
import { ConfirmDialog } from './ConfirmDialog'

const MiB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// docs/localization.md Slice 2b — the Project-revision disclosure and the
// Workspace-JSON summary are in-app ConfirmDialogs now. Nothing is written
// (no download, no `exportProjectRevision`) until Confirm; the download runs
// inside the Confirm button's click event so it keeps user activation.
type Pending =
  | { kind: 'revision' }
  | { kind: 'workspace'; body: string; confirmLabel: string; run: () => void }
  | null

/** §W8 — `Export ▾` → Graph JSON (today's file) / Workspace JSON (graph + run
 *  config + last completed distribution + view + canvas + a verified sim
 *  snapshot). Workspace JSON confirms once (a what's-in / what's-out summary,
 *  so there is always a cancel path) and enforces the §W4 8 MiB cap. */
export function ExportMenu({ getViewport }: { getViewport: () => Viewport }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const exportJSON = useGraphStore((s) => s.exportJSON)
  const projectOpen = useProjectStore((s) => s.open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const graphJSON = () => {
    download(exportJSON({ ...useMcStore.getState().config }), 'loop-studio-graph.json')
    setOpen(false)
  }

  const proposal = () => {
    setOpen(false)
    const r = makeProposal()
    if (!r.ok) window.alert(r.message)
  }

  // SEMANTICS-R.md §R2.1 — disclose, then (on Confirm) plan + download + commit.
  const projectRevision = () => {
    setOpen(false)
    setPending({ kind: 'revision' })
  }
  const runProjectRevision = () => {
    setPending(null)
    const r = exportProjectRevision()
    if (!r.ok) window.alert(r.message)
  }

  const workspaceJSON = () => {
    setOpen(false)
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
      setPending({
        kind: 'workspace',
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
    setPending({
      kind: 'workspace',
      body: summary,
      confirmLabel: t('export.workspace.confirm'),
      run: write(decision.option),
    })
  }

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t('export.button')}
      </button>
      {open ? (
        <div className="menu__pop" role="menu">
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
            onClick={() => {
              setOpen(false)
              setAuthorOpen(true)
            }}
          >
            <span className="menu__name">{t('export.author.name')}</span>
            <span className="menu__blurb">{t('export.author.blurb')}</span>
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={pending?.kind === 'revision'}
        title={t('export.projectRevision.disclosure.title')}
        body={t('export.projectRevision.disclosure.body')}
        confirmLabel={t('export.projectRevision.disclosure.confirm')}
        onConfirm={runProjectRevision}
        onCancel={() => setPending(null)}
        returnFocusTo={() => btnRef.current}
      />
      <ConfirmDialog
        open={pending?.kind === 'workspace'}
        title={t('export.workspace.title')}
        body={pending?.kind === 'workspace' ? pending.body : ''}
        confirmLabel={pending?.kind === 'workspace' ? pending.confirmLabel : ''}
        onConfirm={() => {
          const p = pending
          setPending(null)
          if (p?.kind === 'workspace') p.run()
        }}
        onCancel={() => setPending(null)}
        returnFocusTo={() => btnRef.current}
      />

      <AuthorDialog
        open={authorOpen}
        onClose={() => setAuthorOpen(false)}
        returnFocusTo={() => btnRef.current}
      />
    </div>
  )
}
