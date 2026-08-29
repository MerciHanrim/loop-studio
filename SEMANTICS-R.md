# Project Revision / Proposal

```
Spec ID: loop-revision/1
Status:  Draft — for review
```

**Draft (2026-08-29).** Not yet frozen. Once the §R10 decisions are settled and
this document is marked `Frozen`, it is the fixed target for the implementation
and a behavioural change afterward is a new spec id in a new document
(`loop-revision/2`), exactly as with `loop-state/1 → loop-state/2`; a frozen
file then takes only typo / clarifying-prose fixes.

Defines *what a Project is*, *how revisions chain*, *what a Proposal file is*,
*how a Proposal is diffed against a revision*, and *how a Proposal is applied* —
using files as the only transport, with **no accounts, no server, and no
real-time sync**.

Independent of, and layered on top of, the graph / engine / Monte-Carlo /
workspace / share specs. It never changes how a diagram *runs*.
`SEMANTICS.md`, `SEMANTICS-B1.md`, `SEMANTICS-B2.md`, `SEMANTICS-S.md`,
`SEMANTICS-S2.md`, `SEMANTICS-W.md` (`loop-workspace/1`), and `SEMANTICS-U.md`
(`loop-share/1`) are unaffected.

---

## R0. Scope

**Added**

- A **Project** — a lineage of revisions of one diagram, identified by a stable
  opaque `projectId`. A plain graph / Workspace file is *promoted* to a project
  on the first `Export → Project revision` (a `projectId` and a root revision
  are minted); nothing is a project until then.
- A **Revision** — one saved point in a project's lineage:
  `{ revisionId, parentId, role: "revision" }` plus the usual graph (and
  optional `workspace`) content.
- A **Proposal** — a revision-shaped file with `role: "proposal"` and a pinned
  **`base`** (the `revisionId` + content digest it was authored against). The
  unit that travels between people: *open a revision → make a Proposal copy →
  edit → send the file → the recipient diffs it against their revision →
  optionally applies it.*
- **`Export ▾` gains `Project revision`** (advance the lineage) and, when a
  project is open, **`Make a proposal`**.
- **Import auto-detects** a `project` key. A proposal for the open project opens
  a **Review** view (diff + apply); a revision of the open project (or a fresh
  project) opens as that revision; a file with no `project` key loads exactly as
  today.

**Out of scope for v1** — accounts, login, a server, cloud storage; real-time /
live collaboration, presence, document locking; automatic 3-way merge or rebase
(conflict *resolution* is manual, per hunk); cryptographic signing or verified
authorship; multi-project bundle files; a "revision browser" that lists files
from disk; diffing the `workspace` (run) payload beyond a single "differs" flag;
any network transport (the transport is a file, exactly like Workspace / Share
today).

**Unchanged** — the graph half is still written by the *same* `serialize()`
path; a Project file **is** a valid Workspace file **is** a valid Graph file.
Graph schema stays `version: 1`; `workspace` and `project` are additive,
optional top-level keys; an older build ignores an unknown top-level key.
`localStorage` still persists the **graph only** — never the project lineage.

---

## R1. File shape

```jsonc
{
  "schema": "loop-studio/graph",
  "version": 1,
  "nodes": [ /* … */ ],
  "edges": [ /* … */ ],
  "recommendedRunConfig": { /* … optional, as today … */ },
  "workspace": { /* … optional loop-workspace/1 payload, unchanged … */ },

  "project": {
    "schema": "loop-revision/1",
    "version": 1,

    "projectId": "proj_<26 chars, Crockford base32, crypto-random — minted once, stable for the whole lineage>",
    "revisionId": "rev_<26 chars — unique per exported file>",
    "parentId": "rev_<the revisionId this was derived from>",   // null only for a project's root revision
    "role": "revision",                                          // "revision" | "proposal"

    "base": {                                                    // present IFF role === "proposal"
      "revisionId": "rev_<the revision this proposal was branched from>",
      "contentDigest": "<sha-256 hex — fullContentDigest of that base revision; §R4.1>"
    },

    "appliedProposalId": "rev_<the proposal's revisionId>",      // present IFF this revision was produced by Apply (§R5); provenance only

    "lineage": [ "rev_<parentId>", "rev_<grandparent>", "…" ],   // advisory, newest-first, ≤ LINEAGE_MAX; may be short or absent

    "meta": {
      "title": "Coffee shop economy",                            // optional human label
      "createdAt": "2026-08-29T12:00:00Z",                       // ISO 8601 UTC — display only, never trusted for ordering
      "author": { "name": "Alex", "note": "tuned the drain rates" },  // UNVERIFIED self-asserted strings — §R7
      "tool": "loop-studio/0.5.0"                                // UNVERIFIED
    }
  }
}
```

