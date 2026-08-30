# Project Revision / Proposal — edge-routing extension

```
Spec ID: loop-revision/3
Status:  Draft
```

**Draft for review.** Extends `SEMANTICS-R2.md` (`loop-revision/2`, Frozen) so
the canonical revision projection, its digest, the three-way diff, and Apply
also cover the **edge-routing user-intent fields** introduced by
`docs/edge-routing.md` — `edge.data.route` and `edge.data.waypoints`. The
*approach* is fixed in that design doc (ER-D2, §ER6); this document formalises
it at the wire level and introduces no new design beyond closing the §R3-D
boundaries. On Freeze it is the fixed target for the routing implementation
(Slice 1 = mode + auto routing; Slice 2 = the waypoint UI).

**No behavioural change to `loop-revision/1` or `/2`.** A graph whose edges
carry no routing intent (§R3-1) projects, digests, diffs, and applies
**byte-for-byte** as it does under `loop-revision/2` today (R3-INV-2). Files,
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
- the **round-trip preservation scope** — where the user's routing intent is
  carried byte-for-byte (§R3-7);
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
| `state` edge | `kind`, `mode`, `expr`, `delay`, `resourceType`?, **`route`**, **`waypoints`** |

(The `state`-edge row is `SEMANTICS-S2.md`'s frozen order with the
`loop-revision/2` `resourceType` — where present — and the two new keys
appended. A `state` edge never carries `resourceType` today; the column is
listed for a total order only.)

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

**The golden vector.** A committed fixture — location decided in §R3-D — with:

- **RG0** — a v2-content graph (a `parameter`, a `register`, a `resourceType`,
  no routing intent). Assert `digest_v3(RG0) === digest_v2(RG0)` and both equal
  the pinned value the shipped `loop-revision/2` implementation produces.
- **RG1** — RG0 with **one** edge set to `route: "orthogonal"` and **one**
  other edge given a 3-point `waypoints`. Assert: `digest_v3(RG1) !==
  digest_v2(RG1)` (a real revision); the two changed edges' projected `data`
  objects gain exactly the trailing keys, in order; every other element's bytes
  are unchanged from RG0; `computeRevisionDiff(RG0, RG1)` reports two
  `changed` hunks, both `cosmetic`-tagged, `engineAffecting: false`,
  `advisoryAffecting: false`, `empty: false`.
- **RG2** — RG1 with the `route` edge switched back to Bézier (both keys
  removed) and the `waypoints` edge's array emptied. Assert `RG2` fails §R3-1,
  and `digest_v3(RG2) === digest_v2(RG2) === digest_v2(RG0)` for the
  corresponding elements — the round-trip to default is **exact** (ER-D16).
- **RG3** — a file with a deliberately broken payload (a 5000-entry
  `waypoints`, a `NaN` coordinate, `route: 3`). Assert the routing payload is
  dropped, one warning per edge in `id` order, the edges and every semantic
  field survive, and the resulting graph's digest equals the same graph with
  the payloads never present.

Like `loop-revision/2 §R2-4`, the golden's v2 oracle digest is **pinned to the
value the shipped `loop-revision/2` implementation produces**, so a drift in
either projection fails the fixture.

---

## R3-5. Validation order — verify with the own projection, then lift

Per side, exactly as `loop-revision/2 §R2-5` / R2-INV-3:

1. Choose the projection by the predicate: a **v1** side → `{modelLayer:false}`
   literal v1 projection; a **v2** side → the v2 projection; a **v3** side →
   the v3 projection.
2. Verify the side's **stored digest against that projection**.
3. **Lift** the verified content into the common **v3** compare model (add the
   trailing edge keys where absent, as *default*). By R3-INV-2 / R2-INV-2 the
   lift reproduces identical bytes for a non-v3 side; the implementation
   **asserts** this rather than assuming it.

Verifying a v1 or v2 side **directly with the v3 digest is forbidden** — it
could misclassify a valid older file as tampered (R-INV-6, carried forward).
There is **no** version-mismatch "refuse" branch (R2-INV-6): every same-project
v1 / v2 / v3 combination is compared under the one common v3 projection.

### R3-5.1 Malformed / ambiguous payloads

