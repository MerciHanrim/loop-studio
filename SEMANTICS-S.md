# Execution semantics — State connections

**Status: DRAFT for review.** No engine code yet. On freeze the §S11 tables
become the acceptance vectors and implementation begins on
`feat/state-semantics` in the slice order of §S13. This document *extends*
[`SEMANTICS.md`](./SEMANTICS.md) (Engine A, frozen) and is compatible with
[`SEMANTICS-B1.md`](./SEMANTICS-B1.md) / [`SEMANTICS-B2.md`](./SEMANTICS-B2.md);
it only states what changes and what is added. Section numbers are `S0…S13`.

Spec id: **`loop-state/1`**. On freeze this folds into `SEMANTICS.md` with edits
to §2 (state in `state`), §4 (passive fires), §6 (Phase 0), §12 (I1 carve-out,
new invariants), §15 (remove "state connections"), §16 (decisions).

---

## S0. Scope

**Added**

- **State connections** become executable. A state edge reads one node's state
  and modifies another. Three modes: **`trigger`** (pulse), **`activator`**
  (level gate), **`label`** (numeric modifier).
- **`passive` activation** fires — but only when a trigger pulse reaches it and
  its activator gate (if any) is satisfied.
- A per-run **`triggerQueue`** carried inside `state` for delayed triggers.
- `report.stateEvents` — one entry per state edge that had an effect this step;
  drives the state-edge UI pulse.
- Optional edge fields: **`delay`** (integer ≥ 0 steps) on `trigger`;
  `expr` gains a small grammar (§S6).

**Unchanged from Engine A / B**

- The two-phase resource step (`SEMANTICS.md` §6), the reservation ledger,
  back-pressure, `pull any` / `pull all`, contention order, capacity clamp,
  numeric conventions (finite reals ≥ 0, `epsilon = 1e-9`).
- RNG / probabilistic Gate / Monte-Carlo. State evaluation is **deterministic**
  and draws no randomness in `loop-state/1`.
- `ended` is set **only** by an End node receiving a resource. State edges never
  end a run.
- Invariants **I2–I5, I7** hold verbatim. **I1 gets a carve-out** for `label`
  modifiers (§S10). **I6** is restated (state now carries `triggerQueue`).
  **I8-S, I9-S, I10-S** are added.

**Still deferred**

- `interactive` activation as a *distinct* behaviour (the engine treats it like
  `passive`; the click affordance is UI-only, later).
- `activator` / `label` **delay** (only `trigger` delay ships now).
- Per-edge **OR** combination for activators (the default is AND; §S7).
- `label` modifiers targeting a *resource connection's* flow rate (targets are
  nodes only in this spec).
- Typed / multi-colour resources, Register / Trader formula nodes.

### S0.1 Settled decisions (proposed for this review)

1. **The signal is `fired`, not `activated`.** A trigger source "fires" when it
   moved / produced / consumed `> epsilon` last step (`report.fired`).
   `activated` includes nodes that evaluated but did nothing — too noisy for a
   pulse.
2. **Effects apply next step.** State edges are resolved in a new **Phase 0** at
   the top of each step, reading the *previous* step's committed values `S` and
   `fired` set. A cause in step *n* changes behaviour in step *n+1* at the
   earliest. This removes intra-step ordering dependence and makes state cycles
   safe with no cycle detection.
3. **`node` mode is dropped.** `StateMode` narrows to
   `'trigger' | 'activator' | 'label'`. "Node modifier" had no single target
   field in Loop Studio's model and overlapped `label`. (Migration: an existing
   `mode: 'node'` edge loads as `'label'` with a diagnostic.)
4. **`label` / `activator` sources must be Pools.** Their value is the source
   Pool's snapshot `S[src]`. A non-Pool source → the edge is inert + a
   diagnostic. `trigger` sources may be any node (the signal is "did it fire").
5. **`label` modifiers are a declared external source/sink.** They change the
   target Pool's stored value without a matching resource flow. Conservation
   (I1) is asserted over resource flow only; `label` deltas are reported
   separately.

---

## S1. The state-connection model

### S1.1 Direction

A state edge is stored `source → target` where:

- `source` = the node whose state is **read** (the diamond port on its
  **bottom**, `state-source`).
- `target` = the node that is **modified / gated / triggered** (the diamond port
  on its **top**, `state-target`).

