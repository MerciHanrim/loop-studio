# Model language — Parameter, Register, Resource Type

```
Spec ID: loop-model/1
Status:  Draft
```

**Draft for review.** Adds three modelling constructs on top of the existing
graph + engine:

- **Parameter** — a fixed, user-tuned numeric input.
- **Register** — a **derived** readout computed from the current snapshot by a
  `loop-expr/1` expression; it stores no value.
- **Resource Type** — an **advisory** tag on pools and resource edges driving
  colour / icon / legend / warnings, with **no effect on any number, any
  connection, or the run**.

Built on `loop-expr/1` (`SEMANTICS-X.md`) for expression syntax and evaluation.
Additive and backward-compatible: a graph with none of these is unchanged in
behaviour and in digest (§M7, §M8). It does **not** change how sources / pools /
drains / gates / converters / state connections run — `SEMANTICS.md`,
`SEMANTICS-B1.md` / `-B2.md`, `SEMANTICS-S.md` / `-S2.md` are untouched. §M10
records the open decisions to settle before freeze.

Visual treatment is `docs/visual-language.md` (non-frozen); Parameter / Register
visuals there are provisional pending this freeze.

---

## M0. Scope

**In**

- the wire shape + defaults of `parameter` and `register` nodes;
- the `resourceType` field on `pool` and `resource` edges;
- **Register evaluation**: a step-start DAG over the committed snapshot, cycle /
  invalid propagation, and the post-commit recompute for display;
- reference resolution (which kinds are referenceable) and rename stability;
- the (advisory) **resource-type mismatch** rule;
- the scope of an expression error (it does **not** stop the simulation);
- compatibility with existing nodes / edges / `loop-*/N` files;
- the ripple into `loop-revision/2` and whether `loop-workspace/2` is needed.

**Out**

- expression grammar / numeric rules / evaluation errors — `loop-expr/1`;
- expressions on Gate conditions / Source amounts / Converter ratios — a later
  amendment (`loop-expr/1` §X9);
- **hard** resource-type validation (blocking a connection or a run) — a later,
  separate spec;
- Scenario Compare — a later feature; §M1.3 only keeps Parameter shaped so it
  can be the input vector.

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
    "value": 4.5,          // the tuned input — a finite number; REQUIRED
    "min": 0,              // optional advisory lower bound (UI hint)
    "max": 10,             // optional advisory upper bound (UI hint)
    "step": 0.5,           // optional advisory increment (UI hint)
    "unit": "gold"         // optional display string
  }
}
```

- **`value`** is the only field the model reads. It is a literal, **not** an
  expression. Finite (`loop-expr/1` §X1). Default **`0`**.
- **`min` / `max` / `step`** are **advisory**: the Inspector uses them for a
  slider / stepper and MAY warn when `value` is outside `[min, max]`, but the
  model **never clamps** `value` and the run is unaffected. `min > max` is
  ignored (a warning, not an error).
- **`unit`** is a display string only; it is not parsed and has no semantics.
- A Parameter has **no ports** — no resource or state handle. It cannot be an
  edge endpoint. It participates in the model only by being **referenced**
  (`@param_ab12cd`) from expressions (§M5).
- **Not simulation state.** A Parameter is a constant for the whole run until
  the user edits it; editing it is a graph edit (undo-tracked, re-derives
  `dirty` per `SEMANTICS-R.md`), not a per-step event.

### M1.3 Forward-compat note (Scenario Compare)

A later feature may evaluate the graph across a set of Parameter `value`
assignments. Nothing here fixes that; `value` is kept a plain scalar so a
scenario is just `{ paramId → value }`.

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
    "expr": "@pool_rev - @pool_cost",   // a loop-expr/1 string; REQUIRED
    "unit": "gold",                     // optional display string
    "format": "int"                     // optional display hint: "int" | "float" | "percent"
  }
}
```

- **`expr`** is a `loop-expr/1` expression (`SEMANTICS-X.md`). Default **`"0"`**
  (always valid; shows `0`).
- A Register **stores no value.** It is not an entry in `SimState.values`; it is
  recomputed on demand (§M3). Reset / replay carry nothing extra for it.
- **`unit` / `format`** are display-only. `format` affects how the number is
  rendered (`docs/visual-language.md`), not what it is.
- A Register has **no ports** and cannot be an edge endpoint. Like a Parameter,
  it participates only by being referenced (`@reg_ef34gh`).

---

## M3. Register evaluation

### M3.1 References that a Register expression may resolve

Inside a Register's `expr`, an `@id` resolves to a **number** iff `id` names a:

