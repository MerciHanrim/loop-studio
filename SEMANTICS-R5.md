# Project Revision / Proposal — saved-frames extension

```
Spec ID: loop-revision/5
Status:  Frozen
```

**Frozen (2026-09-04).** The fixed target for LGR Slice 5 (saved group frames).
A behavioural change after this is a new spec id in a new document, exactly as
`loop-revision/1 → /2 → /3 → /4`. This file now takes only typo / clarifying
prose fixes. The *design* is `docs/large-graph-readability-saved-frames.md`
(`SF`); this document formalises it at the wire level and introduces no new
design beyond closing it.

Extends `SEMANTICS-R3.md` (`loop-revision/3`, Frozen) so the canonical revision
projection, its digest, the three-way diff, and Apply also cover the
**graph-level saved-frame block** — `GraphDoc.frames` — introduced by
`docs/large-graph-readability-frame-colour.md` (§FC) + Slices 4a/4b. It is
purely a labelled overlay: `id`, `label`, `rect`, optional `color`, **no
membership** (§LGR6.5). `loop-revision/4` (the `loop-model/2` declaration) is
orthogonal and untouched.

**No behavioural change to `loop-revision/1` … `/4`.** A graph with no `frames`
(or an empty / fully-quarantined `frames`) has a canonical projection, digest,
diff, and Apply **byte-identical** to before Slice 5 (R5-INV-2). Files, and only
files, are the transport.

**`loop-workspace/1` is not bumped** (§R5-8) — a saved frame adds nothing to
`SimState`, the restore contract, or the semantic (engine) digest.

---

## R5-0. Scope

**Added over `loop-revision/3` / `/4`:**

- a **wire-level version predicate** (§R5-1): a graph's content is
  `loop-revision/5` iff, after normalisation + the §R5-1.1 defensive read, the
  graph carries **≥ 1 valid `frames` entry** — inferred from content, never a
  stored header;
- the **extended canonical projection** (§R5-2): one new **trailing top-level
  key**, `frames`, on `CanonicalContent`, after `edges` and before the
  `loop-model/2` `modelSemantics` discriminator; emitted **only when non-empty**;
  a fixed per-entry field order `id`, `label`, `rect` (`x, y, w, h`), `color`;
  `color` emitted only when set;
- the **defensive read** for the `frames` block (§R5-1.1) — a bad entry is
  **dropped**, the graph is kept, no semantic field is touched;
- **`frames` is `cosmetic`** (§R5-3) — the existing tag beside `engine` /
  `advisory`; projected and diffable, **never** `engineAffecting`, **never**
  `advisoryAffecting`;
- the **conservative-extension guarantee** and its **golden vector** (§R5-4): a
  ≤ v4-content graph's v5 digest equals its ≤ v4 digest;
- the **validation order** — verify a v1 … v4 side with its own projection,
  then lift into the common v5 model (§R5-5);
- **`frames` behaviour** in `dirty` / whole diff / whole + per-hunk Apply / undo
  (§R5-6);
- the **round-trip preservation scope** — the valid `frames` **value** carried
  losslessly, canonical bytes stable after the first write (§R5-7);
- an explicit **"Workspace stays v1"** note (§R5-8);
- the explicit **non-projected** list (§R5-9).

**Not changed:** `SEMANTICS-R.md §R4.1` normalisation (finite numbers,
`-0 → 0`, **no rounding**, exact strings, missing-vs-default), §R4.3
`canonicalJson` (fixed key order, no whitespace, id-sorted arrays), §R4.4
`fullContentDigest`, §R7 Apply mechanics, §R7A classification, §R8 author-trust,
§R10 Import, and every prior `loop-revision/*` rule and invariant not restated
here.

**Out of scope:** the frame draw / rename / resize / colour UI and its undo
units (`docs/large-graph-readability-saved-frames.md` §SF11 — an editor
contract, not wire content); frame *membership* / grouping / auto-layout;
the derived **auto (suggested)** frame set (`autoFrameStore`), which is never
serialized and never a revision side.

---

## R5-1. Version inference — the wire-level predicate

Run **after** `normalizeGraph()` and the §R5-1.1 defensive read, on the
**normalised valid GraphDoc** — never on raw JSON, never on a stored header.
Evaluated **per graph** and **per side** of a proposal.

