import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import type { NodeKind } from '../model/types'
import { ConfirmDialog } from './ConfirmDialog'
import { Logo } from './Logo'
import { Templates } from './Templates'
import { ThemeToggle } from './ThemeToggle'

const DND_TYPE = 'application/loop-node'

const PALETTE: { kind: NodeKind; label: string; glyph: string }[] = [
  { kind: 'pool', label: 'Pool', glyph: '◉' },
  { kind: 'source', label: 'Source', glyph: '＋' },
  { kind: 'drain', label: 'Drain', glyph: '－' },
  { kind: 'gate', label: 'Gate', glyph: '◇' },
  { kind: 'converter', label: 'Converter', glyph: '⇄' },
  { kind: 'end', label: 'End', glyph: '⊗' },
]

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const newBtnRef = useRef<HTMLButtonElement>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const newGraph = useGraphStore((s) => s.newGraph)
  const loadJSON = useGraphStore((s) => s.loadJSON)
  const exportJSON = useGraphStore((s) => s.exportJSON)
  const undo = useGraphStore((s) => s.undo)
  const redo = useGraphStore((s) => s.redo)
  const canUndo = useGraphStore((s) => s.canUndo)
  const canRedo = useGraphStore((s) => s.canRedo)
  const { screenToFlowPosition } = useReactFlow()

  const addCentered = (kind: NodeKind) => {
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const cx = (rect ? rect.left + rect.width / 2 : window.innerWidth / 2) + (Math.random() * 80 - 40)
    const cy = (rect ? rect.top + rect.height / 2 : window.innerHeight / 2) + (Math.random() * 80 - 40)
    addNodeAt(kind, screenToFlowPosition({ x: cx, y: cy }))
  }

  const onDragStart = (e: DragEvent, kind: NodeKind) => {
    e.dataTransfer.setData(DND_TYPE, kind)
    e.dataTransfer.effectAllowed = 'move'
  }

  const doExport = () => {
    // save the current Monte-Carlo settings alongside the graph so a shared
    // file reproduces the intended run
    const json = exportJSON({ ...useMcStore.getState().config })
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'loop-studio-graph.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(
      (text) => {
        try {
          useMcStore.getState().applyRecommended(loadJSON(text))
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Could not read that file.')
        }
      },
      () => window.alert('Could not read that file.'),
    )
  }

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__mark">
          <Logo />
        </span>
        <span className="toolbar__word">Loop Studio</span>
        <span className="toolbar__tag">preview</span>
        <span
          className="toolbar__build"
          title={`Loop Studio v${__APP_VERSION__} · build ${__BUILD_SHA__}`}
        >
          v{__APP_VERSION__}
          {__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}
        </span>
      </div>

      <div className="toolbar__palette">
        {PALETTE.map((p) => (
          <button
            key={p.kind}
            type="button"
            className={`chip chip--${p.kind}`}
            draggable
            onDragStart={(e) => onDragStart(e, p.kind)}
            onClick={() => addCentered(p.kind)}
            title={`Add ${p.label} — drag onto the canvas, or click`}
          >
            <span className="chip__glyph">{p.glyph}</span>
            {p.label}
          </button>
        ))}
      </div>

      <div className="toolbar__actions">
        <button
          type="button"
          className="btn btn--icon"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl/Cmd+Z)"
        >
          ↶
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          ↷
        </button>
        <Templates />
        <ThemeToggle />
        <button
          ref={newBtnRef}
          type="button"
          className="btn"
          onClick={() => setConfirmNew(true)}
        >
          New
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button type="button" className="btn" onClick={doExport}>
          Export
        </button>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />
      </div>

      <ConfirmDialog
        open={confirmNew}
        title="Start a new graph?"
        body="Your current graph will be replaced."
        confirmLabel="New graph"
        onConfirm={() => {
          setConfirmNew(false)
          newGraph()
        }}
        onCancel={() => setConfirmNew(false)}
        returnFocusTo={() => newBtnRef.current}
      />
    </header>
  )
}
