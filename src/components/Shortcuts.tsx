import { useEffect } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'

const isTypingTarget = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

// docs/large-graph-readability.md §LGR4.3 - `]` / `[` step the selection through
// the drawn-edge neighbours of the node the walk started from. The origin + its
// neighbour list (sorted by id) are remembered so repeated presses rotate
// through the set; any selection change from outside this walk resets it.
type EdgeLike = { source: string; target: string }
let walk: { from: string; list: string[]; i: number } | null = null

const neighboursOf = (id: string, edges: readonly EdgeLike[]): string[] =>
  [
    ...new Set(
      edges
        .filter((e) => e.source === id || e.target === id)
        .map((e) => (e.source === id ? e.target : e.source))
        .filter((n) => n !== id),
    ),
  ].sort()

function stepConnected(dir: 1 | -1): void {
  const g = useGraphStore.getState()
  const sel = g.selectedNodeId
  if (!sel) return
  const continuing =
    walk != null &&
    walk.list[walk.i] === sel &&
    walk.list.join(' ') === neighboursOf(walk.from, g.edges).join(' ')
  if (continuing && walk) {
    walk.i = (walk.i + dir + walk.list.length) % walk.list.length
  } else {
    const list = neighboursOf(sel, g.edges)
    if (list.length === 0) return
    walk = { from: sel, list, i: dir === 1 ? 0 : list.length - 1 }
  }
  g.setSelection(walk.list[walk.i], null)
}

/**
 * Global keyboard shortcuts. Undo/redo never fire while a text field or select
 * is focused, so the browser's native field undo is left untouched. The sim
 * store resets itself off graphStore.structureRev, so nothing to do here.
 */
export function Shortcuts() {
  const isMobile = useIsMobile()
  const canvasLocked = useUiStore((s) => s.canvasLocked)
  useEffect(() => {
    // docs/mobile.md §MV3a - no structural keyboard shortcuts (undo/redo) on
    // mobile; editing is desktop-only. Same when the desktop Canvas is
    // edit-locked (uiStore.canvasLocked).
    if (isMobile || canvasLocked) return
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
  }, [isMobile, canvasLocked])

  // docs/large-graph-readability.md §LGR4.3 / LGR-D5 - Focus-view keyboard:
  //   - bare `f`     : toggle the Focus view
  //   - `]` / `[`    : select the next / previous node one drawn-edge hop from
  //                    the current selection (neighbours sorted by id, cyclic)
  // Pure view controls, so NOT gated on the edit-lock; they yield to a text
  // field and to a modifier combo (Ctrl/Cmd-F browser find is left alone). Not
  // wired on mobile (no hardware keyboard in the view/run layout).
  useEffect(() => {
    if (isMobile) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        useUiStore.getState().toggleFocusMode()
        return
      }
      if (e.key === ']' || e.key === '[') {
        e.preventDefault()
        stepConnected(e.key === ']' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile])
  return null
}
