# Conditional state update & same-step counter reset (design draft — DRAFT)

**Status: design draft — for review. rev 3.** rev 3 closes the five blockers
Hanrim raised on rev 2 (ceiling off-by-one; the `ssr_hit` / `miss` **Converter**
partial-activation bug; the `applied` vs byte-identical contradiction; a
fail-open `phase0` + `when`; clamp-attribution / schema wording) and turns
CSU9-D1..D6 from open questions into **final decisions**, so this can merge as
*settled design, implementation pending*. rev 2 introduced the **post-pull
conditional `label`** (Phase 2.5); rev 1's Phase-0 `when` + `phase: "post"`
activator is abandoned.

No `loop-*/N` id, no `Frozen` marker. Extends `loop-state/1`
([`SEMANTICS-S.md`](../SEMANTICS-S.md)) / `loop-state/2`
([`SEMANTICS-S2.md`](../SEMANTICS-S2.md)). Ships only under a new
`SEMANTICS-S*.md` revision + a `loop-revision/N` decision (**CSU3-6**).

Prefix `CSU`. Sections: **CSU0** why · **CSU1** what today's primitives do ·
**CSU2** why they can't · **CSU3** proposed contract · **CSU4** how a hard pity
expresses · **CSU5** timing walk-through · **CSU6** acceptance ·
**CSU7** out of scope · **CSU8** slices · **CSU9** decisions.

---

## CSU0. Why

A hard pity — the ceiling every real gacha banner has — needs a counter that

1. **increments** by 1 on every pull whose result is **not** an SSR,
2. **resets to 0 in the same frame** an SSR lands — natural **or** forced,
3. and whose committed value **routes the next pull** — at the ceiling that pull
   is a guaranteed SSR.

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
| `activator` | Phase 0, gates the target's firing this step | **Pool** | `S[source]` vs a **literal** comparison (`>= 5`, `< 2`, …) | gates *firing* only, not a `label` |
| `label` | Phase 0, **every step**, edits `working[target]` | **Pool** | `S[source]` or a literal | **no** — "always applies" (§S5) |

Phase 0 order: (a) deliver due triggers → (b) `activator` gates vs `S` → (c)
apply every `label` in ascending `edge.id` → (d) one clamp per touched Pool.
Then Phase 1 (push), Phase 2 (pull, builds `fired`), Commit (clamp every Pool).

## CSU2. Why they can't

- **`label` is unconditional** — no form means "apply only on a step where …".
  A `ssr → pity` `label` `=0` zeroes `pity` every step.
- **A `label` source must be a Pool, and a Pool never `fires`.** `fired` is only
  ever a Source (Phase 1) or a Phase-2 router — Gate / Converter / Drain / End;
  `step.ts` adds nothing else. So a Pool-sourced `label` cannot be gated on
  "did a result happen".
- **`label` runs in Phase 0, before the pull.** Whatever a Phase-0 `label`
  writes reflects the *previous* step's result, so the on-screen `pity` is
  always one pull behind the roll the user just saw. (rev 1's Phase-0 scheme did
  not fix this — it only stopped the *routing* double-fire, not the *value*.)
- **An `activator` comparison is literal-only** — `>= @cap` is not in the
  grammar (`SEMANTICS-S.md` §S6). A ceiling threshold must be written as a
  number.

## CSU3. Proposed contract (draft — for review)

One addition: a `label` may run **after the pull**, gated on a node that fired
**this** step.

### CSU3-1. `timing` on a `label` edge

`label` gains an optional `timing`:

| `timing` | when it applies | source | `expr` |
|---|---|---|---|
| *(absent)* / `"phase0"` | Phase 0, unconditionally | Pool (unchanged §S5) | `+N -N =N +S -S =S` (unchanged) |
| `"afterPull"` | a new **Phase 2.5**, after the Phase 2 pull, before the Commit clamp | **a node that fires in Phase 2** — a Gate, Converter, Drain, or End (a Source is *not* accepted: it fires in Phase 1 and is not a per-pull result; a Pool never fires) | **numeric literal only**: `+N -N =N` (`N` a finite real ≥ 0). `+S -S =S` are **rejected** — an `afterPull` source is not a Pool, so `S[source]` has no meaning |

