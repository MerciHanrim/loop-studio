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
import { HelpMenu } from './HelpMenu'
import { LanguageSwitch } from './LanguageSwitch'
import { Logo } from './Logo'
import { MobileTopBar } from './mobile/MobileTopBar'
import { ModuleMenu } from './ModuleMenu'
import { RevisionChip } from './RevisionChip'
import { ShareButton } from './ShareButton'
import { Templates } from './Templates'
import { ThemeToggle } from './ThemeToggle'

const DND_TYPE = 'application/loop-node'

// The palette BUTTON label is chrome (keyed); a click still creates a node with
// the locale-independent `defaultData()` label (docs/localization.md §L3.4). The
// tip has three keyed layers — `.name` (also the button's accessible name),
// `.description` (semantic, matched to SEMANTICS-*), `palette.addAction` — each
// on its OWN DOM line, never concatenated (§L13 / Slice 2a).
const PALETTE: { kind: NodeKind; nameKey: MessageKey; descKey: MessageKey; glyph: string }[] = [
  { kind: 'pool', nameKey: 'palette.pool.name', descKey: 'palette.pool.description', glyph: '◉' },
  { kind: 'source', nameKey: 'palette.source.name', descKey: 'palette.source.description', glyph: '＋' },
  { kind: 'drain', nameKey: 'palette.drain.name', descKey: 'palette.drain.description', glyph: '－' },
  { kind: 'gate', nameKey: 'palette.gate.name', descKey: 'palette.gate.description', glyph: '◇' },
  { kind: 'converter', nameKey: 'palette.converter.name', descKey: 'palette.converter.description', glyph: '⇄' },
  { kind: 'end', nameKey: 'palette.end.name', descKey: 'palette.end.description', glyph: '⊗' },
  { kind: 'parameter', nameKey: 'palette.parameter.name', descKey: 'palette.parameter.description', glyph: '▭' },
  { kind: 'register', nameKey: 'palette.register.name', descKey: 'palette.register.description', glyph: '＝' },
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
          window.alert(err instanceof Error ? err.message : t('import.readError'))
        }
      },
      () => window.alert(t('import.readError')),
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

      <div className="toolbar__palette" data-tour="palette">
        {PALETTE.map((p) => (
          <span key={p.kind} className="palette-item">
            <button
              type="button"
              className={`chip chip--${p.kind}`}
              draggable
              onDragStart={(e) => onDragStart(e, p.kind)}
              onClick={() => addCentered(p.kind)}
              aria-describedby={`palette-tip-${p.kind}`}
            >
              <span className="chip__glyph" aria-hidden="true">
                {p.glyph}
              </span>
              {t(p.nameKey)}
            </button>
            {/* overlay tip — three separate lines, absolutely positioned so the
                Toolbar height and Canvas geometry never change (§L13). Shown on
                hover AND keyboard focus via `.palette-item:hover / :focus-within`. */}
            <span className="palette-tip" role="tooltip" id={`palette-tip-${p.kind}`}>
              <span className="palette-tip__name">{t(p.nameKey)}</span>
              <span className="palette-tip__desc">{t(p.descKey)}</span>
              <span className="palette-tip__how">{t('palette.addAction')}</span>
            </span>
          </span>
        ))}
      </div>

      <div className="toolbar__actions" data-tour="files">
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
        <ModuleMenu />
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
        <HelpMenu />
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
