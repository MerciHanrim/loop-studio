# Small Module / Template System (non-frozen design doc — DRAFT)

**Status: DESIGN settled. Impl PR 1 (module insert / extract — §MS9 steps 1–6)
SHIPPED in `v0.8.0-dev` (PR #125, merge `eda6380`) + a follow-up (`1812762`,
v2-promotion consent copy + §MS6.1 mobile-exclusion contract); Production
hands-check functionally PASS. Impl PR 2 (the Inputs / Summary panels — §MS9
step 7) is in build.** `MS` prefix. This doc closes the decisions
[`docs/product-direction.md`](product-direction.md) deferred to the
**"small module / template system"** pass (§PD8-B): how part of a graph becomes
a **reusable module**, how a module is **inserted into an existing graph**
(id-collision, placement, connection boundary), the **surfaced inputs +
result Summary** separation (§PD5), the requirement that a whole insert is
**one `Ctrl+Z`**, and — first — **whether a module needs its own save format /
metadata at all**. The **§MS7** forks are now **decided** (all seven), and
**§MS4a** records five explicit boundaries added in review round 1.

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
- **MS4a** — the five explicit boundaries added in review round 1.
- **MS5** — the **Inputs panel** + **Summary panel** (§PD5) — presentation and
  data source. **Its implementation is a separate follow-up slice** (MS7-5),
  after module insert / extract lands; this doc fixes the design only.
- **MS6** — the assembly surface for v1 (an *Insert module…* menu — **bundled
  modules + file only**, no `#g1=` link — not a dedicated screen).
- **MS7** — the seven fork decisions (all resolved).
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
| `surfacedInputs: nodeId[]` | tell the Inputs panel which values to show, in what order | **Not needed for v1.** The Inputs panel shows **every `parameter` node** (and, for a v2 graph, every resource edge whose `flow` is `@param`) — see §MS5. The coffee Template's "five surfaced levers" *are already* exactly its five Parameters. Hand-picking a **subset** or a **custom order** is the only thing this field would add; it is a possible additive cosmetic follow-up (MS7-4 keeps it out of v1), not a v1 requirement. |
| `summaryOutputs: nodeId[]` | tell the Summary panel which outcomes to show | **Not needed.** Same argument: the Summary panel shows **every `register` node** with its `unit`. Registers already *are* "the outcome numbers that matter" (§PD5). |
| `ports: { edgeId, endpoint }[]` | remember where boundary edges attached, to help reconnection on insert | **Not needed for v1.** §MS2.3 drops boundary edges so the module file is a **self-contained valid graph**; reconnection to the host is a manual step. Recording ports as advisory hints is out of v1 (MS7-3) — a possible later addition. |
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
command **"Extract selection as module…"** produces a **new Graph JSON**,
**offered as a download only** (MS7-6). Opening the result in a new tab is a
follow-up to review later, not v1. **The source graph is not modified** —
Extract is copy-out, never cut, so it mints **no undo entry**.

### MS2.2 What the module file contains

- **Nodes:** every selected node, `data` verbatim.
- **Internal edges:** every edge whose **both** endpoints are selected, verbatim.
- **Positions:** translated so the selection's bounding-box top-left sits at a
  fixed origin (e.g. `(0, 0)`), so §MS3.2 placement is predictable. Relative
  layout is preserved exactly.
- **`recommendedRunConfig`:** **omitted** — a module is a fragment, not a run
  configuration. `canvasLocked` is never carried. (Insert also ignores any
  `recommendedRunConfig` a hand-made module file carries — §MS3.7 / §MS4a-B2.)
- **`frames`:** **omitted** — a module fragment carries no saved frames
  (`SF` §SF2). If the source graph *has* saved frames, the Extract confirmation
  **states that frames are not included** before it produces the file, so no
  loss is silent (§MS4a-B3).
- **`schema`:** `loop-studio/graph/2` iff a surviving edge's `flow` is an
  `@param` reference (every referenced Parameter is guaranteed inside the
  selection, because a dangling reference **refuses** the Extract — §MS2.4);
  else `loop-studio/graph`.

### MS2.3 Boundary edges

