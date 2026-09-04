# Small Module / Template System (non-frozen design doc — DRAFT)

**Status: DESIGN PASS — no implementation.** `MS` prefix. This doc closes the
decisions [`docs/product-direction.md`](product-direction.md) deferred to the
**"small module / template system"** pass (§PD8-B): how part of a graph becomes
a **reusable module**, how a module is **inserted into an existing graph**
(id-collision, placement, connection boundary), the **surfaced inputs +
result Summary** separation (§PD5), the requirement that a whole insert is
**one `Ctrl+Z`**, and — first — **whether a module needs its own save format /
metadata at all**.

It is the second Productization-track design pass; the first,
[`docs/large-graph-readability.md`](large-graph-readability.md), shipped in
`v0.8.0-dev`. It is a **non-frozen** design doc — no `loop-*/N` id, no `Frozen`
marker — like `large-graph-readability.md`, `edge-routing.md`,
`simulation-playback.md`, `localization.md`. **It changes no `src/` file, no
component, no style token, no localization string, and no serialized byte.**
Implementation is a **separate PR that needs separate approval**; this doc only
locks scope.

The headline finding, argued in **§MS1**: **a module is a plain Graph JSON. The
first cut needs no new schema, no new file kind, and no serialized module
metadata.** "Surfaced inputs" and "result Summary" are read off the existing
`parameter` / `register` node kinds, and "insert" is a runtime editor
operation, not a file feature — so old-file compatibility is preserved for
free, because nothing about any file changes.

---

## MS0. Scope

### In scope (this doc decides)

- **MS1** — what a module *is* (artifact + format); whether module save
  metadata is needed.
- **MS2** — **Extract as module**: turning a selection into a reusable Graph
  JSON; the boundary-edge (port) question.
- **MS3** — **Insert module**: the merge operation — id-collision resolution,
  expression-reference rewriting, placement, the connection boundary between
  module and host, the model-version interaction, and the **one-undo-entry**
  guarantee.
- **MS4** — save format + old-file compatibility (the "is metadata needed"
  judgement, in full).
- **MS5** — the **Inputs panel** + **Summary panel** (§PD5) — presentation,
  where the data comes from, persistence (none).
- **MS6** — the assembly surface for v1 (an *Insert module…* menu, not a
  dedicated screen).
- **MS7** — open forks for review.
- **MS8** — test / acceptance scope for the impl PR.
- **MS9** — slice / build order.

### Not in scope (named so they are not assumed)

- **A dedicated assembly screen** with its own layout / focus / filter
  substrate. §PD8-B mentions the readability focus/filter substrate as a
  dependency of "the module system's assembly screen"; **v1 assembly is
  "insert into the one canvas you already have"** (§MS6), so that screen is a
  later, separate pass.
- **A connection auto-helper** that proposes valid edge types + default
  expressions between two selected nodes (§PD3 lists it; it is a distinct
  nicety, deferred — §MS10).
- **Collapsible composite nodes / subgraphs** that fold a region into one node
  — a format-touching change, its own frozen amendment if ever taken up
  (§PD4 long-term).
- **Key-based external data binding**, a **gacha example Template**, and
  **semantic / authored landmark regions** — the §PD12.3 candidates. Reviewed
  only after this structure is fixed (§MS10).
- **Template localization overlay** — already shipped
  ([`docs/template-label-overlay.md`](template-label-overlay.md), so §PD7's
  "decided inside the module-system pass" item is **done**; this doc only
  references it).
- The **editorial roles** themselves (Example / Template / Building block) —
  decided in §PD3. This doc decides only whether they need a serialized `role`
  tag (they do not — §MS4).

---

## MS1. What a module is — and whether it needs its own format

### MS1.1 A module is a Graph JSON

A **module** (a "Building block" in §PD3 terms — ~8–15 nodes) is a **normal
Graph JSON file**: `schema: "loop-studio/graph"` or `"loop-studio/graph/2"`,
`version: 1`, `nodes`, `edges`, optional `recommendedRunConfig`. Nothing marks
it as "a module" in the file. What makes it insertable is the **Insert module**
editor operation (§MS3), which will accept *any* valid Graph JSON — bundled
block, a template, a graph a user exported themselves, or a Share payload.

- **No new `schema` value, no `version` bump, no new file extension, no
  `loop-*/N` id.** A module opens in the Templates menu / from disk exactly
  like any other graph.
