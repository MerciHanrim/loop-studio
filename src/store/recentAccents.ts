import { readAccent } from '../model/model'
import { storagePort } from '../storage/storagePort'

// docs/flow-colour-and-compact-nodes.md FC-2.7 — the flow colours this browser
// used last: a per-browser preference behind the storage port, so a temporary
// session keeps it in memory only and "Reset all Loop Studio data" removes it
// (the port's key table does both). Never part of a document or a link.

export const RECENT_ACCENTS_KEY = 'loop-studio:recent-accents'
export const RECENT_ACCENTS_MAX = 8

/** the stored list, newest first; anything unreadable is skipped */
export function readRecentAccents(): string[] {
  let raw: string | null
  try {
    raw = storagePort.getItem(RECENT_ACCENTS_KEY)
  } catch {
    return []
  }
  if (raw == null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const v of parsed) {
    const a = readAccent(v)
    if (a !== undefined && !out.includes(a)) out.push(a)
    if (out.length === RECENT_ACCENTS_MAX) break
  }
  return out
}

/** put `accent` first (moving it if already there), keep at most 8, store,
 *  and return the new list. A colour that does not read is ignored. */
export function rememberAccent(accent: string): string[] {
  const a = readAccent(accent)
  const current = readRecentAccents()
  if (a === undefined) return current
  const next = [a, ...current.filter((c) => c !== a)].slice(0, RECENT_ACCENTS_MAX)
  try {
    storagePort.setItem(RECENT_ACCENTS_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: the list still works for this render */
  }
  return next
}
