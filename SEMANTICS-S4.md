# Execution semantics — State connections, revision 4

```
Spec ID: loop-state/4
Status:  Frozen
```

**Frozen** (2026-09-13). Supersedes [`SEMANTICS-S.md`](./SEMANTICS-S.md)
(`loop-state/1`) for **`activator`'s comparison grammar only**. Everything
else — `trigger`, `label` (both its Phase-0 form and its `loop-state/3`
`afterPull` form), the Phase-0 / Phase-2.5 model, every invariant, and the
`triggerQueue` lifecycle — is **inherited verbatim**. `SEMANTICS-S.md`,
`SEMANTICS-S2.md`, and `SEMANTICS-S3.md` stay on disk unchanged as the
historical baseline; this document states only the delta.

Design record: [`docs/parameter-activator.md`](./docs/parameter-activator.md)
(PA, draft 2). Why a new spec id rather than an edit to `loop-state/1`'s §S6:
an `activator`'s comparison value may now reference a Parameter node (with an
optional signed integer offset) instead of only a literal — a new,
observable grammar production with its own fail-closed resolution rule that
did not exist before.

---

## What is unchanged (inherited from `loop-state/1`)

- **`trigger`**, **`label`** (both timings) — verbatim.
- An `activator` whose `expr` is a plain literal comparison (`ACT_RE`:
  operator + finite real) parses, evaluates, and reports **byte-identically**
  to `loop-state/1` §S6, in every case, including every existing failure
  reason (`empty`, `op-only`, `not-a-comparison`, `non-finite`) and its exact
  wording (`ACT_WHY`).
- `activator`'s source must be a **Pool**; it is evaluated once per step,
  Phase 0, against `S[source]` (the step-start snapshot, never `working`).
  Multiple activators on the same target still AND together.

## S4-1. The extended comparison grammar

```
activator-expr = op ws (literal | param-term)
op             = ">=" | "<=" | "==" | "!=" | ">" | "<"
literal        = <finite real>                        (unchanged, §S6)
param-term     = ref [ws ("+" | "-") ws offset]
ref            = "@" id | "@{" id "}"                  (loop-expr/1 §X3, unchanged)
offset         = <non-negative safe integer>           (/^\d+$/, Number.isSafeInteger, ≥ 0)
```

**Recognised only under `modelVersion: 2`** — mirrors `loop-model/2`'s own
`@id` flow reference exactly (`flow.ts`'s `parseFlow`). Under `modelVersion:
1` (the default), a string like `@hard_pity - 1` is simply
`not-a-comparison` — inert, unchanged from before this revision. This keeps
the new production strictly opt-in via the SAME versioning axis
`loop-model/2` established, rather than silently activating for a v1
document that never asked for it. `docs/parameter-activator.md` PA11-D4 (the
`modelVersion` 1→2 promotion on committing a `param-term` activator via the
Inspector) is deferred to the Inspector-authoring implementation (§S4-4) —
until then, this grammar is reachable only where a caller already threads a
real `modelVersion` through (`step()`; direct engine tests), not yet through
the shipped free-text Inspector field.

`@id` alone is `@id + 0`. At most one `ref` and at most one signed `offset` —
`@a - @b`, `@a - 1 - 1`, a doubled sign (`+ -1`), a fractional or
out-of-range offset, and any parenthesised or multi-operator expression are
all **rejected** by this grammar; each falls through to the existing
`not-a-comparison` literal-invalid path (§S4-2 Class 1), never a crash.
Reference decoding reuses the shared `loop-expr/1` tokenizer
(`src/model/expr/tokenize.ts`) — the same one `flow.ts`'s `@id` flow
reference and Register formulas use — so `@id` / `@{id}` never drifts
between contexts.

Implementation: `src/engine/stateExpr.ts`'s `parseActivatorExpr` /
`ActivatorRhs` (`{kind:'literal', n}` or `{kind:'param', id, offset}`); a
grammar-level parse never touches the graph — resolution (§S4-2) is a
separate step, once per step, in `src/engine/step.ts`.

## S4-2. Resolution — two classes, opposite outcomes

**Class 1 — `expr` does not parse as a comparison at all** (every §S6/§S4-1
grammar-invalid case). **Unchanged**: the edge is inert, contributes nothing
to the target's AND, and one diagnostic is emitted. Fail-**open** for the
target — exactly `loop-state/1`.

**Class 2 — `expr` parses as `param-term` (grammar-valid) but the reference
cannot be resolved to a usable number.** New in `loop-state/4`. The
activator still participates: it joins the target's AND with
`satisfied: false`, fail-**closed** — gating the target off exactly as if
the comparison had been evaluated and come out false. One diagnostic per
edge per step:

| condition | `satisfied` |
|---|---|
| `ref`'s id does not exist in the graph | `false` |
| id exists, `data.kind` is not `'parameter'` | `false` |
| the Parameter's `value` is not a finite number | `false` |
| `value` is finite but `value ± offset` is not (overflow) | `false` |
| `value ± offset` is finite | `cmp(S[source], op, value ± offset)` |

Resolved fresh every step against that step's node map — a Parameter edit
takes effect on the very next step, never a stale cached value.

The overflow row is implemented as specified (defensive, matches §S4-1's
letter) but is **unreachable given the offset's `Number.isSafeInteger`
bound**: `Number.MAX_VALUE + Number.MAX_SAFE_INTEGER` is still finite
(confirmed directly — a double's ULP near its max magnitude is vastly larger
than any safe-integer offset), so a finite `value` combined with a
safe-integer `offset` can never overflow to `Infinity`/`NaN` in practice.
Kept for defense-in-depth (a future change loosening the offset bound would
silently need it), not because a real input can hit it today.

**Why Class 1 and Class 2 differ.** A grammar-invalid `expr` was never a
comparison — there is nothing to gate on, so `loop-state/1`'s existing
fail-open behaviour is correct and unchanged. A syntactically valid `@id`
reference is a declared gating intent; if the Parameter it names disappears
or breaks, the safe default for a construct whose job is controlling
resource movement is to **stop** it, not silently remove the gate.

## S4-3. Digest

`activator`'s `expr` field (`EDGE_FIELDS.state`) has **no** `modelLayer`
gate in `revision.ts`'s `projectEdge()` — it is emitted verbatim in every
projection, `loop-revision/1` included, unconditionally, both before and
after this revision. A `param-term`-shaped `expr` therefore produces
identical canonical bytes whether a matching Parameter node exists or not,
and whether the document infers as `loop-revision/1` or higher — there is no
`SideVersion`-lift mismatch analogous to `SEMANTICS-R6.md`'s CSU
`timing`/`when` fix (those fields DO carry a `modelLayer` gate). No new
`loop-revision/N` is introduced by this document. A referenced Parameter
node's own `value` field was already unconditionally digest-affecting
(`MODEL_NODE_KINDS` content) before this revision, with or without any
`@id` reference anywhere in the graph.

## S4-4. Out of scope

The Inspector authoring surface (a Parameter picker, an offset control, a
live resolved-value preview) and the `modelVersion` v1→v2 latch extension
(`docs/parameter-activator.md` §PA11-D4) are **not** part of this revision —
both are deferred to the Inspector-authoring implementation. `expr` remains
free-text-editable today via the existing `ExprField`, which already
describes a `param-term` activator's symbolic shape without resolving it
live (`Inspector.tsx`'s `rhsDescribeText`).
