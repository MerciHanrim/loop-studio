// docs/data-import.md §DI11/§DI-D15..D21 -- Phase 2: the pure diff + commit
// engine. Operates over the WHOLE batch of stored tables (never just the one
// being refreshed) because a label recompose can reach into a dependent
// table's Parameters (§DI10's cross-table FK label resolution). Accepts
// ONLY a `ValidatedRefreshSnapshot` (dataImportRefreshValidate.ts) -- never
// raw pasted rows -- mirroring `buildImportCommit`'s own trust-boundary
// discipline for the first import.

import { nextId } from './factory'
import { NODE_H, NODE_W, gridPositions, nodeRect, shiftUntilClear, type Rect } from './dataImportCommit'
import { composeFullRowLabel } from './dataImportValidate'
import type { ValidatedRefreshSnapshot } from './dataImportRefreshValidate'
import { findReferences, type NodeReference } from './dataImportReferences'
import type { ImportRow, ImportSourceTable, SavedFrame } from './serialize'
import type { LoopEdge, LoopNode, ParameterData } from './types'

type Point = { x: number; y: number }

function paramData(n: LoopNode): ParameterData | null {
  return n.data.kind === 'parameter' ? n.data : null
}

/** A join key for a (string, string) pair, matching the same `a:b` shape
 *  already used for the per-cell resolution-map keys below. */
function pairKey(a: string, b: string): string {
  return `${a}:${b}`
}
const tripleKey = pairKey

// -- the per-`number`-cell three-way (§DI11 "the complete base/local/incoming
// three-way") -- a small, NEW, isolated comparator. NOT a reuse of Project
// Revision's `classifyAgainst`/`countThreeWayConflicts` (`revision.ts`):
// that machinery classifies a WHOLE DOCUMENT via canonical-digest comparison
// -- wrong granularity, and much heavier than a per-cell number compare
// needs. Verified directly against `revision.ts` before relying on it, per
// the doc's own "proposed, not yet fully verified" note. --------------------

export type CellState = 'unchanged' | 'source-only' | 'local-only' | 'converged' | 'conflict'

export function classifyCell(base: number, local: number, incoming: number): CellState {
  if (local === base && incoming === base) return 'unchanged'
  if (local === base && incoming !== base) return 'source-only'
  if (local !== base && incoming === base) return 'local-only'
  if (local !== base && incoming !== base && local === incoming) return 'converged'
  return 'conflict'
}

// -- row / cell lifecycle (§DI11's two-phase classification, §DI-D17) -------

export type CellLifecycle =
  | { kind: 'three-way'; sourceColumnId: string; nodeId: string; state: CellState; base: number; local: number; incoming: number }
  | { kind: 'locally-deleted'; sourceColumnId: string; base: number; incoming: number }
  // a column newly mapped THIS refresh (`snapshot.newSourceColumnIds`) --
  // always materializes, never a recreate/discard choice; distinct from
  // `locally-deleted`, which is an EXISTING column that lost its node.
  | { kind: 'added-cell'; sourceColumnId: string; incoming: number }
// A cell whose column already existed, has zero matching Parameters, AND no
// stored base at all is "already-discarded" -- the user previously chose
// discard. It is NOT represented here: it is silently skipped by `diffRefresh`
// so it never resurfaces, per §DI11 phase 2 item 6.

/** A sheet-sourced `label`-role constituent change (§DI11 "label composition
 *  has a different diff unit" mechanism 1) -- always auto-appliable, never a
 *  conflict. Also produced, uniformly, when the column was REMOVED this
 *  refresh (`incoming` reads as `''`) or newly mapped (`base` reads as `''`)
 *  -- both are just the two edges of the same base/incoming text compare. */
export type LabelConstituentChange = { sourceColumnId: string; base: string; incoming: string }

/** A `foreignKey`-role cell's VALUE re-pointing to a different key (§DI11
 *  mechanism 4) -- always surfaced, never auto-applied. Only produced for a
 *  column that survives the refresh (a REMOVED foreignKey column has no
 *  accept/reject choice at all -- it is simply dropped, per the removed-
 *  column rules below). */
