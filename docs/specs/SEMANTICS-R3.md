# Project Revision / Proposal — edge-routing extension

```
Spec ID: loop-revision/3
Status:  Frozen
```

**Frozen (2026-08-30, rev 2).** This document is the fixed target for the
edge-routing implementation (Slice 1 = `route` mode + auto routing; Slice 2 =
the manual-waypoint UI). A behavioural change after this is a new spec id in a
new document (`loop-revision/4`), exactly as `loop-revision/1 → /2 → /3`; this
file now only takes typo / clarifying-prose fixes. §R3-D records the settled
decisions R3-D1…R3-D7. Rev 2 folded in the four pre-Freeze boundaries: the
per-side v2/v3 discrimination + verify-own-projection-first order with the four
v2↔v3 acceptance vectors (§R3-5); `resourceType` **removed** from the
`state`-edge canonical row (§R3-2.1); "byte-for-byte" narrowed to
canonical-bytes / lossless-value (§R3-7, R3-INV-9); and the post-quarantine
`contentDigest` / project-header rule (§R3-5.2).

Extends `SEMANTICS-R2.md` (`loop-revision/2`, Frozen) so
the canonical revision projection, its digest, the three-way diff, and Apply
also cover the **edge-routing user-intent fields** introduced by
`docs/edge-routing.md` — `edge.data.route` and `edge.data.waypoints`. The
*approach* is fixed in that design doc (ER-D2, §ER6); this document formalises
it at the wire level and introduces no new design beyond closing the §R3-D
boundaries. It is the fixed target for the routing implementation
(Slice 1 = mode + auto routing; Slice 2 = the waypoint UI).

**No behavioural change to `loop-revision/1` or `/2`.** A graph whose edges
carry no routing intent (§R3-1) has a canonical projection, digest, diff, and
Apply that are **byte-identical** to `loop-revision/2` today (R3-INV-2). Files,
and only files, are the transport. Every rule is computable from the file in
hand plus the open document.

**`loop-workspace/1` is not bumped** (§R3-8, R3-INV-8) — routing adds nothing
to `SimState`, the restore contract, or the semantic digest.

**The computed route is never wire content.** The orthogonal path (`d`), its
bends and corner points, the `routeClass`, the `routeMapKey` / router cache, and
`ROUTER_VERSION` are **render-time only** and appear in **no** projection,
digest, diff, file, Share link, or Workspace payload (§R3-9). Only the user's
*intent* — which mode, and any pinned points — is stored.

`SEMANTICS.md`, `SEMANTICS-B1.md`/`-B2.md`, `SEMANTICS-S.md`/`-S2.md`,
`SEMANTICS-X.md`, `SEMANTICS-M.md`, `SEMANTICS-U.md` are unaffected.
`docs/visual-language.md` §VL6 and `docs/edge-routing.md` describe the
*rendering*; this file fixes only the *wire contract*.

---

## R3-0. Scope

**Added over `loop-revision/2`:**

- a **wire-level version predicate** (§R3-1): a graph's content is
  `loop-revision/3` iff any edge carries a non-default `route` / `waypoints` —
  **inferred from normalised content, never stored in a header**;
- the **extended edge projection** (§R3-2): two new trailing
  `EDGE_FIELDS_BY_KIND` keys, `route` then `waypoints`, on **both** the
  `resource` and the `state` edge, emitted only when non-default, in a fixed
  order; a fixed canonical form for the `waypoints` point list;
- the **defensive read** for the routing payload (§R3-1.1) — a bad `route` /
  `waypoints` is quarantined **without touching the edge's semantic fields**;
- **`route` / `waypoints` are `cosmetic`** (§R3-3) — the existing tag beside
  `engine` / `advisory`; projected and diffable, **never** `engineAffecting`,
  **never** `advisoryAffecting`;
- the **conservative-extension guarantee** and its **golden vector** (§R3-4):
  a v2-content graph's v3 digest equals its v2 digest;
- the **validation order** — verify a v1/v2 side with its own projection, then
  lift into the common v3 model (§R3-5);
- **routing-field behaviour** in `dirty` / whole diff / whole + per-hunk Apply /
  undo (§R3-6);
- the **round-trip preservation scope** — the valid routing **value** carried
  losslessly, canonical bytes stable after the first write, *not* arbitrary
  input bytes (§R3-7, R3-INV-9);
