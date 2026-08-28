import { useEffect, useRef, useState } from 'react'
import { WORKSPACE_MAX_BYTES } from '../model/workspace'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import {
  decideWorkspaceExport,
  planWorkspaceExport,
  type Viewport,
  type WorkspaceFileOption,
} from '../store/workspaceIO'

const MiB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MiB`

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** §W8 — `Export ▾` → Graph JSON (today's file) / Workspace JSON (graph + run
 *  config + last completed distribution + view + canvas + a verified sim
 *  snapshot). Workspace JSON confirms once (a what's-in / what's-out summary,
 *  so there is always a cancel path) and enforces the §W4 8 MiB cap. */
export function ExportMenu({ getViewport }: { getViewport: () => Viewport }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const exportJSON = useGraphStore((s) => s.exportJSON)

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

  const workspaceJSON = () => {
    setOpen(false)
    const mc = useMcStore.getState()
    const sim = useSimStore.getState()
    const { full, lean } = planWorkspaceExport(getViewport())
    // dev-only: E2E lowers the cap to exercise the §W4 prompts on small files.
    const cap = import.meta.env.DEV
      ? ((window as unknown as { __workspaceMaxBytes?: number }).__workspaceMaxBytes ?? WORKSPACE_MAX_BYTES)
      : WORKSPACE_MAX_BYTES
    const decision = decideWorkspaceExport(full, lean, cap)

    const included: string[] = ['run config']
    if (mc.status === 'done' && mc.result) included.push(`the ${mc.config.runs}-run distribution`)
    included.push('the timeline view', 'the canvas position', `the live run at step ${sim.stepIndex}`)
    const summary =
      `Save this workspace?\n\nIncludes: ${included.join(', ')}.\n` +
      `Not included: undo history, selection, theme.`

    const write = (opt: WorkspaceFileOption) => download(opt.text, 'loop-studio-workspace.json')

    if (decision.kind === 'reject') {
      window.alert(
        `This workspace is ${MiB(decision.bytes)} — over the ${MiB(WORKSPACE_MAX_BYTES)} limit even without the distribution. ` +
          `Trim the graph, or use Graph JSON.`,
      )
      return
    }
    if (decision.kind === 'confirm-omit') {
      const ok = window.confirm(
        `${summary}\n\nThe distribution makes this ${MiB(decision.full.bytes)} — over the ${MiB(WORKSPACE_MAX_BYTES)} limit. ` +
          `Save without the distribution (${MiB(decision.lean.bytes)})?`,
      )
      if (ok) write(decision.lean)
      return
    }
    if (window.confirm(summary)) write(decision.option)
  }

  return (
    <div className="menu" ref={wrapRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Export ▾
      </button>
      {open ? (
        <div className="menu__pop" role="menu">
          <button type="button" className="menu__item" role="menuitem" onClick={graphJSON}>
            <span className="menu__name">Graph JSON</span>
            <span className="menu__blurb">the diagram + recommended run settings</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={workspaceJSON}>
            <span className="menu__name">Workspace JSON</span>
            <span className="menu__blurb">graph + distribution + view + the live run</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