A `project` file whose graph, after §R3-1.1, still cannot be projected (a
recognised failure mode of `loop-revision/2 §R2-5.1`, e.g. an unseatable model
node) routes **graph-only + warning**, unchanged by this spec. A file whose
**only** problem is a bad routing payload has that payload quarantined
(§R3-1.1) and then follows the normal path — Review / Apply is reachable if
nothing else is wrong, because the edge's semantic content is intact.

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
written (R2-INV-5). A routing-only Apply is still confirmed unless the
classification is `exact` (§R7A) — a `cosmetic`-only change can be `exact`.

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
exact prior `route` / `waypoints` bytes.

---

## R3-7. Round-trip preservation scope

The user's routing **intent** (`route` + `waypoints`) is carried
**byte-for-byte** through every file transport; the **computed route** is in
**none** of them (§R3-9).

| transport | `route` / `waypoints` preserved? | notes |
|---|---|---|
| **Graph JSON** (`Export ▾ → Graph JSON` → Import) | **yes**, verbatim | the two trailing edge keys serialize and deserialize unchanged; a default edge emits neither. |
| **Share link** (`#g1=` — `loop-share/1`) | **yes**, verbatim | the share payload is the same GraphDoc; a re-routed edge survives a copy-open. |
| **Project revision** (`Export ▾ → Project revision`) | **yes**, verbatim + in the digest | `route` / `waypoints` are `cosmetic` revision content — projected, digested, diffed (§R3-2 / §R3-6). |
| **Proposal** (`Make a proposal`) | **yes** | `base.content` and the proposed content both carry the routing keys through the v3 projection; the diff shows `cosmetic` hunks. |
| **Workspace** (`Export ▾ → Workspace JSON` → Import) | **yes**, from the embedded GraphDoc | the `workspace` payload is `loop-workspace/1` (§R3-8) and carries **no** routing field of its own; `route` / `waypoints` come from the file's `nodes` / `edges`, exactly as `flow` / `resourceType` do. A stepped, then re-imported Workspace restores `S(t)` and the graph — routing intact — and the route is recomputed from the restored layout. |

An edge whose routing payload was **quarantined on read** (§R3-1.1) round-trips
as a **default (Bézier) edge** — the bad payload is not re-emitted. This is the
one lossy case, and it is deliberate.

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
| **R3-INV-9** | A `waypoints` coordinate is stored and projected **verbatim** at full `Number` precision after `§R4.1` (`-0 → 0`, no rounding); it round-trips `Import → Export` byte-identical. `PATH_DECIMALS` / `COORD_EPS` are render-only and touch no wire value. |
| **R3-INV-10** | The computed route (`d`, `routeClass`, hit path, cache, `ROUTER_VERSION`) is in **no** projection, digest, diff, file, Share link, or Workspace payload (§R3-9). |

---

## R3-D. Open decisions (to close before Freeze)

| id | question | leaning |
|---|---|---|
| **R3-D1** | the exact `cosmetic` tag token in `fieldTag` — `loop-revision/2 §R2-3` names it `cosmetic`; confirm the codebase constant and that `label` / `position` already use it. | reuse `cosmetic` as-is; no new tag. |
| **R3-D2** | `route` / `waypoints` on **state** edges as well as resource — or resource-only for Slice 1? | **both** (state edges are dashed and route the same); the projection lists both rows. Confirm no `SEMANTICS-S2.md` field-order conflict. |
| **R3-D3** | golden-vector location — a new `examples/revision-v3/` + `test/revision-v3-fixture.test.ts`, mirroring `examples/revision-v2/`. | yes, that layout. |
| **R3-D4** | `waypoints` element key order in the canonical JSON — `{x, y}` vs `{y, x}`. | `{x, y}` (matches `position` `{x, y}` in `§R4.2`). |
| **R3-D5** | does a `route` / `waypoints`-only change ever classify `exact` (skipping the whole-Apply confirm)? `loop-revision/2` lets a `cosmetic`-only change be `exact`. | keep `loop-revision/2` behaviour — a `cosmetic`-only diff **can** be `exact`; no special routing rule. |
| **R3-D6** | Slice 1 ships the `route` mode + auto routing while the `waypoints` field exists in the contract but has no editor — confirm the projection / digest / golden still cover `waypoints` from day one so Slice 2 needs no wire change. | yes — `waypoints` is fully specified here; Slice 2 is pure UI. |

On Freeze, R3-D1…R3-D6 become a settled Decisions table (each Decided /
Deferred), `Status` flips to `Frozen`, and the README Semantics table gains the
`loop-revision/3` row.
