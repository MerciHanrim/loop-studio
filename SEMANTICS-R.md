# Project Revision / Proposal

```
Spec ID: loop-revision/1
Status:  Draft — for review (rev 3)
```

**Draft (2026-08-29).** Not yet frozen. Once the §R12 decisions are settled and
this document is marked `Frozen`, it is the fixed target for the implementation
and a behavioural change afterward is a new spec id in a new document
(`loop-revision/2`), exactly as with `loop-state/1 → loop-state/2`; a frozen
file then takes only typo / clarifying-prose fixes.

Defines *what a Project is*, *how revisions chain and stay immutable*, *what a
Proposal file carries*, *the exact canonical projection its digest and diff run
over*, *how a Proposal is diffed three-way*, and *how applying a Proposal makes
a new local revision* — using files as the only transport, with **no accounts,
no server, and no real-time sync**. Every rule here is computable from the file
in hand plus the currently-open document; nothing depends on history the app
cannot see.

Independent of, and layered on top of, the graph / engine / Monte-Carlo /
workspace / share specs. It never changes how a diagram *runs*.
`SEMANTICS.md`, `SEMANTICS-B1.md`, `SEMANTICS-B2.md`, `SEMANTICS-S.md`,
`SEMANTICS-S2.md`, `SEMANTICS-W.md` (`loop-workspace/1`), and `SEMANTICS-U.md`
(`loop-share/1`) are unaffected.

---

## R0. Scope

**Added**

- A **Project** — a lineage of immutable revisions of one diagram, identified by
  a stable opaque `projectId`. A plain graph / Workspace file is *promoted* to a
  project on the first `Export → Project revision`.
- A **Revision** — one immutable saved point: `{ revisionId, parentId,
  role: "revision" }` plus the graph (and optional `workspace`) content. A
  `revisionId` names one exact content state (§R2); editing an open revision
  makes it **dirty** and the next `Export → Project revision` mints a new id.
- A **Proposal** — a revision-shaped file with `role: "proposal"` that carries
  **both** the proposed content (top-level `nodes` / `edges`) **and** a full
  canonical snapshot of the base it was authored against
  (`project.base.content`, §R6). The unit that travels between people: *open a
  revision → `Make a proposal` copy → edit → send the file → the recipient
  diffs it three-way and optionally applies it.*
- **`Export ▾` gains `Project revision`** and, when a project is open,
  **`Make a proposal`**.
- **Import auto-detects** a `project` key and routes (§R10). Importing a
  proposal for the open project opens a non-destructive **Review**; it never
  changes the open document until the user clicks **Apply**.

**Out of scope for v1** — accounts, login, a server, cloud storage; real-time /
live collaboration, presence, document locking; automatic 3-way *merge* or
*rebase* of divergent branches (per-hunk conflict *resolution* is manual);
cryptographic signing or verified authorship; multi-project bundle files; a
"revision browser" that lists files from disk; diffing the `workspace` (run)
payload beyond a single "differs" flag; any network transport (the transport is
a file, exactly like Workspace / Share today).

**Unchanged** — the graph half is still written by the *same* `serialize()`
path; a Project file **is** a valid Workspace file **is** a valid Graph file.
Graph schema stays `version: 1`; `workspace` and `project` are additive,
optional top-level keys; an older build ignores an unknown top-level key.
`loop-workspace/1` is untouched: autosave still never persists the `workspace`
payload. Autosave **does** now also persist the small `project` **header** —
`projectId` / `revisionId` / `parentId` / `role` / `lineage` / `meta`, never
`base.content` — so a reload stays on the open revision (§R2.1).

---

## R1. File shape

```jsonc
{
  "schema": "loop-studio/graph",
  "version": 1,
  "nodes": [ /* … the current / proposed graph … */ ],
  "edges": [ /* … */ ],
  "recommendedRunConfig": { /* … optional, as today … */ },
  "workspace": { /* … optional loop-workspace/1 payload, unchanged … */ },

  "project": {
    "schema": "loop-revision/1",
    "version": 1,

    "projectId": "proj_0123456789ABCDEFGHJKMNPQRS",  // "proj_" + 26 Crockford base32 — minted once, stable for the lineage
    "revisionId": "rev_0123456789ABCDEFGHJKMNPQRS",   // "rev_"  + 26 Crockford base32 — names ONE content state (§R2)
    "parentId": "rev_…",                              // the revisionId this was derived from; null only for a project root
    "role": "revision",                               // "revision" | "proposal"

    "base": {                                         // present IFF role === "proposal"
      "revisionId": "rev_…",                          // the revision this proposal was branched from
      "contentDigest": "<sha-256 hex of canonicalJson(base.content); §R4>",
      "content": {                                    // the canonical revision projection (§R4.2) of the base — REQUIRED, complete
        "nodes": [ /* projected, id-sorted */ ],
        "edges": [ /* projected, id-sorted */ ],
        "recommendedRunConfig": { /* normalized, or omitted */ }
      }
    },

    "appliedProposal": {                              // present IFF this revision was produced by Apply (§R7); provenance only
      "proposalId": "rev_…",                          // the proposal file's revisionId
      "baseId": "rev_…",                              // the proposal's base.revisionId
      "baseDigest": "<the proposal's base.contentDigest>"
    },

    "lineage": [ "rev_<parentId>", "rev_<grandparent>", "…" ],  // advisory, newest-first, ≤ LINEAGE_MAX; may be short/absent

    "meta": {                                         // ALL fields UNVERIFIED, display-only — §R8
      "title": "Coffee shop economy",                 // optional
      "createdAt": "2026-08-29T12:00:00Z",            // ISO 8601 UTC — display only, never trusted for ordering
      "author": { "name": "Alex", "note": "tuned the drain rates" },
      "tool": "loop-studio/0.5.0"
    }
  }
}
```

Why a nested `project` key: today's Import reads `nodes` / `edges` unchanged; an
older build ignores `project` and still opens the graph; a new build tells
plain / Workspace / Project files apart by which keys are present — no schema
bump, no `version` collision. **A Project file is a valid Workspace file is a
valid Graph file** (R-INV-1).

