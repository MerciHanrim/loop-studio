# Project Revision / Proposal — data-import provenance extension

```
Spec ID: loop-revision/8
Status:  Frozen
```

**Frozen (2026-09-13).** The fixed storage-foundation target for Phase 1A of
`docs/data-import.md` (the spreadsheet snapshot import contract, approved
after 6 review rounds). A behavioural change after this is a new spec id in a
new document, exactly as `loop-revision/1 → /2 → /3 → /4 → /5 → /6`. (No
`loop-revision/7` exists — a `@parameter` activator SideVersion was proposed
in `docs/parameter-activator.md` and found unnecessary once
`projectEdge()`'s activator `expr` field was checked directly against the
code: it already carries no `modelLayer` gate, so no new SideVersion was
ever needed there. `8` is the correct next number, not a gap.)

Extends `SEMANTICS-R5.md` (`loop-revision/5`, `frames`, Frozen) AND
`SEMANTICS-R6.md` (`loop-revision/6`, CSU `timing`/`when`, Frozen)
simultaneously, because data-import provenance is **both shapes at once**:
a new top-level graph-level array (like `frames`) **and** new trailing
per-node fields whose mere presence — not validity — must be visible to the
version predicate (like CSU's `timing`/`when`). `loop-revision/4`
(`loop-model/2`) and `loop-revision/5`/`/6` are orthogonal and untouched.

**No behavioural change to `loop-revision/1` … `/6`.** A graph with no
`dataImports` array and no `parameter` node carrying any of the four
provenance keys has a canonical projection, digest, diff, and Apply
**byte-identical** to before this document (R8-INV-2). Files, and only
files, are the transport.

**`loop-workspace/1` is NOT bumped** — like `frames` (§R5-8), unlike
`timing`/`when` (§R6-7): provenance affects nothing `SimState` computes, so
the semantic digest backing the Monte-Carlo stale-result check is untouched
(§R8-7).

---

## R8-0. Scope

**Added over `loop-revision/2` / `/3` / `/4` / `/5` / `/6`:**

- a **dual wire-level version predicate** (§R8-1): a graph's content is
  `loop-revision/8` iff ANY `parameter` node's RAW, pre-`readParameterData`
  data carries any of four provenance keys (any value — recognised or not,
  even a wrong TYPE that `readParameterData` will go on to drop from the
  projection), **or** the graph's RAW `dataImports` value carries ≥ 1 entry
  that at least attempts to be a table record (whether or not
  `readDataImports` goes on to keep it) — either condition alone is
  sufficient, checked independently of each other and of every earlier
  predicate. Classification reads RAW content; the CANONICAL PROJECTION
  (§R8-2) is a separate, later step that runs on defensively-read,
  normalised content and DOES drop an invalid value — see §R8-1's own
  correction note for why these must not be conflated;
- a **new top-level `CanonicalContent` key**, `dataImports` (§R8-2.1),
  mirroring `frames`' own §R5-2.1 shape exactly (a trailing array, file
  order, present only when non-empty);
- **four new trailing fields on `MODEL_NODE_FIELDS.parameter`**
  (§R8-2.2) — `sourceTableId`, `sourceKey`, `sourceColumnId`,
  `labelAutoComposed` — each emitted **verbatim, independently of the other
  three,** once it passes `readParameterData`'s OWN per-field validation
  (a basic type / length check — §DI-D8) — mirroring CSU's §R6-2.1
  "verbatim, not re-validated" rule for CROSS-FIELD coherence (no
  all-four-or-none requirement, unlike `min`/`max`'s coherent-pair-or-drop
  rule), but NOT for per-field type/length checking, which CSU's free-form
  `timing`/`when` strings don't need and these structured ids do;
- a **new field tag, `provenance`** (§R8-3) — neither `cosmetic` (`frames`,
  `route`/`waypoints`) nor `engine` (`timing`/`when`, `value`, `expr`,
  `flow`) nor `advisory` (`min`/`max`/`step`/`unit`/`resourceType`): real
  document content that changes nothing the engine computes, but changes the
  MEANING of a future refresh (Phase 2) — a materially different claim than
  a purely presentational overlay, so it earns its own category rather than
  being folded into `cosmetic`;
- the **conservative-extension guarantee** and its **golden vector**
  (§R8-4): a ≤ v6-content graph's v8 digest equals its ≤ v6 digest;
- the **validation order** — verify a v1 … v6 side with its own projection,
  then lift into the common v8 model (§R8-5);