Why a nested `project` key rather than a new container schema: today's Import
reads `nodes` / `edges` unchanged; an older build ignores `project` and still
opens the graph; a new build tells a plain / Workspace / Project file apart by
which keys are present — no schema bump, no `version` collision. **A Project
file is a valid Workspace file is a valid Graph file.**

---

## R2. Project identity

- **`projectId`** is an opaque, crypto-random id (`proj_` + 26 Crockford
  base32 chars). It is minted **exactly once** — the first time a plain graph /
  Workspace doc is saved via `Export → Project revision` — and is then **carried
  unchanged** by every revision and every proposal in the lineage. Apply never
  changes it (§R5). Nothing derives it from content; re-saving identical content
  keeps the same `projectId`.
- Two files **belong to the same project** iff their `project.projectId` strings
  are byte-equal. That is the **only** identity check — never a title, a
  filename, or a path.
- A file with **no `project` key** has no project identity. It cannot be
  imported as a proposal (there is no lineage to diff against); it opens as a
  fresh anonymous graph / Workspace, and may then be promoted to a **new**
  project (a fresh `projectId`).
- A `project.projectId` that is absent, empty, or not a string → the whole
  `project` key is ignored with a one-line warning; the file opens as a plain
  graph / Workspace.

---

## R3. Revision lineage

- The app holds the **open revision** in a `projectStore`:
  `{ projectId, revisionId, parentId, role, base?, lineage, meta }`, or `null`
  when the open doc is anonymous. It is populated on load of a project file, and
  replaced on `Export → Project revision` and on Apply.
- **`Export → Project revision`** mints a **new `revisionId`**, sets
  `parentId` to the *open* revision's `revisionId` (or `null` if this is the
  first save — the root), keeps `projectId`, sets `role: "revision"`, and makes
  that the new open revision. `lineage` is rebuilt as
  `[parentId, ...open.lineage].slice(0, LINEAGE_MAX)`.
- `revisionId` is opaque and **content-independent** (crypto-random, not a
  hash): every export is a distinct revision object, even with identical
  content. Ordering is by **`parentId` pointers only** — never by `createdAt`.
- The lineage is a **tree**, not a line: two proposals off one revision, each
  applied, yield two children of that revision. v1 never merges branches
  automatically (§R6); each Apply makes **one** new linear child of whatever is
  currently open.
- **`lineage[]`** is an *advisory* bounded list of recent ancestor
  `revisionId`s, newest first, starting with `parentId`. It is used only to
  classify a proposal's base as an ancestor of the open revision (fast-forward
  vs divergent, §R6). It is advisory: if short, missing, or malformed, conflict
  handling still works — it just falls back to the stricter digest comparison.
- **No trust in clocks or counters.** `createdAt` is display-only. There is no
  monotonic revision number.

---

## R4. Diff scope

A **RevisionDiff** compares a *base* revision's content against a *proposal*'s
content (or, in general, any two project files of the same `projectId`). It is
**deterministic and id-keyed** — element order and whitespace never affect it.

### R4.1 Two digests

- **`semanticContentDigest(doc)`** — SHA-256 of the canonical JSON of the
  **engine-relevant** projection, defined **identically to `loop-workspace/1`
  §W3.1 / §W11** (node: `id`, `kind`, engine fields; edge: `id`, `source`,
  `target`, `sourceHandle`, `targetHandle`, `data.kind`, `data.flow` |
  `data.mode` / `data.delay` / `data.expr`; drop `recommendedRunConfig`;
  id-sorted; fixed key order; lowercase hex). Answers *"does applying this
  change how the diagram runs?"*.
- **`fullContentDigest(doc)`** — the same, **plus** each node's `label` and
  `position` (each coordinate rounded to an integer) and each edge's `label`,
  **plus** `recommendedRunConfig`. Answers *"is this exactly the same document
  state?"*. This is the digest written into a proposal's `base.contentDigest`.

Both digests use the pure-JS SHA-256 fallback where `crypto.subtle` is absent
(same requirement and fallback as `loop-workspace/1` §W12.15).

