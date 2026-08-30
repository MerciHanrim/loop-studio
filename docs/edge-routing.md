# Edge Routing (non-frozen design doc — DRAFT)

**Status: DRAFT for review (round 2 — Lumi's ER-D2 / algorithm / recompute /
waypoint boundaries folded in).** A **non-behavioral** rendering concern: how a
resource / state edge's *path* is drawn between two fixed endpoints. It does
**not** change `source` / `target` / handles, the engine, `R(t)`, state
semantics, or Monte-Carlo results. This design doc carries no `loop-*/N` id and
is revised freely (like `docs/visual-language.md` / `docs/mobile.md`) — **but**
the user-intent fields it introduces (`route` mode + `waypoints`) ARE GraphDoc
content, so they need a **frozen `loop-revision/3`** wire amendment (§ER6)
before the first user-facing slice ships. §ER11 is the decision record; §ER12
the acceptance / E2E; §ER13 the scope boundary.

This is the **deferred** item from `docs/visual-language.md` §VL6 "Routing" —
the Canvas Visual Refresh (v0.6.0) fixed edge *class / direction / cues* and
left geometry on React Flow's Bézier path (`getBezierPath`). This doc pins down
what "orthogonal routing" means for Loop Studio before any implementation.

**Build order (settled with Lumi):**
1. this design doc → review → settle;
2. `SEMANTICS-R3.md` (`loop-revision/3`) — the `route` / `waypoints` fields in
   the canonical projection, tagged **cosmetic** (projected + diffable, not
   engine-affecting); draft → **Frozen**;
3. **Slice 1** — `route` mode + automatic orthogonal routing (the `waypoints`
   field exists in the contract but has no editing UI yet);
4. **Slice 2** — manual waypoint editing UI.

---

## ER0. Why

- **Readability of structure.** On a graph with more than a handful of nodes,
  Bézier curves cross nodes, overlap each other, and make "what connects to
  what" hard to trace. Orthogonal (right-angle) segments that step around nodes
  read like a wiring diagram.
- **Parallel edges.** Two edges between the same pair of nodes draw on top of
  each other today; they should fan out.
- **It is the natural next step after the Visual Refresh** — same surface
  (`LoopEdge` / the canvas), small blast radius (no engine, no wire contract),
  and it composes with the direction marker, the flow bead, and the L2/L1/L0
  zoom levels already shipped.

### Scope

**In**

- an **orthogonal route**: axis-aligned segments with rounded corners between
  the two endpoints React Flow already gives us (`sourceX/Y`, `targetX/Y`, and
  the `Position` each handle sits on);
- **obstacle avoidance**: the route steps around node bounding boxes (+ a
  margin), deterministically;
- **parallel-edge fan-out**: N edges between the same ordered pair are offset so
  they do not overlap;
- **manual waypoints** (working title "handles"): a user can drag a point on an
  edge to pin the route through it, add / remove points, and reset an edge to
  auto;
