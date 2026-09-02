# Parameter-driven inputs (non-frozen design doc — DRAFT)

**Status: design only — implementation pending. rev 1.** This is **PR (1.5)** in
[`docs/example-coffee-roastery.md`](example-coffee-roastery.md) §CR13: a
**minimal, general** capability that lets a `parameter` node's `value` drive a
**resource-edge `flow`**, so changing a Parameter genuinely changes what the
simulation computes. It exists because the frozen engine today ignores
`parameter` / `register` nodes entirely (`src/engine/step.ts`, `SEMANTICS-M.md`
§M6.1) and a resource-edge `flow` accepts no reference (`src/engine/flow.ts`).

This doc **fixes the behaviour contract before any engine code**. It is a
**non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and merges as
*settled design, implementation pending*, like
[`docs/large-graph-readability.md`](large-graph-readability.md) and
[`docs/template-label-overlay.md`](template-label-overlay.md). The implementation
PR ratifies the settled parts as a **new frozen spec `loop-model/2`**
(`SEMANTICS-M2.md`), layered on `loop-model/1` exactly as `loop-state/2`
(`SEMANTICS-S2.md`) is layered on `loop-state/1` — §PI9.

**No code in this PR.** No engine change, no `parseFlow` change, no schema / wire
/ `loop-revision` change, no editor change, no Coffee file. Those land in the
implementation PR after this design is reviewed and approved.

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
- **missing / wrong-kind / dangling** reference handling; why **no cycle** is
  possible (§PI5);
- the **restart rule** when a referenced `value` changes (§PI6);
- **save / Share / Workspace / Export** behaviour and **old-document
  compatibility** (§PI7);
- whether **`loop-revision`** needs a change (§PI8);
- the **editor** affordance — how a user sets a reference and sees it resolve
  (§PI9 → detailed UI is impl-time);
- the **invariant** that every existing literal `flow` behaves byte- and
  run-identically (§PI10);
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
- **Whitespace**: a `flow` that trims to `@name` is a `paramref`; `@ name`
  (internal space, unbraced) is **not** a reference — it fails to parse and
  falls back exactly as any unparseable literal does today (`parseFlow` →
  `const 1`). Only the braced form may contain spaces.
- **No composition.** `@p%`, `2D@p`, `@p-@q`, `-@p`, `@p 2` are **not**
  references and **not** valid literals — they hit `parseFlow`'s existing
  unparseable path (`const 1`) with a diagnostic (§PI5). Adding compound forms
  is explicitly out (§PI1).

**FlowExpr.** `parseFlow` gains one kind:

```ts
type FlowExpr =
  | { kind: 'const'; value: number }
  | { kind: 'all' }
  | { kind: 'percent'; frac: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'dice'; count: number; sides: number }
  | { kind: 'param'; id: string }        // NEW — the raw reference; not yet a number
```

Resolution to a number happens **in `step()`** (§PI4), not in `parseFlow`, so
`parseFlow` stays a pure string→shape function with no node-list dependency.

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

The implementation resolves every `{kind:'param', id}` in that map **right
there**, before Phase 0, by reading the referenced node's `data.value` from the
`nodes` array passed to `step()`:

- a resolved reference becomes `{kind:'const', value: n.data.value}` for the rest
  of that step;
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

At the top-of-step resolve pass, for `flow = "@id"`:

| case | outcome | diagnostic |
|---|---|---|
| `id` names a live `parameter` node with a finite `value` | resolves to that `value` | — |
| `id` names a live `parameter` whose `value` is missing / non-finite | `normalizeGraph` already fills it to `0` with `PARAM_VALUE_FIXED` (`SEMANTICS-M.md` §M1.1); the reference resolves to `0` | — (the fill notice is enough) |
| `id` is **unknown** (no such node) | the edge **contributes `0`** this step (parses as `{kind:'const', value: 0}`) | one per step: `Edge "<id>" flow "@<id>" references an unknown parameter; contributes 0.` |
| `id` names a **non-`parameter`** node (pool, source, register, …) | contributes `0` | one per step: `Edge "<id>" flow "@<id>" must reference a parameter node (got <kind>); contributes 0.` |
| the string is a **malformed** reference (`@ x`, `@p%`, `@p*2`, …) | `parseFlow` unparseable → today's `const 1` fallback | one per step: `Edge "<id>" flow "<raw>" is not a number, all, %, range, dice, or a parameter reference; treated as 1.` |