### R4.2 What the diff reports

| part | granularity | fields |
|---|---|---|
| **nodes** | per `id`: `added` / `removed` / `changed` / `unchanged` | for `changed`: a per-field `{ field, base, proposal }` list over the **fullContent** node projection; each field tagged `engine` (in the semantic projection) or `cosmetic` (`label`, `position`) |
| **edges** | per `id`: same four buckets | for `changed`: per-field over `source`, `target`, `sourceHandle`, `targetHandle`, `data.*`; endpoint / handle / `data` changes are `engine`, an edge `label` change is `cosmetic` |
| **runConfig** | per key of `recommendedRunConfig` | `added` / `removed` / `changed` with `{ base, proposal }` |
| **workspace** | one boolean | `workspaceDiffers` — `true` if either side has a `workspace` key and the two `workspace` payloads are not deep-equal. **Not** broken down further in v1. |
| **meta** | — | never diffed (provenance, not content) |

- `RevisionDiff.summary` = counts (`{ nodes: {added, removed, changed}, edges:
  {…}, runConfigChanged, engineAffecting: <bool — any `changed`/`added`/`removed`
  hunk tagged engine, or any runConfig change> }`).
- An element with the **same `id`** on both sides but a different `kind` (node)
  or a different `data.kind` (edge) is reported as `changed` with the
  kind-change first; a downstream apply treats it as replace-in-place.
- The diff is defined for **any two docs of the same `projectId`**. Across
  different `projectId`s it is **not computed** (§R6 case 4).

---

## R5. Apply rules

"Apply" takes a **proposal** and produces a **new revision** of the project,
derived from the **currently open revision** (the *target*).

### R5.1 Whole-proposal apply (required)

- The resulting content is the **proposal's** `nodes` / `edges` /
  `recommendedRunConfig` **verbatim**. (Whole-apply does not merge; it adopts
  the proposal's graph.)
- A **new `revisionId`** is minted; `parentId` = the **target's** `revisionId`;
  `projectId` unchanged; `role: "revision"`;
  `appliedProposalId` = the proposal's `revisionId`; `lineage` rebuilt from the
  target. `meta.author` is taken from the **applier's** local author setting,
  not the proposal's (the proposal's author is preserved only in
  `appliedProposalId` provenance + the diff view).
- Apply is **atomic**: exactly one `loadDoc()` → one `simulationRev` bump →
  lands **paused at step 0** (a structural load resets the sim, as any load
  does), and is **one undo entry** (undo restores the pre-apply target).
- Apply **never** mutates the proposal file or the base file on disk, and never
  writes anything itself — it produces the new open revision in memory; the user
  then `Export → Project revision` to persist it.
- **Run / workspace state is not applied.** An opt-in **"also take the
  proposal's run config"** copies only `recommendedRunConfig` (and, if present,
  the proposal `workspace.mc.config`) — never a sim snapshot, never the MC
  result. Off by default.

### R5.2 Selective (per-hunk) apply — specified here; may land as a later slice

