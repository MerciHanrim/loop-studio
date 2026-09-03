# LGR Slice 4b — Auto group frames (non-frozen design doc — DRAFT)

**Status: design settled — implementation pending review.** This is the
own-design-pass that
[`docs/large-graph-readability.md`](large-graph-readability.md) §LGR6.3 / §LGR12
(slice 4b) and §LGR-D8 defer to. It decides the clustering heuristic, the
recompute policy, the relationship to the shipped Slice-4a manual frames, the
persistence boundary, composition, determinism, and the user-facing wording.

**Correction (this revision):** an early attempt to implement §AF10.2 verbatim
surfaced a contradiction between the pseudocode (which gated *each connected
component* on `WORTH_IT_FLOOR` and ran label propagation per component) and the
§AF3.6 dry-run table (computed by running LP once over the whole eligible node
set). This revision fixes the contradiction — **`WORTH_IT_FLOOR` is a
whole-graph eligibility gate, LP runs once over all eligible nodes, and the
adjacency is a multigraph** — so the pseudocode and the dry-run now describe
the same computation, reproduced by the impl PR's fixture test. This is a
correction, **not** a new product direction: it settles what
"`WORTH_IT_FLOOR`" means ("is this graph worth the feature", not "is each
fragment big enough").

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

### AF2.2 Where it is worth showing — a GRAPH-LEVEL gate

`Suggest frames` is worth offering when the graph, *as a whole*, is big enough
that finding the major pieces is a real problem:

- **`WORTH_IT_FLOOR` is a whole-graph threshold**, **not** a per-component one:
  if the total **eligible** node count (every node except `parameter` /
  `register`) is below `WORTH_IT_FLOOR` (**8**), `Suggest frames` produces
  nothing. At or above it, the algorithm runs.
- **There is no "each connected component must be ≥ 8" rule.** A small
  disconnected component of an otherwise-large graph is a perfectly valid
  frame candidate — it is simply never *force-merged* into another component
  (§AF3.6). Disconnected components stay apart for free: label propagation has
  no edge to cross between them.
- Rough guidance on where it *helps*: little value below ~25 eligible nodes
  (the graph fits a screen); the primary target is a medium Template / Building
  block chain; the 97-node MMO example is the case that motivated it.
- Coffee (13 eligible nodes, split `9 + 4` across two components) is a
  **deliberate small-case check**, not the target — it clears the whole-graph
  floor (13 ≥ 8), so **both** components are eligible and the dry-run frames
  all 13 (§AF3.6).

### AF2.3 Success criteria

| # | Criterion | How it is evaluated |
|---|---|---|
| S1 | A reader shown the MMO example with auto frames on can point to "roughly where combat / rewards / economy / progression happen" **faster** than with frames off | timed comprehension check, same protocol family as §CR11 — read → describe the major areas; frames-on vs frames-off, counterbalanced |
| S2 | On the **MMO fixture** the frame count lands in the legible band **3–6** (`MAX_FRAMES` caps the top; ≥ 3 is expected for this graph's structure) | assertion on the dry-run + a CI test **on the MMO fixture** |
| S3 | **No mega-frame** — no retained auto frame contains **> 55 %** of the eligible node count. *Runtime property* — enforced by §AF3.6 rule 2 (split-big) **and** rule 3b (a survivor that still exceeds the fraction after split-big's depth cap is **dropped**, not drawn) | assertion + a runtime property |
| S4 | **No confetti** — no auto frame contains **< 3** nodes. *Runtime property* — §AF3.6 rule 1 merges or drops tiny groups; a spatial cut never leaves a `< 3` side | assertion + a runtime property |
| S5 | Re-running **Suggest frames** on an unchanged `(graph, positions)` produces byte-identical frames (rects, labels, order) — a runtime property | determinism test (§AF8) |
| S6 | A sim run, a Step, toggling Activity, changing Focus, or applying a Filter **never** changes the auto frames — a runtime property | recompute-trigger test (§AF4) |
| S7 | Expected shape on the **three bundled fixtures** is met (§AF3.6 Table A raw-LP partition **and** Table B final frames) — a regression check on graphs we know | dry-run recorded in this doc + a fixture test |
| S8 | **Every retained frame is spatially clean** — `foreignCount ≤ max(2, floor(memberCount × 0.5))`, where `foreignCount` = non-member, non-model node centres inside the frame's member bounding box. *Runtime property* — §AF3.6 rule 3 splits a contaminated group and **drops** it if it cannot be cleanly bisected | assertion on the final set, on **every** fixture + synthetic |
| S9 | **Geometry is locale-, font-, browser-, zoom- and render-timing-independent.** Membership, split, ranking, drop and rect are computed from node `position` + a fixed canonical footprint only — never React Flow's live `measured` size (§AF8) | determinism test: same `(GraphDoc, positions)` with `measured` = 150×40 / unset / 320×96 / 1×1 → byte-identical frames |

**Fixture criteria vs runtime properties.** S3, S4, S5, S6, S8, S9 are **runtime
properties** — the algorithm upholds them on *any* graph. S1, S2, S7 are
**fixture criteria** — they say what the current algorithm should produce on
the Coffee / MMO / default graphs, to catch a quality regression. They are
**not** guarantees for an arbitrary user graph: a user graph with little clean
structure may legitimately yield 1–2 frames or **none**, and that is a normal
successful `Suggest` result, not a failure (§AF10.4). The algorithm never
merges or fabricates a cluster to hit a count or a coverage number.

**Coverage is NOT a success criterion** *(review boundary 5)*. An early
implementation framed **92 %** of MMO's eligible nodes and the result was a
**worse** screen than no frames (§AF2.4). So:

- **raw-LP coverage / membership** — an *algorithm-regression observation*
  only (§AF3.6 Table A), pinned so a change to LP or the multigraph adjacency
  is caught;
- **final suggested-frame coverage** — a **reported metric**, never a forced
  minimum. The `framed fraction ≥ 0.5` fixture assertion is **removed**. On the
  MMO fixture the final coverage is **≈ 0.43** — every group that would push it
  higher is either spatially contaminated past S8 or out-ranked past the
  `MAX_FRAMES` ceiling, and is correctly dropped;
- **`MAX_FRAMES = 6` is a ceiling, not a target.** Fewer than 6 frames, or
  none, is a valid result. The algorithm never lowers a quality bar or merges a
  weak cluster to *reach* 6;
- **final-frame quality** is the S8 acceptance rule (contamination) then S3
  (no mega-frame) then overlap — decided *before* coverage is even measured;
- **few good frames, or zero frames, is a normal result.** Coffee's clean 3
  are preserved unchanged; MMO's coverage falling from 0.92 to ≈ 0.43 is the
  intended effect, not a regression.

**Explicitly NOT a success criterion:** that the frames "correctly classify the
domain meaning" of each region. The frames are structural; the labels say so
(§AF9.2). A region that a domain expert would draw differently is **not** a
failure as long as the runtime properties hold.

### AF2.4 Failure modes to detect

| Failure | What it looked like (measured) | Detector | After the fix (measured) |
|---|---|---|---|
| one giant frame (CC-style collapse) | connected components alone → MMO **one 90-node frame** | S2 + S3 | not reachable — LP + rule 3b |
| dozens of 1–2 node frames | — | S2 + S4 | — |
| frames that jump on every run / edit | — | S5 + S6 | — |
| **frames overlapping / contaminated so the regions are unreadable** | raw LP + bbox rects on MMO: **max pairwise overlap 100 %** (one rect fully inside another), **12 of 15 pairs overlap > 10 %**, **10–57 foreign node centres** inside each 7–28-member frame, **max foreign/member ratio 8.1** | **S8** — every retained frame satisfies `foreignCount ≤ max(2, floor(memberCount × 0.5))`; §AF3.6 rule 3 splits a contaminated group and **drops** it if it cannot be cleanly bisected; rule 4 then drops any candidate overlapping a kept frame > 50 % of the smaller rect | MMO: **6 frames, max pairwise overlap 0 %, foreign 0–3 per frame (all within budget), max foreign/member 0.50**; coverage 0.92 → **0.43**, 13 candidates dropped |
| **a spatially-clean mega-frame slips through split-big's depth cap** | a degenerate synthetic (9 dense blobs strung on single-edge bridges) collapses under LP into one blob; split-big recurses only twice, leaving a **42-of-54-node** frame that is *spatially* clean (foreign 0) so contamination does not catch it | **S3 rule 3b** — after split-big and spatial cohesion, a group still holding > 55 % of the eligible count is **dropped** | that synthetic → 2 small frames + the 42-group dropped (`exceeds MAX_FRAME_FRACTION`), coverage 0.22 |
| a frame that contains only Parameter / Register nodes | — | model nodes are excluded from membership (§AF3.5) — assertion that no auto frame's member set is all-model | — |
| geometry shifts with locale / font / browser / zoom / `measured` readiness | a centre computed as `position + measured/2` moves when `measured` is unset vs 150×40 vs the real DOM size, changing which foreign centres fall in a bbox | **S9** — all geometry uses `position` + a fixed canonical footprint; `measured` is never read | byte-identical frames for `measured` ∈ {150×40, unset, 320×96, 1×1} on both fixtures |

The raw-LP numbers above are why §AF3.6 has a spatial-cohesion pass: LP finds
*topological* communities, and the MMO layout interleaves them spatially, so
each community's axis-aligned bounding box sweeps a wide area full of other
communities' nodes. Membership and count were correct; the drawn rectangles
were not. The fix keeps the LP membership as the regression baseline (Table A)
and makes the **final** set — after split, drop, overlap-resolution and the
ceiling — the thing S8 / S3 / S5 / S9 assert on.

---

## AF3. Grouping-heuristic comparison

All candidates run on the **same fixture set**: `examples/coffee-roastery.json`
(23 nodes / 11 edges / 0 state edges / schema v2) and
`examples/mmo-progression.json` (97 nodes / 144 edges / 27 state edges), plus
the built-in 3-node default graph as a floor case. Numbers below are the output
of the §AF10.2 procedure on the committed files, pinned by the impl PR's
fixture test (§AF3.7).

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
  every subsystem. Connected components are **not** used as a pre-filter or a
  per-component gate either (§AF2.2 is whole-graph): label propagation runs
  once over all eligible nodes and two disconnected diagrams never share a
  label because no edge joins them — the component split is a free by-product,
  not a step.

### AF3.2 Candidate B — deterministic community detection (label propagation)

- **How:** one asynchronous label-propagation run over the **whole eligible
  drawn-edge graph** (not per component) with a **fixed processing order**
  (node id, lexical, every round) and a **fixed tie-break** (lowest label id
  wins); model nodes excluded; iterate to a fixpoint or 20 rounds. Disconnected
  components never adopt each other's label because no edge joins them, so one
  run keeps them apart on its own — there is no per-component pre-filter.
- **The drawn graph is a MULTIGRAPH.** Each drawn edge contributes weight 1,
  so a **parallel edge counts again** — MMO has 9 node-pairs joined by 2–3
  wires (e.g. `level ⇄ z2_xp2lvl` ×3), and each extra wire adds 1 to that
  neighbour's pull in the frequency count. Collapsing parallels to a single
  adjacency changes the partition; the dry-run below (and the impl PR's fixture
  test) count them with multiplicity.
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
  at a clean 3 frames and its groups are spatially clean, so the post-pass is a
  no-op there; MMO needs the small groups dropped at the cap **and** the
  spatially-interleaved communities broken up by the spatial-cohesion pass
  (§AF3.6 step 3 — the raw MMO bboxes overlap 100 %, §AF2.4). This is the only
  candidate that is both deterministic without an RNG **and** produces a legible
  count on MMO.

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

### AF3.6 The post-pass — merge small, split big, **spatial-cohesion split**, cap + overlap-resolution

Applied **once, graph-wide**, to the raw partition from the single
label-propagation run (Candidate B). **The raw LP membership is preserved** —
LP is never replaced by spatial clustering; every step below runs on the LP
groups.

**All geometry is CANONICAL (§AF8 / S9).** Every measurement below — a node
centre, a member bounding box, a spatial gap, a rect, an overlap area — is
computed from the node's **`position`** and a **fixed canonical footprint**
`CANON_NODE_W × CANON_NODE_H = 150 × 40` flow units. React Flow's live
`measured` width/height is **never read**. So the output is identical whatever
the locale, label length, font, font-load timing, browser, viewport, zoom, or
whether `measured` has populated — no "±1–2" wobble.

1. **Drop / merge small.** Any group of **1 or 2** nodes is merged into the
   neighbouring group it shares the most drawn edges with; tie-break = lowest
   group-representative node id. A group with **no inter-group edge** (which
   includes a tiny group in its own disconnected component) is **dropped, not
   relocated**. Groups of 3+ are left alone here.
2. **Split big (fraction).** Any group holding `> MAX_FRAME_FRACTION` (default
   **0.55**) of the **whole eligible framed-node total** is cut once along its
   longer bounding-box axis at the widest gap; recurse ≤ twice; left whole if
   no gap ≥ `MIN_SPLIT_GAP` (120) or a cut would leave a `< MIN_FRAME_NODES`
   side. (Rarely fires — MMO's largest LP group is 28 / 90 = 0.31.)
3. **Spatial-cohesion split — split, or DROP** *(review boundary 5)*. For each
   group, measure **contamination** = the count of **non-member, non-model node
   centres inside the group's member bounding box** (`foreign`). The group is
   **contaminated** when

   > `foreign > max(2, floor(memberCount × 0.5))`

   An **uncontaminated** group is a candidate as-is. A **contaminated** group is
   **bisected** and each side re-checked (recursively). A contaminated group
   that **cannot be bisected** — no gap ≥ `MIN_SPLIT_GAP` leaving two
   `≥ MIN_FRAME_NODES` sides, or still contaminated at `SPATIAL_MAX_DEPTH = 6`
   — is **DROPPED. It is never kept as a final frame.** Its nodes are left
   unframed.
   - **The threshold** `foreign ≤ max(2, floor(memberCount × 0.5))` was picked
     from the sweep in §AF3.7: it keeps Coffee's 3 frames untouched (0 foreign
     each) and removes MMO's 100 %-overlap / 10–57-foreign pathology.
     `foreign / members ≤ 1.0` was too loose (MMO still overlapped 48 %); the
     ratio and abs forms are identical on every fixture, so the abs form — with
     its `max(2, …)` floor that tolerates ≤ 2 strays in a tiny group — is the
     definition. This is **S8**, asserted on the final set.
   - **The cut.** From the member centres, take the largest **normalized gap**
     (raw gap ÷ axis span) on x and on y; use the axis with the larger
     normalized gap (**tie → x**). Within that axis, scan gaps **descending by
     raw size**; take the first whose split leaves **both** sides
     ≥ `MIN_FRAME_NODES` **and** whose raw gap ≥ `MIN_SPLIT_GAP`. Gap-size
     ties → **smaller lower-bound coordinate**, then **smaller min node id**.
     Because a valid cut always leaves both sides ≥ 3, a split never produces a
     sub-`MIN_FRAME_NODES` fragment.
   - **Multiple clean islands from one group?** Keep **each** as its own
     candidate — never "keep only the largest sub-cluster". Step 4 ranks them.
3b. **S3 acceptance gate — no mega-frame.** After steps 2–3, a surviving group
   still holding `> MAX_FRAME_FRACTION` of the eligible node count is **dropped**
   (`exceeds MAX_FRAME_FRACTION: not spatially separable`). Split-big recurses
   only twice; on a degenerate graph whose LP collapsed a long weak chain into
   one blob, a spatially-*clean* 42-of-54-node group can reach this point — and
   is dropped rather than drawn.
4. **Overlap-resolution + the `MAX_FRAMES` ceiling.** Rank every remaining
   candidate `(size desc, intra-group edge density desc, min node id asc)`. Walk
   the ranked list, keeping a candidate **unless** it overlaps an already-kept
   frame by `> MAX_OVERLAP_FRAC` (**0.5**) of the **smaller** rect's area — then
   drop it. **Stop at `MAX_FRAMES = 6` kept.** Never shrink a kept frame, merge
   a dropped one in, or backfill to reach 6 with a lower-ranked candidate.
   **`MAX_FRAMES` is a ceiling, not a target** — if fewer than 6 candidates
   survive steps 1–3b, the result has fewer than 6 frames, and that is correct.
5. **Rect.** Each kept group's rect = the canonical-footprint bounding box of
   its members, expanded by `AUTO_FRAME_PAD` (24) each side; never smaller than
   `AUTO_FRAME_MIN` (48); integer coordinates. Frames ordered
   `(rect.y, rect.x, min member id)`; 1-based `Area N`.

**The acceptance contract.** After step 5, **every** retained frame satisfies
*all* of: `foreignCount ≤ max(2, floor(memberCount × 0.5))` (S8) ·
`memberCount ≥ MIN_FRAME_NODES` (S4) · `memberCount ≤ MAX_FRAME_FRACTION ×
eligibleCount` (S3) · no pair overlapping > 0.5 of the smaller rect · at most
`MAX_FRAMES`. A candidate that cannot meet the contract is **unframed** — that
is the normal, correct outcome, even when it drives the frame count below 6 or
coverage well below 0.5.

**Three regression layers** — Table A (topology), Table A′ (split stage),
Table B (final) — pinned separately by the impl PR's fixture test
(`autoFrames.fixture.test.ts`), all run verbatim to §AF10.2 on the committed
`examples/*.json`:

**Table A — raw LP + merge-small + split-big (topology-algorithm regression):**

| Graph | Eligible | Raw LP groups | after steps 1–2 |
|---|---|---|---|
| default | 3 | `[3]` | below `WORTH_IT_FLOOR` → `[]` |
| Coffee | 13 (`9 + 4`) | `[5, 4, 4]` | `[5, 4, 4]` (nothing < 3; largest 0.38 < 0.55) |
| MMO | 90 | `[28, 18, 13, 10, 7, 7, 4, 3]` | `[28, 18, 13, 10, 7, 7, 4, 3]` (nothing < 3; largest 0.31 < 0.55) |

**Table A′ — the spatial-candidate stage (after step 3, before ranking / the ceiling):** a split-stage regression guard, independent of step 4.

| Graph | Contaminated LP/split groups | Outcome |
|---|---|---|
| Coffee | none (0 foreign in every group) | 3 candidates pass through unchanged |
| MMO | the 28 / 18 / 13 / 10 / 7 / 7 raw groups all fail S8 once bisected | recursive bisection yields **12 clean candidates** (`{10, 8, 7, 6, 4, 4, 4, 4, 3, 3, 3, 3}`) + **7 dropped** (`no valid spatial gap`: sizes 3, 4, 3, 7, 4, 4, 6) |

**Table B — final suggested frames (measured, after steps 3b – 5):**

| Graph | Final frames | Sizes | Per-frame member / foreign (budget) | Max foreign / member | Max pairwise overlap | Coverage | Dropped candidates |
|---|---|---|---|---|---|---|---|
| default | **0** | — | — | — | — | — | — (below floor) |
| Coffee | **3** | `{5, 4, 4}` | 5/0 (2) · 4/0 (2) · 4/0 (2) | **0.00** | **0 %** (0/3 pairs) | **13 / 13 = 1.00** | **none** — no LP group is contaminated, spatial pass is a no-op |
| MMO | **6** | `{10, 8, 7, 6, 4, 4}` | 10/2 (5) · 8/3 (4) · 7/0 (3) · 6/2 (3) · 4/0 (2) · 4/2 (2) | **0.50** | **0 %** (0/15 pairs) | **39 / 90 = 0.43** | **13**: 7 × `contaminated: no valid spatial gap` (sizes 3, 4, 3, 7, 4, 4, 6 — foreign 6, 16, 10, 5, 5, 11, 10) + 6 × `MAX_FRAMES ceiling reached` (sizes 4, 4, 3, 3, 3, 3 — clean but out-ranked) |

**Synthetic checks (also in the fixture test):**

| Synthetic | Final frames | Coverage | Notes |
|---|---|---|---|
| 2 interleaved communities (MMO pathology, miniature) | **1** — `{3}` | 3 / 16 = 0.19 | 2 × size-5 contaminated groups (foreign 4 > budget 2) dropped `no valid spatial gap`; 1 × size-3 dropped for overlap. A pathological graph yielding almost nothing **is the correct result**. |
| 3 clean blobs, far apart | **3** — `{6, 6, 6}` | 18 / 18 = 1.00 | uncontaminated → untouched |
| 9 clean blobs on single-edge bridges (LP over-merges) | **2** — `{6, 6}` | 12 / 54 = 0.22 | the collapsed 42-of-54-node blob is spatially clean but hits the **S3 gate (3b)** → dropped `exceeds MAX_FRAME_FRACTION` |

Every row of Table B and the synthetics has been verified to satisfy the
acceptance contract (`every retained frame clean`) and
`input-order-reversed → identical`.

Deterministic renders of the Coffee and MMO final frames (node dots + dashed
rects, straight from `suggestFrames` output) are attached to the PR.

### AF3.7 Dry-run source, and the contamination-threshold sweep

The numbers above were first established by a throwaway analysis over the
committed `examples/*.json` (connected components, degree histogram, hub list,
deterministic label propagation). The dry-run is **not** shipped as a loose
script — it lives as a committed **fixture test**,
`src/components/frames/autoFrames.fixture.test.ts` (impl PR), which runs the
§AF10.2 `suggestFrames` procedure verbatim on the same two files and pins the
**Table A** raw-LP partition (`[5, 4, 4]` / `[28, 18, 13, 10, 7, 7, 4, 3]`), the
**Table B** final frame sizes and their coverage / overlap / foreign counts, and
determinism under array reversal. Key raw facts:

- Coffee: 13 eligible nodes across **two** components (`9 + 4`); **10 degree-0
  model nodes**; no hubs. Both components clear the whole-graph floor. Neither
  LP group is contaminated (0 foreign nodes each), so the spatial-cohesion pass
  is a **no-op** on Coffee — its 3 frames are identical before and after
  review boundary 5.
- MMO: **1 component of 90** eligible nodes + 7 degree-0 Registers; hubs
  `level` (13), `gold` (10), `xp` (5), `hunt_payout` (6), `quest_payout` (6),
  `resupply` (6), … — which is why plain connected components fails.
- MMO has **9 node-pairs joined by 2–3 parallel wires**; counting them with
  multiplicity (§AF3.2) is what makes the raw LP partition
  `[28, 18, 13, 10, 7, 7, 4, 3]` reproducible.
- MMO's raw LP communities are **topological, and MMO interleaves them
  spatially** — the level / gold / xp progression corridors run left-to-right
  across the same vertical band — so each raw group's bbox swallows 10–57 nodes
  of the other groups. That is the pathology §AF2.4 forbids and the
  spatial-cohesion pass (§AF3.6 step 3) exists to break.

#### The sweep (review boundary 5)

A deterministic sweep over Coffee, MMO, and synthetic fixtures compares the
candidate contamination thresholds. It is committed as a prints-only fixture
(`autoFrames.sweep.test.ts` / `autoFrames.report.test.ts`). For each threshold
it records final frame count + sizes, coverage, max pairwise overlap (as a
fraction of the smaller rect), foreign nodes / frame, max foreign / member
ratio, and every dropped candidate with its reason.

| Threshold | Coffee | MMO | `interleaved` synthetic |
|---|---|---|---|
| **raw LP + bbox** (no spatial pass) | `{5,4,4}` · cover 1.00 · overlap **0 %** · foreign 0 | `{28,18,13,10,7,7}` · cover 0.92 · overlap **100 %** · foreign **10–57** · maxF/M **8.1** | one frame over both communities · foreign huge |
| `foreign / members ≤ 1.0` (split-or-drop) | `{5,4,4}` · cover 1.00 · overlap 0 % · foreign 0 | still **48 %** max overlap · foreign up to 22 · maxF/M **5.5** — several frames stay contaminated | still one contaminated frame |
| **`foreign ≤ max(2, floor(members × 0.5))`** *(adopted; ≡ ratio ≤ 0.5)* | `{5,4,4}` · cover **1.00** · overlap **0 %** · foreign **0** | `{10,8,7,6,4,4}` · cover **0.43** · overlap **0 %** · foreign **0–3 (all ≤ budget)** · maxF/M **0.50** · **13 dropped** | `{3}` · cover 0.19 · overlap **0 %** · foreign 2 (= budget) · 3 dropped |

`ratio ≤ 0.5` and the abs form `foreign ≤ max(2, floor(members × 0.5))` produce
**identical** partitions on every fixture; the abs form — with its `max(2, …)`
tiny-group floor — is the definition. `ratio ≤ 1.0` still left MMO frames
overlapping 48 % with 5.5× foreign density, so it does **not** clear §AF2.4.

**Adopted (§AF3.6 step 3): `foreign ≤ max(2, floor(memberCount × 0.5))`, split
the contaminated group or — if it will not bisect cleanly — drop it.** It leaves
Coffee's 3 frames identical and brings MMO from "one rect fully inside another,
10–57 strays per frame" to **6 frames, 0 % pairwise overlap, ≤ 3 strays each
(all within budget)**. The MMO coverage falling to **0.43** is the accepted cost
(§AF2.3) — the 0.92 version was the worse screen, and 51 unframed MMO nodes is a
correct result, not a gap to backfill.

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
| R5 | Rename / resize / **recolour** an auto frame | **Committing a rename, a resize, _or an accent colour_ (`docs/large-graph-readability-frame-colour.md`) on an auto frame converts it to a transient manual frame:** it moves out of the derived set into `frameStore.frames`, keeps its current rect and label (an unlabelled one takes the next `Group N` identity), gains the solid border (and the committed accent, if any), and is thereafter an ordinary 4a frame — it survives a re-infer and counts as manual for R3 / R4. |
| R6 | Cancelling an in-progress edit | **If the user cancels** (Escape on the rename input, a resize drag that ends unchanged / is reverted, or dismissing the colour picker without choosing an accent), the frame **stays auto** — no promotion, rect + label unchanged. Only a *committed* change promotes. |
| R7 | Re-infer behaviour | a new **Suggest** replaces **only the auto set**: the previous un-promoted auto frames are discarded and a fresh auto set is computed. Promoted (now-manual) frames are untouched (R3). |
| R8 | Dismiss a single auto frame; no `pin` | **Dismiss** removes just that one frame from the **current** auto set for this session. It is **not remembered** — the **next Suggest may re-propose the same cluster**. There is **no dedicated `pin` control in Slice 4b**: to keep a suggested frame, the user renames or resizes it (R5), which promotes it to a manual frame. A dismissal or a pin that survives a re-infer or a reload is **persistent state → Slice 5 or the §PD12 authored-region design** (§AF6). |

Default labels: auto = **`Area N` / `구역 N`** (§AF9.2); manual keeps the 4a
**`Group N` / `그룹 N`**. The different word is itself the manual-vs-auto tell in
text, alongside R1's border.

### AF5.2 State-transition table

| From | Event | To |
|---|---|---|
| (no frames) | Suggest frames | *N* ≤ 6 **auto** frames in the derived set (dashed) |
| auto frame | user **commits** a rename, a resize, or an **accent colour** | **manual** frame in `frameStore.frames` (promoted, solid, + the accent if one was picked); leaves the derived set |
| auto frame | user starts then **cancels** a rename / resize / colour pick | **stays auto** (no promotion); rect + label unchanged |
| manual frame | user sets / changes / clears its **accent colour** | same frame, new `color` (or none) — rect / label / ordinal unchanged; **not** an undo entry |
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
| AF-INV-3 | **A frame never covers a required signal.** Both frame kinds — and a manual frame's optional **accent colour** (`docs/large-graph-readability-frame-colour.md`, fill ≤ 0.06) — paint in the 4a back-layer, behind nodes and edges; selection / focus rings, `invalid` / `blocked` flags, the `effective` pulse and the `evaluated` bracket, and diagnostic markers all render above every frame, every accent, and every Activity tint (unchanged from 4a). The accent palette deliberately excludes the teal (`--signal-primary`) and red / orange (`--danger` / `--warning`) hues those cues use. |
| AF-INV-4 | **Reset view** clears Focus + Filters, **keeps** all frames (4a + auto). **sim Reset** clears run cues + the Activity history, **keeps** all frames. **graph reload** (`loadRev`) drops **all** frames. **full refresh** drops all frames. |
| AF-INV-5 | **reduced-motion:** frames and any staleness indicator are static; a re-infer swaps the set with no transition/animation (same as the 4a Activity tint rule). |
| AF-INV-6 | **forced-colors:** the manual-vs-auto tell is **dashed vs solid border** (not colour); frame fills wash out and the border carries the frame; two overlapping borders stay distinguishable. |
| AF-INV-7 | **mobile:** **Suggest frames** / **Clear auto** are More-sheet rows (no canvas control), alongside the 4a "Clear group frames" row and the Activity toggle. Auto frames **render** on the mobile canvas. Promote (rename/resize) is desktop-only, like 4a frame drawing. |
| AF-INV-8 | Auto frames compose with Focus de-emphasis like 4a manual frames: a frame is not itself dimmed; it sits behind the de-emphasised nodes and reads at their opacity. |

---

## AF8. Determinism and testability

For an identical `(GraphDoc, node positions)` the following must be **exactly**
equal across reloads, machines, browser JS iteration order, hover, theme
toggle, a sim step, input-array order reversed, **any UI locale (EN / KO), any
label text, any font or font-load timing, any viewport / zoom, and whether or
not React Flow's `measured` sizes have populated** (extends LGR-INV-7):

- cluster membership (which node is in which group);
- frame count;
- each frame rect (`x, y, w, h`);
- each frame's generated label and the frames' order;
- paint order;
- which candidates were dropped, and why.

**Fixing the sources of non-determinism:**

| Source | Rule |
|---|---|
| **node geometry** | **canonical footprint only** — `CANON_NODE_W × CANON_NODE_H = 150 × 40` at the node's `position`. React Flow's live `measured` width/height is **never read** by membership, split, contamination, ranking, overlap, or the rect. (The render layer may *draw* a slightly larger visual if a real node body exceeds the canonical box, but that never feeds back into the algorithm.) |
| adjacency | a **multigraph** built from all drawn edges — a parallel edge is kept, not collapsed (§AF3.2) |
| label-propagation scope | **one run over every eligible node id** (no per-component split); components stay apart because no edge joins them |
| label-propagation processing order | iterate nodes in **ascending node-id** (lexical, `<`) order, every round |
| label-propagation tie-break | equal weighted frequency → **lexically smallest label id** |
| merge-small "most-connected neighbour" tie | neighbour group with the **smallest representative node id** |
| **contamination measure** (§AF3.6 step 3) | `foreign` = count of non-member, non-model node **centres** inside the member-centre bbox (canonical centres); contaminated iff `foreign > max(2, floor(memberCount × 0.5))` |
| **spatial-cohesion split axis** | the axis with the larger **normalized** largest-gap (`raw gap ÷ (max centre − min centre)` on that axis); tie (incl. a square-ish bbox) → **x** |
| **spatial-cohesion split point** | on the chosen axis, scan gaps **descending by raw size**; take the first whose two sides are each ≥ `MIN_FRAME_NODES` **and** whose raw gap ≥ `MIN_SPLIT_GAP` (120); gap-size ties → **smaller lower-bound coordinate**, then **smaller min node id**. A valid cut always leaves both sides ≥ 3, so no sub-`MIN_FRAME_NODES` fragment is ever produced. |
| **spatial-cohesion recursion** | recurse into a still-contaminated subgroup; depth cap `SPATIAL_MAX_DEPTH = 6`. A contaminated group that **cannot be bisected** (no valid gap) or is **still contaminated at the depth cap** is **DROPPED** — never kept as a final frame, never merged. |
| **S3 acceptance gate** (rule 3b) | after steps 2–3, a group still holding `> MAX_FRAME_FRACTION` (0.55) of the eligible count is **dropped** (reason `exceeds MAX_FRAME_FRACTION`) |
| **overlap-resolution + ceiling** (§AF3.6 step 4) | rank `(size desc, intra-group density desc, min node id asc)`; walk ranked, keep unless the candidate overlaps an already-kept frame by `> MAX_OVERLAP_FRAC = 0.5` of the **smaller** rect area; **stop at `MAX_FRAMES = 6`**; never shrink / merge / backfill |
| coordinate rounding | rect coordinates via `Math.round` (half-up), integer flow units |
| frame order | `(rect.y, rect.x, representativeNodeId)` ascending; the ordinal label follows this order |

**Test surface the impl PR must include:**

- **unit** — LP fixpoint on a hand graph; tie-break cases; merge-small;
  split-big gap detection; `bestSpatialCut` axis / gap / tie rules; rect + pad;
  the order/label rules; **input-order-reversed → identical output**.
- **unit** — model-node exclusion; a graph of only Parameters/Registers → 0
  auto frames.
- **unit (S9 — canonical geometry)** — the same `(GraphDoc, positions)` run
  with every node's `measured` set to `150×40`, unset, `320×96`, and `1×1`
  produces **byte-identical** `AutoFrameResult[]` on both the Coffee and MMO
  fixtures. (Proven — see §AF3.6 Table B footnote.)
- **fixture (Table A — topology regression)** — the raw LP + merge-small +
  split-big partition is pinned: Coffee `[5, 4, 4]`, MMO
  `[28, 18, 13, 10, 7, 7, 4, 3]`.
- **fixture (spatial-candidate stage)** — the set of groups **after step 3**
  (before overlap-resolution and the ceiling): pins that the contaminated MMO
  groups are split or dropped as recorded, so a split-stage regression is
  caught independently of the ranking.
- **fixture (Table B — final frames + the acceptance assertion)** — Coffee →
  exactly **3** frames with the recorded member sets; MMO → exactly **6**
  frames with sizes `{10, 8, 7, 6, 4, 4}` and the recorded 13 drop reasons. On
  **every** fixture and synthetic the test asserts the **acceptance contract**
  for every retained frame: `foreignCount ≤ max(2, floor(memberCount × 0.5))`
  (S8), `memberCount ≥ 3` (S4), `memberCount ≤ 0.55 × eligibleCount` (S3), no
  pair overlapping > 0.5 of the smaller rect, ≤ 6 frames — not just the count.
  Coverage is recorded and asserted only as a **range** (Coffee `0.95–1.0`,
  MMO `0.35–0.5`); a change that pushes MMO back toward 0.92 **fails** the
  test (it means the spatial pass stopped dropping).
- **fixture (threshold sweep)** — prints-only: Coffee / MMO / `interleaved` /
  clean-blobs under raw, `ratio ≤ 1.0`, and the adopted `abs` rule; documents
  why `abs` was chosen (§AF3.7).
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
- **visual** — **two** baselines (review boundary 3):
  `auto-frames.png` — a fresh Suggest on the e2e fixture: dashed borders,
  ordinal `Area N` labels, one frame selected with its ✕ + resize corner, the
  first-Suggest note shown; and `auto-frames-mixed.png` — a promoted (solid)
  frame plus a manual frame overlapping an auto frame, proving auto paints
  behind manual and the stale-hint dot renders. Catch a regression where the
  dashed/solid tell is lost, paint order flips, or a frame covers a node.
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
- A manual frame's optional **accent colour** (`docs/large-graph-readability-frame-colour.md`)
  is a **redundant** "which region is which" aid — the label is always shown and
  is never replaced by colour; a frame with no label still shows its
  `Group N` / `Area N` default.

---

## AF10. Design deliverables in this PR, and the explicit exclusion list

### AF10.1 What this doc delivers (checklist)

- [x] §AF1 — reconciliation of §LGR6 / §LGR12 with the shipped Slice-4a code
- [x] §AF2 — user problem + S1–S7 success criteria + the 5 failure detectors
- [x] §AF3 — heuristic comparison table (A–E) with determinism / complexity /
      isolated / bridge-hub / state+hint / Param-Register / merge-split / and
      **Coffee + MMO dry-run counts** per candidate
- [x] §AF3.6 — the post-pass: merge-small → split-big → **spatial-cohesion
      (split, or DROP if not cleanly bisectable)** → **S3 acceptance gate** →
      **overlap-resolution + the `MAX_FRAMES` ceiling**, plus **Table A**
      (raw-LP topology baseline), a **spatial-candidate stage** table, and
      **Table B** (measured final frames). **Review boundary 5, round 2:**
      every retained frame satisfies the acceptance contract — `foreign ≤
      max(2, floor(members × 0.5))` (S8), `≤ 0.55 × eligible` (S3), `≥ 3` (S4),
      no > 0.5 overlap, ≤ 6 frames; a candidate that can't is **unframed**.
      **`MAX_FRAMES = 6` is a ceiling, not a target.** All geometry is
      **canonical** (`CANON_NODE_W×H = 150×40`), never `measured` (S9).
      Coffee → 3 unchanged (0 foreign); MMO → 6, sizes `{10,8,7,6,4,4}`,
      **0 % pairwise overlap, foreign 0–3 (all ≤ budget), coverage 0.43, 13
      candidates dropped** — the raw-LP 0.92 / 100 %-overlap version is
      rejected (§AF2.4)
- [x] §AF3.7 — the contamination-threshold **sweep** (raw / `ratio ≤ 1.0` /
      adopted `abs = foreign ≤ max(2, floor(members × 0.5))`) + the
      split-or-drop rationale
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

### AF10.2 Pseudocode of the algorithm

This procedure and the §AF3.6 tables describe the **same computation** — the
impl PR's fixture test runs exactly this on the committed `examples/*.json` and
pins Table A (`[5,4,4]` / `[28,18,13,10,7,7,4,3]`), the spatial-candidate stage,
and Table B (Coffee 3 / MMO 6 `{10,8,7,6,4,4}` + the 13 drop reasons + the
acceptance assertion).

```
CANON_NODE_W, CANON_NODE_H = 150, 40      # the ONLY node size the algorithm uses
centre(n)   = (n.position.x + 75, n.position.y + 20)          # canonical, never `measured`
canonRect(n)= (n.position.x, n.position.y, 150, 40)

suggestFrames(graph):
  eligible = graph.nodes without kind in {parameter, register}
  if eligible.length < WORTH_IT_FLOOR:  return []              # §AF2.2 — graph-level gate
  adj = multigraph adjacency over eligible from ALL drawn edges (§AF3.2)
  # ONE LP run, ascending lexical id order, low-label tie-break, <= 20 rounds.
  groups = labelPropagation(eligible.ids, adj)
  groups = mergeSmall(groups, adj)                             # r1 — only groups of 1-2; no inter-group edge => DROP
  framedTotal = sum(|g| for g in groups)
  groups = splitBig(groups, centre, framedTotal,               # r2 — fraction is graph-wide
                    MAX_FRAME_FRACTION=0.55, MIN_SPLIT_GAP=120, depth<=2)
  #  >>> TABLE A captured here (groups) <<<

  # --- r3: spatial cohesion — SPLIT the contaminated, or DROP it --------------
  candidates = []
  for g in groups:  candidates += spatialCohesion(g, depth=0)
  #  >>> SPATIAL-CANDIDATE STAGE captured here (candidates + drops) <<<

  spatialCohesion(g, depth):
    foreign = count of non-member, non-model centres inside bbox(centre(m) for m in g)
    if foreign <= max(2, floor(|g| * 0.5)):  return [g]        # clean → candidate as-is
    if depth >= SPATIAL_MAX_DEPTH (6):        drop(g, "depth cap"); return []
    cut = bestSpatialCut(g)            # §AF8: normalized-gap axis (tie x); descending raw gap;
                                       #  both sides >= MIN_FRAME_NODES; raw gap >= MIN_SPLIT_GAP;
                                       #  gap tie -> smaller low coord -> smaller min id
    if cut is none:                          drop(g, "no valid spatial gap"); return []
    return spatialCohesion(cut.a, depth+1) ++ spatialCohesion(cut.b, depth+1)
    # a valid cut always leaves both sides >= 3, so no sub-3 fragment is created

  # --- r3b: S3 acceptance gate — no mega-frame -------------------------------
  candidates = [g for g in candidates
                if |g| <= MAX_FRAME_FRACTION * eligible.length
                else drop(g, "exceeds MAX_FRAME_FRACTION")]

  # --- r4: overlap-resolution + the MAX_FRAMES ceiling ---------------------
  rank candidates by (|g| desc, intraDensity(g,adj) desc, minMemberId asc)
  kept = []
  for g in ranked:
      if kept.length == MAX_FRAMES (6):  drop(g, "MAX_FRAMES ceiling reached"); continue
      rect_g = round(growToMin(bboxOf(canonRect(m) for m in g) padded by AUTO_FRAME_PAD 24,
                               AUTO_FRAME_MIN 48))
      if exists k in kept with overlapArea(rect_g, k.rect)
                               > MAX_OVERLAP_FRAC (0.5) * min(area(rect_g), area(k.rect)):
          drop(g, "overlap > MAX_OVERLAP_FRAC of a kept frame"); continue
      kept.push({members: g, rect: rect_g})

  # --- order + labels -----------------------------------------------------
  kept.sort by (rect.y, rect.x, minMemberId)
  return [{area: i+1, rect, members} for i, k in kept]   # derived, in-memory only

# ACCEPTANCE CONTRACT — asserted on every retained frame, every fixture:
#   foreign(frame) <= max(2, floor(|frame| * 0.5))     (S8)
#   |frame| >= MIN_FRAME_NODES                          (S4)
#   |frame| <= MAX_FRAME_FRACTION * eligible.length     (S3)
#   no kept pair overlaps > 0.5 of the smaller rect
#   kept.length <= MAX_FRAMES
# A candidate that cannot satisfy it is UNFRAMED. Fewer than 6 frames, or 0,
# or coverage well below 0.5, is a correct result — never backfilled.
# Termination: every spatialCohesion call strictly shrinks a group, depth <= 6;
# r3b and r4 are single passes. No RNG, no `measured`, no wall-clock.
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
- Force-merging a leftover cluster into a kept frame to hit `MAX_FRAMES`, or
  keeping a contaminated / mega group because "some frame is better than none" —
  the post-pass **drops** every candidate that fails the acceptance contract
  (§AF3.6). Fewer than 6 frames, or 0, is a valid result.
- Reading React Flow's live `measured` node size anywhere in membership, split,
  ranking, or drop — all geometry is the canonical footprint (§AF8 / S9).
- Any auto-recompute on Template / file open, on a structural edit, or on a
  sim / Activity / Focus / Filter change (§AF4.1).
- Louvain / any RNG-seeded community method (determinism cost — §AF3.2).
- Changing the Slice-4a manual-frame contract, the Activity overlay, Focus,
  Filters, or the run distinction.

### AF10.4 Failure handling / fallback

| Situation | Behaviour |
|---|---|
| graph below the §AF2.2 floor | Suggest yields 0–1 frames; the control does not nag |
| an uncontaminated group holding > MAX_FRAME_FRACTION that split-big could not break (degenerate LP collapse) | **dropped** by the S3 acceptance gate (rule 3b) — `exceeds MAX_FRAME_FRACTION`; its nodes stay unframed |
| a **contaminated** group (§AF3.6 step 3) with no valid spatial cut, or still contaminated at `SPATIAL_MAX_DEPTH` (6) | **dropped** — never kept as a final frame, never merged; nodes stay unframed |
| a spatial cut — by construction leaves both sides ≥ MIN_FRAME_NODES | no sub-3 fragment is ever produced (the cut is only taken when both sides clear the floor) |
| LP does not converge in 20 rounds | stop at round 20 (deterministic); the partition at that point is used |
| every node is a model node | 0 auto frames; a short "nothing to group" note — a **normal** result, not an error |
| a user graph with few reliable clusters (low framed fraction, or only 1–2 frames, or none) | **valid normal output** — `Suggest frames` completes with no error; the algorithm never merges / fabricates a cluster to raise coverage. Coverage is a **reported metric, never a floor** (§AF2.3) |
| more than 6 clean candidates survive steps 1–3b | keep the 6 highest-ranked non-overlapping; **drop** the rest (`MAX_FRAMES ceiling reached`) — those nodes stay unframed. `MAX_FRAMES` is a ceiling, not a target |
| a fixture's final coverage jumps back up (e.g. MMO → 0.92) | **fixture failure** — the spatial pass stopped dropping; a regression, not an improvement (§AF2.4) |
| Suggest invoked twice with no change | identical frames (S5); the second invoke is a no-op visually |
| a node deleted after Suggest so a frame's member set is empty | that auto frame is dropped on the next re-infer; until then it renders at its last rect with the staleness indicator shown |

---

## AF11. Order this feeds into

Merges as *settled design*. The decisions are fixed: `MAX_FRAMES = 6` as a
**ceiling** with a drop (never force-merge) cap, **P1-only** recompute
(§AF4.1), §AF5's R1–R8, a **whole-graph** `WORTH_IT_FLOOR`, one
label-propagation run over all eligible nodes, multigraph adjacency, and —
from **review boundary 5** —

- **canonical geometry** (`CANON_NODE_W × CANON_NODE_H = 150 × 40`), never
  React Flow's `measured` size, so the result is locale-, font-, browser-,
  zoom- and render-timing-independent (S9);
- a **deterministic recursive spatial-cohesion pass** that **splits** any group
  whose member bbox holds `> max(2, floor(members × 0.5))` foreign node centres,
  and **drops** it outright if it cannot be cleanly bisected;
- an **S3 acceptance gate** that drops a surviving group still > 55 % of the
  eligible count;
- **overlap-resolution + the ceiling** that drops any candidate stacking > 0.5
  of the smaller rect on a kept frame and stops at 6;
- the **acceptance contract** (§AF3.6): every retained frame is clean, in
  range, non-overlapping — a candidate that can't be is unframed, and fewer
  than 6 frames (or 0, or coverage well below 0.5) is a correct result.

MMO's fixture coverage moves **0.92 → 0.43** by design (§AF2.3). The
**implementation PR still requires explicit approval before it starts** — it is
render / UI-only, no `src/` wire change, no engine change, one PR with the §AF8
test set (Table A + spatial-candidate-stage + Table B fixtures with the
per-frame acceptance assertion + the threshold sweep + the S9 canonical-geometry
unit test + e2e + **two** visual baselines + a determinism e2e).

Slice 5 (`saved` frames) and the §PD12 authored-sections / hierarchical-groups
candidates remain **separate, later** passes and are not unblocked by this doc.