An edge with **exactly one** endpoint in the selection is a **boundary edge**.
**Decision (MS7-3): boundary edges are dropped.** The module file is a
self-contained valid graph; its "ports" are simply the nodes that previously
had an external connection, and the user reconnects them to the host after
insert (§MS3.3). **No `portHints` metadata is written in v1** — recording ports
is a possible later addition, not part of this pass.

### MS2.4 Dangling references — Extract is refused (§MS4a-B1)

If a **selected** `register`'s expression, or a **selected** edge's v2 `@param`
`flow`, references a node id that is **not** in the selection, the reference
would dangle in the module. **Extract is refused.** The command reports which
node(s) hold the offending reference(s) and which target id is out of the
selection, so the user can either widen the selection to include the target or
deselect the referencing node. **There is no "extract anyway" override** —
dropping only the boundary *edges* (§MS2.3) while leaving a dangling `@ref`
would produce a module that is structurally fine but silently mis-computes, and
that is exactly what this boundary prevents.

(A boundary *edge* being dropped is fine — an edge carries no expression to
mis-resolve; a dangling `@ref` inside a kept node's `data` is not.)

---

## MS3. Insert module

The core new editor operation: **merge** a module's content into the open
graph. `insertGraph(moduleDoc, opts)` — pure at the model layer
(`src/model/`), driven by one store action.

### MS3.1 Id re-issue — every id, always (MS7-1)

**Every** node id and edge id in the module is re-issued to a **fresh id**
(`nextId(kind)` — the existing time+seq scheme, uniqueness guaranteed),
**regardless of whether it collides with a host id.** A module insert is always
an **independent instance**; inserting the same module twice yields two fully
separate copies with no shared id. Build a `Map<oldId, newId>` and rewrite, in
the module's content only:

- every internal edge's `source` / `target`;
- every `register` `data.expr` and every v2 `@param` edge `flow` — parse with
  the existing `parse()` (`src/model/expr/`), walk the AST, replace each `ref`
  id via the map, re-serialise with `canonicalPrint` / `canonicalRef` (helpers
  already exist: `refsOf`, `canonicalRef`). A dangling `@ref` cannot reach this
  point — Extract refused it (§MS2.4) and Insert's §MS3.6 validation would
  refuse a hand-made one.
- `recommendedRunConfig` — **not present** (§MS2.2) and **ignored if a
  hand-made file carries one** (§MS3.7).

**Redo reuses the first insert's ids.** `Ctrl+Shift+Z` restores the *same*
post-insert snapshot, so the ids minted on the original insert come back
verbatim (§MS3.5). Only a *fresh* re-insert (choosing the module from the menu
again) mints another new set.

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

### MS3.4 Model-version interaction — consent before apply (MS7-2)

| host | module | result |
|---|---|---|
| v1 | v1 | stays v1 |
| v2 | v1 | stays v2 (v1 content is a subset of v2) |
| v2 | v2 | stays v2 |
| **v1** | **v2** (`@param` flow) | **confirm dialog → on confirm, promote + insert as one Undo unit; on cancel, nothing changes** |

Inserting a v2 module into a v1 document *is* the `loop-model/2` promotion
trigger (`SEMANTICS-M2.md §M2-1.1` — v1 → v2 is a user-action latch: removing an
`@` reference later, or a plain open / save, never downgrades), but promotion is
significant enough that it is **not silent**. Before anything is applied, a
confirmation states: *inserting this block turns the document into a v2 model
and the model-semantics digest changes; a single undo reverses the model change
and the insert together*. The dialog does **not** call the change "one-way" —
in this transaction it is explicitly undoable (§MS3.5); the latch property
(§M2-1.1) is about auto-downgrade, not about undo, and is out of scope for this
confirmation.

- **Confirm** → the v2 promotion **and** the insert are performed as **one**
  history transaction (§MS3.5) — a single `Ctrl+Z` undoes both together, back to
  a v1 document with no inserted nodes.
- **Cancel** → **nothing changes**: the host graph, `modelVersion`, undo
  history, and selection are all exactly as before.

The other three rows apply with no dialog.

### MS3.5 One atomic Undo/Redo transaction — the hard requirement

`insertGraph` is **one** history transaction covering **everything** it does:

1. `commit('')` once (empty tag ⇒ never coalesces ⇒ its own entry);
2. one `set({ nodes: [...host, ...reissued], edges: [...host, ...reissuedInternal], modelVersion: <promoted?>, selectedNodeId/selectedEdgeId: <the inserted set> })`;
3. `bump()` (one `simulationRev` step) + `persist()`.

Bound into that **single** entry: the **re-issued ids**, the **v2 promotion**
(when §MS3.4 confirmed), the **entire inserted node + edge set**, and the
**selection change**. One `Ctrl+Z` removes every inserted node and edge, reverts
`modelVersion`, and restores the prior selection — all together. `Ctrl+Shift+Z`
restores the identical post-insert snapshot (same re-issued ids, same
`modelVersion`, same selection). `frameStore` is untouched. No new undo
mechanism — it reuses `graphStore`'s snapshot history, exactly like `loadDoc`
but **merging** instead of replacing.

### MS3.6 Build the full candidate, validate, then apply once — or change nothing

The merge is built **entirely in scratch** (maps / arrays), never in place:

1. re-issue all ids (§MS3.1), rewrite every internal endpoint and every
   `@ref` / `@param flow`;
2. compute the placed positions (§MS3.2);
3. form the candidate `{ nodes, edges, modelVersion }`;
4. run `validateResultGraph` on it — the same full-GraphDoc check a selective
   revision Apply runs (no edge incident to a `parameter` / `register`, handles
   match edge kind, finite numbers, id-sorted) **plus** expression parse of
   every rewritten `expr` / `@param flow`.

Only if step 4 passes does the single `set` (§MS3.5) run. **On any failure the
host graph, its `modelVersion`, the undo history, and the selection state are
left completely unchanged** — no partial insert, no orphan id, no history
entry. The failure is reported with the specific reason.

### MS3.7 What insert ignores / drops (§MS4a-B2 / B3)

- **`recommendedRunConfig`** in a module file (a hand-made one might have it) —
  **ignored**. The **host's** run config is kept as-is; the insert never
  touches `mcStore` / the Timeline selection / `canvasLocked`.
- **`frames`** in a module file — **dropped**. If the module Graph JSON carries
  a saved-frames block, the pre-apply confirmation **states that its frames are
  not carried into the host** (no silent loss), then insert proceeds without
  them. `frameStore` is untouched either way.

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

## MS4a. Explicit boundaries (review round 1)

Five boundaries added so that no loss or partial change is silent. Each is
stated where it applies above; collected here for review.

| id | boundary |
|---|---|
| **B1** | **A dangling `@ref` refuses Extract.** If a selected `register` expr or a selected v2 `@param flow` targets a node outside the selection, Extract is **refused** and the offending reference(s) are shown. Dropping only the boundary *edges* while leaving a broken `@ref` is not allowed. There is no override. (§MS2.4) |
| **B2** | **A module's `recommendedRunConfig` is ignored on insert; the host's run config is kept.** Insert never touches `mcStore`, the Timeline selection, or `canvasLocked`. Extract omits `recommendedRunConfig` from the module file. (§MS2.2 / §MS3.7) |
| **B3** | **Saved frames are never carried through a v1 module insert / extract.** If the source graph (extract) or the module file (insert) has a `frames` block, the confirmation **states the frames are excluded** before the operation runs — no silent loss. `frameStore` is untouched. (§MS2.2 / §MS3.7) |
| **B4** | **Build the full candidate (all ids + `@ref` rewritten), validate it, then apply once — or change nothing.** On any validation / parse failure the host graph, its `modelVersion`, the undo history, and the selection state are **all** left completely unchanged. (§MS3.6) |
| **B5** | **One atomic Undo/Redo contract, tested as one.** The id re-issue result, the v2 promotion (when confirmed), the entire inserted node/edge set, and the selection change are a **single** history entry — one `Ctrl+Z` reverts all of them, `Ctrl+Shift+Z` restores all of them (same ids, same `modelVersion`, same selection). (§MS3.5 / §MS8) |

---

## MS5. Inputs panel + Summary panel (§PD5)

> **Built as impl PR 2 (MS7-5), after module insert / extract landed.** The "As
> built" note at the end of this section records the shipped shape.

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
- Ordering: by the node's canonical id order (deterministic). A curated
  subset / order is **not** in v1 (MS7-4) — see §MS4.

### MS5.2 Summary panel

- Lists **every `register` node**: `label`, current `R(t)` value + `unit`, and
  a **`계산식 보기` / Show-calculation** toggle to reveal the expression. A
  plain-language description ahead of the literal formula is a **§PD5
  follow-up** — not built here; the toggle reveals the **canonical expression
  text** for now.
- A register whose `R(t)` is invalid this step shows the same "—" / no-value
  tell it shows on the canvas (never bridged, never hidden), plus its
  diagnostic code.
- Read-through to the canvas, same as §MS5.1.

### MS5.3 What they are not

- Not a new editor mode; the canvas stays the primary surface and advanced
  editing (add / connect / expressions) is unchanged.
- Not persisted, not in any file, not in any digest. The only stored state is
  each panel's collapsed/expanded flag — a **UI preference** in its own
  `localStorage` key (`loop-studio:inputs-panel` / `:summary-panel`), like the
  filter panel; never the GraphDoc.
- Not gated to templates — shown whenever the graph has ≥ 1 `parameter` or
  ≥ 1 `register`.
- **Desktop only** — the panels mount in the desktop right column
  (`DesktopInspector`); mobile stays view / run only, and the read-only mobile
  Inspector sheet is unchanged. A read-only mobile Summary is a possible later
  add.

### MS5.4 As built (impl PR 2)

- **`src/components/ModelPanels.tsx`** — `<ModelPanels/>` renders two `<section>`
  panels (Inputs, Summary) at the top of a single scrolling `.rightcol` that
  also holds the Inspector (`DesktopInspector` now wraps both; the fixed width /
  border / background moved from `.inspector` to `.rightcol`). Renders `null`
  when the graph has no `parameter` and no `register` (§MS5.3).
- **Inputs** — every `parameter` sorted by id: label (read-through button) + a
  number `<input>` writing `updateNodeData(id, { value })` — one history entry
  per commit, exactly like the Inspector, `disabled` under `canvasLocked`. For
  a v2 graph, every resource edge whose `flow` starts with `@` is listed as a
  compact one-line pointer *"src → tgt · flow via &lt;Parameter&gt;"* with no
  editable field.
- **Summary** — every `register` sorted by id: label + `R(t)` (from
  `useRegisterOutcomes()`) + `unit`, and a Show-/Hide-calculation toggle
  (per-row local state) revealing the canonical expression. Invalid ⇒
  *"— no value at step N"* + the `M_REG_*` code.
- **Read-through** — a row label click calls `setSelection`, sets the React
  Flow `selected` ring, and `setCenter`s the viewport on the node. The panels
  sit **outside** the edit-lock `<fieldset disabled>`, so read-through and the
  calc toggle stay usable under `canvasLocked`.
- **Collapse** — `uiStore.inputsPanelOpen` / `summaryPanelOpen`, default open,
  own `localStorage` keys (`readBoolKey(key, true)`).
- **Tests** — `src/store/uiStore.test.ts` (the two toggles) +
  `e2e/model-panels.spec.ts` (9): presence gate, value-edit one-undo, v2
  `@param` flow rows, R(t)/unit + calc toggle + invalid tell, read-through
  select + centre, collapse persistence, edit-lock behaviour, no
  `simulationRev` / export impact, desktop-only.

---

## MS6. The assembly surface for v1

- The Templates menu area gains an **"Insert module…"** action (a submenu, or
  a section in the existing Templates menu) with **exactly two sources**
  (MS7-7): the **bundled Building blocks** (each a small Graph JSON in
  `examples/`, registered like a Template) and **"From file…"** (a Graph JSON
  file picker). **`#g1=` Share-link insert is excluded from v1** — a later
  follow-up if wanted.
- Picking one runs `insertGraph` (§MS3) at the viewport centre; dragging a
  block entry onto the canvas runs it at the drop point.
- **That is the whole assembly surface for v1.** No dedicated screen, no
  staged wizard. §PD3's "a staged build flow" (resources → core loop → costs →
  probabilities → end condition → observations) is a **guided-order hint** in
  the block list / help text, not a mode.
