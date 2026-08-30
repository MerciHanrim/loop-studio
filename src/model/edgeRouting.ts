// loop-revision/3 (SEMANTICS-R3.md §R3-1.1) — the defensive read of an edge's
// routing payload (`data.route` + `data.waypoints`). Pure, model-layer: it
// normalises a valid payload and QUARANTINES a bad one (drops route + waypoints)
// without ever touching the edge's semantic fields. The computed path is not
// this module's concern (that is `src/components/edges/orthogonalRoute.ts`).

/** §ER3.1 — a `waypoints` array longer than this drops the whole routing
 *  payload for the edge. */
export const MAX_WAYPOINTS_PER_EDGE = 64

export type EdgeWaypoint = { x: number; y: number }
export type EdgeRoutingRead = {
  /** present iff a valid `"orthogonal"` mode survived */
  route?: 'orthogonal'
  /** present iff `route` is `"orthogonal"` AND 1..64 finite points survived */
  waypoints?: EdgeWaypoint[]
}

const z0 = (n: number): number => (n === 0 ? 0 : n) // -0 -> 0 (§R4.1)

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * §R3-1.1. Read `raw.route` / `raw.waypoints` off an edge's `data`. Returns the
 * accepted routing intent, or `{}` when the payload is absent, default, or
 * quarantined. `onWarn` (optional) is called once per drop with a stable
 * message — callers that surface import warnings pass it; `normalizeEdge` does
 * not (it quarantines silently and the import path re-scans via
 * `routingReadIssues`).
 */
export function readRoutingPayload(raw: unknown, onWarn?: (msg: string) => void): EdgeRoutingRead {
  if (!raw || typeof raw !== 'object') return {}
  const d = raw as { route?: unknown; waypoints?: unknown }

  // ── route ──
  let route: 'orthogonal' | undefined
  if (d.route === undefined || d.route === 'bezier') {
    route = undefined // absent / explicit-bezier both normalise to absent
  } else if (d.route === 'orthogonal') {
    route = 'orthogonal'
  } else {
    onWarn?.('edge routing dropped — unrecognised `route` value')
    return {} // whole payload
  }

  // ── waypoints ──
  const rawWp = d.waypoints
  if (rawWp === undefined) return route ? { route } : {}
  if (!Array.isArray(rawWp)) {
    onWarn?.('edge routing dropped — `waypoints` is not an array')
    return {}
  }
  if (route !== 'orthogonal') {
    if (rawWp.length > 0) onWarn?.('edge `waypoints` dropped — no `route: "orthogonal"`')
    return {} // waypoints meaningless without orthogonal; route was absent anyway
  }
  if (rawWp.length === 0) return { route }
  if (rawWp.length > MAX_WAYPOINTS_PER_EDGE) {
    onWarn?.(`edge routing dropped — more than ${MAX_WAYPOINTS_PER_EDGE} waypoints`)
    return {}
  }
  const pts: EdgeWaypoint[] = []
  for (const p of rawWp) {
    if (!p || typeof p !== 'object') {
      onWarn?.('edge routing dropped — a `waypoints` entry is not an object')
      return {}
    }
    const { x, y } = p as { x?: unknown; y?: unknown }
    if (!finiteNum(x) || !finiteNum(y)) {
      onWarn?.('edge routing dropped — a `waypoints` coordinate is not a finite number')
      return {}
    }
    pts.push({ x: z0(x), y: z0(y) }) // verbatim precision, -0 -> 0; duplicates / collinear kept
  }
  return { route, waypoints: pts }
}

/** True iff the edge carries surviving `loop-revision/3` routing intent
 *  (`route: "orthogonal"` or a non-empty `waypoints`) — the §R3-1 predicate,
 *  evaluated per edge on already-normalised data. */
export function edgeHasRoutingIntent(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as { route?: unknown; waypoints?: unknown }
  return d.route === 'orthogonal' || (Array.isArray(d.waypoints) && d.waypoints.length > 0)
}

/**
 * §R3-1.1 warning list for the import path — a deterministic message per edge
 * whose *raw* routing payload would be quarantined, in ascending edge `id`
 * order. Operates on raw (pre-normalise) edges so the import UI can report
 * "this file's edge routing was dropped".
 */
export function routingReadIssues(
  rawEdges: { id?: unknown; data?: unknown }[],
): string[] {
  const out: string[] = []
  const withId = rawEdges
    .map((e) => ({ id: typeof e.id === 'string' ? e.id : '', data: e.data }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const e of withId) {
    readRoutingPayload(e.data, (msg) => out.push(`edge "${e.id}": ${msg}`))
  }
  return out
}
