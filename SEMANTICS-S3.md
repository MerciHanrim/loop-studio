# Execution semantics — State connections, revision 3

```
Spec ID: loop-state/3
Status:  Frozen
```

**Frozen** (2026-09-12). Supersedes [`SEMANTICS-S.md`](./SEMANTICS-S.md)
(`loop-state/1`) and [`SEMANTICS-S2.md`](./SEMANTICS-S2.md) (`loop-state/2`)
for **`label` timing only**. Everything else — `trigger` (pulse + `delay`),
`activator` (AND level gate), the Phase-0 model, the `label` *value* grammar
(`+N -N =N +S -S =S`), the `loop-state/2` clamp-reporting rule, every
invariant, and the `triggerQueue` lifecycle — is **inherited verbatim**.
`loop-state/1` and `loop-state/2` stay on disk unchanged as the historical
baseline; this document states only the delta.

Design record: [`docs/conditional-state-update.md`](./docs/conditional-state-update.md)
(CSU, rev 5). Why a new spec id rather than an edit to `loop-state/2`: this adds
a new execution phase (Phase 2.5), a new `report.stateEvents` label variant
(`applied`), and a fail-closed validation rule that did not exist before — all
observable, frozen-contract changes.

---

## What is unchanged (inherited from `loop-state/1` + `loop-state/2`)

- **`trigger`**, **`activator`** — verbatim, including the `S6` comparison
  grammar (literal-only; no `@param`).
- **A `label` with no `timing` (or `timing: "phase0"`) and no `when`** — applies
  in Phase 0, unconditionally, exactly as `loop-state/1` §S5 / `loop-state/2`
  §S2-9 describe it, byte-identical in both behaviour and report shape. This is
  the default: a document that never sets `timing` / `when` is untouched by
  this revision in every observable way — engine result, `report`, and digest
  (§S3-7).
- All invariants **I1′ (refined per §S2-9), I2–I10-S**, with the further I1′
  refinement in §S3-6.

---

## S3-1. `timing` on a `label` edge

A `label` edge gains an optional `timing: "phase0" | "afterPull"`.

| `timing` | when it applies | source | `expr` |
|---|---|---|---|
| absent / `"phase0"` | Phase 0, unconditionally (unchanged) | Pool | `+N -N =N +S -S =S` (unchanged) |
| `"afterPull"` | Phase 2.5 (§S3-3), gated by `when` (§S3-2) | a node that **fires in Phase 2** — Gate, Converter, Drain, or End | numeric literal only: `+N -N =N` |

An `afterPull` label **requires** a `when`. A `phase0` label **must not**
carry one (§S3-5). Grammar recognition lives in `src/engine/stateExpr.ts`
(`parseLabelTiming`, `parseLabelWhen`), shared with the Inspector, per the
existing rule for this file: the engine and the editor must always agree on
what is recognised.

## S3-2. `when: "source-fired"`

The only `when` value in this revision. An `afterPull` label applies **iff
`source ∈ fired` for the step just executed** — i.e. **this step's** `fired`
set, built by Phase 1 push + the committed Phase 2 pull. This is deliberately
**not** `fired(t−1)` (what `trigger` reads, §S3.1 of `loop-state/1`): the whole
point of `timing: "afterPull"` is same-step visibility.

An edge whose `when` is not satisfied this step is **inert** — not an error,
not a diagnostic (§S3-4 below covers when a diagnostic *is* warranted). It is
expected to be inert on most steps.

## S3-3. Phase order

```
Phase 0    (a) deliver due triggers
           (b) activator gates vs S
           (c) phase0 labels, ascending edge.id, one clamp per touched Pool
Phase 1    push (Sources)
Phase 2    pull (Gate / Converter / Drain / End); this step's `fired` is built
Phase 2.5  afterPull labels — NEW, see below
Commit     clamp every Pool to [0, capacity] (floor-0 if uncapped)
```

**Phase 2.5**, ascending `edge.id` (the same tiebreak as Phase-0 labels):

