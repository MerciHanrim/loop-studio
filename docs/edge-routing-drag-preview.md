# Edge Routing — drag-time route preview (non-frozen design doc)

Status: **implemented (narrow PR) — this document is the contract for it;**
ship / no-ship of the preview is decided on the §DP8 numbers and recordings.
Companion to `docs/edge-routing.md` §ER3.9. Ids below use the prefix **DP**.

Decision context (2026-09-17): the drag-time performance defect and the
implementation/spec mismatch are confirmed. Hanrim approved *the direction* of
a temporary route preview during a node drag, on the condition that the
boundary between the preview and the canonical route map, the preview's
termination in every case, and the verification criteria are designed first.
The remaining 400–600 ms pause at drop stays recorded as a **separate defect**.
②-5 (narrow store selectors) stays deferred. Ship / no-ship of the preview will
be decided on numbers **and** screen recordings (§DP9), not on this document.

---

## DP0. Why

- `src/store/routeMap.ts` keys the route map on the identity of the `nodes` /
  `edges` arrays. During a drag, every pointer move goes through
  `onNodesChange` → `set({ nodes: applyNodeChanges(...) })`, so every move is a
  new identity and the **whole** map is rebuilt: measured 12 pointer moves →
  13 store updates → 13 route generations.
- One full rebuild costs 340–685 ms on `mmo-progression` (30 orthogonal edges,
  97 obstacles) and 336–401 ms on `gacha-banner-zones` (77 / 63). In production
  a real node drag on MMO runs at ≈ 2.5 fps; 95 % of the app JS is the router.
- `docs/edge-routing.md` §ER3.9 already prescribes: *"During an active node
  drag the preview uses the L/Z fallback (`routeClass fallback-lz`) for edges
  incident to the dragged node; the atomic full pass runs once on `dragstop`."*
  The implementation never did this. This document turns that sentence into a
  precise contract.

## DP1. Terms

| term | meaning |
|---|---|
| **canonical map** | the `Map<edgeId, RouteResult>` produced by `currentRouteMap(nodes, edges)` — §ER3.8/§ER3.9 semantics, unchanged by this design |
| **generation** | one full rebuild of the canonical map (`__routeGenCount` increments by 1) |
| **preview** | a UI-only state that exists from the first `dragging: true` position change until one of the terminations in §DP4; while it exists, no generation is built |
| **dragged set** | the node ids carried by `position` changes with `dragging: true` in the current gesture (a multi-select drag carries several) |
| **incident edge** | an orthogonal edge with `source` or `target` in the dragged set |
| **frozen generation** | the canonical map as it was when the preview started (identified by the `nodes` / `edges` array identities captured at that moment) |
| **preview route** | the deterministic L/Z route from the edge's *current* handle points, ignoring obstacles (§ER3.6 `lzRoute` geometry) |

## DP2. Scope and non-goals

In scope: the drag-time display of orthogonal edges, its state, its
termination, and how it is verified. Everything is render-layer: no `GraphDoc`
field, no digest, no wire format, no history entry, no autosave content changes.

Out of scope (tracked separately): the drop-time full rebuild cost (400–600 ms
on the two large templates — **separate defect**), router algorithm cost,
asynchronous routing, ②-5 narrow selectors, the unimplemented §ER3.4 cost keys
3–4, and the `fallback-lz` fragility under distant moves (see the router
investigation).

## DP3. The boundary between the preview and the canonical map

**DP3.1 The canonical map is untouched.** `currentRouteMap` keeps its identity
cache, its atomic swap and ER-INV-3 (*incremental trigger == cold recompute*).
The preview never writes into the map and is never an input to it (§ER3.8:
*never a previous route*).

**DP3.2 The preview is a separate store slice.** Proposed shape (in
`graphStore`, UI-only):

```
dragPreview: null | {
  nodeIds: ReadonlySet<string>                 // the dragged set
  frozenMap: ReadonlyMap<string, RouteResult>  // the canonical map OBJECT captured when the preview began
  baseEdges: LoopEdge[]                        // the `edges` array identity when the preview began (DP4: any change ends the preview)
}
```

