// #423 item 7 — lookups for the data-import paths. Each one replaces a scan
// that ran once per row or per cell (a `find` / `filter` over every row of a
// table or every node of the canvas), which made a refresh or an export at the
// 20,000-row limit take seconds to tens of seconds (measured; see the PR).
//
// Rules (Lumi, 2026-10-31):
//  - an index answers exactly what the scan answered: `find` → the FIRST
//    matching item, `filter` → EVERY matching item in its original order —
//    duplicate keys and missing provenance included
//    (src/model/dataImport.lookupOrder.test.ts pins both);
//  - it is built once at the start of one operation and reused inside it,
//    never cached across operations (the tables and nodes it was built from
//    are not watched for later changes);
//  - a multi-part key is a chain of maps, never a joined string, so different
//    tables, rows and columns can never collide (`a:b` + `c` vs `a` + `b:c`);
//  - nothing here is stored: the saved file format does not change.
//
// Keys compare like `Map` keys (SameValueZero), which for the strings and
// `undefined` these keys hold is exactly `===`.

/** What `items.find((x) => key(x) === k)` returns, for every `k` at once. */
export function firstByKey<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T> {
  const out = new Map<K, T>()
  for (const item of items) {
    const k = key(item)
    if (!out.has(k)) out.set(k, item)
  }
  return out
}

/** What `items.filter((x) => key(x) === k)` returns, for every `k` at once:
 *  all of them, in their original order. */
export function groupByKey<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

/** `groupByKey` over a key of several parts, as nested maps. `all(...parts)`
 *  is what `items.filter((x) => parts.every((p, i) => path(x)[i] === p))`
 *  returns, in the original order; `[]` when nothing matches. */
export class PathIndex<T> {
  private readonly root = new Map<unknown, unknown>()
  constructor(items: readonly T[], path: (item: T) => readonly unknown[]) {
    for (const item of items) {
      const parts = path(item)
      let level = this.root
      for (let i = 0; i < parts.length - 1; i++) {
        let next = level.get(parts[i]) as Map<unknown, unknown> | undefined
        if (!next) {
          next = new Map()
          level.set(parts[i], next)
        }
        level = next
      }
      const last = parts[parts.length - 1]
      const list = level.get(last) as T[] | undefined
      if (list) list.push(item)
      else level.set(last, [item])
    }
  }
  all(...parts: readonly unknown[]): readonly T[] {
    let level: unknown = this.root
    for (const p of parts) {
      if (!(level instanceof Map)) return []
      level = level.get(p)
    }
    return Array.isArray(level) ? (level as T[]) : []
  }
}

type KeyedTable = { sourceTableId: string; rows: readonly { sourceKey: string }[] }

/** The tables of one operation, looked up by id and by row key the way
 *  `tables.find((t) => t.sourceTableId === id)` and then
 *  `table.rows.find((r) => r.sourceKey === key)` did: the FIRST table with
 *  the id, and the FIRST row with the key in that table. A table's row map is
 *  built the first time one of its rows is asked for. */
export class ImportTableLookup<T extends KeyedTable> {
  private readonly byId: Map<string, T>
  private readonly rowMaps = new Map<T, Map<string, T['rows'][number]>>()
  constructor(tables: readonly T[]) {
    this.byId = firstByKey(tables, (t) => t.sourceTableId)
  }
  table(sourceTableId: string): T | undefined {
    return this.byId.get(sourceTableId)
  }
  row(table: T, sourceKey: string): T['rows'][number] | undefined {
    let rows = this.rowMaps.get(table)
    if (!rows) {
      rows = firstByKey(table.rows, (r) => r.sourceKey)
      this.rowMaps.set(table, rows)
    }
    return rows.get(sourceKey)
  }
}

/** A caller that already holds a lookup for this operation passes it; a
 *  one-off caller passes the plain array and gets a lookup for that call. */
export function tableLookup<T extends KeyedTable>(tables: readonly T[] | ImportTableLookup<T>): ImportTableLookup<T> {
  return tables instanceof ImportTableLookup ? tables : new ImportTableLookup(tables)
}
