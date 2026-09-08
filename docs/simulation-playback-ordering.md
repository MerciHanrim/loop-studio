# Simulation Playback — ordered cascade & role cues (non-frozen design doc — DRAFT)

**Status: proposed.** A follow-up slice of
[`docs/simulation-playback.md`](simulation-playback.md) (the shipped v0.7.0
choreography). It **revises §PB2.1 / §PB2.6** — today every `FlowEvent` of a step
rides the *same* `τ`, so `supply → split → process → stock → ship` all depart and
arrive at the same instant and the pipeline reads as one simultaneous pulse.
Presentation-only: **no engine / RNG / state-semantics / GraphDoc /
`loop-revision/*` digest / Workspace change**, and `settle` stays one atomic
commit. Carries no `loop-*/N` id and is revised freely.

Sections: **§PBO1** the ordering source · **§PBO2** the staggered-τ model (bounded)
· **§PBO3** role cues · **§PBO4** reduced-motion / forced-colors · **§PBO5**
steady-state (designed here, **shipped in its own PR**) · **§PBO6** spec deltas ·
**§PBO7** invariants · **§PBO8** acceptance · **§PBO9** work order · **§PBO10**
decisions.

---

## PBO0. Why

Confirmed against `SEMANTICS.md` (§8 "Push before pull"; §10 contention/ordering;
I7) and `src/engine/step.ts` (`// Phase 1 push (Sources), then Phase 2 pull … one
forward walk of the router DAG in topological order`):

- a step's **values** are order-invariant (I7) and computed against `S(t)` — the
  *effect* is atomic; nothing physically "arrives then is consumed" in one step;
- a step's **events** are strictly, deterministically ordered — **Phase 1**
  (Source pushes) then **Phase 2** (topological walk of the router DAG,
  root → leaf; ascending-id tiebreak). `report.events` is emitted in that order;
- a full chain (`supply → vault → gate → conv → prod → consume`) resolves within
  **one** step, in that dependency order.

So the causal order already exists in the engine's own emission. The playback
layer discards it: `simStore` sums `report.events` into
`flowByEdge: { edgeId: amount }`, and one global `transition.tau` drives every
edge's token to the same travel fraction at the same time (§PB2.6, verbatim:
*"all run against the **same `τ`** — depart together, travel together, `settle`
together"*). The fix is to **stagger departure along the order the engine already
computed** — never to invent one.

## PBO1. The ordering source — `(phase, rank)`, not `originalEventIndex`

Playing `report.events` one-by-one in emission order is **rejected**: it
serialises genuinely-parallel sibling branches (e.g. a gate's *process* and
*scrap* outputs) and blows a wide step (MMO progression) far past the beat.

**Emission order alone is also rejected as the bucket order.** The engine's
Phase-2 walk is a Kahn sort of the *router → router* graph with an ascending-id
frontier tiebreak; a Drain whose input arrives through a Pool is indegree-0 in
that graph, so it is visited *early*. Verified trace of `examples/equilibrium.json`
at steady state — emission order is
`tpl-e1 (supply) → tpl-e6 (shipment) → tpl-e2 (split) → tpl-e3/e4 → tpl-e5`:
the shipment Drain's pull is emitted *second*. Bucketing by first appearance in
`report.events` would therefore read `supply → shipment → split → process`,
which fails §PBO11. Layered Kahn depth over the *router-only* graph has the same
defect (the shipment Drain is a root there too, tying `rank 1` with the split
gate).

**Rank — longest-predecessor depth over the FULL resource-edge condensation
DAG.** Pools are included in the graph, and the depth is the *longest* path from
a start node, not the shortest (a merge / short-circuit edge could otherwise rank
a node below its own upstream):

1. take the **full resource-edge digraph** — every `kind === "resource"` edge,
   Pools and all node kinds included (the same predicate `step.ts` uses for
   `resEdges`);
2. contract its **strongly connected components** (SCCs) — every feedback loop,
   which in this model always runs *through a Pool*, becomes one condensation
   node. The condensation graph **is** a DAG;