---

## R2. Revision immutability & the dirty flag

A `revisionId` names **one exact content state** within a project. It is
**never** carried onto changed content.

- **On opening a Project file** the `projectStore` records the *baseline*:
  `{ revisionId, parentId, baselineDigest = fullContentDigest(the loaded
  graph), lineage, meta }`. For a proposal file the loaded graph is the
  *proposed* content and the baseline digest is of that (its own
  `project.revisionId` is a fresh id for the proposed state — see below).
- **`dirty`** = `fullContentDigest(current graph) !== baselineDigest`. It is a
  pure function of content, recomputed (debounced) on edit. Selection, viewport,
  run state, undo depth never affect it.
- **`revisionId` is opaque and random**, not a content hash — two independently
  authored revisions with byte-identical content still have different ids (they
  are on different branches). Equality of `revisionId` therefore means "the same
  saved revision object", and it is only *asserted* to mean "the same content"
  when `contentDigest` agrees (§R7A.2 case `exact`).
- Ordering is by **`parentId` pointers only** — `createdAt` and any counter are
  display-only.

### R2.1 `Export → Project revision` and the session baseline

The Export runs the payload build, `canonicalContent`, `serialize`, the
`REVISION_FILE_MAX_BYTES` measure, and (when a new id is needed) id minting. It
**commits only if every one of those succeeds**:

- **Session was not dirty** → write the file with the **current**
  `revisionId` / `parentId` / `lineage`; the session baseline is unchanged.
  A second consecutive `Export → Project revision` with no edits in between
  produces a **byte-identical** file (same ids, same digest).
- **Session was dirty** → mint **one** new `revisionId` (§R11); `parentId` =
  the pre-export baseline `revisionId`; `role: "revision"`; `lineage` =
  `[parentId, ...oldLineage].slice(0, LINEAGE_MAX)`; write the file; **then
  update the session baseline in one step** to
  `{ revisionId: <new>, parentId, baselineDigest = fullContentDigest(current
  graph), lineage, meta }`. `dirty` is now `false`.
  - A subsequent `Export → Project revision` with **no further edits** now takes
    the "not dirty" path and reproduces the **same `revisionId` and digest** —
    two dirty exports in a row cannot yield two different new revisions for one
    unchanged content state.
- The baseline update is **not** a graph-content change and **not** a normal
  undo entry — undo/redo never moves the `revisionId` (it moves content, which
  then re-derives `dirty` against the unchanged baseline).
- Autosave (`localStorage`) stores the graph **plus the lightweight project
  header** — `projectId`, `revisionId`, `parentId`, `role`, `lineage`, `meta`
  — so a reload keeps the session on the same revision. It **never** autosaves
  `base.content` or `workspace`. On the dirty path the autosaved header is
  updated to the new revision together with the baseline.
- **`Make a proposal` never touches the origin session** — no baseline,
  `revisionId`, `parentId`, `role`, or `dirty` change; it only reads the
  current graph to build the proposal file.

**On any failure — the user cancels, `serialize` throws, the file exceeds
`REVISION_FILE_MAX_BYTES`, or secure RNG is unavailable — nothing changes: no
file is written, no id is minted, the session baseline / autosaved header /
`dirty` flag are exactly as before.**

---

## R3. Project identity

- **`projectId`** — opaque, crypto-random (`proj_` + 26 Crockford base32,
  §R11). Minted **exactly once**, on the first `Export → Project revision` of a
  previously-anonymous doc, then **carried byte-for-byte** by every revision and
  proposal in the lineage. Apply and Export never change it. Nothing derives it
  from content.
- Two files **belong to the same project** iff `project.projectId` is byte-equal.
  That is the **only** identity test — never a title, filename, or path.
- A file with **no `project` key** has no project identity; it opens as a fresh
  anonymous graph / Workspace and may be promoted to a **new** project.
- A `projectId` (or `revisionId`, or any id) that fails the §R11 format check →
  the whole `project` key is **dropped** with a one-line warning; the graph /
  workspace still import (R-INV-10).

---

## R4. Canonical revision content & its digest

This projection is **defined here** and is **not** `loop-workspace/1`'s semantic
digest — that one drops `label` / `position`, which this diff must show. Only
the SHA-256 tooling is shared (§R4.4).

### R4.1 Inputs and normalisation

Operate on the graph after the existing `normalizeGraph()` pass
(`src/model/serialize.ts` — fills kind defaults into node `data`, backfills
blank edge handles to `out` / `in` / `state-*`, backfills edge `data`). Then:

- **Numbers** — every number must be **finite**, and is kept **exactly as its
  JavaScript `Number`**; the only normalisation is `-0 → 0`. Coordinates and
  every other numeric field carry their full precision into the digest and into
  `base.content` (`String(n)` after the `-0` fix — `10.0` and `10` are already
  the same `Number` in JS, so they emit identically without a rounding rule). A
  non-finite number anywhere in the projected content makes the content
  **invalid for revision purposes** (on import: drop `project` + warn; on export
  it cannot occur — the editor never produces one).
  - **No rounding.** `position` is preserved to the pixel-fraction, so a
    sub-pixel move is a real content change (it makes the session `dirty`, it
    shows in the diff, and Apply restores the exact coordinate). A UI that wants
    to *hide* trivial position deltas does so with a **display-only tolerance**
    in the diff view — it must never round the value that feeds the digest or
    `base.content`.
- **Strings** — compared and hashed as their exact UTF-8 bytes. No case,
  Unicode-normalisation, or whitespace folding.
- **Missing vs explicit** — an optional field absent and the same field present
  with its documented default normalise to the **same** projected form: the
  default is written explicitly (so a hand-edited file that omits `capacity`
  and one that writes `"capacity": null` project identically).
- **Booleans** — as-is.

### R4.2 The projection

