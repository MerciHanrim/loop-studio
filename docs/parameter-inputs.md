# Parameter-driven inputs (non-frozen design doc — DRAFT)

**Status: design only — implementation pending. rev 3.** This is **PR (1.5)** in
[`docs/example-coffee-roastery.md`](example-coffee-roastery.md) §CR13: a
**minimal, general** capability that lets a `parameter` node's `value` drive a
**resource-edge `flow`**, so changing a Parameter genuinely changes what the
simulation computes. It exists because the frozen engine today ignores
`parameter` / `register` nodes entirely (`src/engine/step.ts`, `SEMANTICS-M.md`
§M6.1) and a resource-edge `flow` accepts no reference (`src/engine/flow.ts`).

- **rev 2** settled: PI-D3 — every unresolved `@…` (incl. a malformed `@…` typo)
  → `0` + a diagnostic, never `1`; PI-D8 — the Parameter picker is required
  scope; §PI10 test boundaries.
- **rev 3** fixes two compatibility blockers in PI-D5:
  1. **the discriminator must be one an already-installed client already
     checks.** A cached PWA / prior deploy does **not** validate `version`, so
     `version: 2` would not fail-close it — it would read `@param` as a
     malformed flow and run it as `1`. So the model-semantics version rides the
     **`schema`** string (v1 = today's `"loop-studio/graph"`, v2 = a **new**
     schema value); an old reader rejects the unknown v2 schema through its
     existing `schema` check. `version` may be carried too, but is **not** the
     fail-closed gate (§PI8).
  2. **no silent v1 → v2 upgrade, and no re-interpretation of an existing
     `@…`.** In v1 a `flow` is an arbitrary string, so an existing document may
     already hold `@foo` as a malformed value whose v1 meaning is `1`. A v1
     document keeps **legacy** semantics for that string; a document becomes v2
     **only on an explicit user action** (creating a reference via the picker,
     or committing a raw `@id`); merely opening and re-saving a v1 document does
     **not** promote it. The model-semantics version is **explicit and
     preserved at runtime** and through Import / Share / Workspace / autosave
     (§PI8). Leading `@` is a reference **only in a v2 document**.
- **rev 3** also pins the **negative / decimal** result explicitly: a **finite**
  value obtained from a reference follows the **same** normalisation and
  execution rules as the identical numeric literal — `@p` with `p.value = -2`
  gives the **same** result as the literal `-2` (which `parseFlow` gates to `1`
  via `n >= 0`); the Parameter path is **never** separately clamped, floored, or
  diagnosed for a negative (§PI5.3).
- **rev 3** also pins the **leading-`@` commit boundary** (§PI8.2 / PI-D11): if
  the user edits a `flow` input and commits a value that starts with `@` —
  well-formed **or** malformed — the document promotes to v2, so a fresh typo
  like `@{visitor` runs `0` + a diagnostic, **never** the v1 fallback `1`. A
  pre-existing v1 `@…` string is **not** promoted by open / save / autosave —
  only by the user actually editing and re-committing it. The exact v2 `schema`
  token may be frozen in the `SEMANTICS-M2.md` design, but **must** be finalised
  before implementation and **must** be a value already-deployed readers reject.

This doc **fixes the behaviour contract before any engine code**. It is a
**non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and merges as
*settled design, implementation pending*, like
[`docs/large-graph-readability.md`](large-graph-readability.md) and
[`docs/template-label-overlay.md`](template-label-overlay.md). The implementation
PR ratifies the settled parts as a **new frozen spec `loop-model/2`**
(`SEMANTICS-M2.md`), layered on `loop-model/1` exactly as `loop-state/2`
(`SEMANTICS-S2.md`) is layered on `loop-state/1` — §PI8.6.

**No code in this PR.** No engine change, no `parseFlow` change, no `schema` /
`version` change, no editor change, no Coffee file. Those land in the
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
- **missing / wrong-kind / malformed / negative** reference handling — *every*
  unresolved `@…` → `0` + a diagnostic; a **finite** value follows the
  identical-literal rules; why **no cycle** is possible (§PI5);
- the **restart rule** when a referenced `value` (or the `flow` string) changes
  (§PI6);
- **save / Share / Workspace / Export / autosave** behaviour and **old-document
  compatibility** (§PI7);
- the **`schema`-based model-semantics discriminator** (an already-installed
  client fail-closes on the new `schema`), **explicit user-action-only, one-way**
  v1 → v2 promotion, the store-held `modelVersion`, `SEMANTICS-M2.md`, and the
  `loop-revision` non-impact (§PI8);
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

## PI2. Reference syntax — and it is only a reference in a **v2** document

A parameter reference is recognised **only when the document's model-semantics
version is v2** (§PI8). In a **v1** document a `flow` is exactly what it is
today — an arbitrary string — and a leading `@` carries **no** meaning:
`parseFlow` runs unchanged and `@foo` falls through to `const 1` with **no
diagnostic**, preserving v1 byte- and run-identity (§PI10.1).

