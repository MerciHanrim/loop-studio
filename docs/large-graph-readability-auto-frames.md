# LGR Slice 4b — Auto group frames (non-frozen design doc — DRAFT)

**Status: design review — no implementation.** This is the own-design-pass that
[`docs/large-graph-readability.md`](large-graph-readability.md) §LGR6.3 / §LGR12
(slice 4b) and §LGR-D8 defer to. It decides the clustering heuristic, the
recompute policy, the relationship to the shipped Slice-4a manual frames, the
persistence boundary, composition, determinism, and the user-facing wording —
or puts each on the table as an explicit choice with a recommendation.

It changes **no** `src/`, GraphDoc, schema, `serialize`, digest, undo, or
engine. It merges as *settled design, implementation pending*, like
[`docs/parameter-inputs.md`](parameter-inputs.md) and
[`docs/example-mmo-progression.md`](example-mmo-progression.md). The
implementation PR does **not** start until these decisions are reviewed.

| | |
|---|---|
| **From** | Daisy |
| **For** | Hanrim · Lumi |
| **Prefix** | `AF` (auto-frames) |
| **Depends on** | Slice 4a (`transient` frames + Activity overlay), shipped — PR #113, merge `f6c9d8d` |
| **Feeds** | Slice 5 (`saved` frames) is still gated on a Frozen `loop-revision/N` `frames` contract (§LGR6.4); this doc does **not** open it |

---

## AF0. Purpose, and what this is NOT

**Purpose (fixed):**

> *An automatic, deterministic visual frame layer that **proposes**
> structurally-close clusters of nodes to help a first-time reader navigate a
> large graph.*

**AF0.1 — Not a semantic claim.** Auto frames do **not** understand domain
meaning. The GraphDoc carries no `기반 / 과정 / 결과` (base / process / result)
information; topology, `resourceType`, and `NodeKind` alone cannot infer a
domain region accurately (§PD12.2). The feature name, the UI copy, and this
doc all avoid any wording that implies the app "detected sections" or
"understood the model" (§AF9).

**AF0.2 — Explicitly out of scope, kept as separate §PD12 candidates:**

| Not this | Where it lives |
|---|---|
| **Semantic sections / authored landmarks** — a template author names regions by domain meaning | `docs/product-direction.md` §PD12.3-A — its own spec-first pass; may touch GraphDoc |
| **Hierarchical groups / collapsible subgraphs** — expand/collapse detail, Master/Root context | §PD12.3-B — its own design |
| **Key-based external data binding** | §PD12.3-C |
| **A `saved` frame that survives reload / Share / revision** | LGR Slice 5, behind a Frozen `frames` wire contract (§LGR6.4) |
| **Auto-layout of a region / "move the whole group"** | the module-system pass (§PD8-B); §LGR13 |

Auto frames are a **read-only overlay** in the same family as the orthogonal
route map (§ER3.9) — derived from `(graph, node positions)`, recomputed as a
whole, never a byte in any persisted structure.

---

## AF1. Reconciliation — what §LGR6 / §LGR12 said vs what Slice 4a shipped

Before designing 4b, pin the actual 4a surface it must compose with. Source:
`f6c9d8d` (`src/store/frameStore.ts`, `src/components/frames/*`,
`src/store/simStore.ts`, `src/index.css`).

| Topic | §LGR6 / §LGR12 as written | Shipped in Slice 4a (`f6c9d8d`) | Consequence for 4b |
|---|---|---|---|
| Manual-frame model | "a labelled rectangle" (§LGR6.5); the *`saved`* shape (§LGR6.4) has `members: nodeId[]` | `Frame = { id, n, label, rect: {x,y,w,h} }` — **no `members`**. A one-time "≥ 1 fully-contained node" guard at creation; after that, pure rectangle, **no membership**, interior click-through (LGR-D9) | An auto frame **computes** a member set to place its rect, but stores it only in the derived layer and **renders like a 4a frame** — rectangle only, interior not hit-testable, never moves a node |
| Frame store | in-memory; cleared on graph reload | `frameStore` `{ frames, toolArmed, selectedId, nextN }`; a module-level subscription clears it on `graphStore.loadRev` change; `nextN` (the `Group N` counter) resets to 1 on `clearFrames()` / `loadRev` | 4b adds a **derived** set alongside — see §AF6; it clears on the same `loadRev` signal, and additionally on its own re-infer |
| "atomic recompute like the route map" (§LGR6.3) | stated as the boundary | 4a has **no** recompute — frames are user-drawn only | 4b introduces the **first** frame recompute; the trigger policy is §AF4, the atomicity rule is §AF8 |
| Activity overlay window/decay ("Slice-4a tuning detail", §LGR6-cues) | left open | `ACTIVITY_WINDOW = 8` committed steps, **linear** recency weight (newest = 1, oldest of 8 = 1/8), opacity cap **≈ 0.15**; node tint = a shape `<path class="nodef__activity">`, edge tint = `--lgr-activity` on the path + a primary drop-shadow; cleared on sim Reset + graph reload, held on pause/end | Recorded here so §AF7 can state "Activity is **not** a grouping input" against a concrete definition |
| Mobile (§LGR-D12) | "auto frames render once Slice 4b ships" | 4a: no frame **drawing** control on mobile; the layer still renders; a "Clear group frames" row + the Activity toggle live in the More sheet | 4b: **Suggest frames** is a More-sheet action on mobile (§AF7); rendering already works |
| Controls column | not specified | when a frame exists, a conditional `rf-frame-clear` ControlButton is inserted, shifting the buttons below it down one slot (observed, accepted as-is) | 4b adds **one** more conditional control (`Suggest frames`); §AF9 notes the same column-shift caveat |

