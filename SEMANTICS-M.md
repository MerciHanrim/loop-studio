# Model language — Parameter, Register, Resource Type

```
Spec ID: loop-model/1
Status:  Draft (rev 3)
```

**Draft for review — rev 3.** Rev 2 (Register time-axis, Resource Type
identity, invalid-Register display value, wire-level v1/v2 discriminator,
`loop-workspace/2` narrowed out) is approved. Rev 3: the advisory Parameter /
Register fields are **in** the `loop-revision/2` canonical projection under a
new `advisory` field tag (§M1.2, §M8.1a); the `@id` token gets an escape form
(`loop-expr/1` §X3); `loop-revision/2` file-validation **order** is pinned
(§M8.1c); every §M10 / §X11 open decision is closed as `Decided` or
`Deferred`. Adds three modelling
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
treatment is `docs/visual-language.md` (non-frozen). §M10 records the decisions
(each Decided or Deferred).

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

### M1.2 `min` / `max` / `step` / `unit` — advisory, but **revision content**

Each is a **hint** for the Inspector's slider / stepper / display. It changes no
number, never makes the node `invalid`, and never affects the run. But it is a
**user-edited value stored in the GraphDoc**, so — unlike a truly transient
render field — it **is** part of the revision content: editing one makes the
document `dirty`, a new `revisionId` is minted on export, and a Proposal can
carry it as its own diff hunk. "No simulation meaning" and "not revision
content" are **separate**; `loop-revision/1` already tracks the compute-neutral
`label` and `position` as `cosmetic` fields for exactly this reason.

These fields are projected into the `loop-revision/2` canonical projection
(§M8.1a) under the **`advisory`** field tag (§M8.1b) — projected and diffable,
but **not** `engineAffecting`.

**Read-time normalisation** (before projection):

| Field | Rule | On violation (read time) |
|---|---|---|
| `step` | if present, a finite number `> 0` | **drop** the hint; warn `PARAM_STEP_INVALID`. A dropped hint is **not** projected. |
| `min`, `max` | if both present, finite with `min ≤ max` | **drop both**; warn `PARAM_RANGE_INVALID`. Not projected. |
| `unit` | a string; trimmed of leading/trailing Unicode `White_Space`; NFC; **≤ `PARAM_UNIT_MAX_BYTES` = 24** UTF-8 bytes | empty after trim → the field is **absent**. Over the cap → **truncated to the cap** (on a UTF-8 char boundary); warn `PARAM_UNIT_TOO_LONG`. The stored/projected value is the **normalised** one. Not parsed, no semantics. |
| `value` vs `[min, max]` | when `min`/`max` are present and coherent | `value` is **kept as stored** and projected **as-is** (never clamped); the run uses it unclamped; advisory `PARAM_VALUE_OUT_OF_RANGE` only |

A field that survives read-time normalisation is projected as its **normalised
stored value**. A field dropped at read time does **not** appear in the
projection (so it also does not appear in a diff). See §M8.1a for the exact
field lists.

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
  form. **Default `"0"`** (always valid, shows `0`). Projected under the
  **`engine`** tag (§M8.1b) — it defines a computed value that the timeline
  plots, so a change to it *is* engine-affecting for the Review.
- A Register **stores no value.** It is not an entry in `SimState.values`; it is
  recomputed every time it is observed (§M3). Reset / replay carry nothing
  extra for it (M-INV-2).
- **`unit`** — same normalisation as §M1.2's `unit` (`PARAM_UNIT_MAX_BYTES`).
  **`format`** — one of `"int"` / `"float"` / `"percent"`; display only:
  `int` rounds for display, `float` shows as-is, `percent` renders
  `value × 100` with a `%`. The stored / **digested** value is always the raw
  number — `format` never changes it. An unrecognised `format` → treated as
  `"float"`, warn `REG_FORMAT_INVALID`, and **not** projected (a dropped bad
  hint). `unit` / `format` are **`advisory`**-tagged and **projected** when
  valid (§M8.1a) — same "advisory but revision content" principle as §M1.2.
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

