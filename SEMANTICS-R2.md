# Project Revision / Proposal — model-layer extension

```
Spec ID: loop-revision/2
Status:  Frozen
```

**Frozen (2026-08-30, rev 2).** This document is the fixed target for the
implementation. A behavioural change after this is a new spec id in a new
document (`loop-revision/3`), exactly as with `loop-state/1 → loop-state/2`;
this file only takes typo / clarifying-prose fixes. §R2-12 records the settled
decisions R2-D1…R2-D5 (each Decided or Deferred).

Extends `SEMANTICS-R.md` (`loop-revision/1`, Frozen) so the canonical revision
projection, its digest, the three-way diff, and Apply also cover the
`loop-model/1` layer — `parameter` / `register` nodes and the advisory
`resourceType` tag on pools and `resource` edges. The *approach* is already
fixed in `SEMANTICS-M.md §M8` ("ratified into `SEMANTICS-R.md`'s successor when
`loop-revision/2` is authored"); this document is that successor and formalises
it — it introduces no new design beyond closing the §R2-12 boundaries.

**No behavioural change to `loop-revision/1`.** A graph that does not use the
model layer (§R2-1) projects, digests, diffs, and applies **byte-for-byte** as
it does under `loop-revision/1` today (R2-INV-2). Files, and only files, are
still the transport — no accounts, no server, no real-time sync. Every rule is
computable from the file in hand plus the open document.

`loop-workspace/1` is **not** bumped (§R2-8, R2-INV-8). `SEMANTICS.md`,
`SEMANTICS-B1.md` / `-B2.md`, `SEMANTICS-S.md` / `-S2.md`, `SEMANTICS-U.md` are
unaffected.

---

## R2-0. Scope

**Added over `loop-revision/1`:**

- a **wire-level version predicate** (§R2-1) that decides, per graph, whether a
  file's content is `loop-revision/1` or `loop-revision/2` — **inferred from the
  graph, never stored in a header**;
- the **extended canonical projection** (§R2-2): two new `FIELDS_BY_KIND` rows
  (`parameter`, `register`) and a trailing `resourceType` on `pool` and the
  `resource` edge, in a fixed field order;
- a third **field tag**, `advisory` (§R2-3), joining `engine` / `cosmetic`;
- the **conservative-extension guarantee** and the **golden vector** that proves
  it (§R2-4);
- the **validation order** — verify a v1 side with the v1 digest, *then* lift
  into the common v2 model — and **malformed-payload handling** (§R2-5);
- **advisory-field behaviour** in `dirty` / whole diff / whole + per-hunk Apply
  (§R2-6);
- **bidirectional v1 ↔ v2** compare & Apply rules, and the cross-version
  whole-Apply **loss report** (§R2-7);
- an explicit **"Workspace stays v1"** note (§R2-8).

**Not changed:** `SEMANTICS-R.md §R4.1` normalisation (finite numbers, `-0 → 0`,
no rounding, exact UTF-8 strings, missing-vs-explicit-default), §R4.3
`canonicalJson` (fixed key order, no whitespace, id-sorted arrays), §R4.4
`fullContentDigest` (SHA-256 of the canonical JSON), §R7 Apply mechanics
(always a new local revision, `parentId` = target, `appliedProposal`
provenance, one `simulationRev` bump, one undo entry), §R7A classification
(`exact` / `divergent` / `unknown ancestry`, only `exact` skips the whole-apply
confirmation), §R8 author-trust posture, §R10 Import routing, R-INV-1…R-INV-13.

**Out of scope** (unchanged from `loop-revision/1 §R0`, plus): making a
Parameter `value` an actual **engine input** (Gate condition / Source amount /
Converter ratio) — that is a later `loop-model` amendment and is what would
force `loop-workspace/2` (§R2-8); automatic merge/rebase; signing.

---

## R2-1. Version inference — the wire-level predicate

Formalises `SEMANTICS-M.md §M8.1` as the `loop-revision/2` contract.

**The predicate runs on the *normalised valid GraphDoc*, not on raw JSON.**
A reader first applies the existing `normalizeGraph()` pass **and**
`loop-model/1`'s defensive read (§M1.2 / §M2 / §M4.1: fill `value`/`expr`
defaults, drop an invalid `step` / `min`-`max` pair / over-long or empty
`unit` / unrecognised `format`, drop an empty-or-over-cap `resourceType`).
The predicate then reads that result. Consequences:

- a `resourceType` that was **removed during read** (empty after trim, or over
  the 64-byte cap) does **not**, by itself, make the doc v2 content — the field
  no longer exists on the normalised element;
- conversely, if a `parameter` / `register` node's shape is **structurally
  invalid** in a way the defensive read cannot seat (§R2-1.1), the reader
  returns **`payload-invalid`** *before* any v2 projection is attempted — the
  node is never silently promoted to v2 and then failed downstream.

