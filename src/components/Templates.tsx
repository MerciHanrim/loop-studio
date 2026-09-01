import { useEffect, useRef, useState } from 'react'
import { TEMPLATES } from '../model/templates'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { TEMPLATE_KEY } from './templateKeys'

// Replacing the current diagram is confirmed through the shared in-app dialog —
// `loadGraph` runs only from Confirm (docs/localization.md Slice 2b).

export function Templates() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const loadGraph = useGraphStore((s) => s.loadGraph)
  const hasContent = useGraphStore((s) => s.nodes.length > 0 || s.edges.length > 0)

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

  const load = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl) return
    useSimStore.getState().pause() // stop any run before the swap
    loadGraph(tpl.graph) // one history entry; sim resets off structureRev
    useMcStore.getState().applyRecommended(tpl.recommendedRunConfig)
  }

  const pick = (id: string) => {
    setOpen(false)
    if (hasContent) setPending(id)
    else load(id)
  }

  const pendingName = pending
    ? t(TEMPLATE_KEY[pending as keyof typeof TEMPLATE_KEY].name)
    : ''

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
        {t('templates.button')}
      </button>
      {open ? (
        <div className="menu__pop" role="menu">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="menu__item"
              role="menuitem"
              onClick={() => pick(tpl.id)}
            >
              <span className="menu__name">
                {t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].name)}
              </span>
              <span className="menu__blurb">
                {t(TEMPLATE_KEY[tpl.id as keyof typeof TEMPLATE_KEY].blurb)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={pending != null}
        title={t('templates.replace.title')}
        body={t('templates.replace.body', { name: pendingName })}
        confirmLabel={t('templates.replace.confirm')}
        onConfirm={() => {
          const id = pending
          setPending(null)
          if (id != null) load(id)
        }}
        onCancel={() => setPending(null)}
        returnFocusTo={() => btnRef.current}
      />
    </div>
  )
}
