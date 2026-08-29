# Model language — Parameter, Register, Resource Type

```
Spec ID: loop-model/1
Status:  Draft (rev 2)
```

**Draft for review — rev 2** (Register time-axis fixed; advisory-field rules
closed; Resource Type identity rule; error display value; a wire-level v1/v2
discriminator; `loop-workspace/2` narrowed out). Adds three modelling
constructs on top of the existing graph + engine:

- **Parameter** — a fixed, user-tuned numeric input.
- **Register** — a **derived** readout computed from the current snapshot by a
  `loop-expr/1` expression; it stores no value.
- **Resource Type** — an **advisory** tag on pools and resource edges (colour /
  icon / legend / warnings) with **no effect on any number, connection, or
  run**.

Built on `loop-expr/1` (`SEMANTICS-X.md`). Additive and backward-compatible: a
graph with none of these behaves and digests **exactly** as a `loop-revision/1`
graph does today (§M7, §M8, M-INV-1). Does **not** change how sources / pools /
drains / gates / converters / state connections run — `SEMANTICS.md`,
`SEMANTICS-B1.md` / `-B2.md`, `SEMANTICS-S.md` / `-S2.md` are untouched. Visual
treatment is `docs/visual-language.md` (non-frozen). §M10 records the open
decisions.

---

## M0. Scope

**In:** the wire shape + defaults of `parameter` and `register` nodes; the
`resourceType` field on `pool` and `resource` edges; **Register evaluation** on
the committed-snapshot time-axis (§M3), with cycle / invalid propagation; the
reference-resolution table and rename stability; the advisory **resource-type
mismatch** rule and the type **identity** rule; the scope of an expression error
(it does **not** stop the simulation) and its **display value**; compatibility
with existing files; the **wire-level `loop-revision/2` discriminator** and why
`loop-workspace/2` is **not** required by `loop-model/1`.

**Out:** expression grammar / numeric rules / error codes — `loop-expr/1`;
expressions on Gate / Source / Converter — a later amendment; **hard**
resource-type validation — a later spec; Scenario Compare — a later feature
(§M1.3 only keeps Parameter shaped for it).

---

## M1. Parameter

A new node kind: `type: "parameter"`, `data.kind: "parameter"`.

```jsonc
{
  "id": "param_ab12cd",
  "type": "parameter",
  "position": { "x": 0, "y": 0 },
  "data": {
    "kind": "parameter",
    "label": "Sale price",
    "value": 4.5,     // the ONLY semantic field — a finite number; default 0
    "min": 0,         // advisory UI hint
    "max": 10,        // advisory UI hint
    "step": 0.5,      // advisory UI hint
    "unit": "gold"    // advisory display string
  }
}
```

### M1.1 `value` — the only semantic field

- Finite (`loop-expr/1` §X1). It is a literal, **not** an expression.
- **Default `0`.** On read, a missing or non-finite `value` is filled to `0` by
  `normalizeGraph` (a read-time fill, not a write) with an Inspector notice
  `PARAM_VALUE_FIXED`. A Parameter node is therefore **never `invalid`**.
- Editing `value` is a graph edit (undo-tracked, re-derives `dirty` per
  `SEMANTICS-R.md`), not a per-step event. It is a constant for the whole run.

### M1.2 `min` / `max` / `step` / `unit` — advisory only

Each is a **hint** for the Inspector's slider / stepper / display. A bad hint is
**dropped** (or truncated) with an Inspector warning; it **never** makes the
node `invalid` and **never** affects the run.

| Field | Rule | On violation |
|---|---|---|
| `step` | if present, must be a finite number `> 0` | drop the hint; warn `PARAM_STEP_INVALID` |
| `min`, `max` | if both present, must be finite with `min ≤ max` | drop **both** hints; warn `PARAM_RANGE_INVALID` |
| `value` vs `[min, max]` | when `min`/`max` are present and coherent and `value ∉ [min, max]` | keep `value` **as stored**, run uses it **unclamped**; advisory `PARAM_VALUE_OUT_OF_RANGE` |
| `unit` | a display string; trimmed for display; **≤ 24 UTF-8 bytes** after trim | over the cap → truncate for display; warn `PARAM_UNIT_TOO_LONG`. Not parsed, no semantics |

