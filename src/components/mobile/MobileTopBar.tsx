import { useRef, type ChangeEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { useReviewStore } from '../../store/reviewStore'
import { routeImport } from '../../store/revisionIO'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { Logo } from '../Logo'
import { RevisionChip } from '../RevisionChip'
import { MobileMoreMenu } from './MobileMoreMenu'
import { MobileOpenFileHint } from './MobileOpenFileHint'

// docs/mobile.md §MV6 — the compact top bar: Logo mark, a "view & run" caption,
// and a single More button. No palette, no undo/redo, no New (editing is
// desktop-only).

export function MobileTopBar() {
  const fileRef = useRef<HTMLInputElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const overlay = useUiStore(selectOverlay)
  const toggleOverlay = useUiStore((s) => s.toggleOverlay)
  const { getViewport, setViewport } = useReactFlow()

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(
      async (text) => {
        try {
          // A proposal never replaces the document (§R10.5), so it needs no
          // replace-confirm; everything else does (docs/mobile.md §MV3b) unless
          // the session is still the untouched first-boot sample.
          let role: unknown
          try {
            role = (JSON.parse(text) as { project?: { role?: unknown } }).project?.role
          } catch {
            /* not JSON — routeImport will surface the error */
          }
          if (
            role !== 'proposal' &&
            !useGraphStore.getState().pristineSample &&
            !window.confirm('Replace the current diagram with the imported file?')
          ) {
            return
          }
          const r = await routeImport(text)
          if (r.kind === 'proposal') {
            useReviewStore.getState().open(r) // §R10.5 — Review only, no mutation
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

  return (
    <header className="toolbar toolbar--mobile">
      <span className="toolbar__mark">
        <Logo />
      </span>
      <span className="toolbar__vr">view &amp; run — edit on desktop</span>
      <RevisionChip className="rev-chip--mobile" />
      <button
        ref={moreRef}
        type="button"
        className="btn mob-more"
        aria-haspopup="dialog"
        aria-expanded={overlay === 'more'}
        aria-label="More"
        onClick={() => toggleOverlay('more')}
      >
        ⋯
      </button>

      <MobileMoreMenu fileInputRef={fileRef} moreBtnRef={moreRef} getViewport={getViewport} />
      <MobileOpenFileHint onOpenFile={() => fileRef.current?.click()} />
      <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />
    </header>
  )
}