An `afterPull` `label` **requires** a `when` (CSU3-2). A `phase0` `label` must
**not** carry one (CSU3-5). A `phase0`-typed `label` is byte-identical to
`loop-state/1` in both behaviour and report shape.

### CSU3-2. `when: "source-fired"` on an `afterPull` `label`

The only `when` value in v1 (**CSU9-D3**). The edit applies **iff `source ∈
fired` for the step just pulled** — the current step's `fired` set, built during
Phase 2 (*not* `fired(t−1)`, which is what `trigger` reads). An `afterPull`
`label` whose source did not fire this step is **inert** — no diagnostic (it is
expected to be inert on most pulls), reported with `applied: false` (CSU3-4).

`when` reads a set membership, never another state edge's result, so Phase 2.5
stays a single forward pass with no ordering questions among the `when` gates.

### CSU3-3. Phase order becomes

```
Phase 0    (a) triggers  (b) activator gates vs S  (c) phase0 labels  (d) clamp   ← unchanged
Phase 1    push (Sources)                                                          ← unchanged
Phase 2    pull (Gate / Converter / Drain / End); builds `fired`                   ← unchanged
Phase 2.5  afterPull labels, ascending edge.id (NEW):
             – an edge whose `when` source ∉ fired  →  inert, applied:false, skip
             – else edit working[target] by the literal expr, against the
               running working[target]; intermediate out-of-range is allowed
Commit     clamp every Pool to [0, capacity] / floor-0 uncapped                   ← existing;
             this single clamp IS the afterPull clamp (no separate one)
```

Phase 0's own label clamp (step d) is untouched. Nothing in Phase 2.5 touches
`report.events`, schedules a trigger, or sets `ended` — a firing `End` in
Phase 2 still ends the run, and the `afterPull` label on that final step still
applies, so the last committed value is correct.

### CSU3-4. Reporting — `applied` on `afterPull` effects only

To keep `loop-state/2` reports **byte-identical** for every existing graph
(**CSU9-D5**):

- a **`phase0` / untyped** `label` effect keeps its exact `loop-state/2` shape —
  `{ kind: "label", delta, clampAdjustment }`, **no `applied` field**.
- an **`afterPull`** `label` effect is
  `{ kind: "label", applied: boolean, delta, clampAdjustment }`:
  - `applied: true` — the edit ran; `delta` is its raw requested change.
  - `applied: false` — the `when` gate was not satisfied; `delta: 0`,
    `clampAdjustment: 0`, **always** (an inert edge never carries a clamp
    correction — CSU3-5).
- a consumer reads **absent `applied` as `true`**.

### CSU3-5. Validation (each ⇒ the edge is inert + exactly one diagnostic)

- `timing: "afterPull"` + a Pool or Source source
  (`afterPull label "<id>" needs a Gate / Converter / Drain / End source`).
- `timing: "afterPull"` + a `+S -S =S` expr
  (`afterPull label "<id>" cannot read S; use a numeric literal`).
- `timing: "afterPull"` with **no** `when`
  (`afterPull label "<id>" needs when: "source-fired"`).
- `timing: "phase0"` (or absent) **with** a `when` — the **whole edge is inert**
  (`label "<id>" has a when but is not timing: "afterPull"; ignored`). It is
  **never** run as an unconditional label — a condition the author set is never
  silently dropped (fail-closed).
- `when` value other than `"source-fired"`
  (`label "<id>" when "<v>" is not supported`).
- unknown `timing` — inert (`label "<id>" timing "<v>" is not supported`).

### CSU3-6. Clamp attribution