> A graph's content is **`loop-revision/5`** iff, after normalisation and the
> §R5-1.1 read, `frames` is an array with **≥ 1 surviving entry**. Otherwise it
> is whatever `loop-revision/3` / `/4` says.

- `frames` absent, `frames: []`, or a `frames` array every entry of which was
  dropped by §R5-1.1 ⇒ **not v5** — the graph projects and digests exactly as
  ≤ v4.
- The predicate is monotone: a v5 graph is also ≤ v4 in the earlier sense; all
  lift into one compare model (§R5-5).
- A v5 graph may **also** be `loop-revision/4` content (it declares
  `loop-model/2`). The two discriminators are independent and both appear in
  the projection — `modelSemantics` (from `/4`) and a non-empty `frames`
  (from `/5`).

### R5-1.1 Defensive read of the `frames` block

`GraphDoc.frames` is read defensively, **before** projection and the predicate:

| input | result |
|---|---|
| `frames` absent, not an array, or `[]` | **no frames.** `[]` normalises to absent. |
| entry is not a plain object | **entry dropped** + one warning. |
| `rect` missing, or any of `rect.x / y / w / h` is not `typeof "number"` / not `Number.isFinite` | **entry dropped** + one warning. |
| `rect.w <= 0` or `rect.h <= 0` | **entry dropped** + one warning. |
| an accepted `rect` | `x, y, w, h` kept **verbatim** at full `Number` precision (`§R4.1`: `-0 → 0`, **no rounding**). No clamping — an off-canvas frame is user intent, like a node `position`. |
| `id` a non-empty string, unique among already-kept entries | kept as-is. |
| `id` missing / empty / not a string / a duplicate of an already-kept id | a **fresh session id** is assigned on read (`frame_…`); the entry is otherwise kept. The *file's* id string is never trusted for identity. |
| `label` not a string | coerced with `String(...)`. |
| `label` longer than `SF_LABEL_MAX` (**120** UTF-16 units) | truncated to 120. |
| `color` one of `"slate" | "sage" | "gold" | "violet" | "rose"` | kept. |
| `color` any other value (or absent) | the `color` key is **omitted**; the entry stays (neutral). |
| more than `SF_FRAMES_MAX` (**200**) entries survive the above | entries past index 199 (file order) are **dropped** + one warning. |
| the session `n` ordinal | **never read from the file.** Re-derived on load as the 1-based index in surviving file order (`SF` §SF6). |

A drop is **frames-only quarantine**: every node, edge, and semantic field is
untouched, the graph opens, and — as under `loop-revision/2` §R2-5.1 / R3-1.1 —
a `project` / `proposal` payload that contained such a block routes **graph-only
+ warning**, never Review / Apply, if its stored `contentDigest` no longer
matches the quarantined GraphDoc. Warnings are deterministic: dropped entries in
surviving-then-original file order, one line each, then the over-cap line (if
any), then any earlier `loop-revision/*` line.

---

## R5-2. The extended canonical projection

`loop-revision/5` adds **one** trailing key to `CanonicalContent`. Nothing in
`§R4`, `§R2-2`, or `§R3-2` moves.

### R5-2.1 The `frames` key — exact shape

`CanonicalContent` key order:

```
{ nodes, edges, recommendedRunConfig?, frames?, modelSemantics? }
```

- `frames` sits **after** `recommendedRunConfig` and **before**
  `modelSemantics` (the `loop-model/2` discriminator, `SEMANTICS-M2.md §M2-8`).
- Emitted **iff** ≥ 1 entry survives §R5-1.1 **and** the projection is run under
  the v5 model (`modelLayer` true — see §R5-5). Under the literal v1 / v2
  projection it is **never** emitted.
- The value is a JSON array in **surviving file order** (the read fixed the
  order; the projection does **not** re-sort — a frame array has no natural key
  and order is user intent, like `waypoints`, §R3-2.2).