- **per-edge opt-in**: an edge is `bezier` (today's look) or `orthogonal`; an
  existing graph renders **identically** until a user changes an edge (ER-INV-1);
- desktop editing; **mobile is display-only** (view/run — no route editing,
  §MV1), but a mobile viewer sees whatever route the file specifies.

**Out**

- changing which handle an edge attaches to, or adding new handles;
- any engine / `R(t)` / state-semantics effect (ER-INV-2);
- Scenario Compare, comparison charts, dashboards (`docs/` TBD, separate);
- a full canvas redesign — this is one more pass on the existing visual
  language, not a new one;
- curved-orthogonal hybrids, edge bundling, or a force-directed re-layout of
  nodes.

---

## ER1. Terms

| term | meaning |
|---|---|
| **route** | the ordered list of points the edge path passes through, endpoints included. A Bézier edge has an implicit 2-point route; an orthogonal edge has ≥ 2. |
| **segment** | a straight piece of the route between two consecutive points. Orthogonal ⇒ every segment is horizontal or vertical. |
| **corner** | where two segments meet; drawn with a small fixed radius (`--radius-…`), never a hard 90°. |
| **waypoint** | a route point that is **not** an endpoint. **Auto** waypoints are computed; **manual** waypoints are placed by a user and pinned. |
| **obstacle** | a node's box (`position` + `measured` size) in flow coordinates, inflated by `ROUTE_PAD` on every side. The route's own source / target nodes are *not* obstacles for that edge. |
| **channel** | the gap between two obstacles (or an obstacle and open space) a segment can run through. |
| **auto route** | a route with no manual waypoints — fully recomputed from the current node layout. |
| **pinned route** | a route with ≥ 1 manual waypoint — the manual points are fixed; the router A*-connects each span between consecutive pinned points (and the two end spans), so it still avoids obstacles (ER-D4). |

---

## ER2. The routing model

- **Orthogonal, per-edge, deterministic.** Given the same node layout, handle
  positions, and manual waypoints, an edge's route is a pure function — byte-
  identical every render (needed for the pixel matrix and for a stable
  `edge-interaction` hit path).
- **Endpoints are fixed.** The route starts at the source handle and ends at
  the target handle, leaving each along its handle's `Position` normal (a short
  fixed **stub** so the line doesn't emerge diagonally). React Flow already
  supplies `sourcePosition` / `targetPosition`.
- **Corners are rounded** at a fixed radius; a segment shorter than `2 × radius`
  drops the corner (straight join) rather than overshooting.
- **The direction marker (§VL6) rides the final segment** — its orientation
  follows the last segment's axis, not the straight-line angle.
- **The fat `edge-interaction` hit path follows the route**, so selecting an
  orthogonal edge means clicking near its actual drawn path (VL-INV: the hit
  path is part of what a render must keep stable for a given route).
- **Zoom LOD (§VL7).** The route is world-space; it does not change with zoom.
  At L1 / L0 the flow chip is already hidden; the route itself is required-set
  (it *is* "edge class + direction") and is drawn at every level.

---

## ER3. Auto-routing algorithm

A deterministic **orthogonal connector** in the family used by diagram editors
(libavoid / draw.io "orthogonal", GoJS `AvoidsNodes`;
[elkjs-libavoid](https://github.com/MrMint/elkjs-libavoid) documents the same
knobs — segment penalty, obstacle buffer, shared-path penalty, port-direction
penalty, self-loop policy). Every constant below is a **fixed value**, not a
per-graph tuning; a different browser or a different node/edge input order must
produce a **byte-identical** route.

### ER3.1 Constants (world units, `world px`)

| name | value | meaning |
|---|---|---|
| `ROUTE_PAD` | **12** | obstacle inflation on every side of a node box |
| `ROUTE_STUB` | **16** | perpendicular exit length off the source handle; entry length into the target handle. The route may not turn inside a stub. |
| `BEND_COST` | **20** | added to a route's cost per corner |
| `PARALLEL_GAP` | **10** | perpendicular spacing between fanned-out parallel edges |
| `CORNER_R` | **6** | drawn corner radius (`--radius` token); a segment shorter than `2 × CORNER_R` draws a straight join |
| `SELF_LOOP` | **28** | the offset of a `source === target` loop from the node box |
| `COORD_EPS` | **1e-3** | ruler-coordinate quantum; two coordinates within `COORD_EPS` are the same ruler |
| `PATH_DECIMALS` | **2** | `d`-string coordinate precision (matches today's `react-flow__edge-path`) |
| `MAX_EXPANSIONS` | **20000** | per-edge A* node-expansion cap → L/Z fallback if hit |

### ER3.2 Obstacles

- An **obstacle** is a node's box `{x, y, width, height}` from
  `node.position` + `node.measured` (fall back to `node.width/height`), inflated
  by `ROUTE_PAD` on all sides.
- The edge's **own source and target nodes are not obstacles** for that edge.
- Inflated boxes may **overlap** — treat the obstacle set as a union of
  rectangles; a point is "free" iff it is outside every inflated box.
- If a stub end (`ROUTE_STUB` off a handle) lands **inside another obstacle**,
  clamp that stub to the first free point along the handle normal (shortening,
  never lengthening past `ROUTE_STUB`), and continue.

### ER3.3 Rulers (the search graph)

- **Candidate x-lines** = for every obstacle: its left and right inflated edge;
  plus the source stub-end x and the target stub-end x; plus, for every pair of
  adjacent obstacle x-edges with a gap `> 2 × ROUTE_PAD`, the **midpoint**
  (channel centre). Same construction for **y-lines**.
- **Normalise:** round each coordinate to `COORD_EPS`
  (`Math.round(v / COORD_EPS) * COORD_EPS`), then sort ascending and dedupe.
  All arithmetic is float64; negative and fractional inputs are fine — the
  only rounding is this step and the final `d` string.
- **Nodes of the search graph** = the intersections of an x-line and a y-line
  that lie outside every inflated obstacle, plus the two stub ends.
- **Moves** connect two search nodes that share a ruler and whose connecting
  segment crosses no inflated obstacle.

### ER3.4 Cost & the total tie-break order

A route's cost, compared **lexicographically** in this exact order — the first
difference decides, so the route is a total order with **no ties left**:

1. **length** — total manhattan length, smaller wins;
2. **bends** — number of corners, fewer wins (each already carries `BEND_COST`
   in (1); this is the explicit second key);
3. **backtrack** — sum of segment lengths that move *away* from the target on
   the axis pointing at it (a "reverse-direction" / port-direction penalty),
   smaller wins;
4. **shared / crossing** — `(count of segments colinear-and-overlapping with an
   already-routed edge in this pass) × 2 + (count of crossings with an
   already-routed edge)`, smaller wins. Edges are routed in ascending **edge
   `id`** order, so "already-routed" is deterministic;
5. **geometry tie-break** — the route's point list, flattened to
   `[x0,y0,x1,y1,…]` and compared element-by-element, smaller wins;
6. **edge id** — never actually reached (5 is already total for distinct
   routes), kept as the documented final key.

A* uses the manhattan-distance heuristic plus `BEND_COST` for a turn; the
open-set tie-break is (lower `f`, then lower `g`, then the move that reduces the
larger remaining axis distance, then lower `(x, y)`).

### ER3.5 Post-process

- Drop any point equal to its predecessor within `COORD_EPS` (**zero-length
  segment removal**).
- Drop any interior point colinear with both neighbours within `COORD_EPS`
  (**consecutive-colinear collapse**) — the route is the minimal point list for
  its shape.
- Round every surviving coordinate to `PATH_DECIMALS` for the `d` string.
- Corners: emit a quadratic/arc join of radius `min(CORNER_R, halfShorter)`;
  below `2 × CORNER_R` on either incident segment, emit a straight `L`.

### ER3.6 Special cases (all deterministic, none use A*)

| case | route |
|---|---|
| **self-loop** (`source === target`) | exit the source handle's side, out `ROUTE_STUB`, along the side `SELF_LOOP`, back in `ROUTE_STUB` to the target handle — a fixed 3-corner rounded rectangle. If the two handles are on different sides, the loop hugs the corner between them. |
| **same-side handles** (both `Left`, both `Right`, …) | a "C": exit both stubs the shared normal, run the outer segment at `max(sourceStubEnd, targetStubEnd) + ROUTE_PAD` from the node, join. |
| **fully blocked** (A* returns nothing, or `MAX_EXPANSIONS` hit) | the direct **L** (one bend) if source/target axes differ, else the **Z** (two bends) through the midpoint of the endpoints' bounding box — ignores obstacles, may overlap. Logged once per edge id. Never drops the `path`. |
| **degenerate** (endpoints within `COORD_EPS`) | a straight `M … L …` of `≥ 1px` so the marker still orients. |

### ER3.7 Parallel-edge fan-out

- A **parallel set** = all edges sharing the ordered key
  `(source, sourceHandle, target, targetHandle)` **including reversed pairs**
  (`A→B` and `B→A` fan out together).
- Sort the set by **edge `id`** (string compare) → index `i` in `0..K-1`.
- Offset edge `i` by `(i − (K−1)/2) × PARALLEL_GAP` perpendicular to its
  first/last segment, applied to the stub start/end and carried into the
  search. Ordering by `id` (not array/paint order) makes the layout
  independent of insertion order.

### ER3.8 Recompute — the cache key

A route is recomputed **iff** any of the following identity inputs changes:

- a node is **created / deleted / moved** (its `position`);
- a node's **`measured` width/height** changes, or a **handle's position**
  (`Position` or offset) changes;
- an **edge is created / deleted**;
- **this edge's** `source` / `target` / `sourceHandle` / `targetHandle`
  changes;
- **this edge's** `route` mode or `waypoints` change;
- the **parallel set this edge belongs to** changes (a sibling added / removed /
  re-keyed);
- a **router constant** (§ER3.1) or the obstacle-padding config changes
  (build-time only today, but the key includes it).

It is **NOT** recomputed on zoom, pan, hover, selection, keyboard focus, theme
change, a sim step / run cue, or any animation frame. The memo key is the tuple
of every input above (obstacle boxes as a sorted, `COORD_EPS`-quantised list).
During an active node drag, edges incident to the dragged node use the L/Z
fallback for the live preview and do the full computation once on `dragstop`
(one undo entry, coalesced like the node move).

---

## ER4. Manual waypoints ("handles") — the contract

A **waypoint** is stored, per edge, as an **ordered list of world-space finite
`{x, y}`**. The contract (Slice 2 builds the UI; the field exists from
`loop-revision/3`):

- **World-space, finite.** `x`, `y` are `number`, `Number.isFinite`, in the
  same flow coordinates as `node.position`. Non-finite / non-number ⇒ the
  waypoint list is rejected at read (defensive read → the edge falls back to a
  pure auto route + a warning, never a crash — mirrors `loop-model/1` §M1).
- **User order preserved.** The list is used in array order; the router does
  **not** reorder it.
- **Endpoints are never stored.** The source and target handles are the
  implicit first and last points; `waypoints` are strictly interior.
- **The router connects the spans.** It orthogonally connects
  `sourceStubEnd → waypoint[0]`, each `waypoint[k] → waypoint[k+1]`, and
  `waypoint[last] → targetStubEnd`, each span run through the same A* (with the
  span's own two ends as start/goal) so it still avoids obstacles between the
  pinned points. (This resolves the old ER-D4: **auto-fill between**, never a
  literal polyline.)
- **Waypoints are fixed on node move.** Moving a node re-routes the *spans*
  around it; the manual points do not move. (A node dragged *onto* a waypoint →
  next item.)
- **A waypoint inside an obstacle** (after `ROUTE_PAD` inflation) → the edge
  shows an **`invalid`-style cue** (the §VL3 dashed `--warning` treatment on the
  edge, a tooltip "a route point is inside a node") and the route uses the
  deterministic fallback for the affected span (route to the nearest free
  point, then to the next pinned point). The waypoint value is **kept** (not
  auto-deleted) so the user can drag it out.
- **Reset route** removes **all `waypoints`**, keeps **`route` mode**. One undo
  entry.
- **Undo granularity.** Add, move (per `dragstop`), delete, and Reset are each
  **one** undo entry.
- **Revision.** `waypoints` is `loop-revision/3` **cosmetic** content: it
  appears in the canonical projection, the dirty check, and the three-way diff,
  and it is **never engine-affecting** (no `R(t)`, engine, state, or MC effect —
  ER-INV-2).

Editing UI (Slice 2): on a **selected** `orthogonal` edge, each auto segment
shows a mid-segment grab handle (drag → create a manual waypoint, snapped to the
`ROUTE_PAD` grid); each manual waypoint shows a draggable dot; dragging a
waypoint moves its two incident segments as an orthogonal pair. Desktop only —
mobile renders the file's route, no handles.

---

## ER5. `route` mode & Bézier parity

- **Per-edge `route` mode** — `"bezier"` or `"orthogonal"`; **absent ⇒
  `"bezier"`**. Nothing else about the edge changes.
- **Existing graphs are inert.** With no `route` field and no `waypoints`, an
  edge emits exactly `getBezierPath(...)` — this feature does not touch the
  bytes, the digest, the undo stack, or the render of any graph that has never
  had an edge re-routed (ER-INV-1 / -6).
- **Opt-in survives the file.** A user sets `route: "orthogonal"` via the
  Inspector edge panel (`Route: Curved | Orthogonal`) or a context action. It is
  **stored** (`loop-revision/3` cosmetic content), so it persists through
  reload, autosave, Export/Import, a Share link, and a Project revision — the
  reason option A (store nothing) is rejected. One undo entry; marks the
  revision dirty; shows in the diff as a cosmetic-tagged field change.
- **A global "new edges are orthogonal" default** is deferred and must never
  retroactively rewrite existing edges.
- **Everything visual is unchanged** — the direction marker, flow bead,
  reduced-motion cue, selection / focus / invalid rings, the flow chip, and the
  L2/L1/L0 behaviour all consume the `path` string; an orthogonal `path` just
  has more segments.

---

## ER6. Serialization — DECIDED: the `loop-revision/3` cosmetic contract

**Decision (Lumi, round 2):** fix the **C** wire contract now; stage the
implementation. The file stores **user intent only**, never a computed result.

- **Stored on the edge** (in `edge.data`, alongside `flow` / `resourceType`):
  - `route?: "bezier" | "orthogonal"` — absent ⇒ `"bezier"`;
  - `waypoints?: { x: number; y: number }[]` — absent / `[]` ⇒ none; each
    finite, world-space, user order (§ER4).
- **Never stored:** the computed orthogonal path, its bends, corner points, or
  any A* output. Those are recomputed from the layout every time (§ER3.8).
- **`loop-revision/3`** (new `SEMANTICS-R3.md`, drafted + **Frozen** before
  Slice 1):
  - `route` and `waypoints` join `FIELDS_BY_KIND` for resource **and** state
    edges, **after** `resourceType`, emitted only when non-default
    (conservative extension — a graph with neither is byte- and
    digest-identical under the v2 *and* v3 projection, like R2-INV-2);
  - both fields are tagged **cosmetic** (the existing 3rd tag beside
    engine / advisory is `cosmetic` per `loop-revision/2` §R2-3 — confirm the
    exact name during the R3 draft): projected, diffed, dirty-tracked,
    **never** `engineAffecting`, never feeds `nConf` on its own;
  - `waypoints` canonical form: the array in order, each `{x, y}` with the
    coordinate written as `loop-expr/1`-style verbatim `String(n)` (finite
    float64), no rounding in the projection (rounding is a *render* step);
  - version predicate: a graph is `loop-revision/3` iff any edge carries a
    non-default `route` / `waypoints` (inferred, never stored — same shape as
    the v1/v2 predicate);
  - **v1 → v2 → v3 all lift**: verify a v1/v2 file against its own projection,
    then lift to the common v3 compare model (R2-INV-style).
- **`loop-workspace` stays v1** — routing adds nothing to `SimState`, the
  restore contract, or the semantic digest. To be re-confirmed with a fixture
  in the R3 work (the same round-trip check the model layer got).
- **VL-INV / ER-INV-1** still holds: a graph that has never had an edge
  re-routed serialises and digests exactly as it does today.

Rejected: **A** (nothing stored) — an Inspector opt-in that does not survive
reload / Share / a Project revision is not a shippable user feature. **B**
(mode as one advisory field, no `waypoints`) — the field still enters the
GraphDoc, so a Frozen `loop-revision/2` that does not know about it reintroduces
the "the file changed but the dirty flag / revision diff did not" bug; and it
would force a *second* wire version when `waypoints` land. Fixing **C** once
means Slice 1 ships without a waypoint UI and Slice 2 needs no new wire
version.

---

## ER7. Invariants (ER-INV)

1. **No change without an edit.** Loading, rendering, hovering, selecting,
   focusing, zooming, or running a graph never changes an edge's stored `route`
   / `waypoints`, the GraphDoc bytes, its `loop-revision/*` digest, the
   undo/redo stacks, or the viewport. The render path (route computation) is
   strictly read-only.
2. **No semantic effect.** Re-routing an edge does not change `source` /
   `target` / `sourceHandle` / `targetHandle`, engine results, `R(t)`, state
   events, resource-type findings, Monte-Carlo output, or the timeline.
3. **Deterministic & idempotent.** Same layout + handles + manual waypoints ⇒
   byte-identical route ⇒ byte-identical `path` `d` and `edge-interaction`
   `d`. Re-rendering without a layout change re-uses the memoized route.
4. **Endpoints honoured.** The route begins at the source handle and ends at
   the target handle, along each handle's `Position` normal. Fan-out offsets the
   stub, not the attach point.
5. **Never fails to draw.** A boxed-in pair falls back to a direct L/Z route
   (may overlap) rather than dropping the edge.
6. **Bézier parity.** With mode `bezier` (the default), the emitted `path` is
   exactly `getBezierPath(...)` — this feature is inert for an untouched graph.

---

## ER8. Interaction

- **Switch mode** — Inspector edge panel: `Route: Curved | Orthogonal`. Or
  right-click edge → "Orthogonal route" / "Curved route". One undo entry.
- **Add a waypoint** — drag a segment's mid-handle on a selected orthogonal
  edge. Snaps to grid.
- **Move a waypoint** — drag its dot; incident segments move as an orthogonal
  pair.
- **Remove a waypoint** — select it + `Delete`, or right-click → "Remove point".
- **Reset route** — right-click edge → "Reset route" (clears manual waypoints;
  auto takes over). Also in the Inspector.
- **Keyboard** — an edge is already focusable; `Enter` on a focused edge opens
  its Inspector where the Route control lives. Waypoint nudging with arrow keys
  is a nice-to-have, deferred.
- **Mobile** — none of the above; the edge renders along the file's route.

---

## ER9. Accessibility & theming

- **Corners** use a single `--radius` token; **stroke, dash, colour, marker**
  are unchanged from §VL6 — an orthogonal resource edge is still solid
  `--edge-resource` with the resource arrow; state is still dashed.
- **Hit area** — the `edge-interaction` fat path follows the route, so the
  clickable region matches what's drawn (no invisible diagonal shortcut).
- **forced-colors** — routing is pure geometry; nothing new to override. The
  existing solid/dashed + arrow tells carry.
- **prefers-reduced-motion** — a route change (mode switch, node move) is
  **instant**; no path-morph animation in either motion mode. (Rationale: a
  moving path is exactly the kind of motion the setting asks to drop, and it
  carries no information a static frame doesn't.)
- **Contrast / zoom** — unchanged; the route is required-set at every LOD.

---

## ER10. Performance

- Route computation is **O(rulers²)** per edge worst case; rulers ≈
  2 × visible nodes. Memoised per edge on the full §ER3.8 cache key.
- `MAX_EXPANSIONS` (§ER3.1) caps an edge's A* → L/Z fallback, logged once,
  never a frame drop.
- During a node drag, incident edges use the L/Z fallback for the live
  preview; the full computation runs once on `dragstop`.
- The memo is **not** invalidated by zoom / pan / hover / selection / theme /
  a sim step / an animation frame.

---

## ER11. Decisions

| id | question | decision |
|---|---|---|
| **ER-D1** | orthogonal-only, or also 45° / hybrids? | **Decided — orthogonal only.** |
| **ER-D2** | serialization — A / B / C? | **Decided — the C wire contract, staged.** File stores `route` mode + optional `waypoints` (user intent only); computed path never stored; both tracked as **`loop-revision/3` cosmetic** content. Slice 1 = mode + auto routing; Slice 2 = waypoint UI (§ER6). |
| **ER-D3** | default mode for a *new* edge? | **Decided — `"bezier"`** (absent field ⇒ bézier). A global "new edges orthogonal" toggle is deferred and must not rewrite existing edges. |
| **ER-D4** | pinned route — auto-fill between waypoints, or literal polyline? | **Decided — auto-fill between.** The router A*-connects each `waypoint[k] → waypoint[k+1]` span (and the two end spans), so a pinned route still avoids obstacles between the pinned points (§ER4). |
| **ER-D5** | router constants | **Decided as fixed values** in §ER3.1 (`ROUTE_PAD 12`, `ROUTE_STUB 16`, `BEND_COST 20`, `PARALLEL_GAP 10`, `CORNER_R 6`, `SELF_LOOP 28`, `COORD_EPS 1e-3`, `PATH_DECIMALS 2`, `MAX_EXPANSIONS 20000`). Not per-graph tunable. Any change is a router-config change and part of the cache key. |
| **ER-D6** | cost / tie-break order | **Decided** — length → bends → backtrack → shared/crossing → geometry (flattened point list) → edge id; total, no residual ties (§ER3.4). |
| **ER-D7** | ruler generation + numeric normalisation | **Decided** — obstacle inflated edges + stub-end coords + wide-channel midpoints; quantise to `COORD_EPS`, sort, dedupe; float64 everywhere else, negatives/fractions fine (§ER3.3). |
| **ER-D8** | endpoint-node obstacle exception + stub length | **Decided** — the edge's own source/target nodes are not obstacles for it; a fixed `ROUTE_STUB` (16) perpendicular exit/entry, clamped shorter (never longer) if it lands in another obstacle (§ER3.2). |
| **ER-D9** | self-loop, same-side handles, fully blocked, overlapping obstacles, degenerate endpoints | **Decided** — deterministic non-A* routes for each (§ER3.6); obstacle set is a union of rectangles (§ER3.2). |
| **ER-D10** | zero-length segments + consecutive collinear points | **Decided** — dropped in the post-process pass within `COORD_EPS` (§ER3.5); the route is the minimal point list for its shape. |
| **ER-D11** | parallel-edge fan-out order | **Decided — by edge `id`** (string compare), so it is independent of insertion / paint order; the set includes reversed pairs (§ER3.7). |
| **ER-D12** | recompute triggers + cache key | **Decided** — the 7-input list in §ER3.8; never zoom / pan / hover / select / focus / theme / sim / animation. |
| **ER-D13** | manual-waypoint contract | **Decided** — world-space finite `{x,y}`, user order, endpoints excluded, auto-fill between, fixed on node move, in-obstacle ⇒ `invalid` cue + fallback (value kept), Reset clears waypoints only, one undo entry per add/move/delete/Reset, cosmetic revision content, no engine effect (§ER4). |
| **ER-D14** | mobile | **Decided — render the file's route as-authored;** no route-editing handles (routing is display-only on the view/run layout). |
| **ER-D15** | pixel matrix | **Decided** — the Visual Refresh matrix fixture stays bézier; add a **separate** small orthogonal-route fixture with its own committed frames. |

Open (not blocking Slice 1): a global "new edges orthogonal" toggle;
arrow-key waypoint nudging; whether the flow chip needs its own offset beyond
riding the route midpoint (leaning: no).

---

## ER12. Acceptance / E2E

Machine-checkable, mirroring the Visual Refresh specs.

**Bézier parity & invariants**
1. Load every `examples/**` graph, render, pan / zoom / run; serialized
   GraphDoc + `loop-revision/*` digest + `canUndo` byte-identical to before;
   every edge `path` `d` equals `getBezierPath(...)`. (ER-INV-1 / -6.)
2. Switch an edge to `orthogonal`, then back; one undo entry each way; digest
   changes on switch (cosmetic field) and returns exactly on switch-back;
   engine pool series / `R(t)` / state events / resource findings / MC digest
   **unchanged** throughout. (ER-INV-2.)

**Determinism**
3. A fixture with obstacles; an orthogonal edge's `path` `d` **and**
   `edge-interaction` `d` are byte-identical across two fresh loads, after
   hover / select / focus / zoom / pan / theme toggle / a sim step, and with
   the node array and the edge array **reversed** on input. (ER-INV-3.)
4. Two graphs identical up to node/edge insertion order route every edge
   identically (edge-id ordering, §ER3.7 / ER3.4-5).
5. Coordinates: a fixture with negative and fractional node positions routes
   without NaN and its `d` matches a committed golden.

**Geometry**
6. No route segment intersects an inflated non-endpoint obstacle box (assert
   geometrically); the edge's own endpoint nodes are exempt.
7. First point == source handle, last == target handle; first/last segments
   axis-aligned along the handle `Position`; the direction marker orients along
   the last segment. (ER-INV-4.)
8. Special cases: a self-loop, a same-side pair, and a fully-boxed-in pair each
   draw a non-empty `d` (deterministic golden per case); the boxed-in one is
   the documented L/Z. (ER-INV-5.)
9. Post-process: a fixture that would produce a zero-length segment / three
   collinear points yields the minimal point list (assert point count).

**Parallel edges**
10. K = 3 edges between one ordered pair ⇒ 3 distinct routes, none overlapping
    along their shared span; swapping two of the three edge ids swaps their
    offsets (order is by id, not array position).

**Waypoints (Slice 2)**
11. Add / move / delete / Reset are one undo entry each; `waypoints` appears in
    the three-way diff as a **cosmetic** change, never feeds `nConf`, never
    changes `engineAffecting`.
12. A waypoint dragged inside a node shows the `invalid` edge cue, the value is
    kept, and the affected span uses the fallback; dragging it out clears the
    cue. Moving a node leaves the waypoints fixed and re-routes the spans.
13. `loop-workspace/1` round-trip: step, Export a Workspace, re-Import — the
    `route` / `waypoints` come from the GraphDoc (not `SimState`), the run
    state restores, nothing about routing is in the workspace payload.

**Accessibility / platform**
14. `forced-colors: active` and `prefers-reduced-motion: reduce` — a mode
    switch is instant (no path-morph); solid-vs-dashed + the direction marker
    survive; the fat hit path follows the route.
15. Mobile: a file with an orthogonal edge renders that route; no
    route-editing handles; no horizontal document scroll.
16. Perf guard: a fixture above `MAX_EXPANSIONS` falls back to L/Z, logs once,
    no dropped frame; the memo is not invalidated by zoom / select / hover.

---

## ER13. Scope boundary

- This is **edge geometry only** — it composes with, and does not re-open, the
  v0.6.0 Canvas Visual Refresh (edge *class / direction / cues*, zoom LOD,
  reduced-motion, forced-colors, the pixel matrix).
- **Scenario Compare is a different project** — comparing *run results* across
  Parameter combinations (save format, run budget, comparison basis, chart
  semantics). Nothing here touches it.
- **No node re-layout.** Routing steps edges around nodes where they *are*; it
  never moves a node.