export type FkChange = { sourceColumnId: string; base: string; incoming: string }

export type RowLifecycle =
  | { kind: 'added'; sourceKey: string; number: Record<string, number>; label: Record<string, string>; foreignKey: Record<string, string> }
  | { kind: 'missing'; sourceKey: string; dependents: readonly ImportForeignKeyDependency[] }
  | {
      kind: 'present'
      sourceKey: string
      cells: readonly CellLifecycle[]
      fkChanges: readonly FkChange[]
      labelConstituentChanges: readonly LabelConstituentChange[]
    }

/** §"Removed-column defaults, per role" / §DI-D20 -- `key` can never be
 *  removed (`validateRefreshSnapshot` already refuses that pairing), so it
 *  never appears here. */
export type RemovedColumnOutcome =
  | { role: 'number'; sourceColumnId: string; nodeIds: readonly string[] }
  | { role: 'label'; sourceColumnId: string }
  | { role: 'foreignKey'; sourceColumnId: string }

/** A dependent table's row whose `foreignKey` cell would still point at a
 *  key this refresh is dropping (§"A missing lookup row..."/§DI-D21). A
 *  DATA-MODEL dependency, never a graph reference -- kept structurally
 *  separate from `findReferences` (`dataImportReferences.ts`), which only
 *  ever scans the live graph. */
export type ImportForeignKeyDependency = { dependentTableId: string; dependentSourceKey: string; sourceColumnId: string }

export function findImportForeignKeyDependents(
  tables: readonly ImportSourceTable[],
  targetTableId: string,
  targetSourceKey: string,
): ImportForeignKeyDependency[] {
  const out: ImportForeignKeyDependency[] = []
  for (const t of tables) {
    for (const col of t.columns) {
      if (col.role !== 'foreignKey' || col.refTableId !== targetTableId) continue
      for (const row of t.rows) {
        if (row.foreignKey[col.sourceColumnId] === targetSourceKey) {
          out.push({ dependentTableId: t.sourceTableId, dependentSourceKey: row.sourceKey, sourceColumnId: col.sourceColumnId })
        }
      }
    }
  }
  return out
}

/** §DI-D15 -- two or more ACTIVE Parameters sharing one generating triple is
 *  a data-integrity error, never a state to classify. `sourceTableId` is
 *  included so a cross-table consumer (the CSV exporter) can use the exact
 *  same shape without re-deriving it. */
export type DuplicateTripleError = { sourceTableId: string; sourceKey: string; sourceColumnId: string; nodeIds: string[] }

/** The refusal detail `buildRefreshCommit` returns when a resolution tries
 *  to unlink or delete a `missing` row still FK-referenced elsewhere. */
export type MissingRowDependencyError = { sourceKey: string; dependents: readonly ImportForeignKeyDependency[] }

/** A `label`-role cell change (or removal) on the refreshed table reaching
 *  another table's Parameter through an FK (§DI10 -- label composition
 *  never chases a target row's own FK columns transitively, so this is
 *  triggered ONLY by a `label`-role change, never a `foreignKey`-role one). */
export type CrossTableImpact = { dependentTableId: string; dependentSourceKey: string; sourceColumnId: string }

// A REAL runtime symbol (never `declare const`, which has no runtime value
// and throws when used as a computed property key -- the exact trap fixed
// in `dataImportRefreshValidate.ts`'s own `REFRESH_BRAND` earlier this
// phase). Never exported, so `RefreshDiffPlan` is unconstructable outside
// this module.
const DIFF_BRAND: unique symbol = Symbol('RefreshDiffPlan')

export type RefreshDiffPlan = {
  readonly refreshingTableId: string
  /** carried through untouched -- `resolvedColumns` / `newSourceColumnIds`
   *  are still available at commit time, so `buildRefreshCommit` never
   *  re-derives column choices from raw pairings. */
  readonly snapshot: ValidatedRefreshSnapshot
  readonly rows: readonly RowLifecycle[]
  readonly removedColumns: readonly RemovedColumnOutcome[]
  readonly crossTableLabelImpact: readonly CrossTableImpact[]
  readonly [DIFF_BRAND]: true
}

