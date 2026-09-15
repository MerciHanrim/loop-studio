import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { BUNDLED_MODULES, cloneModuleDoc } from '../model/modules'
import type { GraphDocLike } from '../model/moduleGraph'
import { useGraphStore } from '../store/graphStore'
import { planSelectionAsModule, readModuleFile } from '../store/moduleIO'
import { useI18n, useT } from '../i18n'
import { moduleLabelOverlay } from '../i18n/moduleLabels'
import { MODULE_KEY } from './moduleKeys'
import type { ToolbarDialog } from './toolbar/dialogTypes'
import { useMenuOpenStore } from './toolbar/menuOpenStore'

// docs/module-system.md §MS6 — the v1 assembly surface: an "Insert module ▾"
// menu with the bundled Building blocks + "From file…" (no `#g1=` link — MS7-7),
// plus "Extract selection as module…". Picking a block inserts it at the
// viewport centre; dragging one drops it at the pointer (Canvas handles the
// `application/loop-module` payload). Every insert is one atomic history entry
// (`graphStore.insertModule` — §MS3.5).

// Kept in sync with the same literal in `Canvas.tsx` (mirrors how `DND_TYPE`
// for palette nodes is duplicated between `Canvas.tsx` and `Toolbar.tsx`).
const MODULE_DND_TYPE = 'application/loop-module'

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// Review condition 3 (applied here for the same reason as Export/Data/Help):
// the "promote to v2" and "frames excluded" confirms no longer live here —
// they're lifted to `Toolbar.tsx`'s `DialogHost`, since Module is a real
// `OVERFLOW_ORDER` member and can collapse into `…` like any other group.
// `onOpenDialog` replaces the local dialog state; `onLeave` is called first
// by the actions that need the same ancestor-close treatment but don't
// always end up opening a dialog (insert, pick-from-file, extract).
export function ModuleMenu({
  buttonRef,
  onOpenDialog,
  onLeave,
}: {
  buttonRef?: (el: HTMLButtonElement | null) => void
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const insertModule = useGraphStore((s) => s.insertModule)
  const { screenToFlowPosition } = useReactFlow()

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

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('module', open)
    return () => useMenuOpenStore.getState().setOpen('module', false)
  }, [open])

  // viewport-centre drop point for a menu-click insert (a drag carries its own).
  const centre = () => {
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    return screenToFlowPosition({ x, y })
  }

  /** Apply one insert. `confirmedPromotion` skips the v2 consent (the dialog
   *  set it); a `needs-v2-consent` refusal opens that dialog and changes
   *  nothing. `bundledModuleId`, when given, is a `BUNDLED_MODULES` id — the
   *  ONLY case `insertModule` registers module-label-sync provenance for
   *  (docs/bundled-module-label-localization.md §MLS4.1); a file-inserted
   *  module never passes it. */
  const runInsert = (doc: GraphDocLike, confirmedPromotion: boolean, bundledModuleId?: string) => {
    const r = insertModule(doc, { at: centre(), confirmedPromotion, bundledModuleId })
    if (r.ok) {
      onLeave()
      return
    }
    if (r.reason === 'needs-v2-consent') {
      onOpenDialog({ kind: 'module-promote', run: () => runInsert(doc, true, bundledModuleId) })
      return
    }
    onLeave()
    window.alert(`${t('modules.error.title')}\n${r.reason}`)
  }

  const insertBundled = (id: string) => {
    setOpen(false)
    const block = BUNDLED_MODULES.find((m) => m.id === id)
    if (block) {
      const locale = useI18n.getState().activeLocale
      runInsert(cloneModuleDoc(block, moduleLabelOverlay(id, locale)), false, id)
    }
  }

  const handleFileText = (text: string) => {
    const r = readModuleFile(text)
    if (!r.ok) {
      onLeave()
      window.alert(`${t('modules.error.title')}\n${r.reason}`)
      return
    }
    // §MS3.7 / B3 — a module file with saved frames: state the exclusion first,
    // then insert without them.
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
    setOpen(false)
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

  const extract = () => {
    setOpen(false)
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
          if (p.ok) download(p.text, p.filename)
          else window.alert(p.reason)
        },
      })
      return
    }
    onLeave()
    download(plan.text, plan.filename)
  }

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t('modules.button')}
      </button>
      {open ? (
        <div className="menu__pop menu__pop--scrollable" role="menu" aria-label={t('modules.menuLabel')}>
          {BUNDLED_MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              className="menu__item"
              role="menuitem"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MODULE_DND_TYPE, m.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => insertBundled(m.id)}
            >
              <span className="menu__name">{t(MODULE_KEY[m.id as keyof typeof MODULE_KEY].name)}</span>
              <span className="menu__blurb">{t(MODULE_KEY[m.id as keyof typeof MODULE_KEY].blurb)}</span>
            </button>
          ))}
          <button type="button" className="menu__item" role="menuitem" onClick={pickFile}>
            <span className="menu__name">{t('modules.fromFile')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={extract}>
            <span className="menu__name">{t('modules.extract')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