`onConnect` already pins these handles; `normalizeGraph` never rewrites them.

### S1.2 The read value `v_src`

| source kind | `v_src` (used by `activator`, `label`) |
|---|---|
| Pool | `S[source]` — the value committed at the end of the previous step |
| non-Pool | edge is inert for `activator` / `label`; diagnostic `"state <mode> needs a Pool source"` |

For `trigger`, there is no `v_src`; the signal is the boolean
`source ∈ fired(previous step)`.

### S1.3 Modes at a glance

| mode | kind | reads | affects the target by | `expr` |
|---|---|---|---|---|
| `trigger` | one-step pulse | source **fired** last step | letting a `passive` target fire this step | *unused* |
| `activator` | continuous level | `v_src` vs `expr` | enabling / disabling the target this step | comparison, e.g. `>=5` |
| `label` | numeric modifier | `v_src` | adding to / setting the target Pool's stored value in Phase 0 | assignment, e.g. `+1`, `-2`, `=S` |

---

## S2. Timing — Phase 0

The step function gains a **Phase 0** before Push:

```
step(nodes, edges, prev, seed):
  S            = prev.values                       # snapshot, read-only
  working      = { ...prev.values }
  firedPrev    = prev.fired                        # (now carried in state)
  queue        = prev.triggerQueue

  ── Phase 0 — state ─────────────────────────────────────────────
  triggered    = { e.target : e is trigger edge,
                              {tgt,due} ∈ queue with due == curStep }   # union
  queue'       = queue without the entries consumed above
  enabled(n)   = activatorGate(n, S)               # §S4 — default true
  for each label edge in ascending edge.id:        # §S5
      working[e.target] = applyLabel(working[e.target], e, S)
  clamp every touched Pool in working to [0, capacity]

  ── Phase 1 — Push (Sources) ───────────────────────────────────  # unchanged
  ── Phase 2 — Pull (routers) ───────────────────────────────────  # unchanged
      a node fires only if  baseFiring(n) ∧ enabled(n)             # §S3, §S4
      a passive/interactive node fires iff  n ∈ triggered ∧ enabled(n)

  ── Commit ─────────────────────────────────────────────────────  # unchanged
  fired        = { nodes that moved > epsilon this step }          # includes
                                                                   # trigger-fired passives
  ── schedule future triggers ───────────────────────────────────
  queue''      = queue' ++ { {target: e.target, due: curStep+1+e.delay}
                            for each trigger edge e with e.source ∈ fired }

  return state = { step: curStep, values: working, ended,
                   fired, triggerQueue: queue'' }
```

Notes:

- `baseFiring(n)` is the old `firing(n)`: `automatic` every step, `onStart` on
  step 0→1.
- A `label` edit lands in `working` *before* Phase 1, so it is subject to
  capacity clamp and behaves toward downstream pulls exactly like a Source push
  that step (back-pressure, snapshot rules unchanged).
- `triggered` and `enabled` are **set membership** over node ids — array order
  of `nodes` / `edges` does not affect them.

---

## S3. `trigger`

- **Pulse, next step, optional integer `delay ≥ 0`.**
- At the **end of step *n***, for every `trigger` edge `src → tgt` with
  `src ∈ fired(n)`: enqueue `{ tgt, due = n + 1 + delay }`.
  `delay = 0` ⇒ delivered in step *n+1*. `delay` is **step units**;
  `0` is allowed and is the minimum. A negative or non-integer `delay` → treated
  as `0` + diagnostic.
- At **Phase 0 of step *m***: every queued entry with `due == m` marks its
  `tgt` as `triggered` this step and is removed from the queue. Multiple entries
  for the same `tgt` in the same step collapse to one (it is a set).
- **Effect on the target:**
  - `activation: passive` or `interactive` → the node **fires this step** iff it
    is also `enabled` (§S4). It is evaluated exactly as an `automatic` node
    would be for that one step (Phase 1 if Source, Phase 2 if router).
  - `activation: automatic` / `onStart` → a trigger has **no effect** (the node
    already fires on its own schedule). No off-cycle double fire.
- A `passive` node with **no incoming trigger edge** never fires (unchanged from
  `SEMANTICS.md` §4).
- `expr` is ignored for `trigger` (the Inspector already hides it).

---

## S4. `activator`

