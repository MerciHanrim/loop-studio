# Parameter-driven inputs (non-frozen design doc — DRAFT)

**Status: design only — implementation pending. rev 2.** This is **PR (1.5)** in
[`docs/example-coffee-roastery.md`](example-coffee-roastery.md) §CR13: a
**minimal, general** capability that lets a `parameter` node's `value` drive a
**resource-edge `flow`**, so changing a Parameter genuinely changes what the
simulation computes. It exists because the frozen engine today ignores
`parameter` / `register` nodes entirely (`src/engine/step.ts`, `SEMANTICS-M.md`
§M6.1) and a resource-edge `flow` accepts no reference (`src/engine/flow.ts`).

**rev 2** settles three points from review: **PI-D3** — *every* unresolved `@…`
string (unknown id, wrong kind, non-finite value, **and** a malformed `@…` typo)
contributes **`0` + a diagnostic**, never `1`; only non-`@` strings keep the
legacy behaviour (§PI2 / §PI5.1). **PI-D5** — the feature ships **`loop-model/2`
(`SEMANTICS-M2.md`) *and* a stored wire-level discriminator** (`version: 2` in
the GraphDoc, plus a deserializer version-ceiling check so a v1-only client
refuses a v2 doc instead of silently mis-running it) — §PI8. **PI-D8** — the
**Parameter picker + resolved-value display + non-blocking warnings** are
**required** scope for the implementation PR, not "desirable" — §PI9. §PI10 now
enumerates the required test boundaries.

This doc **fixes the behaviour contract before any engine code**. It is a
**non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and merges as
*settled design, implementation pending*, like
[`docs/large-graph-readability.md`](large-graph-readability.md) and
[`docs/template-label-overlay.md`](template-label-overlay.md). The implementation
PR ratifies the settled parts as a **new frozen spec `loop-model/2`**
(`SEMANTICS-M2.md`), layered on `loop-model/1` exactly as `loop-state/2`
(`SEMANTICS-S2.md`) is layered on `loop-state/1` — §PI8.5.

**No code in this PR.** No engine change, no `parseFlow` change, no `version`
change, no editor change, no Coffee file. Those land in the implementation PR
after this design is reviewed and approved.

---

## PI0. Why

`docs/example-coffee-roastery.md` needs five **operational levers** (daily
customers, daily roast kg, online orders, green wholesale kg, daily dessert
prep) that a first-time reader can find, change, and see move the stock / sales
/ stockout / waste / profit flow (§CR0 / §CR6 / §CR9). The Machinations-style
model expresses each as *an amount on one resource edge*. The frozen engine has
no way to point an edge's `flow` at a tuned value:

| fact | source |
|---|---|
| the engine **skips `parameter` / `register` nodes** — no ports, no `activation`, never fire | `src/engine/step.ts` (`MODEL` set); `SEMANTICS-M.md` §M6.1 |
| a resource-edge **`flow`** is only `const \| all \| percent \| range \| dice` — **no `@id`** | `src/engine/flow.ts` `parseFlow`; `SEMANTICS-M.md` §M0 Out ("expressions on Gate / Source / Converter — a later amendment") |
| a Parameter is read **only** by Register expressions, which feed nothing | `SEMANTICS-M.md` §M1.3 / §M3 |

This capability is the smallest general fix: **one parameter reference form, in
one field (`flow`), resolved to a number.** It is not a Coffee feature and not
an expression layer.

---

## PI1. Scope

**In**

- a **reference syntax** for naming a `parameter` from a resource-edge `flow`
  (§PI2);
- the **exact set of inputs** the reference is valid in (§PI3);
- **when** in a step the value is read (§PI4);
- **missing / wrong-kind / malformed** reference handling — *every* unresolved
  `@…` → `0` + a diagnostic; why **no cycle** is possible (§PI5);
- the **restart rule** when a referenced `value` changes (§PI6);
- **save / Share / Workspace / Export / autosave** behaviour and **old-document
  compatibility** (§PI7);
- the **wire-level discriminator** (`version: 2` + a reader ceiling check),
  `SEMANTICS-M2.md`, and the `loop-revision` non-impact (§PI8);
- the **required editor scope** — pick a Parameter, see the resolved value,
  non-blocking warnings, no auto-rewrite (§PI9);