- an explicit **"Workspace stays v1"** note (§R3-8);
- the explicit **non-projected** list (§R3-9).

**Not changed:** `SEMANTICS-R.md §R4.1` normalisation (finite numbers,
`-0 → 0`, **no rounding**, exact UTF-8 strings, missing-vs-explicit-default),
§R4.3 `canonicalJson` (fixed key order, no whitespace, id-sorted arrays), §R4.4
`fullContentDigest`, §R7 Apply mechanics, §R7A classification, §R8 author-trust,
§R10 Import routing, R-INV-1…R-INV-13, and every `loop-revision/2` rule and
invariant (R2-INV-1…R2-INV-11) not restated here.

**Out of scope:** the routing algorithm, its constants, the cache key, and the
rendered `d` — all in `docs/edge-routing.md`, none of it wire content;
orthogonal routing of anything other than an edge path (no node re-layout);
an *explicit* stored `route: "bezier"` (a default is the absence of the field —
§R3-1 / ER-D16 — and changing that is a separate amendment).

---

## R3-1. Version inference — the wire-level predicate

Run **after** `normalizeGraph()` and the §R3-1.1 defensive read, on the
**normalised valid GraphDoc** — never on raw JSON, never on a stored header.
Evaluated **per graph** and **per side** of a proposal, exactly like the
`loop-revision/1 → /2` predicate (R2-INV-1).

> A graph's content is **`loop-revision/3`** iff, after normalisation, **any**
> edge has `data.route === "orthogonal"` **or** a non-empty `data.waypoints`
> array. Otherwise it is whatever `loop-revision/2` says (v1 or v2).

- A `route` that normalises to absent (an explicit `"bezier"` — §R3-1.1) does
  **not** make a graph v3.
- An empty `waypoints: []` normalises to absent and does **not** make a graph
  v3.
- `waypoints` present on an edge whose `route` is not `"orthogonal"` is
  **dropped** at read (§R3-1.1) and does not count.
- The predicate is monotone with `/2`: a v3 graph is also v2-or-v1 in the
  `loop-revision/2` sense; the three lift into one compare model (§R3-5).

### R3-1.1 Defensive read of the routing payload (`§ER4-DR`)

The **routing payload** of an edge is the pair (`data.route`, `data.waypoints`).
It is read defensively, **before** projection and the predicate:

| input | result |
|---|---|
| `route` absent | Bézier — canonical. |
| `route === "bezier"` | **normalised to absent.** The writer never emits it (R3-INV-1); a reader that receives it drops it. |
| `route === "orthogonal"` | kept. |
| `route` any other value (number, `null`, `"Orthogonal"`, …) | the **whole routing payload is dropped** (`route` → absent, `waypoints` → dropped) + one import warning. |
| `waypoints` absent / `[]` | none. `[]` normalises to absent. |
| `waypoints` present **and** `route !== "orthogonal"` | `waypoints` **dropped** + one warning. |
| `waypoints` not an array, or `length > MAX_WAYPOINTS_PER_EDGE` (64) | **whole routing payload dropped** + one warning. |
| `waypoints` contains a non-object entry, or an entry whose `x` or `y` is not `typeof "number"` / not `Number.isFinite` | **whole routing payload dropped** + one warning. |
| an accepted `{ x, y }` | `x`, `y` kept **verbatim** at full `Number` precision (`§R4.1`: `-0 → 0`, **no rounding**). Duplicate and collinear points are **kept** — they are user intent. |

A drop is **routing-only quarantine**: the edge itself and its `id`, `source`,
`target`, `sourceHandle`, `targetHandle`, `kind`, `flow`, `resourceType`,
`mode`, `expr`, `delay`, and every other semantic field are **preserved**, the
graph opens, and — as under `loop-revision/2` §R2-5.1 for a malformed model
node — a `project` payload that contained such an edge routes **graph-only +
warning**, never Review / Apply. This mirrors `loop-model/1 §M1` and
`graphStructureIssues`. The warning list is deterministic (edges in `id`
order, one line per dropped payload).

---

## R3-2. The extended canonical projection

`loop-revision/3` extends `SEMANTICS-R2.md §R2-2.2`'s `resource` / `state`
edge rows. Nothing else in `§R4` or `§R2-2` moves.

### R3-2.1 Extended edge rows — exact field order

