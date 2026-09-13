import { readRoutingPayload } from './edgeRouting'
import { defaultData } from './factory'
import { readParameterData, readRegisterData, SOURCE_ID_MAX_BYTES, SOURCE_KEY_MAX_BYTES, utf8Len } from './model'
import type { LoopEdge, LoopNode, NodeKind } from './types'

export const STORAGE_KEY = 'loop-studio:graph:v1'

/** loop-model/2 (SEMANTICS-M2.md §M2-1) — the model-semantics version rides the
 *  `schema` string, NOT `version`: a reader that does not recognise a `schema`
 *  value already rejects the file, so a pre-`loop-model/2` client fail-closes on
 *  a v2 document with no code change. `version` stays `1` for both (the JSON
 *  envelope shape is unchanged). */
export const SCHEMA_V1 = 'loop-studio/graph'
export const SCHEMA_V2 = 'loop-studio/graph/2'
const SCHEMA_VERSION = 1

export type ModelSemanticsVersion = 1 | 2

const SCHEMA_BY_MODEL_VERSION: Record<ModelSemanticsVersion, string> = {
  1: SCHEMA_V1,
  2: SCHEMA_V2,
}
/** The model-semantics version a `schema` string denotes, or `null` if the
 *  string is not a Loop Studio graph schema at all (⇒ the reader rejects it). */
export function modelVersionForSchema(schema: unknown): ModelSemanticsVersion | null {
  if (schema === SCHEMA_V1) return 1
  if (schema === SCHEMA_V2) return 2
  return null
}

/**
 * Advisory execution defaults saved alongside the graph so a shared file
 * reproduces the run the author intended. NOT read by the engine — the app
 * applies the Monte-Carlo fields (`baseSeed` / `runs` / `steps` / `tracked`)
 * and `canvasLocked` on an explicit document / template load only (never on
 * localStorage restore). Separately, the app's autosave record persists the
 * *current* in-app Timeline series selection under a one-field
 * `recommendedRunConfig` `{ timelineSeries }`, purely so a plain reload restores
 * that selection (see `saveToStorage`) — this is reload state, not a change to
 * the file-level meaning of any field here. Every field is optional; an
 * unknown-shaped value is ignored on load.
 */
export type RecommendedRunConfig = {
  baseSeed?: number
  runs?: number
  steps?: number
  /** Pool ids to track; `[]` means every Pool. Filtered to the loaded graph. */
  tracked?: string[]
  /**
   * Advisory Timeline display default: the series shown when the document is
   * opened — Pool **and** Register ids, sorted. Absent ⇒ every series is shown
   * (unchanged behaviour). Distinct from `tracked` (that is Monte-Carlo).
   *
   * A pure display preference: on document / template / Workspace / Share /
   * revision load it seeds the visible set, and every graph Export writes the
   * current value back. The app's autosave record ALSO persists whatever the
   * current selection is — the only `recommendedRunConfig` slice that does —
   * purely so a plain reload restores it (recommended subset + "+N more", never
   * the incoherent "every series shown, no collapse"). NEVER part of the
   * GraphDoc proper, the `loop-revision/*` digest, undo, or `simulationRev`.
   * Unknown / deleted ids are ignored, not an error.
   */
  timelineSeries?: string[]

  /**
   * Advisory: open the document with the Canvas **edit-locked** (nodes don't
   * move / connect, nothing deletes, the Inspector is read-only — selection,
   * pan / zoom, minimap, Timeline and the simulation still work). Absent /
   * falsey ⇒ unlocked (unchanged behaviour). Like `timelineSeries` it is a
   * UI-only preference — applied on load, written back by Export, never in the
   * GraphDoc / digest / undo. The user can flip the Controls lock at any time.
   */
  canvasLocked?: boolean
}

/**
 * LGR Slice 5 (`SEMANTICS-R5.md` / `docs/large-graph-readability-saved-frames.md`)
 * — a saved group frame. A labelled rectangle with an optional preset accent
 * and **no membership** (§LGR6.5). Graph-level, `loop-revision/5` **cosmetic**
 * content: it never reaches the engine, `SimState`, or the semantic digest, and
 * `frames` absent / empty ⇒ the file is byte-identical to a pre-Slice-5 file.
 * Only a MANUAL frame (drawn, or an auto frame the user promoted — §AF5 R5) is
 * ever written here; a pure suggested frame stays session-only.
 */
