// docs/data-import.md -- Phase 1B: the pure candidate builder. Accepts ONLY
// a `ValidatedImportPlan` (never a raw draft) -- validation already ran and
// normalised everything this function reads. Mirrors `insertGraph()`'s own
// separation: pure compute here, one atomic store action
// (`graphStore.commitDataImport`) applies the result.

import { nextId } from './factory'
import {
  composeFullRowLabel,
  resolveForeignKeyLabelTerm,
  type ValidatedImportPlan,
  type ValidatedRow,
  type ValidatedTable,
} from './dataImportValidate'
import { validateResultGraph } from './revision'
import type { ImportSourceTable, SavedFrame } from './serialize'
import type { LoopEdge, LoopNode } from './types'

export type PlacementChoice =
  | { kind: 'none'; origin: { x: number; y: number } }
  | { kind: 'framePerTable'; origin: { x: number; y: number } }
  | { kind: 'existingFrame'; frameId: string }

/** A typed code, never a free-text English string — the UI translates each
 *  into EN/KO/JA; `detail` carries the values a translated message
 *  interpolates (a table label, a frame id, and so on). */
export type CommitFailureCode =
  | 'source-table-id-collision'
  | 'parameter-id-collision'
  | 'frame-placement-failed'
  | 'frame-not-found'
  | 'frame-insufficient-space'
  | 'invalid-result-graph'

export type ImportCommitResult =
  | { ok: true; createdNodes: LoopNode[]; tables: ImportSourceTable[]; createdFrames: SavedFrame[] }
  | { ok: false; reason: CommitFailureCode; detail?: Record<string, unknown> }

// `NODE_W` / `NODE_H` deliberately do NOT mirror `src/components/frames/
// autoFrames.ts`'s `CANON_NODE_W` / `CANON_NODE_H` (150 / 40): that pair is
// `autoFrames.ts`'s own canonical footprint for its frame-SUGGESTION
// algorithm over already-placed non-model nodes ("Model nodes (parameter /
// register) never take part" -- see that file's own comment), never a claim
// about real rendered pixel size. This module only ever creates `parameter`
// nodes, whose real rendered box (`.nodef` in src/index.css / `BASE_NODE_H`
// + `MAX_NODE_H.parameter` in src/components/nodes/silhouette.ts) can be up
// to 260px wide and 120px tall depending on label length -- a long imported
// label (arbitrary spreadsheet text, no length control here) can legitimately
// hit either ceiling. Budgeting the non-model 150x40 footprint here (a bug
// an earlier round missed, caught by an e2e check of REAL rendered node
// boxes rather than just their top-left position) undersizes every
// generated frame and lets a long-labelled node visually escape it. Using
// each dimension's per-kind MAX up front costs some empty space for short
// labels but guarantees no escape ever, for both frame sizing and the
// overlap/collision checks below. `src/model/*` never depends on
// `src/components/*` in this codebase, so these stay separate constants
// rather than an import.
const NODE_W = 260
const NODE_H = 120
const FRAME_PAD = 24
const GRID_GAP_X = 40
const GRID_GAP_Y = 24
const GRID_COLS = 4

export type Rect = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
function nodeRect(pos: Point): Rect {
  return { x: pos.x, y: pos.y, w: NODE_W, h: NODE_H }
}
function gridPositions(count: number, origin: Point): Point[] {
  const out: Point[] = []
  for (let i = 0; i < count; i++) {
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    out.push({ x: origin.x + col * (NODE_W + GRID_GAP_X), y: origin.y + row * (NODE_H + GRID_GAP_Y) })
  }
  return out
}
function frameRectFor(positions: Point[]): Rect {
  const minX = Math.min(...positions.map((p) => p.x))
  const minY = Math.min(...positions.map((p) => p.y))
  const maxX = Math.max(...positions.map((p) => p.x)) + NODE_W
  const maxY = Math.max(...positions.map((p) => p.y)) + NODE_H
  return { x: minX - FRAME_PAD, y: minY - FRAME_PAD, w: maxX - minX + FRAME_PAD * 2, h: maxY - minY + FRAME_PAD * 2 }
}
/** Deterministic fixed scan order: step right one frame-width at a time;
 *  every 20 steps, wrap to a new row directly below the ORIGINAL rect.
 *  Returns `null` (never a still-overlapping rect) if the guard budget is
 *  exhausted without finding a clear spot — the caller must treat that as
 *  a hard failure of the WHOLE commit, never silently place on top of
 *  something. */
export function shiftUntilClear(rect: Rect, obstacles: Rect[]): Rect | null {
  let r = rect
  let guard = 0
  while (obstacles.some((o) => rectsOverlap(r, o))) {
    guard++
    if (guard >= 200) return null
    r = guard % 20 === 0 ? { x: rect.x, y: rect.y + guard * (rect.h + GRID_GAP_Y), w: rect.w, h: rect.h } : { ...r, x: r.x + r.w + GRID_GAP_X }
  }
  return r
}