- the **graph-level `dataImports` hunk** (§R8-6) — one atomic
  `provenance`-tagged unit in the whole diff and the three-way plan,
  mirroring `frames`' §R5-6 shape exactly (not CSU's ordinary per-field
  rule, since `dataImports` is graph-level, not per-edge);
- per-field `sourceTableId`/`sourceKey`/`sourceColumnId`/`labelAutoComposed`
  changes on a `parameter` node follow the **ordinary** `change`-hunk rule
  (no `frames`-style carve-out for THESE — they are per-node fields, not a
  graph-level array) — a divergent value is a `conflict` and feeds `nConf`,
  same mechanics as an `engine` field, just tagged `provenance` instead;
- an explicit **`loop-workspace/1` is NOT bumped** note (§R8-7);
- the explicit **non-projected** list (§R8-8).

**Not changed:** `SEMANTICS-R.md §R4.1` normalisation, §R4.3 `canonicalJson`,
§R4.4 `fullContentDigest`, §R7 Apply mechanics, §R7A classification, §R8
(of `SEMANTICS-R.md`) author-trust, §R10 Import, `SEMANTICS-R5.md`'s
`frames` block in full, `SEMANTICS-R6.md`'s `timing`/`when` block in full,
and every prior `loop-revision/*` rule and invariant not restated here.

**Out of scope (Phase 1B / Phase 2 / a possible later phase — not this
document, per `docs/data-import.md` §DI16):** the actual CSV/TSV import UI,
validation, and Parameter-materialization logic; the refresh workflow, the
row lifecycle (added / missing / key-changed / value-changed / locally
deleted), the number-value base/local/incoming three-way, label
recomposition, both CSV exports; a possible later read-only spreadsheet
connector. This document is the wire / revision-projection contract for the
STORAGE SHAPE alone — exactly as `SEMANTICS-S3.md` is CSU's execution
contract alone and `SEMANTICS-R6.md` is its revision contract alone.

---

## R8-1. Version inference — the dual wire-level predicate

**Run on the side's RAW, pre-normalisation content — never a stored header,
and, unlike every prior `loop-revision/N` predicate, deliberately NOT the
already-normalised GraphDoc either.** This is a genuine departure from
`isModelLayerContent` / `isCsuContent` (both of which run on normalised
data) and this document's OWN first implementation got it wrong by following
that same pattern. The reason it must differ: `readParameterData` /
`readDataImports` don't just fill defaults, they also DROP a wrong-typed
provenance key / an unreadable table record before normalisation finishes —
so by the time a graph has been through `normalizeGraph()`, the very
signal this predicate exists to catch may already be gone. Classification
therefore reads the RAW value directly (see R8-D20 for exactly how
`readRevisionSide` and a `deserialize`-fed caller each do this); the
CANONICAL PROJECTION (§R8-2) is what runs on defensively-read, normalised
content, and is where an invalid value is correctly dropped for good — the
two steps look at two DIFFERENT reads of the same underlying value on
purpose. Evaluated **per graph** and **per side** of a proposal. Two
independent conditions, **either sufficient**:

> A graph's content is **`loop-revision/8`** iff **(a)** any `parameter`-kind
> node's `data` carries any of `sourceTableId`, `sourceKey`, `sourceColumnId`,
> or `labelAutoComposed` (any value — recognised or not, coherent triple or
> not), checked on the side's **RAW, pre-`readParameterData`** node data, or
> **(b)** the graph's RAW `dataImports` value contains ≥ 1 entry that at least
> *attempts* to be a table record (a non-null, non-array object), regardless
> of whether `readDataImports` goes on to keep it. Otherwise it is whatever
> `loop-revision/2` … `/6` says.

Condition (a) mirrors `SEMANTICS-R6.md §R6-1`'s CSU predicate for the
underlying field-reading behaviour: `readParameterData` keeps each of the
four fields **independently verbatim** whenever its own type checks out
(§R8-2.2) — an INCOHERENT but validly-typed partial triple (e.g. `sourceKey`
present, `sourceTableId` / `sourceColumnId` absent) is not "the same as no
provenance," it is a real, distinct document state that must move the
digest, exactly as an unrecognised `timing` must (`SEMANTICS-R6.md` §R6-2.2's
reasoning, restated here for a different field shape).