- `frozenMap` is the value returned by `currentRouteMap(nodes, edges)` for
  the arrays **as they are before the first `dragging: true` change is
  applied**. In the expected case the render before the gesture already built
  that map, the call is a cache hit and the capture is O(1). This is an
  expectation, not a guarantee: if the single cache entry does not hold that
  key at that moment (a dev-bridge read with other arrays evicted it, or a
  document change and the first drag change land before any render), the
  capture call **rebuilds once, synchronously, at the start of the segment**.
  That cost lands on the first pointer move that moves the node, and is exactly
  what gate T1b (§DP7) measures; it counts as the segment's optional start generation in
  DP-INV-4. No other fallback (e.g. skipping the preview) is proposed: a
  start-time miss must show up in the numbers, not be hidden.
- **The click before the drag.** React Flow emits a `select` change on the
  mousedown, and `applyNodeChanges` returns a **new** `nodes` array for it.
  With the identity-only cache that meant a full rebuild on every click,
  before any drag (measured: `select` → generation +1, then the drop → +1).
  `currentRouteMap` therefore now reuses the generation when the **layout
  signature** (node ids, positions, measured sizes; orthogonal edge ids,
  endpoints, handles, waypoints) is unchanged and only the identity moved —
  the §ER3.8 key, applied. The signature is a structured (JSON) serialisation,
  never delimiter-joined text: ids are user data and may contain any
  character, so two different layouts must never produce the same key (pinned
  by a regression test with an id that reproduces the delimiter collision). A real move, resize, route toggle or waypoint edit
  still rebuilds. This is what makes the warm-cache start the expected case
  and keeps T1b a measurement of the preview, not of the click.
- **Why the map object and not the array identities:** `currentRouteMap`
  keeps **one** cache entry (the last key). Its callers are `LoopEdge` and the
  dev bridge `window.__loop.routeMap.get(id)` (`src/main.tsx`), which calls it
  with the **live** arrays. Re-asking the cache with the captured arrays would
  therefore not be a guaranteed hit: any call with another key in between —
  an e2e reading the bridge mid-gesture, or a future caller — would evict the
  entry and the next `LoopEdge` render would rebuild the whole map from the
  stale arrays (one wasted generation, then another for the live arrays).
  Holding the map object removes that dependency on cache state entirely.
- Not serialised: `serialize()` is an explicit allowlist over `nodes` / `edges`
  / config, so a new store field cannot leak into a file, the autosave record,
  a share link or a revision digest (DP-INV-3 is checked by a test, not assumed).
- Not part of a history entry: `commit('move')` snapshots `nodes` / `edges` /
  `modelVersion` / sidecar only. Undo / redo clear the preview (§DP4).

**DP3.3 What each edge draws** (`LoopEdge`, per render):

| condition | route used | marker |
|---|---|---|
| no preview | `currentRouteMap(nodes, edges).get(id)` — canonical, rebuilt once when the identity changed | as today |
| preview, edge incident to the dragged set | **preview route** from the RF-supplied `sourceX/Y`, `targetX/Y` and positions of this render (they follow the pointer every frame) | `data-route-class="preview-lz"`, class `route-preview` (visual cue: DP-D1) |
| preview, edge not incident | `preview.frozenMap.get(id)` — a Map lookup, no cache involved, no rebuild | as today (`route-orthogonal` …) |
| preview, edge not in `frozenMap` (defensive only — §DP4 ends the preview on any edge change, so this should be unreachable) | preview route | `preview-lz` |

While a preview is active `LoopEdge` does **not** call `currentRouteMap` at
all. `routeMap.ts` is unchanged: no second cache, no freeze flag, the cache key
still contains only the layout inputs.

**DP3.4 Generations per preview segment — expectation vs hard bound.** A
*preview segment* runs from a preview's creation to its termination (§DP4).
Within a segment no `LoopEdge` render asks the cache, so `LoopEdge` causes no
rebuild per move. On termination the preview is cleared in the **same** store
update that carries the final `nodes`, so the next render asks for the live
identity once → one generation, atomically swapped in for every edge (§ER3.9
steps 1–3).