/** One generated Parameter's source cell -- a (table, row, number-column). */
type Cell = { table: ValidatedTable; row: ValidatedRow; columnId: string; header: string }

function allCells(tables: readonly ValidatedTable[]): Cell[] {
  const out: Cell[] = []
  for (const table of tables) {
    const numberCols = table.columns.filter((c) => c.role === 'number')
    if (numberCols.length === 0) continue
    for (const row of table.rows) {
      for (const col of numberCols) {
        if (col.sourceColumnId in row.number) out.push({ table, row, columnId: col.sourceColumnId, header: col.header })
      }
    }
  }
  return out
}

/** §DI10 destination 1 -- group a table's cells for "one frame per table (or
 *  per explicit group-by value)". Grouping key is the row's value under the
 *  group-by FK column when set; otherwise the whole table is one group. */
function groupsForTable(table: ValidatedTable, cells: Cell[]): { key: string; cells: Cell[] }[] {
  if (!table.groupByColumnId) return cells.length > 0 ? [{ key: '', cells }] : []
  const byKey = new Map<string, Cell[]>()
  for (const c of cells) {
    const gk = c.row.foreignKey[table.groupByColumnId] ?? ''
    const arr = byKey.get(gk) ?? []
    arr.push(c)
    byKey.set(gk, arr)
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, gCells]) => ({ key, cells: gCells }))
}

/** A `framePerTable` frame's title: for the whole-table case (`groupKey ===
 *  ''`), just the table's own label. For a group-by value, the group-by
 *  FK's RESOLVED label term (e.g. `"Premium Pickup"`) via the same
 *  `resolveForeignKeyLabelTerm` every other FK-derived label term in this
 *  feature uses -- never the raw stored key (`"premium_pickup"`). */
function groupFrameLabel(table: ValidatedTable, tables: readonly ValidatedTable[], groupKey: string): string {
  if (!groupKey) return table.label
  const groupCol = table.columns.find((c) => c.sourceColumnId === table.groupByColumnId)
  if (!groupCol?.refTableId) return `${table.label} (${groupKey})` // defensive -- validateDrafts already guarantees this is set
  const { term } = resolveForeignKeyLabelTerm(tables, groupCol.refTableId, groupKey)
  return `${table.label} (${term})`
}

/** §DI10 destination 3 -- a deterministic scan for a free grid-sized area
 *  strictly inside an EXISTING frame: row by row, column by column, at the
 *  node grid's own pitch (never a sub-pixel search) -- the first origin
 *  whose whole grid avoids every obstacle wins. `null` when nothing in the
 *  frame is large enough / free enough, which the caller treats as a hard
 *  refusal of the whole commit (never grows the frame, never partially
 *  places). */
function findFreeGridOrigin(frame: SavedFrame, cols: number, rowsNeeded: number, obstacles: Rect[]): Point | null {
  const neededW = cols * NODE_W + (cols - 1) * GRID_GAP_X
  const neededH = rowsNeeded * NODE_H + (rowsNeeded - 1) * GRID_GAP_Y
  const minX = frame.rect.x + FRAME_PAD
  const minY = frame.rect.y + FRAME_PAD
  const maxX = frame.rect.x + frame.rect.w - FRAME_PAD - neededW
  const maxY = frame.rect.y + frame.rect.h - FRAME_PAD - neededH
  if (maxX < minX || maxY < minY) return null
  const stepX = NODE_W + GRID_GAP_X
  const stepY = NODE_H + GRID_GAP_Y
  const EPS = 0.5 // tolerate the last step landing fractionally short of max due to float step accumulation
  for (let y = minY; y <= maxY + EPS; y += stepY) {
    for (let x = minX; x <= maxX + EPS; x += stepX) {
      const gridRect: Rect = { x, y, w: neededW, h: neededH }
      if (!obstacles.some((o) => rectsOverlap(gridRect, o))) return { x, y }
    }
  }
  return null
}