- **Continuous level gate. No delay in `loop-state/1`.**
- `expr` is a **comparison**: `>= N`, `> N`, `<= N`, `< N`, `== N`, `!= N`
  (whitespace optional; `N` a finite real). An unparseable `expr` → the edge is
  inert + diagnostic; it does **not** disable the target.
- Each Phase 0: `satisfied(e) = compare(v_src, e.expr)` using `S[source]`.
- **Gate combination (AND):** for a target `t` with activator edges
  `E_act(t)`, `enabled(t) = ∀ e ∈ E_act(t): satisfied(e)`.
  A target with **no** activator edges ⇒ `enabled(t) = true`.
  *(Per-edge OR is deferred — express "any" by routing activators through an
  intermediate Pool for now.)*
- **Interaction with `trigger`:** the two are orthogonal signals.
  - `automatic` target: fires iff `baseFiring ∧ enabled`.
  - `passive` target: fires iff `triggered ∧ enabled`.
  So an activator can *hold off* a passive node that has been triggered, and can
  *pause* an automatic node.
- A disabled node contributes nothing this step: it is skipped in Phase 1 / 2,
  its `inbox` (if any) is **not** consumed and carries no resource (a disabled
  router is inert, like a zero-weight branch), nothing is dropped.

---

## S5. `label` modifier

- **Numeric modifier applied to the target Pool's stored value in Phase 0.**
  Target **must be a Pool**; a non-Pool target → inert + diagnostic.
- `expr` grammar (assignment):

  | form | meaning |
  |---|---|
  | `+N` | `working[tgt] += N` |
  | `-N` | `working[tgt] -= N` |
  | `=N` | `working[tgt]  = N` |
  | `+S` | `working[tgt] += S[source]` |
  | `-S` | `working[tgt] -= S[source]` |
  | `=S` | `working[tgt]  = S[source]` |

  `N` is a finite real ≥ 0. An empty or unparseable `expr` → inert + diagnostic
  (no implicit default).
- **Deterministic order for multiple modifiers into the same target:** ascending
  `edge.id` (the canonical tiebreak used for gate branches, `SEMANTICS-B1.md`
  §B4.2). Apply each in turn to the running `working[tgt]`.
- After **all** Phase-0 modifiers (across all targets) are applied, clamp every
  touched Pool to `[0, capacity]` **once**. A `label` push that would exceed
  capacity is truncated (the excess is lost — a `label` sink, reported).
- **Non-conserving by design.** The source Pool is **not** debited; `S[source]`
  is only read. The delta on the target is an external source/sink, recorded in
  `stateEvents` and **excluded** from the I1 conservation sum.
- A `label` edge does not gate or trigger; it always applies (subject to source
  being a Pool).

---

## S6. `delay` and expression grammar

- **`delay`** — new optional `StateEdgeData` field, `delay?: number`.
  - Applies to **`trigger` only** in `loop-state/1`.
  - Integer, `≥ 0`, **step units**. `0` = the immediately following step.
  - `NaN` / `Infinity` / fractional / negative → coerced to `0` + one diagnostic.
  - Default when absent: `0`.
- **`expr`** — existing field, per-mode grammar:
  - `trigger`: ignored.
  - `activator`: `(>=|>|<=|<|==|!=)\s*<finite real>`. Case/space tolerant.
  - `label`: `[+\-=](N|S)` where `N` is a finite real ≥ 0 and `S` is the literal
    token for `S[source]`.
  - Any `expr` that does not parse for its mode ⇒ the edge is **inert** and adds
    one `diagnostics` line; it never partially applies.

---

## S7. Combining rules, ordering, cycles

| situation | rule |
|---|---|
| several `activator` edges into one target | **AND** — all must be satisfied |
| several `trigger` pulses due at one target in one step | **OR** — one delivery, the node fires once |
| `activator` + `trigger` into one target | orthogonal: `fires = triggered ∧ enabled` (passive) or `baseFiring ∧ enabled` (automatic) |
| several `label` edges into one target | applied in ascending `edge.id`, each to the running value, then one clamp |
| `label` + `activator` into one target | independent — `label` always applies; `activator` gates *firing*, not the `label` edit |
| a state edge and a resource edge between the same pair | independent; different `kind`, different phase |
| **state cycle** (A→B→…→A via state edges) | **allowed, no detection needed.** Phase 0 is a pure function of `prev`; effects chase step by step, exactly like a resource loop needs a Pool. A cycle may oscillate forever — that is a valid non-terminating run, not an error. `ended` is unaffected. |