- The **dedicated assembly screen** with its own focus / filter substrate
  (§PD8-B) is explicitly a **later, separate pass** — §MS0 / §MS10.

### MS6.1 Mobile — no module UI (existing policy)

Module insert / extract is a **structural editing** feature, and structural
editing is **desktop-only** (`docs/mobile.md §MV3a`). Therefore, by design:

- **No Insert-module menu, no *From file…*, no *Extract selection as module…*,
  and no drag-to-insert on mobile / at a narrow viewport.** The `<ModuleMenu>`
  renders after the Toolbar's `if (isMobile) return <MobileTopBar/>` early
  return, and the mobile More sheet carries none of it.
- Mobile stays **view / run only**, unchanged — "view & run — edit on desktop".
- The only mobile requirement for this feature is **negative**: at 375 px the
  module code must not break the top bar or the More menu (it adds nothing
  there). Locked by `e2e/module-system.spec.ts` — *"the module menu is
  desktop-only — absent on a narrow (mobile) viewport"* (`.toolbar--mobile`
  visible, the *Insert module ▾* button count is 0).

A mobile module surface is **not planned** — if it is ever wanted it is its own
pass, gated on mobile structural editing existing at all.

---

## MS7. Fork decisions (all resolved, review round 1 — 2026-09-04)

