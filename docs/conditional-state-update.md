# Conditional state update & same-step counter reset (design draft — DRAFT)

**Status: design draft — for review.** No `loop-*/N` id, no `Frozen` marker.
Extends `loop-state/1` (`SEMANTICS-S.md`) / `loop-state/2` (`SEMANTICS-S2.md`).
Nothing here ships until the contract in **CSU3** is ratified and given its own
`SEMANTICS-S*.md` revision.

Prefix `CSU`. Sections: **CSU0** why · **CSU1** what today's primitives can't do ·
**CSU2** the two gaps · **CSU3** proposed contract · **CSU4** how a hard pity
then expresses · **CSU5** timing walk-through · **CSU6** acceptance ·
**CSU7** out of scope · **CSU8** slices · **CSU9** open decisions.

---

## CSU0. Why

The gacha example ([`docs/example-gacha-simulator.md`](example-gacha-simulator.md))
and every real banner need a **hard pity**: a counter that

1. **increments** by 1 on every pull that is *not* an SSR,
2. **resets to 0** the moment an SSR lands — natural **or** forced,
3. and whose value **decides the routing of the very next pull** (at the ceiling,
   the pull is a guaranteed SSR).

`loop-state/1` cannot express this. Proved, not asserted — the two negative
results are pinned in
[`src/engine/gacha-pity-timing.probe.test.ts`](../src/engine/gacha-pity-timing.probe.test.ts):

- a `pity → pity` self-`label` with `-S` applies **every** Phase 0
  unconditionally, so the counter is pinned at the single-step increment
  (`[0, 1, 1, 1, …]`) and can never climb to a ceiling;
- a `trigger → Drain` reset lands **one step late** — the SSR fires at step *t*,
  the drain empties `pity` at *t+1*, but the routing at *t+1* has already read
  `S[pity]` (committed at *t*, still at the ceiling), so the forced-SSR route
  fires on two consecutive steps: `ceiling fired at steps: [6, 7]` for
  `cap = 5`.

## CSU1. What today's primitives do

From `SEMANTICS-S.md` §S2, §S4, §S5 (impl `src/engine/step.ts` Phase 0):

| primitive | when it acts | reads | can it be conditional? |
|---|---|---|---|
| `trigger` | Phase 0, if `source ∈ fired(t−1)` (opt. `delay`) | — | **yes** — that *is* its gate |
| `activator` | Phase 0, gates the target's firing this step | `S[source]` (Pool, previous commit) | it *is* a condition, but it can only gate *firing*, not a `label` |
| `label` | Phase 0, **every step**, edits `working[target]` | `S[source]` (Pool) or a literal | **no** — "always applies (subject to a valid `expr`)" (§S5) |

Phase 0 order today: (a) deliver due triggers → (b) evaluate `activator` gates
against `S` → (c) apply every `label` edge in ascending `edge.id` → (d) one clamp
per touched Pool.

## CSU2. The two gaps

### CSU2-A. `label` is unconditional

There is no `label` form meaning "apply this edit **only on a step where …**".
So "reset `pity` to 0 only when an SSR landed" cannot be written: a
`ssr → pity` `label` `=0` would zero `pity` every single step.

### CSU2-B. routing reads `S`, not the post-Phase-0 `working`

Even a *correctly conditional* reset lands in `working[pity]` during Phase 0, but
the routing decision — a forced-SSR `activator` (`pity >= @cap`) on the roll
Gate, or a Gate branch weight `@pity` — reads `S[pity]` (the previous step's
commit). So the reset is invisible until the step *after*, which is exactly the
one-step-late double-fire the probe demonstrates.

Both gaps must close together. Closing only CSU2-A still double-fires; closing
only CSU2-B has nothing to make visible.

## CSU3. Proposed contract (draft — for review)

Two additions to `loop-state`. Neither changes the serialized shape beyond new
optional `data` fields on a `state` edge (the `serialize()` allowlist already
carries `data` whole — see [[serialize-schema-allowlist]] — but a new revision
digest decision is still required, CSU9-D3).

### CSU3-1. A **conditional `label`** — `label` gains an optional gate

A `label` edge MAY carry an optional `when` describing the step on which it
applies. When absent, behaviour is exactly `loop-state/1` (unconditional). Two
candidate gate kinds — **CSU9-D1 picks one, or allows both**:

- **`when: "fired"`** — the edit applies only on a step where `source ∈
  fired(t−1)` (the `trigger` rule, reused). Natural fit for "reset when the SSR
  branch fired".
- **`when: "<cmp>" @otherPool`** — the edit applies only if a comparison
  (`>= n`, `< n`, …, the `activator` grammar from §S6) against a **second Pool**
  holds, read from `S` in Phase 0 sub-phase (b). Natural fit for "top up only
  while `wallet < threshold`".

A gated `label` whose gate is not satisfied this step is **inert with no
diagnostic** (it is *expected* to be inert most steps) and contributes `delta =
0` to `report.stateEvents` (§S2-9) so the Timeline still shows the edge exists.

`label` order within one target stays ascending `edge.id`; a gated edge that is
inert this step is simply skipped in that walk.