Determinism: `triggered` / `enabled` are set membership; `label` order is by
`edge.id`; scheduling reads the `fired` **set**. No step result depends on the
order of the `nodes` or `edges` arrays (I8-S).

---

## S8. `state`, Reset, and Monte-Carlo isolation

- `SimState` gains two fields:
  - `fired: string[]` — the previous step's fired set (already computed; now
    carried so Phase 0 / scheduling can read it without recomputation).
  - `triggerQueue: { target: string; due: number }[]` — pending delayed
    triggers, `due` an absolute step index. Sorted by `(due, target)` for a
    canonical serialisation; membership is what matters.
- `initSim(nodes)` sets `fired: []`, `triggerQueue: []` (plus the existing
  `values` / `step: 0` / `ended: false`). **Reset rebuilds `state` entirely** —
  every pending trigger and delay is discarded (I6).
- **Monte-Carlo isolation:** `triggerQueue` and `fired` live in `SimState`,
  which `fillOneRun` (`SEMANTICS-B2.md`) creates fresh per run via `initSim`.
  There is **no module-level state**. Run *i*'s pending triggers can never leak
  into run *j* (I9-S).
- `triggerQueue` entries whose `due` is already `< curStep` (should never
  happen) are dropped defensively with a diagnostic.

---

## S9. `report` events ↔ UI pulse

`StepReport` gains:

```ts
stateEvents: {
  edgeId: string
  from: string          // source node id
  to: string            // target node id
  mode: 'trigger' | 'activator' | 'label'
  effect:
    | { kind: 'trigger'; delivered: true }            // a pulse reached `to` this step
    | { kind: 'activator'; satisfied: boolean }       // the gate's value this step
    | { kind: 'label'; delta: number; applied: number } // requested vs post-clamp change
}[]
```

- Emitted **in ascending `edgeId`** order.
- **`trigger`**: one entry in the step the pulse is *delivered* (Phase 0 of the
  due step), not when scheduled. The UI pulses the state edge then.
- **`activator`**: one entry every step for every activator edge, carrying the
  current boolean. The UI shows a steady "on" tint while `satisfied`, dim
  otherwise — no travelling pulse.
- **`label`**: one entry per step per label edge that applied, with the raw
  `delta` and the `applied` amount after the target's capacity clamp
  (`applied ≠ delta` ⇒ a truncated push/pull, worth surfacing).
- `report.fired` now includes `passive` / `interactive` nodes that fired via a
  trigger. The **firing pulse** on a node still uses `fired` only
  (`SEMANTICS.md` decision 5) — a trigger-fired passive node pulses like any
  other firing node.
- `report.events` (resource transfers) is **unchanged**. `label` edits are *not*
  resource transfers and never appear there.

---

## S10. Invariants

| # | Invariant |
|---|---|
| **I1′** | **Conservation (resource flow).** Per step, over **resource** movement only: `Σ Pool(after) = Σ Pool(before) + Σ Source push + Σ label delta(applied) − Σ Drain/End pull − Σ Converter net loss`. `label` deltas are an explicit external term; every other transit conserves. |
| **I2–I5** | Unchanged. `label` pre-adjusts `working` before Phase 1, so capacity (I3) and back-pressure retention (I4) still hold for everything downstream. |
| **I6′** | **Determinism.** `step` is pure; `initSim` total. `state` now includes `fired` and `triggerQueue`. Same graph + same start ⇒ identical `state` sequence, `report.events`, and `report.stateEvents`, on every run and after every Reset. |
| **I7** | Unchanged (resource iteration-order invariance). |
| **I8-S** | **State iteration-order invariance.** Reversing the `nodes` and/or `edges` arrays yields identical `values`, `fired`, `events`, `stateEvents`, and `triggerQueue` (membership). Achieved via `edge.id` order for `label` / `stateEvents` and set membership for `triggered` / `enabled`. |
| **I9-S** | **Monte-Carlo per-run isolation.** No module-level state. Each run's `triggerQueue` / `fired` originate from its own `initSim` and are discarded at run end. Result of run *i* is independent of whether run *j* ran before it. |
| **I10-S** | **State never ends a run.** `ended` transitions come only from an End node receiving `> epsilon`. A state cycle that oscillates forever is a valid non-terminating run. |