- the **required test boundaries**, including v1 invariance, determinism +
  Monte Carlo, v2 round-trips, and cross-version safety (§PI10);
- a **verification table**: each of the five coffee levers expressed with this
  feature alone (§PI11).

**Out** (kept out on purpose — from `docs/example-coffee-roastery.md` §CR16.3)

- **Coffee-specific code** — no path that special-cases any file;
- **`min` / `max` / clamping / comparison / conditional** — none added here;
- **general expressions on edges / sources** — no `@p * 2`, no `@p + @q`, no
  arithmetic; a `flow` is a *single* bare parameter reference or a literal, never
  a compound;
- **a Register-display-only workaround** — this feature moves the *run*, not a
  read-out;
- **parameter references anywhere else** — not in `activation`, not in a state
  edge's `expr` / `delay`, not in a Pool `initial` / `capacity`, not in a gate
  `distribution`. Those are separate later questions (§PI12);
- **`resourceType`** and any advisory field — untouched.

---

## PI2. Reference syntax

A resource-edge `flow` string is **either** a literal (today's
`const | all | percent | range | dice`, unchanged) **or** a single **parameter
reference** and nothing else:

```
flow      = literal | paramref
paramref  = "@" ( safe-id | "{" braced-id "}" )
```

- `safe-id` / `braced-id` are **exactly** the `loop-expr/1` §X3 reference forms
  (`@daily_roast`, `@{daily roast kg}`), so a reader who has seen a Register
  expression already knows this syntax. The braced form escapes `}` / `\` per
  `loop-expr/1` §X3.1.
- The reference resolves **by node `id`** (stable), never by `label`. `@{...}`
  brackets an **id** that is not a bare `safe-id`, not a label.
- **The leading `@` marks reference intent.** A `flow` string whose **trimmed
  form starts with `@`** is an *intended parameter reference*:
  - a well-formed `@safe-id` / `@{braced-id}` resolves (§PI5.1);
  - **any other** `@…` string — `@`, `@ name`, `@{visitor` (unclosed), `@p%`,
    `@p-@q`, `@p*2`, `@p 2` — is a **malformed reference** → the edge contributes
    **`0`** + one diagnostic (§PI5.1). It does **not** fall back to `const 1`.
  Rationale: a typo like `@{visitor` silently running at `1` would be the
  hardest defect to find.
- **A string that does not start with `@`** is a plain literal and keeps
  `parseFlow`'s exact current behaviour, including the legacy `const 1` for an
  unparseable literal (`garbage`, `2D@p`, `1..2`). v1 compatibility is untouched
  for every non-`@` string.
- **No composition.** `@p%`, `@p-@q`, `-@p`, `@p*2` all start with `@`, so each
  is a malformed reference → `0` + diagnostic. Adding compound / arithmetic
  forms is explicitly out (§PI1).

**FlowExpr.** `parseFlow` gains one kind:

```ts
type FlowExpr =
  | { kind: 'const'; value: number }
  | { kind: 'all' }
  | { kind: 'percent'; frac: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'dice'; count: number; sides: number }
  | { kind: 'param'; id: string }        // NEW — a well-formed reference; not yet a number
  | { kind: 'paramBad'; raw: string }    // NEW — a `@…` string that is NOT a well-formed reference
```

- `parseFlow` returns `{kind:'param', id}` for a well-formed `@safe-id` /
  `@{braced-id}`, `{kind:'paramBad', raw}` for any **other** string that trims
  to a leading `@`, and its existing kinds for everything else (unchanged).
- `parseFlow` stays a pure string→shape function with **no node-list
  dependency**; both `param` and `paramBad` carry only text. Resolution to a
  number — and the choice between "resolved" and "→ 0 + diagnostic" — happens
  **in `step()`** (§PI4 / §PI5).

---

## PI3. Where a reference is valid — the exact input set

**Only the `flow` field of a `resource` edge.** That single field is every
"rate" the engine reads:

| engine role of `flow` | covered? | how it reads a `{kind:'param'}` |
|---|---|---|
| **Source push amount** (Source → Pool edge) — *the "Source rate"* | ✅ | as an **amount** = the parameter's `value` (like a `const`) |
| **Drain / End pull amount** (Pool → Drain/End edge) | ✅ | as an amount |
| **Converter consume / produce rate** (per-activation, in- and out-edges) | ✅ | as a **weight / rate** = the parameter's `value` |
| **Gate split weight** (deterministic or probabilistic branch edge) | ✅ | as a weight |

A Source node has **no separate rate field** in the model
(`src/model/types.ts` `SourceData`) — a Source's rate *is* the `flow` on its
outgoing edge — so "Source rate" and "connection flow" are the **same field**
and one mechanism covers both. Nothing else (`initial`, `capacity`,
`activation`, state-edge `expr` / `delay`, `distribution`) accepts a reference in
this feature.

A `{kind:'param'}` value, once resolved, is treated **exactly** as
`{kind:'const', value: <resolved>}` everywhere `parseFlow`'s result is consumed
(`evalDet`, `rateOf`, `sumInRate`, the Source `amountOf`, …). It does **not**
compose with `all` / `percent` / `range` / `dice` because a `flow` is never a
compound (§PI2).

---

## PI4. When the value is read

**Once per step, at the same point `flow` is parsed today.** In
`src/engine/step.ts`, `step()` builds `flowOf` once at the top:

```ts
const flowOf = new Map(resEdges.map(e => [e.id, parseFlow(e.data.flow)]))
```

The implementation runs a **resolve pass** over that map **right there**, before
Phase 0, reading referenced nodes' `data.value` from the `nodes` array passed to
`step()`:

- `{kind:'param', id}` that resolves to a finite number → `{kind:'const',
  value: <that number>}` for the rest of the step;
- `{kind:'param', id}` that does **not** resolve to a finite number (unknown id,
  non-`parameter` node, non-finite `value`) **and** every `{kind:'paramBad'}`
  → `{kind:'const', value: 0}` + one deduped diagnostic (§PI5.1);
- resolution is **a pure function of the step's `nodes` snapshot** — a Parameter
  `value` is *a constant for the whole run* (`SEMANTICS-M.md` §M1.1), so the
  value is identical on every step of a run; there is **no per-step drift** and
  **no ordering effect** (the reference does not read `S` / `working` / another
  edge);
- it is read **before** any phase, so Phase 0 (state), Phase 1 (push) and
  Phase 2 (pull) all see the same number — the same guarantee `R(t)` gives
  Registers (`SEMANTICS-M.md` §M3.2).

`R(t)` and Register evaluation are **unchanged**: this feature does not make an
engine phase read a Register; it makes a `flow` read a **Parameter**, which is a
run-constant literal, so the frozen "no engine phase reads a Register" statement
(§M3.2) still holds.

---

## PI5. Missing / wrong-kind / dangling references — and why there is no cycle

### PI5.1 Resolution outcomes

At the top-of-step resolve pass, for an edge whose `flow` string trims to a
leading `@`:

| case | value used | diagnostic (one per edge per step) |
|---|---|---|
| well-formed `@id`, `id` names a live `parameter`, `value` **is a finite number** | that `value` (including a legitimate **`0`**) | **none** |
| well-formed `@id`, `parameter` `value` **missing / non-finite** (`NaN` / `±Infinity`) | **`0`** | `Edge "<edgeId>" flow "@<id>": parameter value is not a finite number; contributes 0.` |
| well-formed `@id`, **no such node** | **`0`** | `Edge "<edgeId>" flow "@<id>" references an unknown parameter; contributes 0.` |
| well-formed `@id`, node is **not a `parameter`** (pool / source / register / …) | **`0`** | `Edge "<edgeId>" flow "@<id>" must reference a parameter node (got <kind>); contributes 0.` |
| **malformed** `@…` string (`@`, `@ x`, `@{visitor`, `@p%`, `@p*2`, …) | **`0`** | `Edge "<edgeId>" flow "<raw>" is not a valid parameter reference; contributes 0.` |
| string does **not** start with `@` | **unchanged** — exactly today's `parseFlow` (`const`/`all`/`%`/`range`/`dice`, or `const 1` for a non-`@` unparseable literal) | unchanged from today |

- **Every `@…` string that does not resolve to a finite number → `0`** — an
  unknown id, a wrong-kind reference, a non-finite `value`, and a malformed
  `@…` typo all contribute nothing. A legitimate `value` of **`0`** is a normal
  value and produces **no diagnostic**. Rationale: a typo or a deleted Parameter
  must never cause production / sales that should not exist; and `@{visitor`
  running at `1` would be the worst kind of silent defect.
- **Non-`@` strings are the *only* exception** — they keep `parseFlow`'s exact
  current behaviour (including the legacy `const 1` for an unparseable non-`@`
  literal) so v1 compatibility is byte- and run-identical (§PI10).
- **Never `invalid`, never a throw.** Consistent with `parseFlow` (which never
  throws) and Parameter's "never `invalid`" rule (§M1.1). Every failure degrades
  to `0` + a diagnostic and the run continues.
- Diagnostics are **deduped per edge per step** (like `badRandom` in `step.ts`).
- **Determinism.** `0` is a constant, so a degraded edge is fully deterministic
  and a Monte-Carlo run over it is reproducible (§PI10).

### PI5.2 No new cycle class

A cycle would need `flow → parameter → … → flow`. It cannot form:

- a `parameter`'s only semantic field is `value`, **a finite literal, not an
  expression** (`SEMANTICS-M.md` §M1.1) — it references nothing;
- a `flow` reference reads a Parameter's `value` and stops; it does not feed
  Register evaluation or another edge.

So the reference graph from `flow` to `parameter` is **depth 1, always acyclic**.
No topological pass, no cycle diagnostic, nothing to add to the router-DAG cycle
handling in `step.ts`.

---

## PI6. Restart rule when a referenced value changes

**Editing a referenced `parameter.value` resets the run, exactly as any other
engine edit does today.** No new machinery:

- `parameter.value` is *a constant for the whole run* (`SEMANTICS-M.md` §M1.1) —
  it is **never** hot-swapped mid-run;
- editing it goes through `graphStore.updateNodeData`, which calls `bump()` for
  any non-`label` patch key, incrementing `simulationRev`
  (`src/store/graphStore.ts`);
- the sim store and Monte-Carlo store already watch `simulationRev` — the live
  run **resets to step 0** and a Monte-Carlo result is marked **stale**, the
  same as editing a literal `flow`, a Pool `initial`, or a gate weight today;
- editing the `flow` string itself (adding / removing `@ref`) goes through
  `setEdgeData`, which `bump()`s unless the change is cosmetic-only
  (`route` / `waypoints`) — a `flow` edit is never cosmetic, so it also resets.

The contract to state in `loop-model/2`: **a change to a `value` that any live
`flow` references is a simulation-relevant change** (already true by the
`updateNodeData` rule; the spec just names it).

---

## PI7. Persistence — Share, Workspace, Export, autosave, old documents

`flow` is already a serialized string on `ResourceEdgeData`
(`src/model/serialize.ts` `toDocEdge` keeps `flow: … ?? '1'`). A `@paramId`
value is just a different string in that field — like `2D6` or `25%`.

- **Graph JSON / Share (`#g1=`) / Workspace / autosave** carry the `flow` string
  verbatim; a round-trip is byte-identical (§PI10).
- **Old documents** (no `@` in any `flow`) are **completely unaffected** — every
  `flow` parses to the same `FlowExpr`, the digest is unchanged, and the doc
  stays `version: 1` (§PI8).
- A Share link that references a Parameter carries that Parameter node too (the
  whole graph is in the fragment), so it opens self-consistently.
- **Import of a graph whose `@ref` dangles** (the Parameter was deleted before
  export): `normalizeGraph` leaves the `flow` string as-authored; at run time it
  degrades to `0` + a diagnostic (§PI5.1). It is **not** rewritten on load.
- **`serialize()` allowlist** (`docs/serialize-schema-allowlist.md`): `flow` is
  already inside the projected edge shape. The **only** serialization-boundary
  change is the graph-level `version` field (§PI8) — a `GraphDoc` literal edit,
  the exact kind that doc flags.
- The **discriminator (`version`, §PI8) is preserved through every path**
  because it lives on the `GraphDoc` that Share / Workspace / autosave / Export
  all embed verbatim. Pinned by round-trip tests (§PI10).

---

## PI8. Versioning & compatibility — the wire-level discriminator

`loop-model/2` execution differs *observably* from `loop-model/1` for the same
bytes: a client that does not understand `@param` would run `parseFlow("@x")`
through its **current** unparseable path → `const 1`, so the **same document
produces a different result on an older client**. That breaks the product's
"reproducible simulation" promise, so — unlike `loop-model/1`'s *inferred*
`loop-revision/2` predicate (`SEMANTICS-M.md` §M8.1), whose only failure mode is
digest classification caught by verification — `loop-model/2` needs a **stored,
checkable** marker.

### PI8.1 The marker

- The `GraphDoc` envelope already carries `"schema": "loop-studio/graph"` and
  `"version": <n>` (`src/model/serialize.ts` `SCHEMA` / `SCHEMA_VERSION = 1`).
- **`serialize()` writes `"version": 2` iff the graph contains at least one
  `resource` edge whose `data.flow`, trimmed, starts with `@`** (a well-formed
  *or* malformed reference — anything §PI2 treats as reference intent).
  Otherwise it writes `"version": 1`, exactly as today.
- **Existing documents are byte-identical.** No `@` flow ⇒ `version: 1` ⇒ the
  serializer emits the same bytes it does now (§PI10).
- **Inferred → stored is one-way per save.** A doc *becomes* `version: 2` the
  first time it is serialized while holding a `flow` reference (writing one in
  the editor, or opening a v2 bundled Template and saving / autosaving). If every
  reference is later removed, the next serialize drops back to `version: 1`.

### PI8.2 What a reader does with it

The deserializer (`src/model/serialize.ts` `deserialize`, and the Share /
Workspace / autosave readers) currently checks `schema` but **not** `version`.
The implementation PR adds a **version ceiling check**:

| `version` | reader (Graph JSON / Share / Workspace Import) | autosave-restore |
|---|---|---|
| `1` (or absent) | load normally — `loop-model/1` semantics | restore normally |
| `2`, client supports v2 | load normally — `loop-model/2` semantics | restore normally |
| `> client's max supported` (a v2 doc on a v1-only build) | **refuse with a clear message** — *"This graph uses a newer Loop Studio feature (needs format v2; this version supports v1). Update Loop Studio to open it."* No partial load, no silent run. | **do not restore** — fall back to the first-run sample + a one-line notice; the too-new record is left untouched on disk |

So a v1-only client **cannot silently run a v2 document with different numbers** —
it stops at the door.

### PI8.3 The unavoidable transition gap (stated honestly)

A client **built before `loop-model/2` ships** has no ceiling check and would
still load a `version: 2` doc and run `@param` as `1`. This cannot be fixed
retroactively. It is bounded and one-time:

- the ceiling check ships **in the same release as** the first ability to
  *write* a `flow` reference, so from that release on every client is safe;
- **no v2 content is distributed before then** — the coffee Template (the first
  v2 artefact) ships *after* this feature, by design (§PI14 / `example-coffee-roastery.md` §CR13);
- a pre-v2 client opening a hand-crafted v2 file is the only residual case, and
  the diagnostics (§PI5.1) at least make a `@param`-as-`1` run visibly noisy.

### PI8.4 `loop-revision` — no format change

- `flow` is already an **`engineAffecting`** edge field in the canonical
  projection; a `@paramId` string **digests as its literal text**, exactly like
  `2D6` / `25%` / `1-3`. `loop-expr/1`'s AST-canonical form is **not** applied to
  `flow` (only to Register `expr`).
- The `version` field is **GraphDoc envelope, not projected content** — it does
  **not** enter the `loop-revision` digest, so a v1 graph's `fullContentDigest`
  is unchanged and there is no discontinuity at the boundary (matches
  `SEMANTICS-M.md` §M8.1c M-INV-9).
- **Reference is by `id`.** A Proposal / three-way diff that renames or removes a
  Parameter does **not** auto-rewrite a `flow` that references it — the `flow`
  hunk is independent; a dangling result is a runtime diagnostic, not a merge
  error.
- `loop-model/1` §M8.1 field tags are unchanged; this feature adds no field to
  `parameter`.
- The **inferred `loop-revision/2` predicate (§M8.1) is unaffected** — a graph
  with `parameter` nodes is already `loop-revision/2` content; a `flow`
  reference does not add a new predicate clause.

### PI8.5 `SEMANTICS-M2.md`

The implementation PR writes **`SEMANTICS-M2.md`, spec id `loop-model/2`,
Frozen**, layered on `loop-model/1` exactly as `SEMANTICS-S2.md` /
`loop-state/2` is layered on `loop-state/1`. It fixes: the `@` reference grammar
in `flow`, the top-of-step resolve timing, the "every unresolved `@…` → `0`"
rule, the `version: 2` write predicate + reader ceiling check, and the
conservative-extension invariant (a graph with no `flow` reference runs and
digests identically to `loop-model/1`).

---

## PI9. Editor — **required** scope for the implementation PR

A pure text field where the user must know and type `@id` from memory hides the
feature. The following is the **minimum in scope for PR (1.5)** — not "desirable",
not deferred. Visual polish is impl-time; presence is not.

1. **Pick a Parameter from the connection's `flow` input.** The edge Inspector's
   `flow` control offers the graph's `parameter` nodes (by label) as a choice;
   selecting one writes the `@id` string. A graph with no `parameter` node simply
   shows no options.
2. **After selection, show the Parameter label and the current resolved value**
   at the input, e.g. `Daily roast amount → 40`.
3. **Raw `@id` entry is also allowed.** Typing `@daily_roast_kg` / `@{daily roast kg}`
   directly is accepted and treated identically to a pick.
4. **Non-blocking warning near the input** for a **deleted**, **wrong-kind**, or
   **malformed** (`@{visitor`) reference: a visible flag at the field, but the
   graph still saves and runs (the edge degrades to `0`, §PI5.1). Never a modal,
   never a save block.
5. **Renaming a Parameter's `label` does not affect the reference** — the
   reference is by `id`; the picker / display just shows the new label.
6. **No auto-rewrite on `id` change or deletion.** If a referenced Parameter's
   `id` changes or the node is deleted, the `flow` string is left exactly as
   authored and the edge degrades to `0` + a diagnostic. This rule is stated in
   the Inspector help text and pinned by a test.

Also:

- **Parameter nodes stay portless.** The reference is a field on the edge, not a
  drawn wire — consistent with `SEMANTICS-M.md` §M1.3 (a Parameter "cannot be an
  edge endpoint").
- The `flow` field keeps accepting every literal it does today (`2`, `all`,
  `25%`, `1-3`, `2D6`) with no behaviour change (§PI10).
- An on-canvas "= <n>" affordance on a reference edge is **optional / impl-time**
  (nice for the coffee levers, not required scope).

---

## PI10. Test boundaries — required in the implementation PR

### PI10.1 v1 invariance (existing literals untouched)

- **byte identity** — `serialize(load(doc)) === doc` for every existing
  `examples/*.json` and fixture; every such doc stays `version: 1`;
- **digest identity** — the `loop-revision` canonical digest of every existing
  graph is unchanged;
- **`parseFlow` identity** — `"2"`, `"all"`, `"25%"`, `"1-3"`, `"2D6"`, `""`,
  and a non-`@` unparseable literal (`"garbage"`) produce the **same `FlowExpr`**
  as today (the non-`@` `const 1` fallback is preserved);
- **run identity** — a full deterministic run of `engine-b-verification` /
  `mmo-progression` / `risky-factory` is **step-for-step identical**;
- a graph with **zero** `@` flows exercises **no** new `step()` path beyond a
  `Map` scan that resolves nothing, and its serialize emits `version: 1`.

### PI10.2 The reference itself

- **one Parameter, many edges** — several `resource` edges each with
  `flow: "@p"` all read the same `value` in one step; changing `p` moves all of
  them; determinism holds;
- **value shapes** — `value` of `0` (normal, no diagnostic), a **negative**
  number, a **decimal**, and a **non-finite** (`NaN` / `∞`, after
  `normalizeGraph`'s `PARAM_VALUE_FIXED` → `0`) each behave per §PI5.1;
  a negative or fractional `value` flows through `evalDet` / `rateOf` exactly as
  a negative or fractional literal does today (no new clamping — §PI1);
- **failure modes** — unknown id, wrong node kind (`@somePool`), and a malformed
  `@…` string each → the edge contributes `0`, exactly one deduped diagnostic
  per edge per step, run continues, no throw, no `invalid`;
- **`@{braced-id}`** — round-trips and resolves identically to the bare form for
  an id that is also a valid `safe-id`.

### PI10.3 Determinism

- **run** — same seed ⇒ identical trajectory with `@param` edges present,
  including degraded (`→ 0`) edges;
- **Monte Carlo** — a graph using `@param` flows produces byte-identical
  `series` / `endedRuns` / `final` across two runs of the same config
  (the `mmo-progression`-style determinism test, applied to a small
  reference-bearing fixture).

### PI10.4 v2 round-trips (same result through every path)

For a fixture graph that **uses** a `flow` reference (`version: 2`):

- **Export → Import** — reload is byte-identical and a run is step-for-step
  identical;
- **Share (`#g1=`) encode → decode** — same;
- **Workspace Export → Import** — same (the GraphDoc, incl. `version: 2`, is
  embedded verbatim);
- **autosave → reload** — same;
- in every case the **`version: 2` discriminator survives** the round-trip.

### PI10.5 Cross-version safety

- a **`version: 2` doc opened by a v1-only reader** (simulated by a reader whose
  supported ceiling is 1) is **refused with the clear message** (§PI8.2) — it
  does **not** load and run with `@param` treated as `1`;
- a **`version: 1` doc opened by a v2 reader** loads and runs exactly as before
  (no v2 path touched);
- autosave-restore of a **too-new** record falls back to the sample + a notice,
  leaving the record on disk.

---

## PI11. Verification — the five coffee levers with this feature alone

Each lever is **one `parameter` node** referenced by **one resource-edge
`flow`**. No other mechanism, no Coffee-specific code.

| # | lever (Parameter `id`) | edge whose `flow` = `@id` | engine role | result it moves |
|---|---|---|---|---|
| 1 | `daily_customers` | cafe-demand source → cafe-demand pool | Source amount | cafe drink sales; roasted-stock draw; missed sales when roasted stock is short |
| 2 | `daily_roast_kg` | green-stock pool → roasting converter (input edge) | Converter consume rate | roasted-bean stock inflow; green-stock drawdown; roasted stockouts if too low |
| 3 | `online_orders` | roasted-stock pool → online-channel drain | Drain amount | online bag sales; roasted-stock drawdown; operating profit |
| 4 | `green_wholesale_kg` | green-stock pool → wholesale drain | Drain amount | wholesale revenue; green available for roasting (competition, §CR9-2) |
| 5 | `dessert_prep` | dessert-prep source → dessert-stock pool | Source amount | dessert sales; dessert waste when prep exceeds demand (§CR9-3) |

All five are "an amount / rate on one edge" → **all expressible**. Levers 2 and 4
both draw from the green-stock pool, so raising `green_wholesale_kg` genuinely
starves roasting (§CR9 scenario 2) — the competition is real in the run, not a
Register artefact. Shortfall read-outs ("missed sales", "dessert waste") remain
**signed headroom Registers or real drains** (no `min` / `max`), per
`docs/example-coffee-roastery.md` §CR3.5 / §CR8.

---

## PI12. Explicitly deferred

- **`@param` in other fields** — Pool `initial` / `capacity`, `activation`
  timing, state-edge `expr` / `delay`, gate `distribution`. Each is a separate
  design if a real need appears.
- **compound flow expressions** — `@p * 2`, `@p + @q`, `@p%`. A different, larger
  feature (an expression grammar on edges); not this one.
- **`min` / `max` / clamp / comparison** anywhere — belongs to a future
  `loop-expr/1.1`, not here.
- **a Parameter reference from a Register that then drives an edge** — Registers
  still feed nothing; unchanged.
- **Scenario Compare** sweeping `{paramId → value}` sets — already noted as a
  later feature in `SEMANTICS-M.md` §M1.3; this feature makes such a sweep
  *meaningful* for the run but does not build it.

---

## PI13. Decisions (PI-D)

| id | question | decision |
|---|---|---|
| **PI-D1** | reference syntax | **Reuse `loop-expr/1` §X3 `@safe-id` / `@{braced-id}`**, by node `id`. A `flow` is a *single* bare reference or a literal — never a compound. |
| **PI-D2** | which fields accept it | **Only a `resource` edge's `flow`.** That one field is every rate the engine reads (Source amount, Drain/End amount, Converter rate, Gate weight). Nothing else. |
| **PI-D3** | value used when a `@…` string does not resolve to a finite number | **`0` + one deduped diagnostic — for every `@…` failure**: unknown id, non-`parameter` node, non-finite `value`, **and** a malformed `@…` string (`@{visitor`, `@p%`, `@p*2`, …). A legitimate `value` of `0` is normal and silent. **Only non-`@` strings** keep `parseFlow`'s current behaviour, including the legacy `const 1` for a non-`@` unparseable literal (v1 compat). *(revised — a `@`-prefixed typo must never run at `1`.)* |
| **PI-D4** | when read | **Once per step**, at the existing `parseFlow` point, before Phase 0; resolved from the step's `nodes` snapshot. A run-constant, so no drift / ordering effect. |
| **PI-D5** | freeze vehicle + discriminator | **Both.** (a) a new frozen spec **`SEMANTICS-M2.md` / `loop-model/2`**, additive over `loop-model/1`; (b) a **stored wire-level discriminator**: `serialize()` writes GraphDoc **`version: 2` iff any `resource`-edge `flow` starts with `@`**, else `version: 1` (existing docs byte-identical); (c) the deserializer gains a **version-ceiling check** — a doc newer than the client's max is **refused with a clear message**, never partially loaded or silently run; too-new autosave restores the sample + a notice; (d) the discriminator rides the GraphDoc through Share / Workspace / autosave / Export verbatim. The pre-`loop-model/2`-client gap (§PI8.3) is stated and bounded (no v2 content distributed before the check ships). *(revised — was "open for review".)* |
| **PI-D6** | `loop-revision` | **No format change.** `flow` is already an engine-affecting string; `@id` digests as its literal text. `version` is GraphDoc envelope, **not** projected content — not in the digest. Reference is by `id`; a rename/delete does not auto-rewrite a `flow`. |
| **PI-D7** | restart on value change | **Reuses `simulationRev`.** Editing a referenced `value` (or the `flow` string) already bumps it → live run resets, MC result goes stale. No new machinery. |
| **PI-D8** | editor | **Required scope for PR (1.5)** (§PI9): pick a Parameter from the `flow` input; show its label + current resolved value; allow raw `@id` entry; non-blocking warning at the field for deleted / wrong-kind / malformed; label rename does not affect the reference; **no auto-rewrite on id change or deletion** (stated in help text + a test). On-canvas "= n" affordance stays optional. *(revised — was "desirable".)* |
| **PI-D9** | scope guard | **Excluded:** Coffee-specific code, `min` / `max`, compound / general expressions on edges, a Register-display-only approach, references in any field other than `flow`. |

---

## PI14. Build order (feeds `docs/example-coffee-roastery.md` §CR13)

1. **this design PR** — docs-only, review → settle §PI2–§PI13.
2. **implementation PR**, all in one:
   - **`SEMANTICS-M2.md`** (`loop-model/2`, Frozen);
   - `parseFlow` → `param` / `paramBad` kinds (pure, text-only);
   - the **top-of-step resolve pass** in `step.ts` (§PI4) + the "every unresolved
     `@…` → `0`" rule + deduped diagnostics (§PI5.1);
   - `serialize()` writes `version: 1 | 2` by the `@`-flow predicate; the
     **deserializer version-ceiling check** for Graph JSON / Share / Workspace /
     autosave (§PI8.2); `GraphDoc` literal updated per
     `docs/serialize-schema-allowlist.md`;
   - the **required editor scope** (§PI9 items 1–6);
   - the **test boundaries** in §PI10 (v1 invariance, the reference itself,
     determinism incl. Monte Carlo, v2 round-trips, cross-version safety) + the
     §PI11 lever table as an engine test.
   **No Coffee file.**
3. **doc fold-in** — `docs/example-coffee-roastery.md` §CR3.5 / §CR6 / §CR8 /
   §CR9 / CR-D12 lose their "blocked" notes and state the real mechanism.
4. **impl PR (2)** — `examples/coffee-roastery.json` + registration, consuming
   this feature (unchanged from §CR13).

---

## PI15. Scope boundary

- This doc fixes the **behaviour contract** for a parameter reference in a
  resource-edge `flow`, plus the **compatibility contract** (the `version: 2`
  discriminator + reader ceiling check, §PI8). It is **not** the frozen spec
  (that is `SEMANTICS-M2.md`, written in the implementation PR) and **not** a
  detailed UI design — §PI9 fixes *what must exist*, not the pixels.
- It adds **no** capability beyond "a `flow` may be one parameter reference,
  resolved to a number once per step" and the versioning needed to keep that
  reproducible across clients.
- Everything in §PI1 **Out** and §PI12 stays out.
- `docs/example-coffee-roastery.md` impl PR (2) does not start until the
  implementation PR here has merged and §CR13 step 3 (the doc fold-in) is done.