export const SF_FRAME_COLORS = ['slate', 'sage', 'gold', 'violet', 'rose'] as const
export type SavedFrameColor = (typeof SF_FRAME_COLORS)[number]
/** §R5-1.1 — the defensive-read caps. */
export const SF_LABEL_MAX = 120
export const SF_FRAMES_MAX = 200

export type SavedFrame = {
  id: string
  label: string
  rect: { x: number; y: number; w: number; h: number }
  color?: SavedFrameColor
}

/**
 * docs/data-import.md §DI9 / §DI11 / §DI13 (`loop-revision/8`, SEMANTICS-R8.md)
 * — the document-level import-source records a spreadsheet snapshot import
 * (Phase 1B, not built here) will write. Graph-level, like `frames`: present
 * only when non-empty. Unlike `frames`, this is `provenance`-tagged, not
 * `cosmetic` (§R8-3) — it doesn't affect the engine today, but it changes the
 * MEANING of a future refresh, so it is real document content someone might
 * git-diff or three-way-merge, not a purely presentational overlay.
 *
 * One record per bound table: its stable `sourceTableId` (never shown, never
 * user-editable — the refresh match key), its display `label` (freely
 * renameable, presentation only), its column-role configuration, and the
 * per-row base projection every future refresh diffs against. Never the full
 * original row, an unmapped/ignored column, or a source file/Sheet URL
 * (§DI-D6) — `ignored` is Phase 1B's OWN transient preview-selection state
 * (a column the user hasn't assigned a role to yet), never a role this wire
 * shape recognises: `readDataImports` drops a column carrying it exactly like
 * any other unrecognised role, so it can never reach GraphDoc content.
 */
export type ImportColumnRole = 'key' | 'number' | 'label' | 'foreignKey'

export type ImportColumn = {
  /** freshly minted once per column-role mapping (§DI9); never the header text. */
  sourceColumnId: string
  role: ImportColumnRole
  /** the CURRENT header text — display / CSV-facing only (§DI9). */
  header: string
  /** `role: 'foreignKey'` only — the `sourceTableId` this column's values
   *  reference (§DI8). */
  refTableId?: string
}

export type ImportRow = {
  sourceKey: string
  /** `sourceColumnId` -> value, one entry per mapped `number`-role column. */
  number: Record<string, number>
  /** `sourceColumnId` -> text, one entry per mapped `label`-role column. */
  label: Record<string, string>
  /** `sourceColumnId` -> the referenced table's `sourceKey`, one entry per
   *  mapped `foreignKey`-role column. */
  foreignKey: Record<string, string>
}

export type ImportSourceTable = {
  sourceTableId: string
  label: string
  columns: ImportColumn[]
  rows: ImportRow[]
}

/** §DI-D6 / defensive-read caps — generous, but bounded against a corrupted
 *  or maliciously huge file. */
export const DI_TABLES_MAX = 64
export const DI_COLUMNS_MAX = 128
export const DI_ROWS_MAX = 20_000
export const DI_LABEL_MAX = 200
export const DI_HEADER_MAX = 200

export type GraphDoc = {
  schema: string
  version: number
  nodes: LoopNode[]
  edges: LoopEdge[]
  recommendedRunConfig?: RecommendedRunConfig
  /** LGR Slice 5 (`loop-revision/5`, SEMANTICS-R5.md) — the saved manual group
   *  frames. Emitted only when non-empty; absent ⇒ no frames, byte-identical to
   *  a pre-Slice-5 file. Read defensively (`readSavedFrames`). */
  frames?: SavedFrame[]
  /** `loop-revision/8` (SEMANTICS-R8.md, docs/data-import.md) — the saved
   *  spreadsheet-import source records. Emitted only when non-empty. Read
   *  defensively (`readDataImports`). */
  dataImports?: ImportSourceTable[]
  /** loop-workspace/1 extension (SEMANTICS-W.md) — an opaque blob here; the
   *  Workspace reader validates it against the loaded graph. Absent on a plain
   *  Graph Export. */
  workspace?: unknown
  /** loop-revision/1 extension (SEMANTICS-R.md) — an opaque blob here; the
   *  revision reader validates it. On the autosave record it holds the
   *  lightweight project *header* (never `base.content`, never `workspace`) so
   *  the graph + its project lineage are one atomic `localStorage` write. */
  project?: unknown
}

let sfSeq = 0
const freshFrameId = (): string => `frame_${Date.now().toString(36)}_${(sfSeq++).toString(36)}`

