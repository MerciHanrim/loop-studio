import { useEffect } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'

const isTypingTarget = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Global keyboard shortcuts. Undo/redo do not fire while a text field is focused. */
export function Shortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      const g = useGraphStore.getState()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        g.undo()
        useSimStore.getState().reset()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        g.redo()
        useSimStore.getState().reset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