export function buildImportCommit(
  plan: ValidatedImportPlan,
  placement: PlacementChoice,
  host: { nodes: LoopNode[]; edges: LoopEdge[] },
  existingFrames: readonly SavedFrame[],
  existingTables: readonly ImportSourceTable[],
): ImportCommitResult {
  // -- pre-commit collision gate (defense in depth, not an expected path) --
  const existingSourceTableIds = new Set(existingTables.map((t) => t.sourceTableId))
  for (const t of plan.tables) {
    if (existingSourceTableIds.has(t.sourceTableId)) {
      return { ok: false, reason: 'source-table-id-collision', detail: { sourceTableId: t.sourceTableId } }
    }
  }

  const cells = allCells(plan.tables)
  const hostNodeIds = new Set(host.nodes.map((n) => n.id))
  const mintedIds = new Set<string>()
  const ids: string[] = []
  for (let i = 0; i < cells.length; i++) {
    const id = nextId('parameter')
    if (hostNodeIds.has(id) || mintedIds.has(id)) {
      return { ok: false, reason: 'parameter-id-collision', detail: { id } }
    }
    mintedIds.add(id)
    ids.push(id)
  }

  // -- placement --------------------------------------------------------
  let positions: Point[] = []
  const createdFrames: SavedFrame[] = []

  if (placement.kind === 'none') {
    positions = gridPositions(cells.length, placement.origin)
  } else if (placement.kind === 'framePerTable') {
    const hostObstacles = host.nodes.map((n) => nodeRect(n.position))
    const existingFrameObstacles = existingFrames.map((f) => f.rect)
    const placedThisBatch: Rect[] = []
    let cursor = { ...placement.origin }
    const posByCell = new Map<Cell, Point>()
    for (const table of plan.tables) {
      const tableCells = cells.filter((c) => c.table === table)
      for (const group of groupsForTable(table, tableCells)) {
        const groupPositions = gridPositions(group.cells.length, cursor)
        const initialRect = frameRectFor(groupPositions)
        const rect = shiftUntilClear(initialRect, [...hostObstacles, ...existingFrameObstacles, ...placedThisBatch])
        if (!rect) {
          // The deterministic scan exhausted its budget without finding a
          // clear spot — refuse the WHOLE commit (nothing has been applied
          // yet; `createdFrames` / `positions` built so far are discarded
          // with this early return), never place on top of something.
          return { ok: false, reason: 'frame-placement-failed', detail: { table: table.label } }
        }
        const dx = rect.x - initialRect.x
        const dy = rect.y - initialRect.y
        const finalPositions = groupPositions.map((p) => ({ x: p.x + dx, y: p.y + dy }))
        group.cells.forEach((c, i) => posByCell.set(c, finalPositions[i]))
        placedThisBatch.push(rect)
        createdFrames.push({ id: nextId('frame'), label: groupFrameLabel(table, plan.tables, group.key), rect })
        cursor = { x: placement.origin.x, y: rect.y + rect.h + GRID_GAP_Y }
      }
    }
    positions = cells.map((c) => posByCell.get(c)!)
  } else {
    // existingFrame
    const target = existingFrames.find((f) => f.id === placement.frameId)
    if (!target) return { ok: false, reason: 'frame-not-found', detail: { frameId: placement.frameId } }
    const usableW = target.rect.w - FRAME_PAD * 2
    const cols = Math.max(1, Math.floor((usableW + GRID_GAP_X) / (NODE_W + GRID_GAP_X)))
    const rowsNeeded = Math.ceil(cells.length / cols)
    if (usableW < NODE_W) return { ok: false, reason: 'frame-insufficient-space', detail: { frame: target.label } }
    const hostObstacles = host.nodes.map((n) => nodeRect(n.position))
    const origin = findFreeGridOrigin(target, cols, rowsNeeded, hostObstacles)
    if (!origin) return { ok: false, reason: 'frame-insufficient-space', detail: { frame: target.label } }
    const candidate: Point[] = []
    for (let i = 0; i < cells.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      candidate.push({ x: origin.x + col * (NODE_W + GRID_GAP_X), y: origin.y + row * (NODE_H + GRID_GAP_Y) })
    }
    positions = candidate
  }

  // -- build the Parameter nodes -----------------------------------------
  const createdNodes: LoopNode[] = cells.map((cell, i) => {
    const { text } = composeFullRowLabel(plan.tables, cell.table, cell.row)
    const label = `${cell.table.label} · ${text} · ${cell.header}`
    return {
      id: ids[i],
      type: 'parameter',
      position: positions[i],
      data: {
        kind: 'parameter',
        label,
        value: cell.row.number[cell.columnId],
        sourceTableId: cell.table.sourceTableId,
        sourceKey: cell.row.sourceKey,
        sourceColumnId: cell.columnId,
        labelAutoComposed: true,
      },
    } as LoopNode
  })

  const check = validateResultGraph([...host.nodes, ...createdNodes], host.edges)
  if (!check.ok) return { ok: false, reason: 'invalid-result-graph', detail: { reasons: check.reasons } }

  const tables: ImportSourceTable[] = plan.tables.map((t) => ({
    sourceTableId: t.sourceTableId,
    label: t.label,
    columns: t.columns.map((c) =>
      c.refTableId
        ? { sourceColumnId: c.sourceColumnId, role: c.role, header: c.header, refTableId: c.refTableId }
        : { sourceColumnId: c.sourceColumnId, role: c.role, header: c.header },
    ),
    rows: t.rows.map((r) => ({ sourceKey: r.sourceKey, number: { ...r.number }, label: { ...r.label }, foreignKey: { ...r.foreignKey } })),
  }))

  return { ok: true, createdNodes, tables, createdFrames }
}