- Each element is the object, keys in this order:

  | key | emitted when | value |
  |---|---|---|
  | `id` | always | the surviving id string (see §R5-1.1 — a file-clashing id was replaced on read; the projection sees the resolved id) |
  | `label` | always | the normalised string (`""` allowed) |
  | `rect` | always | `{ "x": <n>, "y": <n>, "w": <n>, "h": <n> }`, keys in that order, each `<n>` by `canonicalJson`'s number rule (verbatim `String(n)` for a finite float64 after `§R4.1`) |
  | `color` | `color` is one of the five palette ids | the string |

  `color` neutral ⇒ the key is **absent** — a neutral frame's projected object
  is `{ id, label, rect }` exactly.

### R5-2.2 Everything else is unchanged

`node(n)` / `edge(e)` shape, `position`, the id-sorted `nodes` / `edges`
arrays, `canonicalJson` (fixed key order — `frames` slots in at the position
above), and `fullContentDigest = SHA-256(UTF-8(canonicalJson(canonicalContent
(doc))))` are all as `SEMANTICS-R.md §R4` / `SEMANTICS-R2.md §R2-2.3` /
`SEMANTICS-R3.md §R3-2.3`.

There is **one** `canonicalContent`. Given a graph with no surviving `frames`
it emits the ≤ v4 bytes (R5-INV-2); given a v5-content graph it emits those
bytes plus the one trailing `frames` array.

---

## R5-3. Field tag — `frames` is `cosmetic`

`loop-revision/2 §R2-3` defines `engine` / `cosmetic` / `advisory`. A saved
frame is a labelled overlay — it changes no value the model computes or
displays — so it is `cosmetic`, alongside `label`, `position`, `route`,
`waypoints`:

| field | tag | in projection & diff? | sets `engineAffecting`? | sets `advisoryAffecting`? |
|---|---|---|---|---|
| `frames` (the whole graph-level array) | `cosmetic` | yes | **no** | **no** |

- Editing `frames` — adding, renaming, resizing, recolouring, deleting a
  frame, or `Clear all frames` — is full revision content: it flips `dirty`,
  mints a new `revisionId` on export, produces a diff hunk, and its conflicts
  feed `nConf` — exactly as a `label` rename does under `loop-revision/1`.
- It **never** sets `summary.engineAffecting` and **never** sets
  `summary.advisoryAffecting`. A `RevisionDiff` whose only change is `frames`
  is *not* `summary.empty`, is neither engine- nor advisory-affecting, and a
  Review UI labels it a **"frames"** / *"cosmetic"* change.
- The `frames` array is a **single top-level field**: the diff for it is one
  hunk on the pseudo-element `graph` (or the existing top-level bucket the
  diff uses for `recommendedRunConfig`-class content), `base` = the old array,
  `proposed` = the new array. Per-entry granularity is a UI nicety, **not** a
  wire rule — the wire diff compares the whole projected `frames` array.

---

## R5-4. Conservative extension, and the golden vector

**R5-INV-2 — conservative extension.** Run `canonicalContent` over a normalised
graph that **fails §R5-1** (no surviving `frames`): the output is
**byte-identical** to the ≤ v4 projection of the same graph, so
`fullContentDigest` is identical under either reading. Adding saved frames to
the codebase does **not** move any existing file's digest.

**The golden vector.** `examples/revision-v5/` + `test/revision-v5-fixture.test.ts`,
mirroring `examples/revision-v3/`:

- **SG0** — a ≤ v4-content graph (may declare `loop-model/2`), **no `frames`**.
  Assert `digest_v5(SG0) === digest_v4(SG0)`, both equal the value the shipped
  ≤ v4 implementation produces (**pinned**), and the v5 predicate agrees it is
  **not** v5.
- **SG1** — SG0 with **two** `frames` entries (one with `color`, one neutral).
  Assert: it infers **v5**; `digest_v5(SG1) !== digest_v4(SG1)`; the projected
  `frames` array is exactly `[{id,label,rect}, {id,label,rect,color}]` in file
  order with the §R5-2.1 key order; every node / edge byte is unchanged from
  SG0; `computeRevisionDiff(SG0, SG1)` = **one** `changed` hunk on `frames`,
  `cosmetic`, `engineAffecting: false`, `advisoryAffecting: false`,
  `empty: false`; the engine / MC / `R(t)` digests equal SG0's.