| target kind | resolved value |
|---|---|
| **pool** | the pool's current count in the snapshot being evaluated (§M3.2) |
| **parameter** | its `data.value` |
| **register** | that Register's value **in the same evaluation pass** (§M3.2) |

Any other kind (`source`, `drain`, `gate`, `converter`, `end`, an edge id, an
unknown id) ⇒ a **resolve error** (`loop-expr/1` §X7) ⇒ the Register is
`invalid` (§M3.4).

> **Open (§M10-1):** should `@source` / `@drain` resolve to "amount moved this
> step"? Useful for KPIs, but those are per-step engine outputs, not snapshot
> state. Leaning: **no** in `loop-model/1`; add via amendment with a defined
> semantic.

### M3.2 The two evaluation points

A Register value at a given step is a **pure function of a committed snapshot**
— never a stored, lagging quantity.

1. **Step-start pass.** At the top of each step, before Phase 0
   (`loop-state/*`), evaluate **all** Registers against the **current committed
   snapshot** (the state left by the previous step's commit, or the initial
   state at step 0):
   - build the Register→Register dependency graph from the `@reg_*` references
     in every `expr`;
   - **topologically sort** it; evaluate Registers in that order so each sees
     the already-computed value of any Register it depends on;
   - Pool and Parameter references read the committed snapshot directly.
   These **step-start values are frozen for the whole step** — Phase 0 and every
   later phase that reads a Register (none in `loop-model/1`; future amendments)
   see the same numbers.
2. **Post-commit pass.** After the step commits its new snapshot, evaluate **all
   Registers again** against that **new** snapshot. These post-commit values are
   what the Inspector shows and what the timeline plots for that step index —
   exactly parallel to how a Pool's value is plotted at each step.

There is **no one-step lag**: the step *uses* step-start values; the UI *shows*
post-commit values; both are pure functions of a committed snapshot.

### M3.3 Cycles

If the Register→Register dependency graph contains a cycle, **every** Register on
that cycle is `invalid` with reason **`cycle`**. (Pools referencing each other
through the flow graph are irrelevant here — only `@reg → @reg` edges form this
DAG.)

### M3.4 Invalid propagation

A Register is `invalid` when any of:

| reason | condition |
|---|---|
| `parse` / `evaluate` | `loop-expr/1` §X7 parse or evaluate error in its `expr` |
| `unknown-reference` | an `@id` names nothing in the graph |
| `wrong-reference-kind` | an `@id` names a node kind not in §M3.1 |
| `cycle` | on a Register dependency cycle (§M3.3) |
| `depends-on-invalid` | at least one `@reg_*` it references is `invalid` for any of the above |

An `invalid` Register **produces no value**. In the topo pass it is skipped;
any Register that references it becomes `invalid` with `depends-on-invalid`.
Reason is reported to the Inspector as a stable string; the node shows the
`invalid` cue (`docs/visual-language.md` §VL3).

### M3.5 Determinism

For a fixed graph, seed, and step index, the step-start and post-commit Register
values are **identical** on every run, reset, and replay. Registers add nothing
to `SimState` and nothing to any snapshot; they are derived every time.

---

## M4. Resource Type — advisory

### M4.1 The field

An optional `resourceType` string on:

- a **pool**'s `data` — the type the pool holds;
- a **`resource`** edge's `data` — the type flowing along it.

Absent / `""` / `null` ⇒ **untyped** (the default). Not on `parameter`,
`register`, `source`, `drain`, `gate`, `converter`, `end`, or `state` edges.

`resourceType` is an arbitrary non-empty string. A **known set** gets built-in
colour + icon in `docs/visual-language.md` (§VL5.1: Gold / Energy / XP / Player
/ Item); any other string is valid and gets a generic swatch. Custom named
types are allowed; a registry of custom types is **out of scope** (§M10-4).

### M4.2 It is computation-neutral

Resource Type **never**:

- changes a flow amount, a pool count, a gate split, or any engine output;
- deletes, redirects, or disables a connection;
- blocks Step / Play / Reset / Monte Carlo.

It is read only by the UI (colour, icon, legend, Inspector) and by the mismatch
rule below.

### M4.3 Mismatch (advisory finding)

A **mismatch finding** is emitted for a `resource` edge `e` when **all** hold:

- `e.data.resourceType` is set (non-empty); and
- at least one endpoint pool `p` (`e.source` or `e.target`, when that endpoint
  is a pool) has `p.data.resourceType` set and **different** from
  `e.data.resourceType`.