**A normalised graph doc is `loop-revision/2` content iff ANY of:**

1. some `node.data.kind ∈ { "parameter", "register" }` (and the node passed the
   §R2-1.1 structural gate); **or**
2. some `node.data.kind === "pool"` whose `data.resourceType`, **after §M4.1
   normalisation**, is still present (non-empty); **or**
3. some edge with `data.kind === "resource"` whose `data.resourceType`, after
   §M4.1 normalisation, is still present.

Otherwise the doc is **`loop-revision/1` content**, even when produced or read
by a v0.6+ app.

- **Purely syntactic, post-normalisation.** The predicate reads only
  `data.kind` and the *normalised* `resourceType` string. It never runs the
  engine, never evaluates an `expr`, never inspects `SimState`.
- **Inferred from content, never stored.** No `project.version` /
  `project.schema` field exists or is read; a future `project` header field is
  **forbidden** from carrying the version. A reader recomputes the predicate on
  the normalised graph in hand — including, after an Apply, on the **result
  graph** (§R2-7, R2-D3): the new revision's version is whatever its own
  resulting content implies.
- **Per side.** A **proposal** file carries two graphs — the proposed content
  (top-level `nodes` / `edges`) and `project.base.content`. The predicate is
  run on **each independently** (§R2-5); the two may disagree (a v2-capable
  author adding the model layer to a v1 base is the common case).
- **Per graph, not per element.** One valid `parameter` node makes the **whole
  doc** v2 content; the shared v1 elements are still projected exactly as v1
  (§R2-4).

### R2-1.1 The structural gate for `parameter` / `register`

Before the predicate, a node whose `data.kind` is `parameter` or `register` is
checked for a **seatable shape**. Read-time *fillable* problems are fine and
leave the node in place; *unseatable* problems make the whole `project` payload
`payload-invalid` (graph still loads, `project` dropped + warning — R-INV-10).

| condition | outcome |
|---|---|
| `value` **absent** (key missing or `null`) | **fillable** — set to `0`, notice `PARAM_VALUE_FIXED`; node kept |
| `value` present and **not a JSON number** (object, array, string, boolean) | **unseatable** → `payload-invalid` |
| `value` present, a number, but **non-finite** (`NaN` / `±Infinity` — only reachable via a hand-edited file; JSON has no such literal) | **unseatable** → `payload-invalid` (a non-finite number in projected content is invalid per §R4.1) |
| `expr` missing / `null` | **fillable** — set to `"0"`; node kept |
| `expr` present and **not a string** | **unseatable** → `payload-invalid` |
| `expr` present, a string, but **not parseable** as `loop-expr/1` (a syntax error — `EXPR_*`) | **unseatable** → `payload-invalid`. §M2 mandates `expr` be *stored* in §X8 canonical form, so an unparseable `expr` is a malformed file, not a runtime condition. |
| `expr` parseable but **references a missing / wrong-kind id** (a dangling `@id`) | **kept** — the reference is syntactically valid; the Register is `invalid` at eval time (`M_REG_UNKNOWN_REF` / `M_REG_WRONG_KIND`), which is non-fatal (§M6.1, §M5). Projected in §X8 canonical form with the `@id` preserved. |
| `label` present and not a string, or `data` not an object | **unseatable** → `payload-invalid` (same as any malformed node today) |

An **unknown** `data.kind` (neither a v1 kind nor `parameter` / `register`) is
handled by §R2-5.1 (graph-only + warning; no projection guessed).

---

## R2-2. The extended canonical projection

`loop-revision/2` extends `SEMANTICS-R.md §R4.2`'s frozen `FIELDS_BY_KIND` /
`EDGE_FIELDS_BY_KIND`. Nothing else in §R4 moves.

### R2-2.1 New node rows — exact field order

| kind | `data` fields, **in this order** |
|---|---|
| `parameter` | `kind`, `label`, `value`, `min`, `max`, `step`, `unit` |
| `register` | `kind`, `label`, `expr`, `unit`, `format` |

Presence (all after the read-time normalisation of `SEMANTICS-M.md §M1.2` /
`§M2`, applied **before** projection):

| field | rule | projected? |
|---|---|---|
| `value` | finite (`§R4.1`: `-0 → 0`, **no rounding**); default `0` filled on read | **always** — even when outside `[min, max]` (projected **as stored**, never clamped) |
| `min`, `max` | only as a **coherent pair**: both finite and `min ≤ max` | both, or neither |
| `step` | finite and `> 0` | when valid; else **absent** |
| `unit` | non-empty after trim + NFC + ≤ `PARAM_UNIT_MAX_BYTES` (24) truncation | when non-empty; else **absent** |
| `expr` | a `loop-expr/1` string in **§X8 canonical form** (AST re-serialisation, `@id` / `@{id}` refs); default `"0"` | **always** |
| `format` | one of `int` / `float` / `percent` | when recognised; else **absent** |

