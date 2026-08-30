# Simulation Playback / Event Choreography (non-frozen design doc — DRAFT)

**Status: DRAFT for review (round 2).** Round 1's `committedStep ≥ revealedStep`
two-clock model is **withdrawn**. The state model is now **one committed clock +
a single `preparedTransition` with progress `τ`** (§PB2). A **presentation-only**
layer over the existing engine: when the user presses **Play** (or **Step**), the
next step is computed in full but **not committed**; resources visibly leave a
source, travel the real edge path, arrive, and then — in **one atomic commit at
`settle`** — `SimState` / step index / timeline series advance together. It does
**not** touch the engine's determinism, the RNG result, state semantics,
Monte-Carlo, the GraphDoc, the `loop-revision/*` digest, or the Workspace format.
This doc carries no `loop-*/N` id and is revised freely (like
`docs/visual-language.md`, `docs/edge-routing.md`).

It supersedes the ad-hoc "flow bead" that the Canvas Visual Refresh (v0.6.0) and
Orthogonal Routing Slice 1 (v0.7.0-dev) ship today: one `<animateMotion>` token
per active edge, fire-and-forget, with no ordering, no backpressure, and no
relationship to when the number on a Pool updates. This doc pins down what "the
model comes alive when you press Play" means for Loop Studio **before any
implementation**.

**Build order:**
1. this design doc → review → settle;
2. implementation slices (proposed in §PB13), each behind the same acceptance
   set (§PB12);
3. no wire/spec amendment is expected — if one turns out to be needed, it stops
   and gets its own frozen `loop-*/N` (this doc does not pre-authorise it).

**Review focus (round 2):**

| question | pinned in |
|---|---|
| compute vs commit — when does `S(t+1)` reach the store? | §PB1.1–PB1.2, §PB2.2 — computed at prepare, **committed once at `settle`**; `committedStep === revealedStep` always |
| what do Canvas / Inspector / Register / Timeline / autosave / Workspace show during a transition? | §PB2.4 — **all of them read the last committed state `S(t)`**; the only extra thing that exists is `preparedTransition` + `τ` |
| cancellation — Pause vs Reset/Import/Undo/edit | §PB7 — Pause **keeps** `preparedTransition` (τ frozen); the rest **discard** it, leaving no trace in RNG / step / series / Workspace |
| do backpressure + background catch-up drop or double-count a step? | §PB3.2, §PB8 — one `preparedTransition` at a time; every committed step is written to the Timeline **exactly once**; "skip-to-latest" elides visual phases, never a state step |
| speed change mid-transition | §PB6 — keep `τ`, recompute only the remaining phases; no speed 0 / invalid; `τ` never decreases; `settle` fires **exactly once** |
| reduced motion | §PB9 — same prepared result; no travel element; short depart/path/arrive cue or immediate `settle`; **no auto-`settle` while Paused** |
| summing several `FlowEvents` on one edge | §PB4.5 — token visual may merge; the events list keeps every original `FlowEvent` (origin / category / order); state events never merged |

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
committed  S(t)                     ← the ONLY authoritative sim state right now
   │  pure engine step (no store write, no visible change)
   ▼
preparedTransition = {
   fromStep: t,
   from:     S(t),                  ← a reference to the committed state
   events:   FlowEvents[] + StateEvents[],   ← the engine's own per-step lists, verbatim
   to:       S(t+1),               ← fully computed, NOT yet committed
   rngAfter: <engine cursor after t+1, if the engine has one>,
   τ:        0                      ← animation progress, [0, 1]
}
   │  depart → travel → arrive        (τ advances; store still shows S(t))
   ▼