/**
 * `SEMANTICS-R5.md §R5-1.1` — the defensive read of `GraphDoc.frames`. Drops a
 * bad ENTRY, never the graph. A file-clashing / missing `id` is replaced with a
 * fresh session id (the file's id string is not trusted for identity). `label`
 * is coerced + capped, `rect` kept verbatim (finite, positive size), `color`
 * kept only if it is a palette id. At most `SF_FRAMES_MAX` entries survive.
 * The `n` ordinal is never read — the store re-derives it from array order.
 */
export function readSavedFrames(raw: unknown): SavedFrame[] {
  if (!Array.isArray(raw)) return []
  const out: SavedFrame[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (out.length >= SF_FRAMES_MAX) break
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const r = e.rect as Record<string, unknown> | undefined
    if (!r || typeof r !== 'object') continue
    const x = r.x
    const y = r.y
    const w = r.w
    const h = r.h
    if (
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof w !== 'number' || !Number.isFinite(w) || w <= 0 ||
      typeof h !== 'number' || !Number.isFinite(h) || h <= 0
    ) {
      continue
    }
    let id = typeof e.id === 'string' ? e.id : ''
    if (id === '' || seen.has(id)) id = freshFrameId()
    seen.add(id)
    let label = typeof e.label === 'string' ? e.label : e.label == null ? '' : String(e.label)
    if (label.length > SF_LABEL_MAX) label = label.slice(0, SF_LABEL_MAX)
    const frame: SavedFrame = {
      id,
      label,
      rect: { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, w, h },
    }
    if (typeof e.color === 'string' && (SF_FRAME_COLORS as readonly string[]).includes(e.color)) {
      frame.color = e.color as SavedFrameColor
    }
    out.push(frame)
  }
  return out
}

/** Project a live frame to the wire shape (`§R5-2.1` key order): `id`, `label`,
 *  `rect` (`x, y, w, h`), then `color` only when set. `n` / `selectedId` etc.
 *  are never emitted. */
function toDocFrame(f: SavedFrame): SavedFrame {
  const rect = { x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h }
  return f.color ? { id: f.id, label: f.label, rect, color: f.color } : { id: f.id, label: f.label, rect }
}

const IMPORT_COLUMN_ROLES: readonly ImportColumnRole[] = ['key', 'number', 'label', 'foreignKey']

/** §DI-D8 — the SAME ceilings `readParameterData` enforces on a Parameter's
 *  generating triple (`SOURCE_ID_MAX_BYTES` / `SOURCE_KEY_MAX_BYTES`,
 *  `src/model/model/parameter.ts`), applied here too. Without this, a
 *  129-byte `sourceTableId` (say) could survive in a `dataImports` table
 *  record while being dropped by `readParameterData` on any Parameter
 *  pointing at it — silently severing the exact linkage §DI9 depends on. An
 *  over-limit identifier is EXCLUDED, never truncated: truncating would
 *  produce a shorter id that might collide with, or simply no longer MATCH,
 *  a Parameter's own (independently-truncated-or-not) stored value. */
const isValidSourceId = (v: string): boolean => v !== '' && utf8Len(v) <= SOURCE_ID_MAX_BYTES
const isValidSourceKey = (v: string): boolean => v !== '' && utf8Len(v) <= SOURCE_KEY_MAX_BYTES

/**
 * `SEMANTICS-R8.md §R8-1.1` — the defensive read of `GraphDoc.dataImports`.
 * Drops a bad ENTRY (table, column, or row), never the graph — and drops
 * DETERMINISTICALLY: unlike `readSavedFrames`, a missing, clashing, or
 * OVER-LENGTH (`isValidSourceId` / `isValidSourceKey`) `sourceTableId` /
 * `sourceColumnId` / row `sourceKey` / FK-referenced `sourceKey` is never
 * minted a fresh replacement id, and never truncated. Regenerating one would
 * (a) make re-reading the SAME file twice produce a DIFFERENT canonical
 * projection and digest (the old design used `Date.now()`), breaking the
 * basic "a pure read is a pure function" property every other
 * `loop-revision/N` reader relies on, and (b) silently sever a Parameter's
 * stored generating triple from the table it names, the moment that table's
 * id happened to collide, go missing, or exceed the length ceiling —
 * exactly the linkage `docs/data-import.md` §DI9 depends on staying stable.
 * So a table missing / duplicating / over-length its `sourceTableId`, or a
 * column missing / duplicating / over-length its `sourceColumnId` WITHIN its
 * table, is dropped whole instead — the same first-occurrence-wins rule
 * already used for a duplicate row `sourceKey` below. A column with an
 * unrecognised `role` (this includes Phase 1B's own transient `ignored`
 * preview state, §DI-D6 — never a storable role) is likewise dropped whole.
 * A row's `number` / `label` / `foreignKey` values are kept only under a
 * `sourceColumnId` that resolves to a column of the matching role IN THIS
 * TABLE — a stray key naming no real column, or a wrong-typed value (a
 * `number` role's value not finite, a `label` role's value not a string, a
 * `foreignKey` role's value not a valid `sourceKey`), is dropped, not
 * coerced. At most `DI_TABLES_MAX` tables, `DI_COLUMNS_MAX` columns per
 * table, `DI_ROWS_MAX` rows per table survive.
 */
