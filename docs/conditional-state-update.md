# Conditional state update & same-step counter reset (design draft — DRAFT)

**Status: design draft — for review. rev 2.** rev 2 replaces the Phase-0
`when` + `phase: "post"` activator scheme (which reset the counter one pull
*late* — the on-screen `pity` lagged the result) with a **post-pull conditional
`label`**: the edit is applied *after* Phase 2, keyed to a result node that
fired **this** step, so the counter is already correct at commit and the next
pull's `activator` reads it the ordinary way. No `phase: "post"` activator.

No `loop-*/N` id, no `Frozen` marker. Extends `loop-state/1`
([`SEMANTICS-S.md`](../SEMANTICS-S.md)) / `loop-state/2`
([`SEMANTICS-S2.md`](../SEMANTICS-S2.md)). Nothing ships until **CSU3** is
ratified and given its own `SEMANTICS-S*.md` revision + a `loop-revision/N`
decision.

Prefix `CSU`. Sections: **CSU0** why · **CSU1** what today's primitives do ·
**CSU2** why they can't · **CSU3** proposed contract · **CSU4** how a hard pity
then expresses · **CSU5** timing walk-through · **CSU6** acceptance ·
**CSU7** out of scope · **CSU8** slices · **CSU9** open decisions.

---

## CSU0. Why

A hard pity — the ceiling every real gacha banner has — needs a counter that

1. **increments** by 1 on every pull whose result is **not** an SSR,
2. **resets to 0 in the same frame** an SSR lands — natural **or** forced,
3. and whose committed value **routes the next pull** (at the ceiling, that pull
   is a guaranteed SSR).