- **Hard bound (every path):** per pointer move **after the first** **0**
  generations (the first move of a segment may carry the start-time cache-miss
  generation, §DP3.2); per segment **≤ 2** — at most one at start (cache miss)
  and at most one at termination. A segment that terminates before any render committed (e.g. a
  press-and-release with no movement, where `dragging: true` and
  `dragging: false` arrive in the same tick) produces **≤ 1** (the
  termination render only).
- **Expectation for a real drag (what the harness measures):** exactly **1**
  generation, at termination, and **0** at start — a start-time miss is
  reported as a T1b failure, not silently absorbed.

A pointer gesture is one segment **unless** an edge change (§DP4) or a focus
loss (§DP4.1) ends the preview mid-gesture; the gesture then continues as a
new segment with its own bound. The performance gates (§DP7) are measured on
gestures without such events; the termination tests (§DP10) assert the hard
bound for the split cases.

Other callers of `currentRouteMap` (today: the dev bridge) can still rebuild
with the live arrays during a segment; that is a dev-only read path and is
handled by DP-D7 (the bridge serves `frozenMap` while a preview is active).

**DP3.5 Stubs, fan-out, waypoints in the preview route.** The preview route is
the L/Z of `lzRoute(src, tgt, sourcePosition)` with the same parallel fan
offset as the canonical route (§ER3.7) so parallel edges do not collapse onto
one line; manual waypoints are **not** honoured in the preview (they are
restored by the drop-time generation); `invalidWaypoint` is not evaluated in
the preview.

## DP4. Preview lifecycle and termination — every path

React Flow / d3-drag facts verified in `@xyflow/system` and `d3-drag`: a drag
ends only on window-level `mouseup`, `touchend` or `touchcancel`; `Escape` does
not cancel a drag; a window `blur` or a hidden tab does **not** end it, so no
`dragging: false` arrives until the next pointer release.

| event | preview | canonical map |
|---|---|---|
| **start** — first `onNodesChange` with a `position` change carrying `dragging: true` while `dragPreview === null` | created with `nodeIds` = ids of those changes, `frozenMap` = `currentRouteMap(nodes, edges)` evaluated on the arrays **before** this change is applied, `baseEdges` = the `edges` identity at that moment | expected: cache hit, no generation; cache miss: one synchronous generation at start (§DP3.2, T1b) |
| **move** — further `dragging: true` position changes | `nodeIds` ∪= ids in the change (multi-select), `frozenMap` / `baseEdges` unchanged | none |
| **`select` changes** (React Flow selects the pressed node; may arrive alone or with a move) | neutral — never touch geometry, so the preview is kept as it is | none |
| **normal drop** — `position` change with `dragging: false` (this is also what React Flow emits after a `touchcancel`, which d3-drag handles like a release) | cleared **in the same `set` as the final nodes**; the move-history tag is closed here (existing behaviour) | one generation on the next render, == cold load (DP-INV-2) |
| **window `blur`, `visibilitychange` → hidden, `pointercancel` on the document** (no `dragging: false` will arrive) | cleared by an app listener (graphStore, same pattern as the autosave `pagehide` flush) **and** the move-history tag is closed — see §DP4.1 | one generation on the next render from the nodes as they are; a resumed gesture is a new segment (§DP4.1) |
| **node removed during the gesture** (`remove` change, or any change that leaves a dragged id absent from `nodes`) | cleared | one generation |
| **document replaced** — `loadDoc`, `loadJSON`, `newGraph`, undo, redo, revision Apply / Open-as-document, share link, template load, data-import insert / refresh, module insert / extract | cleared in the same update (central rule: **any `nodes` replacement that is not a `dragging: true` position change clears the preview**; plus explicit clears in `loadDoc` / `newGraph` / `undo` / `redo` for readability) | one generation |
| **any `edges` replacement during the gesture** — connect, edge delete, an edge's `data` change (route toggle, waypoint edit, kind / flow edits), edge reconnect | **cleared** (narrow rule: the frozen map was built for the old edge set / edge data and would draw a stale route under a changed edge of the same id) | one generation from the live arrays; the next `dragging: true` move starts a new segment |

