# Simulation Playback / Event Choreography (non-frozen design doc — DRAFT)

**Status: DRAFT — final form, pending merge.** Round 1's `committedStep ≥
revealedStep` two-clock model was withdrawn; round 2's **one committed clock + a
single `preparedTransition` with progress `τ`** state model (§PB2) is approved.
Round 3 fixed the last three expressions: the RNG is confirmed **fully keyed**
(`loop-rng/1`) so there is **no RNG cursor** anywhere in the design (§PB1.1a,
§PB-D1); `committed-state identity` is an explicit non-serialised monotonic
**`commitEpoch`** (§PB2.7a, PB-INV-19); and the `commitPrepared` **decision
ladder** + the **one-commit-per-user-event** Step rule are fixed (§PB7.7,
§PB3.3), backed by two scalars (`activeTransitionId`, `lastSettledTransitionId`)
and no unbounded fired-id set. The dedicated `commitPrepared()` API (§PB2.7 — not
a reuse of `advance`), the CAS / prepare-determinism / exactly-once /
legacy-equivalence boundaries (§PB7.5–PB7.7, §PB2.8), the three implementation
slices (§PB13), and every §PB14 question (all **Decided** / **Deferred**) are
settled.

A **presentation-only** layer over the existing engine: when the user presses
**Play** (or **Step**), the next step is computed in full but **not committed**;
resources visibly leave a source, travel the real edge path, arrive, and then —
in **one atomic commit at `settle`** — `SimState` / step index / timeline series /
`commitEpoch` advance together. It does **not** touch the engine's determinism,
the RNG draws, state semantics, Monte-Carlo, the GraphDoc, the `loop-revision/*`
digest, or the Workspace format. This doc carries no `loop-*/N` id and is revised
freely (like `docs/visual-language.md`, `docs/edge-routing.md`).

It supersedes the ad-hoc "flow bead" that the Canvas Visual Refresh (v0.6.0) and
Orthogonal Routing Slice 1 (v0.7.0-dev) ship today: one `<animateMotion>` token
per active edge, fire-and-forget, with no ordering, no backpressure, and no
relationship to when the number on a Pool updates. This doc pins down what "the
model comes alive when you press Play" means for Loop Studio **before any
implementation**.

**Build order:**
1. this design doc → merge;
2. implementation slices §PB13 (S1 state machine + `commitPrepared` → S2
   choreography → S3 reduced-motion / LOD / background / mobile / matrix), each
   behind the acceptance set §PB12;
3. no wire/spec amendment is expected — if one turns out to be needed, it stops
   and gets its own frozen `loop-*/N` (this doc does not pre-authorise it).

**Map (the load-bearing sections):**

| topic | pinned in |
|---|---|
| the state model — one clock + `preparedTransition`; `settle` = one atomic commit | §PB1, §PB2.1–PB2.4, PB-INV-1/2/3 |
| the API — `prepareTransition` / `commitPrepared`, and why not reuse `advance` | §PB2.7, §PB2.8, PB-INV-16/18 |
| `commitEpoch` — the non-serialised generation token | §PB2.7a, PB-INV-19 |
| `commitPrepared` decision ladder + CAS | §PB7.7 (fixed order), §PB7.5 (checks) |
| prepare determinism — repeat-safe, RNG-neutral, frozen-input-safe | §PB7.6, PB-INV-17 |
| one commit per user event (Step-spam) | §PB3.3 |
| RNG — fully keyed, no cursor introduced | §PB1.1a, §PB-D1 |
| Pause/Resume · discard · background · speed · reduced-motion | §PB5 · §PB7 · §PB8 · §PB6 · §PB9 |
| every §PB14 question | §PB14 — all **Decided** / **Deferred** |

---

## PB0. Why

- Automatic orthogonal routing (Slice 1) made the **structure** readable. The
  next value increase is **behaviour**: pressing Play should *explain* the model
  — you see where resources come from, which path they take, what they feed, and
  in what order — not just watch numbers tick.
- Today's single bead is decorative. It starts whenever `activeByEdge[id] > 0`,
  runs once, and is unrelated to the Pool value update, so it reads as "some
  animation happened", not "3 gold moved from the Mine to the Vault this step".
- Event choreography also makes **causality** legible: a `trigger` that fires a
  converter, an `activator` that opens a gate, a `label` edge that adds to a
  pool — each becomes a small ordered beat instead of a simultaneous flash.

## PB1. The hard boundary — the engine decides everything, the animation decides nothing

**PB1.1 — compute, then (later) commit.** A step is computed **first, in full,
synchronously**, exactly as the engine does today — but the result is **held, not
written to the store**:

```
committed  S(t)   @ commitEpoch = E       ← the ONLY authoritative sim state right now
   │  pure engine step (no store write, no visible change)
   ▼
preparedTransition = {
   fromStep:            t,
   from:                S(t),              ← a reference to the committed state
   expectedCommitEpoch: E,                 ← the generation token this was prepared against (§PB7.5)
   events:             FlowEvents[] + StateEvents[],   ← the engine's own per-step lists, verbatim
   to:                 S(t+1),             ← fully computed, NOT yet committed
   transitionId:       <fresh monotonic>,
   τ:                  0                   ← animation progress, [0, 1]
}
   │  depart → travel → arrive              (τ advances; store still shows S(t))
   ▼
settle  ── ONE atomic commit ──▶  committed S(t+1)   @ commitEpoch = E+1
                                  (SimState + stepIndex + series + last-FlowEvents, together)
