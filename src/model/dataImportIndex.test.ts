import { describe, expect, it } from 'vitest'
import { firstByKey, groupByKey, ImportTableLookup, PathIndex, tableLookup } from './dataImportIndex'

// #423 item 7 — each index against the scan it replaces, on seeded random data
// full of duplicate keys and missing (`undefined`) parts.

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const KEYS = ['a', 'b', 'a:b', 'b:', ':', '', undefined] as const
type Item = { id: number; k1: string | undefined; k2: string | undefined; k3: string | undefined }

function items(seed: number, n: number): Item[] {
  const r = rng(seed)
  const pick = () => KEYS[Math.floor(r() * KEYS.length)]
  return Array.from({ length: n }, (_, id) => ({ id, k1: pick(), k2: pick(), k3: pick() }))
}

describe('the indexes answer what the scans answered', () => {
  for (const seed of [1, 2, 3, 42, 4230]) {
    it(`seed ${seed}: firstByKey = find, groupByKey = filter, PathIndex = a three-part filter`, () => {
      const list = items(seed, 300)
      const first = firstByKey(list, (x) => x.k1)
      const groups = groupByKey(list, (x) => x.k1)
      const path = new PathIndex(list, (x) => [x.k1, x.k2, x.k3])
      for (const a of [...KEYS, 'never']) {
        expect(first.get(a)).toBe(list.find((x) => x.k1 === a))
        expect(groups.get(a) ?? []).toEqual(list.filter((x) => x.k1 === a))
        for (const b of KEYS)
          for (const c of KEYS) expect(path.all(a, b, c)).toEqual(list.filter((x) => x.k1 === a && x.k2 === b && x.k3 === c))
      }
    })
  }

  it('a multi-part key never collides: ("a:b", "") and ("a", "b:") stay apart', () => {
    const list: Item[] = [
      { id: 1, k1: 'a:b', k2: '', k3: 'x' },
      { id: 2, k1: 'a', k2: 'b:', k3: 'x' },
    ]
    const path = new PathIndex(list, (x) => [x.k1, x.k2, x.k3])
    expect(path.all('a:b', '', 'x').map((x) => x.id)).toEqual([1])
    expect(path.all('a', 'b:', 'x').map((x) => x.id)).toEqual([2])
    expect(path.all('a', 'b', 'x')).toEqual([])
  })

  it('ImportTableLookup: the first table with an id, then its first row with a key', () => {
    const r = rng(7)
    const ids = ['t1', 't2', 't1', 't3', 't2']
    const tables = ids.map((sourceTableId, i) => ({
      sourceTableId,
      n: i,
      rows: Array.from({ length: 40 }, (_, j) => ({ sourceKey: ['k1', 'k2', 'k3', 'k1:'][Math.floor(r() * 4)]!, j })),
    }))
    const lookup = tableLookup(tables)
    expect(tableLookup(lookup)).toBe(lookup)
    expect(lookup).toBeInstanceOf(ImportTableLookup)
    for (const id of ['t1', 't2', 't3', 't4']) {
      const t = lookup.table(id)
      expect(t).toBe(tables.find((x) => x.sourceTableId === id))
      if (!t) continue
      for (const k of ['k1', 'k2', 'k3', 'k1:', 'k4']) expect(lookup.row(t, k)).toBe(t.rows.find((x) => x.sourceKey === k))
    }
  })
})