3. **longest-predecessor depth** on it: `depth(s) = 0` for every indegree-0
   condensation node (so a Source-less initial-stock → Drain graph, and every
   disconnected component, still gets a depth); otherwise
   `depth(v) = max(depth(pred) + 1)` over the topological order. Every
   condensation edge then points **strictly deeper** — the cascade can never run
   backward (PBO-D2);
4. bucket assignment:
   - **Phase-1** (an event whose `from` is a Source): the **Phase-1 bucket**,
     always first;
   - **Phase-2**: group by the SCC of the event's *routing node* (`from` for a
     push out of a router, `to` for a pull into one — §PBO10-D2). A routing
     node's bucket is ordered by `depth(its SCC)`.

**Events whose routing node falls in the same SCC share the same bucket** — the
animation shows a feedback cycle's edges moving together, never an invented order
inside the loop. A router's *pull in* and its *push out* also share its bucket
(one routing subject).

Rank is a **pure function of the step-start graph** (nodes + resource edges + the
push/pull split), computed in the playback layer — it adds **nothing** to
`FlowEvent`, `StepReport`, the Workspace sim-snapshot, or any digest. It is
computed **once**, from the graph **snapshot taken at the moment the transition
is prepared** (a graph edit mid-transition cancels playback — §PB7 — so the
snapshot is never stale during a run).

**Bucket.** Events are grouped into ordered buckets: the Phase-1 bucket first,
then one bucket per distinct Phase-2 routing-SCC, ordered by that SCC's
longest-predecessor depth (id-ascending tiebreak). Let `B` be the count of
non-empty buckets this step. Same bucket ⇒ **identical onset** (parallel
siblings, and every edge inside one SCC, move together). Only the depths that
actually occur are kept, then the list is compressed to consecutive indices and
clamped to `STAGGER_MAX_BUCKETS` (deeper ranks fold into the last bucket).

**PBO1.1 — the stagger is a visual narration, not a physical route.** Every value
is computed **atomically against `S(t)`** (I7) — Phase-2 processing consumes what
was in a Pool at the *committed* state, not what a Phase-1 push just delivered
this step. The staggered onset therefore expresses only the engine's **execution
phase and the left-to-right reading direction of the graph** — it does **not**
claim that one unit of resource traversed the whole pipeline in a single step.
Concretely: a token on edge A and a token on the downstream edge B are **separate
cues with their own depart/travel/arrive** — B's departure is offset by rank,
but B does **not** start where A's token arrived and the two must never visually
join into one continuous moving object (no shared path, no hand-off dot, a
visible gap in time and space between A's `arrive` cue and B's `emit` cue).

## PBO2. The staggered-τ model — bounded, `settle` unchanged

One transition, one wall clock, unchanged total duration `beatDuration()`
(speed-controlled, `Math.max(speedMs, PLAYBACK_MIN_MS)`) — **the stagger never
grows the step**. The next step still begins only after this step's single
`settle` (§PB2.3 / §PB3.2 unchanged).

Within the transition's `τ ∈ [0, 1]`:

- a fixed fraction `STAGGER_SPAN` (**0.30**, one constants block in `playbackRank.ts`) is
  reserved for spreading bucket onsets across `[0, STAGGER_SPAN]`;
- bucket `k` (0-indexed, `0 … B−1`) has onset
  `onsetₖ = STAGGER_SPAN · k / max(1, B−1)` — bucket 0 at `τ = 0`, the last
  bucket at `τ = STAGGER_SPAN`, regardless of how large `B` is;
- **cap:** `B` is clamped to `STAGGER_MAX_BUCKETS` (**6**); ranks past
  the cap fold into the last bucket. Onsets are therefore always in
  `[0, 0.30]` no matter the graph width;
- each event's **local τ** is
  `τₗ = clamp01((τ − onsetₖ) / (BEAT_SETTLE − onsetₖ))`, then fed to the
  existing `phaseOf` / `travelFraction`. Because every `onsetₖ ≤ STAGGER_SPAN <
  BEAT_ARRIVE`, **every bucket completes `depart → travel → arrive` before the
  shared `settle`** at `τ ≥ BEAT_SETTLE`.