In a **v2** document, a resource-edge `flow` is **either** a literal (today's
`const | all | percent | range | dice`, unchanged) **or** a single **parameter
reference** and nothing else:

```
flow      = literal | paramref
paramref  = "@" ( safe-id | "{" braced-id "}" )
```

- `safe-id` / `braced-id` are **exactly** the `loop-expr/1` §X3 reference forms
  (`@daily_roast`, `@{daily roast kg}`) — a reader who has seen a Register
  expression already knows this syntax. The braced form escapes `}` / `\` per
  `loop-expr/1` §X3.1.
- The reference resolves **by node `id`** (stable), never by `label`. `@{...}`
  brackets an **id** that is not a bare `safe-id`, not a label.
- **In a v2 document, a leading `@` marks reference intent:**
  - a well-formed `@safe-id` / `@{braced-id}` resolves (§PI5.1);
  - **any other** `@…` string — `@`, `@ name`, `@{visitor` (unclosed), `@p%`,
    `@p-@q`, `@p*2`, `@p 2` — is a **malformed reference** → the edge contributes
    **`0`** + one diagnostic (§PI5.1). It does **not** fall back to `const 1`.
  Rationale: in a v2 document a typo like `@{visitor` silently running at `1`
  would be the hardest defect to find.
- **A string that does not start with `@`** (in a v1 *or* v2 document) is a
  plain literal and keeps `parseFlow`'s exact current behaviour, including the
  legacy `const 1` for an unparseable literal (`garbage`, `2D@p`, `1..2`).
- **No composition.** `@p%`, `@p-@q`, `-@p`, `@p*2` all start with `@`, so in a
  v2 document each is a malformed reference → `0` + diagnostic. Adding compound /
  arithmetic forms is explicitly out (§PI1).

**FlowExpr.** `parseFlow(raw, modelVersion)` gains a **`modelVersion`** argument
(default `1`, so every existing caller and test is byte-identical) and two kinds
that are produced **only when `modelVersion === 2`**:

```ts
type FlowExpr =
  | { kind: 'const'; value: number }
  | { kind: 'all' }
  | { kind: 'percent'; frac: number }
  | { kind: 'range'; lo: number; hi: number }
  | { kind: 'dice'; count: number; sides: number }
  | { kind: 'param'; id: string }        // v2 only — a well-formed reference; not yet a number
  | { kind: 'paramBad'; raw: string }    // v2 only — a `@…` string that is NOT a well-formed reference
```

- With `modelVersion === 1` (the default), `parseFlow` is **literally today's
  function** — a leading `@` is an unparseable string → `const 1`. `param` /
  `paramBad` are **never** produced.
- With `modelVersion === 2`, a leading-`@` string → `{kind:'param', id}` (well
  formed) or `{kind:'paramBad', raw}` (any other `@…`); everything else is
  unchanged.

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

A resolved reference feeds `parseFlow`'s result consumers (`evalDet`, `rateOf`,
`sumInRate`, the Source `amountOf`, …) **through the same normalisation the
identical numeric literal would** (§PI5.3) — never a Parameter-only clamp. It
does **not** compose with `all` / `percent` / `range` / `dice` because a `flow`
is never a compound (§PI2).

---

## PI4. When the value is read

**Once per step, at the same point `flow` is parsed today.** In
`src/engine/step.ts`, `step()` builds `flowOf` once at the top:

```ts
const flowOf = new Map(resEdges.map(e => [e.id, parseFlow(e.data.flow, modelVersion)]))
```

`step()` gains a **`modelVersion`** input (the loaded document's model-semantics
version, §PI8; the store threads it in, default `1`). It is passed to
`parseFlow`, so in a **v1** document no `param` / `paramBad` is ever produced and
the map is exactly today's.

In a **v2** document, the implementation runs a **resolve pass** over that map
**right there**, before Phase 0, reading referenced nodes' `data.value` from the
`nodes` array passed to `step()`:

- `{kind:'param', id}` where `id` names a live `parameter` whose `value` is a
  **finite number** → that value, **routed through the same literal
  normalisation** (§PI5.3): `value >= 0` → `{kind:'const', value}`;
  `value < 0` → `{kind:'const', value: 1}` (exactly `parseFlow`'s `n >= 0`
  literal gate — no diagnostic, matching a negative literal);
- `{kind:'param', id}` that does **not** resolve to a finite number — unknown
  id, non-`parameter` node, or a **non-finite** `value` (`NaN` / `±Infinity`) —
  **and** every `{kind:'paramBad'}` → `{kind:'const', value: 0}` + one deduped
  diagnostic (§PI5.1);
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

### PI5.1 Resolution outcomes (v2 documents only)

At the top-of-step resolve pass, for an edge whose `flow` string trims to a
leading `@`, **in a v2 document**:

| case | value used | diagnostic (one per edge per step) |
|---|---|---|
| well-formed `@id`, `id` names a live `parameter`, `value` is a **finite number ≥ 0** | that `value` (incl. a legitimate **`0`** / a **decimal**) | **none** |
| well-formed `@id`, `parameter` `value` is a **finite negative** number | **as the identical literal** — `parseFlow`'s `n >= 0` gate → **`1`** (§PI5.3) | **none** (a negative *literal* is also silent) |
| well-formed `@id`, `parameter` `value` **missing / non-finite** (`NaN` / `±Infinity`) | **`0`** | `Edge "<edgeId>" flow "@<id>": parameter value is not a finite number; contributes 0.` |
| well-formed `@id`, **no such node** | **`0`** | `Edge "<edgeId>" flow "@<id>" references an unknown parameter; contributes 0.` |
| well-formed `@id`, node is **not a `parameter`** (pool / source / register / …) | **`0`** | `Edge "<edgeId>" flow "@<id>" must reference a parameter node (got <kind>); contributes 0.` |
| **malformed** `@…` string (`@`, `@ x`, `@{visitor`, `@p%`, `@p*2`, …) | **`0`** | `Edge "<edgeId>" flow "<raw>" is not a valid parameter reference; contributes 0.` |
| string does **not** start with `@` | **unchanged** — exactly today's `parseFlow` | unchanged from today |

- **Every `@…` string that does not resolve to a *finite* number → `0`** — an
  unknown id, a wrong-kind reference, a non-finite `value`, and a malformed `@…`
  typo all contribute nothing + a diagnostic. A legitimate finite `value` of
  **`0`** is a normal value and is silent. A **finite negative** `value` is
  *not* a resolve failure — it routes through the identical literal path
  (§PI5.3), no special Parameter clamp, no diagnostic.
- **In a v1 document** a leading-`@` string is a plain unparseable literal →
  `const 1`, **no diagnostic**, exactly as today (§PI2 / §PI10.1).
- **Never `invalid`, never a throw.** Consistent with `parseFlow` (which never
  throws) and Parameter's "never `invalid`" rule (§M1.1).
- Diagnostics are **deduped per edge per step** (like `badRandom` in `step.ts`).
- **Determinism.** `0` and `1` are constants, so a degraded / negative edge is
  fully deterministic and a Monte-Carlo run over it is reproducible (§PI10.3).

### PI5.2 No new cycle class

A cycle would need `flow → parameter → … → flow`. It cannot form:

- a `parameter`'s only semantic field is `value`, **a finite literal, not an
  expression** (`SEMANTICS-M.md` §M1.1) — it references nothing;
- a `flow` reference reads a Parameter's `value` and stops; it does not feed
  Register evaluation or another edge.

So the reference graph from `flow` to `parameter` is **depth 1, always acyclic**.
No topological pass, no cycle diagnostic, nothing to add to the router-DAG cycle
handling in `step.ts`.

### PI5.3 A resolved finite value follows the identical-literal rules

**A finite number obtained from a reference is normalised and executed by the
*exact same* rules as the identical numeric literal — the Parameter path adds no
clamp, floor, cap, or special case of its own.**

- `parseFlow`'s literal gate is `Number.isFinite(n) && n >= 0`. A resolved
  `value`:
  - `>= 0` → `{kind:'const', value}` (a decimal like `2.5` flows as `2.5`,
    exactly as the literal `2.5` does);
  - `< 0` → `{kind:'const', value: 1}` — because the literal `-2` also does
    (`parseFlow("-2")` fails the regex → `const 1`). **`@p` with `p.value = -2`
    produces a run identical to a literal `-2` in the same position.**
- Downstream (`evalDet`, `rateOf`, `sumInRate`, capacity clamps in `step.ts`,
  the Commit-phase `[0, capacity]` clamp) is **untouched** — a Parameter-fed
  edge and a literal-fed edge of the same effective number produce the
  **same** `values` and `events`.
- Pinned by a test: for `v ∈ {-2, 0, 0.5, 2, 100}`, a graph with `flow: "@p"`
  (`p.value = v`) runs **step-for-step identical** to the same graph with
  `flow: "<v>"` written as a literal.

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
  (`route` / `waypoints`) — a `flow` edit is never cosmetic, so it also resets;
- **the first `flow` edit that introduces a reference also latches the document
  to v2** (§PI8.2) — one undo-tracked edit does both (writes the string, sets
  `modelVersion = 2`); undoing it reverts both.

The contract to state in `loop-model/2`: **a change to a `value` that any live
`flow` references — and any edit that adds or removes a reference — is a
simulation-relevant change** (already true by the `updateNodeData` /
`setEdgeData` rules; the spec just names it).

---

## PI7. Persistence — Share, Workspace, Export, autosave, old documents

`flow` is already a serialized string on `ResourceEdgeData`
(`src/model/serialize.ts` `toDocEdge` keeps `flow: … ?? '1'`). A `@paramId`
value is just a different string in that field — like `2D6` or `25%`. What
changes is the **document's model-semantics version**, carried on the `schema`
string (§PI8).

- **Graph JSON / Share (`#g1=`) / Workspace / autosave** carry the whole
  `GraphDoc` — `schema` string included — verbatim; a round-trip preserves the
  model version and is byte-identical for an unchanged document (§PI10.1 / §PI10.4).
- **Existing (v1) documents are completely unaffected** — every `flow` parses to
  the same `FlowExpr` (a stray `@foo` still → `const 1`, no diagnostic), the
  digest is unchanged, and the `schema` stays `"loop-studio/graph"` (§PI8.2).
- A Share link that references a Parameter carries that Parameter node too (the
  whole graph is in the fragment), so it opens self-consistently; the fragment
  stays `#g1=` (`loop-share/1`) — the inner `GraphDoc.schema` is the model
  discriminator (§PI8.4).
- **Import of a v2 graph whose `@ref` dangles** (the Parameter was deleted
  before export): `normalizeGraph` leaves the `flow` string as-authored; at run
  time it degrades to `0` + a diagnostic (§PI5.1). It is **not** rewritten.
- **`serialize()` allowlist** (`docs/serialize-schema-allowlist.md`): `flow` is
  already inside the projected edge shape. The serialization-boundary change is
  the graph-level **`schema`** value becoming `"loop-studio/graph"` **or** the v2
  string, chosen from the document's model version (a `GraphDoc` literal edit —
  the exact kind that doc flags).
- **The model version is preserved through every path** because it lives on the
  `GraphDoc.schema` that Share / Workspace / autosave / Export all embed
  verbatim, and the store re-derives it on every load (§PI8.3). Pinned by
  round-trip tests (§PI10.4).

---

## PI8. Model-semantics versioning & compatibility

`loop-model/2` execution differs *observably* from `loop-model/1` for the same
`flow` bytes (`@x` → resolved vs. `@x` → `const 1`). So the same document must
not silently produce different numbers on different clients — and the
already-installed client (a cached PWA, a prior deploy) is the one that matters,
because we cannot ship it new code.

### PI8.1 The discriminator rides `schema` — not `version`

An already-deployed reader validates **`schema`** (`deserialize`:
`if (obj.schema !== 'loop-studio/graph') throw`) and **ignores `version`
entirely**. So `version` cannot fail-close an old client. The model-semantics
version therefore rides the **`schema`** string:

| | v1 | v2 |
|---|---|---|
| `GraphDoc.schema` | `"loop-studio/graph"` (unchanged) | a **new** distinct value — proposed **`"loop-studio/graph/2"`** (the exact token is the `SEMANTICS-M2.md` PR's call; the hard constraint is that every already-deployed reader's `schema !== "loop-studio/graph"` check **rejects** it) |
| a **new** reader | accepts | accepts — and runs `loop-model/2` |
| an **already-installed** reader | accepts | **rejects** via its existing `schema` check → its "This does not look like a Loop Studio graph file." error. **Fail-closed, with no code update.** |

`version` MAY still be written (`1` for both, or `2` alongside the v2 schema) but
it is **informational only** — it is never the gate. A new reader treats
`schema` as authoritative.

### PI8.2 No silent v1 → v2 upgrade, and no re-reading of an existing `@…`

In v1 a `flow` is an arbitrary string, so an existing document may already carry
`@foo` as a malformed value whose v1 meaning is the fallback `1`. Automatically
reading that as a reference, or promoting the document to v2 because it "contains
`@`", would break **v1 byte identity**, **v1 run identity**, and **"no format
upgrade without an explicit user action"**. So:

- **A v1 document stays v1.** Its `schema` is `"loop-studio/graph"`, its `@foo`
  keeps legacy semantics (`const 1`, no diagnostic), and opening + re-saving it —
  or autosaving it — leaves the `schema` and (for an otherwise-unchanged
  document) the bytes **exactly as they were**.
- **A document becomes v2 only on an explicit user action:**
  1. creating a parameter reference with the picker (§PI9.1), **or**
  2. **the user editing a `flow` input and committing a value whose trimmed
     form starts with `@`** — *whether the reference is well-formed **or**
     malformed*.
  Either is an undo-tracked graph edit that **latches the document's model
  version to v2**; the next `serialize()` writes the v2 `schema`.
- **The leading-`@` commit boundary — new typos are safe, existing v1 strings
  are preserved:**
  - editing the `flow` field and committing `@{visitor` (a typo) in a v1
    document → the document is **promoted to v2** and that edge runs under v2
    rules → **`0` + a diagnostic** (§PI5.1), **not** the v1 fallback `1`. A
    fresh mistake never silently runs at `1`.
  - an `@…` string **already stored** in an existing v1 document is **not**
    promoted by opening, saving, or autosave — it keeps its v1 meaning
    (`const 1`, no diagnostic). Only when the **user actually edits that stored
    string and re-commits it** as a `flow` value (still starting with `@`) does
    the explicit v2 transition happen.
  This is what makes *"a new typo is safely `0`"* and *"existing v1 semantics
  preserved"* both hold. *(Decision PI-D10 / PI-D11.)*
- **v2 is a one-way latch.** Once v2, a document stays v2 even if every reference
  is later removed (a v2 document with no live reference runs and digests
  identically to v1 — §PI8.5–§PI8.6 — so staying v2 costs nothing, and an auto-downgrade
  would be a second kind of silent format change). *(Decision PI-D10.)*
- **Leading `@` is a reference only in a v2 document** (§PI2). A v1 document's
  stored `@…` is never re-interpreted **until the user edits and re-commits it**
  (which promotes the document, per the boundary above).

### PI8.3 The store holds and preserves the model version

- `graphStore` carries a **`modelVersion: 1 | 2`** field (next to
  `simulationRev` / `pristineSample`), set on load from the document's `schema`,
  latched to `2` by the first reference-creating edit (§PI8.2), and **passed to
  `serialize()`** on every write (Graph JSON export, Share encode, Workspace
  export, autosave) and **to `step()` / `parseFlow`** for every run.
- `deserialize()` (and the Share / Workspace / autosave readers) **return** the
  model version derived from the incoming `schema`. Import / Share-open /
  Workspace-import / autosave-restore all set the store's `modelVersion` from
  the loaded document — so the version is **identical before and after every
  round-trip** (pinned, §PI10.4).
- A new reader that sees the v2 `schema` but was somehow built without v2 support
  refuses with a clear message (belt-and-braces; the primary gate is the old
  reader's `schema` rejection).
- **autosave-restore of a v2 record on a v1-only client:** the old
  `loadFromStorage` `deserialize` throws on the unknown `schema`; that is caught
  and returns `null` → the app boots the first-run sample; the v2 record is left
  on disk untouched.

### PI8.4 Share / Workspace fragment versions

- The Share fragment stays **`#g1=`** (`loop-share/1`) — it is a container for a
  `GraphDoc`, and the `GraphDoc.schema` inside it is the model discriminator. An
  old client decoding `#g1=<v2 doc>` decompresses fine, then its `deserialize`
  rejects the unknown `schema`. No `#g2=` needed.
- **`loop-workspace/1` is unchanged** — it embeds the `GraphDoc` verbatim
  (`SEMANTICS-M.md` §M8.2 reasoning), so an old client reading a workspace with a
  v2 `GraphDoc` rejects it at the inner `schema` check.

### PI8.5 `loop-revision` — no format change

- `flow` is already an **`engineAffecting`** edge field in the canonical
  projection; a `@paramId` string **digests as its literal text**, exactly like
  `2D6` / `25%` / `1-3`. `loop-expr/1`'s AST-canonical form is **not** applied to
  `flow` (only to Register `expr`).
- `schema` is **GraphDoc envelope, not projected content** — it does **not**
  enter the `loop-revision` digest, so a v1 graph's `fullContentDigest` is
  unchanged and a v2 graph with no live reference has the **same** digest as its
  v1 form (conservative extension, matching `SEMANTICS-M.md` §M8.1c M-INV-9).
- **Reference is by `id`.** A Proposal / three-way diff that renames or removes a
  Parameter does **not** auto-rewrite a `flow` — the `flow` hunk is independent;
  a dangling result is a runtime diagnostic, not a merge error.
- `loop-model/1` §M8.1 field tags are unchanged; this feature adds no field to
  `parameter`. The inferred `loop-revision/2` predicate (§M8.1) is unaffected —
  a graph with `parameter` nodes is already `loop-revision/2` content.

### PI8.6 `SEMANTICS-M2.md`

The implementation PR writes **`SEMANTICS-M2.md`, spec id `loop-model/2`,
Frozen**, layered on `loop-model/1` as `SEMANTICS-S2.md` / `loop-state/2` is on
`loop-state/1`. It fixes: the `@` reference grammar in a **v2** `flow`, the
`modelVersion` argument to `parseFlow` / `step`, the top-of-step resolve timing,
the "every unresolved `@…` → `0`" and "finite value follows the identical-literal
rules" rules (§PI5), the **`schema`-based v1/v2 discriminator** — including the
**exact v2 `schema` token** (frozen there, but it **must** be settled before the
implementation code and **must** be rejected by every already-deployed reader) —
the explicit, user-action-only, one-way promotion (incl. the leading-`@` commit
boundary, §PI8.2) + the store-held `modelVersion`, and the
conservative-extension invariant (a v2 graph with no live reference runs and
digests identically to `loop-model/1`).

---

## PI9. Editor — **required** scope for the implementation PR

A pure text field where the user must know and type `@id` from memory hides the
feature. The following (**§PI9.1 items 1–6**) is the **minimum in scope for
PR (1.5)** — not "desirable", not deferred. Visual polish is impl-time; presence
is not.

### PI9.1 Required items

1. **Pick a Parameter from the connection's `flow` input.** The edge Inspector's
   `flow` control offers the graph's `parameter` nodes (by label) as a choice;
   selecting one writes the `@id` string **and, if the document is still v1,
   latches it to v2** (§PI8.2). A graph with no `parameter` node simply shows no
   options.
2. **After selection, show the Parameter label and the current resolved value**
   at the input, e.g. `Daily roast amount → 40`.
3. **Raw `@…` entry is also allowed, and any committed leading-`@` value
   latches v2.** Typing `@daily_roast_kg` / `@{daily roast kg}` — **or a
   mistyped `@{visitor`** — into the `flow` field and committing it is a `flow`
   edit whose trimmed value starts with `@`, so it **latches a v1 document to
   v2** (§PI8.2) and the edge then runs under v2 rules (a well-formed reference
   resolves; a malformed one → `0` + a diagnostic, **never** the v1 fallback
   `1`). Editing an `@…` string that was **already stored** in a v1 document and
   re-committing it does the same; opening / saving / autosaving that stored
   string alone does **not**.
4. **Non-blocking warning near the input** for a **deleted**, **wrong-kind**, or
   **malformed** (`@{visitor`) reference: a visible flag at the field, but the
   graph still saves and runs (the edge degrades to `0`, §PI5.1). Never a modal,
   never a save block.
5. **Renaming a Parameter's `label` does not affect the reference** — the
   reference is by `id`; the picker / display just shows the new label.
6. **No auto-rewrite on `id` change or deletion.** If a referenced Parameter's
   `id` changes or the node is deleted, the `flow` string is left exactly as
   authored and the edge degrades to `0` + a diagnostic. This rule is stated in
   the Inspector help text and pinned by a test. (The document does **not**
   downgrade to v1 — §PI8.2.)

### PI9.2 Also

- **Parameter nodes stay portless.** The reference is a field on the edge, not a
  drawn wire — consistent with `SEMANTICS-M.md` §M1.3 (a Parameter "cannot be an
  edge endpoint").
- The `flow` field keeps accepting every literal it does today (`2`, `all`,
  `25%`, `1-3`, `2D6`) with no behaviour change (§PI10).
- An on-canvas "= <n>" affordance on a reference edge is **optional / impl-time**
  (nice for the coffee levers, not required scope).

---

## PI10. Test boundaries — required in the implementation PR

### PI10.1 v1 invariance (existing documents completely untouched)

- **byte identity** — `serialize(load(doc)) === doc` for every existing
  `examples/*.json` and fixture; every such doc keeps `schema:
  "loop-studio/graph"` and is **never** promoted by a plain open + re-save /
  autosave;
- **digest identity** — the `loop-revision` canonical digest of every existing
  graph is unchanged;
- **`parseFlow(raw, 1)` identity** — `"2"`, `"all"`, `"25%"`, `"1-3"`, `"2D6"`,
  `""`, a non-`@` unparseable literal (`"garbage"`), **and a stray `"@foo"`**
  each produce the **same `FlowExpr`** as today (a v1 `@foo` → `const 1`, **no
  diagnostic**);
- **run identity** — a full deterministic run of `engine-b-verification` /
  `mmo-progression` / `risky-factory` is **step-for-step identical**;
- a v1 document exercises **no** new `step()` path (no resolve pass runs when
  `modelVersion === 1`).

### PI10.2 The reference itself (v2 documents)

- **one Parameter, many edges** — several `resource` edges each with
  `flow: "@p"` all read the same `value` in one step; changing `p` moves all of
  them; determinism holds;
- **finite value = identical literal** — for `v ∈ {-2, 0, 0.5, 2, 100}`, a graph
  with `flow: "@p"` (`p.value = v`) runs **step-for-step identical** to the same
  graph with `flow: "<v>"` as a literal; in particular `@p` with `v = -2` gives
  the **same** result as the literal `-2` (→ `1`, no diagnostic, no Parameter-only
  clamp — §PI5.3);
- **non-finite value** — `NaN` / `±Infinity` (after `normalizeGraph`'s
  `PARAM_VALUE_FIXED` → `0`, or if it slips through) → the edge contributes `0` +
  a diagnostic;
- **failure modes** — unknown id, wrong node kind (`@somePool`), and a malformed
  `@…` string each → the edge contributes `0`, exactly one deduped diagnostic
  per edge per step, run continues, no throw, no `invalid`;
- **`@{braced-id}`** — round-trips and resolves identically to the bare form for
  an id that is also a valid `safe-id`.

### PI10.3 Determinism

- **run** — same seed ⇒ identical trajectory with `@param` edges present,
  including degraded (`→ 0`) and negative (`→ 1`) edges;
- **Monte Carlo** — a graph using `@param` flows produces byte-identical
  `series` / `endedRuns` / `final` across two runs of the same config
  (the `mmo-progression`-style determinism test, applied to a small
  reference-bearing fixture).

### PI10.4 Model-version promotion & preservation

- **explicit promotion only** — opening a v1 fixture and calling `serialize()`
  again (no edit) yields **byte-identical** output with `schema:
  "loop-studio/graph"`; only after a picker selection **or** a committed
  leading-`@` `flow` value does the store's `modelVersion` become `2` and the
  next `serialize()` write the v2 `schema`;
- **leading-`@` commit boundary (§PI8.2 / PI-D11):**
  - in a **v1** fixture, editing a `flow` field and committing **`@{visitor`**
    (a typo) → the document is now v2, and that edge runs `0` + a diagnostic —
    **not** `1`;
  - a v1 fixture that **already carries** `flow: "@foo"` on some edge, opened and
    re-serialized with **no edit to that field**, stays v1 and that edge still
    runs `const 1` with **no** diagnostic;
  - editing that same stored `@foo` (even re-typing it identically) and
    committing it → the document promotes to v2 and the edge runs under v2 rules;
- **no downgrade** — remove every reference from a v2 document → it still
  serializes with the v2 `schema` (`modelVersion` stays `2`), and a run is
  identical to the equivalent v1 graph (conservative extension);
- **round-trip preserves the version** for a v2 fixture through **Export →
  Import**, **Share (`#g1=`) encode → decode**, **Workspace Export → Import**,
  and **autosave → reload**: reload is byte-identical, the store's
  `modelVersion` is `2` after each, and a run is step-for-step identical.

### PI10.5 Cross-version safety (the already-installed client)

- a **v2 document** (`schema: "loop-studio/graph/2"`) fed to a reader that only
  knows `"loop-studio/graph"` (i.e. today's `deserialize` unchanged) is
  **rejected** by its existing `schema` check — it does **not** load and run
  `@param` as `1`;
- a **new (v2-capable) reader** accepts both `schema` values and runs the
  matching semantics;
- a **v1 document** opened by a v2 reader loads and runs exactly as before (the
  resolve pass never runs);
- **autosave-restore of a v2 record on a v1-only client** — `loadFromStorage`'s
  `deserialize` throws on the unknown `schema`, the throw is caught, `null` is
  returned, the app boots the first-run sample, and the v2 record is left on
  disk untouched.

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
| **PI-D3** | value used when a `@…` string does not resolve to a finite number | **`0` + one deduped diagnostic — for every `@…` failure** (v2 documents): unknown id, non-`parameter` node, non-finite `value`, **and** a malformed `@…` string (`@{visitor`, `@p%`, `@p*2`, …). A legitimate finite `value` of `0` is normal and silent. A **v1** document's `@…` string is a plain literal → `const 1`, no diagnostic (unchanged). |
| **PI-D3b** | value used when a `@id` resolves to a *finite* number | **Follows the identical-literal rules — no Parameter-only clamp.** `>= 0` → that value; **`< 0` → `1`** (exactly `parseFlow`'s `n >= 0` literal gate; a negative literal also → `1`); a decimal flows as itself. `@p` with `p.value = -2` runs identically to the literal `-2` (§PI5.3). |
| **PI-D4** | when read | **Once per step**, at the existing `parseFlow` point, before Phase 0; resolved from the step's `nodes` snapshot. A run-constant, so no drift / ordering effect. The resolve pass runs **only** when `modelVersion === 2`. |
| **PI-D5** | freeze vehicle + discriminator | **Both.** (a) a new frozen spec **`SEMANTICS-M2.md` / `loop-model/2`**, additive over `loop-model/1`. (b) The model-semantics version rides the **`schema`** string — **not** `version` — because an already-installed reader validates `schema` and **ignores `version`**: v1 = `"loop-studio/graph"` (unchanged), v2 = a **new** distinct value. **The exact v2 token may be frozen in the `SEMANTICS-M2.md` design** (proposed `"loop-studio/graph/2"`), but it **must** be finalised **before implementation** and **must** be a value every already-deployed reader's `schema !== "loop-studio/graph"` check **rejects** — fail-closed with no code update. A new reader accepts both and runs the matching semantics. `version` may be carried but is informational only. |
| **PI-D10** | how a document becomes v2 | **Only on an explicit user action** — a picker selection **or** the user editing a `flow` input and committing a value whose trimmed form starts with `@`. Opening + re-saving / autosaving a v1 document does **not** promote it, and a v1 `@…` string already stored is **never** re-interpreted (it keeps legacy `const 1`) — *until the user edits and re-commits it*. Promotion is one undo-tracked edit that also sets `modelVersion`. **One-way latch** — a v2 document with every reference removed stays v2 (it still runs identically to v1, and an auto-downgrade would be a second silent format change). The store holds `modelVersion: 1 \| 2`, sets it from the loaded `schema`, passes it to `serialize()` / `step()`, and re-derives it on every Import / Share / Workspace / autosave load — identical before and after every round-trip. |
| **PI-D11** | the leading-`@` commit boundary | **A committed leading-`@` `flow` value promotes the document to v2 whether the reference is well-formed or malformed.** So a fresh typo (`@{visitor` typed and committed) runs under v2 → **`0` + a diagnostic**, never the v1 fallback `1`. A pre-existing v1 `@…` string is promoted **only** when the user actually edits and re-commits it — not by open / save / autosave. This is what makes *"a new typo is safely `0`"* and *"existing v1 semantics preserved"* both hold (§PI8.2). |
| **PI-D6** | `loop-revision` | **No format change.** `flow` is already an engine-affecting string; `@id` digests as its literal text. `schema` is GraphDoc envelope, **not** projected content — not in the digest; a v2 graph with no live reference has the same digest as its v1 form. Reference is by `id`; a rename/delete does not auto-rewrite a `flow`. |
| **PI-D7** | restart on value change | **Reuses `simulationRev`.** Editing a referenced `value`, or the `flow` string (incl. the reference-introducing edit that also latches v2), already bumps it → live run resets, MC result goes stale. No new machinery. |
| **PI-D8** | editor | **Required scope for PR (1.5)** (§PI9.1): pick a Parameter from the `flow` input (which latches v1 → v2); show its label + current resolved value; allow raw `@id` entry (also latches); non-blocking warning at the field for deleted / wrong-kind / malformed; label rename does not affect the reference; **no auto-rewrite on id change or deletion**, and no downgrade (stated in help text + a test). On-canvas "= n" affordance stays optional. |
| **PI-D9** | scope guard | **Excluded:** Coffee-specific code, `min` / `max`, compound / general expressions on edges, a Register-display-only approach, references in any field other than `flow`. |

---

## PI14. Build order (feeds `docs/example-coffee-roastery.md` §CR13)

1. **this design PR** — docs-only, review → settle §PI2–§PI13.
2. **implementation PR**, all in one:
   - **`SEMANTICS-M2.md`** (`loop-model/2`, Frozen);
   - `parseFlow(raw, modelVersion)` → `param` / `paramBad` kinds **only when
     `modelVersion === 2`** (pure, text-only; default `1` = today's function);
   - the **v2 top-of-step resolve pass** in `step.ts` (§PI4) + the "every
     unresolved `@…` → `0`" rule + the "finite value = identical literal" rule
     (§PI5.3) + deduped diagnostics;
   - `step()` gains a `modelVersion` input; the store threads it in;
   - **`schema`-based discriminator**: `serialize()` writes the v1 or v2 `schema`
     from the store's `modelVersion`; `deserialize()` (+ Share / Workspace /
     autosave readers) accept both `schema` values and return the model version;
     a new-but-non-v2 build refuses the v2 `schema` with a clear message;
     `GraphDoc` literal updated per `docs/serialize-schema-allowlist.md`;
   - **`graphStore.modelVersion`** + explicit, user-action-only, one-way v1 → v2
     promotion (§PI8.2 / §PI9.1);
   - the **required editor scope** (§PI9.1 items 1–6);
   - the **test boundaries** in §PI10 (v1 invariance incl. a stray `@foo` still
     → `const 1`; the reference itself incl. the negative = literal test;
     determinism incl. Monte Carlo; promotion is explicit + one-way; v2
     round-trips preserve the version; an already-installed reader rejects a v2
     `schema`) + the §PI11 lever table as an engine test.
   **No Coffee file.**
3. **doc fold-in** — `docs/example-coffee-roastery.md` §CR3.5 / §CR6 / §CR8 /
   §CR9 / CR-D12 lose their "blocked" notes and state the real mechanism.
4. **impl PR (2)** — `examples/coffee-roastery.json` + registration, consuming
   this feature (unchanged from §CR13).

---

## PI15. Scope boundary

- This doc fixes the **behaviour contract** for a parameter reference in a
  resource-edge `flow`, plus the **compatibility contract** (the `schema`-based
  model-semantics discriminator, explicit one-way v1 → v2 promotion, and the
  store-held `modelVersion`, §PI8). It is **not** the frozen spec (that is
  `SEMANTICS-M2.md`, written in the implementation PR) and **not** a detailed UI
  design — §PI9 fixes *what must exist*, not the pixels.
- It adds **no** capability beyond "in a v2 document, a `flow` may be one
  parameter reference, resolved to a number once per step" and the versioning
  needed to keep that reproducible across clients.
- Everything in §PI1 **Out** and §PI12 stays out.
- `docs/example-coffee-roastery.md` impl PR (2) does not start until the
  implementation PR here has merged and §CR13 step 3 (the doc fold-in) is done.
