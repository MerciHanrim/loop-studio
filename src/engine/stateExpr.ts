// Shared parse / validation for state-edge expressions — the ONE source of
// truth for `activator` comparisons, `label` modifiers, and `trigger` `delay`.
// `step.ts` (the engine) and `Inspector.tsx` (the editor) both import from here
// so the editor can never accept — or auto-normalise — something the engine
// would treat as inert. Frozen grammar: SEMANTICS-S.md §S6 (activator, label),
// SEMANTICS-S2.md is unrelated (it only touches the label *report* shape).

/** activator comparison: `(>=|>|<=|<|==|!=)\s*<finite real>`, space-tolerant */
export const ACT_RE = /^\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/
export const ACT_OP_ONLY_RE = /^\s*(>=|<=|==|!=|>|<)\s*$/
/** label modifier: `[+\-=]\s*(<finite real ≥ 0> | S)`, space-tolerant */
export const LABEL_RE = /^\s*([+\-=])\s*(\d+(?:\.\d+)?|S)\s*$/

export type ActivatorReason = 'empty' | 'op-only' | 'not-a-comparison' | 'non-finite'
export type ActivatorParse = { ok: true; op: string; n: number } | { ok: false; reason: ActivatorReason }

/** the fragment the engine appends after `expression "<raw>" ` (frozen wording) */
export const ACT_WHY: Record<ActivatorReason, string> = {
  empty: 'is empty',
  'op-only': 'has no comparison value',
  'not-a-comparison': 'is not a comparison (expected e.g. ">= 5")',
  'non-finite': 'uses a non-finite value',
}
/** short hint for the inline editor */
export const ACT_HINT: Record<ActivatorReason, string> = {
  empty: 'enter a comparison, e.g. >= 5',
  'op-only': 'add a number, e.g. >= 5',
  'not-a-comparison': 'use >= <= > < == != then a number',
  'non-finite': 'the number must be finite',
}

export function parseActivatorExpr(raw: string): ActivatorParse {
  const s = raw ?? ''
  const m = ACT_RE.exec(s)
  if (!m) {
    if (s.trim() === '') return { ok: false, reason: 'empty' }
    if (ACT_OP_ONLY_RE.test(s)) return { ok: false, reason: 'op-only' }
    return { ok: false, reason: 'not-a-comparison' }
  }
  const n = Number(m[2])
  if (!Number.isFinite(n)) return { ok: false, reason: 'non-finite' }
  return { ok: true, op: m[1], n }
}

export type LabelReason = 'empty' | 'not-an-assignment' | 'non-finite'
export type LabelParse =
  | { ok: true; op: '+' | '-' | '='; token: 'N' | 'S'; n: number } // `n` is meaningful only for token 'N'
  | { ok: false; reason: LabelReason }

export const LABEL_WHY: Record<LabelReason, string> = {
  empty: 'is empty',
  'not-an-assignment': 'is not a +N / -N / =N / +S / -S / =S assignment',
  'non-finite': 'uses a non-finite value',
}
export const LABEL_HINT: Record<LabelReason, string> = {
  empty: 'enter a modifier, e.g. +1 or =S',
  'not-an-assignment': 'use + - or = then a number or S',
  'non-finite': 'the number must be finite',
}

export function parseLabelExpr(raw: string): LabelParse {
  const s = raw ?? ''
  const m = LABEL_RE.exec(s)
  if (!m) return { ok: false, reason: s.trim() === '' ? 'empty' : 'not-an-assignment' }
  const op = m[1] as '+' | '-' | '='
  if (m[2] === 'S') return { ok: true, op, token: 'S', n: Number.NaN }
  const n = Number(m[2])
  if (!Number.isFinite(n)) return { ok: false, reason: 'non-finite' }
  return { ok: true, op, token: 'N', n }
}

export type DelayParse = { ok: true; delay: number } | { ok: false }
/** `trigger` delay — a non-negative integer; anything else ⇒ engine treats as 0 */
export function parseDelay(raw: unknown): DelayParse {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? { ok: true, delay: raw } : { ok: false }
}