- `settle` remains **one** global atomic commit at `τ ≥ BEAT_SETTLE`
  (PB-INV-6 unchanged — exactly once, `arriveFired`/`lastSettledTransitionId`
  logic untouched). The count-up / delta chips still resolve against the
  just-committed `S(t+1)` for the whole step at once.

`transition` gains `onsetByEdge: Record<string, number>` and `bucketCount`,
computed **once per transition** in `beginTransition` from the step-start graph
snapshot (`computeStagger(nodes, edges, events)` in `src/store/playbackRank.ts`)
and carried by reference across every τ tick (like `flowByEdge` / `events`), so a
τ-only frame does no graph work. `LoopEdge` reads its own onset, gates its cue on
`τ ≥ onset`, and derives `τₗ`. The immediate `advance()` path (Monte-Carlo /
tests) has no animation and skips the computation.

Pause (§PB5) freezes the global `τ` — every bucket freezes in place. Speed change
mid-transition (§PB6.2) re-rates the shared wall clock; local τ follows. LOD /
background (§PB4.4 / §PB8) unchanged — they read the per-edge phase off `τₗ`.

## PBO3. Role cues — emit / converge / absorb

Today `depart` and `arrive` are the **same** ring (`@keyframes pb-cue-ping`,
3→8 px expand + fade), differing only by which handle they sit on. §PB2.1's
"outflow cue" / "inflow cue" is not visually realised. Replace with three
geometrically distinct cues, each carrying a stable `data-cue-role`:

| role | when | shape |
|---|---|---|
| **emit** | `depart`, at the source handle | an **outward** burst — a ring that expands *away* from the handle, or short radial ticks pointing out |
| **converge** | `arrive` into a Pool / Gate / Converter | an **inward** collapse — a ring contracting *onto* the target handle; the token's `arrive` scale-up (1.2×) stays |
| **absorb** | `arrive` into a **Drain / End** | inward collapse **+ the token dissolves** — a brief fade-to-nothing at the handle; nothing "lands" |

- **Same-rank branches move together** (§PBO1) — a gate's *process* and *scrap*
  tokens depart on the same onset and their `emit` cues fire together at the
  gate's output handles.
- The token itself keeps the §PB2.1 scale tell (`depart` 0.45× → `arrive`
  1.2×); `absorb` overrides the end with the dissolve.
- No new colour — all three read on `--flow-strength` / `currentColor`.
- The direction marker, trail, count label, and §PB4.5 breakdown are unchanged.

## PBO4. Reduced-motion & forced-colors — the role difference must survive

**`prefers-reduced-motion: reduce`** (§PB9): no τ ramp, the step settles on one
tick, so the stagger collapses to nothing — acceptable (values are still
correct; §PBO2 cap already bounds it). The **role tell must still be static and
distinct** on the RM substitute (`.flow-edge-pulse`, held for the step):

- **emit**: a small outward "▸" glyph at the source handle;
- **converge**: a filled "▪" at the target handle;
- **absorb**: a hollow "◌" at the target handle (Drain / End) — reads as
  "taken, gone".

Held for the whole committed step, no fade (matches §VL6 / §VL9).

**`forced-colors: active`**: the three cues differ by **geometry only** (outward
vs inward vs hollow), never by hue; stroke is `currentColor` / `ButtonText`. A
greyscale / high-contrast user still tells emit from absorb.

## PBO5. Steady-state — "Steady state — flows continue" (own PR)

Designed here; **implemented as a separate small PR after §PBO2/§PBO3 land and
verify.** Rationale for splitting: a one-step "net Δ = 0" is *not* equilibrium —
an accidental one-step stall would be mislabelled.

**Detection.** Look at the last **3 consecutive committed steps** (`N = 3`; a
constants block, tunable, not structural). The system is *steady* iff, for **both**
adjacent pairs `(t−2, t−1)` and `(t−1, t)`, **all three** hold:

1. `‖pools(t) − pools(t−1)‖∞ ≤ ε` — the Pool value vector is pairwise unchanged
   within tolerance;
2. `flowByEdge(t)` equals `flowByEdge(t−1)` per edge within `ε` — the whole
   edge-flow vector is pairwise unchanged;
3. `Σ flowByEdge(t) > 0` — total flow is above zero.

So a frozen line (nothing moving) is **not** "steady" — it is stopped, and gets
no label. `ε` is a small combined absolute + relative tolerance (final value set
during impl).

**The consecutive-step counter resets to zero on:** `reset()`, a template load
(`loadGraph`), any graph edit (a `simulationRev` bump), and a seed change. So an
equilibrium claim is always about ≥ 3 steps of the **current** graph + seed, from
step 0 or the last disruption — never carried across a change.

**Display.** A quiet strip / chip near the Timeline or PlayBar reading
**"Steady state — flows continue"** (localised EN / KO / JA). It appears once the
3-step test passes and **clears the moment any condition breaks** (a lever
change, a stock draining, a probabilistic swing) or the counter resets.
Session-only,
presentation-only — no GraphDoc / digest / undo / autosave / Workspace effect.
`N` / `ε` are tunable and not a structural decision.

## PBO6. Spec deltas to `docs/simulation-playback.md`

- **§PB2.1** — the `depart` / `arrive` rows: "*the exact onset is offset per
  `(phase, rank)` bucket within `[0, STAGGER_SPAN]` (§PBO2); events in the same
  bucket share an onset; the token's local `τ` drives `phaseOf` / `travelFraction`*".
- **§PB2.6** — "*all run against the same `τ`*" → "*all run inside the same
  **transition**; each event's **local** `τ` is offset by its `(phase, rank)`
  bucket within a bounded window (§PBO2). `settle` is still one global atomic
  commit; draw order within a beat is unchanged (ascending edge id, then the
  flattened event key)*".
- **§PB2.1 cue language** — "*outflow cue*" / "*inflow cue*" now name the three
  §PBO3 roles (emit / converge / absorb).
- **§PB4.5** — the budget sort key `(edgeId, cueKind, originalEventIndex)` is
  unchanged; the **bucket onset** is a separate render-time map, also computed
  once per transition.

## PBO7. Invariants (PBO-INV)

| id | statement |
|---|---|
| **PBO-INV-1** | The stagger is a pure function of `report.events` and the graph's `(phase, longest-predecessor depth over the FULL resource-edge condensation DAG)` order. Playback **never invents an order** (SCCs share a bucket; a router's pull-in and push-out share its bucket), **never changes which events animate** (only *when each starts*), and computes the schedule **once** from the step-start graph snapshot. No `FlowEvent` / `StepReport` / Workspace / digest field is added. |
| **PBO-INV-1a** | The stagger is a **visual narration of the execution phase + reading direction**, not a physical route (§PBO1.1). Values are atomic vs `S(t)`. Tokens on different edges are **separate cues** — no shared path, no hand-off, a visible time+space gap between an upstream `arrive` and a downstream `emit`; they must never read as one continuous moving object. |
| **PBO-INV-2** | Total step wall time is **independent of rank count** — bucket onsets are always in `[0, STAGGER_SPAN]`, `B` clamped to `STAGGER_MAX_BUCKETS`. The step is never longer than `beatDuration()`. |
| **PBO-INV-3** | Same bucket ⇒ identical onset ⇒ parallel siblings — and every edge inside one SCC — depart and arrive together. Every condensation-DAG edge points **strictly deeper**, so the cascade never runs backward (PBO-D2, structural). |
| **PBO-INV-4** | `settle` commits **exactly once** per transition at `τ ≥ BEAT_SETTLE` (PB-INV-6 verbatim — `arriveFired` / `lastSettledTransitionId` untouched); the whole step's count-up / chips resolve against `S(t+1)` at once. |
| **PBO-INV-5** | `emit` / `converge` / `absorb` are distinguishable by **geometry** under `forced-colors` and by a **static shape tell** under `prefers-reduced-motion`. |
| **PBO-INV-6** | Steady-state is **presentation-only** and session-only: no engine, RNG, GraphDoc, digest, undo, autosave, or Workspace effect. It is never "one step's net Δ = 0" — it needs **3 consecutive** committed steps with the pool vector *and* the whole edge-flow vector pairwise ε-equal *and* Σ flow > 0. The consecutive counter zeroes on `reset()` / template load / graph edit / seed change. |
| **PBO-INV-7** | The bucket map and (later) the steady-state window are recomputed **once per transition / commit**, not per frame; a τ-only frame does no graph work. |