settle  ── ONE atomic commit ──▶  committed S(t+1)   (SimState + stepIndex + series + rng, together)
```

`from` / `to` are `SimState` values; `events` is the engine's existing per-step
output, **passed through unchanged** — the choreography never re-orders,
coalesces, or invents events. Computing `preparedTransition` performs no store
write and no visible change; if the engine carries an advancing RNG cursor, that
cursor's advance is part of the **`settle` commit**, not of prepare (so a
discarded `preparedTransition` leaves the RNG exactly where it was — §PB7).

**PB1.2 — `settle` is the single commit point.** `settle` (the last beat, §PB2.1)
is the *only* place the store changes during playback. It applies `to` /
`stepIndex+1` / the appended `series` point / the RNG cursor **in one update** —
the same one `advance` action the store performs today, just deferred to the end
of the choreography. Before `settle`: the store is `S(t)`. After `settle`: the
store is `S(t+1)` and there is no `preparedTransition` until the next one is
prepared. There is never a moment where the store is "half a step ahead".

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

**PB3.3 — an input during an active transition.**

- **Step again / Play pressed:** the in-flight transition is **advanced straight
  to `settle`** (τ → 1 instantly): tokens jump to arrival, `settle` commits
  `S(t+1)` **exactly once**, then the next step is prepared. No step is skipped —
  the user chose to skip its *travel*, not its commit.
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
current value. `preparedTransition` (its `from`, `events`, `to`, `rngAfter`, and
`τ`) is **retained**. Tokens hold their exact positions. **Nothing is committed**
— the store is still `S(t)` (PB2.4), and stays there until Resume/Step drives the
transition to `settle`, or a cancel discards it.

**PB5.2 — Resume continues the same transition.** Resume restarts the `τ` clock
from the frozen value toward `1` using the **already-computed** `preparedTransition`
— same `events`, same `to`, same `rngAfter`. Nothing is recomputed and no RNG is
consumed on Resume (it was computed once at prepare). No jump to `τ = 0`.

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
- a callback that crosses a beat boundary fires that boundary's hook (`arrive`,
  `settle`) **at most once** — each hook is guarded by a `firedBeats` set on the
  `preparedTransition`, so an overlong frame or a mid-flight speed change cannot
  produce a double `arrive` or a double `settle`;
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
holds `to` and `rngAfter` and **neither is committed until `settle`**, discarding
it means: `stepIndex` never advanced, no `series` point was appended, the RNG
cursor never moved, and no Workspace/Share/revision bytes changed. The engine is
exactly where it was before the transition was prepared. (This is the main reason
the round-1 two-clock model was wrong: there, `S(t+1)` was already committed, so a
discard had to *roll back* the store; here there is nothing to roll back.)

**PB7.3 — stale-callback guard.** One monotonic `transitionId`, bumped when a
transition is prepared **and** when the scheduler is torn down (any row above
except Pause). Every scheduled callback (`requestAnimationFrame`, `animationend`
/ `animationcancel`, `setTimeout` beat hook, count-up frame) captures the id it
was armed under and, as its first line, `if (id !== scheduler.currentTransitionId)
return;`. So a callback from a discarded transition — or from transition `K`
after `K+1` has been prepared — is inert: it cannot move a token, advance `τ`, or
fire `settle`. Timers/animation handles are also cleared on teardown (belt and
braces), and there is no queue for a passed-through callback to act on.

**PB7.4 — no partial commit.** The value update is the `settle` beat and `settle`
is atomic and last, so a discarded transition never leaves a half-applied
display: either `settle` ran (store = `S(t+1)`) or it did not (store = `S(t)`),
and the post-discard authoritative render is correct either way.

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
| **PB-INV-1** | The engine computes `from → events → to` for a step **before** any visual is scheduled, and the choreography is a pure function of that result — it calls no engine code and never re-orders/coalesces events. If the engine has an advancing RNG cursor, prepare does not move it. |
| **PB-INV-2** | The store changes **only** at `settle`, which applies `to` / `stepIndex+1` / the appended `series` point / the RNG cursor in **one atomic update**. Before `settle` the store is `S(t)`; after, `S(t+1)`. `committedStep === revealedStep` at every instant. |
| **PB-INV-3** | Every reader of sim state — Canvas, Inspector, Register panel, Timeline (cursor **and** line), autosave, Workspace / Share / revision export, Monte-Carlo / Predict start — reads the committed store and therefore sees `S(t)` throughout a transition and `S(t+1)` only after `settle`. No separate "revealed" snapshot exists. |
| **PB-INV-4** | Exactly one `preparedTransition` exists at a time. Play prepares `t+2` only after `t+1`'s `settle`. It is never a queue; the engine is never run ahead of the choreography. |
| **PB-INV-5** | A discarded `preparedTransition` (Reset / Import / Undo / Redo / edit) leaves **no trace**: `stepIndex` did not advance, no `series` point was appended, the RNG cursor did not move, no Workspace / Share / revision bytes changed. |
| **PB-INV-6** | `settle` runs **exactly once** per `preparedTransition`, and each beat hook (`arrive`, `settle`) fires at most once, regardless of frame gaps, fast-forward, or speed changes. `τ` is monotonic non-decreasing. |
| **PB-INV-7** | A stale callback (id ≠ `currentTransitionId`) is inert — it cannot move a token, advance `τ`, or fire `settle`, for its own transition or any later one. |
| **PB-INV-8** | Speed, Pause/Resume, tab visibility, and frame starvation change only **wall-clock pacing**. From one seed: identical committed `SimState` at every step, identical series, identical step count. Speed cannot be 0 / NaN / ∞. |
| **PB-INV-9** | Every travelling / highlighted element for an edge uses that edge's **exact rendered `d`** (Bézier or orthogonal). No chords. |
| **PB-INV-10** | All events of one step share one `τ` axis; the value update is the last beat (`settle`). Never value-first-then-travel. |
| **PB-INV-11** | Background catch-up commits **one step per scheduler tick** (`MAX_SETTLES_PER_TICK`), writes every committed step to the series **exactly once**, and never advances `stepIndex` by more than the number of `settle`s that ran. "Skip-to-latest" elides visual phases only. |
| **PB-INV-12** | A summed edge token is a presentational group-by; `preparedTransition.events` keeps every original `FlowEvent` with its origin / category / order. Sign handling (+ / 0 / −) is explicit; a `StateEvent` is never merged into a resource token. |
| **PB-INV-13** | `prefers-reduced-motion` ⇒ zero moving elements and no artificially long wait; the depart / path / arrive / settle beats still play (brief or immediate) in order; the committed state, series, and RNG result are identical to a full-motion run; a Paused transition is **not** auto-settled. |
| **PB-INV-14** | No GraphDoc, `loop-revision/*` digest, `SimState` shape, timeline series shape, Share link, or Workspace (`loop-workspace/1`) format change. No new `loop-*/N`. Monte Carlo / Predict untouched and tokenless. |
| **PB-INV-15** | The whole layer is render-side and disposable: destroying the scheduler leaves no residue in any store that persists or serialises. |

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
   completes the **same** transition (no jump to `τ=0`, no RNG re-consume) and
   `settle` commits `S(t+1)` once.
7. **Discard leaves no trace** — Reset / Import / Undo / a node move mid-`travel`:
   within one frame zero tokens and the new authoritative state; the discarded
   step is absent from `series`; the RNG cursor is unchanged from before prepare;
   then start a new transition and confirm the pre-discard transition's late
   `rAF` / `animationend` callbacks are no-ops (`transitionId` mismatch).
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
    transition wall-time ≤ the full-motion floor; committed `series` and RNG
    result identical to a full-motion run of the same seed; a Paused transition
    stays Paused (no auto-settle).
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

## PB13. Proposed slices (for discussion — not settled)

- **Slice A — the transition scheduler + resource tokens.** `preparedTransition`
  + the single-commit `settle`, the `τ` scheduler, backpressure, Pause/Resume,
  speed (incl. the guards + `firedBeats`), the discard/`transitionId` guard,
  background catch-up (`MAX_SETTLES_PER_TICK`), reduced motion, L0 elision.
  Resource `FlowEvents` only (depart → travel on the real `d` → arrive → count-up
  on `settle`). State effects keep their current one-step cue but move onto the
  `settle` beat.
- **Slice B — state-event choreography.** `trigger` pulse as a travelling beat,
  `activator` tint flip on `settle`, `label` delta token with direction, the
  "blocked" / clamp annotations on the `arrive` beat. Delayed-`trigger` emit cue
  vs delivery choreography (resolve PB-Q1).
- **Slice C — polish.** Summed-token breakdown UI, per-edge multi-event lanes
  within the cap, source-outflow / target-inflow micro-cues, count-up easing,
  reduced-motion sequence timing.

## PB14. Open questions

- **PB-Q1** — delayed `trigger`: delivery-step choreography only, or also a faint
  in-flight marker across the wait? (Lean: delivery only, for determinism.)
- **PB-Q2** — does `settle`'s value count-up tween or snap? (Lean: short tween
  full-motion, snap under reduced motion; both land on `to`.)
- **PB-Q3** — Step-spam / Play-during-transition: instant `settle` of the
  in-flight transition (current text), or a very fast catch-up play of it?
  (Lean: instant `settle` — Step is the escape hatch.)
- **PB-Q4** — `MAX_PLAYBACK_TOKENS` (12?) and the global per-step token cap for a
  wide graph.
- **PB-Q5** — timeline scrubber: always jump (current text), or an optional
  "scrub with choreography"? (Lean: always jump; "play from here" is just Play.)
- **PB-Q6** — should `settle`'s atomic commit reuse the store's existing
  `advance` action verbatim (preferred — one code path), or a dedicated
  `commitPrepared` that asserts `preparedTransition.fromStep === stepIndex`?

## PB15. Scope boundary

**In:** a render-side scheduler holding one `preparedTransition`; the single
atomic `settle` commit; resource + state event choreography along real edge
paths; Pause/Resume/speed/discard semantics; background catch-up; reduced-motion
and L0 behaviour; the acceptance set.

**Out (this doc):** any engine change; any new persisted or serialised field; any
`loop-*/N`; Monte-Carlo / Predict token animation; a "record / export the
animation" feature; camera moves / auto-pan-to-action (possible later, separate).