| id | question | **decision** |
|---|---|---|
| **MS7-1** | §MS3.1 — remap only colliding ids vs **all** ids on insert | **All ids, always re-issued** — regardless of collision. A repeat insert is always an independent instance. **Redo reuses the ids minted on the first insert** (it restores that snapshot). |
| **MS7-2** | §MS3.4 — v2 module into a v1 host | **Consent before apply.** Show the promotion fact + impact and ask; on **confirm**, the v2 promotion **and** insert are **one** Undo unit; on **cancel**, nothing changes. |
| **MS7-3** | §MS2.3 — boundary edges on Extract | **Dropped.** No `portHints` in v1. |
| **MS7-4** | §MS1.2 / §MS5.1 — a serialised surfaced-input list for v1 | **Not added.** The panel shows every Parameter / Register; a curated subset/order is a possible later additive `cosmetic` field only. |
| **MS7-5** | §MS5 — Inputs / Summary panels in this pass's impl PR, or a later slice | **A separate follow-up slice**, after module insert / extract lands. Not in the first module-system impl PR. |
| **MS7-6** | §MS2.1 — Extract delivery | **Download only** in v1. New-tab is a later follow-up. |
| **MS7-7** | §MS6 — `#g1=` link insert in v1 | **Excluded.** v1 insert = bundled modules + Graph JSON file only. |