- A module that happens to be a `loop-studio/graph/2` document carries `@param`
  flow references as usual; §MS3.4 covers inserting v2 content into a v1 host.

### MS1.2 The "does it need metadata" judgement (§PD3 deferred; user-flagged)

§PD3 deferred "any **save metadata** a block file carries." The instruction is
to **decide whether it is needed, not assume compatibility is simply
maintained.** Walking the candidate fields:

| candidate field | why it was considered | verdict |
|---|---|---|
| `role: "block" \| "template" \| "example"` | tell the Templates menu how to open / message the entry | **Not needed.** The Templates **registry** already carries name + blurb + `recommendedRunConfig.canvasLocked` (the Example lock). A standalone file opened from disk has no role and needs none — it opens as an editable graph. An advisory `role` string could be an additive cosmetic field *later*; it is not required for insert, packaging, or messaging to work. |
| `surfacedInputs: nodeId[]` | tell the Inputs panel which values to show, in what order | **Not needed for v1.** The Inputs panel shows **every `parameter` node** (and, for a v2 graph, every resource edge whose `flow` is `@param`) — see §MS5. The coffee Template's "five surfaced levers" *are already* exactly its five Parameters. Hand-picking a **subset** or a **custom order** is the only thing this field would add; it is a possible additive cosmetic follow-up (§MS7 fork), not a v1 requirement. |
| `summaryOutputs: nodeId[]` | tell the Summary panel which outcomes to show | **Not needed.** Same argument: the Summary panel shows **every `register` node** with its `unit`. Registers already *are* "the outcome numbers that matter" (§PD5). |
| `ports: { edgeId, endpoint }[]` | remember where boundary edges attached, to help reconnection on insert | **Not needed for v1.** §MS2.3 drops boundary edges so the module file is a **self-contained valid graph**; reconnection to the host is a manual step. Recording ports as advisory hints is a §MS7 fork. |
| a module-manifest / `module: {…}` block | a home for all of the above | **Not needed.** With every row above resolved to "no", there is nothing to put in it. |

**Conclusion: the first cut serialises no module metadata.** The design is
built so that "insert" and "surface the inputs / summary" both work off the
**existing node kinds and the existing Graph JSON**. Consequences:

- **Old files, old clients, every existing round-trip are untouched** — there
  is no format change to be compatible *with*. A pre-module-system client
  opening a graph that was later used as a module sees exactly what it sees
  today.
- The `loop-revision/*` digest, Share, Workspace, autosave, and every fixture
  are unaffected.
- If a real need for an author-curated input subset / order emerges from using
  the feature, it is added **then** as one additive **`cosmetic`** field on a
  future `loop-revision/N`, modelled on `route` / `waypoints` /
  `frames` — decided by that pass, not pre-approved here.

---

## MS2. Extract as module

### MS2.1 The gesture

With a set of nodes selected on the canvas (marquee or shift-click), a new
command **"Extract selection as module…"** produces a **new Graph JSON**
(offered as a download and/or opened in a new tab — same delivery as
`Export ▾`). **The source graph is not modified** — Extract is copy-out, never
cut, so it mints **no undo entry**.

### MS2.2 What the module file contains

- **Nodes:** every selected node, `data` verbatim.
- **Internal edges:** every edge whose **both** endpoints are selected, verbatim.
- **Positions:** translated so the selection's bounding-box top-left sits at a
  fixed origin (e.g. `(0, 0)`), so §MS3.2 placement is predictable. Relative
  layout is preserved exactly.
- **`recommendedRunConfig`:** omitted (a module is a fragment, not a run
  configuration). `canvasLocked` is never carried.
- **`frames`:** omitted — a module fragment carries no saved frames
  (consistent with "a pasted graph carries no `frames` block", `SF` §SF2).
- **`schema`:** `loop-studio/graph/2` iff a surviving edge's `flow` is an
  `@param` reference **and** every referenced Parameter is inside the selection
  (otherwise the reference would dangle — see §MS2.4); else
  `loop-studio/graph`.

### MS2.3 Boundary edges (the port question)

An edge with **exactly one** endpoint in the selection is a **boundary edge**.
A Graph JSON with an edge pointing at a missing node is invalid (the loader
isolates it with a warning). Options:

- **(a) Drop boundary edges.** The module file is a self-contained valid graph;
  its "ports" are simply the nodes that had an external connection, and the
  user reconnects them to the host after insert (§MS3.3).
