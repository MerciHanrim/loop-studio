# Simulation Playback / Event Choreography (non-frozen design doc — DRAFT)

**Status: DRAFT for review (round 1).** A **presentation-only** layer over the
existing engine: when the user presses **Play** (or **Step**), the already-
computed transition from one simulation step to the next is *choreographed* on
the canvas — resources visibly leave a source, travel along the real edge path,
arrive, and only then does the target's displayed value change. It does **not**
touch the engine, the RNG, `SimState`, `R(t)`, state semantics, Monte-Carlo, the
GraphDoc, the `loop-revision/*` digest, or the Workspace format. This doc carries
no `loop-*/N` id and is revised freely (like `docs/visual-language.md`,
`docs/edge-routing.md`).

It supersedes the ad-hoc "flow bead" that the Canvas Visual Refresh (v0.6.0)
and Orthogonal Routing Slice 1 (v0.7.0-dev) ship today: one `<animateMotion>`
token per active edge, fire-and-forget, with no ordering, no backpressure, and
no relationship to when the number on a Pool updates. This doc pins down what
"the model comes alive when you press Play" means for Loop Studio **before any
implementation**.

**Build order:**
1. this design doc → review → settle;
2. implementation slices (proposed in §PB13), each behind the same acceptance
   set (§PB12);
3. no wire/spec amendment is expected — if one turns out to be needed, it stops
   and gets its own frozen `loop-*/N` (this doc does not pre-authorise it).

**Review focus (round 1 — where the sharp edges are):**