---

## MS8. Test / acceptance scope (for the impl PR)

**Id re-issue (MS7-1):**
- Insert → **every** node/edge id is a fresh id (whether or not it collided);
  every internal edge endpoint, every `register` expr `@ref`, every v2
  `@param flow` is rewritten to the new id; no host node/edge changes; the
  merged graph validates and parses.
- Insert the **same module twice** → two fully disjoint copies, no shared id;
  each runs independently.

**One atomic Undo/Redo contract (§MS4a-B5 — tested as one):**
- Insert → `simulationRev` +1, exactly **one** history entry.
- One `Ctrl+Z` removes **every** inserted node + edge, reverts `modelVersion`
  (if it was promoted), and restores the exact prior selection — all together.
- `Ctrl+Shift+Z` restores the identical post-insert snapshot: **same** re-issued
  ids, **same** `modelVersion`, **same** selection.
- `frameStore` is unchanged before, during, and after; no `frameStore` history
  entry.

**v2-into-v1 consent (MS7-2):**
- v1 host + v2 module → the confirmation is shown *before* any change.
- **Confirm** → `modelVersion` = 2, `@param` flows resolve, and a **single**
  `Ctrl+Z` returns a v1 document with no inserted nodes (promotion + insert in
  one entry).
- **Cancel** → host graph, `modelVersion`, undo history, and selection are
  byte-identical to before (§MS4a-B4).