1. An edge whose `when` source `∉ fired` this step is skipped — reported as
   `applied: false` (§S3-4), contributes nothing.
2. Otherwise, edit `working[target]` by the literal `expr` against the running
   value at that target — carrying forward across other `afterPull` edges into
   the same target within this same walk, exactly like a Phase-0 label carries
   across other Phase-0 edges into its target. Intermediate out-of-range values
   are allowed.

There is **no dedicated Phase-2.5 clamp**. The correction that would otherwise
be computed by a dedicated clamp is instead read off the identical formula the
existing Commit clamp already applies (`working[target] → [0, capacity]`, or
floor-`0` uncapped) — computed early enough, immediately after step 2, to be
attributed and reported (§S3-4/§S3-6); the Commit clamp then finds the value
already in range and is a no-op for that Pool. This keeps Phase 2.5 from
needing a second, separate clamp point in the algorithm while still producing
a correct, reportable `clampAdjustment`.

A firing `End` in Phase 2 still ends the run (I10-S, unchanged); the
`afterPull` labels on that same, final step still apply — the last committed
value is the correct one.

## S3-4. `report.stateEvents` — the `afterPull` label entry

```ts
stateEvents: {
  edgeId: string
  from: string
  to: string
  mode: 'trigger' | 'activator' | 'label'
  effect:
    | { kind: 'trigger';  delivered: true; applied: boolean }                       // unchanged
    | { kind: 'activator'; satisfied: boolean }                                     // unchanged
    | { kind: 'label';     delta: number; clampAdjustment: number }                 // phase0 — UNCHANGED SHAPE
    | { kind: 'label';     applied: boolean; delta: number; clampAdjustment: number } // afterPull — NEW
}[]
```

- A **`phase0`** (or untyped) `label` effect is the exact `loop-state/2` shape.
  It **never** carries `applied`. This is what makes a legacy document's
  `report` byte-identical (§S3-7).