When several **applied** `afterPull` labels edit one Pool and the Commit clamp
then corrects it, the correction is attributed to **that target's last applied
`afterPull` edge** (ascending `edge.id`), as `clampAdjustment` on its effect —
exactly the `SEMANTICS-S2.md` §S2-9 rule for Phase-0 labels, but scoped to the
Phase-2.5 edits. An **inert** edge is never the attribution target. I1′ holds:
`Σ (applied delta) + clampAdjustment = final − start` per Pool per step, summed
across Phase-0 **and** Phase-2.5 edits.

### CSU3-7. Schema surface

`timing` and `when` are **new recognised fields on a `state` edge's `data`**.
The GraphDoc envelope, `schema` string, and model version are **unchanged**;
`serialize()` already carries `data` whole (see [[serialize-schema-allowlist]]),
so the fields round-trip. This is a **state-edge schema extension**, not a
file-format change — and it needs its own `loop-revision/N` decision
(**CSU9-D4**).

## CSU4. How a hard pity expresses

Parameters: `HARD_PITY = 3` (a "3-pull ceiling" — the **3rd** pull is
guaranteed). Because an `activator` expr can't reference a Parameter, the two
routing activators use the **literal `HARD_PITY − 1 = 2`**; the Template must
keep the two in sync and the acceptance fixture asserts it (**CSU9-D2**).

Nodes — all shipped kinds:

- `pity` — Pool, `initial` 0, **uncapped** (**CSU9-D1**). Its committed value is
  the count of consecutive non-SSR pulls.
- `roll_gate` — probabilistic Gate, `activator pity < 2`. Branches → `ssr` /
  `sr` / `r`.
- `forced_ssr` — deterministic Gate, `activator pity >= 2`, single SSR
  out-edge. Exactly one of `roll_gate` / `forced_ssr` is enabled per pull.
- `ssr_hit` — a **single-output deterministic Gate** merging the `roll_gate` SSR
  branch **and** `forced_ssr`, → `ssr_count` Pool. A Gate passes its whole
  input through its one output (no Converter `Σ inRate` demand), so a lone
  natural *or* forced SSR delivers exactly 1. It `fires` ⇔ any SSR this step.
- `sr_hit` / `r_hit` — single-output deterministic Gates on the `roll_gate` `sr`
  / `r` branches, → `sr_count` / `r_count`. Each `fires` ⇔ that grade this step.

> **Not Converters.** A Converter treats the sum of *all* its input-edge rates
> as one activation's demand, so a 2-input `ssr_hit` Converter fed by only one
> branch would run at `f = 0.5` and bank `0.5` into `ssr_count`. Deterministic
> Gates avoid this and keep every grade count integral and
> `ssr + sr + r == pulls` exact.

State edges — all `mode: "label"`, `timing: "afterPull"`, `when: "source-fired"`:

| edge | source → target | `expr` | effect |
|---|---|---|---|
| `pity_reset` | `ssr_hit` → `pity` | `=0` | pity → 0 in the SSR frame (natural or forced) |
| `pity_inc_sr` | `sr_hit` → `pity` | `+1` | pity += 1 in an SR frame |
| `pity_inc_r` | `r_hit` → `pity` | `+1` | pity += 1 in an R frame |

`roll_gate` / `forced_ssr` route **exactly one** branch per pull, so **exactly
one** of `ssr_hit` / `sr_hit` / `r_hit` fires, so **exactly one** `afterPull`
label applies — no ordering trick, no marker Pool.

The routing `activator`s read `S[pity]` the ordinary way, because Phase 2.5
already committed the correct value on the previous pull.

## CSU5. Timing walk-through (`HARD_PITY = 3`, forced activator literal `2`)

`pity` column = the value **committed at the end of that step** — what the
Timeline shows for that frame.