```
canonicalContent(doc) = {
  "nodes": [ node(n) for n in doc.nodes ] sorted by n.id ascending (UTF-16 code-unit order),
  "edges": [ edge(e) for e in doc.edges ] sorted by e.id ascending,
  "recommendedRunConfig": rrc(doc.recommendedRunConfig)   // key omitted entirely if the result is empty
}

node(n) = {
  "id":       n.id,
  "position": { "x": norm(n.position.x), "y": norm(n.position.y) },   // finite as-is; only -0 → 0. NO rounding.
  "data":     pick(normalizedNodeData(n), FIELDS_BY_KIND[n.data.kind])  // keys emitted in the fixed order below
}

edge(e) = {
  "id":           e.id,
  "source":       e.source,
  "target":       e.target,
  "sourceHandle": e.sourceHandle,     // post-normalize: "out" | "in" | "state-source" | "state-target" | a real handle id
  "targetHandle": e.targetHandle,
  "data":         pick(normalizedEdgeData(e), EDGE_FIELDS_BY_KIND[e.data.kind])
}

rrc(c) = present-and-valid keys of { baseSeed, runs, steps, tracked }, coerced
         (finite int for the numbers; string[] of graph-node ids for `tracked`,
         in the order they appear in `c.tracked`), unknown keys dropped;
         → {} (⇒ the key is omitted) if nothing valid remains
```

**`FIELDS_BY_KIND`** (node `data`, emitted in this order):

| kind | fields |
|---|---|
| `pool` | `kind`, `label`, `activation`, `initial`, `capacity` (number **or** `null`), `mode` |
| `source` | `kind`, `label`, `activation`, `mode` |
| `drain` | `kind`, `label`, `activation`, `mode` |
| `gate` | `kind`, `label`, `activation`, `distribution`, `mode` (always present after normalize; default `"pullAny"`) |
| `converter` | `kind`, `label`, `activation`, `mode` |
| `end` | `kind`, `label`, `activation`, `mode` (default `"pullAny"`) |

**`EDGE_FIELDS_BY_KIND`** (edge `data`, in order):

| kind | fields |
|---|---|
| `resource` | `kind`, `flow` |
| `state` | `kind`, `mode`, `expr`, `delay` (integer ≥ 0; **always present after normalize**, default `0`) |

Any node `data` key not in its list, any edge `data` key not in its list,
`n.type` / `e.type`, `selected` / `dragging` / `measured` / width / height /
`positionAbsolute`, and every top-level doc key other than `nodes` / `edges` /
`recommendedRunConfig` are **excluded**.

### R4.3 Canonical JSON

`canonicalJson(x)` = `JSON.stringify` with: object keys in the **fixed order
given above** (not lexicographic — the field tables define the order); no
whitespace; arrays already sorted by the rules above; numbers as produced by
JS `String(n)` after §R4.1 normalisation.

### R4.4 The digests

- **`fullContentDigest(doc)`** = `SHA-256`(UTF-8 bytes of
  `canonicalJson(canonicalContent(doc))`), lowercase hex. This is the digest in
  a proposal's `base.contentDigest`, the `baselineDigest` in `projectStore`, and
  the basis of the `dirty` flag.
- **`semanticView(node|edge)`** — the subset of the projection above that
  affects the engine: drop node `label` and `position`, drop the whole
  `recommendedRunConfig`. Used **only** to *tag* a diff hunk `engine` vs
  `cosmetic` (§R5.2). There is no separate semantic *digest* in
  `loop-revision/1`.
- SHA-256 uses `crypto.subtle` where the context exposes it and **bundles a
  pure-JS SHA-256 fallback** for every other target (identical requirement and
  fallback to `loop-workspace/1` §W12.15). A build with neither degrades the
  `project` reader to **graph-only + warning**.

---

## R5. The RevisionDiff

`computeRevisionDiff(baseContent, proposedContent)` — both are
`canonicalContent(...)` structures — is **deterministic and id-keyed**; element
order and whitespace in the source files never affect it.

### R5.1 Buckets

For nodes, and independently for edges, partition ids into:

- **`added`** — id in `proposed`, not in `base`; value = the proposed
  projection.
- **`removed`** — id in `base`, not in `proposed`; value = the base projection.
- **`changed`** — id in both, projections differ; value = a per-field list
  `{ field, base, proposed }` over the union of differing keys (a nested `data`
  diff descends one level: `data.capacity`, `data.flow`, …).
- **`unchanged`** — id in both, projections equal (not listed, only counted).

`recommendedRunConfig` is diffed per key → `added` / `removed` / `changed`
`{ key, base, proposed }`.

### R5.2 Tags & summary

- Each `changed` field, and each `added` / `removed` element, is tagged
  **`engine`** if it is inside `semanticView` (endpoints, handles, `data.*`
  other than nothing here — all edge `data` is engine; node `kind` / `activation`
  / `initial` / `capacity` / `mode` / `distribution` are engine), else
  **`cosmetic`** (node `label`, node `position`).
- `RevisionDiff.summary` = `{ nodes: {added, removed, changed}, edges: {…},
  runConfigChanged: <bool>, engineAffecting: <bool — any engine-tagged hunk or
  any runConfig change>, empty: <bool — no added/removed/changed anywhere> }`.

### R5.3 `workspace`

Reduced to a single boolean `RevisionDiff.workspaceDiffers` — `true` if either
file has a `workspace` key and the two payloads are not deep-equal. It is
**never** broken down and **never** applied (§R7).

---

## R6. Proposal creation & `base.content`

`Make a proposal` on an open, **non-dirty** project revision (if dirty, the app
first offers to `Export → Project revision`) produces a file where:

- `project.projectId` = the open project's;
- `project.role` = `"proposal"`;
- `project.revisionId` = a **fresh** id for the proposed state (each export of a
  proposal mints a new one; the identity that matters is `base` + `projectId` +
  `role`);
- `project.parentId` = the open revision's `revisionId`;
- `project.base` =
  - `revisionId` = the open revision's `revisionId`,
  - `content` = **`canonicalContent(the open graph)`** — the full projection,
    complete, id-sorted (§R4.2). This is what makes the three-way diff and
    per-hunk apply computable **entirely offline** from the proposal file plus
    the recipient's open document.
  - `contentDigest` = `SHA-256(canonicalJson(base.content))` — MUST equal
    `fullContentDigest(the open graph)`. A reader that finds
    `contentDigest !== SHA-256(canonicalJson(base.content))` treats the
    `project` payload as **corrupt** (R-INV-10: graph still loads, `project`
    dropped + warning).
