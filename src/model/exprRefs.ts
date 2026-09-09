// docs/register-expression-authoring.md §RXA — pure helpers for the
// reference-aware Register expression editor. NOTHING here parses or evaluates
// an expression a second time: the read-back's verdict is read straight from
// the `RegisterOutcome` the M3.5 pass already produced (RXA-INV-8); per-`@id`
// values come from the same graph + `S(t)` the caller passes in. `@id` stays
// the only stored form (RXA-INV-1) — these functions produce a *view*.

import { canonicalPrint, canonicalRef, parse, refsOf } from './expr'
import {
  formatRegisterValue,
  readParameterData,
  readRegisterData,
  type RegisterFormat,
  type RegisterOutcome,
} from './model'
import type { LoopNode } from './types'

export type RefResolveKind = 'pool' | 'parameter' | 'register'
const REFERENCEABLE: RefResolveKind[] = ['pool', 'parameter', 'register']
const KIND_ORDER: Record<RefResolveKind, number> = { pool: 0, parameter: 1, register: 2 }

/** Why a candidate cannot be inserted from the `@` list (RXA-INV-4). */
export type RefBlock = { reason: 'self' } | { reason: 'cycle'; withName: string }

export type RefCandidate = {
  id: string
  /** disambiguated (`Label`, else `Label · Kind`, else `Label · Kind …tail`) */
  name: string
  kind: RefResolveKind
  /** current value, or `null` when non-finite / the Register is invalid */
  value: number | null
  /** the value as the node itself displays it (§RXA3.2) — `formatRegisterValue`
   *  for a Register, integers-verbatim / trimmed-float for a Pool / Parameter,
   *  `—` for non-finite / unresolved. Use this for BOTH the row text and the
   *  option's accessible name. */
  valueText: string
  /** `format` for a Register value, so the caller renders it the node's way */
  format?: RegisterFormat
  /** the canonical spelling to insert (`@id` or `@{id}`) */
  insert: string
  block: RefBlock | null
}

const kindOf = (d: unknown): string | undefined =>
  d && typeof d === 'object' ? (d as { kind?: string }).kind : undefined
const labelOf = (d: unknown): string =>
  (d && typeof d === 'object' ? ((d as { label?: unknown }).label ?? '') : '').toString().trim()
const idTail = (id: string) => `…${id.slice(-4)}`

/** Build the disambiguated display name for every referenceable node id. Shared
 *  trimmed labels collapse to `Label · Kind`, and `Label · Kind …tail` when the
 *  kind also collides. Runs once per candidate-list build. */
export function buildRefNames(
  nodes: readonly LoopNode[],
  kindLabel: (k: RefResolveKind) => string,
): Map<string, string> {
  const rows = nodes
    .filter((n) => REFERENCEABLE.includes(kindOf(n.data) as RefResolveKind))
    .map((n) => ({ id: n.id, kind: kindOf(n.data) as RefResolveKind, label: labelOf(n.data) }))
  const byLabel = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.label || ` ${r.kind}` // empty label groups per kind
    ;(byLabel.get(key) ?? byLabel.set(key, []).get(key)!).push(r)
  }
  const out = new Map<string, string>()
  for (const [, group] of byLabel) {
    const labelClash = group.length > 1
    for (const r of group) {
      const base = r.label || `${kindLabel(r.kind)} ${idTail(r.id)}`
      if (!labelClash) {
        out.set(r.id, base)
        continue
      }
      const kindClash = group.filter((x) => x.kind === r.kind).length > 1
      out.set(r.id, kindClash ? `${base} · ${kindLabel(r.kind)} ${idTail(r.id)}` : `${base} · ${kindLabel(r.kind)}`)
    }
  }
  return out
}

/** register id → register ids it references (transitively closed), so a
 *  candidate that is a Register already reachable-to `editingId` would cycle. */
function registerDependsOn(nodes: readonly LoopNode[]): (from: string, target: string) => boolean {
  const regs = nodes.filter((n) => kindOf(n.data) === 'register')
  const regIds = new Set(regs.map((n) => n.id))
  const direct = new Map<string, string[]>()
  for (const n of regs) {
    const r = readRegisterData(n.data)
    if (!r.ok) {
      direct.set(n.id, [])
      continue
    }
    const p = parse(r.data.expr)
    direct.set(n.id, p.ok ? refsOf(p.ast).filter((t) => regIds.has(t)) : [])
  }
  return (from, target) => {
    if (from === target) return true
    const seen = new Set<string>([from])
    const stack = [...(direct.get(from) ?? [])]
    while (stack.length) {
      const id = stack.pop()!
      if (id === target) return true
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...(direct.get(id) ?? []))
    }
    return false
  }
}

/** current value of a referenceable id, or `null` when it does not resolve to a
 *  finite number (a wrong-kind / missing id is `null` too). */