| kind | `data` fields, **in this order** |
|---|---|
| `resource` edge | `kind`, `flow`, `resourceType`, **`route`**, **`waypoints`** |
| `state` edge | `kind`, `mode`, `expr`, `delay`, **`route`**, **`waypoints`** |

- The `resource`-edge row is `SEMANTICS-R2.md §R2-2.2`'s order with the two new
  keys appended.
- The `state`-edge row is `SEMANTICS-S2.md`'s frozen `EDGE_FIELDS_BY_KIND`
  order with **only** `route`, `waypoints` appended. **`resourceType` is NOT a
  `state`-edge field** — it is agreed advisory content for `pool` and the
  `resource` edge only (`loop-model/1 §M4` / `loop-revision/2 §R2-2.2`).
  Introducing `resourceType` on a `state` edge would be new, routing-unrelated
  wire semantics and needs its own `loop-model` amendment; `loop-revision/3`
  does not do it.

`route` and `waypoints` are the **last two keys** of the edge `data` object,
`route` before `waypoints`, and each is emitted **only when non-default**:

| field | emitted when | value in the projection |
|---|---|---|
| `route` | `=== "orthogonal"` after §R3-1.1 | the string `"orthogonal"` |
| `waypoints` | a non-empty array survives §R3-1.1 **and** `route === "orthogonal"` | the array in **wire order, not deduped** (§R3-2.2) |

A default edge (`route` absent, no `waypoints`) emits **neither** key — its
projected `data` object is byte-identical to its `loop-revision/2` projection
(R3-INV-2). Never `"route": "bezier"`, never `"waypoints": []`, never `null`.

### R3-2.2 `waypoints` canonical form

- The value is a JSON array, **in the stored order**, one element per waypoint.
  It is **not** sorted, **not** deduplicated, and **not** collinear-collapsed —
  those are *render* steps on the derived path (`docs/edge-routing.md` §ER3.5),
  never on wire content.
- Each element is the object `{ "x": <n>, "y": <n> }` with keys in that order.
- `<n>` is written by `canonicalJson`'s existing number rule — verbatim
  `String(n)` for a finite float64, after `§R4.1` (`-0 → 0`, no rounding). A
  waypoint coordinate therefore round-trips `Import → Export`
  **byte-identical**.
- `MAX_WAYPOINTS_PER_EDGE` (64) is enforced at read (§R3-1.1); by the time the
  projection runs, every `waypoints` array is `1..64` finite points.

### R3-2.3 Everything else is unchanged

`node(n)` / `edge(e)` shape, `position` (`norm`, no rounding), the id-sorted
`nodes` / `edges` arrays, `canonicalJson` (fixed key order — the two new keys
slot in at the positions above), and
`fullContentDigest = SHA-256(UTF-8(canonicalJson(canonicalContent(doc))))` are
all as `SEMANTICS-R.md §R4` / `SEMANTICS-R2.md §R2-2.3`.

There is **one** `canonicalContent`. Given a graph with no routing intent it
emits the `loop-revision/2` bytes (R3-INV-2); given a v3-content graph it emits
those bytes for every shared element plus the two trailing keys on the edges
that carry intent.

---

## R3-3. Field tags — `route` / `waypoints` are `cosmetic`

`loop-revision/2 §R2-3` defines `engine` / `cosmetic` / `advisory`. Routing
intent is **pure presentation** — it changes no value the model computes or
displays — so it is `cosmetic`, alongside `label` and `position`:

| field | tag | in projection & diff? | sets `engineAffecting`? | sets `advisoryAffecting`? |
|---|---|---|---|---|
| `edge.data.route` | `cosmetic` | yes | **no** | **no** |
| `edge.data.waypoints` | `cosmetic` | yes | **no** | **no** |

- Editing `route` / `waypoints` is full revision content: it flips `dirty`,
  mints a new `revisionId` on export, produces a `changed`-field diff hunk, and
  its conflicts feed `nConf` — exactly as a `label` rename or a node move does
  under `loop-revision/1`.
- It **never** sets `summary.engineAffecting` and **never** sets
  `summary.advisoryAffecting`. A `RevisionDiff` whose only changes are
  `route` / `waypoints` is *not* `summary.empty`, is neither engine- nor
  advisory-affecting, and a Review UI labels it a **"routing"** / *"cosmetic"*
  change.
- Adding or removing an **edge** is already `engine`-affecting under
  `loop-revision/1` (an edge is engine structure); carrying `route` /
  `waypoints` on a new edge does not change that classification.