**Checking the ALREADY-NORMALISED graph is NOT sufficient, and this document's
first implementation got it wrong.** `readParameterData` keeps an
incoherent-but-validly-typed field, but it still DROPS a **wrong-typed** one
(`sourceTableId: 42` is not a string, so it never reaches a normalised
node's `data` at all) — by the time a graph has been through
`normalizeGraph`, that signal is gone. A predicate that only ever looks at
normalised data therefore mis-classifies a document with corrupted-but-real
provenance as a plain (≤ v7) file, directly contradicting this section's own
"however invalid its value" clause. The fix: condition (a) is checked on the
side's RAW node data — `readRevisionSide` uses its own un-normalised
`graph.nodes` argument (before its internal `normalizeGraph` call), and a
`deserialize`-fed caller (`revisionIO.ts`) additionally threads a
`hasRawDataImportSignal` boolean that `deserialize` computes from the file's
genuinely raw, pre-normalisation JSON — required because `deserialize`'s OWN
internal normalisation pass has already stripped the signal from its `nodes`
return value by the time any caller sees it (R8-D20).

Condition (b) mirrors `SEMANTICS-R5.md §R5-1`'s `frames` predicate in
spirit — a `dataImports` entry can exist with **zero** parameter nodes
referencing it at all (a pure-lookup-table import — `Items`/`Banners` in
`docs/data-import.md`'s own worked example carry no `number`-role column, so
they never materialize a Parameter), so the array's own presence must be an
independent trigger — but **not** in mechanism: `frames`' predicate checks
the DEFENSIVELY-READ result (≥ 1 entry must *survive* `readSavedFrames`);
`dataImports`' condition (b) checks RAW presence (≥ 1 entry must merely
*attempt* to be a table record), for the same reason as condition (a) —a
`dataImports` array every entry of which is malformed enough that
`readDataImports` drops all of them must still classify as v8, never
silently fall back to a plain document (R8-D20/R8-D21).

- **Section 8-1.1 (defensive read).** `readDataImports` (§R8-1.1,
  `src/model/serialize.ts`) drops a malformed table / column / row **entry**,
  never the graph. Unlike `readSavedFrames`'s §R5-1.1 posture, a missing,
  duplicate, or OVER-LENGTH `sourceTableId` / `sourceColumnId` / row
  `sourceKey` / FK-referenced `sourceKey` — the SAME `SOURCE_ID_MAX_BYTES` /
  `SOURCE_KEY_MAX_BYTES` ceilings `readParameterData` enforces on a
  Parameter's generating triple, §DI-D8 — is never given a freshly-minted
  replacement id and never truncated: it is dropped WHOLE,
  first-occurrence-wins, deterministic (R8-D21/R8-D24). This
  defensively-read result feeds the CANONICAL PROJECTION (§R8-2.1); it is
  deliberately NOT what condition (b) above is evaluated against — see the
  correction above.
- The predicate is **monotone**: a v8 graph is also ≤ v6 in the earlier
  sense; all lift into one compare model (§R8-5).
- Checked **independently** of `frames` / `loop-model/2` / routing / CSU —
  a graph can be pure-data-import content with none of the others present
  (a bare Parameter carrying only a provenance triple, or a bare
  `dataImports` array with no Parameters at all). The label is the only
  thing precedence changes; every ≥ v2 side shares the one
  `{ modelLayer: true }` projection (§R8-2), so which of v2 … v8 a side is
  labelled never changes what bytes are produced.

---

## R8-2. The extended canonical projection

### R8-2.1 A new top-level key: `dataImports`

Unlike CSU (§R6-2, no new top-level key), `dataImports` is genuinely new —
mirroring `frames`' §R5-2.1 shape:

```
CanonicalContent.dataImports?: ImportSourceTable[]
```

Trailing, **after `frames`, before `modelSemantics`** — the established
append-order for every new top-level key since `loop-revision/5`. Present
**iff** ≥ 1 entry survives the §R8-1.1 defensive read AND the projection
runs under the model layer (`{ modelLayer: true }`); absent ⇒ ≤ v7 canonical
bytes are unchanged (R8-INV-2). Array in **file order** (not re-sorted, same
as `frames`). Per-table key order: `sourceTableId`, `label`, `columns`
(each `sourceColumnId`, `role`, `header`, then `refTableId` only when the
role is `foreignKey`), `rows` (each `sourceKey`, `number`, `label`,
`foreignKey` — each of these three maps' OWN keys sorted by `sourceColumnId`,
never the live object's insertion order, R8-D22).

### R8-2.2 Four new trailing `parameter` fields

Unlike `frames`, but exactly like CSU (§R6-2), the per-node half of this
extension adds no new top-level key — it appends to the existing
`MODEL_NODE_FIELDS.parameter` table:

```
MODEL_NODE_FIELDS.parameter =
  ['kind', 'label', 'value', 'min', 'max', 'step', 'unit',
   'sourceTableId', 'sourceKey', 'sourceColumnId', 'labelAutoComposed']
```

**Emission rule** — for a `parameter` node, under `{ modelLayer: true }`
only (never emitted under the literal v1 projection, same as every other
Parameter field beyond `kind`/`label`/`value`):

| stored field | emitted? |
|---|---|
| absent | no |
| present, valid type | yes — verbatim |
| present, WRONG type | **dropped by `readParameterData` before projection ever sees it** (§R8-2.3) |

This is a narrower verbatim rule than CSU's: `readParameterData` (not the
projection) is where a wrong-TYPE value is rejected — `sourceTableId: 42`
is dropped with a `PARAM_SOURCE_INVALID` notice, never reaching
`projectNode`. What is **not** rejected, and What CSU's precedent directly
motivates preserving, is an INCOHERENT COMBINATION of otherwise-validly-typed
fields (`sourceKey` alone, no table/column id) — each field's OWN validity
is checked independently; there is no cross-field "all four or none" rule
(§R8-2.3).

