# Execution semantics — State connections

**Status: DRAFT, ready for freeze review.** D1–D7 resolved (§S12) and the seven
pre-freeze additions folded in (this revision). No engine code yet. On freeze
the §S11 tables become the acceptance vectors and implementation begins on
`feat/state-semantics` in the slice order of §S13.

This document *extends* [`SEMANTICS.md`](./SEMANTICS.md) (Engine A, frozen) and
is compatible with [`SEMANTICS-B1.md`](./SEMANTICS-B1.md) /
[`SEMANTICS-B2.md`](./SEMANTICS-B2.md); it only states what changes and what is
added. Section numbers are `S0…S13`.

Spec id: **`loop-state/1`**. On freeze this folds into `SEMANTICS.md` with edits
to §2 (state carries `fired` + `triggerQueue`), §4 (`passive` fires; `onStart`
interaction), §6 (Phase 0), §12 (I1 carve-out, new invariants), §15 (remove
"state connections"), §16 (decisions).

---

## S0. Scope

**Added**

- **State connections** become executable. A state edge reads one node's state
  and modifies another. Three modes: **`trigger`** (pulse), **`activator`**
  (level gate), **`label`** (numeric modifier on a Pool).
- **`passive` activation** fires — but only when a trigger pulse reaches it and
  its activator gate (if any) is satisfied.
- A per-run **`triggerQueue`** carried inside `state` for delayed triggers.
- `report.stateEvents` — one entry per state edge with an effect this step;
  drives the state-edge UI pulse.
- New optional edge field **`delay`** (integer ≥ 0 steps) used by `trigger`;
  `expr` gains a small per-mode grammar (§S6).

**Unchanged from Engine A / B**

- The two-phase resource step (`SEMANTICS.md` §6), the reservation ledger,
  back-pressure, `pull any` / `pull all`, contention order, capacity clamp,
  numeric conventions (finite reals ≥ 0, `epsilon = 1e-9`).
- RNG / probabilistic Gate / Monte-Carlo. State evaluation is **deterministic**
  and draws no randomness in `loop-state/1`.
- `ended` is set **only** by an End node receiving a resource. State edges never
  end a run (I10-S).
- Invariants **I2–I5, I7** hold verbatim. **I1 → I1′** (carve-out for `label`).
  **I6 → I6′** (state now carries `fired` + `triggerQueue`). **I8-S, I9-S,
  I10-S** are added.

**Still deferred**

- `interactive` as a *distinct* engine behaviour (identical to `passive`
  headless; §S12 D7).
- `activator` / `label` **delay** (only `trigger` delay ships now).
- Per-**target** `all | any` activator policy (v1 is AND only; §S12 D1).
- `label` modifiers targeting a *resource connection's* flow rate, or a non-Pool
  target field (v1 targets Pools only; §S5).
- Typed / multi-colour resources, Register / Trader formula nodes.

### S0.1 Settled decisions

1. **Signal = `fired`, not `activated`.** A `trigger` source fires when it moved
   / produced / consumed `> epsilon` last step (`report.fired`). `activated`
   includes nodes that evaluated but did nothing — too noisy for a pulse.
2. **Effects apply next step**, via a new **Phase 0** at the top of `step()`
   that reads the *previous* step's committed values `S` and `fired` set. A
   cause in step *t* changes behaviour in step *t+1* at the earliest. This
   removes intra-step ordering dependence and makes state cycles safe with no
   cycle detection.
3. **`node` mode is not executed and is not auto-converted.** `mode: 'node'`
   (and any unrecognised `mode`) loads **inert** with a diagnostic
   `"state mode '<x>' is not supported; connection has no effect"`. There is no
   evidence the legacy `node` option meant a label modifier, and a silent
   `node → label` rewrite on Import would let a previously-inert edge start
   creating or destroying resources. An automatic conversion is approved only
   if a fixture demonstrates the intended meaning; otherwise migration is an
   explicit UI action (§S13 slice 5).
4. **`activator` / `label` sources must be Pools.** Their read value is the
   source Pool's snapshot `S[source]`. A non-Pool source ⇒ the edge is **inert +
   diagnostic**. Only `trigger` accepts any node as its source (the signal is
   "did it fire").