---

## R3-4. Conservative extension, and the golden vector

**R3-INV-2 — conservative extension.** Run `canonicalContent` over a
normalised graph that **fails §R3-1** (no edge has `route: "orthogonal"` or a
non-empty `waypoints`): the output is **byte-identical** to the
`loop-revision/2` projection of the same graph, so `fullContentDigest` is
identical under either reading. Adding the routing feature to the codebase does
**not** move any existing file's digest.

**The golden vector.** `examples/revision-v3/` + `test/revision-v3-fixture.test.ts`
(R3-D3), mirroring `examples/revision-v2/`:

- **RG0** — a v2-content graph (a `parameter`, a `register`, a `resourceType`,
  no routing intent). Assert `digest_v3(RG0) === digest_v2(RG0)`, both equal
  the value the shipped `loop-revision/2` implementation produces (**pinned**),
  and `isModelLayerContent` / the v3 predicate agree it is **not** v3.
- **RG1** — RG0 with **one** edge set `route: "orthogonal"` and **one** other
  edge given a 3-point `waypoints`. Assert: it infers **v3**;
  `digest_v3(RG1) !== digest_v2(RG1)`; the two changed edges' projected `data`
  gain exactly the trailing keys in order (`{x, y}` per point);
  every other element's bytes are unchanged from RG0;
  `computeRevisionDiff(RG0, RG1)` = two `changed` hunks (`data.route`,
  `data.waypoints`), both `cosmetic`, `engineAffecting: false`,
  `advisoryAffecting: false`, `empty: false`.
- **RG2 — the v2 → v3 → v2 digest return.** RG1 with the `route` edge switched
  back to Bézier (both keys removed) and the `waypoints` edge emptied. Assert
  RG2 fails the v3 predicate and
  `digest_v3(RG2) === digest_v2(RG2) === digest_v2(RG0)` — the round-trip to
  default is **exact** (ER-D16 / R3-D5), and `computeRevisionDiff(RG1, RG2)`
  is two `changed` hunks removing the keys.
- **RG3 — malformed `proposed`.** A proposal file whose **proposed content**
  carries a broken payload (a 65-entry `waypoints`, a `NaN` coord, `route: 3`,
  `waypoints` with `route` absent). Assert every broken payload is quarantined,
  one warning per edge in ascending `id` order, the edges + every semantic
  field survive, the proposed side then infers v2 (nothing v3 survived), and
  its `contentDigest` is verified against the **quarantined** GraphDoc; a
  mismatch drops the whole proposal (graph-only + warning).
- **RG4 — malformed `base`.** The same proposal but the break is in
  `base.content`. Assert `base.content` is verified **independently** (§R3-5.2)
  and its failure drops the **whole** proposal payload — no partial trust.
- **RG5 — the four v2 ↔ v3 combinations (§R3-5.3 RV-1…RV-4)** replayed through
  `computeThreeWay` / `buildSelectiveApply` / `validateResultGraph`: a v2 base
  with a v3 proposed (routing hunks apply, no engine field touched); a v3 base
  with a v2 proposed (routing hunks remove keys, digest returns); v3↔v3 full
  three-way with a `waypoints` reorder feeding `nConf`; v2↔v2 unchanged from
  `loop-revision/2`.
- **RG6 — `loop-workspace/1` round-trip** (§R3-8): step RG1, build a workspace
  payload, `readWorkspace`; assert the `workspace.simulation` key set is
  unchanged, contains **no** `route` / `waypoints`, the pool state + step
  restore, and the graph's `route` / `waypoints` are intact from the embedded
  GraphDoc.

Like `loop-revision/2 §R2-4`, every v2 oracle digest is **pinned to the value
the shipped `loop-revision/2` implementation produces**, so a drift in either
projection fails the fixture.

---

## R3-5. Per-side discrimination & validation order

The order below is `loop-revision/2 §R2-5` / R2-INV-3 with a third version.
Every step is **per side** — a graph, a revision file, and each of a proposal's
`base.content` and proposed content are all "a side".

### R3-5.1 The ordered pipeline

1. **Normalise** the side's graph (`SEMANTICS-R.md §R4.1` + `normalizeGraph()`).
2. **Defensive read** of every `parameter` / `register` (`loop-revision/2
   §R2-1.1`) **and** every edge's routing payload (§R3-1.1). A bad routing
   payload is **quarantined** here — `route` / `waypoints` gone, the edge and
   its semantic fields intact.