### R8-2.3 Why an incoherent partial triple is NOT normalised away

The tempting simplification, mirroring `min`/`max`'s own rule, would be "all
four fields survive together, coherently, or none do." This was this
document's own first-drafted form (`src/model/model/parameter.ts`, before
correction) and it is **wrong**, for the same class of reason
`SEMANTICS-R6.md §R6-2.2` gives for `timing`/`when`: a hand-edited or
partially-corrupted file with `sourceKey` set but `sourceTableId` /
`sourceColumnId` missing is a REAL, DISTINCT document state — not
equivalent to "no provenance at all" — and Phase 2's future refresh logic,
not this defensive reader, is the correct layer to decide what a partial
triple MEANS. If the reader silently dropped the whole incoherent group,
such a file would hash **identically** to a plain hand-created Parameter,
making `isDataImportContent` (§R8-1) blind to exactly the
corrupted-but-clearly-intended-as-provenance case it must classify by
storage shape, not validity. §R8-2.2's per-field verbatim rule closes this.

### R8-2.4 Everything else is unchanged

`node(n)` / `edge(e)` shape, `position`, the id-sorted `nodes` / `edges`
arrays, the `frames` / `modelSemantics` trailing keys, `canonicalJson`
(fixed key order), and `fullContentDigest =
SHA-256(UTF-8(canonicalJson(canonicalContent(doc))))` are all as
`SEMANTICS-R.md §R4` / `SEMANTICS-R5.md §R5-2.2` / `SEMANTICS-R6.md
§R6-2.3`.