export function readDataImports(raw: unknown): ImportSourceTable[] {
  if (!Array.isArray(raw)) return []
  const out: ImportSourceTable[] = []
  const seenTableIds = new Set<string>()
  for (const entry of raw) {
    if (out.length >= DI_TABLES_MAX) break
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>

    const sourceTableId = typeof e.sourceTableId === 'string' ? e.sourceTableId : ''
    // missing / dup / over-length id → drop the table (never regenerated, never truncated)
    if (!isValidSourceId(sourceTableId) || seenTableIds.has(sourceTableId)) continue
    seenTableIds.add(sourceTableId)

    let label = typeof e.label === 'string' ? e.label : e.label == null ? '' : String(e.label)
    if (label.length > DI_LABEL_MAX) label = label.slice(0, DI_LABEL_MAX)

    // columns — an unrecognised role, or a missing / duplicate / over-length
    // sourceColumnId, drops the whole column (same deterministic-exclusion
    // posture as the table id above — never regenerated, never truncated).
    const columns: ImportColumn[] = []
    const seenColumnIds = new Set<string>()
    const roleByColumnId = new Map<string, ImportColumnRole>()
    if (Array.isArray(e.columns)) {
      for (const centry of e.columns) {
        if (columns.length >= DI_COLUMNS_MAX) break
        if (typeof centry !== 'object' || centry === null || Array.isArray(centry)) continue
        const c = centry as Record<string, unknown>
        const role = c.role
        if (typeof role !== 'string' || !(IMPORT_COLUMN_ROLES as readonly string[]).includes(role)) continue
        const sourceColumnId = typeof c.sourceColumnId === 'string' ? c.sourceColumnId : ''
        if (!isValidSourceId(sourceColumnId) || seenColumnIds.has(sourceColumnId)) continue
        seenColumnIds.add(sourceColumnId)
        let header = typeof c.header === 'string' ? c.header : c.header == null ? '' : String(c.header)
        if (header.length > DI_HEADER_MAX) header = header.slice(0, DI_HEADER_MAX)
        const column: ImportColumn = { sourceColumnId, role: role as ImportColumnRole, header }
        // `refTableId` is unchanged by this fix — out of the four fields
        // Hanrim's review named (§DI-D8 §5), and a dangling/over-length
        // reference here is already a tolerated, harmless state (an FK
        // column matching no known table), unlike the Parameter-linkage
        // severance the four bounded fields actually risk.
        if (role === 'foreignKey' && typeof c.refTableId === 'string' && c.refTableId !== '') {
          column.refTableId = c.refTableId
        }
        columns.push(column)
        roleByColumnId.set(sourceColumnId, column.role)
      }
    }

    // rows — a value survives only under a sourceColumnId this table actually
    // declared, of the matching role, with the right runtime type.
    const rows: ImportRow[] = []
    const seenRowKeys = new Set<string>()
    if (Array.isArray(e.rows)) {
      for (const rentry of e.rows) {
        if (rows.length >= DI_ROWS_MAX) break
        if (typeof rentry !== 'object' || rentry === null || Array.isArray(rentry)) continue
        const r = rentry as Record<string, unknown>
        if (typeof r.sourceKey !== 'string' || !isValidSourceKey(r.sourceKey) || seenRowKeys.has(r.sourceKey)) continue
        seenRowKeys.add(r.sourceKey)
        const number: Record<string, number> = {}
        const rnum = r.number
        if (rnum && typeof rnum === 'object' && !Array.isArray(rnum)) {
          for (const [cid, v] of Object.entries(rnum as Record<string, unknown>)) {
            if (roleByColumnId.get(cid) === 'number' && typeof v === 'number' && Number.isFinite(v)) {
              number[cid] = Object.is(v, -0) ? 0 : v
            }
          }
        }
        const label2: Record<string, string> = {}
        const rlab = r.label
        if (rlab && typeof rlab === 'object' && !Array.isArray(rlab)) {
          for (const [cid, v] of Object.entries(rlab as Record<string, unknown>)) {
            if (roleByColumnId.get(cid) === 'label' && typeof v === 'string') label2[cid] = v
          }
        }
        const fk: Record<string, string> = {}
        const rfk = r.foreignKey
        if (rfk && typeof rfk === 'object' && !Array.isArray(rfk)) {
          for (const [cid, v] of Object.entries(rfk as Record<string, unknown>)) {
            // the FK value is itself a `sourceKey` (of the referenced table's
            // row) — same ceiling as a row's own `sourceKey`, never truncated.
            if (roleByColumnId.get(cid) === 'foreignKey' && typeof v === 'string' && isValidSourceKey(v)) fk[cid] = v
          }
        }
        rows.push({ sourceKey: r.sourceKey, number, label: label2, foreignKey: fk })
      }
    }

    out.push({ sourceTableId, label, columns, rows })
  }
  return out
}