## PBO8. Acceptance / E2E

Extends `docs/simulation-playback.md` §PB12 (all existing rows still pass).
**Every ordering assertion keys on `node.id` / `edge.id`, never on a rendered
label** — so the tests are locale-independent. The Korean Balanced production
line screen is used **only** as the human visual-review scene (§PBO11), not in
an assertion.

1. **Ordered cascade — Balanced production line** (`examples/equilibrium.json`).
   Play; read `transition.onsetByEdge` by `edge.id`. With ids
   `tpl-e1` (src→vault) · `tpl-e2` (vault→gate) · `tpl-e3` (gate→conv) +
   `tpl-e4` (gate→spill) · `tpl-e5` (conv→prod) · `tpl-e6` (prod→consume),
   assert onsets are non-decreasing in that depth order **and**
   `onset(tpl-e2) === onset(tpl-e3) === onset(tpl-e4)` — the split's pull-in, its
   process branch, and its scrap branch are one routing subject (the gate) —
   **and** `onset(tpl-e5) > onset(tpl-e3)` **and** `onset(tpl-e6) > onset(tpl-e5)`
   (the shipment Drain is deepest by longest-predecessor depth, *not* early as
   its emission order would suggest).
2. **Bounded step — MMO progression** (`examples/mmo-progression.json`). A wide
   step (many ranks); assert `max(onsetByEdge) ≤ STAGGER_SPAN`,
   `bucketCount ≤ STAGGER_MAX_BUCKETS`, and `series.length === stepIndex + 1`
   after a run (one `settle` per step — width does not stretch the step). Keyed
   on node/edge ids.
2a. **Cyclic graph — a feedback loop through a Pool** (pure `computeStagger`
   unit test with synthetic `nodes` / `edges` / `events` — a live *router-only*
   cycle carries no flow, since this engine declares a zero-storage router cycle
   dead, so it cannot be exercised end-to-end). Assert: every event whose
   routing node is in one SCC gets the **same** onset · no invented order inside
   the SCC · the function terminates (no infinite walk) · it is computed once
   (`__staggerComputes` +1). The SCC-condensation code stays a defensive mirror
   of the engine's own `cyclic` fallback (`step.ts`).
3. **`settle` exactly once** — the §PB7.7 double-beat / giant-gap / speed-change
   matrix still yields one commit; `stepIndex` still moves only at `settle`.
4. **Pause mid-stagger** — Pause with bucket 2 still in `travel`: all buckets
   freeze; Resume completes them; one `settle`.
5. **Role cues** — `data-cue-role` is `emit` at the source, `converge` at a Pool
   target, `absorb` at a Drain / End target; the three have distinct bounding
   geometry. Holds under `emulateMedia({ forcedColors: 'active' })` and
   `{ reducedMotion: 'reduce' }` (static shape tells).
6. **Determinism** — same seed + graph ⇒ identical `onsetByEdge` across runs
   (every traversal in `computeStagger` is id-sorted; PBO-INV-1).
7. **Steady-state (PR 3)** — 3 consecutive all-equal committed steps raise
   "Steady state — flows continue"; two equal steps do **not**; a single-step
   stall does **not**; a run that has stopped (Σ flow = 0) does **not**;
   breaking condition 1, 2, or 3 clears the label within one step; `reset()` /
   `loadGraph` / a graph edit / a seed change zeroes the counter (label gone).
   Assertions key on node/edge ids; localised string checked in EN / KO / JA
   separately. No digest / undo / autosave movement.

