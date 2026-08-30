# Edge Routing (non-frozen — DRAFT)

**Status: DRAFT for review.** A **non-behavioral** rendering concern: how a
resource / state edge's *path* is drawn between two fixed endpoints. It does
**not** change `source` / `target` / handles, the engine, `R(t)`, state
semantics, or any `loop-*/N` wire contract. Carries no `loop-*/N` id; revised
freely (like `docs/visual-language.md` and `docs/mobile.md`). §ER11 is the
decision record; §ER12 the acceptance / E2E; §ER13 the scope boundary.

This is the **deferred** item from `docs/visual-language.md` §VL6 "Routing" —
the Canvas Visual Refresh (v0.6.0) fixed edge *class / direction / cues* and
left geometry on React Flow's Bézier path (`getBezierPath`). This doc pins down
what "orthogonal routing" means for Loop Studio before any implementation.

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
| **obstacle** | a node's DOM bounding box in flow coordinates, inflated by `ROUTE_MARGIN`. The route's own endpoints' nodes are *not* obstacles for that edge. |
| **channel** | the gap between two obstacles (or an obstacle and the canvas edge) a segment can run through. |
| **auto route** | a route with no manual waypoints — fully recomputed from the current node layout. |
| **pinned route** | a route with ≥ 1 manual waypoint — the manual points are fixed; auto routing only fills the gaps between them (or, per ER11-D4, is skipped entirely). |

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

## ER3. Auto-routing algorithm (candidate)

A grid-free, deterministic **orthogonal connector** in the family used by
diagram editors (yFiles / draw.io "orthogonal", GoJS `AvoidsNodes`):

1. **Inflate obstacles.** Every node box except the two this edge connects →
   inflate by `ROUTE_MARGIN` (proposal: 12 world px, one grid step).
2. **Rulers.** Collect the x-coordinates of every obstacle's left/right edges
   and the y-coordinates of every top/bottom edge, plus the two endpoint stub
   ends. These lines partition the plane into a sparse grid of rectangles
   (O(nodes²) cells worst case, tiny in practice).
3. **Search.** A* over the sparse grid graph (nodes = ruler intersections
   outside every inflated obstacle; edges = unobstructed unit moves along a
   ruler). Cost = manhattan distance + a **bend penalty** (each turn costs
   `BEND_COST`, proposal 20) so the route prefers few corners, + a small
   **centre-of-channel** bias so it doesn't hug a node.
4. **Simplify.** Merge colinear segments; drop a waypoint whose removal keeps
   the route obstacle-free.
5. **Fallback.** If no obstacle-free route exists (endpoints boxed in), route
   the direct 1- or 2-bend "L" / "Z" and let it overlap — never fail to draw an
   edge.

Determinism: ruler order, tie-breaks in A* (prefer the move that reduces the
larger axis distance, then lower coordinate), and the simplify pass are all
total orders. No RNG.

**Parallel-edge fan-out (ER3.1).** For the K edges sharing an ordered
`(source, sourceHandle, target, targetHandle)`, offset edge *i* by
`(i − (K−1)/2) × PARALLEL_GAP` (proposal 10 world px) perpendicular to the
first/last segment, applied to the stub and carried into the search as a shifted
start/end. Order is the edges' array order (stable, already the paint order).

**Recompute triggers (ER3.2).** Auto routes recompute when a **node moves /
resizes** or an obstacle set changes — *not* every frame, *not* on hover /
select / zoom / sim step. Memoize on `(endpoints, handlePositions, sorted
obstacle boxes, manual waypoints)`. A drag recomputes on `dragstop` (live
preview may use the cheap L/Z fallback while dragging).

---

## ER4. Manual waypoints ("handles")

- On a **selected** orthogonal edge, each segment shows a small mid-segment
  grab handle; dragging it creates / moves a **manual** waypoint, snapped to the
  `ROUTE_MARGIN` grid. A manual waypoint shows a draggable dot; `Delete` /
  right-click → "remove point" drops it; a context action "**Reset route**"
  clears all manual waypoints (back to auto).