| step | routing (reads `S[pity]`) | roll result | fires | Phase 2.5 | committed `pity` |
|---|---|---|---|---|---|
| 1 | `0 < 2` → `roll_gate` | R | `r_hit` | `pity_inc_r +1` | **1** |
| 2 | `1 < 2` → `roll_gate` | SR | `sr_hit` | `pity_inc_sr +1` | **2** |
| 3 | `2 >= 2` → **`forced_ssr`** | forced SSR | `ssr_hit` | `pity_reset =0` | **0** |
| 4 | `0 < 2` → `roll_gate` | R | `r_hit` | `pity_inc_r +1` | **1** |
| 5 | `1 < 2` → `roll_gate` | **natural SSR** | `ssr_hit` | `pity_reset =0` | **0** |
| 6 | `0 < 2` → `roll_gate` | R | `r_hit` | `pity_inc_r +1` | **1** |
| 7 | `1 < 2` → `roll_gate` | SR | `sr_hit` | `pity_inc_sr +1` | **2** |

- The **3rd** pull is the guaranteed SSR — a real "3-pull hard pity", not a
  4-pull one.
- `pity = 0` in the exact frame the SSR lands (steps 3, 5) — not the next.
- `+1` in the exact frame a non-SSR lands.
- `forced_ssr` fires on step 3 **only** — the probe's `[6, 7]` becomes a single
  hit — because step 4 routes on the already-reset `S[pity] = 0`.
- The SSR gap never exceeds `HARD_PITY`; `pity` is `0` after every SSR; `pity`
  only rises on a non-SSR pull.

## CSU6. Acceptance (for the engine impl slice)

1. **One result per paid pull** — exactly one of `ssr_hit` / `sr_hit` / `r_hit`
   fires; `ssr_count + sr_count + r_count == pulls_made` exactly at every
   committed step, all integral.
2. **Below the ceiling** — `roll_gate` routes by probability; `forced_ssr` inert.
3. **At the ceiling** — on the `HARD_PITY`-th consecutive non-SSR pull the
   routing reads `S[pity] = HARD_PITY − 1`, `forced_ssr` fires, that pull is a
   guaranteed SSR.
4. **Same-frame reset** — the committed `pity` is `0` at the end of **every**
   SSR step (natural or forced), with no intervening frame at a non-zero value.
5. **Same-frame increment** — the committed `pity` rises by exactly 1 at the end
   of every non-SSR step and by 0 at the end of every SSR step; never negative;
   never exceeds `HARD_PITY − 1` at a routing read.
6. **No off-by-one routing** — the forced route fires on exactly one step per
   ceiling hit; the SSR-to-SSR gap never exceeds `HARD_PITY`.
7. **Determinism** — same graph + seed ⇒ byte-identical run incl. the Phase 2.5
   order; Reset returns every value to step 0; the `loop-revision/*` engine
   digest is unmoved by running.
8. **Backward compat** — a `label` with no `timing` (or `timing: "phase0"`)
   behaves byte-identically to `loop-state/1`, **and its report effect keeps the
   exact `loop-state/2` shape (no `applied` field)**; every existing state test
   passes unchanged; `SEMANTICS-S.md` §14 vectors re-run; a graph with no
   `afterPull` edge has a byte-identical engine digest **and** a byte-identical
   `report`.
9. **Reporting** — every `afterPull` effect carries `applied`; an inert
   `afterPull` edge is exactly `{ applied: false, delta: 0, clampAdjustment: 0 }`;
   a clamp correction is attributed only to the target's last **applied**
   `afterPull` edge.
10. **I1′ conservation** — `Σ (applied delta) + clampAdjustment = final − start`
    per Pool per step, across Phase-0 and Phase-2.5 edits together.

The `gacha-pity-timing.probe.test.ts` tripwire is rewritten to the **positive**
case (the CSU5 trace) and kept.

## CSU7. Deliberately out of scope

- **Soft pity** (a rate that ramps near the ceiling) — needs a Gate branch
  **weight** that reads state; `loop-model` / Engine-B territory (GS11-D2), not
  `loop-state`. CSU3 makes it *reachable* later; it is not built here.
- **`@param` in an `activator` expression** (`>= @cap`) — the grammar is
  literal-only. A separate, tiny `loop-model`-style extension; v1 uses a literal
  and states the coupling (CSU9-D2).
- **`when` forms other than `"source-fired"`** — e.g. a comparison against a
  Pool. Add later only if a concrete use case earns it (CSU9-D3).