- **SG2 — the v4 → v5 → v4 digest return.** SG1 with every frame removed
  (`frames` key gone on write). Assert SG2 fails the v5 predicate and
  `digest_v5(SG2) === digest_v4(SG2) === digest_v4(SG0)`;
  `computeRevisionDiff(SG1, SG2)` is one `changed` hunk removing `frames`.
- **SG3 — malformed `frames`.** A file whose `frames` carries a `NaN`
  `rect.x`, a `rect.h: 0`, an unknown `color`, a numeric `id`, a duplicate
  `id`, a 130-char `label`, and (in a second fixture) 201 entries. Assert each
  bad entry is dropped / normalised per §R5-1.1, one warning per drop in the
  defined order, the good entry survives with a resolved id + a 120-char
  label + no `color`, and after the read the side infers v5 iff a good entry
  remained; the `contentDigest` is verified against the **quarantined**
  GraphDoc; a mismatch drops the whole `project` / `proposal` (graph-only +
  warning).
- **SG4 — the v4 ↔ v5 combinations** replayed through `computeThreeWay` /
  `buildSelectiveApply` / `validateResultGraph`: a v4 base with a v5 proposed
  (`frames` hunk applies, no engine field touched); a v5 base with a v4
  proposed (`frames` hunk removes the array, digest returns); v5 ↔ v5 full
  three-way with a `frames` reorder / relabel feeding `nConf`; ≤ v4 ↔ ≤ v4
  unchanged from `loop-revision/3` / `/4`.
- **SG5 — `loop-workspace/1` round-trip** (§R5-8): step SG1, build a workspace
  payload, `readWorkspace`; assert the `workspace.simulation` key set is
  unchanged and contains **no** `frames`, the pool state + step restore, and
  the graph's `frames` are intact from the embedded GraphDoc.

Every ≤ v4 oracle digest is **pinned to a literal** in the fixture.

---

## R5-5. Per-side discrimination & validation order

`SEMANTICS-R3.md §R3-5` with a fifth version. Every step is **per side**.

### R5-5.1 The ordered pipeline

1. **Normalise** the side's graph (`§R4.1` + `normalizeGraph()`).
2. **Defensive read** of every `parameter` / `register` (`§R2-1.1`), every
   edge's routing payload (`§R3-1.1`), **and** the graph-level `frames` block
   (§R5-1.1). A bad `frames` entry is **dropped** here — every semantic field
   intact.
3. **Infer the version** from the *result of step 2*, by predicate:
   - `frames` has ≥ 1 surviving entry ⇒ **v5**;
   - else `loop-revision/3` §R3-1 decides v3, then `§R2-1` v2 / v1;
   - `loop-model/2` declaration is checked independently ⇒ the side is also
     `loop-revision/4` content (`SEMANTICS-M2.md §M2-8`).
   A `frames` block whose entries were all dropped leaves **nothing**, so a
   file whose only "v5 signal" was a broken block infers as ≤ v4.
4. **Verify the stored digest against the ORIGINAL version's projection:**
   - a **v1** side → `{ modelLayer: false }` literal v1 projection;
   - a **v2 / v3** side → that projection (no `frames`);
   - a **v4** side → the v4 projection (`modelSemantics`, no `frames`);
   - a **v5** side → the v5 projection (`frames` included).
   Verifying a ≤ v4 side **directly with the v5 projection is forbidden**.
5. **Lift** the verified content into the common **v5 compare model** — the
   trailing `frames` key defaults to **absent** where the side did not carry a
   surviving block. By R5-INV-2 this reproduces byte-identical output for a
   ≤ v4 side; the implementation **asserts** it.

There is **no** version-mismatch "refuse" branch: every same-project v1 … v5
combination is compared under the one common v5 projection. The only
apply-time refusal remains the `§R7A.1` different-`projectId` gate.

### R5-5.2 Post-quarantine `contentDigest` & the project header

`SEMANTICS-R3.md §R3-5.2`, unchanged, with "quarantined GraphDoc" now also
meaning "after the §R5-1.1 `frames` read". `contentDigest` is REQUIRED in a
valid `loop-revision/2`+ file; a mismatch against the normalised
(post-quarantine) GraphDoc drops the whole `project` / `proposal` payload
(graph-only + warning). `base.content` and proposed content are verified
**independently**.

---

