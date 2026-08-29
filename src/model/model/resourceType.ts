// loop-model/1 (SEMANTICS-M.md §M4) — the advisory `resourceType` tag on pools
// and `resource` edges. Normalisation + identity (§M4.1) and the deterministic
// mismatch finding (§M4.3). Computation-neutral: it changes no number, deletes
// no connection, blocks no run (§M4.2).

import { trimUnicodeWhitespace, utf8Len } from './text'

export const RESOURCE_TYPE_MAX_BYTES = 64

/** The built-in styled set (docs/visual-language.md §VL5.1), matched
 *  case-sensitively; any other non-empty string is a valid custom type. */
export const BUILTIN_RESOURCE_TYPES = ['Gold', 'Energy', 'XP', 'Player', 'Item'] as const
export type BuiltinResourceType = (typeof BUILTIN_RESOURCE_TYPES)[number]

export type ResourceTypeNorm =
  | { value: string } // typed
  | { value: null; notice?: 'RTYPE_TOO_LONG' } // untyped

/** §M4.1 — trim Unicode White_Space → empty ⇒ untyped → NFC → ≤ 64 UTF-8
 *  bytes (over the cap ⇒ dropped, not truncated). Case-sensitive. */
export function normalizeResourceType(raw: unknown): ResourceTypeNorm {
  if (typeof raw !== 'string') return { value: null }
  const trimmed = trimUnicodeWhitespace(raw)
  if (trimmed === '') return { value: null }
  const nfc = trimmed.normalize('NFC')
  if (utf8Len(nfc) > RESOURCE_TYPE_MAX_BYTES) return { value: null, notice: 'RTYPE_TOO_LONG' }
  return { value: nfc }
}

/** Two resourceTypes are the same iff their normalised forms are byte-equal. */
export function sameResourceType(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b
}

export function isBuiltinResourceType(t: string): t is BuiltinResourceType {
  return (BUILTIN_RESOURCE_TYPES as readonly string[]).includes(t)
}

// ── mismatch findings (§M4.3) ────────────────────────────────────────────

export type ResourceMismatchFinding = {
  edgeId: string
  endpoint: 'source' | 'target'
  nodeId: string
  edgeType: string
  nodeType: string
}

export type MismatchGraphView = {
  /** every `resource` edge, in any order */
  resourceEdges: { id: string; source: string; target: string; resourceType?: unknown }[]
  /** a node's kind, or `undefined` if the id is not a node */
  nodeKind: (id: string) => string | undefined
  /** a node's raw `data.resourceType` (only pools carry it) */
  nodeResourceType: (id: string) => unknown
}

/**
 * §M4.3 — a mismatch finding per `resource` edge whose normalised type is set
 * and differs from a typed **pool** endpoint's normalised type. Deterministic:
 * emitted in `edge.id` ascending order, `source` endpoint before `target`.
 */
export function resourceTypeMismatches(view: MismatchGraphView): ResourceMismatchFinding[] {
  const findings: ResourceMismatchFinding[] = []
  const edges = [...view.resourceEdges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const e of edges) {
    const edgeType = normalizeResourceType(e.resourceType).value
    if (edgeType === null) continue
    for (const endpoint of ['source', 'target'] as const) {
      const nodeId = endpoint === 'source' ? e.source : e.target
      if (view.nodeKind(nodeId) !== 'pool') continue
      const nodeType = normalizeResourceType(view.nodeResourceType(nodeId)).value
      if (nodeType === null) continue
      if (nodeType !== edgeType) {
        findings.push({ edgeId: e.id, endpoint, nodeId, edgeType, nodeType })
      }
    }
  }
  return findings
}