- **Fallback value:** a *well-formed but unresolvable* reference contributes
  **`0`**, not `1` — the author's intent ("a parameter drives this") is
  unambiguous, and showing no flow is safer and more visible than a silent `1`.
  A *malformed* string keeps `parseFlow`'s existing `const 1` behaviour so this
  feature does not change any current unparseable case. *(Decision PI-D3 — open
  for review.)*
- **Never `invalid`, never a throw.** Consistent with `parseFlow` (which never
  throws) and with Parameter's "never `invalid`" rule (§M1.1). A dangling
  reference degrades to `0` + a diagnostic and the run continues.
- Diagnostics are **deduped per edge per step** (like `badRandom` in
  `step.ts`).

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

## PI7. Persistence, Share, Workspace, Export, and old documents

**No schema or wire change.** `flow` is already a serialized string on
`ResourceEdgeData` (`src/model/serialize.ts` `toDocEdge` keeps
`flow: … ?? '1'`). A `@paramId` value is just a different string in that field —
like `2D6` or `25%`.

- **Graph JSON / Share (`#g1=`) / Workspace / autosave** carry the `flow` string
  verbatim; a round-trip is byte-identical (§PI10).
- **Old documents** (no `@` in any `flow`) are **completely unaffected** — every
  `flow` still parses to the same `FlowExpr` and the digest is unchanged (§PI8).
- A Share link that references a Parameter carries that Parameter node too (the
  whole graph is in the fragment), so it opens self-consistently.
- **Import of a graph whose `@ref` dangles** (the Parameter was deleted before
  export): `normalizeGraph` leaves the `flow` string as-authored; at run time it
  degrades to `0` + a diagnostic (§PI5.1). It is **not** rewritten on load.
- **`serialize()` allowlist** (`docs/serialize-schema-allowlist.md`): `flow` is
  already inside the projected edge shape, so nothing new needs to be added to
  the serialization boundary.

---

## PI8. `loop-revision` impact

**No `loop-revision/N` bump.** `flow` is already an **`engineAffecting`** edge
field in the canonical projection (a change to it changes the digest and is a
Review-visible hunk). A `@paramId` string digests as its **literal text**,
exactly like `2D6` / `25%` / `1-3` do now — the digest treats `flow` as an
opaque engine-affecting string, and `loop-expr/1`'s AST-canonical form is **not**
applied to `flow` (that form is only for Register `expr`).

Two points the implementation must honour (no format change, but worth pinning):

- **Reference is by `id`.** A Proposal / three-way diff that renames or removes a
  Parameter does **not** auto-rewrite a `flow` that references it — the `flow`
  hunk is independent. A dangling result is a runtime diagnostic, not a merge
  error (matches how a `flow` pointing at a since-deleted handle already
  behaves).
- **`loop-model/1` §M8.1 field tags are unchanged.** Parameter `value` stays
  `engine`-tagged; `min` / `max` / `step` / `unit` stay `advisory`. This feature
  adds no field to `parameter` and no tag.

If the freeze review decides a discriminator is wanted (a graph that *uses* a
`flow` reference is not readable by a pre-`loop-model/2` engine), that is a
one-line **wire-level marker** decided in the `SEMANTICS-M2.md` PR — analogous to
`loop-model/1`'s v1/v2 discriminator (§M8.1) — **not** a `loop-revision` format
change. *(Decision PI-D5 — open for review.)*

---

## PI9. Editor — setting and recognising a reference

Design intent only; the exact controls are impl-time.

- The **`flow` text input** in the edge Inspector accepts `@paramId` /
  `@{param id}` and validates it live, the same field that accepts `2D6` today.
- When the value is a valid reference, the Inspector shows the **resolved
  number** and the **source Parameter's label** inline, e.g.
  `@daily_roast_kg → 40  (Daily roast amount)`.
- A **dangling / wrong-kind** reference is flagged in the Inspector (not a
  blocking error — the graph still saves and runs, degrading to `0`).