- An **`afterPull`** `label` effect **always** carries `applied`:
  - `applied: true` — the `when` held this step. `delta` is the edge's own raw
    requested change (identical rule to a Phase-0 edge's `delta`); the clamp is
    never folded in.
  - `applied: false` — the `when` did not hold this step. `delta: 0` and
    `clampAdjustment: 0`, **always** — an inert edge is never the target of a
    clamp attribution (§S3-6).
- A consumer that does not distinguish the two `label` variants should treat a
  **missing `applied` as `true`** (`'applied' in effect ? effect.applied :
  true`) — every `phase0` edge "applies" in the sense that its `delta` is real.
- Emitted in the SAME global **ascending `edgeId`** order as every other
  `stateEvent` (unchanged — the final sort in `step()` is over the whole
  array, not per phase).
- One entry per step per **valid** `afterPull` label edge (§S3-5 validation
  failures get a diagnostic and no entry at all — the same rule `loop-state/1`
  §S5 already applies to an invalid Phase-0 label).

## S3-5. Validation — fail-closed, never a silent fallback

Each of the following makes the edge **fully inert** for the step and adds
**exactly one** diagnostic. None of them ever falls back to running the edge as
an unconditional Phase-0 label, and none of them produces a `stateEvent`:

| condition | diagnostic (paraphrased) |
|---|---|
| `timing` is neither absent, `"phase0"`, nor `"afterPull"` | `timing "<v>" is not supported` |
| `timing: "phase0"` (or absent) **with** a `when` present | *has a "when" but is not `timing: "afterPull"`* |
| `timing: "afterPull"` with **no** `when` | *needs `when: "source-fired"`* |
| `timing: "afterPull"` with a `when` other than `"source-fired"` | `when "<v>" is not supported` |
| `timing: "afterPull"` whose **source** is not a node that fires in Phase 2 (a Pool, a Source, or missing) | *needs a Gate / Converter / Drain / End source* |
| `timing: "afterPull"` whose **target** is not a Pool | *needs a Pool target* (same rule/wording as a Phase-0 label) |
| `timing: "afterPull"` whose `expr` is empty / unparseable / non-finite | the existing `loop-state/1` §S5 wording, unchanged |
| `timing: "afterPull"` whose `expr` is `+S`, `-S`, or `=S` | *cannot read S; use a numeric literal* — an `afterPull` source is not a Pool, so `S[source]` has no meaning |

The **fail-closed with a `when`** rule (row 2) is the one behavioural
departure from how an author might expect a "condition I don't fully
understand" to degrade: it does **not** silently run every step. A condition
the author set is never dropped in favour of the more dangerous unconditional
behaviour.

## S3-6. The I1′ identity — three terms, not one

`loop-state/2` §S2-9 wrote I1′ as one label term added to resource movement.
With TWO label phases touching a Pool in the same step, the identity is a
**three-term decomposition**:

```
final − start  =  ( Σ resource in − Σ resource out )     ← Phase 1 + Phase 2, report.events
               +  ( Σ phase0 delta + phase0 clampAdjustment )     ← Phase-0 label term (unchanged)
               +  ( Σ applied-afterPull delta + afterPull clampAdjustment )  ← NEW, Phase-2.5 term
```

Each label term is computed exactly as `loop-state/2` §S2-9 already defines it
for Phase 0 — `Σ delta` over the edges into that target within that phase, plus
that phase's one `clampAdjustment` — just evaluated twice, once per phase,
against that phase's own start-of-phase / end-of-phase working values.

The single equation `Σ delta + clampAdjustment = final − start` (as
`loop-state/2` states it) still holds **exactly** for any Pool with **no
incident resource edges** — e.g. a pure counter like a pity Pool, touched only
by `label` edges in one phase or the other. It is the special case of the
three-term form where the resource term and the *other* phase's label term are
both zero.

## S3-7. Digest & schema surface

`timing` and `when` are new recognised fields on a `state` edge's `data`
(`src/model/types.ts` `StateEdgeData`). The GraphDoc envelope, the `schema`
string, the model version, and every node kind are **unchanged** — this is a
state-edge `data` contract extension, not a file-format change.

Unlike the `route` / `waypoints` cosmetic precedent (`SEMANTICS-R3.md` §R3-3 —
never `engineAffecting`), `timing` and `when` are **engine-affecting**: they
change what a step computes. Concretely, in this codebase:

- `src/model/revision.ts` — `fieldTag('edge', 'data.timing')` and
  `fieldTag('edge', 'data.when')` are the **`'engine'` default** (not added to
  the `cosmetic` list), and the canonical projection (`EDGE_FIELDS.state`,
  `projectEdge`) emits them — so they move the `loop-revision/*`
  `fullContentDigest` and set `dirty`.
- `src/model/workspace.ts` — `projectEdge` / `EdgeProjection` (which back
  `semanticDigest`) include them too, so they move the engine / semantic
  digest.
- `src/store/graphStore.ts` — `setEdgeData`'s `COSMETIC` field set does **not**
  include `timing` / `when` (the default, non-cosmetic path), so editing them
  bumps `simulationRev` like any other engine-relevant edit.

**Byte-identical only for a fully legacy graph.** Absent, or the literal
`timing: "phase0"`, normalises away in every one of the above projections —
so a document where every `label` has no `when` and no `timing` (or only the
default) is **byte-identical**, in engine digest and in `report`, to the same
document under `loop-state/2`. A document with even one `afterPull` edge, or
one `phase0` edge carrying a stray `when` (§S3-5 row 2 — fail-closed, hence
already a behavioural difference from `loop-state/2`), is not.

---

## S3-8. Slice status

`loop-state/3` ships together with the CSU engine-implementation slice
(`docs/conditional-state-update.md` §CSU8 slice 2): Phase 2.5 in
`src/engine/step.ts`, `timing` / `when` parsing in `src/engine/stateExpr.ts`,
the `applied` report field, and this document. Inspector authoring for
`timing` / `when` (CSU8 slice 3) and the gacha hard-pity content (GS10-3,
slice 4) are separate, later slices — this revision is the engine contract
alone.
