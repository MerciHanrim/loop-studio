import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  computeToolbarLayout,
  OVERFLOW_ORDER,
  type OverflowItem,
  type ToolbarLayout,
  type ToolbarMetrics,
} from './toolbarOverflow'

const OVERFLOW_SLACK = 4

// The measured overflow controller for Tier 1 of the desktop toolbar (the
// project/app-command row — Tier 2's node palette is always its own row and
// is never measured here). It watches Tier 1's width (ResizeObserver) and
// re-runs a full measurement whenever the active locale or the project
// chip's presence changes — those alter control widths. `computeToolbarLayout`
// (pure) then decides how many trailing GROUPS collapse into the ⋯ menu. See
// `toolbarOverflow.ts`.

export type ToolbarRefs = {
  toolbar: HTMLElement | null
  brand: HTMLElement | null
  /** the never-collapsed action cluster (undo + redo + Templates [+ chip]) */
  core: HTMLElement | null
  /** the ⋯ overflow trigger */
  more: HTMLElement | null
  /** outer wrapper of each collapsible group, by id */
  items: Partial<Record<OverflowItem, HTMLElement | null>>
}

const FALLBACK_ITEM = 72
const FALLBACK_MORE = 30

function emptyRefs(): ToolbarRefs {
  return { toolbar: null, brand: null, core: null, more: null, items: {} }
}

const boxW = (el: Element | null | undefined): number =>
  el ? el.getBoundingClientRect().width : 0

const gapOf = (el: Element | null): number => {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0
}

export function useToolbarOverflow(locale: string, projectOpen: boolean) {
  const [layout, setLayout] = useState<ToolbarLayout>({ collapsed: 0 })
  // while true, the toolbar renders EVERYTHING expanded for one synchronous
  // (pre-paint) pass so every control's width can be read fresh.
  const [measuring, setMeasuring] = useState(true)

  const refs = useRef<ToolbarRefs>(emptyRefs())
  const cache = useRef<{
    more: number
    items: Partial<Record<OverflowItem, number>>
  }>({ more: FALLBACK_MORE, items: {} })

  // Read every region's TRUE width. Only ever called during the `measuring`
  // pass, when the toolbar renders everything expanded and (via `[data-measuring]`
  // CSS) `nowrap` + `overflow: visible`, so nothing is clipped or squeezed and
  // every collapsible control is in the DOM.
  const readMetrics = useCallback((): ToolbarMetrics | null => {
    const r = refs.current
    const tb = r.toolbar
    if (!tb) return null
    const cs = getComputedStyle(tb)
    const inner = tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    // the gap BETWEEN brand / actions on Tier 1's line is the column-gap
    const topGap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 8

    const brandBase = boxW(r.brand)

    const core = boxW(r.core)
    const actionGap = gapOf(r.core?.parentElement ?? null) || 6

    const moreW = boxW(r.more)
    if (moreW > 0) cache.current.more = moreW

    const items = OVERFLOW_ORDER.map((id) => {
      const w = boxW(r.items[id])
      if (w > 0) {
        cache.current.items[id] = w
        return w
      }
      return cache.current.items[id] ?? FALLBACK_ITEM
    })

    return {
      inner,
      topGap,
      actionGap,
      brandBase: Math.max(0, brandBase),
      core,
      more: cache.current.more,
      items,
    }
  }, [])

  // locale / project-chip change → re-measure from scratch
  useLayoutEffect(() => {
    setMeasuring(true)
  }, [locale, projectOpen])

  // width changes → re-measure from scratch too (debounced). A full pass avoids
  // stale cached widths for controls that were collapsed at the previous width.
  // A ResizeObserver catches the toolbar's box changing (e.g. a scrollbar
  // appearing); a window `resize` listener is the reliable viewport signal.
  useEffect(() => {
    let raf = 0
    let lastWidth = refs.current.toolbar?.clientWidth ?? 0
    const ping = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setMeasuring(true))
    }
    const tb = refs.current.toolbar
    const ro =
      tb && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const w = tb.clientWidth
            if (w === lastWidth) return
            lastWidth = w
            ping()
          })
        : null
    ro?.observe(tb!)
    const onWinResize = () => {
      lastWidth = refs.current.toolbar?.clientWidth ?? lastWidth
      ping()
    }
    window.addEventListener('resize', onWinResize)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', onWinResize)
    }
  }, [])

  // the measurement pass — runs before paint (useLayoutEffect), so the expanded
  // state never reaches the screen
  useLayoutEffect(() => {
    if (!measuring) return
    const m = readMetrics()
    if (m) {
      const next = computeToolbarLayout(m)
      setLayout((prev) => (prev.collapsed === next.collapsed ? prev : next))
    }
    setMeasuring(false)
  }, [measuring, readMetrics])

  // safety net: Tier 1 still doesn't fit at the computed collapse count (the
  // line is clipped) — escalate to the maximum collapse. Never loops — that
  // state is the ladder's end.
  useLayoutEffect(() => {
    if (measuring) return
    const tb = refs.current.toolbar
    if (!tb) return
    const overflows = tb.scrollWidth > tb.clientWidth + OVERFLOW_SLACK
    if (!overflows) return
    if (layout.collapsed >= OVERFLOW_ORDER.length) return
    setLayout({ collapsed: OVERFLOW_ORDER.length })
  }, [measuring, layout])

  // stable callback-ref setters — the ref object stays private to the hook
  const setToolbar = useCallback((el: HTMLElement | null) => {
    refs.current.toolbar = el
  }, [])
  const setBrand = useCallback((el: HTMLElement | null) => {
    refs.current.brand = el
  }, [])
  const setCore = useCallback((el: HTMLElement | null) => {
    refs.current.core = el
  }, [])
  const setMore = useCallback((el: HTMLElement | null) => {
    refs.current.more = el
  }, [])
  const itemSetters = useRef<Partial<Record<OverflowItem, (el: HTMLElement | null) => void>>>({})
  const setItem = useCallback((id: OverflowItem) => {
    return (itemSetters.current[id] ??= (el: HTMLElement | null) => {
      refs.current.items[id] = el
    })
  }, [])

  return {
    layout,
    measuring,
    setToolbar,
    setBrand,
    setCore,
    setMore,
    setItem,
  }
}