/** §R8-2.1 — a row's `number` / `label` / `foreignKey` maps are projected with
 *  keys sorted by `sourceColumnId`, not in whatever insertion order the live
 *  store's object happens to hold: two documents whose values are equal but
 *  were built in a different column order must still project the SAME bytes,
 *  or their digests would differ for no real content difference. */
function sortedByKey<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]
  return out
}

/** Project a live import-source table to the wire shape (`§R8-2.1` key
 *  order): `sourceTableId`, `label`, `columns` (each `sourceColumnId`, `role`,
 *  `header`, then `refTableId` only when set), `rows` (each `sourceKey`,
 *  `number`, `label`, `foreignKey`, each map key-sorted). */
function toDocImportSourceTable(t: ImportSourceTable): ImportSourceTable {
  return {
    sourceTableId: t.sourceTableId,
    label: t.label,
    columns: t.columns.map((c) =>
      c.refTableId
        ? { sourceColumnId: c.sourceColumnId, role: c.role, header: c.header, refTableId: c.refTableId }
        : { sourceColumnId: c.sourceColumnId, role: c.role, header: c.header },
    ),
    rows: t.rows.map((r) => ({
      sourceKey: r.sourceKey,
      number: sortedByKey(r.number),
      label: sortedByKey(r.label),
      foreignKey: sortedByKey(r.foreignKey),
    })),
  }
}

/**
 * `SEMANTICS-R8.md §R8-1` — true when a `parameter`-shaped node in the RAW,
 * pre-`normalizeGraph` file content carries any of the four provenance keys,
 * REGARDLESS of whether its value is valid. `readParameterData` (called from
 * `normalizeNode`, called from `normalizeGraph`, called from `deserialize`
 * below) drops a wrong-TYPED value before it ever reaches `data` — correct for
 * the PROJECTION (an invalid value should never appear in canonical content),
 * but wrong for CLASSIFICATION, which must go by storage shape alone (the
 * settled "presence, not validity" contract). By the time `deserialize`'s own
 * `normalizeGraph` call has run, that raw shape is gone for good — so this
 * scan must happen on the genuinely raw `obj.nodes` array, before any
 * normalisation, and its result carried alongside the (already-cleaned)
 * `nodes` / `dataImports` deserialize returns.
 */
export function hasRawParameterProvenanceKeys(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false
  for (const n of nodes) {
    if (typeof n !== 'object' || n === null) continue
    const nn = n as Record<string, unknown>
    const data = nn.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) continue
    const d = data as Record<string, unknown>
    const kind = d.kind ?? nn.type
    if (kind !== 'parameter') continue
    if (
      d.sourceTableId !== undefined ||
      d.sourceKey !== undefined ||
      d.sourceColumnId !== undefined ||
      d.labelAutoComposed !== undefined
    ) {
      return true
    }
  }
  return false
}

/**
 * `SEMANTICS-R8.md §R8-1` — true when the RAW `dataImports` value contains at
 * least one entry that at least ATTEMPTS to be an import-source table record
 * (a non-null, non-array object) — regardless of whether `readDataImports`
 * ultimately keeps it. Same "presence, not validity" reasoning as
 * `hasRawParameterProvenanceKeys`: a `dataImports` array every one of whose
 * entries is malformed enough to be dropped entirely must still classify as
 * `loop-revision/8` content, never silently fall back to a plain document.
 */
export function hasRawDataImportTableSignal(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false
  return raw.some((e) => typeof e === 'object' && e !== null && !Array.isArray(e))
}

const FLOW_KINDS: NodeKind[] = ['pool', 'source', 'drain', 'gate', 'converter', 'end']