A field dropped at read time is **absent** from the projection — **never**
`null`, **never** `""`. A dropped field therefore also never appears in a diff
hunk.

### R2-2.2 Extended existing rows — trailing `resourceType`

| kind | `data` fields, in order |
|---|---|
| `pool` | `kind`, `label`, `activation`, `initial`, `capacity`, `mode`, **`resourceType`** |
| `resource` edge | `kind`, `flow`, **`resourceType`** |

`resourceType` is emitted **only when its normalised value (§M4.1) is
non-empty**, as the **last** key of the object. An untyped element omits the key
entirely — it does not emit `"resourceType": ""` or `null`. The projected value
is the normalised (trim + NFC) form; case is preserved (`"Gold"` ≠ `"gold"`).

### R2-2.3 Everything else in §R4 is unchanged

- `node(n)` / `edge(e)` shape, `position` (`norm`, no rounding), `sourceHandle`
  / `targetHandle` post-normalize, `rrc(...)` — as `SEMANTICS-R.md §R4.2`.
- `nodes` sorted by `n.id` ascending (UTF-16 code-unit order), `edges` by
  `e.id`; `recommendedRunConfig` key omitted when empty.
- `canonicalJson` — fixed key order (the field tables above define it; the new
  keys slot in at the positions shown), no whitespace, `String(n)` numbers.
- `fullContentDigest(doc)` = `SHA-256(UTF-8(canonicalJson(canonicalContent(doc))))`,
  lowercase hex. Same primitive, same `crypto.subtle`-or-pure-JS fallback
  (`§R4.4`); a build with neither still degrades the `project` reader to
  graph-only + warning.

There is **one** `canonicalContent`. Given a v1-content graph it emits the v1
bytes (R2-INV-2); given a v2-content graph it emits the v1 bytes for the shared
elements plus the rows above.

---

## R2-3. Field tags — `engine` / `cosmetic` / `advisory`

`loop-revision/1`'s `fieldTag` returns `engine | cosmetic`. `loop-revision/2`
adds **`advisory`**.

| tag | meaning | in projection & diff? | sets `summary.engineAffecting`? |
|---|---|---|---|
| `engine` | changes what the model computes or displays **as a value** | yes | **yes** |
| `cosmetic` | pure presentation (`label`, `position`) | yes | no |
| `advisory` | authored content that changes **no** value — a tuning hint or a type tag | **yes** | no |

Assignments for the new / extended fields (existing v1 fields keep their
`SEMANTICS-R.md §R5.2` tags):

| field | tag |
|---|---|
| `parameter.value` | `engine` |
| `parameter.min` / `.max` / `.step` / `.unit` | `advisory` |
| `register.expr` | `engine` |
| `register.unit` / `.format` | `advisory` |
| `pool.resourceType`, `resource`-edge `.resourceType` | `advisory` |

- An **added** or **removed** `parameter` / `register` node is engine-affecting
  (it carries an `engine`-tagged `value` / `expr`); an element that changes
  **only** `resourceType` is not.
- `RevisionDiff.summary` gains **`advisoryAffecting: <bool>`** — true when any
  hunk is `advisory`-tagged — so the Review UI can label a change *"tuning
  hint"* / *"type tag"* distinctly from an `engine` change or a `cosmetic`
  rename. (Field name open — §R2-12 R2-D1.)
- `summary.empty` is still "no `added` / `removed` / `changed` anywhere".
  An advisory-only change is **not** empty.

---

## R2-4. Conservative extension, and the golden vector

**R2-INV-2 — conservative extension.** Run `canonicalContent` over a graph that
**fails** the §R2-1 predicate and it emits output **byte-identical** to the
`loop-revision/1` projection: no `parameter` / `register` node ⇒ no new rows;
no non-empty `resourceType` ⇒ the trailing key omitted. Hence a
`loop-revision/1` graph has the **same** `fullContentDigest` under either
reading — there is **no discontinuity** at the predicate boundary.

**The golden vector** (committed, drift-guarded — §R2-13 A1/A2):

- **Fixture `G0`** — a graph exercising every v1 kind (pool with finite
  `capacity`, pool with `null` capacity, source, drain, gate with a
  `distribution`, converter, end), at least one `resource` edge and one `state`
  edge with a non-default `delay`, and a non-empty `recommendedRunConfig`.
  `G0` uses **no** model-layer field, so §R2-1 → v1 content.
  - Assert `canonicalJson(canonicalContent(G0))` is **byte-equal** to the
    stored `loop-revision/1` oracle string.
  - Assert `fullContentDigest(G0)` equals the stored v1 digest.