```

`from` / `to` are `SimState` values; `events` is the engine's existing per-step
output, **passed through unchanged** — the choreography never re-orders,
coalesces, or invents events. Computing `preparedTransition` performs no store
write and no visible change.

**PB1.1a — the RNG is fully keyed; playback consumes none.** `loop-rng/1`
(`SEMANTICS-B1.md §B1.2`, frozen) threads **no PRNG object** through a run: every
random value is a pure total function of `(seed, step, elementId, purpose,
drawIndex)`. So the prepare inputs are `(GraphDoc, committed SimState, seed)` —
recomputing step `t+1` from the same inputs yields the same draws — and there is
**no RNG cursor** to carry in `preparedTransition`, to commit at `settle`, or to
roll back on discard. The playback layer must **not** introduce one.

**PB1.2 — `settle` is the single commit point.** `settle` (the last beat, §PB2.1)
is the *only* place the store changes during playback. It applies `to` /
`stepIndex+1` / the appended `series` point / the store's "last FlowEvents" field
/ `commitEpoch += 1` **in one transaction** — the same net effect the existing
`advance` action produces, just deferred to the end of the choreography. Before
`settle`: the store is `S(t)`. After `settle`: the store is `S(t+1)` and there is
no `preparedTransition` until the next one is prepared. There is never a moment
where the store is "half a step ahead".

**PB1.3 — no animation-derived state.** Nothing the choreography computes (a
token's position, a lane assignment, `τ`, a per-edge visual sum) enters
`SimState`, the timeline series, the GraphDoc, the digest, the Share link, or the
Workspace payload. `preparedTransition` lives only in a render-side scheduler and
is discarded on cancel (§PB7).

**PB1.4 — Register `R(t)`.** A Register value is recomputed from the **committed**
snapshot each step (`loop-model/1`). During a transition the committed snapshot is
`S(t)`, so `R` reads `R(t)`; `settle` commits `S(t+1)` and the next read is
`R(t+1)`. The choreography never re-derives `R`.

## PB2. State model — one committed clock + one `preparedTransition`

**PB2.1 — a transition is a fixed sequence of beats.** Every visual for the
prepared step is placed on **one normalised axis** `τ ∈ [0, 1]` (mapped to
wall-clock by the current speed, §PB6):

| beat | τ window | what happens | store |
|---|---|---|---|
| **depart** | `[0.00, 0.15]` | a token appears at each contributing source handle; the source's "outflow" cue plays | `S(t)` |
| **travel** | `[0.15, 0.80]` | tokens move along the **real edge path** (§PB4) at constant path-length speed | `S(t)` |
| **arrive** | `[0.80, 0.95]` | tokens reach the target handle; the target's "inflow" cue plays | `S(t)` |
| **settle** | `[0.95, 1.00]` | **one atomic commit → `S(t+1)`**; the value count-up / delta chip and state effects (tint, pulse, gate open/close) resolve against the just-committed state | `S(t) → S(t+1)` |

The exact fractions are a single constants block (`PLAYBACK_BEATS`), tunable in
one place.

**PB2.2 — `committedStep === revealedStep`, always.** There is one clock: the
store's `stepIndex`. It moves only at `settle`, so what the canvas shows and what
the store holds are the same thing at every instant. There is no separate
"revealed" snapshot and no observer-bypass layer — every existing reader of the
store (Canvas, Inspector, Register panel, Timeline, autosave, Workspace Export,
revision/project export, Monte-Carlo/Predict start point) just reads the store
and is correct, because the store is not advanced until `settle`.

**PB2.3 — exactly one `preparedTransition` at a time.** Play/Step create it;
`settle` commits it and clears it; cancel discards it. It is **not** a queue —
Play does not pre-compute step `t+2` while `t+1`'s transition is animating
(§PB3.2). The only lookahead that ever exists is the single step currently being
choreographed.

**PB2.4 — what every surface shows during a transition.** Because nothing is
committed until `settle`, the answer is uniform and needs no per-surface table:

| surface | during depart / travel / arrive | after `settle` |
|---|---|---|
| node value text, delta chip | `S(t)` | `S(t+1)` |
| Register `R(t)` panel | `R(t)` | `R(t+1)` |
| Inspector values | `S(t)` | `S(t+1)` |
| timeline cursor **and** plotted line | both at step `t` (the line ends at `t`) | both at `t+1` |
| autosave record / Workspace Export / Share / revision export | `S(t)` (step `t`, series up to `t`) | `S(t+1)` |
| Monte-Carlo / Predict start point | `S(t)` | `S(t+1)` |
| state cues (tint / pulse / blocked) | the `S(t)` state | the `S(t+1)` state |
| tokens | at their `τ` positions | removed |

A Workspace Export taken mid-`travel` saves step `t` with a series ending at `t`
— **never** the not-yet-committed `S(t+1)`.

**PB2.5 — delayed `trigger` delivery.** A `trigger` with `delay > 0` is delivered
by the engine on a later step; its choreography plays on **that** step's
transition (the delivery step), because that is the step whose `events` list
contains it. The emit step may show a brief "queued" cue at the source with no
travel (see PB-Q1).

**PB2.6 — event order within a beat.** Two `FlowEvents`, a `trigger`, and a
`label` in the same prepared step all run against the *same* `τ` — depart
together, travel together, `settle` together. Drawing order within a beat (which
arrival is on top) is deterministic: ascending edge id, then the flattened event
key, matching the router's tie-break vocabulary.

**PB2.7 — the API: `prepareTransition` + `commitPrepared` (a dedicated commit,
NOT a reuse of `advance`).** `advance` today *computes and commits together*.
Reusing it for playback would risk (a) running the engine step / RNG twice, (b)
committing a **fresh** result instead of the prepared one, (c) overwriting a
state the user changed mid-animation with a stale result, and (d) tangling the
existing immediate path with the playback path. So playback gets its own two
functions and the two responsibilities are split:

```
prepareTransition(snapshot) →           // snapshot = { nodes, edges, S: SimState, seed }
   {
     fromStep,                 // the committed stepIndex this was prepared against
     expectedCommitEpoch,      // store.commitEpoch at prepare time (§PB7.5) — a generation token
     expectedSimulationRev,    // store.simulationRev at prepare time (GraphDoc-edit guard)
     events,                   // the engine's per-step FlowEvents[] + StateEvents[], verbatim
     toState,                  // fully computed S(fromStep + 1), NOT committed
     transitionId,             // fresh monotonic id (§PB7.3 / §PB7.7)
   }

