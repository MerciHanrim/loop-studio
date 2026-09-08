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

**Rank.** Each event is assigned an integer `rank`:

- **Phase-1** (Source → its immediate targets): `rank = 0`.
- **Phase-2**: `rank = 1 + L`, where `L` is the **layered** (Kahn-level)
  topological depth of the event's *routing node* (`from` for a push out of a
  router, `to` for a pull into one — see §PBO10-D2) in the **router→router
  resource-edge DAG** — the same DAG `step.ts` walks. "Layered" = process the
  whole current frontier as one layer, then advance; **all same-depth siblings
  share a rank**.

Rank is a **pure function of the graph** (nodes + resource edges + the
push/pull phase split), computed in the playback layer — it adds **nothing** to
`FlowEvent`, `StepReport`, the Workspace sim-snapshot, or any digest. A cyclic
router region (rare; the engine has its own fallback) collapses to a single rank
(§PBO10-D3).

**Bucket.** Events are grouped into ordered buckets by `(phase, rank)`. Let `B`
be the count of non-empty buckets this step. Same bucket ⇒ **identical onset**
(parallel siblings move together). Bucket order is `phase` then ascending `rank`.

## PBO2. The staggered-τ model — bounded, `settle` unchanged

One transition, one wall clock, unchanged total duration `beatDuration()`
(speed-controlled, `Math.max(speedMs, PLAYBACK_MIN_MS)`) — **the stagger never
grows the step**. The next step still begins only after this step's single
`settle` (§PB2.3 / §PB3.2 unchanged).

Within the transition's `τ ∈ [0, 1]`:

- a fixed fraction `STAGGER_SPAN` (proposed **0.30**, one constants block) is
  reserved for spreading bucket onsets across `[0, STAGGER_SPAN]`;
- bucket `k` (0-indexed, `0 … B−1`) has onset
  `onsetₖ = STAGGER_SPAN · k / max(1, B−1)` — bucket 0 at `τ = 0`, the last
  bucket at `τ = STAGGER_SPAN`, regardless of how large `B` is;
- **cap:** `B` is clamped to `STAGGER_MAX_BUCKETS` (proposed **6**); ranks past
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

`transition` gains a render-time `bucketOf: (edgeId) => number` (or a
`onsetByEdge` map), computed **once per transition** (keyed on the
`flowByEdge` identity, like the §PB4.5 budget sort) so a τ-only frame and every
edge consumer share one result. `LoopEdge` reads its own onset and derives `τₗ`;
no per-frame graph work.

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

**Detection.** A rolling window of the last `N` **committed** steps (`N ≥ 3`,
one constants block). The system is *steady* iff, for every adjacent pair
`(t−1, t)` inside the window, **all** hold:

1. `‖pools(t) − pools(t−1)‖∞ ≤ ε` — the Pool value vector is unchanged within
   tolerance;
2. `flowByEdge(t)` equals `flowByEdge(t−1)` per edge within `ε` — the transfer
   vector is unchanged;
3. `Σ flowByEdge(t) > 0` — transfers are still happening.

So a frozen line (nothing moving) is **not** "steady" — it is stopped, and gets
no label.

**Display.** A quiet strip / chip near the Timeline or PlayBar reading
**"Steady state — flows continue"** (localised EN / KO / JA). It appears when all
three hold across the window and **clears the moment any condition breaks** (a
lever change, a stock draining, a probabilistic swing). Session-only,
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
| **PBO-INV-1** | The stagger is a pure function of `report.events` and the graph's `(phase, layered topo-rank)` order — the engine's own emission order. Playback **never invents an order** and **never changes which events animate** (only *when each starts*). No `FlowEvent` / `StepReport` / Workspace / digest field is added. |
| **PBO-INV-2** | Total step wall time is **independent of rank count** — bucket onsets are always in `[0, STAGGER_SPAN]`, `B` clamped to `STAGGER_MAX_BUCKETS`. The step is never longer than `beatDuration()`. |
| **PBO-INV-3** | Same `(phase, rank)` bucket ⇒ identical onset ⇒ parallel siblings depart and arrive together. |
| **PBO-INV-4** | `settle` commits **exactly once** per transition at `τ ≥ BEAT_SETTLE` (PB-INV-6 verbatim — `arriveFired` / `lastSettledTransitionId` untouched); the whole step's count-up / chips resolve against `S(t+1)` at once. |
| **PBO-INV-5** | `emit` / `converge` / `absorb` are distinguishable by **geometry** under `forced-colors` and by a **static shape tell** under `prefers-reduced-motion`. |
| **PBO-INV-6** | Steady-state is **presentation-only** and session-only: no engine, RNG, GraphDoc, digest, undo, autosave, or Workspace effect. It is never "one step's net Δ = 0". |
| **PBO-INV-7** | The bucket map and (later) the steady-state window are recomputed **once per transition / commit**, not per frame; a τ-only frame does no graph work. |