**No contradiction found** — 4a shipped a *narrower* frame than §LGR6.4's
`saved` sketch (no `members`), which is exactly right for a derived overlay.
The one genuinely new thing 4b brings is a **recompute**, so most of this doc
is about making that recompute predictable.

---

## AF2. User problem and success criteria

### AF2.1 The problem

A first-time reader opening a large graph (the 97-node MMO example is the
worst case shipped) cannot tell **where the major pieces are**. The canvas
shows every node and wire at once; Focus (§LGR2) needs a starting selection;
Filters (§LGR3.2) need the reader to already know what to hide. Auto frames
give an **unprompted** first pass: "here are ~4 areas, roughly, so you know
where to look."

### AF2.2 Where it is worth showing

- **Below ~25 drawn-edge-connected nodes**: not worth it — the whole graph
  fits one screen; **Suggest frames** may still run but is expected to produce
  0–2 frames and the UI should not push it.
- **~25–60 nodes**: the primary target (a Building block chain, a medium
  Template).
- **60+ nodes** (MMO): the case that motivated the feature.
- Coffee (23 nodes, 11 edges) is a **deliberate small-case check**, not the
  target — see the dry-run (§AF3.7).

### AF2.3 Success criteria

| # | Criterion | How it is evaluated |
|---|---|---|
| S1 | A reader shown the MMO example with auto frames on can point to "roughly where combat / rewards / economy / progression happen" **faster** than with frames off | timed comprehension check, same protocol family as §CR11 — read → describe the major areas; frames-on vs frames-off, counterbalanced |
| S2 | On the **MMO fixture** the frame count lands in the legible band **3–6** (`MAX_FRAMES` caps the top; ≥ 3 is expected for this graph's structure) | assertion on the dry-run + a CI test **on the MMO fixture** |
| S3 | **No mega-frame** — no single auto frame contains **> 55 %** of a component's framed nodes. *This one **is** a runtime property* — enforced by §AF3.6 rule 2 (split-big) on every graph | assertion + a runtime property of the algorithm |
| S4 | **No confetti** — no auto frame contains **< 3** nodes. *Also a runtime property* — §AF3.6 rule 1 merges or drops tiny groups on every graph | assertion + a runtime property of the algorithm |
| S5 | Re-running **Suggest frames** on an unchanged `(graph, positions)` produces byte-identical frames (rects, labels, order) — a runtime property | determinism test (§AF8) |
| S6 | A sim run, a Step, toggling Activity, changing Focus, or applying a Filter **never** changes the auto frames — a runtime property | recompute-trigger test (§AF4) |
| S7 | Expected shape on the **three bundled fixtures** is met (§AF3.6 dry-run table) — a regression check on graphs we know | dry-run recorded in this doc + a fixture test |

**Fixture criteria vs runtime properties.** S3, S4, S5, S6 are **runtime
properties** — the algorithm upholds them on *any* graph. S1, S2, S7 (and the
`framed fraction ≥ 0.5` check, §AF3.6) are **fixture criteria** — they say what
the current algorithm should produce on the Coffee / MMO / default graphs, to
catch a quality regression. They are **not** guarantees for an arbitrary user
graph: a user graph with little clean structure may legitimately yield 1–2
frames or **none**, and that is a normal successful `Suggest` result, not a
failure (§AF10.4). The algorithm never merges or fabricates a cluster to hit a
count or a coverage number.

**Explicitly NOT a success criterion:** that the frames "correctly classify the
domain meaning" of each region. The frames are structural; the labels say so
(§AF9.2). A region that a domain expert would draw differently is **not** a
failure as long as the runtime properties hold.

### AF2.4 Failure modes to detect

| Failure | Detector |
|---|---|
| one giant frame (CC-style collapse) | S2 + S3 |
| dozens of 1–2 node frames | S2 + S4 |
| frames that jump on every run / edit | S5 + S6 |
| frames overlapping so heavily the labels are unreadable | a max-overlap-ratio assertion on the dry-run |
| a frame that contains only Parameter / Register nodes | model nodes are excluded from membership (§AF3.5) — assertion that no auto frame's member set is all-model |

---

## AF3. Grouping-heuristic comparison

All candidates run on the **same fixture set**: `examples/coffee-roastery.json`
(23 nodes / 11 edges / 0 state edges / schema v2) and
`examples/mmo-progression.json` (97 nodes / 144 edges / 27 state edges), plus
the built-in 3-node default graph as a floor case. Numbers below are from a
dry-run script over the committed files (§AF3.7 has the script's output).

### AF3.1 Candidate A — connected components (drawn-edge graph)

- **How:** union-find over drawn edges (resource + state); each component is a
  frame.
- **Determinism:** total (union-find is order-independent for the partition).
- **Complexity:** `O(V + E·α)`.
- **Isolated nodes:** each becomes its own 1-node component → dropped by S4.
- **Bridge / hub nodes:** a hub does not split a component — it **glues**
  everything it touches into one.
- **State + dependency-hint edges:** including state edges glues more; hint
  edges do not exist on a normal canvas (§LGR-D4).
- **Param / Register:** all degree-0 in both examples (referenced only by `@id`
  in expressions, never by a drawn edge) → all isolated → all dropped.
- **Too-big / too-small:** no merge/split — the partition is whatever the
  topology is.
- **Dry-run:** Coffee → `[9, 4]` + 10 isolated. MMO → **`[90]`** + 7 isolated.
- **Verdict: REJECTED as the primary heuristic.** MMO collapses to one
  mega-frame (S3 hard-fail) because `level` (deg 13) and `gold` (deg 10) bridge
  every subsystem. Kept only as a **pre-filter**: run the real heuristic
  **per connected component** so two disconnected diagrams never share a frame.

### AF3.2 Candidate B — deterministic community detection (label propagation)

- **How:** synchronous-free label propagation over the drawn-edge graph with a
  **fixed processing order** (node id, lexical) and a **fixed tie-break**
  (lowest label id wins); model nodes excluded from the graph; iterate to a
  fixpoint or 20 rounds.
- **Determinism:** total, *given* the fixed order + tie-break (§AF8). This is
  the whole reason to use label propagation over Louvain — Louvain's greedy
  moves are order-sensitive and need a seeded RNG to be reproducible; LP with a
  lexical order needs none.
- **Complexity:** `O(rounds · E)`, rounds ≲ 20 in practice → effectively
  `O(E)`.
- **Isolated nodes:** keep their own label → 1-node groups → merged/dropped
  (§AF3.6).
- **Bridge / hub nodes:** a hub tends to adopt the label of its largest
  neighbourhood; **hub-edge down-weighting** (skip edges where both endpoints
  have degree ≥ `HUB_DEG`, default 8) is an option that pulls the two MMO
  mega-groups apart — see the dry-run.
- **State edges:** **included by default** — on MMO, including the 27 state
  edges changes the raw split from `[31,30,13,7,4,3,2]` to
  `[28,18,13,10,7,7,4,3]` (the 31/30 blob breaks up). Recommendation: **include
  state edges**, weight 1, same as a resource edge, because a `trigger` /
  `activator` link is a real structural adjacency the reader sees.
- **Param / Register:** excluded from the LP graph (§AF3.5).
- **Too-big / too-small:** handled by the post-pass (§AF3.6).
- **Dry-run (raw, before the post-pass):**
  - Coffee (resource only, model excluded): **`[5, 4, 4]`**, 0 isolated.
  - Coffee (+ state): `[5, 4, 4]` (no state edges → identical).
  - MMO (resource only): `[31, 30, 13, 7, 4, 3, 2]`, 0 isolated.
  - MMO (+ state): `[28, 18, 13, 10, 7, 7, 4, 3]`, 0 isolated.
- **Verdict: RECOMMENDED core**, with §AF3.6's post-pass. Coffee already lands
  at a clean 3 frames; MMO needs the small groups merged and — optionally — the
  ~28 group split. This is the only candidate that is both deterministic
  without an RNG **and** produces a legible count on MMO.

### AF3.3 Candidate C — directional reachability / flow corridors

- **How:** from each `source` (and each `parameter`-fed entry), compute the
  forward-reachable set over resource edges; each corridor is a frame.
- **Determinism:** total.
- **Complexity:** `O(sources · (V + E))` — 6 sources on MMO → fine.
- **Isolated nodes:** never in any corridor → dropped.
- **Bridge / hub nodes:** appear in **every** corridor that flows through them
  → frames overlap heavily (a hub like `gold` is in all of them).
- **State edges:** excluded (a state link is not resource flow).
- **Param / Register:** a Register is never on a resource path → excluded
  naturally; a Parameter feeds a `flow` by `@id`, not a drawn edge → excluded.
- **Too-big / too-small:** MMO has 6 sources; several corridors would be ~50+
  nodes and mutually ~70 % overlapping.
- **Dry-run estimate:** MMO → ~6 corridors, pairwise overlap frequently > 60 %.
  Coffee → 2 sources → 2 corridors, ~60 % overlap through `roasted_stock`.
- **Verdict: REJECTED as primary** (overlap makes the labels unreadable, S-fail
  on the overlap assertion). Kept as an **optional label input** — naming a
  frame after the source that dominates its member set (§AF9.2) reads better
  than a bare ordinal.

### AF3.4 Candidate D — shared `resourceType`

- **How:** group nodes/edges by their normalised `resourceType` string; one
  frame per distinct value + one for *untyped*.
- **Determinism:** total.
- **Coverage in the real fixtures:** Coffee tags **0** of 23 nodes. MMO tags
  **4** of 97 (`currency` ×1, `supply` ×2, `power` ×1).
- **Verdict: REJECTED.** `resourceType` is a free-form advisory field
  (`SEMANTICS-M.md` §M4.1) that authors barely use; it produces one *untyped*
  mega-frame on both examples. Not a grouping signal. (It **is** already a
  Filter axis — §LGR-D4 — which is the right home for it.)

### AF3.5 Candidate E — `NodeKind` classification

- **Verdict: REJECTED, with reason recorded.** Engine classes
  (`source` / `pool` / `gate` / `converter` / `drain` / `end` / `parameter` /
  `register`) are an **orthogonal axis** to a navigation region (§PD12.2): the
  MMO's "combat area" contains pools, gates, and converters; so does its
  "economy area". Grouping by kind produces 6–8 interleaved frames that each
  span the whole canvas. `NodeKind` stays a **Filter** axis (§LGR-D4), never a
  frame axis.
- **Model nodes** (`parameter`, `register`) are the one kind-based rule that
  **is** applied: they are **excluded from auto-frame membership** entirely.
  Rationale: in both bundled examples every model node is degree-0 on the drawn
  graph (they connect by `@id` reference, which auto frames do **not** parse —
  that is §PD12.3-A / the module system's connection helper). A frame drawn
  around a floating Register would be noise. If a future graph wires a
  Parameter by a drawn edge, it is still excluded from membership but **may**
  sit visually inside a frame's rect without being "in" it (frames have no
  membership at render time anyway, §AF1).

### AF3.6 The post-pass — merge small, split big

Applied to the raw community partition (Candidate B) **per connected
component**:

1. **Drop / merge small.** Any group with `< MIN_FRAME_NODES` (default **3**,
   S4): merge it into the neighbouring group it shares the most drawn edges
   with; tie-break = lowest group-representative node id. A group with no
   inter-group edge (a tiny isolated cluster) is **dropped** — no frame.
2. **Split big.** Any group with `> MAX_FRAME_FRACTION` of the component's
   framed nodes (default **0.55**, S3): sub-divide by a **single spatial cut**
   along the group's longer bounding-box axis at the **largest positional gap**
   (the biggest empty band between sorted node centres on that axis). Recurse
   at most **twice**. If no gap ≥ `MIN_SPLIT_GAP` (default 120 px) exists, the
   group is left whole and flagged in the dry-run (accepting a large-but-not-
   mega frame over an arbitrary cut).
3. **Cap count — drop, do not force-merge.** `MAX_FRAMES = 6` (**decided**). If,
   after 1–2, the component still yields more than `MAX_FRAMES` frames, keep the
   `MAX_FRAMES` **highest-quality** groups and **drop the rest — no frame**. A
   dropped group's nodes are simply left unframed. **Never** merge a leftover
   group into a kept one to hit the cap: forcing a weak cluster into a large
   frame is exactly the "auto frames become new visual complexity" failure the
   count limit exists to avoid. "Quality" rank = group size first, then
   intra-group edge density (edges among members / members), then lowest
   representative node id.
4. **Rect.** Each surviving group's rect = the axis-aligned bounding box of its
   member node rects, expanded by `FRAME_PAD` (default 24 px, flow units) on
   every side. No rect is smaller than `FRAME_MIN` (matches the 4a
   `FRAME_MIN_SCREEN_PX` intent at zoom 1).

**Dry-run after the post-pass (`MAX_FRAMES = 6`, drop-not-merge, state edges included):**

| Graph | Raw LP groups | After merge-small (< 3) | After split-big (> 0.55) | After cap (keep 6, drop rest) | **Final frame count** | Notes |
|---|---|---|---|---|---|---|
| default (3 nodes) | `[3]` | `[3]` | `[3]` | `[3]` | **1** (or 0 — below the "worth it" floor, §AF2.2) | UI does not push Suggest here |
| Coffee | `[5, 4, 4]` | `[5, 4, 4]` | `[5, 4, 4]` | `[5, 4, 4]` | **3** | meets S2–S4; the 10 model nodes are unframed |
| MMO | `[28, 18, 13, 10, 7, 7, 4, 3]` | `[28, 18, 13, 10, 7, 7, 7]` (the two 3–4 groups merge up into their densest neighbour) | `[28, 18, 13, 10, 7, 7, 7]` — the 28-group is 0.31 of 90, **under** 0.55, so **no split** | `[28, 18, 13, 10, 7, 7]` — the 7th group (the lowest-ranked 7-node group) is **dropped**, ~63 of 90 nodes framed | **6** | meets S2 (3–6), S3 (largest ≈ 31 %), S4 (min 6); ~27 MMO nodes intentionally unframed |

The dropped MMO group is a low-density 7-node cluster; leaving it unframed is
preferable to a 7th frame or to bloating a neighbour.

**`framed fraction ≥ 0.5` is a *fixture quality bar*, not a runtime invariant.**
A CI assertion on the **Coffee and MMO fixtures** pins the expected frame count
(3 and 6) and `framed fraction ≥ 0.5` — its only job is to catch an *algorithm
quality regression* on graphs we know well ("did a change start dropping groups
it used to keep"). It is **not** applied to arbitrary user graphs and it never
changes what the algorithm does:

- The algorithm **never** merges or fabricates a weak cluster to reach 50 %
  coverage. Rules 1–3 (§AF3.6) run purely on cluster quality; the framed
  fraction is only *observed* afterward, never *targeted*.
- On a user graph whose structure yields few reliable clusters, a **low framed
  fraction, a handful of frames, or "no frames to suggest" are all valid
  normal results** — `Suggest frames` completes successfully, no error, no
  failure state (§AF10.4).
- The 0.5 number lives only in the fixture tests. It carries no meaning for a
  live graph.

### AF3.7 Dry-run source

The numbers above are from a script over the committed `examples/*.json`
(connected components, degree histogram, hub list, deterministic
label-propagation with model nodes excluded). It is reproduced in the PR
description and will be committed as `scripts/lgr-autoframe-dryrun.mjs` **only
if** the heuristic is approved (it is a design artefact, not shipped code).
Key raw facts it established:

- Coffee: 1 component of 9 + 1 of 4 + **10 degree-0 model nodes**; no hubs.
- MMO: **1 component of 90** + 7 degree-0 Registers; hubs `level` (13),
  `gold` (10), `xp` (5), `hunt_payout` (6), `quest_payout` (6),
  `resupply` (6), … — which is exactly why connected components fails.
- MMO x-position histogram has natural empty bands at x≈800–1200 and
  x≈2400–2800 → a spatial split (§AF3.6 rule 2) has real gaps to cut on.

---

## AF4. Stability and the recompute trigger policy

**Auto frames must not move on their own.** A sim result, the Activity overlay,
and a Focus change are **not** recompute inputs (S6).

### AF4.1 The policy — DECIDED: P1 only

**Auto frames are computed only when the user explicitly invokes
`Suggest frames`. Nothing else ever triggers a (re)compute.**

| Policy | When frames (re)compute | Verdict |
|---|---|---|
| **P1 — explicit opt-in** | only when the user invokes **Suggest frames** | **ADOPTED** |
| P2 — auto on structural edit | + a recompute after any node/edge add/delete | rejected — frames rearrange silently while editing; a half-built graph churns (fails S6) |
| P3 — auto on template / load | + compute once when a Template or file loads | **rejected** — a Template's original placement and first impression must not be auto-altered, and an unrequested structural overlay would read as if the app had classified the Template into domain regions (§AF0.1) |
| P4 — separate Refresh action | + a "Refresh frames" button | rejected — the staleness signal (§AF4.3) covers the same need with no extra control |

Consequences, fixed:

- Opening a Template / file / Workspace / Share / revision, or **New graph**,
  produces **no** frames — the canvas is exactly as authored until the user
  asks.
- **Run, Step, sim Reset, the Activity overlay, Focus, and Filter changes never
  recompute** an auto frame (§AF4.2, §AF7 AF-INV-1/2).
- There is **no new `localStorage` key** for 4b — P3's toggle was the only one
  contemplated and P3 is rejected (§AF6).

### AF4.2 What each user action does to existing auto frames (fixed table)

Assumes P1 (frames exist because the user invoked Suggest earlier).

| Action | Effect on existing **auto** frames | Effect on **manual** frames |
|---|---|---|
| **Pan / zoom** | none (rects are flow-space) | none |
| **Select / deselect a node** | none | none |
| **Focus on / off** | none (de-emphasis is a render class, not a recompute) | none |
| **Apply / clear a Filter** | none — the frame set and every rect are **unchanged** even if all of a frame's members are hidden (§AF7) | none |
| **Toggle / step the Activity overlay** | none | none |
| **Sim run / Step / Reset** | none | none |
| **Move a node** | frames **do not follow** — the rect is frozen at last-compute; the moved node may now sit outside its frame's rect. A **staleness indicator** appears (§AF4.3). Re-invoking Suggest recomputes. | none (4a frames already never follow a node) |
| **Add / delete a node or edge** | frames unchanged + **staleness indicator**; re-invoke to recompute | none |
| **Edit a node label or a Parameter value** | none — not a structural change, no staleness | none |
| **Undo / redo a graph edit** | frames unchanged + staleness re-evaluated against the restored graph | none |
| **New graph / open Template / Import / open Workspace / open Share / open a revision** | **all auto frames dropped** (same `graphStore.loadRev` signal that clears 4a manual frames) | all dropped |
| **Full browser refresh** | dropped (session-only, §AF6) | dropped |
| **Reset view** (§LGR-D4) | **not** dropped — Reset view clears Focus + Filters, not frames (matches 4a: frames survive Reset view) | not dropped |

### AF4.3 The staleness indicator

When the drawn-edge graph or any framed node's position has changed since the
last Suggest, the **Suggest frames** control shows a subtle "recompute
available" state (a dot / changed tooltip — a §VL non-colour tell, forced-colors
safe). It never recomputes on its own. If **zero** auto frames currently exist,
there is nothing stale — the control is just "Suggest frames".

---

## AF5. Relationship to Slice 4a manual frames

### AF5.1 R1–R8 — DECIDED

| # | Question | Decision |
|---|---|---|
| R1 | Visual distinction manual vs auto | **manual = solid border; auto = dashed border.** Same rectangle geometry, same faint fill, same label-chip style. Forced-colors keeps the dashed-vs-solid tell (§AF7 AF-INV-6). No other affordance is required. |
| R2 | Overlap + paint order between the two kinds | all frames (both kinds) paint in the existing 4a back-layer, **behind** nodes / edges. Among frames: **manual always paints over auto** (the user's own rectangle wins the visual tie); within a kind, later-created over earlier (the 4a rule). |
| R3 | Does invoking Suggest preserve manual frames? | **Yes. Suggest never modifies, moves, relabels, or deletes a manual frame** — including a manual frame that was promoted from an earlier auto frame. |
| R4 | Clear semantics | **Default control = `Clear all frames`** — removes both kinds (this is the existing 4a "Clear group frames" control, renamed). **One auxiliary action, shown only when auto frames exist: `Clear suggested frames`** — removes just the derived auto set, keeps every manual frame. There is **no** bulk "clear manual only" control — a manual frame is removed individually by its ✕ (the 4a affordance) or by `Clear all`. Two Clear entries at most; the default is unambiguous. |
| R5 | Rename / resize an auto frame | **Committing a rename or a resize of an auto frame converts it to a transient manual frame:** it moves out of the derived set into `frameStore.frames`, keeps its current rect and label (an unlabelled one takes the next `Group N` identity), gains the solid border, and is thereafter an ordinary 4a frame — it survives a re-infer and counts as manual for R3 / R4. |
| R6 | Cancelling an in-progress edit | **If the user cancels** (Escape on the rename input, or a resize drag that ends unchanged / is reverted), the frame **stays auto** — no promotion. Only a *committed* change promotes. |
| R7 | Re-infer behaviour | a new **Suggest** replaces **only the auto set**: the previous un-promoted auto frames are discarded and a fresh auto set is computed. Promoted (now-manual) frames are untouched (R3). |
| R8 | Dismiss a single auto frame; no `pin` | **Dismiss** removes just that one frame from the **current** auto set for this session. It is **not remembered** — the **next Suggest may re-propose the same cluster**. There is **no dedicated `pin` control in Slice 4b**: to keep a suggested frame, the user renames or resizes it (R5), which promotes it to a manual frame. A dismissal or a pin that survives a re-infer or a reload is **persistent state → Slice 5 or the §PD12 authored-region design** (§AF6). |

Default labels: auto = **`Area N` / `구역 N`** (§AF9.2); manual keeps the 4a
**`Group N` / `그룹 N`**. The different word is itself the manual-vs-auto tell in
text, alongside R1's border.

### AF5.2 State-transition table

| From | Event | To |
|---|---|---|
| (no frames) | Suggest frames | *N* ≤ 6 **auto** frames in the derived set (dashed) |
| auto frame | user **commits** a rename or resize | **manual** frame in `frameStore.frames` (promoted, solid); leaves the derived set |
| auto frame | user starts then **cancels** a rename / resize | **stays auto** (no promotion) |
| auto frame | user Dismisses it | removed from the current derived set (session); **not** remembered |
| auto frame | Suggest frames (re-infer) | discarded; a fresh auto set is computed (may re-propose an equivalent cluster) |
| manual frame (incl. a promoted one) | Suggest frames (re-infer) | **unchanged** |
| manual frame | its ✕ / Clear all | removed |
| auto frame | Clear suggested frames / Clear all | removed from the derived set |
| any frame | graph reload (`loadRev`) / full browser refresh | removed |
| any frame | Reset view | **unchanged** |
| any frame | sim Reset / Step / run / Activity toggle / Focus / Filter | **unchanged** |

---

## AF6. Persistence and the product boundary

**Slice 4b is session-only and derived — the same boundary as 4a.**

Three categories, kept explicitly distinct:

| Category | What it is | Lives in | Persists? | Touches GraphDoc / serialize / digest / undo? |
|---|---|---|---|---|
| **derived auto frame** | recomputed from `(graph, node positions)` by Suggest | a new in-memory derived selector / store (not `frameStore`) | **no** — gone on `loadRev` and on refresh; rebuilt by Suggest | **no** |
| **edited transient manual frame** | a 4a frame, or a promoted auto frame (§AF5 R5) | `frameStore.frames` (existing 4a store) | **no** — session-only, gone on `loadRev` / refresh | **no** |
| **future saved authored region** | a frame (or a semantic section) the user wants to keep across reload / Share / revision | — | **yes** | **yes** — needs the Frozen `loop-revision/N` `frames` contract (§LGR6.4) or the §PD12.3-A authored-sections design |

**Hard rule:** if any 4b behaviour (a remembered dismissal, a pinned frame that
survives reload, a saved label) needs to persist, it is **out of Slice 4b** and
moves to Slice 5 or the §PD12 authored-sections pass. This doc's
implementation must add **zero** bytes to the GraphDoc, the digest, Share,
`SimState`, `localStorage`, or the undo stack — **including no new `localStorage`
key** (P3, the only key that was contemplated, is rejected — §AF4.1). Slice 4b
holds no state that outlives the session.

---

## AF7. Composition with Focus / Filter / Activity / run cues / selection / diagnostics

Invariants (extend §LGR8; every one gets an e2e in the impl PR):

| # | Invariant |
|---|---|
| AF-INV-1 | **A Filter never recomputes an auto frame's membership or rect.** A hidden node is removed from paint + hit-test (§LGR-D4); the auto frame it was in keeps its exact rect and stays visible — even if **every** member is hidden. Only Suggest (re-infer), Clear, or `loadRev` change the auto set. |
| AF-INV-2 | **Activity and sim results are not grouping inputs.** `firedNodeIds`, `activatedNodeIds`, `activitySteps`, `StepReport` — none feed the clustering. (`activated` still feeds only the Slice-3 evaluated cue.) |
| AF-INV-3 | **A frame never covers a required signal.** Both frame kinds paint in the 4a back-layer, behind nodes and edges; selection / focus rings, `invalid` / `blocked` flags, the `effective` pulse and the `evaluated` bracket, and diagnostic markers all render above every frame and every Activity tint (unchanged from 4a). |
| AF-INV-4 | **Reset view** clears Focus + Filters, **keeps** all frames (4a + auto). **sim Reset** clears run cues + the Activity history, **keeps** all frames. **graph reload** (`loadRev`) drops **all** frames. **full refresh** drops all frames. |
| AF-INV-5 | **reduced-motion:** frames and any staleness indicator are static; a re-infer swaps the set with no transition/animation (same as the 4a Activity tint rule). |
| AF-INV-6 | **forced-colors:** the manual-vs-auto tell is **dashed vs solid border** (not colour); frame fills wash out and the border carries the frame; two overlapping borders stay distinguishable. |
| AF-INV-7 | **mobile:** **Suggest frames** / **Clear auto** are More-sheet rows (no canvas control), alongside the 4a "Clear group frames" row and the Activity toggle. Auto frames **render** on the mobile canvas. Promote (rename/resize) is desktop-only, like 4a frame drawing. |
| AF-INV-8 | Auto frames compose with Focus de-emphasis like 4a manual frames: a frame is not itself dimmed; it sits behind the de-emphasised nodes and reads at their opacity. |

---

## AF8. Determinism and testability

For an identical `(GraphDoc, node positions)` the following must be **exactly**
equal across reloads, machines, browser JS iteration order, hover, theme
toggle, a sim step, and input-array order reversed (extends LGR-INV-7):

- cluster membership (which node is in which group);
- frame count;
- each frame rect (`x, y, w, h`);
- each frame's generated label and the frames' order;
- paint order.

**Fixing the sources of non-determinism:**

| Source | Rule |
|---|---|
| label-propagation processing order | iterate nodes in **ascending node-id** (lexical, `<`) order, every round |
| label-propagation tie-break | when two neighbour labels are equally frequent, pick the **lexically smallest label id** |
| post-pass "merge into most-connected neighbour" tie | pick the neighbour group whose **representative node id** (its lexically smallest member) is smallest |
| spatial split axis when bbox is square (w == h) | split on **x** |
| spatial split gap ties | the gap with the **smaller lower-bound coordinate** |
| coordinate rounding | all rect coordinates rounded to **integer flow units** with `Math.round`; half-up |
| frame order | frames sorted by `(rect.y, rect.x, representativeNodeId)` ascending; the ordinal label follows this order |
| connected-component order (the pre-filter) | components sorted by `(size desc, smallest-member-id asc)` |

**Test surface the impl PR must include:**

- **unit** — `autoFrameGeom` (or equivalent): LP fixpoint on a hand graph;
  tie-break cases; merge-small; split-big gap detection; rect + pad; the
  order/label rules; **input-order-reversed → identical output**.
- **unit** — model-node exclusion; a graph of only Parameters/Registers → 0
  auto frames.
- **fixture** — Coffee → exactly **3** auto frames with the recorded member
  sets; MMO → exactly **6** frames, no frame > S3 fraction, none < S4 size,
  **framed fraction ≥ 0.5** — a **fixture quality bar only** (catches an
  algorithm regression on these two known graphs; never asserted on arbitrary
  user graphs, never a runtime invariant — §AF3.6).
- **e2e** — Suggest frames from the desktop control + the mobile More sheet;
  auto set replaced on re-infer; manual frames preserved (§AF5 R3); a committed
  rename/resize promotes to manual, a cancelled edit stays auto (§AF5 R5/R6);
  Dismiss removes one from the current set (§AF5 R8); `Clear suggested frames`
  vs `Clear all frames` (§AF5 R4); staleness
  indicator after a node move / an edit, cleared by re-invoke; AF-INV-1
  (filter hides all members → frame stays, rect + count unchanged); AF-INV-3
  (selection ring / effective pulse / evaluated bracket above a frame);
  AF-INV-4 (survives Reset view + sim Reset, dropped on Template load); Focus
  de-emphasis (AF-INV-8).
- **visual** — one baseline `auto-frames.png`: the MMO fixture (or a trimmed
  stand-in) with auto frames on — dashed borders, ordinal labels, a promoted
  (solid) frame among them, minimap hidden. Catches a regression where the
  dashed/solid tell is lost or a frame covers a node.
- **determinism e2e** — Suggest, snapshot the frame rects+labels; reload;
  Suggest again; assert byte-identical.

---

## AF9. User-facing wording

### AF9.1 The control name — options

| Candidate | Read | Verdict |
|---|---|---|
| **Suggest frames** | "the app is offering grouping rectangles; I decide" — matches P1 (opt-in) and the promote/dismiss model | **RECOMMENDED** |
| Group nearby nodes | accurate ("nearby" = structurally close), plain; slightly long | acceptable alternative |
| Auto group | terse; "group" can imply it changed the model | weak — avoid "group" as a verb here |
| Detect sections / Detect semantic sections | implies the app understood domain meaning — **forbidden** (§AF0.1) | **REJECTED** |

The control tooltip: *"Suggest frames — draw rough grouping rectangles around
structurally-connected nodes. Structural only; not domain meaning."* (KO: the
existing `canvas.frame.*` key family gains `canvas.frame.suggest` + a
`canvas.frame.suggestHint`.)

### AF9.2 The result disclaimer + frame labels

- Auto-frame default label: **`Area N`** (EN) / **`구역 N`** (KO), ordinal by
  §AF8's frame order. **Not** `Group N` (that is the 4a manual default) — the
  different word is itself a manual-vs-auto tell.
- Optionally, when one source dominates a frame's member set (§AF3.3),
  `Area N · from <source label>` — still structural, still generic.
- On first Suggest per session, a one-line note near the control:
  *"Suggested structural groups — they may not match how you'd divide the work."*
  Dismissible; not shown again that session.

---

## AF10. Design deliverables in this PR, and the explicit exclusion list

### AF10.1 What this doc delivers (checklist)

- [x] §AF1 — reconciliation of §LGR6 / §LGR12 with the shipped Slice-4a code
- [x] §AF2 — user problem + S1–S7 success criteria + the 5 failure detectors
- [x] §AF3 — heuristic comparison table (A–E) with determinism / complexity /
      isolated / bridge-hub / state+hint / Param-Register / merge-split / and
      **Coffee + MMO dry-run counts** per candidate
- [x] §AF3.6 — the chosen post-pass + the after-post-pass dry-run table.
      **DECIDED: `MAX_FRAMES = 6`; the cap drops leftover groups, never
      force-merges them** (Coffee → 3, MMO → 6, ~27 MMO nodes left unframed)
- [x] §AF4 — recompute-trigger policy. **DECIDED: P1 only** (explicit
      `Suggest frames`; no Template-open one-shot; run / Activity / Focus /
      Filter never recompute) + the per-action effect table
- [x] §AF5 — manual/auto relationship: **R1–R8 DECIDED** (solid vs dashed
      border; Suggest never touches manual frames; re-infer replaces only the
      auto set; a committed rename/resize promotes to a transient manual frame,
      a cancelled edit stays auto; Dismiss is per-session and unremembered;
      **no `pin` in 4b**) + a state-transition table
- [x] §AF6 — persistence: three categories, the hard "no bytes / no new
      `localStorage` key" rule, the Slice-5 / §PD12 boundary
- [x] §AF7 — composition invariants AF-INV-1…8
- [x] §AF8 — determinism rules + the required unit / e2e / fixture / visual /
      determinism-e2e test list for the impl PR
- [x] §AF9 — control name comparison, the forbidden phrasing, the disclaimer;
      auto label `Area N` / `구역 N`, manual keeps `Group N` / `그룹 N`
- [x] cross-reference lines added in `docs/large-graph-readability.md` §LGR6.3
      and §LGR12 (slice 4b) pointing here — **in this PR**

### AF10.2 Pseudocode of the recommended algorithm

```
suggestFrames(graph, positions):
  drawn = graph.edges                        # resource + state, weight 1 each
  nodes = graph.nodes without kind in {parameter, register}
  frames = []
  for comp in connectedComponents(nodes, drawn) sorted by (size desc, minId asc):
      if comp.size < WORTH_IT_FLOOR: continue          # §AF2.2 (default ~8)
      groups = labelPropagation(comp, drawn)           # §AF3.2, id-ordered, low-label tie-break
      groups = mergeSmall(groups, MIN_FRAME_NODES=3)   # §AF3.6 rule 1
      groups = splitBig(groups, MAX_FRAME_FRACTION=0.55, MIN_SPLIT_GAP=120, depth<=2)
      groups = keepTopN(groups, MAX_FRAMES=6, rankBy=(size, density, minId))
               # §AF3.6 rule 3 — DROP the rest; never merge a leftover into a kept group
      for g in groups:
          rect = boundingBox(g.memberRects(positions)) expandedBy FRAME_PAD(24)
          rect = max(rect, FRAME_MIN)
          frames.push({ kind: 'auto', members: g, rect: round(rect) })
  frames.sort by (rect.y, rect.x, representativeNodeId)
  assignOrdinalLabels(frames)                          # "Area N" / "구역 N"
  return frames        # derived, in-memory only
```

### AF10.3 Out of scope for the Slice-4b implementation PR

- Any GraphDoc / schema / `serialize` / digest / undo / `SimState` / engine
  change. (If the review picks a persistent behaviour, it is not 4b.)
- Semantic sections / authored landmarks (§PD12.3-A), hierarchical /
  collapsible groups (§PD12.3-B), external data binding (§PD12.3-C).
- The `saved` `frames` wire contract (§LGR6.4) and LGR Slice 5.
- "Move the whole group" / auto-layout of a region (§PD8-B, §LGR13).
- Expression-`@id` traversal as a grouping or membership input.
- Remembering a dismissal across a re-infer or a reload; a dedicated `pin`
  control (a kept frame is a promoted manual frame instead — §AF5 R8).
- Force-merging a leftover cluster into a kept frame to hit `MAX_FRAMES` — the
  cap **drops** low-quality groups (§AF3.6 rule 3).
- Any auto-recompute on Template / file open, on a structural edit, or on a
  sim / Activity / Focus / Filter change (§AF4.1).
- Louvain / any RNG-seeded community method (determinism cost — §AF3.2).
- Changing the Slice-4a manual-frame contract, the Activity overlay, Focus,
  Filters, or the run distinction.

### AF10.4 Failure handling / fallback

| Situation | Behaviour |
|---|---|
| graph below the §AF2.2 floor | Suggest yields 0–1 frames; the control does not nag |
| a component that resists splitting (no gap ≥ MIN_SPLIT_GAP) | leave the large frame whole; record it; do not cut arbitrarily |
| LP does not converge in 20 rounds | stop at round 20 (deterministic); the partition at that point is used |
| every node is a model node | 0 auto frames; a short "nothing to group" note — a **normal** result, not an error |
| a user graph with few reliable clusters (framed fraction < 0.5, or only 1–2 frames, or none) | **valid normal output** — `Suggest frames` completes with no error; the algorithm never merges / fabricates a cluster to raise coverage. The `framed fraction ≥ 0.5` check is a **fixture-only** quality bar (§AF3.6), not applied here |
| more than 6 candidate groups survive 1–2 | keep the 6 highest-ranked; **drop** the rest — those nodes stay unframed (§AF3.6 rule 3) |
| Suggest invoked twice with no change | identical frames (S5); the second invoke is a no-op visually |
| a node deleted after Suggest so a frame's member set is empty | that auto frame is dropped on the next re-infer; until then it renders at its last rect with the staleness indicator shown |

---

## AF11. Order this feeds into

Merges as *settled design*. The three open choices are now **fixed**:
`MAX_FRAMES = 6` with a drop (not force-merge) cap (§AF3.6), **P1-only** recompute
(§AF4.1), and §AF5's R1–R8. The **implementation PR still requires explicit
approval before it starts** — it is render / UI-only, no `src/` wire change, no
engine change, one PR with the §AF8 test set (unit + fixture + e2e + one
`auto-frames.png` visual baseline + a determinism e2e).

Slice 5 (`saved` frames) and the §PD12 authored-sections / hierarchical-groups
candidates remain **separate, later** passes and are not unblocked by this doc.

Slice 5 (`saved` frames) and the §PD12 authored-sections / hierarchical-groups
candidates remain **separate, later** passes and are not unblocked by this doc.