- **Fixture `G1`** — `G0` plus one `parameter`, one `register` (its `expr`
  references the `parameter` and a pool), one pool given `resourceType: "Gold"`,
  and one `resource` edge given `resourceType: "Gold"`. §R2-1 → v2 content.
  - Assert the projection of every `G0`-shared element in `canonicalContent(G1)`
    is **byte-identical** to its projection in `canonicalContent(G0)` (the model
    layer adds rows, it does not perturb the shared ones).
  - Assert the new rows appear in the fixed field order of §R2-2.
  - Assert that deleting the model-layer elements from `G1` reproduces exactly
    `fullContentDigest(G0)`.
- Both fixtures re-serialised with keys reordered and whitespace injected ⇒
  **unchanged** digests (`SEMANTICS-R.md` R-INV-4 carried forward).

Fixtures live under `examples/revision-v2/` with an `oracle.json`; a unit test
drift-guards them the way `test/revision-fixture.test.ts` guards the
`loop-revision/1` fixture. (Location open — §R2-12 R2-D2.)

---

## R2-5. Validation order — v1 digest verify, then lift

Formalises `SEMANTICS-M.md §M8.1c` (M-INV-11). A reader given a revision or a
proposal file MUST, **before** treating any `project` payload as trusted:

1. **Per side, run the §R2-1 predicate on that side's own graph.**
   - A **revision** file has one side: its top-level `nodes` / `edges`.
   - A **proposal** file has two: the top-level proposed graph, **and**
     `project.base.content`. Classify each independently.
2. **Verify each side's digest against the projection the predicate selected
   for that side:**
   - side is **v1 content** → verify its stored digest
     (`project.contentDigest` for a revision's own graph; `base.contentDigest`
     for `project.base.content`; the session `baselineDigest` for the open doc)
     against the **`loop-revision/1` projection** (`SEMANTICS-R.md §R4`) — the
     digest the file's author (possibly a v0.5.x app) actually computed. **Only
     after it verifies**, lift the content into the common v2 compare model; by
     R2-INV-2 this reproduces the identical bytes.
   - side is **v2 content** → verify against the **v2 projection** directly.
3. **Then** classify / diff / apply with **both sides expressed in the v2
   projection** (§R2-7).

**Forbidden:** verifying a side that is v1 content **directly with the v2
digest**. Any latent gap in R2-INV-2 would misclassify a valid v1 file as a
tampered payload (`SEMANTICS-R.md` R-INV-6). Selecting the projection per side
by the predicate makes R2-INV-2 a *verified* property at read time, not an
*assumed* one.

### R2-5.1 Malformed / ambiguous payloads

| situation | handling |
|---|---|
| digest present but ≠ the projection the predicate selected for that side | `project` payload **corrupt** (R-INV-6 / R-INV-10): the graph (and any `workspace`) still loads; `project` is **dropped + warning**; the file is **never** Reviewed or Applied as a trusted revision / proposal. |
| `base.content` trips the v2 predicate and `base.contentDigest` matches the **v2** projection | **not** corrupt — a v2-capable app authored the base. Verify v2, proceed. |
| `base.content` is v1 content and `base.contentDigest` matches the **v1** projection | normal path — verify v1, lift, proceed. |
| a `parameter` / `register` node that fails the §R2-1.1 **structural gate** (non-number `value`, non-finite `value`, non-string / unparseable `expr`, non-object `data`) | **`payload-invalid`** — returned **before** any v2 projection is attempted (§R2-1). Drop `project` + warn; graph still loads (R-INV-10). The doc is **not** classified as v2-then-failed. |
| an unknown `node.data.kind` (not a v1 kind, not `parameter` / `register`) | this app cannot compute a projection for the file — **do not guess** and **do not** silently carry it into a digest. Degrade the `project` reader to **graph-only + warning**; the graph still loads. (R2-D5.) |
| an **unknown `data` key** on an otherwise-known kind | excluded from the canonical projection exactly as `SEMANTICS-R.md §R4.2` already excludes any unlisted `data` key — it is not in the digest and no hunk carries it; `serialize()` still round-trips it in memory. (R2-D5.) |
| the file's own graph is v2 content but the app is a **v1-only** build | already covered by `§R4.4` — the `project` reader degrades to graph-only + warning; `loop-revision/2` adds nothing. |
| `project.contentDigest` **absent** (it is optional, `SEMANTICS-R.md §R1` / R10.4) | unchanged: no integrity check to run on the file's own graph; the baseline digest is `fullContentDigest` of the loaded graph under the predicate-selected projection. |

No malformed `project` payload can stop the graph — or a valid `workspace` —
from importing (R-INV-10, carried forward as R2-INV-9).

---

## R2-6. Advisory fields in `dirty`, diff, and Apply

`advisory` fields are **full revision content**. The only thing that separates
them from `engine` fields is that they do not set `summary.engineAffecting`.

### R2-6.1 `dirty`