commitPrepared(prepared) → "committed" | "stale" | "already-settled"
```

- `prepareTransition` is **pure** over `(nodes, edges, S, seed)`: no store write,
  no visible change, and — because `loop-rng/1` is fully keyed (§PB1.1a) — no
  RNG state to touch. `seed + fromStep` are part of the input; the same inputs
  always produce the same `events` / `toState` (§PB7.6).
- `commitPrepared` reads the guards it needs straight off `prepared` (it carries
  its own `expectedCommitEpoch` / `expectedSimulationRev` / `fromStep` /
  `transitionId`), runs the **§PB7.7 decision ladder**, and on `"committed"`
  mutates — **in one store transaction** — `SimState` **and** `stepIndex`
  **and** the appended `series` point **and** the store's "last FlowEvents"
  field **and** `commitEpoch += 1`, together, never partially. On `"stale"` /
  `"already-settled"` it performs **zero** mutation.
- `settle` (§PB2.1) is exactly one `commitPrepared` call. Nothing else in the
  playback layer writes sim state.

**PB2.7a — `commitEpoch`: an explicit generation token.** The CAS (§PB7.5) does
**not** lean on object identity or a full-state digest. The sim store holds a
plain **monotonic `commitEpoch: number`**:

- it **increments on every committed-state replacement** — a `settle` commit,
  Reset, Workspace/Graph Import, Undo, Redo, Workspace load, a timeline scrub
  that commits `series[K]`;
- `prepareTransition` captures the current value as `expectedCommitEpoch`;
- `commitPrepared` requires `prepared.expectedCommitEpoch === store.commitEpoch`
  (a plain integer equality) as one of its guards;
- a **GraphDoc edit** does not bump `commitEpoch` — it is caught by the existing
  `simulationRev` guard instead (which already fires on every structure/param
  change), so the two guards are orthogonal and both are checked;
- `commitEpoch` is **render/session state only** — it is never written to
  `SimState`, the timeline series, the Workspace payload, the Share link, or the
  GraphDoc, and it is not restored on load (a fresh session starts at 0).

**PB2.8 — relationship to the legacy immediate path.** The non-playback callers —
unit/integration tests that just want to step the engine, Monte-Carlo, Predict —
keep using the existing **immediate** `advance` (compute + commit in one call, no
tokens). Both paths **must** bottom out in the *same pure engine primitive*
(the current `step(nodes, edges, prev, seed)` → `StepResult`) and produce
identical results:

```
advance(S)                            // legacy immediate
   ≡  commitPrepared(prepareTransition({ nodes, edges, S, seed }))   // when nothing changed in between