function refValue(
  node: LoopNode | undefined,
  poolValue: (id: string) => number,
  outcomes: ReadonlyMap<string, RegisterOutcome>,
): { kind: RefResolveKind | null; value: number | null; format?: RegisterFormat } {
  const k = kindOf(node?.data)
  if (k === 'pool') {
    const v = poolValue(node!.id)
    return { kind: 'pool', value: Number.isFinite(v) ? v : null }
  }
  if (k === 'parameter') {
    const r = readParameterData(node!.data)
    return { kind: 'parameter', value: r.ok && Number.isFinite(r.data.value) ? r.data.value : null }
  }
  if (k === 'register') {
    const o = outcomes.get(node!.id)
    const r = readRegisterData(node!.data)
    return {
      kind: 'register',
      value: o && !o.invalid && Number.isFinite(o.value) ? o.value : null,
      format: r.ok ? r.data.format : undefined,
    }
  }
  return { kind: null, value: null }
}

type RefValue = ReturnType<typeof refValue>

/** The display string for a referenceable node's current value — the SAME
 *  presentation the node itself uses: `formatRegisterValue` for a Register
 *  (no re-evaluation — the number is already `useRegisterOutcome`'s, RXA-INV-8),
 *  and integers-verbatim / trimmed-float for a Pool count or Parameter value.
 *  `NaN` / `±Infinity` / an unresolved reference → `—`. Screen text and the
 *  option's accessible name both use this (§RXA3.2). */
export function refValueText(rv: RefValue): string {
  if (rv.value == null || !Number.isFinite(rv.value)) return '—'
  if (rv.kind === 'register') return formatRegisterValue(rv.value, rv.format)
  return Number.isInteger(rv.value) ? String(rv.value) : String(Number(rv.value.toFixed(6)))
}

/**
 * The `@` autocomplete list (RXA-INV-4): every Pool / Parameter / Register.
 * `editingId`'s own row is present but `block: {reason:'self'}`; any Register
 * that already (transitively) references `editingId` is present but
 * `block: {reason:'cycle'}`. Sorted by (kind, name, id).
 */
export function referenceCandidates(
  nodes: readonly LoopNode[],
  poolValue: (id: string) => number,
  outcomes: ReadonlyMap<string, RegisterOutcome>,
  editingId: string | null,
  kindLabel: (k: RefResolveKind) => string,
): RefCandidate[] {
  const names = buildRefNames(nodes, kindLabel)
  const depends = registerDependsOn(nodes)
  const out: RefCandidate[] = []
  for (const n of nodes) {
    const kind = kindOf(n.data) as RefResolveKind
    if (!REFERENCEABLE.includes(kind)) continue
    const rv = refValue(n, poolValue, outcomes)
    let block: RefBlock | null = null
    if (editingId != null) {
      if (n.id === editingId) block = { reason: 'self' }
      else if (kind === 'register' && depends(n.id, editingId))
        block = { reason: 'cycle', withName: names.get(editingId) ?? editingId }
    }
    out.push({
      id: n.id,
      name: names.get(n.id) ?? n.id,
      kind,
      value: rv.value,
      valueText: refValueText(rv),
      format: rv.format,
      insert: canonicalRef(n.id),
      block,
    })
  }
  out.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.name.localeCompare(b.name) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return out
}

/** rank a candidate against a filter query (higher = better; -1 = no match).
 *  name-prefix > name-substring > id-substring (RXA §RXA3.2). */
export function scoreCandidate(c: RefCandidate, q: string): number {
  if (q === '') return 0
  const n = c.name.toLowerCase()
  const id = c.id.toLowerCase()
  const query = q.toLowerCase()
  if (n.startsWith(query)) return 3
  if (n.includes(query)) return 2
  if (id.includes(query)) return 1
  return -1
}

// ── the read-back (line 1 = meaning, line 2 = result) ──────────────────────

export type MeaningToken =
  | { t: 'text'; s: string }
  | { t: 'ref'; id: string; name: string; refKind: RefResolveKind | 'other' | 'missing' }

/** §RXA3.3 line 2 — a reference shown as `<name> <resolved value>`
 *  (e.g. `Wallet 3`); `s` is the value alone for tests / a compact render. */
export type ResultToken = MeaningToken | { t: 'val'; s: string; id: string; name: string }

export type ReadBack =
  | { ok: false; parse: { code: string; column: number } }
  | {
      ok: true
      canonical: string
      /** `[]` when the expression is empty */
      meaning: MeaningToken[]
      result:
        | { kind: 'empty' }
        | { kind: 'value'; parts: ResultToken[]; total: string }
        | { kind: 'error'; code: string; badRefName?: string; badRefId?: string }
    }

/** split canonical text into verbatim runs and `@id` / `@{id}` refs. */
function tokenizeCanonical(src: string): { text?: string; id?: string }[] {
  const toks: { text?: string; id?: string }[] = []
  let buf = ''
  let i = 0
  const push = () => {
    if (buf) toks.push({ text: buf })
    buf = ''
  }
  while (i < src.length) {
    const c = src[i]
    if (c !== '@') {
      buf += c
      i++
      continue
    }
    push()
    if (src[i + 1] === '{') {
      let j = i + 2
      let id = ''
      while (j < src.length && src[j] !== '}') {
        if (src[j] === '\\' && (src[j + 1] === '}' || src[j + 1] === '\\')) {
          id += src[j + 1]
          j += 2
        } else {
          id += src[j]
          j++
        }
      }
      toks.push({ id })
      i = j + 1
    } else {
      let j = i + 1
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      toks.push({ id: src.slice(i + 1, j) })
      i = j
    }
  }
  push()
  return toks
}