---

## S11. Representative samples & expected results (test basis)

`epsilon = 1e-9`; all pull nodes `pull any`; `S` = previous step's committed
values. Tables are the freeze target.

### Case S-A — trigger + passive activation, `delay = 0`

```
Src ──e1:2──► Pool P ──e2:1──► Drain D            D: activation = passive
 (auto,        (init 0,        (pulls 1 from P)
  push any)     cap ∞)
Src ┄┄ t1: trigger, delay 0 ┄┄► D                 (state edge, Src bottom → D top)
```

Src fires every step ⇒ at end of step *n* it schedules D for step *n+1*.
D is `passive`: it fires **only** on a step it is triggered.

| step | P | Src→P | P→D | D triggered? | note |
|---:|---:|---:|---:|:--:|---|
| 0 | 0 | – | – | – | initial; `triggerQueue = []` |
| 1 | 2 | 2 | 0 | **no** | Src fired step 0? no (step 0 is initial). D idle. queue after: `{D@2}` |
| 2 | 3 | 2 | 1 | **yes** | delivered `{D@2}`; D pulls 1 from `S[P]=2`. queue after: `{D@3}` |
| 3 | 4 | 2 | 1 | yes | steady: +2 −1 |
| ≥3 | +1/step | 2 | 1 | yes | P rises by 1 each step |

`fired`: step 1 = {Src}; step ≥ 2 = {Src, D}. `stateEvents`: step ≥ 2 has one
`{edgeId: t1, mode: trigger, effect: {kind: trigger, delivered: true}}`.

**Variant S-A2 — `delay = 2`.** Scheduling at the end of step *n* uses
`due = n+1+2`. The first pulse (from Src firing in step 1) is due step 4, and
every later step schedules one too, so D fires every step from 4 on.
P = 0, 2, 4, 6, 7, 8, 9, … — rises by 2 through step 3, by 1 from step 4.

### Case S-B — activator level gate (AND of two)

```
Src ──e1:3──► Pool P ──e2:2──► Drain D            D: activation = automatic
Gauge A (Pool, init 6) ┄┄ a1: activator ">= 5" ┄┄► D
Gauge B (Pool, init 4) ┄┄ a2: activator ">= 5" ┄┄► D
```

A and B have no in/out edges — their values are constant. `enabled(D) =
(S[A] ≥ 5) ∧ (S[B] ≥ 5) = true ∧ false = false` on **every** step.

| step | P | Src→P | P→D | enabled(D) | note |
|---:|---:|---:|---:|:--:|---|
| 0 | 0 | – | – | – | initial |
| 1 | 3 | 3 | 0 | **false** | D disabled (B = 4 < 5) |
| 2 | 6 | 3 | 0 | false | P just accumulates |
| ≥1 | +3/step | 3 | 0 | false | D never fires |

`fired` every step = {Src}. `stateEvents` every step: `a1 satisfied:true`,
`a2 satisfied:false` (ascending `edgeId`).

**Variant S-B2 — B init `5`.** `enabled(D) = true` from step 1. Then:
`P` = 0, 3, 4, 5, 5, … (step 1: +3; step 2: `S[P]=3`, D pulls 2 → net +1 = 4;
step 3: `S[P]=4`, D pulls 2 → 3+... wait recompute) —

| step | P | Src→P | P→D (from `S[P]`) |
|---:|---:|---:|---:|
| 0 | 0 | – | – |
| 1 | 3 | 3 | 0 (S[P]=0) |
| 2 | 4 | 3 | 2 (S[P]=3) |
| 3 | 5 | 3 | 2 (S[P]=4) |
| 4 | 6 | 3 | 2 |
| ≥3 | +1/step | 3 | 2 | net +1, no steady state (Src 3 > Drain 2) |

### Case S-C — label modifier (non-conserving) + order + clamp

```
Feeder F (Pool, init 10, isolated)
F ┄┄ m1: label "-1" ┄┄► Tank T           (subtract 1 from T each step)
F ┄┄ m2: label "+S"  ┄┄► Tank T           (then add S[F] = 10)   edge id m2 > m1
Tank T: Pool, init 0, cap 8
T ──e1:4──► Drain D  (auto)
```