```

i.e. `advance` becomes a thin wrapper: `prepareTransition` then an immediate
`commitPrepared`. Playback simply inserts the `τ` animation *between* those two
calls. Only the Step / Play **UI** uses the split path; MC / Predict stay on the
tokenless immediate path (§PB10).

## PB3. Step vs Play — backpressure

**PB3.1 — Step.** Pressing **Step** prepares step `t+1` (synchronous engine call,
no commit) and plays its transition **once**. `settle` commits `S(t+1)`; control
returns to idle. A second **Step** press before `settle` — PB3.3.

**PB3.2 — Play.** Play prepares `t+1`, choreographs it, and **only after that
transition's `settle` has committed `S(t+1)`** does it prepare `t+2`. Exactly one
`preparedTransition` exists at a time; transitions never overlap; the engine is
never run ahead of the choreography. Play's throughput is bounded by
`beatDuration` by design (§PB6). "Ended" (`SimState.ended` on a committed step)
stops Play after that step's `settle`; no empty transition is prepared.

**PB3.3 — an input during an active transition — one commit per user event.**

- **Step clicked while a transition is animating:** the click **only advances the
  in-flight transition straight to `settle`** (τ → 1, tokens jump to arrival, one
  `commitPrepared` → `S(t+1)`). The **same click does not prepare or start the
  next step.** Preparing `t+2` requires a **separate** Step click (or the Play
  loop). So a burst of rapid Step clicks commits **at most one step per click** —
  N fast clicks over an N-step-long animation settle the current one and then act
  as ordinary Step presses, never "N steps at once".
- **Play pressed while a transition is animating:** same — the in-flight
  transition is advanced to `settle` (one commit), *then* the Play loop takes
  over and prepares the next step on its next tick.
- **Pause pressed:** §PB5 — the transition is kept, `τ` frozen, nothing
  committed.

## PB4. Path fidelity — tokens follow the real edge `d`

**PB4.1 — one path, every consumer.** A travelling element uses the **exact same
path string** the edge renders — `getBezierPath(...)` for a default edge,
`currentRouteMap().get(id).d` for `route: "orthogonal"`. This is the invariant
already enforced for the flow bead in Slice 1 (`e2e/edge-routing.spec.ts` "every
path consumer reads the same d"); Playback extends it to *all* travelling /
highlighted elements (token, trail, count label, state pulse). No element follows
a straight chord while the edge is drawn curved or right-angled.

**PB4.2 — direction.** A resource token travels **source-handle → target-handle**.
A `label` `StateEvent` with a negative delta travels **target → source** (the
current flash direction). An `activator` has no travel — a target tint that flips
on `settle`.

**PB4.3 — constant speed along arc length.** Equal path length per unit `τ` (not
equal parameter `t`), so a token does not visually accelerate through an
orthogonal corner or a Bézier bulge. `<animateMotion>` with the path's own
length, or a JS rAF sampler — implementation choice, same result.

**PB4.4 — zoom / LOD.** At **L2 / L1** the full token choreography plays. At **L0**
(`docs/visual-language.md` §VL7, zoom `< 0.45`) the moving dot is **elided**: a
brief directional path "pulse" + the target's arrival cue + the `settle` value
update, still ordered on `τ`. Only the sub-pixel travelling dot is dropped;
`settle` still commits normally. Switching zoom mid-transition re-reads LOD on the
next beat, not retroactively.

**PB4.5 — several `FlowEvents` on one edge in one step — merge the token, keep the
events.** The **token visual** may be one dot carrying the summed amount (label =
the sum); the **`preparedTransition.events` list keeps every original
`FlowEvent`**, unmerged:

- the merge is a **render-time group-by** on `(edgeId, direction)`; it changes no
  engine data and no `to` value;
- each original `FlowEvent`'s **origin** (which gate branch / source / converter),
  **category** (resource kind), and **order** are preserved in the list, so
  hover / select on the edge during or right after the transition shows the
  breakdown ("+3 from the gate A-branch, +2 from the recycler");
- **sign handling is fixed:** positives sum into a forward token, negatives into a
  reverse token (`label`-style), a net-zero pair still shows both component cues
  (it is information that they cancelled) — never a silent drop;
- a `trigger` / `activator` / `label` `StateEvent` is **never** merged into a
  resource token (different meaning, own beat);
- a cap `MAX_PLAYBACK_TOKENS` (proposed **12**) per edge per step and a global
  per-step cap (PB-Q4) bound the DOM; past the cap only the **`+N` affordance**
  changes — the summed amount shown is still exact and `to` is untouched.

## PB5. Pause / Resume

**PB5.1 — Pause keeps the prepared transition.** Pause stops the `τ` clock at its
current value. `preparedTransition` (its `from`, `events`, `to`,
`expectedCommitEpoch`, `transitionId`, and `τ`) is **retained**. Tokens hold
their exact positions. **Nothing is committed** — the store is still `S(t)`
(PB2.4), and stays there until Resume/Step drives the transition to `settle`, or a
cancel discards it.

**PB5.2 — Resume continues the same transition.** Resume restarts the `τ` clock
from the frozen value toward `1` using the **already-computed** `preparedTransition`
— same `events`, same `to`. Nothing is recomputed on Resume (it was computed once
at prepare; the RNG is keyed, so there was nothing to consume either). No jump to
`τ = 0`. Resume's eventual `settle` still runs the §PB7.7 ladder, so if the graph
or committed state changed while Paused, that `settle` returns `"stale"` and the
store is left untouched.

**PB5.3 — Pause mutates no store field.** Not `stepIndex`, not `values`, not
`series`, not `simulationRev`. Every surface therefore keeps showing `S(t)`
(PB2.4) — the timeline cursor and line are both at `t`, the Register panel reads
`R(t)`, a Workspace Export saves `S(t)`.

**PB5.4 — Pause during a fast-forward.** If Pause lands while a transition is
being advanced to `settle` (PB3.3, PB8), that advance is atomic and near-instant:
`settle` commits `S(t+1)` first, *then* the clock stops with no
`preparedTransition` pending. Pause never freezes a half-applied `settle`.

## PB6. Speed

**PB6.1 — speed scales wall-clock only.** The speed control maps `τ`'s `[0,1]` to
a wall-clock duration `beatDuration`. Faster = shorter `beatDuration` = the same
beats, compressed. It changes **nothing** about the engine result, RNG result,
step count, event lists, beat order, or which `to` is committed. Two runs at
different speeds from the same seed commit byte-identical `SimState` at every step
and identical series.

**PB6.2 — speed change mid-transition: recompute the remaining phases only.**
Progress is held as `τ ∈ [0,1]`, never as an absolute end-timestamp. On a change
at frame time `t₀` with current `τ₀`:

```
beatDuration ← speedToDuration(newSpeed)          // clamped: newSpeed ∈ [SPEED_MIN, SPEED_MAX], finite; 0 / NaN / ∞ rejected, keep current
remaining    ← (1 − τ₀) · beatDuration
// each later frame:  τ ← max(τ_prev, τ₀ + (now − t₀) / beatDuration)   (clamped to 1)
```

- `τ` is **monotonic non-decreasing** — the `max(τ_prev, …)` guard means repeated
  or conflicting speed changes can never rewind the token;
- the fixed beat-boundary `τ` fractions do not move; a beat already passed is not
  replayed;
- a callback that crosses a beat boundary fires that boundary's hook **at most
  once** — the `arrive` hook by a per-transition `arriveFired` boolean (it dies
  with the transition), the `settle` hook by the §PB7.7 ladder
  (`transitionId === lastSettledTransitionId` ⇒ `"already-settled"`) — so an
  overlong frame or a mid-flight speed change cannot produce a double `arrive`
  or a double `settle`;
- `settle` runs **exactly once** per `preparedTransition`, whichever way `τ`
  reached `1` (normal, fast-forward, or a giant frame gap).

`<animateMotion>` impl: restart the element with `begin = −(τ₀ · beatDuration)`
and the new `dur`. JS rAF impl: swap `beatDuration`, keep `τ₀` / `t₀`. Same
result.

**PB6.3 — a floor.** `beatDuration` has a minimum (proposed ~120 ms total) so
"fastest" is still a visible frame. Instant advancement is **Step** (which
fast-forwards) or the timeline scrubber, not a speed value.

## PB7. Cancellation

**PB7.1 — Pause vs discard.**

| trigger | `preparedTransition` | store | RNG / step / series / Workspace |
|---|---|---|---|
| **Pause** | kept, `τ` frozen | unchanged (`S(t)`) | untouched |
| **Reset** | **discarded** | → step 0 | reset to step-0 state; no trace of the discarded step |
| **Workspace / Graph Import** | **discarded** | → the imported `SimState` | as imported |
| **Undo / Redo** | **discarded** | → the history frame | as that frame |
| **any GraphDoc edit** (add/remove/move/connect/retarget, Inspector change, route toggle, Apply) | **discarded** | → sim reset to step 0 (the existing `simulationRev` rule) | reset |

**PB7.2 — a discarded transition leaves no trace.** Because `preparedTransition`
holds `to` and it is **not committed until `settle`**, discarding it means:
`stepIndex` never advanced, no `series` point was appended, `commitEpoch` never
bumped, and no Workspace/Share/revision bytes changed. The RNG is keyed
(§PB1.1a), so there is nothing there to move or restore either. The engine is
exactly where it was before the transition was prepared. (This is the main reason
the round-1 two-clock model was wrong: there, `S(t+1)` was already committed, so a
discard had to *roll back* the store; here there is nothing to roll back.)

**PB7.3 — stale-callback guard.** The scheduler holds two scalars:
`activeTransitionId` (the id of the current `preparedTransition`, or `null`) and
`lastSettledTransitionId` (the id of the most recent transition that `settle`
committed). A fresh `transitionId` is minted when a transition is prepared;
teardown (any PB7.1 row except Pause) clears `activeTransitionId`. Every
scheduled callback (`requestAnimationFrame`, `animationend` / `animationcancel`,
`setTimeout` beat hook, count-up frame) captures the id it was armed under and,
as its first line, `if (id !== activeTransitionId) return;`. So a callback from a
discarded transition — or from transition `K` after `K+1` was prepared — is
inert. Timers/animation handles are also cleared on teardown; there is **no
unbounded set of fired ids** — the two scalars are the whole guard.

**PB7.4 — no partial commit.** The value update is the `settle` beat and `settle`
is atomic and last, so a discarded transition never leaves a half-applied
display: either `settle` ran (store = `S(t+1)`) or it did not (store = `S(t)`),
and the post-discard authoritative render is correct either way.

**PB7.5 — commit-time revalidation (compare-and-swap).** `transitionId` alone is
not enough — it proves "this callback belongs to the current transition", not
"the world is still the one this transition was prepared against". So the moment
before it mutates, `commitPrepared(prepared)` checks, against the live store:

| checked | pass condition | what a mismatch means |
|---|---|---|
| **`commitEpoch`** | `prepared.expectedCommitEpoch === store.commitEpoch` | the committed sim state was replaced since prepare — a `settle`, Reset, Import, Undo/Redo, Workspace load, or a timeline scrub (§PB2.7a) |
| **`simulationRev`** | `prepared.expectedSimulationRev === store.simulationRev` | the GraphDoc was edited since prepare |
| **step index** | `prepared.fromStep === store.stepIndex` | redundant with `commitEpoch` but cheap; also catches a same-epoch programmatic step |
| **liveness** | `prepared.transitionId === activeTransitionId` | this transition was already torn down |

(No RNG check — the RNG is keyed, not cursored, §PB1.1a.) If **any** check fails
→ return `"stale"` and perform **zero** mutation (`SimState`, `stepIndex`,
`series`, "last FlowEvents", `commitEpoch` all untouched). The scheduler then
discards the `preparedTransition` and — if Play is still running — prepares a
fresh one from the *current* committed state on the next tick. A `"stale"` result
is normal (something authoritative changed mid-animation), logged at debug level
only.

**PB7.6 — prepare determinism.** `prepareTransition` is a pure function of
`(nodes, edges, S, seed)`:

- calling it **twice** on the same inputs returns state-identical `events` and
  `toState`;
- it touches **no RNG state** — there is none to touch (§PB1.1a); N repeated
  prepares are pure computation and leave the store byte-identical;
- it **does not mutate its inputs** — passing a deep-`Object.freeze`d
  `{ nodes, edges, S }` must not throw and must not attempt a write (the engine
  copies where it needs scratch space).

This is what makes Pause→Resume safe (Resume re-uses the *stored* `prepared`, it
does not re-prepare) and PB7.5's "recompute from the current state after a
`stale`" deterministic.

**PB7.7 — the `commitPrepared` decision ladder (fixed order).** `commitPrepared`
evaluates, in this exact order, and stops at the first match:

```
prepared.transitionId === lastSettledTransitionId  →  "already-settled"   (zero mutation)
prepared.transitionId !== activeTransitionId       →  "stale"             (zero mutation)
CAS mismatch (§PB7.5: commitEpoch / simulationRev / fromStep)  →  "stale" (zero mutation)
otherwise                                          →  atomic commit; set lastSettledTransitionId = transitionId;
                                                      clear activeTransitionId;  return "committed"