**Ownership rule (one terminator per outcome).** The final node position and
the closing of the move-history tag are owned by the `dragging: false` change
**whenever it arrives** — React Flow / d3-drag emit it on window-level
`mouseup`, `touchend` and `touchcancel`. The app listeners (`blur`, hidden,
`pointercancel` — events d3-drag does not listen to) own termination **only
when no `dragging: false` will arrive**; they clear the preview and close the
tag without touching positions. Both terminators are idempotent on an
already-cleared preview, so the order "app listener, then a late
`dragging: false`" clears once and yields at most the generations of the
segments actually opened (a late `dragging: false` with no preview open is a
no-op for the preview, and still closes the tag as today). The termination
tests (§DP10) dispatch both in sequence and assert no double generation.

Guard against a stuck preview (belt and braces): `LoopEdge` treats a preview
whose `nodeIds` are not all present in the current `nodes`, or whose
`baseEdges` is not the current `edges` identity, as inactive, and the store
clears such a preview on its next update (a module-level `subscribe` in
`graphStore.ts` enforces exactly this after every update). No timeout is
proposed (DP-D4).

**DP4.1 Focus loss and resumption — what "clear the preview" does and does not do.**

- Clearing the preview ends **our** display state only. It does **not** end
  React Flow's drag: d3-drag keeps its window listeners until the next
  window-level `mouseup` / `touchend` / `touchcancel`, and React Flow will keep
  emitting `dragging: true` position changes if the pointer is still held
  (or, if the release happened while the window was unfocused and was missed,
  until the next release anywhere — a **ghost drag**; this is pre-existing
  React Flow / d3-drag behaviour, unchanged by this design, DP-D8).
- Store side, on `blur` / hidden / `pointercancel` the same handler
  (`endDragPreview`) also **closes the move-history tag** (`lastTag = ''`, the
  same statement `onNodesChange` runs on `dragging: false`) — only when a
  preview was active, so an unrelated coalescing edit is not cut by a blur. Today that tag is closed only by
  a `dragging: false` change, undo / redo, or a document load; coalescing is
  otherwise bounded only by `COALESCE_MS` (600 ms). Closing it on focus loss
  makes the pre-blur part of the gesture one undo step deterministically.
- If the gesture resumes after focus returns, the next `dragging: true` change
  creates a **new segment**: a new preview (from the then-current arrays and
  the then-current canonical map, which the post-blur generation just built),
  and, because the tag was closed, a **new history entry** — a gesture
  interrupted by focus loss is up to two undo steps. This is accepted and
  stated here so the tests (§DP10 termination (a)) pin it rather than discover
  it.
- The eventual `dragging: false` of the resumed gesture terminates that second
  segment normally (one more generation, equal to a cold load).

## DP5. Invariants

- **DP-INV-1** The canonical map never reads the preview; the preview never
  reads a previous canonical route as an input (§ER3.8 kept).
- **DP-INV-2** After any termination, the next generation equals, byte for
  byte (`d`, `hitD`, `routeClass`, `invalidWaypoint`), a cold full recompute of
  the same document — the existing e2e "incremental == cold" cases extended to
  a real multi-move drag (§DP10).
- **DP-INV-3** The preview is never persisted: export / autosave record / share
  link / revision digest taken **during** a gesture are identical to those
  taken after the drop (positions aside), and contain no preview field.
- **DP-INV-4** **Zero** generations per pointer move **after the first move
  of a segment** (hard; the first move may carry the start-time cache-miss
  generation). Per preview segment **at most two** (hard: ≤ 1 at start on a cache miss, ≤ 1 at
  termination) and, for a real drag with a warm cache, **exactly one** at
  termination (expected, measured). A gesture is one segment unless an edge
  change or a focus loss splits it (§DP3.4, §DP4.1); the split cases are
  pinned by the termination tests, the gates measure unsplit gestures.
- **DP-INV-5** Every incident preview route starts at the source handle and
  ends at the target handle of the current frame (no detached lines).
- **DP-INV-6** Non-incident edges show exactly the frozen generation's route —
  a render never mixes two canonical generations; the only overlay is the
  incident preview.
- **DP-INV-7** A drop with no net movement (press and release without moving,
  or move back to the exact start) still terminates the preview and still
  yields a canonical map equal to a cold load (it may be the same generation
  object if the arrays are identical).