/** Fill in fields an older or hand-made file may be missing (e.g. `activation`
 *  before it became `automatic` by default) without overriding saved values.
 *  For `parameter` / `register` (loop-model/1) the normalised `data` is the
 *  defensive reader's output (§M1.2 / §M2 — defaults filled, incoherent hints
 *  dropped). A model node whose shape cannot be seated (§R2-1.1) is left
 *  **exactly as authored**: the graph still loads, and the downstream
 *  `readRevisionSide` / canonical projection reject the `project` payload
 *  rather than silently repairing it. */
function normalizeNode(n: LoopNode): LoopNode {
  const kind = (n.data?.kind ?? (n.type as NodeKind | undefined)) as NodeKind | undefined
  if (!kind) return n

  if (kind === 'parameter' || kind === 'register') {
    const read = kind === 'parameter' ? readParameterData(n.data) : readRegisterData(n.data)
    if (!read.ok) return n
    return { ...n, type: n.type ?? kind, data: { ...read.data } as LoopNode['data'] }
  }

  if (!FLOW_KINDS.includes(kind)) return n
  return {
    ...n,
    type: n.type ?? kind,
    data: { ...defaultData(kind), ...n.data, kind } as LoopNode['data'],
  }
}

/** A handle id counts as "unset" when it is null, undefined, or empty. */
const isBlankHandle = (h: string | null | undefined): boolean => h == null || h === ''
const isStateHandle = (h: string | null | undefined): boolean => h?.startsWith('state') ?? false

/**
 * Backfill an edge's handle ids and data. Older / hand-made files (and the
 * templates) may leave `sourceHandle` / `targetHandle` null or '' — those bind
 * ambiguously once a node has more than one handle per side, so they snap to the
 * side circular ports (`out` / `in`). State handles (`state-source` /
 * `state-target`) are never rewritten; a blank handle on a state edge fills to
 * its state default instead.
 */
function normalizeEdge(e: LoopEdge): LoopEdge {
  const type = e.type ?? 'loop'
  const stateEdge =
    e.data?.kind === 'state' || isStateHandle(e.sourceHandle) || isStateHandle(e.targetHandle)

  // loop-revision/3 §R3-1.1 — accepted routing intent is appended TRAILING (the
  // canonical projection orders it explicitly; this keeps the serialized file
  // key order too). A bad payload is quarantined silently here; the import path
  // re-scans raw edges via `routingReadIssues` for the user warning.
  const routing = readRoutingPayload(e.data)

  if (stateEdge) {
    const prev = e.data?.kind === 'state' ? e.data : undefined
    return {
      ...e,
      type,
      sourceHandle: isBlankHandle(e.sourceHandle) ? 'state-source' : e.sourceHandle,
      targetHandle: isBlankHandle(e.targetHandle) ? 'state-target' : e.targetHandle,
      data: {
        kind: 'state',
        mode: prev?.mode ?? 'trigger',
        expr: prev?.expr ?? '',
        // `delay` (trigger only) is graph structure — keep it across a round-trip
        ...(typeof prev?.delay === 'number' ? { delay: prev.delay } : {}),
        // CSU / loop-state/3 (SEMANTICS-S3.md) — `timing` / `when` (`label`
        // only) are graph structure too, same precedent as `delay`: kept
        // across a round-trip as authored, whatever the string is. The engine
        // (src/engine/step.ts, via ./stateExpr) is the single source of truth
        // for validating them — fail-closed with a diagnostic, never silently
        // normalised here.
        ...(typeof prev?.timing === 'string' ? { timing: prev.timing } : {}),
        ...(typeof prev?.when === 'string' ? { when: prev.when } : {}),
        ...(routing.route ? { route: routing.route } : {}),
        ...(routing.waypoints ? { waypoints: routing.waypoints } : {}),
      },
    }
  }

  const prevRes = e.data?.kind === 'resource' ? (e.data as Record<string, unknown>) : undefined
  const flow = prevRes?.flow
  return {
    ...e,
    type,
    sourceHandle: isBlankHandle(e.sourceHandle) ? 'out' : e.sourceHandle,
    targetHandle: isBlankHandle(e.targetHandle) ? 'in' : e.targetHandle,
    data: {
      kind: 'resource',
      flow: flow != null && flow !== '' ? (flow as string) : '1',
      // `resourceType` is authored graph structure (loop-model/1 §M4) — keep it
      // across a round-trip, like `delay` on a state edge. A string is kept
      // as-is here; the canonical projection normalises / drops it (§M4.1).
      ...(typeof prevRes?.resourceType === 'string' ? { resourceType: prevRes.resourceType } : {}),
      ...(routing.route ? { route: routing.route } : {}),
      ...(routing.waypoints ? { waypoints: routing.waypoints } : {}),
    } as LoopEdge['data'],
  }
}