There is **one** `canonicalContent`. Given a graph with no provenance
content of either shape, it emits the ≤ v6 bytes (R8-INV-2); given a
v8-content graph it emits those bytes plus whichever of the two new pieces
(the `dataImports` array, the affected Parameters' trailing fields, or both)
actually survived.

---

## R8-3. Field tag — a new category, `provenance`

`loop-revision/2 §R2-3` defines `engine` / `cosmetic` / `advisory`;
`loop-revision/6 §R6-3` reuses `engine` for `timing`/`when`. Neither fits
data-import provenance:

| field | tag | in projection & diff? | sets `engineAffecting`? | sets `advisoryAffecting`? |
|---|---|---|---|---|
| `data.sourceTableId` | **`provenance`** | yes | no | no |
| `data.sourceKey` | **`provenance`** | yes | no | no |
| `data.sourceColumnId` | **`provenance`** | yes | no | no |
| `data.labelAutoComposed` | **`provenance`** | yes | no | no |
| the graph-level `dataImports` array | **`provenance`** | yes (§R8-6) | no | no |

**Why not `cosmetic` (like `frames`)?** A `frames` edit is purely
presentational — it changes nothing about how the document is understood
going forward. Data-import provenance is different: it changes the MEANING
of a future `refresh` (Phase 2) — the same `sourceKey` reappearing later is
either recognized or not depending on this exact content. Filing it under
"purely cosmetic" would understate what kind of content it is, per explicit
review direction (`docs/data-import.md`'s kickoff review: "provenance는
단순 cosmetic보다 별도의 dataImport 또는 provenance 필드 태그가 맞습니다").

**Why not `engine` (like `timing`/`when`)?** Because it genuinely does not
change what any step computes — `fieldTag`'s own `engineAffecting` /
`advisoryAffecting` booleans would both be dishonest if provenance set
either one.

**Why not `advisory` (like `min`/`max`/`resourceType`)?** `advisory`
content is a tuning HINT for a human reading the SAME document right now
(a range hint, a unit). Provenance is a hidden BOOKKEEPING record for a
FUTURE operation (refresh) the current document doesn't even have a UI for
yet (Phase 1A ships no refresh workflow at all). Conflating the two would
make `advisoryAffecting` mean two unrelated things.

A `provenance`-tagged `change`-hunk field follows the **ordinary** field
rule in `computeThreeWay` (a divergent value is a `conflict`, feeds `nConf`)
— no special carve-out, exactly like `engine` fields get no carve-out
(`SEMANTICS-R6.md §R6-3`'s own point). The carve-out-shaped mechanic
(`nConf` scored specially, one atomic unit) applies only to the
GRAPH-LEVEL `dataImports` array (§R8-6), because THAT is graph-level like
`frames`, not because `provenance` as a tag implies it.

---

## R8-4. Conservative extension, and the golden vector

**R8-INV-2 — conservative extension.** Run `canonicalContent` over a
normalised graph that **fails §R8-1** (no provenance-carrying `parameter`
node, no surviving `dataImports` entry): the output is **byte-identical** to
the ≤ v6 projection of the same graph, so `fullContentDigest` is identical
under either reading. Adding data-import projection support to the codebase
does **not** move any existing file's digest.

**The golden vector.** `examples/revision-v8/` + `test/revision-v8-fixture.test.ts`,
combining `examples/revision-v5/`'s graph-level-array template with
`examples/revision-v6/`'s per-node-content template (since `dataImports` is
both shapes at once):

- **DG0** — a plain `parameter` node, no provenance, no `dataImports`.
  `digest_v8(DG0) === digest_v2(DG0)`; not v8.
- **DG1** — DG0's Parameter gains the FULL valid generating triple +
  `labelAutoComposed`. Infers v8; `readRevisionSide` does not throw (the
  R2-INV-2-style regression this document's §R8-1 dual predicate exists to
  prevent, mirroring CG1's role in `SEMANTICS-R6.md §R6-4`); digest differs
  from DG0; every other node/edge byte unchanged.
- **DG2 — the v6 → v8 → v6 digest return.** DG1 with the four fields
  removed. `digest_v8(DG2) === digest_v8(DG0)` exactly.
- **DG3 — an incoherent partial triple** (`sourceKey` only). Still v8
  (§R8-2.3); digest differs from BOTH DG0 and DG1 — an incomplete triple is
  neither "no provenance" nor "the same provenance."
- **DG4 — a `dataImports` entry with ZERO provenance-carrying Parameters**
  (a pure-lookup-table import). Still v8, via the array alone
  (§R8-1 condition (b)) — the case that would otherwise mis-infer v1 (no
  model/routing/frames/CSU trigger either) and hit the same class of
  assertion failure CSU's own CG1 found for `timing`/`when`.
- **DG5 — a WRONG-TYPED provenance value** (`sourceTableId: 42`, a number, on
  an otherwise plain Parameter). Still classifies v8 (§R8-1's "however
  invalid its value" clause, R8-D20) even though the value itself never
  survives the projection (§R8-2.3) — the regression this document's first
  implementation got wrong (checking only already-normalised data, which
  `readParameterData` has already stripped the key from).
- **DG6 — a `dataImports` array whose ONLY entry is malformed enough that
  `readDataImports` drops it entirely** (e.g. no `sourceTableId` at all).
  Still classifies v8 via condition (b)'s RAW-presence check, even though the
  CANONICAL PROJECTION carries no `dataImports` key at all (nothing survived
  to project) — proof that classification and projection are governed by two
  different reads of the same raw value (R8-D20).
- **determinism** — deserializing the SAME file text twice (or projecting the
  same in-memory `dataImports` twice) produces byte-identical canonical JSON
  and digest both times — a regression guard against `readDataImports` ever
  minting a fresh id from `Date.now()` again (R8-D21).
- **map key order** — two otherwise-identical rows whose `number` map was
  built by inserting the same key/value pairs in a different order project
  identical canonical bytes (R8-D22).
- **`ignored` role exclusion** — a column carrying `role: "ignored"` in a raw
  file is dropped like any other unrecognised role; it can never appear in a
  read-back `ImportSourceTable` (R8-D23).
- **diff DG0 → DG1** — exactly one `changed` node with four `provenance`-tagged
  fields; `provenanceAffecting: true`, `engineAffecting: false`,
  `advisoryAffecting: false`.
- **three-way conflict** — a genuinely divergent local `sourceTableId` value
  (base has none, mine and theirs disagree) is a `conflict`, tag
  `provenance`, feeds `nConf` — the ordinary field rule (§R8-3).
- **selective Apply, both directions (R8-D7 regression guard, mirroring
  `SEMANTICS-R6.md`'s CG7a/CG7b for `timing`/`when`)** — provenance → plain:
  selecting "theirs" on all four fields DELETES them, result returns to
  DG0's digest exactly; plain → provenance (reverse): selecting "theirs"
  ADDS all four, result matches DG1's digest exactly. Both confirm the four
  fields are members of `OPTIONAL_PROJECTED_KEYS` (§R8-6.1).
- **round trip through Import → Export** preserves the triple +
  `labelAutoComposed` byte-for-byte.
- **the `dataImports` graph-level hunk** (§R8-6), mirroring
  `SEMANTICS-R5.md`'s own SG4a-e battery: a clean swap-in (selecting the
  hunk adopts the proposal's whole array, no node/edge byte moves), a clean
  clear (returns the digest to DG0 exactly), a divergent-edit conflict
  (feeds `nConf`), a target-already-at-proposal noop, and the absent-on-
  both-sides case (no `dataImports` key on the plan at all).

DG0's and DG1's digests are **PINNED** to literal 64-hex constants (mirroring
`SEMANTICS-R6.md §R6-4`'s `CG0_DIGEST` / `CG1_DIGEST`) — a comparison against
only other freshly-computed digests cannot catch a drift in the projection's
own field ORDER (e.g. an accidental reordering of `MODEL_NODE_FIELDS.parameter`
or the `dataImports` key table), since a consistent reordering would still
agree with itself on both sides of every `not.toBe` / `toBe` comparison
between two computed values. Every other digest in the fixture (DG2-DG6) is
still compared against DG0's / DG1's PINNED value, or against another
computed value where no oracle exists yet for that exact shape.

---

## R8-5. Per-side discrimination & validation order

`SEMANTICS-R6.md §R6-5` with an eighth version and a DUAL step 3.

1. **Normalise** the side's graph (`§R4.1` + `normalizeGraph()`).
2. **Defensive read** of `parameter` / `register` (`§R2-1.1`), routing
   (`§R3-1.1`), `frames` (`§R5-1.1`), and `dataImports` (`§R8-1.1`). The four
   provenance FIELDS on a `parameter` node need **no separate** defensive
   read step of their own beyond `readParameterData` itself (§R8-2.2/2.3 —
   nothing surviving that read is further dropped or repaired here).
3. **Infer the version** from the result of step 2, by predicate — **data-import
   checked FIRST** (highest precedence: this document is the newest
   extension), **then CSU** (`SEMANTICS-R6.md §R6-5` step 3), **then**
   `frames` — order among v5/v6/v8 changes only the LABEL when more than one
   applies simultaneously, never which bytes the shared `{ modelLayer: true }`
   projection produces, since every v2 … v8 side shares that one projection
   (§R8-D6):
   - any `parameter` node carries a provenance key (checked on the side's
     RAW, pre-normalisation node data — a wrong-typed value that
     `readParameterData` will go on to drop from the PROJECTION must still be
     visible to CLASSIFICATION, per §R8-1's presence-not-validity rule), OR
     `dataImports` contains ≥ 1 entry that at least attempts to be a table
     record (again checked on the RAW value, before `readDataImports` may
     drop it entirely) ⇒ **v8**;
   - else any `state` edge with a non-default `timing` / any `when` ⇒ v6;
   - else `frames` has ≥ 1 surviving entry ⇒ v5;
   - else `loop-model/2` declaration ⇒ v4; else routing ⇒ v3; else
     `loop-revision/2` §R2-1 ⇒ v2; else v1.
4. **Verify the stored digest against the ORIGINAL version's projection** —
   a v1 side against `{ modelLayer: false }`; every v2 … v8 side against the
   **same** `{ modelLayer: true }` projection (optionally with the §M2-8
   discriminator). Verifying a v1 side directly with the v8 projection is
   forbidden, for the same reason `SEMANTICS-R5.md §R5-5.1` step 4 and
   `SEMANTICS-R6.md §R6-5` step 4 forbid it for v5 / v6.
5. **Lift** the verified content into the common **v8 compare model**. By
   R8-INV-2 this reproduces byte-identical output for a ≤ v6 side; the
   implementation **asserts** it.

---

## R8-6. The graph-level `dataImports` hunk

Mirrors `SEMANTICS-R5.md §R5-6` (`frames`) exactly, substituting
`provenance` for `cosmetic` as the tag:

- The WHOLE projected `dataImports` array is compared as **one atomic
  hunk** — no per-table / per-row granularity on the wire (same reasoning
  as `frames`' §R5-D7: table membership / row-level detail is not tracked
  at this level, and adding that granularity would be new complexity this
  storage-foundation slice does not need).
- `computeRevisionDiff`: `summary.dataImportsChanged` — feeds `dirty` /
  `empty`, but **never** `engineAffecting` / `advisoryAffecting` (it DOES
  feed `provenanceAffecting`, per §R8-3).
- `computeThreeWay`: a `DataImportsHunk` (`kind: 'dataImports'`) present
  only when `base` and `proposed` arrays differ; `noop` / `clean` /
  `conflict` verdict against the target exactly like a `frames` hunk. A
  `conflict` (base and both sides diverged) feeds `nConf`, gating a whole
  Apply so a user's data-import edits are never silently overwritten.
- `buildSelectiveApply`: `HunkSelection.dataImports` (`'proposed' |
  'yours'`) swaps in the proposal's WHOLE array (`[]` clears every record)
  or keeps the target's — never a per-entry merge, ever, same as `frames`.

### R8-6.1 Per-field provenance changes on a `parameter` node

Unlike the graph-level array, a single Parameter's `sourceTableId` /
`sourceKey` / `sourceColumnId` / `labelAutoComposed` are **ordinary**
per-field `change`-hunk entries (§R8-3) — ADDED to `OPTIONAL_PROJECTED_KEYS`
alongside `min`/`max`/`step`/`unit`/`format`/`route`/`waypoints`/
`resourceType`/`delay`/`timing`/`when`, so a selective Apply choosing
"theirs" with `proposed: undefined` correctly DELETES a stored provenance
field rather than silently leaving it in place — the exact class of bug
`SEMANTICS-R6.md §R6-D7` found and fixed for `timing`/`when` (R6-D7), guarded
against here from the start rather than discovered later (§R8-4's selective-
Apply golden-vector cases).

---

## R8-7. `loop-workspace/1` is NOT bumped

Like `frames` (§R5-8), unlike `timing`/`when` (§R6-7): provenance affects
nothing `SimState` computes. Verified directly against the code, not
assumed: `src/model/workspace.ts`'s `NodeProjection` / `projectNode` never
reads a Parameter's `value` at all (only `activation`, `mode`,
`distribution`, `initial`, `capacity` — none of which a `parameter` node
even has), so the four new fields were already, by construction, outside
this semantic digest's field set before this document existed — no code
change to `workspace.ts` was needed or made. The Monte-Carlo stale-result
check (`SEMANTICS-W.md` §W3.2) correctly does NOT treat a provenance-only
edit as invalidating a prior result, exactly as a `frames`-only edit
doesn't.

---

## R8-8. Explicitly NOT projected / NOT wire content

- The full original spreadsheet row, any unmapped / ignored column, or a
  source file / Sheet URL (`docs/data-import.md` §DI-D6) — never stored
  anywhere, so there is nothing here to project either.
- The refresh workflow's runtime state (a pending diff, an in-progress
  three-way resolution, an open "locally deleted" prompt) — session UI
  state, never document content, exactly like an open dialog is never
  projected today.
- Re-validation of a provenance field's coherence (whether a triple is
  complete, whether an FK resolves) against `docs/data-import.md`'s own
  contract — the projection carries whatever is stored verbatim (§R8-2.2);
  deciding what a partial or dangling value MEANS is Phase 2's job at
  refresh time, not the revision layer's job at projection time (exactly
  `SEMANTICS-R6.md §R6-8`'s closing point, restated for this document's own
  fields).

---

## R8-D. Settled decisions

| id | decision |
|---|---|
| **R8-D1** | `dataImports` is a NEW top-level `CanonicalContent` key (like `frames`, §R5-2.1) — **not** reused per-node fields for the table-level records, since a table/row isn't attached to any single node. |
| **R8-D2** | `sourceTableId` / `sourceKey` / `sourceColumnId` / `labelAutoComposed` are per-`parameter`-node `data` fields (like `timing`/`when`, §R6-2) — **not** a second new top-level key, since they belong to one specific node. |
| **R8-D3** | **No `schema` / `version` bump.** Additive, forward-compatible at the wire level, same posture as every prior `loop-revision/N` (`SEMANTICS-R6.md` R6-D2). |
| **R8-D4** | **Verbatim, not re-validated**, for both halves — the projection emits whatever is stored (past the "no dataImports"/"no provenance keys" default), including an incoherent partial triple. See §R8-2.3 for why the coherent-pair-or-drop alternative was rejected. |
| **R8-D5** | **A new tag, `provenance`** — neither `cosmetic` (`frames`) nor `engine` (`timing`/`when`) nor `advisory` (`min`/`max`/`resourceType`). See §R8-3 for the full reasoning against each alternative. |
| **R8-D6** | The dual predicate (§R8-1) is checked **independently** of `frames` / `loop-model/2` / routing / CSU, at the **highest** precedence tier (above CSU, above `frames`) in the `readRevisionSide` cascade — this ordering is a labelling convenience only, since every v2 … v8 side shares one projection. Checked on the side's RAW pre-normalisation content (not the already-normalised `g.nodes` `readRevisionSide` computes internally, and not the already-cleaned `dataImports` a `deserialize` caller passes in) — see §R8-1 and R8-D20. |
| **R8-D20** | **Classification reads RAW content; a `deserialize` caller must thread the raw signal through explicitly.** `readParameterData` drops a wrong-typed provenance key, and `readDataImports` drops a malformed table record, before either ever reaches a normalised node / array — correct for the PROJECTION, wrong for CLASSIFICATION (§R8-1's presence-not-validity rule). `readRevisionSide` checks its own raw `graph.nodes` / `graph.dataImports` arguments (not its internally-`normalizeGraph`'d copy) to catch this for a directly-constructed graph; a `deserialize`-fed caller (`revisionIO.ts`) additionally threads a `rawDataImportSignal` boolean that `deserialize` computes from the file's genuinely raw, pre-`normalizeGraph` JSON — the only point at which that shape still exists, since `deserialize`'s own internal normalisation pass has already stripped it by the time its `nodes` / `dataImports` return values exist. |
| **R8-D21** | **`readDataImports` never mints a replacement id.** A table/column missing or duplicating its `sourceTableId` / `sourceColumnId` is dropped WHOLE (first-occurrence-wins, the same rule already used for a duplicate row `sourceKey`), never given a freshly-minted id. Unlike `readSavedFrames`' `frames` (which DOES mint one), a data-import id is a stable cross-reference a Parameter's generating triple points at — minting a new one on every read would (a) make re-reading the same file twice produce a *different* canonical projection and digest, breaking the basic purity every other `loop-revision/N` reader relies on, and (b) silently sever that Parameter's triple from its table the moment an id happened to collide or go missing. |
| **R8-D22** | **A row's `number` / `label` / `foreignKey` maps project with keys sorted by `sourceColumnId`**, never the live object's insertion order — two documents whose values are equal but were authored/edited in a different column order must still produce identical canonical bytes and digests. |
| **R8-D23** | **`ignored` is never a storable `ImportColumnRole`.** It is Phase 1B's own transient preview-selection state (a column the user hasn't assigned a role to yet); `readDataImports` treats it exactly like any other unrecognised role (the column is dropped whole), so it can never appear in GraphDoc wire content — required by §DI-D6 / §R8-8, which this closes a gap against. |
| **R8-D24** | **`readDataImports` enforces the SAME `SOURCE_ID_MAX_BYTES` / `SOURCE_KEY_MAX_BYTES` ceilings `readParameterData` already enforces** (§DI-D8) — on a table's `sourceTableId`, a column's `sourceColumnId`, a row's own `sourceKey`, and an FK column's referenced `sourceKey` value. Without this, a 129-byte `sourceTableId` (say) could survive in a `dataImports` table record while `readParameterData` drops it from any Parameter pointing at it — severing the exact linkage §DI9 depends on. An over-limit id/key is EXCLUDED (the table/column/row is dropped whole), never truncated — a truncated id could collide with, or simply no longer match, a Parameter's own stored value. `refTableId` (a column's OWN reference to another table) is deliberately NOT bounded by this fix — a dangling or over-length `refTableId` is already a tolerated, harmless state (an FK column matching no known table), unlike the Parameter-linkage severance the four bounded fields actually risk. |
| **R8-D7** | `loop-workspace/1` is **NOT** bumped (contrast `SEMANTICS-R6.md` R6-D6) — provenance is not a real input to what a run computes; verified directly against `workspace.ts`'s existing field set rather than assumed (§R8-7). |
| **R8-D8** | The four per-node provenance fields ARE members of `OPTIONAL_PROJECTED_KEYS` from the start (§R8-6.1) — proactively guarding against the exact `SEMANTICS-R6.md` R6-D7 class of bug (a selective "take theirs" that can't delete a field) rather than discovering it in a later review round. |
| **R8-D9** | The graph-level `dataImports` array gets `frames`' whole-array-hunk treatment (§R8-6); the four per-node fields get the ORDINARY per-field `change`-hunk treatment (§R8-6.1) — the two halves of this extension are diffed by two genuinely different mechanisms, matching their two genuinely different shapes, not forced into one uniform rule. |