3. **Infer the version** from the *result of step 2*, by predicate:
   - any edge with a **surviving** `route: "orthogonal"` or non-empty
     `waypoints` ⇒ **v3**;
   - else, `loop-revision/2 §R2-1` decides **v2** or **v1**.
   A routing payload that was quarantined in step 2 leaves **no** field behind,
   so a file whose only "v3 signal" was a broken payload infers as **v2**
   (or v1).
4. **Verify the stored digest against the ORIGINAL version's projection:**
   - a **v1** side → `{ modelLayer: false }` literal v1 projection;
   - a **v2** side → the v2 projection;
   - a **v3** side → the v3 projection.
   Verifying a v1 or v2 side **directly with the v3 projection / digest is
   forbidden** — a latent gap would misflag a valid older file as tampered
   (R-INV-6, carried forward).
5. **Lift** the verified content into the common **v3 compare model** — add the
   trailing `route` / `waypoints` keys as *default* (absent) where the side
   did not carry them. By R3-INV-2 / R2-INV-2 this reproduces byte-identical
   output for a non-v3 side; the implementation **asserts** it rather than
   assuming it.

There is **no** version-mismatch "refuse" branch (R2-INV-6): every same-project
v1 / v2 / v3 combination is compared under the one common v3 projection. The
only apply-time refusal remains the `§R7A.1` different-`projectId` gate.

### R3-5.2 Post-quarantine `contentDigest` & the project header

After step 2 quarantines a routing payload, step 4 verifies against the
**normalised, quarantined** GraphDoc:

- **`contentDigest` is REQUIRED in a valid `loop-revision/3` file** (as it is
  for `loop-revision/2` — `SEMANTICS-R.md §R10` / `R-INV`). A `project` /
  `proposal` payload that carries a `contentDigest` which does **not** match
  the normalised (post-quarantine) GraphDoc's `fullContentDigest` ⇒ **the whole
  `project` / `proposal` payload is dropped, the graph opens graph-only +
  warning.** This is the existing `loop-revision/*` tamper response; routing
  quarantine does not weaken it.
- **A legacy file with no `contentDigest`** (an early `loop-revision/1`
  optional-digest file) keeps its existing `loop-revision/1` treatment — the
  header is read but the content is trusted un-verified per that spec's rule.
  If such a file *also* carries a routing payload it is, by definition, not a
  clean v1 file; after the routing payload is quarantined it is treated as the
  v1-with-optional-digest file it now is (header kept, unverified). A
  `loop-revision/2` or `/3` file **must** carry the digest, so this only ever
  applies to genuinely old inputs.
- **A proposal verifies `base.content` and the proposed content
  INDEPENDENTLY** by steps 1–4 above. Either failing its own digest drops the
  **whole** proposal payload (graph-only + warning); a partial trust is never
  produced.
- **Warnings are deterministic** — one line per quarantined edge in ascending
  edge `id` order, then the digest-mismatch line (if any), then any
  `loop-revision/2 §R2-5.1` line.

### R3-5.3 The four v2 ↔ v3 combinations — acceptance vectors

Fixed, mirroring `loop-revision/2 §R2-7`. "base" = the pinned base a proposal
was authored against; "target" = the recipient's open document.

| # | base | proposed / target | result |
|---|---|---|---|
| **RV-1** | v2 | v2 | identical to `loop-revision/2` today. The v3 projection of each side ≡ its v2 projection ≡ same bytes / digest (R3-INV-2). No `route` / `waypoints` hunk. |
| **RV-2** | v2 | **v3** (proposed adds routing) | `base.content` is v2 → verify v2; proposed is v3 → verify v3. The diff shows `changed` hunks `data.route` / `data.waypoints`, **`cosmetic`**-tagged, `engineAffecting: false`, `advisoryAffecting: false`, `empty: false`. Whole Apply adopts them; per-hunk Apply applies only the selected routing hunks. Applying them does **not** touch any engine field. |
| **RV-3** | **v3** | v2 (proposed / target drops back to Bézier) | verify v3 base, v2 other side. The diff shows `changed` hunks removing `route` / `waypoints` (`base` = the value, `proposed` = absent). Whole Apply produces a graph that **fails §R3-1** and whose digest returns **exactly** to the v2 value for those elements (ER-D16). |
| **RV-4** | **v3** | **v3** | full three-way over the v3 projection; `route` / `waypoints` diff and feed `nConf` like `label`; `engine` / `advisory` / `cosmetic` fields all diffable. |