## PBO8. Acceptance / E2E

Extends `docs/simulation-playback.md` §PB12 (all existing rows still pass).

1. **Ordered cascade — Balanced production line.** Play; capture each edge's
   first `emit`-cue onset. Assert:
   `supply (rank 0) < split (rank 1) < { process, scrap } (rank 2, equal ± 1
   frame) < prod (rank 3) < ship (rank 4)`. The **scrap** branch's onset equals
   the **process** branch's (same rank).
2. **Bounded step — MMO progression.** A wide step (many ranks); assert the last
   bucket's onset ≤ `STAGGER_SPAN` and the total transition wall time ≤
   `beatDuration()` (± one frame), i.e. width does not stretch the step.
3. **`settle` exactly once** — the §PB7.7 double-beat / giant-gap / speed-change
   matrix still yields one commit; `stepIndex` still moves only at `settle`.
4. **Pause mid-stagger** — Pause with bucket 2 still in `travel`: all buckets
   freeze; Resume completes them; one `settle`.
5. **Role cues** — `data-cue-role` is `emit` at the source, `converge` at a Pool
   target, `absorb` at a Drain / End target; the three have distinct bounding
   geometry. Holds under `emulateMedia({ forcedColors: 'active' })` and
   `{ reducedMotion: 'reduce' }` (static shape tells).
6. **Determinism** — same seed + graph ⇒ identical bucket assignment and onset
   timeline across runs (`originalEventIndex` order unchanged; §PB-INV-1).
7. **Steady-state (PR 3)** — a 4-step all-equal run raises "Steady state — flows
   continue"; a single-step stall does **not**; a run that has stopped (Σ flow =
   0) does **not**; breaking condition 1, 2, or 3 clears the label within one
   step. Localised EN / KO / JA. No digest / undo / autosave movement.

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
| **PBO-D2** | which node's rank for a Phase-2 event? | The **routing node** the engine is visiting when it emits: for a push *out of* a router use `from`; for a pull *into* a router use `to`. A CI test asserts monotonicity on every bundled example + fixture — no event's routing rank is *lower* than its predecessor in `report.events` (the cascade never runs backward). |
| **PBO-D3** | cyclic router region? | Collapse the whole strongly-connected region to **one rank** (the engine already has a cycle fallback for the values; the animation shows the cycle's edges moving together rather than inventing an order inside it). |
| **PBO-D4** | `STAGGER_SPAN` / `STAGGER_MAX_BUCKETS` / `N` / `ε` values | Tunable constants blocks, **not** structural. Proposed 0.30 / 6 / 3 / a small absolute+relative ε; final values set during impl against the Balanced production line and MMO cascades. |
| **PBO-D5** | is this a new `loop-*/N`? | **No.** Display layer only — no engine result, no digest, no wire, no Workspace field. Same status as the parent doc. If impl surfaces a genuine wire need it halts and gets a frozen id then. |
| **PBO-D6** | steady-state in the same PR? | **No** — split (§PBO9). A one-step net-zero is not equilibrium; the multi-step three-condition test needs its own verification and shouldn't gate the cascade work. |

---

## PBO11. Scope boundary

- This doc pins **ordering + role cues + steady-state detection** for playback.
  It does **not** touch the engine, the RNG, state semantics, Monte-Carlo, the
  GraphDoc, any `loop-revision/*` / `loop-workspace/1` contract, or the
  §PB7.7 commit ladder.
- The **acceptance scene** is: Balanced production line under Play shows
  `공급 → 배분 → 가공 → 완제품 → 출하` in visible order, with the **폐기** (scrap)
  branch moving together with the same-rank **가공** (process) branch, and the
  whole step still fitting one beat.