### CSU3-2. An `activator` MAY read the **post-Phase-0** `working` value

An `activator` edge MAY set `phase: "post"` (default `"pre"` = today's `S`
read). A `post` activator is evaluated in a new Phase 0 **sub-phase (d)**, after
all `label` edges and the single clamp, against `working[source]`.

- A `post` activator gates its target's firing for Phase 1 / Phase 2 the same
  way a `pre` activator does — only the *read timing* differs.
- `pre` and `post` activators into one target still AND-combine (§S4).
- Cost: one extra pass over the `post`-tagged activator edges. No new node kind,
  no new phase — Phase 0 sub-phases (b) and (d) run the same code against a
  different value map.

### CSU3-3. Phase 0 order becomes

```
(a) deliver due trigger pulses            (unchanged)
(b) evaluate `pre` activator gates   vs  S[source]     (unchanged read)
(c) apply `label` edges in edge.id order:
       – skip a gated edge whose `when` is unsatisfied  (NEW)
       – otherwise edit working[target] exactly as loop-state/1
(d) one clamp per label-touched Pool       (unchanged)
(e) evaluate `post` activator gates  vs  working[source]   (NEW)
    → final enabled(target) = AND(all pre gates, all post gates)
```

`(b)` still runs before `(c)` so a `when` comparison in `(c)` and a `pre`
activator in `(b)` both see the *same* pre-step snapshot — no ordering
ambiguity between them.

## CSU4. How a hard pity then expresses

Nodes (all shipped kinds):

- `pity` — Pool, `initial` 0, uncapped (or capped at `@cap` — CSU9-D2).
- `pull_tick` — Source (`automatic`, flow 1) → a transient `tick` Pool, one unit
  per step; used only as a `label` **source** (a `label` reads `S[source]`, it
  never debits it).
- roll: one probabilistic Gate `roll_gate` for the normal branches **plus** a
  `forced_ssr` deterministic Gate, partitioned by a `post` activator on `pity`
  (`< @cap` opens `roll_gate`, `>= @cap` opens `forced_ssr`) — exactly the
  two-route shape §GS2.2 sketched before it was cut.
- `ssr_count` — Pool, the SSR tally (fed by both the natural and the forced SSR
  branch).

State edges:

| edge | mode | source → target | `expr` / `when` | effect |
|---|---|---|---|---|
| `pity_inc` | `label` | `tick` → `pity` | `+1`, `when: "fired"` on … | +1 **only on a non-SSR pull** — see below |
| `pity_reset` | `label` | `ssr_count` → `pity` | `=0`, `when: "fired"` | zero `pity` the step after any SSR (natural or forced) |
| `open_roll` | `activator` | `pity` → `roll_gate` | `< @cap`, `phase: "post"` | normal routing until the ceiling |
| `open_forced` | `activator` | `pity` → `forced_ssr` | `>= @cap`, `phase: "post"` | the ceiling pull is a guaranteed SSR |

**"+1 only on a non-SSR pull".** Two ways, CSU9-D4 decides:

- **D4-a** — `pity_inc` `when: "fired"` keyed to a `no_ssr` marker Pool that the
  R / SR branches feed (fires ⇔ a non-SSR result last step). Clean, but adds a
  marker node.
- **D4-b** — `pity_inc` is *unconditional* `+1`, and `pity_reset` is ordered
  **after** it (higher `edge.id`) with `=0`. On an SSR step the net is
  `pity + 1` then `= 0` → 0. On a non-SSR step only `+1` applies. Uses only the
  ordering rule already in §S5 — **no marker node**. Preferred.

## CSU5. Timing walk-through (D4-b, `cap = 3`)

`t` = the pull that lands the result shown.

| step | Phase 0 (b) pre | Phase 0 (c) labels | Phase 0 (e) post activator | routing this step | commit `pity` |
|---|---|---|---|---|---|
| 1 | — | `+1` → `pity 1` | `1 < 3` → `roll_gate` | roll: R | 1 |
| 2 | — | `+1` → `pity 2` | `2 < 3` → `roll_gate` | roll: SR | 2 |
| 3 | — | `+1` → `pity 3` | `3 >= 3` → **`forced_ssr`** | forced SSR ⇒ `ssr_count` fires | 3 |
| 4 | — | `+1` → `4`, then `=0` (`ssr_count` fired at 3) → `pity 0` | `0 < 3` → `roll_gate` | roll: R | 0 |
| 5 | — | `+1` → `pity 1` | `1 < 3` → `roll_gate` | roll: SSR (natural) | 1 |
| 6 | — | `+1` → `2`, then `=0` (`ssr_count` fired at 5) → `pity 0` | `0 < 3` → `roll_gate` | roll: … | 0 |

The forced route fires on step 3 **only** — never 3 *and* 4 — because the
`post` activator on step 4 reads `working[pity] = 0` (after the reset), not
`S[pity] = 3`. This is the exact behaviour the probe showed today's primitives
cannot produce.

Pity is `0` after every SSR (steps 4, 6). Pity only ever climbs on a non-SSR
pull (the `=0` cancels the `+1` on an SSR step). The SSR gap never exceeds
`cap`.