- A lightweight **picker** (choose from the graph's `parameter` nodes) is
  desirable so a first-time user does not have to type an id; it writes the same
  `@id` string. Picker vs. free-text-only is an impl-PR call.
- On the canvas, an edge whose `flow` is a reference **may** carry a small
  "= <n>" affordance so the reader sees the effective rate without opening the
  Inspector — desirable for the coffee levers, but optional and impl-time.
- **Parameter nodes stay portless.** The reference is a text field on the edge,
  not a drawn wire from the Parameter — consistent with `SEMANTICS-M.md` §M1.3
  (a Parameter "cannot be an edge endpoint").

---

## PI10. Invariant — every existing literal `flow` is unchanged

Pinned by tests in the implementation PR:

- **byte identity** — `serialize(load(doc)) === doc` for every existing
  `examples/*.json` and fixture (no `flow` rewrite);
- **digest identity** — the `loop-revision` canonical digest of every existing
  graph is unchanged;
- **run identity** — `parseFlow("2") / "all" / "25%" / "1-3" / "2D6" / "" /
  "garbage"` produce the **same `FlowExpr`** as today, and a full deterministic
  run of `engine-b-verification` / `mmo-progression` / `risky-factory` is
  **step-for-step identical**;
- a graph with **zero** `{kind:'param'}` flows exercises **no** new code path in
  `step()` beyond a `Map` lookup that finds nothing to resolve.

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
| **PI-D3** | fallback for a well-formed but unresolvable `@ref` | **Contributes `0` + one diagnostic** (author intent is clear; `0` is visible and safe). A *malformed* string keeps `parseFlow`'s current `const 1`. *(open for review)* |
| **PI-D4** | when read | **Once per step**, at the existing `parseFlow` point, before Phase 0; resolved from the step's `nodes` snapshot. A run-constant, so no drift / ordering effect. |
| **PI-D5** | freeze vehicle | **A new frozen spec `loop-model/2` (`SEMANTICS-M2.md`)**, additive over `loop-model/1`; a graph with no `flow` reference runs and digests exactly as `loop-model/1`. Whether a wire-level v1/v2 discriminator is added is settled in that PR. *(open for review)* |
| **PI-D6** | `loop-revision` | **No format change.** `flow` is already an engine-affecting string; `@id` digests as its literal text. Reference is by `id`; a rename/delete does not auto-rewrite a `flow`. |
| **PI-D7** | restart on value change | **Reuses `simulationRev`.** Editing a referenced `value` (or the `flow` string) already bumps it → live run resets, MC result goes stale. No new machinery. |
| **PI-D8** | editor | The existing `flow` input accepts a reference; the Inspector shows the resolved number + the Parameter's label; a dangling reference is flagged non-blockingly. A parameter picker is desirable. Detail is impl-time. |
| **PI-D9** | scope guard | **Excluded:** Coffee-specific code, `min` / `max`, compound / general expressions on edges, a Register-display-only approach, references in any field other than `flow`. |

---

## PI14. Build order (feeds `docs/example-coffee-roastery.md` §CR13)

1. **this design PR** — docs-only, review → settle §PI2–§PI13.
2. **implementation PR** — `SEMANTICS-M2.md` (`loop-model/2`, frozen) + the
   `parseFlow` `param` kind + the top-of-step resolve pass in `step.ts` +
   `normalizeGraph` / diagnostics + the editor field + tests (§PI10 invariants,
   §PI5 fallbacks, §PI11 lever table as an engine test). **No Coffee file.**
3. **doc fold-in** — `docs/example-coffee-roastery.md` §CR3.5 / §CR6 / §CR8 /
   §CR9 / CR-D12 lose their "blocked" notes and state the real mechanism.
4. **impl PR (2)** — `examples/coffee-roastery.json` + registration, consuming
   this feature (unchanged from §CR13).

---

## PI15. Scope boundary

- This doc fixes the **behaviour contract** for a parameter reference in a
  resource-edge `flow`. It is **not** the frozen spec (that is `SEMANTICS-M2.md`,
  written in the implementation PR) and **not** a UI spec.
- It adds **no** capability beyond "a `flow` may be one parameter reference,
  resolved to a number once per step."
- Everything in §PI1 **Out** and §PI12 stays out.
- `docs/example-coffee-roastery.md` impl PR (2) does not start until the
  implementation PR here has merged and §CR13 step 3 (the doc fold-in) is done.
