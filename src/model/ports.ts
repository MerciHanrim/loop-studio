// Node structure, first implementation — the four-side port faces of a
// connection (scratch/share/connection-editing-2/17-implementation-rules.md
// §2 "Ports and connections", NS4.2 P1–P5).
//
// The document stores a face per end in `data.ports` (cosmetic, like `route`);
// the handle ids (`out` / `in`, `state-source` / `state-target`) stay the
// kind channel and are in both digests, so a face is never encoded in them.
// The renderer offers one DOM handle per face per port; which DOM handle id a
// face maps to is a renderer detail (`rfHandleId` / `parseHandleId`), never a
// document one.

import type { EdgePorts, LoopEdge, PortFace } from './types'

export const PORT_FACES: readonly PortFace[] = ['top', 'right', 'bottom', 'left']

const isFace = (v: unknown): v is PortFace => typeof v === 'string' && (PORT_FACES as readonly string[]).includes(v)

/** the accepted `ports` payload of an edge's data, or undefined: only valid
 *  faces survive, an empty object is nothing (the normaliser drops it) */
export function readPorts(raw: unknown): EdgePorts | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: EdgePorts = {}
  if (isFace(r.source)) out.source = r.source
  if (isFace(r.target)) out.target = r.target
  return out.source || out.target ? out : undefined
}

export type PortKind = 'resource' | 'state'
export type PortEnd = 'source' | 'target'

/** the CANONICAL stored form (SEMANTICS-R11.md §R11-1.1): only valid faces,
 *  and only the ones that differ from the kind's default — an explicit default
 *  face says nothing and is dropped, so two documents that draw alike store
 *  alike (and digest alike). Undefined when nothing non-default remains. */
export function canonicalPorts(kind: PortKind, raw: unknown): EdgePorts | undefined {
  const p = readPorts(raw)
  if (!p) return undefined
  const out: EdgePorts = {}
  if (p.source && p.source !== defaultFace(kind, 'source')) out.source = p.source
  if (p.target && p.target !== defaultFace(kind, 'target')) out.target = p.target
  return out.source || out.target ? out : undefined
}

/** today's faces by kind: a resource connection leaves right and arrives left,
 *  a state connection leaves bottom and arrives top */
export const defaultFace = (kind: PortKind, end: PortEnd): PortFace =>
  kind === 'state' ? (end === 'source' ? 'bottom' : 'top') : end === 'source' ? 'right' : 'left'

export const edgePortKind = (e: Pick<LoopEdge, 'data' | 'sourceHandle' | 'targetHandle'>): PortKind =>
  e.data?.kind === 'state' || e.sourceHandle?.startsWith('state') || e.targetHandle?.startsWith('state') ? 'state' : 'resource'

/** the face one end of a connection uses: the stored one, else the kind's default */
export function faceOf(e: Pick<LoopEdge, 'data' | 'sourceHandle' | 'targetHandle'>, end: PortEnd): PortFace {
  const stored = (e.data as { ports?: unknown } | undefined)?.ports
  const p = readPorts(stored)
  return (end === 'source' ? p?.source : p?.target) ?? defaultFace(edgePortKind(e), end)
}

/** the document's handle id for a port kind and end (the kind channel) */
export const baseHandleId = (kind: PortKind, end: PortEnd): string =>
  kind === 'state' ? (end === 'source' ? 'state-source' : 'state-target') : end === 'source' ? 'out' : 'in'

/** the DOM handle id the renderer gives a face: the document id itself on the
 *  kind's default face (so a document without faces binds to the handles it
 *  always had), `<id>@<face>` elsewhere */
export function rfHandleId(kind: PortKind, end: PortEnd, face: PortFace): string {
  const base = baseHandleId(kind, end)
  return face === defaultFace(kind, end) ? base : `${base}@${face}`
}

/** a DOM handle id back to the document id and the face it stands for */
export function parseHandleId(id: string | null | undefined): { base: string | null; face: PortFace | null } {
  if (!id) return { base: null, face: null }
  const at = id.indexOf('@')
  if (at < 0) return { base: id, face: null }
  const face = id.slice(at + 1)
  return { base: id.slice(0, at), face: isFace(face) ? face : null }
}

/** the name's face — a CANDIDATE rule (17-implementation-rules.md §4.3): the
 *  first face none of the node's connections uses, in the order below, right,
 *  left, top; all busy ⇒ below (the lane offset for that case is not designed
 *  yet). Derived from the connection set only, so it never changes during a
 *  drag; adding or removing a connection may move the name, and undoing that
 *  edit moves it back. */
const NAME_FACE_ORDER: readonly PortFace[] = ['bottom', 'right', 'left', 'top']
export const nameFaceFor = (used: ReadonlySet<PortFace>): PortFace => NAME_FACE_ORDER.find((f) => !used.has(f)) ?? 'bottom'

/** the `ports` to store for a new connection made from DOM handles: only the
 *  ends whose face differs from the kind's default, else undefined */
export function portsFromHandles(kind: PortKind, sourceHandle: string | null | undefined, targetHandle: string | null | undefined): EdgePorts | undefined {
  const s = parseHandleId(sourceHandle).face
  const t = parseHandleId(targetHandle).face
  const out: EdgePorts = {}
  if (s && s !== defaultFace(kind, 'source')) out.source = s
  if (t && t !== defaultFace(kind, 'target')) out.target = t
  return out.source || out.target ? out : undefined
}