**Build-validate-then-apply / atomicity (§MS4a-B4):**
- A module with an edge incident to a `parameter` / `register`, a non-finite
  number, an unparseable `expr` after rewrite, or a bad handle → **refused**;
  the host graph, `modelVersion`, undo history, and selection are **all**
  byte-identical before / after the refusal (nothing partial, no orphan id).

**Extract (§MS2 / MS7-3 / MS7-6):**
- Selection → module file has exactly the selected nodes + fully-internal edges,
  positions normalised to origin, **no `recommendedRunConfig`**, **no
  `frames`**; the source graph is unchanged and **no undo entry** is minted.
- Delivered as a **download** (no new-tab path).
- **Boundary edges dropped**; no `portHints` key in the output.

**Dangling-`@ref` refusal (§MS4a-B1):**
- A selected `register` expr or v2 `@param flow` targeting a node outside the
  selection → Extract is **refused**, the offending reference(s) reported, and
  no file is produced. No "extract anyway" path exists.

**Run-config isolation (§MS4a-B2):**
- Inserting a (hand-made) module file that carries a `recommendedRunConfig` →
  `mcStore` config, the Timeline selection, and `canvasLocked` are unchanged.

**Frames-exclusion notice (§MS4a-B3):**
- Extract from a graph that **has** saved frames → the confirmation states the
  frames are not included, then the file is produced without them.
- Insert a module file that **has** a `frames` block → the confirmation states
  the frames are not carried into the host, then insert proceeds without them;
  `frameStore` untouched.

**Round-trip:** Extract → Insert back into the same graph → a second disjoint
copy; the two copies run independently.

**Mobile — negative only (§MS6.1):**
- At 375 px the mobile top bar renders and the *Insert module ▾* button count is
  **0** — no module menu, no *From file…*, no *Extract*, no drag-to-insert.
- The module code adds nothing to the mobile top bar or the More sheet and does
  not clip or push either.
- There is **no** mobile insert / extract path to test — mobile is view / run
  only (`docs/mobile.md §MV3a`).

**Panels (the later slice, MS7-5):** Inputs panel lists every Parameter with an
editable value + read-through select; Summary panel lists every Register +
`unit` + `계산식 보기`; both absent with no Parameter / Register; neither writes
to any file or digest.

**Invariance:** a full `vitest` + e2e pass showing **no change** to any
`loop-revision/*` / `loop-workspace/*` / Share digest, projection, or golden
fixture — there is no format change to break.

**i18n:** every new UI string (menu labels, the v2-promotion consent copy, the
extract / insert / frames-exclusion confirmations, panel headers) added to
`en` + `ko` with the CI catalog-parity + hardcoded-string checks.

---

## MS9. Slice / build order (for the impl PR — pending separate approval)

**Impl PR 1 — module insert / extract:**

1. **Model layer** — `insertGraph(hostDoc, moduleDoc, opts)` pure function:
   full id re-issue map (§MS3.1), expr-`@ref` / `@param flow` rewrite,
   placement offset, `recommendedRunConfig` / `frames` stripped from the module
   input, the full candidate build + `validateResultGraph` + expr parse
   (§MS3.6). Unit-tested against hand-built fixtures. No store, no UI.
2. **Store + one atomic transaction** — a `graphStore.insertGraph` action
   wrapping (1) in a single `commit('')` → `set` (nodes + edges + `modelVersion`
   + selection) → `bump` (§MS3.5); the v2-into-v1 **consent** gate (§MS3.4) that
   changes nothing on cancel.
3. **Extract** — `extractModule(doc, selectedIds)` pure function
   (fully-internal edges only, positions to origin, no rrc, no frames) + a
   store command that produces the **download**; the **dangling-`@ref`
   refusal** (§MS2.4); the **frames-exclusion notice** (§MS4a-B3).
4. **Assembly surface** — the *Insert module…* menu (bundled blocks + From
   file…, **no `#g1=`**), drag-to-insert on the canvas.
5. **Bundled Building blocks** — 2–4 small generalised blocks (~8–15 nodes
   each) in `examples/`, registered like Templates, EN + KO names via the
   existing label overlay.
6. **Docs** — README roadmap (`Small module / template-composition system`
   → `◐` / `✅`), `examples/README.md`, and this doc's status.

### As built (impl PR 1)