An untyped edge, or an edge both of whose typed endpoints match, or an edge
whose typed endpoints are themselves untyped, emits nothing. Non-pool endpoints
(source/drain/gate/converter/end) are not checked in `loop-model/1` (§M10-5).

Findings are a **deterministic pure function of the graph**, emitted in a stable
order (by `edge.id`, then `source` before `target`). They drive the
`docs/visual-language.md` §VL4 mismatch badge and the Inspector list — **and
nothing else**. Hard validation (refusing the connection, blocking the run) is a
later spec.

---

## M5. References & rename stability

- Expressions reference targets by **stable node id** (`loop-expr/1` §X3:
  `@id`). Renaming a target's `label` changes **no** expression bytes and **no**
  revision digest (§M-INV-4).
- **Deleting** a referenced node ⇒ referencing Registers become `invalid`
  (`unknown-reference`), reported, **non-fatal** (§M6). The `expr` text is left
  as the user wrote it (the dangling `@id` stays visible so they can fix it);
  the model does not rewrite or clear it.
- An imported graph re-resolves `@id`s against its own nodes; a matching id
  resolves, a missing one is `unknown-reference`.

---

## M6. Execution-blocking scope

In `loop-model/1` an expression error is **contained**:

- an `invalid` Register **does not stop** the simulation. It has no value; its
  node shows the `invalid` cue; Registers depending on it cascade to
  `depends-on-invalid`. Every other Register, every Pool, every flow phase, and
  every state connection run exactly as if the invalid Register were absent.
- the run bar (Step / Play / Reset / Monte Carlo) is fully functional; the
  timeline simply has a **gap** in that Register's series for the affected
  steps.
- because flow nodes (`source` / `pool` / `gate` / `converter` / …) do **not**
  read `loop-expr/1` expressions in `loop-model/1`, no expression error can
  block flow. State edges keep their own `loop-state/*` grammar and their own
  (unchanged) error handling.

When a later amendment lets the engine consume expressions (Gate condition,
Source amount, …), that amendment must define what an error there does — it is
**not** decided here.

---

## M7. Compatibility

- A graph with **no** `parameter` / `register` node and **no** `resourceType`
  field is a valid `loop-model/1` graph with an empty model layer. Its
  behaviour and its `loop-revision/1` digest are **byte-identical** to today
  (§M-INV-1).
- The two new kinds are **purely additive**: `pool` / `source` / `drain` /
  `gate` / `converter` / `end`, all edges, the engine step, `loop-state/1` /
  `/2`, `loop-workspace/1`, `loop-share/1`, and `loop-revision/1` reading of a
  v1 file are untouched.
- Opening a v1 file performs **no migration**, creates **no** undo entry, and
  does **not** mark the document `dirty` (matches `docs/visual-language.md`
  §VL10 / VL-INV). The file is `loop-model/1`-clean by absence.
- `normalizeGraph` gains defaults for the new kinds (`parameter.value → 0`,
  `register.expr → "0"`) exactly as it backfills other kinds; this is a
  read-time fill, not a write.

---

## M8. Ripple — `loop-revision/2` and Workspace

### M8.1 `loop-revision/2` (required)

`SEMANTICS-R.md` §R4.2 freezes `FIELDS_BY_KIND` / `EDGE_FIELDS_BY_KIND` and says
"a future engine field is added there in `loop-revision/2`". `loop-model/1`
triggers that:

- **new `FIELDS_BY_KIND` rows:**
  - `parameter`: `kind`, `label`, `value`, `min`, `max`, `step`, `unit`
    (numbers per §R4.1: finite, `-0 → 0`, no rounding; absent optionals omitted
    entirely, not `null`);
  - `register`: `kind`, `label`, `expr`, `unit`, `format`.
- **extended rows:** `pool` and the `resource` edge gain a trailing
  `resourceType` field (present only when set; a string, exact UTF-8 bytes).
