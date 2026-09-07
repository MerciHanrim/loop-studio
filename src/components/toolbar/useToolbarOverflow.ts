import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  computeToolbarLayout,
  OVERFLOW_ORDER,
  STAMP_AFTER,
  type OverflowItem,
  type ToolbarLayout,
  type ToolbarMetrics,
} from './toolbarOverflow'

/** A single-row desktop toolbar is ~45px tall; past this the palette wrapped
 *  despite a `row` layout. `overflow: hidden` in row mode can also keep the
 *  height at ~45 while clipping horizontally, so we check `scrollWidth` too. */
const ONE_ROW_MAX_H = 58
const OVERFLOW_SLACK = 4

// The measured overflow controller for the desktop toolbar. It watches the
// toolbar's width (ResizeObserver) and re-runs a full measurement whenever the
// active locale or the project chip's presence changes — those alter control
// widths. `computeToolbarLayout` (pure) then decides the row count, the ⋯ menu
// contents, and whether the build stamp is shown. See `toolbarOverflow.ts`.

export type ToolbarRefs = {
  toolbar: HTMLElement | null
  brand: HTMLElement | null
  /** the `v… · <sha>` build stamp span */
  stamp: HTMLElement | null
  palette: HTMLElement | null
  /** the never-collapsed action cluster (undo + redo + Templates [+ chip]) */
  core: HTMLElement | null
  /** the ⋯ overflow trigger */
  more: HTMLElement | null
  /** outer wrapper of each collapsible control, by id */
  items: Partial<Record<OverflowItem, HTMLElement | null>>
}

const FALLBACK_ITEM = 72
const FALLBACK_MORE = 30
const FALLBACK_STAMP = 66

function emptyRefs(): ToolbarRefs {
  return { toolbar: null, brand: null, stamp: null, palette: null, core: null, more: null, items: {} }
}

const boxW = (el: Element | null | undefined): number =>
  el ? el.getBoundingClientRect().width : 0

const gapOf = (el: Element | null): number => {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0
}

export function useToolbarOverflow(locale: string, projectOpen: boolean) {
  const [layout, setLayout] = useState<ToolbarLayout>({
    mode: 'row',
    collapsed: 0,
    hideStamp: false,
  })
  // while true, the toolbar renders EVERYTHING expanded for one synchronous
  // (pre-paint) pass so every control's width can be read fresh.
  const [measuring, setMeasuring] = useState(true)

  const refs = useRef<ToolbarRefs>(emptyRefs())
  const cache = useRef<{
    stampSlot: number
    more: number
    items: Partial<Record<OverflowItem, number>>
  }>({ stampSlot: FALLBACK_STAMP, more: FALLBACK_MORE, items: {} })

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
    // the gap BETWEEN brand / palette / actions on one line is the column-gap
    const topGap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 8

    // palette: sum the chips + their gaps — never a stretched wrap-mode box
    let palette = 0
    if (r.palette) {
      const kids = Array.from(r.palette.children)
      palette =
        kids.reduce((s, k) => s + boxW(k), 0) + gapOf(r.palette) * Math.max(0, kids.length - 1)
    }

    // during measuring the stamp is always in normal flow → brandW includes it
    const brandW = boxW(r.brand)
    const stampW = boxW(r.stamp)
    if (stampW > 0) cache.current.stampSlot = stampW + gapOf(r.brand)
    const brandBase = brandW - cache.current.stampSlot

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
      stampSlot: cache.current.stampSlot,
      palette,
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
  // The RO reacts to WIDTH only — the measurement pass itself changes the
  // toolbar's HEIGHT, and reacting to that would loop.
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
      setLayout((prev) =>
        prev.mode === next.mode &&
        prev.collapsed === next.collapsed &&
        prev.hideStamp === next.hideStamp
          ? prev
          : next,
      )
    }
    setMeasuring(false)
  }, [measuring, readMetrics])

  // safety net: a `row` layout that still doesn't fit — the palette wrapped
  // (height) or the line is clipped (scrollWidth). Escalate to the maximum
  // one-row collapse. Never loops — that state is the ladder's end.
  useLayoutEffect(() => {
    if (measuring || layout.mode !== 'row') return
    const tb = refs.current.toolbar
    if (!tb) return
    const overflows =
      tb.offsetHeight > ONE_ROW_MAX_H || tb.scrollWidth > tb.clientWidth + OVERFLOW_SLACK
    if (!overflows) return
    if (layout.collapsed >= STAMP_AFTER && layout.hideStamp) return
    setLayout({ mode: 'row', collapsed: STAMP_AFTER, hideStamp: true })
  }, [measuring, layout])

  // stable callback-ref setters — the ref object stays private to the hook
  const setToolbar = useCallback((el: HTMLElement | null) => {
    refs.current.toolbar = el
  }, [])
  const setBrand = useCallback((el: HTMLElement | null) => {
    refs.current.brand = el
  }, [])
  const setStamp = useCallback((el: HTMLElement | null) => {
    refs.current.stamp = el
  }, [])
  const setPalette = useCallback((el: HTMLElement | null) => {
    refs.current.palette = el
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
    setStamp,
    setPalette,
    setCore,
    setMore,
    setItem,
  }
}
