# Edge Routing (non-frozen design doc)

**Status: Slice 1 shipped in v0.7.0 (automatic orthogonal routing, PR #51); kept
as the living reference. Manual waypoint editing (§ER4, "Slice 2") is
deferred — the wire contract is frozen and existing waypoints round-trip
losslessly, but the create / move / delete UI is not built.** A
**non-behavioral** rendering concern: how a
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
| `PATH_DECIMALS` | **2** | rendered `d`-string precision only (matches today's `react-flow__edge-path`) — **never** applied to a stored `waypoints` coordinate |
| `MAX_EXPANSIONS` | **20000** | per-edge A* node-expansion cap → L/Z fallback if hit |
| `MAX_WAYPOINTS_PER_EDGE` | **64** | defensive cap; a `waypoints` array longer than this drops the whole routing payload for that edge (§ER4) |

### ER3.2 Obstacles

- **Handle points** (issue #344, `docs/diagram-layout.md` §DL1): a resource
  handle (`in` / `out`) starts or ends a route on the fixed port row 28 px below
  the node's top, at the x where the drawn outline is on that row
  (`portInsetFraction`); a state handle at the top / bottom centre. Before
  #344 a resource handle was at the side's vertical centre.
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

### ER3.5 Numeric normalisation & post-process

Applied to the **derived path only** — never to a stored `waypoints`
coordinate (§ER4).

- **Quantise** every ruler / search coordinate to `COORD_EPS` with
  round-half-away-from-zero:
  `q(v) = Math.sign(v) * Math.round(Math.abs(v) / COORD_EPS) * COORD_EPS`.
  This is symmetric about 0, so a negative coordinate rounds the mirror of its
  positive twin (no `Math.round`'s round-half-toward-`+∞` bias).
- **`-0 → 0`** everywhere a coordinate is written or compared
  (`x === 0 ? 0 : x`), so `-0` and `0` never produce two rulers or two `d`
  strings.
- **Half-ties** in any `<` comparison (cost keys, ruler sort, open-set) break
  toward the **smaller signed value**, then smaller `x`, then smaller `y`,
  then lower edge `id` — every comparator is a total order.
- **Zero-length segment removal** — drop any path point equal to its
  predecessor within `COORD_EPS`.
- **Consecutive-collinear collapse** — drop any interior path point collinear
  with both neighbours within `COORD_EPS`; the path is the minimal point list
  for its shape.
- **Round** every surviving path coordinate to `PATH_DECIMALS` for the `d`
  string.
- **Padding re-check (final)** — after rounding, assert no rounded path segment
  lies within an inflated obstacle (`ROUTE_PAD`). If rounding pushed a segment
  in (only possible at the `COORD_EPS` / `PATH_DECIMALS` boundary), nudge that
  segment out by one `PATH_DECIMALS` step, deterministically, away from the
  obstacle centre; if that still fails, the edge takes the L/Z fallback
  (§ER3.6) — a rounded path never visibly cuts a node.
- Corners: emit a quadratic/arc join of radius `min(CORNER_R, halfShorter)`;
  below `2 × CORNER_R` on either incident segment, emit a straight `L`.

### ER3.6 Special cases & fallback (all deterministic, none use A*)

Each returns a route with an explicit **`routeClass`** on the rendered edge
(`data-route-class`, for the E2E and for a one-time console note) — the stored
GraphDoc is untouched:

| case | `routeClass` | route |
|---|---|---|
| normal A* result | `orthogonal` | the searched route |
| **self-loop** (`source === target`) | `self-loop` | exit the source handle's side, out `ROUTE_STUB`, along the side `SELF_LOOP`, back in `ROUTE_STUB` to the target handle — a fixed 3-corner rounded rectangle. Different sides ⇒ the loop hugs the corner between them. |
| **same-side handles** (both `Left` / both `Right` / …) | `same-side` | a "C": exit both stubs the shared normal, run the outer segment at `max(sourceStubEnd, targetStubEnd) + ROUTE_PAD` from the node, join. |
| **blocked** — A* returns nothing, `MAX_EXPANSIONS` hit, or the §ER3.5 padding re-check still fails | `fallback-lz` | the direct **L** (one bend) if source/target axes differ, else the **Z** (two bends) through the midpoint of the endpoints' bounding box — ignores obstacles, may overlap. |
| **degenerate** — endpoints within `COORD_EPS` | `degenerate` | a straight `M … L …` of `≥ 1 px` along the source handle normal so the marker still orients. |

The **`fallback-lz` route is itself deterministic** — the same L/Z for the same
`(sourceStubEnd, targetStubEnd, sourcePosition, targetPosition)`, so its `d` and
`edge-interaction` `d` are byte-identical across renders and input orderings,
exactly like a searched route. A `fallback-lz` is `console.warn`'d **once per
edge id per session** (dev only), never per frame.

### ER3.7 Parallel-edge fan-out

- A **parallel set** = all edges sharing the ordered key
  `(source, sourceHandle, target, targetHandle)` **including reversed pairs**
  (`A→B` and `B→A` fan out together).
- Sort the set by **edge `id`** (string compare) → index `i` in `0..K-1`.
- Offset edge `i` by `(i − (K−1)/2) × PARALLEL_GAP` perpendicular to its
  first/last segment, applied to the stub start/end and carried into the
  search. Ordering by `id` (not array/paint order) makes the layout
  independent of insertion order.

### ER3.8 The canonical cache key

The whole orthogonal-edge set shares **one** memo, keyed by a canonical
serialisation of exactly these inputs — nothing else, and **never a previous
route** (that would let an incremental result diverge from a clean recompute):

```
routeMapKey = stableStringify({
  nodes: [ for every node, sorted by id:
    { id, bx: q(x), by: q(y), bw: q(measuredW), bh: q(measuredH) } ],      // quantised bounds
  handles: [ for every handle actually used by an orthogonal edge, sorted:
    { nodeId, handleId, position, dx: q(offsetX), dy: q(offsetY) } ],
  edges: [ for every edge with route === "orthogonal", sorted by id:
    { id, source, target, sourceHandle, targetHandle,
      waypoints: [ {x, y} … ],                                             // raw wire precision, order kept
      parallelKey } ],                                                      // (source,sHandle,target,tHandle) unordered
  router: ROUTER_VERSION,                                                   // bumps if any §ER3.1 constant changes
})
```

- `q(v)` is the §ER3.5 quantiser (`-0 → 0`, round-half-away-from-zero).
- **Every** obstacle's geometry is in the key — the whole node set, not just
  nodes incident to a given edge (crossing / shared-path cost couples them).
- **Implementation (`src/store/routeMap.ts`):** the array identities are
  checked first (free), then a `layoutSignature` — every node's `id`,
  position, measured bounds and `hidden` flag, and every orthogonal edge's id,
  endpoints, handles and waypoints, as structured JSON (never a delimiter
  join: ids are user data). Same signature ⇒ same generation, so a `select`
  change or a label edit — which hand React Flow a new `nodes` array — no
  longer rebuild the map; a move, a resize, a hide, a route toggle, a handle or
  waypoint change, or an added / removed node or edge still do. Raw (not
  quantised) values are used, which can only rebuild more often, never reuse
  wrongly.
- **Excluded** (current decision, correct): zoom, pan, viewport transform,
  hover, selection, keyboard focus, theme / `data-theme`, `prefers-*`, sim
  status / step / run cue, any animation frame.
- **Bézier edges are not in the key** and never trigger a recompute.

### ER3.9 Global reroute is atomic

Because the cost function couples edges (crossing / shared-path) and the routing
order is by edge id, a change to the obstacle geometry **or** the
orthogonal-edge set does **not** recompute incident edges only:

1. On any `routeMapKey` change, recompute **every** `route === "orthogonal"`
   edge, in **ascending edge-id** order, in one pass (each edge sees the routes
   already committed *in this pass* for the shared/crossing key — §ER3.4).
2. Build the complete new `Map<edgeId, { d, hitD, routeClass }>` off to the
   side.
3. **Swap it in atomically** — one render commit. A render never mixes an
   edge's stale cached route with another edge's fresh one.
4. Therefore an incremental trigger (one node moved) and a cold full recompute
   from the same `routeMapKey` produce the **identical** route map
   (ER-INV-3 / acceptance §ER12.4).

During a node drag every pointer move changes the dragged node's bounds, so
every move is a `routeMapKey` change and runs the atomic full pass — the edges
drawn mid-drag are always canonical routes; there is no separate drag-time
preview or L/Z substitute (the cost of that pass is what §ER3.1's router
budget and the per-obstacle lattice keep small). A `nodes` / `edges` change
that leaves the key unchanged — a selection, a drag flag, a label or value edit
— reuses the current generation without recomputing (§ER3.8).

---

## ER4. Manual waypoints ("handles") — the contract

A **waypoint** is stored, per edge, as an **ordered list of world-space finite
`{x, y}`**. The contract (Slice 2 builds the UI; the field exists from
`loop-revision/3`):

- **Defensive read (`§ER4-DR`).** The routing payload = `route` +
  `waypoints`. It is accepted only if `waypoints` is an **array of ≤
  `MAX_WAYPOINTS_PER_EDGE` (64)** objects, each with `x` and `y` that are
  `typeof "number"` and `Number.isFinite`. If **any** of that fails —
  over-length, a non-object entry, a non-finite / non-number coord, `route`
  not one of `"bezier"` / `"orthogonal"`, or `waypoints` present with `route
  ≠ "orthogonal"` — the reader **drops the whole routing payload for that
  edge** (`route` → absent, `waypoints` → dropped) and emits one import
  warning. The **edge itself and its `source` / `target` / handles / `flow` /
  `kind` / every other semantic field are preserved** — this is a
  routing-only quarantine, mirrors `loop-model/1` §M1 / `graphStructureIssues`.
- **`-0 → 0`.** Any `-0` coordinate is normalised to `0` at read.
- **Wire precision is kept.** A read-accepted `{x, y}` is stored **verbatim**
  at full `Number` precision — `PATH_DECIMALS` and `COORD_EPS` are *render*
  steps (§ER3.5) and never touch the stored value. Round-tripping a file must
  not perturb a waypoint coordinate.
- **Duplicate / collinear waypoints are PRESERVED on the wire.** They are user
  intent; only the *derived path* strips zero-length and collinear *segments*
  (§ER3.5). A file with `[{10,10},{10,10},{10,40}]` keeps all three points and
  renders the same path as `[{10,40}]` between the same endpoints.
- **User order preserved.** The list is used in array order; the router does
  **not** reorder or dedupe it.
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
  *Slice 1 status:* the `RouteResult.invalidWaypoint` flag + the
  `.route-invalid` dashed `--warning` stroke + `routeClass: 'fallback-lz'` +
  value-kept are implemented; the **per-span** "nearest free point" refinement
  and the hover tooltip land with the Slice 2 drag UI.
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

### ER5.1 Canonical form — default Bézier is the *absence* of the fields

To keep the conservative extension exact (a graph that ends up back on Bézier is
byte- and digest-identical to before it was ever re-routed):

| rule | |
|---|---|
| `route` **absent** | = Bézier. The only canonical representation of "this edge is a curve". |
| **writer** | never emits `route: "bezier"` and never emits an empty `waypoints: []`. `serialize` / the revision projection strip both. |
| **reader** | an explicit `route: "bezier"` is **normalised to absent**; `waypoints` present alongside it is **dropped** (§ER4-DR). `waypoints` is meaningful **only** with `route: "orthogonal"`. |
| **switch → Bézier** (Inspector / context action) | removes **both** `route` **and** `waypoints` from `edge.data`. One undo entry. After it, the edge's bytes / projection / digest match a never-routed edge. |
| **switch → Orthogonal** | sets `route: "orthogonal"`; `waypoints` stays whatever it was (empty until Slice 2). |

An **explicit** stored Bézier (keeping `route: "bezier"` and preserving
`waypoints` across a Bézier↔Orthogonal toggle) is **not** in scope — it would
need its own decision on why, the UI affordance, and a `loop-revision/3` field
that is no longer "absent = default". If it is ever wanted it is a separate
amendment, not a silent behaviour.

### ER5.2 Parity & opt-in

- **Per-edge `route` mode** — `"bezier"` (⇒ absent) or `"orthogonal"`. Nothing
  else about the edge changes.
- **Existing graphs are inert.** With `route` absent and no `waypoints`, an
  edge emits exactly `getBezierPath(...)` — this feature does not touch the
  bytes, the digest, the undo stack, or the render of any graph that has never
  had an edge re-routed (ER-INV-1 / -6).
- **Opt-in survives the file.** Setting `route: "orthogonal"` is **stored**
  (`loop-revision/3` cosmetic content), so it persists through reload,
  autosave, Export/Import, a Share link, and a Project revision — the reason
  option A (store nothing) is rejected. One undo entry; marks the revision
  dirty; shows in the diff as a cosmetic-tagged field change. Switching **back**
  removes the fields and returns the edge (and the file, and the digest) to the
  v2 state.
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
  - `route?: "orthogonal"` — **absent ⇒ Bézier**; the writer never emits
    `"bezier"`, the reader normalises an explicit `"bezier"` to absent (§ER5.1);
  - `waypoints?: { x: number; y: number }[]` — meaningful **only** with
    `route: "orthogonal"`; absent / `[]` ⇒ none; ≤ 64, each finite, world-space,
    **verbatim `Number` precision**, user order, duplicates / collinear points
    **kept** (§ER4 / §ER4-DR).
- **Never stored:** the computed orthogonal path, its bends, corner points, the
  `routeClass`, or any A* output. Those are recomputed from the layout every
  time (§ER3.8 / ER3.9).
- **`loop-revision/3`** ([`SEMANTICS-R3.md`](specs/SEMANTICS-R3.md), **Draft** →
  Frozen before Slice 1) fixes, precisely:
  - `route` then `waypoints` join `FIELDS_BY_KIND` for resource **and** state
    edges, **after** `resourceType`, **emitted only when non-default**
    (`route` present == `"orthogonal"`; `waypoints` non-empty). A graph with
    neither is byte- and digest-identical under the v2 *and* v3 projection —
    the **v2 conservative-extension golden** (a committed v2 file whose v3
    digest equals its v2 digest);
  - both fields tagged **cosmetic** (the 3rd `loop-revision/2` §R2-3 field tag
    beside engine / advisory — confirm the exact token in the R3 draft):
    projected, diffed, dirty-tracked, **never** `engineAffecting`, never feeds
    `nConf` on its own;
  - `waypoints` canonical form: the array **in wire order, not deduped**, each
    `{x, y}` written as `loop-expr/1`-style verbatim `String(n)` for a finite
    float64 (`-0` already normalised to `0` at read); no rounding in the
    projection (rounding is a *render* step, §ER3.5);
  - the reader's `§ER4-DR` quarantine (drop the routing payload, keep the edge)
    is a `loop-revision/3` read rule, not just an editor nicety;
  - version predicate: a graph is `loop-revision/3` iff any edge carries
    `route: "orthogonal"` or a non-empty `waypoints` (inferred from normalised
    content, never stored — same shape as the v1/v2 predicate);
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
3. **Deterministic & idempotent.** The same `routeMapKey` (§ER3.8) ⇒ the same
   `Map<edgeId, {d, hitD, routeClass}>`, byte-identical, regardless of browser,
   node/edge input order, or whether it was reached incrementally or by a cold
   full recompute (§ER3.9). Includes the `fallback-lz` / `self-loop` /
   `same-side` / `degenerate` classes.
4. **Endpoints honoured.** The route begins at the source handle and ends at
   the target handle, along each handle's `Position` normal. Fan-out offsets the
   stub, not the attach point.
5. **Never fails to draw.** A boxed-in pair, a `MAX_EXPANSIONS` hit, or a
   post-round padding intrusion falls back to a deterministic L/Z
   (`routeClass: "fallback-lz"`, may overlap) rather than dropping the edge.
6. **Bézier parity.** `route` absent ⇒ the emitted `path` is exactly
   `getBezierPath(...)`; switching an edge to orthogonal and back leaves the
   edge, the GraphDoc bytes, and the `loop-revision/*` digest exactly as a
   never-routed edge (§ER5.1).

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
| **ER-D5** | router constants | **Decided as fixed values** in §ER3.1 (`ROUTE_PAD 12`, `ROUTE_STUB 16`, `BEND_COST 20`, `PARALLEL_GAP 10`, `CORNER_R 6`, `SELF_LOOP 28`, `COORD_EPS 1e-3`, `PATH_DECIMALS 2`, `MAX_EXPANSIONS 20000`, `MAX_WAYPOINTS_PER_EDGE 64`). Not per-graph tunable. A change bumps `ROUTER_VERSION`, which is in the cache key. |
| **ER-D6** | cost / tie-break order | **Decided** — length → bends → backtrack → shared/crossing → geometry (flattened point list) → edge id; total, no residual ties (§ER3.4). |
| **ER-D7** | ruler generation + numeric normalisation | **Decided** — obstacle inflated edges + stub-end coords + wide-channel midpoints; quantise to `COORD_EPS`, sort, dedupe; float64 everywhere else, negatives/fractions fine (§ER3.3). |
| **ER-D8** | endpoint-node obstacle exception + stub length | **Decided** — the edge's own source/target nodes are not obstacles for it; a fixed `ROUTE_STUB` (16) perpendicular exit/entry, clamped shorter (never longer) if it lands in another obstacle (§ER3.2). |
| **ER-D9** | self-loop, same-side handles, fully blocked, overlapping obstacles, degenerate endpoints | **Decided** — deterministic non-A* routes for each (§ER3.6); obstacle set is a union of rectangles (§ER3.2). |
| **ER-D10** | zero-length segments + consecutive collinear points | **Decided** — dropped in the post-process pass within `COORD_EPS` (§ER3.5); the route is the minimal point list for its shape. |
| **ER-D11** | parallel-edge fan-out order | **Decided — by edge `id`** (string compare), so it is independent of insertion / paint order; the set includes reversed pairs (§ER3.7). |
| **ER-D12** | recompute triggers + cache key | **Decided** — the canonical `routeMapKey` in §ER3.8; never zoom / pan / hover / select / focus / theme / sim / animation; a previous route is **not** an input. |
| **ER-D13** | manual-waypoint contract | **Decided** — §ER4: world-space finite `{x,y}`, user order, endpoints excluded, auto-fill between, fixed on node move, in-obstacle ⇒ `invalid` cue + fallback (value kept), Reset clears waypoints only, one undo entry per add/move/delete/Reset, cosmetic revision content, no engine effect. |
| **ER-D14** | mobile | **Decided — render the file's route as-authored;** no route-editing handles. |
| **ER-D15** | pixel matrix | **Decided** — the Visual Refresh matrix fixture stays bézier; add a **separate** small orthogonal-route fixture with its own committed frames. |
| **ER-D16** | canonical form of default Bézier | **Decided (§ER5.1)** — `route` absent = Bézier; writer never emits `"bezier"` or `waypoints: []`; reader normalises explicit `"bezier"` → absent and drops a stray `waypoints`; switch → Bézier removes **both** fields; `waypoints` valid only with `route: "orthogonal"`. Explicit-Bézier-with-waypoint-preservation is a **separate** amendment if ever wanted. |
| **ER-D17** | waypoint defensive limits | **Decided (§ER4-DR)** — `MAX_WAYPOINTS_PER_EDGE = 64`; over-length / non-object / non-finite / bad `route` / `waypoints`-without-orthogonal ⇒ **drop the routing payload only + one warning**, keep the edge and every semantic field; `-0 → 0`; wire coords kept at full `Number` precision (only the derived path gets `PATH_DECIMALS`); duplicate / collinear waypoints **preserved on the wire**, stripped only from the derived path. |
| **ER-D18** | global reroute atomicity | **Decided (§ER3.9)** — any `routeMapKey` change recomputes **all** `orthogonal` edges in ascending edge-id order in one pass, then swaps the full route map in atomically. A render never mixes an edge's stale route with another's fresh one; incremental == cold full recompute. |
| **ER-D19** | numeric & failure normalisation | **Decided (§ER3.5 / ER3.6)** — `q(v)` round-half-**away-from-zero** (symmetric about 0), `-0 → 0` on every write/compare, `<`-tie → smaller signed value then `x` then `y` then edge id, a final post-round padding re-check (nudge once, else L/Z), `MAX_EXPANSIONS` / re-check failure ⇒ `routeClass: "fallback-lz"` (deterministic L/Z, same `d` for same input), one dev `console.warn` per edge id per session. |
| **ER-D20** | `routeClass` on the edge | **Decided** — `orthogonal` / `self-loop` / `same-side` / `fallback-lz` / `degenerate` exposed as `data-route-class` for the E2E; **not** stored in the GraphDoc. |

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
   collinear path points yields the minimal point list (assert point count);
   a `-0` node position and its `+0` twin produce the **same** `d`.
9a. **Atomicity** (§ER3.9) — move one node; the resulting route map equals a
    cold full recompute from the same `routeMapKey`, for **every** orthogonal
    edge (not just incident ones). No render frame shows a mixed old/new map.
9b. **`fallback-lz` determinism** — the boxed-in / `MAX_EXPANSIONS` fixture's
    `d` and `edge-interaction` `d` are byte-identical across two loads and with
    inputs reversed; `data-route-class="fallback-lz"`.

**Wire / canonical form**
10. **Default round-trip** — set an edge to `orthogonal`, then back to
    `Curved`; `edge.data` has **no** `route` and **no** `waypoints`; the
    serialized GraphDoc and the `loop-revision/*` digest equal the pre-edit
    bytes exactly (ER-D16).
11. **Writer** never emits `route: "bezier"` or `waypoints: []`; a file
    containing an explicit `route: "bezier"` reads back with the field absent;
    a file with `waypoints` but `route ≠ "orthogonal"` reads back with
    `waypoints` dropped + a warning (ER-D16 / §ER4-DR).
12. **Defensive read** — a file with a 5000-entry `waypoints`, or a non-object
    entry, or a `NaN` coord: the routing payload is dropped with **one**
    warning; the edge, its `source` / `target` / handles / `flow` / `kind` are
    intact; import still succeeds (ER-D17).
13. **Precision** — an accepted `waypoints` coordinate round-trips
    `Import → Export` **byte-identical** (no `PATH_DECIMALS` on the wire);
    duplicate / collinear waypoints survive the round-trip and render the same
    path as the deduped list.

**Parallel edges**
14. K = 3 edges between one ordered pair ⇒ 3 distinct routes, none overlapping
    along their shared span; swapping two of the three edge ids swaps their
    offsets (order is by id, not array position); a reversed `B→A` sibling
    shares the fan-out set.

**Waypoints (Slice 2)**
15. Add / move / delete / Reset are one undo entry each; `waypoints` appears in
    the three-way diff as a **cosmetic** change and never sets
    `engineAffecting` / `advisoryAffecting`. A **divergent conflict** on it is
    still counted in `nConf` (`SEMANTICS-R3.md` §ER6 — revision conflicts to
    resolve before a whole Apply, exactly like a `label` rename), so a whole
    Apply cannot silently discard the user's manual routing.
16. A waypoint dragged inside a node shows the `invalid` edge cue, the value is
    kept, and the affected span uses the fallback; dragging it out clears the
    cue. Moving a node leaves the waypoints fixed and re-routes the spans.
17. `loop-workspace/1` round-trip: step, Export a Workspace, re-Import — the
    `route` / `waypoints` come from the GraphDoc (not `SimState`), the run
    state restores, nothing about routing is in the workspace payload.

**Accessibility / platform**
18. `forced-colors: active` and `prefers-reduced-motion: reduce` — a mode
    switch is instant (no path-morph); solid-vs-dashed + the direction marker
    survive; the fat hit path follows the route.
19. Mobile: a file with an orthogonal edge renders that route; no
    route-editing handles; no horizontal document scroll.
20. Perf guard: a fixture above `MAX_EXPANSIONS` falls back to L/Z, logs once,
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

---

## ER14. The guarded router (issue #344 step 2, v0.25.0)

Diagram Readability (`docs/diagram-layout.md`) makes the orthogonal route the
default for new and migrated connections and replaces the router behind
`route: "orthogonal"` with a guarded one. The wire contract of §ER6 is
unchanged: `route` absent is still a Bézier, `waypoints` are still meaningful
only with `orthogonal`.

### ER14.1 Route meaning and the migration

- `route` absent = Bézier, everywhere, as before. Nothing reinterprets it.
- A revision or proposal payload keeps its bytes, its digests AND its drawing:
  an absent `route` there is drawn as a Bézier.
- The layout migration of an ordinary pre-grid document (`layoutVersion` < 1:
  a graph file, a Workspace, a share link, the autosave without a Project
  header — §DL2.8) writes `route: "orthogonal"` on every connection without a
  `route`. Its full content digest changes; its engine digest does not. Tidy to
  grid never writes a route.
- A new connection is created with `route: "orthogonal"`.
- `orthogonal` without `waypoints` = **Auto** (the guarded route);
  with `waypoints` = **Manual** (routed through them).
- Bundled Templates and modules are not migrated; step 4 re-places them.

### ER14.2 No node fill is ever crossed

`computeGuardedRoute` (`orthogonalRoute.ts`) runs the §ER3 search with:

- **own end nodes as obstacles** — a route leaves its port along the port
  normal to a stub `ROUTE_STUB` beyond its own box (shorter, half the gap, when
  another node is nearer) and enters its target the same way; only those two
  stubs may run inside the connection's own nodes;
- **the clearance ladder** `GUARD_PADS` (12, 6, 2, 0 px) — a failed search is
  retried with less clearance (`routeClass` `tight` below 12);
- **the outer corridor** — then rulers `OUTER_MARGIN` outside the bounding box
  of every node, both stubs and every waypoint, with a larger budget (`outer`);
- **`blocked`** — the one case no route can avoid: another node covers a port
  or a stub. The route avoids every node except the covering one.

Every candidate is checked before it is returned: between the stubs no segment
enters a node fill (own end nodes included), and the stubs enter no other node.
There is no cost-based crossing and no plain L / Z: a route that would cross is
never drawn. A waypoint inside a node fill keeps its value and the §ER4 cue but
is not routed through. The v1 entry point `computeOrthogonalRoute` stays as the
pinned single-edge core (golden + differential tests); the app no longer calls it.

### ER14.3 Shared trunks and labels

- Edges are routed in id order. Each placed route's segments are indexed by
  ruler line; an **unrelated** edge (sharing neither its source port nor its
  target port) pays `TRUNK_COST` per px it runs along one and `CROSS_COST` per
  crossing. The result never depends on input order.
- **A port fan** (Lumi, 2026-10-09): connections of exactly the same port share
  only that port's stub, `ROUTE_STUB` (16 px) beyond the node box, in the same
  direction; past it there is no line-on-line overlap at all.
  - Each member gets its own **branch point** inside the stub. The members are
    sorted by where their far end lies across the stub, then by edge id;
    members on the negative side leave toward it, members on the positive side
    toward that one, at most one (the lowest id among those level with the
    port) goes straight on, and other level members alternate sides. Within a
    side the member reaching furthest out branches nearest the node, so
    siblings never cross; members on opposite sides may share an offset. The
    offsets split the 16 px evenly. The router fixes the first move after the
    branch (and, at a target fan, the move into it).
  - Every end's stub and every branch's first leg are **reserved** before any
    route: another route pays `FAN_COST` per px to run along them (a route's
    own ports' stubs excepted), so neither a later sibling nor an earlier
    unrelated route takes them. Past the branch, running along a sibling also
    costs `FAN_COST`, and the sibling's lines ± `PARALLEL_GAP` are offered as
    lanes.
  - If obstacles block a branch, the route is found without it, drawn on the
    outer corridor when needed, and listed in `routeDiagnostics().fanBlocked`;
    `fanOverlaps` lists any pair that still runs together past the stub. Both
    are reported, never hidden.
  - No label sits on a shared stub. A selected connection's underlay runs
    alone from its branch on. A parallel set (the same two ports) keeps its own
    offset (§ER3.7).
  - Measured (every connection routed): Early MMO 0 fan overlaps (a port with
    17 connections included), the 3-zone gacha 0; 0 `fanBlocked`.
- The judge (survey and collision check) keeps the same-port trunk as an
  informational count; unrelated line-on-line overlap is a failure.
- A label takes the first free slot on its own route — the midpoint, then 0.4,
  0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8 of its length — clear of every node box
  (2 px margin) and every label already placed; the midpoint when none is free.
- Then up to `LABEL_ROUNDS` (2) guarded rounds: an edge whose route runs
  through other edges' labels is routed again with those labels as soft
  obstacles (`computeSoftReroute`: one rung of `SOFT_PADS` — 12, then 6 px —
  per step, each with the budget `SOFT_EXPANSIONS`), kept only when it crosses
  fewer of them and is not a lower rung; otherwise the edge keeps its route.
- Label sizes are the labels' REST sizes (shown, not selected, no run value),
  reported by the rendered labels; the last known size stays while a label is
  hidden by zoom. A run, a selection or a zoom never moves a route.

### ER14.4 Failures are reported, never hidden

`routeDiagnostics()` returns, for the last full generation, how many routes each
rung produced and every edge drawn `outer` or `blocked`; the collision check of
step 6 reads it. In a development build each such edge is warned once.

### ER14.5 Cost: a provisional map at once, the full generation in slices

Lumi, 2026-10-09: no pause at the drop, no long main-thread task.

- A map is cached on the layout signature (§ER3.8, label sizes included).
- A layout change shows a **provisional** map at once: the last full generation
  with only the routes the change touches routed again — new or changed edges,
  edges incident to a moved or resized node, edges whose route now runs into a
  moved node — incident ones first, within `PROVISIONAL_MS` (5 ms, budgeted by
  the longest route so far; an edge with no route at all is always routed).
- The **full generation** for the new layout then runs as a job, in id order,
  in slices of about `SLICE_MS` (8 ms; a step is started only when the longest
  step so far still fits), each slice its own task, so input and frames run in
  between. A single search is itself a step sequence: the A* search pauses
  every `SEARCH_SLICE` (1,024) expansions, so no step is longer than a slice;
  the synchronous router drains the same steps, so its result is unchanged. It is committed in one swap when complete; a partial map is never
  drawn. A newer layout, or a drag starting, cancels a running job; a cancelled
  job never commits. Diagnostics and development warnings are settled on the
  committed generation only.
- During a node, selection or frame drag (`beginLiveLayout` … `endLiveLayout`)
  only provisional maps are shown; the drop starts the job.
- **A cold start** (a document opened, or another document: most routed edges
  new) runs the same sliced job. Until it commits, no routed edge and no label
  of one is drawn — never a temporary path; only an invisible, off-canvas copy
  of each label is rendered so its rest size reaches the router first. The
  canvas carries `aria-busy` while any routed edge waits. The last
  `GENERATIONS_KEPT` (4) committed generations are kept by signature, so a
  layout seen again (undo, redo, the same document reopened) is shown at once;
  a newer document cancels the job.
- Only a run without a task scheduler (unit tests, the offline judge) computes
  the full generation at once — the same steps, so the committed map is
  byte-identical to the synchronous one (`__syncFullGeneration`).
- Acceptance (Lumi's criteria; Early MMO, every connection routed):
  - production build: drag p95 16.8 ms (≤ 20), max frame 17.4 ms, 0 long tasks
    during the drag and the drop; the 3-zone gacha 16.9 ms, 0;
  - routing-owned work (development build, where it is instrumented): the
    largest slice 6.9 ms on the cold load and 10 ms at the drop, the longest
    step 6.9 ms, the provisional map at most 6 ms (≤ 10); no routing task of
    50 ms or more;
  - the committed map equals the synchronous generation byte for byte; 0
    cancelled generations committed.
  - Not routing: the document mount (~145 ms in production) and the node press
    (51–100 ms on a development build) are long tasks with no routing at all
    (the curves-only control shows them too). Out of scope for #344.

### ER14.6 Invariants that change

- ER-INV-5 "never fails to draw" now draws without crossing: the L / Z fallback
  is replaced by the ladder, the outer corridor and `blocked`.
- ER-INV-6 Bézier parity still holds for `route` absent.
- ER-INV-3 holds at rest; during a live gesture the map is incremental by design.

## ER15. Curved and Straight connections (issue #344 step 3, v0.25.0)

`SEMANTICS-R10.md` adds `route: "straight"`. The four shapes and their stored
form are in §R10-0; `docs/diagram-layout.md` §DL4 is the product rule.

- **Straight** is drawn as one straight segment between the two port anchors
  React Flow gives the edge (`M sx,sy L tx,ty`). **Curved** is unchanged: React
  Flow's Bézier, byte for byte (ER-INV-6).
- Neither is routed: the user chose to give up obstacle avoidance. A Curved or
  Straight connection never changes any route (the router does not see it).
- **Their labels are placed**, not left at the middle. The route map samples
  each line from its own port anchors (`freeLine.ts`: the straight segment, or
  the Bézier with React Flow's control points, 24 segments) and gives the label
  the first slot of `LABEL_SLOTS` that is clear of every node, every label
  already placed and every other line (routed, Curved or Straight); failing
  that, clear of nodes and labels; the middle last — the same rule as a routed
  label (§ER14.3).
- Order: the routed labels first, exactly as before (they also keep off Curved
  and Straight lines), then the Curved and Straight labels in id order. A
  document with only orthogonal connections gets a byte-identical generation.
- A slot is stored as a fraction of the line's length; `LoopEdge` puts the
  label at that fraction of the line it draws, so the label sits on the drawn
  curve even where React Flow's anchors differ from the map's by a pixel.
- A label whose slot is not known yet (its size not measured, or the first
  generation of a document still running) is rendered hidden and measured,
  never shown in a temporary place; the canvas is `aria-busy` while a measured
  label waits (§ER14.5). The provisional map re-places only the labels of the
  Curved and Straight edges that are new, changed or incident to a moved node.

### ER15.1 Records keep their recorded label places (Lumi, 2026-10-10)

- A revision or proposal whose header declares semantics before
  `loop-revision/10` (no `semantics` key, or an earlier one — `SEMANTICS-R10.md`
  §R10-6; the edges are never inspected for this) opens with `recordLabels`:
  its Curved labels sit at the
  Bézier middle, where they were when it was recorded, and the route map places
  no Curved / Straight label and keeps no label off their lines — so the routed
  edges get the generation they had before step 3. A record's Review, which is
  drawn on that same canvas, keeps its visual reference too.
- Ordinary documents, Templates, share links and `/10` records use the free
  slots of §ER15.
- The first shape or bend-point edit, or Tidy to grid (even on a record
  already on the grid), ends the rule for that document, inside the same undo
  entry: undoing it brings the record's label places back.
- The autosaved Project header carries the rule as `labelLayoutVersion` (0 the
  record's, 1 current; absent in an older header reads as 0), so a reload
  restores it. An ordinary document has no Project header and follows the
  layout migration contract; `layoutVersion` means the layout migration only.

## ER16. Shapes and bend points in the editor (issue #344 step 3, v0.25.0)

### ER16.1 The Inspector

- **Route**: Orthogonal / Curved / Straight. Under Orthogonal it says
  *Automatic route* or, with bend points, *Manual route*.
- **Add bend** (a toggle) and, for a Manual route, **Reset to automatic**
  (keeps `orthogonal`, drops every bend point).
- Switching to Curved or Straight drops the bend points (R10-INV-3). Changing a
  connection's kind (resource / state) keeps its shape and bend points.
- Under the edit lock the select and the buttons are disabled by the
  Inspector's fieldset; on the phone the select is read-only (the sheet's
  fieldset) and the bend tools are not rendered at all.

### ER16.2 Editing on the canvas

- **Add bend**: armed for the selected connection. The next click on its line
  inserts one bend point on the segment clicked (`bendAtClick`), snapped to
  the 16 px grid ALONG that segment and kept on its line across it (Alt: at
  the click) — so adding a bend moves nothing; a port row is off the grid and
  a full snap would make the route jog. **Enter** inserts one in the middle of
  the longest editable segment (between the two stub ends; equal lengths: the
  one nearer the start; a refused point gives way to the next segment —
  `keyboardBend`) and moves the focus to its handle. Either goes into the
  span it lies on (`bendInsertIndex`), is one undo entry, makes an Auto route
  Manual, and disarms. When no segment can take one, Enter changes nothing,
  stays armed, and says so in the canvas live region and under the hint.
  Escape, another selection, the edit lock and the phone layout disarm it.
- **Handles**: a selected Manual connection shows one handle per bend point
  (`RouteBends.tsx`, a button named "Bend point n of total"). A pointer drag
  moves it on the grid (Alt: free); the arrow keys move a focused handle one
  grid step, Shift four; Delete or Backspace removes it (the last one removed
  makes the route automatic again); Escape cancels the drag or key gesture in
  progress and puts the point back.
- **Refused**: a bend point dropped inside a node, or within `BEND_STUB_TOL`
  (8 px) of the connection's own port stub (the stretch from a port to
  `ROUTE_STUB` past its node's side), goes back where it was; nothing is
  adjusted and nothing is recorded. While it is over such a place the handle
  has a dashed border (the non-colour tell).
- **Undo**: adding, moving (one drag, or one held key gesture), removing,
  Reset and a shape change are one history entry each, never merged with the
  next edit; undoing or redoing one does not reset the run (R10-INV-2, the
  flow-colour rule). The Inspector says so in its restart note: the route,
  the bend points and the colour are drawing only.
- Changing a connection's kind (resource / state) keeps its shape and bend
  points; nothing else about a kind change is different.
- During a drag the route map shows provisional maps (`beginLiveLayout`); the
  drop starts the full generation.

### ER16.3 How a Manual route goes through its bend points

The route is the guarded route (§ER14) through the stub ends and every bend
point, in order, one search per span. A span after a bend point starts from
the way the route arrived there: leaving along it is free, turning is one
bend, and going straight back costs two — so a Manual route turns AT its bend
point instead of running up to it and folding back over itself (which
`simplify` would then hide, leaving the bend point off the drawn line). It is
a cost, not a ban: a span that has no other way still finds one. Auto routes
(one span) are unchanged.