- **Model layer** — `src/model/moduleGraph.ts`: `insertGraph(host, mod, opts)` +
  `extractModule(src, selectedIds)`, both pure. `insertGraph` re-issues **every**
  id (`nextId(kind)` / `nextId('e')`), rewrites `register` `expr` and v2 `@param`
  `flow` (`parse` → walk the AST replacing each `ref` id → `canonicalPrint`),
  offsets to the drop point, then `validateResultGraph` + `canonicalContent` the
  whole candidate before returning. `moduleGraph.test.ts` (16).
- **Store** — `graphStore.insertModule(module, { at, confirmedPromotion? })`:
  one `commit('')` → one `set` → `bump`. **`HistoryEntry` gained
  `modelVersion`** (undo / redo now restore it) so a promoting insert — and the
  existing leading-`@` flow latch — is reverted as one unit; no existing test
  regressed. Without consent a v2-into-v1 insert returns
  `{ ok: false, reason: 'needs-v2-consent' }` and changes nothing.
  `moduleInsert.test.ts` (6).
- **IO** — `src/store/moduleIO.ts`: `readModuleFile` (any Graph JSON is a
  module; reports `hadFrames` / `hadRunConfig`), `planSelectionAsModule`
  (serialise the selection via `extractModule`; no rrc / no frames), and
  `selectedNodeIds` (marquee selection, single-Inspector fallback).
- **UI** — `src/components/ModuleMenu.tsx` (an *Insert module ▾* menu next to
  Templates: the bundled blocks, *From file…*, *Extract selection as module…*;
  the v2 promotion consent + the frames-exclusion notice reuse `ConfirmDialog`).
  `Canvas.tsx` `handleDrop` also accepts the `application/loop-module` payload
  for drag-to-insert. **Desktop only** (§MS6.1) — `<ModuleMenu>` renders after
  the Toolbar's `if (isMobile) return <MobileTopBar/>`, so mobile has no module
  UI at all.
- **Blocks** — `examples/module-buffered-step.json`,
  `examples/module-reward-split.json` (v1, generalised), read by
  `src/model/modules.ts`, menu name / blurb keyed in
  `src/components/moduleKeys.ts` + `modules.*` in `en` / `ko`. Seeded node
  labels stay English in every locale for v1 (like `equilibrium` / `deadlock`);
  a KO node-label overlay for blocks is a later follow-up.
- **e2e** — `e2e/module-system.spec.ts` (12): menu contents; insert (fresh ids /
  selected set / one entry); one-undo + redo-same-ids; twice-disjoint; the v2
  consent gate (no-op / cancel / promote+insert one undo unit); a module file
  with `frames` + its own run config (notice, then host frames / MC config /
  Timeline untouched); drag-to-insert == the menu result; failure leaves the
  viewport untouched; Import → Module *From file…* → Import again in sequence;
  Extract to a download (internal edges only, no rrc / frames, positions to
  origin); dangling-`@ref` refusal (no download); **the module menu is absent
  at a 375-px mobile viewport** (§MS6.1). Plus `moduleGraph.test.ts` (18) and
  `moduleInsert.test.ts` (9) and the `graphStore.modelVersion` history
  regression (+3).

**Impl PR 2 (MS7-5) — the panels (in build):**

7. **Inputs / Summary panels** — `<ModelPanels/>` in the desktop right column
   above the Inspector: Inputs = every `parameter` (+ v2 `@param` flow pointers),
   Summary = every `register` (R(t) + unit + Show-calculation). Read-through
   select, per-panel collapse (`localStorage`), no GraphDoc / digest / undo
   impact beyond the value edits themselves. See §MS5.4 for the shipped shape.