/** Backfill a whole graph — used on file import and on template / paste load. */
export function normalizeGraph(g: { nodes: LoopNode[]; edges: LoopEdge[] }): {
  nodes: LoopNode[]
  edges: LoopEdge[]
} {
  return { nodes: g.nodes.map(normalizeNode), edges: g.edges.map(normalizeEdge) }
}

/**
 * Project a live React Flow node / edge down to just the fields the document
 * owns. React Flow writes renderer state straight back onto the objects it is
 * given — `measured` (its ResizeObserver result), plus `selected` / `dragging`
 * as the user interacts — and those objects are the very ones the store hands to
 * `serialize()`. None of that belongs in a saved or shared graph: `measured`
 * depends on viewport size, fonts and *when* RF got round to measuring, so
 * letting it through makes the same graph export to different bytes on different
 * machines and even on the same machine before vs. after the first layout pass
 * (it broke the "a locale switch changes no exported byte" invariant the moment
 * RF finished measuring). `serialize()` is the single write boundary for every
 * persisted / exported form — Graph JSON, Share, Workspace, autosave — so the
 * projection to the schema shape (types.ts `LoopNode` / `LoopEdge`) happens here
 * once. Key order matches the committed example files.
 */
function toDocNode(n: LoopNode): LoopNode {
  return { id: n.id, type: n.type, position: n.position, data: n.data } as LoopNode
}

function toDocEdge(e: LoopEdge): LoopEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
    data: e.data,
  } as LoopEdge
}

export function serialize(
  nodes: LoopNode[],
  edges: LoopEdge[],
  recommendedRunConfig?: RecommendedRunConfig,
  workspace?: unknown,
  project?: unknown,
  modelVersion: ModelSemanticsVersion = 1,
  /** LGR Slice 5 — the saved MANUAL frames. Absent / empty ⇒ no `frames` key,
   *  byte-identical to a pre-Slice-5 file (`SEMANTICS-R5.md` R5-INV-2). */
  frames?: readonly SavedFrame[],
  /** `loop-revision/8` — the saved data-import source records. Absent / empty
   *  ⇒ no `dataImports` key, byte-identical to a pre-R8 file (R8-INV-2). */
  dataImports?: readonly ImportSourceTable[],
): string {
  const doc: GraphDoc = {
    schema: SCHEMA_BY_MODEL_VERSION[modelVersion] ?? SCHEMA_V1,
    version: SCHEMA_VERSION,
    nodes: nodes.map(toDocNode),
    edges: edges.map(toDocEdge),
  }
  if (recommendedRunConfig && typeof recommendedRunConfig === 'object') {
    doc.recommendedRunConfig = recommendedRunConfig
  }
  // §R5-2.1 — `frames` after `recommendedRunConfig`, only when non-empty.
  if (Array.isArray(frames) && frames.length > 0) {
    doc.frames = frames.map(toDocFrame)
  }
  // §R8-2.1 — `dataImports` after `frames`, only when non-empty.
  if (Array.isArray(dataImports) && dataImports.length > 0) {
    doc.dataImports = dataImports.map(toDocImportSourceTable)
  }
  if (workspace && typeof workspace === 'object') {
    doc.workspace = workspace
  }
  if (project && typeof project === 'object') {
    doc.project = project
  }
  return JSON.stringify(doc, null, 2)
}