## DP6. What the preview explicitly does NOT guarantee (accepted scope)

These are the costs of the trade-off and must be judged in §DP9, not hidden:

1. **Incident preview routes may cross obstacles.** The L/Z ignores every node
   box; the marker `preview-lz` makes this visible to tests and styling.
2. **Frozen non-incident routes may be crossed by the dragged node(s).** They
   are not recomputed until drop.
3. **A snap at drop is expected** wherever the canonical route differs from the
   frozen or preview route. The investigation showed both small (≈ 5 px) and
   large (hundreds of px) canonical changes caused by a distant node's move;
   how often either happens in a real gesture is **not** known from the
   static per-node experiment and must be measured (§DP8.3).
4. **The drop pause remains** (one full rebuild, 400–600 ms on the large
   templates) — separate defect.

Nothing in this design claims obstacle avoidance during the gesture.

## DP7. Performance targets (realistic, derived from the no-router baseline)

Baseline already measured on this machine (production bundle, real node drag
verified, orthogonal routes stripped so only the re-render cost remains — the
preview cannot beat this because ②-5 is deferred):

| build / load | MMO frame p50 / p95 | gacha frame p50 / p95 | long tasks in the drag phase |
|---|---|---|---|
| prod, CPU ×1 | 16–19 / 32–37 ms | 17 / 25–28 ms | 0–1 (≤ 55 ms) |
| prod, CPU ×4 | 15–16 / 89–152 ms | 14–15 / 58–67 ms | 10–44 |

Targets for the preview (gates for a merge, measured as in §DP8):

- **T1 drag phase, CPU ×1:** frame p95 ≤ **40 ms** on MMO and ≤ **30 ms** on
  gacha; **0 long tasks** in the drag phase **after the first pointer move**.
- **T1b first-move pause, CPU ×1:** the long-task duration (0 if none) of the
  **first pointer move that actually changes a node's position** — the first one
  past React Flow's drag threshold — recorded as its own number and **included
  in the pass criteria**: ≤ **60 ms** on both graphs. Baseline: the no-router
  runs showed 0–1 long task of ≤ 55 ms at that move; the user feels this
  as the initial hitch, so it is not excluded from the verdict.

  The measurement point is stated this way because React Flow **arms** the drag
  threshold on one pointer move and applies motion from the **next** one: after
  the arming move the dragged node's `transform` is unchanged, so no route is
  recomputed and no edge re-renders. Measuring the literal first move of the
  gesture therefore reports a number containing none of the work T1b exists to
  bound. Which ordinal that turns out to be is not fixed by this document — the
  harness finds it (§DP8.2a) rather than assuming it is the second.

  This wording is a correction, not a change of target: **the 60 ms threshold
  and the per-run verdict of §DP8.4 are unchanged**, and every T1b figure
  recorded so far was already taken at this point.
- **T2 per-move JS:** app JS per pointer move ≤ baseline + 5 ms (the preview
  route is O(1) per incident edge; a frozen-generation lookup is a Map get).
- **T3 generations:** for the measured gestures exactly 1 per gesture (dev
  bridge `__routeGenCount`) and 0 per move after the first; the hard bound of DP-INV-4 (≤ 2
  per segment) is asserted by the termination tests, not by this gate.
- **T4 drop:** ≤ 1 long task, its duration **recorded** (expected 400–600 ms
  on MMO/gacha) and filed under the separate defect — not a gate here.
- **T5 CPU ×4:** report only; must not be worse than the ×4 no-router baseline
  by more than 20 % on p95.

## DP8. Measurement method (before / after, same machine, same session)

**DP8.1 Harness.** Reuse the scratch harness from the ②-5 measurement
(`scratchpad/audit/perf-2-7.spec.ts`, `perf-frames.js`, `perf-hook.js`):
production `vite preview` build, `recommendedRunConfig.canvasLocked` forced to
`false` in the imported document, and a run counts **only if** the dragged
node's own `style.transform` changed **and** the `.react-flow__viewport`
transform did not (a pan is discarded, not averaged). Graphs: `mmo-progression`
and `gacha-banner-zones`. Load: CPU ×1 (3 runs each) and CPU ×4 (2 runs each).
Record dragMs, frame p50/p95/max per phase, long tasks per phase, and, as its
own field, the long-task duration of the first pointer move that changes a
node's position (T1b — located and verified as in §DP8.2a).