5. **`label` modifiers are a declared external source/sink.** They change the
   target Pool's step-start balance without a matching resource flow.
   Conservation is asserted over resource movement only; `label` deltas are an
   explicit term (I1′) and are reported separately, never in `report.events`.
6. **`onStart` is an independent one-shot** (§S3.2): it fires once, on the
   step 0 → 1 advance, *if* its activator gate is satisfied then; a later
   `trigger` never re-fires it, and it does not wait for a closed gate to open.

---

## S1. The state-connection model

### S1.1 Direction

A state edge is stored `source → target`:

- `source` = the node whose state is **read** — the diamond port on its
  **bottom** (`state-source`).
- `target` = the node that is **modified / gated / triggered** — the diamond
  port on its **top** (`state-target`).

`onConnect` already pins these handles; `normalizeGraph` never rewrites them.

### S1.2 The read value `v_src`

| source kind | `v_src` (for `activator`, `label`) |
|---|---|
| Pool | `S[source]` — the value committed at the end of the previous step |
| non-Pool | edge **inert**; diagnostic `"state <mode> needs a Pool source"` |

For `trigger` there is no `v_src`; the signal is `source ∈ fired(previous step)`.

### S1.3 Modes at a glance

| mode | kind | reads | affects the target by | `expr` |
|---|---|---|---|---|
| `trigger` | one-step pulse (opt. `delay`) | source **fired** last step | letting a `passive` / `interactive` target fire this step | *unused* |
| `activator` | continuous level | `v_src` vs `expr` | enabling / disabling the target this step (AND-combined) | comparison, e.g. `>= 5` |
| `label` | numeric modifier | `v_src` | adjusting the target **Pool**'s step-start balance in Phase 0 | assignment, e.g. `+1`, `-2`, `=S` |

---

## S2. Timing — Phase 0

`step()` gains a **Phase 0** before Push:

```
step(nodes, edges, prev, seed):
  curStep      = prev.step + 1
  S            = prev.values                    # snapshot, read-only
  working      = { ...prev.values }
  firedPrev    = prev.fired                     # carried in state
  queue        = prev.triggerQueue              # [{ edgeId, target, deliveryStep }]

  ── Phase 0 — state ────────────────────────────────────────────
  due          = { q ∈ queue : q.deliveryStep == curStep }
  triggered    = { q.target : q ∈ due , the edge q.edgeId still exists
                              and q.target still exists }        # a SET
  queue'       = queue \ due                    # every due entry removed, delivered or not
  enabled(n)   = activatorGate(n, S)            # §S4 — no activator edges ⇒ true
  for each label edge e in ascending e.id:      # §S5 — source & target are Pools
      working[e.target] = applyLabel(working[e.target], e, S)
  clamp every Pool touched by a label edge to [0, capacity]   # ONCE, after all of them

  ── Phase 1 — Push (Sources) ──────────────────────────────────  # unchanged
  ── Phase 2 — Pull (routers) ──────────────────────────────────  # unchanged
      automatic / onStart node n fires iff  baseFiring(n) ∧ enabled(n)
      passive / interactive node n fires iff  (n ∈ triggered) ∧ enabled(n)
      a node with enabled(n) == false is skipped entirely: its inbox (if any)
      is NOT consumed and stays with the upstream (I4 preserved)

  ── Commit ────────────────────────────────────────────────────  # unchanged
  fired  = { nodes that moved > epsilon this step }   # incl. trigger-fired passives

  ── Schedule future triggers ──────────────────────────────────
  for each trigger edge e with e.source ∈ fired:
      queue'' = queue' ++ { edgeId: e.id, target: e.target,
                            deliveryStep: curStep + e.delay + 1 }     # §S6

  return state = { step: curStep, values: working, ended,
                   fired, triggerQueue: sortBy(queue'', (deliveryStep, edgeId)) }
```

- `baseFiring(n)` is the old `firing(n)`: `automatic` every step; `onStart` only
  when `curStep == 1`.
- A `label` edit lands in `working` *before* Phase 1, so downstream pulls,
  capacity clamp, and back-pressure treat it exactly like a Source push that
  step.
- `triggered` and `enabled` are **set membership** over node ids — the order of
  the `nodes` / `edges` arrays never affects them (I8-S).

### S2.1 Activation modes under state

