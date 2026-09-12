// Shared parse / validation for state-edge expressions — the ONE source of
// truth for `activator` comparisons, `label` modifiers, and `trigger` `delay`.
// `step.ts` (the engine) and `Inspector.tsx` (the editor) both import from here
// so the editor can never accept — or auto-normalise — something the engine
// would treat as inert. Frozen grammar: SEMANTICS-S.md §S6 (activator, label),
// SEMANTICS-S2.md is unrelated (it only touches the label *report* shape).

import type { NodeKind } from '../model/types'
import { tokenize } from '../model/expr/tokenize'
import type { ModelVersion } from './flow'

// The node kinds that actively move resources in Phase 2 (a "routing node").
// docs/label-timing-authoring.md §LTA4.2 / LTA-D13 — canonical home, so
// `step.ts`'s own CSU3-5 source-kind check and the Inspector's
// `eligibleLabelPreset` (below) can never drift apart; `step.ts` imports and
// re-exports this rather than declaring its own copy. Also used by the
// playback-ordering layer (docs/simulation-playback-ordering.md §PBO1) so the
// cascade rank derives from the SAME kind set the engine walks.
export const ROUTER_KINDS = new Set(['gate', 'converter', 'drain', 'end'])

/** activator comparison: `(>=|>|<=|<|==|!=)\s*<finite real>`, space-tolerant */
export const ACT_RE = /^\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/
export const ACT_OP_ONLY_RE = /^\s*(>=|<=|==|!=|>|<)\s*$/
/** label modifier: `[+\-=]\s*(<finite real ≥ 0> | S)`, space-tolerant */
export const LABEL_RE = /^\s*([+\-=])\s*(\d+(?:\.\d+)?|S)\s*$/

export type ActivatorReason = 'empty' | 'op-only' | 'not-a-comparison' | 'non-finite'
/** docs/parameter-activator.md §PA4 — `loop-state/4`. A comparison's RHS is
 *  either the original literal, or a reference to a Parameter node with at
 *  most one signed integer offset (`@id`, `@id + N`, `@id - N`). */
export type ActivatorRhs = { kind: 'literal'; n: number } | { kind: 'param'; id: string; offset: number }
export type ActivatorParse = { ok: true; op: string; rhs: ActivatorRhs } | { ok: false; reason: ActivatorReason }

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

/** the operator prefix, split from its (possibly empty) remainder — used only
 *  to attempt the `param-term` extension once the literal grammar (`ACT_RE`)
 *  and the existing empty/op-only checks have already failed. */
const ACT_OP_PREFIX_RE = /^\s*(>=|<=|==|!=|>|<)\s*(.*)$/

/** docs/parameter-activator.md §PA4 — `ref [ws ("+"|"-") ws offset]`, where
 *  `offset` is a non-negative safe integer (`/^\d+$/`, i.e. the token's raw
 *  spelling has no sign, no decimal point, no exponent). Reuses the shared
 *  `loop-expr/1` tokenizer (`flow.ts`'s `parseParamRef` / `RegisterExprField`
 *  use the same one) so `@id` / `@{id}` decoding never drifts between
 *  contexts. Returns `null` for anything else — a second reference, a second
 *  operator, parentheses, a fractional or out-of-range offset, a doubled
 *  sign (`+ -1`) — every one of which falls back to `not-a-comparison`
 *  (PA5 Class 1, unchanged), never a crash. */
function parseParamTerm(s: string): { id: string; offset: number } | null {
  const r = tokenize(s)
  if (!r.ok) return null
  const t = r.tokens
  if (t.length === 2 && t[0].type === 'ref' && t[1].type === 'eof') {
    return { id: t[0].id, offset: 0 }
  }
  if (
    t.length === 4 &&
    t[0].type === 'ref' &&
    t[1].type === 'op' &&
    (t[1].op === '+' || t[1].op === '-') &&
    t[2].type === 'number' &&
    t[3].type === 'eof' &&
    /^\d+$/.test(t[2].raw) &&
    Number.isSafeInteger(t[2].value)
  ) {
    return { id: t[0].id, offset: t[1].op === '-' ? -t[2].value : t[2].value }
  }
  return null
}

