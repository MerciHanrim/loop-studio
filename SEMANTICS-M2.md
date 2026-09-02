# Model language — Parameter-driven inputs, revision 2

```
Spec ID: loop-model/2
Status:  Frozen
```

**Frozen (2026-09-02).** Layers on [`SEMANTICS-M.md`](./SEMANTICS-M.md)
(`loop-model/1`) exactly as [`SEMANTICS-S2.md`](./SEMANTICS-S2.md)
(`loop-state/2`) layers on `loop-state/1`. It adds **one** capability: in a
**v2 document**, a `resource` edge's `flow` string may be a **single parameter
reference** that the engine resolves to that Parameter's `value` once per step.
Everything else in `loop-model/1` — `parameter` / `register` node shape and
defaults, Register evaluation on the committed-snapshot axis, `resourceType`,
the field-projection tags, the inferred `loop-revision/2` predicate — is
**inherited verbatim**.

Design record: [`docs/parameter-inputs.md`](./docs/parameter-inputs.md).

Why a new frozen spec id: this changes **what a diagram computes** for the same
`flow` bytes (`@x` → resolved vs. `@x` → the `loop-expr` / flow "unparseable ⇒
`1`" fallback). A behavioural change to the frozen execution contract takes a
new frozen document.

---

## M2-0. What is unchanged (inherited from `loop-model/1`)

- `parameter`: `data.value` is the only semantic field, a finite literal,
  default `0`, never `invalid`, a **run constant** (`SEMANTICS-M.md` §M1);
  `min` / `max` / `step` / `unit` advisory; **no ports** (§M1.3).
- `register`: a `loop-expr/1` readout, stores no value, feeds nothing (§M2).
- Register evaluation `R(t)`, its time axis, cycle / invalid handling (§M3).
- `resourceType` advisory tag (§M4); no engine effect.
- The engine **ignores** `parameter` / `register` nodes in every phase (§M6.1) —
  they still never fire, still have no `activation`. A `flow` **reference** is
  the only way a Parameter reaches the engine, and it does so as a **number**,
  not as a node that participates.
- Field-projection tags (§M8.1b): `parameter.value` stays `engine`; no field is
  added to `parameter`.
- The inferred `loop-revision/2` content predicate (§M8.1) is **unchanged** — a
  `flow` reference adds no clause; a graph with `parameter` nodes is already
  `loop-revision/2` content.

---

## M2-1. Model-semantics version — the `schema` discriminator

A GraphDoc's **model-semantics version** is carried on its `schema` string:

| version | `GraphDoc.schema` |
|---|---|
| **v1** (`loop-model/1` execution) | `"loop-studio/graph"` |
| **v2** (`loop-model/2` execution) | `"loop-studio/graph/2"` |

- The token `"loop-studio/graph/2"` is **frozen here**.
- A reader that does not recognise a `schema` value **rejects the file** — this
  is the existing `loop-model/1` behaviour (`deserialize`: an unrecognised
  `schema` throws "This does not look like a Loop Studio graph file."). So a
  client built before `loop-model/2` **fail-closes** on a v2 document with no
  code change: it never runs a v2 document under v1 semantics.
- A `loop-model/2`-capable reader accepts **both** tokens and runs the matching
  semantics.
- `GraphDoc.version` is **not** the discriminator (a pre-`loop-model/2` reader
  ignores it). It stays `1` for both v1 and v2 documents — the JSON envelope
  shape `{ schema, version, nodes, edges, … }` is unchanged.
- `schema` is **GraphDoc envelope, not projected content** — it is not part of
  the `loop-revision` canonical projection or digest (M2-INV-4).

### M2-1.1 Promotion — v1 → v2 is explicit, one-way, and never automatic

- A document is **v1 unless its `schema` says v2**. Loading, re-saving, or
  autosaving a v1 document **never** promotes it, and a `flow` string already
  stored in a v1 document (including a stray `@foo`) is **never** re-interpreted
  — it keeps v1 semantics (M2-2).
- A document becomes **v2 only by an explicit user action** in the editor:
  1. selecting a Parameter for a `resource` edge's `flow` via the reference
     control, **or**
  2. the user editing a `resource` edge's `flow` field and committing a value
     whose **trimmed form starts with `@`** — *whether the reference is
     well-formed or malformed*.

  Either is one undo-tracked graph edit that also sets the document's model
  version to v2; the next serialise writes `schema: "loop-studio/graph/2"`.
- **The leading-`@` commit boundary.** A fresh typo cannot hide: committing
  `@{visitor` (unclosed) into a `flow` field promotes the document, so that edge
  runs under **v2** rules — `0` + a diagnostic (M2-3) — **never** the v1
  fallback `1`. Conversely, a `@…` string that was already on disk in a v1
  document is promoted **only** when the user actually edits and re-commits it.
- **v2 is a one-way latch.** Removing every reference from a v2 document does
  **not** return it to v1. By M2-INV-2 a v2 document with no live reference runs
  and digests identically to v1, so the latch costs nothing, and an
  auto-downgrade would be a second silent format change.

---

## M2-2. `flow` grammar — v1 vs v2

`parseFlow(raw, modelVersion)` gains the `modelVersion` argument (default `1`).

### v1 (`modelVersion === 1`) — unchanged

`parseFlow` is **byte-for-byte** `loop-model/1`: `flow ∈
{ const, all, percent, range, dice }`, and **any** other string — including one
starting with `@` — is the "unparseable ⇒ `const 1`" fallback, **with no
diagnostic**. `loop-model/1` execution is untouched.

### v2 (`modelVersion === 2`)

A `resource` edge's `flow` is **either** a v1 literal (unchanged) **or** a
**single parameter reference**:

```
flow      = literal | paramref
paramref  = "@" ( safe-id | "{" braced-id "}" )        ; loop-expr/1 §X3, decoded identically
```

- `safe-id` / `braced-id` are the **exact** `loop-expr/1` §X3 forms (same
  tokeniser, same `@{…}` escape rules, same "`@` + digit / space / EOF ⇒ not a
  reference"). The reference resolves **by node `id`**, never by `label`.
- A `flow` is a **single** bare reference or a literal — **never** a compound.
  `@p%`, `@p*2`, `@p-@q`, `-@p`, `@p 2`, `@ p`, `@{visitor`, a bare `@` all
  **start with `@`** and are **malformed references** (M2-3), not literals.
- `parseFlow(raw, 2)` returns:
  - `{ kind: "param", id }` for a well-formed `@safe-id` / `@{braced-id}`;
  - `{ kind: "paramBad", raw }` for any **other** string whose trimmed form
    starts with `@`;
  - its v1 result for every string that does **not** start with `@`.
  `parseFlow` stays pure (no node list); resolution is M2-4.

---

## M2-3. Resolution — every unresolved `@…` contributes `0`

**In a v2 document only.** At the top of `step()`, after `flow` strings are
parsed and **before Phase 0**, each `param` / `paramBad` entry is resolved
against the step's `nodes` snapshot:

| case | value used | one diagnostic per edge per step |
|---|---|---|
| `{param, id}` → live `parameter`, `value` a **finite number ≥ 0** (incl. `0`, incl. a decimal) | that `value` | — |
| `{param, id}` → live `parameter`, `value` a **finite negative** number | routed through the identical-literal rule (M2-3.1) ⇒ **`1`** | — |
| `{param, id}` → live `parameter`, `value` **non-finite** (`NaN` / `±Infinity`) | **`0`** | `Edge "<id>" flow "@<ref>": parameter value is not a finite number; contributes 0.` |
| `{param, id}` → **no such node** | **`0`** | `Edge "<id>" flow "@<ref>" references an unknown parameter; contributes 0.` |
| `{param, id}` → node is **not** a `parameter` | **`0`** | `Edge "<id>" flow "@<ref>" must reference a parameter node (got <kind>); contributes 0.` |
| `{paramBad, raw}` | **`0`** | `Edge "<id>" flow "<raw>" is not a valid parameter reference; contributes 0.` |

- **Never `invalid`, never a throw** — every failure degrades to a constant and
  the run continues (consistent with `parseFlow`, which never throws, and with
  Parameter's "never `invalid`" rule).
- Diagnostics are **deduped per edge per step** (as `badRandom` is in `step()`).
- The resolved entry is thereafter a plain `{ kind: "const", value }` —
  identical in every consumer (`evalDet`, `rateOf`, `sumInRate`, the Source
  amount path, the capacity clamps). It does **not** compose with `all` /
  `percent` / `range` / `dice` because a `flow` is never a compound (M2-2).

### M2-3.1 A resolved finite value follows the identical-literal rules

A **finite** value from a reference is normalised and executed by the **exact
same** rules as the identical numeric literal — the Parameter path adds **no**
clamp, floor, or special case of its own:

- `parseFlow`'s literal gate is `Number.isFinite(n) && n >= 0`. So a resolved
  `value >= 0` becomes `{ const, value }`; a resolved `value < 0` becomes
  `{ const, 1 }` — **because the literal `"-2"` also does** (`parseFlow("-2")`
  fails the digit regex ⇒ `const 1`).
- Consequence (M2-INV-3): `@p` with `p.value = v` produces a run **identical** to
  the same graph with `flow: "<v>"` written as a literal, for every finite `v`.

---

## M2-4. Timing — read once per step, before every phase

`step()` gains a **`modelVersion`** argument (default `1`). It threads to
`parseFlow`. When `modelVersion === 2`, the resolve pass (M2-3) runs **once**,
at the existing `flow`-parse point, **before Phase 0**. Therefore:

- Phase 0 (state), Phase 1 (push), Phase 2 (pull) all see the **same** resolved
  number for a given edge within a step — the same guarantee `R(t)` gives
  Registers (`SEMANTICS-M.md` §M3.2).
- A Parameter `value` is a run constant, so the resolved number is identical on
  **every** step of a run — no per-step drift, no dependence on node/edge
  iteration order (the reference reads only `nodes[i].data.value`, never `S`,
  `working`, or another edge). **I7 (iteration-order invariance) is preserved.**
- **`R(t)` and Register evaluation are unchanged.** No engine phase reads a
  Register; a `flow` reads a **Parameter**, which is a run-constant literal, so
  `SEMANTICS-M.md` §M3.2's "no engine phase reads a Register" still holds.
- **No new cycle class.** A `parameter`'s `value` is a literal that references
  nothing, and a `flow` reference reads that value and stops. The
  `flow → parameter` graph is depth-1 and always acyclic; nothing is added to
  the router-DAG cycle handling.

---

## M2-5. Persistence & compatibility

- `flow` is already a serialised string on a `resource` edge; a `@…` value is
  just a different string — no schema-shape change, no new field.
- The model version rides `GraphDoc.schema` (M2-1) and is therefore preserved
  verbatim through **Graph JSON**, **Share (`#g1=`)**, **Workspace**, and
  **autosave** (each embeds the GraphDoc). The Share fragment stays `#g1=`
  (`loop-share/1`); the inner `schema` is the model discriminator. Workspace
  stays `loop-workspace/1`.
- A reader returns the model version derived from the incoming `schema`; the
  app's Graph Store holds it, passes it to serialise / `step()`, and re-derives
  it on every load — identical before and after every round-trip
  (M2-INV-5).
- **`loop-revision`: no format change.** `flow` is already an `engineAffecting`
  edge field; a `@…` string digests as its literal text (like `2D6` / `25%`).
  `loop-expr/1`'s AST-canonical form is **not** applied to `flow`. `schema` is
  not projected (M2-INV-4). A rename / delete of a referenced Parameter does
  **not** auto-rewrite a `flow` — the hunk is independent; a dangling result is
  a runtime diagnostic, not a merge error.

---

## M2-6. Scope — what `loop-model/2` does **not** add

- `@` references in any field other than a `resource` edge's `flow` (`initial`,
  `capacity`, `activation`, a state edge's `expr` / `delay`, a gate's
  `distribution`).
- Compound / arithmetic `flow` expressions (`@p * 2`, `@p + @q`, `@p%`).
- `min` / `max` / clamp / comparison / conditional anywhere.
- Any change to `parameter` / `register` node shape, Register evaluation,
  `resourceType`, or the `loop-revision` / `loop-workspace` / `loop-share`
  formats.

---

## M2-7. Invariants (M2-INV)

| id | statement |
|---|---|
| **M2-INV-1** | **v1 identity.** For any document whose `schema` is `"loop-studio/graph"`: `parseFlow(raw, 1)` equals `loop-model/1` for every `raw` (a leading-`@` string ⇒ `const 1`, no diagnostic); no resolve pass runs; the deterministic run, the serialised bytes, and the `loop-revision` digest are **identical** to `loop-model/1`. |
| **M2-INV-2** | **Conservative extension.** A v2 document with **no** `param` / `paramBad` flow runs and digests **identically** to the same graph read as v1. There is no discontinuity at the boundary. |
| **M2-INV-3** | **Identical-literal.** For a finite `p.value = v`, an edge `flow: "@p"` yields a run identical to `flow: "<v>"` as a literal (M2-3.1) — including `v < 0` ⇒ `1`. |
| **M2-INV-4** | **`schema` is not content.** The `schema` string is not part of the `loop-revision` canonical projection or `fullContentDigest`. |
| **M2-INV-5** | **Round-trip version stability.** Export→Import, Share encode→decode, Workspace export→import, and autosave→reload all preserve the model version; the reloaded document's `schema` and the store's model version are unchanged. |
| **M2-INV-6** | **Fail-closed.** A reader that does not recognise `"loop-studio/graph/2"` rejects the document; it never runs a v2 document under v1 semantics. |
| **M2-INV-7** | **Determinism.** With `param` edges present (resolved, degraded-to-`0`, or negative-to-`1`), the same seed reproduces an identical trajectory, and a Monte-Carlo run reproduces byte-identical `series` / `endedRuns` / `final`. |
| **M2-INV-8** | **I7 preserved.** The resolve pass reads only `nodes[i].data.value`; the run result depends on node/edge order only through the existing `loop-model/1` / `SEMANTICS.md` priority rules. |