| `activation` | fires when | activator gate | trigger pulse |
|---|---|---|---|
| `automatic` | every step | gates it (`baseFiring ∧ enabled`) | **no execution effect**; delivery still reported (`applied:false`) |
| `onStart` | step 0 → 1 only, once | gates that one attempt; a closed gate ⇒ it never fires (§S3.2) | no execution effect; delivery reported (`applied:false`) |
| `passive` | only on a step it is `triggered` | gates it (`triggered ∧ enabled`) | **this is its fire signal** |
| `interactive` | headless: identical to `passive` | same as `passive` | same as `passive` (a live-UI click is modelled as an external trigger pulse — §S12 D7) |

---

## S3. `trigger`

- **One-step pulse, next step, optional integer `delay ≥ 0` (step units).**
- `expr` is ignored (the Inspector already hides it).

### S3.1 Scheduling and delivery

**Formula (fixes off-by-one):**

```
source fired at step t ,  edge delay d
deliveryStep = t + d + 1
```

so `delay:0` ⇒ step `t+1`, `delay:2` ⇒ step `t+3`.

- At the **end of step *t***, for every trigger edge `e` with `e.source ∈
  fired(t)`: append `{ edgeId: e.id, target: e.target, deliveryStep: t+d+1 }` to
  `triggerQueue`.
- `d` that is `NaN` / `Infinity` / fractional / negative ⇒ treated as `0` + one
  diagnostic.
- At **Phase 0 of step *m***: every queued entry with `deliveryStep == m` is
  removed from the queue and, if its edge and target still exist (§S8), marks
  its `target` as `triggered` this step.

### S3.2 Effect on the target

| target `activation` | effect of a delivered pulse |
|---|---|
| `passive` / `interactive` | the node **fires this step** iff `enabled(target)` (§S4). It is evaluated exactly as an `automatic` node would be for that one step — Phase 1 if a Source, Phase 2 if a router. |
| `automatic` | **no execution effect** (it already fires on its own schedule; no off-cycle double fire). |
| `onStart` | **no execution effect.** `onStart` fires only on step 0 → 1, gated once by its activator condition. A `trigger` never re-fires it; a gate that is closed at step 1 means it simply never fires (it does not wait). |

For `automatic` and `onStart` targets the delivery is still emitted as a
`stateEvent` with `applied: false` (§S9) so the UI pulses and the run is
debuggable.

### S3.3 Simultaneous pulses at one target

Several trigger edges delivering to the same target on the same step:

- the target executes **at most once** (it is a set membership);
- combination is **OR** — any one delivered pulse is enough;
- `report.stateEvents` records **every** arriving edge separately
  (`{ edgeId, …, effect.applied }`);
- the UI pulses **each** contributing state edge.

A `passive` node with **no** incoming trigger edge never fires
(`SEMANTICS.md` §4, unchanged).

---

## S4. `activator`

- **Continuous level gate. No delay in `loop-state/1`.**
- `expr` is a **comparison**: `>= N`, `> N`, `<= N`, `< N`, `== N`, `!= N`
  (whitespace optional; `N` a finite real). An unparseable `expr` ⇒ the edge is
  **inert + diagnostic**; it does **not** disable the target.
- Each Phase 0: `satisfied(e) = compare(S[e.source], e.expr)`.
- **Combination (AND, v1):** for a target `t` with activator edges `E_act(t)`,

  ```
  enabled(t) =  E_act(t) is empty                                → true
                otherwise  ∀ e ∈ E_act(t) : satisfied(e)
  ```

  The **empty set is `true`** (a node with no activator edges is always
  enabled). Per-edge `all | any` is out of scope; if added later it is a
  *target-level* policy attribute, never per-edge (§S12 D1).
- **Interaction with `trigger`** — orthogonal signals:
  - `automatic` / `onStart` target: fires iff `baseFiring(n) ∧ enabled(n)`.
  - `passive` / `interactive` target: fires iff `(n ∈ triggered) ∧ enabled(n)`.
- **A disabled node is skipped entirely** in Phase 1 / 2. If it is a router, its
  `inbox` (if any) is **not** consumed and the resource stays with the upstream
  node (back-pressure — I4). A disabled router never drops resources (I5, I4).

---

## S5. `label` modifier

**v1 scope — a bounded list:**

- **source: a Pool.** Read value `v_src = S[source]`. Non-Pool source ⇒ inert +
  diagnostic.
