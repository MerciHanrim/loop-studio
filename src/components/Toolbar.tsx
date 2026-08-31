import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../store/graphStore'
import type { NodeKind } from '../model/types'
import { useReviewStore } from '../store/reviewStore'
import { routeImport } from '../store/revisionIO'
import { useIsMobile } from '../ui/media'
import { useT, type MessageKey } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportMenu } from './ExportMenu'
import { LanguageSwitch } from './LanguageSwitch'
import { Logo } from './Logo'
import { MobileTopBar } from './mobile/MobileTopBar'
import { RevisionChip } from './RevisionChip'
import { ShareButton } from './ShareButton'
import { Templates } from './Templates'
import { ThemeToggle } from './ThemeToggle'

const DND_TYPE = 'application/loop-node'

// The palette BUTTON label is chrome (keyed); a click still creates a node with
// the locale-independent `defaultData()` label (docs/localization.md §L3.4).
const PALETTE: { kind: NodeKind; labelKey: MessageKey; glyph: string }[] = [
  { kind: 'pool', labelKey: 'toolbar.node.pool', glyph: '◉' },
  { kind: 'source', labelKey: 'toolbar.node.source', glyph: '＋' },
  { kind: 'drain', labelKey: 'toolbar.node.drain', glyph: '－' },
  { kind: 'gate', labelKey: 'toolbar.node.gate', glyph: '◇' },
  { kind: 'converter', labelKey: 'toolbar.node.converter', glyph: '⇄' },
  { kind: 'end', labelKey: 'toolbar.node.end', glyph: '⊗' },
  { kind: 'parameter', labelKey: 'toolbar.node.parameter', glyph: '▭' },
  { kind: 'register', labelKey: 'toolbar.node.register', glyph: '＝' },
]

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const newBtnRef = useRef<HTMLButtonElement>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const addNodeAt = useGraphStore((s) => s.addNodeAt)
  const newGraph = useGraphStore((s) => s.newGraph)
  const undo = useGraphStore((s) => s.undo)
  const redo = useGraphStore((s) => s.redo)
  const canUndo = useGraphStore((s) => s.canUndo)
  const canRedo = useGraphStore((s) => s.canRedo)
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow()
  const isMobile = useIsMobile()
  const t = useT()

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
          window.alert(err instanceof Error ? err.message : 'Could not read that file.')
        }
      },
      () => window.alert('Could not read that file.'),
    )
  }

  // docs/mobile.md §MV6 — the mobile layout replaces the whole editing toolbar
  // with a compact bar (Logo + a More menu). Desktop is untouched below.
  if (isMobile) return <MobileTopBar />

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__mark">
          <Logo />
        </span>
        <span className="toolbar__word">Loop Studio</span>
        <span className="toolbar__tag">{t('toolbar.preview')}</span>
        <span
          className="toolbar__build"
          title={t('toolbar.buildTitle', { version: __APP_VERSION__, sha: __BUILD_SHA__ })}
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
            title={t('toolbar.node.addTitle', { name: t(p.labelKey) })}
          >
            <span className="chip__glyph">{p.glyph}</span>
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      <div className="toolbar__actions">
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
        <ThemeToggle />
        <LanguageSwitch />
        <button
          ref={newBtnRef}
          type="button"
          className="btn"
          onClick={() => setConfirmNew(true)}
        >
          {t('toolbar.new')}
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          {t('toolbar.import')}
        </button>
        <RevisionChip />
        <ShareButton />
        <ExportMenu getViewport={getViewport} />
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
        returnFocusTo={() => newBtnRef.current}
      />
    </header>
  )
}
