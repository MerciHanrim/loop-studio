import { useEffect } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useIsMobile } from '../ui/media'

const isTypingTarget = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/**
 * Global keyboard shortcuts. Undo/redo never fire while a text field or select
 * is focused, so the browser's native field undo is left untouched. The sim
 * store resets itself off graphStore.structureRev, so nothing to do here.
 */
export function Shortcuts() {
  const isMobile = useIsMobile()
  useEffect(() => {
    // docs/mobile.md §MV3a — no structural keyboard shortcuts (undo/redo) on
    // mobile; editing is desktop-only.
    if (isMobile) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useGraphStore.getState().undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        useGraphStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile])
  return null
}