- The Review UI can offer per-hunk accept toggles. Each accepted hunk is
  **id-scoped and independently applicable**:
  - `add node/edge X` → insert X (proposal's version);
  - `remove node/edge X` → delete X;
  - `change node/edge X` → for a whole-element accept, replace X with the
    proposal's X; for **field-level** accept, set only the accepted fields on
    the target's X.
- Result content = **target + accepted hunks**, then the §R5.1 new-revision
  wrapping (atomic `loadDoc`, one bump, one undo entry).
- A hunk that is **not applicable** against the target (§R6.3) is shown but
  cannot be toggled on until resolved.
- Removing a node also removes its now-dangling edges (as the editor already
  does); a rejected node-remove hunk keeps that node and its edges.

### R5.3 Common to both

- **`projectId` never changes.**
- Applying is refused entirely if the proposal's `projectId` ≠ the target's
  (§R6.4).
- After a successful apply the app is on a **new, unsaved revision**; the
  toolbar revision indicator shows it as modified until `Export → Project
  revision`.

---

## R6. Conflict handling

No automatic merge. Everything below is either a clean apply or an **explicit,
consented** apply / manual per-hunk resolution.

### R6.1 Gate: same project

If `proposal.project.projectId !== target.project.projectId` → **refuse**:
*"This proposal belongs to a different project."* No diff, no apply. (Case 4.)

If the **target is anonymous** (no open project) → the proposal cannot be
applied; offer only **"Open the proposal as a new project"** (mint a fresh
`projectId` from the proposal's content) or **Cancel**.

### R6.2 Classify the target against the proposal's `base`

| # | condition | classification |
|---|---|---|
| 1 | `target.revisionId === proposal.base.revisionId` **and** `fullContentDigest(target) === proposal.base.contentDigest` | **exact base** — whole-proposal apply is clean; per-hunk apply has no conflicts |
| 2 | `target.revisionId !== proposal.base.revisionId` but `proposal.base.revisionId ∈ target.lineage` **and** every region a hunk touches still matches the base (per-field, §R6.3) | **fast-forward** — per-hunk apply lands cleanly; whole-proposal apply still asks for consent because it would also drop untouched-by-the-proposal edits the target made after `base` |
| 3 | `proposal.base.revisionId ∉ target.lineage`, **or** `target.revisionId === proposal.base.revisionId` but the digest does not match (the open doc was edited after that revision without re-saving) | **divergent** — no clean whole-apply; per-hunk apply must resolve conflicts (§R6.3) |
| 4 | `projectId` mismatch | **wrong project** — refused (§R6.1) |

A missing / empty `proposal.base` (a malformed proposal, or a `role: "revision"`
file dropped into Review) → treated as **divergent**, with the note *"this file
does not record what it was based on."*

### R6.3 Per-hunk applicability (fast-forward & divergent)

For each proposal hunk, compare the **target's current** projected value for
that `id` against the **proposal's `base`** value for the same `id`
(reconstructable from `proposal` content minus the hunk, i.e. the base side of
the diff):

- **`add`** — id absent in target → applicable. Id present in target with an
  **equal** projection → already there, hunk is a **no-op**. Id present but
  **different** → **conflict** (added on both sides differently).
- **`remove`** — id present in target and its projection **equals the base's** →
  applicable. Id absent → **no-op**. Id present but **changed** vs base →
  **conflict** (you edited what the proposal wants to delete).
- **`change`** — id present and the fields the hunk changes still hold their
  **base** values in the target → applicable. Id absent → **conflict** (you
  deleted what the proposal wants to change). A field already at the proposal's
  value → that field is a **no-op**; a field at a *third* value → **conflict on
  that field**.

Conflicts are **surfaced per hunk (and per field)** with `base`, `proposal`,
and `yours`; the user picks **take proposal** or **keep mine** for each, or
skips it. Nothing is auto-resolved. A "take proposal" on a conflicting `change`
whose id is missing first re-adds the element from the proposal.

### R6.4 Whole-proposal apply on a non-exact base

Allowed only with an explicit confirmation that names both revisions and states
the loss:

> *This proposal was made from revision `rev_ab…` (title, if any). You have
> `rev_cd…` open. Applying it replaces your current graph with the proposal's
> version — anything you changed since `rev_ab…` will be lost. Undo reverts it.*

with **Apply anyway**, **Open the proposal instead** (switch to viewing/running
the proposal as its own revision — no apply, no new revision), or **Cancel**.

### R6.5 What is never automatic

Renumbering ids, reconciling positions, choosing a "winner" for a conflicting
field, merging two divergent branches into one revision, or rebasing a proposal
onto a newer base. All of these are either manual (per-hunk) or out of scope.

---

## R7. Author-info trust level

- `project.meta.author.name`, `author.note`, `meta.title`, `meta.createdAt`,
  `meta.tool` are **unverified, self-asserted strings** written by whoever last
  exported the file. There is no signing, no identity check, no server — a file
  can claim any author.
- The UI renders them as **claimed, not verified** — e.g. a muted
  *"proposed by Alex · unverified"* and *"file says: 2026-08-29"*. Never
  presented as authenticated. Same disclosure posture as the Share-link warning
  in `SEMANTICS-U.md`.
- **No apply / diff / conflict / lineage logic depends on `meta`.** A missing,
  empty, or garbage `author` / `createdAt` / `tool` never blocks or changes an
  outcome; it renders as *"unknown"*.
- The trusted structural facts are `projectId`, `revisionId`, `parentId`,
  `base.*`, `appliedProposalId`, `lineage` — and they are trusted **only as
  opaque correlation keys**, never as proof of *who* produced a file or *when*.
- `author.name` is filled from a **device-local** setting the user types once
  (stored under the user's own `localStorage` key, like `theme`); it is never
  read from the OS, an account, or the network. `Make a proposal` states once
  that this name travels inside the file (like a diagram label). It contains no
  PII beyond what the user chooses to type.

---

## R8. Import routing

One file input; branch on the keys present.

1. **Parse + load the graph first** via the existing `deserialize()` path. If it
   throws, Import fails as today; `workspace` / `project` are not consulted.
2. **`project` absent** → today's behaviour (`workspace` handled per
   `loop-workspace/1`, else a plain graph). The open project becomes `null`.
3. **`project` present but `schema !== "loop-revision/1"` or `version !== 1`**
   (strict — a string `"1"`, `1.5`, `0`, negative all fail) → **load the graph /
   workspace only**, one-line warning (*"this file's project data is not a
   supported version"*); open project `null`.
4. **`project.role === "revision"`** (or unknown/absent `role`, treated as
   `"revision"`) → open it: the graph (+ workspace) loads, and the
   `projectStore` is set from the file's `project`. If it shares `projectId`
   with the previously open project, it is just a different revision of the same
   project; otherwise it is a different project.
5. **`project.role === "proposal"`**:
   - `projectId` **matches** the open project → open the **Review** view: the
     RevisionDiff (§R4) between the open revision (target) and the proposal, the
     §R6 classification, and the Apply / Open-instead / Cancel actions. The
     graph on screen does **not** change until the user applies.
   - `projectId` **differs** from the open project, or there is no open project
     → the §R6.1 refuse / "open as a new project" path.
6. A `project` payload that is structurally invalid (missing `projectId` /
   `revisionId`; `base` absent on a `proposal`; non-string ids) → **degrade**:
   load the graph / workspace, drop `project` with a warning, open project
   `null`. The graph always survives, exactly as `loop-workspace/1` §W5
   guarantees for `workspace`.

---

## R9. Invariants

| # | invariant |
|---|---|
| **R1** | A file with no `project` key behaves exactly as a `loop-workspace/1` / Graph file does today. Stripping `project` yields exactly what `Export(Workspace)` / `Export(Graph)` would have written. |
| **R2** | `projectId` is stable across an entire lineage — every revision and proposal derived from a project carries it byte-for-byte; promote mints it once; Apply and Export never change it. |
| **R3** | Apply produces a **new** revision whose `parentId` is the target it was applied onto, and **never** mutates the proposal file or the base file. |
| **R4** | Apply is atomic: one `loadDoc()`, one `simulationRev` bump, lands paused at step 0, one undo entry. |
| **R5** | A proposal whose `projectId` ≠ the open project is refused — no diff across projects, no apply. |
| **R6** | Whole-proposal apply onto a non-exact base requires an explicit confirmation naming both revisions; per-hunk apply surfaces every conflict with base / proposal / yours and resolves **none** automatically. |
| **R7** | `meta.author` / `createdAt` / `tool` are unverified, display-only; no diff / apply / conflict / lineage decision depends on them; the UI labels them as claimed-not-verified. |
| **R8** | The RevisionDiff is deterministic and id-keyed: element order and whitespace in the two files never change it; the same two files always produce the same diff. |
| **R9** | Round-trip — open a revision, `Make a proposal`, change nothing, Import the proposal: `fullContentDigest` equals the base's, the diff is empty, and Apply is a no-op that still advances the lineage only if the user asks. |
| **R10** | No `project` payload — malformed, wrong version, wrong project, or partially corrupt — can prevent the graph from importing. |

---

## R10. Decisions — to settle before freeze

| # | decision | proposed |
|---|---|---|
| **D1** | Container | a nested **`project`** key on the `loop-studio/graph` doc (additive, optional), not a new schema. A Project file is a valid Workspace / Graph file. |
| **D2** | Spec id | **`loop-revision/1`**, its own frozen id. |
| **D3** | Project identity | one opaque crypto-random `projectId`, minted on first `Export → Project revision`, stable for the whole lineage; equality of `projectId` is the *only* identity test. |
| **D4** | Revision id | opaque crypto-random, **content-independent** (every export is a distinct revision); lineage by `parentId` pointers only; `createdAt` never trusted for ordering. |
| **D5** | Proposal | a `role: "proposal"` file carrying a pinned **`base` = { revisionId, fullContentDigest }**; content is an editable copy of the base. Each re-export of a proposal mints a fresh `revisionId` but preserves `base`. |
| **D6** | Diff scope | id-keyed per-element `added` / `removed` / `changed` / `unchanged` over the **fullContent** projection (engine fields + `label` + `position` + `recommendedRunConfig`), each changed field tagged `engine` / `cosmetic`; `workspace` reduced to a single `workspaceDiffers` boolean; `meta` not diffed. |
| **D7** | Apply granularity | **whole-proposal apply is required (slice 1)**; **per-hunk selective apply is specified here** and may land as a later slice. Both wrap the result as a new revision atomically (one `loadDoc`, one bump, one undo). |
| **D8** | Apply scope | structural graph + `recommendedRunConfig`; **run / workspace / sim state is not applied** (an opt-in copies only the run config). Always lands paused / step 0. |
| **D9** | Conflict model | project-id gate → classify target vs `base` (exact / fast-forward / divergent) → whole-apply on a non-exact base needs explicit consent; per-hunk conflicts show base / proposal / yours and are resolved **manually**. **No 3-way merge, no rebase, no auto-resolution.** |
| **D10** | Author trust | `meta.*` are unverified self-asserted strings; UI labels them "claimed, not verified"; no logic depends on them; `author.name` comes from a device-local setting the user types once and is disclosed to travel in the file. |
| **D11** | Persistence | the project lineage lives only in files and the in-memory `projectStore`; `localStorage` still persists the **graph only**; `New` / opening a plain file clears the open project. |
| **D12** | Out of v1 | accounts, server, cloud, real-time sync, presence, locking, signing, auto-merge / rebase, multi-project bundles, a disk revision browser, deep `workspace` diffing, any network transport. |

---

## R11. Constants to pin on freeze

| name | value | note |
|---|---|---|
| `PROJECT_SCHEMA` | `"loop-revision/1"` | the `project.schema` string |
| `PROJECT_VERSION` | `1` | a v1 reader restores **only** `version === 1` (strict); everything else loads graph/workspace-only |
| `PROJECT_ID_PREFIX` | `"proj_"` | + 26 Crockford base32 chars from `crypto.getRandomValues` |
| `REVISION_ID_PREFIX` | `"rev_"` | + 26 Crockford base32 chars; content-independent |
| `LINEAGE_MAX` | `64` | cap on the advisory `lineage[]` ancestor list |
| `AUTHOR_NAME_KEY` | `"loop-studio:author"` | device-local `localStorage` key for the self-asserted author name (like `loop-studio:theme`) |
| digest projections | **semantic** = `loop-workspace/1` §W11 node/edge lists verbatim; **full** = semantic + node `label` + node `position` (integer-rounded) + edge `label` + `recommendedRunConfig` | canonicalisation (id-sort, fixed key order, no whitespace, SHA-256 lowercase hex, pure-JS fallback) identical to `loop-workspace/1` §W3.1 |

---

## R12. Implementation consequences (decided here; not part of the frozen wire contract)

- **`src/model/revision.ts`** — owns the `project` schema, id minting,
  `semanticContentDigest` / `fullContentDigest` (reusing
  `src/model/workspace.ts`'s digest primitives), `computeRevisionDiff(base,
  proposal)`, hunk applicability (§R6.3), and the defensive `project` reader.
  `deserialize()` grows to return `{ …graph, workspace?, project? }`.
- **`src/store/projectStore.ts`** — the open revision
  (`{ projectId, revisionId, parentId, role, base?, lineage, meta } | null`);
  `promote()`, `nextRevision()` (mint + set as open), `applyProposal(proposal,
  { hunks?, alsoRunConfig? })` (builds the resulting graph, calls
  `graphStore.loadDoc` once, records `appliedProposalId`), `openRevision(file)`,
  `clear()`.
- **`src/store/revisionIO.ts`** — `collectProjectPayload()`,
  `serializeRevisionFile()` / `serializeProposalFile()`, and `routeImport(text)`
  extending `workspaceIO.importFile` (§R8) so one file input covers graph /
  workspace / revision / proposal.
- **UI** — `Export ▾` gains **Project revision** and **Make a proposal**; a
  toolbar **revision chip** (project title · short `revisionId` · a `proposal`
  badge · a "modified" dot); a **Review** panel/sheet (the RevisionDiff, per-hunk
  toggles when selective apply ships, the §R6.4 consent dialog, Apply /
  Open-instead / Cancel). On mobile the Review panel is a sheet and Apply goes
  through the existing §MV3b confirm-before-replace path.
- **`recommendedRunConfig`** already round-trips through `serialize()`; the diff
  reads it directly.
- Apply reuses `graphStore.loadDoc` (the single `simulationRev` bump from
  `loop-workspace/1` §W7) so §R9/R4 hold without new reset plumbing.

---

## R13. Acceptance vectors (test basis — filled on implementation)

1. **Plain / workspace files unaffected** — `Export(Graph)` and
   `Export(Workspace)` bytes identical before/after this feature; a v0.4.0
   Workspace file imports with no open project.
2. **Promote + lineage** — open a plain graph, `Export → Project revision` ⇒ a
   `project` with a fresh `projectId`, `parentId: null`, `role: "revision"`;
   edit, export again ⇒ same `projectId`, new `revisionId`, `parentId` = the
   first.
3. **Make a proposal, no edits** — from a revision, `Make a proposal` ⇒
   `role: "proposal"`, `base.revisionId` = the open revision,
   `base.contentDigest` = its `fullContentDigest`; Import it into the same
   revision ⇒ **exact base**, diff empty, Apply is a no-op.
4. **Diff — engine vs cosmetic** — a proposal that moves a node, renames a Pool,
   and changes a Gate `distribution` ⇒ the diff lists three `changed` node
   hunks with `position` / `label` tagged `cosmetic` and `distribution` tagged
   `engine`; `summary.engineAffecting === true`.
5. **Whole-apply on exact base** — target === base ⇒ Apply with no confirmation;
   result graph === proposal graph; a **new** revision, `parentId` = target,
   `appliedProposalId` = the proposal, `projectId` unchanged; sim paused at
   step 0; one undo entry restores the target.
6. **Whole-apply on a divergent base** — edit the target after making the
   proposal ⇒ Apply shows the §R6.4 consent naming both revisions; **Cancel**
   changes nothing; **Apply anyway** replaces the graph and undo reverts it;
   **Open instead** switches to the proposal as its own revision with no new
   revision minted.
7. **Wrong project** — a proposal whose `projectId` differs ⇒ refused, no diff,
   no state change; the "open as a new project" path mints a fresh `projectId`.
8. **Per-hunk apply (when it ships)** — a proposal with 3 node changes and 1
   edge removal; accept 2 node changes, reject the rest ⇒ result = target + the
   2 accepted fields; new revision; the edge is still present.
9. **Per-hunk conflict** — the proposal changes node X's `capacity` from `10` to
   `20`; the target already changed it to `15` ⇒ that field is a **conflict**
   showing base `10` / proposal `20` / yours `15`; "keep mine" leaves `15`,
   "take proposal" sets `20`; nothing auto-resolves.
10. **Per-hunk conflict — deleted target** — the proposal changes node X; the
    target deleted X ⇒ conflict; "take proposal" re-adds X from the proposal,
    "keep mine" leaves X deleted.
11. **Author is display-only** — a proposal with `author.name: "<script>"` and a
    future `createdAt` ⇒ rendered as an escaped, muted "claimed, unverified"
    label; the diff, classification, and apply outcomes are byte-identical to
    the same file with `meta` removed.
12. **Version must be exactly 1** — `project.version` of `2`, `0`, `-1`, `1.5`,
    `"1"` ⇒ graph / workspace load, `project` skipped + warning; the
    `projectStore` stays `null`.
13. **Corrupt `project`** — missing `revisionId`; `base` absent on a proposal;
    non-string `projectId` ⇒ graph / workspace still import, `project` dropped
    with a warning.
14. **Old build** — a Project file opened by a `loop-revision`-unaware build
    (simulate by removing the reader) loads the graph (and the `workspace` if
    that reader exists).
15. **Deterministic diff** — shuffle `nodes` / `edges` order and reformat
    whitespace in both files ⇒ identical `RevisionDiff`.
16. **`file://` portable** — promote, proposal round-trip (3), diff (4), and a
    whole-apply (5) all work in the portable single-file build from `file://`
    (SHA-256 via the bundled pure-JS fallback, as `loop-workspace/1` §W12.15).
17. **Mobile** — a proposal opened on the mobile layout shows the Review sheet;
    Apply goes through the §MV3b confirm-before-replace path and produces the
    same new revision as on desktop; the desktop `state-ui` / `visual`
    snapshots are unchanged.