export function deserialize(text: string): {
  nodes: LoopNode[]
  edges: LoopEdge[]
  /** loop-model/2 — the model-semantics version this file declares (from `schema`). */
  modelVersion: ModelSemanticsVersion
  recommendedRunConfig?: RecommendedRunConfig
  /** LGR Slice 5 — the saved manual frames, already run through `readSavedFrames`
   *  (bad entries dropped, ids resolved, labels capped). `[]` when the file has
   *  none. The store re-derives the `n` ordinal from array order. */
  frames: SavedFrame[]
  /** `loop-revision/8` — the saved data-import source records, already run
   *  through `readDataImports`. `[]` when the file has none. */
  dataImports: ImportSourceTable[]
  /** `SEMANTICS-R8.md §R8-1` — true when the file's RAW, pre-defensive-read
   *  content carried a data-import provenance signal that `readDataImports` /
   *  `readParameterData` may have gone on to discard as unreadable (an
   *  invalid-typed provenance key, or a `dataImports` entry that didn't
   *  survive). `nodes` / `dataImports` above are already cleaned by the time a
   *  caller sees them, so this is the ONLY place that signal survives —
   *  `readRevisionSide` callers must thread it through explicitly (see
   *  `revisionIO.ts`) or a corrupted-but-real provenance file misclassifies as
   *  a plain (≤ v7) document, contradicting the "presence, not validity" rule
   *  the design settled on. */
  hasRawDataImportSignal: boolean
  /** raw, unvalidated — the Workspace reader checks it against the loaded graph */
  workspace?: unknown
  /** raw, unvalidated — the revision reader (loop-revision/1) validates it */
  project?: unknown
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Unexpected file contents.')
  }
  const obj = raw as Partial<GraphDoc>
  const modelVersion = modelVersionForSchema(obj.schema)
  if (modelVersion == null) {
    // Unknown schema — including a newer `loop-studio/graph/N` a pre-N client
    // does not know (SEMANTICS-M2.md §M2-1: fail-closed, never a silent run).
    throw new Error('This does not look like a Loop Studio graph file.')
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error('Graph file is missing its nodes or edges.')
  }
  const rrc =
    obj.recommendedRunConfig && typeof obj.recommendedRunConfig === 'object' && !Array.isArray(obj.recommendedRunConfig)
      ? (obj.recommendedRunConfig as RecommendedRunConfig)
      : undefined
  const workspace =
    obj.workspace && typeof obj.workspace === 'object' && !Array.isArray(obj.workspace)
      ? obj.workspace
      : undefined
  const project =
    obj.project && typeof obj.project === 'object' && !Array.isArray(obj.project)
      ? obj.project
      : undefined
  // §R8-1 — computed on the genuinely RAW `obj.nodes` / `obj.dataImports`,
  // BEFORE `normalizeGraph` / `readDataImports` below get a chance to drop
  // anything unreadable (see `hasRawParameterProvenanceKeys`'s own doc comment).
  const hasRawDataImportSignal =
    hasRawDataImportTableSignal(obj.dataImports) || hasRawParameterProvenanceKeys(obj.nodes)
  return {
    ...normalizeGraph({ nodes: obj.nodes as LoopNode[], edges: obj.edges as LoopEdge[] }),
    modelVersion,
    frames: readSavedFrames(obj.frames), // §R5-1.1 — [] when absent / all-bad
    dataImports: readDataImports(obj.dataImports), // §R8-1.1 — [] when absent / all-bad
    hasRawDataImportSignal,
    ...(rrc ? { recommendedRunConfig: rrc } : {}),
    ...(workspace ? { workspace } : {}),
    ...(project ? { project } : {}),
  }
}

/** Autosave record — the graph and, atomically in the same write, the
 *  lightweight `project` header (or nothing) and the current Timeline series
 *  selection (as a one-field `recommendedRunConfig` `{ timelineSeries }`, or
 *  nothing while it is the "all" default) so a plain reload restores it. One
 *  `localStorage.setItem`. The Monte-Carlo fields and `canvasLocked` are
 *  deliberately NOT persisted here — they apply on an explicit document /
 *  template load only. */
export function saveToStorage(
  nodes: LoopNode[],
  edges: LoopEdge[],
  project?: unknown,
  timelineSeries?: 'all' | readonly string[],
  modelVersion: ModelSemanticsVersion = 1,
  /** LGR Slice 5 — the current saved manual frames, atomically in the same
   *  write. Absent / empty ⇒ no `frames` key. */
  frames?: readonly SavedFrame[],
  /** `loop-revision/8` — the current saved data-import source records,
   *  atomically in the same write. Absent / empty ⇒ no `dataImports` key. */
  dataImports?: readonly ImportSourceTable[],
): void {
  try {
    const rrc: RecommendedRunConfig | undefined =
      Array.isArray(timelineSeries) && timelineSeries.length > 0
        ? { timelineSeries: [...timelineSeries] }
        : undefined
    localStorage.setItem(
      STORAGE_KEY,
      serialize(nodes, edges, rrc, undefined, project, modelVersion, frames, dataImports),
    )
  } catch {
    /* storage unavailable (private mode, quota) — silently skip */
  }
}

export function loadFromStorage():
  | {
      nodes: LoopNode[]
      edges: LoopEdge[]
      modelVersion: ModelSemanticsVersion
      recommendedRunConfig?: RecommendedRunConfig
      frames: SavedFrame[]
      dataImports: ImportSourceTable[]
      project?: unknown
    }
  | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return null
    return deserialize(text)
  } catch {
    return null
  }
}