- **`expr`** is projected as its `loop-expr/1` §X8 canonical text (verbatim
  inner whitespace, `@id` references) — so a rename never changes the digest and
  a whitespace edit does (consistent with §R4's byte-exact strings).
- everything else in §R4 (id-sorted arrays, whitespace-free `canonicalJson`,
  fixed key order) is unchanged.

**Version boundary.** A file is `loop-revision/2` content **iff** it contains a
`parameter` / `register` node or a `resourceType` field; otherwise the v1
projection / digest still applies. A revision records which projection version
produced its digest. `loop-revision/2` must define how §R7A **classification /
three-way diff** behave when a `base` and a `target` are on different projection
versions (candidate: compare under the **higher** version, treating the missing
model layer as empty) — this is a `loop-revision/2` decision, flagged here.

### M8.2 `loop-workspace/2` — needed?

`loop-workspace/1`'s semantic digest (§W3.1) binds a saved Monte-Carlo result to
its graph. It must cover fields that **change the simulation**:

- **Parameter `value`** changes engine outputs ⇒ it **must** enter the
  Workspace semantic digest ⇒ **`loop-workspace/2` is required** (an additive
  field, same pattern as `loop-revision/2`).
- **Register** is derived, stores nothing, and does not feed the engine in
  `loop-model/1` ⇒ it does **not** enter the sim snapshot or the semantic
  digest. On Workspace load, Register values are **recomputed** from the
  restored snapshot (§M3), never stored.
- **Resource Type** is computation-neutral ⇒ **not** in the semantic digest.
  (It may still travel in the graph doc and thus in `loop-revision/2`.)

So: `loop-workspace/2` = `loop-workspace/1` + Parameter `value` in the semantic
digest; no snapshot growth; a v1 workspace file still loads (its digest omits
the model layer, which is empty).

---

## M-INV. Invariants

| # | Invariant |
|---|---|
| **M-INV-1** | A graph with no `parameter` / `register` node and no `resourceType` is behaviour- and digest-identical to a `loop-revision/1` / today's graph. |
| **M-INV-2** | A Register stores no value: it is absent from `SimState` and every snapshot, and is a pure function of a committed snapshot at every step (M-INV-6 for determinism). |
| **M-INV-3** | The step **uses** step-start Register values (frozen for the whole step); the UI/timeline **show** post-commit values; there is no one-step lag and no stored Register state. |
| **M-INV-4** | Expression references are `@id`; renaming any node's `label` changes no `expr` bytes and no revision / workspace digest. |
| **M-INV-5** | An `invalid` Register (parse / evaluate / unknown-ref / wrong-kind / cycle / depends-on-invalid) never halts the simulation; it has no value and its dependents cascade. Flow and state phases are unaffected. |
| **M-INV-6** | For a fixed graph + seed + step, step-start and post-commit Register values are identical on every run / reset / replay. |
| **M-INV-7** | Resource Type is computation-neutral: it changes no number, no connection, and no run control; mismatch findings are a deterministic, stably-ordered, advisory list. |
| **M-INV-8** | Parameter / Register / Resource Type are additive: adding them to the spec breaks no `loop-*/N` file, and reading a v1 file triggers no migration, undo entry, or `dirty`. |
| **M-INV-9** | Content that uses the model layer is `loop-revision/2` (and `loop-workspace/2` where a Parameter value participates); content that does not still uses the v1 projections / digests. |

---

## M10. Open decisions — settle before freeze

1. **`@source` / `@drain` (and `@gate` / `@converter`) as references** — resolve
   to a per-step engine output ("amount moved / made / converted this step")?
   Leaning **no** for `loop-model/1` (snapshot-only refs); revisit in the
   engine-expression amendment.
2. **Register `format`** — is `{ int, float, percent }` the right initial set?
   `percent` implies a ×100 at render only (not in the value). Confirm, and
   whether `format` belongs in `loop-model/1` at all vs `docs/visual-language.md`.
3. **Empty `expr`** — default `"0"` (chosen; always valid) vs default `""`
   (invalid until set). `"0"` is friendlier and keeps a fresh Register from
   flashing an error.
4. **Custom resource-type registry** — v0.6.0 allows any string with built-in
   styling for a known set. Do we need a per-graph list of declared types (for
   the legend, for autocomplete, for a future hard-validation spec)? Leaning:
   derive the legend from types **in use**; no declared list yet.
5. **Mismatch across non-pool endpoints** — `loop-model/1` only checks
   pool↔edge. Extend to source/drain/converter port types later, with the same
   advisory-only rule.
6. **Projection-version boundary in `loop-revision/2`** — how classification /
   three-way diff compare a v1 `base` against a v2 `target` (and vice-versa).
   Candidate: promote both to the higher projection, missing model layer = empty.
   This is a `loop-revision/2` spec decision; named here so it is not forgotten.
7. **`loop-workspace/2` scope** — confirm Parameter `value` is the *only*
   model-layer field that must enter the semantic digest, and that Register
   values are always recomputed on load (never stored).
8. **Reference cycle detection cost** — the Register DAG is small; a full topo
   sort per step is fine. Confirm it runs once per step (start) and once per
   commit, not per Register access.