| question | pinned in |
|---|---|
| when does `toState` commit to the store vs become visible on the canvas? | §PB2.4 (two clocks: `committedStep` ≥ `revealedStep`), §PB2.5 (ledger) |
| what snapshot do value / timeline / Register show **while Paused**? | §PB5.3 (table — every viewer surface follows `revealedStep`; the timeline *line* may lead the *cursor* by one step) |
| do Play backpressure + background catch-up ever drop a step? | §PB2.5, §PB3.2, §PB8.2 (every committed step's `settle` runs in order; only *travel visuals* are elided) |
| does summing multiple `FlowEvents` on one edge lose causal info? | §PB4.5 (visual sum only; per-component breakdown kept for inspection; state events never merged) |
| can a stale animation callback touch the **next** transition after cancel? | §PB7.2 (single monotonic `transitionId`; first-line id check; ledger discarded; timers cleared) |
| on a speed change, how is the current transition's remaining time recomputed? | §PB6.2 (progress held as `τ`, not an end-timestamp; `remainingMs = (1−τ₀)·beatDuration`; beat boundaries fixed) |

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

**PB1.1 — order of operations, per step.** A step is computed **first, in full,
synchronously**, exactly as today:

```
step N:  fromState  ──engine──▶  { toState, FlowEvents[], StateEvents[] }
```

`fromState` and `toState` are `SimState` values; `FlowEvents` / `StateEvents`
are the engine's existing per-step event lists. The choreography is a **pure
function of that already-computed triple** — it reads `fromState`, the event
lists, and `toState`, and schedules visuals. It never calls the engine, never
consumes RNG, never re-orders or coalesces events, and never writes back.

**PB1.2 — the displayed value is `toState`, always.** When a transition's
choreography completes, every Pool/Register shows its `toState` value — bit-for-
bit what the engine produced. If the animation is skipped, interrupted, or the
tab was hidden the whole time, the canvas still lands on `toState`. The
animation only controls **when, between "step committed" and "next input
accepted", the eye is guided** — never the destination.

**PB1.3 — no animation-derived state.** Nothing the choreography computes (a
token's position, a lane assignment, an elapsed fraction, a per-edge sum) enters
`SimState`, the timeline series, the GraphDoc, the digest, the Share link, or
the Workspace payload. It lives only in a render-side scheduler that is
discarded on reset.

**PB1.4 — Register `R(t)`.** A Register value is still recomputed from the
committed snapshot each step (`loop-model/1`); the choreography may *reveal* the
new `R(t)` on the same "arrival" beat as the pools it depends on, but it reads
`R(t)` from the engine layer, never re-derives it.

## PB2. The transition timeline — one shared axis per step

**PB2.1 — a transition is a fixed sequence of beats.** For step `N`, every
visual for that step is placed on **one normalised time axis** `τ ∈ [0, 1]`
(mapped to wall-clock by the current speed, §PB6):

| beat | τ window | what happens |
|---|---|---|
| **depart** | `[0.00, 0.15]` | a token appears at each contributing source handle; the source's "outflow" cue plays |
| **travel** | `[0.15, 0.80]` | tokens move along the **real edge path** (§PB4) at constant path-length speed |
| **arrive** | `[0.80, 0.95]` | tokens reach the target handle; the target's "inflow" cue plays |
| **settle** | `[0.95, 1.00]` | **the displayed value updates to `toState`** (count-up / delta chip); state effects (tint, pulse, gate open/close) resolve |

The exact fractions are a single constants block (`PLAYBACK_BEATS`), tunable in
one place, not scattered.

**PB2.2 — every event of step `N` shares this axis.** Two `FlowEvents` on
different edges, a `trigger` `StateEvent`, and a `label` `StateEvent` in the
same step all run against the *same* `τ`. They therefore *depart together*,
*travel together*, and *settle together* — the step reads as one coordinated
frame, not a cascade. Ordering **within** a beat (e.g. which of two arrivals
draws on top) is deterministic: by ascending edge id, then by the flattened
event key, matching the router's tie-break vocabulary.

**PB2.3 — delayed `trigger` delivery.** A `trigger` with `delay > 0` is
delivered by the engine on a later step; its choreography plays on **that**
step's axis (the delivery step), not the emit step. The emit step may show a
brief "queued" cue at the source with no travel. (Open question PB-Q1: whether
to also show a faint in-flight marker across the intervening steps, or keep it
to emit-cue + delivery-choreography only. Lean: delivery only, for determinism.)

**PB2.4 — store commit vs canvas reveal (the two clocks).** These are separate
and must never be conflated:

| | when | authority |
|---|---|---|
| **store commit** | the instant the engine returns step `N+1` (synchronously, before any frame) | `useSimStore` — `stepIndex`, `values`, `series`, `R(t)` inputs are all at `N+1` immediately; the timeline series already contains the point |
| **canvas reveal** | the `settle` beat of `N+1`'s transition (τ ≥ 0.95) | the choreography — the *number rendered on a node*, the Register readout, the state tint, and the timeline **cursor** move to `N+1` here |

So between "engine computed `N+1`" and "`settle` of `N+1`", the **store is one
step ahead of what the canvas shows**. The scheduler tracks this as
`revealedStep ≤ committedStep`. Everything that reads the store directly for a
non-visual purpose (export, digest, Workspace save, `series` length, "ended"
detection) sees `committedStep` and is correct immediately. Everything the
*viewer* reads (node value text, Register panel, timeline cursor, state cues)
follows `revealedStep` and catches up on `settle`. A hard reveal (scrub, Reset,
Import, cancel — §PB7) sets `revealedStep = committedStep` at once with no
choreography.

**PB2.5 — the committed-step ledger.** The engine's per-step outputs
(`fromState`, `events`, `toState`) for every step from `revealedStep+1` to
`committedStep` are held in an ordered in-memory queue the scheduler drains one
transition at a time. It is **append-only during a run and never reordered**;
Play/Step append to it, the choreography shifts from its front, and cancel
(§PB7) discards it wholesale. Because it is drained in order and Play only
appends after the previous `settle`, **no committed step can be skipped over
without its `settle` running** (its travel may be fast-forwarded — §PB3.3, §PB8
— but `settle` always applies that step's `toState` and state effects before the
next is drained).

## PB3. Step vs Play — backpressure

**PB3.1 — Step.** Pressing **Step** computes step `N+1` immediately (engine is
synchronous) and plays its transition choreography **once**. The control
returns to idle when `settle` completes. A second **Step** press *before*
`settle` — see PB3.3.

**PB3.2 — Play = Step on a repeating timer, with backpressure.** Play appends
step `N+1` to the ledger (§PB2.5) and choreographs it; only when that
transition's `settle` beat has completed does it append and choreograph `N+2`.
**Transitions never overlap** — exactly one is active at a time. Play paces the
engine to the choreography, so `committedStep` never runs more than one step
ahead of `revealedStep` under normal Play (it can get further ahead only via
explicit Step-spam or a resumed background run — §PB8 — and even then every
committed step's `settle` still fires in order, so **none is dropped**). Play's
throughput is bounded by `beatDuration` by design (§PB6).

**PB3.3 — an input during an active transition.** Step-again / Play-toggle /
speed-change while a transition is mid-flight:

- **Step again:** the in-flight transition is **fast-forwarded to `settle`
  instantly** (tokens jump to arrival, value snaps to that step's `toState`),
  then the next step's transition begins. No transition is ever silently
  dropped; the user just chose to skip its travel.
- **Play pressed (from Step/idle):** same fast-forward of any in-flight
  single transition, then the Play loop takes over from the current step.
- **Pause pressed:** PB5.

**PB3.4 — "ended".** When the engine reports the run ended (`SimState.ended`),
Play stops after that final transition's `settle`; no empty transitions play.

## PB4. Path fidelity — tokens follow the real edge `d`

**PB4.1 — one path, every consumer.** A travelling token uses the **exact same
path string** the edge renders — `getBezierPath(...)` for a default edge,
`currentRouteMap().get(id).d` for `route: "orthogonal"`. This is the invariant
already enforced for the flow bead in Slice 1 (`e2e/edge-routing.spec.ts` "every
path consumer reads the same d"); Playback extends it to *all* travelling
elements (token, trail, count label, state pulse). No element may follow a
straight chord while the edge is drawn curved or right-angled.

**PB4.2 — direction.** A resource token travels **source-handle → target-
handle**. A `label` `StateEvent` with a negative delta travels **target →
source** (matching the current flash direction). An `activator` has no travel —
it is a steady state, shown as a target tint that flips on `settle`.

**PB4.3 — constant speed along arc length.** The token covers equal path length
per unit `τ` (not equal parameter `t`), so it does not visually accelerate
through an orthogonal corner or a Bézier bulge. `<animateMotion>` with the
path's own length, or a JS rAF sampler — implementation choice, same result.

**PB4.4 — zoom / LOD.** At **L2 / L1** the full token choreography plays. At
**L0** (`docs/visual-language.md` §VL7, zoom `< 0.45`) the per-token travel is
**elided**: the edge shows a brief directional "pulse" along its path plus the
target's arrival cue and value update. Departure and arrival are still ordered
on the `τ` axis; only the moving dot is dropped (it is a sub-pixel distraction
at that zoom). Switching zoom mid-transition re-reads LOD on the next beat, not
retroactively.

**PB4.5 — multiple events on one edge in one step, without losing causality.**
If several `FlowEvents` traverse the same edge in one step, the **visual** is
one token carrying the summed amount (count label = the sum), not N dots — but
the summing is **presentational only**:

- the engine's individual `FlowEvents` are untouched (PB-INV-1); the merge is a
  render-time group-by on `(edgeId, direction)`;
- the merged token keeps a **breakdown** for inspection — hovering / selecting
  the edge during or just after the transition shows the component amounts and
  their origin (which gate output, which source), so "why did Pool X gain 5"
  stays answerable as "3 from the gate's A-branch + 2 from the recycler";
- a `trigger` / `activator` / `label` `StateEvent` on the same edge is **never**
  merged into a resource token — it keeps its own beat (different meaning);
- a hard cap `MAX_PLAYBACK_TOKENS` (proposed **12**) per edge per step, and a
  global per-step cap (PB-Q4), bound the DOM; past the cap it is still one token
  with the summed label + a "+N more" affordance to the breakdown. The cap
  changes nothing about `toState`.

## PB5. Pause / Resume

**PB5.1 — Pause freezes in place.** Pause stops the `τ` clock at its current
value. Tokens hold their exact positions; no beat is forced to complete; the
displayed value stays at whatever the frozen beat shows (still `fromState` if
Pause landed before `settle`).

**PB5.2 — Resume continues.** Resume restarts the `τ` clock from the frozen
value toward `τ = 1`; the same transition finishes, then Play resumes its loop.
Resume never restarts the transition from `τ = 0` and never re-consumes engine
work.

**PB5.3 — which snapshot each surface shows while Paused.** Pause can land
**before** a transition's `settle` (`revealedStep = N`, `committedStep = N+1`) or
**at rest between** transitions (`revealedStep == committedStep`). The rule is
uniform: **every viewer-facing surface shows `revealedStep`.**

| surface | Paused mid-transition (revealed `N`, committed `N+1`) | Paused at rest (revealed == committed == `N`) |
|---|---|---|
| node value text / delta chip | `N` (`fromState` of the frozen transition) | `N` |
| Register `R(t)` panel | `R` recomputed from the **`revealedStep` snapshot** (= `N`) | `R` at `N` |
| timeline cursor | on step `N` | on step `N` |
| timeline series (the plotted line) | full committed series **including `N+1`** — the line is drawn ahead of the cursor, the cursor just hasn't advanced | same |
| state cues (tint / pulse / blocked) | the `revealedStep` state | the `revealedStep` state |
| tokens | frozen at their exact `τ` positions | none |

So the timeline **line** can extend one step past the **cursor** while Paused
mid-transition — that is intentional and readable ("the engine has computed the
next point; playback hasn't walked to it yet"). `Resume` walks the cursor +
values to `N+1` via the rest of that transition; `Step` fast-forwards it; a
scrub or Reset hard-syncs `revealedStep`.

**PB5.4 — Pause is not Reset.** Pause changes no store state at all — not
`stepIndex`, not `series`, not `simulationRev`. It only stops the `τ` clock. All
of `SimState` stays exactly as the engine left it.

**PB5.5 — Pause during the fast-forward of PB3.3 / PB8.** If Pause arrives while
a transition is being fast-forwarded (Step-spam, catch-up), the fast-forward
completes to that step's `settle` first (it is already atomic and near-instant),
then the clock stops with `revealedStep == committedStep`. Pause never freezes a
half-applied `settle`.

## PB6. Speed

**PB6.1 — speed scales wall-clock only.** The speed control maps `τ`'s `[0,1]`
to a wall-clock duration `beatDuration`. Faster = shorter `beatDuration` = the
same beats, compressed. It changes **nothing** about: the engine result, RNG
consumption, the number of steps, the event lists, the order of beats, or which
`toState` is shown. Two runs at different speeds from the same seed produce
byte-identical `SimState` at every step and identical timeline series.

**PB6.2 — speed change mid-transition: remaining time recompute.** The scheduler
holds progress as `τ ∈ [0,1]`, **not** as an absolute end-timestamp. On a speed
change at frame time `t₀` with current `τ₀`:

```
beatDuration      ← speedToDuration(newSpeed)          // the only input that changed
remainingMs       ← (1 − τ₀) · beatDuration            // recomputed from τ₀, not from the old schedule
// each subsequent frame:  τ ← τ₀ + (now − t₀) / beatDuration   (clamped to 1)
```

So the *elapsed* fraction is preserved exactly and only the *rate* of the
remaining fraction changes — no visual jump, no restart, and the beat boundaries
(`depart` / `travel` / `arrive` / `settle` at their fixed `τ` fractions) stay
put. If `newSpeed` is faster and `τ₀` is already past a beat boundary, that beat
is not replayed. A `<animateMotion>`-based implementation restarts the element
with `begin` offset `−(τ₀ · beatDuration)` and the new `dur`; a JS rAF sampler
just swaps `beatDuration` and keeps `τ₀`, `t₀`. Same result either way.

**PB6.3 — a floor.** `beatDuration` has a minimum (proposed ~120 ms total) so
"fastest" is still a visible frame, not an instant snap. A user who wants
instant should use **Step** repeatedly (which fast-forwards) or the timeline
scrubber.

## PB7. Cancellation — Reset / Import / Undo / Redo / any edit

**PB7.1 — these abort the choreography immediately.** Reset, Workspace/Graph
Import, Undo, Redo, and any GraphDoc edit (add/remove/move/connect/retarget,
Inspector change, route toggle, Apply) **cancel any in-flight transition at
once**: every token is removed, the `τ` clock is torn down, and the canvas shows
whatever the new authoritative state is (Reset → step 0; Import → the imported
`SimState`; edit → sim reset to step 0 per the existing `simulationRev` rule).

**PB7.2 — stale-callback guard: an old callback cannot touch the next
transition.** There is **one** monotonic `transitionId`, incremented every time a
transition starts **and** every time the scheduler is torn down (cancel, Reset,
Import, edit). The scheduler exposes `currentTransitionId` (an atomic read).
Every scheduled callback — `requestAnimationFrame` tick, `animationend` /
`animationcancel`, `setTimeout` beat advance, count-up tween frame — captures the
`transitionId` it was armed under and, as its **first line**, does
`if (id !== scheduler.currentTransitionId) return;`. Consequences:

- a callback from a **cancelled** transition is inert (its id is now behind);
- a callback from transition `K` can **never** be mistaken for transition `K+1`
  — `K+1` has a strictly greater id, and `K`'s callbacks were all armed under
  `K`. It cannot advance `K+1`'s `τ`, move `K+1`'s tokens, or fire `K+1`'s
  `settle`;
- `animationId`s / timers are also actively cleared on teardown, so this is a
  belt-and-braces second line, not the only defence;
- the ledger (§PB2.5) is discarded on teardown, so even a callback that somehow
  passed the id check would find nothing to drain.

This generalises the state-effect layer's existing `stepIndex`-keyed React keys.

**PB7.3 — no partial commit.** Because the value update is the `settle` beat and
`settle` is the last beat, a cancelled transition never leaves a half-applied
display: either `settle` ran (value = that step's `toState`) or it did not
(value = previous `toState`), and the subsequent authoritative render corrects
it regardless.

## PB8. Background tab / frame starvation — catch-up policy

**PB8.1 — the clock is wall-clock, not frame-count.** Each tick advances `τ` by
`elapsedMs / beatDuration`, so a long gap between frames advances `τ`
proportionally — the transition does not "pause" just because `requestAnimation
Frame` stopped firing.

**PB8.2 — a large gap collapses travel but never skips a `settle`.** If a single
frame gap exceeds one full transition (`elapsedMs > beatDuration`), the
choreography does **not** replay every intermediate step's travel. It drains the
ledger (§PB2.5) forward: for each committed step from `revealedStep+1` up to the
step the Play loop had reached, it **applies that step's `settle`** (value
update + state effects — cheap, no motion) in order, and only *animates the
travel of the final one*. So `revealedStep` catches up to `committedStep`, every
skipped step's `toState` and state effects **were applied** (in sequence, not
jumped over — this is what "no step dropped" means), and only the *intermediate
travel visuals* are elided. This bounds the animation backlog at one transition.

**PB8.3 — `document.hidden`.** While the tab is hidden, the Play loop **stops
appending to the ledger** (it does not run the engine ahead). On
`visibilitychange` back to visible it resumes from the current `SimState`, with
`revealedStep == committedStep` (any transition that was mid-flight when the tab
hid is fast-forwarded to `settle` on the way out, per PB8.2). Rationale: a hidden
tab has no viewer; `rAF` is throttled to ~0 and running the engine ahead only to
animate it later serves nothing. Steps committed by explicit **Step** presses
before hiding stay committed; Play just resumes choreographing forward from
there — none are lost.

**PB8.4 — determinism unaffected.** None of PB8 touches the engine. A run
backgrounded for a minute and one watched the whole time produce identical
`SimState`, identical series, identical final `toState`.

## PB9. `prefers-reduced-motion`

**PB9.1 — no travel, but the beats still read.** Under reduced motion there is
**no moving token**. The transition still communicates the same three things, in
the same order, either as a short static sequence or all at once:

- **depart:** the source handle briefly emphasised;
- **path:** the edge path briefly emphasised end-to-end (a one-shot stroke
  highlight, no motion — the existing `.flow-edge-pulse` treatment);
- **arrive + settle:** the target handle emphasised and the value updates with a
  delta chip (no count-up tween, or a very short one).

**PB9.2 — timing.** Reduced motion may collapse `beatDuration` toward its floor
so the sequence is quick; it must not collapse to zero (the ordering is the
information). Step still fast-forwards; Play still paces one transition at a
time.

**PB9.3 — this extends the Slice 1 contract.** Slice 1 already guarantees "zero
`<animateMotion>` under the edge, a static `.flow-edge-pulse` on the same path"
under reduced motion (`e2e/edge-routing.spec.ts`). Playback keeps that and adds
the ordered depart/arrive emphasis.

## PB10. What is explicitly OUT of per-token choreography

- **Monte Carlo.** A Monte-Carlo run executes hundreds of seeded runs headless;
  there is no single canvas timeline to choreograph. MC keeps its current
  progress strip + distribution view. No tokens.
- **Predict / any look-ahead estimate.** Any "what happens next" preview
  computes state without presenting a canvas transition — it shows numbers /
  bands, not travelling tokens.
- **The timeline scrubber.** Dragging the timeline to step `K` **jumps** the
  canvas to `series[K]` with no travel choreography (it is navigation, not
  playback). Pressing Play from a scrubbed position resumes forward
  choreography from `K`.
- **Autosave / load / share-link open.** Opening a graph shows its state
  directly; the first Play press is the first choreography.

## PB11. Non-negotiable invariants (PB-INV)

| id | invariant |
|---|---|
| **PB-INV-1** | The engine computes `fromState → events → toState` **before** any visual is scheduled. The choreography is a pure function of that triple; it calls no engine code and consumes no RNG. |
| **PB-INV-2** | When a transition ends (completed, fast-forwarded, or superseded), every value on the canvas equals the engine's `toState` for that step, bit-for-bit. |
| **PB-INV-3** | Speed, Pause/Resume, tab visibility, and frame starvation change only **wall-clock pacing**. From one seed: identical `SimState` at every step, identical timeline series, identical step count, regardless of how it was watched. |
| **PB-INV-4** | Every travelling / highlighted element for an edge uses that edge's **exact rendered `d`** (Bézier or orthogonal). No chords. |
| **PB-INV-5** | All events of one step share one `τ` axis: depart together → travel together → **value updates on `settle`**, which is the last beat. Never value-first-then-travel. |
| **PB-INV-6** | Play never overlaps two transitions. Exactly one is active; the next is computed only after the current `settle`. |
| **PB-INV-7** | Reset / Import / Undo / Redo / any edit cancels the in-flight transition within one frame; a stale callback (checked against the single monotonic `transitionId`) is inert and can neither move a token, advance `τ`, nor fire `settle` — for its own transition **or any later one**. |
| **PB-INV-11** | Two clocks: the store's `committedStep` (set synchronously when the engine returns a step) and the canvas's `revealedStep` (advanced on `settle`), with `revealedStep ≤ committedStep`. Non-visual store readers (export, digest, Workspace, `series`, "ended") see `committedStep`; every viewer surface (node value, Register panel, timeline cursor, state cues) follows `revealedStep`. |
| **PB-INV-12** | Every committed step's `settle` (its `toState` + state effects) is applied **in order** before the next step is drained — Play backpressure and background catch-up elide only *travel visuals*, never a `settle`. No committed step is skipped. |
| **PB-INV-13** | A summed edge token is a **presentational** group-by; the engine's individual `FlowEvents` are unchanged and their per-origin breakdown stays available for inspection. A `StateEvent` is never merged into a resource token. |
| **PB-INV-8** | `prefers-reduced-motion` ⇒ zero moving elements; the depart / path / arrive / settle beats still play (static or quick) in order. |
| **PB-INV-9** | No GraphDoc, `loop-revision/*` digest, `SimState`, timeline series, Share link, or Workspace (`loop-workspace/1`) byte changes. No new `loop-*/N`. Monte Carlo / Predict are untouched and tokenless. |
| **PB-INV-10** | The whole layer is render-side and disposable: destroying the scheduler (unmount, Reset) leaves no residue in any store that persists or serialises. |

## PB12. Acceptance / E2E (every slice)

1. **Determinism vs speed** — run seed `S` to step `K` at slow speed, capture
   `series`; repeat at fastest speed and via Step-spam; all three `series` and
   the final `SimState` byte-identical.
2. **Value-on-settle** — during `travel`, the target's displayed value still
   reads `fromState`; only after `settle` does it read `toState`. (DOM text
   assertion at sampled `τ`.)
3. **One path** — for a Bézier edge and an orthogonal edge, the token's
   `animateMotion` path (or sampled JS positions) lies on the edge's rendered
   `d`.
4. **Backpressure** — with Play running, at most one transition's token set is
   in the DOM at any time; step `N+2`'s tokens never appear before `N+1`'s
   `settle`.
5. **Pause/Resume** — Pause mid-`travel` freezes token positions (bounding
   boxes stable across 500 ms); Resume completes the *same* transition (no jump
   to `τ=0`), value lands on `toState`.
5a. **Pause snapshot** — Pause mid-transition (revealed `N`, committed `N+1`):
   the node value text reads `N`, the Register panel reads `R@N`, the timeline
   **cursor** is on `N` while the plotted **line** already includes `N+1`; no
   store field (`stepIndex` / `series` / `simulationRev`) changed on Pause.
5b. **Speed recompute** — change speed at `τ₀ ≈ 0.5` mid-`travel`: the token
   does not jump; its position is continuous across the change; the remaining
   travel takes `(1−τ₀)·newBeatDuration`; the `settle` still lands on `toState`.
6. **Cancellation** — trigger Reset / Import / Undo / a node move mid-`travel`;
   within one frame: zero tokens, canvas shows the new authoritative state, and
   no delayed value update fires afterward (assert value stable for 1 s). Then
   immediately start a new transition and assert the pre-cancel transition's
   pending `rAF` / `animationend` callbacks (fired late) touch nothing —
   `transitionId` mismatch, no-op.
7. **Background catch-up** — drive Play, emulate `document.hidden` for a spell,
   restore; the canvas resumes at the correct `SimState`, no token backlog, no
   console error; `series` unchanged.
8. **Reduced motion** — `prefers-reduced-motion: reduce`: zero `<animateMotion>`
   under any edge during a transition; the depart/path/arrive emphasis elements
   appear and the value updates with a delta chip.
9. **L0** — at zoom `< 0.45`, no travelling dot; the directional path pulse +
   arrival cue + value update still play in order.
10. **Summed tokens** — two flow events on one edge in one step ⇒ one token,
    label = the sum; `> MAX_PLAYBACK_TOKENS` events ⇒ still one token, value
    correct.
11. **MC untouched** — a Monte-Carlo run shows no tokens and its result is
    identical to today's oracle.
12. **VL-INV carry-over** — GraphDoc bytes, `loop-revision/3` digest, undo
    stack, edge `d`, viewport unchanged by playing / pausing / resetting a run.

## PB13. Proposed slices (for discussion — not settled)

- **Slice A — the transition scheduler + resource tokens.** The `τ`-axis
  scheduler, backpressure, Pause/Resume/speed, cancellation guard, reduced
  motion, L0 elision. Resource `FlowEvents` only (departure → travel on the real
  `d` → arrival → count-up to `toState`). No state-event choreography yet
  (state effects keep their current one-step cue but move onto the `settle`
  beat).
- **Slice B — state-event choreography.** `trigger` pulse as a travelling beat,
  `activator` tint flip on `settle`, `label` delta token with direction, the
  "blocked" / clamp annotations aligned to the `arrive` beat. Delayed-trigger
  emit cue vs delivery choreography (resolve PB-Q1).
- **Slice C — polish.** Summed-token labels, per-edge multi-event lanes within
  the cap, source outflow / target inflow micro-cues, count-up easing, the
  reduced-motion static sequence timing.

## PB14. Open questions

- **PB-Q1** — delayed `trigger`: delivery-step choreography only, or also a
  faint in-flight marker across the wait? (Lean: delivery only.)
- **PB-Q2** — does `settle`'s value count-up animate (tween) or snap? A tween is
  nicer but is itself motion; under reduced motion it snaps. (Lean: short tween
  normally, snap under reduced motion, both land on `toState`.)
- **PB-Q3** — Step-spam fast-forward: instant snap of the in-flight transition,
  or a very fast "catch-up" play of it? (Lean: instant snap — matches "Step is
  the escape hatch".)
- **PB-Q4** — `MAX_PLAYBACK_TOKENS` value (12?) and the per-step global cap
  across all edges (to bound total DOM on a wide graph).
- **PB-Q5** — should the timeline scrubber optionally *play* a range (scrub-with-
  choreography) or always jump? (Lean: always jump; a "play from here" is just
  Play.)

## PB15. Scope boundary

**In:** a render-side scheduler; resource + state event choreography along real
edge paths; Pause/Resume/speed/cancel semantics; reduced-motion and L0
behaviour; the acceptance set.

**Out (this doc):** any engine change; any new persisted or serialised field;
any `loop-*/N`; Monte-Carlo / Predict token animation; a "record / export the
animation" feature; camera moves / auto-pan-to-action (possible later, separate).