Phase 0 order by `edge.id`: `m1` then `m2`. Per step, starting from
`working[T] = S[T]`:
`working[T] = (S[T] − 1) + 10 = S[T] + 9`, then clamp to `[0, 8]`, then Phase 2
Drain pulls `min(4, S[T])`.

`F` is **never debited** — `S[F] = 10` forever. I1′: T's change each step =
`label applied` + `−Drain pull`.

| step | S[T] | after m1 (−1) | after m2 (+S[F]=+10) | clamp→[0,8] | Drain pull (min 4, S[T]) | T (commit) |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | – | – | – | – | 0 |
| 1 | 0 | −1\* | 9 | **8** | 0 (S[T]=0) | 8 |
| 2 | 8 | 7 | 17 | **8** | 4 (S[T]=8) | 4 |
| 3 | 4 | 3 | 13 | **8** | 4 | 4 |
| ≥3 | 4 | 3 | 13 | 8 | 4 | 4 → steady |

\* the intermediate `−1` is allowed *within* Phase 0; the single clamp is at the
**end** of Phase 0. (If a reviewer prefers clamping after **each** modifier,
that is decision **D3** in §S12.)

`stateEvents` per step (ascending id): `m1 {label, delta:-1, applied:-1}`,
`m2 {label, delta:+10, applied: …}` where `applied` reflects the post-clamp
contribution (step 2: requested +10 from 7→17, clamped to 8 ⇒ `applied:+1`).
`report.events` never contains `m1` / `m2`.

---

## S12. Open decisions for review

- **D1 — activator combine default.** Spec says **AND**. Confirm, or ship a
  per-edge `combine: 'all' | 'any'` now (default `all`).
- **D2 — trigger on `automatic` targets.** Spec says **no effect**. Alternative:
  a trigger forces an extra off-cycle activation. Recommend "no effect" — keeps
  `automatic` meaning "every step, period".
- **D3 — label clamp granularity.** Spec clamps **once** at the end of Phase 0
  (order still deterministic, but an intermediate value may go out of range).
  Alternative: clamp after **each** modifier. Recommend once — fewer surprises
  with `-` then `+` pairs.
- **D4 — `v_src` for a non-Pool `activator` / `label` source.** Spec makes the
  edge **inert + diagnostic**. Alternative: `v_src = 1 if fired else 0`.
  Recommend inert — a comparison against a fired-bit is rarely what the author
  means, and the diagnostic teaches the model.
- **D5 — `delay` field location.** New `StateEdgeData.delay?: number`. Confirm it
  is **not** promoted to a `recommendedRunConfig`-style doc concern (it is graph
  structure, belongs in the edge).
- **D6 — disabled router `inbox`.** Spec: a disabled router does not consume its
  `inbox`; the upstream keeps the resource (back-pressure). Confirm vs.
  "disabled router drops its inbox" (would violate I4).
- **D7 — `interactive` in the engine.** Spec treats it identically to `passive`.
  Confirm the click-to-fire affordance is a later UI slice.

---

## S13. Implementation slices (after freeze)

Each slice is a reviewable branch checkpoint; the §S11 tables gate slice 1 & 2,
new tables gate 3–5.

1. **Trigger + passive activation.** `state` gains `fired` + `triggerQueue`;
   Phase 0 delivers `delay = 0` pulses; `passive` fires on delivery;
   `report.stateEvents` for triggers; Case **S-A**.
2. **Activator.** `enabled(n)` gate, AND-combine, `automatic` pause + `passive`
   hold-off; `stateEvents` for activators; Cases **S-B / S-B2**.
3. **Delay & condition.** `StateEdgeData.delay`; `triggerQueue` with
   `due = n+1+delay`; the `activator` comparison grammar hardened; Variant
   **S-A2**; Monte-Carlo isolation test (I9-S).
4. **Label modifier.** Phase-0 numeric edits, `edge.id` order, single clamp,
   I1′ carve-out; `stateEvents` for labels; Case **S-C**; conservation test with
   the `label` term.
5. **UI pulse + Inspector.** State-edge travelling pulse for `trigger`, steady
   tint for `activator`, delta flash for `label`; Inspector gains `delay` and
   validates `expr` per mode; `mode: 'node'` legacy edges migrate to `'label'`.

Reverse-array determinism (I8-S) is asserted in every slice.