In every combination, "v2 file" also covers "a v3 file whose routing payloads
were all quarantined" — after step 2 it *is* a v2 file, and its v3 digest
equals its v2 digest (R3-INV-2).

---

## R3-6. `route` / `waypoints` in `dirty`, diff, and Apply

`route` / `waypoints` are full revision content (`cosmetic`). The only thing
separating them from `engine` fields is that they set neither `engineAffecting`
nor `advisoryAffecting`.

### R3-6.1 `dirty`

Setting or clearing `route`, or any change to `waypoints` (add / move / delete /
reorder / empty), flips `dirty` and, on export, mints a new `revisionId` — same
as editing `label` or dragging a node.

### R3-6.2 Whole diff (`computeRevisionDiff`)

- A `route` / `waypoints` change on an edge present on both sides is a
  `changed`-field hunk `{ field, base, proposed }` tagged **`cosmetic`**.
  `field` is `data.route` or `data.waypoints`.
- The `waypoints` `base` / `proposed` values are the **canonical arrays**
  (§R3-2.2) — a diff comparing them is an array-equality check on the ordered
  point list; a reorder or a single moved point is a `changed` hunk.
- An edge changing **only** `route` / `waypoints` sets neither
  `engineAffecting` nor `advisoryAffecting`; it does count toward
  `summary.changed` and `empty: false`.

### R3-6.3 Whole-proposal Apply

Adopts the proposed graph **verbatim** (`SEMANTICS-R.md §R7.2`); the routing
keys ride along like `label` / `position`. Apply atomicity is unchanged: one
`loadDoc()`, one `simulationRev` bump, paused at step 0, one undo entry, no file
written (R2-INV-5).

`exact` (§R7A) is decided by the **target's `revisionId` / `contentDigest`
matching the proposal's pinned `base`** — **not** by which field tags the diff
hunks carry (R3-D5). A routing-only proposal whose recipient is still exactly on
the pinned base classifies `exact` and skips the confirm; if the recipient has
diverged (any local edit — routing or otherwise), it is `divergent` /
`unknown ancestry` and confirms, like any other proposal.

### R3-6.4 Per-hunk (selective) Apply

- A `data.route` hunk and a `data.waypoints` hunk on the same edge are
  **independently selectable** and apply as a normal field pick
  (`take theirs` / `keep mine`).
- Selecting a `data.waypoints` hunk replaces the **whole ordered array** for
  that edge with the chosen side's array — there is no per-point merge (the
  array is one value, like `expr` text).
- A conflict on `route` / `waypoints` (base ≠ yours ≠ proposed) surfaces
  `base` / `proposed` / `yours` and is resolved per-field like any other; it
  feeds `nConf`.
- A routing-only selective Apply is still **one** new revision, **one** undo
  entry, paused at step 0.
- A UI **may** offer a *"routing changes only"* quick-select bucket; the wire
  contract does not require it.

### R3-6.5 Undo

Each user routing action is **one** undo entry: set / clear `route`; add a
waypoint; move a waypoint (coalesced per drag, like a node move); delete a
waypoint; "Reset route" (clears `waypoints`, keeps `route`). Undo restores the
exact prior `route` / `waypoints` value.

---

## R3-7. Round-trip preservation scope

The contract is **lossless preservation of the valid, normalised routing
value**, and **canonical-byte stability** after the first canonical write — not
"the original input JSON bytes". Arbitrary input is normalised on read (key
order, an explicit `route: "bezier"`, `-0 → 0`, a stray `waypoints`, an empty
`waypoints: []`), so its *original bytes* cannot be preserved and are not
promised.

Precisely:

1. **Value losslessness.** A `route: "orthogonal"` and every accepted
   `waypoints` point (order, full `Number` precision, duplicates, collinear
   points) survive every transport below **without loss or reordering**.
2. **Canonical-byte stability.** Once a graph has been serialised by
   `serialize` / projected by `canonicalContent`, a `load → re-serialise` (or
   `project → re-project`) produces **byte-identical** output. The idempotent
   fixed point is the canonical form, not the author's original text.