export function diffRefresh(
  tables: readonly ImportSourceTable[],
  refreshingTableId: string,
  hostNodes: readonly LoopNode[],
  snapshot: ValidatedRefreshSnapshot, // ONLY this branded type -- never raw rows
): { ok: true; plan: RefreshDiffPlan } | { ok: false; duplicateTriples: DuplicateTripleError[] } {
  // `validateRefreshSnapshot` already confirmed `refreshingTableId` names a
  // real table in `tables` -- a `ValidatedRefreshSnapshot` cannot exist
  // otherwise, so this lookup is guaranteed to succeed.
  const table = tables.find((t) => t.sourceTableId === refreshingTableId)!

  const tripleNodes = hostNodes.filter((n) => {
    const d = paramData(n)
    return d?.sourceTableId === refreshingTableId && d.sourceKey !== undefined && d.sourceColumnId !== undefined
  })

  // -- duplicate-triple guard, run FIRST, before anything else. Scans EVERY
  // Parameter tied to this table, regardless of what THIS refresh's
  // incoming data says about its row/column (a `missing` row's surviving
  // Parameters, and a column about to be `column-removed`, are both
  // included) -- never just `present`-row survivors. --------------------
  const byTriple = new Map<string, { sourceKey: string; sourceColumnId: string; nodes: LoopNode[] }>()
  for (const n of tripleNodes) {
    const d = paramData(n)!
    const key = tripleKey(d.sourceKey!, d.sourceColumnId!)
    const entry = byTriple.get(key) ?? { sourceKey: d.sourceKey!, sourceColumnId: d.sourceColumnId!, nodes: [] }
    entry.nodes.push(n)
    byTriple.set(key, entry)
  }
  const duplicateTriples: DuplicateTripleError[] = []
  for (const { sourceKey, sourceColumnId, nodes } of byTriple.values()) {
    if (nodes.length < 2) continue
    duplicateTriples.push({ sourceTableId: refreshingTableId, sourceKey, sourceColumnId, nodeIds: nodes.map((n) => n.id) })
  }
  if (duplicateTriples.length > 0) return { ok: false, duplicateTriples }

  // -- removed columns (a stored column absent from `resolvedColumns`) ----
  const resolvedIds = new Set(snapshot.resolvedColumns.map((c) => c.sourceColumnId))
  const removedColumns: RemovedColumnOutcome[] = []
  for (const c of table.columns) {
    if (resolvedIds.has(c.sourceColumnId)) continue
    if (c.role === 'number') {
      const nodeIds = tripleNodes.filter((n) => paramData(n)!.sourceColumnId === c.sourceColumnId).map((n) => n.id)
      removedColumns.push({ role: 'number', sourceColumnId: c.sourceColumnId, nodeIds })
    } else if (c.role === 'label') {
      removedColumns.push({ role: 'label', sourceColumnId: c.sourceColumnId })
    } else if (c.role === 'foreignKey') {
      removedColumns.push({ role: 'foreignKey', sourceColumnId: c.sourceColumnId })
    }
    // 'key' is never removable -- `validateRefreshSnapshot` already refuses it.
  }

  // -- row existence (phase 1) + per-cell / constituent state (phase 2) ---
  const oldRowsByKey = new Map(table.rows.map((r) => [r.sourceKey, r]))
  const newRowsByKey = new Map(snapshot.rows.map((r) => [r.sourceKey, r]))
  const allKeys = new Set<string>([...oldRowsByKey.keys(), ...newRowsByKey.keys()])

  const numberColumnIds = snapshot.resolvedColumns.filter((c) => c.role === 'number').map((c) => c.sourceColumnId)
  const oldLabelColumnIds = table.columns.filter((c) => c.role === 'label').map((c) => c.sourceColumnId)
  const newLabelColumnIds = new Set(snapshot.resolvedColumns.filter((c) => c.role === 'label').map((c) => c.sourceColumnId))
  const allLabelColumnIds = new Set<string>([...oldLabelColumnIds, ...newLabelColumnIds])
  const oldFkColumnIds = table.columns.filter((c) => c.role === 'foreignKey').map((c) => c.sourceColumnId)
  const newFkColumnIds = new Set(snapshot.resolvedColumns.filter((c) => c.role === 'foreignKey').map((c) => c.sourceColumnId))

  const rows: RowLifecycle[] = []
  for (const sourceKey of allKeys) {
    const oldRow = oldRowsByKey.get(sourceKey)
    const newRow = newRowsByKey.get(sourceKey)

    if (!oldRow && newRow) {
      rows.push({ kind: 'added', sourceKey, number: { ...newRow.number }, label: { ...newRow.label }, foreignKey: { ...newRow.foreignKey } })
      continue
    }
    if (oldRow && !newRow) {
      // `missing` wins outright, regardless of whether the local node also
      // happens to be deleted (§DI-D17) -- and is checked for cross-table
      // dependents here (informational; ENFORCED at commit time by
      // `buildRefreshCommit`, symmetrically with how a graph reference is
      // only enforced by `findReferences` at commit time too, never here).
      const dependents = findImportForeignKeyDependents(tables, refreshingTableId, sourceKey)
      rows.push({ kind: 'missing', sourceKey, dependents })
      continue
    }
    if (!oldRow || !newRow) continue // unreachable -- `sourceKey` came from one of the two maps

    // -- present: phase 2, per number-role cell ---------------------------
    const cells: CellLifecycle[] = []
    for (const columnId of numberColumnIds) {
      const incoming = newRow.number[columnId]
      if (incoming === undefined) continue // defensive -- `validateRefreshSnapshot` guarantees every number column has a value per row
      if (snapshot.newSourceColumnIds.has(columnId)) {
        cells.push({ kind: 'added-cell', sourceColumnId: columnId, incoming })
        continue
      }
      const matches = tripleNodes.filter((n) => {
        const d = paramData(n)!
        return d.sourceKey === sourceKey && d.sourceColumnId === columnId
      })
      const base = oldRow.number[columnId]
      if (matches.length === 0) {
        if (base === undefined) continue // already-discarded -- silently skipped, never resurfaces (§DI11 phase 2 item 6)
        cells.push({ kind: 'locally-deleted', sourceColumnId: columnId, base, incoming })
        continue
      }
      // the duplicate-triple guard above already refused the whole refresh
      // if any triple had 2+ Parameters, so exactly one match is guaranteed.
      const node = matches[0]
      const local = paramData(node)!.value
      // `base` should always be defined whenever a Parameter carries the
      // triple -- a defensive fallback to `local` covers a hand-corrupted
      // document without crashing, treating an unknown base as "no drift."
      const b = base ?? local
      cells.push({ kind: 'three-way', sourceColumnId: columnId, nodeId: node.id, state: classifyCell(b, local, incoming), base: b, local, incoming })
    }

    // -- foreignKey-role changes (surfaced, never auto-applied) -----------
    const fkChanges: FkChange[] = []
    for (const columnId of oldFkColumnIds) {
      if (!newFkColumnIds.has(columnId)) continue // removed -- no accept/reject choice, handled via `removedColumns`
      const base = oldRow.foreignKey[columnId] ?? ''
      const incoming = newRow.foreignKey[columnId] ?? ''
      if (base !== incoming) fkChanges.push({ sourceColumnId: columnId, base, incoming })
    }

    // -- label-role constituent changes (always auto-appliable) -----------
    const labelConstituentChanges: LabelConstituentChange[] = []
    for (const columnId of allLabelColumnIds) {
      const base = oldRow.label[columnId] ?? ''
      const incoming = newLabelColumnIds.has(columnId) ? (newRow.label[columnId] ?? '') : ''
      if (base !== incoming) labelConstituentChanges.push({ sourceColumnId: columnId, base, incoming })
    }

    rows.push({ kind: 'present', sourceKey, cells, fkChanges, labelConstituentChanges })
  }

  // -- cross-table label impact -- triggered ONLY by a label-role change
  // (§DI10: `resolveForeignKeyLabelTerm` never chases a target's own FK
  // columns transitively, so a `foreignKey`-role change on THIS table can
  // never affect a dependent). A removed label column is already folded
  // into `labelConstituentChanges` uniformly (its `incoming` reads `''`),
  // so this single loop covers both an ordinary text change and a removal.
  const crossTableLabelImpact: CrossTableImpact[] = []
  for (const row of rows) {
    if (row.kind !== 'present' || row.labelConstituentChanges.length === 0) continue
    crossTableLabelImpact.push(...findImportForeignKeyDependents(tables, refreshingTableId, row.sourceKey))
  }

  const plan: RefreshDiffPlan = {
    refreshingTableId,
    snapshot,
    rows,
    removedColumns,
    crossTableLabelImpact,
    [DIFF_BRAND]: true,
  }
  return { ok: true, plan }
}