Each PR is held as **Draft** until its acceptance subset (§MS8 / §MS5.4) is
green, then a separate merge approval.

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
| MS-Q3 | How are surfaced inputs + the result Summary presented, and from what? | **Two UI-only side panels** (§MS5) — designed here, **built as a separate follow-up slice** (MS7-5): Inputs = every `parameter` node (+ v2 `@param` flows) with editable values; Summary = every `register` node with `unit` + `계산식 보기`. No persistence, no file, no digest. |
| MS-Q4 | How is a module inserted into an existing graph? | **`insertGraph` merge** (§MS3): **every** node/edge id re-issued (not only colliding — MS7-1), `@ref` / `@param flow` rewritten to the new ids, placed at the drop point / viewport centre with no host node moved, inserted nodes selected, no automatic wiring. |
| MS-Q5 | Id resolution? | **Re-issue every id, always** (MS7-1). A repeat insert is always an independent instance; **Redo reuses the first insert's ids** (it restores that snapshot). Rewrite every internal endpoint and every `@ref` to match; validate the full candidate before applying. |
| MS-Q6 | Is a whole insert one `Ctrl+Z`? | **Yes — one atomic transaction** (§MS3.5 / §MS4a-B5): the re-issued ids, the v2 promotion (when confirmed), the whole inserted node/edge set, and the selection change are **one** history entry. One Undo reverts all; Redo restores all (same ids, `modelVersion`, selection). Reuses `graphStore`'s snapshot history. |
| MS-Q7 | Extract — cut or copy; boundary edges; delivery? | **Copy-out** (source unchanged, no undo entry). Boundary edges **dropped**, no `portHints` (MS7-3). **Download only** (MS7-6). A **dangling `@ref` refuses** Extract — no override (§MS4a-B1). No `recommendedRunConfig`, no `frames` (with a pre-op frames-exclusion notice — §MS4a-B3). |
| MS-Q8 | v2 module into a v1 host? | **Consent before apply** (MS7-2): show the promotion fact + impact, ask. **Confirm** → promotion + insert as **one** Undo unit. **Cancel** → nothing changes (§MS4a-B4). |
| MS-Q9 | Old-file / old-client compatibility? | **Preserved for free** — no file format changes at all (MS-Q1 / MS-Q2). Every existing graph / template / revision / Share / Workspace file and every digest is byte-for-byte unaffected. |
| MS-Q10 | The v1 assembly surface? | **An *Insert module…* menu** — bundled blocks + Graph JSON file only, **no `#g1=` link** (MS7-7) — and drag-to-insert on the open canvas (§MS6). **No dedicated assembly screen** (later, separate pass). |
| MS-Q11 | On any validation failure? | **Nothing changes** (§MS4a-B4): the host graph, `modelVersion`, undo history, and selection are all byte-identical before / after the refusal — the merge is built and checked entirely in scratch first. |
| MS-Q12 | A module's `recommendedRunConfig` on insert? | **Ignored** (§MS4a-B2). The host's run config, Timeline selection, and `canvasLocked` are untouched; insert never calls into `mcStore`. |

---

## MS12. Order this feeds into

1. **This design pass** — docs-only Draft PR. **Review round 1 (2026-09-04)**
   settled all seven §MS7 forks and added the five §MS4a boundaries; MS-Q1…Q12
   are the decision record.
2. **Impl PR 1** — §MS9 steps 1–6 (module insert / extract + assembly menu +
   bundled blocks). **Shipped** (PR #125, merge `eda6380`, `v0.8.0-dev`). **No
   serialized change** — a full invariance pass proved so. Production
   hands-check: functionally PASS across the six core flows (bundled insert +
   undo/redo · twice-disjoint · file insert · v2 consent + cancel · Extract +
   external-ref refusal · 375-px mobile layout). Closed after the follow-up
   below.
2a. **Follow-up (post-#125)** — fix the `modules.promote.body` copy so it no
   longer says the change is "one-way" in the same breath as "one undo reverses
   it" (EN + KO), and record the **mobile-exclusion contract** (§MS6.1) in this
   doc + the acceptance scope. Copy / docs only.
3. **Impl PR 2** — §MS9 step 7 / §MS5.4 (the Inputs / Summary panels). **In
   build** — `<ModelPanels/>` + `uiStore` prefs + `e2e/model-panels.spec.ts`;
   no serialized change (a per-panel collapse flag in its own `localStorage`
   key is the only stored state). Held Draft; separate merge approval.
4. **After both ship** — contextual inline help (README, Onboarding part 2) can
   start, now that the app's structure is fixed. The §PD12.3 candidates
   (external data binding, gacha Template, authored landmark regions) are
   reviewed against this shape.