```

`lastSettledTransitionId` is the **only** id retained after a commit — no
unbounded fired-id set. `settle` therefore commits exactly once across every
path:

| path | why it's once |
|---|---|
| the `settle` beat hook fires twice (overlong-frame re-entry) | 2nd call hits `transitionId === lastSettledTransitionId` → `"already-settled"` |
| Pause / Resume toggled many times, then the transition completes | Pause/Resume never call `commitPrepared`; only the final `settle` does |
| a giant frame gap jumps `τ` from `0.3` to `2.0` in one tick | one `settle` hook call; the `arrive` hook has a per-transition `arriveFired` boolean (dies with the transition) so it also fires once |
| a speed change pushes `τ` across `arrive` / `settle` in one frame | same — one hook call each |
| a stale callback from `K` and a fresh callback from `K+1` in the same tick | `K`'s callback: `id !== activeTransitionId` → returns early (PB7.3); `K+1`'s `settle` commits once |

## PB8. Background tab / frame starvation

**PB8.1 — the clock is wall-clock, not frame-count.** Each tick advances `τ` by
`elapsedMs / beatDuration`; a long inter-frame gap advances `τ` proportionally —
the transition does not stall just because `requestAnimationFrame` stopped
firing.

**PB8.2 — one giant frame gap ⇒ fast-forward the current transition only.** If a
frame gap pushes `τ ≥ 1` for the active transition, its `settle` fires **once**
(PB6.2) and commits `S(t+1)`. The scheduler does **not** then prepare-and-settle
`t+2, t+3, …` inside the same callback. Instead, after that one `settle`, the
normal Play loop prepares `t+2` on the **next** tick. Consequences:

- **no burst of pre-committed steps** — the store advances one step per
  scheduler tick even when catching up;
- a `MAX_SETTLES_PER_TICK` cap (proposed **1** for Play; a small N only for the
  explicit "skip to end" control, if that is ever added) guarantees a single
  callback cannot monopolise the main thread;
- **every committed step is written to the timeline series exactly once**, in
  order — catch-up changes *when* a step commits, never *whether* or *how many
  times*;
- **"skip-to-latest" means skipping visual phases (depart/travel/arrive), not
  state steps.** There is no path by which `stepIndex` jumps by more than the
  number of `settle` commits that actually ran.

**PB8.3 — `document.hidden`.** While hidden, the Play loop **does not prepare new
transitions** (the engine is not run ahead). Any transition that was mid-flight
when the tab hid is fast-forwarded to its single `settle` on the way out (PB8.2),
so on `visibilitychange` back the store is a clean committed step with no
`preparedTransition`, and Play resumes preparing forward from there. Steps
committed by explicit **Step** presses before hiding stay committed.

**PB8.4 — determinism unaffected.** None of PB8 touches the engine or the RNG. A
run backgrounded for a minute and one watched throughout commit identical
`SimState` at every step, identical series, identical final state.

## PB9. `prefers-reduced-motion`

**PB9.1 — same prepared result, no travel, no artificial wait.** Under reduced
motion the `preparedTransition` is computed identically (same `events`, same `to`,
same RNG result). The choreography then:

- shows **no travelling element** (no token, no `<animateMotion>`);
- shows the **depart** (source handle emphasis), **path** (a one-shot end-to-end
  stroke highlight — the existing `.flow-edge-pulse`, no motion), and **arrive**
  (target handle emphasis) cues **briefly** or all at once — the ordering is the
  information, so it is not removed, but it is **not padded to a long duration**;
- runs `settle` (value delta chip, state effects) — a very short count-up or an
  immediate snap.

**PB9.2 — timing.** `beatDuration` may collapse toward its floor so the sequence
is quick; it must not stretch playback out. Step still fast-forwards; Play still
paces one transition at a time.

**PB9.3 — Pause still holds.** Reduced motion does **not** auto-`settle` a Paused
transition. If the user Paused mid-transition, it stays at `S(t)` with `τ` frozen
until Resume/Step/cancel — same as full-motion (PB5).

**PB9.4 — parity.** The committed `SimState` at every step, the timeline series,
and the RNG result are **identical** to a full-motion run of the same seed.
Reduced motion changes only which visual elements render and for how long.

**PB9.5 — extends the Slice 1 contract.** Slice 1 already guarantees "zero
`<animateMotion>` under the edge, a static `.flow-edge-pulse` on the same path"
under reduced motion; Playback keeps that and adds the ordered depart/arrive
emphasis.

## PB10. What is explicitly OUT of per-token choreography

- **Monte Carlo.** Hundreds of seeded headless runs — no single canvas timeline
  to choreograph. Keeps its progress strip + distribution view. No tokens. Its
  start point is the committed `SimState` (PB2.4).
- **Predict / any look-ahead estimate.** Computes state without a canvas
  transition — numbers / bands, not tokens.
- **The timeline scrubber.** Dragging to step `K` **jumps** the canvas + store to
  `series[K]` with no travel choreography (navigation, not playback). Play from
  there resumes forward choreography from `K`.
- **Autosave / load / share-link open.** Show state directly; the first Play
  press is the first choreography.

## PB11. Non-negotiable invariants (PB-INV)

| id | invariant |
|---|---|
| **PB-INV-1** | The engine computes `from → events → to` for a step **before** any visual is scheduled, and the choreography is a pure function of that result — it calls no engine code and never re-orders/coalesces events. The RNG is fully keyed (`loop-rng/1`, §PB1.1a); playback introduces no RNG cursor and consumes no RNG state. |
| **PB-INV-2** | The store changes **only** at `settle`, which applies `to` / `stepIndex+1` / the appended `series` point / the "last FlowEvents" field / `commitEpoch += 1` in **one atomic transaction**. Before `settle` the store is `S(t)`; after, `S(t+1)`. `committedStep === revealedStep` at every instant. |
| **PB-INV-3** | Every reader of sim state — Canvas, Inspector, Register panel, Timeline (cursor **and** line), autosave, Workspace / Share / revision export, Monte-Carlo / Predict start — reads the committed store and therefore sees `S(t)` throughout a transition and `S(t+1)` only after `settle`. No separate "revealed" snapshot exists. |
| **PB-INV-4** | Exactly one `preparedTransition` exists at a time. Play prepares `t+2` only after `t+1`'s `settle`. It is never a queue; the engine is never run ahead of the choreography. |
| **PB-INV-5** | A discarded `preparedTransition` (Reset / Import / Undo / Redo / edit) leaves **no trace**: `stepIndex` did not advance, no `series` point was appended, `commitEpoch` did not bump, no Workspace / Share / revision bytes changed. (The RNG is keyed — nothing there to move.) |
| **PB-INV-6** | `settle` commits **exactly once** per `preparedTransition` via the §PB7.7 ladder (`transitionId === lastSettledTransitionId ⇒ "already-settled"`); the `arrive` hook fires at most once via a per-transition boolean. Holds regardless of frame gaps, fast-forward, or speed changes. `τ` is monotonic non-decreasing. No unbounded fired-id set — only the scalar `lastSettledTransitionId`. |
| **PB-INV-7** | A callback whose captured id ≠ `activeTransitionId` is inert — it cannot move a token, advance `τ`, or fire `settle`, for its own (discarded) transition or any later one. |
| **PB-INV-8** | Speed, Pause/Resume, tab visibility, and frame starvation change only **wall-clock pacing**. From one seed: identical committed `SimState` at every step, identical series, identical step count. Speed cannot be 0 / NaN / ∞. |
| **PB-INV-9** | Every travelling / highlighted element for an edge uses that edge's **exact rendered `d`** (Bézier or orthogonal). No chords. |
| **PB-INV-10** | All events of one step share one `τ` axis; the value update is the last beat (`settle`). Never value-first-then-travel. |
| **PB-INV-11** | Background catch-up commits **one step per scheduler tick** (`MAX_SETTLES_PER_TICK`), writes every committed step to the series **exactly once**, and never advances `stepIndex` by more than the number of `settle`s that ran. "Skip-to-latest" elides visual phases only. |
| **PB-INV-12** | A summed edge token is a presentational group-by; `preparedTransition.events` keeps every original `FlowEvent` with its origin / category / order. Sign handling (+ / 0 / −) is explicit; a `StateEvent` is never merged into a resource token. |
| **PB-INV-13** | `prefers-reduced-motion` ⇒ zero moving elements and no artificially long wait; the depart / path / arrive / settle beats still play (brief or immediate) in order; the committed state, series, and drawn random values are identical to a full-motion run of the same seed; a Paused transition is **not** auto-settled. |
| **PB-INV-14** | No GraphDoc, `loop-revision/*` digest, `SimState` shape, timeline series shape, Share link, or Workspace (`loop-workspace/1`) format change. No new `loop-*/N`. Monte Carlo / Predict untouched and tokenless. |
| **PB-INV-15** | The whole layer is render-side and disposable: destroying the scheduler leaves no residue in any store that persists or serialises. |
| **PB-INV-16** | Playback commits sim state **only** through `commitPrepared(prepared)`, never through `advance`. Its decision ladder is the fixed order of §PB7.7: `already-settled` (id === `lastSettledTransitionId`) → `stale` (id !== `activeTransitionId`) → `stale` (CAS: `commitEpoch` / `simulationRev` / `fromStep`) → atomic commit. Every non-`committed` result performs **zero** mutation. |
| **PB-INV-17** | `prepareTransition` is a pure function of `(nodes, edges, S, seed)`: repeat calls return identical `events` / `toState`; it touches no RNG state (there is none); it never mutates its inputs (safe on deep-frozen inputs). |
| **PB-INV-18** | Legacy immediate `advance` and the playback path bottom out in the **same** pure engine primitive (`step(nodes, edges, prev, seed)`) and produce identical results: `advance(S) ≡ prepareTransition({nodes, edges, S, seed}) → commitPrepared(…)`. Only the Step / Play UI uses the split path; MC / Predict / test-stepping keep the tokenless immediate path. |
| **PB-INV-19** | `commitEpoch` is a monotonic session-scoped integer bumped on every committed-state replacement (`settle`, Reset, Import, Undo, Redo, Workspace load, timeline scrub). It is **never** serialised into `SimState`, the timeline series, the Workspace payload, the Share link, or the GraphDoc, and is not restored on load. A GraphDoc edit is caught by `simulationRev`, not `commitEpoch`. |

## PB12. Acceptance / E2E (every slice)

1. **Determinism vs speed** — seed `S` to step `K` at slow speed, at fastest
   speed, and via Step-spam; the committed `series` and final `SimState` are
   byte-identical across all three.
2. **Commit-on-settle** — during `depart`/`travel`/`arrive`, the store's
   `stepIndex`, `values`, and `series.length` are unchanged (`= t`); a Workspace
   Export taken at sampled `τ < 0.95` encodes step `t` with a series ending at
   `t`; only after `settle` do they read `t+1`.
3. **One clock** — at sampled `τ` mid-`travel`: the node value text, the Register
   panel, the timeline cursor, and the timeline line all read step `t`
   simultaneously.
4. **One path** — for a Bézier edge and an orthogonal edge, the token's
   `animateMotion` path (or sampled JS positions) lies on the edge's rendered `d`.
5. **Backpressure** — with Play running, exactly one `preparedTransition` exists;
   step `t+2` is not prepared before `t+1`'s `settle`; `t+2` tokens never appear
   before `t+1` `settle`.
6. **Pause/Resume** — Pause mid-`travel`: token bounding boxes stable across
   500 ms, store fields unchanged, `preparedTransition` still present; Resume
   completes the **same** transition (no jump to `τ=0`, no re-prepare) and
   `settle` commits `S(t+1)` once.
7. **Discard leaves no trace** — Reset / Import / Undo / a node move mid-`travel`:
   within one frame zero tokens and the new authoritative state; the discarded
   step is absent from `series`; `commitEpoch` did not bump for a discarded
   transition; then start a new transition and confirm the pre-discard
   transition's late `rAF` / `animationend` callbacks are no-ops
   (`id !== activeTransitionId`).
8. **`settle` exactly once** — force an overlong frame (fake timers) that pushes
   `τ` from `0.3` to `2.0` in one tick, and change speed mid-flight: `settle`
   fires once, the series gains exactly one point, `stepIndex` advances by one.
9. **Background catch-up** — drive Play, emulate `document.hidden` for a spell,
   restore: the store advances **one step per tick** on catch-up, every step
   appears in `series` exactly once and in order, no token backlog, no console
   error, final state matches a foreground run.
10. **Speed guards** — setting speed to 0 / NaN / a negative value is rejected
    (speed stays at its last valid value); rapid alternating speed changes never
    move a token backwards.
11. **Reduced motion** — `prefers-reduced-motion: reduce`: zero `<animateMotion>`
    during a transition; the depart/path/arrive cues appear briefly; total
    transition wall-time ≤ the full-motion floor; committed `series` and drawn
    random values identical to a full-motion run of the same seed; a Paused
    transition stays Paused (no auto-settle).
12. **L0** — zoom `< 0.45`: no travelling dot; the path pulse + arrival cue +
    `settle` value update still play in order and `settle` still commits.
13. **Summed tokens** — two `FlowEvents` on one edge in one step ⇒ one token,
    label = the exact sum, and the edge's hover/select breakdown lists both with
    their origins; a net-zero +/− pair still shows both component cues;
    `> MAX_PLAYBACK_TOKENS` ⇒ still one token, exact summed label, `+N`
    affordance; `to` unchanged in every case.
14. **MC / Predict untouched** — a Monte-Carlo run shows no tokens and its result
    equals today's oracle; Predict shows numbers, no tokens.
15. **VL / revision carry-over** — GraphDoc bytes, `loop-revision/3` digest, undo
    stack, edge `d`, viewport unchanged by playing / pausing / discarding a run.
16. **CAS `stale`** — prepare a transition, then between prepare and `settle`
    do one of: edit the graph (`simulationRev` bumps), scrub the timeline
    (`commitEpoch` bumps, committed `SimState` swapped), Undo/Redo, or Import.
    At `settle`, `commitPrepared` returns `"stale"` and **no** store field
    changed; Play then re-prepares from the current committed state.
17. **Prepare determinism / frozen inputs** — call `prepareTransition` 100× on
    the same deep-`Object.freeze`d `{ nodes, edges, S, seed }`: identical
    `events` / `toState` every time, no throw, and the whole store is
    byte-identical after all 100 calls.
18. **`settle` exactly once — the matrix** — for each row of §PB7.7 (double beat
    fire, Pause/Resume loop, giant frame gap, speed across a boundary, same-tick
    stale+fresh callbacks): the `series` gains exactly one point and `stepIndex`
    advances by exactly one; the redundant call returns `"already-settled"`.
19. **Legacy-path equivalence** — for a seed and step, `advance(S)` and
    `prepareTransition({ nodes, edges, S, seed }) → commitPrepared(…)` produce
    byte-identical `SimState` and `series` point (same keyed draws). A
    Monte-Carlo run (immediate path) and a step-by-step Play of the same seed
    reach the same per-step states.

## PB13. Implementation slices (Decided)

- **Slice 1 — the state machine, no real choreography.** The store's
  `commitEpoch` field (§PB2.7a) + its bumps on Reset/Import/Undo/Redo/Workspace-
  load/scrub; `prepareTransition` + `commitPrepared` with the §PB7.7 decision
  ladder (`already-settled` → `stale` → CAS `stale` → atomic commit), the
  §PB7.6 purity guarantees, the `activeTransitionId` / `lastSettledTransitionId`
  scalars; the `preparedTransition` + `τ` scheduler, Step/Play backpressure
  (§PB3, incl. one-commit-per-click, §PB3.3), Pause/Resume (§PB5), discard guard
  (§PB7), background one-`settle`-per-tick (§PB8); the `advance` =
  `prepareTransition → commitPrepared` refactor (§PB2.8). **Visuals are minimal**
  — the existing single flow bead may be retimed onto the beats, but no new
  token / trail / breakdown UI. Ships when §PB12 tests 1–3, 5–10, 16–19 are
  green and no v1 sim / MC / Predict behaviour moved (PB-INV-18).
- **Slice 2 — the choreography.** `depart → travel → arrive` on the real
  Bézier / orthogonal `d` (§PB4.1), the resource token + count-up on `settle`,
  Pause/Resume freezing token positions, speed re-rate mid-travel (§PB6.2),
  the summed-token visual + `events`-list breakdown (§PB4.5), event ordering
  within a beat (§PB2.6). §PB12 tests 4, 6, 13 join the gate.
- **Slice 3 — the edges.** `prefers-reduced-motion` (§PB9), zoom LOD / L0
  elision (§PB4.4), background-tab visual behaviour polish, the mobile
  view/run layout, and the full visual + E2E matrix (light/dark × the LOD
  levels × reduced-motion). §PB12 tests 11, 12, 15 join the gate. State-event
  choreography (`trigger` travelling beat, `activator` tint, `label` delta
  token) also lands here or as a small Slice 3b.

## PB14. Decisions (all closed)

| id | decision |
|---|---|
| **PB-Q1** delayed `trigger` visual | **Decided:** delivery-step choreography only; the emit step shows a brief static "queued" cue at the source, no travel and no in-flight marker across the wait (keeps it a pure function of that step's `events`). |
| **PB-Q2** `settle` count-up | **Decided:** a short count-up tween in full motion, an immediate snap under `prefers-reduced-motion`; both land on `toState`; the tween is cosmetic and never gates `commitPrepared` (which has already run). |
| **PB-Q3** Step-spam / Play-during-transition | **Decided:** instant advance to `settle` (τ → 1, one `commitPrepared`), not a fast catch-up play. Step is the escape hatch. |
| **PB-Q4** token caps | **Decided:** `MAX_PLAYBACK_TOKENS = 12` per edge per step; global per-step cap `MAX_PLAYBACK_TOKENS_TOTAL = 60`. Past a cap only the `+N` affordance changes; the summed amount stays exact; `toState` untouched. Both are one constants block, tunable. |
| **PB-Q5** timeline scrubber | **Decided:** always jump (navigation, not playback); a scrub commits `series[K]` to the store like today. "Play from here" is just pressing Play. No scrub-with-choreography. |
| **PB-Q6** commit API | **Decided:** a **dedicated `commitPrepared()`**, not a reuse of `advance`. `advance` is refactored to `prepareTransition` + an immediate `commitPrepared` so both paths share the pure primitive (§PB2.7 / §PB2.8 / PB-INV-16/18). |
| **PB-D1** RNG | **Decided (verified against the code):** `loop-rng/1` (`src/engine/rng.ts`, `SEMANTICS-B1.md §B1.2`, frozen) is **fully keyed** — "there is no PRNG object threaded through a run; every random value is a pure total function of `(seed, step, elementId, purpose, drawIndex)`". So there is **no RNG cursor** anywhere in the design: `preparedTransition` has no `rngAfter`, `commitPrepared` commits no RNG state, the CAS has no RNG row, and `seed + fromStep` are named `prepareTransition` inputs (§PB1.1a). The playback layer must not introduce a cursor. If a future `loop-rng/2` ever adds one, this decision is revisited then, not pre-authorised here. |
| **PB-D2** state-effect timing in Slice 1 | **Decided:** until Slice 2/3, existing `trigger` / `activator` / `label` cues keep their current single-step form but are triggered on the `settle` beat (not on raw `stepIndex` change), so they stay aligned with the committed state. |

**Deferred (explicit, out of this cycle):** a "record / export the animation"
feature; camera moves / auto-pan-to-action; scrub-with-choreography; per-token
lanes beyond the cap; any Predict visualisation change.

## PB15. Scope boundary

**In:** `prepareTransition` + `commitPrepared` and the `advance` refactor; a
render-side scheduler holding one `preparedTransition`; the single atomic
`settle` commit with CAS; resource + state event choreography along real edge
paths; Pause/Resume/speed/discard semantics; background catch-up; reduced-motion
and L0 behaviour; the acceptance set.

**Out (this doc):** any engine change; any new persisted or serialised field; any
`loop-*/N`; Monte-Carlo / Predict token animation; a "record / export the
animation" feature; camera moves / auto-pan-to-action (possible later, separate).