- **target: a Pool.** Non-Pool target ⇒ inert + diagnostic.
- **what it changes:** `working[target]`, the target Pool's **step-start
  balance** (initialised from `S[target]`), during Phase 0. The resource Phase 1
  / Phase 2 of the same step then operate on that adjusted value.
- **`expr` grammar** (assignment):

  | form | meaning |
  |---|---|
  | `+N` | `working[target] += N` |
  | `-N` | `working[target] -= N` |
  | `=N` | `working[target]  = N` |
  | `+S` | `working[target] += S[source]` |
  | `-S` | `working[target] -= S[source]` |
  | `=S` | `working[target]  = S[source]` |

  `N` is a finite real ≥ 0. An empty or unparseable `expr`, or `N` that is
  `NaN` / `Infinity`, ⇒ **inert + diagnostic** (never a partial apply).
- **Order for multiple modifiers into one target:** ascending `edge.id` (the
  canonical tiebreak from `SEMANTICS-B1.md` §B4.2). Apply each in turn to the
  running `working[target]`.
- **Clamp: once**, at the **end of Phase 0**, after *all* label edges (across all
  targets) have been applied: `working[P] → [0, capacity]`. A Pool **without a
  capacity** gets only the lower bound `0`. Intermediate out-of-range values
  between two modifiers are allowed; the excess removed by the single final
  clamp is a `label` sink and is reported (`applied ≠ delta`, §S9).
- **Non-conserving by design.** The source Pool is **never debited** — `S[source]`
  is only read. The net change on the target is an external source/sink term in
  I1′ and appears in `report.stateEvents`, never in `report.events`.
- A `label` edge does not gate or trigger; it always applies (subject to the
  source and target both being Pools with a valid `expr`).

---

## S6. `delay` and expression grammar

- **`delay`** — new optional `StateEdgeData` field, `delay?: number`
  (graph structure — it lives on the edge, not in any run config; §S12 D5).
  - Used by **`trigger` only** in `loop-state/1`.
  - Integer, `≥ 0`, **step units**. Delivery: `deliveryStep = t + delay + 1`
    where `t` is the step the source fired (§S3.1). `delay: 0` ⇒ next step.
  - `NaN` / `Infinity` / fractional / negative ⇒ coerced to `0` + one
    diagnostic. Absent ⇒ `0`.
- **`expr`** — per mode:
  - `trigger`: ignored.
  - `activator`: `(>=|>|<=|<|==|!=)\s*<finite real>`, case/space tolerant.
  - `label`: `[+\-=](N|S)`, `N` a finite real ≥ 0, `S` the literal token for
    `S[source]`.
  - Any `expr` that does not parse for its mode ⇒ the edge is **inert** and adds
    one `diagnostics` line; it never partially applies.

---

## S7. Combining rules, ordering, cycles

| situation | rule |
|---|---|
| several `activator` edges into one target | **AND** — all `satisfied`; empty set ⇒ `true` |
| several `trigger` pulses due at one target in one step | **OR**; the node executes at most once; every arriving edge is reported and pulsed (§S3.3) |
| `activator` + `trigger` into one target | orthogonal: `fires = (triggered ∧ enabled)` (passive) or `(baseFiring ∧ enabled)` (automatic / onStart) |
| several `label` edges into one target | applied in ascending `edge.id` to the running value, then **one** clamp at the end of Phase 0 |
| `label` + `activator` into one target | independent — `label` always applies; `activator` gates *firing*, not the `label` edit |
| a state edge and a resource edge between the same pair | independent; different `kind`, resolved in different phases |
| **state cycle** (A→B→…→A via state edges) | **allowed, no detection.** Phase 0 is a pure function of `prev`; effects chase step by step, exactly like a resource loop needs a Pool. A cycle may oscillate forever — a valid non-terminating run, not an error. `ended` is unaffected (I10-S). |

Determinism: `triggered` / `enabled` are set membership; `label` order and
`stateEvents` order are by `edge.id`; the queue is sorted `(deliveryStep,
edgeId)`. No step result depends on the order of the `nodes` / `edges` arrays
(I8-S).

---

## S8. `state`, Reset, queue lifecycle, and Monte-Carlo isolation

`SimState` gains two fields:

- `fired: string[]` — the previous step's fired set (already computed; now
  carried so Phase 0 and scheduling can read it).