## PBO9. Work order

1. **Ordered playback + role cues** — §PBO1 rank + §PBO2 staggered local-τ +
   §PBO3 emit/converge/absorb, behind §PBO8 rows 1–6. One PR (or two if the
   cue-CSS review is heavy — ordering first, then cues).
2. **Visual / performance / accessibility verification** — the §PB12 matrix
   re-run, the LOD × RM × forced-colors grid, a frame-cost check that the
   per-transition bucket map adds no per-frame graph work (PBO-INV-7), and a
   screenshot/interaction review of the Balanced production line cascade.
3. **Steady-state detection + label** — §PBO5, its own small PR, gated on
   §PBO8 row 7.

## PBO10. Decisions

| id | question | decision |
|---|---|---|
| **PBO-D1** | serialise the per-event order? | **No.** Rank is derived in the playback layer from the graph; nothing is added to `FlowEvent` / `StepReport` / Workspace / any `loop-*` digest (PBO-INV-1). If a future need forces a field onto a serialised structure it **stops** and gets its own review — not pre-authorised here. |
| **PBO-D2** | which node's rank for a Phase-2 event, and how is "never backward" enforced? | The **routing node** the engine is visiting when it emits: for a push *out of* a router use `from`; for a pull *into* a router use `to`. "Never backward" is **structural, not an emission-order check**: with longest-predecessor depth over the full condensation DAG, *every* condensation edge `u → v` has `depth(v) > depth(u)`. The CI test (`playbackRank.bundled.test.ts`) asserts exactly that on every bundled example + fixture. (An earlier draft checked monotonicity along `report.events`; the verified `equilibrium.json` trace emits the shipment Drain's pull *second*, so that check was wrong — the depth labelling is the correct invariant.) |
| **PBO-D3** | cyclic / feedback region? | Feedback loops in this model always run **through a Pool**, so the ordering graph must include Pools. Rank is computed on the **condensation DAG of the FULL resource-edge graph**: contract every SCC to one node, then take longest-predecessor depth (§PBO1). **Every event whose routing node is in one SCC shares that SCC's bucket** — the loop's edges animate together, no invented inner order. The playback layer recomputes SCC + condensation from the step-start snapshot (a pure function; nothing on any serialised structure or `loop-*` digest). A live *router-only* cycle carries no flow (the engine declares a zero-storage router cycle dead), so the SCC-contraction path is a defensive mirror of the engine's own `cyclic` fallback, covered by a `computeStagger` unit test rather than e2e. |
| **PBO-D4** | `STAGGER_SPAN` / `STAGGER_MAX_BUCKETS` / `N` / `ε` values | Tunable constants blocks, **not** structural. Proposed 0.30 / 6 / 3 / a small absolute+relative ε; final values set during impl against the Balanced production line and MMO cascades. |
| **PBO-D5** | is this a new `loop-*/N`? | **No.** Display layer only — no engine result, no digest, no wire, no Workspace field. Same status as the parent doc. If impl surfaces a genuine wire need it halts and gets a frozen id then. |
| **PBO-D6** | steady-state in the same PR? | **No** — split (§PBO9). A one-step net-zero is not equilibrium; the multi-step three-condition test needs its own verification and shouldn't gate the cascade work. |

---

## PBO11. Scope boundary

- This doc pins **ordering + role cues + steady-state detection** for playback.
  It does **not** touch the engine, the RNG, state semantics, Monte-Carlo, the
  GraphDoc, any `loop-revision/*` / `loop-workspace/1` contract, or the
  §PB7.7 commit ladder.
- The **human visual-review scene** (not an e2e assertion — those key on
  node/edge ids, §PBO8) is: the Korean Balanced production line under Play shows
  `공급 → 배분 → 가공 → 완제품 → 출하` in visible order, with the **폐기** (scrap)
  branch moving together with the same-rank **가공** (process) branch, and the
  whole step still fitting one beat.