`loop-state/1` cannot express this. Proved — the two negative results are pinned
in [`src/engine/gacha-pity-timing.probe.test.ts`](../src/engine/gacha-pity-timing.probe.test.ts)
(merged with #178):

- a `pity → pity` self-`label` with `-S` applies **every** Phase 0
  unconditionally, so the counter is pinned at the single-step increment
  (`[0, 1, 1, 1, …]`) and never climbs to a ceiling;
- a `trigger → Drain` reset lands **one step late** — the SSR fires at step *t*,
  the drain empties `pity` at *t+1*, but the routing at *t+1* has already read
  `S[pity]` (committed at *t*, still at the ceiling), so the forced-SSR route
  fires on two consecutive steps: `ceiling fired at steps: [6, 7]` for
  `cap = 5`.

## CSU1. What today's primitives do

From `SEMANTICS-S.md` §S2, §S4, §S5 (impl `src/engine/step.ts` Phase 0):

| primitive | when it acts | source | reads | conditional? |
|---|---|---|---|---|
| `trigger` | Phase 0, if `source ∈ fired(t−1)` (opt. `delay`) | any node | — | yes — that *is* its gate |
| `activator` | Phase 0, gates the target's firing this step | **Pool** | `S[source]` vs a **literal** comparison | gates *firing* only, not a `label` |
| `label` | Phase 0, **every step**, edits `working[target]` | **Pool** | `S[source]` or a literal | **no** — "always applies" (§S5) |

Phase 0 order: (a) deliver due triggers → (b) `activator` gates vs `S` → (c)
apply every `label` in ascending `edge.id` → (d) one clamp per touched Pool.
Then Phase 1 (push), Phase 2 (pull), Commit (clamp every Pool to `[0, cap]`).

## CSU2. Why they can't

- **`label` is unconditional** — no form means "apply only on a step where …".
  A `ssr → pity` `label` `=0` would zero `pity` every step.
- **A `label` source must be a Pool, and Pools never `fire`.** `fired` is only
  ever a Source or a router (Gate / Converter / Drain / End) — `step.ts` adds
  nothing else. So a Pool-sourced `label` can never be gated on "did a result
  happen".
- **`label` runs in Phase 0, before the pull.** Whatever a Phase-0 `label`
  writes reflects the *previous* step's result, so the on-screen `pity` is
  always one pull behind the roll the user just saw. (This is the flaw rev 1
  did not fix — it only stopped the *routing* double-fire, not the *value*.)

## CSU3. Proposed contract (draft — for review)

One addition: a `label` may run **after the pull**, gated on a node that fired
**this** step.

### CSU3-1. `timing` on a `label` edge

`label` gains an optional `timing`:

| `timing` | when it applies | source | `expr` |
|---|---|---|---|
| *(absent)* / `"phase0"` | Phase 0, unconditionally | Pool (unchanged §S5) | `+N -N =N +S -S =S` (unchanged) |
| `"afterPull"` | a new **Phase 2.5**, after the Phase 2 pull, before the Commit clamp | a **router** (Gate / Converter / Drain / End) — the only nodes that `fire` | **numeric literal only**: `+N -N =N` (`N` a finite real ≥ 0). `+S -S =S` are **rejected** — an `afterPull` source is not a Pool, so `S[source]` has no meaning |

An `afterPull` `label` **requires** a `when` (CSU3-2); a `phase0` `label` must
**not** carry one. A `phase0`-typed `label` is byte-identical to `loop-state/1`.

### CSU3-2. `when: "source-fired"` on an `afterPull` `label`

The only `when` value in v1. The edit applies **iff `source ∈ fired` for the
step just pulled** (the current step's `fired` set, built during Phase 2 — *not*
`fired(t−1)`, which is what `trigger` reads). An `afterPull` `label` whose
source did not fire this step is **inert** — no diagnostic (it is expected to be
inert on most pulls), reported with `applied: false` (CSU3-4).

`when` is deliberately narrow: it reads a set membership, never another state
edge's result, so Phase 2.5 stays a single forward pass with no ordering
questions among `when` gates.

### CSU3-3. Phase order becomes

```
Phase 0    (a) triggers  (b) activator gates vs S  (c) phase0 labels  (d) clamp   ← unchanged
Phase 1    push (Sources)                                                          ← unchanged
Phase 2    pull (Gate / Converter / Drain / End); builds `fired`                   ← unchanged
Phase 2.5  afterPull labels, ascending edge.id:                                    ← NEW
             – skip an edge whose `when: "source-fired"` source ∉ fired
             – else edit working[target] by the literal expr
Commit     clamp every Pool to [0, capacity] (or floor-0 uncapped)                 ← existing;
             also absorbs any afterPull overshoot — this IS the afterPull clamp
```

A Phase-0 `label`'s own clamp (step d) is untouched. An `afterPull` `label` has
**no** separate clamp — the Commit clamp that already runs is its clamp, and the
correction it removes from an `afterPull` target is reported as that edge's
`clampAdjustment` (CSU3-4). Nothing in Phase 2.5 touches `report.events`,
schedules a trigger, or sets `ended` (a firing `End` in Phase 2 still ends the
run; the `afterPull` label on that final step still applies, so the last
committed `pity` is correct).

### CSU3-4. Reporting — an explicit `applied` flag

`report.stateEvents` label effects (loop-state/2 §S2-9) gain `applied`:

```
effect: { kind: "label", applied: boolean, delta: number, clampAdjustment: number }
```

- `applied: true`  — the edit ran; `delta` is its raw requested change, as today.
- `applied: false` — the gate was not satisfied this step; `delta: 0`,
  `clampAdjustment: 0`. This distinguishes "condition not met" from a genuine
  `+0` edit that *did* apply.

Phase-0 labels always report `applied: true` (they are unconditional), so the
field is a pure addition — every existing assertion on `delta` / `clampAdjustment`
still holds.

### CSU3-5. Validation

- `timing: "afterPull"` + Pool source ⇒ inert + one diagnostic
  (`afterPull label "<id>" needs a Gate / Converter / Drain / End source`).
- `timing: "afterPull"` + `+S -S =S` expr ⇒ inert + one diagnostic
  (`afterPull label "<id>" cannot read S; use a numeric literal`).
- `timing: "afterPull"` with no `when` ⇒ inert + diagnostic.
- `timing: "phase0"` (or absent) with a `when` ⇒ the `when` is ignored + one
  diagnostic (a `phase0` label is always unconditional).
- `when` value other than `"source-fired"` ⇒ inert + diagnostic.
- unknown `timing` ⇒ inert + diagnostic (treated as neither phase).

## CSU4. How a hard pity then expresses

Nodes — all shipped kinds:

- `pity` — Pool, `initial` 0, **uncapped** (CSU9-D1).
- `roll_gate` — probabilistic Gate, `activator pity < CAP` (a **literal**;
  CSU9-D2). Branches → `ssr` / `sr` / `r`.
- `forced_ssr` — deterministic Gate, `activator pity >= CAP` (literal), single
  SSR out-edge. Exactly one of `roll_gate` / `forced_ssr` is enabled per pull.
- `ssr_hit` — a passthrough **Converter** on the SSR path (fed by the `roll_gate`
  SSR branch **and** by `forced_ssr`), → `ssr_count` Pool. It `fires` ⇔ *any*
  SSR this step, natural or forced.
- `miss` — a passthrough **Converter** fed by the `roll_gate` `sr` and `r`
  branches, → `sr_count` / `r_count` (or a single `non_ssr_count`). `fires` ⇔ a
  non-SSR result this step.

State edges (all `mode: "label"`, `timing: "afterPull"`):

| edge | source → target | `when` | `expr` | effect |
|---|---|---|---|---|
| `pity_reset` | `ssr_hit` → `pity` | `"source-fired"` | `=0` | pity → 0 in the SSR frame (natural or forced) |
| `pity_inc` | `miss` → `pity` | `"source-fired"` | `+1` | pity += 1 in a non-SSR frame |

Exactly one of `ssr_hit` / `miss` fires per pull, so exactly one of the two
labels applies — no ordering trick, no marker Pool (rev 1's `no_ssr` **Pool**
could never fire; a Converter can).

The routing `activator`s on `roll_gate` / `forced_ssr` read `S[pity]` the
ordinary way — because Phase 2.5 already committed the correct value on the
previous pull.

## CSU5. Timing walk-through (`CAP = 3`)

`pity` column = the value **committed at the end of that step** (what the
Timeline shows for that frame).

| step | routing (reads `S[pity]`) | roll result | Phase 2.5 | committed `pity` |
|---|---|---|---|---|
| 1 | `S[pity]=0 < 3` → `roll_gate` | R → `miss` fires | `pity_inc +1` | **1** |
| 2 | `1 < 3` → `roll_gate` | SR → `miss` fires | `pity_inc +1` | **2** |
| 3 | `2 < 3` → `roll_gate` | R → `miss` fires | `pity_inc +1` | **3** |
| 4 | `3 >= 3` → **`forced_ssr`** | forced SSR → `ssr_hit` fires | `pity_reset =0` | **0** |
| 5 | `0 < 3` → `roll_gate` | R → `miss` fires | `pity_inc +1` | **1** |
| 6 | `1 < 3` → `roll_gate` | **natural SSR** → `ssr_hit` fires | `pity_reset =0` | **0** |
| 7 | `0 < 3` → `roll_gate` | SR → `miss` fires | `pity_inc +1` | **1** |

- **`pity = 0` in the exact frame the SSR lands** (steps 4 and 6) — not the next.
- **+1 in the exact frame a non-SSR lands.**
- The forced route fires on step 4 **only** — the probe's `[6, 7]` becomes a
  single hit — because step 5 routes on the *already-reset* `S[pity] = 0`.
- The SSR gap never exceeds `CAP`; `pity` is `0` after every SSR; `pity` only
  rises on a non-SSR pull.

## CSU6. Acceptance (for the engine impl slice)

1. **One result per paid pull** — exactly one of `ssr_hit` / `miss` fires;
   `ssr + sr + r == pulls` at every committed step.
2. **Below the ceiling** — `roll_gate` routes by probability; `forced_ssr` inert.
3. **At the ceiling** — `forced_ssr` fires; that pull is a guaranteed SSR.
4. **Same-frame reset** — the committed `pity` is `0` at the end of **every**
   step whose result is an SSR (natural *or* forced), with no intervening frame
   at a non-zero value.
5. **Same-frame increment** — the committed `pity` rises by exactly 1 at the end
   of every non-SSR step and by 0 at the end of every SSR step.
6. **No off-by-one routing** — the forced route fires on exactly one step per
   ceiling hit.
7. **Determinism** — same graph + seed ⇒ byte-identical run incl. the Phase 2.5
   order; Reset returns every value to step 0; the `loop-revision/*` engine
   digest is unmoved by running.
8. **Backward compat** — a `label` with no `timing` (or `timing: "phase0"`)
   behaves byte-identically to `loop-state/1`; **every existing state test
   passes unchanged**; `SEMANTICS-S.md` §14-style vectors are re-run; a graph
   with no `afterPull` edge produces a byte-identical engine digest.
9. **I1′ conservation** — an `afterPull` label that is inert contributes a
   reported `applied: false` term, not a silently skipped one;
   `Σ delta + clampAdjustment = final − start` holds per target per step across
   Phase-0 **and** Phase 2.5 edits.
10. **Reporting** — `applied` is present on every label effect; an inert
    `afterPull` edge is `applied: false, delta: 0, clampAdjustment: 0`.

The `gacha-pity-timing.probe.test.ts` tripwire is rewritten to the **positive**
case (the CSU5 trace) and kept.

## CSU7. Deliberately out of scope

- **Soft pity** (a rate that ramps near the ceiling) — needs a Gate branch
  **weight** that reads state; `loop-model` / Engine-B territory (GS11-D2), not
  `loop-state`. CSU3 makes it *reachable* later; it is not built here.
- **`@param` in an `activator` expression** (`>= @cap`) — the current grammar is
  literal-only. A separate, tiny `loop-model`-style extension; v1 uses a literal
  matching the Parameter's default and notes the coupling (CSU9-D2).
- **`when` forms other than `"source-fired"`** — e.g. `"level >= n"` against a
  Pool. Add later if a concrete use case earns it (CSU9-D3).
- **`afterPull` label targeting a resource edge's flow** or a non-Pool target —
  still out (`SEMANTICS-S.md` §S0 deferred list).
- **Per-target `all | any` activator policy** — v1 stays AND-only.
- Pickup-banner state (is-pickup, guarantee-after-loss), pity carry-over between
  banners — compose on top of CSU3 but are their own design (the gacha 3-zone
  Template redesign).

## CSU8. Slices

1. **Design** — this doc. Merges as *settled design, implementation pending*.
2. **Engine impl** — Phase 2.5 in `src/engine/step.ts`; `timing` / `when`
   parsing + validation in `src/engine/stateExpr.ts` (shared with the
   Inspector); the `applied` field on the label effect
   (`src/engine/types.ts` / `SEMANTICS-S2.md`); a new `SEMANTICS-S*.md`
   revision + a `loop-revision/N` decision (CSU9-D4); the positive pity probe.
   **No** node-kind or file-schema change.
3. **Inspector** — `timing` / `when` authoring on a `state` edge (a small
   extension of the state-edge editor); read-back copy; the `applied: false`
   Timeline cue.
4. **Gacha hard pity (GS10-3)** — the two-route roll + `ssr_hit` / `miss`
   markers + the two `afterPull` labels of CSU4 land in
   `examples/gacha-simulator.json` and its fixture; §GS9's pity conditions
   return.
5. **3-zone gacha Template** — general / premium-standard / premium-pickup,
   pickup guarantee, pity carry-over. Own design doc; consumes CSU3 + GS10-3.

## CSU9. Open decisions

| id | question | lean |
|---|---|---|
| **CSU9-D1** | `pity` Pool capped at `CAP` or uncapped? | **Uncapped.** A cap would clamp `pity + 1 → CAP` on the ceiling step, harmless but it makes the Commit clamp a second writer of the counter. Uncapped keeps `pity_reset =0` the single source of truth and the Timeline shows the raw count. |
| **CSU9-D2** | Routing threshold: a literal in the `activator` expr, or `@param`? | v1 **literal** (`>= 3`), because the `activator` grammar is literal-only. Note in the Template that the literal must match `@cap`'s default; a `@param`-in-`activator` extension is CSU7 / future. |
| **CSU9-D3** | Any `when` form beyond `"source-fired"` in v1? | **No.** `"source-fired"` unblocks the pity and the pickup-guarantee state; a comparison form waits for a concrete need. |
| **CSU9-D4** | Does a `timing` / `when` field move the `loop-revision/*` digest? | Like `route` / `waypoints` / `frames` — it changes the *run*, so it is in the **full revision digest** + `dirty`, but a graph with no `afterPull` edge has a byte-identical **engine** digest (CSU6-8). Fix the exact projection in slice 2. |
| **CSU9-D5** | Phase 2.5 vs Commit clamp interaction — does an `afterPull` `-N` that drives a Pool negative mid-walk match §S5's "intermediate out-of-range allowed, one final clamp"? | **Yes** — Phase 2.5 walks all `afterPull` edges in `edge.id` order against the running `working[target]`, intermediate values may be out of range, and the existing Commit clamp is the single final clamp. Spec it identically to §S5(d). |
| **CSU9-D6** | If both `ssr_hit` and `miss` somehow fire in one step (malformed graph), what applies? | Both labels apply in `edge.id` order (last wins for `=`, sums for `+`). Not a valid gacha graph; no special-casing — the acceptance fixture asserts exactly one fires. |