Mechanism is unchanged — `dirty = fullContentDigest(current) !== baselineDigest`
(`SEMANTICS-R.md §R2`). Because `min` / `max` / `step` / `unit` / `format` /
`resourceType` are **in** the projection (§R2-2), editing one flips `dirty`,
and the next `Export → Project revision` mints a new `revisionId` with
`parentId` = the prior one — exactly as editing `label` does today.

### R2-6.2 Whole diff (`computeRevisionDiff`)

- An advisory-field change on an element present on both sides is a `changed`
  field hunk `{ field, base, proposed }` tagged **`advisory`**.
- An added / removed `parameter` / `register` is an `added` / `removed` element;
  its per-field tags make it engine-affecting via its `value` / `expr`.
- An element changing **only** `resourceType` is `advisory`-tagged and does
  **not** set `engineAffecting`; it does set `advisoryAffecting`.

### R2-6.3 Whole-proposal Apply

Adopts the proposed graph **verbatim** (`SEMANTICS-R.md §R7.2`), advisory
fields included. Classification (`exact` / `divergent` / `unknown ancestry`)
consumes `nConf` from the three-way check (§R7A.3) computed over the **v2
projection**, so a conflict on an advisory field (e.g. `min` changed to
different values on both sides) counts toward `nConf` and can make the class
`divergent`. The confirmation policy is unchanged: only `exact` skips it.

When the target is v2 content and the proposal's proposed graph does **not**
carry the same model-layer elements, a whole Apply removes them; the
confirmation MUST carry the §R2-7.1 loss report.

### R2-6.4 Per-hunk (selective) Apply

- An advisory-field hunk is **independently selectable** and applies
  field-level like any `change` hunk.
- A conflict on an advisory field surfaces `base` / `proposed` / `yours` and is
  resolved one item at a time (R-INV-13); nothing is auto-resolved. Advisory
  conflicts are in `nConf` (consistent with the Slice-2 rule that a structural
  `blockedBy` conflict feeds `nConf`).
- An advisory-only selective Apply is still **one** new revision, **one** undo
  entry, and `simulationRev` **+1** — Apply's atomicity (R-INV-8) is **not**
  conditional on anything engine-affecting having changed.
- The applied result still passes the full-GraphDoc `validateResultGraph`
  check from Slice 2 (kind / field agreement, endpoint existence, finite
  numbers, normalise-idempotence). An invalid selection is blocked before any
  mutation with a specific reason list.
- A UI **may** offer an *"advisory changes only"* quick-select bucket; the
  applied result must still pass `validateResultGraph`. (Ships-with-slice vs
  later — §R2-12 R2-D3.)

---

## R2-7. Bidirectional v1 ↔ v2 compare & Apply

After the per-side verification of §R2-5, **both sides are expressed in the v2
projection** and classification / three-way diff / Apply run exactly as
`SEMANTICS-R.md §R7 / §R7A` — there is **no "refuse" branch** for a version
mismatch. The only refusal remains the `§R7A.1` different-`projectId` gate.

| # | proposal base | proposal proposed | target | behaviour |
|---|---|---|---|---|
| 1 | v1 | v1 | v1 | identical to `loop-revision/1` today. v2 projection of every side ≡ v1 projection ≡ same bytes / digest (R2-INV-2). |
| 2 | v1 | v1 | **v2** | the target carries a model layer the proposal does not mention. The diff shows the shared part as a normal v1↔v1 diff; the target's `parameter` / `register` / typed elements are **target-only** (present in target, absent in base and proposed). **Whole-proposal Apply adopts the proposed graph verbatim and therefore drops the target's model layer** — allowed only behind the non-`exact` whole-apply confirmation (`§R7A.4`), which MUST carry the computed **§R2-7.1 loss report**. **Per-hunk Apply never removes an unmentioned target element** (`§R7.2`: rejected/absent hunks leave the target as-is), so a selective Apply preserves the target's model layer byte-for-byte. |
| 3 | v1 | **v2** | v1 | the proposal *adds* the model layer. `base.content` is v1 (verify v1); the proposed side is v2 (verify v2). The diff shows `add` hunks — `engine`-tagged for a `parameter.value` / `register.expr`, `advisory`-tagged for a `resourceType`. Whole Apply adopts them; per-hunk Apply adds only the selected ones. A selected `register` `add` whose `expr` references an id absent from the resulting target is **applied anyway** and the model marks it `invalid` (`M_REG_UNKNOWN_REF`, `SEMANTICS-M.md §M5`) — non-fatal, the run is not blocked, the Review / Inspector shows the `M_REG_*` code. |
| 4 | **v2** | **v2** | **v2** | full three-way over the v2 projection; `engine` and `advisory` fields alike are diffable and feed `nConf`. |

In every combo the compare model is the single v2 projection; a v1 side is "v2
with an empty model layer", and its v2 digest equals its v1 digest (R2-INV-2).

### R2-7.1 Cross-version whole-Apply loss report

Before a **whole-proposal Apply** whose **result would drop model-layer content
that exists on the target**, the reader computes — from the v2 projections of
the target and the proposed graph — and the confirmation dialog (`§R7A.4`)
displays:

- **`paramRegistersRemoved`** — the count of `data.kind ∈ { parameter, register }`
  nodes present in the target and **absent** from the proposed graph (by `id`);
- **`resourceTypesRemoved`** — the count of `pool` / `resource`-edge elements
  whose target projection carries a non-empty `resourceType` and whose proposed
  projection (same `id`) carries **none** (removed) **or a different value**
  (overwritten) — reported as *removed* and *changed* sub-counts;
- a fixed warning line: *"This proposal does not include the model layer. Applying
  the whole proposal removes N Parameters/Registers and M resource-type tags from
  your graph that the proposal doesn't carry. Undo reverts it."* (exact copy is
  an implementation string; the three quantities above are mandatory).

If **both** counts are `0` the report is omitted (the whole Apply still shows the
ordinary non-`exact` confirmation). The counts are a **pure function** of the two
v2 projections — deterministic, no engine, no ordering dependence. A **per-hunk
Apply** never triggers this report: it cannot remove an element that has no
selected hunk (§R2-INV-7).

Restates `SEMANTICS-M.md §M8.2`. A `loop-workspace/1` file embeds the GraphDoc
**verbatim**, so `parameter` / `register` / `resourceType` ride along with **no
new Workspace field**. `loop-workspace/2` is **not** authored by
`loop-revision/2`:

- **`SimState`** — Registers store nothing (recomputed on demand,
  `SEMANTICS-M.md §M3`); Parameters are graph data, not `SimState`; Resource
  Type is inert. No `SimState` shape change; the verified sim-snapshot is
  byte-unchanged.
- **Restore contract** — on Workspace load the GraphDoc (including the model
  layer) loads normally; Registers are recomputed from the restored snapshot,
  never stored or restored. No restore-contract change.
- **Semantic digest (`SEMANTICS-W.md §W3.1`)** — it binds a saved Monte-Carlo
  result to the graph and must cover everything that changes what the
  simulation computes. In `loop-model/1` **no engine phase reads a Parameter or
  a Register**, so a `parameter.value` change alters no MC result and need not
  enter the semantic digest for `loop-model/1`. If §W3.1 is computed as
  `fullContentDigest` of the canonical projection, that projection is simply the
  v1 **or** v2 projection per the §R2-1 predicate — a **clarifying erratum** to
  `loop-workspace/1`, not a new spec version. (Publish-as-note vs fold-in —
  §R2-12 R2-D5.)
- **Autosave** — an autosaved doc may hold a `project` header beside a
  `workspace` payload; autosave still **never** persists `base.content` or the
  `workspace` payload (`SEMANTICS-R.md §R2.1`, unchanged).

`loop-workspace/2` is **deferred to the engine-expression amendment**: when a
Parameter `value` becomes an actual engine input, *then* it must enter the
semantic digest and the sim-snapshot / restore story is revisited.

---

## R2-INV. Invariants