## CSU6. Acceptance (for the engine impl slice)

Adapted from the hard-pity conditions Hanrim listed for the gacha example:

1. **One result per paid pull** — every pull moves exactly one roll branch;
   `ssr + sr + r == pulls` at every committed step.
2. **Below the ceiling** — normal probability routing (`roll_gate`), `forced_ssr`
   inert.
3. **At the ceiling** — `forced_ssr` fires; that pull is a guaranteed SSR.
4. **Reset** — `pity` is exactly `0` at the first committed step after **every**
   SSR, natural and forced.
5. **Increment discipline** — `pity` rises by exactly 1 on a non-SSR pull and by
   0 on an SSR pull; never negative; never exceeds `cap` at a routing read.
6. **No off-by-one** — the forced route fires on exactly one step per ceiling
   hit (the probe's `[6, 7]` becomes `[6]`).
7. **Determinism** — same graph + seed ⇒ byte-identical run incl. the Phase 0
   sub-phase order; Reset returns every value to step 0; the `loop-revision/*`
   digest is unmoved by running.
8. **Backward compat** — a `state` edge with no `when` / no `phase` behaves
   byte-identically to `loop-state/1`; every existing state test passes
   unchanged; `SEMANTICS-S.md` §14-style vectors are re-run.
9. **I1′ conservation** — a gated `label` that is inert contributes `0`, not a
   skipped term; `Σ delta + clampAdjustment = final − start` still holds per
   target per step.

A throwaway probe like `gacha-pity-timing.probe.test.ts` is rewritten to the
**positive** case and kept as the tripwire.

## CSU7. Deliberately out of scope

- **Soft pity** (a rate that ramps near the ceiling) — needs a Gate branch
  **weight** that reads state (`@pity` / a Register of it); that is
  `loop-model` / Engine-B territory (GS11-D2), not `loop-state`. This design
  makes soft pity *reachable* later but does not build it.
- **`label` targeting a resource edge's flow rate** or a non-Pool — still out
  (`SEMANTICS-S.md` §S0 deferred list).
- **Per-target `all | any` activator policy** — v1 stays AND-only.
- **`when` with a `delay`** — the gate is evaluated for the current step only.
- Pickup-banner state (is-pickup, guarantee-after-loss), pity carry-over between
  banners — these compose *on top of* CSU3 but are their own design (the gacha
  3-zone Template redesign).

## CSU8. Slices

1. **Design** — this doc. Merges as *settled design, implementation pending*.
2. **Engine impl** — Phase 0 sub-phases (c-gated) + (e); `when` / `phase`
   parsing in `src/engine/stateExpr.ts` (shared with the Inspector); the
   §S2-9 reporting shape for a gated-inert `label`; a new `SEMANTICS-S*.md`
   revision + a `loop-revision/N` decision (CSU9-D3); the positive pity probe.
   **No** node-kind or file-schema change.
3. **Inspector** — `when` / `phase` authoring on a `state` edge (a small
   extension of the existing state-edge editor); read-back copy.
4. **Gacha hard pity (GS10-3)** — the two-route roll + the four state edges of
   CSU4 land in `examples/gacha-simulator.json` and the fixture; the gacha
   acceptance §GS9 pity conditions come back.
5. **3-zone gacha Template** — general / premium-standard / premium-pickup,
   pickup guarantee, pity carry-over. Its own design doc; consumes CSU3 + GS10-3.

## CSU9. Open decisions

| id | question | lean |
|---|---|---|
| **CSU9-D1** | `when: "fired"` only, or also `when: "<cmp> @pool"`? | Ship **`"fired"`** first (it unblocks the pity); add the comparison form with the budget-top-up use case if it earns its keep. |
| **CSU9-D2** | `pity` Pool capped at `@cap`, or uncapped with the `post` activator doing all the work? | **Uncapped.** A cap would clamp `pity + 1 → cap` on the ceiling step *before* the `= 0`, which is fine, but an uncapped Pool keeps the `= 0` assignment the single source of truth and the Timeline shows the raw count. |
| **CSU9-D3** | Does a `when` / `phase` field move the `loop-revision/*` digest? | Treat like `route` / `waypoints` / `frames` — it is **cosmetic-adjacent document content**: it changes the *run*, so it must be in the **full revision digest** and `dirty`, but a graph with no gated / `post` edge produces a byte-identical **engine** digest (CSU6-8). Decide the exact projection in slice 2. |
| **CSU9-D4** | "+1 only on non-SSR" via a marker Pool (D4-a) or `= 0` ordered after `+ 1` (D4-b)? | **D4-b** — no extra node, uses the existing §S5 ascending-`edge.id` order. Document that a reset `= N` on a step also cancels that step's increments into the same target (it is an assignment, not a delta). |
| **CSU9-D5** | Should a `post` activator be allowed to gate a **`label`'s** `when` (i.e. chained conditional state)? | **No** in v1 — a `when` reads `S` or `fired`, never another activator's result. Keeps Phase 0 a single forward pass. |