/** docs/parameter-activator.md §PA4/§S4-1 — a `param-term` RHS is recognised
 *  ONLY under `modelVersion: 2`, mirroring `flow.ts`'s `parseFlow` exactly:
 *  a v1 document's stray `@hard_pity` string is `not-a-comparison`, inert,
 *  UNCHANGED from before this grammar existed — the new production is
 *  strictly opt-in via the same one versioning axis `loop-model/2`
 *  established, never silently active for a document that never asked for
 *  it. Default `1` so every existing call site (until threaded through) is
 *  unaffected. */
export function parseActivatorExpr(raw: string, modelVersion: ModelVersion = 1): ActivatorParse {
  const s = raw ?? ''
  const m = ACT_RE.exec(s)
  if (m) {
    const n = Number(m[2])
    if (!Number.isFinite(n)) return { ok: false, reason: 'non-finite' }
    return { ok: true, op: m[1], rhs: { kind: 'literal', n } }
  }
  if (s.trim() === '') return { ok: false, reason: 'empty' }
  if (ACT_OP_ONLY_RE.test(s)) return { ok: false, reason: 'op-only' }
  if (modelVersion === 2) {
    const opRhs = ACT_OP_PREFIX_RE.exec(s)
    if (opRhs) {
      const term = parseParamTerm(opRhs[2])
      if (term) return { ok: true, op: opRhs[1], rhs: { kind: 'param', id: term.id, offset: term.offset } }
    }
  }
  return { ok: false, reason: 'not-a-comparison' }
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

// ── CSU / loop-state/3 (SEMANTICS-S3.md) — conditional `label` timing ───────
// A `label` edge may run `"afterPull"` — Phase 2.5, after the pull, gated by
// `when` — instead of the default unconditional Phase 0. Grammar is a closed
// set of string literals, not a parsed expression, but lives here for the same
// reason as the rest of this file: the engine and the Inspector must agree on
// exactly what is recognised, with no silent fallback to the legacy behaviour
// for anything else (CSU3-5 — fail-closed).

export type LabelTiming = 'phase0' | 'afterPull'
export type TimingParse = { ok: true; timing: LabelTiming } | { ok: false }

/** Absent or the literal `"phase0"` ⇒ the loop-state/1 unconditional Phase-0
 *  label (the default — byte-identical to a document with no `timing` field
 *  at all). `"afterPull"` ⇒ Phase 2.5, gated by `when` (`parseLabelWhen`).
 *  Anything else is unsupported — the caller reports it as a diagnostic and
 *  treats the edge as inert; it never falls back to `"phase0"` silently. */
export function parseLabelTiming(raw: unknown): TimingParse {
  if (raw === undefined || raw === 'phase0') return { ok: true, timing: 'phase0' }
  if (raw === 'afterPull') return { ok: true, timing: 'afterPull' }
  return { ok: false }
}

export type LabelWhen = 'source-fired'
export type WhenParse = { ok: true; when: LabelWhen } | { ok: false }

/** `when` on a `timing: "afterPull"` label. The only recognised value in v1
 *  (CSU9-D3) — the edit applies iff `source ∈ fired` for the step just pulled
 *  (THIS step's `fired`, built during Phase 2 — not `fired(t−1)`, which is
 *  what `trigger` reads). */
export function parseLabelWhen(raw: unknown): WhenParse {
  if (raw === 'source-fired') return { ok: true, when: 'source-fired' }
  return { ok: false }
}

// ── docs/label-timing-authoring.md — the Inspector authoring surface ───────
// Two pure helpers the Inspector (never `step.ts`) calls: a classifier for
// what a STORED (timing, when) pair means (§LTA4.1), and an eligibility
// check for what the current GRAPH CONTEXT (source/target kind, modifier)
// allows (§LTA4.2). Neither adds a recognised value or changes `step.ts`'s
// own CSU3-5 validation — they exist so the Inspector never has to re-derive
// what this file already knows.

/** §LTA4.1 — exactly `SEMANTICS-S3.md` §S3-5 rows 1-4, and only those rows:
 *  is a stored `(timing, when)` pair the `phase0` default, a valid
 *  `afterPull`, or neither? Absent / `"phase0"` `timing` with a `when`
 *  present is `"unsupported"` (row 2 — fail-closed, never falls back to
 *  `"phase0"`); `"afterPull"` with no `when`, or an unrecognised one, is
 *  `"unsupported"` (rows 3-4); an unrecognised `timing` is `"unsupported"`
 *  (row 1). Rows 5-8 are graph-context, not a property of these two fields
 *  alone — see `eligibleLabelPreset`. */
export type LabelTimingClass = 'phase0' | 'afterPull' | 'unsupported'

export function classifyLabelTiming(rawTiming: unknown, rawWhen: unknown): LabelTimingClass {
  const t = parseLabelTiming(rawTiming)
  if (!t.ok) return 'unsupported'
  if (t.timing === 'phase0') {
    return rawWhen === undefined ? 'phase0' : 'unsupported'
  }
  const w = parseLabelWhen(rawWhen)
  return w.ok ? 'afterPull' : 'unsupported'
}

/** §LTA4.2 — why (if at all) preset A ("Always") is currently unavailable to
 *  freshly pick. Present iff A is NOT eligible. */
export type LabelPresetReasonA = 'target-not-pool' | 'modifier-invalid' | 'source-not-pool'
/** why (if at all) preset B ("On source fire") is currently unavailable.
 *  Present iff B is NOT eligible. */
export type LabelPresetReasonB = 'target-not-pool' | 'modifier-invalid' | 'source-not-router' | 's-form'

export type LabelPresetEligibility = {
  /** the ONE preset a fresh pick may currently commit to, or `null` if
   *  neither `SEMANTICS-S3.md` §S3-5 rows 5-8 admit one. Never both — a node
   *  has exactly one kind, and A needs a Pool source while B needs a Router
   *  source, so the two are mutually exclusive by construction. */
  eligible: 'A' | 'B' | null
  reasonA?: LabelPresetReasonA
  reasonB?: LabelPresetReasonB
}

/**
 * §LTA4.2 — a pure function of the edge's CURRENT graph context (never of its
 * stored `timing` / `when`): does `SEMANTICS-S3.md` §S3-5 rows 5-8 admit
 * preset A, preset B, neither, or (impossible) both? `targetKind` /
 * `sourceKind` are `undefined` when the endpoint id doesn't resolve to a node
 * (a dangling reference, reachable only via an imported file — never through
 * this codebase's own UI, since `removeNode` cascades incident-edge deletion).
 */
export function eligibleLabelPreset(ctx: {
  targetKind: NodeKind | undefined
  sourceKind: NodeKind | undefined
  modifier: LabelParse
}): LabelPresetEligibility {
  // a condition that disqualifies BOTH presets identically — checked first,
  // same priority `SEMANTICS-S3.md` §S3-5 rows 6/7 share for `phase0` too.
  const common: (LabelPresetReasonA & LabelPresetReasonB) | undefined =
    ctx.targetKind !== 'pool' ? 'target-not-pool' : !ctx.modifier.ok ? 'modifier-invalid' : undefined

  const reasonA: LabelPresetReasonA | undefined = common ?? (ctx.sourceKind !== 'pool' ? 'source-not-pool' : undefined)
  const reasonB: LabelPresetReasonB | undefined =
    common ??
    (!ctx.sourceKind || !ROUTER_KINDS.has(ctx.sourceKind)
      ? 'source-not-router'
      : !(ctx.modifier.ok && ctx.modifier.token === 'N')
        ? 's-form'
        : undefined)

  const eligible: LabelPresetEligibility['eligible'] = !reasonA ? 'A' : !reasonB ? 'B' : null
  return { eligible, ...(reasonA ? { reasonA } : {}), ...(reasonB ? { reasonB } : {}) }
}