- Manual waypoints are **ordered along the route** and constrained to keep
  segments axis-aligned (dragging a point moves the two incident segments as an
  orthogonal pair, draw.io-style).
- A pinned route still **rounds corners** and still **avoids the edge's own
  endpoint stubs** overlapping the node body.
- Manual waypoints are a **desktop editing** action. On mobile the edge renders
  along whatever route the file carries; no handles.

Open: whether auto-routing fills the gaps *between* consecutive manual
waypoints, or a pinned route is taken literally as the manual polyline
(§ER11-D4).

---

## ER5. Bézier compatibility & migration

- **Per-edge mode.** An edge is `bezier` (exactly today's `getBezierPath`
  output) or `orthogonal`. Nothing else about the edge changes.
- **Default is `bezier`.** Every existing graph, on load, renders
  **byte-identical** to before this feature (ER-INV-1). No auto-migration, no
  digest change, no undo entry on load.
- **Opt-in.** A user switches an edge to `orthogonal` via the Inspector (an
  edge "Route" field: `Curved` / `Orthogonal`) or a context action. This is a
  normal edit — one undo entry — and, *if* the mode is serialized (§ER6),
  marks the revision dirty.
- **A global default toggle** ("new edges are orthogonal") is a *possible*
  convenience, deferred — it must not retroactively change existing edges.
- **The direction marker, flow bead, reduced-motion cue, selection / focus /
  invalid rings, and the L2/L1/L0 behaviour are unchanged** — they already take
  the `path` string as input; an orthogonal `path` just has more segments.

---

## ER6. Serialization — the load-bearing decision

Three options; pick before implementing.

| option | what's stored | GraphDoc / digest impact | manual waypoints persist? |
|---|---|---|---|
| **A — nothing stored (pure view)** | nothing; every route recomputed each render | none — no schema change, `loop-revision/2` untouched, VL-INV holds trivially | **no** (a manual route is lost on reload) |
| **B — mode only** | `edge.data.route: 'bezier' \| 'orthogonal'` (absent ⇒ `'bezier'`) | a new **advisory-tagged** edge field in the `loop-revision/2` projection (like `resourceType`): projected + diffable, **not** engine-affecting. No new revision id if `loop-revision/2`'s `advisory` bucket can absorb it; otherwise a `loop-revision/2.1` amendment. | **no** (routes are auto within the chosen mode) |
| **C — mode + manual waypoints** | `route: 'orthogonal'` + `waypoints: [{x,y}, …]` (flow coords, or normalized offsets) | a real **engine-neutral but content** field set → almost certainly a **`loop-revision/3`** (new `FIELDS_BY_KIND` rows, canonical form for the point list, digest) and a decision on `loop-workspace` (probably still v1 — no SimState change) | **yes** |

**Recommendation for the first slice: option A**, auto-routing only —
zero schema/contract surface, ships fast, and proves the algorithm and the
visual result. Manual waypoints (and therefore B or C) become a **follow-up**
that owns whatever revision bump it needs. If Lumi wants persistence in the
first slice, **B** is the smaller step (mode is one advisory string; matches the
`resourceType` precedent exactly) and **C** is a genuine `loop-revision/3`
project.

Whichever is chosen, the invariant is: **a graph that has never had an edge
re-routed serializes and digests exactly as it does today** (ER-INV-1).

---

## ER7. Invariants (ER-INV)

1. **No change without an edit.** Loading, rendering, hovering, selecting,
   focusing, zooming, or running a graph never changes an edge's stored mode /
   waypoints, the GraphDoc bytes, its `loop-revision/*` digest, the undo/redo
   stacks, or the viewport. (Under option A there is nothing to change; under B
   / C the render path is read-only.)
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

- Route computation is **O(rulers²)** per edge in the worst case; rulers ≈
  2 × visible nodes. Memoized per edge on `(endpoints, handlePositions, sorted
  obstacle boxes, manual waypoints)`.