| # | invariant |
|---|---|
| **R2-INV-1** | The §R2-1 version predicate is purely syntactic (`data.kind` + normalised `resourceType` only) and runs on the **normalised valid GraphDoc** (after `normalizeGraph()` + the `loop-model/1` defensive read), **never on raw JSON** and **never on a stored header**. It is evaluated **per graph** and **per side** of a proposal. A field removed during normalisation (e.g. an empty / over-cap `resourceType`) does not make a doc v2; a `parameter` / `register` that fails the §R2-1.1 structural gate makes the `project` payload `payload-invalid` **before** any v2 projection. |
| **R2-INV-2** | Conservative extension: for any normalised graph failing §R2-1, `canonicalContent` emits **byte-identical** output to the `loop-revision/1` projection, so `fullContentDigest` is identical under either reading. The §R2-4 golden vector proves it at test time, and its v1 oracle digest is **pinned to the value the shipped `loop-revision/1` implementation produces** (R2-D2). |
| **R2-INV-3** | Validation order: the projection is chosen **per side** by the predicate; a v1 side's stored digest is verified against the **v1** projection **before** the content is lifted into the common v2 model. Verifying a v1 side directly with the v2 digest is **forbidden**. |
| **R2-INV-4** | An `advisory` field is full revision content — editing it flips `dirty`, mints a new `revisionId` on export, produces its own diff hunk, and its conflicts feed `nConf` — but it **never** sets `summary.engineAffecting`. |
| **R2-INV-5** | Apply atomicity (`SEMANTICS-R.md` R-INV-8) holds regardless of the `engine` / `advisory` / `cosmetic` mix of what changed: one `loadDoc()`, one `simulationRev` bump, paused at step 0, one undo entry, no file written. An advisory-only Apply is no exception. |
| **R2-INV-6** | No version-mismatch "refuse" branch. The only apply-time refusal is the `§R7A.1` different-`projectId` gate. Every same-project v1 / v2 combination is compared under the single common v2 projection. |
| **R2-INV-7** | A whole-proposal Apply that would drop a **target-only** model layer is permitted **only** behind the non-`exact` whole-apply confirmation (`§R7A.4`), which MUST carry the computed **§R2-7.1 loss report** — `paramRegistersRemoved`, `resourceTypesRemoved` (removed + changed), and the fixed warning line. A per-hunk Apply never adds, removes, or edits a target element that has no selected hunk, and so never triggers the report. |
| **R2-INV-8** | `loop-workspace/1` is not bumped: no `SimState` change, no restore-contract change; its §W3.1 digest, if projection-based, follows the §R2-1 predicate as an erratum. `loop-workspace/2` waits for a Parameter `value` to become an engine input. |
| **R2-INV-9** | No malformed, unknown-kind, non-finite, or version-skewed `project` payload can prevent the graph (or a valid `workspace`) from importing (`SEMANTICS-R.md` R-INV-10 carried forward); such a payload is dropped with a warning and never Reviewed or Applied. |
| **R2-INV-10** | **v2 → v1 results are allowed.** Apply never refuses on a version basis (R2-INV-6). The resulting revision's own version is **re-inferred from the result graph** (§R2-1) — a selective Apply that leaves the result with no model layer produces `loop-revision/1` content (its `fullContentDigest` computed under the v1 projection, identical by R2-INV-2); one that introduces or keeps a model layer produces v2 content. The result is a normal new revision either way (`SEMANTICS-R.md §R7.1`). |
| **R2-INV-11** | An **unknown `data.kind`** (not a v1 kind, not `parameter` / `register`) is never projected, digested, or hunk-carried: the `project` reader degrades to **graph-only + warning** and the graph still loads. An **unknown `data` key** on a known kind is excluded from the canonical projection exactly as `SEMANTICS-R.md §R4.2` already excludes any unlisted key. |

---

## R2-12. Decisions — settled at freeze

Every item is **Decided** or **Deferred — out of `loop-revision/2`**. Nothing
here is left as a leaning.

| # | question | resolution |
|---|---|---|
| **R2-D1** | `summary` sub-count for advisory hunks | **Decided.** `RevisionDiff.summary` gains **`advisoryAffecting: boolean`** — `true` iff any hunk is `advisory`-tagged. It is **separate from** `engineAffecting`: an advisory-only conflict feeds `nConf` (and can push the class to `divergent`) but **never** sets `engineAffecting`. No wire / digest effect — `summary` is a computed view, not projected content. |
| **R2-D2** | golden-vector fixture location + the v1 oracle digest | **Decided.** Fixtures at **`examples/revision-v2/`** (`G0.json`, `G1.json`, `oracle.json`); drift-guard at **`test/revision-v2-fixture.test.ts`**, mirroring `test/revision-fixture.test.ts`. The `G0` oracle string **and** its `fullContentDigest` are **pinned to the values the shipped `loop-revision/1` implementation produces** for `G0` (captured once from that code path, not recomputed by the v2 projection); the test asserts the v2 projection reproduces them byte-for-byte (R2-INV-2). |
| **R2-D3** | an *"advisory changes only"* quick-select bucket in Review | **Deferred — out of `loop-revision/2`.** The spec permits such a bucket; whether it ships with the model-language slice or later is an implementation/UX call. Any result it produces MUST still pass `validateResultGraph` and the §R2-6.4 atomicity rules. |
| **R2-D4** | Review-UI copy for a whole Apply that replaces a target-only model layer | **Decided** (contract) **+ Deferred** (exact string). The confirmation MUST compute and show the **§R2-7.1 loss report** — `paramRegistersRemoved`, `resourceTypesRemoved` (removed + changed sub-counts), and a warning line stating the model layer is not in the proposal and will be removed. The precise wording of that line is an implementation string; the three quantities and the warning are mandatory. |
| **R2-D5** | unknown future `NodeKind` / `data` field — preserve or reject; and where the §W3.1 clarification lands | **Decided.** *(a)* An **unknown `data.kind`** is **rejected as trusted revision content**: no projection is guessed, nothing is carried into a digest or a hunk, the `project` reader degrades to **graph-only + warning**, the graph still loads (R2-INV-11). *(b)* An **unknown `data` key** on a known kind is **silently excluded** from the canonical projection — identical to `SEMANTICS-R.md §R4.2`'s existing treatment of any unlisted key — so it never enters the digest or a diff, while `serialize()` still round-trips it in memory. *(c)* The `loop-workspace/1 §W3.1` "projection follows the §R2-1 predicate" clarification is published as a **standalone `loop-workspace/1` erratum note**, not folded into this spec; it has no behavioural effect either way. |