- **(b) Record boundary edges as advisory `portHints`** metadata (which node,
  which handle, the dropped edge's `kind` / `flow`), shown on insert as
  "this block expects a connection here".

**Leaning: (a) for v1** — it needs no metadata (§MS1.2), keeps the module a
normal graph, and matches how "assemble" is currently only an *intent*
(§PD3). (b) is a §MS7 fork.

### MS2.4 Dangling references inside the extracted set

If a selected `register`'s expression, or a selected edge's `@param` `flow`,
references a node id **not** in the selection, that reference would dangle in
the module. Handling:

- **Warn and offer to widen the selection** to include the referenced node(s),
  or
- **Extract anyway** — the reference is kept as text; on load into any graph
  it resolves to `0` with the existing "unknown reference" diagnostic (this is
  already defined behaviour, `SEMANTICS-M.md`). The module is still a valid
  file.

**Leaning: warn + offer to widen; allow "extract anyway" as the explicit
override.**

---

## MS3. Insert module

The core new editor operation: **merge** a module's content into the open
graph. `insertGraph(moduleDoc, opts)` — pure at the model layer
(`src/model/`), driven by one store action.

### MS3.1 Id-collision resolution

For every node id and edge id in the module that **already exists in the
host**, mint a **fresh id** (`nextId(kind)` — the existing time+seq scheme, so
uniqueness is guaranteed) and build a `Map<oldId, newId>`. Then rewrite, in the
module's content only:

- every internal edge's `source` / `target`;
- every `register` `data.expr` and every `@param` edge `flow` — parse with the
  existing `parse()` (`src/model/expr/`), walk the AST, replace each `ref` id
  that is in the map, re-serialise with `canonicalPrint` / `canonicalRef`
  (helpers already exist: `refsOf`, `canonicalRef`);
- any `recommendedRunConfig.tracked` — **not applicable**, since §MS2.2 omits
  `recommendedRunConfig` from a module.

**Fork (§MS7): remap only colliding ids** (leaning — keeps readable ids stable
on a first insert; a second insert of the same module remaps because the first
insert's ids now exist) **vs. remap all ids unconditionally** (dead simple,
fully deterministic, but a first insert's ids stop matching the module file).

**Non-collision case:** if no id collides, no remap happens and no expression
is rewritten — a first insert into an empty-ish graph is byte-clean.

### MS3.2 Placement

The module's nodes are translated so its bounding box lands:

- at the **drop point** when inserted by dragging a block from a menu / palette
  onto the canvas; or
- at a **clear area near the current viewport centre** with a fixed nudge to
  avoid stacking on existing nodes, when inserted via a menu with no pointer
  position.

No node in the host graph moves. No re-layout.

### MS3.3 The connection boundary

After insert, **every inserted node is selected** (and nothing else), so the
user can immediately marquee-move the block or drag edges from its ports to
host nodes. **No automatic wiring in v1** — the connection helper (§PD3) is a
separate later pass (§MS10). The module and host are, until the user connects
them, two disjoint components in one graph — which the engine runs fine
(disconnected pools simply don't exchange).

### MS3.4 Model-version interaction

| host | module | result |
|---|---|---|
| v1 | v1 | stays v1 |
| v2 | v1 | stays v2 (v1 content is a subset of v2) |
| v2 | v2 | stays v2 |
| **v1** | **v2** (`@param` flow) | **the host promotes to v2** |

Inserting a v2 module into a v1 document is an **explicit user action**, which
is exactly the `loop-model/2` promotion trigger (`SEMANTICS-M2.md §M2-1.1` — v1
→ v2 is user-action-only, one-way). So the insert **auto-promotes the host to
v2** and shows a one-line notice ("this block uses parameter-driven flow — the
document is now a v2 model"). **Fork (§MS7):** auto-promote + notice (leaning)
vs. refuse the insert with a prompt to promote first.

### MS3.5 One undo entry — the hard requirement

`insertGraph` is **one** history transaction:

1. `commit('')` once (empty tag ⇒ never coalesces ⇒ its own entry);
2. one `set({ nodes: [...host, ...remapped], edges: [...host, ...remappedInternal], selectedNodeId: … })`;
3. `bump()` (one `simulationRev` step) + `persist()`.

This mirrors `loadDoc` exactly, but **merges** instead of replacing. A single
`Ctrl+Z` removes **every** inserted node and edge together and restores the
prior selection; `Ctrl+Shift+Z` re-inserts them with the **same** remapped ids
(the redo entry holds the post-insert snapshot). `frameStore` is untouched
(a module carries no frames). No new undo mechanism — it reuses the
snapshot-based history already in `graphStore`.

### MS3.6 Validation on insert

Before the `set`, the merged result is checked exactly as a selective revision
Apply already checks its result (`validateResultGraph` — no edge incident to a
`parameter` / `register`, handles match edge kind, finite numbers, id-sorted).
A module file that fails (hand-edited / hostile) is **refused with a reason**,
and the host graph is untouched — nothing is mutated in place; the merge is
built in scratch maps first.

---

## MS4. Save format & old-file compatibility — resolved

From §MS1.2: **v1 serialises no module metadata.** Therefore:

- **No `schema` / `version` change. No new `loop-*/N`. No new file kind.**
- **No GraphDoc change**, so the `loop-revision/*` canonical projection, its
  digest, `computeRevisionDiff`, three-way, Apply, Share, Workspace, autosave,
  and every golden fixture are **byte-for-byte unaffected**.
- **Old files:** every existing graph / template / revision / Share / Workspace
  file opens and round-trips exactly as today. There is nothing to migrate.
- **Old clients:** a pre-module-system client is a *current* client — it has
  the full file format already. "Insert" is a runtime editor action it simply
  lacks; the files it produces and consumes are unchanged.
- **The one deliberate door left open:** if usage shows authors need a curated
  surfaced-input **subset / order**, that becomes a single additive
  **`cosmetic`** field on a future `loop-revision/N` (the `route` / `waypoints`
  / `frames` pattern — projected, diffed, dirty-tracked, never
  engine-affecting), designed by that follow-up. It is **not** pre-approved
  here and **not** required for anything in §MS2 / §MS3 / §MS5 / §MS6.

---

## MS5. Inputs panel + Summary panel (§PD5)

Two collapsible side panels, **UI-only, no persistence**, recomputed from the
live graph each render. They are useful for **any** graph, not only modules /
templates — the module system is what introduces them.

### MS5.1 Inputs panel

- Lists **every `parameter` node**: its `label`, its current `value`, and an
  **editable number field** (writes `updateNodeData(id, { value })` — one undo
  entry per commit, same as editing it in the Inspector).
- For a **v2** graph, also lists **each resource edge whose `flow` is
  `@param`**, shown as "*<source> → <target>* — flow via **<Parameter label>**"
  (read-only pointer; editing is on the Parameter row).
- Each row is **read-through**: clicking it selects + centres the node on the
  canvas.
- Ordering: by the node's canonical id order (deterministic). A curated order
  is the §MS7 fork.

### MS5.2 Summary panel

- Lists **every `register` node**: `label`, current `R(t)` value + `unit`, and
  the existing **`계산식 보기` / show-calculation** toggle to reveal the
  expression (plain-language description first, literal formula behind the
  toggle — §PD5, already the model-language behaviour).
- A register whose `R(t)` is invalid this step shows the same "—" / error tell
  it shows on the canvas (never bridged, never hidden).
- Read-through to the canvas, same as §MS5.1.

### MS5.3 What they are not

- Not a new editor mode; the canvas stays the primary surface and advanced
  editing (add / connect / expressions) is unchanged.
- Not persisted, not in any file, not in any digest.
- Not gated to templates — shown whenever the graph has ≥ 1 `parameter` or
  ≥ 1 `register`.

---

## MS6. The assembly surface for v1

- The Templates menu area gains an **"Insert module…"** action (a submenu, or
  a section in the existing Templates menu): the **bundled Building blocks**
  (each a small Graph JSON in `examples/`, registered like a Template) plus
  **"From file…"** (a file picker) and, if a Share payload is in scope,
  **"From a `#g1=` link…"**.
- Picking one runs `insertGraph` (§MS3) at the viewport centre; dragging a
  block entry onto the canvas runs it at the drop point.
- **That is the whole assembly surface for v1.** No dedicated screen, no
  staged wizard. §PD3's "a staged build flow" (resources → core loop → costs →
  probabilities → end condition → observations) is a **guided-order hint** in
  the block list / help text, not a mode.
- The **dedicated assembly screen** with its own focus / filter substrate
  (§PD8-B) is explicitly a **later, separate pass** — §MS0 / §MS10.

---

## MS7. Open forks for review

| id | fork | leaning |
|---|---|---|
| **MS7-1** | §MS3.1 — remap **only colliding** ids vs **all** ids on insert | only colliding (stable ids on first insert; deterministic because `nextId` is unique) |
| **MS7-2** | §MS3.4 — v2 module into v1 host: **auto-promote + notice** vs **refuse + prompt** | auto-promote + notice (it *is* the explicit-action promotion trigger) |
| **MS7-3** | §MS2.3 — boundary edges on Extract: **drop** vs **record `portHints`** | drop (no metadata; module stays a normal graph) |
| **MS7-4** | §MS1.2 / §MS5.1 — **no** serialised surfaced-input list for v1 (panel shows all Parameters / Registers) — confirm acceptable, or is a curated subset/order needed on day one? | no serialised list for v1; add later as one additive `cosmetic` field if usage demands it |
| **MS7-5** | §MS5 — are the Inputs / Summary panels **part of this pass's impl PR**, or a **separate slice** after Insert lands? | same pass — they are small and are the concrete §PD5 deliverable |
| **MS7-6** | §MS2.1 — Extract delivery: **download only**, **new tab only**, or **both** (matching `Export ▾`) | both, matching `Export ▾` |
| **MS7-7** | §MS6 — does "From a `#g1=` link…" belong in v1, or Graph-JSON-file insert only? | file only for v1; link insert is a small follow-up |

---

## MS8. Test / acceptance scope (for the impl PR)

- **Insert — id remap:** inserting a module whose ids all collide with the host
  → every node/edge gets a fresh id; every internal edge endpoint, every
  `register` expr `@ref`, every `@param` `flow` is rewritten to the new id; no
  host node/edge changes; the merged graph validates.
- **Insert — no collision:** inserting into an empty / disjoint graph → ids
  unchanged, no expression rewritten.
- **Insert — one undo:** insert → `simulationRev` +1, one history entry; one
  `Ctrl+Z` removes exactly the inserted set and restores selection; redo
  re-inserts with identical remapped ids; `frameStore` untouched throughout.
- **Insert — v1 host + v2 module:** host promotes to v2 (per MS7-2 outcome),
  `modelVersion` = 2, `@param` flows resolve.
- **Insert — invalid module:** a module with an edge onto a `parameter`, or a
  non-finite number, is refused; the host graph is byte-identical before/after
  the refusal.
- **Extract:** selection → module file has exactly the selected nodes + fully
  internal edges, positions normalised to origin, no `recommendedRunConfig`, no
  `frames`; the source graph is unchanged and no undo entry is minted; a
  dangling `@ref` triggers the widen/override prompt.
- **Round-trip:** Extract a module → Insert it back into the same graph →
  (with remap) a second disjoint copy of the block; the two copies run
  independently.
- **Panels:** Inputs panel lists every Parameter with an editable value +
  read-through select; Summary panel lists every Register + `unit` +
  `계산식 보기`; both absent when the graph has no Parameter / Register; neither
  writes to any file or digest.
- **Invariance:** a full `vitest` + e2e pass showing no change to any
  `loop-revision/*` / `loop-workspace/*` / Share digest or fixture (there is no
  format change to break).
- **i18n:** new UI strings (menu labels, panel headers, the v2-promotion
  notice, the extract/insert confirmations) added to `en` + `ko` with the CI
  parity + surface checks.

---

## MS9. Slice / build order (for the impl PR — pending separate approval)

1. **Model layer** — `insertGraph(hostDoc, moduleDoc, opts)` pure function:
   id-remap map, expr-ref rewrite, placement offset, merged-result build +
   `validateResultGraph`. Unit-tested against hand-built fixtures. No store, no
   UI.
2. **Store + one-undo** — a `graphStore.insertGraph` action wrapping (1) in a
   single `commit('')` → `set` → `bump` transaction; the v2-promotion path.
3. **Extract** — `extractModule(doc, selectedIds)` pure function + a store
   command that produces the file (download / tab); the dangling-ref prompt.
4. **Assembly surface** — the *Insert module…* menu (bundled blocks + From
   file…), drag-to-insert on the canvas.
5. **Inputs / Summary panels** (MS7-5 → same pass) — two side panels reading
   `parameter` / `register` nodes, read-through select, no persistence.
6. **Bundled Building blocks** — 2–4 small generalised blocks (~8–15 nodes
   each) in `examples/`, registered like Templates, EN + KO names via the
   existing label overlay.
7. **Docs** — README roadmap (`Small module / template-composition system`
   → `◐` / `✅`), `examples/README.md`, and this doc's status.

Each slice is its own commit; the whole is one PR held as **Draft** until the
acceptance set (§MS8) is green, then a separate merge approval.

---

## MS10. What this doc does NOT decide

- **A dedicated assembly screen** (own layout, its own use of the readability
  focus/filter substrate — §PD8-B). v1 assembly is insert-into-the-open-canvas
  (§MS6); the screen is a later pass.
- **A connection auto-helper** — proposing valid edge kinds + default
  expressions between two selected nodes, and explaining an invalid pair
  (§PD3). Deferred; `insertGraph` leaves the module and host disjoint until the
  user wires them by hand.
- **Collapsible composite nodes / subgraphs** (§PD4 long-term) — a
  format-touching change with its own frozen amendment if ever taken up.
- **A serialised `role` / `surfacedInputs` / `ports` field** — argued
  unnecessary for v1 (§MS1.2); any of them is a separate additive `cosmetic`
  amendment decided by a later pass only if usage demands it.
- **Key-based external data binding**, a **gacha example Template**, and
  **semantic / authored landmark regions** (§PD12.3 candidates). To be
  reviewed **after** this structure is fixed — a data-bound `parameter` or a
  saved authored region both interact with `insertGraph` and the panels, so
  they inherit this doc's shape.
- **Template localization overlay** — already shipped
  ([`docs/template-label-overlay.md`](template-label-overlay.md)); the module
  system reuses it for bundled-block names, adds nothing.

---

## MS11. Decision record

| # | Question | Decision |
|---|---|---|
| MS-Q1 | Is a module a new file kind / schema? | **No.** A module is a plain Graph JSON (`loop-studio/graph` / `graph/2`). No new `schema`, `version`, extension, or `loop-*/N`. |
| MS-Q2 | Does a module carry save metadata (`role` / `surfacedInputs` / `ports` / manifest)? | **No, for v1.** Every candidate field resolves to "not needed" (§MS1.2). A curated surfaced-input subset/order is the only plausible future addition — then, as one additive `cosmetic` field, not now. |
| MS-Q3 | How are surfaced inputs + the result Summary presented, and from what? | **Two UI-only side panels** (§MS5): Inputs = every `parameter` node (+ v2 `@param` flows) with editable values; Summary = every `register` node with `unit` + `계산식 보기`. No persistence, no file, no digest. |
| MS-Q4 | How is a module inserted into an existing graph? | **`insertGraph` merge** (§MS3): fresh ids for colliding node/edge ids, expression `@ref` + `@param` `flow` rewritten to the new ids, placed at the drop point / viewport centre with no host node moved, inserted nodes selected, no automatic wiring. |
| MS-Q5 | Id-collision resolution? | **Remap only colliding ids** to a fresh `nextId(kind)` (MS7-1 leaning); rewrite every internal endpoint and every expression reference to match; validate the merged result before applying. |
| MS-Q6 | Is a whole insert one `Ctrl+Z`? | **Yes.** One `commit('')` → one `set` → one `bump` (§MS3.5), mirroring `loadDoc` but merging; a single Undo removes the entire inserted set; redo re-inserts with identical ids. Reuses the existing history mechanism. |
| MS-Q7 | Extract — does it cut or copy, and what about boundary edges? | **Copy-out** (source unchanged, no undo entry). Boundary edges are **dropped** (MS7-3 leaning) so the module file is a self-contained valid graph; reconnection to a host is manual after insert. |
| MS-Q8 | v2 module into a v1 host? | **Auto-promote the host to v2 with a notice** (MS7-2 leaning) — inserting is the explicit user action that `loop-model/2` promotion requires. |
| MS-Q9 | Old-file / old-client compatibility? | **Preserved for free** — no file format changes at all (MS-Q1 / MS-Q2). Every existing graph / template / revision / Share / Workspace file and every digest is byte-for-byte unaffected. |
| MS-Q10 | The v1 assembly surface? | **An *Insert module…* menu** (bundled blocks + From file…) and drag-to-insert on the open canvas (§MS6). **No dedicated assembly screen** — that is a later, separate pass. |

---

## MS12. Order this feeds into

1. **This design pass** — docs-only Draft PR (this file). Review the §MS7
   forks; settle MS-Q1…MS-Q10.
2. **Impl PR** — §MS9 slices, held Draft; separate merge approval. No
   serialized change; a full invariance pass proving so.
3. **After it ships** — contextual inline help (README, Onboarding part 2) can
   start, now that the app's structure is fixed. The §PD12.3 candidates
   (external data binding, gacha Template, authored landmark regions) are
   reviewed against this shape.