### M8.1a `loop-revision/2` — the extended canonical projection

`loop-revision/2` extends `SEMANTICS-R.md` §R4.2's frozen field tables:

- **new `FIELDS_BY_KIND` rows** (node `data`, in this order):

  | kind | fields |
  |---|---|
  | `parameter` | `kind`, `label`, `value`, `min`, `max`, `step`, `unit` |
  | `register` | `kind`, `label`, `expr`, `unit`, `format` |

  `value` is always present (finite, `-0 → 0`, no rounding — §R4.1), projected
  **as stored** even when outside `[min, max]`. `min` / `max` are present **only
  as a pair and only when coherent** (`min ≤ max`); `step` **only when `> 0`**;
  `unit` **only when non-empty after normalisation** (§M1.2); `format` **only
  when one of `int` / `float` / `percent`**. A field dropped at read time
  (§M1.2 / §M2) is **absent** from the projection — never `null`, never `""`.

- **extended existing rows** — `pool` and the `resource` edge gain a **trailing**
  `resourceType`, emitted **only when the normalised value (§M4.1) is
  non-empty** (omitted entirely when untyped).

- **`expr`** is projected as its `loop-expr/1` §X8 canonical text (AST form,
  `@id` / `@{id}` references — §X3).

- everything else in §R4 — id-sorted arrays, whitespace-free `canonicalJson`,
  the fixed key order — is unchanged.

### M8.1b Field tags — `engine` / `cosmetic` / `advisory`

`loop-revision/1`'s `fieldTag` returns `engine | cosmetic`. `loop-revision/2`
adds a **third** value, **`advisory`**:

| tag | meaning | in projection & diff? | `summary.engineAffecting`? |
|---|---|---|---|
| `engine` | changes what the model computes / displays as a value | yes | **yes** |
| `cosmetic` | pure presentation (`label`, `position`) | yes | no |
| `advisory` | authored content that changes **no** value (a tuning hint / a type tag) | **yes** | no |

Tag assignments for the new/extended fields:

| field | tag |
|---|---|
| `parameter.value` | `engine` |
| `parameter.min` / `.max` / `.step` / `.unit` | `advisory` |
| `register.expr` | `engine` |
| `register.unit` / `.format` | `advisory` |
| `pool.resourceType`, `resource`-edge `.resourceType` | `advisory` |

An `advisory` field is full revision content: editing it flips `dirty`, mints a
new `revisionId` on export, and produces its own `change` hunk in a Proposal
diff / selective Apply. It just does not set `engineAffecting`, so the Review UI
can label it (e.g. *"tuning hint"*) distinctly from an `engine` change or a
`cosmetic` rename.

### M8.1c Conservative extension, and the file-validation order

**Conservative extension (M-INV-9).** Run the v2 projection over a graph that
**fails** the §M8.1 predicate and it emits **byte-identical** output to the v1
projection — no `parameter` / `register` nodes ⇒ no new rows; no `resourceType`
⇒ the trailing field omitted. So a `loop-revision/1` graph has the **same**
`fullContentDigest` under either projection; there is **no discontinuity** at
the boundary.

**Validation order — v1 first, then lift (M-INV-11).** A reader given a file
(revision or proposal) MUST:

1. run the §M8.1 predicate on the file's **own** graph;
2. **if it is `loop-revision/1` content:** verify `base.contentDigest` /
   `project.contentDigest` against the **`loop-revision/1` projection**
   (`fullContentDigest` per `SEMANTICS-R.md` §R4) — the digest the file's author
   (a v0.5.x app) actually computed. **Only after that verifies**, lift the
   content into the common v2 compare model (by M-INV-9 this reproduces the
   identical bytes) for classification / diff against a possibly-v2 target;
3. **if it is `loop-revision/2` content:** verify against the v2 projection
   directly.