// -- buildRefreshCommit -------------------------------------------------

/** The user's per-row / per-cell / per-FK choices ONLY -- never a column
 *  choice (those already live in `plan.snapshot`, resolved before the plan
 *  ever existed). Map keys for a per-cell choice are `${sourceKey}:
 *  ${sourceColumnId}`. An entry absent from a resolution map means "not yet
 *  decided" and is handled as a safe no-op below -- an unresolved `conflict`
 *  keeps the local value, an unresolved `locally-deleted` cell is left
 *  untouched (re-prompts next refresh), an unresolved FK re-point defaults
 *  to `reject` (the doc's own explicit "not yet decided" default), and an
 *  unresolved `missing` row's stored data simply carries over unchanged. */
export type RefreshResolution = {
  confirmedAdds: ReadonlySet<string>
  missingRowChoices: ReadonlyMap<string, 'unlink' | 'delete'>
  cellChoices: ReadonlyMap<string, 'apply-incoming' | 'keep-mine'>
  locallyDeletedChoices: ReadonlyMap<string, 'recreate' | 'discard'>
  fkRepointChoices: ReadonlyMap<string, 'accept' | 'reject'>
}

export type RefreshCommitResult =
  | { ok: true; createdNodes: LoopNode[]; updatedNodes: LoopNode[]; removedNodeIds: string[]; updatedTables: ImportSourceTable[] }
  | { ok: false; reason: 'referenced-node'; detail: { nodeId: string; refs: NodeReference[] } }
  | { ok: false; reason: 'missing-row-dependency'; detail: MissingRowDependencyError }

