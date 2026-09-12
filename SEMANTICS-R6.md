# Project Revision / Proposal — CSU (`loop-state/3`) extension

```
Spec ID: loop-revision/6
Status:  Frozen
```

**Frozen (2026-09-12).** The fixed target for the CSU engine-implementation
slice (`docs/conditional-state-update.md` §CSU8 slice 2). A behavioural change
after this is a new spec id in a new document, exactly as
`loop-revision/1 → /2 → /3 → /5`. The *design* is
`docs/conditional-state-update.md` (CSU, rev 5) and `SEMANTICS-S3.md`
(`loop-state/3`, Frozen); this document formalises the revision-projection /
diff / Apply surface of the same `timing` / `when` fields.

Extends `SEMANTICS-R5.md` (`loop-revision/5`, Frozen) so the canonical
revision projection, its digest, the three-way diff, and Apply also cover a
`state` edge's `timing` and `when` fields — the CSU / `loop-state/3` **Phase
2.5** grammar. `loop-revision/4` (`loop-model/2`) and `loop-revision/5`
(`frames`) are orthogonal and untouched.

**No behavioural change to `loop-revision/1` … `/5`.** A graph where every
`label` edge has no `when` and no `timing` (or only the literal
`timing: "phase0"`) has a canonical projection, digest, diff, and Apply
**byte-identical** to before this document (R6-INV-2). Files, and only files,
are the transport.

**`loop-workspace/1` is bumped** — unlike `frames` (§R5-8, cosmetic, not
bumped), `timing` / `when` are **engine-affecting** (§R6-3): the semantic
digest that backs `loop-workspace/1`'s stale-result check moves whenever they
do (`src/model/workspace.ts`, mirrored independently of this document).

---

## R6-0. Scope

**Added over `loop-revision/3` / `/4` / `/5`:**

- a **wire-level version predicate** (§R6-1): a graph's content is
  `loop-revision/6` iff, after normalisation, any `state` edge carries a
  `when` (any string) or a `timing` other than absent / the literal
  `"phase0"` — inferred from content, never a stored header;
- the **extended canonical projection** (§R6-2): two fields already trailing
  on `EDGE_FIELDS.state` (`timing` then `when`, after `route` / `waypoints`),
  emitted **verbatim** whenever stored and non-default — including an
  **unrecognised value**, deliberately, per §R6-2.2;
- **`timing` / `when` are `engine`** (§R6-3) — unlike `route` / `waypoints`
  (`cosmetic`, `SEMANTICS-R3.md` §R3-3) and unlike `frames` (`cosmetic`,
  `SEMANTICS-R5.md` §R5-3): they change what a step computes, so they set
  `engineAffecting` and move the semantic / engine digest, exactly like
  `expr` or `flow`;
- the **conservative-extension guarantee** and its **golden vector** (§R6-4):
  a ≤ v5-content graph's v6 digest equals its ≤ v5 digest;
- the **validation order** — verify a v1 … v5 side with its own projection,
  then lift into the common v6 model (§R6-5);
