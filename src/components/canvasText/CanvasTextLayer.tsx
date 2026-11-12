// docs/canvas-text-layer.md — the canvas text layer: at low zoom, where the
// canvas's own text is under 8 px on screen, each zone's name and the ONE
// selected node's name are drawn at 12 px on a layer above the canvas that
// takes no clicks (`pointer-events: none`), clipped to the pane. The places
// come from `textPlacement.ts`; they are kept between draws.
//
// Geometry is read from the rendered canvas only when it changes (a node or a
// line moved, a route settled, a node appeared), converted to WORLD
// coordinates and kept; a pan or a zoom only transforms it. During a node
// drag the lines are not re-read (no label is chosen against lines then).

import { useEffect, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { routeDiagnostics, useRouteInputs } from '../../store/routeMap'
import type { FrameRect } from '../../store/frameStore'
import { nodeDirs, nodeOnLayer, placeNode, placeZone, TEXT_SHOW_PX, ZONE_TEXT_PX, zoneOnLayer, type Box, type NodeSlot, type Obstacles, type ZoneSlot } from './textPlacement'

export type LayerZone = { id: string; text: string; rect: FrameRect }

type NodeGeom = { sym: Box; body: Box; name: string }
type Geometry = { nodes: Map<string, NodeGeom>; pts: Float32Array; edgeCount: number; linesRead: boolean }

/** world px between two sampled points of a line */
const LINE_STEP = 3
/** the longest a name is held back waiting for the routes to settle, ms: after it the lines read so far are taken as known */
export const SETTLE_WAIT_MS = 1500
/** the wait ends this much early, so the draw that shows the name (a timer, then an animation
 *  frame) lands within SETTLE_WAIT_MS of the moment it was first held back */
const SHOW_SLACK_MS = 50

/** the class FrameLayer's chip takes while its name is on the layer: its text
 *  is hidden, its click target stays (index.css) */
export const LAYER_NAMED_CLASS = 'is-layer-named'

/** every re-choice of a kept place, with when it happened, for the browser tests (dev builds only) */
type Rechoice = { t: number; kind: 'zone' | 'node'; text: string; reason: string }
const log = (r: Omit<Rechoice, 't'>) => {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __canvasTextRechoices?: Rechoice[] }
  ;(w.__canvasTextRechoices ??= []).push({ t: Math.round(performance.now()), ...r })
}
/** marks a chip re-chosen in this draw, with its reason (read by the browser tests) */
const markRechosen = (c: HTMLElement, reason: string) => {
  if (reason) { c.dataset.rechosen = '1'; c.dataset.reason = reason } else { delete c.dataset.rechosen; delete c.dataset.reason }
}