function unlinkNode(n: LoopNode): LoopNode {
  const d = paramData(n)!
  const { sourceTableId: _st, sourceKey: _sk, sourceColumnId: _sc, labelAutoComposed: _la, ...rest } = d
  return { ...n, data: rest } as LoopNode
}

/** A Parameter's full label, matching `buildImportCommit`'s own format
 *  exactly (`${table.label} · ${composed row text} · ${column header}`).
 *  `null` when the triple no longer resolves to a real row/column in
 *  `tables` (defensive -- should not happen for any triple this function is
 *  asked to relabel). Exported for `graphStore.renameDataImportTable`
 *  (§DI-D19 item 2) to reuse the SAME composition this module's own
 *  cross-table recompose uses -- a table-rename cascade must never drift
 *  from what a refresh would compute for the same row/column. */
export function parameterLabel(tables: readonly ImportSourceTable[], sourceTableId: string, sourceKey: string, sourceColumnId: string): string | null {
  const table = tables.find((t) => t.sourceTableId === sourceTableId)
  const row = table?.rows.find((r) => r.sourceKey === sourceKey)
  const column = table?.columns.find((c) => c.sourceColumnId === sourceColumnId)
  if (!table || !row || !column) return null
  const { text } = composeFullRowLabel(tables, table, row)
  return `${table.label} · ${text} · ${column.header}`
}

