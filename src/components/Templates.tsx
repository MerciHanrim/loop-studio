import { useEffect, useRef, useState } from 'react'
import { TEMPLATES } from '../model/templates'
import { useGraphStore } from '../store/graphStore'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'

export function Templates() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
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

  const pick = (id: string) => {
    const tpl = TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    if (hasContent && !window.confirm(`Replace the current diagram with "${tpl.name}"?`)) return
    useSimStore.getState().pause() // stop any run before the swap
    loadGraph(tpl.graph) // one history entry; sim resets off structureRev
    useMcStore.getState().applyRecommended(tpl.recommendedRunConfig)
    setOpen(false)
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
        Templates ▾
      </button>
      {open ? (
        <div className="menu__pop" role="menu">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="menu__item"
              role="menuitem"
              onClick={() => pick(t.id)}
            >
              <span className="menu__name">{t.name}</span>
              <span className="menu__blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
