import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { BUNDLED_MODULES, cloneModuleDoc } from '../model/modules'
import type { GraphDocLike } from '../model/moduleGraph'
import { useGraphStore } from '../store/graphStore'
import { planSelectionAsModule, readModuleFile } from '../store/moduleIO'
import { useT } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { MODULE_KEY } from './moduleKeys'

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

type FramesNotice = { dir: 'insert'; doc: GraphDocLike } | { dir: 'extract' }

export function ModuleMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [promoteDoc, setPromoteDoc] = useState<GraphDocLike | null>(null)
  const [framesNotice, setFramesNotice] = useState<FramesNotice | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  // viewport-centre drop point for a menu-click insert (a drag carries its own).
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
    if (r.ok) return
    if (r.reason === 'needs-v2-consent') {
      setPromoteDoc(doc)
      return
    }
    window.alert(`${t('modules.error.title')}\n${r.reason}`)
  }

  const insertBundled = (id: string) => {
    setOpen(false)
    const block = BUNDLED_MODULES.find((m) => m.id === id)
    if (block) runInsert(cloneModuleDoc(block), false)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setOpen(false)
    if (!file) return
    file.text().then(
      (text) => {
        const r = readModuleFile(text)
        if (!r.ok) {
          window.alert(`${t('modules.error.title')}\n${r.reason}`)
          return
        }
        // §MS3.7 / B3 — a module file with saved frames: state the exclusion
        // first, then insert without them.
        if (r.hadFrames) setFramesNotice({ dir: 'insert', doc: r.module })
        else runInsert(r.module, false)
      },
      () => window.alert(t('modules.error.title')),
    )
  }

  const extract = () => {
    setOpen(false)
    const plan = planSelectionAsModule()
    if (!plan.ok) {
      window.alert(plan.reason)
      return
    }
    if (plan.hadFrames) {
      setFramesNotice({ dir: 'extract' })
      return
    }
    download(plan.text, plan.filename)
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
        {t('modules.button')}
      </button>
      {open ? (
        <div className="menu__pop" role="menu" aria-label={t('modules.menuLabel')}>
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
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => fileRef.current?.click()}
          >
            <span className="menu__name">{t('modules.fromFile')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={extract}>
            <span className="menu__name">{t('modules.extract')}</span>
          </button>
        </div>
      ) : null}

      <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />

      <ConfirmDialog
        open={promoteDoc != null}
        title={t('modules.promote.title')}
        body={t('modules.promote.body')}
        confirmLabel={t('modules.promote.confirm')}
        onConfirm={() => {
          const doc = promoteDoc
          setPromoteDoc(null)
          if (doc) runInsert(doc, true)
        }}
        onCancel={() => setPromoteDoc(null)}
        returnFocusTo={() => btnRef.current}
      />

      <ConfirmDialog
        open={framesNotice != null}
        title={t('modules.frames.title')}
        body={
          framesNotice?.dir === 'extract'
            ? t('modules.frames.extractBody')
            : t('modules.frames.insertBody')
        }
        confirmLabel={t('modules.frames.continue')}
        onConfirm={() => {
          const n = framesNotice
          setFramesNotice(null)
          if (!n) return
          if (n.dir === 'insert') {
            runInsert(n.doc, false)
          } else {
            const plan = planSelectionAsModule()
            if (plan.ok) download(plan.text, plan.filename)
            else window.alert(plan.reason)
          }
        }}
        onCancel={() => setFramesNotice(null)}
        returnFocusTo={() => btnRef.current}
      />
    </div>
  )
}