/**
 * §RXA3.3 — the structured read-back for `draft`, given the graph + the M3.5
 * outcome of the Register being edited. Never re-evaluates: `result` mirrors
 * `editingOutcome` exactly (RXA-INV-8).
 */
export function readBackExpr(
  draft: string,
  nodes: readonly LoopNode[],
  poolValue: (id: string) => number,
  outcomes: ReadonlyMap<string, RegisterOutcome>,
  editingOutcome: RegisterOutcome | undefined,
  editingId: string | null,
  kindLabel: (k: RefResolveKind) => string,
): ReadBack {
  if (draft.trim() === '')
    return { ok: true, canonical: '', meaning: [], result: { kind: 'empty' } }
  const p = parse(draft)
  if (!p.ok) return { ok: false, parse: { code: p.error.code, column: p.error.column } }

  const canonical = canonicalPrint(p.ast)
  const names = buildRefNames(nodes, kindLabel)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kindByRef = (id: string): RefResolveKind | 'other' | 'missing' => {
    const k = kindOf(byId.get(id)?.data)
    return k === 'pool' || k === 'parameter' || k === 'register' ? k : k ? 'other' : 'missing'
  }

  const toks = tokenizeCanonical(canonical)
  const meaning: MeaningToken[] = toks.map((t) =>
    t.id != null
      ? { t: 'ref', id: t.id, name: names.get(t.id) ?? t.id, refKind: kindByRef(t.id) }
      : { t: 'text', s: t.text! },
  )
  if (canonical === '') return { ok: true, canonical, meaning: [], result: { kind: 'empty' } }

  // line 2 mirrors the committed outcome — no re-eval
  if (editingOutcome && editingOutcome.invalid) {
    const code = editingOutcome.code
    const detail = editingOutcome.detail
    // EVAL_* keeps the value line + a "→ reason" verdict (all refs are numbers)
    if (code === 'M_REG_EVAL' && (detail === 'EVAL_DIV_ZERO' || detail === 'EVAL_NOT_FINITE')) {
      const parts = valueParts(toks, byId, names, poolValue, outcomes)
      if (parts) return { ok: true, canonical, meaning, result: { kind: 'value', parts, total: `→ ${detail}` } }
    }
    // `detail` is either a diagnostic sub-code (`REF_*`, `EVAL_*`) or the id of
    // the offending reference. A sub-code (all-caps, has `_`) becomes the shown
    // `code`; anything else is treated as the bad ref id (whether or not that id
    // still exists in the graph).
    const isSubCode = typeof detail === 'string' && /^[A-Z][A-Z0-9_]*$/.test(detail)
    const badId = typeof detail === 'string' && !isSubCode ? detail : undefined
    return {
      ok: true,
      canonical,
      meaning,
      result: {
        kind: 'error',
        code: isSubCode ? (detail as string) : code,
        badRefId: badId,
        // a wrong-kind ref's node is not in `names` (that map is
        // referenceable-only) — fall back to its raw label, else the raw id
        badRefName: badId ? (names.get(badId) ?? labelOf(byId.get(badId)?.data)) || badId : undefined,
      },
    }
  }

  const parts = valueParts(toks, byId, names, poolValue, outcomes)
  const total =
    editingOutcome && !editingOutcome.invalid
      ? `= ${formatTotal(editingOutcome.value, editingId, byId)}`
      : '= …'
  return { ok: true, canonical, meaning, result: parts ? { kind: 'value', parts, total } : { kind: 'error', code: 'M_REG_EVAL' } }
}

function valueParts(
  toks: { text?: string; id?: string }[],
  byId: Map<string, LoopNode>,
  names: ReadonlyMap<string, string>,
  poolValue: (id: string) => number,
  outcomes: ReadonlyMap<string, RegisterOutcome>,
): ResultToken[] | null {
  const parts: ResultToken[] = []
  for (const t of toks) {
    if (t.id == null) {
      parts.push({ t: 'text', s: t.text! })
      continue
    }
    const rv = refValue(byId.get(t.id), poolValue, outcomes)
    parts.push({
      t: 'val',
      id: t.id,
      name: names.get(t.id) ?? labelOf(byId.get(t.id)?.data) ?? t.id,
      s: refValueText(rv), // the node's own display format — never a raw float
    })
  }
  return parts
}

function formatTotal(value: number, editingId: string | null, byId: Map<string, LoopNode>): string {
  if (editingId != null) {
    const r = readRegisterData(byId.get(editingId)?.data)
    if (r.ok) return formatRegisterValue(value, r.data.format)
  }
  return String(value)
}