- **`afterPull` label targeting a resource edge's flow, or a non-Pool target** —
  target stays Pool-only (`SEMANTICS-S.md` §S0 deferred list).
- **Per-target `all | any` activator policy** — v1 stays AND-only.
- Pickup-banner state (is-pickup, guarantee-after-loss), pity carry-over between
  banners — compose on top of CSU3 but are their own design (the gacha 3-zone
  Template redesign).

## CSU8. Slices

1. **Design** — this doc. Merges as *settled design, implementation pending*.
2. **Engine impl** — Phase 2.5 in `src/engine/step.ts`; `timing` / `when` parse
   + the CSU3-5 validation in `src/engine/stateExpr.ts` (shared with the
   Inspector); the `applied` field on the `afterPull` label effect
   (`src/engine/types.ts` + `SEMANTICS-S2.md`); a new `SEMANTICS-S*.md`
   revision + the `loop-revision/N` decision (CSU9-D4); the positive pity
   probe. **No** node-kind or file-format change.
3. **Inspector** — `timing` / `when` authoring on a `state` edge; read-back
   copy; an `applied: false` Timeline cue.
4. **Gacha hard pity (GS10-3)** — `roll_gate` / `forced_ssr` + `ssr_hit` /
   `sr_hit` / `r_hit` Gates + the three `afterPull` labels of CSU4 land in
   `examples/gacha-simulator.json` and its fixture; §GS9's pity conditions
   return; `HARD_PITY` Parameter + the paired literal `2`.
5. **3-zone gacha Template** — general / premium-standard / premium-pickup,
   pickup guarantee, pity carry-over. Own design doc; consumes CSU3 + GS10-3.

## CSU9. Decisions

| id | decision |
|---|---|
| **CSU9-D1** | `pity` is an **uncapped** Pool. A capacity would make the Commit clamp a second writer of the counter (`pity + 1 → cap` on the ceiling step). Uncapped keeps `pity_reset =0` the single source of truth and the Timeline shows the raw count. |
| **CSU9-D2** | The routing threshold is a **literal** in the `activator` expr (`< 2` / `>= 2` for a 3-pull ceiling). The example carries a `HARD_PITY` Parameter for documentation and cost math; the Template keeps `activator literal == HARD_PITY − 1` and the acceptance fixture asserts the pair. A `@param`-in-`activator` grammar extension is out of scope (CSU7). |
| **CSU9-D3** | The only `when` value in v1 is **`"source-fired"`**. It unblocks the hard pity and the pickup-guarantee state; a comparison form (`when: ">= n" @pool`) is deferred until a concrete use case. |
| **CSU9-D4** | A `timing` / `when` field is **document content**: it changes the *run*, so it moves the **full `loop-revision/*` document digest** and sets `dirty` (the `route` / `waypoints` / `frames` precedent). A graph with **no** `afterPull` edge has a byte-identical **engine** digest and a byte-identical `report`. The exact digest projection is fixed in slice 2's `SEMANTICS-S*` revision. |
| **CSU9-D5** | `applied` is added **only** to `afterPull` label effects; `phase0` / untyped label effects keep the exact `loop-state/2` shape. Consumers treat a missing `applied` as `true`. This preserves "byte-identical report for every existing graph"; a report shape does **not** change for anyone who does not use `afterPull`. |
| **CSU9-D6** | Phase 2.5 walks all `afterPull` edges for a target in ascending `edge.id` against the running `working[target]`; intermediate out-of-range values are allowed and the single **Commit** clamp is the only clamp — identical semantics to `SEMANTICS-S.md` §S5(d), scoped to Phase 2.5. If a malformed graph makes two of `ssr_hit` / `sr_hit` / `r_hit` fire in one step, both labels apply in `edge.id` order (`=` last-wins, `+` sums); the gacha fixture asserts exactly one fires, and with `roll_gate` / `forced_ssr` routing exactly one branch this cannot occur in a valid graph. |