## R5-6. `frames` in `dirty`, diff, and Apply

`frames` is full revision content (`cosmetic`) — the only thing separating it
from `engine` fields is that it sets neither `engineAffecting` nor
`advisoryAffecting`.

- **`dirty`.** Any `frames` change vs. the pinned base flips `dirty`, exactly
  as a `label` rename does.
- **Whole diff.** `computeRevisionDiff` emits **one** `frames` hunk when the
  projected arrays differ: `{ field: "frames", base: <array | absent>,
  proposed: <array | absent>, tag: "cosmetic", engineAffecting: false,
  advisoryAffecting: false }`.
- **Whole Apply.** Adopts the proposed `frames` array wholesale (or removes it
  when the proposed side has none). Never touches a node / edge / value.
- **Per-hunk Apply.** The `frames` hunk is one selectable unit — applying it
  swaps the whole array; not applying it keeps the base array. There is no
  sub-entry hunk on the wire.
- **`nConf`.** A `frames` conflict (base and both sides changed the array
  divergently) feeds `nConf` like a `label` conflict; it never makes the
  merge `engineAffecting`.
- **Undo.** Editor-side only, `docs/large-graph-readability-saved-frames.md`
  §SF11 — not a wire rule. A frame undo entry restores the `frames` array to
  its prior state and moves the `loop-revision/5` cosmetic digest, never the
  engine digest.

---

## R5-7. Round-trip preservation scope

- A **valid** `frames` entry's `id` (as resolved on read), `label` (post-cap),
  `rect` (verbatim finite numbers), and `color` (a palette id or absent)
  round-trip `Import → Export` **canonical-byte-identical** after the first
  write. `n` is not on the wire.
- A **quarantined** entry is **gone** after the first write — the export is the
  clean file.
- Arbitrary input formatting / key order is not preserved (there is one
  canonical form); the *value* is.

---

## R5-8. `loop-workspace/1` is not bumped

A saved frame adds **nothing** to `SimState`, the `loop-workspace/1` restore
contract, or the semantic (engine) digest. A `frames` block rides inside the
embedded GraphDoc of a workspace file and restores with the graph, **before**
the `SimState` restore. `workspace.simulation` carries no `frames`. Re-confirmed
by SG5.

---

## R5-9. Explicitly NOT projected / NOT wire content

- the session `n` ordinal, `selectedId`, `toolArmed`, `nextN`;
- the **auto (suggested)** frame set (`autoFrameStore`) — derived, never
  serialized, never a revision side;
- any computed render geometry (the drawn rect after zoom, the label chip
  position, the swatch row);
- the frame draw / rename / resize / colour **UI** and its undo units
  (`docs/large-graph-readability-saved-frames.md` §SF11);
- `frames` under `recommendedRunConfig` (it is real document content, not an
  advisory run default).

---

## R5-D. Settled decisions

| id | decision |
|---|---|
| **R5-D1** | `frames` is **graph-level**, one trailing `CanonicalContent` key after `recommendedRunConfig`, before `modelSemantics`. Not per-node, not per-edge, not under `recommendedRunConfig`. |
| **R5-D2** | **No `schema` / `version` bump.** `frames` is additive, forward-compatible, `cosmetic`. A pre-v5 reader ignores the key and loses only the overlay; on its next save it drops `frames` (frames only — never a node / edge / value). Accepted (`SF` §SF5). |
| **R5-D3** | **No `members`.** 4a/4b removed the membership model; the §LGR6.4 sketch's `members` is not carried. |
| **R5-D4** | Only **`frameStore.frames`** (manual + promoted) is serialized. A pure suggested frame is never wire content (§R5-9). |
| **R5-D5** | Defensive read drops a bad **entry**, never the graph; a file-clashing `id` is replaced on read; `SF_LABEL_MAX = 120`, `SF_FRAMES_MAX = 200`; `rect` kept verbatim (no clamp). |
| **R5-D6** | `frames` array order is **file order**, not re-sorted — user intent, like `waypoints`. |
| **R5-D7** | The wire diff compares the **whole** projected `frames` array as one `cosmetic` hunk; per-entry granularity is UI-only. |
| **R5-D8** | `loop-workspace/1` not bumped; `SimState` / engine digest unaffected. |