Verifying a legitimate v1 file **directly with the v2 digest is forbidden** —
any latent gap in the conservative-extension claim would misclassify a valid v1
file as a **tampered payload** (`SEMANTICS-R.md` R-INV-6). Checking with the
projection the author used, then lifting, makes M-INV-9 a *verified* property at
read time rather than an *assumed* one.

**v1 ↔ v2 comparison** (§R7A classification / three-way diff across the
predicate boundary): after the step-2/3 verification, both sides are compared
under the **v2 projection** — a v1 graph is "v2 with an empty model layer", its
v2 digest equals its v1 digest. No "refuse" branch. The diff shows exactly a
v1↔v1 diff for the shared part, plus `add` hunks for any new-kind /
`resourceType` element. *(Formally ratified at the `loop-revision/2` freeze; the
approach is fixed here.)*

**No `project`-header field.** A reader infers the version by running the
predicate on the file's own graph. **Inferred, not stored.**

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
| **M-INV-11** | A `loop-revision/1` file is digest-verified against the **v1 projection first**; only after it verifies is its content lifted into the v2 compare model. Verifying a v1 file directly with the v2 digest is forbidden (§M8.1c). |
| **M-INV-12** | The advisory Parameter / Register fields (`min` / `max` / `step` / `unit` / `format`) and `resourceType` are **revision content**: they are in the v2 canonical projection (`advisory` tag), so editing one flips `dirty`, mints a new `revisionId`, and yields its own diff hunk — it just does not set `engineAffecting`. |

---

## M10. Decisions

Every item is **Decided** (fixed by this spec) or **Deferred** (explicitly out
of `loop-model/1`). No item is left "open with a leaning".

| # | Item | Resolution |
|---|---|---|
| **M-1** | `@source` / `@drain` / `@gate` / `@converter` as references | **Deferred — out of `loop-model/1`.** Only `pool` / `parameter` / `register` resolve (§M3.1). Per-step engine outputs as references are for the future engine-expression amendment, which must define their semantic. |
| **M-2** | `min` / `max` / `step` / `unit` / `format` in the projection | **Decided: included** (§M8.1a, §M8.1b) under the `advisory` tag. They are user-edited GraphDoc content, so they are revision content (M-INV-12); they are not `engineAffecting`. |
| **M-3** | Custom resource-type registry (`resourceTypes: []` on the doc) | **Deferred — out of `loop-model/1`.** Any non-empty normalised string is a valid type; the legend is derived from types **in use**. A declared list is left for a later spec (autocomplete / hard validation). |
| **M-4** | Mismatch across non-pool endpoints | **Deferred — out of `loop-model/1`.** `loop-model/1` checks `pool ↔ resource-edge` only (§M4.3). Source / drain / converter port typing is a later spec, same advisory-only rule. |
| **M-5** | v1 ↔ v2 comparison in `loop-revision/2` | **Decided (approach fixed here; ratified at `loop-revision/2` freeze).** Verify v1 files with the v1 projection first (M-INV-11), then compare all sides under the v2 projection — a v1 graph is "v2 with an empty model layer", its v2 digest equals its v1 digest (M-INV-9). No refuse branch. |
| **M-6** | `format: "percent"` | **Decided: display-only.** Renders `value × 100 %`; the stored / **digested** value stays the raw number. `format` is `advisory`-tagged and projected when valid (§M2, §M8.1b). |
| **M-7** | `unit` byte cap | **Decided: `PARAM_UNIT_MAX_BYTES = 24`** UTF-8 bytes, post-trim/NFC (a new `loop-model/1` constant; the author-name/note caps are unrelated and larger). Over the cap → truncate on a char boundary + warn (§M1.2). |
| **M-8** | Register DAG evaluation cadence | **Decided: one topological pass per committed snapshot** — once at step start (`S(t)`) and once after the step commits (`S(t+1)`); **not** per reference access. Caching `R(k)` for a committed snapshot is an implementation detail (§M3.6). |