**Also settled inline** (see the cited invariants): version inference reads
**normalised content only, never a stored header** (R2-INV-1); **v2 → v1 Apply
results are allowed** and the new revision's version is re-inferred from the
**result graph** (R2-INV-10); an **advisory-only** conflict is in `nConf` but
not `engineAffecting` (R2-INV-4, R2-D1).

Every other rule in this document is a formalisation of `SEMANTICS-M.md §M8`
(already fixed) and is **not** reopened here.

---

## R2-13. Acceptance vectors (test basis — filled on implementation)

1. **Golden vector, v1 fixture** — `canonicalJson(canonicalContent(G0))` is
   byte-equal to the stored v1 oracle; `fullContentDigest(G0)` equals the
   stored v1 digest; key-reorder + whitespace injection leave both unchanged.
2. **Golden vector, v2 fixture** — every `G0`-shared element projects
   byte-identically inside `canonicalContent(G1)`; the new `parameter` /
   `register` / `resourceType` rows appear in the §R2-2 field order; deleting
   the model layer from `G1` reproduces `fullContentDigest(G0)`.
3. **Read-time drops** — a `parameter` with `step: 0`, `min: 5`, `max: 1`,
   `unit: "   "`, `value: 7` projects as exactly `{ kind, label, value: 7 }`
   (no `null`, no `""`); its digest matches the hand-computed oracle; an
   Inspector notice records each dropped hint.
4. **Advisory `dirty`** — open a non-dirty v2 revision, change a pool's
   `resourceType` from `"Gold"` to `"gold"` ⇒ `dirty === true`, one `changed`
   hunk tagged `advisory`, `summary.engineAffecting === false`,
   `summary.advisoryAffecting === true`; `Export → Project revision` mints a new
   `revisionId`.
5. **Advisory conflict** — base `min: 0`, target `min: 2`, proposed `min: 5` ⇒
   the per-hunk view shows `base` / `proposed` / `yours`, `nConf ≥ 1`, class
   `divergent`; resolving each way applies the chosen value and no other field.
6. **v1 proposal → v2 target, whole Apply** — target has a `register`; the
   non-`exact` confirmation fires and names the model-layer loss; after Apply
   the `register` is gone; one undo restores it (graph **and** project header).
7. **v1 proposal → v2 target, per-hunk Apply** — same setup; selecting only an
   unrelated node hunk leaves the target's `register` byte-identical in the
   result.
8. **v2 proposal adds a dangling `register`** — the proposed `register.expr`
   references a missing id; selective Apply of that `add` succeeds, the model
   marks it `invalid` (`M_REG_UNKNOWN_REF`), Step / Play / Reset stay
   functional, and the Review / Inspector shows the `M_REG_*` code.
9. **Malformed model content** — `project.base.content` contains
   `data.kind: "widget"` ⇒ `project` dropped + warning, the graph still
   imports, no Review offered.
10. **Forbidden-path guard** — for a legitimate v1 proposal file, the verify
    path computes the v1 digest for a v1 side and never the v2 digest first
    (asserted by instrumentation or a code-review vector).
11. **Conservative extension under Apply** — applying a v1 proposal to a v1
    target through the v2 code path yields the identical bytes / `revisionId`
    lineage as the `loop-revision/1` implementation (regression parity).
12. **Structural gate** — a proposal whose `base.content` holds a `parameter`
    with `value: {}` (or `expr: 42`) is rejected as **`payload-invalid`**
    *before* any v2 projection; the graph still imports; no Review is offered.
13. **Removed `resourceType` is not a version bump** — a v2 pool whose
    `resourceType` is edited to `"   "` (whitespace) normalises to untyped; if
    it was the graph's only model-layer marker the graph is now `loop-revision/1`
    content and its `fullContentDigest` equals the v1-projection value.
14. **Loss report** — a v1 proposal applied whole to a target with 2 Registers
    and 3 typed elements surfaces `paramRegistersRemoved: 2`,
    `resourceTypesRemoved` summing to 3, and the warning line, before any change.
15. **v2 → v1 result** — selectively applying only a non-model hunk from a v2
    proposal onto a v1 target yields `loop-revision/1` content; the new
    revision's `fullContentDigest` is the v1-projection value and a later
    `Make a proposal` from it produces a v1 `base`.

---

## R2-14. Order this feeds into

1. `docs/visual-language.md` — Parameter / Register appearance (**merged**,
   PR #35).
2. `loop-expr/1` + `loop-model/1` — **Frozen** (`SEMANTICS-X.md`,
   `SEMANTICS-M.md`).
3. **This document — `loop-revision/2`** — **Frozen** (rev 2); merged via
   PR #36.
4. Verify the merge-commit CI for both pre-implementation PRs, then
   `chore/open-0.6.0-dev`.
5. Implementation slices: **model language → Canvas Visual Refresh**. Scenario
   Compare is **out of the confirmed v0.6.0 scope** — it needs its own
   spec/design PR and a separate go decision after the Refresh.