- `triggerQueue: { edgeId: string; target: string; deliveryStep: number }[]` —
  pending delayed triggers. **Canonical order: `(deliveryStep, edgeId)`
  ascending.** `edgeId` is carried so a delivery from a since-deleted edge can
  be dropped, and so the ordering is stable.

Lifecycle:

- `initSim(nodes)` sets `fired: []`, `triggerQueue: []` (plus the existing
  `values` / `step: 0` / `ended: false`).
- **Reset, and any simulation-relevant graph edit / Import** rebuild `state`
  through `initSim` (the sim store already resets on `simulationRev`), so the
  queue is **cleared** — every pending trigger and delay is discarded (I6′).
- **Delivery-time guard:** when a queued entry comes due, if its `edgeId` no
  longer exists in the graph, **or** its `target` no longer exists, the entry is
  removed and produces **no** `triggered` mark and **no** `stateEvent`
  (a one-line diagnostic is allowed). This is defence-in-depth on top of the
  clear-on-edit rule.
- **After `ended`:** the step loop stops; `triggerQueue` is simply never read
  again. Monte-Carlo carry-forward (`SEMANTICS-B2.md`) repeats the last
  committed `values` and is **not** affected by any residual queue.
- **Monte-Carlo isolation (I9-S):** `fired` and `triggerQueue` live in
  `SimState`, which `fillOneRun` (`SEMANTICS-B2.md`) creates fresh per run via
  `initSim`. There is **no module-level state**. Run *i*'s pending triggers can
  never leak into run *j*.

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
    | { kind: 'trigger';  delivered: true; applied: boolean }
    | { kind: 'activator'; satisfied: boolean }
    | { kind: 'label';     delta: number; applied: number }
}[]
```

- Emitted in **ascending `edgeId`**.
- **`trigger`** — one entry in the step the pulse is *delivered* (Phase 0 of the
  due step), one per contributing edge (§S3.3). `applied` =
  `(to is passive/interactive) ∧ enabled(to)` — i.e. whether the pulse actually
  made the target eligible to fire. For `automatic` / `onStart` targets, or a
  disabled target, `applied: false`. The UI pulses the edge on `delivered`
  regardless of `applied`.
- **`activator`** — one entry every step for every activator edge, carrying the
  current boolean. The UI shows a steady "on" tint while `satisfied`, dim
  otherwise — no travelling pulse.
- **`label`** — one entry per step per label edge that applied, `delta` = the
  raw requested change, `applied` = the change after the target's end-of-Phase-0
  clamp (`applied ≠ delta` ⇒ a truncated push/pull, surfaced).
- `report.fired` now includes `passive` / `interactive` nodes that fired via a
  trigger. The node **firing pulse** still uses `fired` only (`SEMANTICS.md`
  decision 5) — a trigger-fired passive node pulses like any other firing node.
- `report.events` (resource transfers) is **unchanged**; `label` edits never
  appear there.

---

## S10. Invariants

| # | Invariant |
|---|---|
| **I1′** | **Conservation (resource flow).** Per step, over **resource** movement only: `Σ Pool(after) = Σ Pool(before) + Σ Source push + Σ label applied − Σ Drain/End pull − Σ Converter net loss`. The `Σ label applied` term is the explicit external source/sink; every other transit conserves. |
| **I2–I5** | Unchanged. `label` pre-adjusts `working` before Phase 1, so capacity (I3) and back-pressure retention (I4) still hold downstream; a disabled router keeps zero-storage (I5) and drops nothing (I4). |
| **I6′** | **Determinism.** `step` pure; `initSim` total. `state` = `{ step, values, ended, fired, triggerQueue }`. Same graph + same start ⇒ identical `state` sequence, `report.events`, and `report.stateEvents`, on every run and after every Reset. |
| **I7** | Unchanged (resource iteration-order invariance). |
| **I8-S** | **State iteration-order invariance.** Reversing the `nodes` and/or `edges` arrays yields identical `values`, `fired`, `events`, `stateEvents`, and `triggerQueue` (by canonical order). Via `edge.id` order for `label` / `stateEvents` / queue, and set membership for `triggered` / `enabled`. |
| **I9-S** | **Monte-Carlo per-run isolation.** No module-level state; each run's `fired` / `triggerQueue` come from its own `initSim` and are discarded at run end. Result of run *i* is independent of any earlier run. |
| **I10-S** | **State never ends a run.** `ended` comes only from an End node receiving `> epsilon`. An oscillating state cycle is a valid non-terminating run. |

---

## S11. Representative samples & expected results (test basis)

`epsilon = 1e-9`; all pull nodes `pull any`; `S` = previous step's committed
values; `deliveryStep = t + delay + 1`. These tables are the freeze target.

### Case S-A — trigger + passive activation, `delay = 0`

```
Src ──e1:2──► Pool P ──e2:1──► Drain D            D: activation = passive
 (auto,        (init 0,        (pulls 1 from P)
  push any)     cap ∞)