`min` / `max` / `step` / `unit` are **display metadata**: they travel in the
graph file but are **excluded from the canonical projection** (§M8.1), like
`SEMANTICS-R.md` excludes `meta`. Two graphs differing only in a Parameter's
`step` (or `unit`, `min`, `max`) are the **same revision**. *(Open — §M10-2.)*

### M1.3 Ports & forward-compat

A Parameter has **no ports** and cannot be an edge endpoint. It participates
only by being **referenced** (`@param_ab12cd`) from expressions (§M3.1). A later
Scenario Compare feature may sweep `value` across a set `{ paramId → value }`;
nothing here fixes that.

---

## M2. Register

A new node kind: `type: "register"`, `data.kind: "register"`.

```jsonc
{
  "id": "reg_ef34gh",
  "type": "register",
  "position": { "x": 0, "y": 0 },
  "data": {
    "kind": "register",
    "label": "Profit",
    "expr": "@pool_rev - @pool_cost",  // a loop-expr/1 string; default "0"
    "unit": "gold",                    // display string, same rules as §M1.2 unit
    "format": "int"                    // display hint: "int" | "float" | "percent"
  }
}
```

- **`expr`** is a `loop-expr/1` expression, stored in `loop-expr/1` §X8 canonical
  form. **Default `"0"`** (always valid, shows `0`).
- A Register **stores no value.** It is not an entry in `SimState.values`; it is
  recomputed every time it is observed (§M3). Reset / replay carry nothing
  extra for it (M-INV-2).
- **`unit`** — as §M1.2. **`format`** — display only: `int` rounds for display,
  `float` shows as-is, `percent` renders `value × 100` with a `%` (the stored /
  digested value is unchanged). A bad `format` string → treated as `float`,
  warn `REG_FORMAT_INVALID`. `unit` / `format` are **display metadata**,
  excluded from the canonical projection like §M1.2.
- No ports; referenced only (`@reg_ef34gh`).

---

## M3. Register evaluation

### M3.1 Reference resolution

Inside a Register's `expr`, an `@id` resolves to a **number** iff `id` names a:

| target kind | resolved value |
|---|---|
| **pool** | the pool's count **in the snapshot being evaluated** (§M3.3) |
| **parameter** | its `data.value` |
| **register** | that Register's value **in the same evaluation pass** (§M3.3) |

Any other target (`source` / `drain` / `gate` / `converter` / `end`, an edge id,
an unknown id) ⇒ the Register is `invalid` — `loop-expr/1` code `REF_WRONG_KIND`
or `REF_UNKNOWN` (§M3.4). `@source` / `@drain` deliberately do **not** resolve
in `loop-model/1` (§M10-1).

### M3.2 Time-axis — notation

Let:

- **`S(t)`** — the **committed snapshot** at step index `t` (the state at the
  *top* of step `t`; `S(0)` is the initial state).
- **`R(t) := evaluate every Register against S(t)`** — one topo-ordered DAG pass
  (§M3.3). `R(t)` is a pure function of `S(t)`.

The engine step `t → t+1` produces `S(t+1)` from **`S(t)`** (and, once a future
amendment lets an engine phase read a Register, from **`R(t)`**, frozen for the
whole of step `t`). In `loop-model/1` **no engine phase reads a Register**, so
`R(t)` is purely observational here; the notation is fixed now so the future
amendment has a defined hook.

- **`R_pre(t) ≡ R(t)`** — the Register values available to any phase executing
  step `t` (frozen for the whole step: Phase 0 and every later phase would see
  the same `R(t)`).
- **`R_post(t) ≡ R(t)`** — the Register values of the snapshot at step `t`,
  i.e. what is displayed and recorded *for step index `t`*.

`R_pre(t)` and `R_post(t)` are **the same quantity** `R(t)`; the two names only
mark the role. **There is exactly one Register value per step index.**

### M3.3 The pass — `R(k) = evaluate(Registers, S(k))`

