import { useReactFlow } from '@xyflow/react'
import type { GraphDocLike } from '../model/moduleGraph'
import { useGraphStore } from '../store/graphStore'
import { useUiStore } from '../store/uiStore'
import { planSelectionAsModule, readModuleFile } from '../store/moduleIO'
import { useT } from '../i18n'
import { downloadText } from '../ui/download'
import type { ToolbarDialog } from './toolbar/dialogTypes'
import { DescribedRow } from './toolbar/DescribedMenu'

// docs/module-system.md §MS6 (2026-10) — the reuse of a saved structure, in the
// File menu: "Save selected structure…" writes the selected nodes and their
// internal connections to a file; "Insert saved structure…" adds such a file to
// the OPEN document. Import, above them, opens a whole document instead of this
// one — the two are kept apart by name and by description.
//
// The "Insert module ▾" menu and its two bundled blocks were removed (2026-10);
// these two actions are what remains of it, unchanged in behaviour: every insert
// is one atomic history entry (`graphStore.insertModule`, §MS3.5), a v2 file into
// a v1 document asks first, and saved frames are never carried.

export function StructureMenuItems({
  onOpenDialog,
  onLeave,
}: {
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}) {
  const t = useT()
  const insertModule = useGraphStore((s) => s.insertModule)
  // #334 — inserting edits the document; saving the selection (an export)
  // stays available while locked
  const editLocked = useUiStore((s) => s.canvasLocked)
  const { screenToFlowPosition } = useReactFlow()

  // the canvas's visible centre: where an inserted structure lands
  const centre = () => {
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    return screenToFlowPosition({ x, y })
  }

  /** Apply one insert. `confirmedPromotion` skips the v2 consent (the dialog
   *  set it); a `needs-v2-consent` refusal opens that dialog and changes
   *  nothing. */
  const runInsert = (doc: GraphDocLike, confirmedPromotion: boolean) => {
    const r = insertModule(doc, { at: centre(), confirmedPromotion })
    if (r.ok) {
      onLeave()
      return
    }
    if (r.reason === 'needs-v2-consent') {
      onOpenDialog({ kind: 'module-promote', run: () => runInsert(doc, true) })
      return
    }
    onLeave()
    window.alert(`${t('modules.error.title')}\n${r.reason}`)
  }

  const handleFileText = (text: string) => {
    const r = readModuleFile(text)
    if (!r.ok) {
      onLeave()
      window.alert(`${t('modules.error.title')}\n${r.reason}`)
      return
    }
    // §MS3.7 / B3 — a file with saved frames: state the exclusion first, then
    // insert without them.
    if (r.hadFrames) {
      onOpenDialog({
        kind: 'module-frames',
        body: t('modules.frames.insertBody'),
        run: () => runInsert(r.module, false),
      })
    } else {
      runInsert(r.module, false)
    }
  }

  // A transient `<input type=file>` — created, clicked, and discarded per pick —
  // so there is never a second standing file input in the toolbar (the app has
  // exactly one, the Import button's; e2e and other callers rely on that).
  const pickFile = () => {
    onLeave()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0] // captured before removal — the File stays valid
      input.remove()
      if (file) file.text().then(handleFileText, () => window.alert(t('modules.error.title')))
    })
    // a dismissed picker fires no `change`; sweep the element once the window is
    // focused again, deferred so a real `change` runs first.
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 200), { once: true })
    document.body.appendChild(input)
    input.click()
  }

  const saveSelection = () => {
    const plan = planSelectionAsModule()
    if (!plan.ok) {
      onLeave()
      window.alert(plan.reason)
      return
    }
    if (plan.hadFrames) {
      onOpenDialog({
        kind: 'module-frames',
        body: t('modules.frames.extractBody'),
        run: () => {
          const p = planSelectionAsModule()
          if (p.ok) downloadText(p.text, p.filename)
          else window.alert(p.reason)
        },
      })
      return
    }
    onLeave()
    downloadText(plan.text, plan.filename)
  }

  return (
    <>
      <div className="menu__divider" role="separator" />
      {/* names on one line; the descriptions show in File's description area
          (docs/workbench.md §WB2.2) */}
      <DescribedRow name={t('modules.extract')} description={t('modules.extract.blurb')} onSelect={saveSelection} />
      <DescribedRow
        name={t('modules.insertSaved')}
        description={t('modules.insertSaved.blurb')}
        onSelect={pickFile}
        disabledNote={editLocked ? t('modules.insertSaved.locked') : undefined}
      />
    </>
  )
}