export function CanvasTextLayer({ zones }: { zones: LayerZone[] }) {
  const store = useStoreApi()
  const layerRef = useRef<HTMLDivElement>(null)
  const zonesRef = useRef(zones)
  const scheduleRef = useRef<(geom: boolean) => void>(() => {})

  useEffect(() => {
    zonesRef.current = zones
    scheduleRef.current(false)
  }, [zones])

  useEffect(() => {
    const layer = layerRef.current
    const root = layer?.parentElement // the `.react-flow` element
    if (!layer || !root) return
    const zoneSlots = new Map<string, ZoneSlot>()
    let nodeSlot: NodeSlot | null = null
    let geom: Geometry = { nodes: new Map(), pts: new Float32Array(0), edgeCount: 0, linesRead: false }
    const sizes = new Map<string, { w: number; h: number }>()
    const chips = new Map<string, HTMLDivElement>()
    let raf = 0
    let wantGeom = true
    let wasDragging = false
    // since when a name has been held back as provisional (null: none is), and the timer that ends the wait
    let heldSince: number | null = null
    let settleTimer = 0

    const dragging = () => useGraphStore.getState().nodes.some((n) => n.dragging)

    const readGeometry = (withLines: boolean) => {
      const [tx, ty, z] = store.getState().transform
      const o = root.getBoundingClientRect()
      const toWorld = (r: DOMRect): Box => ({ x: (r.left - o.left - tx) / z, y: (r.top - o.top - ty) / z, w: r.width / z, h: r.height / z })
      const nodes = new Map<string, NodeGeom>()
      for (const el of root.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = el.dataset.id
        if (!id) continue
        const sym = (el.querySelector('.nodef__stroke') ?? el).getBoundingClientRect()
        const body = (el.querySelector('.nodef') ?? el).getBoundingClientRect()
        nodes.set(id, { sym: toWorld(sym), body: toWorld(body), name: (el.querySelector('.nodef__name')?.textContent ?? '').trim() })
      }
      const paths = root.querySelectorAll<SVGGeometryElement>('.react-flow__edge-path')
      let pts = geom.pts
      if (withLines) {
        const out: number[] = []
        for (const p of paths) {
          let n = 0
          try { n = p.getTotalLength() } catch { continue }
          const m = p.getScreenCTM()
          if (!m || !n) continue
          for (let s = 0; s <= n; s += LINE_STEP) {
            const q = p.getPointAtLength(s)
            out.push((m.a * q.x + m.c * q.y + m.e - o.left - tx) / z, (m.b * q.x + m.d * q.y + m.f - o.top - ty) / z)
          }
        }
        pts = Float32Array.from(out)
      }
      geom = { nodes, pts, edgeCount: paths.length, linesRead: withLines || geom.linesRead }
    }

    // a chip element per label, reused between draws
    const chip = (key: string, kind: 'zone' | 'node', text: string): HTMLDivElement => {
      let c = chips.get(key)
      if (!c) {
        c = document.createElement('div')
        c.className = 'canvas-text__chip'
        c.dataset.kind = kind
        c.setAttribute('dir', 'auto')
        layer.append(c)
        chips.set(key, c)
      }
      if (c.textContent !== text) c.textContent = text
      return c
    }
    // its natural size, measured once per text, kind and language (the font differs by language)
    const sizeOf = (c: HTMLDivElement, kind: string, text: string) => {
      const k = `${kind}|${document.documentElement.lang}|${text}`
      let s = sizes.get(k)
      if (!s) {
        // measured at the layer's top-left, unconstrained by its position (an
        // absolutely placed box near the right edge shrinks to the room left),
        // and rounded UP: a fractional text width cut to whole px is what puts
        // an ellipsis on a name that fits
        Object.assign(c.style, { left: '0px', top: '0px', width: '', height: '', maxWidth: kind === 'zone' ? 'none' : '', visibility: 'hidden' })
        const r = c.getBoundingClientRect()
        s = { w: Math.ceil(r.width) + 1, h: Math.ceil(r.height) }
        sizes.set(k, s)
      }
      return s
    }

    const draw = () => {
      const st = store.getState()
      const [tx, ty, z] = st.transform
      const pane: Box = { x: 0, y: 0, w: st.width, h: st.height }
      const toScreen = (b: Box): Box => ({ x: b.x * z + tx, y: b.y * z + ty, w: b.w * z, h: b.h * z })
      const drag = dragging()
      const nodes = [...geom.nodes.values()].map((g) => toScreen(g.sym))
      let screenPts: Float32Array | null = null
      const o: Obstacles = {
        pane,
        nodes,
        get pts() {
          if (!screenPts) {
            screenPts = new Float32Array(geom.pts.length)
            for (let i = 0; i + 1 < geom.pts.length; i += 2) { screenPts[i] = geom.pts[i] * z + tx; screenPts[i + 1] = geom.pts[i + 1] * z + ty }
          }
          return screenPts
        },
        placed: [],
      }
      // The lines are KNOWN once read after the routes settled: no routed line
      // still waiting for its first route (`busy`) and no full generation
      // running (`pending`). A document opens with its routes drawn over several
      // slices; a NEW place chosen before that is provisional — not kept, and
      // not shown, so a name appears once, at its final place, instead of
      // standing somewhere first and jumping. A kept place that still holds is
      // shown throughout. A name held back for SETTLE_WAIT_MS (the routes slow,
      // or failing) is shown with the lines read so far, so a name is never
      // hidden for good. During a drag the rules use no lines.
      const now = performance.now()
      const settledNow = !useRouteInputs.getState().busy && !routeDiagnostics().pending
      const waitedOut = heldSince !== null && now - heldSince >= SETTLE_WAIT_MS - SHOW_SLACK_MS
      const linesKnown = ((settledNow || waitedOut) && (geom.linesRead || geom.edgeCount === 0)) || drag
      let held = false
      const seen = new Set<string>()
      // KEYBOARD focus on a zone: on its own chip (a solid ring on the name) or
      // on the zone itself (a dashed ring on the name) — the name the reader
      // sees shows which; the layer itself never takes focus
      const ae = document.activeElement as HTMLElement | null
      const focusedChip = ae?.matches('.lgr-frame__label:focus-visible') ? (ae.closest<HTMLElement>('.lgr-frame')?.dataset.frameId ?? null) : null
      const focusedZone = ae?.matches('.lgr-frame:focus-visible') ? (ae.dataset.frameId ?? null) : null

      // zone names first
      for (const zn of zonesRef.current) {
        const rect = toScreen(zn.rect)
        const frameEl = root.querySelector(`.lgr-frame[data-frame-id="${CSS.escape(zn.id)}"]`)
        const show = !!zn.text && zoneOnLayer(z, rect, pane)
        if (!show) { frameEl?.classList.remove(LAYER_NAMED_CLASS); continue }
        const key = `zone|${zn.id}`
        const c = chip(key, 'zone', zn.text)
        const nat = sizeOf(c, 'zone', zn.text)
        const w = Math.min(nat.w, Math.max(40, rect.w)), h = nat.h
        const kept = zoneSlots.get(zn.id + '|' + zn.text) ?? null
        const p = placeZone(rect, w, h, kept, o, drag)
        const provisional = p.slot !== kept && !linesKnown
        held ||= provisional
        if (p.slot !== kept && linesKnown) {
          zoneSlots.set(zn.id + '|' + zn.text, p.slot)
          if (p.rechosen) log({ kind: 'zone', text: zn.text, reason: p.rechosen })
        }
        // the zone's own chip shows nothing only while the layer's name is shown
        frameEl?.classList.toggle(LAYER_NAMED_CLASS, !provisional)
        Object.assign(c.style, { left: `${p.at.x}px`, top: `${p.at.y}px`, width: `${w}px`, maxWidth: `${w}px`, height: `${h}px`, visibility: provisional ? 'hidden' : '' })
        if (provisional) c.dataset.hidden = 'provisional'
        else delete c.dataset.hidden
        const focus = provisional ? '' : zn.id === focusedChip ? 'chip' : zn.id === focusedZone ? 'zone' : ''
        if (focus) c.dataset.focus = focus
        else delete c.dataset.focus
        c.dataset.row = String(p.slot.row)
        c.dataset.frac = p.slot.frac.toFixed(3)
        c.toggleAttribute('data-fallback', p.fallback)
        markRechosen(c, provisional ? '' : p.rechosen)
        if (!provisional) o.placed.push(p.at)
        seen.add(key)
      }

      // the ONE selected node's name
      const selected = useGraphStore.getState().nodes.filter((n) => n.selected)
      const g = selected.length === 1 ? geom.nodes.get(selected[0].id) : undefined
      if (g && g.name && nodeOnLayer(z)) {
        const id = selected[0].id
        const key = 'node'
        const c = chip(key, 'node', g.name)
        const s = sizeOf(c, 'node', g.name)
        const own = toScreen(g.sym)
        // the selection ring's outer edge on screen (index.css `.nodef__sel`: band max(2z, 1.5), gap max(2.5z, 0.75))
        const ringOut = Math.max(2.5 * z, 0.75) + Math.max(2 * z, 1.5)
        const ring: Box = { x: own.x - ringOut, y: own.y - ringOut, w: own.w + 2 * ringOut, h: own.h + 2 * ringOut }
        const p = placeNode(id, toScreen(g.body), own, ring, s.w, s.h, nodeSlot, o, drag)
        // a new side chosen before the lines are known: not kept, not shown (as for a zone name)
        const provisional = !p.hidden && p.slot !== nodeSlot && !linesKnown
        held ||= provisional
        if ((linesKnown || p.hidden) && !provisional) {
          if (p.rechosen) log({ kind: 'node', text: g.name, reason: p.rechosen })
          nodeSlot = p.slot
        }
        const hidden = p.hidden || (provisional ? 'provisional' : '')
        // the measured size is locked, so a chip near the pane's edge never shrinks and wraps
        Object.assign(c.style, { left: `${p.at.x}px`, top: `${p.at.y}px`, width: `${s.w}px`, height: `${s.h}px`, maxWidth: 'none', visibility: hidden ? 'hidden' : '' })
        if (hidden) c.dataset.hidden = hidden
        else delete c.dataset.hidden
        c.dataset.side = `${p.slot.k}@${p.slot.g}`
        // a slide inward at the pane's edge, as the offset from the kept side (px)
        if (p.shifted) {
          const side = nodeDirs(toScreen(g.body), s.w, s.h, p.slot.g)[p.slot.k]
          c.dataset.shifted = `${Math.round(p.at.x - side.x)},${Math.round(p.at.y - side.y)}`
        } else delete c.dataset.shifted
        c.toggleAttribute('data-fallback', p.fallback)
        markRechosen(c, hidden ? '' : p.rechosen)
        if (!hidden) o.placed.push(p.at)
        seen.add(key)
      } else if (selected.length !== 1) nodeSlot = null

      for (const [k, c] of chips) if (!seen.has(k)) { c.remove(); chips.delete(k) }

      // since when a name has been held back; a timer draws again when the wait is over
      if (!held) heldSince = null
      else {
        heldSince ??= now
        // (a draw only: re-reading the lines first would delay the name past the wait)
        if (!settleTimer) settleTimer = window.setTimeout(() => { settleTimer = 0; schedule(false) }, Math.max(0, SETTLE_WAIT_MS - SHOW_SLACK_MS - (now - heldSince)))
      }
    }

    const frame = () => {
      raf = 0
      const drag = dragging()
      // nothing goes on the layer at this zoom: the geometry is read when something does
      const z = store.getState().transform[2]
      const active = nodeOnLayer(z) || (zonesRef.current.length > 0 && ZONE_TEXT_PX * z < TEXT_SHOW_PX)
      // a held-back name whose wait is over is shown first, on the geometry
      // already read, before any slower re-read
      if (heldSince !== null && performance.now() - heldSince >= SETTLE_WAIT_MS - SHOW_SLACK_MS) draw()
      if (active && (wantGeom || (wasDragging && !drag))) {
        // lines are read again once a drag ends; while dragging only the nodes
        readGeometry(!drag)
        wantGeom = false
      }
      wasDragging = drag
      draw()
    }
    const schedule = (g: boolean) => {
      if (g) wantGeom = true
      if (!raf) raf = requestAnimationFrame(frame)
    }
    scheduleRef.current = schedule

    // the viewport, the pane's size: transform only
    const unStore = store.subscribe((s, prev) => {
      if (s.transform !== prev.transform || s.width !== prev.width || s.height !== prev.height) schedule(false)
    })
    // a selection or a drag
    const unGraph = useGraphStore.subscribe((s, prev) => { if (s.nodes !== prev.nodes) schedule(true) })
    // the routes settling (a provisional place becomes a kept one)
    const unRoutes = useRouteInputs.subscribe(() => schedule(true))
    // a zone chip taking or losing keyboard focus (its name on the layer shows it)
    const onFocus = () => schedule(false)
    root.addEventListener('focusin', onFocus)
    root.addEventListener('focusout', onFocus)
    // a node or a line drawn somewhere else (a route settling, a node resized,
    // a language switch): watched inside the viewport only — never this layer's
    // own writes — and not the viewport's own transform (a pan or a zoom)
    const viewport = root.querySelector('.react-flow__viewport')
    const mo = new MutationObserver((records) => {
      if (records.some((r) => r.target !== viewport)) schedule(true)
    })
    if (viewport) mo.observe(viewport, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['d', 'style'] })
    // the fonts arrive late: measure again
    const onFonts = () => { sizes.clear(); schedule(false) }
    document.fonts?.addEventListener?.('loadingdone', onFonts)
    schedule(true)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (settleTimer) clearTimeout(settleTimer)
      root.removeEventListener('focusin', onFocus)
      root.removeEventListener('focusout', onFocus)
      unStore()
      unGraph()
      unRoutes()
      mo.disconnect()
      document.fonts?.removeEventListener?.('loadingdone', onFonts)
      for (const c of chips.values()) c.remove()
      for (const el of root.querySelectorAll(`.lgr-frame.${LAYER_NAMED_CLASS}`)) el.classList.remove(LAYER_NAMED_CLASS)
    }
  }, [store])

  return <div ref={layerRef} className="canvas-text" aria-hidden="true" />
}