- top-level `nodes` / `edges` / `recommendedRunConfig` = an editable **copy** of
  the base, which the author then edits;
- `meta.author.name` from the device-local setting (§R8), truncated to
  `AUTHOR_NAME_MAX_BYTES`; `meta.author.note` to `AUTHOR_NOTE_MAX_BYTES`.

The **serialized proposal file** is capped at `REVISION_FILE_MAX_BYTES` (§R11) —
it carries the base snapshot **and** the proposed graph; over the cap, `Make a
proposal` is refused with a clear message (the diagram is too large to propose
as one file; a plain Graph JSON still works). No silent truncation.

Editing a proposal in-app: it behaves like an open revision (its own
`baselineDigest` is of the proposed content) but its `role` / `base` are
preserved on the next `Make a proposal` export.

---

## R7. Apply — the result is always a NEW local revision

"Apply" takes a **proposal** and produces a **new revision of the open project**,
derived from the **currently-open revision** (the *target*). This holds for
**every** classification (§R7A.2); only `divergent` / `unknown` add a
confirmation.

### R7.1 The resulting revision

- `projectId` = the target's (**never** the proposal's, though they must match —
  §R7A.1);
- `revisionId` = a **fresh** id minted at apply time (the proposal's own
  `revisionId` is **not** reused);
- `parentId` = the **target's** `revisionId` (the pre-apply open revision);
- `role` = `"revision"`;
- `appliedProposal` = `{ proposalId: proposal.project.revisionId, baseId:
  proposal.project.base.revisionId, baseDigest:
  proposal.project.base.contentDigest }` — provenance only;
- `lineage` rebuilt from the target;
- `meta.author` = the **applier's** device-local author (the proposal's author
  is preserved **only** inside `appliedProposal` provenance and the Review view;
  it is **not** promoted to the verified author of the result);
- `meta.createdAt` = now (display-only).

### R7.2 The resulting content

- **Whole-proposal apply** → the proposed `nodes` / `edges` /
  `recommendedRunConfig` **verbatim** (adopt the proposal's graph).
- **Per-hunk (selective) apply** → `target content + accepted hunks`, each hunk
  id-scoped and independently applicable (§R7A.3): `add` inserts the proposed
  element; `remove` deletes it (and its now-dangling edges, as the editor does);
  `change` sets the accepted fields (whole-element or field-level) on the
  target's element. Rejected hunks leave the target as it was.
- **Run / workspace / sim state is not applied.** An opt-in *"also take the
  proposal's run config"* copies only `recommendedRunConfig` (and, if present,
  `workspace.mc.config`) — never a sim snapshot, never an MC result.

### R7.3 Atomicity

- Exactly one `graphStore.loadDoc()` on the resulting graph → one
  `simulationRev` bump → the sim resets to **paused at step 0**, the MC result
  stales as any load does.
- **One undo entry** — undo restores the pre-apply target (graph, and the
  `projectStore` baseline).
- Apply **never** writes a file and **never** mutates the proposal or base file.
  The user `Export → Project revision` afterward to persist the new revision.

---

## R7A. Classification & conflicts (applied by §R7)

### R7A.1 Gate: same project

- `proposal.project.projectId !== target.project.projectId` → **refuse to
  apply**: *"This proposal belongs to a different project."* No diff, no state
  change. (The user may still **open the proposal as a document**, §R10.5.)
- **No open project** (target anonymous) → cannot apply; offer only *"open the
  proposal as a document"* (§R10.5) or **Cancel**.

### R7A.2 Classify the target against the proposal (provable cases only)