- Recompute only on `onNodesChange` where a `position` / `dimensions` actually
  changed (diff the box set), never on hover / select / zoom / sim tick.
- During a node drag, edges incident to the dragged node use the cheap L/Z
  fallback for the live preview and do the full A* once on `dragstop`.
- A hard cap (proposal: if `visible nodes > N` or an edge's search expands
  `> M` cells) falls back to L/Z for that edge, logged once — never a frame
  drop.

---

## ER11. Decisions & open questions

| id | question | leaning |
|---|---|---|
| **ER-D1** | orthogonal-only, or also 45°/rounded-orthogonal hybrids? | **orthogonal only** for v1. |
| **ER-D2** | serialization — A / B / C (§ER6)? | **A (nothing stored, auto-only)** for the first slice; manual waypoints + B or C as a scoped follow-up. **Open — Lumi decides.** |
| **ER-D3** | default mode for a *new* edge? | **`bezier`** (parity with today). A global "new edges orthogonal" toggle is deferred. |
| **ER-D4** | pinned route — auto-fill the gaps between manual waypoints, or take the manual polyline literally? | **auto-fill between** (draw.io behaviour) — but only relevant once manual waypoints land. **Open.** |
| **ER-D5** | `ROUTE_MARGIN` / `BEND_COST` / `PARALLEL_GAP` / corner `--radius` values | proposals in §ER3 / §ER9; **tune against the fixture during impl.** |
| **ER-D6** | do parallel edges also *label* differently (offset the flow chip)? | chip already sits at the route midpoint; fan-out moves it for free. No extra rule. |
| **ER-D7** | mobile — is a file's orthogonal route rendered on mobile, or coerced to bézier for the small screen? | **rendered as-authored** (routing is display-only there; coercing would misrepresent the file). |
| **ER-D8** | interaction with the Canvas Visual Refresh pixel matrix — new baselines, or is routing off in the matrix fixture? | the matrix fixture stays **bézier** (its edges are never re-routed); add a **separate** small orthogonal-route fixture + its own frames. |
| **ER-D9** | undo granularity for a waypoint drag | one undo entry per `dragstop`, coalesced like a node move. |

---

## ER12. Acceptance / E2E (sketch)

Machine-checkable, mirroring the Visual Refresh specs:

1. **Bézier parity** — load every `examples/**` graph, render, pan / zoom /
   run; the serialized GraphDoc + `loop-revision/*` digest + `canUndo` are
   byte-identical to before; every edge's `path` `d` equals
   `getBezierPath(...)`. (ER-INV-1 / -6.)
2. **Deterministic route** — a fixture with obstacles; switch an edge to
   orthogonal; the `path` `d` and the `edge-interaction` `d` are byte-identical
   across two renders and after a hover / select / zoom / sim step. (ER-INV-3.)
3. **Avoids nodes** — the route's segments do not intersect any inflated
   non-endpoint obstacle box (assert geometrically).
4. **Endpoints honoured** — first point == source handle, last == target
   handle, first/last segments axis-aligned along the handle `Position`.
   (ER-INV-4.)
5. **Parallel fan-out** — 3 edges between one pair ⇒ 3 distinct routes, none
   overlapping along their shared span.
6. **No semantic effect** — before/after switching modes and adding a
   waypoint: engine pool series, `R(t)` rows, state events, resource-type
   findings, Monte-Carlo digest all unchanged. (ER-INV-2.)
7. **Fallback** — box an edge's endpoints in; it still draws (an L/Z route),
   no crash, no dropped `path`.
8. **Reduced-motion / forced-colors** — a mode switch is instant (no
   animation); solid-vs-dashed + arrow tells survive; hit path follows the
   route.
9. **Mobile** — a file with an orthogonal edge renders that route on the
   mobile layout; no route-editing handles appear.
10. **Perf guard** — a fixture above the node cap falls back to L/Z without a
    dropped frame; the memo is not invalidated by hover / select / zoom.

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