1. Build the Register→Register dependency graph from the `@reg_*` references in
   every Register's `expr`.
2. **Topologically sort** it.
3. In topo order, for each Register: resolve its `@id`s against `S(k)`
   (pools / parameters read `S(k)` directly; registers read their
   already-computed value from this pass) and evaluate its `expr`
   (`loop-expr/1` §X6).
4. A Register on a dependency **cycle**, or one whose expression errors, or one
   referencing something unresolvable / wrong-kind, is **`invalid`** and is
   skipped; Registers depending on it become `invalid` (`depends-on-invalid`).

`R(k)` is deterministic: the topo order is defined up to independent nodes,
whose evaluation is order-independent (pure, §X6), so `R(k)` is a well-defined
function of `S(k)` (M-INV-6).

### M3.4 Invalid — reasons

| reason | `loop-expr/1` / model code | condition |
|---|---|---|
| parse | `M_REG_PARSE` (wraps `EXPR_*`) | a `loop-expr/1` parse error in `expr` |
| evaluate | `M_REG_EVAL` (wraps `EVAL_*`) | a `loop-expr/1` evaluate error |
| unknown reference | `M_REG_UNKNOWN_REF` (wraps `REF_UNKNOWN`) | an `@id` names nothing in the graph |
| wrong-kind reference | `M_REG_WRONG_KIND` (wraps `REF_WRONG_KIND`) | an `@id` names a non-{pool,parameter,register} node |
| cycle | `M_REG_CYCLE` | on a Register→Register dependency cycle |
| depends on invalid | `M_REG_DEPENDS_ON_INVALID` | references a Register that is itself `invalid` |

The model codes are a **stable enumerated contract** (M-INV-5).

### M3.5 What shows / records what

| Observer | value | which is |
|---|---|---|
| Canvas node, Inspector | `R(currentStepIndex)` | `evaluate(Registers, S(currentStepIndex))` |
| Timeline series point at index `t` | `R(t)` | `evaluate(Registers, S(t))` — recorded when step `t` commits, exactly as a Pool's point is |
| A future engine phase during `t → t+1` | `R_pre(t) = R(t)` | frozen for the whole step |
| Reset | `R(0)` | `evaluate(Registers, S(0))` (initial) |
| Scrub / replay to step `t` | `R(t)` | `evaluate(Registers, S(t))` |

There is **no one-step lag**: the step consumes `R(t)` (the value shown *at*
step `t`, not `R(t-1)`); after the step, `R(t+1)` becomes current. Every
observer of "step `t`" — live run, timeline point, replay scrub — shows the
**same** `R(t)`.

### M3.6 Not simulation state

Reset clears nothing extra for Registers. `SimState` and every snapshot are
byte-unchanged by the presence of Registers. `R(t)` is recomputed on demand;
caching it per committed snapshot is an implementation detail (M-INV-2).

---

## M4. Resource Type — advisory

### M4.1 The field & identity rule

An optional `resourceType` **string** on a **pool**'s `data` (the type it holds)
and a **`resource`** edge's `data` (the type flowing). Not on any other kind or
on `state` edges.

**Normalisation & identity:**

1. **Trim** leading/trailing Unicode `White_Space`.
2. If the result is **empty**, the field is **absent** → the element is
   **untyped**.
3. Otherwise apply **Unicode NFC**.
4. Cap at **64 UTF-8 bytes** (post-trim, post-NFC). **Over the cap → the field
   is dropped** (element becomes untyped); warn `RTYPE_TOO_LONG`. Not
   `invalid`.