3. **No guarantee** for the original bytes of: an explicit default
   (`route: "bezier"` normalises to absent), an empty `waypoints: []`
   (normalises to absent), a quarantined bad payload (dropped — §R3-1.1), or
   any non-canonical key order / whitespace in a hand-edited file.
4. **Workspace** preserves the routing value **only inside its embedded
   GraphDoc** — the `workspace` payload itself carries no routing field.

| transport | valid routing value preserved? | notes |
|---|---|---|
| **Graph JSON** (`Export ▾ → Graph JSON` → Import) | **yes** (value; canonical bytes after first write) | the two trailing edge keys serialise / deserialise unchanged; a default edge emits neither. |
| **Share link** (`#g1=` — `loop-share/1`) | **yes** | the share payload is the same canonical GraphDoc; a re-routed edge survives a copy-open. |
| **Project revision** (`Export ▾ → Project revision`) | **yes**, and in the `contentDigest` | `route` / `waypoints` are `cosmetic` revision content — projected, digested, diffed (§R3-2 / §R3-6). |
| **Proposal** (`Make a proposal`) | **yes** | `base.content` and the proposed content each carry the routing keys through the v3 projection (verified independently — §R3-5.2); the diff shows `cosmetic` hunks. |
| **Workspace** (`Export ▾ → Workspace JSON` → Import) | **yes**, from the embedded GraphDoc only | `route` / `waypoints` come from the file's `edges`, exactly as `flow` / `resourceType` do; `loop-workspace/1` is unchanged (§R3-8). A stepped, then re-imported Workspace restores `S(t)` + the graph (routing value intact); `d` is recomputed from the restored layout. |

An edge whose routing payload was **quarantined on read** (§R3-1.1) round-trips
as a **default (Bézier) edge** — the bad payload is not re-emitted. This is the
one deliberately lossy case.

---

## R3-8. Workspace stays `loop-workspace/1`

Routing adds nothing to `SimState`, the restore contract, or the Workspace
semantic digest — no seed, step, pool value, trigger queue, or series entry
depends on a route. `loop-workspace/1` is **not** bumped (R3-INV-8). The R3
work re-confirms this with a round-trip fixture (the same check the model layer
got in `test/model-verification.test.ts` `workspaceRoundTrip`): the
`workspace.simulation` key set is unchanged and mentions no `route` /
`waypoints`; `route` / `waypoints` come from the GraphDoc; the run state
restores; `d` is recomputed.

---

## R3-9. Explicitly **not** projected

None of the following is wire content — no projection, no digest, no diff, no
file, no Share link, no Workspace payload:

- the computed orthogonal **path** (`d`), its segments, bends, or corner
  points;
- the **`routeClass`** (`orthogonal` / `self-loop` / `same-side` /
  `fallback-lz` / `degenerate`) and its `data-route-class` DOM attribute;
- the router **cache** — `routeMapKey`, the `Map<edgeId, {d, hitD,
  routeClass}>`, any memo;
- **`ROUTER_VERSION`** and the router constants (`ROUTE_PAD`, `ROUTE_STUB`, …);
- the `edge-interaction` **hit path** `d`.

A change to any of these (e.g. a future `ROUTER_VERSION` bump that reshapes
every computed route) therefore moves **no** digest and produces **no** diff —
the same file renders differently, which is exactly the non-behavioral posture
of `docs/edge-routing.md`.

---

## R3-INV. Invariants