/** New nodes are grid-placed from `origin` using the SAME deterministic
 *  wrapped-grid + `shiftUntilClear` machinery `buildImportCommit` already
 *  uses, checked against every existing host node's rect AND every existing
 *  frame's rect -- a refresh's new nodes must never land on top of anything
 *  already on the canvas, and must never fall inside a frame purely because
 *  the viewport happened to be centred there (§DI-D12: a refresh never
 *  auto-joins a frame). */
function placeNewNodes(count: number, origin: Point, hostNodes: readonly LoopNode[], existingFrames: readonly SavedFrame[]): Point[] {
  if (count === 0) return []
  const raw = gridPositions(count, origin)
  const minX = Math.min(...raw.map((p) => p.x))
  const minY = Math.min(...raw.map((p) => p.y))
  const maxX = Math.max(...raw.map((p) => p.x)) + NODE_W
  const maxY = Math.max(...raw.map((p) => p.y)) + NODE_H
  const rect: Rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  const obstacles = [...hostNodes.map((n) => nodeRect(n.position)), ...existingFrames.map((f) => f.rect)]
  const shifted = shiftUntilClear(rect, obstacles)
  if (!shifted) return raw // guard budget exhausted -- extremely unlikely; fall back rather than fail the whole refresh
  const dx = shifted.x - rect.x
  const dy = shifted.y - rect.y
  return raw.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

export function buildRefreshCommit(
  tables: readonly ImportSourceTable[],
  plan: RefreshDiffPlan, // the ONE branded result of `diffRefresh`
  resolution: RefreshResolution,
  host: { nodes: LoopNode[]; edges: LoopEdge[] },
  modelVersion: 1 | 2,
  newNodeOrigin: Point,
  existingFrames: readonly SavedFrame[],
): RefreshCommitResult {
  const refreshingTableId = plan.refreshingTableId
  const oldTable = tables.find((t) => t.sourceTableId === refreshingTableId)!

  // -- refusal gates, checked BEFORE anything is built ---------------------
  for (const row of plan.rows) {
    if (row.kind !== 'missing' || row.dependents.length === 0) continue
    if (resolution.missingRowChoices.has(row.sourceKey)) {
      return { ok: false, reason: 'missing-row-dependency', detail: { sourceKey: row.sourceKey, dependents: row.dependents } }
    }
  }
  const tripleNodes = host.nodes.filter((n) => paramData(n)?.sourceTableId === refreshingTableId)
  for (const row of plan.rows) {
    if (row.kind !== 'missing' || resolution.missingRowChoices.get(row.sourceKey) !== 'delete') continue
    const nodeIds = tripleNodes.filter((n) => paramData(n)!.sourceKey === row.sourceKey).map((n) => n.id)
    for (const nodeId of nodeIds) {
      const refs = findReferences(host.nodes, host.edges, modelVersion, nodeId)
      if (refs.length > 0) return { ok: false, reason: 'referenced-node', detail: { nodeId, refs } }
    }
  }

  const updatedNodesById = new Map<string, LoopNode>()
  const removedNodeIds: string[] = []
  const unlinkedThisCommit = new Set<string>()
  const removedThisCommit = new Set<string>()
  const newRows: ImportRow[] = []
  const pending: { sourceKey: string; sourceColumnId: string; value: number }[] = []

  const oldRowsByKey = new Map(oldTable.rows.map((r) => [r.sourceKey, r]))
  const newRowsByKey = new Map(plan.snapshot.rows.map((r) => [r.sourceKey, r]))

  // -- bulk-unlink every Parameter under a removed `number`-role column ----
  for (const rc of plan.removedColumns) {
    if (rc.role !== 'number') continue
    for (const nodeId of rc.nodeIds) {
      const node = host.nodes.find((n) => n.id === nodeId)
      if (!node) continue
      updatedNodesById.set(nodeId, unlinkNode(node))
      unlinkedThisCommit.add(nodeId)
    }
  }

  for (const row of plan.rows) {
    if (row.kind === 'added') {
      if (!resolution.confirmedAdds.has(row.sourceKey)) continue // not yet confirmed -- excluded entirely, reappears as `added` next refresh
      newRows.push({ sourceKey: row.sourceKey, number: { ...row.number }, label: { ...row.label }, foreignKey: { ...row.foreignKey } })
      for (const [sourceColumnId, value] of Object.entries(row.number)) pending.push({ sourceKey: row.sourceKey, sourceColumnId, value })
      continue
    }

    if (row.kind === 'missing') {
      const choice = resolution.missingRowChoices.get(row.sourceKey)
      const ownedNodeIds = tripleNodes.filter((n) => paramData(n)!.sourceKey === row.sourceKey).map((n) => n.id)
      if (choice === 'unlink') {
        for (const nodeId of ownedNodeIds) {
          const node = host.nodes.find((n) => n.id === nodeId)
          if (!node) continue
          updatedNodesById.set(nodeId, unlinkNode(node))
          unlinkedThisCommit.add(nodeId)
        }
        continue // row + base dropped entirely
      }
      if (choice === 'delete') {
        for (const nodeId of ownedNodeIds) {
          removedNodeIds.push(nodeId)
          removedThisCommit.add(nodeId)
        }
        continue
      }
      // unresolved -- no-op: the row's stored data carries over unchanged
      const carried = oldRowsByKey.get(row.sourceKey)
      if (carried) newRows.push({ sourceKey: carried.sourceKey, number: { ...carried.number }, label: { ...carried.label }, foreignKey: { ...carried.foreignKey } })
      continue
    }

    // present
    const newRow = newRowsByKey.get(row.sourceKey)!

    const number: Record<string, number> = {}
    for (const cell of row.cells) {
      if (cell.kind === 'added-cell') {
        number[cell.sourceColumnId] = cell.incoming
        pending.push({ sourceKey: row.sourceKey, sourceColumnId: cell.sourceColumnId, value: cell.incoming })
        continue
      }
      if (cell.kind === 'locally-deleted') {
        const choice = resolution.locallyDeletedChoices.get(`${row.sourceKey}:${cell.sourceColumnId}`)
        if (choice === 'recreate') {
          number[cell.sourceColumnId] = cell.incoming
          pending.push({ sourceKey: row.sourceKey, sourceColumnId: cell.sourceColumnId, value: cell.incoming })
        } else if (choice === 'discard') {
          // omitted -- this cell's base-projection entry is dropped
        } else {
          number[cell.sourceColumnId] = cell.base // unresolved -- no-op, re-prompts next refresh
        }
        continue
      }
      // three-way
      if (cell.state === 'local-only') {
        number[cell.sourceColumnId] = cell.base // base does not move
        continue
      }
      number[cell.sourceColumnId] = cell.incoming // every other state moves base to incoming
      if (cell.state === 'source-only' || cell.state === 'converged') {
        const node = host.nodes.find((n) => n.id === cell.nodeId)!
        updatedNodesById.set(cell.nodeId, { ...node, data: { ...paramData(node)!, value: cell.incoming } })
      } else if (cell.state === 'conflict') {
        const choice = resolution.cellChoices.get(`${row.sourceKey}:${cell.sourceColumnId}`) ?? 'keep-mine'
        if (choice === 'apply-incoming') {
          const node = host.nodes.find((n) => n.id === cell.nodeId)!
          updatedNodesById.set(cell.nodeId, { ...node, data: { ...paramData(node)!, value: cell.incoming } })
        }
      }
    }

    const fkChangeByColumn = new Map(row.fkChanges.map((c) => [c.sourceColumnId, c]))
    const foreignKey: Record<string, string> = {}
    for (const col of plan.snapshot.resolvedColumns) {
      if (col.role !== 'foreignKey') continue
      const change = fkChangeByColumn.get(col.sourceColumnId)
      if (!change) {
        const v = newRow.foreignKey[col.sourceColumnId]
        if (v !== undefined) foreignKey[col.sourceColumnId] = v
        continue
      }
      // doc's own explicit default for "not yet decided": reject (base stays put)
      const choice = resolution.fkRepointChoices.get(`${row.sourceKey}:${col.sourceColumnId}`) ?? 'reject'
      foreignKey[col.sourceColumnId] = choice === 'accept' ? change.incoming : change.base
    }

    const label: Record<string, string> = {}
    for (const col of plan.snapshot.resolvedColumns) {
      if (col.role !== 'label') continue
      const v = newRow.label[col.sourceColumnId]
      if (v !== undefined) label[col.sourceColumnId] = v
    }

    newRows.push({ sourceKey: row.sourceKey, number, label, foreignKey })
  }

  // -- label recompose, in the doc's own fixed 4-step order ----------------
  // 1. the refreshed table's OWN final record, built above as `newRows`.
  const refreshedTable: ImportSourceTable = {
    sourceTableId: refreshingTableId,
    label: oldTable.label,
    columns: plan.snapshot.resolvedColumns.map((c) => ({ ...c })),
    rows: newRows,
  }
  // 2. splice it into the whole batch -- everything else unchanged.
  const postRefreshTables: ImportSourceTable[] = tables.map((t) => (t.sourceTableId === refreshingTableId ? refreshedTable : t))

  // 3/4. compose against `postRefreshTables` (NEVER the stale pre-refresh
  // `tables`) and apply as `updatedNodes` -- this table's own Parameters
  // first, then every cross-table dependent.
  for (const n of tripleNodes) {
    if (unlinkedThisCommit.has(n.id) || removedThisCommit.has(n.id)) continue
    const d = paramData(n)!
    if (d.labelAutoComposed !== true || !d.sourceKey || !d.sourceColumnId) continue
    const label = parameterLabel(postRefreshTables, refreshingTableId, d.sourceKey, d.sourceColumnId)
    if (label === null || label === d.label) continue // no actual text change -- leave the node out of `updatedNodes` entirely unless something else already touched it
    const base = updatedNodesById.get(n.id) ?? n
    updatedNodesById.set(n.id, { ...base, data: { ...paramData(base)!, label } })
  }

  const impactedPairs = new Set(plan.crossTableLabelImpact.map((i) => pairKey(i.dependentTableId, i.dependentSourceKey)))
  if (impactedPairs.size > 0) {
    for (const n of host.nodes) {
      const d = paramData(n)
      if (!d || d.sourceTableId === refreshingTableId) continue // this table's own nodes handled above
      if (d.labelAutoComposed !== true || !d.sourceTableId || !d.sourceKey || !d.sourceColumnId) continue
      if (!impactedPairs.has(pairKey(d.sourceTableId, d.sourceKey))) continue
      const label = parameterLabel(postRefreshTables, d.sourceTableId, d.sourceKey, d.sourceColumnId)
      if (label === null || label === d.label) continue
      const base = updatedNodesById.get(n.id) ?? n
      updatedNodesById.set(n.id, { ...base, data: { ...paramData(base)!, label } })
    }
  }

  // -- materialize every pending cell (added confirmations, added-cell,
  // recreated locally-deleted cells) -- grid-placed together, clear of
  // every existing node and every existing frame (§DI-D12). -------------
  const positions = placeNewNodes(pending.length, newNodeOrigin, host.nodes, existingFrames)
  const createdNodes: LoopNode[] = pending.map((p, i) => {
    const label = parameterLabel(postRefreshTables, refreshingTableId, p.sourceKey, p.sourceColumnId) ?? p.sourceKey
    return {
      id: nextId('parameter'),
      type: 'parameter',
      position: positions[i],
      data: {
        kind: 'parameter',
        label,
        value: p.value,
        sourceTableId: refreshingTableId,
        sourceKey: p.sourceKey,
        sourceColumnId: p.sourceColumnId,
        labelAutoComposed: true,
      },
    } as LoopNode
  })

  return {
    ok: true,
    createdNodes,
    updatedNodes: [...updatedNodesById.values()],
    removedNodeIds,
    updatedTables: [refreshedTable],
  }
}