**DP8.2 Generations.** In the dev build, `__routeGenCount()` before and after
one real pointer drag (`onNodesChange` instrumented as in the investigation
probe): expect +1 per gesture.

**DP8.2a Finding the T1b move, and proving it was found.** The harness must not
assume which pointer move of the gesture is the one T1b measures. It presses,
lets the page settle, then dispatches pointer moves **one at a time** and takes
the first whose dispatch changes the dragged node's `transform`. Each sample
records:

- `movingIndex` — which pointer move of the gesture that turned out to be;
- `priorMovesChecked` — how many moves preceded it;
- `priorAllStill` — that **every** one of those left the `transform` unchanged.

A sample where an earlier move already moved the node (`priorAllStill: false`),
or where no move changed it within the harness's bound, measured the wrong thing
and is **excluded and reported as not run** — never counted as a pass. The
run-level verdict is unchanged: per §DP8.4, one run over 60 ms fails the gate.

**DP8.3 Overlap and snap — measured, not extrapolated.** The static figure
"48 of 2,850 node/edge pairs" from the per-node experiment is **not** used to
estimate anything about a gesture. Instead, per run:

- *overlap:* on every rAF poll of the drag phase, take the dragged node's
  inflated box (its DOM box + `ROUTE_PAD`) and every non-incident orthogonal
  edge's current hit polyline (`path.edge-interaction` `d`); count polls with
  ≥ 1 crossing segment and the maximum number of crossed edges in a poll;
  report per run (MMO, gacha) — these numbers describe *this gesture path*
  only;
- *snap:* capture every orthogonal edge's `d` on the last poll before the
  drop and after the post-drop generation; report the number of edges whose
  `d` changed, and the maximum vertex displacement in px; per run. The one
  428 px case seen in the static experiment is a **possibility**, not a
  frequency — whether it appears in real gestures is what this measures.
- *recording:* `recordVideo` for each MMO/gacha ×1 run, kept next to the JSON,
  so the numbers and the screen are reviewed together (§DP9).

**DP8.4 Consistency.** The e2e cases in §DP10 run in the same PR CI; DP-INV-2
is byte equality, not a tolerance.

## DP9. Ship decision

Inputs: the §DP8 numbers before/after, the recordings, and the §DP10 test
results. The decision is Hanrim's. If overlap or snap is judged unacceptable
on the recordings even with T1–T3 met, the preview is **not shipped** and the
next work item becomes router cost reduction or asynchronous routing, designed
concretely before any implementation.

## DP10. Tests required before an implementation merges

Unit (`vitest`):
- preview route: same handle points + positions + fan offset ⇒ byte-identical
  `d` / `hitD`; starts and ends exactly on the handles; parallel edges keep
  distinct offsets.
- store: the preview is created only by a `dragging: true` position change;
  cleared by `dragging: false`, by any other `nodes` replacement, by `remove`,
  by `loadDoc` / `newGraph` / undo / redo; `nodeIds` accumulates a
  multi-select drag; a preview whose ids vanished is inactive.
- serialisation: `serialize()` output and the autosave record taken with an
  active preview contain no preview field and equal the no-preview output for
  the same `nodes` / `edges`.

Browser e2e (`playwright`, chromium):
- **post-drop equality:** a real pointer drag (≥ 10 `dragging: true` moves,
  then release) on the routing fixtures and on `mmo-progression`; every
  orthogonal edge's `d` / `hitD` after the drop == a cold import of the moved
  document; `__routeGenCount` +1 for the gesture (extends
  `edge-routing.spec.ts` "incremental move lands on the cold-load paths" and
  "one obstacle move … single atomic generation").
- **during the gesture:** incident edges carry `data-route-class="preview-lz"`
  and their first/last path points equal the moving handles on every sampled
  frame; non-incident edges keep the pre-drag `d` on every sampled frame; no
  edge ever shows a `d` from a generation other than the frozen one.
