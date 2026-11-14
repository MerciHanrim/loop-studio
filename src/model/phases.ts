// docs/run-phases.md — the phases of a run, as the document's author named them: a
// name and the first and last step it covers. A guide for the reader beside the
// current step, never a value the engine reads: no step, no result and neither
// digest depends on it.

export type DocPhase = {
  id: string
  /** the short name shown beside the step */
  label: string
  /** the first and the last step of the phase, both counted in; a step is 1 or more */
  from: number
  to: number
}

/** the defensive-read caps */
export const PHASES_MAX = 64
export const PHASE_ID_MAX = 64
export const PHASE_LABEL_MAX = 60

const isStep = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1

/**
 * The defensive read of a document's `phases`. A bad ENTRY is dropped, never the
 * document, and the same file always reads to the same list: an entry is kept only
 * with a new id, a name and a whole `from` ≤ `to` of 1 or more that starts after
 * the last kept entry ends, so the kept phases are in step order and never overlap
 * (of two that do, the first in the file stays). A name longer than
 * `PHASE_LABEL_MAX` characters is cut there; at most `PHASES_MAX` entries stay.
 */
export function readPhases(raw: unknown): DocPhase[] {
  if (!Array.isArray(raw)) return []
  const out: DocPhase[] = []
  const seen = new Set<string>()
  let last = 0
  for (const entry of raw) {
    if (out.length >= PHASES_MAX) break
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id === '' || e.id.length > PHASE_ID_MAX || seen.has(e.id)) continue
    if (typeof e.label !== 'string' || e.label.trim() === '') continue
    if (!isStep(e.from) || !isStep(e.to) || e.from > e.to || e.from <= last) continue
    const chars = Array.from(e.label)
    seen.add(e.id)
    last = e.to
    out.push({ id: e.id, label: chars.length > PHASE_LABEL_MAX ? chars.slice(0, PHASE_LABEL_MAX).join('') : e.label, from: e.from, to: e.to })
  }
  return out
}

/** the wire shape, in its key order */
export function canonicalPhase(p: DocPhase): DocPhase {
  return { id: p.id, label: p.label, from: p.from, to: p.to }
}

/** the phase that covers `step`, or none: before the run (step 0) and in a gap */
export function phaseAt(phases: readonly DocPhase[], step: number): DocPhase | null {
  for (const p of phases) if (step >= p.from && step <= p.to) return p
  return null
}