Src ┄┄ t1: trigger, delay 0 ┄┄► D                 (Src bottom → D top)
```

Src fires every step ⇒ at end of step *t* it schedules D for step
`t + 0 + 1`. D is `passive`: it fires only on a step it is triggered.

| step | P | Src→P | P→D | D triggered? | queue after step |
|---:|---:|---:|---:|:--:|---|
| 0 | 0 | – | – | – | `[]` (initial; `fired = []`) |
| 1 | 2 | 2 | 0 | **no** | `[{t1,D,2}]` (Src fired step 1 → due `1+0+1`) |
| 2 | 3 | 2 | 1 | **yes** | `[{t1,D,3}]` (delivered `{…,2}`; D pulls `min(1, S[P]=2)`) |
| 3 | 4 | 2 | 1 | yes | `[{t1,D,4}]` — steady `+2 −1` |
| ≥3 | +1/step | 2 | 1 | yes | P rises by 1 each step |

`fired`: step 1 = {Src}; step ≥ 2 = {Src, D}. `stateEvents` step ≥ 2: one
`{edgeId:t1, mode:trigger, effect:{kind:trigger, delivered:true, applied:true}}`.

**Variant S-A2 — `delay = 2`.** The pulse from Src firing in step 1 is due step
`1 + 2 + 1 = 4`; every later step schedules one too, so D fires every step from
4 on. P = 0, 2, 4, 6, 7, 8, 9, … — rises by 2 through step 3, by 1 from step 4
(step 4: `working` 6 → +2 → 8, D pulls `min(1, S[P]=6)=1` → 7).

### Case S-B — activator level gate (AND of two)

```
Src ──e1:3──► Pool P ──e2:2──► Drain D            D: activation = automatic
Gauge A (Pool, init 6) ┄┄ a1: activator ">= 5" ┄┄► D
Gauge B (Pool, init 4) ┄┄ a2: activator ">= 5" ┄┄► D
```

A and B have no in/out edges — constant. `enabled(D) = (S[A] ≥ 5) ∧ (S[B] ≥ 5)
= true ∧ false = false` every step.

| step | P | Src→P | P→D | enabled(D) |
|---:|---:|---:|---:|:--:|
| 0 | 0 | – | – | – |
| 1 | 3 | 3 | 0 | **false** |
| 2 | 6 | 3 | 0 | false |
| ≥1 | +3/step | 3 | 0 | false |

`fired` every step = {Src}. `stateEvents` every step, ascending id:
`a1 {activator, satisfied:true}`, `a2 {activator, satisfied:false}`.

**Variant S-B2 — Gauge B init `5`.** `enabled(D) = true` from step 1:

| step | P (commit) | Src→P | P→D (from `S[P]`) |
|---:|---:|---:|---:|
| 0 | 0 | – | – |
| 1 | 3 | 3 | 0 (S[P]=0) |
| 2 | 4 | 3 | 2 (S[P]=3) |
| 3 | 5 | 3 | 2 (S[P]=4) |
| 4 | 6 | 3 | 2 |
| ≥3 | +1/step | 3 | 2 | net +1, no steady state (Src 3 > Drain 2) |

### Case S-C — label modifier (non-conserving), order + single clamp

```
Feeder F (Pool, init 10, isolated — never debited)
F ┄┄ m1: label "-1" ┄┄► Tank T
F ┄┄ m2: label "+S"  ┄┄► Tank T          (edge id m2 > m1 ⇒ applied second)
Tank T: Pool, init 0, cap 8
T ──e1:4──► Drain D  (auto)
```

Phase 0, per step, from `working[T] = S[T]`: apply `m1` (`−1`), then `m2`
(`+S[F] = +10`) ⇒ `working[T] = S[T] + 9`; then the single clamp to `[0, 8]`;
then Phase 2 Drain pulls `min(4, S[T])`.

| step | S[T] | after m1 (−1) | after m2 (+10) | clamp→[0,8] | Drain pull | T (commit) |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | – | – | – | – | 0 |
| 1 | 0 | −1 | 9 | **8** | 0 (S[T]=0) | 8 |
| 2 | 8 | 7 | 17 | **8** | 4 (S[T]=8) | 4 |
| 3 | 4 | 3 | 13 | **8** | 4 | 4 |
| ≥3 | 4 | 3 | 13 | 8 | 4 | 4 → steady |

`S[F] = 10` forever (F is only read). I1′: T's change per step =
`Σ label applied` − `Drain pull`. `stateEvents` per step, ascending id:
`m1 {label, delta:-1, applied:-1}`, `m2 {label, delta:+10, applied:+X}` where
`+X` is the post-clamp contribution (step 2: from 7, requested +10 → 17,
clamped to 8 ⇒ `applied:+1`). `report.events` never contains `m1` / `m2`.

---

## S12. Decisions — resolved

| # | decision |
|---|---|
| **D1** | **Activator combine = AND, v1 only.** No per-edge `all/any`. If added later it is a **target-level** policy, not an edge attribute. |
| **D2** | **A trigger on an `automatic` / `onStart` target has no execution effect**, but the delivery is emitted as a `stateEvent` with `applied: false` so the UI pulses and the run is debuggable. |
| **D3** | **`label` clamp once**, at the end of Phase 0, after all edge-id-ordered modifiers; then `[0, capacity]` (`[0, ∞)` if uncapped). |
| **D4** | **Non-Pool `activator` / `label` source ⇒ inert + diagnostic.** `fired ? 1 : 0` over-extends the meaning. Only `trigger` accepts any node as source in v1. |
| **D5** | **`delay` is an edge field** (`StateEdgeData.delay?: number`) — graph structure, not a run-config concern. (This decision is resolved, not removed.) |
| **D6** | **A disabled router's `inbox` stays with the upstream node.** Zero-storage routers never discard; back-pressure invariants (I4, I5) are preserved. |
| **D7** | **`interactive` == `passive` in headless / Monte-Carlo.** A future live-UI user click is modelled as an **external trigger pulse** delivered into the node that step; the doc leaves that room but the engine ships them identical. |

---

## S13. Implementation slices (after freeze)

Each slice is a reviewable branch checkpoint. The §S11 tables gate slices 1–4;
new tables gate 3 and 5. **Reverse-array determinism (I8-S) is asserted in every
slice.**

1. **Trigger + passive activation.** `state` gains `fired` + `triggerQueue`
   (`{edgeId,target,deliveryStep}`); Phase 0 delivers `delay = 0` pulses;
   `passive` / `interactive` fire on delivery; `automatic` / `onStart` get
   `applied:false` events; delivery-time guard for deleted edge/target;
   `report.stateEvents` for triggers; simultaneous-pulse OR (§S3.3). Case
   **S-A**.
2. **Activator.** `enabled(n)` gate, AND-combine, empty set ⇒ true; `automatic`
   pause + `passive` hold-off; `onStart` gated-once; disabled-router inbox
   retention; `stateEvents` for activators. Cases **S-B / S-B2**.
3. **Delay & condition.** `StateEdgeData.delay`; `deliveryStep = t + delay + 1`;
   queue sort `(deliveryStep, edgeId)`; `activator` comparison grammar hardened;
   Variant **S-A2**; Monte-Carlo isolation test (I9-S); Reset / graph-edit
   queue-clear test.
4. **Label modifier.** Phase-0 numeric edits, source & target both Pools,
   `edge.id` order, single end-of-Phase-0 clamp, `NaN`/Inf/bad-expr inert,
   floor-only when uncapped; I1′ carve-out; `stateEvents` for labels. Case
   **S-C** + a conservation test carrying the `label` term.
5. **UI pulse + Inspector.** Travelling pulse for `trigger`, steady tint for
   `activator`, delta flash for `label`; Inspector gains `delay` and validates
   `expr` per mode; **legacy `mode: 'node'` / unknown modes load inert with a
   diagnostic — no automatic `node → label` conversion** (an explicit migration
   action only, and only if a fixture proves the intended meaning).