- **terminations:** (a) window `blur` mid-drag (dispatch `blur` /
  `visibilitychange` hidden) → preview attributes gone, one generation,
  equality with cold load, the move-history tag closed (a following
  `dragging: true` move creates a **new** undo entry and a new preview
  segment; its `dragging: false` yields one more generation, again equal to a
  cold load); (b) Delete of the dragged node mid-drag; (c) import of another
  document mid-drag; (d) undo mid-drag; (e) press-release with no move —
  asserts the DP-INV-4 hard bound (≤ 1 generation) rather than "exactly 1",
  and that the canonical map still equals a cold load; (g) a start-time cache
  miss forced with the dev bridge's `routeMap.reset()` right before the first
  move — asserts ≤ 2 generations for the segment (one at the first move, one
  at termination), 0 for the moves after the first, and that T1b reports the
  extra cost; (f)
  any edge change mid-drag — a `connect` creating an orthogonal edge, an edge
  delete, and an Inspector route toggle on an incident edge — → preview
  cleared, one generation from the live arrays, the resumed moves start a new
  segment, the final map equals a cold load.
- **dev bridge:** `window.__loop.routeMap.get(id)` read during a gesture
  returns the frozen route and does **not** change `__routeGenCount`
  (DP-D7); the generation-count assertions in the drag tests read the bridge
  mid-gesture on purpose to prove this.
- **first-move pause:** the harness reports T1b for every run, measured at the
  move §DP7 names and located as §DP8.2a requires; a run failing T1b fails the
  gate even when T1 passes, and a sample whose measurement point could not be
  verified is not run rather than passed.
- **persistence:** export and the autosave record taken mid-drag equal the
  post-drop ones apart from positions; no preview key.
- **performance gates** T1–T3 (§DP7) via the harness, with the "node actually
  moved" check, recorded in the PR body with the before/after table.
- **visual:** the §DP8.3 recordings attached to the PR for the §DP9 review.

## DP11. Decisions to take before implementation

| id | question | proposal |
|---|---|---|
| DP-D1 | visual cue for `preview-lz` edges | reuse the existing `route-fallback-lz` look (no new styling) so the review judges geometry, not a new style; a dashed cue can be added later if the recordings show the L/Z is mistaken for a final route |
| DP-D2 | record the `edges` identity in the preview | yes — `baseEdges` exists only to detect an edge change: any `edges` replacement during a segment **ends the preview** (§DP4); the "not in frozen map ⇒ preview route" row in §DP3.3 is defensive and should be unreachable |
| DP-D3 | where the blur / hidden listeners live | graphStore, next to the autosave `pagehide` / `visibilitychange` listeners, same registration pattern |
| DP-D4 | a timeout as a last-resort terminator | no — every termination path is event-driven; a timeout would make behaviour timing-dependent |
| DP-D5 | dragged node drawn above frozen routes | unchanged (React Flow's existing z-order); revisit only if the recordings show the frozen route hides the dragged node |
| DP-D6 | multi-select drag | supported by construction (`nodeIds` is a set); no special path |
| DP-D7 | dev bridge `routeMap.get` during a preview | serve `dragPreview.frozenMap.get(id)` while a preview is active so a mid-gesture read by a test never evicts the single-entry cache or adds a generation; `genCount` / `reset` unchanged |
| DP-D8 | should the app also end React Flow's drag on focus loss (e.g. toggling `nodesDraggable`, or dispatching a synthetic release)? | **no** in this change: the ghost-drag after a missed release is pre-existing React Flow / d3-drag behaviour and touching it widens the scope; the design only guarantees the preview's own termination and the history-tag close. Recorded as a follow-up candidate, not approved |

## DP12. Follow-ups kept separate

1. **Drop pause** — one full rebuild at termination, 400–600 ms on the large
   templates: separate defect; candidates are router cost reduction and
   asynchronous routing, each needing its own design and measured numbers.
2. **Router fragility** — a distant node's 24 px move can flip a 7-bend edge
   to `fallback-lz` (likely `MAX_EXPANSIONS`); separate item.
3. **§ER3.4 cost keys 3–4** are not implemented; the spec text should say so
   or the router should implement them — separate doc fix.
4. **②-5** narrow selectors — deferred until the preview decision.