5. **Case-sensitive.** No auto-lowercasing — `"Gold"` and `"gold"` are
   **different** types (auto-casing would corrupt the user's display text).

Two `resourceType`s are **the same type** iff their normalised (trim + NFC)
forms are **byte-equal**. This normalised form is what §M8.1 projects.

The built-in styled set (`docs/visual-language.md` §VL5.1: Gold / Energy / XP /
Player / Item) is matched **case-sensitively**; any other non-empty string is a
valid custom type with the generic swatch. No per-graph declared-type registry
(§M10-3).

### M4.2 Computation-neutral

Resource Type **never** changes a flow amount, pool count, gate split, or any
engine output; **never** deletes / redirects / disables a connection; **never**
blocks Step / Play / Reset / Monte Carlo. It is read only by the UI and by the
mismatch rule.

### M4.3 Mismatch — advisory finding

A **mismatch finding** is emitted for a `resource` edge `e` when: `e`'s
normalised `resourceType` is set **and** at least one endpoint that is a pool
has a set normalised `resourceType` **different** from `e`'s. Untyped
elements, and edges whose typed pool endpoints all match, emit nothing.
Non-pool endpoints are not checked in `loop-model/1` (§M10-4).

Findings are a **deterministic pure function of the graph**, emitted in a stable
order (`edge.id` ascending, then the `source` endpoint before the `target`).
They drive the `docs/visual-language.md` §VL4 badge + the Inspector list —
**and nothing else**. Hard validation is a later spec.

---

## M5. References & rename stability

- Expressions reference by **stable node id** (`@id`, `loop-expr/1` §X3).
  Renaming a `label` changes **no** `expr` bytes and **no** digest (M-INV-4).
- **Deleting** a referenced node ⇒ referencing Registers become `invalid`
  (`M_REG_UNKNOWN_REF`), reported, **non-fatal**. The `expr` text is **left as
  written** (the dangling `@id` stays visible for the user to fix); the model
  never rewrites or clears it.
- An imported graph re-resolves `@id`s against its own nodes.

---

## M6. Execution-blocking scope, and the error display value

### M6.1 An expression error is contained

- An `invalid` Register **does not stop** the simulation. Every other Register,
  every Pool, every flow phase, every state connection run exactly as if the
  invalid Register were absent. The run bar (Step / Play / Reset / Monte Carlo)
  is fully functional.
- Flow nodes do **not** read `loop-expr/1` expressions in `loop-model/1`, so no
  expression error can block flow. State edges keep their own `loop-state/*`
  grammar and (unchanged) error handling.
- A later amendment that lets the engine consume an expression must define what
  an error there does — **not** decided here.

### M6.2 The display value of an invalid Register

Fixed, so Canvas / Inspector / Timeline agree:

- **No value.** An `invalid` Register has **no** number — **never** `0`,
  **never** the previous valid value, **never** a rendered `null` line.
- **Canvas** — the value area shows a neutral placeholder (`docs/visual-language.md`
  §VL3: `—` + the struck `=` cue).
- **Inspector** — the model **code** (§M3.4) + a message.
- **Timeline** — a **gap**: no series point at any step index where the Register
  is `invalid` (not a `0`, not a carried value, not an interpolated segment).
- When the Register becomes valid again, it resumes at the next evaluation with
  `R(t)` — **no memory of the gap**.

Rationale: a carried-forward value is indistinguishable from a real computation
and would silently mislead; an explicit gap + a stable code is honest.

---

## M7. Compatibility

- A graph with **no** `parameter` / `register` node and **no** `resourceType`
  is a valid `loop-model/1` graph with an empty model layer. Its behaviour and
  its `loop-revision/1` digest are **byte-identical** to today (M-INV-1).
- The new kinds are **purely additive**: existing kinds, all edges, the engine
  step, `loop-state/1` / `/2`, `loop-workspace/1`, `loop-share/1`, and
  `loop-revision/1` reading of a v1 file are untouched.
- Opening a v1 file performs **no migration**, creates **no** undo entry, and
  does **not** mark the document `dirty` (matches `docs/visual-language.md`
  §VL10 / VL-INV). The v0.6.0 app **must not** inject `resourceType: null`,
  empty `parameter` collections, or any v2 marker into a v1 file — round-trip
  (open → save → re-export) yields byte-identical GraphDoc and the identical
  `fullContentDigest` a v0.5.0 app would produce.
- `normalizeGraph` gains read-time fills for the new kinds (`parameter.value →
  0`, `register.expr → "0"`), exactly as it backfills other kinds — a fill on
  read, never a write.

---

## M8. Ripple — the `loop-revision/2` discriminator, and Workspace

### M8.1 `loop-revision/2` — a wire-level discriminator

`SEMANTICS-R.md` §R4.2 freezes `FIELDS_BY_KIND` / `EDGE_FIELDS_BY_KIND` and says
"a future engine field is added there in `loop-revision/2`". `loop-model/1`
triggers that, gated by a **purely syntactic** predicate on the graph doc — not
by a vague "uses the model layer".

**A graph doc is `loop-revision/2` content iff ANY of:**

1. some `node.data.kind ∈ { "parameter", "register" }`; **or**
2. some `node.data.kind === "pool"` whose `data.resourceType`, after §M4
   normalisation, is **non-empty**; **or**
3. some edge with `data.kind === "resource"` whose `data.resourceType`, after
   §M4 normalisation, is **non-empty**.

Otherwise it is **`loop-revision/1` content**, even in a v0.6.0 app.

**The v2 projection is a conservative extension of the v1 projection:**

- **new `FIELDS_BY_KIND` rows** — `parameter`: `kind`, `label`, `value`;
  `register`: `kind`, `label`, `expr`. *(The advisory / display metadata
  `min` / `max` / `step` / `unit` / `format` are **not** projected — §M1.2 /
  §M2.)*
- **extended rows** — `pool` and the `resource` edge gain a **trailing**
  `resourceType`, **emitted only when the normalised value is non-empty**
  (omitted entirely when untyped — never `null`, never `""`).
- **`expr`** is projected as its `loop-expr/1` §X8 canonical text.
- **numbers** (`value`) per §R4.1 (finite, `-0 → 0`, no rounding).
- everything else in §R4 — id-sorted arrays, whitespace-free `canonicalJson`,
  the fixed key order — is unchanged.

**Consequence (M-INV-9):** run the v2 projection over a graph that fails the
predicate and it emits **byte-identical** output to the v1 projection (no new
kinds → no new rows; no `resourceType` → the trailing field omitted). So a
`loop-revision/1` graph has the **same** `fullContentDigest` under either
projection; there is **no discontinuity** at the v1/v2 boundary.

**v1 ↔ v2 comparison** (§R7A classification / three-way diff when a proposal's
`base` and the open `target` fall on different sides of the predicate): because
the v2 projection is a conservative extension, `loop-revision/2` compares
**everything under the v2 projection** — a v1 graph is simply "v2 with an empty
model layer", and its v2-projection digest equals its v1 digest. No "refuse"
branch is needed; the diff degrades to exactly what a v1↔v1 diff would show for
the shared part, plus `add` hunks for any new-kind / `resourceType` element.
*(This is the key `loop-revision/2` decision; named here so it is fixed at that
freeze — §M10-5.)*

No new field on the `project` header: a reader runs the predicate on the file's
own graph and picks the projection. **Inferred, not stored.**

### M8.2 `loop-workspace/2` is **not** required by `loop-model/1`

A `loop-workspace/1` file embeds the GraphDoc **verbatim**, so `parameter` /
`register` / `resourceType` ride along with **no new Workspace field**. Whether
Workspace needs a **v2** turns on **new `SimState`** or a **changed restore
contract** — not on "a new NodeKind exists".

- **`SimState`** — Registers store nothing (derived); Parameters are graph data,
  not `SimState`; Resource Type is inert. **No `SimState` change**; the verified
  sim-snapshot shape is unchanged.
- **Restore contract** — on Workspace load the GraphDoc (incl. the model layer)
  loads normally; Registers are **recomputed** from the restored snapshot
  (§M3), never stored or restored. **No restore-contract change.**
- **Semantic digest (`SEMANTICS-W.md` §W3.1)** — this binds the saved
  Monte-Carlo result to the graph and must cover everything that changes what
  the simulation computes. In **`loop-model/1`**, **no engine phase reads a
  Parameter or a Register** (Registers are observational; flow nodes do not
  consume expressions). So a Parameter `value` change does **not** alter any MC
  result and need **not** enter the semantic digest for `loop-model/1`.
  - If §W3.1 is computed as `fullContentDigest` of the graph's canonical
    projection, that projection is simply the v1 **or** v2 projection per the
    §M8.1 predicate — a clarifying note (a `loop-workspace/1` erratum), not a
    new spec version.

**`loop-workspace/2` is deferred to the engine-expression amendment** — when a
Parameter `value` becomes an actual engine input (Gate condition / Source
amount / …), *then* it must enter the semantic digest and the sim-snapshot /
restore story is revisited.

---

## M-INV. Invariants

| # | Invariant |
|---|---|
| **M-INV-1** | A graph with no `parameter` / `register` node and no non-empty `resourceType` is behaviour- and digest-identical to a `loop-revision/1` / today's graph, under **either** projection (M-INV-9). |
| **M-INV-2** | A Register stores no value: absent from `SimState` and every snapshot; a pure function of a committed snapshot at every step. |
| **M-INV-3** | Per step index there is **one** Register value `R(t) = evaluate(Registers, S(t))`. The step consumes `R(t)` (no lag); Canvas/Inspector/live-run/timeline-point/replay for "step `t`" all show that same `R(t)`. |
| **M-INV-4** | Expression references are `@id`; renaming any node's `label` changes no `expr` bytes and no revision / workspace digest. |
| **M-INV-5** | An `invalid` Register never halts the simulation; it has **no value** (never `0`, never a stale value), its dependents cascade, and its model error **code** is a fixed enumerated contract. Flow and state phases are unaffected. |
| **M-INV-6** | For a fixed graph + seed + step index, `R(t)` is identical on every run / reset / replay. |
| **M-INV-7** | Resource Type is computation-neutral: no number, no connection, no run-control effect. Type identity is trim + NFC + case-sensitive byte-equality, ≤ 64 UTF-8 bytes; mismatch findings are a deterministic, stably-ordered, advisory list. |
| **M-INV-8** | Parameter / Register / Resource Type are additive: adding them breaks no `loop-*/N` file; reading a v1 file triggers no migration, undo entry, or `dirty`, and no v2 marker is written into a v1 file. |
| **M-INV-9** | The v2 canonical projection is a **conservative extension** of v1: on any graph that fails the §M8.1 predicate it emits byte-identical output, so the `fullContentDigest` is the same under either projection and there is no v1/v2 discontinuity. |
| **M-INV-10** | `loop-workspace/2` is **not** introduced by `loop-model/1`: no new `SimState`, no restore-contract change; the §W3.1 semantic digest uses the graph's own (v1 or v2) projection. |

---

## M10. Open decisions — settle before freeze

1. **`@source` / `@drain` / `@gate` / `@converter` as references** — resolve to a
   per-step engine output? **Leaning: no** for `loop-model/1` (snapshot-only
   refs); revisit in the engine-expression amendment with a defined semantic.
2. **`min` / `max` / `step` / `unit` / `format` in the digest** — this rev
   **excludes** them (display metadata). Confirm that a proposal changing only a
   slider bound is legitimately an *empty* diff; if not, project them (and
   accept that a bound edit mints a revision).
3. **Custom resource-type registry** — this rev derives the legend from types
   *in use*, no declared list. Confirm no per-graph `resourceTypes: []` is
   wanted (for autocomplete / a future hard-validation spec).
4. **Mismatch across non-pool endpoints** — `loop-model/1` checks pool ↔ edge
   only. Extend to source / drain / converter port types later, same
   advisory-only rule.
5. **v1 ↔ v2 comparison in `loop-revision/2`** — this rev's recommendation is
   "always compare under the v2 projection; a v1 graph is v2-with-empty-model,
   its v2 digest equals its v1 digest (M-INV-9)". This is a `loop-revision/2`
   spec decision; named here so it is not lost.
6. **`format: "percent"`** — render `value × 100 %` at display only. Confirm the
   stored / digested value stays raw and `format` is display metadata (not
   projected).
7. **`unit` byte cap** — 24 UTF-8 bytes chosen (small-label spirit). Confirm, or
   align with an existing constant.
8. **Register DAG cost** — one topo sort per committed snapshot (step start +
   step commit), not per reference access. Confirm this cadence.