| id | invariant |
|---|---|
| **R3-INV-1** | The writer (`serialize` and the projection) **never** emits `route: "bezier"`, an empty `waypoints: []`, `null` for either key, or a `waypoints` coordinate rounded to `PATH_DECIMALS`. A default edge's serialized + projected `data` is byte-identical to its `loop-revision/2` form. |
| **R3-INV-2** | Conservative extension: for any normalised graph failing §R3-1, `canonicalContent` emits **byte-identical** output to the `loop-revision/2` projection, so `fullContentDigest` is identical under either reading. The §R3-4 golden (RG0 / RG2) proves it; its v2 oracle digest is **pinned** to the shipped `loop-revision/2` value. |
| **R3-INV-3** | The §R3-1 predicate is purely syntactic (`data.route` + `data.waypoints` after normalisation), runs on the **normalised valid GraphDoc**, never on raw JSON, never on a stored header, **per graph** and **per side**. An explicit `route: "bezier"` or an empty `waypoints` normalises to absent and does not make a graph v3. |
| **R3-INV-4** | Validation order: a side is verified against **its own** projection (v1 / v2 / v3 by the predicate), **then** lifted into the common v3 model; the lift is **asserted** byte-identical for a non-v3 side. Verifying an older side directly with the v3 digest is forbidden. There is no version-mismatch refuse branch. |
| **R3-INV-5** | `route` / `waypoints` are `cosmetic`: full revision content (flips `dirty`, mints a `revisionId`, diffs, feeds `nConf`) but set **neither** `summary.engineAffecting` **nor** `summary.advisoryAffecting`. A routing-only `RevisionDiff` is not `empty`. |
| **R3-INV-6** | Defensive read (§R3-1.1) is a **routing-only quarantine**: a bad `route` / `waypoints` is dropped with one deterministic warning; the edge's `id`, endpoints, handles, and every semantic field (`flow`, `kind`, `mode`, `expr`, `delay`, `resourceType`, …) are preserved; the graph opens; a `project` file with such an edge routes graph-only + warning, never Review / Apply-with-that-edge-broken. |
| **R3-INV-7** | Apply atomicity (R-INV-8 / R2-INV-5) holds for any `engine` / `advisory` / `cosmetic` mix, routing included: one `loadDoc()`, one `simulationRev` bump, paused at step 0, one undo entry, no file written. |
| **R3-INV-8** | `loop-workspace/1` is **not** bumped. The Workspace payload carries no routing field; `route` / `waypoints` live only in the embedded GraphDoc. |
| **R3-INV-9** | A `waypoints` coordinate is stored and projected **verbatim** at full `Number` precision after `§R4.1` (`-0 → 0`, **no rounding**). The **value** round-trips losslessly through every transport (§R3-7); once canonically serialised, `load → re-serialise` is byte-identical. `PATH_DECIMALS` / `COORD_EPS` are render-only and touch no wire value. Original non-canonical input bytes (key order, explicit `"bezier"`, `[]`, a quarantined payload) are **not** promised. |
| **R3-INV-10** | The computed route (`d`, `routeClass`, hit path, cache, `ROUTER_VERSION`) is in **no** projection, digest, diff, file, Share link, or Workspace payload (§R3-9). |

---

## R3-D. Decisions

Settled (rev 2, folded in at Freeze).

| id | decision |
|---|---|
| **R3-D1** | **Reuse the existing `cosmetic` `fieldTag` token as-is** — the one `label` / `position` already use (`loop-revision/1 §R5.2` / `loop-revision/2 §R2-3`). No new tag. `route` / `waypoints` set neither `engineAffecting` nor `advisoryAffecting`. |
| **R3-D2** | **`route` / `waypoints` on `resource` AND `state` edges** — the two keys are appended to each edge's existing frozen field order. **`resourceType` is NOT added to the `state`-edge row** (§R3-2.1); it stays advisory content for `pool` + `resource` edge only. |
| **R3-D3** | **Fixtures at `examples/revision-v3/` + `test/revision-v3-fixture.test.ts`**, mirroring `examples/revision-v2/`. Contents per §R3-4. `GEN_ORACLE=1` (or the repo's convention) regenerates. |
| **R3-D4** | **`{ "x": …, "y": … }`** — key order `x` then `y`, matching `position` in `SEMANTICS-R.md §R4.2`. |
| **R3-D5** | **`exact` is unchanged from `loop-revision/2`** — it is decided by the target's `revisionId` / `contentDigest` matching the proposal's pinned `base`, **not** by which field tags a hunk carries. A routing-only proposal whose target is still exactly the pinned base classifies **`exact`** and skips the whole-Apply confirm; if the target has diverged, it is `divergent` / `unknown` like any other. No routing-specific rule. |
| **R3-D6** | **`waypoints` is fully specified from day one.** Slice 1 ships `route` mode + auto orthogonal routing with **no** `waypoints` editor, but the projection, the digest, the diff, the defensive read, and the golden vector all cover `waypoints`. Slice 2 (the waypoint UI) needs **no** wire change. |
| **R3-D7** | **A `data.waypoints` diff hunk is whole-array.** `base` / `proposed` are the complete ordered point lists; a selective Apply of that hunk swaps the whole array (§R3-6.4). There is no per-point three-way merge. |

This file now only takes typo / clarifying-prose fixes; a behavioural change is
a new spec id (`loop-revision/4`), exactly as `loop-revision/1 → /2 → /3`.