Inputs — **only** these, all file-contained: `target.revisionId`,
`target.parentId` (from the target's own `project`), `proposal.base.revisionId`,
`fullContentDigest(target)`, `proposal.base.contentDigest`, and the three-way
conflict count from §R7A.3 (`nConf`, computed from `proposal.base.content` +
target + proposed). **`lineage[]` is display-only advisory and is *not* an input
to classification** — a bounded, possibly-truncated ancestor list cannot prove
an indirect relationship.

Evaluate top to bottom; the four classes are **mutually exclusive** (proof
below):

| # | class | condition (all must hold) |
|---|---|---|
| **exact** | `target.revisionId === proposal.base.revisionId` **and** `fullContentDigest(target) === proposal.base.contentDigest` |
| **direct fast-forward** | *not* `exact`; **and** `proposal.base.revisionId === target.parentId`; **and** `nConf === 0` |
| **divergent** | same `projectId`; *not* `exact` / `direct fast-forward`; **and** `nConf ≥ 1` |
| **unknown ancestry** | same `projectId`; *not* `exact` / `direct fast-forward`; **and** `nConf === 0` (related content, but no file-contained proof that `proposal.base.revisionId` is `target.revisionId` or `target.parentId`) |

**Meaning / handling**

- **exact** — the target *is* the base, content-verified. Whole-proposal apply
  is a clean replace, **no confirmation** (§R7A.4).
- **direct fast-forward** — a *distinct, provable* case: the target is exactly
  **one** saved revision past the proposal's base (`target.parentId` is the
  base — a fact in the target file, not inferred), **and** nothing the target
  changed since then overlaps the proposal. Per-hunk "apply all" lands with
  **no confirmation** (a genuine fast-forward); a *whole-proposal* apply still
  confirms (it would also drop the target's one-revision-ahead edits).
- **divergent** — same project, the two lines changed overlapping regions →
  **confirmation** + manual per-hunk conflict resolution (§R7A.3 / §R7A.4).
- **unknown ancestry** — same project, no conflicting hunks, but the files do
  not prove how the two revisions relate. Handled **like `divergent`**
  (confirmation required); per-hunk "apply all" is possible since `nConf === 0`,
  but only behind the confirmation, whose message says the relationship is
  unproven.

**Non-overlap** — `exact` needs `target.revisionId === base.revisionId`;
`direct fast-forward` needs `target.parentId === base.revisionId` and *not*
`exact`, and a revision's `revisionId` is never its own `parentId` (§R11 — a
non-root `parentId` points to a different prior revision, a root's is `null`),
so `exact` ∩ `direct fast-forward` = ∅. `divergent` needs `nConf ≥ 1`;
`direct fast-forward` and `unknown` need `nConf === 0`. `direct fast-forward`
needs the `target.parentId === base.revisionId` proof; `unknown` is exactly its
absence. The four are disjoint and total (given the §R7A.1 same-project gate).

*(If a reviewer prefers fewer branches: dropping `direct fast-forward` and
folding it into `unknown` — i.e. every non-`exact` apply requires a
confirmation — is a valid simplification; its only cost is one extra click in
the clean one-revision-ahead case. See §R12 D10.)*

### R7A.3 Three-way per-hunk check

The proposal file contains `base.content`; the target's content is
`canonicalContent(open graph)`; the proposed content is
`canonicalContent(proposal top-level)`. For each proposal hunk (`base` →
`proposed`), compare the target's current value for that id:

- **`add`** — id absent in target → **clean**. Id present, projection equals the
  proposed → **no-op**. Id present, projection differs → **conflict** (added on
  both sides).
- **`remove`** — id present in target and equals `base.content`'s → **clean**.
  Id absent → **no-op**. Id present but changed vs `base.content` → **conflict**.
- **`change`** — id present and the fields the hunk changes still hold their
  `base.content` values in the target → **clean**. Id absent → **conflict**. A
  field already at the proposed value → that field **no-op**; a field at a third
  value → **conflict on that field** (`base` / `proposed` / `yours` all shown).

Conflicts are surfaced per hunk (and per field); the user picks **take
proposal** or **keep mine** for each, or skips. **Nothing is auto-resolved.**

### R7A.4 Confirmation

- **exact** → whole-proposal apply lands with **no** confirmation.
- **direct fast-forward** → per-hunk "apply all" lands with no confirmation
  (it is a clean fast-forward); a *whole-proposal* apply still confirms (it
  would also discard the target's one-revision-ahead changes).
- **divergent** / **unknown ancestry** → **explicit confirmation** naming both
  revisions and stating the loss, before *any* change:

  > *This proposal was made from `rev_ab…`{ (title) }. You have `rev_cd…` open{,
  > and their relationship can't be determined from the files }. Applying it
  > {replaces your graph with the proposal's version | applies N hunks; M
  > conflict}. Undo reverts it.*

  Actions: **Apply** (whole or resolved-per-hunk), **Open the proposal as a
  document** (§R10.5 — no apply, no new revision), **Cancel**.

---

## R8. Author-info trust level

- `meta.author.{name,note}`, `meta.title`, `meta.createdAt`, `meta.tool` are
  **unverified, self-asserted strings** written by whoever last exported the
  file. No signing, no identity, no server — a file can claim any author.
- The UI renders them as **claimed, not verified** — a muted *"proposed by
  Alex · unverified"*, *"file says: 2026-08-29"* — never as authenticated.
  Same posture as the Share-link disclosure in `SEMANTICS-U.md`. All rendered
  `meta` strings are escaped as text.
- **No diff / classify / apply / lineage decision depends on `meta`.** Missing,
  empty, or garbage `author` / `createdAt` / `tool` never blocks or changes an
  outcome; it renders as *"unknown"*.
- The trusted structural facts are `projectId`, `revisionId`, `parentId`,
  `base.*`, `appliedProposal.*`, `lineage[]` — trusted **only as opaque
  correlation keys**, never as proof of *who* or *when*.
- `meta.author.name` is filled from a **device-local** setting the user types
  once (`localStorage` key `AUTHOR_NAME_KEY`, §R11) — never from the OS, an
  account, or the network. **Before the name is stored, the settings UI states
  once that it is written into and travels with every revision / proposal file
  the user exports** (like a diagram label). `name` / `note` are truncated to
  the §R11 byte caps on export.

---

## R9. Invariants

| # | invariant |
|---|---|
| **R-INV-1** | A file with no `project` key behaves exactly as a `loop-workspace/1` / Graph file does today. Stripping `project` yields exactly what `Export(Workspace)` / `Export(Graph)` would have written. |
| **R-INV-2** | A `revisionId` names one exact content state: it is kept on re-export **only** while `fullContentDigest` is unchanged; any content change mints a new `revisionId` with `parentId` = the prior one. |
| **R-INV-2a** | A **successful** `Export → Project revision` commits its `{ revisionId, parentId, baselineDigest, lineage }` to the session **and** the autosaved project header, atomically, as a non-content non-undo update; so an immediate unchanged re-export reproduces the same id and bytes. **Any** failure (cancel, `serialize`, `REVISION_FILE_MAX_BYTES`, secure RNG) writes no file, mints no id, and leaves the session baseline / autosaved header / `dirty` exactly as before. `Make a proposal` changes none of them. |
| **R-INV-3** | `projectId` is stable across the whole lineage — every revision and proposal carries it byte-for-byte; promote mints it once; Apply and Export never change it. |
| **R-INV-4** | The canonical revision projection (§R4.2) and `canonicalJson` (§R4.3) are fixed: the same graph always yields the same `fullContentDigest`; element order and whitespace in a source file never change it. |
| **R-INV-5** | A proposal file always carries a complete `base.content` (§R6); the three-way diff and per-hunk apply are computable from the proposal file + the open document alone, with no external history. |
| **R-INV-6** | `base.contentDigest === SHA-256(canonicalJson(base.content))`; a mismatch makes the `project` payload corrupt (graph still loads). |
| **R-INV-7** | Apply always produces a **new** revision: fresh `revisionId`, `parentId` = the pre-apply target, `projectId` unchanged, `appliedProposal` recorded, applier as `meta.author`. The proposal's `revisionId` / author is never adopted as the result's identity / verified author. This holds for `exact` and `divergent` alike; only `divergent` / `unknown` add a confirmation. |
| **R-INV-8** | Apply is atomic: one `loadDoc()`, one `simulationRev` bump, paused at step 0, one undo entry; it writes no file and mutates neither the proposal nor the base file. |
| **R-INV-9** | Classification uses only file-contained, provable facts — `target.revisionId`, `target.parentId`, the two digests, and the three-way conflict count; **`lineage[]` is not an input**. The four classes are mutually exclusive; `unknown ancestry` is never inferred as `direct fast-forward`. |
| **R-INV-10** | No `project` payload — malformed, wrong version, wrong project, digest-inconsistent, or partially corrupt — can prevent the graph (and a valid `workspace`) from importing. |
| **R-INV-11** | Opening a proposal for Review does not change the open document; **Cancel** and any validation failure leave the graph, run state, undo history, and `projectStore` untouched. |
| **R-INV-12** | Secure randomness is required to mint an id; if `crypto.getRandomValues` is unavailable or throws, `Export → Project revision` / `Make a proposal` **abort** with a message — `Math.random()` is never a fallback. |
| **R-INV-13** | No automatic merge / rebase; conflicting hunks are surfaced with `base` / `proposed` / `yours` and resolved only by an explicit per-item choice. |

---

## R10. Import routing (Import ≠ Apply)

One file input; branch on the keys present. Nothing here changes the open
document except step 4 (opening a revision) and step 5's explicit
"open as a document".

1. **Parse + load the graph first** via `deserialize()`. Throws → Import fails
   as today; `workspace` / `project` are not consulted.
2. **`project` absent** → today's behaviour (`workspace` per `loop-workspace/1`,
   else a plain graph). Open project → `null`.
3. **`project` present but `schema !== "loop-revision/1"` or `version !== 1`**
   (strict — `"1"`, `1.5`, `0`, negative all fail), **or** any id fails the
   §R11 format check, **or** `base` is absent on a `role: "proposal"`, **or**
   `base.contentDigest !== SHA-256(canonicalJson(base.content))` → **load the
   graph / workspace only**, one-line warning; open project → `null`. The graph
   always survives (R-INV-10).
4. **`project.role === "revision"`** (or absent/unknown `role`) → **open it**:
   the graph (+ workspace) loads and `projectStore` is set from the file's
   `project` (baseline digest = `fullContentDigest` of the loaded graph). Same
   `projectId` as before ⇒ a different revision of the same project; otherwise a
   different project.
5. **`project.role === "proposal"`:**
   - `projectId` **matches** the open project → open the **Review** view: the
     RevisionDiff (§R5), the §R7A.2 classification, the §R7A.3 conflicts, and
     **Apply / Open-as-document / Cancel**. **The open document is unchanged
     until Apply** (R-INV-11).
   - `projectId` **differs**, or there is **no** open project → offer **"Open
     the proposed content as a document"**: load its graph, set `projectStore`
     from its `project` (you are now on *that* project, viewing the proposed
     content; the toolbar chip shows `proposal · viewing`), **no diff, no apply**
     — there is no target. Or **Cancel** (nothing changes).
6. On **Apply** only (from step 5, same project): the §R7 atomic path runs. On
   **Cancel**, or any per-field validation failure during Review, **nothing
   changes** — graph, run state, undo, `projectStore` all as before.

---

## R11. Constants & formats to pin on freeze

| name | value | note |
|---|---|---|
| `PROJECT_SCHEMA` | `"loop-revision/1"` | the `project.schema` string |
| `PROJECT_VERSION` | `1` | a v1 reader restores **only** `version === 1` (strict); else graph/workspace-only |
| id alphabet | Crockford base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I L O U`) | uppercase only |
| `PROJECT_ID` | `^proj_[0-9A-HJKMNP-TV-Z]{26}$` | 26 chars ≈ 130 bits, from `crypto.getRandomValues` |
| `REVISION_ID` | `^rev_[0-9A-HJKMNP-TV-Z]{26}$` | same generator; content-independent |
| `LINEAGE_MAX` | `64` | cap on `lineage[]`; excess dropped from the tail on rebuild |
| `AUTHOR_NAME_KEY` | `"loop-studio:author"` | device-local `localStorage` key (sibling of `loop-studio:theme`) |
| `AUTHOR_NAME_MAX_BYTES` | `80` | UTF-8; truncated on export at a code-point boundary |
| `AUTHOR_NOTE_MAX_BYTES` | `1000` | UTF-8; truncated at a code-point boundary |
| `REVISION_FILE_MAX_BYTES` | `8 * 1024 * 1024` (8 MiB) | hard cap on the serialized revision / proposal file, measured as UTF-8 length; over ⇒ export refused (no truncation) |
| RNG failure | **abort export** | `crypto.getRandomValues` unavailable / throwing ⇒ no id minted, no file written; **never** `Math.random()` |
| digest tooling | `crypto.subtle` where present, else the bundled pure-JS SHA-256 (as `loop-workspace/1` §W12.15) | a build with neither ⇒ `project` reader is graph-only + warning |

**Canonical projection field lists** — §R4.2 `FIELDS_BY_KIND` /
`EDGE_FIELDS_BY_KIND` are the frozen lists; a future engine field is added there
in `loop-revision/2`.

---

## R12. Decisions — to settle before freeze

| # | decision | proposed |
|---|---|---|
| **D1** | Container | a nested **`project`** key (additive, optional). A Project file is a valid Workspace / Graph file. |
| **D2** | Spec id | **`loop-revision/1`**. |
| **D3** | Project identity | one opaque crypto-random `projectId`, minted on promote, stable for the lineage; `projectId` equality is the *only* identity test. |
| **D4** | Revision identity, dirty & the session baseline | `revisionId` names one content state; a **successful** `Export → Project revision` commits the new `{ revisionId, parentId, baselineDigest, lineage }` to the session **and** the autosaved project header (a non-content, non-undo update); an unchanged re-export reproduces the **same id + bytes**; any failure (cancel / serialize / size / RNG) leaves baseline + file untouched; `Make a proposal` never changes the origin session (§R2.1). `dirty` is a pure `fullContentDigest` comparison. |
| **D5** | Canonical projection | **defined in §R4**, distinct from `loop-workspace/1`'s semantic digest: includes `label` + **full-precision `position`** + `recommendedRunConfig`; excludes `workspace` / `project` / `meta` / selection / UI transient; fixed field order, id-sorted arrays, **finite numbers kept exactly (`-0 → 0` only — NO rounding)**, missing-vs-default normalised to the default; **only** SHA-256 tooling is reused from W3.1. A UI may hide trivial position deltas with a display tolerance, never by rounding the digest input. |
| **D6** | Proposal carries the base | `project.base` includes a complete **`content`** snapshot (the canonical projection of the base) plus its digest, so three-way diff and per-hunk apply are fully offline-computable. |
| **D7** | Apply granularity | **both** whole-proposal and per-hunk selective apply are part of `loop-revision/1` — the file contract (D6) is complete for both from freeze. Implementation may ship whole-apply first; the wire format does not change. |
| **D8** | Apply result | always a **new** revision: fresh `revisionId`, `parentId` = pre-apply target, `projectId` unchanged, `appliedProposal` recorded, applier as `meta.author`; the proposal's id/author never adopted. Same for `exact` and `divergent`; only `divergent` / `unknown` add a confirmation. |
| **D9** | Apply scope & atomicity | structural graph + `recommendedRunConfig` (run/sim/workspace **not** applied; opt-in copies only the run config); one `loadDoc`, one `simulationRev` bump, paused/step 0, one undo entry; writes no file. |
| **D10** | Classification (§R7A.2 has the ID/digest/`nConf` table + a disjointness proof) | four **mutually-exclusive** classes from file-contained facts only — `exact` (`target.revisionId === base.revisionId` **and** digests equal), `direct fast-forward` (not exact; `target.parentId === base.revisionId`; `nConf === 0`), `divergent` (same project; not exact/ff; `nConf ≥ 1`), `unknown ancestry` (same project; not exact/ff; `nConf === 0`; no parent proof). `lineage[]` is **not** a classification input. `unknown` is handled like `divergent`. **Open question:** keep `direct fast-forward` (one fewer confirmation in the provable one-ahead case) or drop it and confirm every non-`exact` apply (simpler). |
| **D11** | Conflict model | no 3-way merge / rebase; per-hunk conflicts show `base` / `proposed` / `yours`, resolved by explicit per-item choice; whole-apply on a non-exact base needs explicit consent. |
| **D12** | Author trust | `meta.*` unverified, display-only, UI-labelled "claimed, not verified"; no logic depends on them; `author.name` from a device-local setting, disclosed once to travel in exported files; byte-capped. |
| **D13** | Import vs Apply | Import routes (§R10) and never changes the open doc except opening a revision or an explicit "open as a document"; Review is non-destructive; Apply is the only mutation and it is atomic; Cancel / validation failure = zero change. |
| **D14** | Limits | `LINEAGE_MAX 64`; author name/note byte caps; `REVISION_FILE_MAX_BYTES 8 MiB` (export refused over it, no truncation); `proj_` / `rev_` + 26 Crockford base32; secure-RNG failure aborts export. |
| **D15** | Out of v1 | accounts, server, cloud, real-time sync, presence, locking, signing, auto-merge/rebase, multi-project bundles, a disk revision browser, deep `workspace` diffing, any network transport. |

---

## R13. Implementation consequences (decided here; not part of the frozen wire contract)

- **`src/model/revision.ts`** — the `project` schema; `PROJECT_*` /
  `REVISION_ID` validators; `canonicalContent` / `canonicalJson` /
  `fullContentDigest` (reusing `src/model/workspace.ts`'s SHA-256 primitive);
  `computeRevisionDiff`; the §R7A.3 per-hunk applicability check; the defensive
  `project` reader (§R10 steps 3/6). `deserialize()` grows to return
  `{ …graph, workspace?, project? }`.
- **`src/store/projectStore.ts`** — the open revision +
  `{ baselineDigest, dirty }`; `promote()`, `nextRevision()` (digest-gated —
  §R2), `makeProposal()`, `openRevision(file)`, `applyProposal(proposal, {
  hunks?, alsoRunConfig? })` (builds the resulting graph, one
  `graphStore.loadDoc`, records `appliedProposal`), `clear()` (on `New` / a
  plain-file open).
- **`src/store/revisionIO.ts`** — `collectRevisionPayload()` /
  `collectProposalPayload()`; `serializeRevisionFile()` /
  `serializeProposalFile()` with the `REVISION_FILE_MAX_BYTES` measure;
  `routeImport(text)` extending `workspaceIO.importFile` (§R10).
- **Author setting** — a small settings control writing `AUTHOR_NAME_KEY`, with
  the "travels in the file" disclosure; read at `Make a proposal` / `Project
  revision` export.
- **UI** — `Export ▾` gains **Project revision** / **Make a proposal**; a
  toolbar **revision chip** (title · short `revisionId` · `proposal` /
  `viewing` badge · a dirty dot); a **Review** panel (desktop) / sheet (mobile,
  through the §MV3b confirm-before-replace path) with the RevisionDiff, per-hunk
  toggles + conflict resolvers, the §R7A.4 consent, and Apply / Open-as-document
  / Cancel.
- Apply reuses `graphStore.loadDoc` (the single `simulationRev` bump from
  `loop-workspace/1` §W7) so R-INV-8 holds with no new reset plumbing.

---

## R14. Acceptance vectors (test basis — filled on implementation)

1. **Plain / workspace files unaffected** — `Export(Graph)` / `Export(Workspace)`
   bytes identical before/after; a v0.4.0 Workspace file imports with no open
   project.
2. **Promote + immutable lineage** — open a plain graph, `Export → Project
   revision` ⇒ fresh `projectId`, `parentId: null`; **re-export with no edit ⇒
   byte-identical `revisionId` + `parentId`**; edit, export ⇒ same `projectId`,
   **new** `revisionId`, `parentId` = the first; `dirty` is true between the
   edit and the export, false after.
2a. **Dirty export → unchanged re-export is stable** — make an edit (`dirty`),
    `Export → Project revision` (⇒ new `revisionId` R₁, baseline + autosaved
    header updated), then **immediately re-export with no edit** ⇒ the file's
    `revisionId` is **still R₁**, `parentId` unchanged, and the two exported
    files are **byte-identical**. Two dirty exports in a row never produce two
    different revisions for one content state. Then: cancel a third export, and
    stub `serialize` / the size check / `crypto.getRandomValues` to fail on a
    fourth ⇒ each failure leaves the baseline, the autosaved header, `dirty`,
    and (no) file exactly as before. Undo across the edit moves content only —
    `revisionId` does not change; `dirty` re-derives from the baseline.
2b. **`Make a proposal` does not disturb the origin** — from a clean revision,
    `Make a proposal` ⇒ the session's `revisionId` / `parentId` / `role` /
    `baselineDigest` / `dirty` are unchanged; the autosaved header is unchanged.
3. **Canonical digest — normalisation** — two files for the same graph that
   differ only in node/edge array order, key order, `"capacity": null` vs
   omitted, `10` vs `10.0`, and whitespace ⇒ **equal** `fullContentDigest` and
   an **empty** diff. A **sub-pixel** node move (`x += 0.4`) ⇒ **different**
   `fullContentDigest`, `dirty` true, and one `changed` node hunk with a
   `position` field (a display tolerance may hide it in the diff *view*, but the
   digest and `base.content` carry the exact coordinate).
4. **Digest — cosmetic vs engine** — a proposal that moves a node, renames a
   Pool, and changes a Gate `distribution` ⇒ three `changed` node hunks with
   `position` / `label` tagged `cosmetic`, `data.distribution` tagged `engine`,
   `summary.engineAffecting === true`.
5. **Proposal carries a complete base** — `Make a proposal`, then with **only**
   the proposal file: reconstruct `base.content`, compute the diff against an
   independently-loaded target, and run a per-hunk apply — no other file needed;
   `base.contentDigest === SHA-256(canonicalJson(base.content))`.
6. **Whole-apply on `exact` base** — target `revisionId` + digest match ⇒ Apply
   with no confirmation; result graph === proposal graph; **new** `revisionId`,
   `parentId` = target, `appliedProposal` = {proposalId, baseId, baseDigest},
   `projectId` unchanged, `meta.author` = the applier; sim paused/step 0; one
   undo restores the target.
7. **Apply on `divergent` base** — edit the target after the proposal was made
   ⇒ §R7A.4 confirmation names both revisions; **Cancel** ⇒ zero change (graph,
   run, undo, `projectStore`); **Apply anyway** ⇒ new revision as in (6), undo
   reverts; **Open as a document** ⇒ switch to the proposal's content, **no**
   new revision minted.
8. **`direct fast-forward`** — target's `parentId` === `proposal.base.revisionId`
   and the three-way check has no conflicts ⇒ classed `direct fast-forward`;
   per-hunk "apply all" lands with no confirmation and yields a clean merge;
   whole-apply still confirms.
9. **`unknown ancestry` is not fast-forward** — `proposal.base.revisionId` is
   not the target's `revisionId` / `parentId` and not in a (short) `lineage[]`
   ⇒ classed `unknown ancestry`, treated as `divergent` (confirmation
   required); a longer `lineage[]` containing it moves it to `divergent`, never
   to `fast-forward`.
10. **Per-hunk conflict** — proposal changes node X `capacity` `10 → 20`; target
    already has `15` ⇒ conflict showing base `10` / proposed `20` / yours `15`;
    "keep mine" leaves `15`, "take proposal" sets `20`; result is a new
    revision; nothing auto-resolves.
11. **Per-hunk conflict — deleted target** — proposal changes X; target deleted
    X ⇒ conflict; "take proposal" re-adds X from the proposal, "keep mine"
    leaves it deleted.
12. **Wrong project** — a proposal with a different `projectId` ⇒ **refused to
    apply**, no diff, no state change; "open as a document" loads its graph and
    switches `projectStore` to that project.
13. **Author is display-only** — a proposal with `author.name` containing markup
    and a future `createdAt` ⇒ rendered escaped + muted "claimed, unverified";
    the diff, classification, and apply outcomes are byte-identical to the same
    file with `meta` removed.
14. **Corrupt / inconsistent `project`** — missing `revisionId`; `base` absent
    on a proposal; `base.contentDigest` not matching `base.content`; a
    non-Crockford id ⇒ graph (+ valid `workspace`) still import, `project`
    dropped + warning, `projectStore` `null`.
15. **Version must be exactly 1** — `project.version` of `2`, `0`, `-1`, `1.5`,
    `"1"` ⇒ graph/workspace load, `project` skipped + warning.
16. **File size cap** — a graph large enough that a proposal (base snapshot +
    proposed graph) exceeds `REVISION_FILE_MAX_BYTES` ⇒ `Make a proposal` is
    refused with a clear message; `Export → Project revision` and `Graph JSON`
    still work.
17. **Secure-RNG failure** — stub `crypto.getRandomValues` to throw ⇒
    `Export → Project revision` and `Make a proposal` abort with a message;
    nothing is written; **no** `Math.random()` id appears.
18. **Import ≠ Apply** — importing a same-project proposal opens Review with the
    canvas unchanged; the graph changes only on **Apply**; **Cancel** and a
    mid-Review validation failure leave everything as before.
19. **Deterministic diff** — shuffle `nodes` / `edges` and reformat whitespace
    in both files ⇒ identical `RevisionDiff`.
20. **`file://` portable** — promote (2), proposal round-trip (5), diff (4), and
    a whole-apply (6) all work in the portable single-file build from `file://`
    (SHA-256 via the bundled fallback, as `loop-workspace/1` §W12.15).
21. **Mobile** — a same-project proposal opened on the mobile layout shows the
    Review sheet; Apply goes through the §MV3b confirm-before-replace path and
    produces the same new revision as on desktop; the desktop `state-ui` /
    `visual` snapshots are unchanged.