- `timing` / `when` behaviour in `dirty` / whole diff / whole + per-hunk Apply
  (§R6-6) — the **ordinary** `engine`-tagged-field rules, no new exception
  (contrast `frames`' §R5-6 `nConf` carve-out, which does not apply here);
- an explicit **`loop-workspace/1` IS bumped** note (§R6-7);
- the explicit **non-projected** list (§R6-8).

**Not changed:** `SEMANTICS-R.md §R4.1` normalisation (finite numbers,
`-0 → 0`, **no rounding**, exact strings, missing-vs-default), §R4.3
`canonicalJson` (fixed key order, no whitespace, id-sorted arrays), §R4.4
`fullContentDigest`, §R7 Apply mechanics, §R7A classification, §R8
author-trust, §R10 Import, `SEMANTICS-R5.md`'s `frames` block in full, and
every prior `loop-revision/*` rule and invariant not restated here.

**Out of scope:** the Inspector authoring UI for `timing` / `when` (CSU8
slice 3 — an editor contract, not wire content); the gacha hard-pity content
(GS10-3, slice 4); `@parameter` activator support (slice 5). This document is
the wire / revision contract for the engine fields alone, exactly as
`SEMANTICS-S3.md` is their execution contract alone.

---

## R6-1. Version inference — the wire-level predicate

Run **after** `normalizeGraph()`, on the **normalised valid GraphDoc** — never
on raw JSON, never on a stored header. Evaluated **per graph** and **per
side** of a proposal.

> A graph's content is **`loop-revision/6`** iff, after normalisation, any
> `state`-kind edge carries a `when` field (any string — recognised or not),
> or a `timing` field whose value is anything other than absent or the
> literal `"phase0"` (i.e. `"afterPull"`, or any unrecognised string).
> Otherwise it is whatever `loop-revision/3` / `/4` / `/5` says.

This is deliberately **not** "a *valid* `afterPull` label" — the predicate
(and the projection, §R6-2.2) does not re-run the engine's CSU3-5 validation.
An edge with `timing: "nope"` or a `phase0` label carrying a stray `when` is
already, on its own, a document that behaves differently from a `loop-state/2`
document (the engine fail-closes it — `SEMANTICS-S3.md` §S3-5) — so it must be
`loop-revision/6` content and move the digest, exactly as a *valid* `afterPull`
edge does. Re-validating here would silently let a malformed-but-stored value
hide behind the ≤ v5 digest, which is precisely the gap this document closes.

- The predicate is **monotone**: a v6 graph is also ≤ v5 in the earlier
  sense; all lift into one compare model (§R6-5).
- A v6 graph is checked **first**, ahead of `frames` / `loop-model/2` /
  routing — it is orthogonal to all three (a pure engine-only pity-counter
  graph — one Gate, one Pool, one `afterPull` label — carries none of them)
  and independent of them when it does co-occur. The label is the only thing
  the precedence changes; every ≥ v2 side shares the one `{ modelLayer: true
  }` projection (§R6-2), so which of v2 … v6 a side is labelled never changes
  what bytes are produced.

---

## R6-2. The extended canonical projection

`loop-revision/6` adds **no new top-level `CanonicalContent` key** (unlike
`frames`, §R5-2.1) — `timing` and `when` are two more entries in the existing
`EDGE_FIELDS.state` per-edge field table, already declared as trailing keys
by the CSU implementation:

```
EDGE_FIELDS.state = ['kind', 'mode', 'expr', 'delay', 'route', 'waypoints', 'timing', 'when']
```

### R6-2.1 Emission rule

For a `state`-kind edge, under the `{ modelLayer: true }` projection only
(the literal v1 projection never emits either key, same as `route` /
`waypoints`):

| stored `data.timing` | emitted? |
|---|---|
| absent | no |
| `"phase0"` (the literal default) | no |
| `"afterPull"` | yes — `"afterPull"` |
| any other string | yes — **that string, verbatim** |

| stored `data.when` | emitted? |
|---|---|
| absent | no |
| `"source-fired"` | yes — `"source-fired"` |
| any other string | yes — **that string, verbatim** |

Neither field is validated, coerced, or defaulted here — the raw stored
string is the projected value. (Contrast the `frames` block, §R5-1.1, which
*does* structurally validate and can drop an entry: `timing` / `when` are
each a single scalar with only one normal-default value, so there is nothing
to repair — an unrecognised string is exactly as much "the document's real
content" as a recognised one.)

### R6-2.2 Why unrecognised values are NOT normalised away

A tempting simplification would be "emit only `'afterPull'` / `'source-fired'`
— the only values `SEMANTICS-S3.md` recognises; treat everything else as if
absent." This was the implementation's first form, and it is **wrong**:
`SEMANTICS-S3.md` §S3-5 does not treat an unrecognised `timing` / `when` as
"absent" — it fail-closes the edge (inert, one diagnostic, no `stateEvent`),
which is a **different run** from both a legacy `phase0` label (which would
apply) and a valid `afterPull` label (which conditionally applies). If the
projection normalised the unrecognised string away, that different run would
hash **identically** to the legacy one — silently defeating the very
guarantee `SEMANTICS-S3.md` §S3-7 states ("a document with even one
`afterPull` edge … is not [byte-identical]"), and letting a stale
`loop-workspace/1` Monte-Carlo result or an `unknown ancestry` proposal
review pass a graph whose actual behaviour changed. §R6-2.1's verbatim rule
closes this.

### R6-2.3 Everything else is unchanged

`node(n)` / `edge(e)` shape, `position`, the id-sorted `nodes` / `edges`
arrays, the `frames` / `modelSemantics` trailing keys (`SEMANTICS-R5.md` /
`SEMANTICS-M2.md`), `canonicalJson` (fixed key order), and
`fullContentDigest = SHA-256(UTF-8(canonicalJson(canonicalContent(doc))))`
are all as `SEMANTICS-R.md §R4` / `SEMANTICS-R2.md §R2-2.3` /
`SEMANTICS-R3.md §R3-2.3` / `SEMANTICS-R5.md §R5-2.2`.

There is **one** `canonicalContent`. Given a graph with no `state` edge
carrying a non-default `timing` / `when`, it emits the ≤ v5 bytes (R6-INV-2);
given a v6-content graph it emits those bytes plus the affected edges'
trailing `timing` / `when` keys.

---

## R6-3. Field tag — `timing` / `when` are `engine`

`loop-revision/2 §R2-3` defines `engine` / `cosmetic` / `advisory`.
`fieldTag('edge', 'data.timing')` and `fieldTag('edge', 'data.when')` are the
**`engine` default** — neither is added to the `cosmetic` list (`route` /
`waypoints` / `frames`) or the `advisory` list (`resourceType`, Parameter /
Register hints):

| field | tag | in projection & diff? | sets `engineAffecting`? | sets `advisoryAffecting`? |
|---|---|---|---|---|
| `data.timing` | `engine` | yes | **yes** | no |
| `data.when` | `engine` | yes | **yes** | no |

This is the deliberate contrast with `SEMANTICS-R3.md §R3-3` (`route` /
`waypoints`, cosmetic — a wire *reroute* that never changes a computed value)
and `SEMANTICS-R5.md §R5-3` (`frames`, cosmetic — a labelled overlay). `timing`
/ `when` gate **which phase, and whether at all,** a label edit is applied
(`SEMANTICS-S3.md` §S3-1 / §S3-5) — that is definitionally engine content, so
it needs **no special-cased `nConf` carve-out** the way `frames` did (§R5-6
/ R5-D9): a `change` hunk on `data.timing` / `data.when` is scored by the
**ordinary** `engine`-field rule already in `computeThreeWay` — a divergent
value is a `conflict` and feeds `nConf` exactly as a divergent `expr` or
`flow` would.

---

## R6-4. Conservative extension, and the golden vector

**R6-INV-2 — conservative extension.** Run `canonicalContent` over a
normalised graph that **fails §R6-1** (no `state` edge with a non-default
`timing` / `when`): the output is **byte-identical** to the ≤ v5 projection
of the same graph, so `fullContentDigest` is identical under either reading.
Adding CSU-projection support to the codebase does **not** move any existing
file's digest.

**The golden vector.** `examples/revision-v6/` + `test/revision-v6-fixture.test.ts`,
mirroring `examples/revision-v5/`:

- **CG0** — a **pure engine-only** graph with no `parameter` / `register`,
  no routing, no `frames`: a Pool, a deterministic Gate, a `resource` edge
  between them (so the Gate fires), and a second Pool with an ordinary
  `phase0` `label` edge (no `timing`, no `when`) targeting it. This is
  exactly the shape `SEMANTICS-R6.md §R6-1` calls out as orthogonal to every
  earlier predicate — before this document, `readRevisionSide` on a graph
  like CG0 **plus an `afterPull` edge** (CG1 below) would infer `loop-revision/1`
  and then **throw** `InvalidRevisionContentError('R2-INV-2: lifting a v1 side
  changed its canonical bytes')`, because the `{ modelLayer: true }`
  projection it lifts into already included the CSU fields while the version
  predicate did not know to look for them. Assert `digest_v6(CG0) ===
  digest_v1(CG0) === pinned`, and the predicate agrees it is **not** v6.
- **CG1** — CG0 with the `phase0` label's `timing` set to `"afterPull"` +
  `when: "source-fired"`, source retargeted to the Gate (an `afterPull`
  source must fire in Phase 2). Assert: it infers **v6**; `readRevisionSide`
  on CG1 (no `frames`, no model layer, no routing) succeeds with `version:
  'loop-revision/6'` and does **not** throw; `digest_v6(CG1) !==
  digest_v6(CG0)`; the projected edge carries `timing: "afterPull"`,
  `when: "source-fired"`; every other node / edge byte is unchanged from CG0.
- **CG2 — the v5 → v6 → v5 digest return.** CG1 with `timing` / `when`
  removed (back to a bare `phase0` label). Assert CG2 fails the v6 predicate
  and `digest_v6(CG2) === digest_v6(CG0)` exactly.
- **CG3 — an unrecognised `timing`.** CG1 with `timing: "nope"` (invalid per
  `SEMANTICS-S3.md` §S3-5, `when` still `"source-fired"`). Assert: the
  predicate still says **v6**; the projected edge carries `timing: "nope"`
  verbatim; `digest_v6(CG3)` differs from **both** `digest_v6(CG0)` (the
  legacy graph) **and** `digest_v6(CG1)` (the valid `afterPull` graph) — an
  invalid value is neither "no CSU" nor "the same CSU edit."
- **CG4 — an unrecognised `when`, and a `phase0` label with a stray `when`.**
  Two further fixtures: (a) CG1 with `when: "level>=5"` (invalid); (b) CG0's
  bare `phase0` label with `when: "source-fired"` added and `timing` left
  absent (CSU3-5 row 2 — fail-closed even though `timing` never became
  `"afterPull"`). Assert both are **v6** content, both digest differently
  from `digest_v6(CG0)`, from each other, and from CG3 — distinct invalid /
  unexpected inputs never collide.
- **CG5 — diff / three-way.** `computeRevisionDiff(CG0, CG1)` is exactly two
  `changed` fields on the one edge — `data.timing` and `data.when` — both
  tagged `engine`, `engineAffecting: true`, `advisoryAffecting: false`. A
  three-way `computeThreeWay` where the base is CG0, the target has taken a
  **different** unrecognised `timing` locally, and the proposed is CG1
  produces a `conflict` on `data.timing` and feeds `nConf` — the ordinary
  engine-field rule, no `frames`-style carve-out.

Every ≤ v5 oracle digest is **pinned to a literal** in the fixture.

---

## R6-5. Per-side discrimination & validation order

`SEMANTICS-R5.md §R5-5` with a sixth version. Every step is **per side**.

1. **Normalise** the side's graph (`§R4.1` + `normalizeGraph()`).
2. **Defensive read** of `parameter` / `register` (`§R2-1.1`), routing
   (`§R3-1.1`), and `frames` (`§R5-1.1`). `timing` / `when` need **no**
   defensive read of their own (§R6-2.1 — nothing here is dropped or
   repaired; an unrecognised value is kept and projected as-is).
3. **Infer the version** from the result of step 2, by predicate, **CSU
   checked first**:
   - any `state` edge with a non-default `timing` / any `when` ⇒ **v6**;
   - else `frames` has ≥ 1 surviving entry ⇒ v5;
   - else `loop-revision/3` §R3-1 decides v3, then §R2-1 v2 / v1;
   - `loop-model/2` declaration is checked independently ⇒ the side is also
     `loop-revision/4` content.
4. **Verify the stored digest against the ORIGINAL version's projection** —
   a v1 side against `{ modelLayer: false }`; every v2 … v6 side against the
   **same** `{ modelLayer: true }` projection (optionally with the §M2-8
   discriminator). Verifying a v1 side directly with the v6 projection is
   forbidden, for the same reason `SEMANTICS-R5.md §R5-5.1` step 4 forbids it
   for v5 — this is exactly the check that used to be skipped for a
   CSU-only graph before this document (§R6-4, CG1's history).
5. **Lift** the verified content into the common **v6 compare model**. By
   R6-INV-2 this reproduces byte-identical output for a ≤ v5 side; the
   implementation **asserts** it (the same assertion that used to fail for a
   pure-CSU graph is now correct because step 3 recognises it).

---

## R6-6. `timing` / `when` in `dirty`, diff, and Apply

No new rule. `data.timing` / `data.when` are `engine`-tagged fields like any
other (`expr`, `flow`, `mode`, …):

- **`dirty`.** A `timing` / `when` change vs. the pinned base flips `dirty`.
- **Whole diff.** `computeRevisionDiff` reports each as an ordinary `changed`
  field of the edge's hunk, `tag: 'engine'`; a hunk with such a field sets
  `summary.engineAffecting`.
- **Whole / per-hunk Apply.** No special casing — a `change` hunk carrying a
  `data.timing` / `data.when` field goes through `computeThreeWay` /
  `buildSelectiveApply` exactly like any other field-level change, including
  the `OPTIONAL_PROJECTED_KEYS` "proposed: undefined removes the key" rule
  (both are in that set already, alongside `route` / `waypoints` /
  `resourceType` / `delay`).
- **`nConf`.** A divergent `timing` / `when` field is a `conflict` and is
  counted in `nConf` under the **existing** `change`-hunk rule — there is no
  `frames`-style (§R5-D9) exception to invent.

---

## R6-7. `loop-workspace/1` IS bumped

Unlike `frames` (§R5-8, never bumped — a labelled overlay contributes
nothing to `SimState`), `timing` / `when` **do** move the
`loop-workspace/1` semantic / engine digest (`src/model/workspace.ts`
`projectEdge` / `EdgeProjection`, independently maintained from
`src/model/revision.ts` but following the identical §R6-2 emission rule).
This is required for the stale-result check (`SEMANTICS-W.md` §W3.2) to
correctly mark a Monte Carlo result stale after a `timing` / `when` edit —
the run really would produce different numbers.

---

## R6-8. Explicitly NOT projected / NOT wire content

- `SEMANTICS-S3.md` §S3-4's `report.stateEvents` `applied` field, and every
  other per-step engine output — a computed **result**, never document
  content, exactly like `report.events` / clamp corrections are not
  projected today.
- the Inspector authoring UI for `timing` / `when` (CSU8 slice 3) and any of
  its session-only affordances (a combobox, a validity hint) — an editor
  contract, not wire content.
- re-validation of `timing` / `when` against `SEMANTICS-S3.md` §S3-5 — the
  projection carries the stored string verbatim (§R6-2.2); recognising it as
  valid or not is the engine's job at `step()` time, every step, not the
  revision layer's job at projection time.

---

## R6-D. Settled decisions

| id | decision |
|---|---|
| **R6-D1** | `timing` / `when` are per-edge `data` fields (already declared, trailing, on `EDGE_FIELDS.state`) — **not** a new top-level `CanonicalContent` key, unlike `frames`. |
| **R6-D2** | **No `schema` / `version` bump.** Additive, forward-compatible at the wire level; a pre-`loop-state/3` reader that somehow saw these keys would simply not understand them — out of scope for this codebase, which is both reader and writer. |
| **R6-D3** | **Verbatim, not re-validated.** The projection emits whatever string is stored (past the `phase0` / absent default), including one `SEMANTICS-S3.md` §S3-5 would reject. See §R6-2.2 for why the earlier "recognised-only" reading was wrong. |
| **R6-D4** | **`engine`, not `cosmetic`.** The opposite classification from `route` / `waypoints` (§R3-3) and `frames` (§R5-3) — deliberately, because these fields change what a step computes. No `nConf` carve-out is needed or added. |
| **R6-D5** | The CSU predicate (§R6-1) is checked **first**, ahead of `frames` / `loop-model/2` / routing, because it is the only one of the four that can be true on a graph with *none* of the others (a pure engine-only pity-counter). This ordering is a labelling convenience only — every v2 … v6 side shares one projection. |
| **R6-D6** | `loop-workspace/1` **is** bumped (contrast R5-D8) — `timing` / `when` are real inputs to what a run computes. |
