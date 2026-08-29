import { useRef, type ChangeEvent } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { importFile } from '../../store/workspaceIO'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { Logo } from '../Logo'
import { MobileMoreMenu } from './MobileMoreMenu'

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
    // docs/mobile.md §MV3b — confirm before replacing the current document
    // (unless it is still the untouched first-boot sample).
    if (
      !useGraphStore.getState().pristineSample &&
      !window.confirm('Replace the current diagram with the imported file?')
    ) {
      return
    }
    file.text().then(
      async (text) => {
        try {
          const out = await importFile(text)
          if (out.canvas) setViewport(out.canvas, { duration: 0 })
          if (out.warnings.length) window.alert(out.warnings.join('\n'))
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
      <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />
    </header>
  )
}
